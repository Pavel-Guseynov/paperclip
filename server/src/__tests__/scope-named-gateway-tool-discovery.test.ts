import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  connectionGrants,
  createDb,
  heartbeatRuns,
  issues,
  projects,
  toolApplications,
  toolCatalogEntries,
  toolConnections,
  toolMcpGateways,
  toolMcpGatewayTokens,
  toolPolicies,
  toolProfileBindings,
  toolProfileEntries,
  toolProfiles,
} from "@paperclipai/db";
import {
  createToolGatewayService,
} from "../services/tool-gateway.js";
import * as policyModule from "../services/tool-access-policy.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const EXPECTED_APPROVAL_SUFFIX = "Requires human approval";
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const testToolActionSigningSecret = "test-tool-action-signing-secret";

type Db = ReturnType<typeof createDb>;

async function createCompany(db: Db) {
  return db
    .insert(companies)
    .values({
      name: `Gateway ${randomUUID()}`,
      issuePrefix: `TG${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createAgent(db: Db, companyId: string) {
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
    .then((rows) => rows[0]!);
}

async function createIssueAndRun(db: Db, companyId: string, agentId: string) {
  const project = await db
    .insert(projects)
    .values({ companyId, name: `Project ${randomUUID()}` })
    .returning()
    .then((rows) => rows[0]!);
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
    .then((rows) => rows[0]!);
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
    .then((rows) => rows[0]!);
  return { project, issue, run };
}

async function createRemoteMcpConnection(
  db: Db,
  companyId: string,
  options: {
    connectionName?: string;
    applicationKey?: string;
    tools: Array<{ toolName: string; title?: string; riskLevel?: "read" | "write" | "destructive" }>;
  },
) {
  const applicationKey = options.applicationKey ?? `app-${randomUUID().slice(0, 8)}`;
  const [application] = await db
    .insert(toolApplications)
    .values({
      companyId,
      applicationKey,
      name: `App ${applicationKey}`,
      type: "mcp_http",
      status: "active",
    })
    .returning();

  const [connection] = await db
    .insert(toolConnections)
    .values({
      companyId,
      applicationId: application.id,
      name: options.connectionName ?? `Connection ${randomUUID().slice(0, 8)}`,
      uid: `test/${randomUUID()}`,
      transport: "mcp_remote",
      status: "active",
      enabled: true,
      healthStatus: "ok",
      config: { url: `https://${applicationKey}.example.test/mcp` },
      transportConfig: { url: `https://${applicationKey}.example.test/mcp` },
    })
    .returning();

  await db.insert(connectionGrants).values({
    companyId,
    connectionId: connection.id,
    kind: "organization",
    status: "active",
    isDefault: true,
  });

  const catalogEntries = await Promise.all(
    options.tools.map(async (t) => {
      const [entry] = await db
        .insert(toolCatalogEntries)
        .values({
          companyId,
          applicationId: application.id,
          connectionId: connection.id,
          entryKind: "tool",
          name: `${t.toolName}-${randomUUID().slice(0, 8)}`,
          toolName: t.toolName,
          title: t.title ?? t.toolName,
          description: `Description for ${t.toolName}`,
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: t.riskLevel === "read" },
          riskLevel: t.riskLevel ?? "read",
          isReadOnly: (t.riskLevel ?? "read") === "read",
          isWrite: (t.riskLevel ?? "read") === "write",
          isDestructive: (t.riskLevel ?? "read") === "destructive",
          status: "active",
          versionHash: randomUUID(),
        })
        .returning();
      return entry;
    }),
  );

  return { application, connection, catalogEntries };
}

