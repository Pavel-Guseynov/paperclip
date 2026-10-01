import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

type HeartbeatRun = typeof heartbeatRuns.$inferSelect;

/** Columns a status transition may write besides `status`, which only the authority sets. */
export type HeartbeatRunStatusPatch = Omit<PgUpdateSetSource<typeof heartbeatRuns>, "id" | "status">;

/** Plain column values for a status transition, without `status`. */
export type HeartbeatRunValuesPatch = Partial<Omit<typeof heartbeatRuns.$inferInsert, "id" | "status">>;

/** One committed change of a run's status. */
export interface HeartbeatRunStatusTransition {
  /** Unique per transition: run, `clock_timestamp()` microseconds, and target status. */
  eventId: string;
  runId: string;
  fromStatus: string;
  toStatus: string;
  /** `clock_timestamp()` read while the row lock was held, in microseconds since the epoch. */
  transitionedAtEpochUs: string;
}

export interface TransitionHeartbeatRunStatusOptions {
  toStatus: string;
  patch?: HeartbeatRunStatusPatch;
  /** Extra compare-and-set condition; the transition does nothing unless the locked row matches. */
  where?: SQL;
}

/**
 * The only writer of `heartbeat_runs.status`.
 *
 * It locks the run row, reads `clock_timestamp()` under that lock, and then
 * writes the new status with the patch. Concurrent transitions of one run
 * therefore commit in lock order, each sees the status the previous one
 * committed, and their timestamps increase in that order. A transition to the
 * status the run already has writes only the patch and reports no transition.
 * Returns null when the run does not exist or does not match `where`.
 */
export async function transitionHeartbeatRunStatus(
  dbOrTx: Db | DbTransaction,
  runId: string,
  options: TransitionHeartbeatRunStatusOptions,
): Promise<{ run: HeartbeatRun; transition: HeartbeatRunStatusTransition | null } | null> {
  if (options.patch && "status" in options.patch) {
    throw new Error("transitionHeartbeatRunStatus: pass the status as toStatus, not in the patch");
  }
  const runInTransaction = async (tx: DbTransaction) => {
    const where = options.where ? and(eq(heartbeatRuns.id, runId), options.where) : eq(heartbeatRuns.id, runId);
    const [locked] = await tx
      .select({
        status: heartbeatRuns.status,
        transitionedAtEpochUs: sql<string>`(extract(epoch from clock_timestamp()) * 1000000)::bigint::text`,
      })
      .from(heartbeatRuns)
      .where(where)
      .for("update");
    if (!locked) return null;

    if (locked.status === options.toStatus) {
      const run = options.patch && Object.keys(options.patch).length > 0
        ? (await tx.update(heartbeatRuns).set(options.patch).where(eq(heartbeatRuns.id, runId)).returning())[0]
        : (await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0];
      return run ? { run, transition: null } : null;
    }

    const [run] = await tx
      .update(heartbeatRuns)
      .set({ ...options.patch, status: options.toStatus })
      .where(eq(heartbeatRuns.id, runId))
      .returning();
    if (!run) return null;
    return {
      run,
      transition: {
        eventId: `run:${runId}:${locked.transitionedAtEpochUs}:${options.toStatus}`,
        runId,
        fromStatus: locked.status,
        toStatus: options.toStatus,
        transitionedAtEpochUs: locked.transitionedAtEpochUs,
      },
    };
  };
  // A drizzle transaction exposes `rollback`; the database handle does not.
  // A handle without `transaction` can only be a transaction already.
  return "rollback" in dbOrTx || typeof dbOrTx.transaction !== "function"
    ? runInTransaction(dbOrTx as DbTransaction)
    : dbOrTx.transaction(runInTransaction);
}
