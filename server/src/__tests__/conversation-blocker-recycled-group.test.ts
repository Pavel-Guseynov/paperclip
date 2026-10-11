import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getConversationOwnershipBlocker } from "../services/conversation-continuation.js";
import { readProcessStartedAt } from "../services/hot-restart.js";
import { seedCompanyWithAgent } from "./helpers/query-plan.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

// A stopped run records its provider's PID and process group, which are the same number when the
// provider led its own group. After the host recycles that number, the group belongs to an
// unrelated process, usually a system daemon the server may not signal. PID 1 stands in for it:
// it always exists, leads its own group, and an unprivileged test user cannot signal it.
describeDatabase("conversation ownership blocker for a recycled process group", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-recycled-group-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function stoppedConversationRunRecordedAs(processStartedAt: Date) {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Reassigned", status: "todo", priority: "medium", assigneeAgentId: agentId,
    });
    const [run] = await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      status: "cancelled",
      runtimeMode: "legacy",
      processPid: 1,
      processGroupId: 1,
      processStartedAt,
      contextSnapshot: { issueId },
      runnerProfileJson: { adapterDispatch: { adapterType: "claude_local" } },
    }).returning();
    return { companyId, issueId, run: run! };
  }

  it("does not block when the group leader started at a different time than the recorded run", async () => {
    const { companyId, issueId } = await stoppedConversationRunRecordedAs(new Date("2001-01-01T00:00:00.000Z"));

    await expect(getConversationOwnershipBlocker(db, companyId, issueId)).resolves.toBeNull();
  });

  it("blocks while the group leader is the process the run recorded", async () => {
    const { companyId, issueId, run } = await stoppedConversationRunRecordedAs(new Date(await readProcessStartedAt(1)));

    await expect(getConversationOwnershipBlocker(db, companyId, issueId)).resolves.toMatchObject({
      runId: run.id,
      cause: "execution_owner_active",
    });
  });
});