describeEmbeddedPostgres("Change 23: Scope named gateway tool discovery", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-scope-gateway-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a profiled named gateway evaluates only its profile's candidates, even though the company has many other connections", async () => {
    const company = await createCompany(db);

    const conn1 = await createRemoteMcpConnection(db, company.id, {
      applicationKey: "alpha",
      connectionName: "Alpha service",
      tools: [
        { toolName: "alpha_read", riskLevel: "read" },
        { toolName: "alpha_write", riskLevel: "write" },
      ],
    });

    const conn2 = await createRemoteMcpConnection(db, company.id, {
      applicationKey: "beta",
      connectionName: "Beta service",
      tools: [
        { toolName: "beta_read", riskLevel: "read" },
        { toolName: "beta_write", riskLevel: "write" },
      ],
    });

    const conn3 = await createRemoteMcpConnection(db, company.id, {
      applicationKey: "gamma",
      connectionName: "Gamma service",
      tools: [
        { toolName: "gamma_read", riskLevel: "read" },
        { toolName: "gamma_write", riskLevel: "write" },
      ],
    });

    // Profile P1 includes only conn1 via connection selector
    const [profile] = await db
      .insert(toolProfiles)
      .values({
        companyId: company.id,
        profileKey: `profile-${randomUUID()}`,
        name: "Conn1 Only Profile",
        defaultAction: "deny",
      })
      .returning();

    await db.insert(toolProfileEntries).values({
      companyId: company.id,
      profileId: profile.id,
      selectorType: "connection",
      effect: "include",
      connectionId: conn1.connection.id,
    });

    const [gatewayRow] = await db
      .insert(toolMcpGateways)
      .values({
        companyId: company.id,
        name: "Alpha Gateway",
        slug: `alpha-${randomUUID()}`,
        profileId: profile.id,
        defaultProfileMode: "gateway_only",
      })
      .returning();

    await db.insert(toolProfileBindings).values({
      companyId: company.id,
      profileId: profile.id,
      targetType: "gateway",
      targetId: gatewayRow.id,
    });

    const evaluatedToolNames: string[] = [];
    const origToolAccessPolicyService = policyModule.toolAccessPolicyService;
    vi.spyOn(policyModule, "toolAccessPolicyService").mockImplementation((database) => {
      const svc = origToolAccessPolicyService(database);
      const origDecide = svc.decide.bind(svc);
      svc.decide = vi.fn(async (input, ...args) => {
        evaluatedToolNames.push(input.request.upstreamToolName ?? input.request.toolName);
        return origDecide(input, ...args);
      });
      return svc;
    });

    const gatewayService = createToolGatewayService(db, {
      toolActionSigningSecret: testToolActionSigningSecret,
    });

    const token = await gatewayService.createNamedGatewayToken({
      companyId: company.id,
      gatewayId: gatewayRow.id,
      body: { name: "Discovery token", allowedActions: ["tools/list"] },
    });

    const tools = await gatewayService.listToolsForNamedGateway({
      gatewayId: gatewayRow.id,
      bearerToken: token.token,
    });

    // On head: ONLY conn1 candidate tools are evaluated by policyService.decide
    // On base: ALL company tools (conn1, conn2, conn3 + builtins) are evaluated!
    expect(evaluatedToolNames.some((name) => name.startsWith("beta_"))).toBe(false);
    expect(evaluatedToolNames.some((name) => name.startsWith("gamma_"))).toBe(false);
    expect(evaluatedToolNames.length).toBe(conn1.catalogEntries.length);

    // Visible tools should be only alpha tools
    const toolNames = tools.map((t) => t.upstreamToolName ?? t.name);
    expect(toolNames).toContain("alpha_read");
    expect(toolNames).toContain("alpha_write");
    expect(toolNames).not.toContain("beta_read");
    expect(toolNames).not.toContain("gamma_read");
  });

  it("a runtime gateway with profile_id and no binding row lists only its profile's tools, never the agent's", async () => {
    const company = await createCompany(db);
    const agent = await createAgent(db, company.id);
    const { run } = await createIssueAndRun(db, company.id, agent.id);

    const agentConn = await createRemoteMcpConnection(db, company.id, {
      applicationKey: "agent-app",
      connectionName: "Agent Connection",
      tools: [{ toolName: "agent_tool_exclusive", riskLevel: "read" }],
    });

    const gatewayConn = await createRemoteMcpConnection(db, company.id, {
      applicationKey: "gw-app",
      connectionName: "Gateway Connection",
      tools: [{ toolName: "gateway_tool_exclusive", riskLevel: "read" }],
    });

    // Agent profile granting agentConn
    const [agentProfile] = await db
      .insert(toolProfiles)
      .values({
        companyId: company.id,
        profileKey: `agent-prof-${randomUUID()}`,
        name: "Agent Profile",
        defaultAction: "deny",
      })
      .returning();

    await db.insert(toolProfileEntries).values({
      companyId: company.id,
      profileId: agentProfile.id,
      selectorType: "connection",
      effect: "include",
      connectionId: agentConn.connection.id,
    });

    await db.insert(toolProfileBindings).values({
      companyId: company.id,
      profileId: agentProfile.id,
      targetType: "agent",
      targetId: agent.id,
    });

    // Gateway profile granting gatewayConn
    const [gatewayProfile] = await db
      .insert(toolProfiles)
      .values({
        companyId: company.id,
        profileKey: `gw-prof-${randomUUID()}`,
        name: "Gateway Profile",
        defaultAction: "deny",
      })
      .returning();

    await db.insert(toolProfileEntries).values({
      companyId: company.id,
      profileId: gatewayProfile.id,
      selectorType: "connection",
      effect: "include",
      connectionId: gatewayConn.connection.id,
    });

    // Create runtime gateway: profileId set on gateway row, BUT NO toolProfileBindings row!
    const [runtimeGateway] = await db
      .insert(toolMcpGateways)
      .values({
        companyId: company.id,
        name: "Runtime Gateway",
        slug: `runtime-gw-${randomUUID()}`,
        profileId: gatewayProfile.id,
        agentId: agent.id,
        defaultProfileMode: "gateway_only",
      })
      .returning();

    const gatewayService = createToolGatewayService(db, {
      toolActionSigningSecret: testToolActionSigningSecret,
    });

    const token = await gatewayService.createNamedGatewayToken({
      companyId: company.id,
      gatewayId: runtimeGateway.id,
      body: {
        name: "Run token",
        subjectType: "heartbeat_run",
        subjectId: run.id,
        allowedActions: ["tools/list"],
      },
      actor: { agentId: agent.id },
    });

    const tools = await gatewayService.listToolsForNamedGateway({
      gatewayId: runtimeGateway.id,
      bearerToken: token.token,
    });

    const toolNames = tools.map((t) => t.upstreamToolName ?? t.name);

    // On head: gateway profile is authoritative (precedence 0). Returns gateway_tool_exclusive, never agent_tool_exclusive.
    // On base: missing gateway binding causes fallback to agent profile. Returns agent_tool_exclusive and not gateway_tool_exclusive!
    expect(toolNames).toContain("gateway_tool_exclusive");
    expect(toolNames).not.toContain("agent_tool_exclusive");
  });

  it("one tools/list issues a bounded number of policy-context queries, independent of the company's tool count", async () => {
    const company = await createCompany(db);

    // Create 10 tools on one connection
    const toolDefs = Array.from({ length: 10 }, (_, i) => ({
      toolName: `batch_tool_${i}`,
      riskLevel: "read" as const,
    }));

    const conn = await createRemoteMcpConnection(db, company.id, {
      applicationKey: "batch",
      connectionName: "Batch Connection",
      tools: toolDefs,
    });

    const [profile] = await db
      .insert(toolProfiles)
      .values({
        companyId: company.id,
        profileKey: `batch-prof-${randomUUID()}`,
        name: "Batch Profile",
        defaultAction: "deny",
      })
      .returning();

    await db.insert(toolProfileEntries).values({
      companyId: company.id,
      profileId: profile.id,
      selectorType: "connection",
      effect: "include",
      connectionId: conn.connection.id,
    });

    const [gatewayRow] = await db
      .insert(toolMcpGateways)
      .values({
        companyId: company.id,
        name: "Batch Gateway",
        slug: `batch-gw-${randomUUID()}`,
        profileId: profile.id,
        defaultProfileMode: "gateway_only",
      })
      .returning();

    await db.insert(toolProfileBindings).values({
      companyId: company.id,
      profileId: profile.id,
      targetType: "gateway",
      targetId: gatewayRow.id,
    });

    const gatewayService = createToolGatewayService(db, {
      toolActionSigningSecret: testToolActionSigningSecret,
    });

    const token = await gatewayService.createNamedGatewayToken({
      companyId: company.id,
      gatewayId: gatewayRow.id,
      body: { name: "Batch token", allowedActions: ["tools/list"] },
    });

    const selectSpy = vi.spyOn(db, "select");

    const tools = await gatewayService.listToolsForNamedGateway({
      gatewayId: gatewayRow.id,
      bearerToken: token.token,
    });

    expect(tools.length).toBe(10);

    const queryCount = selectSpy.mock.calls.length;
    // On head with context caching: queries for policies, bindings, gateway, profile, etc.
    // are executed once per discovery request (<= 15 queries total).
    // On base: queries scale linearly with candidate tool count (10 * 8 = 80+ queries).
    expect(queryCount).toBeLessThanOrEqual(15);
  });

  it("decisions for a mixed allow, deny, and require-approval set are unchanged", async () => {
    const company = await createCompany(db);

    const conn = await createRemoteMcpConnection(db, company.id, {
      applicationKey: "mixed",
      connectionName: "Mixed Policy Connection",
      tools: [
        { toolName: "tool_allowed", riskLevel: "read" },
        { toolName: "tool_requires_approval", riskLevel: "write" },
        { toolName: "tool_blocked", riskLevel: "destructive" },
      ],
    });

    const [profile] = await db
      .insert(toolProfiles)
      .values({
        companyId: company.id,
        profileKey: `mixed-prof-${randomUUID()}`,
        name: "Mixed Profile",
        defaultAction: "deny",
      })
      .returning();

    await db.insert(toolProfileEntries).values({
      companyId: company.id,
      profileId: profile.id,
      selectorType: "connection",
      effect: "include",
      connectionId: conn.connection.id,
    });

    // Add explicit policies: allow, require_approval, block
    const allowedCatalogEntry = conn.catalogEntries.find((e) => e.toolName === "tool_allowed")!;
    const approvalCatalogEntry = conn.catalogEntries.find((e) => e.toolName === "tool_requires_approval")!;
    const blockedCatalogEntry = conn.catalogEntries.find((e) => e.toolName === "tool_blocked")!;

    await db.insert(toolPolicies).values([
      {
        companyId: company.id,
        policyType: "allow",
        name: "Allow tool_allowed",
        priority: 10,
        enabled: true,
        selectors: { catalogEntryId: allowedCatalogEntry.id },
      },
      {
        companyId: company.id,
        policyType: "require_approval",
        name: "Require approval for tool_requires_approval",
        priority: 20,
        enabled: true,
        selectors: { catalogEntryId: approvalCatalogEntry.id },
      },
      {
        companyId: company.id,
        policyType: "block",
        name: "Block tool_blocked",
        priority: 30,
        enabled: true,
        selectors: { catalogEntryId: blockedCatalogEntry.id },
      },
    ]);

    const [gatewayRow] = await db
      .insert(toolMcpGateways)
      .values({
        companyId: company.id,
        name: "Mixed Gateway",
        slug: `mixed-gw-${randomUUID()}`,
        profileId: profile.id,
        defaultProfileMode: "gateway_only",
      })
      .returning();

    await db.insert(toolProfileBindings).values({
      companyId: company.id,
      profileId: profile.id,
      targetType: "gateway",
      targetId: gatewayRow.id,
    });

    const gatewayService = createToolGatewayService(db, {
      toolActionSigningSecret: testToolActionSigningSecret,
    });

    const token = await gatewayService.createNamedGatewayToken({
      companyId: company.id,
      gatewayId: gatewayRow.id,
      body: { name: "Mixed token", allowedActions: ["tools/list"] },
    });

    const tools = await gatewayService.listToolsForNamedGateway({
      gatewayId: gatewayRow.id,
      bearerToken: token.token,
    });

    const allowedTool = tools.find((t) => t.upstreamToolName === "tool_allowed");
    const approvalTool = tools.find((t) => t.upstreamToolName === "tool_requires_approval");
    const blockedTool = tools.find((t) => t.upstreamToolName === "tool_blocked");

    expect(allowedTool).toBeDefined();
    expect(allowedTool?.description).not.toContain(EXPECTED_APPROVAL_SUFFIX);

    expect(approvalTool).toBeDefined();
    expect(approvalTool?.description).toContain(EXPECTED_APPROVAL_SUFFIX);

    expect(blockedTool).toBeUndefined();
  });
});
