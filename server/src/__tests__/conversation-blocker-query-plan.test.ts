import { randomUUID } from "node:crypto";
import {
  agents,
  companies,
  createDb,
  issues,
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
import { EXECUTION_RECONCILIATION_CAUSES } from "@paperclipai/shared";
import { executionBlockerPredicate } from "../services/execution-blocker.js";
import { explainPlan, seedCompanyWithAgent, seedManyRuns } from "./helpers/query-plan.js";
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
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("finds an issue's terminal runs through the issue indexes, not a scan of the company's runs", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    await seedManyRuns(db, companyId, agentId, issueId);

    const plan = await explainPlan(db, 
      sql`select * from ${heartbeatRuns} where ${conversationOwnershipRunFilter(companyId, issueId)}`,
    );

    expect(plan).not.toMatch(/Seq Scan/);
    expect(plan).toMatch(/heartbeat_runs_company_native_issue_id_uq|heartbeat_runs_company_ctx_issue_created_idx/);
    expect(plan).not.toMatch(/heartbeat_runs_company_status_process_started_idx/);
  });

  it("checks the conversation predicate for given run ids without scanning run events", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const runs = await seedManyRuns(db, companyId, agentId, randomUUID());
    const ids = runs.slice(0, 3).map((run) => run.id);

    const plan = await explainPlan(db, 
      sql`select id from ${heartbeatRuns} where ${inArray(heartbeatRuns.id, ids)} and ${conversationRunPredicate()}`,
    );

    expect(plan).not.toMatch(/Seq Scan on heartbeat_run_events/);
    expect(plan).not.toMatch(/hashed SubPlan/);
    expect(plan).toMatch(/heartbeat_run_events_company_run_idx|heartbeat_run_events_run_seq_uq/);
  });

  it.each([
    { evidence: "claimed conversation adapter", matches: true },
    { evidence: "continuation policy", matches: true },
    { evidence: "matching invocation", matches: true },
    { evidence: "no evidence", matches: false },
    { evidence: "another run's invocation", matches: false },
    { evidence: "another company's invocation", matches: false },
    { evidence: "another event type", matches: false },
    { evidence: "process invocation", matches: false },
    { evidence: "missing adapter type", matches: false },
  ])("classifies a run from $evidence", async ({ evidence, matches }) => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const runId = randomUUID();
    const otherRunId = randomUUID();
    await db.insert(heartbeatRuns).values([
      {
        id: runId, companyId, agentId, status: "failed",
        runnerProfileJson: evidence === "claimed conversation adapter"
          ? { adapterDispatch: { adapterType: "codex_local" } } : null,
        resultJson: evidence === "continuation policy"
          ? { conversationContinuation: "continue_conversation_v1" } : null,
      },
      { id: otherRunId, companyId, agentId, status: "failed" },
    ]);
    if (!["claimed conversation adapter", "continuation policy", "no evidence"].includes(evidence)) {
      const owner = evidence === "another company's invocation"
        ? await seedCompanyWithAgent(db) : { companyId, agentId };
      await db.insert(heartbeatRunEvents).values({
        ...owner,
        runId: evidence === "another run's invocation" ? otherRunId : runId,
        seq: 1,
        eventType: evidence === "another event type" ? "log" : "adapter.invoke",
        payload: evidence === "missing adapter type" ? {} : {
          adapterType: evidence === "process invocation" ? "process" : "codex_local",
        },
      });
    }
    const selected = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .where(sql`${heartbeatRuns.id} = ${runId} and ${conversationRunPredicate()}`);
    expect(selected).toEqual(matches ? [{ id: runId }] : []);
  });

  it("evaluates the conversation recovery hold without scanning heartbeat runs per recovery action", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    await seedManyRuns(db, companyId, agentId, issueId);

    const plan = await explainPlan(db, 
      sql`select * from ${issueRecoveryActions}
        where ${issueRecoveryActions.companyId} = ${companyId}
          and ${issueRecoveryActions.sourceIssueId} = ${issueId}
          and ${executionBlockerPredicate()}`,
    );

    expect(plan).not.toMatch(/Seq Scan on heartbeat_runs/);
  });


  it("reads an issue's open or replay-blocked recovery records through the partial index, not its whole history", async () => {
    const { companyId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Stranded", status: "in_progress", priority: "medium" });
    const base = {
      companyId,
      sourceIssueId: issueId,
      kind: "active_run_watchdog",
      cause: EXECUTION_RECONCILIATION_CAUSES[0],
      nextAction: "Review",
      evidence: { filler: "x".repeat(600) },
    };
    for (let offset = 0; offset < 800; offset += 200) {
      await db.insert(issueRecoveryActions).values(
        Array.from({ length: 200 }, (_, index) => ({
          ...base,
          status: "resolved",
          fingerprint: "resolved-" + (offset + index),
        })),
      );
    }
    await db.insert(issueRecoveryActions).values({ ...base, status: "active", fingerprint: "open" });
    await db.execute(sql`analyze issue_recovery_actions`);

    const plan = await explainPlan(db, 
      sql`select * from ${issueRecoveryActions}
        where ${issueRecoveryActions.companyId} = ${companyId}
          and ${issueRecoveryActions.sourceIssueId} = ${issueId}
          and ${executionBlockerPredicate()}
        order by ${issueRecoveryActions.updatedAt} desc, ${issueRecoveryActions.id} desc
        limit 1`,
    );

    // The index holds only open or replay-blocked records, so the scan reads a handful of
    // rows however long the resolved history is (801 rows here).
    expect(plan).not.toMatch(/Seq Scan on issue_recovery_actions\b/);
    const indexScan = /Index Scan using issue_recovery_actions_blocker_lookup_idx[^\n]*rows=(\d+)/.exec(plan);
    expect(indexScan).not.toBeNull();
    expect(Number(indexScan![1])).toBeLessThan(50);
  });

  it("still blocks on a terminal conversation run recorded by native issue id or by context snapshot", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
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
