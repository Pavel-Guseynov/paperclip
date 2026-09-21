import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueThreadInteractions,
  issues,
  reviewAdmissions,
  statusDecisions,
} from "@paperclipai/db";
import {
  startEmbeddedPostgresTestDatabase,
  getEmbeddedPostgresTestSupport,
} from "./helpers/embedded-postgres.js";
import {
  computeReviewPolicyDigest,
  createReviewAdmissionService,
  ReviewAdmissionService,
} from "../services/review-admission.js";
import {
  DeliveryVerificationService,
  type DeliveryProviderClient,
} from "../services/delivery-verification.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres review admission tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("computeReviewPolicyDigest", () => {
  it("computes deterministic SHA-256 digest regardless of object key order", () => {
    const d1 = computeReviewPolicyDigest({
      policy: "anyone",
      acceptance: { b: 2, a: 1 },
      instructions: "test",
    });
    const d2 = computeReviewPolicyDigest({
      instructions: "test",
      acceptance: { a: 1, b: 2 },
      policy: "anyone",
    });
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("yields different digests for different acceptance criteria or review policies", () => {
    const d1 = computeReviewPolicyDigest({ policy: "anyone", instructions: "foo" });
    const d2 = computeReviewPolicyDigest({ policy: "human_only", instructions: "foo" });
    const d3 = computeReviewPolicyDigest({ policy: "anyone", instructions: "bar" });
    expect(d1).not.toBe(d2);
    expect(d1).not.toBe(d3);
  });
});

