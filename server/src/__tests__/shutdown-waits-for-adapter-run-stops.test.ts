import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drainRunExecutionFinalizersForShutdown,
  finalizeServerShutdown,
} from "../shutdown.js";
import { heartbeatService } from "../services/heartbeat.js";

function stubLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

describe("shutdown waits for adapter run stops", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an in-flight execution that needs longer than 5 s, but less than the deadline, to finish its stop settles before the database closes and before exit", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      let executionSettled = false;

      // In-flight execution needs 7 seconds (longer than the legacy 5s hardcode, but less than the 60s deadline)
      const inFlightExecution = new Promise<void>((resolve) => {
        setTimeout(() => {
          executionSettled = true;
          order.push("execution:settled");
          resolve();
        }, 7_000);
      });

      const drain = vi.fn(() => inFlightExecution);
      const log = stubLogger();

      // Default timeout without explicit timeoutMs (as index.ts invokes it by default)
      const drainPromise = drainRunExecutionFinalizersForShutdown({
        signal: "SIGTERM",
        drain,
        log,
      });

      // Advance past the legacy 5s mark
      await vi.advanceTimersByTimeAsync(6_000);

      // On base (5s hardcoded timeout): drainPromise already resolved to "timed_out"
      // On head (60s deadline): drainPromise is still waiting for the execution to finish
      // Advance to 7s so the execution completes
      await vi.advanceTimersByTimeAsync(1_000);

      const drainResult = await drainPromise;
      expect(drainResult).toBe("drained");
      expect(executionSettled).toBe(true);

      // Verify that finalizeServerShutdown closes the database after the execution settled
      await finalizeServerShutdown({
        signal: "SIGTERM",
        closeDatabase: async () => {
          order.push("database:close");
        },
        stopEmbeddedPostgres: null,
        shutdownInstrumentation: async () => {},
        shutdownSentry: async () => {},
        log,
      });

      expect(order).toEqual(["execution:settled", "database:close"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an execution that outlives the deadline produces the overrun failure record, and shutdown still completes", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const log = stubLogger();

      // Execution that outlives the deadline
      const unyieldingExecution = new Promise<void>(() => {});
      const drain = vi.fn(() => unyieldingExecution);

      const inFlightRunIds = ["run-antigravity-1234", "run-external-plugin-5678"];

      const drainPromise = drainRunExecutionFinalizersForShutdown({
        signal: "SIGTERM",
        drain,
        timeoutMs: 10_000,
        getActiveRunIds: () => inFlightRunIds,
        log,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const drainResult = await drainPromise;
      expect(drainResult).toBe("timed_out");

      // Verify overrun failure record: logged as an error naming the run ids still in flight
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: "SIGTERM",
          timeoutMs: 10_000,
          pendingRunIds: expect.arrayContaining(["run-antigravity-1234", "run-external-plugin-5678"]),
          pendingRunCount: 2,
        }),
        expect.stringContaining("timed out"),
      );

      // Verify shutdown still completes orderly
      await finalizeServerShutdown({
        signal: "SIGTERM",
        closeDatabase: async () => {
          order.push("database:close");
        },
        stopEmbeddedPostgres: null,
        shutdownInstrumentation: async () => {},
        shutdownSentry: async () => {},
        log,
      });

      expect(order).toEqual(["database:close"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no queued or deferred run is dispatched during the wait", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => [],
          }),
        }),
      }),
    } as any;
    const heartbeat = heartbeatService(mockDb);

    // Before shutdown drain, shutdown is not in progress
    expect(heartbeat.isShutdownInProgress?.()).toBe(false);

    // Invoke drainRunningRunsForShutdown to start graceful shutdown
    await heartbeat.drainRunningRunsForShutdown("SIGTERM");

    // On base: drainRunningRunsForShutdown did NOT set shutdownInProgress to true (isShutdownInProgress was undefined or false)
    // On head: shutdownInProgress is true
    expect(heartbeat.isShutdownInProgress?.()).toBe(true);

    // And startNextQueuedRunForAgent returns empty without dispatching any run
    const queuedResult = await heartbeat.startNextQueuedRunForAgent?.("agent-1");
    expect(queuedResult).toEqual([]);
  });
});
