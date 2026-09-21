import type {
  IssueExecutionPolicy,
  IssueTerminalEvidence,
  PRReadResult,
  VerifiedDeliveryReceipt,
} from "@paperclipai/shared";
import { HttpError } from "../errors.js";

export const DELIVERY_ERROR_CODES = {
  EVIDENCE_MISSING: "delivery_evidence_missing",
  UNSUPPORTED_PROVIDER: "delivery_unverified_unsupported_provider",
  NOT_MERGED: "delivery_unverified_not_merged",
  BASE_MISMATCH: "delivery_unverified_base_mismatch",
  HEAD_MISMATCH: "delivery_unverified_head_mismatch",
  CHECKS_FAILING: "delivery_unverified_checks_failing",
  CHECKS_FAILED: "delivery_unverified_checks_failing",
  CHECKS_PENDING: "delivery_unverified_checks_pending",
  UNREACHABLE: "delivery_unverified_unreachable",
  REPOSITORY_UNAVAILABLE: "delivery_unverified_repository_unavailable",
  DISPOSITION_INVALID: "delivery_unverified_disposition_invalid",
  WORK_PRODUCTS_MISSING: "delivery_unverified_work_products_missing",
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

export type DeliveryProvider = "github" | "gitea" | "generic";

export interface DeliveryChecksSummary {
  status: "passed" | "pending" | "failed";
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

export interface DeliveryPullRequestDetails {
  state: "open" | "closed";
  merged: boolean;
  mergedAt?: string | null;
  mergeCommitSha?: string | null;
  headSha: string;
  baseRef: string;
  baseSha?: string | null;
}

export interface DeliveryProviderClient {
  provider: DeliveryProvider;
  getPullRequest(params: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<DeliveryPullRequestDetails>;
  getChecks(params: {
    owner: string;
    repo: string;
    ref: string;
  }): Promise<DeliveryChecksSummary>;
  isReachableInBase(params: {
    owner: string;
    repo: string;
    baseRef: string;
    headSha: string;
    mergeCommitSha?: string | null;
  }): Promise<boolean>;
  getPullRequestFiles?(params: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<Array<{ filename: string; status: string; additions: number; deletions: number }>>;
}

export function isOperationTask(issue: {
  kind?: string | null;
  labels?: Array<{ name?: string } | string> | null;
  originKind?: string | null;
}): boolean {
  if (issue.kind === "operation") return true;
  if (issue.originKind === "operation") return true;
  if (Array.isArray(issue.labels)) {
    for (const label of issue.labels) {
      const name = typeof label === "string" ? label : label?.name;
      if (typeof name === "string" && name.toLowerCase() === "operation") {
        return true;
      }
    }
  }
  return false;
}

export function parseRepoAndPr(input: {
  pr?: string | number | null;
  repo?: string | null;
  repoUrl?: string | null;
}): {
  provider: DeliveryProvider;
  owner: string;
  repo: string;
  pullNumber?: number;
  unsupported?: boolean;
} | null {
  const prStr = input.pr != null ? String(input.pr).trim() : "";
  const rawRepo = input.repoUrl?.trim() || input.repo?.trim() || "";

  // Check for unsupported protocols like ftp://
  if (rawRepo.startsWith("ftp://") || prStr.startsWith("ftp://")) {
    return { provider: "generic", owner: "", repo: "", unsupported: true };
  }

  // 1. Full PR URL check: https://github.com/owner/repo/pull/123
  const githubUrlMatch = prStr.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i,
  );
  if (githubUrlMatch) {
    return {
      provider: "github",
      owner: githubUrlMatch[1]!,
      repo: githubUrlMatch[2]!.replace(/\.git$/i, ""),
      pullNumber: parseInt(githubUrlMatch[3]!, 10),
    };
  }

  // Generic / Gitea URL check: https://hostname/owner/repo/pulls/123
  const genericUrlMatch = prStr.match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pulls?\/(\d+)/i,
  );
  if (genericUrlMatch) {
    const host = genericUrlMatch[1]!.toLowerCase();
    const provider: DeliveryProvider = host.includes("github")
      ? "github"
      : host.includes("gitea") || host.includes("git.")
      ? "gitea"
      : "generic";
    return {
      provider,
      owner: genericUrlMatch[2]!,
      repo: genericUrlMatch[3]!.replace(/\.git$/i, ""),
      pullNumber: parseInt(genericUrlMatch[4]!, 10),
    };
  }

  // 2. Parse repository from repo / repoUrl
  let owner = "";
  let repo = "";
  let provider: DeliveryProvider = "github";

  if (rawRepo) {
    const httpMatch = rawRepo.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)/i);
    if (httpMatch) {
      const host = httpMatch[1]!.toLowerCase();
      provider = host.includes("github")
        ? "github"
        : host.includes("gitea") || host.includes("git.")
        ? "gitea"
        : "generic";
      owner = httpMatch[2]!;
      repo = httpMatch[3]!.replace(/\.git$/i, "");
    } else {
      const parts = rawRepo.replace(/^git@[^:]+:/, "").replace(/\.git$/i, "").split("/");
      if (parts.length === 2 && parts[0] && parts[1]) {
        owner = parts[0];
        repo = parts[1];
        provider = "github";
      }
    }
  }

  const pullNum = prStr ? parseInt(prStr.replace(/^#/, ""), 10) : undefined;
  const validPullNum = pullNum && !isNaN(pullNum) && pullNum > 0 ? pullNum : undefined;

  if (owner && repo) {
    return {
      provider,
      owner,
      repo,
      pullNumber: validPullNum,
    };
  }

  return null;
}

export function createGitHubDeliveryClient(options?: {
  apiBase?: string;
  token?: string | null;
  fetchFn?: typeof fetch;
}): DeliveryProviderClient {
  const apiBase = (options?.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
  const token =
    options?.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;

  const getFetch = () => options?.fetchFn ?? globalThis.fetch;

  return {
    provider: "github",
    async getPullRequest({ owner, repo, pullNumber }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Paperclip-Delivery-Verification",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const url = `${apiBase}/repos/${owner}/${repo}/pulls/${pullNumber}`;
      const res = await getFetch()(url, { headers: authHeaders });
      if (!res.ok) {
        if (res.status === 404) {
          throw new DeliveryVerificationError(
            DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
            `Pull request #${pullNumber} not found in repository ${owner}/${repo}`,
          );
        }
        throw new DeliveryVerificationError(
          DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
          `GitHub API error fetching PR #${pullNumber}: ${res.statusText}`,
        );
      }
      const data = (await res.json()) as any;
      return {
        state: data.state === "closed" ? "closed" : "open",
        merged: Boolean(data.merged),
        mergedAt: data.merged_at ?? null,
        mergeCommitSha: data.merge_commit_sha ?? null,
        headSha: data.head?.sha ?? "",
        baseRef: data.base?.ref ?? "",
        baseSha: data.base?.sha ?? null,
      };
    },
    async getPullRequestFiles({ owner, repo, pullNumber }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Paperclip-Delivery-Verification",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const url = `${apiBase}/repos/${owner}/${repo}/pulls/${pullNumber}/files`;
      const res = await getFetch()(url, { headers: authHeaders });
      if (!res.ok) return [];
      const files = (await res.json()) as any[];
      return Array.isArray(files)
        ? files.map((f: any) => ({
            filename: String(f.filename ?? ""),
            status: String(f.status ?? "modified"),
            additions: Number(f.additions ?? 0),
            deletions: Number(f.deletions ?? 0),
          }))
        : [];
    },
    async getChecks({ owner, repo, ref }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Paperclip-Delivery-Verification",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const checkRunsUrl = `${apiBase}/repos/${owner}/${repo}/commits/${ref}/check-runs`;
      const checkRunsRes = await getFetch()(checkRunsUrl, { headers: authHeaders });
      let checkRuns: any[] = [];
      if (checkRunsRes.ok) {
        const body = (await checkRunsRes.json()) as any;
        checkRuns = Array.isArray(body.check_runs) ? body.check_runs : [];
      }

      const statusUrl = `${apiBase}/repos/${owner}/${repo}/commits/${ref}/status`;
      const statusRes = await getFetch()(statusUrl, { headers: authHeaders });
      let statuses: any[] = [];
      if (statusRes.ok) {
        const body = (await statusRes.json()) as any;
        statuses = Array.isArray(body.statuses) ? body.statuses : [];
      }

      let passed = 0;
      let failed = 0;
      let pending = 0;

      for (const run of checkRuns) {
        if (run.status === "in_progress" || run.status === "queued" || !run.conclusion) {
          pending++;
        } else if (
          [
            "failure",
            "timed_out",
            "action_required",
            "cancelled",
            "startup_failure",
          ].includes(run.conclusion)
        ) {
          failed++;
        } else if (["success", "neutral", "skipped"].includes(run.conclusion)) {
          passed++;
        } else {
          failed++;
        }
      }

      for (const s of statuses) {
        if (s.state === "pending") {
          pending++;
        } else if (s.state === "failure" || s.state === "error") {
          failed++;
        } else if (s.state === "success") {
          passed++;
        }
      }

      const total = checkRuns.length + statuses.length;
      let status: "passed" | "pending" | "failed" = "passed";
      if (failed > 0) {
        status = "failed";
      } else if (pending > 0) {
        status = "pending";
      }

      return { status, total, passed, failed, pending };
    },
    async isReachableInBase({ owner, repo, baseRef, headSha, mergeCommitSha }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Paperclip-Delivery-Verification",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const compareHeadUrl = `${apiBase}/repos/${owner}/${repo}/compare/${encodeURIComponent(
        baseRef,
      )}...${encodeURIComponent(headSha)}`;
      const res = await getFetch()(compareHeadUrl, { headers: authHeaders });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.status === "diverged") {
          return false;
        }
        if (
          data.status === "identical" ||
          data.status === "behind" ||
          data.status === "ahead" ||
          data.behind_by === 0
        ) {
          return true;
        }
      }
      if (mergeCommitSha) {
        const compareMergeUrl = `${apiBase}/repos/${owner}/${repo}/compare/${encodeURIComponent(
          baseRef,
        )}...${encodeURIComponent(mergeCommitSha)}`;
        const mergeRes = await getFetch()(compareMergeUrl, { headers: authHeaders });
        if (mergeRes.ok) {
          const data = (await mergeRes.json()) as any;
          if (data.status === "diverged") {
            return false;
          }
          if (
            data.status === "identical" ||
            data.status === "behind" ||
            data.status === "ahead" ||
            data.behind_by === 0
          ) {
            return true;
          }
        }
      }
      return false;
    },
  };
}

export function createGiteaDeliveryClient(options?: {
  apiBase?: string;
  token?: string | null;
  fetchFn?: typeof fetch;
}): DeliveryProviderClient {
  const apiBase = (
    options?.apiBase ??
    process.env.GITEA_API_URL ??
    "https://gitea.example.com/api/v1"
  ).replace(/\/+$/, "");
  const token = options?.token ?? process.env.GITEA_TOKEN ?? null;

  const getFetch = () => options?.fetchFn ?? globalThis.fetch;

  return {
    provider: "gitea",
    async getPullRequest({ owner, repo, pullNumber }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/json",
        ...(token ? { Authorization: `token ${token}` } : {}),
      };
      const url = `${apiBase}/repos/${owner}/${repo}/pulls/${pullNumber}`;
      const res = await getFetch()(url, { headers: authHeaders });
      if (!res.ok) {
        if (res.status === 404) {
          throw new DeliveryVerificationError(
            DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
            `Pull request #${pullNumber} not found in repository ${owner}/${repo}`,
          );
        }
        throw new DeliveryVerificationError(
          DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
          `Gitea API error fetching PR #${pullNumber}: ${res.statusText}`,
        );
      }
      const data = (await res.json()) as any;
      const isMerged = Boolean(data.has_merged ?? data.merged);
      return {
        state: data.state === "closed" ? "closed" : "open",
        merged: isMerged,
        mergedAt: data.merged_at ?? null,
        mergeCommitSha: data.merged_commit_id ?? data.merge_commit_sha ?? null,
        headSha: data.head?.sha ?? "",
        baseRef: data.base?.ref ?? "",
        baseSha: data.base?.sha ?? null,
      };
    },
    async getPullRequestFiles({ owner, repo, pullNumber }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/json",
        ...(token ? { Authorization: `token ${token}` } : {}),
      };
      const url = `${apiBase}/repos/${owner}/${repo}/pulls/${pullNumber}/files`;
      const res = await getFetch()(url, { headers: authHeaders });
      if (!res.ok) return [];
      const files = (await res.json()) as any[];
      return Array.isArray(files)
        ? files.map((f: any) => ({
            filename: String(f.filename ?? ""),
            status: String(f.status ?? "modified"),
            additions: Number(f.additions ?? 0),
            deletions: Number(f.deletions ?? 0),
          }))
        : [];
    },
    async getChecks({ owner, repo, ref }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/json",
        ...(token ? { Authorization: `token ${token}` } : {}),
      };
      const statusUrl = `${apiBase}/repos/${owner}/${repo}/commits/${ref}/statuses`;
      const statusRes = await getFetch()(statusUrl, { headers: authHeaders });
      let statuses: any[] = [];
      if (statusRes.ok) {
        const body = (await statusRes.json()) as any;
        statuses = Array.isArray(body) ? body : [];
      }

      let passed = 0;
      let failed = 0;
      let pending = 0;

      for (const s of statuses) {
        const st = String(s.status ?? s.state).toLowerCase();
        if (st === "pending") {
          pending++;
        } else if (st === "failure" || st === "error" || st === "warning") {
          failed++;
        } else if (st === "success") {
          passed++;
        }
      }

      const total = statuses.length;
      let status: "passed" | "pending" | "failed" = "passed";
      if (failed > 0) {
        status = "failed";
      } else if (pending > 0) {
        status = "pending";
      }

      return { status, total, passed, failed, pending };
    },
    async isReachableInBase({ owner, repo, baseRef, headSha, mergeCommitSha }) {
      const authHeaders: Record<string, string> = {
        Accept: "application/json",
        ...(token ? { Authorization: `token ${token}` } : {}),
      };

      // 1. First check branch tip directly: /branches/${baseRef}
      const branchUrl = `${apiBase}/repos/${owner}/${repo}/branches/${encodeURIComponent(baseRef)}`;
      const branchRes = await getFetch()(branchUrl, { headers: authHeaders });
      if (branchRes.ok) {
        const branchData = (await branchRes.json()) as any;
        const branchCommitId = branchData.commit?.id ?? branchData.commit?.sha;
        if (
          branchCommitId &&
          (branchCommitId === headSha || branchCommitId === mergeCommitSha)
        ) {
          return true;
        }
      }

      // 2. Check compare API
      const compareUrl = `${apiBase}/repos/${owner}/${repo}/compare/${encodeURIComponent(
        baseRef,
      )}...${encodeURIComponent(headSha)}`;
      const res = await getFetch()(compareUrl, { headers: authHeaders });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (
          data.identical ||
          data.status === "identical" ||
          data.status === "behind" ||
          data.status === "ahead" ||
          data.behind_by === 0 ||
          (Array.isArray(data.commits) &&
            data.commits.some((c: any) => c.id === headSha || c.sha === headSha))
        ) {
          return true;
        }
      }
      if (mergeCommitSha) {
        const compareMergeUrl = `${apiBase}/repos/${owner}/${repo}/compare/${encodeURIComponent(
          baseRef,
        )}...${encodeURIComponent(mergeCommitSha)}`;
        const mergeRes = await getFetch()(compareMergeUrl, { headers: authHeaders });
        if (mergeRes.ok) {
          const data = (await mergeRes.json()) as any;
          if (
            data.identical ||
            data.status === "identical" ||
            data.status === "behind" ||
            data.status === "ahead" ||
            data.behind_by === 0
          ) {
            return true;
          }
        }
      }
      return false;
    },
  };
}

