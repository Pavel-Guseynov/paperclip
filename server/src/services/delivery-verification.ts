import { and, desc, eq } from "drizzle-orm";
import {
  executionWorkspaces,
  issueWorkProducts,
  projectWorkspaces,
  type Db,
} from "@paperclipai/db";
import type {
  IssueTerminalEvidence,
  IssueTerminalEvidenceRecord,
  VerifiedDeliveryReceipt,
} from "@paperclipai/shared";
import { HttpError } from "../errors.js";
import { DEFAULT_GITHUB_TOKEN_SECRET_NAMES, resolveManagedGitHubCredential } from "./git-credentials.js";
import { ghFetch, gitHubApiBase, isGitHubDotCom } from "./github-fetch.js";
import { secretService } from "./secrets.js";
import { isLowTrustQuarantined } from "./source-trust.js";

/**
 * Stable codes a caller can branch on. Every one of them means "not verified"; the
 * terminal write never happens on any of them.
 */
export const DELIVERY_ERROR_CODES = {
  EVIDENCE_MISSING: "delivery_evidence_missing",
  SOURCE_QUARANTINED: "delivery_unverified_source_quarantined",
  REPOSITORY_UNCONFIGURED: "delivery_unverified_repository_unconfigured",
  UNSUPPORTED_PROVIDER: "delivery_unverified_unsupported_provider",
  BASE_UNCONFIGURED: "delivery_unverified_base_unconfigured",
  PULL_REQUEST_UNRESOLVED: "delivery_unverified_pull_request_unresolved",
  PULL_REQUEST_MISMATCH: "delivery_unverified_pull_request_mismatch",
  REVIEWED_HEAD_UNRESOLVED: "delivery_unverified_reviewed_head_unresolved",
  CREDENTIALS_UNAVAILABLE: "delivery_unverified_credentials_unavailable",
  NOT_MERGED: "delivery_unverified_not_merged",
  BASE_MISMATCH: "delivery_unverified_base_mismatch",
  HEAD_MISMATCH: "delivery_unverified_head_mismatch",
  CHECKS_FAILING: "delivery_unverified_checks_failing",
  CHECKS_PENDING: "delivery_unverified_checks_pending",
  CHECKS_UNVERIFIABLE: "delivery_unverified_checks_unverifiable",
  UNREACHABLE: "delivery_unverified_unreachable",
  REPOSITORY_UNAVAILABLE: "delivery_unverified_repository_unavailable",
  STALE: "delivery_verification_stale",
} as const;

export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[keyof typeof DELIVERY_ERROR_CODES];

export class DeliveryVerificationError extends HttpError {
  code: DeliveryErrorCode;

  constructor(code: DeliveryErrorCode, message: string, details?: unknown) {
    super(409, message, {
      code,
      ...(typeof details === "object" && details ? details : {}),
    });
    this.code = code;
  }
}

/**
 * The only provider this service can verify at the current upstream tree: github.com.
 * A GitHub Enterprise host, a Gitea host, or any other remote has no server-side
 * credential path here, so it fails closed rather than being probed with a token that
 * was never scoped to it.
 */
export const SUPPORTED_DELIVERY_HOST = "github.com";

const FULL_SHA = /^[0-9a-f]{40}$/i;

/** GitHub's maximum page size, and a bound on how many pages one read will fetch. */
const CHECK_PAGE_SIZE = 100;
const CHECK_PAGE_LIMIT = 10;

export interface DeliveryChecksSummary {
  status: "passed" | "pending" | "failed";
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /**
   * False when the provider reported more checks than this read collected. A partial
   * read cannot establish "all checks passed" — the failing one may be on a page that
   * was never fetched — so the caller treats it as unverifiable, never as a pass.
   */
  complete: boolean;
}

export interface DeliveryPullRequestDetails {
  state: "open" | "closed";
  merged: boolean;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  headSha: string;
  baseRef: string;
}

