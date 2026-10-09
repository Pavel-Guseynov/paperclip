import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import {
  describeStatement,
  setDatabaseObserver,
  type DatabaseObserver,
  type DatabasePoolSnapshot,
  type DatabaseStatementInfo,
  type DatabaseStatementOutcome,
} from "./query-observer.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

describe("describeStatement", () => {
  it("collapses whitespace and reads the operation and main table", () => {
    expect(
      describeStatement('select "id",\n   "title"\n  from "public"."issues" where "id" = $1'),
    ).toEqual({
      statement: 'select "id", "title" from "public"."issues" where "id" = $1',
      operation: "SELECT",
      table: "issues",
    });
  });

  it("folds IN lists so one statement shape has one text regardless of arity", () => {
    const two = describeStatement('select 1 from "issues" where "id" in ($1, $2)');
    const five = describeStatement('select 1 from "issues" where "id" in ($1, $2, $3, $4, $5)');
    expect(five.statement).toBe(two.statement);
    expect(two.statement).toBe('select 1 from "issues" where "id" in ($…)');
  });

  it("folds multi-row VALUES lists", () => {
    expect(
      describeStatement('insert into "activity_log" ("a", "b") values ($1, $2), ($3, $4), ($5, $6)'),
    ).toMatchObject({
      statement: 'insert into "activity_log" ("a", "b") values ($…), …',
      operation: "INSERT",
      table: "activity_log",
    });
  });

  it("reports a null table when the statement names none and truncates very long text", () => {
    expect(describeStatement("select 1")).toEqual({ statement: "select 1", operation: "SELECT", table: null });
    const long = describeStatement(`select ${"x, ".repeat(3000)}y`);
    expect(long.statement.length).toBe(4097);
    expect(long.statement.endsWith("…")).toBe(true);
  });
});

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

interface RecordedStatement {
  info: DatabaseStatementInfo;
  queueWaitMs: number | null;
  outcome: DatabaseStatementOutcome | null;
}

function createRecordingObserver() {
  const statements: RecordedStatement[] = [];
  const pools: Array<() => DatabasePoolSnapshot> = [];
  const observer: DatabaseObserver = {
    startStatement(info) {
      const record: RecordedStatement = { info, queueWaitMs: null, outcome: null };
      statements.push(record);
      return {
        started: (queueWaitMs) => {
          record.queueWaitMs = queueWaitMs;
        },
        finish: (outcome) => {
          record.outcome = outcome;
        },
      };
    },
    observePool(read) {
      pools.push(read);
    },
  };
  return { observer, statements, pools };
}

describeDatabase("database query observation", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-query-observer-");
  }, 60_000);

  afterEach(() => setDatabaseObserver(null));

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("reports each statement with its text, row count and queue wait", async () => {
    const recording = createRecordingObserver();
    setDatabaseObserver(recording.observer);
    const db = createDb(tempDb!.connectionString);

    await db.execute(sql`select generate_series(1, 3) as n`);

    const observed = recording.statements.find((entry) => entry.info.statement.includes("generate_series"));
    expect(observed).toMatchObject({
      info: { operation: "SELECT", table: null },
      outcome: { rowCount: 3 },
    });
    expect(observed?.queueWaitMs).toBeGreaterThanOrEqual(0);
    expect(observed?.outcome?.error).toBeUndefined();
  });

  it("reports a failed statement with its error and no row count", async () => {
    const recording = createRecordingObserver();
    setDatabaseObserver(recording.observer);
    const db = createDb(tempDb!.connectionString);

    await expect(db.execute(sql`select * from "table_that_does_not_exist"`)).rejects.toThrow();

    const observed = recording.statements.find((entry) => entry.info.statement.includes("table_that_does_not_exist"));
    expect(observed?.info.table).toBe("table_that_does_not_exist");
    expect(observed?.outcome?.rowCount).toBeNull();
    expect(observed?.outcome?.error).toBeInstanceOf(Error);
  });

  it("reports statements that run inside a transaction", async () => {
    const recording = createRecordingObserver();
    setDatabaseObserver(recording.observer);
    const db = createDb(tempDb!.connectionString);

    await db.transaction(async (tx) => {
      await tx.execute(sql`select 41 + 1 as answer`);
    });

    const observed = recording.statements.find((entry) => entry.info.statement.includes("41 + 1"));
    expect(observed?.outcome).toEqual({ rowCount: 1 });
  });

  it("shows a statement waiting for the only connection, then its queue wait", async () => {
    const recording = createRecordingObserver();
    setDatabaseObserver(recording.observer);
    const db = createDb(tempDb!.connectionString, { maxConnections: 1 });
    expect(recording.pools).toHaveLength(1);
    const snapshot = recording.pools[0]!;

    let waitingWhileHeld: DatabasePoolSnapshot | null = null;
    let queued: Promise<unknown> | null = null;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 as holder`);
      // drizzle runs the query once something consumes it; the single
      // connection is held by this transaction, so it can only queue.
      queued = db.execute(sql`select 2 as queued`).then((rows) => rows);
      await new Promise<void>((resolve) => setImmediate(resolve));
      waitingWhileHeld = snapshot();
    });
    await queued;

    expect(waitingWhileHeld).toEqual({ max: 1, inUse: 0, waiting: 1 });
    expect(snapshot()).toEqual({ max: 1, inUse: 0, waiting: 0 });
    const observed = recording.statements.find((entry) => entry.info.statement.includes("2 as queued"));
    expect(observed?.queueWaitMs).toBeGreaterThan(0);
    expect(observed?.outcome).toEqual({ rowCount: 1 });
  });

  it("leaves the client unwrapped when no observer is installed", async () => {
    const db = createDb(tempDb!.connectionString);
    await expect(db.execute(sql`select 1 as one`)).resolves.toHaveLength(1);
  });
});
