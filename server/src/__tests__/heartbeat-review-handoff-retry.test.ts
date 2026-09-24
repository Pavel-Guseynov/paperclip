import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
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

import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { heartbeatService } from "../services/heartbeat.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { recoveryService } from "../services/recovery/service.js";
import {
  REVIEW_HANDOFF_COALESCED_REASON,
  REVIEW_HANDOFF_NO_RECEIPT_REASON,
  REVIEW_HANDOFF_REFUSED_REASON,
  buildReviewHandoffRetryIdempotencyKey,
  isReviewHandoffRetryIdempotencyConflict,
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
      idempotencyKey: buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt: 1 }),
    });
    expect(wakes[0].payload).toMatchObject({
      issueId,
      reviewHandoffAttempt: 1,
      executionStage: {
        stageId,
        wakeRole: "reviewer",
      },
    });

    // Behavioral proof that the asynchronous run reached authoritative
    // completion before teardown. The run is selected by its own handoff wake:
    // completing it lets upstream's stranded-participant recovery enqueue
    // further runs for the same agent.
    await heartbeat.drainActiveRunExecutions();
    const [completedRun] = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, reviewerAgentId),
          eq(heartbeatRuns.wakeupRequestId, wakes[0].id),
        ),
      );
    expect(completedRun).toBeDefined();
    expect(completedRun.status).toBe("succeeded");
  });

  it("rejects a second durable retry for the same issue, stage and attempt", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();
    const idempotencyKey = buildReviewHandoffRetryIdempotencyKey({
      issueId,
      stageId,
      attempt: 1,
    });

    const insertWake = (status: string) =>
      db.insert(agentWakeupRequests).values({
        id: randomUUID(),
        companyId,
        agentId: reviewerAgentId,
        source: "automation",
        status,
        idempotencyKey,
        payload: { issueId, reviewHandoffAttempt: 1 },
      });

    await insertWake("queued");

    const conflict = await insertWake("queued").then(
      () => null,
      (error: unknown) => error,
    );
    expect(conflict).not.toBeNull();
    expect(isReviewHandoffRetryIdempotencyConflict(conflict)).toBe(true);

    // A skipped row records a refused delivery and is deliberately outside the
    // index, so it never blocks the retry it refused.
    await insertWake("skipped");

    // A later attempt carries its own key and stays admissible.
    await db.insert(agentWakeupRequests).values({
      id: randomUUID(),
      companyId,
      agentId: reviewerAgentId,
      source: "automation",
      status: "queued",
      idempotencyKey: buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt: 2 }),
      payload: { issueId, reviewHandoffAttempt: 2 },
    });

    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.companyId, companyId));
    expect(rows).toHaveLength(3);
  });

  it("coalesces concurrent triggers into one durable retry", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();
    const heartbeat = heartbeatService(db);

    // The wake writer persists the durable retry without dispatching a run, so
    // the outcome depends on the durable key alone and not on run timing.
    const persistWake: Parameters<typeof reconcileReviewHandoffAfterBlockerClear>[1]["enqueueWakeup"] =
      async (agentId, request) => {
        const [row] = await db
          .insert(agentWakeupRequests)
          .values({
            id: randomUUID(),
            companyId,
            agentId,
            source: "automation",
            reason: request.reason,
            status: "queued",
            idempotencyKey: request.idempotencyKey ?? null,
            payload: request.payload ?? null,
          })
          .returning({ id: agentWakeupRequests.id });
        return row ?? null;
      };

    const results = await Promise.all([
      reconcileReviewHandoffAfterBlockerClear(db, { issueId, companyId, enqueueWakeup: persistWake }),
      reconcileReviewHandoffAfterBlockerClear(db, { issueId, companyId, enqueueWakeup: persistWake }),
      reconcileReviewHandoffAfterBlockerClear(db, { issueId, companyId, enqueueWakeup: persistWake }),
    ]);

    expect(results.filter((result) => result.action === "enqueued")).toHaveLength(1);

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
    expect(wakes[0].idempotencyKey).toBe(
      buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt: 1 }),
    );
    await heartbeat.drainActiveRunExecutions();
  });

  it("reports a lost enqueue race as a coalesced skip", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();

    const result = await reconcileReviewHandoffAfterBlockerClear(db, {
      issueId,
      companyId,
      // Stands for the caller that loses a cross-process race: the winner
      // already persisted this attempt's wake before this insert runs.
      enqueueWakeup: async (agentId, request) => {
        const values = {
          companyId,
          agentId,
          source: "automation" as const,
          status: "queued",
          idempotencyKey: request.idempotencyKey ?? null,
          payload: request.payload ?? null,
        };
        await db.insert(agentWakeupRequests).values({ id: randomUUID(), ...values });
        await db.insert(agentWakeupRequests).values({ id: randomUUID(), ...values });
        return null;
      },
    });

    expect(result).toEqual({
      action: "skipped",
      reason: REVIEW_HANDOFF_COALESCED_REASON,
    });

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
    expect(wakes[0].idempotencyKey).toBe(
      buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt: 1 }),
    );
  });

  it("continues the durable retry ledger on a restarted instance", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();

    // A previous process persisted attempt 1 and stopped before the reviewer
    // ran: the wake row is the only surviving state.
    await db.insert(agentWakeupRequests).values({
      id: randomUUID(),
      companyId,
      agentId: reviewerAgentId,
      source: "automation",
      reason: "execution_review_requested",
      status: "queued",
      idempotencyKey: buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt: 1 }),
      payload: { issueId, reviewHandoffAttempt: 1 },
    });

    // A fresh instance carries no in-process state, so the queued retry must be
    // read from the database rather than enqueued a second time.
    const restarted = heartbeatService(db);
    const stillQueued = await restarted.reconcileStrandedAssignedIssues();
    expect(stillQueued.reviewParticipantRequeued).toBe(0);
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.companyId, companyId)),
    ).toHaveLength(1);

    // The queued retry is consumed without the reviewer acting. The restarted
    // instance must resume the ledger at attempt 2, not restart the budget.
    await db
      .update(agentWakeupRequests)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(agentWakeupRequests.companyId, companyId));

    const resumed = await restarted.reconcileStrandedAssignedIssues();
    expect(resumed.reviewParticipantRequeued).toBe(1);
    expect(resumed.issueIds).toContain(issueId);

    const wakes = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.companyId, companyId))
      .orderBy(agentWakeupRequests.requestedAt);
    expect(wakes).toHaveLength(2);
    expect(wakes[1].idempotencyKey).toBe(
      buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt: 2 }),
    );
    expect(wakes[1].payload).toMatchObject({ issueId, reviewHandoffAttempt: 2 });

    // The restarted instance owns the dispatched run through to completion.
    // The run is selected by the handoff wake it came from: completing it lets
    // upstream's own stranded-participant recovery enqueue further runs for the
    // same agent, which this case does not assert on.
    await restarted.drainActiveRunExecutions();
    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, reviewerAgentId),
          eq(heartbeatRuns.wakeupRequestId, wakes[1].id),
        ),
      );
    expect(run).toBeDefined();
    expect(run.status).toBe("succeeded");
    expect(run.contextSnapshot).toMatchObject({
      issueId,
      currentStageId: stageId,
      wakeReason: "execution_review_requested",
    });
  });

  it("escalates to board with one actionable blocker upon exhausting the review handoff budget", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();
    const heartbeat = heartbeatService(db);

    // Three durable attempts already consumed the budget.
    for (const attempt of [1, 2, 3]) {
      await db.insert(agentWakeupRequests).values({
        id: randomUUID(),
        companyId,
        agentId: reviewerAgentId,
        source: "automation",
        status: "completed",
        idempotencyKey: buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt }),
        payload: { issueId, reviewHandoffAttempt: attempt },
      });
    }

    const result = await heartbeat.reconcileStrandedAssignedIssues();
    expect(result.escalated).toBe(1);
    expect(result.issueIds).toContain(issueId);

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
      kind: "stranded_assigned_issue",
      cause: "execution_recovery_budget_exhausted",
      status: "active",
      ownerType: "board",
      ownerAgentId: null,
      returnOwnerAgentId: reviewerAgentId,
      fingerprint: `review-handoff:${issueId}:${stageId}`,
      attemptCount: 3,
      maxAttempts: 3,
      wakePolicy: null,
      monitorPolicy: null,
    });

    const blocker = await getExecutionBlocker(db, companyId, issueId);
    expect(blocker).toMatchObject({
      cause: "execution_recovery_budget_exhausted",
      recoveryActionId: recoveryActions[0].id,
    });

    // The escalated blocker is now a valid blocker, so no further retry starts
    // and no second action is created.
    const nextResult = await heartbeat.reconcileStrandedAssignedIssues();
    expect(nextResult.reviewParticipantRequeued).toBe(0);
    expect(
      await db
        .select()
        .from(issueRecoveryActions)
        .where(eq(issueRecoveryActions.companyId, companyId)),
    ).toHaveLength(1);
    await heartbeat.drainActiveRunExecutions();
  });

  it("reconciles the owed handoff before the recovery-action resolve response returns", async () => {
    const { companyId, issueId, reviewerAgentId, stageId, workerAgentId } = await seedFixture();
    const heartbeat = heartbeatService(db);
    const actionId = randomUUID();
    await db.insert(issueRecoveryActions).values({
      id: actionId,
      companyId,
      sourceIssueId: issueId,
      kind: "stranded_assigned_issue",
      status: "active",
      ownerType: "board",
      returnOwnerAgentId: workerAgentId,
      cause: "uncertain_provider_action",
      fingerprint: `stale-blocker:${issueId}`,
      evidence: {},
      nextAction: "Confirm whether the provider action completed.",
      attemptCount: 1,
    });

    // The blocker is real until it is resolved, so nothing is owed yet.
    expect(
      (await reconcileReviewHandoffAfterBlockerClear(db, {
        issueId,
        companyId,
        enqueueWakeup: (agentId, request) => heartbeat.wakeup(agentId, request),
      })).action,
    ).toBe("skipped");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        source: "local_implicit",
        userId: "responsible-user",
        companyIds: [companyId],
        memberships: [{ companyId, status: "active", membershipRole: "operator" }],
        isInstanceAdmin: true,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any, {}));
    app.use(errorHandler);

    const res = await request(app)
      .post(`/api/issues/${issueId}/recovery-actions/resolve`)
      .send({ actionId, outcome: "restored", sourceIssueStatus: "in_review" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Asserted with no drain and no waiting: the route awaited the
    // reconciliation, so the durable retry already exists when it responded.
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
    expect(wakes[0].idempotencyKey).toBe(
      buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt: 1 }),
    );

    await heartbeat.drainActiveRunExecutions();
  });

  it("counts a refused wake as a consumed attempt and escalates instead of retrying forever", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();
    // The reviewer refuses every on-demand wake. The heartbeat writes a
    // `skipped` receipt under this attempt's key and returns no run.
    await db
      .update(agents)
      .set({ runtimeConfig: { heartbeat: { wakeOnDemand: false } } })
      .where(eq(agents.id, reviewerAgentId));
    const heartbeat = heartbeatService(db);

    const results = [];
    for (let pass = 0; pass < 4; pass += 1) {
      results.push(
        await reconcileReviewHandoffAfterBlockerClear(db, {
          issueId,
          companyId,
          enqueueWakeup: (agentId, req) => heartbeat.wakeup(agentId, req),
        }),
      );
    }

    // A refused wake is reported as refused, never as an enqueued handoff.
    // The wake path coalesces its own refusal receipt under a derived
    // execution-wait key, so the retry records the consumed attempt itself.
    expect(results.slice(0, 3)).toEqual([
      { action: "skipped", reason: REVIEW_HANDOFF_NO_RECEIPT_REASON },
      { action: "skipped", reason: REVIEW_HANDOFF_NO_RECEIPT_REASON },
      { action: "skipped", reason: REVIEW_HANDOFF_NO_RECEIPT_REASON },
    ]);

    // Each refusal consumed one attempt, so the rows are bounded by the budget
    // instead of growing once per sweep.
    const wakes = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.companyId, companyId));
    expect(wakes.every((wake) => wake.status === "skipped")).toBe(true);
    expect(
      wakes
        .map((wake) => wake.idempotencyKey)
        .filter((key) => key?.startsWith("review-handoff:"))
        .sort(),
    ).toEqual(
      [1, 2, 3].map((attempt) =>
        buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt }),
      ),
    );
    // The wake path's own refusal receipts stay coalesced into one row.
    expect(
      wakes.filter((wake) => !wake.idempotencyKey?.startsWith("review-handoff:")),
    ).toHaveLength(1);

    // The budget is exhausted, so the fourth pass escalates to the board.
    expect(results[3].action).toBe("exhausted");
    const recoveryActions = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.companyId, companyId));
    expect(recoveryActions).toHaveLength(1);
    expect(recoveryActions[0]).toMatchObject({
      cause: "execution_recovery_budget_exhausted",
      ownerType: "board",
      attemptCount: 3,
      maxAttempts: 3,
    });
    await heartbeat.drainActiveRunExecutions();
  });

  it("counts an execution-wait receipt that keeps this attempt's key", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();

    // `recordExecutionWait` saves a refused wake as a `skipped` row that keeps
    // the requested idempotency key when it does not coalesce.
    const savedAsExecutionWait: Parameters<
      typeof reconcileReviewHandoffAfterBlockerClear
    >[1]["enqueueWakeup"] = async (agentId, request) => {
      await db.insert(agentWakeupRequests).values({
        id: randomUUID(),
        companyId,
        agentId,
        source: "automation",
        reason: request.reason,
        status: "skipped",
        idempotencyKey: request.idempotencyKey ?? null,
        payload: {
          ...(request.payload ?? {}),
          executionWait: { reason: "issue_execution_disabled" },
        },
        finishedAt: new Date(),
      });
      return null;
    };

    const first = await reconcileReviewHandoffAfterBlockerClear(db, {
      issueId,
      companyId,
      enqueueWakeup: savedAsExecutionWait,
    });
    expect(first).toEqual({ action: "skipped", reason: REVIEW_HANDOFF_REFUSED_REASON });

    const second = await reconcileReviewHandoffAfterBlockerClear(db, {
      issueId,
      companyId,
      enqueueWakeup: savedAsExecutionWait,
    });
    expect(second).toEqual({ action: "skipped", reason: REVIEW_HANDOFF_REFUSED_REASON });

    const wakes = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.companyId, companyId));
    expect([...wakes.map((wake) => wake.idempotencyKey)].sort()).toEqual(
      [1, 2].map((attempt) =>
        buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt }),
      ),
    );
  });

  it("records the consumed attempt when the wake persisted no receipt under this key", async () => {
    const { companyId, issueId, reviewerAgentId, stageId } = await seedFixture();

    // A coalescing execution wait records the wake under its own derived key,
    // so this attempt's key has no receipt of its own.
    const coalescedElsewhere: Parameters<
      typeof reconcileReviewHandoffAfterBlockerClear
    >[1]["enqueueWakeup"] = async (agentId) => {
      await db.insert(agentWakeupRequests).values({
        id: randomUUID(),
        companyId,
        agentId,
        source: "automation",
        status: "skipped",
        idempotencyKey: `execution-wait:${issueId}`,
        payload: { issueId },
        finishedAt: new Date(),
      });
      return null;
    };

    const first = await reconcileReviewHandoffAfterBlockerClear(db, {
      issueId,
      companyId,
      enqueueWakeup: coalescedElsewhere,
    });
    expect(first).toEqual({
      action: "skipped",
      reason: REVIEW_HANDOFF_NO_RECEIPT_REASON,
    });

    // The consumed attempt is durable, so the next trigger moves to attempt 2.
    const second = await reconcileReviewHandoffAfterBlockerClear(db, {
      issueId,
      companyId,
      enqueueWakeup: coalescedElsewhere,
    });
    expect(second).toEqual({
      action: "skipped",
      reason: REVIEW_HANDOFF_NO_RECEIPT_REASON,
    });

    const recorded = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, reviewerAgentId),
        ),
      );
    expect(
      recorded
        .map((wake) => wake.idempotencyKey)
        .filter((key) => key?.startsWith("review-handoff:"))
        .sort(),
    ).toEqual(
      [1, 2].map((attempt) =>
        buildReviewHandoffRetryIdempotencyKey({ issueId, stageId, attempt }),
      ),
    );
    expect(recorded.every((wake) => wake.status === "skipped")).toBe(true);
  });

  it("skips a hidden issue", async () => {
    const { companyId, issueId, reviewerAgentId } = await seedFixture();
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, issueId));
    const heartbeat = heartbeatService(db);

    const result = await reconcileReviewHandoffAfterBlockerClear(db, {
      issueId,
      companyId,
      enqueueWakeup: (agentId, req) => heartbeat.wakeup(agentId, req),
    });

    expect(result).toEqual({ action: "skipped", reason: "issue not in_review" });
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, companyId),
            eq(agentWakeupRequests.agentId, reviewerAgentId),
          ),
        ),
    ).toHaveLength(0);
    await heartbeat.drainActiveRunExecutions();
  });

  it("contains one issue's handoff failure and finishes the stranded sweep", async () => {
    const failing = await seedFixture();
    const healthy = await seedFixture();
    const wakeFailure = new Error("wake target rejected the handoff");

    const recovery = recoveryService(db, {
      enqueueWakeup: async (agentId, opts) => {
        if (agentId === failing.reviewerAgentId) throw wakeFailure;
        const [row] = await db
          .insert(agentWakeupRequests)
          .values({
            id: randomUUID(),
            companyId: healthy.companyId,
            agentId,
            source: "automation",
            reason: opts?.reason ?? null,
            status: "queued",
            idempotencyKey: opts?.idempotencyKey ?? null,
            payload: opts?.payload ?? null,
          })
          .returning();
        return row as never;
      },
    });

    const result = await recovery.reconcileStrandedAssignedIssues();

    expect(result.reviewParticipantRequeued).toBe(1);
    expect(result.issueIds).toContain(healthy.issueId);
    expect(result.issueIds).not.toContain(failing.issueId);
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.companyId, healthy.companyId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.companyId, failing.companyId)),
    ).toHaveLength(0);
  });
});
