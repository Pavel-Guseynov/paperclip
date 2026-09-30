import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns, registerPostCommitHook } from "@paperclipai/db";
import { emitLifecycleRecordToStderr } from "./task-lifecycle-logging.js";

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface RunCancellationAttribution {
  cancellationOrigin?: string | null;
  cancellationActor?: { actorType: string; actorId: string } | null;
  triggerDetail?: string | null;
}

export interface TransitionHeartbeatRunStatusOptions {
  toStatus: string;
  patch?: Record<string, any>;
  phase?: "queued" | "started" | "retrying" | "finished";
  outcome?: "succeeded" | "failed" | "cancelled" | "timed_out" | "interrupted" | null;
  cancellationAttribution?: RunCancellationAttribution | null;
  error?: { code: string; message: string } | null;
  postCommitRecords?: Array<any>;
  whereCondition?: any;
}

export interface RunLifecycleEventAttributes {
  eventId: string;
  eventType: "run_transition";
  runId: string;
  taskId: string | null;
  companyId: string;
  agentId: string;
  agentName: string;
  status: string;
  phase: string;
  outcome: string | null;
  committedAtMs: number;
  retryOfRunId: string | null;
  scheduledRetryAttempt: number | null;
  scheduledRetryReason: string | null;
  cancellationOrigin: string | null;
  cancellationActor: { actorType: string; actorId: string } | null;
  triggerDetail: string | null;
  error: { code: string; message: string } | null;
}

export interface RunLifecycleRecord {
  schemaVersion: 1;
  timestamp: string;
  time_unix_nano: string;
  level: "info";
  service: "paperclip";
  action: "heartbeat_run_lifecycle";
  message: string;
  attributes: RunLifecycleEventAttributes;
  error: null;
}

export function derivePhase(status: string): "queued" | "started" | "retrying" | "finished" {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "started";
    case "scheduled_retry":
      return "retrying";
    case "succeeded":
    case "failed":
    case "cancelled":
    case "timed_out":
    case "interrupted":
      return "finished";
    default:
      return "finished";
  }
}

export function deriveOutcome(status: string): "succeeded" | "failed" | "cancelled" | "timed_out" | "interrupted" | null {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    case "interrupted":
      return "interrupted";
    default:
      return null;
  }
}

export function formatRunLifecycleRecord(attributes: RunLifecycleEventAttributes): RunLifecycleRecord {
  const ts = new Date(attributes.committedAtMs).toISOString();
  const timeUnixNano = (BigInt(attributes.committedAtMs) * 1_000_000n).toString();
  const msg = attributes.outcome
    ? `Run ${attributes.runId} finished with outcome ${attributes.outcome}`
    : `Run ${attributes.runId} transitioned to ${attributes.status} (phase: ${attributes.phase})`;

  return {
    schemaVersion: 1,
    timestamp: ts,
    time_unix_nano: timeUnixNano,
    level: "info",
    service: "paperclip",
    action: "heartbeat_run_lifecycle",
    message: msg,
    attributes,
    error: null,
  };
}

export function formatRunInsertionLifecycleRecord(
  run: typeof heartbeatRuns.$inferSelect,
  agentName: string,
  committedAtMs: number,
  triggerDetail?: string | null,
): RunLifecycleRecord {
  const eventId = `run:${run.id}:${committedAtMs * 1000}:${run.status}`;
  return formatRunLifecycleRecord({
    eventId,
    eventType: "run_transition",
    runId: run.id,
    taskId: (run as any).taskId ?? run.nativeIssueId ?? ((run.contextSnapshot as Record<string, unknown> | null)?.issueId as string | undefined) ?? null,
    companyId: run.companyId,
    agentId: run.agentId,
    agentName,
    status: run.status,
    phase: derivePhase(run.status),
    outcome: deriveOutcome(run.status),
    committedAtMs,
    retryOfRunId: run.retryOfRunId ?? null,
    scheduledRetryAttempt: run.scheduledRetryAttempt ?? null,
    scheduledRetryReason: run.scheduledRetryReason ?? null,
    cancellationOrigin: null,
    cancellationActor: null,
    triggerDetail: triggerDetail ?? null,
    error: null,
  });
}

