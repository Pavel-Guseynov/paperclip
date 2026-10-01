import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.js";
import { CONVERSATION_CONTINUATION_POLICY } from "../services/conversation-continuation.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { heartbeatService } from "../services/heartbeat.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
const describePostgres = postgresSupport.supported ? describe : describe.skip;

const RESUMABLE_ADAPTER = "resumable_custom_adapter";
const UNDECLARED_ADAPTER = "undeclared_custom_adapter";

function customAdapter(type: string, supportsConversationContinuation?: boolean): ServerAdapterModule {
  return {
    type,
    ...(supportsConversationContinuation === undefined ? {} : { supportsConversationContinuation }),
    execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
    testEnvironment: async () => ({ adapterType: type, status: "pass", checks: [], testedAt: new Date().toISOString() }),
  };
}

describePostgres("declared adapter conversation continuation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-conversation-continuation-");
    db = createDb(database.connectionString);
  }, 20_000);

  afterEach(() => {
    unregisterServerAdapter(RESUMABLE_ADAPTER);
    unregisterServerAdapter(UNDECLARED_ADAPTER);
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  /** A legacy run whose adapter process was lost after adapter.invoke. */
  async function seedLostRun(adapterType: string) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Continuation",
      issuePrefix,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Custom adapter agent",
      role: "engineer",
      status: "idle",
      adapterType,
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      status: "claimed",
      runId,
      claimedAt: new Date(),
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      wakeupRequestId,
      contextSnapshot: { issueId },
      runnerProfileJson: { adapterDispatch: { adapterType } },
      nextEventSeq: 2,
      startedAt: new Date("2026-03-19T00:00:00.000Z"),
      updatedAt: new Date("2026-03-19T00:00:00.000Z"),
    });
    await db.insert(heartbeatRunEvents).values({
      companyId,
      agentId,
      runId,
      seq: 1,
      eventType: "adapter.invoke",
      payload: { adapterType },
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Continue the conversation",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
      executionRunId: runId,
      responsibleUserId: "responsible-user",
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });
    return { companyId, agentId, runId, issueId };
  }

  it("stamps a lost run of an adapter that declares continuation and continues it", async () => {
    registerServerAdapter(customAdapter(RESUMABLE_ADAPTER, true));
    const { companyId, agentId, runId, issueId } = await seedLostRun(RESUMABLE_ADAPTER);

    await heartbeatService(db).reapOrphanedRuns();

    const [source] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(source!.resultJson).toMatchObject({ conversationContinuation: CONVERSATION_CONTINUATION_POLICY });
    expect(await getExecutionBlocker(db, companyId, issueId)).toBeNull();
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
    expect(runs.filter((run) => run.retryOfRunId === runId)).toHaveLength(1);
  });

  it("does not stamp a lost run of an adapter that does not declare continuation", async () => {
    registerServerAdapter(customAdapter(UNDECLARED_ADAPTER));
    const { runId } = await seedLostRun(UNDECLARED_ADAPTER);

    await heartbeatService(db).reapOrphanedRuns();

    const [source] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(source!.resultJson?.conversationContinuation).toBeUndefined();
  });
});
