import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  toolProfileEntries,
  toolCatalogEntries,
  toolApplications,
  toolConnections,
} from "@paperclipai/db";

export type ToolProfileMigrationResult = {
  scannedEntries: number;
  migratedEntries: number;
};

export async function migrateLegacyProfileToolNameEntries(
  db: Db,
): Promise<ToolProfileMigrationResult> {
  const entries = await db
    .select()
    .from(toolProfileEntries)
    .where(
      and(
        eq(toolProfileEntries.selectorType, "tool_name"),
        isNotNull(toolProfileEntries.toolName),
      ),
    );

  let migratedEntries = 0;
  if (entries.length === 0) {
    return { scannedEntries: 0, migratedEntries: 0 };
  }

  const companyIds = Array.from(new Set(entries.map((e) => e.companyId)));
  const [catalog, applications, connections] = await Promise.all([
    db
      .select()
      .from(toolCatalogEntries)
      .where(inArray(toolCatalogEntries.companyId, companyIds)),
    db
      .select()
      .from(toolApplications)
      .where(inArray(toolApplications.companyId, companyIds)),
    db
      .select()
      .from(toolConnections)
      .where(inArray(toolConnections.companyId, companyIds)),
  ]);

  const appsById = new Map(applications.map((app) => [app.id, app]));
  const connsById = new Map(connections.map((c) => [c.id, c]));

  for (const entry of entries) {
    const rawToolName = entry.toolName;
    if (!rawToolName) continue;

    // Built-in fixtures and plugin tools have no catalog entry and must never be rewritten
    if (
      rawToolName.startsWith("mcp-stdio-fixture:") ||
      rawToolName.startsWith("mcp-remote-fixture:") ||
      rawToolName.includes("-plugin:")
    ) {
      continue;
    }

    let targetCatalogName: string | null = null;

    const companyCatalog = catalog.filter((c) => c.companyId === entry.companyId);
    const exactMatch = companyCatalog.find((c) => c.toolName === rawToolName);
    if (exactMatch) {
      continue;
    }

    if (rawToolName.startsWith("mcp.") && rawToolName.includes(":")) {
      const toolPart = rawToolName.slice(rawToolName.lastIndexOf(":") + 1);
      const catMatch = companyCatalog.find(
        (c) =>
          c.toolName === toolPart ||
          c.toolName.toLowerCase().replace(/[^a-z0-9]+/g, "-") === toolPart ||
          c.toolName.toLowerCase().replace(/[^a-z0-9_-]/g, "") === toolPart,
      );
      targetCatalogName = catMatch ? catMatch.toolName : toolPart;
    } else if (rawToolName.includes(":")) {
      const toolPart = rawToolName.slice(rawToolName.lastIndexOf(":") + 1);
      const catMatch = companyCatalog.find(
        (c) =>
          c.toolName === toolPart ||
          c.toolName.toLowerCase().replace(/[^a-z0-9]+/g, "-") === toolPart ||
          c.toolName.toLowerCase().replace(/[^a-z0-9_-]/g, "") === toolPart,
      );
      if (catMatch) {
        targetCatalogName = catMatch.toolName;
      }
    } else {
      // 2. Client-safe or gateway format without colon (e.g. Change 14 client-safe format `<appSlug>_<toolSlug>`, disambiguated `<base>_<connId>`, or report fixtures)
      for (const cat of companyCatalog) {
        const app = cat.applicationId ? appsById.get(cat.applicationId) : null;
        const conn = cat.connectionId ? connsById.get(cat.connectionId) : null;
        const appSlug = (app?.applicationKey ?? conn?.name ?? "mcp")
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "");
        const toolSlug = cat.toolName.toLowerCase().replace(/[^a-z0-9_-]/g, "");

        // Change 14 disambiguated tool names append _<shortStableId(8)> or _<shortStableId(5)>_<counter>
        const withoutCollisionSuffix = rawToolName.replace(/_[a-z0-9]{5,8}(?:_[0-9]+)?$/i, "");

        if (
          rawToolName === `${appSlug}_${toolSlug}` ||
          rawToolName.endsWith(`_${toolSlug}`) ||
          rawToolName.endsWith(`_${cat.toolName}`) ||
          rawToolName.includes(`_${toolSlug}_`) ||
          rawToolName.includes(`_${cat.toolName}_`) ||
          withoutCollisionSuffix === `${appSlug}_${toolSlug}` ||
          withoutCollisionSuffix.endsWith(`_${toolSlug}`) ||
          withoutCollisionSuffix.endsWith(`_${cat.toolName}`) ||
          (toolSlug.length > 8 && withoutCollisionSuffix.includes(`_${toolSlug.slice(0, 8)}`))
        ) {
          targetCatalogName = cat.toolName;
          break;
        }
      }
    }

    if (targetCatalogName && targetCatalogName !== rawToolName) {
      await db
        .update(toolProfileEntries)
        .set({
          toolName: targetCatalogName,
          updatedAt: new Date(),
        })
        .where(eq(toolProfileEntries.id, entry.id));
      migratedEntries++;
    }
  }

  return {
    scannedEntries: entries.length,
    migratedEntries,
  };
}