export interface DeliveryProviderClient {
  provider: "github";
  getPullRequest(params: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<DeliveryPullRequestDetails>;
  getChecks(params: { owner: string; repo: string; ref: string }): Promise<DeliveryChecksSummary>;
  isReachableInBase(params: {
    owner: string;
    repo: string;
    baseRef: string;
    headSha: string;
    mergeCommitSha: string | null;
  }): Promise<boolean>;
}

/**
 * Parse a repository remote that an operator configured on a workspace row.
 *
 * Only `github.com` over https or ssh resolves. Everything else — including a GitHub
 * Enterprise hostname — returns null, because the credential this service can reach is
 * scoped to github.com alone.
 */
export function parseConfiguredGitHubRepo(
  remote: string | null | undefined,
): { owner: string; repo: string } | null {
  const raw = typeof remote === "string" ? remote.trim() : "";
  if (!raw) return null;
  let host: string;
  let path: string;
  const sshMatch = raw.match(/^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/i);
  if (sshMatch) {
    host = sshMatch[1]!;
    path = sshMatch[2]!;
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    host = url.hostname;
    path = url.pathname;
  }
  if (!isGitHubDotCom(host)) return null;
  const parts = path.replace(/^\/+/, "").replace(/\.git$/i, "").split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { owner, repo };
}

/**
 * A branch ref as the provider names it.
 *
 * An operator may configure `main`, `refs/heads/main` or `origin/main` for the same
 * branch; GitHub reports the pull request's base as `main`. Comparing the raw strings
 * would call those a base mismatch, so both sides are reduced to the branch name.
 */
export function normalizeBaseRef(ref: string): string {
  return ref.trim().replace(/^refs\/heads\//, "").replace(/^origin\//, "");
}

/** Parse a github.com pull-request URL recorded on a work product. */
export function parseGitHubPullRequestUrl(
  value: string | null | undefined,
): { owner: string; repo: string; pullNumber: number } | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isGitHubDotCom(url.hostname)) return null;
  const parts = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length !== 4) return null;
  const [owner, repo, kind, rawNumber] = parts;
  if (!owner || !repo || kind !== "pull" || !rawNumber) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  if (!/^[1-9][0-9]*$/.test(rawNumber)) return null;
  return { owner, repo, pullNumber: Number(rawNumber) };
}

export type DeliveryTargetIssue = {
  id: string;
  companyId: string;
  projectId?: string | null;
  sourceTrust?: unknown;
};

export type DeliveryTarget = {
  owner: string;
  repo: string;
  pullNumber: number;
  baseRef: string;
  reviewedHeadSha: string;
  repoSource: "execution_workspace" | "project_workspace";
};

export type DeliveryTargetResolution =
  | { ok: true; target: DeliveryTarget }
  | { ok: false; errorCode: DeliveryErrorCode; reason: string };

