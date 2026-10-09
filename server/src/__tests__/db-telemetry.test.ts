import { createDb, setDatabaseObserver } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabaseTelemetryObserver,
  type DatabaseTelemetryMeter,
  type DatabaseTelemetryTracer,
} from "../db-telemetry.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

type Attributes = Record<string, string | number | boolean>;

function createFakes() {
  const spans: Array<{
    name: string;
    kind: number | undefined;
    attributes: Attributes;
    status: { code: number; message?: string } | null;
    ended: boolean;
  }> = [];
  const tracer: DatabaseTelemetryTracer = {
    startSpan(name, options) {
      const span = { name, kind: options?.kind, attributes: { ...options?.attributes }, status: null as { code: number; message?: string } | null, ended: false };
      spans.push(span);
      return {
        setAttribute: (key, value) => {
          span.attributes[key] = value;
        },
        setStatus: (status) => {
          span.status = status;
        },
        end: () => {
          span.ended = true;
        },
      };
    },
  };
  const histograms = new Map<string, Array<{ value: number; attributes: Attributes | undefined }>>();
  const gauges = new Map<string, Array<(result: { observe(value: number): void }) => void>>();
  const meter: DatabaseTelemetryMeter = {
    createHistogram(name) {
      const records: Array<{ value: number; attributes: Attributes | undefined }> = [];
      histograms.set(name, records);
      return { record: (value, attributes) => void records.push({ value, attributes }) };
    },
    createObservableGauge(name) {
      const callbacks: Array<(result: { observe(value: number): void }) => void> = [];
      gauges.set(name, callbacks);
      return { addCallback: (callback) => void callbacks.push(callback) };
    },
  };
  const gauge = (name: string) => {
    let total = 0;
    for (const callback of gauges.get(name) ?? []) callback({ observe: (value) => void (total += value) });
    return total;
  };
  return { spans, tracer, histograms, meter, gauge };
}

describe("createDatabaseTelemetryObserver", () => {
  it("emits one CLIENT span per statement with the normalized text, queue wait and row count", () => {
    const fakes = createFakes();
    const observer = createDatabaseTelemetryObserver({ tracer: fakes.tracer, meter: fakes.meter });

    const observation = observer.startStatement({
      statement: 'select "id" from "issues" where "id" = $1',
      operation: "SELECT",
      table: "issues",
    });
    observation.started(12.5);
    observation.finish({ rowCount: 7 });

    expect(fakes.spans).toEqual([
      {
        name: "SELECT issues",
        kind: 2,
        attributes: {
          "db.system.name": "postgresql",
          "db.operation.name": "SELECT",
          "db.collection.name": "issues",
          "db.query.text": 'select "id" from "issues" where "id" = $1',
          "paperclip.db.queue_wait_ms": 12.5,
          "db.response.returned_rows": 7,
        },
        status: null,
        ended: true,
      },
    ]);
    expect(fakes.histograms.get("db.client.connection.wait_time")).toEqual([
      { value: 0.0125, attributes: { "db.system.name": "postgresql", "db.operation.name": "SELECT", "db.collection.name": "issues" } },
    ]);
    expect(fakes.histograms.get("db.client.response.returned_rows")?.map((entry) => entry.value)).toEqual([7]);
    expect(fakes.histograms.get("db.client.operation.duration")).toHaveLength(1);
    expect(fakes.histograms.get("db.client.operation.duration")?.[0]?.value).toBeGreaterThanOrEqual(0);
  });

  it("marks a failed statement as an error span and tags its duration with the error type", () => {
    const fakes = createFakes();
    const observer = createDatabaseTelemetryObserver({ tracer: fakes.tracer, meter: fakes.meter });

    const observation = observer.startStatement({ statement: "select 1", operation: "SELECT", table: null });
    observation.finish({ rowCount: null, error: new TypeError("boom") });

    expect(fakes.spans[0]).toMatchObject({
      name: "SELECT",
      attributes: { "error.type": "TypeError" },
      status: { code: 2, message: "boom" },
      ended: true,
    });
    expect(fakes.spans[0]?.attributes).not.toHaveProperty("db.response.returned_rows");
    expect(fakes.histograms.get("db.client.operation.duration")?.[0]?.attributes).toMatchObject({ "error.type": "TypeError" });
    expect(fakes.histograms.get("db.client.response.returned_rows")).toEqual([]);
  });

  it("reports pool gauges summed over every observed client", () => {
    const fakes = createFakes();
    const observer = createDatabaseTelemetryObserver({ tracer: fakes.tracer, meter: fakes.meter });
    observer.observePool(() => ({ max: 10, inUse: 4, waiting: 2 }));
    observer.observePool(() => ({ max: 1, inUse: 1, waiting: 0 }));

    expect(fakes.gauge("db.client.connection.max")).toBe(11);
    expect(fakes.gauge("db.client.connection.used")).toBe(5);
    expect(fakes.gauge("db.client.connection.pending_requests")).toBe(2);
  });
});

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("database telemetry against a real database", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-db-telemetry-");
  }, 60_000);

  afterEach(() => setDatabaseObserver(null));

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("emits a span with the real row count for a statement run through createDb", async () => {
    const fakes = createFakes();
    setDatabaseObserver(createDatabaseTelemetryObserver({ tracer: fakes.tracer, meter: fakes.meter }));
    const db = createDb(tempDb!.connectionString);

    await db.execute(sql`select generate_series(1, 4) as n`);

    const span = fakes.spans.find((entry) => String(entry.attributes["db.query.text"]).includes("generate_series"));
    expect(span?.attributes["db.response.returned_rows"]).toBe(4);
    expect(span?.attributes["db.operation.name"]).toBe("SELECT");
    expect(span?.attributes["paperclip.db.queue_wait_ms"]).toBeGreaterThanOrEqual(0);
    expect(span?.ended).toBe(true);
    expect(fakes.gauge("db.client.connection.max")).toBe(10);
  });
});
