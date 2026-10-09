// OpenTelemetry reporting for the postgres.js client.
//
// `packages/db` reports every statement and the pool state to a
// `DatabaseObserver`. This module is the observer: one CLIENT span per
// statement, plus duration, queue-wait and row-count histograms and pool gauges.
// It uses the structural tracer/meter shapes below so the module graph stays
// free of the optional OTel SDK packages; a real `@opentelemetry/api` tracer
// and meter satisfy them. `installDatabaseTelemetry()` is called only after the
// SDK started, so with OTel off nothing is installed and the DB client is not
// wrapped.

import { createRequire } from "node:module";
import { setDatabaseObserver, type DatabaseObserver, type DatabasePoolSnapshot } from "@paperclipai/db";

interface TelemetrySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

export interface DatabaseTelemetryTracer {
  startSpan(name: string, options?: { kind?: number; attributes?: Record<string, string | number | boolean> }): TelemetrySpan;
}

interface TelemetryHistogram {
  record(value: number, attributes?: Record<string, string | number | boolean>): void;
}

interface TelemetryObservableResult {
  observe(value: number, attributes?: Record<string, string | number | boolean>): void;
}

interface TelemetryObservable {
  addCallback(callback: (result: TelemetryObservableResult) => void): void;
}

export interface DatabaseTelemetryMeter {
  createHistogram(name: string, options?: { unit?: string; description?: string }): TelemetryHistogram;
  createObservableGauge(name: string, options?: { unit?: string; description?: string }): TelemetryObservable;
}

// `@opentelemetry/api` numeric enum values (SpanKind.CLIENT, SpanStatusCode.ERROR).
const SPAN_KIND_CLIENT = 2;
const SPAN_STATUS_ERROR = 2;

export function createDatabaseTelemetryObserver(input: {
  tracer: DatabaseTelemetryTracer;
  meter: DatabaseTelemetryMeter;
}): DatabaseObserver {
  const { tracer, meter } = input;
  const operationDuration = meter.createHistogram("db.client.operation.duration", {
    unit: "s",
    description: "Duration of a database statement, from queueing for a connection to its result.",
  });
  const queueWait = meter.createHistogram("db.client.connection.wait_time", {
    unit: "s",
    description: "Time a statement waited for a free pooled connection.",
  });
  const returnedRows = meter.createHistogram("db.client.response.returned_rows", {
    unit: "{row}",
    description: "Rows returned or affected by a database statement.",
  });
  const pools = new Set<() => DatabasePoolSnapshot>();
  const sum = (pick: (snapshot: DatabasePoolSnapshot) => number) => {
    let total = 0;
    for (const read of pools) total += pick(read());
    return total;
  };
  meter
    .createObservableGauge("db.client.connection.max", { unit: "{connection}", description: "Configured maximum pooled connections." })
    .addCallback((result) => result.observe(sum((snapshot) => snapshot.max)));
  meter
    .createObservableGauge("db.client.connection.used", { unit: "{connection}", description: "Pooled connections currently running a statement." })
    .addCallback((result) => result.observe(sum((snapshot) => snapshot.inUse)));
  meter
    .createObservableGauge("db.client.connection.pending_requests", { unit: "{request}", description: "Statements waiting for a free pooled connection." })
    .addCallback((result) => result.observe(sum((snapshot) => snapshot.waiting)));

  return {
    startStatement(info) {
      const baseAttributes: Record<string, string> = { "db.system.name": "postgresql" };
      if (info.operation) baseAttributes["db.operation.name"] = info.operation;
      if (info.table) baseAttributes["db.collection.name"] = info.table;
      const startedAt = performance.now();
      const span = tracer.startSpan(info.table ? `${info.operation ?? "QUERY"} ${info.table}` : (info.operation ?? "QUERY"), {
        kind: SPAN_KIND_CLIENT,
        attributes: { ...baseAttributes, "db.query.text": info.statement },
      });
      return {
        started(queueWaitMs) {
          span.setAttribute("paperclip.db.queue_wait_ms", queueWaitMs);
          queueWait.record(queueWaitMs / 1000, baseAttributes);
        },
        finish(outcome) {
          const attributes: Record<string, string> = { ...baseAttributes };
          if (outcome.error !== undefined) {
            const errorType = outcome.error instanceof Error ? outcome.error.name : "Error";
            attributes["error.type"] = errorType;
            span.setAttribute("error.type", errorType);
            span.setStatus({
              code: SPAN_STATUS_ERROR,
              message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
            });
          }
          if (outcome.rowCount !== null) {
            span.setAttribute("db.response.returned_rows", outcome.rowCount);
            returnedRows.record(outcome.rowCount, baseAttributes);
          }
          operationDuration.record((performance.now() - startedAt) / 1000, attributes);
          span.end();
        },
      };
    },
    observePool(read) {
      pools.add(read);
    },
  };
}

let installFailed = false;

/**
 * Installs the OTel database observer. Call after the OTel SDK started and
 * before the first `createDb`. Never throws: without `@opentelemetry/api` it
 * logs once and leaves the DB client unwrapped.
 */
export function installDatabaseTelemetry(): boolean {
  try {
    const require = createRequire(import.meta.url);
    const api = require("@opentelemetry/api") as {
      trace: { getTracer(name: string): DatabaseTelemetryTracer };
      metrics: { getMeter(name: string): DatabaseTelemetryMeter };
    };
    setDatabaseObserver(
      createDatabaseTelemetryObserver({
        tracer: api.trace.getTracer("paperclip.db"),
        meter: api.metrics.getMeter("paperclip.db"),
      }),
    );
    return true;
  } catch (err) {
    if (!installFailed) {
      installFailed = true;
      // eslint-disable-next-line no-console
      console.warn("[paperclip] database telemetry is disabled; @opentelemetry/api is not available.", err);
    }
    return false;
  }
}
