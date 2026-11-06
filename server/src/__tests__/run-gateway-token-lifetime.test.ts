import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issues,
  projects,
  toolProfiles,
  toolMcpGatewayTokens,
} from "@paperclipai/db";
import { runtimeConnectionIntentRoutes } from "../routes/connection-intents.js";
import { createRuntimeToolsToken } from "../runtime-tools-token.js";
import { errorHandler } from "../middleware/error-handler.js";
import {
  mcpGatewayProtocolRoutes,
  toolGatewayRoutes,
} from "../routes/tool-gateway.js";
import {
  createToolGatewayService,
} from "../services/tool-gateway.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const testToolActionSigningSecret = "test-secret-that-is-at-least-32-chars-long";

function createTestToolGatewayService(db: any) {
  return createToolGatewayService(db, {
    toolActionSigningSecret: testToolActionSigningSecret,
  });
}

function createGatewayRouteApp(db: any, gateway: any) {
  const app = express();
  app.use(express.json());
  app.use(mcpGatewayProtocolRoutes(gateway));
  app.use("/api", toolGatewayRoutes(db, gateway));
  return app;
}

async function createCompany(db: any) {
  return db
    .insert(companies)
    .values({
      name: `Gateway ${randomUUID()}`,
      issuePrefix: `TG${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows: any[]) => rows[0]!);
}

async function createProfile(db: any, companyId: string) {
  return db
    .insert(toolProfiles)
    .values({
      companyId,
      profileKey: `profile-${randomUUID().slice(0, 8)}`,
      name: `Profile ${randomUUID()}`,
      defaultAction: "allow",
    })
    .returning()
    .then((rows: any[]) => rows[0]!);
}

async function createAgent(db: any, companyId: string) {
  return db
    .insert(agents)
    .values({
      companyId,
      name: `Agent ${randomUUID()}`,
      role: "engineer",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    })
    .returning()
    .then((rows: any[]) => rows[0]!);
}

async function createIssueAndRun(db: any, companyId: string, agentId: string) {
  const project = await db
    .insert(projects)
    .values({ companyId, name: `Project ${randomUUID()}` })
    .returning()
    .then((rows: any[]) => rows[0]!);
  const issue = await db
    .insert(issues)
    .values({
      companyId,
      projectId: project.id,
      title: `Gateway issue ${randomUUID()}`,
      status: "in_progress",
      assigneeAgentId: agentId,
    })
    .returning()
    .then((rows: any[]) => rows[0]!);
  const run = await db
    .insert(heartbeatRuns)
    .values({
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      contextSnapshot: { issueId: issue.id, projectId: project.id },
    })
    .returning()
    .then((rows: any[]) => rows[0]!);
  return { project, issue, run };
}

describeEmbeddedPostgres("Run gateway and runtime-tools token lifetime", () => {
  let db: any;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-gw-token-lifetime-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("cleanup retains an expired active-run token for protocol and HTTP use", async () => {
    const company = await createCompany(db);
    const agent = await createAgent(db, company.id);
    const profile = await createProfile(db, company.id);
    const { issue, run } = await createIssueAndRun(db, company.id, agent.id);
    const gateway = createTestToolGatewayService(db);

    const namedGateway = await gateway.createNamedGateway({
      companyId: company.id,
      body: {
        name: `Runtime gateway ${randomUUID()}`,
        profileId: profile.id,
        defaultProfileMode: "gateway_only",
      },
    });

    // Mint token with expiresAt set to 1 hour in the past, while run is actively running
    const oneHourAgo = new Date(Date.now() - 3600_000);
    const token = await gateway.createNamedGatewayToken({
      companyId: company.id,
      gatewayId: namedGateway.id,
      body: {
        name: "Run-bound expired token",
        subjectType: "heartbeat_run",
        subjectId: run.id,
        allowedActions: ["tools/list", "tools/call"],
        expiresAt: oneHourAgo,
      },
      actor: { agentId: agent.id },
    });

    await gateway.cleanupExpiredSessions();

    // Cleanup must retain the expired credential while its run is active.
    const session = await gateway.initializeNamedGatewayProtocol({
      gatewayId: namedGateway.id,
      bearerToken: token.token,
    });
    expect(session).toMatchObject({
      companyId: company.id,
      agentId: agent.id,
      runId: run.id,
      issueId: issue.id,
    });

    // HTTP MCP route check
    const app = createGatewayRouteApp(db, gateway);
    const response = await request(app)
      .post(`/api/tool-gateway/gateways/${namedGateway.id}/mcp`)
      .set("authorization", `Bearer ${token.token}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      .expect(200);

    expect(response.body).toHaveProperty("result");
  });

  it.each(["succeeded", "cancelled"])("the same token is rejected and cleaned up once the run is %s", async (status) => {
    const company = await createCompany(db);
    const agent = await createAgent(db, company.id);
    const profile = await createProfile(db, company.id);
    const { issue, run } = await createIssueAndRun(db, company.id, agent.id);
    const gateway = createTestToolGatewayService(db);

    const namedGateway = await gateway.createNamedGateway({
      companyId: company.id,
      body: {
        name: `Runtime gateway ${randomUUID()}`,
        profileId: profile.id,
        defaultProfileMode: "gateway_only",
      },
    });

    const token = await gateway.createNamedGatewayToken({
      companyId: company.id,
      gatewayId: namedGateway.id,
      body: {
        name: "Run-bound token",
        subjectType: "heartbeat_run",
        subjectId: run.id,
        allowedActions: ["tools/list", "tools/call"],
        expiresAt: new Date(Date.now() + 3600_000),
      },
      actor: { agentId: agent.id },
    });

    // Terminal state ends authorization even before timestamp expiry.
    await db
      .update(heartbeatRuns)
      .set({ status, completedAt: new Date() })
      .where(eq(heartbeatRuns.id, run.id));

    // initializeNamedGatewayProtocol must reject with gateway_token_run_inactive
    await expect(
      gateway.initializeNamedGatewayProtocol({
        gatewayId: namedGateway.id,
        bearerToken: token.token,
      }),
    ).rejects.toMatchObject({
      status: 401,
      reasonCode: "gateway_token_run_inactive",
    });

    // HTTP MCP route check: must return 401 with reasonCode gateway_token_run_inactive
    const app = createGatewayRouteApp(db, gateway);
    const response = await request(app)
      .post(`/api/tool-gateway/gateways/${namedGateway.id}/mcp`)
      .set("authorization", `Bearer ${token.token}`)
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list" })
      .expect(401);

    expect(response.body.error.data.reasonCode).toBe("gateway_token_run_inactive");

    await gateway.cleanupExpiredSessions({ now: new Date(Date.now() + 7200_000) });
    expect(await db.select().from(toolMcpGatewayTokens).where(eq(toolMcpGatewayTokens.id, token.id))).toEqual([]);
  });

  it.each(["missing", "malformed", "foreign-company"])("cleans up expired credentials with a %s run binding", async (binding) => {
    const company = await createCompany(db);
    const agent = await createAgent(db, company.id);
    const profile = await createProfile(db, company.id);
    const gateway = createTestToolGatewayService(db);
    const namedGateway = await gateway.createNamedGateway({
      companyId: company.id,
      body: { name: "Missing run", profileId: profile.id, defaultProfileMode: "gateway_only" },
    });
    let subjectId = binding === "malformed" ? "invalid-run-id" : randomUUID();
    if (binding === "foreign-company") {
      const foreignCompany = await createCompany(db);
      const foreignAgent = await createAgent(db, foreignCompany.id);
      subjectId = (await createIssueAndRun(db, foreignCompany.id, foreignAgent.id)).run.id;
    }
    const token = await gateway.createNamedGatewayToken({
      companyId: company.id, gatewayId: namedGateway.id,
      body: { name: "Orphan", subjectType: "heartbeat_run", subjectId, expiresAt: new Date(0) },
      actor: { agentId: agent.id },
    });
    await gateway.cleanupExpiredSessions();
    expect(await db.select().from(toolMcpGatewayTokens).where(eq(toolMcpGatewayTokens.id, token.id))).toEqual([]);
  });

  it.each(["succeeded", "cancelled"])("runtime-tools accepts an expired live-run token and rejects it after %s", async (status) => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-runtime-tools-secret");
    const company = await createCompany(db);
    const agent = await createAgent(db, company.id);
    const { run } = await createIssueAndRun(db, company.id, agent.id);
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Responsible", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
    await db.update(heartbeatRuns).set({ responsibleUserId: userId }).where(eq(heartbeatRuns.id, run.id));
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const token = createRuntimeToolsToken({ agentId: agent.id, companyId: company.id, runId: run.id, responsibleUserId: userId })!;
    vi.setSystemTime(new Date("2026-11-01T02:00:00Z"));
    const app = express();
    app.use(express.json());
    app.use(runtimeConnectionIntentRoutes(db));
    app.use(errorHandler);

    const initialize = () => request(app).post("/mcp/runtime-tools").set("authorization", `Bearer ${token.token}`)
      .send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const response = await initialize().expect(200);
    expect(response.body.result.serverInfo.name).toBe("paperclip-runtime-tools");
    await request(app).get("/mcp/runtime-tools").set("authorization", `Bearer ${token.token}`).expect(405);
    const search = () => request(app).post("/runtime-tools/connections/search").set("authorization", `Bearer ${token.token}`).send({ query: "" });
    expect((await search().expect(200)).body.version).toBe(1);
    const connect = () => request(app).post("/runtime-tools/connections/request").set("authorization", `Bearer ${token.token}`).send({ service: "test-service-does-not-exist" });
    expect((await connect().expect(404)).body.error).toBe("Connection service was not found");

    await db.update(heartbeatRuns).set({ status, completedAt: new Date() }).where(eq(heartbeatRuns.id, run.id));
    expect((await initialize().expect(403)).body.error).toBe("Runtime tool token is no longer active");
    expect((await search().expect(403)).body.error).toBe("Runtime tool token is no longer active");
    expect((await connect().expect(403)).body.error).toBe("Runtime tool token is no longer active");
  });

  it("a token that is not run-bound still expires at its expiresAt", async () => {
    const company = await createCompany(db);
    const agent = await createAgent(db, company.id);
    const profile = await createProfile(db, company.id);
    const gateway = createTestToolGatewayService(db);

    const namedGateway = await gateway.createNamedGateway({
      companyId: company.id,
      body: {
        name: `Runtime gateway ${randomUUID()}`,
        profileId: profile.id,
        defaultProfileMode: "gateway_only",
      },
    });

    const pastDate = new Date(Date.now() - 5000);
    const token = await gateway.createNamedGatewayToken({
      companyId: company.id,
      gatewayId: namedGateway.id,
      body: {
        name: "Agent token expired",
        subjectType: "agent",
        subjectId: agent.id,
        allowedActions: ["tools/list", "tools/call"],
        expiresAt: pastDate,
      },
      actor: { agentId: agent.id },
    });

    await expect(
      gateway.initializeNamedGatewayProtocol({
        gatewayId: namedGateway.id,
        bearerToken: token.token,
      }),
    ).rejects.toMatchObject({
      status: 401,
      reasonCode: "gateway_token_expired",
    });

    const app = createGatewayRouteApp(db, gateway);
    const response = await request(app)
      .post(`/api/tool-gateway/gateways/${namedGateway.id}/mcp`)
      .set("authorization", `Bearer ${token.token}`)
      .send({ jsonrpc: "2.0", id: 3, method: "tools/list" })
      .expect(401);

    expect(response.body.error.data.reasonCode).toBe("gateway_token_expired");
    await gateway.cleanupExpiredSessions();
    expect(await db.select().from(toolMcpGatewayTokens).where(eq(toolMcpGatewayTokens.id, token.id))).toEqual([]);
  });
});
