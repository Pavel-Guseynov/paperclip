import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  type Db,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { transitionHeartbeatRunStatus } from "../services/heartbeat-run-lifecycle.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("heartbeat run lifecycle events", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const capturedRunRecords: any[] = [];
  let restoreStderr: (() => void) | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-lifecycle-");
    db = createDb(tempDb.connectionString);

    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any, ...args: any[]) => {
      const str = typeof chunk === "string" ? chunk : chunk?.toString?.("utf8") ?? "";
      for (const line of str.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.action === "heartbeat_run_lifecycle") {
              capturedRunRecords.push(parsed);
            }
          } catch {}
        }
      }
      return originalWrite(chunk, ...args as any);
    }) as any;
    restoreStderr = () => {
      process.stderr.write = originalWrite;
    };
  }, 30_000);

  afterAll(async () => {
    restoreStderr?.();
    await tempDb?.cleanup();
  });

  afterEach(async () => {
    capturedRunRecords.length = 0;
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  async function createCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme Run Corp",
      issuePrefix: "RC",
      defaultResponsibleUserId: randomUUID(),
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Agent Runner",
      role: "engineer",
      adapterType: "codex_local",
    });
    return { companyId, agentId };
  }

  it("transitions through queued, running, suppression release to queued, running, scheduled_retry, and terminal outcomes with unique microsecond eventIds", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();
    const runId = randomUUID();

    // 1. Initial run insert (queued)
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "queued",
    });

    // 2. Claim / running
    const claimed = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "running",
      patch: { startedAt: new Date() },
    });
    expect(claimed?.status).toBe("running");

    // 3. Suppression release back to queued
    const released = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "queued",
      patch: { startedAt: null },
    });
    expect(released?.status).toBe("queued");

    // 4. Running again
    const claimedAgain = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "running",
      patch: { startedAt: new Date() },
    });
    expect(claimedAgain?.status).toBe("running");

    // 5. scheduled_retry
    const scheduled = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "scheduled_retry",
      patch: {
        scheduledRetryAt: new Date(),
        scheduledRetryAttempt: 1,
        scheduledRetryReason: "process_timeout",
      },
    });
    expect(scheduled?.status).toBe("scheduled_retry");

    // 6. Terminal status (succeeded)
    const terminal = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "succeeded",
      patch: { finishedAt: new Date() },
    });
    expect(terminal?.status).toBe("succeeded");

    // Check captured lifecycle events
    const runEvents = capturedRunRecords.filter((r) => r.attributes?.runId === runId);
    expect(runEvents.length).toBeGreaterThanOrEqual(5);

    // Each transition must have a unique eventId
    const eventIds = runEvents.map((r) => r.attributes.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    for (const eventId of eventIds) {
      expect(eventId).toMatch(new RegExp(`^run:${runId}:\\d+:[a-z_]+$`));
    }

    // Succeeded event
    const succeededEvent = runEvents.find((r) => r.attributes.status === "succeeded");
    expect(succeededEvent).toBeDefined();
    expect(succeededEvent?.attributes.phase).toBe("finished");
    expect(succeededEvent?.attributes.outcome).toBe("succeeded");
  });

  it("handles idempotent same-status writes without emitting duplicate records", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
    });
    capturedRunRecords.length = 0;

    // Call transition to same status "running"
    const sameStatus = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "running",
      patch: { lastOutputAt: new Date() },
    });
    expect(sameStatus?.status).toBe("running");

    const emitted = capturedRunRecords.filter((r) => r.attributes?.runId === runId);
    expect(emitted).toHaveLength(0);
  });

  it("records cancellationOrigin: legacy_controller_lease_expired and actor: controller_lease_watchdog on lease expiration abort", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
    });
    capturedRunRecords.length = 0;

    // Simulate controller abort with lease lost error
    const cancelled = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "cancelled",
      cancellationAttribution: {
        cancellationOrigin: "legacy_controller_lease_expired",
        cancellationActor: { actorType: "system", actorId: "controller_lease_watchdog" },
        triggerDetail: "Controller lease expired during event loop freeze",
      },
    });

    expect(cancelled?.status).toBe("cancelled");
    const event = capturedRunRecords.find((r) => r.attributes?.runId === runId && r.attributes?.status === "cancelled");
    expect(event).toBeDefined();
    expect(event.attributes.cancellationOrigin).toBe("legacy_controller_lease_expired");
    expect(event.attributes.cancellationActor).toEqual({
      actorType: "system",
      actorId: "controller_lease_watchdog",
    });
    expect(event.attributes.phase).toBe("finished");
    expect(event.attributes.outcome).toBe("cancelled");
  });

  it("records unattributed cancellations with cancellationOrigin: unattributed_abort and cancellationActor: null", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
    });
    capturedRunRecords.length = 0;

    const cancelled = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "cancelled",
      cancellationAttribution: {
        cancellationOrigin: "unattributed_abort",
        cancellationActor: null,
        triggerDetail: "Unknown abort signal received",
      },
    });

    expect(cancelled?.status).toBe("cancelled");
    const event = capturedRunRecords.find((r) => r.attributes?.runId === runId && r.attributes?.status === "cancelled");
    expect(event).toBeDefined();
    expect(event.attributes.cancellationOrigin).toBe("unattributed_abort");
    expect(event.attributes.cancellationActor).toBeNull();
  });

  it("does not emit lifecycle records on rollback, and the next committed transition gets a unique eventId", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "queued",
    });
    capturedRunRecords.length = 0;

    await expect(
      db.transaction(async (tx) => {
        await transitionHeartbeatRunStatus(tx, runId, {
          toStatus: "running",
        });
        throw new Error("Simulated run rollback");
      }),
    ).rejects.toThrow("Simulated run rollback");

    // Rolled back - 0 records emitted
    expect(capturedRunRecords).toHaveLength(0);

    const snapshot = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r) => r[0]);
    expect(snapshot.status).toBe("queued");

    // Now perform committed transition
    const committed = await transitionHeartbeatRunStatus(db, runId, {
      toStatus: "running",
    });
    expect(committed?.status).toBe("running");

    expect(capturedRunRecords).toHaveLength(1);
    expect(capturedRunRecords[0].attributes.eventId).toMatch(new RegExp(`^run:${runId}:\\d+:running$`));
  });

  it("defers lifecycle records into options.postCommitRecords when provided on a transaction without post-commit hooks", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "queued",
    });
    capturedRunRecords.length = 0;

    const deferredRecords: any[] = [];

    await db.transaction(async (tx) => {
      const POST_COMMIT_HOOKS = Symbol.for("paperclip.db.postCommitHooks");
      const txWithoutHooks = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === POST_COMMIT_HOOKS) return undefined;
          return Reflect.get(target, prop, receiver);
        },
      });

      const updated = await transitionHeartbeatRunStatus(txWithoutHooks as any, runId, {
        toStatus: "running",
        patch: { startedAt: new Date() },
        postCommitRecords: deferredRecords,
      });

      expect(updated?.status).toBe("running");
    });

    expect(deferredRecords).toHaveLength(1);
    expect(deferredRecords[0].attributes.eventId).toMatch(new RegExp(`^run:${runId}:\\d+:running$`));
    expect(deferredRecords[0].attributes.status).toBe("running");
    expect(capturedRunRecords).toHaveLength(0);
  });

  it("fails loudly when a transaction lacks post-commit hooks and options.postCommitRecords is not provided", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "queued",
    });
    capturedRunRecords.length = 0;

    await expect(
      db.transaction(async (tx) => {
        const POST_COMMIT_HOOKS = Symbol.for("paperclip.db.postCommitHooks");
        const txWithoutHooks = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === POST_COMMIT_HOOKS) return undefined;
            return Reflect.get(target, prop, receiver);
          },
        });

        await transitionHeartbeatRunStatus(txWithoutHooks as any, runId, {
          toStatus: "running",
          patch: { startedAt: new Date() },
        });
      }),
    ).rejects.toThrow("missing_post_commit_hooks");

    expect(capturedRunRecords).toHaveLength(0);

    const snapshot = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r) => r[0]);
    expect(snapshot.status).toBe("queued");
  });
});
