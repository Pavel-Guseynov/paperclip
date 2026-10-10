import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  toolApplications,
  toolConnectionInstalls,
  toolConnections,
  toolMcpGateways,
  toolMcpGatewayTokens,
  toolProfileBindings,
  toolProfileEntries,
  toolProfiles,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { buildPaperclipRuntimeMcpServers } from "../services/heartbeat.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { toolAccessService } from "../services/tool-access.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
const describePostgres = postgresSupport.supported ? describe : describe.skip;

const HOUR_MS = 60 * 60 * 1_000;

describePostgres("heartbeat-run gateway token lifetime", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const originalApiUrl = process.env.PAPERCLIP_API_URL;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-run-gateway-token-");
    db = createDb(database.connectionString);
  }, 20_000);

  afterEach(() => {
    vi.useRealTimers();
    if (originalApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = originalApiUrl;
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  /** A running heartbeat run of an agent with one installed remote MCP connection. */
  async function seedRunningRun() {
    process.env.PAPERCLIP_API_URL = "https://paperclip.example.test";
    const [company] = await db.insert(companies).values({
      name: `Gateway ${randomUUID()}`,
      issuePrefix: `R${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    }).returning();
    const companyId = company!.id;
    const [agent] = await db.insert(agents).values({
      companyId,
      name: "Gateway agent",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
    }).returning();
    const [application] = await db.insert(toolApplications).values({
      companyId,
      applicationKey: `runtime-${randomUUID().slice(0, 8)}`,
      name: "Runtime MCP App",
      type: "mcp_http",
      status: "active",
    }).returning();
    const [connection] = await db.insert(toolConnections).values({
      companyId,
      applicationId: application!.id,
      name: "Installed MCP",
      uid: `test/${randomUUID()}`,
      transport: "mcp_remote",
      status: "active",
      enabled: true,
      config: { url: "https://installed.example.test/mcp" },
    }).returning();
    const [profile] = await db.insert(toolProfiles).values({
      companyId,
      profileKey: `app:${connection!.id}`,
      name: "Installed MCP",
      defaultAction: "deny",
    }).returning();
    await db.insert(toolProfileEntries).values({
      companyId,
      profileId: profile!.id,
      selectorType: "connection",
      effect: "include",
      applicationId: application!.id,
      connectionId: connection!.id,
    });
    await db.insert(toolProfileBindings).values({
      companyId,
      profileId: profile!.id,
      targetType: "agent",
      targetId: agent!.id,
    });
    await db.insert(toolConnectionInstalls).values({
      companyId,
      connectionId: connection!.id,
      targetType: "agent",
      targetId: agent!.id,
    });
    const [issue] = await db.insert(issues).values({
      companyId,
      title: "Long task",
      status: "in_progress",
      assigneeAgentId: agent!.id,
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId,
      agentId: agent!.id,
      invocationSource: "assignment",
      status: "running",
      contextSnapshot: { issueId: issue!.id },
    }).returning();
    return { companyId, agent: agent!, runId: run!.id };
  }

  /** Issues the run's token through heartbeat and returns a tools/list call with it. */
  async function issueRunToken(seed: Awaited<ReturnType<typeof seedRunningRun>>) {
    const [server] = await buildPaperclipRuntimeMcpServers({ db, agent: seed.agent, runId: seed.runId });
    expect(server?.token).toMatch(/^pcgw_/);
    const [gateway] = await db.select().from(toolMcpGateways).where(eq(toolMcpGateways.companyId, seed.companyId));
    const gatewayService = createToolGatewayService(db, { toolActionSigningSecret: "test-tool-action-signing-secret" });
    return () => gatewayService.listToolsForNamedGateway({ gatewayId: gateway!.id, bearerToken: server!.token });
  }

  function twoHoursLater() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * HOUR_MS);
  }

  it("issues a heartbeat-run token without a time expiry", async () => {
    const seed = await seedRunningRun();
    await issueRunToken(seed);

    const [token] = await db
      .select()
      .from(toolMcpGatewayTokens)
      .where(eq(toolMcpGatewayTokens.subjectId, seed.runId));
    expect(token).toMatchObject({ subjectType: "heartbeat_run", expiresAt: null });
    expect(token!.ownerNote).toContain("Valid while the run is running.");
  });

  it("keeps a heartbeat-run token valid while its run is running, also after an hour", async () => {
    const seed = await seedRunningRun();
    const listTools = await issueRunToken(seed);

    twoHoursLater();

    await expect(listTools()).resolves.toEqual(expect.any(Array));
  });

  it("rejects a heartbeat-run token once its run stopped running", async () => {
    const seed = await seedRunningRun();
    const listTools = await issueRunToken(seed);
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, seed.runId));

    await expect(listTools()).rejects.toMatchObject({ status: 401, reasonCode: "gateway_token_run_inactive" });
  });

  it("still expires a token with an explicit expiry", async () => {
    const seed = await seedRunningRun();
    const profile = await toolAccessService(db).createProfile(seed.companyId, {
      profileKey: `allow-${randomUUID()}`,
      name: "Allow all",
      defaultAction: "allow",
    });
    const gatewayService = createToolGatewayService(db, { toolActionSigningSecret: "test-tool-action-signing-secret" });
    const gateway = await gatewayService.createNamedGateway({
      companyId: seed.companyId,
      body: { name: "Client gateway", profileId: profile.id },
    });
    const token = await gatewayService.createNamedGatewayToken({
      companyId: seed.companyId,
      gatewayId: gateway.id,
      body: {
        name: "Client token",
        subjectType: "gateway_client",
        clientLabel: "Gateway client",
        ownerNote: "",
        allowedActions: ["tools/list", "tools/call"],
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    });

    twoHoursLater();

    await expect(
      gatewayService.listToolsForNamedGateway({ gatewayId: gateway.id, bearerToken: token.token }),
    ).rejects.toMatchObject({ status: 401, reasonCode: "gateway_token_expired" });
  });
});
