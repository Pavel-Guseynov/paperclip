import { randomUUID } from "node:crypto";
import { activityLog, agents, companies, createDb, heartbeatRunEvents, heartbeatRuns } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runsOfIssueCondition } from "../services/activity.js";
import { explainPlan, seedCompanyWithAgent, seedManyRuns } from "./helpers/query-plan.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("runs of an issue", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-runs-plan-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  const selectRunIds = async (companyId: string, issueId: string) =>
    (await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(runsOfIssueCondition(companyId, issueId)))
      .map((row) => row.id)
      .sort();

  async function logIssueActivity(companyId: string, agentId: string, issueId: string, runId: string) {
    await db.insert(activityLog).values({
      companyId,
      actorType: "agent",
      actorId: agentId,
      action: "issue.updated",
      entityType: "issue",
      entityId: issueId,
      agentId,
      runId,
    });
  }

  it("returns runs whose context names the issue and runs that logged activity on it, and no others", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    const otherIssueId = randomUUID();
    const [byContext, byActivity, other, another] = await db.insert(heartbeatRuns).values([
      { companyId, agentId, status: "succeeded", contextSnapshot: { issueId } },
      { companyId, agentId, status: "succeeded", contextSnapshot: null },
      { companyId, agentId, status: "succeeded", contextSnapshot: { issueId: otherIssueId } },
      { companyId, agentId, status: "succeeded", contextSnapshot: { issueId: otherIssueId } },
    ]).returning();
    await logIssueActivity(companyId, agentId, issueId, byActivity!.id);
    await logIssueActivity(companyId, agentId, otherIssueId, other!.id);
    // A run that both names the issue and logged activity on it appears once.
    await logIssueActivity(companyId, agentId, issueId, byContext!.id);
    // Activity recorded for a non-issue entity with the same id does not count.
    await db.insert(activityLog).values({
      companyId, actorType: "agent", actorId: agentId, action: "x", entityType: "project",
      entityId: issueId, agentId, runId: another!.id,
    });

    expect(await selectRunIds(companyId, issueId)).toEqual([byContext!.id, byActivity!.id].sort());
    expect(await selectRunIds(randomUUID(), issueId)).toEqual([]);
  });

  it("finds an issue's runs through the context and activity indexes, not a scan of the company's runs", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    const runs = await seedManyRuns(db, companyId, agentId, issueId);
    await db.insert(activityLog).values(
      runs.slice(0, 2000).map((run, index) => ({
        companyId,
        actorType: "agent",
        actorId: agentId,
        action: "issue.updated",
        entityType: "issue",
        entityId: index === 0 ? issueId : randomUUID(),
        agentId,
        runId: run.id,
      })),
    );
    await db.execute(sql`analyze activity_log`);

    const plan = await explainPlan(
      db,
      sql`select id from ${heartbeatRuns} where ${runsOfIssueCondition(companyId, issueId)}`,
    );

    expect(plan).not.toMatch(/Seq Scan on heartbeat_runs/);
    expect(plan).not.toMatch(/Seq Scan on activity_log/);
  });
});
