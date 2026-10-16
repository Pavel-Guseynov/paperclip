import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  SHARED_TEST_POSTGRES_TEMPLATE,
  SHARED_TEST_POSTGRES_URL_ENV,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;
const gateDatabaseUrl = process.env[SHARED_TEST_POSTGRES_URL_ENV];
const describeNixGate = process.env.NIX_BUILD_TOP ? describe : describe.skip;

describeNixGate("Nix-owned PostgreSQL endpoint", () => {
  it("serves the gate over a private socket without reserving a host TCP port", async () => {
    expect(gateDatabaseUrl).toBeTruthy();
    const client = postgres(gateDatabaseUrl!, { max: 1 });
    try {
      const [endpoint] = await client`
        select inet_server_addr()::text as address,
          current_setting('listen_addresses') as tcp_listeners
      `;
      expect(endpoint).toEqual({ address: null, tcp_listeners: "" });
    } finally {
      await client.end();
    }
  });
});

describeDatabase("shared test Postgres cluster", () => {
  let cluster: EmbeddedPostgresTestDatabase;
  let adminUrl: string;

  beforeAll(async () => {
    // One real cluster stands in for the shared one: its migrated database becomes the template.
    // Always an embedded cluster here, even when the gate itself provides a shared one.
    const inherited = process.env[SHARED_TEST_POSTGRES_URL_ENV];
    delete process.env[SHARED_TEST_POSTGRES_URL_ENV];
    try {
      cluster = await startEmbeddedPostgresTestDatabase("paperclip-shared-template-");
    } finally {
      if (inherited !== undefined) process.env[SHARED_TEST_POSTGRES_URL_ENV] = inherited;
    }
    const admin = new URL(cluster.connectionString);
    admin.pathname = "/postgres";
    adminUrl = admin.toString();
    const sql = postgres(adminUrl, { max: 1 });
    try {
      await sql.unsafe(`create database "${SHARED_TEST_POSTGRES_TEMPLATE}" template "paperclip"`);
    } finally {
      await sql.end();
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterEach(() => {
    delete process.env[SHARED_TEST_POSTGRES_URL_ENV];
  });

  afterAll(async () => {
    await cluster?.cleanup();
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  async function tables(connectionString: string): Promise<string[]> {
    const sql = postgres(connectionString, { max: 1 });
    try {
      const rows = await sql<{ name: string }[]>`select tablename as name from pg_tables where schemaname = 'public'`;
      return rows.map((row) => row.name);
    } finally {
      await sql.end();
    }
  }

  it("gives each suite a database that already holds the migrated schema", async () => {
    process.env[SHARED_TEST_POSTGRES_URL_ENV] = adminUrl;

    const database = await startEmbeddedPostgresTestDatabase("unused-");

    expect(await tables(database.connectionString)).toContain("companies");
    await database.cleanup();
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("keeps suites isolated and removes a suite's database on cleanup", async () => {
    process.env[SHARED_TEST_POSTGRES_URL_ENV] = adminUrl;
    const first = await startEmbeddedPostgresTestDatabase("unused-");
    const second = await startEmbeddedPostgresTestDatabase("unused-");
    const sql = postgres(first.connectionString, { max: 1 });
    try {
      await sql`create table suite_marker (id integer)`;
    } finally {
      await sql.end();
    }

    expect(await tables(first.connectionString)).toContain("suite_marker");
    expect(await tables(second.connectionString)).not.toContain("suite_marker");

    await first.cleanup();
    await second.cleanup();
    const admin = postgres(adminUrl, { max: 1 });
    try {
      const left = await admin`select datname from pg_database where datname like 'paperclip_test_%'`;
      expect(left).toHaveLength(0);
    } finally {
      await admin.end();
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("reports the cluster unsupported when it has no template database", async () => {
    const empty = new URL(adminUrl);
    process.env[SHARED_TEST_POSTGRES_URL_ENV] = empty.toString();
    const sql = postgres(adminUrl, { max: 1 });
    try {
      await sql.unsafe(`alter database "${SHARED_TEST_POSTGRES_TEMPLATE}" rename to renamed_template`);
      const missing = await (await import("./test-embedded-postgres.js")).probeSharedTestPostgresForTests(adminUrl);
      expect(missing.supported).toBe(false);
      expect(missing.reason).toContain(SHARED_TEST_POSTGRES_TEMPLATE);
    } finally {
      await sql.unsafe(`alter database renamed_template rename to "${SHARED_TEST_POSTGRES_TEMPLATE}"`);
      await sql.end();
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
