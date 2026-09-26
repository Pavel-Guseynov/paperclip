import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  projects,
  toolProfiles,
} from "@paperclipai/db";
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

describeEmbeddedPostgres("Change 24: Run gateway token lifetime", () => {
  let db: any;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-gw-token-lifetime-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("a run-bound token presented more than an hour after minting, while its run is running, is accepted", async () => {
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

    // Initialize named gateway protocol - must succeed while run is running
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

  it("the same token is rejected once the run has finished", async () => {
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

    // Set run to succeeded (no longer active)
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded", completedAt: new Date() })
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
  });
});
