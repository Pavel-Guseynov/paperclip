import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueRecoveryActions,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => mockTelemetryClient }));

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Review handoff retry test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(function child() {
      return this;
    }),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  httpLogger: vi.fn(),
}));

import { heartbeatService } from "../services/heartbeat.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import {
  buildReviewHandoffRetryIdempotencyKey,
  reconcileReviewHandoffAfterBlockerClear,
} from "../services/recovery/review-handoff-retry.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres review handoff retry tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("review handoff retry after stale blocker clears", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-review-handoff-retry-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    await db.delete(issueRelations);
    await db.delete(issueRecoveryActions);
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(agentTaskSessions);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companies);
  });

  afterAll(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    await db?.$client?.end?.();
    await tempDb?.cleanup();
  });

  async function seedFixture(options?: { withBlocker?: boolean }) {
    const companyId = randomUUID();
    const reviewerAgentId = randomUUID();
    const workerAgentId = randomUUID();
    const issueId = randomUUID();
    const stageId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip Test Co",
      issuePrefix,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: reviewerAgentId,
        companyId,
        name: "ReviewerAgent",
        role: "reviewer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: workerAgentId,
        companyId,
        name: "WorkerAgent",
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Feature ready for review",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: workerAgentId,
      assigneeUserId: null,
      responsibleUserId: "responsible-user",
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
      executionState: {
        status: "pending",
        currentStageId: stageId,
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: reviewerAgentId, userId: null },
        returnAssignee: { type: "agent", agentId: workerAgentId, userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
        changesRequestedCount: 0,
      },
    });

    let blockerIssueId: string | null = null;
    if (options?.withBlocker) {
      blockerIssueId = randomUUID();
      await db.insert(issues).values({
        id: blockerIssueId,
        companyId,
        title: "Blocker issue",
        status: "todo",
        priority: "high",
        assigneeAgentId: workerAgentId,
        responsibleUserId: "responsible-user",
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
      });

      await db.insert(issueRelations).values({
        companyId,
        issueId: blockerIssueId,
        relatedIssueId: issueId,
        type: "blocks",
      });
    }

    return {
      companyId,
      reviewerAgentId,
      workerAgentId,
      issueId,
      stageId,
      blockerIssueId,
    };
  }

  it("skips review handoff while a valid blocker exists", async () => {
    const { companyId, issueId, reviewerAgentId } = await seedFixture({ withBlocker: true });
    const heartbeat = heartbeatService(db);

    const result = await heartbeat.reconcileStrandedAssignedIssues();
    expect(result.reviewParticipantRequeued).toBe(0);

    const wakes = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, reviewerAgentId),
        ),
      );
    expect(wakes).toHaveLength(0);
    await heartbeat.drainActiveRunExecutions();
  });

  it("starts or schedules exactly one handoff after a stale dependency blocker clears", async () => {
    const { companyId, issueId, reviewerAgentId, stageId, blockerIssueId } = await seedFixture({
      withBlocker: true,
    });
    const heartbeat = heartbeatService(db);

    // Initial check: blocker prevents handoff
    await heartbeat.reconcileStrandedAssignedIssues();
    let wakes = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, reviewerAgentId),
        ),
      );
    expect(wakes).toHaveLength(0);

    // Resolve blocker issue to "done"
    await db
      .update(issues)
      .set({ status: "done" })
      .where(eq(issues.id, blockerIssueId!));

    // Reconcile: stale blocker cleared, handoff scheduled atomically
    const result = await heartbeat.reconcileStrandedAssignedIssues();
    expect(result.reviewParticipantRequeued).toBe(1);
    expect(result.issueIds).toContain(issueId);

    wakes = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, reviewerAgentId),
        ),
      );
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({
      agentId: reviewerAgentId,
      reason: "execution_review_requested",
      idempotencyKey: buildReviewHandoffRetryIdempotencyKey({ issueId, stageId }),
    });
    expect(wakes[0].payload).toMatchObject({
      issueId,
      reviewHandoffAttempt: 1,
      executionStage: {
        stageId,
        wakeRole: "reviewer",
      },
    });

    // Behavioral proof that the asynchronous run reached authoritative completion before teardown
    await heartbeat.drainActiveRunExecutions();
    const [completedRun] = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, reviewerAgentId),
        ),
      );
    expect(completedRun).toBeDefined();
    expect(completedRun.status).toBe("succeeded");
  });

  it("coalesces concurrent triggers using the durable issue-and-stage key", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();
    const heartbeat = heartbeatService(db);

    // Run 3 concurrent reconciliations simultaneously
    await Promise.all([
      heartbeat.reconcileStrandedAssignedIssues(),
      heartbeat.reconcileStrandedAssignedIssues(),
      reconcileReviewHandoffAfterBlockerClear(db, {
        issueId,
        companyId,
        enqueueWakeup: (agentId, req) => heartbeat.wakeup(agentId, req),
      }),
    ]);

    // Exactly one handoff enqueued in DB for reviewerAgentId
    const wakes = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, reviewerAgentId),
        ),
      );
    expect(wakes).toHaveLength(1);
    expect(wakes[0].idempotencyKey).toBe(`review-handoff:${issueId}:${stageId}`);

    // Behavioral proof that the asynchronous run reached authoritative completion before teardown
    await heartbeat.drainActiveRunExecutions();
    const [completedRun] = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, reviewerAgentId),
        ),
      );
    expect(completedRun).toBeDefined();
    expect(completedRun.status).toBe("succeeded");
  });

  it("persists queued retry across restart and resumes execution", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();
    const heartbeat = heartbeatService(db);

    // Enqueue review handoff retry
    const handoff = await reconcileReviewHandoffAfterBlockerClear(db, {
      issueId,
      companyId,
      enqueueWakeup: (agentId, req) => heartbeat.wakeup(agentId, req),
    });
    expect(handoff.action).toBe("enqueued");

    // Verify durable wakeup request was persisted with issue-and-stage key
    const [persistedWake] = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, reviewerAgentId),
        ),
      );
    expect(persistedWake).toBeDefined();
    expect(persistedWake.idempotencyKey).toBe(`review-handoff:${issueId}:${stageId}`);

    // Verify a heartbeat run is created in DB for the reviewer with the stage context
    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, reviewerAgentId),
        ),
      );
    expect(run).toBeDefined();
    expect(run.contextSnapshot).toMatchObject({
      issueId,
      currentStageId: stageId,
      wakeReason: "execution_review_requested",
    });

    // Simulate restart by initializing a new heartbeat service instance and calling resumeQueuedRuns
    const restartedHeartbeat = heartbeatService(db);
    await restartedHeartbeat.resumeQueuedRuns();

    // Verify the run remains intact and traceable
    const [resumedRun] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run.id));
    expect(resumedRun).toBeDefined();

    // Behavioral proof that the asynchronous run reached authoritative completion before teardown
    await restartedHeartbeat.drainActiveRunExecutions();
    const [finalRun] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run.id));
    expect(finalRun).toBeDefined();
    expect(finalRun.status).toBe("succeeded");
  });

  it("escalates to board with an actionable blocker upon exhausting review handoff budget", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();
    const heartbeat = heartbeatService(db);

    // Record 3 exhausted attempts in agentWakeupRequests with the issue-and-stage key
    await db.insert(agentWakeupRequests).values({
      id: randomUUID(),
      companyId,
      agentId: reviewerAgentId,
      source: "automation",
      status: "completed",
      idempotencyKey: buildReviewHandoffRetryIdempotencyKey({ issueId, stageId }),
      payload: {
        issueId,
        reviewHandoffAttempt: 3,
      },
    });

    // Next reconciliation should detect exhaustion (attemptCount >= 3)
    const result = await heartbeat.reconcileStrandedAssignedIssues();
    expect(result.escalated).toBe(1);
    expect(result.issueIds).toContain(issueId);

    // Verify exactly one actionable blocker in issueRecoveryActions
    const recoveryActions = await db
      .select()
      .from(issueRecoveryActions)
      .where(
        and(
          eq(issueRecoveryActions.companyId, companyId),
          eq(issueRecoveryActions.sourceIssueId, issueId),
        ),
      );
    expect(recoveryActions).toHaveLength(1);
    expect(recoveryActions[0]).toMatchObject({
      cause: "execution_recovery_budget_exhausted",
      status: "escalated",
      ownerType: "board",
      fingerprint: `review-handoff:${issueId}:${stageId}`,
      attemptCount: 3,
      maxAttempts: 3,
    });

    // Verify getExecutionBlocker identifies this as an active actionable blocker
    const blocker = await getExecutionBlocker(db, companyId, issueId);
    expect(blocker).toMatchObject({
      cause: "execution_recovery_budget_exhausted",
      recoveryActionId: recoveryActions[0].id,
    });

    // Subsequent reconciliations skip because of the valid actionable blocker
    const nextResult = await heartbeat.reconcileStrandedAssignedIssues();
    expect(nextResult.reviewParticipantRequeued).toBe(0);
  });
});