function sha(value: unknown): string | null {
  return typeof value === "string" && FULL_SHA.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/**
 * The exact reviewed head this issue records, read from its own `commit` work product.
 *
 * This is the revision identity a review is keyed on. It is server-held state: a caller
 * cannot name it, and an abbreviated or absent SHA resolves to null rather than to a
 * guess.
 */
export async function resolveReviewedHeadSha(
  db: Db,
  issue: Pick<DeliveryTargetIssue, "id" | "companyId">,
): Promise<string | null> {
  const rows = await db
    .select({
      externalId: issueWorkProducts.externalId,
      metadata: issueWorkProducts.metadata,
    })
    .from(issueWorkProducts)
    .where(
      and(
        eq(issueWorkProducts.companyId, issue.companyId),
        eq(issueWorkProducts.issueId, issue.id),
        eq(issueWorkProducts.type, "commit"),
        eq(issueWorkProducts.provider, "github"),
      ),
    )
    .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return sha(row.externalId) ?? sha((row.metadata as Record<string, unknown> | null)?.sha);
}

/**
 * Resolve the verification target from server-held state only.
 *
 * Nothing on this path reads the request body. The repository and the base branch come
 * from the workspace row an operator configured; the pull request and the reviewed head
 * come from this issue's own work products, read under the issue's company. A caller can
 * therefore not point verification at a host, repository, or credential of its choosing.
 */
export async function resolveDeliveryTarget(
  db: Db,
  issue: DeliveryTargetIssue,
): Promise<DeliveryTargetResolution> {
  if (isLowTrustQuarantined(issue.sourceTrust as never)) {
    return {
      ok: false,
      errorCode: DELIVERY_ERROR_CODES.SOURCE_QUARANTINED,
      reason: "Delivery verification is not available to a quarantined low-trust issue.",
    };
  }

  let configuredRemote: string | null = null;
  let configuredBase: string | null = null;
  let repoSource: DeliveryTarget["repoSource"] = "execution_workspace";

  const executionWorkspaceRows = await db
    .select({
      repoUrl: executionWorkspaces.repoUrl,
      baseRef: executionWorkspaces.baseRef,
    })
    .from(executionWorkspaces)
    .where(
      and(
        eq(executionWorkspaces.companyId, issue.companyId),
        eq(executionWorkspaces.sourceIssueId, issue.id),
      ),
    )
    .orderBy(desc(executionWorkspaces.lastUsedAt))
    .limit(1);
  const executionWorkspace = executionWorkspaceRows[0];
  if (executionWorkspace?.repoUrl) {
    configuredRemote = executionWorkspace.repoUrl;
    configuredBase = executionWorkspace.baseRef ?? null;
  }

  if (!configuredRemote && issue.projectId) {
    const projectWorkspaceRows = await db
      .select({
        repoUrl: projectWorkspaces.repoUrl,
        defaultRef: projectWorkspaces.defaultRef,
        isPrimary: projectWorkspaces.isPrimary,
      })
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.companyId, issue.companyId),
          eq(projectWorkspaces.projectId, issue.projectId),
        ),
      )
      .orderBy(desc(projectWorkspaces.isPrimary), desc(projectWorkspaces.updatedAt))
      .limit(1);
    const projectWorkspace = projectWorkspaceRows[0];
    if (projectWorkspace?.repoUrl) {
      configuredRemote = projectWorkspace.repoUrl;
      configuredBase = projectWorkspace.defaultRef ?? null;
      repoSource = "project_workspace";
    }
  }

  if (!configuredRemote) {
    return {
      ok: false,
      errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNCONFIGURED,
      reason:
        "No execution or project workspace for this issue records a repository remote, so there is nothing to verify against.",
    };
  }

  const repository = parseConfiguredGitHubRepo(configuredRemote);
  if (!repository) {
    return {
      ok: false,
      errorCode: DELIVERY_ERROR_CODES.UNSUPPORTED_PROVIDER,
      reason: `Delivery verification supports ${SUPPORTED_DELIVERY_HOST} remotes only; this issue's configured remote is not one.`,
    };
  }

  const baseRef = typeof configuredBase === "string" ? normalizeBaseRef(configuredBase) : "";
  if (!baseRef) {
    return {
      ok: false,
      errorCode: DELIVERY_ERROR_CODES.BASE_UNCONFIGURED,
      reason:
        "The configured workspace does not name a live base branch, so a merge into it cannot be verified.",
    };
  }

  const workProducts = await db
    .select({
      type: issueWorkProducts.type,
      provider: issueWorkProducts.provider,
      externalId: issueWorkProducts.externalId,
      url: issueWorkProducts.url,
      isPrimary: issueWorkProducts.isPrimary,
      metadata: issueWorkProducts.metadata,
    })
    .from(issueWorkProducts)
    .where(
      and(
        eq(issueWorkProducts.companyId, issue.companyId),
        eq(issueWorkProducts.issueId, issue.id),
      ),
    )
    .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt));

  const pullRequestProduct = workProducts.find(
    (row) => row.type === "pull_request" && row.provider === "github",
  );
  const pullRequest = parseGitHubPullRequestUrl(pullRequestProduct?.url ?? null);
  if (!pullRequest) {
    return {
      ok: false,
      errorCode: DELIVERY_ERROR_CODES.PULL_REQUEST_UNRESOLVED,
      reason:
        "This issue records no GitHub pull-request work product with a github.com pull URL, so there is no reviewed delivery to verify.",
    };
  }
  if (
    pullRequest.owner.toLowerCase() !== repository.owner.toLowerCase() ||
    pullRequest.repo.toLowerCase() !== repository.repo.toLowerCase()
  ) {
    return {
      ok: false,
      errorCode: DELIVERY_ERROR_CODES.PULL_REQUEST_MISMATCH,
      reason: `The recorded pull request belongs to ${pullRequest.owner}/${pullRequest.repo}, not to the configured repository ${repository.owner}/${repository.repo}.`,
    };
  }

  const commitProduct = workProducts.find(
    (row) => row.type === "commit" && row.provider === "github",
  );
  const reviewedHeadSha =
    sha(commitProduct?.externalId) ??
    sha((commitProduct?.metadata as Record<string, unknown> | null)?.sha);
  if (!reviewedHeadSha) {
    return {
      ok: false,
      errorCode: DELIVERY_ERROR_CODES.REVIEWED_HEAD_UNRESOLVED,
      reason:
        "This issue records no GitHub commit work product naming a full 40-character reviewed head SHA.",
    };
  }

  return {
    ok: true,
    target: {
      owner: repository.owner,
      repo: repository.repo,
      pullNumber: pullRequest.pullNumber,
      baseRef,
      reviewedHeadSha,
      repoSource,
    },
  };
}

