import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  companies,
  createDb,
  issueThreadInteractions,
  issueWorkProducts,
  issues,
  projectWorkspaces,
  projects,
  reviewAdmissions,
} from "@paperclipai/db";
import { REVIEW_ADMISSION_DECISIONS } from "@paperclipai/shared";
import {
  startEmbeddedPostgresTestDatabase,
  getEmbeddedPostgresTestSupport,
} from "./helpers/embedded-postgres.js";
import {
  acceptanceRelevantExecutionPolicy,
  computeReviewPolicyDigest,
  createReviewAdmissionService,
} from "../services/review-admission.ts";

const HEAD_SHA = "1111111111111111111111111111111111111111";
const NEXT_SHA = "4444444444444444444444444444444444444444";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres review admission tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("computeReviewPolicyDigest", () => {
  it("is independent of key order in the acceptance contract", () => {
    const first = computeReviewPolicyDigest({
      acceptanceContract: { b: 2, a: 1 },
      reviewPolicy: "anyone",
    });
    const second = computeReviewPolicyDigest({
      acceptanceContract: { a: 1, b: 2 },
      reviewPolicy: "anyone",
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the review policy changes", () => {
    expect(computeReviewPolicyDigest({ reviewPolicy: "anyone" })).not.toBe(
      computeReviewPolicyDigest({ reviewPolicy: "human_only" }),
    );
  });

  it("changes when the acceptance contract changes", () => {
    expect(computeReviewPolicyDigest({ acceptanceContract: { objective: "a" } })).not.toBe(
      computeReviewPolicyDigest({ acceptanceContract: { objective: "b" } }),
    );
  });

  it("changes when the execution policy's stages change", () => {
    expect(computeReviewPolicyDigest({ executionPolicy: { stages: [] } })).not.toBe(
      computeReviewPolicyDigest({ executionPolicy: { stages: [{ type: "review" }] } }),
    );
  });

  it("changes when evidenceRequired changes", () => {
    expect(computeReviewPolicyDigest({ executionPolicy: { stages: [] } })).not.toBe(
      computeReviewPolicyDigest({ executionPolicy: { stages: [], evidenceRequired: true } }),
    );
  });

  it("is unchanged by a monitor write, which asks the reviewer nothing new", () => {
    const base = { mode: "normal", commentRequired: true, stages: [] };
    expect(computeReviewPolicyDigest({ executionPolicy: base })).toBe(
      computeReviewPolicyDigest({
        executionPolicy: {
          ...base,
          monitor: {
            nextCheckAt: "2026-09-24T10:00:00.000Z",
            scheduledBy: "assignee",
            timeoutAt: "2026-09-24T12:00:00.000Z",
            maxAttempts: 3,
          },
        },
      }),
    );
  });
});

describe("review admission contract", () => {
  it("declares exactly the decision values the service writes", () => {
    expect([...REVIEW_ADMISSION_DECISIONS]).toEqual(["approved", "changes_requested"]);
  });
});

describe("acceptanceRelevantExecutionPolicy", () => {
  it("keeps the fields that change what a reviewer is asked to accept", () => {
    expect(
      acceptanceRelevantExecutionPolicy({
        mode: "normal",
        commentRequired: true,
        evidenceRequired: true,
        maxReviewRounds: 3,
        stages: [{ id: "s1", type: "review", approvalsNeeded: 1, participants: [] }],
      }),
    ).toMatchObject({
      mode: "normal",
      commentRequired: true,
      evidenceRequired: true,
      maxReviewRounds: 3,
      stages: [{ id: "s1", type: "review", approvalsNeeded: 1, participants: [] }],
    });
  });

  it("drops the operational monitor fields", () => {
    expect(
      acceptanceRelevantExecutionPolicy({
        mode: "normal",
        monitor: { nextCheckAt: "2026-09-24T00:00:00.000Z", scheduledBy: "assignee" },
      }),
    ).not.toHaveProperty("monitor");
  });
});

describeEmbeddedPostgres("ReviewAdmissionService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-review-admission-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  afterEach(async () => {
    await db.delete(reviewAdmissions);
    await db.delete(issueThreadInteractions);
    await db.delete(issueWorkProducts);
    await db.delete(issues);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(companies);
  });

  const BASE_EXECUTION_POLICY = {
    mode: "normal",
    commentRequired: true,
    stages: [],
  } as const;

  async function seedIssue(
    options: { reviewedHeadSha?: string | null; pullUrl?: string | null; companyId?: string } = {},
  ) {
    const companyId = options.companyId ?? randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();
    if (!options.companyId) {
      await db.insert(companies).values({
        id: companyId,
        name: "Acme",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
    }
    await db.insert(projects).values({ id: projectId, companyId, name: "Widgets" });
    await db.insert(projectWorkspaces).values({
      id: randomUUID(),
      companyId,
      projectId,
      name: "primary",
      repoUrl: "https://github.com/acme/widgets.git",
      defaultRef: "main",
      isPrimary: true,
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Ship the widget",
      description: "The widget must ship.",
      status: "in_review",
      priority: "medium",
      reviewPolicy: "anyone",
      executionPolicy: BASE_EXECUTION_POLICY as never,
    });
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
        status: "open",
        isPrimary: true,
      });
    }
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    return { companyId, projectId, issueId, issue: issue! };
  }

  const admit = (
    issue: typeof issues.$inferSelect,
    overrides: { reviewInteractionId?: string | null } = {},
  ) =>
    createReviewAdmissionService(db).admitReview({
      companyId: issue.companyId,
      issue,
      reviewInteractionId: overrides.reviewInteractionId ?? null,
      decisionId: null,
      resolverPolicy: "anyone",
    });

  it("records one admission keyed by the issue's own reviewed head", async () => {
    const { issue } = await seedIssue();

    const result = await admit(issue);

    expect(result.admitted).toBe(true);
    if (!result.admitted) throw new Error("unreachable");
    expect(result.created).toBe(true);
    expect(result.admission).toMatchObject({
      companyId: issue.companyId,
      issueId: issue.id,
      sourceSha: HEAD_SHA,
      status: "in_review",
      reviewPolicy: "anyone",
    });
    expect(result.admission.policyDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records the server-bound pull request identity, with no outbound request", async () => {
    const { issue } = await seedIssue();

    const result = await admit(issue);

    if (!result.admitted) throw new Error("unreachable");
    expect(result.admission.prDetails).toEqual({
      provider: "github",
      repository: "acme/widgets",
      pullNumber: 42,
      baseRef: "main",
      reviewedHeadSha: HEAD_SHA,
    });
  });

  it("records no pull request identity when the issue records no pull request", async () => {
    const { issue } = await seedIssue({ pullUrl: null });

    const result = await admit(issue);

    if (!result.admitted) throw new Error("unreachable");
    expect(result.admission.prDetails).toBeNull();
  });

  it("records nothing when the issue has no revision identity", async () => {
    const { issue } = await seedIssue({ reviewedHeadSha: null });

    const result = await admit(issue);

    expect(result).toEqual({ admitted: false, reason: "no_revision_identity" });
    expect(await db.select().from(reviewAdmissions)).toEqual([]);
  });

  it("returns the existing admission when the same revision and contract admit again", async () => {
    const { issue } = await seedIssue();

    const first = await admit(issue);
    const second = await admit(issue);

    if (!first.admitted || !second.admitted) throw new Error("unreachable");
    expect(second.created).toBe(false);
    expect(second.admission.id).toBe(first.admission.id);
    expect(await db.select().from(reviewAdmissions)).toHaveLength(1);
  });

  it("is unaffected by a monitor write on the issue", async () => {
    const { issue, issueId } = await seedIssue();
    const first = await admit(issue);
    if (!first.admitted) throw new Error("unreachable");

    await db
      .update(issues)
      .set({
        executionPolicy: {
          ...BASE_EXECUTION_POLICY,
          monitor: {
            nextCheckAt: "2026-09-24T10:00:00.000Z",
            scheduledBy: "assignee",
            notes: null,
            kind: null,
            serviceName: null,
            externalRef: null,
            timeoutAt: null,
            maxAttempts: null,
            recoveryPolicy: null,
          },
        } as never,
      })
      .where(eq(issues.id, issueId));
    const [rescheduled] = await db.select().from(issues).where(eq(issues.id, issueId));

    const second = await admit(rescheduled!);

    if (!second.admitted) throw new Error("unreachable");
    expect(second.created).toBe(false);
    expect(second.admission.id).toBe(first.admission.id);
    expect(await db.select().from(reviewAdmissions)).toHaveLength(1);
  });

  it("opens a new round when the same revision is reviewed again after a decision", async () => {
    const { issue } = await seedIssue();
    const first = await admit(issue);
    if (!first.admitted) throw new Error("unreachable");
    await createReviewAdmissionService(db).recordReviewDecision({
      companyId: issue.companyId,
      admissionId: first.admission.id,
      decision: "changes_requested",
      reason: "Name the failing case",
    });

    const second = await admit(issue);

    if (!second.admitted) throw new Error("unreachable");
    expect(second.created).toBe(true);
    expect(second.admission.round).toBe(2);
    expect(second.admission.sourceSha).toBe(first.admission.sourceSha);
    expect(second.admission.policyDigest).toBe(first.admission.policyDigest);
    expect(second.admission.supersedesAdmissionId).toBe(first.admission.id);
    expect(second.admission.status).toBe("in_review");
  });

  it("keeps the earlier round's decision when a new round opens", async () => {
    const { issue } = await seedIssue();
    const first = await admit(issue);
    if (!first.admitted) throw new Error("unreachable");
    const service = createReviewAdmissionService(db);
    await service.recordReviewDecision({
      companyId: issue.companyId,
      admissionId: first.admission.id,
      decision: "changes_requested",
      reason: "Name the failing case",
    });
    const second = await admit(issue);
    if (!second.admitted) throw new Error("unreachable");

    await service.recordReviewDecision({
      companyId: issue.companyId,
      admissionId: second.admission.id,
      decision: "approved",
    });

    const rows = await db
      .select()
      .from(reviewAdmissions)
      .orderBy(reviewAdmissions.round);
    expect(rows.map((row) => [row.round, row.decision])).toEqual([
      [1, "changes_requested"],
      [2, "approved"],
    ]);
  });

  it("admits a new linked review when the head moves", async () => {
    const { issue, companyId, issueId, projectId } = await seedIssue();
    const first = await admit(issue);
    if (!first.admitted) throw new Error("unreachable");

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
      externalId: NEXT_SHA,
      title: "reviewed head",
      status: "active",
    });

    const second = await admit(issue);

    if (!second.admitted) throw new Error("unreachable");
    expect(second.created).toBe(true);
    expect(second.admission.sourceSha).toBe(NEXT_SHA);
    expect(second.admission.supersedesAdmissionId).toBe(first.admission.id);
    const [superseded] = await db
      .select()
      .from(reviewAdmissions)
      .where(eq(reviewAdmissions.id, first.admission.id));
    expect(superseded!.status).toBe("superseded");
  });

  it("admits a new linked review when the acceptance contract changes materially", async () => {
    const { issue, issueId } = await seedIssue();
    const first = await admit(issue);
    if (!first.admitted) throw new Error("unreachable");

    await db
      .update(issues)
      .set({ description: "The widget must ship behind a flag." })
      .where(eq(issues.id, issueId));
    const [changed] = await db.select().from(issues).where(eq(issues.id, issueId));

    const second = await admit(changed!);

    if (!second.admitted) throw new Error("unreachable");
    expect(second.created).toBe(true);
    expect(second.admission.sourceSha).toBe(HEAD_SHA);
    expect(second.admission.policyDigest).not.toBe(first.admission.policyDigest);
    expect(second.admission.supersedesAdmissionId).toBe(first.admission.id);
  });

  it("admits once under concurrent requests for the same revision", async () => {
    const { issue } = await seedIssue();

    const results = await Promise.all([admit(issue), admit(issue), admit(issue)]);

    const admissionIds = new Set(
      results.map((result) => {
        if (!result.admitted) throw new Error("unreachable");
        return result.admission.id;
      }),
    );
    expect(admissionIds.size).toBe(1);
    expect(await db.select().from(reviewAdmissions)).toHaveLength(1);
  });

  it("lets the database refuse a second row for the same revision and contract", async () => {
    const { issue } = await seedIssue();
    const first = await admit(issue);
    if (!first.admitted) throw new Error("unreachable");

    await expect(
      db.insert(reviewAdmissions).values({
        companyId: issue.companyId,
        issueId: issue.id,
        sourceSha: first.admission.sourceSha,
        policyDigest: first.admission.policyDigest,
        status: "in_review",
        acceptanceContract: {},
        reviewPolicy: "anyone",
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint_name: "review_admissions_issue_revision_digest_uq",
      }),
    });
  });

  it("keeps two companies' admissions of the same revision apart", async () => {
    const first = await seedIssue();
    const second = await seedIssue();

    const firstResult = await admit(first.issue);
    const secondResult = await admit(second.issue);

    if (!firstResult.admitted || !secondResult.admitted) throw new Error("unreachable");
    expect(firstResult.admission.id).not.toBe(secondResult.admission.id);
    expect(firstResult.admission.sourceSha).toBe(secondResult.admission.sourceSha);
    expect(await db.select().from(reviewAdmissions)).toHaveLength(2);
  });

  it("refuses to read another company's admission by id", async () => {
    const owner = await seedIssue();
    const other = await seedIssue();
    const admitted = await admit(owner.issue);
    if (!admitted.admitted) throw new Error("unreachable");

    await expect(
      createReviewAdmissionService(db).recordReviewDecision({
        companyId: other.companyId,
        admissionId: admitted.admission.id,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ status: 404 });

    const [untouched] = await db
      .select()
      .from(reviewAdmissions)
      .where(eq(reviewAdmissions.id, admitted.admission.id));
    expect(untouched!.status).toBe("in_review");
    expect(untouched!.decision).toBeNull();
  });

  it("records an approval as an immutable decision", async () => {
    const { issue } = await seedIssue();
    const admitted = await admit(issue);
    if (!admitted.admitted) throw new Error("unreachable");
    const service = createReviewAdmissionService(db);

    const decided = await service.recordReviewDecision({
      companyId: issue.companyId,
      admissionId: admitted.admission.id,
      decision: "approved",
      reason: "Looks right",
    });

    expect(decided.admission).toMatchObject({
      status: "completed",
      decision: "approved",
      decisionReason: "Looks right",
    });
    expect(decided.admission.decidedAt).toBeInstanceOf(Date);
  });

  it("treats the same decision twice as the decision already recorded", async () => {
    const { issue } = await seedIssue();
    const admitted = await admit(issue);
    if (!admitted.admitted) throw new Error("unreachable");
    const service = createReviewAdmissionService(db);
    await service.recordReviewDecision({
      companyId: issue.companyId,
      admissionId: admitted.admission.id,
      decision: "approved",
    });

    const again = await service.recordReviewDecision({
      companyId: issue.companyId,
      admissionId: admitted.admission.id,
      decision: "approved",
    });

    expect(again.deduplicated).toBe(true);
  });

  it("refuses to change a decision once recorded", async () => {
    const { issue } = await seedIssue();
    const admitted = await admit(issue);
    if (!admitted.admitted) throw new Error("unreachable");
    const service = createReviewAdmissionService(db);
    await service.recordReviewDecision({
      companyId: issue.companyId,
      admissionId: admitted.admission.id,
      decision: "approved",
    });

    await expect(
      service.recordReviewDecision({
        companyId: issue.companyId,
        admissionId: admitted.admission.id,
        decision: "changes_requested",
        reason: "Actually no",
      }),
    ).rejects.toMatchObject({ status: 409, details: { code: "review_already_decided" } });
  });

  it("requires changes_requested to say what to change", async () => {
    const { issue } = await seedIssue();
    const admitted = await admit(issue);
    if (!admitted.admitted) throw new Error("unreachable");

    await expect(
      createReviewAdmissionService(db).recordReviewDecision({
        companyId: issue.companyId,
        admissionId: admitted.admission.id,
        decision: "changes_requested",
        reason: "   ",
      }),
    ).rejects.toMatchObject({ status: 422, details: { code: "rejection_reason_required" } });
  });

  it("finds an admission by its interaction only under its own company", async () => {
    const owner = await seedIssue();
    const other = await seedIssue();
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId: owner.companyId,
      issueId: owner.issueId,
      kind: "request_confirmation",
      payload: { version: 1, prompt: "Review it" } as never,
    });
    const admitted = await admit(owner.issue, { reviewInteractionId: interactionId });
    if (!admitted.admitted) throw new Error("unreachable");

    const service = createReviewAdmissionService(db);
    expect(
      await service.findAdmissionForInteraction({
        companyId: owner.companyId,
        reviewInteractionId: interactionId,
      }),
    ).toMatchObject({ id: admitted.admission.id });
    expect(
      await service.findAdmissionForInteraction({
        companyId: other.companyId,
        reviewInteractionId: interactionId,
      }),
    ).toBeNull();
  });
});
