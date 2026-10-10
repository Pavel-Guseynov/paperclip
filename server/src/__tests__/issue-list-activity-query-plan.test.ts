import { randomUUID } from "node:crypto";
import { activityLog, agents, companies, createDb, issues } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { issueLatestLogAtExpr } from "../services/issues.js";
import { explainPlan, seedCompanyWithAgent } from "./helpers/query-plan.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("issue list last-activity sort key", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-list-plan-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedActivity(companyId: string, agentId: string) {
    const issueRows = await db
      .insert(issues)
      .values(Array.from({ length: 400 }, (_, index) => ({
        companyId, title: `Issue ${index}`, status: "in_progress", priority: "medium",
      })))
      .returning({ id: issues.id });
    const rows = issueRows.flatMap((issue) =>
      Array.from({ length: 80 }, (_, index) => ({
        companyId,
        actorType: "agent",
        actorId: agentId,
        action: index % 10 === 0 ? "issue.read_marked" : "issue.updated",
        entityType: "issue",
        entityId: issue.id,
        agentId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
    );
    for (let offset = 0; offset < rows.length; offset += 1000) {
      await db.insert(activityLog).values(rows.slice(offset, offset + 1000));
    }
    await db.execute(sql`analyze activity_log`);
    return issueRows;
  }

  it("reads the newest qualifying activity of each issue with one backward index probe", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    await seedActivity(companyId, agentId);

    const indexes = await db.execute(sql`select indexname from pg_indexes where tablename = 'activity_log'`);
    expect((indexes as unknown as Array<{ indexname: string }>).map((row) => row.indexname)).toContain(
      "activity_log_company_entity_created_idx",
    );

    const plan = await explainPlan(db, sql`select ${issueLatestLogAtExpr(companyId)} from ${issues}`);

    expect(plan).toMatch(/Index Scan Backward using activity_log_company_entity_created_idx/);
    expect(plan).not.toMatch(/Seq Scan on activity_log/);
    expect(plan).not.toMatch(/Aggregate/);
  });

  it("still returns the newest activity that is not inbox bookkeeping", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const [issue] = await seedActivity(companyId, agentId).then((rows) => rows.slice(0, 1));

    const rows = await db.execute(
      sql`select ${issueLatestLogAtExpr(companyId)} as latest from ${issues} where ${issues.id} = ${issue!.id}`,
    );

    // Index 79 is the newest row and not a multiple of 10, so it is not bookkeeping.
    expect(new Date((rows as unknown as Array<{ latest: string | Date }>)[0]!.latest).toISOString()).toBe(
      "2026-01-01T00:01:19.000Z",
    );
  });
});
