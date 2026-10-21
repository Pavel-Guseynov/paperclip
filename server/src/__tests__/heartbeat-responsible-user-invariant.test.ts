import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companyMemberships,
  companySkills,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Responsible-user invariant test run.",
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

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("heartbeat responsible-user invariant", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-responsible-user-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    // Await every in-flight background heartbeat run to quiescence before the
    // deletes below. A wakeup claims a run and dispatches its execution
    // fire-and-forget, and that run can dispatch a follow-up wakeup, so a run or
    // wakeup can still write heartbeat_runs and issues rows when teardown starts
    // and would race the deletes. The shared drain also awaits an in-flight
    // wakeup that is still before run registration, which a plain run table
    // status poll cannot see.
    await heartbeat.drainActiveRunExecutions();
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    await db.delete(issueComments);
    await db.delete(activityLog);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  }, 60_000);

  async function completedRun(runId: string) {
    await heartbeat.drainActiveRunExecutions();
    return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then(rows => rows[0] ?? null);
  }

  function holdNextAdapter() {
    const events = new EventEmitter();
    let started = false;
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const execute = mockAdapterExecute.getMockImplementation()!;
    mockAdapterExecute.mockImplementationOnce(async () => {
      started = true;
      events.emit("started");
      await blocked;
      return execute();
    });
    return {
      finish,
      waitForStart: async () => {
        if (!started) await once(events, "started", { signal: AbortSignal.timeout(5_000) });
      },
    };
  }

  async function seedCompany() {
    const companyId = randomUUID();
    const ownerUserId = `owner-${randomUUID()}`;
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: ownerUserId,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: ownerUserId,
      membershipRole: "owner",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });

    return { companyId, ownerUserId, agentId };
  }

  it("dispatches an interrupted queue under the clicking operator through the real startup path", async () => {
    const { companyId, agentId, ownerUserId } = await seedCompany();
    const operatorId = `operator-${randomUUID()}`, issueId = randomUUID(), commentId = randomUUID(), queueId = randomUUID();
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: operatorId,
      membershipRole: "operator", status: "active" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Interrupted queue", status: "todo",
      assigneeAgentId: agentId, responsibleUserId: ownerUserId });
    await db.insert(issueComments).values({ id: commentId, companyId, issueId, authorUserId: ownerUserId, body: "Continue the task" });
    await db.insert(agentWakeupRequests).values({ id: queueId, companyId, agentId,
      source: "automation", status: "deferred_issue_execution", requestedByActorType: "system",
      payload: { issueId, commentId, queuedCommentInterrupt: { actorId: operatorId, requestedAt: new Date().toISOString() },
        _paperclipWakeContext: { wakeCommentIds: [commentId], responsibleUserId: ownerUserId,
          retryOfRunId: randomUUID(), originIdentityContextId: randomUUID() } },
    });
    await heartbeat.resumeQueuedCommentInterrupt(companyId, queueId);
    const [receipt] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, queueId));
    expect(receipt.status).toBe("coalesced");
    const completed = await completedRun(receipt.runId!);
    expect(completed).toMatchObject({ status: "succeeded", responsibleUserId: operatorId });
    expect(completed?.activeIdentityContextId).toBeTruthy();
    expect(completed?.contextSnapshot?.originIdentityContextId).toBeUndefined();
    expect(completed?.contextSnapshot?.retryOfRunId).toBeUndefined();
    expect(mockAdapterExecute).toHaveBeenCalled();
    await heartbeat.drainActiveRunExecutions();
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
    expect(runs.every(run => run.responsibleUserId === operatorId && run.status === "succeeded")).toBe(true);
    expect((await db.select().from(issueComments).where(eq(issueComments.id, commentId)))[0].authorUserId).toBe(ownerUserId);
  });

  it("keeps a board manual wake under its caller even when it adopts someone else's queue", async () => {
    const { companyId, agentId, ownerUserId } = await seedCompany();
    const operatorId = `operator-${randomUUID()}`, issueId = randomUUID(), commentId = randomUUID(), queueId = randomUUID();
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: operatorId,
      membershipRole: "operator", status: "active" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Manual wake", status: "todo",
      assigneeAgentId: agentId, responsibleUserId: ownerUserId });
    await db.insert(issueComments).values({ id: commentId, companyId, issueId, authorUserId: ownerUserId, body: "Pending work" });
    await db.insert(agentWakeupRequests).values({ id: queueId, companyId, agentId,
      source: "automation", reason: "issue_commented", status: "deferred_issue_execution", requestedByActorType: "user", requestedByActorId: ownerUserId,
      payload: { issueId, commentId, _paperclipWakeContext: { wakeCommentIds: [commentId] } },
    });
    const run = await heartbeat.wakeup(agentId, { manualUserWake: true, source: "on_demand", triggerDetail: "manual",
      payload: { issueId }, requestedByActorType: "user", requestedByActorId: operatorId,
      contextSnapshot: { responsibleUserId: operatorId } });
    expect(run?.responsibleUserId).toBe(operatorId);
    const completed = await completedRun(run!.id);
    expect(completed).toMatchObject({ status: "succeeded", responsibleUserId: operatorId });
    expect(completed?.contextSnapshot?.wakeCommentIds).toEqual([commentId]);
    await heartbeat.drainActiveRunExecutions();
    expect((await db.select().from(heartbeatRuns)).every(row => row.responsibleUserId === operatorId)).toBe(true);
  });

  it("keeps the clicking user when a manual wake merges into an older deferred receipt", async () => {
    const { companyId, agentId, ownerUserId } = await seedCompany();
    const operatorId = `operator-${randomUUID()}`, issueId = randomUUID(), commentId = randomUUID(), queueId = randomUUID();
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: operatorId,
      membershipRole: "operator", status: "active" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Deferred manual wake", status: "todo",
      assigneeAgentId: agentId, responsibleUserId: ownerUserId });
    const { finish, waitForStart } = holdNextAdapter();
    const first = await heartbeat.wakeup(agentId, { payload: { issueId },
      requestedByActorType: "user", requestedByActorId: ownerUserId });
    try {
      await waitForStart();
      await db.insert(issueComments).values({ id: commentId, companyId, issueId, authorUserId: ownerUserId, body: "Pending work" });
      await db.insert(agentWakeupRequests).values({ id: queueId, companyId, agentId,
        source: "automation", reason: "issue_commented", status: "deferred_issue_execution",
        requestedByActorType: "user", requestedByActorId: ownerUserId,
        payload: { issueId, commentId, _paperclipWakeContext: { wakeCommentIds: [commentId] } },
      });
      expect(await heartbeat.wakeup(agentId, { manualUserWake: true, source: "on_demand", triggerDetail: "manual",
        payload: { issueId }, requestedByActorType: "user", requestedByActorId: operatorId,
        contextSnapshot: { responsibleUserId: operatorId } })).toBeNull();
      const [pending] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, queueId));
      expect(pending).toMatchObject({ requestedByActorType: "user", requestedByActorId: operatorId,
        payload: { manualUserWake: true } });
    } finally {
      finish();
    }
    await heartbeat.drainActiveRunExecutions();
    const successors = (await db.select().from(heartbeatRuns)).filter(run => run.id !== first!.id);
    expect(successors.length).toBeGreaterThan(0);
    expect(successors.every(run => run.responsibleUserId === operatorId && run.status === "succeeded")).toBe(true);
    expect((await db.select().from(issueComments).where(eq(issueComments.id, commentId)))[0].authorUserId).toBe(ownerUserId);
  });

  it("starts an unscoped manual wake with its own user instead of joining another user's run", async () => {
    const { companyId, agentId, ownerUserId } = await seedCompany();
    const operatorId = `operator-${randomUUID()}`;
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: operatorId,
      membershipRole: "operator", status: "active" });
    const { finish, waitForStart } = holdNextAdapter();
    const first = await heartbeat.wakeup(agentId, { manualUserWake: true, source: "on_demand", triggerDetail: "manual",
      requestedByActorType: "user", requestedByActorId: ownerUserId });
    let second: Awaited<ReturnType<typeof heartbeat.wakeup>>;
    try {
      await waitForStart();
      second = await heartbeat.wakeup(agentId, { manualUserWake: true, source: "on_demand", triggerDetail: "manual",
        requestedByActorType: "user", requestedByActorId: operatorId });
      expect(second?.id).not.toBe(first!.id);
      expect(second?.responsibleUserId).toBe(operatorId);
    } finally {
      finish();
    }
    await heartbeat.drainActiveRunExecutions();
    expect(await completedRun(second!.id)).toMatchObject({ status: "succeeded", responsibleUserId: operatorId });
    expect(await completedRun(first!.id)).toMatchObject({ status: "succeeded", responsibleUserId: ownerUserId });
  });

  it("denies a manual wake of another user's private conversation", async () => {
    const { companyId, agentId, ownerUserId } = await seedCompany();
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Private conversation", status: "todo",
      assigneeAgentId: agentId, responsibleUserId: ownerUserId, conversationAgentId: agentId, conversationUserId: ownerUserId, conversationState: "active" });
    await expect(heartbeat.wakeup(agentId, { manualUserWake: true, source: "on_demand", triggerDetail: "manual",
      payload: { issueId }, requestedByActorType: "user", requestedByActorId: "another-user" })).rejects.toThrow("conversation owner");
    expect(mockAdapterExecute).not.toHaveBeenCalled();
    expect(await db.select().from(heartbeatRuns)).toHaveLength(0);
  });

  it("does not accept a caller-supplied manual-wake authority marker", async () => {
    const { companyId, agentId, ownerUserId } = await seedCompany();
    const run = await heartbeat.wakeup(agentId, { source: "on_demand", triggerDetail: "manual",
      requestedByActorType: "agent", requestedByActorId: agentId, payload: { manualUserWake: true },
      contextSnapshot: { responsibleUserId: ownerUserId } });
    expect((await completedRun(run!.id))?.status).toBe("succeeded");
    const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, run!.wakeupRequestId!));
    expect(wake.payload?.manualUserWake).toBeUndefined();
  });

  it("uses the issue responsible user for automated dependency wakes without a message context", async () => {
    const { companyId, agentId } = await seedCompany();
    const issueResponsibleUserId = `issue-owner-${randomUUID()}`;
    const commenterUserId = `commenter-${randomUUID()}`;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Issue-owned work",
      status: "todo",
      assigneeAgentId: agentId,
      responsibleUserId: issueResponsibleUserId,
    });

    const sourceRunIds: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wakeReason = "issue_blockers_resolved";
      const run = await heartbeat.wakeup(agentId, {
        source: "automation",
        triggerDetail: "system",
        reason: wakeReason,
        payload: { issueId },
        requestedByActorType: "user",
        requestedByActorId: commenterUserId,
        contextSnapshot: { issueId, taskId: issueId, wakeReason },
      });
      expect(run).not.toBeNull();
      sourceRunIds.push(run!.id);
      const completed = await completedRun(run!.id);
      expect(completed?.responsibleUserId).toBe(issueResponsibleUserId);
      expect(completed?.status).toBe("succeeded");
      // A terminal row can precede the execution's final queue/lease cleanup.
      // This test starts independent wakes, not a burst that may be deferred.
      await heartbeat.drainActiveRunExecutions();
    }
    // The deliberately disposition-free adapter response schedules one bounded
    // handoff per source run. Those automatic continuations retain its identity.
    const runs = await db.select().from(heartbeatRuns);
    const handoffs = runs.filter((run) => !sourceRunIds.includes(run.id));
    expect(handoffs).toHaveLength(3);
    expect(
      handoffs.map((run) => run.contextSnapshot?.parentRunId).sort(),
    ).toEqual(sourceRunIds.sort());
    for (const handoff of handoffs) {
      expect(handoff.contextSnapshot?.wakeReason).toBe(
        "finish_successful_run_handoff",
      );
      expect(handoff.responsibleUserId).toBe(issueResponsibleUserId);
      expect(handoff.status).toBe("succeeded");
    }
    expect(mockAdapterExecute).toHaveBeenCalledTimes(runs.length);
  });

  it.each(["issue_commented", "issue_comment_mentioned"])(
    "uses the persisted message author for %s without changing issue ownership",
    async (wakeReason) => {
      const { companyId, agentId } = await seedCompany();
      const issueResponsibleUserId = `issue-owner-${randomUUID()}`;
      const commenterUserId = `commenter-${randomUUID()}`;
      const issueId = randomUUID();
      const commentId = randomUUID();
      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Message-authored work",
        status: "todo",
        assigneeAgentId: agentId,
        responsibleUserId: issueResponsibleUserId,
      });
      await db.insert(issueComments).values({
        id: commentId,
        companyId,
        issueId,
        authorUserId: commenterUserId,
        body: `Current request for ${wakeReason}`,
      });

      const run = await heartbeat.wakeup(agentId, {
        source: "automation",
        triggerDetail: "system",
        reason: wakeReason,
        payload: { issueId, commentId },
        // Request metadata is not authority to replace the stored author.
        requestedByActorType: "user",
        requestedByActorId: `different-requester-${randomUUID()}`,
        contextSnapshot: { issueId, taskId: issueId, wakeReason },
      });

      expect(run).not.toBeNull();
      const completed = await completedRun(run!.id);
      expect(completed?.status).toBe("succeeded");
      expect(completed?.responsibleUserId).toBe(commenterUserId);
      const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
      expect(issue?.responsibleUserId).toBe(issueResponsibleUserId);
      expect(mockAdapterExecute).toHaveBeenCalledTimes(1);
    },
  );

  it("uses the triggering user for manual UI/API runs", async () => {
    const { agentId } = await seedCompany();
    const triggeringUserId = `manual-${randomUUID()}`;
    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      requestedByActorType: "user",
      requestedByActorId: triggeringUserId,
    });

    expect(run).not.toBeNull();
    const completed = await completedRun(run!.id);
    expect(completed?.responsibleUserId).toBe(triggeringUserId);
  });

  it("falls back to the company default for system-originated runs without an issue", async () => {
    const { agentId, ownerUserId } = await seedCompany();
    const run = await heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "scheduled_maintenance",
      requestedByActorType: "system",
      requestedByActorId: null,
      contextSnapshot: { wakeReason: "scheduled_maintenance" },
    });

    expect(run).not.toBeNull();
    const completed = await completedRun(run!.id);
    expect(completed?.responsibleUserId).toBe(ownerUserId);
  });

  it("does not use an issue creator as an implicit responsible user for automated issue runs", async () => {
    const { companyId, agentId, ownerUserId } = await seedCompany();
    const creatorUserId = `creator-${randomUUID()}`;
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Creator is not credential owner",
      status: "todo",
      assigneeAgentId: agentId,
      createdByUserId: creatorUserId,
    });

    const run = await heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_blockers_resolved",
      payload: { issueId },
      requestedByActorType: "user",
      requestedByActorId: `commenter-${randomUUID()}`,
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_blockers_resolved" },
    });
    expect(run).not.toBeNull();
    const completed = await completedRun(run!.id);
    expect(completed?.responsibleUserId).toBe(ownerUserId);
    expect(completed?.responsibleUserId).not.toBe(creatorUserId);
  });

  it("fails automated issue dispatch instead of falling back to the issue creator when no default exists", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Creator-only",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Creator-only issue",
      status: "todo",
      assigneeAgentId: agentId,
      createdByUserId: `creator-${randomUUID()}`,
    });

    await expect(heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_commented",
      payload: { issueId, commentId: randomUUID() },
      requestedByActorType: "user",
      requestedByActorId: `commenter-${randomUUID()}`,
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_commented" },
    })).rejects.toMatchObject({
      status: 422,
      details: { code: "responsible_user_unresolved" },
    });

    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)));
    expect(runs).toHaveLength(0);
  });

  it("fails dispatch before creating a run when no responsible user can be resolved", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Ownerless",
      issuePrefix: `O${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true } },
      permissions: {},
    });

    await expect(heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      requestedByActorType: "system",
    })).rejects.toMatchObject({
      status: 422,
      details: { code: "responsible_user_unresolved" },
    });

    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)));
    expect(runs).toHaveLength(0);
  });
});
