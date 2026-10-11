import { and, desc, eq, inArray, isNotNull, or, sql, type AnyColumn } from "drizzle-orm";
import { environmentLeases, heartbeatRunEvents, heartbeatRuns, issueRecoveryActions, type Db } from "@paperclipai/db";
import { readProcessStartedAt } from "./hot-restart.js";
import { findActiveServerAdapter, listServerAdapters } from "../adapters/index.js";

// These adapters accept a conversation turn. Retrying a process or webhook can
// replay the action itself, so those adapters retain their recovery contract.
export const CONVERSATION_ADAPTER_TYPES = [
  "claude_local", "codex_local", "cursor", "gemini_local", "opencode_local",
  "pi_local", "grok_local", "kimi_local", "hermes_local",
] as const;

export function getConversationAdapterTypes(): string[] {
  const types = new Set<string>(CONVERSATION_ADAPTER_TYPES);
  try {
    for (const adapter of listServerAdapters()) {
      if (adapter.supportsConversationContinuation) {
        types.add(adapter.type);
      }
    }
  } catch {
    // ignore
  }
  return Array.from(types);
}

export function isConversationAdapter(adapterType: string | null | undefined): boolean {
  if (!adapterType) return false;
  if ((CONVERSATION_ADAPTER_TYPES as readonly string[]).includes(adapterType)) {
    return true;
  }
  try {
    const adapter = findActiveServerAdapter(adapterType);
    return adapter?.supportsConversationContinuation === true;
  } catch {
    return false;
  }
}

export const CONVERSATION_CONTINUATION_POLICY = "continue_conversation_v1";

export function hasConversationContinuationPolicy(result: Record<string, unknown> | null | undefined): boolean {
  return result?.conversationContinuation === CONVERSATION_CONTINUATION_POLICY;
}

/** Persisted by the server when it claims the run, before remote provisioning. */
export function claimedAdapterType(run: Pick<typeof heartbeatRuns.$inferSelect, "runnerProfileJson">): string | null {
  const dispatch = run.runnerProfileJson?.adapterDispatch as Record<string, unknown> | undefined;
  return typeof dispatch?.adapterType === "string" ? dispatch.adapterType : null;
}

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/**
 * The run belongs to `issueId`: its native issue id, or the issue id in its
 * context snapshot when it has no native id. This is the same condition as
 * `coalesce(native_issue_id::text, context_snapshot->>'issueId') = issueId`,
 * written as an OR so the native-id index and the context-issue index both
 * apply. The coalesce form matched neither index, so every call scanned all
 * runs and, through the per-run event lookup, all run events.
 */
export function runBelongsToIssue(issueId: string | AnyColumn) {
  const text = typeof issueId === "string" ? sql`${issueId}` : sql`${issueId}::text`;
  const native = typeof issueId !== "string"
    ? sql`${heartbeatRuns.nativeIssueId} = ${issueId}`
    : new RegExp(UUID_PATTERN, "i").test(issueId)
      ? sql`${heartbeatRuns.nativeIssueId} = ${issueId}::uuid`
      : sql`false`;
  return sql`(${native} or (${heartbeatRuns.nativeIssueId} is null and ${heartbeatRuns.contextSnapshot}->>'issueId' = ${text}))`;
}

/** The run id a recovery action recorded in its evidence, as a uuid so `heartbeat_runs.id` stays indexable; null when absent or not a uuid. */
export function evidenceRunId() {
  return sql`(case when ${issueRecoveryActions.evidence}->>'runId' ~* ${UUID_PATTERN} then (${issueRecoveryActions.evidence}->>'runId')::uuid end)`;
}

export function conversationRunPredicate() {
  const types = getConversationAdapterTypes();
  return or(
    inArray(sql`${heartbeatRuns.runnerProfileJson}->'adapterDispatch'->>'adapterType'`, types),
    sql`${heartbeatRuns.resultJson}->>'conversationContinuation' = ${CONVERSATION_CONTINUATION_POLICY}`,
    sql`exists (
      select 1 from ${heartbeatRunEvents}
      where ${heartbeatRunEvents.companyId} = ${heartbeatRuns.companyId}
        and ${heartbeatRunEvents.runId} = ${heartbeatRuns.id}
        and ${heartbeatRunEvents.eventType} = 'adapter.invoke'
        and ${inArray(sql`${heartbeatRunEvents.payload}->>'adapterType'`, types)}
    )`,
  );
}

/** Recovery must not infer the old adapter from the agent's mutable settings. */
export async function historicalAdapterType(db: Db, run: typeof heartbeatRuns.$inferSelect): Promise<string | null> {
  const selected = claimedAdapterType(run);
  if (selected) return selected;
  const [invocation] = await db.select({ payload: heartbeatRunEvents.payload }).from(heartbeatRunEvents)
    .where(and(eq(heartbeatRunEvents.companyId, run.companyId), eq(heartbeatRunEvents.runId, run.id),
      eq(heartbeatRunEvents.eventType, "adapter.invoke")))
    .orderBy(desc(heartbeatRunEvents.seq)).limit(1);
  const adapterType = invocation?.payload?.adapterType;
  return typeof adapterType === "string" ? adapterType : null;
}

