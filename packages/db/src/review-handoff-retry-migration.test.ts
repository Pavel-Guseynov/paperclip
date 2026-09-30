import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
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

async function findRapidProwlerStatements(): Promise<string[]> {
  const migrationsDir = new URL("./migrations/", import.meta.url);
  const files = await readdir(fileURLToPath(migrationsDir));
  const fileName = files.find((f) => f.endsWith("_rapid_prowler.sql"));
  if (!fileName) throw new Error("Rapid prowler migration file not found");

  const migrationSql = await readFile(
    fileURLToPath(new URL(`./migrations/${fileName}`, import.meta.url)),
    "utf8",
  );
  return migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describeEmbeddedPostgres("review handoff retry migration with duplicate handling", () => {
  it("resolves duplicate non-skipped review-handoff rows by keeping the earliest and marking later rows skipped", async () => {
    const database = await startEmbeddedPostgresTestDatabase(
      "review-handoff-migration-",
    );
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, {
      max: 1,
      onnotice: () => {},
    });
    cleanups.push(async () => sql.end());

    // 1. Drop existing unique index if already present, to simulate pre-migration database state
    await sql.unsafe(`
      DROP INDEX IF EXISTS "agent_wakeup_requests_review_handoff_retry_idempotency_uq"
    `);

    const companyId = "11111111-1111-1111-1111-111111111111";
    const agentId = "22222222-2222-2222-2222-222222222222";
    await sql.unsafe(`
      INSERT INTO companies (id, name, issue_prefix)
      VALUES ('${companyId}', 'Test Co', 'TEST')
    `);
    await sql.unsafe(`
      INSERT INTO agents (id, company_id, name, role)
      VALUES ('${agentId}', '${companyId}', 'Test Agent', 'engineer')
    `);

    const key1 = "review-handoff:issue-test-1:stage-1:1";
    const key2 = "review-handoff:issue-test-2:stage-1:1";

    const now = Date.now();
    const t1 = new Date(now - 30_000);
    const t2 = new Date(now - 20_000);
    const t3 = new Date(now - 10_000);
    const t4 = new Date(now - 40_000);

    // Seed duplicate rows for key1:
    // row1: earliest non-skipped (created_at = t1)
    // row2: later duplicate non-skipped (created_at = t2)
    // row3: even later duplicate non-skipped (created_at = t3)
    // row4: already skipped (created_at = t4)
    const [row1] = await sql<{ id: string }[]>`
      INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, reason, created_at, updated_at)
      VALUES (${companyId}, ${agentId}, 'automation', ${key1}, 'queued', 'earliest_attempt', ${t1}, ${t1})
      RETURNING id
    `;
    const [row2] = await sql<{ id: string }[]>`
      INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, reason, created_at, updated_at)
      VALUES (${companyId}, ${agentId}, 'automation', ${key1}, 'queued', 'duplicate_attempt_2', ${t2}, ${t2})
      RETURNING id
    `;
    const [row3] = await sql<{ id: string }[]>`
      INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, reason, created_at, updated_at)
      VALUES (${companyId}, ${agentId}, 'automation', ${key1}, 'failed', 'duplicate_attempt_3', ${t3}, ${t3})
      RETURNING id
    `;
    const [row4] = await sql<{ id: string }[]>`
      INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, reason, created_at, updated_at)
      VALUES (${companyId}, ${agentId}, 'automation', ${key1}, 'skipped', 'pre_existing_skipped', ${t4}, ${t4})
      RETURNING id
    `;

    // Seed key2 with 2 rows
    const [rowK2A] = await sql<{ id: string }[]>`
      INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, reason, created_at, updated_at)
      VALUES (${companyId}, ${agentId}, 'automation', ${key2}, 'running', 'k2_earliest', ${t1}, ${t1})
      RETURNING id
    `;
    const [rowK2B] = await sql<{ id: string }[]>`
      INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, reason, created_at, updated_at)
      VALUES (${companyId}, ${agentId}, 'automation', ${key2}, 'queued', 'k2_later', ${t2}, ${t2})
      RETURNING id
    `;

    // 3. Run migration statements
    const statements = await findRapidProwlerStatements();
    expect(statements.length).toBeGreaterThanOrEqual(2);

    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }

    // 4. Verify no data deleted
    const allKey1Rows = await sql<{ id: string; status: string; reason: string }[]>`
      SELECT id, status, reason FROM agent_wakeup_requests WHERE company_id = ${companyId} AND idempotency_key = ${key1} ORDER BY created_at ASC
    `;
    expect(allKey1Rows).toHaveLength(4);

    // Verify row 1 retained its non-skipped status
    const postRow1 = allKey1Rows.find((r) => r.id === row1.id);
    expect(postRow1?.status).toBe("queued");
    expect(postRow1?.reason).toBe("earliest_attempt");

    // Verify row 2 and 3 became skipped
    const postRow2 = allKey1Rows.find((r) => r.id === row2.id);
    expect(postRow2?.status).toBe("skipped");

    const postRow3 = allKey1Rows.find((r) => r.id === row3.id);
    expect(postRow3?.status).toBe("skipped");

    // Verify row 4 stayed skipped
    const postRow4 = allKey1Rows.find((r) => r.id === row4.id);
    expect(postRow4?.status).toBe("skipped");

    // Verify key 2 rows
    const postK2A = await sql<{ status: string }[]>`
      SELECT status FROM agent_wakeup_requests WHERE id = ${rowK2A.id}
    `;
    expect(postK2A[0]?.status).toBe("running");

    const postK2B = await sql<{ status: string }[]>`
      SELECT status FROM agent_wakeup_requests WHERE id = ${rowK2B.id}
    `;
    expect(postK2B[0]?.status).toBe("skipped");

    // 5. Verify index exists and enforces uniqueness for non-skipped rows
    const indexRows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'agent_wakeup_requests'
        AND indexname = 'agent_wakeup_requests_review_handoff_retry_idempotency_uq'
    `;
    expect(indexRows).toHaveLength(1);

    // Inserting a duplicate non-skipped row for key1 must fail
    await expect(
      sql`
        INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, created_at, updated_at)
        VALUES (${companyId}, ${agentId}, 'automation', ${key1}, 'queued', now(), now())
      `,
    ).rejects.toThrow();

    // Inserting another skipped row for key1 must succeed
    const insertedSkipped = await sql<{ id: string }[]>`
      INSERT INTO agent_wakeup_requests (company_id, agent_id, source, idempotency_key, status, created_at, updated_at)
      VALUES (${companyId}, ${agentId}, 'automation', ${key1}, 'skipped', now(), now())
      RETURNING id
    `;
    expect(insertedSkipped).toHaveLength(1);

    // 6. Verify idempotency - running migration statements again succeeds cleanly
    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }
  }, 120_000);
});
