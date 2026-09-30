import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer, connect as netConnect, type AddressInfo, type Server as NetServer, type Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  connectionGrants,
  createDb,
  heartbeatRuns,
  issues,
  toolApplications,
  toolConnections,
} from "@paperclipai/db";
import { toolAccessService } from "../services/tool-access.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const testToolActionSigningSecret = "test-tool-action-signing-secret";

type Db = ReturnType<typeof createDb>;

type Socks5ConnectRecord = {
  atyp: number;
  targetHost: string;
  targetPort: number;
};

type Socks5TestProxy = {
  server: NetServer;
  port: number;
  connections: Socks5ConnectRecord[];
  close: () => Promise<void>;
};

function createSocks5TestProxy(targetPortMap?: Record<string, number>): Promise<Socks5TestProxy> {
  return new Promise((resolve, reject) => {
    const connections: Socks5ConnectRecord[] = [];
    const openSockets: Socket[] = [];

    const server = createNetServer((clientSocket) => {
      openSockets.push(clientSocket);
      let stage: "greeting" | "connect" | "piping" = "greeting";

      clientSocket.on("error", () => {});

      clientSocket.on("data", (chunk) => {
        if (stage === "greeting") {
          if (chunk[0] !== 0x05) {
            clientSocket.destroy();
            return;
          }
          clientSocket.write(Buffer.from([0x05, 0x00]));
          stage = "connect";
          return;
        }

        if (stage === "connect") {
          if (chunk[0] !== 0x05 || chunk[1] !== 0x01) {
            clientSocket.destroy();
            return;
          }
          const atyp = chunk[3];
          let targetHost = "";
          let offset = 4;

          if (atyp === 0x01) {
            targetHost = `${chunk[offset]}.${chunk[offset + 1]}.${chunk[offset + 2]}.${chunk[offset + 3]}`;
            offset += 4;
          } else if (atyp === 0x03) {
            const len = chunk[offset];
            offset += 1;
            targetHost = chunk.subarray(offset, offset + len).toString("utf8");
            offset += len;
          } else if (atyp === 0x04) {
            targetHost = "ipv6";
            offset += 16;
          } else {
            clientSocket.destroy();
            return;
          }

          const targetPort = chunk.readUInt16BE(offset);
          connections.push({ atyp, targetHost, targetPort });

          const destPort = targetPortMap?.[targetHost] ?? targetPort;
          const destSocket = netConnect({ host: "127.0.0.1", port: destPort }, () => {
            clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            stage = "piping";
            clientSocket.pipe(destSocket);
            destSocket.pipe(clientSocket);
          });

          openSockets.push(destSocket);
          destSocket.on("error", () => clientSocket.destroy());
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        connections,
        close: async () => {
          for (const s of openSockets) s.destroy();
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
    server.on("error", reject);
  });
}

type McpTestServer = {
  server: Server;
  port: number;
  requests: Array<{ method: string; url: string; body: unknown }>;
  close: () => Promise<void>;
};

function createMcpTestServer(): Promise<McpTestServer> {
  return new Promise((resolve, reject) => {
    const requests: McpTestServer["requests"] = [];
    const server = createServer(async (req, res) => {
      let bodyText = "";
      for await (const chunk of req) bodyText += chunk;
      let body: unknown = null;
      try {
        body = JSON.parse(bodyText);
      } catch {}
      requests.push({ method: req.method ?? "GET", url: req.url ?? "", body });

      if (req.method === "POST" && body && typeof body === "object") {
        const payload = body as Record<string, unknown>;
        if (payload.method === "tools/list") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id ?? "1",
              result: {
                tools: [
                  {
                    name: "echo_tool",
                    description: "Echo test tool",
                    inputSchema: {
                      type: "object",
                      properties: { text: { type: "string" } },
                    },
                  },
                ],
              },
            }),
          );
          return;
        }
        if (payload.method === "tools/call") {
          const params = payload.params as Record<string, unknown> | undefined;
          const args = params?.arguments as Record<string, unknown> | undefined;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id ?? "1",
              result: {
                content: [{ type: "text", text: `proxied:${args?.text ?? "ok"}` }],
              },
            }),
          );
          return;
        }
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        requests,
        close: async () => {
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
    server.on("error", reject);
  });
}

describeEmbeddedPostgres("Change 25: Remote MCP SOCKS5 proxy", () => {
  let testDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: Db;
  let mcpServer: McpTestServer;
  let proxy: Socks5TestProxy;

  beforeAll(async () => {
    testDb = await startEmbeddedPostgresTestDatabase("paperclip-socks-test-");
    db = createDb(testDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  afterEach(async () => {
    await mcpServer?.close?.();
    await proxy?.close?.();
  });

  it("proxied connection routes catalog refresh and tools/call through SOCKS5 proxy with target hostname", async () => {
    mcpServer = await createMcpTestServer();
    proxy = await createSocks5TestProxy({ "mcp.remote.test": mcpServer.port });

    const [company] = await db
      .insert(companies)
      .values({ name: "ProxyCo", issuePrefix: "PRX" })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: "ProxyAgent",
        role: "engineer",
        adapterType: "process",
      })
      .returning();
    const [issue] = await db
      .insert(issues)
      .values({
        companyId: company.id,
        title: "Proxy Issue",
        status: "in_progress",
      })
      .returning();
    const [run] = await db
      .insert(heartbeatRuns)
      .values({
        companyId: company.id,
        agentId: agent.id,
        issueId: issue.id,
        status: "running",
      })
      .returning();

    const [app] = await db
      .insert(toolApplications)
      .values({
        companyId: company.id,
        name: "RemoteApp",
        type: "mcp_http",
      })
      .returning();

    const [connection] = await db
      .insert(toolConnections)
      .values({
        companyId: company.id,
        applicationId: app.id,
        name: "SOCKS Remote Connection",
        uid: `conn-${randomUUID()}`,
        transport: "mcp_remote",
        status: "active",
        enabled: true,
        config: {
          url: `http://mcp.remote.test:${mcpServer.port}/mcp`,
          proxy: `socks5h://127.0.0.1:${proxy.port}`,
        },
      })
      .returning();

    await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "organization",
      status: "active",
      isDefault: true,
    });

    // 1. Catalog refresh reaches test server through proxy, proxy receives target hostname
    const accessSvc = toolAccessService(db);
    const refreshResult = await accessSvc.refreshCatalog(connection.id);
    expect(refreshResult.catalog.length).toBeGreaterThan(0);
    expect(refreshResult.catalog[0].toolName).toBe("echo_tool");

    expect(proxy.connections.length).toBeGreaterThan(0);
    expect(proxy.connections[0].atyp).toBe(0x03); // DOMAINNAME
    expect(proxy.connections[0].targetHost).toBe("mcp.remote.test");

    // 2. Gateway tools/call reaches test server through proxy, proxy receives target hostname
    const initialProxyConnCount = proxy.connections.length;
    const gateway = createToolGatewayService(db, {
      toolActionSigningSecret: testToolActionSigningSecret,
    });
    const session = await gateway.createSession({
      companyId: company.id,
      agentId: agent.id,
      runId: run.id,
    });
    const tools = await gateway.listToolsForSession(session.token);
    const echoTool = tools.find((t) => t.upstreamToolName === "echo_tool");
    expect(echoTool).toBeDefined();

    const result = (await gateway.executeTool({
      sessionToken: session.token,
      tool: echoTool!.name,
      parameters: { text: "hello" },
    })) as Record<string, any>;

    expect(result.status).toBe("completed");
    expect(JSON.stringify(result)).toContain("proxied:hello");
    expect(proxy.connections.length).toBeGreaterThan(initialProxyConnCount);
    const lastConn = proxy.connections[proxy.connections.length - 1];
    expect(lastConn.atyp).toBe(0x03);
    expect(lastConn.targetHost).toBe("mcp.remote.test");
  });

  it("connection without a proxy uses pinned transport unchanged", async () => {
    mcpServer = await createMcpTestServer();
    proxy = await createSocks5TestProxy({ "127.0.0.1": mcpServer.port });

    const [company] = await db
      .insert(companies)
      .values({ name: "DirectCo", issuePrefix: "DIR" })
      .returning();
    const [app] = await db
      .insert(toolApplications)
      .values({
        companyId: company.id,
        name: "DirectApp",
        type: "mcp_http",
      })
      .returning();
    const [connection] = await db
      .insert(toolConnections)
      .values({
        companyId: company.id,
        applicationId: app.id,
        name: "Direct Connection",
        uid: `conn-${randomUUID()}`,
        transport: "mcp_remote",
        status: "active",
        enabled: true,
        config: {
          url: `http://127.0.0.1:${mcpServer.port}/mcp`,
        },
      })
      .returning();

    const accessSvc = toolAccessService(db, { allowPrivateRemoteEndpoints: true });
    const refreshResult = await accessSvc.refreshCatalog(connection.id);
    expect(refreshResult.catalog.length).toBeGreaterThan(0);
    expect(refreshResult.catalog[0].toolName).toBe("echo_tool");
    // Proxy should have received NO connections
    expect(proxy.connections.length).toBe(0);
    // Direct MCP server should have received requests directly
    expect(mcpServer.requests.length).toBeGreaterThan(0);
  });

  it("rejects unsupported proxy scheme or malformed proxy value at save time and use time", async () => {
    const [company] = await db
      .insert(companies)
      .values({ name: "RejectCo", issuePrefix: "REJ" })
      .returning();

    const accessSvc = toolAccessService(db);

    // Unsupported scheme http://
    await expect(
      accessSvc.createConnection(company.id, {
        name: "Bad Scheme Conn",
        transport: "mcp_remote",
        config: {
          url: "http://example.com/mcp",
          proxy: "http://127.0.0.1:1080",
        },
      }),
    ).rejects.toMatchObject({
      details: expect.objectContaining({ code: "mcp_remote_proxy_invalid" }),
    });

    // Unsupported scheme socks5:// (must be socks5h)
    await expect(
      accessSvc.createConnection(company.id, {
        name: "Socks5 Scheme Conn",
        transport: "mcp_remote",
        config: {
          url: "http://example.com/mcp",
          proxy: "socks5://127.0.0.1:1080",
        },
      }),
    ).rejects.toMatchObject({
      details: expect.objectContaining({ code: "mcp_remote_proxy_invalid" }),
    });

    // Malformed proxy value
    await expect(
      accessSvc.createConnection(company.id, {
        name: "Malformed Proxy Conn",
        transport: "mcp_remote",
        config: {
          url: "http://example.com/mcp",
          proxy: "not-a-valid-url",
        },
      }),
    ).rejects.toMatchObject({
      details: expect.objectContaining({ code: "mcp_remote_proxy_invalid" }),
    });

    // At use time via guardedRemoteHttpFetch directly
    await expect(
      guardedRemoteHttpFetch(
        "http://example.com/mcp",
        {},
        {
          allowPrivateNetwork: true,
          error: (message, code) => Object.assign(new Error(message), { code }),
          proxy: "http://127.0.0.1:1080",
        },
      ),
    ).rejects.toMatchObject({ code: "mcp_remote_proxy_invalid" });
  });

  it("unreachable proxy fails with no direct connection attempted", async () => {
    mcpServer = await createMcpTestServer();

    const [company] = await db
      .insert(companies)
      .values({ name: "UnreachCo", issuePrefix: "UNR" })
      .returning();
    const [app] = await db
      .insert(toolApplications)
      .values({
        companyId: company.id,
        name: "UnreachApp",
        type: "mcp_http",
      })
      .returning();

    // Use an unassigned port on loopback where nothing is listening
    const unusedPort = 59987;
    const [connection] = await db
      .insert(toolConnections)
      .values({
        companyId: company.id,
        applicationId: app.id,
        name: "Unreachable Proxy Conn",
        uid: `conn-${randomUUID()}`,
        transport: "mcp_remote",
        status: "active",
        enabled: true,
        config: {
          url: `http://127.0.0.1:${mcpServer.port}/mcp`,
          proxy: `socks5h://127.0.0.1:${unusedPort}`,
        },
      })
      .returning();

    const accessSvc = toolAccessService(db, { allowPrivateRemoteEndpoints: true });
    await expect(accessSvc.refreshCatalog(connection.id)).rejects.toThrow();

    // Directly targeted MCP server must NOT have been called (no direct fallback)
    expect(mcpServer.requests.length).toBe(0);
  });

  it("target-URL guards still apply to proxied connection", async () => {
    proxy = await createSocks5TestProxy();

    // 1. Link-local IP literal is denied even with a proxy
    await expect(
      guardedRemoteHttpFetch(
        "http://169.254.169.254/latest/meta-data",
        {},
        {
          allowPrivateNetwork: true,
          error: (message, code) => Object.assign(new Error(message), { code }),
          proxy: `socks5h://127.0.0.1:${proxy.port}`,
        },
      ),
    ).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    // 2. Private IP literal is denied when allowPrivateNetwork is false
    await expect(
      guardedRemoteHttpFetch(
        "http://10.0.0.1/mcp",
        {},
        {
          allowPrivateNetwork: false,
          error: (message, code) => Object.assign(new Error(message), { code }),
          proxy: `socks5h://127.0.0.1:${proxy.port}`,
        },
      ),
    ).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    // 3. Invalid scheme is denied
    await expect(
      guardedRemoteHttpFetch(
        "ftp://example.com/mcp",
        {},
        {
          allowPrivateNetwork: false,
          error: (message, code) => Object.assign(new Error(message), { code }),
          proxy: `socks5h://127.0.0.1:${proxy.port}`,
        },
      ),
    ).rejects.toMatchObject({ code: "mcp_remote_url_invalid" });

    // 4. Proxy URL itself CAN be loopback or private address without error
    const loopbackProxyResult = await guardedRemoteHttpFetch(
      "http://mcp.remote.test/mcp",
      {},
      {
        allowPrivateNetwork: false,
        error: (message, code) => Object.assign(new Error(message), { code }),
        proxy: `socks5h://127.0.0.1:${proxy.port}`,
        socketFactory: () => {
          throw Object.assign(new Error("simulated test connect stop"), { code: "test_stop" });
        },
      },
    ).catch((e) => e);
    // Verified that it passed proxy validation and target-URL validation, reaching the socket factory
    expect(loopbackProxyResult.code).toBe("test_stop");
  });
});