/**
 * Company-scoped credential resolution, in the order upstream already declares for GitHub
 * remotes: the managed GitHub identity first, then a company secret held by a well-known
 * name. A configured managed identity that cannot produce a credential fails closed
 * instead of falling through. The server process environment is deliberately not a source
 * here: an operator's ambient token is not scoped to this company.
 */
export async function resolveDeliveryCredentialToken(
  db: Db,
  input: { companyId: string; issueId: string },
): Promise<string | null> {
  const secrets = secretService(db);
  const managed = await resolveManagedGitHubCredential(db, secrets, input.companyId, {
    issueId: input.issueId,
    allowStandingDelegation: false,
  });
  if (managed.configured) {
    return managed.credential?.token?.trim() || null;
  }
  for (const secretName of DEFAULT_GITHUB_TOKEN_SECRET_NAMES) {
    const secret = await Promise.resolve(secrets.getByName(input.companyId, secretName)).catch(
      () => null,
    );
    if (!secret) continue;
    const token = await secrets
      .resolveSecretValue(input.companyId, secret.id, "latest", {
        accessContext: {
          consumerType: "system",
          consumerId: "delivery-verification",
          actorType: "system",
          issueId: input.issueId,
          heartbeatRunId: null,
          responsibleUserId: null,
        },
      })
      .then((value) => value.trim())
      .catch(() => "");
    if (token) return token;
  }
  return null;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "paperclip-delivery-verification",
    "x-github-api-version": "2022-11-28",
    authorization: `Bearer ${token}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `base...head` containment. GitHub reports `ahead_by` as the number of commits `head`
 * carries that `base` does not; containment is exactly `ahead_by === 0`. The `status`
 * field is only consulted when the count is absent: `ahead` means the head is NOT in the
 * base, which is the opposite of what this predicate is looking for.
 */
export function comparisonContainsHead(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  const aheadBy = body.ahead_by;
  if (typeof aheadBy === "number" && Number.isFinite(aheadBy)) return aheadBy === 0;
  const status = typeof body.status === "string" ? body.status : "";
  return status === "identical" || status === "behind";
}

export function createGitHubDeliveryClient(options: {
  token: string;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}): DeliveryProviderClient {
  const apiBase = gitHubApiBase(SUPPORTED_DELIVERY_HOST);
  const doFetch = options.fetchFn ?? ghFetch;
  const headers = githubHeaders(options.token);

  const compare = async (owner: string, repo: string, base: string, head: string) => {
    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const res = await doFetch(url, { headers });
    if (!res.ok) return false;
    return comparisonContainsHead(asRecord(await res.json().catch(() => null)));
  };

  return {
    provider: "github",
    async getPullRequest({ owner, repo, pullNumber }) {
      const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`;
      const res = await doFetch(url, { headers });
      if (!res.ok) {
        throw new DeliveryVerificationError(
          DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
          `GitHub returned HTTP ${res.status} for pull request #${pullNumber} in ${owner}/${repo}.`,
        );
      }
      const body = asRecord(await res.json().catch(() => null));
      if (!body) {
        throw new DeliveryVerificationError(
          DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
          `GitHub returned an unreadable pull-request response for #${pullNumber} in ${owner}/${repo}.`,
        );
      }
      const head = asRecord(body.head);
      const base = asRecord(body.base);
      return {
        state: body.state === "closed" ? "closed" : "open",
        merged: body.merged === true,
        mergedAt: typeof body.merged_at === "string" ? body.merged_at : null,
        mergeCommitSha: sha(body.merge_commit_sha),
        headSha: sha(head?.sha) ?? "",
        baseRef: typeof base?.ref === "string" ? base.ref : "",
      };
    },
    async getChecks({ owner, repo, ref }) {
      const prefix = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`;

      /**
       * Read every page the provider says exists.
       *
       * The default page size is 30. A repository with more checks than that would
       * otherwise report "all passed" from page one while a failing run sat on page
       * two. `total_count` is the provider's own count, so a read that ends short of
       * it is reported as incomplete rather than summarized.
       */
      const readAll = async (path: string, key: string) => {
        const collected: unknown[] = [];
        let expected: number | null = null;
        for (let page = 1; page <= CHECK_PAGE_LIMIT; page++) {
          const res = await doFetch(`${prefix}${path}?per_page=${CHECK_PAGE_SIZE}&page=${page}`, {
            headers,
          });
          if (!res.ok) {
            throw new DeliveryVerificationError(
              DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
              `GitHub returned HTTP ${res.status} for ${key} on ${ref}.`,
            );
          }
          const body = asRecord(await res.json().catch(() => null));
          const entries = Array.isArray(body?.[key]) ? (body[key] as unknown[]) : [];
          if (typeof body?.total_count === "number" && Number.isFinite(body.total_count)) {
            expected = body.total_count;
          }
          collected.push(...entries);
          if (entries.length < CHECK_PAGE_SIZE) break;
          if (expected !== null && collected.length >= expected) break;
        }
        return { collected, complete: expected === null || collected.length >= expected };
      };

      const checkRuns = await readAll("/check-runs", "check_runs");
      const statuses = await readAll("/status", "statuses");

      let passed = 0;
      let failed = 0;
      let pending = 0;
      for (const entry of checkRuns.collected) {
        const run = asRecord(entry);
        const conclusion = typeof run?.conclusion === "string" ? run.conclusion : "";
        if (run?.status !== "completed" || !conclusion) pending++;
        else if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") passed++;
        else failed++;
      }
      for (const entry of statuses.collected) {
        const status = asRecord(entry);
        const state = typeof status?.state === "string" ? status.state : "";
        if (state === "success") passed++;
        else if (state === "pending") pending++;
        else failed++;
      }

      const total = checkRuns.collected.length + statuses.collected.length;
      return {
        status: failed > 0 ? "failed" : pending > 0 ? "pending" : "passed",
        total,
        passed,
        failed,
        pending,
        complete: checkRuns.complete && statuses.complete,
      };
    },
    async isReachableInBase({ owner, repo, baseRef, headSha, mergeCommitSha }) {
      if (await compare(owner, repo, baseRef, headSha)) return true;
      if (mergeCommitSha && (await compare(owner, repo, baseRef, mergeCommitSha))) return true;
      return false;
    },
  };
}

export interface VerifyTerminalDeliveryInput {
  db: Db;
  issue: DeliveryTargetIssue;
  evidence?: IssueTerminalEvidence | null;
}

export type VerifyTerminalDeliveryResult =
  | { verified: true; receipt: VerifiedDeliveryReceipt; target: DeliveryTarget }
  | { verified: false; errorCode: DeliveryErrorCode; reason: string };

export class DeliveryVerificationService {
  async verifyTerminalDelivery(
    input: VerifyTerminalDeliveryInput,
  ): Promise<VerifyTerminalDeliveryResult> {
    const claimedPr = input.evidence?.pr;
    const claimedMergedSha = sha(input.evidence?.mergedSha);
    if (claimedPr == null || !claimedMergedSha) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.EVIDENCE_MISSING,
        reason:
          "A code task requires delivery evidence naming the pull request and the full 40-character merged SHA before terminal completion.",
      };
    }
    const claimedPullNumber = Number(String(claimedPr).replace(/^#/, "").trim());
    if (!Number.isSafeInteger(claimedPullNumber) || claimedPullNumber <= 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.EVIDENCE_MISSING,
        reason: "evidence.pr must name a positive pull-request number.",
      };
    }

    const resolution = await resolveDeliveryTarget(input.db, input.issue);
    if (!resolution.ok) {
      return { verified: false, errorCode: resolution.errorCode, reason: resolution.reason };
    }
    const target = resolution.target;

    if (claimedPullNumber !== target.pullNumber) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.PULL_REQUEST_MISMATCH,
        reason: `evidence.pr names #${claimedPullNumber}, but this issue's recorded pull request is #${target.pullNumber}.`,
      };
    }

    const token = await resolveDeliveryCredentialToken(input.db, {
      companyId: input.issue.companyId,
      issueId: input.issue.id,
    });
    if (!token) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CREDENTIALS_UNAVAILABLE,
        reason:
          "No company-scoped GitHub credential is available, so delivery cannot be verified against the repository.",
      };
    }
    const client = createGitHubDeliveryClient({ token });

    let pr: DeliveryPullRequestDetails;
    try {
      pr = await client.getPullRequest({
        owner: target.owner,
        repo: target.repo,
        pullNumber: target.pullNumber,
      });
    } catch (err) {
      return {
        verified: false,
        errorCode:
          err instanceof DeliveryVerificationError
            ? err.code
            : DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: err instanceof Error ? err.message : "Failed to read the pull request.",
      };
    }

    if (pr.state !== "closed" || !pr.merged) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.NOT_MERGED,
        reason: `Pull request #${target.pullNumber} in ${target.owner}/${target.repo} is not merged.`,
      };
    }

    if (normalizeBaseRef(pr.baseRef) !== target.baseRef) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.BASE_MISMATCH,
        reason: `Base branch mismatch: the configured live base branch is "${target.baseRef}", but the pull request merged into "${pr.baseRef}".`,
      };
    }

    const providerHeadSha = sha(pr.headSha);
    if (!providerHeadSha || providerHeadSha !== target.reviewedHeadSha) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH,
        reason: `Head SHA mismatch: the reviewed head is "${target.reviewedHeadSha}", but the pull request head is "${providerHeadSha ?? "unknown"}".`,
      };
    }

    const providerMergeSha = sha(pr.mergeCommitSha);
    if (claimedMergedSha !== providerHeadSha && claimedMergedSha !== providerMergeSha) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH,
        reason: `Claimed mergedSha "${claimedMergedSha}" is neither the pull-request head "${providerHeadSha}" nor its merge commit "${providerMergeSha ?? "unknown"}".`,
      };
    }

    let checks: DeliveryChecksSummary;
    try {
      checks = await client.getChecks({
        owner: target.owner,
        repo: target.repo,
        ref: providerHeadSha,
      });
    } catch (err) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: err instanceof Error ? err.message : "Failed to read the commit checks.",
      };
    }

    if (!checks.complete) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_UNVERIFIABLE,
        reason: `The provider reports more checks on "${providerHeadSha}" than this read collected, so "all required checks passed" cannot be established.`,
      };
    }
    if (checks.total === 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_UNVERIFIABLE,
        reason: `No check run or commit status is reported for "${providerHeadSha}", so "all required checks passed" cannot be established.`,
      };
    }
    if (checks.pending > 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_PENDING,
        reason: `${checks.pending} check(s) are still pending on "${providerHeadSha}".`,
      };
    }
    if (checks.failed > 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_FAILING,
        reason: `${checks.failed} check(s) failed on "${providerHeadSha}".`,
      };
    }

    let reachable: boolean;
    try {
      reachable = await client.isReachableInBase({
        owner: target.owner,
        repo: target.repo,
        baseRef: target.baseRef,
        headSha: providerHeadSha,
        mergeCommitSha: providerMergeSha,
      });
    } catch (err) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.UNREACHABLE,
        reason: err instanceof Error ? err.message : "Failed to compare against the live base branch.",
      };
    }
    if (!reachable) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.UNREACHABLE,
        reason: `The live base branch "${target.baseRef}" does not contain "${providerHeadSha}".`,
      };
    }

    const receipt: VerifiedDeliveryReceipt = {
      verifiedAt: new Date().toISOString(),
      provider: "github",
      repository: `${target.owner}/${target.repo}`,
      pullRequestNumber: target.pullNumber,
      headSha: providerHeadSha,
      mergedSha: providerMergeSha ?? providerHeadSha,
      baseBranch: target.baseRef,
      repositorySource: target.repoSource,
      checksSummary: {
        total: checks.total,
        passed: checks.passed,
        failed: 0,
        pending: 0,
      },
      reachable: true,
      checkRun: input.evidence?.checkRun != null ? String(input.evidence.checkRun) : null,
      note: input.evidence?.note != null ? String(input.evidence.note) : null,
    };

    return { verified: true, receipt, target };
  }
}

