import { randomUUID } from "node:crypto";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueRecoveryActions,
  issues,
} from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { settleUnrecoverableExecutions } from "../services/execution-recovery-resolution.js";
import { LEGACY_RECOVERY_CAUSE, terminalizeLegacyExecution } from "../services/legacy-execution-recovery.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("legacy execution recovery action", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-legacy-recovery-loop-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueRecoveryActions);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedStoppedConversationRun() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
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
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Conversation task",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    const [run] = await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "interrupted",
      runtimeMode: "legacy",
      errorCode: "process_lost",
      finishedAt: new Date(),
      contextSnapshot: { issueId },
      runnerProfileJson: { adapterDispatch: { adapterType: "claude_local" } },
    }).returning();
    return { companyId, issueId, run: run! };
  }

  const holdsFor = (companyId: string, issueId: string) =>
    db.select().from(issueRecoveryActions).where(and(
      eq(issueRecoveryActions.companyId, companyId),
      eq(issueRecoveryActions.sourceIssueId, issueId),
      eq(issueRecoveryActions.cause, LEGACY_RECOVERY_CAUSE),
    ));

  it("keeps one disposition for a stopped conversation run however often recovery revisits it", async () => {
    const { companyId, issueId, run } = await seedStoppedConversationRun();

    // Each tick is what retry scheduling does to a terminal predecessor, followed by the
    // settle sweep that folds a conversation hold. Before the fix every tick made a new row.
    for (let tick = 0; tick < 6; tick += 1) {
      const [current] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
      await terminalizeLegacyExecution({ db, run: current!, status: current!.status });
      await settleUnrecoverableExecutions(db);
    }

    const holds = await holdsFor(companyId, issueId);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      status: "resolved",
      outcome: "cancelled",
      fingerprint: `legacy-execution:${run.id}`,
    });
  });

  it("still opens a hold for a different run of the same issue", async () => {
    const { companyId, issueId, run } = await seedStoppedConversationRun();
    await terminalizeLegacyExecution({ db, run, status: run.status });
    await settleUnrecoverableExecutions(db);
    const [next] = await db.insert(heartbeatRuns).values({
      companyId,
      agentId: run.agentId,
      status: "interrupted",
      runtimeMode: "legacy",
      errorCode: "process_lost",
      finishedAt: new Date(),
      contextSnapshot: { issueId },
      runnerProfileJson: { adapterDispatch: { adapterType: "claude_local" } },
    }).returning();

    await terminalizeLegacyExecution({ db, run: next!, status: next!.status });

    const holds = await holdsFor(companyId, issueId);
    expect(holds.map((hold) => hold.fingerprint).sort()).toEqual(
      [`legacy-execution:${run.id}`, `legacy-execution:${next!.id}`].sort(),
    );
  });
});