/**
 * Single authority for updating heartbeat run statuses across the server codebase.
 * Enforces:
 * - Row lock serialization (SELECT ... FOR UPDATE)
 * - clock_timestamp() evaluated under lock at microsecond precision
 * - Same-status idempotency (zero records emitted if status unchanged)
 * - Unique eventId derived from transition's microsecond timestamp
 * - Cancellation origin and actor attribution without fake fallbacks
 * - Post-commit lifecycle record emission to stderr (S6)
 */
export async function transitionHeartbeatRunStatus(
  dbOrTx: Db | DbTransaction,
  runId: string,
  options: TransitionHeartbeatRunStatusOptions,
): Promise<typeof heartbeatRuns.$inferSelect | null> {
  const stagedRecords: RunLifecycleRecord[] = [];

  const runOperation = async (tx: DbTransaction) => {
    const whereClause = options.whereCondition
      ? and(eq(heartbeatRuns.id, runId), options.whereCondition)
      : eq(heartbeatRuns.id, runId);

    const rows = await tx
      .select({
        run: heartbeatRuns,
        committedAtEpochUs: sql<string>`(extract(epoch from clock_timestamp()) * 1000000)::bigint::text`,
      })
      .from(heartbeatRuns)
      .where(whereClause)
      .for("update");

    const existing = rows[0] ?? null;
    if (!existing) return null;

    let agentName = "agent";
    if (existing.run.agentId) {
      const [agent] = await tx
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, existing.run.agentId));
      if (agent?.name) {
        agentName = agent.name;
      }
    }

    // Idempotent same-status check
    if (existing.run.status === options.toStatus) {
      if (options.patch && Object.keys(options.patch).length > 0) {
        const [updated] = await tx
          .update(heartbeatRuns)
          .set(options.patch)
          .where(whereClause)
          .returning();
        return updated ?? existing.run;
      }
      return existing.run;
    }

    const patchPayload = {
      ...(options.patch ?? {}),
      status: options.toStatus,
    };

    const [updated] = await tx
      .update(heartbeatRuns)
      .set(patchPayload)
      .where(whereClause)
      .returning();

    if (!updated) return null;

    const phase = options.phase ?? derivePhase(options.toStatus);
    const outcome = options.outcome !== undefined ? options.outcome : deriveOutcome(options.toStatus);
    const committedAtMs = Math.floor(Number(existing.committedAtEpochUs) / 1000);
    const eventId = `run:${runId}:${existing.committedAtEpochUs}:${options.toStatus}`;

    let cancellationOrigin = options.cancellationAttribution?.cancellationOrigin ?? null;
    let cancellationActor = options.cancellationAttribution?.cancellationActor ?? null;
    let triggerDetail = options.cancellationAttribution?.triggerDetail ?? null;

    if (options.toStatus === "cancelled" && !cancellationOrigin) {
      cancellationOrigin = "unattributed_abort";
      cancellationActor = null;
    }

    const record = formatRunLifecycleRecord({
      eventId,
      eventType: "run_transition",
      runId: updated.id,
      taskId: (updated as any).taskId ?? updated.nativeIssueId ?? ((updated.contextSnapshot as Record<string, unknown> | null)?.issueId as string | undefined) ?? null,
      companyId: updated.companyId,
      agentId: updated.agentId,
      agentName,
      status: updated.status,
      phase,
      outcome,
      committedAtMs,
      retryOfRunId: updated.retryOfRunId ?? null,
      scheduledRetryAttempt: updated.scheduledRetryAttempt ?? null,
      scheduledRetryReason: updated.scheduledRetryReason ?? null,
      cancellationOrigin,
      cancellationActor,
      triggerDetail,
      error: options.error ?? null,
    });

    stagedRecords.push(record);

    if (options.postCommitRecords) {
      options.postCommitRecords.push(...stagedRecords);
    } else {
      const registered = registerPostCommitHook(tx, () => {
        for (const record of stagedRecords) {
          emitLifecycleRecordToStderr(record);
        }
      });
      if (!registered) {
        throw new Error(
          `missing_post_commit_hooks: cannot guarantee post-commit lifecycle emission for run ${runId}`,
        );
      }
    }

    return updated;
  };

  const isTx = typeof (dbOrTx as any).rollback === "function" || !("transaction" in dbOrTx);
  let result: typeof heartbeatRuns.$inferSelect | null;

  if (isTx) {
    result = await runOperation(dbOrTx as DbTransaction);
  } else {
    result = await (dbOrTx as Db).transaction(runOperation);
  }

  return result;
}
