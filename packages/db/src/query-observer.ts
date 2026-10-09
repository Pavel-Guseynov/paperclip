import type { Sql } from "postgres";

/**
 * Query observation seam for the postgres.js client.
 *
 * `packages/db` carries no telemetry dependency. A host (the server) installs
 * one `DatabaseObserver` before it opens a client, and every client created
 * afterwards reports each statement and its pool state to it. With no observer
 * installed the client is returned unwrapped, so the seam costs nothing.
 *
 * postgres.js exposes no pool statistics. The tracker below derives them from
 * the two points the driver does expose: the call into `unsafe` and the
 * `debug` hook, which fires when a statement starts on a connection. The time
 * between those two points is the queue wait for a free connection.
 */

export interface DatabaseStatementInfo {
  /** Statement text with whitespace collapsed and long parameter lists folded. Never contains parameter values. */
  statement: string;
  /** Leading SQL keyword in upper case, e.g. `SELECT`; null when none is found. */
  operation: string | null;
  /** Main table the statement reads or writes, without schema or quotes; null when none is found. */
  table: string | null;
}

export interface DatabaseStatementOutcome {
  /** Rows returned or affected; null when the driver result carries no count. */
  rowCount: number | null;
  error?: unknown;
}

export interface DatabaseStatementObservation {
  /** The driver started the statement on a connection after waiting `queueWaitMs` for one. */
  started(queueWaitMs: number): void;
  finish(outcome: DatabaseStatementOutcome): void;
}

export interface DatabasePoolSnapshot {
  /** Configured pool size (`max`). */
  max: number;
  /** Statements currently running on a connection. */
  inUse: number;
  /** Statements waiting for a free connection. */
  waiting: number;
}

export interface DatabaseObserver {
  startStatement(info: DatabaseStatementInfo): DatabaseStatementObservation;
  /** Called once per client; the observer polls `read` when it reports pool state. */
  observePool(read: () => DatabasePoolSnapshot): void;
}

let installedObserver: DatabaseObserver | null = null;

export function setDatabaseObserver(observer: DatabaseObserver | null): void {
  installedObserver = observer;
}

export function getDatabaseObserver(): DatabaseObserver | null {
  return installedObserver;
}

const MAX_STATEMENT_LENGTH = 4096;
const PARAMETER_LIST = String.raw`\$\d+(?:\s*,\s*\$\d+)*`;
const TABLE_PATTERN = /\b(?:from|into|update|join)\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\.(?:"[^"]+"|[A-Za-z_]\w*))?)/i;

/** Folds parameter lists so one statement shape maps to one string regardless of arity. */
export function describeStatement(rawStatement: string): DatabaseStatementInfo {
  let statement = rawStatement.replace(/\s+/g, " ").trim();
  statement = statement.replace(new RegExp(String.raw`\(\s*${PARAMETER_LIST}\s*\)(?:\s*,\s*\(\s*${PARAMETER_LIST}\s*\))+`, "g"), "($…), …");
  statement = statement.replace(new RegExp(String.raw`\bin\s*\(\s*${PARAMETER_LIST}\s*\)`, "gi"), "in ($…)");
  if (statement.length > MAX_STATEMENT_LENGTH) statement = `${statement.slice(0, MAX_STATEMENT_LENGTH)}…`;
  const operation = /^\(?\s*([A-Za-z]+)/.exec(statement)?.[1]?.toUpperCase() ?? null;
  const tableMatch = TABLE_PATTERN.exec(statement)?.[1] ?? null;
  const table = tableMatch ? (tableMatch.split(".").pop() ?? null)?.replace(/^"|"$/g, "") ?? null : null;
  return { statement, operation, table };
}

function rowCountOf(result: unknown): number | null {
  if (!Array.isArray(result)) return null;
  const count = (result as { count?: unknown }).count;
  return typeof count === "number" ? count : result.length;
}

interface TrackedStatement {
  queuedAt: number;
  started: boolean;
  finished: boolean;
  observation: DatabaseStatementObservation;
}

export interface QueryTracker {
  /** Pass as the postgres.js `debug` option. */
  debug: (connectionId: number, statement: string) => void;
  /** Wraps a client so each `unsafe` call and each transaction-scoped client reports to the observer. */
  instrument: <T extends Sql>(sql: T) => T;
  snapshot: () => DatabasePoolSnapshot;
}

export function createQueryTracker(observer: DatabaseObserver, max: number, now: () => number = performance.now.bind(performance)): QueryTracker {
  // Statements waiting for a connection, keyed by exact text. The driver queue
  // is first-in first-out, so the oldest unstarted statement with the same
  // text is the one its `debug` call announces.
  const byText = new Map<string, TrackedStatement[]>();
  let waiting = 0;
  let inUse = 0;

  const debug = (_connectionId: number, statement: string) => {
    const tracked = byText.get(statement)?.find((entry) => !entry.started);
    if (!tracked) return;
    tracked.started = true;
    waiting -= 1;
    inUse += 1;
    tracked.observation.started(now() - tracked.queuedAt);
  };

  const track = (statement: string): TrackedStatement => {
    const tracked: TrackedStatement = {
      queuedAt: now(),
      started: false,
      finished: false,
      observation: observer.startStatement(describeStatement(statement)),
    };
    const list = byText.get(statement);
    if (list) list.push(tracked);
    else byText.set(statement, [tracked]);
    waiting += 1;
    return tracked;
  };

  const finish = (statement: string, tracked: TrackedStatement, outcome: DatabaseStatementOutcome) => {
    if (tracked.finished) return;
    tracked.finished = true;
    if (tracked.started) inUse -= 1;
    else waiting -= 1;
    const list = byText.get(statement);
    if (list) {
      const index = list.indexOf(tracked);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) byText.delete(statement);
    }
    tracked.observation.finish(outcome);
  };

  const instrumentQuery = (statement: string, real: any): any => {
    let tracked: TrackedStatement | null = null;
    const begin = () => {
      if (tracked) return;
      const current = (tracked = track(statement));
      real.then(
        (result: unknown) => finish(statement, current, { rowCount: rowCountOf(result) }),
        (error: unknown) => finish(statement, current, { rowCount: null, error }),
      );
    };
    const proxy: any = new Proxy(real, {
      get(target, property) {
        if (property === "then" || property === "catch" || property === "finally" || property === "execute") {
          return (...args: unknown[]) => {
            begin();
            const result = target[property](...args);
            return result === target ? proxy : result;
          };
        }
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result === target ? proxy : result;
        };
      },
    });
    return proxy;
  };

  const instrument = <T extends Sql>(sql: T): T =>
    new Proxy(sql, {
      get(target, property, receiver) {
        if (property === "unsafe") {
          return (query: string, ...rest: unknown[]) =>
            instrumentQuery(query, (target.unsafe as (...args: unknown[]) => unknown)(query, ...rest));
        }
        if (property === "begin") {
          return (...args: unknown[]) => {
            const callbackIndex = args.findIndex((argument) => typeof argument === "function");
            if (callbackIndex < 0) return (target.begin as (...a: unknown[]) => unknown)(...args);
            const callback = args[callbackIndex] as (scoped: Sql) => unknown;
            const wrapped = [...args];
            wrapped[callbackIndex] = (scoped: Sql) => callback(instrument(scoped));
            return (target.begin as (...a: unknown[]) => unknown)(...wrapped);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

  return { debug, instrument, snapshot: () => ({ max, inUse, waiting }) };
}
