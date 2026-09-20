import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  approvals,
  companies,
  companySecrets,
  connectionGrants,
  createDb,
  heartbeatRuns,
  issueApprovals,
  issues,
  projects,
  issueThreadInteractions,
  toolApplications,
  toolCatalogEntries,
  toolConnections,
  toolAccessAuditEvents,
  toolActionRequests,
  toolCallEvents,
  toolGatewaySessions,
  toolInvocations,
  toolPolicies,
} from "@paperclipai/db";
import {
  createToolGatewayService,
  ToolGatewayHttpError,
} from "../services/tool-gateway.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const testToolActionSigningSecret = "test-tool-action-signing-secret";
type ToolGatewayServiceOptions = NonNullable<Parameters<typeof createToolGatewayService>[1]>;

function createTestToolGatewayService(db: ReturnType<typeof createDb>, options: ToolGatewayServiceOptions = {}) {
  return createToolGatewayService(db, {
    ...options,
    toolActionSigningSecret: options.toolActionSigningSecret ?? testToolActionSigningSecret,
    remoteHttpRequest: options.remoteHttpRequest ?? (async (url, init) => fetch(url, init)),
  });
}

async function createRunFixture(db: ReturnType<typeof createDb>) {
  const company = await db.insert(companies).values({
    name: `Gateway ${randomUUID()}`,
    issuePrefix: `TG${randomUUID().slice(0, 6).toUpperCase()}`,
  }).returning().then((rows) => rows[0]!);
  const agent = await db.insert(agents).values({
    companyId: company.id,
    name: `Gateway Agent ${randomUUID()}`,
    role: "engineer",
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  }).returning().then((rows) => rows[0]!);
  const issue = await db.insert(issues).values({
    companyId: company.id,
    title: "Gateway work",
    status: "in_progress",
    assigneeAgentId: agent.id,
  }).returning().then((rows) => rows[0]!);
  const run = await db.insert(heartbeatRuns).values({
    companyId: company.id,
    agentId: agent.id,
    invocationSource: "assignment",
    status: "running",
    contextSnapshot: { issueId: issue.id },
  }).returning().then((rows) => rows[0]!);
  return { company, agent, issue, run };
}

async function createRemoteMcpFixture(
  db: ReturnType<typeof createDb>,
  companyId: string,
  options?: { toolName?: string; isReadOnly?: boolean; riskLevel?: "read" | "write" },
) {
  const toolName = options?.toolName ?? "query_data";
  const isReadOnly = options?.isReadOnly ?? true;
  const riskLevel = options?.riskLevel ?? (isReadOnly ? "read" : "write");

  const application = await db.insert(toolApplications).values({
    companyId,
    applicationKey: `remote-${randomUUID().slice(0, 8)}`,
    name: "Remote MCP Service",
    type: "mcp_http",
    status: "active",
  }).returning().then((rows) => rows[0]!);

  const connection = await db.insert(toolConnections).values({
    companyId,
    applicationId: application.id,
    name: "Remote MCP Connection",
    uid: `test/${randomUUID()}`,
    transport: "mcp_remote",
    status: "active",
    enabled: true,
    healthStatus: "ok",
    credentialPolicy: "shared",
    config: { url: "https://8.8.8.8/mcp" },
  }).returning().then((rows) => rows[0]!);

  await db.insert(connectionGrants).values({
    companyId,
    connectionId: connection.id,
    kind: "organization",
    credentialSecretRefs: [],
    status: "active",
    isDefault: true,
  });

  const catalogEntry = await db.insert(toolCatalogEntries).values({
    companyId,
    applicationId: application.id,
    connectionId: connection.id,
    entryKind: "tool",
    name: toolName,
    toolName,
    title: "Remote Tool",
    riskLevel,
    isReadOnly,
    status: "active",
    versionHash: randomUUID(),
    schemaHash: randomUUID(),
  }).returning().then((rows) => rows[0]!);

  return { application, connection, catalogEntry };
}