export interface VerifyTerminalDeliveryInput {
  issue: {
    id?: string;
    companyId?: string;
    kind?: string | null;
    labels?: Array<{ name?: string } | string> | null;
    originKind?: string | null;
  };
  evidence?: IssueTerminalEvidence | null;
  repoUrl?: string | null;
  baseRef?: string | null;
  reviewedHeadSha?: string | null;
  policy?: IssueExecutionPolicy | null;
  client?: DeliveryProviderClient;
}

export interface VerifyTerminalDeliveryResult {
  verified: boolean;
  receipt?: VerifiedDeliveryReceipt | null;
  errorCode?: DeliveryErrorCode;
  reason?: string;
  exempt?: boolean;
}

export interface PreflightReviewDeliveryInput {
  issue: {
    id: string;
    title: string;
    status: string;
    kind?: string | null;
    labels?: Array<{ name?: string } | string> | null;
    originKind?: string | null;
  };
  sourceSha: string;
  evidence?: {
    pr?: string | number | null;
    repo?: string | null;
    repoUrl?: string | null;
    headSha?: string | null;
    mergedSha?: string | null;
    baseBranch?: string | null;
    checkRun?: string | number | null;
    note?: string | null;
  } | null;
  repoUrl?: string | null;
  baseRef?: string | null;
  workProducts?: Array<{
    kind?: string;
    title?: string;
    location?: string;
    [key: string]: unknown;
  }> | null;
  client?: DeliveryProviderClient;
}

