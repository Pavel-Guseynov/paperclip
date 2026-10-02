import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentTaskSessions,
  companies,
  createDb,
  heartbeatRuns,
  issueRecoveryActions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  registerServerAdapter,
  unregisterServerAdapter,
} from "../adapters/index.js";
import {
  CONVERSATION_CONTINUATION_POLICY,
  hasConversationContinuationPolicy,
  isConversationAdapter,
  runUsedConversationAdapter,
} from "../services/conversation-continuation.js";
import {
  legacyExecutionNeedsReconciliation,
  terminalizeLegacyExecution,
} from "../services/legacy-execution-recovery.js";
import { heartbeatService, resolveNextSessionState } from "../services/heartbeat.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
const describePostgres = postgresSupport.supported ? describe : describe.skip;

describePostgres("antigravity_local conversation continuation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase(
      "paperclip-antigravity-continuation-",
    );
    db = createDb(database.connectionString);
  }, 20_000);

  afterAll(async () => {
    await database?.cleanup();
  });

  afterEach(() => {
    unregisterServerAdapter("antigravity_local");
    unregisterServerAdapter("unlisted_custom_adapter");
  });

  it("an interrupted antigravity_local run carries the continuation policy and creates no reconciliation hold", async () => {
    registerServerAdapter({
      type: "antigravity_local",
      supportsConversationContinuation: true,
      execute: vi.fn(),
      testEnvironment: vi.fn(),
    } as any);

    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Agy Continuation Test",
      issuePrefix: "AGY",
      defaultResponsibleUserId: "user-1",
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Antigravity Agent",
      adapterType: "antigravity_local",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Task with agy",
      status: "in_progress",
      assigneeAgentId: agentId,
    });

    const [run] = await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      runtimeMode: "legacy",
      startedAt: new Date(),
      runnerProfileJson: { adapterDispatch: { adapterType: "antigravity_local" } },
      contextSnapshot: { issueId },
    }).returning();

    // Verify runUsedConversationAdapter recognizes antigravity_local as a conversation adapter
    const usedConversation = await runUsedConversationAdapter(db, run);
    expect(usedConversation).toBe(true);

    // Drain/interrupt via drainRunningRunsForShutdown
    const heartbeat = heartbeatService(db);
    const drainResult = await heartbeat.drainRunningRunsForShutdown("SIGTERM", new Date(), [runId]);
    expect(drainResult.interruptedRunIds).toContain(runId);

    const interruptedRun = await heartbeat.getRun(runId);
    expect(interruptedRun?.status).toBe("interrupted");
    expect(interruptedRun?.errorCode).toBe("server_shutdown_interrupted");
    expect(hasConversationContinuationPolicy(interruptedRun?.resultJson)).toBe(true);
    expect(interruptedRun?.resultJson).toMatchObject({
      conversationContinuation: CONVERSATION_CONTINUATION_POLICY,
    });

    expect(legacyExecutionNeedsReconciliation(interruptedRun!)).toBe(false);

    // Verify no reconciliation hold was created in db
    const holds = await db.select().from(issueRecoveryActions).where(and(
      eq(issueRecoveryActions.companyId, companyId),
      eq(issueRecoveryActions.sourceIssueId, issueId),
      eq(issueRecoveryActions.cause, "legacy_execution_requires_reconciliation"),
    ));
    expect(holds).toHaveLength(0);
  });

  it("the same for an acknowledged-cancelled antigravity_local run", async () => {
    registerServerAdapter({
      type: "antigravity_local",
      supportsConversationContinuation: true,
      execute: vi.fn(),
      testEnvironment: vi.fn(),
    } as any);

    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Agy Cancellation Test",
      issuePrefix: "AGYC",
      defaultResponsibleUserId: "user-1",
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Antigravity Agent",
      adapterType: "antigravity_local",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Cancelled task with agy",
      status: "in_progress",
      assigneeAgentId: agentId,
    });

    const [run] = await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      runtimeMode: "legacy",
      startedAt: new Date(),
      runnerProfileJson: { adapterDispatch: { adapterType: "antigravity_local" } },
      contextSnapshot: { issueId },
    }).returning();

    expect(isConversationAdapter("antigravity_local")).toBe(true);
    expect(await runUsedConversationAdapter(db, run)).toBe(true);

    const cancelledRun = {
      ...run,
      status: "cancelled",
      errorCode: "cancelled",
      resultJson: {
        executionCancellation: { state: "acknowledged", acknowledgedAt: new Date().toISOString() },
        ...(isConversationAdapter("antigravity_local")
          ? { conversationContinuation: CONVERSATION_CONTINUATION_POLICY }
          : {}),
      },
    };

    expect(hasConversationContinuationPolicy(cancelledRun.resultJson)).toBe(true);
    expect(legacyExecutionNeedsReconciliation(cancelledRun)).toBe(false);

    if (legacyExecutionNeedsReconciliation(cancelledRun)) {
      await terminalizeLegacyExecution({ db, run: cancelledRun as any, status: "cancelled" });
    }

    const holds = await db.select().from(issueRecoveryActions).where(and(
      eq(issueRecoveryActions.companyId, companyId),
      eq(issueRecoveryActions.sourceIssueId, issueId),
      eq(issueRecoveryActions.cause, "legacy_execution_requires_reconciliation"),
    ));
    expect(holds).toHaveLength(0);
  });

  it("a failed or timed_out antigravity_local run is continued, not held", async () => {
    registerServerAdapter({
      type: "antigravity_local",
      supportsConversationContinuation: true,
      execute: vi.fn(),
      testEnvironment: vi.fn(),
    } as any);

    expect(isConversationAdapter("antigravity_local")).toBe(true);

    for (const status of ["failed", "timed_out"] as const) {
      const run = {
        runtimeMode: "legacy" as const,
        status,
        errorCode: status === "failed" ? "process_lost" : "timeout",
        resultJson: isConversationAdapter("antigravity_local")
          ? { conversationContinuation: CONVERSATION_CONTINUATION_POLICY }
          : {},
      };

      expect(hasConversationContinuationPolicy(run.resultJson)).toBe(true);
      expect(legacyExecutionNeedsReconciliation(run)).toBe(false);
    }
  });

  it("the continued wake reuses the stored session", async () => {
    registerServerAdapter({
      type: "antigravity_local",
      supportsConversationContinuation: true,
      execute: vi.fn(),
      testEnvironment: vi.fn(),
    } as any);

    expect(isConversationAdapter("antigravity_local")).toBe(true);

    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const sessionId = "agy-session-uuid-1234";

    await db.insert(companies).values({
      id: companyId,
      name: "Agy Session Reuse Test",
      issuePrefix: "AGYS",
      defaultResponsibleUserId: "user-1",
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Antigravity Agent",
      adapterType: "antigravity_local",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Session reuse task",
      status: "in_progress",
      assigneeAgentId: agentId,
    });

    const previousRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: previousRunId,
      companyId,
      agentId,
      status: "interrupted",
      runtimeMode: "legacy",
      startedAt: new Date(),
      finishedAt: new Date(),
      runnerProfileJson: { adapterDispatch: { adapterType: "antigravity_local" } },
      contextSnapshot: { issueId },
      resultJson: { conversationContinuation: CONVERSATION_CONTINUATION_POLICY },
    });

    // Store existing task session
    await db.insert(agentTaskSessions).values({
      companyId,
      agentId,
      adapterType: "antigravity_local",
      taskKey: issueId,
      sessionParamsJson: { sessionId },
      sessionDisplayId: sessionId,
      lastRunId: previousRunId,
    });

    // Simulate an interrupted/failed run ending without clearSession
    const nextSession = resolveNextSessionState({
      adapterType: "antigravity_local",
      codec: {
        serialize: (p) => p,
        deserialize: (p) => p as Record<string, unknown>,
      },
      adapterResult: {
        exitCode: 1,
        signal: "SIGTERM",
        timedOut: false,
        clearSession: false,
      },
      outcome: "interrupted",
      previousParams: { sessionId },
      previousDisplayId: sessionId,
      previousLegacySessionId: sessionId,
    });

    // Verify session params and displayId are preserved
    expect(nextSession.params).toEqual({ sessionId });
    expect(nextSession.displayId).toBe(sessionId);

    // Verify run carrying continuation policy preserves continuation eligibility
    const runResult = {
      ...(isConversationAdapter("antigravity_local")
        ? { conversationContinuation: CONVERSATION_CONTINUATION_POLICY }
        : {}),
    };
    expect(hasConversationContinuationPolicy(runResult)).toBe(true);

    // Verify task session row in DB still retains the session
    const [storedSession] = await db.select().from(agentTaskSessions).where(and(
      eq(agentTaskSessions.companyId, companyId),
      eq(agentTaskSessions.agentId, agentId),
      eq(agentTaskSessions.taskKey, issueId),
    ));
    expect(storedSession.sessionParamsJson).toMatchObject({ sessionId });
  });

  it("a run of an adapter that stays unlisted or undeclared is still held", async () => {
    registerServerAdapter({
      type: "unlisted_custom_adapter",
      // supportsConversationContinuation is NOT declared
      execute: vi.fn(),
      testEnvironment: vi.fn(),
    } as any);

    expect(isConversationAdapter("unlisted_custom_adapter")).toBe(false);

    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Unlisted Hold Test",
      issuePrefix: "UHLD",
      defaultResponsibleUserId: "user-1",
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Unlisted Agent",
      adapterType: "unlisted_custom_adapter",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Task with unlisted adapter",
      status: "in_progress",
      assigneeAgentId: agentId,
    });

    const [run] = await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "interrupted",
      runtimeMode: "legacy",
      errorCode: "process_lost",
      startedAt: new Date(),
      runnerProfileJson: { adapterDispatch: { adapterType: "unlisted_custom_adapter" } },
      contextSnapshot: { issueId },
    }).returning();

    expect(await runUsedConversationAdapter(db, run)).toBe(false);
    expect(hasConversationContinuationPolicy(run.resultJson)).toBe(false);
    expect(legacyExecutionNeedsReconciliation(run)).toBe(true);

    // Terminalize should create reconciliation hold
    await terminalizeLegacyExecution({ db, run, status: "interrupted" });

    const holds = await db.select().from(issueRecoveryActions).where(and(
      eq(issueRecoveryActions.companyId, companyId),
      eq(issueRecoveryActions.sourceIssueId, issueId),
      eq(issueRecoveryActions.cause, "legacy_execution_requires_reconciliation"),
    ));
    expect(holds).toHaveLength(1);
    expect(holds[0].ownerType).toBe("board");
    expect(holds[0].evidence).toMatchObject({
      adapterRecovery: "unsupported_or_unknown",
    });
  });

  it("a listed adapter's behavior is unchanged", async () => {
    // claude_local and codex_local are in CONVERSATION_ADAPTER_TYPES
    expect(isConversationAdapter("claude_local")).toBe(true);
    expect(isConversationAdapter("codex_local")).toBe(true);

    const run = {
      runtimeMode: "legacy" as const,
      status: "interrupted" as const,
      errorCode: "server_shutdown_interrupted",
      resultJson: {
        conversationContinuation: CONVERSATION_CONTINUATION_POLICY,
      },
    };

    expect(hasConversationContinuationPolicy(run.resultJson)).toBe(true);
    expect(legacyExecutionNeedsReconciliation(run)).toBe(false);
  });
});