describeEmbeddedPostgres("remote MCP timeout and health resilience", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-remote-mcp-health-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.delete(activityLog);
    await db.delete(agentWakeupRequests);
    await db.delete(toolGatewaySessions);
    await db.delete(toolCallEvents);
    await db.delete(toolAccessAuditEvents);
    await db.delete(toolActionRequests);
    await db.delete(toolInvocations);
    await db.delete(issueApprovals);
    await db.delete(approvals);
    await db.delete(issueThreadInteractions);
    await db.delete(toolCatalogEntries);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(companySecrets);
    await db.delete(toolPolicies);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("preserves catalog eligibility and marks connection degraded on tool invocation timeout", async () => {
    const { company, agent, run } = await createRunFixture(db);
    const { connection } = await createRemoteMcpFixture(db, company.id);

    await db.insert(toolPolicies).values({
      companyId: company.id,
      name: "Allow all tools",
      policyType: "allow",
      selectors: {},
    });

    // Remote HTTP mock simulates a slow server that triggers AbortSignal on timeout
    const gateway = createTestToolGatewayService(db, {
      remoteHttpRequest: async (_url, init) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: "test",
                  result: { content: [{ type: "text", text: "too slow" }] },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          }, 5000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      },
    });

    const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id });
    const initialTools = await gateway.listToolsForSession(session.token);
    const targetTool = initialTools.find((t) => t.providerType === "mcp_remote_http");
    expect(targetTool).toBeDefined();

    // Execute with a short 50ms timeout
    let caughtError: unknown;
    try {
      await gateway.executeTool({
        sessionToken: session.token,
        tool: targetTool!.name,
        parameters: { q: "test" },
        timeoutMs: 50,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ToolGatewayHttpError);
    const gatewayErr = caughtError as ToolGatewayHttpError;
    expect(gatewayErr.status).toBe(504);
    expect(gatewayErr.reasonCode).toBe("tool_timeout");
    expect(gatewayErr.details.failureKind).toBe("invocation_timeout");

    // Check that connection is marked "degraded", NOT "error"
    const [storedConn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(storedConn?.healthStatus).toBe("degraded");
    expect(storedConn?.healthMessage).toContain("Remote MCP tool call timed out; transport remains viable.");

    // Check that the tool remains catalog-eligible in the SAME session
    const toolsAfterTimeoutSameSession = await gateway.listToolsForSession(session.token);
    expect(toolsAfterTimeoutSameSession.some((t) => t.name === targetTool!.name)).toBe(true);

    // Check that the tool remains catalog-eligible in a NEW session
    const newSession = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id });
    const toolsNewSession = await gateway.listToolsForSession(newSession.token);
    expect(toolsNewSession.some((t) => t.name === targetTool!.name)).toBe(true);

    // Check invocation status in DB
    const invocations = await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, company.id));
    expect(invocations.length).toBe(1);
    expect(invocations[0]?.status).toBe("timed_out");
    expect(invocations[0]?.errorCode).toBe("tool_timeout");
  });

  it("restores normal ok health status on subsequent successful exchange", async () => {
    const { company, agent, run } = await createRunFixture(db);
    const { connection } = await createRemoteMcpFixture(db, company.id);

    await db.insert(toolPolicies).values({
      companyId: company.id,
      name: "Allow all tools",
      policyType: "allow",
      selectors: {},
    });

    let shouldDelay = true;
    const gateway = createTestToolGatewayService(db, {
      remoteHttpRequest: async (_url, init) => {
        if (shouldDelay) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const abortErr = new Error("The operation was aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "test",
            result: { content: [{ type: "text", text: "success data" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id });
    const tools = await gateway.listToolsForSession(session.token);
    const targetTool = tools.find((t) => t.providerType === "mcp_remote_http")!;
    expect(targetTool).toBeDefined();

    // 1. First call times out -> degrades health
    await expect(
      gateway.executeTool({
        sessionToken: session.token,
        tool: targetTool.name,
        parameters: {},
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ status: 504, reasonCode: "tool_timeout" });

    const [degradedConn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(degradedConn?.healthStatus).toBe("degraded");

    // 2. Subsequent call succeeds -> restores "ok" health
    shouldDelay = false;
    const result = await gateway.executeTool({
      sessionToken: session.token,
      tool: targetTool.name,
      parameters: {},
      timeoutMs: 500,
    });

    expect(result.status).toBe("completed");

    const [restoredConn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(restoredConn?.healthStatus).toBe("ok");
    expect(restoredConn?.healthMessage).toContain("Remote MCP server responded to tools/call.");
    expect(restoredConn?.lastError).toBeNull();
  });

  it("preserves ambiguous write tool outcomes without automatic retry or replay", async () => {
    const { company, agent, run } = await createRunFixture(db);
    const { connection } = await createRemoteMcpFixture(db, company.id, {
      toolName: "charge_payment",
      isReadOnly: false,
      riskLevel: "write",
    });

    await db.insert(toolPolicies).values({
      companyId: company.id,
      name: "Allow payment write",
      policyType: "allow",
      selectors: {},
    });

    let dispatchCount = 0;
    const gateway = createTestToolGatewayService(db, {
      remoteHttpRequest: async (_url, init) => {
        dispatchCount++;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      },
    });

    const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id });
    const tools = await gateway.listToolsForSession(session.token);
    const writeTool = tools.find((t) => t.providerType === "mcp_remote_http")!;
    expect(writeTool).toBeDefined();

    const idempotencyKey = `idempotent-write-${randomUUID()}`;

    // 1. Call times out
    await expect(
      gateway.executeTool({
        sessionToken: session.token,
        tool: writeTool.name,
        parameters: { amount: 5000 },
        timeoutMs: 40,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ status: 504, reasonCode: "tool_timeout" });

    // The remote server must only have been invoked once (no automatic background retries)
    expect(dispatchCount).toBe(1);

    // Verify the invocation recorded in DB is timed_out
    const [inv] = await db
      .select()
      .from(toolInvocations)
      .where(and(eq(toolInvocations.companyId, company.id), eq(toolInvocations.idempotencyKey, idempotencyKey)));
    expect(inv?.status).toBe("timed_out");

    // 2. Calling again with the same idempotency key must reject as ambiguous invocation timeout (NOT replay)
    let secondCallError: unknown;
    try {
      await gateway.executeTool({
        sessionToken: session.token,
        tool: writeTool.name,
        parameters: { amount: 5000 },
        timeoutMs: 500,
        idempotencyKey,
      });
    } catch (err) {
      secondCallError = err;
    }

    expect(secondCallError).toBeDefined();
    expect((secondCallError as any).status).toBe(409);
    expect((secondCallError as any).message).toContain("ambiguous outcome");

    // Still exactly 1 dispatch to the remote server — it was never called a second time
    expect(dispatchCount).toBe(1);
  });

  it("fails closed on genuine transport failure (network drop)", async () => {
    const { company, agent, run } = await createRunFixture(db);
    const { connection } = await createRemoteMcpFixture(db, company.id);

    await db.insert(toolPolicies).values({
      companyId: company.id,
      name: "Allow all",
      policyType: "allow",
      selectors: {},
    });

    const gateway = createTestToolGatewayService(db, {
      remoteHttpRequest: async () => {
        throw new TypeError("fetch failed: ECONNREFUSED");
      },
    });

    const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id });
    const tools = await gateway.listToolsForSession(session.token);
    const targetTool = tools.find((t) => t.providerType === "mcp_remote_http")!;
    expect(targetTool).toBeDefined();

    let caughtErr: unknown;
    try {
      await gateway.executeTool({
        sessionToken: session.token,
        tool: targetTool.name,
        parameters: {},
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(ToolGatewayHttpError);
    const err = caughtErr as ToolGatewayHttpError;
    expect(err.status).toBe(502);
    expect(err.reasonCode).toBe("mcp_remote_fetch_failed");
    expect(err.details.failureKind).toBe("transport_failure");

    // Connection MUST be marked "error", not "degraded"
    const [storedConn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(storedConn?.healthStatus).toBe("error");

    // Catalog MUST be excluded from listToolsForSession
    const toolsAfter = await gateway.listToolsForSession(session.token);
    expect(toolsAfter.some((t) => t.name === targetTool.name)).toBe(false);
  });

  it("fails closed on protocol failure (HTTP 500, invalid JSON, JSON-RPC error)", async () => {
    const { company, agent, run } = await createRunFixture(db);
    const { connection } = await createRemoteMcpFixture(db, company.id);

    await db.insert(toolPolicies).values({
      companyId: company.id,
      name: "Allow all",
      policyType: "allow",
      selectors: {},
    });

    let mode: "http_500" | "invalid_json" | "rpc_error" = "http_500";
    const gateway = createTestToolGatewayService(db, {
      remoteHttpRequest: async () => {
        if (mode === "http_500") {
          return new Response("Internal Server Error", { status: 500 });
        }
        if (mode === "invalid_json") {
          return new Response("This is not JSON", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "test",
            error: { code: -32603, message: "Internal JSON-RPC failure" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id });
    const tools = await gateway.listToolsForSession(session.token);
    const targetTool = tools.find((t) => t.providerType === "mcp_remote_http")!;
    expect(targetTool).toBeDefined();

    // HTTP 500
    let err500: any;
    try {
      await gateway.executeTool({ sessionToken: session.token, tool: targetTool.name, parameters: {} });
    } catch (e) {
      err500 = e;
    }
    expect(err500?.status).toBe(502);
    expect(err500?.reasonCode).toBe("mcp_remote_status");
    expect(err500?.details?.failureKind).toBe("protocol_failure");

    let [conn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(conn?.healthStatus).toBe("error");

    // Invalid JSON
    mode = "invalid_json";
    await db.update(toolConnections).set({ healthStatus: "ok" }).where(eq(toolConnections.id, connection.id));
    let errJson: any;
    try {
      await gateway.executeTool({ sessionToken: session.token, tool: targetTool.name, parameters: {} });
    } catch (e) {
      errJson = e;
    }
    expect(errJson?.status).toBe(502);
    expect(errJson?.reasonCode).toBe("mcp_remote_invalid_json");
    expect(errJson?.details?.failureKind).toBe("protocol_failure");

    [conn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(conn?.healthStatus).toBe("error");

    // JSON-RPC Error
    mode = "rpc_error";
    await db.update(toolConnections).set({ healthStatus: "ok" }).where(eq(toolConnections.id, connection.id));
    let errRpc: any;
    try {
      await gateway.executeTool({ sessionToken: session.token, tool: targetTool.name, parameters: {} });
    } catch (e) {
      errRpc = e;
    }
    expect(errRpc?.status).toBe(502);
    expect(errRpc?.reasonCode).toBe("remote_mcp_error");
    expect(errRpc?.details?.failureKind).toBe("protocol_failure");

    [conn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(conn?.healthStatus).toBe("error");
  });

  it("guards against stale timeout downgrading a newer successful health update", async () => {
    const { company, agent, run } = await createRunFixture(db);
    const { connection } = await createRemoteMcpFixture(db, company.id);

    await db.insert(toolPolicies).values({
      companyId: company.id,
      name: "Allow all",
      policyType: "allow",
      selectors: {},
    });

    const gateway = createTestToolGatewayService(db, {
      remoteHttpRequest: async (_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      },
    });

    const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id });
    const tools = await gateway.listToolsForSession(session.token);
    const targetTool = tools.find((t) => t.providerType === "mcp_remote_http")!;
    expect(targetTool).toBeDefined();

    // Start a tool execution that will abort
    const executionPromise = gateway.executeTool({
      sessionToken: session.token,
      tool: targetTool.name,
      parameters: {},
      timeoutMs: 60,
    });

    // While in flight (simulate concurrent catalog refresh / health check at T1 > T0)
    await new Promise((r) => setTimeout(r, 20));
    const concurrentHealthUpdateAt = new Date();
    await db
      .update(toolConnections)
      .set({
        healthStatus: "ok",
        healthMessage: "Tool catalog refreshed concurrently.",
        healthCheckedAt: concurrentHealthUpdateAt,
        lastHealthAt: concurrentHealthUpdateAt,
        updatedAt: concurrentHealthUpdateAt,
      })
      .where(eq(toolConnections.id, connection.id));

    // Wait for the tool invocation to time out
    await expect(executionPromise).rejects.toMatchObject({ status: 504, reasonCode: "tool_timeout" });

    // The connection MUST still be "ok", NOT downgraded to "degraded"
    const [finalConn] = await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id));
    expect(finalConn?.healthStatus).toBe("ok");
    expect(finalConn?.healthMessage).toBe("Tool catalog refreshed concurrently.");
  });
});
