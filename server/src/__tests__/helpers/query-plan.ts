import { randomUUID } from "node:crypto";
import { agents, companies, heartbeatRunEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";

/** A company with one agent, enough to own heartbeat runs. */
export async function seedCompanyWithAgent(db: Db) {
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

/** The plan Postgres would use for `query`, as text. */
export async function explainPlan(db: Db, query: ReturnType<typeof sql>) {
  const rows = await db.execute(sql`explain ${query}`);
  return (rows as unknown as Array<Record<string, string>>).map((row) => row["QUERY PLAN"]).join("\n");
}

/**
 * A realistic spread for plan tests: 3000 terminal legacy runs over as many issues, each with a
 * wide context, and 600 of them with an adapter.invoke event. Even-numbered runs carry a native
 * issue id; every third run records its issue only under `paperclipIssue.id`. The first run
 * belongs to `targetIssueId`. Statistics are refreshed so the planner sees real row counts.
 */
export async function seedManyRuns(db: Db, companyId: string, agentId: string, targetIssueId: string) {
  const runs = Array.from({ length: 3000 }, (_, index) => {
    const issueId = index === 0 ? targetIssueId : randomUUID();
    return {
      id: randomUUID(),
      companyId,
      agentId,
      status: "failed",
      runtimeMode: "legacy",
      ...(index % 2 === 0 ? { nativeIssueId: issueId } : {}),
      contextSnapshot:
        index % 3 === 0
          ? { paperclipIssue: { id: issueId }, filler: "x".repeat(400) }
          : { issueId, filler: "x".repeat(400) },
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