export function createDeliveryVerificationService(): DeliveryVerificationService {
  return new DeliveryVerificationService();
}

/**
 * Re-assert, under the issue row lock, that the server-side binding verification observed
 * is still the binding that is about to be written. Verification itself runs on a pre-lock
 * snapshot; this closes the window in which the recorded pull request, reviewed head, or
 * configured repository changes between the two.
 */
export async function assertDeliveryTargetUnchanged(
  db: Db,
  issue: DeliveryTargetIssue,
  verified: DeliveryTarget,
): Promise<void> {
  const resolution = await resolveDeliveryTarget(db, issue);
  if (!resolution.ok) {
    throw new DeliveryVerificationError(DELIVERY_ERROR_CODES.STALE, resolution.reason);
  }
  const current = resolution.target;
  if (
    current.owner !== verified.owner ||
    current.repo !== verified.repo ||
    current.pullNumber !== verified.pullNumber ||
    current.baseRef !== verified.baseRef ||
    current.reviewedHeadSha !== verified.reviewedHeadSha
  ) {
    throw new DeliveryVerificationError(
      DELIVERY_ERROR_CODES.STALE,
      "The delivery binding changed while this completion was being verified; re-submit the terminal transition.",
    );
  }
}

/**
 * The single entry the transition routes use.
 *
 * Without `evidenceRequired` the claim is persisted exactly as the caller made it, marked
 * unverified — nothing checked it, so nothing may say otherwise. With `evidenceRequired`
 * the claim is checked against the repository the server bound for this issue, and any
 * failure throws with its stable code so the terminal write never happens.
 */
