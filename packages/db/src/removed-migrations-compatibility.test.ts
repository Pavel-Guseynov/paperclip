import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  applyPendingMigrations,
  inspectMigrations,
} from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const cleanups: Array<() => Promise<void>> = [];
const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

// SHA-256 hashes of removed migrations
export const REMOVED_MIGRATION_HASHES = {
  "0280_panoramic_the_spike.sql": "5b2a81f5d329cae0729a99f0b78213d74422d6a749bb9c3bc69c6032b7dd0065",
  "0282_wakeful_mister_sinister.sql": "5c05aaf5642c0a9b753fc702a22afe5e109e115d197d525c6291bcf8cbc0b63a",
  "0283_unknown_imperial_guard.sql": "cf573d24061056d33ca8114372a4a1ea6a9c3bfe8f7352b17f9a29afd585353a",
  "0284_clumsy_harry_osborn.sql": "05487e142975f4c8571d183cbc88d3d7777378638deec50a0b62be8ff9470463",
} as const;

describeEmbeddedPostgres("database compatibility with legacy removed migrations (A4)", () => {
  it("starts and migrates cleanly on a database that already applied 0280 and 0282-0284, applying only Change 07 index", async () => {
    const database = await startEmbeddedPostgresTestDatabase("legacy-migration-compat-");
    cleanups.push(database.cleanup);

    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    // 1. Calculate hash of 0280_rapid_prowler.sql
    const rapidProwlerSql = await readFile(
      new URL("./migrations/0280_rapid_prowler.sql", import.meta.url),
      "utf8",
    );
    const rapidProwlerHash = createHash("sha256").update(rapidProwlerSql).digest("hex");

    // 2. Simulate a database that has had 0280_rapid_prowler removed from history,
    // and instead has entries for 0280_panoramic_the_spike, 0282, 0283, 0284.
    // First, remove rapid prowler index and its migration entry
    await sql.unsafe(`
      DROP INDEX IF EXISTS "agent_wakeup_requests_review_handoff_retry_idempotency_uq"
    `);

    // Remove rapid prowler hash from drizzle migrations table if present
    const migrationTable = (await sql<{ table_schema: string }[]>`
      SELECT table_schema FROM information_schema.tables WHERE table_name = '__drizzle_migrations' LIMIT 1
    `)[0]?.table_schema ?? "drizzle";

    await sql.unsafe(`
      DELETE FROM "${migrationTable}"."__drizzle_migrations"
      WHERE hash = '${rapidProwlerHash}'
         OR hash IN (${Object.values(REMOVED_MIGRATION_HASHES).map((h) => `'${h}'`).join(",")})
    `);

    // 3. Insert historical rows for the removed migrations (0280, 0282, 0283, 0284)
    const baseEpoch = 1789400000000;
    let offset = 1;
    for (const [name, hash] of Object.entries(REMOVED_MIGRATION_HASHES)) {
      const createdAt = baseEpoch + offset * 100000;
      await sql.unsafe(`
        INSERT INTO "${migrationTable}"."__drizzle_migrations" (hash, created_at)
        VALUES ('${hash}', '${createdAt}')
      `);
      offset++;
    }

    // Verify the foreign/unknown migration hashes exist in DB
    const insertedRows = await sql.unsafe<{ hash: string }[]>(`
      SELECT hash FROM "${migrationTable}"."__drizzle_migrations"
      WHERE hash IN (${Object.values(REMOVED_MIGRATION_HASHES).map((h) => `'${h}'`).join(",")})
    `);
    expect(insertedRows).toHaveLength(4);

    // 4. Inspect migrations: should detect only 0280_rapid_prowler.sql as pending,
    // ignoring the 4 unknown hash entries
    const inspection = await inspectMigrations(database.connectionString);
    expect(inspection.status).toBe("needsMigrations");
    if (inspection.status !== "needsMigrations") {
      throw new Error(`Expected needsMigrations, got ${inspection.status}`);
    }
    expect(inspection.pendingMigrations).toEqual(["0280_rapid_prowler.sql"]);

    // 5. Apply pending migrations: must apply only 0280_rapid_prowler.sql cleanly
    await expect(applyPendingMigrations(database.connectionString)).resolves.toBeUndefined();

    // 6. Verify migration status is now up to date
    const postInspection = await inspectMigrations(database.connectionString);
    expect(postInspection.status).toBe("upToDate");

    // 7. Verify index was created and is active
    const indexCheck = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'agent_wakeup_requests'
        AND indexname = 'agent_wakeup_requests_review_handoff_retry_idempotency_uq'
    `;
    expect(indexCheck).toHaveLength(1);
  }, 120_000);
});