export async function runUsedConversationAdapter(db: Db, run: typeof heartbeatRuns.$inferSelect): Promise<boolean> {
  if (hasConversationContinuationPolicy(run.resultJson)) return true;
  const adapterType = await historicalAdapterType(db, run);
  return adapterType !== null && isConversationAdapter(adapterType);
}

/** Only immutable run evidence can retire a historical conversation hold.
 * An agent's current adapter can differ from the one that executed this run.
 * Missing evidence retains the hold; the current agent is never a fallback.
 */
export function conversationRecoveryActionPredicate() {
  return and(
    eq(issueRecoveryActions.cause, "legacy_execution_requires_reconciliation"),
    sql`exists (
      select 1 from ${heartbeatRuns}
      where ${heartbeatRuns.companyId} = ${issueRecoveryActions.companyId}
        and ${heartbeatRuns.id} = ${evidenceRunId()}
        and ${runBelongsToIssue(issueRecoveryActions.sourceIssueId)}
        and ${heartbeatRuns.runtimeMode} = 'legacy'
        and ${inArray(heartbeatRuns.status, ['failed', 'timed_out', 'interrupted', 'cancelled'])}
        and ${conversationRunPredicate()}
        and ${or(
          sql`${heartbeatRuns.resultJson}->>'conversationContinuation' = ${CONVERSATION_CONTINUATION_POLICY}`,
          eq(heartbeatRuns.status, "interrupted"),
          inArray(heartbeatRuns.errorCode, ["process_lost", "server_shutdown_interrupted", "execution_reconciliation_required"]),
          and(eq(heartbeatRuns.status, "cancelled"), sql`${heartbeatRuns.resultJson}->'executionCancellation'->>'state' = 'acknowledged'`),
        )}
    )`,
  );
}

/** OS liveness probes do not signal or stop the process. Unknown ownership holds. */
function processMayBeAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Terminal legacy runs of one issue. Whether they were conversation runs is
 * decided afterwards for just these runs (see `getConversationOwnershipBlocker`):
 * as one predicate the run-event lookup became a hashed subplan that scanned
 * every adapter.invoke event. Exported so its query plan can be asserted.
 */
export function conversationOwnershipRunFilter(companyId: string, issueId: string) {
  return and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.runtimeMode, "legacy"),
    runBelongsToIssue(issueId),
    inArray(heartbeatRuns.status, ["failed", "timed_out", "interrupted", "cancelled"]),
  );
}

/** A terminal conversation row does not prove that its execution authority ended.
 * Other adapters keep their existing bootstrap and ownership protocols.
 */
export async function getConversationOwnershipBlocker(db: Db, companyId: string, issueId: string) {
  const activeLease = sql`exists (select 1 from ${environmentLeases}
    where ${environmentLeases.companyId} = "heartbeat_runs"."company_id"
      and ${environmentLeases.heartbeatRunId} = "heartbeat_runs"."id"
      and (${environmentLeases.releasedAt} is null
        or ${environmentLeases.status} = 'pending_cleanup'
        or ${environmentLeases.cleanupStatus} = 'failed'))`;
  const issueRuns = await db.select({ run: heartbeatRuns, activeLease }).from(heartbeatRuns)
    .where(and(
      conversationOwnershipRunFilter(companyId, issueId),
      or(isNotNull(heartbeatRuns.processPid), isNotNull(heartbeatRuns.processGroupId), activeLease),
    )).orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id));
  if (issueRuns.length === 0) return null;
  const conversationRunIds = new Set((await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
    .where(and(inArray(heartbeatRuns.id, issueRuns.map(({ run }) => run.id)), conversationRunPredicate())))
    .map((row) => row.id));
  const candidates = issueRuns.filter(({ run }) => conversationRunIds.has(run.id));
  for (const { run, activeLease: leaseHeld } of candidates) {
    // A recycled PID cannot keep an old task blocked. An unreadable identity
    // stays conservative; the original process may still own execution.
    const startedDifferently = async (pid: number) => {
      if (!run.processStartedAt) return false;
      const observed = await readProcessStartedAt(pid).catch(() => null);
      return observed !== null && new Date(observed).getTime() !== run.processStartedAt.getTime();
    };
    let pidAlive = run.processPid !== null && processMayBeAlive(run.processPid);
    if (pidAlive && await startedDifferently(run.processPid!)) pidAlive = false;
    // The recorded start time is the provider's, so it identifies the group only when the
    // provider led it: a group led by anything else is judged by its existence alone.
    let groupAlive = run.processGroupId !== null && processMayBeAlive(-run.processGroupId);
    if (groupAlive && run.processGroupId === run.processPid && await startedDifferently(run.processGroupId!)) {
      groupAlive = false;
    }
    if (pidAlive || groupAlive || leaseHeld) {
      return {
        runId: run.id,
        agentId: run.agentId,
        cause: "execution_owner_active",
        nextAction: pidAlive || groupAlive
          ? "The previous provider process is still running. Stop it before continuing this task."
          : "The previous execution has not released its environment lease. Wait for cleanup before continuing this task.",
      };
    }
  }
  return null;
}