export async function verifyTerminalDecisionEvidence(input: {
  db: Db;
  issue: DeliveryTargetIssue;
  policy?: { evidenceRequired?: boolean } | null;
  evidence: IssueTerminalEvidence | null | undefined;
}): Promise<{ record: IssueTerminalEvidenceRecord | null; target: DeliveryTarget | null }> {
  // A decision without evidence is either a non-terminal decision or an approval on a
  // policy that does not require evidence. `applyIssueExecutionPolicyTransition` is the
  // single place that decides whether the terminal approval needed a claim; duplicating
  // that decision here would give the rule two authorities.
  if (!input.evidence) return { record: null, target: null };

  const claim: IssueTerminalEvidence = {
    pr: input.evidence.pr,
    mergedSha: input.evidence.mergedSha,
    checkRun: input.evidence.checkRun ?? null,
    note: input.evidence.note ?? null,
  };

  if (!input.policy?.evidenceRequired) {
    return { record: { ...claim, verified: false, receipt: null }, target: null };
  }

  const result = await createDeliveryVerificationService().verifyTerminalDelivery({
    db: input.db,
    issue: input.issue,
    evidence: claim,
  });

  if (!result.verified) {
    throw new DeliveryVerificationError(result.errorCode, result.reason);
  }
  return { record: { ...claim, verified: true, receipt: result.receipt }, target: result.target };
}
