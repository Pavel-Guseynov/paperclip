import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.js";
import { loadConfig } from "../config.js";
import { heartbeatService } from "../services/heartbeat.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
const describePostgres = postgresSupport.supported ? describe : describe.skip;

describe("shutdown drain timeout config", () => {
  let configDir: string;
  let configPath: string;

  beforeAll(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-shutdown-config-"));
    configPath = path.join(configDir, "config.json");
  });

  beforeEach(() => {
    vi.stubEnv("PAPERCLIP_CONFIG", configPath);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(configPath, { force: true });
  });

  afterAll(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
  });

  async function writeConfigFile(server: Record<string, unknown>) {
    await fs.writeFile(configPath, JSON.stringify({
      $meta: { version: 1, updatedAt: "2026-10-01T00:00:00.000Z", source: "configure" },
      database: { mode: "embedded-postgres" },
      logging: { mode: "file" },
      server,
    }));
  }

  it("waits 60 seconds by default", () => {
    vi.stubEnv("PAPERCLIP_SHUTDOWN_DRAIN_TIMEOUT_MS", undefined);
    expect(loadConfig().shutdownDrainTimeoutMs).toBe(60_000);
  });

  it("reads a positive whole number of milliseconds from the environment", () => {
    vi.stubEnv("PAPERCLIP_SHUTDOWN_DRAIN_TIMEOUT_MS", " 120000 ");
    expect(loadConfig().shutdownDrainTimeoutMs).toBe(120_000);
  });

  it("uses the default for a zero, negative, fractional, too large, or non-numeric value", () => {
    for (const value of ["", "0", "-1", "1.5", "2147483648", "soon"]) {
      vi.stubEnv("PAPERCLIP_SHUTDOWN_DRAIN_TIMEOUT_MS", value);
      expect(loadConfig().shutdownDrainTimeoutMs).toBe(60_000);
    }
  });

  it("reads server.shutdownDrainTimeoutMs from the config file, and the environment wins over it", async () => {
    await writeConfigFile({ shutdownDrainTimeoutMs: 15_000 });
    vi.stubEnv("PAPERCLIP_SHUTDOWN_DRAIN_TIMEOUT_MS", undefined);
    expect(loadConfig().shutdownDrainTimeoutMs).toBe(15_000);

    vi.stubEnv("PAPERCLIP_SHUTDOWN_DRAIN_TIMEOUT_MS", "90000");
    expect(loadConfig().shutdownDrainTimeoutMs).toBe(90_000);
  });
});

const SHUTDOWN_TEST_ADAPTER = "shutdown_dispatch_test_adapter";

describePostgres("queued run dispatch during graceful shutdown", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let paperclipHome: string;
  const execute = vi.fn(async () => ({ exitCode: 0, signal: null, timedOut: false }));

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-shutdown-dispatch-");
    db = createDb(database.connectionString);
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-shutdown-dispatch-home-"));
    registerServerAdapter({
      type: SHUTDOWN_TEST_ADAPTER,
      execute,
      testEnvironment: async () => ({
        adapterType: SHUTDOWN_TEST_ADAPTER,
        status: "pass",
        checks: [],
        testedAt: new Date().toISOString(),
      }),
    });
  }, 20_000);

  afterEach(() => {
    vi.unstubAllEnvs();
    execute.mockClear();
  });

  afterAll(async () => {
    unregisterServerAdapter(SHUTDOWN_TEST_ADAPTER);
    await database?.cleanup();
    await fs.rm(paperclipHome, { recursive: true, force: true });
  });

  async function seedAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Shutdown",
      issuePrefix: `S${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Shutdown agent",
      role: "engineer",
      status: "idle",
      adapterType: SHUTDOWN_TEST_ADAPTER,
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });
    return agentId;
  }

  async function wakeAndSettle(heartbeat: ReturnType<typeof heartbeatService>, agentId: string) {
    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual",
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });
    await heartbeat.drainActiveRunExecutions();
    const [row] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    return row!;
  }

  it("starts a woken run while the server is running", async () => {
    const heartbeat = heartbeatService(db);
    const run = await wakeAndSettle(heartbeat, await seedAgent());

    expect(run.status).not.toBe("queued");
    expect(execute).toHaveBeenCalledOnce();
  });

  // Shutdown stops run starts for the whole process, so this test runs after
  // the test above.
  it("keeps a run woken through any heartbeat service queued after shutdown began", async () => {
    vi.stubEnv("PAPERCLIP_HOME", paperclipHome);
    const shuttingDown = heartbeatService(db);
    await shuttingDown.prepareHotRestartShutdown("SIGTERM");

    // Routes build their own heartbeat service instances.
    const routeInstanceRun = await wakeAndSettle(heartbeatService(db), await seedAgent());
    const sameInstanceRun = await wakeAndSettle(shuttingDown, await seedAgent());

    expect(routeInstanceRun.status).toBe("queued");
    expect(sameInstanceRun.status).toBe("queued");
    expect(execute).not.toHaveBeenCalled();
  });
});
