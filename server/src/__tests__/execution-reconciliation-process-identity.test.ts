import { randomUUID } from "node:crypto";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { validateExecutionReconciliation } from "../services/execution-recovery-resolution.js";
import { readProcessStartedAt } from "../services/hot-restart.js";
import { seedCompanyWithAgent } from "./helpers/query-plan.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

// The recorded process of a stopped run may hold a PID that the host has since recycled for an
// unrelated process, often one the server may not signal (EPERM). PID 1 stands in for that
// process: it always exists, and an unprivileged test user cannot signal it.
describeDatabase("reconciling a stopped run whose recorded PID was recycled", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-process-identity-");
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

  async function stoppedRunRecordedAs(processStartedAt: Date) {
    const { companyId, agentId } = await seedCompanyWithAgent(db);
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Reconcile", status: "todo", priority: "medium", assigneeAgentId: agentId,
    });
    const [run] = await db.insert(heartbeatRuns).values({
      companyId, agentId, status: "failed", runtimeMode: "legacy", errorCode: "execution_finalization_deadline_exceeded",
      finishedAt: new Date(), processPid: 1, processGroupId: 1, processStartedAt, contextSnapshot: { issueId },
    }).returning();
    return { companyId, agentId, issueId, run: run! };
  }

  const reconcile = (input: Awaited<ReturnType<typeof stoppedRunRecordedAs>>) =>
    validateExecutionReconciliation({
      db, companyId: input.companyId, issueId: input.issueId, agentId: input.agentId, sourceRunId: input.run.id,
      decision: {
        runId: input.run.id, providerStopped: true, actionOutcome: "completed",
        outcomeEvidence: "The provider was stopped and its recorded actions were checked.",
      },
    });

  it("accepts the reconciliation when the PID now belongs to a process that started at a different time", async () => {
    const input = await stoppedRunRecordedAs(new Date("2001-01-01T00:00:00.000Z"));

    await expect(reconcile(input)).resolves.toMatchObject({ id: input.run.id });
  });

  it("still refuses when the recorded start time is only a second off the process's real one", async () => {
    const input = await stoppedRunRecordedAs(new Date(new Date(await readProcessStartedAt(1)).getTime() + 1_000));

    await expect(reconcile(input)).rejects.toMatchObject({
      message: expect.stringMatching(/still running|ownership cannot be verified/),
    });
  });

  it("still refuses when the process holding the PID is the one the run recorded", async () => {
    const input = await stoppedRunRecordedAs(new Date(await readProcessStartedAt(1)));

    await expect(reconcile(input)).rejects.toMatchObject({
      message: expect.stringMatching(/still running|ownership cannot be verified/),
    });
  });
});