export interface PreflightReviewDeliveryResult {
  verified: boolean;
  errorCode?: DeliveryErrorCode;
  reason?: string;
  exempt?: boolean;
  pr?: DeliveryPullRequestDetails;
  checksSummary?: DeliveryChecksSummary;
  provider?: DeliveryProvider;
  repo?: string;
  pullNumber?: number;
  preflightEvidence?: Record<string, unknown>;
}

export class DeliveryVerificationService {
  private clientOverride?: DeliveryProviderClient;

  constructor(options?: { client?: DeliveryProviderClient }) {
    this.clientOverride = options?.client;
  }

  async verifyTerminalDelivery(
    input: VerifyTerminalDeliveryInput,
  ): Promise<VerifyTerminalDeliveryResult> {
    // 1. Operation task exemption
    if (isOperationTask(input.issue)) {
      return {
        verified: true,
        receipt: null,
        exempt: true,
        reason: "operation_task",
      };
    }

    // 2. Validate evidence
    if (!input.evidence || !input.evidence.pr || !input.evidence.mergedSha) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.EVIDENCE_MISSING,
        reason: "A code task requires verified delivery evidence (`pr` and `mergedSha`) before terminal completion.",
      };
    }

    // 3. Resolve target repo, PR and provider
    const target = parseRepoAndPr({
      pr: input.evidence.pr,
      repo: input.evidence.repo,
      repoUrl: input.repoUrl || input.evidence.repoUrl,
    });

    if (!target || target.unsupported || !target.owner || !target.repo) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.UNSUPPORTED_PROVIDER,
        reason: "Missing, unsupported, or invalid repository URL or provider.",
      };
    }

    const pullNumber = target.pullNumber;
    if (!pullNumber) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: "Cannot determine pull request number from delivery evidence.",
      };
    }

    const client =
      input.client ??
      this.clientOverride ??
      (target.provider === "gitea"
        ? createGiteaDeliveryClient({
            apiBase: input.repoUrl
              ? input.repoUrl.replace(/\/[^/]+\/[^/]+(?:\.git)?$/, "")
              : undefined,
          })
        : createGitHubDeliveryClient({
            apiBase: input.repoUrl?.includes("api.github.com")
              ? "https://api.github.com"
              : undefined,
          }));

    const expectedBase =
      input.baseRef?.trim() ||
      input.evidence.baseBranch?.trim() ||
      "master";

    // 4. Fetch PR details and check merged state
    let pr: DeliveryPullRequestDetails;
    try {
      pr = await client.getPullRequest({
        owner: target.owner,
        repo: target.repo,
        pullNumber,
      });
    } catch (err: any) {
      return {
        verified: false,
        errorCode: err.code || DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: err.message || "Failed to fetch pull request",
      };
    }

    if (pr.state !== "closed" || !pr.merged) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.NOT_MERGED,
        reason: `Pull request #${pullNumber} in ${target.owner}/${target.repo} is ${
          pr.state === "open" ? "open; not merged" : "closed but not merged"
        }.`,
      };
    }

    // 5. Verify base branch match
    if (pr.baseRef !== expectedBase) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.BASE_MISMATCH,
        reason: `Base branch mismatch: expected "${expectedBase}", but PR merged into "${pr.baseRef}".`,
      };
    }

    // 6. Verify reviewed head & merged sha
    const expectedHeadSha = (input.reviewedHeadSha || input.evidence.headSha)?.trim().toLowerCase();
    const actualHeadSha = pr.headSha.trim().toLowerCase();
    const expectedMergedSha = input.evidence.mergedSha.trim().toLowerCase();
    const actualMergeCommitSha = (pr.mergeCommitSha ?? "").trim().toLowerCase();

    if (expectedHeadSha) {
      if (
        !actualHeadSha.startsWith(expectedHeadSha) &&
        !expectedHeadSha.startsWith(actualHeadSha)
      ) {
        return {
          verified: false,
          errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH,
          reason: `Head SHA mismatch: expected reviewed head "${expectedHeadSha}", but PR head commit is "${actualHeadSha}". Head movement detected.`,
        };
      }
    }

    const matchesMergeSha =
      actualMergeCommitSha &&
      (actualMergeCommitSha.startsWith(expectedMergedSha) ||
        expectedMergedSha.startsWith(actualMergeCommitSha));
    const matchesHeadSha =
      actualHeadSha &&
      (actualHeadSha.startsWith(expectedMergedSha) ||
        expectedMergedSha.startsWith(actualHeadSha));

    if (!matchesMergeSha && !matchesHeadSha) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH,
        reason: `Claimed mergedSha "${expectedMergedSha}" matches neither PR head commit ("${actualHeadSha}") nor merge commit ("${actualMergeCommitSha}").`,
      };
    }

    // 7. Verify required checks
    let checks: DeliveryChecksSummary;
    try {
      checks = await client.getChecks({
        owner: target.owner,
        repo: target.repo,
        ref: pr.headSha,
      });
    } catch (err: any) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: `Failed to fetch checks: ${err.message}`,
      };
    }

    if (checks.status === "pending" || checks.pending > 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_PENDING,
        reason: `Checks pending on commit "${pr.headSha}" (${checks.pending} pending).`,
      };
    }

    if (checks.status === "failed" || checks.failed > 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_FAILING,
        reason: `Checks failing on commit "${pr.headSha}" (${checks.failed} failed).`,
      };
    }

    // 8. Verify live base branch reachability
    let reachable = false;
    try {
      reachable = await client.isReachableInBase({
        owner: target.owner,
        repo: target.repo,
        baseRef: pr.baseRef,
        headSha: pr.headSha,
        mergeCommitSha: pr.mergeCommitSha,
      });
    } catch (err: any) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.UNREACHABLE,
        reason: `Failed to verify reachability: ${err.message}`,
      };
    }

    if (!reachable) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.UNREACHABLE,
        reason: `Live base branch does not reach merged commit "${pr.headSha}".`,
      };
    }

    // 9. Construct secret-safe receipt (zero tokens, passwords, authorization headers)
    const receipt: VerifiedDeliveryReceipt = {
      verifiedAt: new Date().toISOString(),
      provider: client.provider,
      repo: `${target.owner}/${target.repo}`,
      repository: `${target.owner}/${target.repo}`,
      pr: pullNumber,
      pullRequestNumber: pullNumber,
      headSha: pr.headSha,
      mergedSha: pr.mergeCommitSha || input.evidence.mergedSha,
      baseBranch: pr.baseRef,
      checksPassed: true,
      checksSummary: {
        total: checks.total,
        passed: checks.passed,
        failed: 0,
        pending: 0,
      },
      reachable: true,
      checkRun: input.evidence.checkRun != null ? String(input.evidence.checkRun) : null,
      note: input.evidence.note != null ? String(input.evidence.note) : null,
    };

    return {
      verified: true,
      receipt,
    };
  }

  async preflightReviewDelivery(
    input: PreflightReviewDeliveryInput,
  ): Promise<PreflightReviewDeliveryResult> {
    // 1. Operation task exemption
    if (isOperationTask(input.issue)) {
      return {
        verified: true,
        exempt: true,
        reason: "operation_task",
      };
    }

    // 2. Disposition check: cannot admit review for an issue that is already terminal
    if (input.issue.status === "done" || input.issue.status === "cancelled") {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.DISPOSITION_INVALID,
        reason: "Cannot admit review for an issue that is already terminal.",
      };
    }

    // 3. Work products check: code tasks require deliverables/work products
    if (input.workProducts !== undefined && (!input.workProducts || input.workProducts.length === 0)) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.WORK_PRODUCTS_MISSING,
        reason: "A code task requires recorded work products or deliverables before review admission.",
      };
    }

    // 4. PR Identity check
    if (!input.evidence || !input.evidence.pr) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.EVIDENCE_MISSING,
        reason: "A code task requires PR identity before review admission.",
      };
    }

    const target = parseRepoAndPr({
      pr: input.evidence.pr,
      repo: input.evidence.repo,
      repoUrl: input.repoUrl || input.evidence.repoUrl,
    });

    if (!target || target.unsupported || !target.owner || !target.repo) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.UNSUPPORTED_PROVIDER,
        reason: "Missing, unsupported, or invalid repository URL or provider.",
      };
    }

    const pullNumber = target.pullNumber;
    if (!pullNumber) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: "Cannot determine pull request number from delivery evidence.",
      };
    }

    const client =
      input.client ??
      this.clientOverride ??
      (target.provider === "gitea"
        ? createGiteaDeliveryClient({
            apiBase: input.repoUrl
              ? input.repoUrl.replace(/\/[^/]+\/[^/]+(?:\.git)?$/, "")
              : undefined,
          })
        : createGitHubDeliveryClient({
            apiBase: input.repoUrl?.includes("api.github.com")
              ? "https://api.github.com"
              : undefined,
          }));

    // 5. Fetch PR details
    let pr: DeliveryPullRequestDetails;
    try {
      pr = await client.getPullRequest({
        owner: target.owner,
        repo: target.repo,
        pullNumber,
      });
    } catch (err: any) {
      return {
        verified: false,
        errorCode: err.code || DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: err.message || "Failed to fetch pull request",
      };
    }

    // 6. Verify exact head commit SHA match against input.sourceSha
    const expectedHeadSha = input.sourceSha.trim().toLowerCase();
    const actualHeadSha = pr.headSha.trim().toLowerCase();
    if (
      !actualHeadSha.startsWith(expectedHeadSha) &&
      !expectedHeadSha.startsWith(actualHeadSha)
    ) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH,
        reason: `Head SHA mismatch: expected reviewed head "${expectedHeadSha}", but PR head commit is "${actualHeadSha}". Head movement detected.`,
      };
    }

    if (input.evidence.headSha) {
      const evidenceHeadSha = input.evidence.headSha.trim().toLowerCase();
      if (
        !actualHeadSha.startsWith(evidenceHeadSha) &&
        !evidenceHeadSha.startsWith(actualHeadSha)
      ) {
        return {
          verified: false,
          errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH,
          reason: `Head SHA mismatch: delivery evidence head "${evidenceHeadSha}" does not match PR head "${actualHeadSha}".`,
        };
      }
    }

    // 7. Base branch check if specified
    const expectedBase = input.baseRef?.trim() || input.evidence?.baseBranch?.trim();
    if (expectedBase && pr.baseRef && pr.baseRef !== expectedBase) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.BASE_MISMATCH,
        reason: `Base branch mismatch: expected "${expectedBase}", but PR targets "${pr.baseRef}".`,
      };
    }

    // 8. Fetch and verify PR checks
    let checks: DeliveryChecksSummary;
    try {
      checks = await client.getChecks({
        owner: target.owner,
        repo: target.repo,
        ref: pr.headSha,
      });
    } catch (err: any) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        reason: `Failed to fetch checks: ${err.message}`,
      };
    }

    if (checks.status === "failed" || checks.failed > 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_FAILING,
        reason: `Checks failing on commit "${pr.headSha}" (${checks.failed} failed).`,
      };
    }

    if (checks.status === "pending" || checks.pending > 0) {
      return {
        verified: false,
        errorCode: DELIVERY_ERROR_CODES.CHECKS_PENDING,
        reason: `Checks pending on commit "${pr.headSha}" (${checks.pending} pending).`,
      };
    }

    // 9. Structured preflight evidence
    const preflightEvidence: Record<string, unknown> = {
      verifiedAt: new Date().toISOString(),
      provider: client.provider,
      repo: `${target.owner}/${target.repo}`,
      pullNumber,
      headSha: pr.headSha,
      baseRef: pr.baseRef,
      checksSummary: {
        status: checks.status,
        total: checks.total,
        passed: checks.passed,
        failed: checks.failed,
        pending: checks.pending,
      },
      workProductsCount: input.workProducts?.length ?? 0,
    };

    return {
      verified: true,
      pr,
      checksSummary: checks,
      provider: client.provider,
      repo: `${target.owner}/${target.repo}`,
      pullNumber,
      preflightEvidence,
    };
  }

  async readPullRequest(input: {
    pr: string | number;
    repo?: string | null;
    repoUrl?: string | null;
    includeDiff?: boolean;
    client?: DeliveryProviderClient;
  }): Promise<PRReadResult> {
    const target = parseRepoAndPr({
      pr: input.pr,
      repo: input.repo,
      repoUrl: input.repoUrl,
    });
    if (!target || !target.owner || !target.repo || !target.pullNumber) {
      throw new DeliveryVerificationError(
        DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        "Cannot parse pull request reference",
      );
    }
    const client =
      input.client ??
      this.clientOverride ??
      (target.provider === "gitea"
        ? createGiteaDeliveryClient({
            apiBase: input.repoUrl
              ? input.repoUrl.replace(/\/[^/]+\/[^/]+(?:\.git)?$/, "")
              : undefined,
          })
        : createGitHubDeliveryClient({
            apiBase: input.repoUrl?.includes("api.github.com")
              ? "https://api.github.com"
              : undefined,
          }));

    const pr = await client.getPullRequest({
      owner: target.owner,
      repo: target.repo,
      pullNumber: target.pullNumber,
    });

    let checks: DeliveryChecksSummary | undefined;
    try {
      checks = await client.getChecks({
        owner: target.owner,
        repo: target.repo,
        ref: pr.headSha,
      });
    } catch {
      // Non-fatal for read
    }

    let files: Array<{ filename: string; status: string; additions: number; deletions: number }> = [];
    if (input.includeDiff && client.getPullRequestFiles) {
      try {
        files = await client.getPullRequestFiles({
          owner: target.owner,
          repo: target.repo,
          pullNumber: target.pullNumber,
        });
      } catch {
        // Non-fatal
      }
    }

    const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
    const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);
    const diffSummary = files.length > 0
      ? files.map((f) => `${f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"} ${f.filename} (+${f.additions}, -${f.deletions})`).join("\n")
      : undefined;

    return {
      pullNumber: target.pullNumber,
      provider: client.provider,
      repo: `${target.owner}/${target.repo}`,
      title: `PR #${target.pullNumber} in ${target.owner}/${target.repo}`,
      state: pr.state,
      headSha: pr.headSha,
      baseRef: pr.baseRef,
      changedFiles: files.length > 0 ? files.length : undefined,
      additions: files.length > 0 ? totalAdditions : undefined,
      deletions: files.length > 0 ? totalDeletions : undefined,
      diffSummary,
      checksSummary: checks,
    };
  }
}

export function createDeliveryVerificationService(options?: {
  client?: DeliveryProviderClient;
}): DeliveryVerificationService {
  return new DeliveryVerificationService(options);
}

// Convenience function matching verifyTerminalDelivery
export async function verifyTerminalDelivery(
  input: VerifyTerminalDeliveryInput,
): Promise<VerifyTerminalDeliveryResult> {
  const service = createDeliveryVerificationService();
  return service.verifyTerminalDelivery(input);
}

export async function preflightReviewDelivery(
  input: PreflightReviewDeliveryInput,
): Promise<PreflightReviewDeliveryResult> {
  const service = createDeliveryVerificationService();
  return service.preflightReviewDelivery(input);
}
