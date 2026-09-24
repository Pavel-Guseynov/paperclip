import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  createDb,
  executionWorkspaces,
  issueWorkProducts,
  issues,
  projectWorkspaces,
  projects,
  companySecretVersions,
  companySecrets,
} from "@paperclipai/db";
import { issueExecutionEvidenceSchema } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  DELIVERY_ERROR_CODES,
  assertDeliveryTargetUnchanged,
  comparisonContainsHead,
  createDeliveryVerificationService,
  createGitHubDeliveryClient,
  normalizeBaseRef,
  parseConfiguredGitHubRepo,
  parseGitHubPullRequestUrl,
} from "../services/delivery-verification.ts";
import { secretService } from "../services/secrets.ts";

const HEAD_SHA = "1111111111111111111111111111111111111111";
const MERGE_SHA = "2222222222222222222222222222222222222222";
const OTHER_SHA = "3333333333333333333333333333333333333333";

type RecordedRequest = { method: string; url: string; authorization: string | undefined };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("delivery evidence request contract", () => {
  it("rejects an abbreviated merged SHA", () => {
    const parsed = issueExecutionEvidenceSchema.safeParse({ pr: 42, mergedSha: "abc1234" });
    expect(parsed.success).toBe(false);
  });

  it("accepts a full 40-character merged SHA", () => {
    const parsed = issueExecutionEvidenceSchema.safeParse({ pr: 42, mergedSha: HEAD_SHA });
    expect(parsed.success).toBe(true);
  });

  it("refuses a caller-named repository url", () => {
    const parsed = issueExecutionEvidenceSchema.safeParse({
      pr: 42,
      mergedSha: HEAD_SHA,
      repoUrl: "https://attacker.example.com/acme/widgets",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a caller-asserted verdict", () => {
    const parsed = issueExecutionEvidenceSchema.safeParse({
      pr: 42,
      mergedSha: HEAD_SHA,
      verified: true,
      receipt: { repository: "acme/widgets" },
    });
    expect(parsed.success).toBe(false);
  });

  it("publishes one stable code per delivery failure, with no duplicate-valued alias", () => {
    const values = Object.values(DELIVERY_ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("configured repository parsing", () => {
  it("resolves an https github.com remote", () => {
    expect(parseConfiguredGitHubRepo("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("resolves an ssh github.com remote", () => {
    expect(parseConfiguredGitHubRepo("git@github.com:acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("refuses a gitea remote", () => {
    expect(parseConfiguredGitHubRepo("https://gitea.example.com/acme/widgets")).toBeNull();
  });

  it("refuses a github enterprise remote", () => {
    expect(parseConfiguredGitHubRepo("https://github.acme-corp.com/acme/widgets")).toBeNull();
  });

  it("refuses a host that merely contains the word github", () => {
    expect(parseConfiguredGitHubRepo("https://github.com.attacker.example/acme/widgets")).toBeNull();
  });

  it("resolves a github.com pull url", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/acme/widgets/pull/42")).toEqual({
      owner: "acme",
      repo: "widgets",
      pullNumber: 42,
    });
  });

  it("refuses a pull url on another host", () => {
    expect(parseGitHubPullRequestUrl("https://attacker.example.com/acme/widgets/pull/42")).toBeNull();
  });
});

describe("base ref normalization", () => {
  it("reduces a refs/heads ref to its branch name", () => {
    expect(normalizeBaseRef("refs/heads/main")).toBe("main");
  });

  it("reduces a remote-tracking ref to its branch name", () => {
    expect(normalizeBaseRef("origin/main")).toBe("main");
  });

  it("leaves a plain branch name alone", () => {
    expect(normalizeBaseRef("  release/2026-09  ")).toBe("release/2026-09");
  });
});

describe("live base containment", () => {
  it("treats a head the base does not contain as unreachable", () => {
    expect(comparisonContainsHead({ status: "ahead", ahead_by: 3, behind_by: 0 })).toBe(false);
  });

  it("treats a head the base already contains as reachable", () => {
    expect(comparisonContainsHead({ status: "behind", ahead_by: 0, behind_by: 7 })).toBe(true);
  });

  it("treats an identical base and head as reachable", () => {
    expect(comparisonContainsHead({ status: "identical", ahead_by: 0, behind_by: 0 })).toBe(true);
  });

  it("treats a diverged head as unreachable", () => {
    expect(comparisonContainsHead({ status: "diverged", ahead_by: 2, behind_by: 5 })).toBe(false);
  });
});

describe("github delivery client", () => {
  it("reports a head the base is only ahead of as unreachable", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ status: "ahead", ahead_by: 3, behind_by: 0 }),
    );
    const client = createGitHubDeliveryClient({ token: "t0ken", fetchFn });
    await expect(
      client.isReachableInBase({
        owner: "acme",
        repo: "widgets",
        baseRef: "main",
        headSha: HEAD_SHA,
        mergeCommitSha: null,
      }),
    ).resolves.toBe(false);
  });

  it("reports a head contained in the base as reachable", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ status: "behind", ahead_by: 0, behind_by: 4 }),
    );
    const client = createGitHubDeliveryClient({ token: "t0ken", fetchFn });
    await expect(
      client.isReachableInBase({
        owner: "acme",
        repo: "widgets",
        baseRef: "main",
        headSha: HEAD_SHA,
        mergeCommitSha: null,
      }),
    ).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe(
      `https://api.github.com/repos/acme/widgets/compare/main...${HEAD_SHA}`,
    );
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres delivery verification tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("verifyTerminalDelivery", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const secretsTmpDir = path.join(os.tmpdir(), `paperclip-delivery-${randomUUID()}`);
  let requests: RecordedRequest[] = [];

  beforeAll(async () => {
    mkdirSync(secretsTmpDir, { recursive: true });
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secretsTmpDir, "master.key");
    const started = await startEmbeddedPostgresTestDatabase("delivery-verification");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    requests = [];
    await db.delete(issueWorkProducts);
    await db.delete(executionWorkspaces);
    await db.delete(issues);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(companySecretVersions);
    await db.delete(companySecrets);
    await db.delete(companies);
  });

  afterAll(async () => {
    if (stopDb) await stopDb();
    if (previousKeyFile === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    rmSync(secretsTmpDir, { recursive: true, force: true });
  });

  /** Only the provider HTTP boundary is stubbed; every request it receives is recorded. */
  function stubGitHub(routes: Record<string, () => Response>) {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        method: init?.method ?? "GET",
        url,
        authorization: headers.get("authorization") ?? undefined,
      });
      const route = routes[url];
      if (!route) throw new Error(`unexpected outbound request: ${url}`);
      return route();
    }) as typeof fetch);
  }

  function githubRoutes(
    overrides: {
      pull?: () => Response;
      checkRuns?: () => Response;
      status?: () => Response;
      compare?: () => Response;
    } = {},
  ) {
    return {
      "https://api.github.com/repos/acme/widgets/pulls/42":
        overrides.pull ??
        (() =>
          jsonResponse({
            state: "closed",
            merged: true,
            merged_at: "2026-09-01T00:00:00Z",
            merge_commit_sha: MERGE_SHA,
            head: { sha: HEAD_SHA },
            base: { ref: "main" },
          })),
      [`https://api.github.com/repos/acme/widgets/commits/${HEAD_SHA}/check-runs?per_page=100&page=1`]:
        overrides.checkRuns ??
        (() =>
          jsonResponse({
            total_count: 1,
            check_runs: [{ status: "completed", conclusion: "success", name: "build" }],
          })),
      [`https://api.github.com/repos/acme/widgets/commits/${HEAD_SHA}/status?per_page=100&page=1`]:
        overrides.status ?? (() => jsonResponse({ total_count: 0, statuses: [] })),
      [`https://api.github.com/repos/acme/widgets/compare/main...${HEAD_SHA}`]:
        overrides.compare ??
        (() => jsonResponse({ status: "behind", ahead_by: 0, behind_by: 2 })),
      [`https://api.github.com/repos/acme/widgets/compare/main...${MERGE_SHA}`]:
        overrides.compare ??
        (() => jsonResponse({ status: "behind", ahead_by: 0, behind_by: 2 })),
    };
  }

  async function seed(
    options: {
      repoUrl?: string | null;
      baseRef?: string | null;
      pullUrl?: string | null;
      reviewedHeadSha?: string | null;
      token?: string | null;
      bindVia?: "project_workspace" | "execution_workspace";
      sourceTrust?: Record<string, unknown> | null;
    } = {},
  ) {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(projects).values({ id: projectId, companyId, name: "Widgets" });
    const repoUrl =
      options.repoUrl === undefined ? "https://github.com/acme/widgets.git" : options.repoUrl;
    const baseRef = options.baseRef === undefined ? "main" : options.baseRef;
    if ((options.bindVia ?? "project_workspace") === "project_workspace") {
      await db.insert(projectWorkspaces).values({
        id: randomUUID(),
        companyId,
        projectId,
        name: "primary",
        repoUrl,
        defaultRef: baseRef,
        isPrimary: true,
      });
    }
    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Ship the widget",
      status: "in_review",
      priority: "medium",
      ...(options.sourceTrust ? { sourceTrust: options.sourceTrust as never } : {}),
    });
    if (options.bindVia === "execution_workspace") {
      await db.insert(executionWorkspaces).values({
        id: randomUUID(),
        companyId,
        projectId,
        sourceIssueId: issueId,
        mode: "isolated_worktree",
        strategyType: "worktree",
        name: "ws",
        repoUrl,
        baseRef,
      });
    }
    const pullUrl =
      options.pullUrl === undefined ? "https://github.com/acme/widgets/pull/42" : options.pullUrl;
    if (pullUrl) {
      await db.insert(issueWorkProducts).values({
        id: randomUUID(),
        companyId,
        projectId,
        issueId,
        type: "pull_request",
        provider: "github",
        title: "PR #42",
        url: pullUrl,
        status: "merged",
        isPrimary: true,
      });
    }
    const reviewedHeadSha =
      options.reviewedHeadSha === undefined ? HEAD_SHA : options.reviewedHeadSha;
    if (reviewedHeadSha) {
      await db.insert(issueWorkProducts).values({
        id: randomUUID(),
        companyId,
        projectId,
        issueId,
        type: "commit",
        provider: "github",
        externalId: reviewedHeadSha,
        title: "reviewed head",
        status: "active",
      });
    }
    const token = options.token === undefined ? "company-github-token" : options.token;
    if (token) {
      await secretService(db).create(companyId, {
        name: "GITHUB_TOKEN",
        provider: "local_encrypted",
        value: token,
      });
    }
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    return { companyId, projectId, issueId, issue: issue! };
  }

  const service = () => createDeliveryVerificationService();

  it("verifies a merged reviewed head and writes a receipt from provider facts", async () => {
    const { issue } = await seed();
    stubGitHub(githubRoutes());

    const result = await service().verifyTerminalDelivery({
      db,
      issue,
      evidence: { pr: 42, mergedSha: MERGE_SHA, checkRun: "build", note: "shipped" },
    });

    expect(result).toMatchObject({ verified: true });
    if (!result.verified) throw new Error("unreachable");
    expect(result.receipt).toMatchObject({
      provider: "github",
      repository: "acme/widgets",
      repositorySource: "project_workspace",
      pullRequestNumber: 42,
      headSha: HEAD_SHA,
      mergedSha: MERGE_SHA,
      baseBranch: "main",
      reachable: true,
      checksSummary: { total: 1, passed: 1, failed: 0, pending: 0 },
      checkRun: "build",
      note: "shipped",
    });
  });

  it("sends every request to api.github.com under the company secret", async () => {
    const { issue } = await seed({ token: "company-github-token" });
    stubGitHub(githubRoutes());

    await service().verifyTerminalDelivery({
      db,
      issue,
      evidence: { pr: 42, mergedSha: MERGE_SHA },
    });

    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://api.github.com/repos/acme/widgets/pulls/42",
        authorization: "Bearer company-github-token",
      },
      {
        method: "GET",
        url: `https://api.github.com/repos/acme/widgets/commits/${HEAD_SHA}/check-runs?per_page=100&page=1`,
        authorization: "Bearer company-github-token",
      },
      {
        method: "GET",
        url: `https://api.github.com/repos/acme/widgets/commits/${HEAD_SHA}/status?per_page=100&page=1`,
        authorization: "Bearer company-github-token",
      },
      {
        method: "GET",
        url: `https://api.github.com/repos/acme/widgets/compare/main...${HEAD_SHA}`,
        authorization: "Bearer company-github-token",
      },
    ]);
  });

  it("ignores a process environment token", async () => {
    const { issue } = await seed({ token: null });
    vi.stubEnv("GITHUB_TOKEN", "ambient-operator-token");
    stubGitHub(githubRoutes());

    const result = await service().verifyTerminalDelivery({
      db,
      issue,
      evidence: { pr: 42, mergedSha: MERGE_SHA },
    });

    expect(result).toEqual({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.CREDENTIALS_UNAVAILABLE,
      reason: expect.any(String),
    });
    expect(requests).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("binds the repository from the issue's execution workspace when one exists", async () => {
    const { issue } = await seed({ bindVia: "execution_workspace" });
    stubGitHub(githubRoutes());

    const result = await service().verifyTerminalDelivery({
      db,
      issue,
      evidence: { pr: 42, mergedSha: MERGE_SHA },
    });

    expect(result).toMatchObject({ verified: true });
    if (!result.verified) throw new Error("unreachable");
    expect(result.receipt.repositorySource).toBe("execution_workspace");
  });

  it("fails closed when no workspace records a repository remote", async () => {
    const { issue } = await seed({ repoUrl: null });
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNCONFIGURED,
    });
    expect(requests).toEqual([]);
  });

  it("fails closed on a gitea remote instead of probing github.com", async () => {
    const { issue } = await seed({ repoUrl: "https://gitea.example.com/acme/widgets" });
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.UNSUPPORTED_PROVIDER,
    });
    expect(requests).toEqual([]);
  });

  it("fails closed when the workspace names no live base branch", async () => {
    const { issue } = await seed({ baseRef: null });
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.BASE_UNCONFIGURED,
    });
    expect(requests).toEqual([]);
  });

  it("fails closed when the issue records no pull-request work product", async () => {
    const { issue } = await seed({ pullUrl: null });
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.PULL_REQUEST_UNRESOLVED,
    });
    expect(requests).toEqual([]);
  });

  it("refuses a recorded pull request in another repository", async () => {
    const { issue } = await seed({ pullUrl: "https://github.com/attacker/exfil/pull/42" });
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.PULL_REQUEST_MISMATCH,
    });
    expect(requests).toEqual([]);
  });

  it("refuses a claim naming a different pull request than the issue's own", async () => {
    const { issue } = await seed();
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 99, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.PULL_REQUEST_MISMATCH,
    });
    expect(requests).toEqual([]);
  });

  it("fails closed when the issue records no reviewed head commit", async () => {
    const { issue } = await seed({ reviewedHeadSha: null });
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.REVIEWED_HEAD_UNRESOLVED,
    });
    expect(requests).toEqual([]);
  });

  it("fails closed for a quarantined low-trust issue", async () => {
    const { issue } = await seed({
      sourceTrust: { preset: "low_trust_review", disposition: "quarantined" },
    });
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.SOURCE_QUARANTINED,
    });
    expect(requests).toEqual([]);
  });

  it("rejects an open pull request", async () => {
    const { issue } = await seed();
    stubGitHub(
      githubRoutes({
        pull: () =>
          jsonResponse({
            state: "open",
            merged: false,
            merge_commit_sha: null,
            head: { sha: HEAD_SHA },
            base: { ref: "main" },
          }),
      }),
    );

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.NOT_MERGED });
  });

  it("rejects a merge into a branch other than the configured live base", async () => {
    const { issue } = await seed();
    stubGitHub(
      githubRoutes({
        pull: () =>
          jsonResponse({
            state: "closed",
            merged: true,
            merge_commit_sha: MERGE_SHA,
            head: { sha: HEAD_SHA },
            base: { ref: "release/2026-09" },
          }),
      }),
    );

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.BASE_MISMATCH });
  });

  it("rejects a head that moved after review", async () => {
    const { issue } = await seed();
    stubGitHub({
      "https://api.github.com/repos/acme/widgets/pulls/42": () =>
        jsonResponse({
          state: "closed",
          merged: true,
          merge_commit_sha: MERGE_SHA,
          head: { sha: OTHER_SHA },
          base: { ref: "main" },
        }),
    });

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH });
  });

  it("rejects an empty provider head sha instead of matching it by prefix", async () => {
    const { issue } = await seed();
    stubGitHub({
      "https://api.github.com/repos/acme/widgets/pulls/42": () =>
        jsonResponse({
          state: "closed",
          merged: true,
          merge_commit_sha: MERGE_SHA,
          head: { sha: "" },
          base: { ref: "main" },
        }),
    });

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH });
  });

  it("rejects a merged sha that is neither the head nor the merge commit", async () => {
    const { issue } = await seed();
    stubGitHub(githubRoutes());

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: OTHER_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.HEAD_MISMATCH });
  });

  it("treats an absence of checks as unverifiable rather than as passing", async () => {
    const { issue } = await seed();
    stubGitHub(
      githubRoutes({
        checkRuns: () => jsonResponse({ total_count: 0, check_runs: [] }),
        status: () => jsonResponse({ total_count: 0, statuses: [] }),
      }),
    );

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.CHECKS_UNVERIFIABLE,
    });
  });

  it("reads every page of checks and fails on a failure the first page does not carry", async () => {
    const { issue } = await seed();
    const firstPage = Array.from({ length: 100 }, () => ({
      status: "completed",
      conclusion: "success",
    }));
    stubGitHub({
      ...githubRoutes(),
      [`https://api.github.com/repos/acme/widgets/commits/${HEAD_SHA}/check-runs?per_page=100&page=1`]:
        () => jsonResponse({ total_count: 101, check_runs: firstPage }),
      [`https://api.github.com/repos/acme/widgets/commits/${HEAD_SHA}/check-runs?per_page=100&page=2`]:
        () =>
          jsonResponse({
            total_count: 101,
            check_runs: [{ status: "completed", conclusion: "failure" }],
          }),
    });

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.CHECKS_FAILING });
  });

  it("treats a read that ends short of the provider's count as unverifiable", async () => {
    const { issue } = await seed();
    stubGitHub(
      githubRoutes({
        checkRuns: () =>
          jsonResponse({
            total_count: 7,
            check_runs: [{ status: "completed", conclusion: "success" }],
          }),
      }),
    );

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.CHECKS_UNVERIFIABLE,
    });
  });

  it("accepts a configured base written as a refs/heads ref", async () => {
    const { issue } = await seed({ baseRef: "refs/heads/main" });
    stubGitHub(githubRoutes());

    const result = await service().verifyTerminalDelivery({
      db,
      issue,
      evidence: { pr: 42, mergedSha: MERGE_SHA },
    });

    expect(result).toMatchObject({ verified: true });
    if (!result.verified) throw new Error("unreachable");
    expect(result.receipt.baseBranch).toBe("main");
  });

  it("refuses the terminal write when the reviewed head changes after verification", async () => {
    const { issue, companyId, projectId, issueId } = await seed();
    stubGitHub(githubRoutes());
    const result = await service().verifyTerminalDelivery({
      db,
      issue,
      evidence: { pr: 42, mergedSha: MERGE_SHA },
    });
    if (!result.verified) throw new Error("unreachable");

    await db.delete(issueWorkProducts).where(
      and(eq(issueWorkProducts.issueId, issueId), eq(issueWorkProducts.type, "commit")),
    );
    await db.insert(issueWorkProducts).values({
      id: randomUUID(),
      companyId,
      projectId,
      issueId,
      type: "commit",
      provider: "github",
      externalId: OTHER_SHA,
      title: "reviewed head",
      status: "active",
    });

    await expect(
      assertDeliveryTargetUnchanged(db, issue, result.target),
    ).rejects.toMatchObject({ details: { code: DELIVERY_ERROR_CODES.STALE } });
  });

  it("accepts an unchanged binding under the lock", async () => {
    const { issue } = await seed();
    stubGitHub(githubRoutes());
    const result = await service().verifyTerminalDelivery({
      db,
      issue,
      evidence: { pr: 42, mergedSha: MERGE_SHA },
    });
    if (!result.verified) throw new Error("unreachable");

    await expect(assertDeliveryTargetUnchanged(db, issue, result.target)).resolves.toBeUndefined();
  });

  it("rejects a pending check", async () => {
    const { issue } = await seed();
    stubGitHub(
      githubRoutes({
        checkRuns: () => jsonResponse({ total_count: 1, check_runs: [{ status: "in_progress" }] }),
      }),
    );

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.CHECKS_PENDING });
  });

  it("rejects a failing check", async () => {
    const { issue } = await seed();
    stubGitHub(
      githubRoutes({
        checkRuns: () =>
          jsonResponse({ total_count: 1, check_runs: [{ status: "completed", conclusion: "failure" }] }),
      }),
    );

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.CHECKS_FAILING });
  });

  it("rejects a head the live base branch does not contain", async () => {
    const { issue } = await seed();
    stubGitHub(
      githubRoutes({
        compare: () => jsonResponse({ status: "ahead", ahead_by: 3, behind_by: 0 }),
      }),
    );

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({ verified: false, errorCode: DELIVERY_ERROR_CODES.UNREACHABLE });
  });

  it("requires a delivery claim before reaching the provider", async () => {
    const { issue } = await seed();
    stubGitHub({});

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: null }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.EVIDENCE_MISSING,
    });
    expect(requests).toEqual([]);
  });

  it("reports an unreadable provider response as a repository failure", async () => {
    const { issue } = await seed();
    stubGitHub({
      "https://api.github.com/repos/acme/widgets/pulls/42": () =>
        new Response("nope", { status: 502 }),
    });

    await expect(
      service().verifyTerminalDelivery({ db, issue, evidence: { pr: 42, mergedSha: MERGE_SHA } }),
    ).resolves.toMatchObject({
      verified: false,
      errorCode: DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
    });
  });
});
