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

    // 1. Calculate hash of 0284_rapid_prowler.sql
    const rapidProwlerSql = await readFile(
      new URL("./migrations/0284_rapid_prowler.sql", import.meta.url),
      "utf8",
    );
    const rapidProwlerHash = createHash("sha256").update(rapidProwlerSql).digest("hex");

    // 2. Simulate a database that has had 0284_rapid_prowler removed from history,
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

    // 4. Inspect migrations: should detect only 0284_rapid_prowler.sql as pending,
    // ignoring the 4 unknown hash entries
    const inspection = await inspectMigrations(database.connectionString);
    expect(inspection.status).toBe("needsMigrations");
    if (inspection.status !== "needsMigrations") {
      throw new Error(`Expected needsMigrations, got ${inspection.status}`);
    }
    expect(inspection.pendingMigrations).toEqual(["0284_rapid_prowler.sql"]);

    // 5. Apply pending migrations: must apply only 0284_rapid_prowler.sql cleanly
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

  it("tolerates leftover heartbeat_runs.transition_seq from 044ba08d9, applies 0280..0283, and skips 0284 idempotently", async () => {
    const database = await startEmbeddedPostgresTestDatabase("transition-seq-upgrade-");
    cleanups.push(database.cleanup);

    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    // 1. Re-add leftover column transition_seq integer DEFAULT 1 NOT NULL on heartbeat_runs
    await sql.unsafe(`
      ALTER TABLE heartbeat_runs ADD COLUMN IF NOT EXISTS transition_seq integer DEFAULT 1 NOT NULL;
    `);

    // 2. Simulate historical 044ba08d9 database state:
    // 0280..0283 from upstream v2026.1001.0 were NOT yet applied in __drizzle_migrations.
    // 0280_rapid_prowler.sql (now 0284_rapid_prowler.sql) was already applied with hash 275adf1a...
    const rapidProwlerSql = await readFile(
      new URL("./migrations/0284_rapid_prowler.sql", import.meta.url),
      "utf8",
    );
    const rapidProwlerHash = createHash("sha256").update(rapidProwlerSql).digest("hex");

    const migrationTable = (await sql<{ table_schema: string }[]>`
      SELECT table_schema FROM information_schema.tables WHERE table_name = '__drizzle_migrations' LIMIT 1
    `)[0]?.table_schema ?? "drizzle";

    // Read hashes of 0280..0283 to simulate them being pending
    const upstreamFiles = [
      "0280_unique_genesis.sql",
      "0281_true_boom_boom.sql",
      "0282_colossal_shocker.sql",
      "0283_jittery_psynapse.sql",
    ];
    const upstreamHashes: string[] = [];
    for (const file of upstreamFiles) {
      const content = await readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8");
      upstreamHashes.push(createHash("sha256").update(content).digest("hex"));
    }

    // Remove upstream 0280..0283 from __drizzle_migrations, while keeping rapid prowler hash
    await sql.unsafe(`
      DELETE FROM "${migrationTable}"."__drizzle_migrations"
      WHERE hash IN (${upstreamHashes.map((h) => `'${h}'`).join(",")})
    `);

    // Ensure rapid prowler hash is present in __drizzle_migrations (representing historical 0280 execution)
    const existingRapid = await sql.unsafe<{ id: number }[]>(`
      SELECT id FROM "${migrationTable}"."__drizzle_migrations" WHERE hash = '${rapidProwlerHash}'
    `);
    if (existingRapid.length === 0) {
      await sql.unsafe(`
        INSERT INTO "${migrationTable}"."__drizzle_migrations" (hash, created_at)
        VALUES ('${rapidProwlerHash}', '1789400000000')
      `);
    }

    // 3. Inspect migrations: should detect 0280..0283 as pending, but 0284 is skipped (already applied)
    const inspection = await inspectMigrations(database.connectionString);
    expect(inspection.status).toBe("needsMigrations");
    if (inspection.status !== "needsMigrations") {
      throw new Error(`Expected needsMigrations, got ${inspection.status}`);
    }
    expect(inspection.pendingMigrations).toEqual(upstreamFiles);

    // 4. Apply pending migrations: must apply 0280..0283 and skip 0284 cleanly
    await expect(applyPendingMigrations(database.connectionString)).resolves.toBeUndefined();

    // 5. Verify migrations are now up to date
    const postInspection = await inspectMigrations(database.connectionString);
    expect(postInspection.status).toBe("upToDate");

    // 6. Verify table operations on heartbeat_runs succeed with leftover transition_seq column
    const companyId = "33333333-3333-3333-3333-333333333333";
    const agentId = "44444444-4444-4444-4444-444444444444";
    await sql.unsafe(`
      INSERT INTO companies (id, name, issue_prefix)
      VALUES ('${companyId}', 'Upgrade Test Co', 'UPG')
      ON CONFLICT (id) DO NOTHING;
    `);
    await sql.unsafe(`
      INSERT INTO agents (id, company_id, name, role)
      VALUES ('${agentId}', '${companyId}', 'Upgrade Agent', 'engineer')
      ON CONFLICT (id) DO NOTHING;
    `);

    const insertedRun = await sql<{ id: string; status: string; transition_seq: number }[]>`
      INSERT INTO heartbeat_runs (company_id, agent_id, status, invocation_source)
      VALUES (${companyId}, ${agentId}, 'queued', 'timer')
      RETURNING id, status, transition_seq
    `;
    expect(insertedRun).toHaveLength(1);
    expect(insertedRun[0].status).toBe("queued");
    expect(insertedRun[0].transition_seq).toBe(1);

    const queriedRun = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM heartbeat_runs WHERE id = ${insertedRun[0].id}
    `;
    expect(queriedRun).toHaveLength(1);
    expect(queriedRun[0].status).toBe("queued");
  }, 120_000);
});
