import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  environmentLeases,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

import { getConversationOwnershipBlocker } from "../services/conversation-continuation.js";
import { environmentRuntimeService } from "../services/environment-runtime.js";
import { environmentService } from "../services/environments.js";
import { heartbeatService } from "../services/heartbeat.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
const describePostgres = postgresSupport.supported ? describe : describe.skip;

// A PID that no process on the host uses, so the stale-lock sweep sees the
// run's process as gone.
const DEAD_PID = 2_147_483_000;

function spawnLiveProcess() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
}

describePostgres("leases of runs that end without an executor", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-release-run-leases-");
    db = createDb(database.connectionString);
  }, 20_000);

  afterAll(async () => {
    await database?.cleanup();
  });

  /** A running legacy run whose execution is not in this process. */
  async function seedRunWithLease(input: { processPid?: number } = {}) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const issuePrefix = `L${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Leases",
      issuePrefix,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Lease agent",
      role: "engineer",
      status: "running",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      runtimeMode: "legacy",
      processPid: input.processPid ?? null,
      contextSnapshot: { issueId },
      startedAt: new Date(),
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Leased work",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: runId,
      responsibleUserId: "responsible-user",
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });
    const environment = await environmentService(db).ensureLocalEnvironment(companyId);
    const { lease } = await environmentRuntimeService(db).acquireRunLease({
      companyId,
      environment,
      issueId,
      agentId,
      heartbeatRunId: runId,
      persistedExecutionWorkspace: null,
    });
    return { companyId, agentId, issueId, runId, leaseId: lease.id };
  }

  async function readLease(leaseId: string) {
    const [lease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, leaseId));
    return lease!;
  }

  it("releases the lease of a run cancelled by the control plane", async () => {
    const { companyId, issueId, runId, leaseId } = await seedRunWithLease();

    const cancelled = await heartbeatService(db).cancelRun(runId, "Cancelled by control plane");

    expect(cancelled?.status).toBe("cancelled");
    const lease = await readLease(leaseId);
    expect(lease.status).toBe("expired");
    expect(lease.releasedAt).toBeInstanceOf(Date);
    expect(await getConversationOwnershipBlocker(db, companyId, issueId)).toBeNull();
  });

  it("releases the lease of a run cancelled because its agent paused", async () => {
    const { companyId, agentId, issueId, runId, leaseId } = await seedRunWithLease();

    await heartbeatService(db).cancelActiveForAgent(agentId, "Cancelled due to agent pause");

    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run!.status).toBe("cancelled");
    expect((await readLease(leaseId)).status).toBe("expired");
    expect(await getConversationOwnershipBlocker(db, companyId, issueId)).toBeNull();
  });

  it("releases the lease of a run the stale-lock sweep interrupts after its process died", async () => {
    const { companyId, issueId, runId, leaseId } = await seedRunWithLease({ processPid: DEAD_PID });

    const sweep = await heartbeatService(db).sweepStaleIssueLocks();

    expect(sweep.terminalizedRunIds).toContain(runId);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run!.status).toBe("interrupted");
    expect((await readLease(leaseId)).status).toBe("released");
    expect(await getConversationOwnershipBlocker(db, companyId, issueId)).toBeNull();
  });

  it("keeps the lease of a cancelled run while its detached local process still runs", async () => {
    const child = spawnLiveProcess();
    try {
      const { runId, leaseId } = await seedRunWithLease({ processPid: child.pid });

      const cancelled = await heartbeatService(db).cancelRun(runId, "Cancelled by control plane");

      expect(cancelled?.status).toBe("cancelled");
      expect((await readLease(leaseId)).status).toBe("active");
    } finally {
      await stopProcess(child);
    }
  });

  it("recovers the lease of a terminal run in the orphaned-lease sweep only after its local process exits", async () => {
    const child = spawnLiveProcess();
    try {
      const { runId, leaseId } = await seedRunWithLease({ processPid: child.pid });
      const heartbeat = heartbeatService(db);
      await heartbeat.cancelRun(runId, "Cancelled by control plane");

      await heartbeat.sweepOrphanedActiveLeases({ backoffMs: 0 });
      expect((await readLease(leaseId)).status).toBe("active");

      await stopProcess(child);
      await heartbeat.sweepOrphanedActiveLeases({ backoffMs: 0 });
      expect((await readLease(leaseId)).status).toBe("pending_cleanup");
    } finally {
      await stopProcess(child);
    }
  });
});
