import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  costEvents,
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  issueComments,
  setDatabaseObserver,
  type DatabaseStatementInfo,
} from "@paperclipai/db";
import { getDatabaseObserver } from "../../../packages/db/src/query-observer.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService, getTaskDrainStatus, startTaskDrain, stopTaskDrain } from "../services/heartbeat.ts";
import { subscribeCompanyLiveEvents } from "../services/live-events.ts";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.js";
import { withAgentStartLock } from "../services/agent-start-lock.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres task-drain admission release tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat task-drain admission release", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let onStatementFinished: ((info: DatabaseStatementInfo) => void) | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-task-drain-admission-release-");
    const previousObserver = getDatabaseObserver();
    setDatabaseObserver({
      observePool() {},
      startStatement(info) {
        return { started() {}, finish() { onStatementFinished?.(info); } };
      },
    });
    try {
      db = createDb(tempDb.connectionString);
    } finally {
      setDatabaseObserver(previousObserver);
    }
  }, 60_000);

  afterEach(async () => {
    onStatementFinished = null;
    await heartbeatService(db).drainActiveRunExecutions();
    heartbeatService(db).setShutdownInProgress(false);
    unregisterServerAdapter("shutdown_fixture");
    stopTaskDrain();
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(costEvents);
    await db.delete(environmentLeases);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgentAndIssue() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Drain Race Agent",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      },
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
          wakeOnDemand: true,
        },
      },
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Work claimed just before a drain trips",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      responsibleUserId: "responsible-user",
    });

    return { companyId, agentId, issueId };
  }

  async function seedQueuedRun(owner?: Awaited<ReturnType<typeof seedAgentAndIssue>>) {
    const { companyId, agentId, issueId } = owner ?? await seedAgentAndIssue();
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "assignment",
      status: "queued",
      runId,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId,
      contextSnapshot: { issueId, wakeReason: "issue_assigned" },
    });

    return { companyId, agentId, issueId, runId, wakeupRequestId };
  }

  async function withinDeadline<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Shutdown fixture did not reach its lifecycle barrier")), 10_000);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function expectQueuedClaim(fixture: Awaited<ReturnType<typeof seedQueuedRun>>) {
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId)))
      .toEqual([expect.objectContaining({ status: "queued", startedAt: null })]);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, fixture.wakeupRequestId)))
      .toEqual([expect.objectContaining({ status: "queued", claimedAt: null })]);
    expect(await db.select().from(issues).where(eq(issues.id, fixture.issueId)))
      .toEqual([expect.objectContaining({ executionRunId: null, executionLockedAt: null })]);
  }

  async function addQueuedComment(fixture: Awaited<ReturnType<typeof seedQueuedRun>>) {
    const [message] = await db.insert(issueComments).values({
      companyId: fixture.companyId, issueId: fixture.issueId,
      authorAgentId: fixture.agentId, body: "Queued message",
    }).returning();
    await db.update(heartbeatRuns).set({ contextSnapshot: {
      issueId: fixture.issueId, wakeReason: "issue_commented", wakeCommentIds: [message!.id],
    } }).where(eq(heartbeatRuns.id, fixture.runId));
    await db.update(agentWakeupRequests).set({ payload: {
      issueId: fixture.issueId, _paperclipWakeContext: { wakeCommentIds: [message!.id] },
    } }).where(eq(agentWakeupRequests.id, fixture.wakeupRequestId));
  }

  it("keeps the comment queued when shutdown begins before its claim transaction opens", async () => {
    const fixture = await seedQueuedRun();
    await addQueuedComment(fixture);
    await db.update(heartbeatRuns).set({ invocationSource: "automation" })
      .where(eq(heartbeatRuns.id, fixture.runId));
    const heartbeat = heartbeatService(db, {
      beforeChatControlRecoveryCheck: async () => { heartbeatService(db).setShutdownInProgress(); },
    });
    await heartbeat.startNextQueuedRunForAgent(fixture.agentId);
    await heartbeat.drainActiveRunExecutions();
    await expectQueuedClaim(fixture);
  });

  it.each([false, true])("keeps a capacity retry queued until predecessor cleanup finishes (native review=%s)", async (nativeReview) => {
    const fixture = await seedQueuedRun();
    const [predecessor] = await db.insert(heartbeatRuns).values({
      companyId: fixture.companyId, agentId: fixture.agentId,
      status: "failed", contextSnapshot: { issueId: fixture.issueId },
    }).returning();
    await db.update(heartbeatRuns).set({
      retryOfRunId: predecessor!.id, scheduledRetryReason: "native_provider_overloaded",
      contextSnapshot: { issueId: fixture.issueId, ...(nativeReview ? {
        nativeReviewInteractionId: randomUUID(), nativeReviewDecisionId: randomUUID(),
      } : {}) },
    }).where(eq(heartbeatRuns.id, fixture.runId));
    await db.insert(environmentLeases).values({
      companyId: fixture.companyId, heartbeatRunId: predecessor!.id,
      provider: "local", status: "pending_cleanup", cleanupStatus: "failed",
    });
    const heartbeat = heartbeatService(db);
    await heartbeat.startNextQueuedRunForAgent(fixture.agentId);
    await heartbeat.drainActiveRunExecutions();
    await expectQueuedClaim(fixture);
  });

  it("keeps another service instance's run and wake queued after graceful shutdown begins", async () => {
    const fixture = await seedQueuedRun();
    const routeHeartbeat = heartbeatService(db);
    await heartbeatService(db).drainRunningRunsForShutdown("SIGTERM");
    await routeHeartbeat.startNextQueuedRunForAgent(fixture.agentId);
    await routeHeartbeat.drainActiveRunExecutions();
    await expectQueuedClaim(fixture);
  });

  it("keeps wakes arriving after shutdown durable and queued", async () => {
    const { agentId, issueId } = await seedAgentAndIssue();
    await heartbeatService(db).drainRunningRunsForShutdown("SIGTERM");
    const routeHeartbeat = heartbeatService(db);
    await routeHeartbeat.wakeup(agentId, {
      source: "assignment", reason: "issue_assigned", payload: { issueId },
      contextSnapshot: { issueId, wakeReason: "issue_assigned" },
    });
    await routeHeartbeat.drainActiveRunExecutions();
    expect(await db.select().from(heartbeatRuns)).toEqual([
      expect.objectContaining({ status: "queued", startedAt: null }),
    ]);
    expect(await db.select().from(agentWakeupRequests)).toEqual([
      expect.objectContaining({ status: "queued", claimedAt: null }),
    ]);
    expect(await db.select().from(issues).where(eq(issues.id, issueId))).toEqual([
      expect.objectContaining({ executionRunId: null }),
    ]);
  });

  it("leaves a start already waiting on the agent lock queued during shutdown", async () => {
    const fixture = await seedQueuedRun();
    const routeHeartbeat = heartbeatService(db);
    let unlock!: () => void;
    const lockRelease = new Promise<void>(resolve => { unlock = resolve; });
    let entered!: () => void;
    const lockEntered = new Promise<void>(resolve => { entered = resolve; });
    const lock = withAgentStartLock(fixture.agentId, async () => { entered(); await lockRelease; });
    await withinDeadline(lockEntered);
    const starting = routeHeartbeat.startNextQueuedRunForAgent(fixture.agentId);
    try {
      await heartbeatService(db).drainRunningRunsForShutdown("SIGINT");
    } finally {
      unlock();
      await lock;
      await starting;
      await routeHeartbeat.drainActiveRunExecutions();
    }
    await expectQueuedClaim(fixture);
  });

  it("interrupts an admitted run and preserves its retry when its other-instance finalizer settles", async () => {
    const fixture = await seedQueuedRun();
    let entered!: () => void;
    const adapterEntered = new Promise<void>(resolve => { entered = resolve; });
    registerServerAdapter({
      type: "shutdown_fixture",
      supportsConversationContinuation: true,
      async execute(context) {
        if (context.runId !== fixture.runId) return { exitCode: 0, signal: null, timedOut: false, errorMessage: null };
        await context.onCancellationReady?.();
        context.onDispatch?.();
        await new Promise<void>(resolve => {
          context.signal!.addEventListener("abort", () => resolve(), { once: true });
          entered();
        });
        return { exitCode: 1, signal: "SIGTERM", timedOut: false, errorMessage: "Shutdown acknowledged" };
      },
      async testEnvironment() { return { adapterType: "shutdown_fixture", status: "pass", checks: [], testedAt: "2026-11-06T00:00:00.000Z" }; },
    });
    await db.update(agents).set({ adapterType: "shutdown_fixture" }).where(eq(agents.id, fixture.agentId));
    const routeHeartbeat = heartbeatService(db);
    await routeHeartbeat.startNextQueuedRunForAgent(fixture.agentId);
    try {
      await withinDeadline(adapterEntered);
      const [waitingIssue] = await db.insert(issues).values({
        companyId: fixture.companyId, title: "Queued task waiting for the same agent",
        status: "todo", assigneeAgentId: fixture.agentId, responsibleUserId: "responsible-user",
      }).returning();
      const pending = await seedQueuedRun({ ...fixture, issueId: waitingIssue!.id });
      const result = await heartbeatService(db).drainRunningRunsForShutdown("SIGTERM");
      await routeHeartbeat.drainActiveRunExecutions();
      expect(await routeHeartbeat.getRun(fixture.runId)).toMatchObject({
        status: "interrupted", errorCode: "server_shutdown_interrupted",
      });
      expect(result.interruptedRunIds).toContain(fixture.runId);
      expect(result.retryRunIds).toHaveLength(1);
      await expectQueuedClaim(pending);
      expect(await routeHeartbeat.getRun(result.retryRunIds[0]!)).toMatchObject({ status: "scheduled_retry", startedAt: null });
      const [retry] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.retryRunIds[0]!));
      expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, retry!.wakeupRequestId!)))
        .toEqual([expect.objectContaining({ status: "queued" })]);
      expect(await db.select().from(issues).where(eq(issues.id, fixture.issueId)))
        .toEqual([expect.objectContaining({ executionRunId: retry!.id })]);
    } finally {
      await heartbeatService(db).drainRunningRunsForShutdown("SIGTERM");
      await routeHeartbeat.drainActiveRunExecutions();
    }
  }, 30_000);

  const claimBoundaries = [
    { phase: "queue read", matches: (info: DatabaseStatementInfo) => info.operation === "SELECT" && info.table === "heartbeat_runs" },
    { phase: "issue row lock", matches: (info: DatabaseStatementInfo) => info.table === "issues" && /for update/i.test(info.statement) },
    { phase: "run transition", matches: (info: DatabaseStatementInfo) => info.operation === "UPDATE" && info.table === "heartbeat_runs" },
  ];
  it.each(claimBoundaries.flatMap(boundary => [false, true].map(comment => ({ ...boundary, comment }))))
  ("keeps the claim queued when shutdown begins during the $phase (comment=$comment)", async ({ matches, comment }) => {
    const fixture = await seedQueuedRun();
    if (comment) await addQueuedComment(fixture);
    const routeHeartbeat = heartbeatService(db);
    let shutdownBegan = false;
    onStatementFinished = (info) => {
      if (!matches(info)) return;
      onStatementFinished = null;
      shutdownBegan = true;
      heartbeatService(db).setShutdownInProgress();
    };
    await routeHeartbeat.startNextQueuedRunForAgent(fixture.agentId);
    await routeHeartbeat.drainActiveRunExecutions();
    expect(shutdownBegan).toBe(true);
    await expectQueuedClaim(fixture);
  });

  it("releases a claim made just before another service instance begins shutdown", async () => {
    const fixture = await seedQueuedRun();
    const routeHeartbeat = heartbeatService(db);
    let shutdownBegan = false;
    const unsubscribe = subscribeCompanyLiveEvents(fixture.companyId, (event) => {
      if (event.type !== "heartbeat.run.status" || event.payload.runId !== fixture.runId || event.payload.status !== "running") return;
      shutdownBegan = true;
      heartbeatService(db).setShutdownInProgress();
    });
    try {
      await routeHeartbeat.startNextQueuedRunForAgent(fixture.agentId);
      await routeHeartbeat.drainActiveRunExecutions();
    } finally {
      unsubscribe();
    }
    expect(shutdownBegan).toBe(true);
    await expectQueuedClaim(fixture);
  });

  it("preserves a queued claim and reports the original PostgreSQL refusal", async () => {
    const fixture = await seedQueuedRun();
    await db.execute(sql`create function reject_shutdown_fixture_claim() returns trigger language plpgsql as $$
      begin raise exception 'fixture claim denied'; end $$`);
    await db.execute(sql`create trigger reject_shutdown_fixture_claim before update on heartbeat_runs
      for each row when (new.status = 'running') execute function reject_shutdown_fixture_claim()`);
    try {
      await expect(heartbeatService(db).startNextQueuedRunForAgent(fixture.agentId)).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "fixture claim denied" }),
      });
      await expectQueuedClaim(fixture);
    } finally {
      await db.execute(sql`drop trigger reject_shutdown_fixture_claim on heartbeat_runs`);
      await db.execute(sql`drop function reject_shutdown_fixture_claim()`);
    }
  });

  it("releases the run, wakeup, and issue lock when a task drain trips right after the run is claimed", async () => {
    const { companyId, issueId, runId, wakeupRequestId } = await seedQueuedRun();
    const heartbeat = heartbeatService(db);

    // The claim path publishes a "heartbeat.run.status" live event with
    // status "running" the moment it flips the run row, before the run is
    // dispatched to executeRun's second suppression check. Starting the
    // drain from that same event reproduces the gap the fix closes: the
    // drain trips after the first admission check passed but before the
    // second one runs.
    const unsubscribe = subscribeCompanyLiveEvents(companyId, (event) => {
      const payload = event.payload as { runId?: string; status?: string };
      if (event.type === "heartbeat.run.status" && payload.runId === runId && payload.status === "running") {
        startTaskDrain({});
      }
    });

    try {
      await heartbeat.resumeQueuedRuns();
      await heartbeat.drainActiveRunExecutions();
    } finally {
      unsubscribe();
    }

    const run = await db
      .select({
        status: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
        responsibleUserId: heartbeatRuns.responsibleUserId,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    expect(run).toMatchObject({ status: "queued", startedAt: null, responsibleUserId: null });

    const wakeup = await db
      .select({ status: agentWakeupRequests.status, claimedAt: agentWakeupRequests.claimedAt })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeupRequestId))
      .then((rows) => rows[0] ?? null);
    expect(wakeup).toMatchObject({ status: "queued", claimedAt: null });

    const issue = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(issue).toMatchObject({
      executionRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
    });

    const status = getTaskDrainStatus();
    expect(status.draining).toBe(true);
    expect(status.activeRuns).toBe(0);
    expect(status.pendingWakes).toBe(0);
    expect(status.quiescent).toBe(true);

    // The released run is not orphaned: once the drain lifts, the normal
    // admission path picks it back up and it runs to completion.
    stopTaskDrain();
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();

    const finished = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    expect(finished?.status).toBe("succeeded");
  }, 20_000);

  it("keeps a wake that arrives during a task drain queued and runs it once the drain lifts", async () => {
    const { agentId, issueId } = await seedAgentAndIssue();
    const heartbeat = heartbeatService(db);

    // The drain holds ADMISSION, not the request. The wake lands in the
    // durable queue, so the restart that clears the process-local drain
    // resumes it instead of losing it. (Before this, the wake was written
    // as `skipped` and the issue sat in `todo` with no run and no path.)
    startTaskDrain({});
    await heartbeat.wakeup(agentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "system",
      requestedByActorId: "issue_assignment",
    });
    await heartbeat.drainActiveRunExecutions();

    const wakeup = await db
      .select({
        status: agentWakeupRequests.status,
        reason: agentWakeupRequests.reason,
        payload: agentWakeupRequests.payload,
      })
      .from(agentWakeupRequests)
      .then((rows) => rows[0] ?? null);
    expect(wakeup).toMatchObject({ status: "queued", reason: "issue_assigned" });
    expect(wakeup?.payload).not.toHaveProperty("heartbeatSkip");
    const queuedRuns = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns);
    expect(queuedRuns).toHaveLength(1);
    expect(queuedRuns[0]).toMatchObject({ status: "queued" });
    const runId = queuedRuns[0]!.id;

    // Admission stays held for as long as the drain is active, and the
    // queued row does not count against quiescence: the restart may proceed.
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    const held = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    expect(held?.status).toBe("queued");
    expect(getTaskDrainStatus()).toMatchObject({
      draining: true,
      activeRuns: 0,
      pendingWakes: 0,
      quiescent: true,
    });

    // The drain lifts (a restart clears it the same way): the queued wake
    // runs to completion through the normal admission path.
    stopTaskDrain();
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    const finished = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    expect(finished?.status).toBe("succeeded");
    const completedWakeup = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .then((rows) => rows[0] ?? null);
    expect(completedWakeup?.status).toBe("completed");
  }, 20_000);

  // Inject one rollback only after the test starts task drain. Admission also
  // uses transactions, so transaction call numbers do not identify release.
  function withFailingTransactionalUpdate(realDb: typeof db, failingTable: unknown, armed: () => boolean) {
    let injected = false;
    return new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop !== "transaction") return Reflect.get(target, prop, receiver);
        return (fn: (tx: unknown) => Promise<unknown>) => {
          return target.transaction((tx) => {
            const txProxy = new Proxy(tx as object, {
              get(txTarget, txProp, txReceiver) {
                if (txProp === "update") {
                  return (table: unknown) => {
                    if (!injected && armed() && table === failingTable) {
                      injected = true;
                      throw new Error("simulated transactional write failure");
                    }
                    return (txTarget as any).update(table);
                  };
                }
                return Reflect.get(txTarget, txProp, txReceiver);
              },
            });
            return fn(txProxy);
          });
        };
      },
    }) as typeof db;
  }

  it("leaves the run row running for the orphan reaper when the atomic release fails", async () => {
    const { companyId, issueId, runId, wakeupRequestId } = await seedQueuedRun();
    // Fault the release transaction on the issue-lock write, so executeRun's
    // suppression branch catches the failure, logs it, and returns instead
    // of throwing. There is no in-process fallback or retry for this path.
    let releaseStarted = false;
    const failingDb = withFailingTransactionalUpdate(db, issues, () => releaseStarted);
    const heartbeat = heartbeatService(failingDb);

    const unsubscribe = subscribeCompanyLiveEvents(companyId, (event) => {
      const payload = event.payload as { runId?: string; status?: string };
      if (event.type === "heartbeat.run.status" && payload.runId === runId && payload.status === "running") {
        startTaskDrain({});
        releaseStarted = true;
      }
    });

    try {
      await heartbeat.resumeQueuedRuns();
      await heartbeat.drainActiveRunExecutions();
    } finally {
      unsubscribe();
    }

    // The release transaction rolled back, so the run, wakeup, and issue
    // lock stay exactly as the admission claim left them.
    const run = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    expect(run?.status).toBe("running");

    const wakeup = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeupRequestId))
      .then((rows) => rows[0] ?? null);
    expect(wakeup?.status).toBe("claimed");

    const issue = await db
      .select({ executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(issue?.executionRunId).toBe(runId);

    // executeRun did not throw, so the dispatch site removed this run's
    // execution promise from active tracking like it does for any other
    // completed run. Task-drain now reads quiescent even though the
    // database still holds the run claimed: this reading counts in-process
    // work only.
    const status = getTaskDrainStatus();
    expect(status.activeRuns).toBe(0);
    expect(status.quiescent).toBe(true);

    // Missing local tracking cannot override the durable controller lease.
    // Once that unrenewed lease expires, the reaper finalizes the orphan and
    // releases the issue lock on its own cycle.
    const beforeExpiry = await heartbeat.reapOrphanedRuns();
    expect(beforeExpiry.runIds).not.toContain(runId);
    await db.update(heartbeatRuns).set({
      controllerLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
    }).where(eq(heartbeatRuns.id, runId));
    const reapResult = await heartbeat.reapOrphanedRuns();
    expect(reapResult.runIds).toContain(runId);

    const reapedRun = await db
      .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    expect(reapedRun?.status).toBe("failed");
    expect(reapedRun?.errorCode).toBe("process_lost");

    // The issue is still "todo" and assigned to the same agent, so the
    // reaper's normal self-heal path queues a fresh recovery run for it
    // instead of leaving the lock pointed at the failed run.
    const reapedIssue = await db
      .select({ executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(reapedIssue?.executionRunId).not.toBe(runId);
  }, 20_000);
});