describeEmbeddedPostgres("ReviewAdmissionService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;
  let agentId: string;
  let mockClient: DeliveryProviderClient;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-review-admission-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    companyId = randomUUID();
    agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Acme Corp",
      issuePrefix: "ACM",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "ReviewerAgent",
      role: "qa_engineer",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
    });

    mockClient = {
      provider: "github",
      getPullRequest: async () => ({
        provider: "github",
        owner: "acme",
        repo: "test-repo",
        pullNumber: 42,
        state: "open",
        headSha: "1111222233334444555566667777888899990000",
        baseRef: "main",
        merged: false,
        mergeCommitSha: null,
      }),
      getChecks: async () => ({
        total: 2,
        passed: 2,
        failed: 0,
        pending: 0,
        status: "passed",
      }),
      isReachableInBase: async () => true,
      getPullRequestFiles: async () => [
        {
          filename: "src/index.ts",
          status: "modified",
          additions: 10,
          deletions: 2,
          patch: "@@ -1 +1 @@",
        },
      ],
    };
  });

  afterEach(async () => {
    await db.delete(reviewAdmissions);
    await db.delete(issueThreadInteractions);
    await db.delete(statusDecisions);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  it("admits review for an operation task without requiring PR or deliverables", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Operation Task",
      status: "in_progress",
      originKind: "operation",
    });

    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    const sourceSha = "1111222233334444555566667777888899990000";
    const result = await service.admitReview({
      companyId,
      issueId,
      sourceSha,
      reviewPolicy: "anyone",
    });

    expect(result.status).toBe("admitted");
    expect(result.created).toBe(true);
    expect(result.admission.status).toBe("in_review");
    expect(result.admission.sourceSha).toBe(sourceSha);
    expect(result.admission.reviewInteractionId).toBeTruthy();

    const [persisted] = await db
      .select()
      .from(reviewAdmissions)
      .where(eq(reviewAdmissions.id, result.admission.id));
    expect(persisted).toBeTruthy();
    expect(persisted.status).toBe("in_review");
  });

  it("denies admission when preflight fails: terminal issue", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Closed Task",
      status: "done",
    });

    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    await expect(
      service.admitReview({
        companyId,
        issueId,
        sourceSha: "1111222233334444555566667777888899990000",
        evidence: { pr: 42, repo: "acme/test-repo" },
        workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
      }),
    ).rejects.toThrow("Cannot admit review for an issue that is already terminal");

    // Zero uncommitted rows
    const rows = await db.select().from(reviewAdmissions).where(eq(reviewAdmissions.issueId, issueId));
    expect(rows).toHaveLength(0);
  });

  it("denies admission when preflight fails: head movement / SHA mismatch", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Code Task",
      status: "in_progress",
    });

    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    // Source SHA does not match mockClient's PR head
    await expect(
      service.admitReview({
        companyId,
        issueId,
        sourceSha: "9999999999999999999999999999999999999999",
        evidence: { pr: 42, repo: "acme/test-repo" },
        workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
      }),
    ).rejects.toThrow("Head SHA mismatch");

    // Zero rows in DB
    const rows = await db.select().from(reviewAdmissions).where(eq(reviewAdmissions.issueId, issueId));
    expect(rows).toHaveLength(0);
  });

  it("denies admission when preflight fails: code task missing deliverables", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Code Task",
      status: "in_progress",
    });

    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    await expect(
      service.admitReview({
        companyId,
        issueId,
        sourceSha: "1111222233334444555566667777888899990000",
        evidence: { pr: 42, repo: "acme/test-repo" },
        workProducts: [], // empty work products
      }),
    ).rejects.toThrow("A code task requires recorded work products");

    const rows = await db.select().from(reviewAdmissions).where(eq(reviewAdmissions.issueId, issueId));
    expect(rows).toHaveLength(0);
  });

  it("denies admission when preflight fails: checks failing on PR", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Code Task",
      status: "in_progress",
    });

    const failingClient: DeliveryProviderClient = {
      ...mockClient,
      getChecks: async () => ({
        total: 3,
        passed: 1,
        failed: 2,
        pending: 0,
        status: "failed",
      }),
    };

    const deliveryVerification = new DeliveryVerificationService({ client: failingClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    await expect(
      service.admitReview({
        companyId,
        issueId,
        sourceSha: "1111222233334444555566667777888899990000",
        evidence: { pr: 42, repo: "acme/test-repo" },
        workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
      }),
    ).rejects.toThrow("Checks failing on commit");

    const rows = await db.select().from(reviewAdmissions).where(eq(reviewAdmissions.issueId, issueId));
    expect(rows).toHaveLength(0);
  });

  it("deduplicates repeated requests for same revision and policy", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Task with Repeated Review",
      status: "in_progress",
    });

    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    const sourceSha = "1111222233334444555566667777888899990000";
    const input = {
      companyId,
      issueId,
      sourceSha,
      reviewPolicy: "anyone",
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    };

    // First request admits
    const first = await service.admitReview(input);
    expect(first.status).toBe("admitted");
    expect(first.created).toBe(true);

    // Second request returns existing active review
    const second = await service.admitReview(input);
    expect(second.status).toBe("active");
    expect(second.deduplicated).toBe(true);
    expect(second.admission.id).toBe(first.admission.id);

    // Only one row exists in DB
    const all = await db.select().from(reviewAdmissions).where(eq(reviewAdmissions.issueId, issueId));
    expect(all).toHaveLength(1);

    // Only one interaction exists
    const interactions = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.issueId, issueId));
    expect(interactions).toHaveLength(1);
  });

  it("supersedes prior admission when a new sourceSha is provided", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Task with multiple heads",
      status: "in_progress",
    });

    const sha1 = "1111222233334444555566667777888899990000";
    const sha2 = "2222333344445555666677778888999900001111";

    let currentHead = sha1;
    const dynamicClient: DeliveryProviderClient = {
      ...mockClient,
      getPullRequest: async () => ({
        provider: "github",
        owner: "acme",
        repo: "test-repo",
        pullNumber: 42,
        state: "open",
        headSha: currentHead,
        baseRef: "main",
        merged: false,
        mergeCommitSha: null,
      }),
    };

    const deliveryVerification = new DeliveryVerificationService({ client: dynamicClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    // First admission
    const first = await service.admitReview({
      companyId,
      issueId,
      sourceSha: sha1,
      reviewPolicy: "anyone",
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    });
    expect(first.status).toBe("admitted");

    // Second admission with new SHA
    currentHead = sha2;
    const second = await service.admitReview({
      companyId,
      issueId,
      sourceSha: sha2,
      reviewPolicy: "anyone",
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    });
    expect(second.status).toBe("admitted");
    expect(second.admission.id).not.toBe(first.admission.id);
    expect(second.admission.supersedesAdmissionId).toBe(first.admission.id);

    // Verify first admission is now superseded
    const [persistedFirst] = await db
      .select()
      .from(reviewAdmissions)
      .where(eq(reviewAdmissions.id, first.admission.id));
    expect(persistedFirst.status).toBe("superseded");
    expect(persistedFirst.updatedAt).toBeTruthy();

    // Verify first interaction is cancelled with superseded reason
    const [firstInteraction] = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, first.admission.reviewInteractionId!));
    expect(firstInteraction.status).toBe("cancelled");
  });

  it("supersedes prior admission when acceptance contract or policy digest changes", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Task with changing policy",
      status: "in_progress",
    });

    const sha = "1111222233334444555566667777888899990000";
    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    const first = await service.admitReview({
      companyId,
      issueId,
      sourceSha: sha,
      reviewPolicy: "anyone",
      acceptanceContract: { requirement: "initial requirement" },
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    });
    expect(first.status).toBe("admitted");

    // Same SHA, but altered criteria
    const second = await service.admitReview({
      companyId,
      issueId,
      sourceSha: sha,
      reviewPolicy: "anyone",
      acceptanceContract: { requirement: "updated requirement with more strict tests" },
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    });

    expect(second.status).toBe("admitted");
    expect(second.admission.policyDigest).not.toBe(first.admission.policyDigest);
    expect(second.admission.supersedesAdmissionId).toBe(first.admission.id);

    const [persistedFirst] = await db
      .select()
      .from(reviewAdmissions)
      .where(eq(reviewAdmissions.id, first.admission.id));
    expect(persistedFirst.status).toBe("superseded");
  });

  it("enforces decision immutability and rejects contradictory decisions", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Immutable Task",
      status: "in_progress",
    });

    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    const admitted = await service.admitReview({
      companyId,
      issueId,
      sourceSha: "1111222233334444555566667777888899990000",
      reviewPolicy: "anyone",
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    });

    // Submit review: approved
    const decisionResult = await service.recordReviewDecision({
      companyId,
      admissionId: admitted.admission.id,
      decision: "approved",
      decisionReason: "LGTM! All acceptance criteria met.",
      actorId: agentId,
      actorType: "agent",
    });

    expect(decisionResult.decision).toBe("approved");
    expect(decisionResult.admission.status).toBe("completed");

    // Linked interaction is resolved
    const [interaction] = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, admitted.admission.reviewInteractionId!));
    expect(interaction.status).toBe("accepted");

    // Subsequent admitReview returns completed immutable result
    const repeatAdmit = await service.admitReview({
      companyId,
      issueId,
      sourceSha: "1111222233334444555566667777888899990000",
      reviewPolicy: "anyone",
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    });
    expect(repeatAdmit.status).toBe("completed");
    expect(repeatAdmit.immutable).toBe(true);
    expect(repeatAdmit.decision).toBe("approved");

    // Contradictory decision attempt is rejected with 409
    await expect(
      service.recordReviewDecision({
        companyId,
        admissionId: admitted.admission.id,
        decision: "changes_requested",
        decisionReason: "Actually never mind",
        actorId: agentId,
        actorType: "agent",
      }),
    ).rejects.toThrow("Review decision is immutable and cannot be changed once recorded");
  });

  it("recovers interrupted launches idempotently without duplicate admissions", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Interrupted Task",
      status: "in_progress",
    });

    const sha = "1111222233334444555566667777888899990000";
    const digest = computeReviewPolicyDigest({ policy: "anyone" });

    // Simulate crash where row was left in "admitted" status 5 minutes ago
    const staleAdmittedAt = new Date(Date.now() - 300_000);
    const [admission] = await db
      .insert(reviewAdmissions)
      .values({
        companyId,
        issueId,
        sourceSha: sha,
        policyDigest: digest,
        reviewPolicy: "anyone",
        acceptanceContract: {},
        status: "admitted",
        reviewInteractionId: null,
        createdAt: staleAdmittedAt,
        updatedAt: staleAdmittedAt,
      })
      .returning();

    const service = createReviewAdmissionService(db);

    // Recover
    const recovered = await service.recoverInterruptedLaunches({
      companyId,
      staleThresholdMs: 60_000,
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe(admission.id);
    expect(recovered[0].status).toBe("in_review");
    expect(recovered[0].reviewInteractionId).toBeTruthy();

    // Verify interaction was created
    const [interaction] = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, recovered[0].reviewInteractionId!));
    expect(interaction).toBeTruthy();
    expect(interaction.status).toBe("pending");

    // Second recovery is a no-op
    const recoveredSecond = await service.recoverInterruptedLaunches({
      companyId,
      staleThresholdMs: 60_000,
    });
    expect(recoveredSecond).toHaveLength(0);
  });

  it("produces compact, bounded review context with truncated limits", async () => {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Compact Context Test",
      status: "in_progress",
      description: "A".repeat(10_000), // oversized description
    });

    const deliveryVerification = new DeliveryVerificationService({ client: mockClient });
    const service = createReviewAdmissionService(db, deliveryVerification);

    const admitted = await service.admitReview({
      companyId,
      issueId,
      sourceSha: "1111222233334444555566667777888899990000",
      reviewPolicy: "anyone",
      acceptanceContract: {
        objective: "Objective " + "B".repeat(5_000),
        criteria: Array.from({ length: 50 }, (_, i) => ({
          id: `crit-${i}`,
          requirement: `Requirement ${i}: ` + "C".repeat(200),
        })),
      },
      instructions: "D".repeat(5_000),
      evidence: { pr: 42, repo: "acme/test-repo" },
      workProducts: [{ kind: "pr", location: "https://github.com/acme/test-repo/pull/42" }],
    });

    const context = await service.getCompactReviewContext(admitted.admission.id);
    expect(context).toBeTruthy();
    expect(context!.title).toBe("Compact Context Test");
    expect(context!.pullRequest?.pullNumber).toBe(42);
    expect(context!.pullRequest?.checksSummary?.status).toBe("passed");
    expect(context!.acceptanceCriteria.criteria!.length).toBeLessThanOrEqual(20);
    expect(context!.acceptanceCriteria.objective?.length).toBeLessThanOrEqual(503);
  });
});
