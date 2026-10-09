import { randomUUID } from "node:crypto";
import {
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueRecoveryActions,
} from "@paperclipai/db";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  conversationOwnershipRunFilter,
  conversationRunPredicate,
  getConversationOwnershipBlocker,
} from "../services/conversation-continuation.js";
import { executionBlockerPredicate } from "../services/execution-blocker.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("execution blocker query plans", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-blocker-plans-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(issueRecoveryActions);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Coder",
      role: "engineer",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function explain(query: ReturnType<typeof sql>) {
    const rows = await db.execute(sql`explain ${query}`);
    return (rows as unknown as Array<Record<string, string>>).map((row) => row["QUERY PLAN"]).join("\n");
  }

  /** A realistic spread: many terminal legacy runs over many issues, some recording adapter.invoke events. */
  async function seedManyRuns(companyId: string, agentId: string, targetIssueId: string) {
    const runs = Array.from({ length: 3000 }, (_, index) => {
      const issueId = index === 0 ? targetIssueId : randomUUID();
      return {
        id: randomUUID(),
        companyId,
        agentId,
        status: "failed",
        runtimeMode: "legacy",
        ...(index % 2 === 0 ? { nativeIssueId: issueId } : {}),
        contextSnapshot: { issueId, filler: "x".repeat(400) },
      };
    });
    for (let offset = 0; offset < runs.length; offset += 500) {
      await db.insert(heartbeatRuns).values(runs.slice(offset, offset + 500));
    }
    await db.insert(heartbeatRunEvents).values(
      runs.slice(0, 600).map((run) => ({
        companyId,
        runId: run.id,
        agentId,
        seq: 1,
        eventType: "adapter.invoke",
        payload: { adapterType: "claude_local" },
      })),
    );
    await db.execute(sql`analyze heartbeat_runs`);
    await db.execute(sql`analyze heartbeat_run_events`);
    return runs;
  }

  it("finds an issue's terminal runs through the issue indexes, not a scan of the company's runs", async () => {
    const { companyId, agentId } = await seedCompany();
    const issueId = randomUUID();
    await seedManyRuns(companyId, agentId, issueId);

    const plan = await explain(
      sql`select * from ${heartbeatRuns} where ${conversationOwnershipRunFilter(companyId, issueId)}`,
    );

    expect(plan).not.toMatch(/Seq Scan/);
    expect(plan).toMatch(/heartbeat_runs_company_native_issue_id_uq|heartbeat_runs_company_ctx_issue_created_idx/);
    expect(plan).not.toMatch(/heartbeat_runs_company_status_process_started_idx/);
  });

  it("checks the conversation predicate for given run ids without scanning run events", async () => {
    const { companyId, agentId } = await seedCompany();
    const runs = await seedManyRuns(companyId, agentId, randomUUID());
    const ids = runs.slice(0, 3).map((run) => run.id);

    const plan = await explain(
      sql`select id from ${heartbeatRuns} where ${inArray(heartbeatRuns.id, ids)} and ${conversationRunPredicate()}`,
    );

    expect(plan).not.toMatch(/Seq Scan on heartbeat_run_events/);
    expect(plan).not.toMatch(/hashed SubPlan/);
  });

  it("evaluates the conversation recovery hold without scanning heartbeat runs per recovery action", async () => {
    const { companyId, agentId } = await seedCompany();
    const issueId = randomUUID();
    await seedManyRuns(companyId, agentId, issueId);

    const plan = await explain(
      sql`select * from ${issueRecoveryActions}
        where ${issueRecoveryActions.companyId} = ${companyId}
          and ${issueRecoveryActions.sourceIssueId} = ${issueId}
          and ${executionBlockerPredicate()}`,
    );

    expect(plan).not.toMatch(/Seq Scan on heartbeat_runs/);
  });

  it("still blocks on a terminal conversation run recorded by native issue id or by context snapshot", async () => {
    const { companyId, agentId } = await seedCompany();
    const nativeIssueId = randomUUID();
    const contextIssueId = randomUUID();
    const otherIssueId = randomUUID();
    const base = {
      companyId,
      agentId,
      status: "interrupted",
      runtimeMode: "legacy",
      processPid: process.pid,
      runnerProfileJson: { adapterDispatch: { adapterType: "claude_local" } },
    };
    const nativeRunId = randomUUID();
    const contextRunId = randomUUID();
    await db.insert(heartbeatRuns).values([
      { ...base, id: nativeRunId, nativeIssueId, contextSnapshot: { issueId: otherIssueId } },
      { ...base, id: contextRunId, contextSnapshot: { issueId: contextIssueId } },
    ]);

    await expect(getConversationOwnershipBlocker(db, companyId, nativeIssueId)).resolves.toMatchObject({ runId: nativeRunId });
    await expect(getConversationOwnershipBlocker(db, companyId, contextIssueId)).resolves.toMatchObject({ runId: contextRunId });
    // The native id wins over a stale context snapshot, as the old coalesce did.
    await expect(getConversationOwnershipBlocker(db, companyId, otherIssueId)).resolves.toBeNull();
    await expect(getConversationOwnershipBlocker(db, companyId, randomUUID())).resolves.toBeNull();
    await db.update(heartbeatRuns).set({ processPid: null }).where(eq(heartbeatRuns.id, nativeRunId));
    await expect(getConversationOwnershipBlocker(db, companyId, nativeIssueId)).resolves.toBeNull();
  });
});
