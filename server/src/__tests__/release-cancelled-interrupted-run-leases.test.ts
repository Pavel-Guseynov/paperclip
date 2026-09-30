import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  environmentLeases,
  environments,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  type Db,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => mockTelemetryClient }));

const mockTerminateLocalService = vi.hoisted(() => vi.fn());
vi.mock("../services/local-service-supervisor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/local-service-supervisor.js")>();
  return {
    ...actual,
    terminateLocalService: mockTerminateLocalService,
  };
});

import { heartbeatService } from "../services/heartbeat.js";
import { recoveryService } from "../services/recovery/service.js";
import { validateExecutionReconciliation } from "../services/execution-recovery-resolution.js";
import { getConversationOwnershipBlocker } from "../services/conversation-continuation.js";
import { runningProcesses } from "../adapters/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres release-cancelled-interrupted-run-leases tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("release-cancelled-interrupted-run-leases", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-release-leases-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(() => {
    mockTerminateLocalService.mockReset();
    mockTerminateLocalService.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    runningProcesses.clear();
    await db.delete(environmentLeases);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(environments);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture(opts?: {
    agentAdapterType?: string;
    runtimeMode?: "legacy" | "native";
    runStatus?: string;
    processPid?: number | null;
    processGroupId?: number | null;
    issueStatus?: string;
    leaseStatus?: string;
    leaseProvider?: string;
    leaseUpdatedAt?: Date;
  }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const leaseId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Test Agent",
      role: "engineer",
      status: "active",
      adapterType: opts?.agentAdapterType ?? "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const [existingLocal] = await db
      .select()
      .from(environments)
      .where(eq(environments.driver, "local"));
    let environmentId = existingLocal?.id;
    if (!environmentId) {
      environmentId = randomUUID();
      await db.insert(environments).values({
        id: environmentId,
        companyId,
        name: `Local Environment ${environmentId.slice(0, 8)}`,
        driver: "local",
        status: "active",
        config: { provider: opts?.leaseProvider ?? "local" },
      });
    }

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: opts?.runStatus ?? "running",
      runtimeMode: opts?.runtimeMode ?? "legacy",
      invocationSource: "manual",
      startedAt: new Date(),
      processPid: opts?.processPid ?? null,
      processGroupId: opts?.processGroupId ?? null,
      contextSnapshot: { issueId },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Task",
      status: opts?.issueStatus ?? "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      executionRunId: runId,
    });

    const now = opts?.leaseUpdatedAt ?? new Date();
    await db.insert(environmentLeases).values({
      id: leaseId,
      companyId,
      environmentId,
      heartbeatRunId: runId,
      status: opts?.leaseStatus ?? "active",
      leasePolicy: "ephemeral",
      provider: opts?.leaseProvider ?? "local",
      acquiredAt: now,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { companyId, agentId, issueId, environmentId, runId, leaseId };
  }

  it("a legacy run cancelled while its execution runs in this process releases its lease, reproducing run 5661c208's path", async () => {
    const fixture = await seedFixture({
      agentAdapterType: "claude_local",
      runtimeMode: "legacy",
      runStatus: "running",
      leaseStatus: "active",
      leaseProvider: "local",
    });

    // Simulate in-process execution registered in runningProcesses
    runningProcesses.set(fixture.runId, {
      child: { pid: 98765 } as ChildProcess,
      graceSec: 5,
      processGroupId: null,
    });

    const heartbeat = heartbeatService(db);
    const cancelled = await heartbeat.cancelRun(
      fixture.runId,
      "Cancelled before issue reassignment",
      { errorCode: "issue_reassigned" },
    );

    expect(cancelled?.status).toBe("cancelled");

    // The lease must be released
    const [lease] = await db
      .select()
      .from(environmentLeases)
      .where(eq(environmentLeases.id, fixture.leaseId));

    expect(lease.status).toMatch(/released|expired/);
    expect(lease.releasedAt).toBeInstanceOf(Date);

    // After release, getConversationOwnershipBlocker clears
    const blocker = await getConversationOwnershipBlocker(
      db,
      fixture.companyId,
      fixture.issueId,
    );
    expect(blocker).toBeNull();

    // After release, validateExecutionReconciliation accepts the run
    await expect(
      validateExecutionReconciliation({
        db,
        companyId: fixture.companyId,
        issueId: fixture.issueId,
        agentId: fixture.agentId,
        sourceRunId: fixture.runId,
        decision: {
          runId: fixture.runId,
          providerStopped: true,
          actionOutcome: "not_performed",
          outcomeEvidence: "Inspected process and verified stopped.",
        },
      }),
    ).resolves.toMatchObject({ id: fixture.runId });
  });

  it("a run cancelled with no in-process execution releases its lease", async () => {
    const fixture = await seedFixture({
      agentAdapterType: "claude_local",
      runtimeMode: "legacy",
      runStatus: "running",
      leaseStatus: "active",
      leaseProvider: "local",
    });

    // Explicitly ensure no in-process execution is registered
    expect(runningProcesses.has(fixture.runId)).toBe(false);

    const heartbeat = heartbeatService(db);
    const cancelled = await heartbeat.cancelRun(
      fixture.runId,
      "Cancelled by control plane",
      { errorCode: "cancelled" },
    );

    expect(cancelled?.status).toBe("cancelled");

    // The lease must be released
    const [lease] = await db
      .select()
      .from(environmentLeases)
      .where(eq(environmentLeases.id, fixture.leaseId));

    expect(lease.status).toMatch(/released|expired/);
    expect(lease.releasedAt).toBeInstanceOf(Date);

    // After release, getConversationOwnershipBlocker clears
    const blocker = await getConversationOwnershipBlocker(
      db,
      fixture.companyId,
      fixture.issueId,
    );
    expect(blocker).toBeNull();

    // After release, validateExecutionReconciliation accepts the run
    await expect(
      validateExecutionReconciliation({
        db,
        companyId: fixture.companyId,
        issueId: fixture.issueId,
        agentId: fixture.agentId,
        sourceRunId: fixture.runId,
        decision: {
          runId: fixture.runId,
          providerStopped: true,
          actionOutcome: "not_performed",
          outcomeEvidence: "Inspected process and verified stopped.",
        },
      }),
    ).resolves.toMatchObject({ id: fixture.runId });
  });

  it("a run terminalized by the stale-lock sweep's backstop after its owning server process died releases its lease", async () => {
    const deadPid = 99999999;
    const fixture = await seedFixture({
      agentAdapterType: "antigravity_local",
      runtimeMode: "legacy",
      runStatus: "running",
      processPid: deadPid,
      leaseStatus: "active",
      leaseProvider: "local",
    });

    expect(runningProcesses.has(fixture.runId)).toBe(false);

    const recovery = recoveryService(db, { enqueueWakeup: vi.fn() });
    const sweepResult = await recovery.sweepStaleIssueLocks();

    expect(sweepResult.cleared).toBeGreaterThanOrEqual(1);

    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, fixture.runId));
    expect(run?.status).toBe("interrupted");

    // The lease must be released
    const [lease] = await db
      .select()
      .from(environmentLeases)
      .where(eq(environmentLeases.id, fixture.leaseId));

    expect(lease.status).toMatch(/released|expired/);
    expect(lease.releasedAt).toBeInstanceOf(Date);

    // After release, getConversationOwnershipBlocker clears
    const blocker = await getConversationOwnershipBlocker(
      db,
      fixture.companyId,
      fixture.issueId,
    );
    expect(blocker).toBeNull();

    // After release, validateExecutionReconciliation accepts the run
    await expect(
      validateExecutionReconciliation({
        db,
        companyId: fixture.companyId,
        issueId: fixture.issueId,
        agentId: fixture.agentId,
        sourceRunId: fixture.runId,
        decision: {
          runId: fixture.runId,
          providerStopped: true,
          actionOutcome: "not_performed",
          outcomeEvidence: "Server process crashed; run terminalized by sweep.",
        },
      }),
    ).resolves.toMatchObject({ id: fixture.runId });
  });

  it("a lease already stranded on a terminal run with no live process is released by the supported sweep", async () => {
    const oldDate = new Date(Date.now() - 600_000); // 10 minutes ago
    const fixture = await seedFixture({
      agentAdapterType: "claude_local",
      runtimeMode: "legacy",
      runStatus: "interrupted",
      processPid: null,
      processGroupId: null,
      leaseStatus: "active",
      leaseProvider: "local",
      leaseUpdatedAt: oldDate,
    });

    const heartbeat = heartbeatService(db);
    // Execute the sweep
    await heartbeat.sweepOrphanedActiveLeases({ backoffMs: 0 });

    const [lease] = await db
      .select()
      .from(environmentLeases)
      .where(eq(environmentLeases.id, fixture.leaseId));

    expect(lease.status).toMatch(/released|expired/);
    expect(lease.releasedAt).toBeInstanceOf(Date);

    // After release, getConversationOwnershipBlocker clears
    const blocker = await getConversationOwnershipBlocker(
      db,
      fixture.companyId,
      fixture.issueId,
    );
    expect(blocker).toBeNull();

    // After release, validateExecutionReconciliation accepts the run
    await expect(
      validateExecutionReconciliation({
        db,
        companyId: fixture.companyId,
        issueId: fixture.issueId,
        agentId: fixture.agentId,
        sourceRunId: fixture.runId,
        decision: {
          runId: fixture.runId,
          providerStopped: true,
          actionOutcome: "not_performed",
          outcomeEvidence: "Stranded lease recovered by sweep.",
        },
      }),
    ).resolves.toMatchObject({ id: fixture.runId });
  });

  it("a lease whose run's process is still alive is not released", async () => {
    const oldDate = new Date(Date.now() - 600_000);
    const fixture = await seedFixture({
      agentAdapterType: "claude_local",
      runtimeMode: "legacy",
      runStatus: "cancelled",
      processPid: process.pid, // current Node process is alive!
      leaseStatus: "active",
      leaseProvider: "local",
      leaseUpdatedAt: oldDate,
    });

    const heartbeat = heartbeatService(db);
    await heartbeat.sweepOrphanedActiveLeases({ backoffMs: 0 });

    const [lease] = await db
      .select()
      .from(environmentLeases)
      .where(eq(environmentLeases.id, fixture.leaseId));

    // Must NOT be released because the process is alive
    expect(lease.status).toBe("active");
    expect(lease.releasedAt).toBeNull();
  });
});
