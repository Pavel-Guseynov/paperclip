import { randomUUID } from "node:crypto";
import { agents, companies, createDb, heartbeatRunEvents, heartbeatRuns } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runsOfIssueFilter } from "../services/run-secret-redaction.js";
import { explainPlan, seedCompanyWithAgent, seedManyRuns } from "./helpers/query-plan.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("issue response redaction query plan", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-redaction-plan-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("finds an issue's runs through the context indexes, not a read of every run's context", async () => {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    await seedManyRuns(db, companyId, agentId, issueId);

    const plan = await explainPlan(
      db,
      sql`select id from ${heartbeatRuns} where ${runsOfIssueFilter(companyId, issueId)}`,
    );

    expect(plan).not.toMatch(/Seq Scan/);
    expect(plan).toMatch(/heartbeat_runs_company_ctx_issue_created_idx/);
    expect(plan).toMatch(/heartbeat_runs_company_ctx_paperclip_issue_idx/);
  });
});
