import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  createDb,
  toolApplications,
  toolCatalogEntries,
  toolConnections,
  toolProfileEntries,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { toolAccessService } from "../services/tool-access.js";
import { createToolGatewayService } from "../services/tool-gateway.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
const describePostgres = postgresSupport.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;

async function createRemoteMcpConnection(db: Db, companyId: string, key: string, toolNames: string[]) {
  const [application] = await db.insert(toolApplications).values({
    companyId,
    applicationKey: key,
    name: `App ${key}`,
    type: "mcp_http",
    status: "active",
  }).returning();
  const [connection] = await db.insert(toolConnections).values({
    companyId,
    applicationId: application!.id,
    name: `Connection ${key}`,
    uid: `test/${randomUUID()}`,
    transport: "mcp_remote",
    status: "active",
    enabled: true,
    healthStatus: "ok",
    config: { url: `https://${key}.example.test/mcp` },
    transportConfig: { url: `https://${key}.example.test/mcp` },
  }).returning();
  await db.insert(toolCatalogEntries).values(toolNames.map((toolName) => ({
    companyId,
    applicationId: application!.id,
    connectionId: connection!.id,
    entryKind: "tool" as const,
    name: toolName,
    toolName,
    title: toolName,
    description: `Description for ${toolName}`,
    inputSchema: { type: "object", properties: {} },
    riskLevel: "read" as const,
    isReadOnly: true,
    status: "active" as const,
    versionHash: randomUUID(),
  })));
  return connection!;
}

describePostgres("tool policy reads during tool discovery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-tool-policy-read-cache-");
    db = createDb(database.connectionString);
  }, 20_000);

  afterAll(async () => {
    await database?.cleanup();
  });

  /** Lists the tools of a named gateway over `toolCount` tools and counts the selects it runs. */
  async function selectsForTools(toolCount: number) {
    const [company] = await db.insert(companies).values({
      name: `Gateway ${randomUUID()}`,
      issuePrefix: `G${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    }).returning();
    const toolNames = Array.from({ length: toolCount }, (_, index) => `batch_tool_${index}`);
    const connection = await createRemoteMcpConnection(db, company!.id, `batch${randomUUID().slice(0, 8)}`, toolNames);
    const profile = await toolAccessService(db).createProfile(company!.id, {
      profileKey: `batch-${randomUUID()}`,
      name: "Batch",
      defaultAction: "deny",
      entries: [{ selectorType: "connection", effect: "include", connectionId: connection.id }],
    });
    const gatewayService = createToolGatewayService(db, { toolActionSigningSecret: "test-tool-action-signing-secret" });
    const gateway = await gatewayService.createNamedGateway({
      companyId: company!.id,
      body: { name: "Batch gateway", profileId: profile.id },
    });
    const token = await gatewayService.createNamedGatewayToken({
      companyId: company!.id,
      gatewayId: gateway.id,
      body: { name: "Discovery", allowedActions: ["tools/list"] },
    });
    const select = vi.spyOn(db, "select");
    try {
      const tools = await gatewayService.listToolsForNamedGateway({ gatewayId: gateway.id, bearerToken: token.token });
      expect(tools.map((tool) => tool.upstreamToolName)).toEqual(expect.arrayContaining(toolNames));
      return select.mock.calls.length;
    } finally {
      select.mockRestore();
    }
  }

  it("reads the policy context once per tools/list, whatever the number of tools", async () => {
    expect(await selectsForTools(20)).toBe(await selectsForTools(5));
  });

  it("reads the policy context again for the next tools/list", async () => {
    const [company] = await db.insert(companies).values({
      name: `Gateway ${randomUUID()}`,
      issuePrefix: `G${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    }).returning();
    const connection = await createRemoteMcpConnection(db, company!.id, `fresh${randomUUID().slice(0, 8)}`, ["kept_tool", "denied_tool"]);
    const profile = await toolAccessService(db).createProfile(company!.id, {
      profileKey: `fresh-${randomUUID()}`,
      name: "Fresh",
      defaultAction: "deny",
      entries: [{ selectorType: "connection", effect: "include", connectionId: connection.id }],
    });
    const gatewayService = createToolGatewayService(db, { toolActionSigningSecret: "test-tool-action-signing-secret" });
    const gateway = await gatewayService.createNamedGateway({
      companyId: company!.id,
      body: { name: "Fresh gateway", profileId: profile.id },
    });
    const token = await gatewayService.createNamedGatewayToken({
      companyId: company!.id,
      gatewayId: gateway.id,
      body: { name: "Discovery", allowedActions: ["tools/list"] },
    });
    const listTools = async () =>
      (await gatewayService.listToolsForNamedGateway({ gatewayId: gateway.id, bearerToken: token.token }))
        .map((tool) => tool.upstreamToolName);

    expect(await listTools()).toEqual(expect.arrayContaining(["kept_tool", "denied_tool"]));

    const [denied] = await db
      .select({ id: toolCatalogEntries.id })
      .from(toolCatalogEntries)
      .where(and(eq(toolCatalogEntries.connectionId, connection.id), eq(toolCatalogEntries.toolName, "denied_tool")));
    await db.insert(toolProfileEntries).values({
      companyId: company!.id,
      profileId: profile.id,
      selectorType: "catalog_entry",
      effect: "exclude",
      catalogEntryId: denied!.id,
    });

    const after = await listTools();
    expect(after).toContain("kept_tool");
    expect(after).not.toContain("denied_tool");
  });
});
