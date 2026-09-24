import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWakeupRequests,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { isUniqueViolation } from "../../db-errors.js";
import { parseIssueExecutionState } from "../issue-execution-policy.js";
import { getExecutionBlocker } from "../execution-blocker.js";
import { isAutomaticRecoverySuppressedByPauseHold } from "./pause-hold-guard.js";
import { withRecoveryContext } from "./status-only-context.js";
import { issueRecoveryActionService } from "../issue-recovery-actions.js";

export const DEFAULT_MAX_REVIEW_HANDOFF_ATTEMPTS = 3;
export const REVIEW_HANDOFF_RETRY_IDEMPOTENCY_PREFIX = "review-handoff:";
export const EXECUTION_REVIEW_REQUESTED_REASON = "execution_review_requested";
export const EXECUTION_APPROVAL_REQUESTED_REASON = "execution_approval_requested";
/**
 * Partial unique index on `agent_wakeup_requests(company_id, idempotency_key)`
 * for this prefix. It is the cross-process authority for "one handoff wake per
 * issue, stage and attempt": a concurrent trigger that loses the race gets a
 * unique violation instead of a second wake.
 */
export const REVIEW_HANDOFF_RETRY_IDEMPOTENCY_INDEX =
  "agent_wakeup_requests_review_handoff_retry_idempotency_uq";
export const REVIEW_HANDOFF_EXHAUSTED_CAUSE = "execution_recovery_budget_exhausted";

/** Recovery-action identity for the exhausted retry budget of one stage. */
export function buildReviewHandoffRetryFingerprint(input: {
  issueId: string;
  stageId: string;
}): string {
  return `${REVIEW_HANDOFF_RETRY_IDEMPOTENCY_PREFIX}${input.issueId}:${input.stageId}`;
}

export type ParsedExecutionState = NonNullable<ReturnType<typeof parseIssueExecutionState>>;

export type PendingReviewStageTarget = {
  stageId: string;
  stageType: "review" | "approval";
  reviewerAgentId: string;
  executionState: ParsedExecutionState;
};

export type ExecutionStageWakeContext = {
  wakeRole: "reviewer" | "approver" | "executor";
  stageId: string | null;
  stageType: ParsedExecutionState["currentStageType"];
  currentParticipant: ParsedExecutionState["currentParticipant"];
  returnAssignee: ParsedExecutionState["returnAssignee"];
  reviewRequest: ParsedExecutionState["reviewRequest"];
  lastDecisionOutcome: ParsedExecutionState["lastDecisionOutcome"];
  allowedActions: string[];
};

/** Every durable retry wake for one issue and stage shares this key prefix. */
export function buildReviewHandoffRetryIdempotencyKeyPrefix(input: {
  issueId: string;
  stageId: string;
}): string {
  return `${REVIEW_HANDOFF_RETRY_IDEMPOTENCY_PREFIX}${input.issueId}:${input.stageId}:`;
}

/**
 * One key per attempt. The attempt is part of the key so the partial unique
 * index coalesces concurrent triggers that resolved the same attempt, while a
 * later attempt of the same stage still has a key of its own.
 */
export function buildReviewHandoffRetryIdempotencyKey(input: {
  issueId: string;
  stageId: string;
  attempt: number;
}): string {
  return `${buildReviewHandoffRetryIdempotencyKeyPrefix(input)}${input.attempt}`;
}

export function isReviewHandoffRetryIdempotencyConflict(error: unknown): boolean {
  return isUniqueViolation(error, REVIEW_HANDOFF_RETRY_IDEMPOTENCY_INDEX);
}

export function buildExecutionStageWakeContext(input: {
  state: ParsedExecutionState;
  wakeRole: ExecutionStageWakeContext["wakeRole"];
  allowedActions: string[];
}): ExecutionStageWakeContext {
  return {
    wakeRole: input.wakeRole,
    stageId: input.state.currentStageId,
    stageType: input.state.currentStageType,
    currentParticipant: input.state.currentParticipant,
    returnAssignee: input.state.returnAssignee,
    reviewRequest: input.state.reviewRequest ?? null,
    lastDecisionOutcome: input.state.lastDecisionOutcome,
    allowedActions: input.allowedActions,
  };
}

export function getPendingReviewStageTarget(issue: {
  status: string;
  executionState: unknown;
}): PendingReviewStageTarget | null {
  if (issue.status !== "in_review") return null;
  const executionState = parseIssueExecutionState(issue.executionState);
  if (!executionState || executionState.status !== "pending") return null;
  if (!executionState.currentStageId) return null;
  if (
    executionState.currentParticipant?.type !== "agent" ||
    !executionState.currentParticipant.agentId
  ) {
    return null;
  }
  const stageType =
    executionState.currentStageType === "approval" ? "approval" : "review";
  return {
    stageId: executionState.currentStageId,
    stageType,
    reviewerAgentId: executionState.currentParticipant.agentId,
    executionState,
  };
}

export async function hasValidReviewBlocker(
  db: Db,
  issue: {
    id: string;
    companyId: string;
  },
  treeControlSvc?: Parameters<typeof isAutomaticRecoverySuppressedByPauseHold>[3],
): Promise<{ hasBlocker: boolean; reason: string | null }> {
  // 1. Dependency blockers in issueRelations
  const [unresolvedBlocker] = await db
    .select({ id: issues.id, status: issues.status })
    .from(issueRelations)
    .innerJoin(
      issues,
      and(
        eq(issues.companyId, issueRelations.companyId),
        eq(issues.id, issueRelations.issueId),
      ),
    )
    .where(
      and(
        eq(issueRelations.companyId, issue.companyId),
        eq(issueRelations.relatedIssueId, issue.id),
        eq(issueRelations.type, "blocks"),
        notInArray(issues.status, ["done", "cancelled"]),
        sql`${issues.hiddenAt} is null`,
      ),
    )
    .limit(1);
  if (unresolvedBlocker) {
    return {
      hasBlocker: true,
      reason: `unresolved_dependency:${unresolvedBlocker.id}`,
    };
  }

  // 2. Active execution blocker (issueRecoveryActions)
  const executionBlocker = await getExecutionBlocker(
    db,
    issue.companyId,
    issue.id,
  );
  if (executionBlocker) {
    return {
      hasBlocker: true,
      reason: `execution_blocker:${executionBlocker.cause}`,
    };
  }

  // 3. Pause hold
  if (
    await isAutomaticRecoverySuppressedByPauseHold(
      db,
      issue.companyId,
      issue.id,
      treeControlSvc,
    )
  ) {
    return { hasBlocker: true, reason: "pause_hold_active" };
  }

  return { hasBlocker: false, reason: null };
}

export async function hasActiveReviewRun(
  db: Db,
  companyId: string,
  issueId: string,
  agentId: string,
): Promise<boolean> {
  const [activeRun] = await db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId),
        inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`,
      ),
    )
    .limit(1);
  return Boolean(activeRun);
}

export async function hasQueuedReviewRetry(
  db: Db,
  companyId: string,
  issueId: string,
  stageId: string,
): Promise<boolean> {
  const keyPrefix = buildReviewHandoffRetryIdempotencyKeyPrefix({ issueId, stageId });
  const [queuedWake] = await db
    .select({ id: agentWakeupRequests.id })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, companyId),
        sql`${agentWakeupRequests.idempotencyKey} LIKE ${`${keyPrefix}%`}`,
        inArray(agentWakeupRequests.status, [
          "queued",
          "deferred_issue_execution",
        ]),
      ),
    )
    .limit(1);
  return Boolean(queuedWake);
}

/**
 * The durable wake rows are the single authoritative attempt counter: every
 * handoff writes its own attempt number into the wake payload under a key the
 * partial unique index keeps unique. Counting rows or coalesced triggers
 * instead would let a benign repeated trigger consume the budget and escalate
 * a healthy issue.
 *
 * Every persisted receipt counts, including a `skipped` one. The wake path
 * writes such a row when it refuses the wake (heartbeat disabled, wake on
 * demand disabled, inactive company, suppressed scheduling) or saves it as an
 * execution wait. Ignoring those rows would let a permanently refusing target
 * be retried under attempt 1 forever, growing `agent_wakeup_requests` without
 * bound and never reaching the escalation this retry budget exists for.
 */
export async function getReviewHandoffAttemptCount(
  db: Db,
  companyId: string,
  issueId: string,
  stageId: string,
): Promise<number> {
  const keyPrefix = buildReviewHandoffRetryIdempotencyKeyPrefix({ issueId, stageId });
  const rows = await db
    .select({ payload: agentWakeupRequests.payload })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, companyId),
        sql`${agentWakeupRequests.idempotencyKey} LIKE ${`${keyPrefix}%`}`,
      ),
    );

  let attempts = 0;
  for (const row of rows) {
    const payload = row.payload as Record<string, unknown> | null;
    const attempt = Number(payload?.reviewHandoffAttempt ?? 0);
    if (Number.isFinite(attempt) && attempt > attempts) attempts = attempt;
  }
  return attempts;
}

/**
 * Records a consumed attempt whose wake left no receipt under this key. The
 * wake path coalesces a refused automatic wake into an execution-wait row
 * under its own derived key, which this retry's ledger cannot see, so without
 * this receipt a permanently refusing target would be retried under attempt 1
 * forever. The row mirrors the refusal receipt the wake path writes itself.
 */
async function recordRefusedReviewHandoffAttempt(
  db: Db,
  input: {
    companyId: string;
    agentId: string;
    idempotencyKey: string;
    reason: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(agentWakeupRequests).values({
    companyId: input.companyId,
    agentId: input.agentId,
    source: "automation",
    triggerDetail: "system",
    reason: input.reason,
    status: SKIPPED_WAKE_STATUS,
    payload: input.payload,
    requestedByActorType: "system",
    idempotencyKey: input.idempotencyKey,
    finishedAt: new Date(),
  });
}

/**
 * The statuses of every wake row persisted under one attempt's key. A refused
 * wake returns no run but still writes its receipt, so the receipt — not the
 * return value — says whether the handoff was actually accepted.
 */
export async function getReviewHandoffWakeReceiptStatuses(
  db: Db,
  companyId: string,
  idempotencyKey: string,
): Promise<string[]> {
  const rows = await db
    .select({ status: agentWakeupRequests.status })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, companyId),
        eq(agentWakeupRequests.idempotencyKey, idempotencyKey),
      ),
    );
  return rows.map((row) => row.status);
}

export type ReviewHandoffRetryDecision =
  | {
      kind: "skip";
      reason: string;
    }
  | {
      kind: "exhausted";
      reason: string;
      stageId: string;
      stageType: "review" | "approval";
      reviewerAgentId: string;
      attemptsUsed: number;
      maxAttempts: number;
    }
  | {
      kind: "enqueue";
      targetAgentId: string;
      idempotencyKey: string;
      reason: string;
      attempt: number;
      maxAttempts: number;
      payload: Record<string, unknown>;
      contextSnapshot: Record<string, unknown>;
    };

export type DecideReviewHandoffRetryParams = {
  target: PendingReviewStageTarget | null;
  issue: {
    id: string;
    companyId: string;
    identifier?: string | null;
    assigneeAgentId?: string | null;
  };
  hasBlocker: boolean;
  blockerReason: string | null;
  hasActiveRun: boolean;
  hasQueuedWake: boolean;
  attemptCount: number;
  maxAttempts?: number;
};

export function decideReviewHandoffRetry(input: DecideReviewHandoffRetryParams): ReviewHandoffRetryDecision {
  const { target, issue, hasBlocker, blockerReason, hasActiveRun, hasQueuedWake } = input;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_REVIEW_HANDOFF_ATTEMPTS;

  if (!target) {
    return {
      kind: "skip",
      reason: "issue is not in_review with a pending agent review stage",
    };
  }

  if (hasActiveRun) {
    return { kind: "skip", reason: "active review run already exists" };
  }

  if (hasQueuedWake) {
    return { kind: "skip", reason: "durable review retry already queued" };
  }

  if (hasBlocker) {
    return {
      kind: "skip",
      reason: `issue has valid blocker: ${blockerReason ?? "unresolved"}`,
    };
  }

  if (input.attemptCount >= maxAttempts) {
    return {
      kind: "exhausted",
      reason: `review handoff retries exhausted (${input.attemptCount}/${maxAttempts})`,
      stageId: target.stageId,
      stageType: target.stageType,
      reviewerAgentId: target.reviewerAgentId,
      attemptsUsed: input.attemptCount,
      maxAttempts,
    };
  }

  const nextAttempt = input.attemptCount + 1;
  const idempotencyKey = buildReviewHandoffRetryIdempotencyKey({
    issueId: issue.id,
    stageId: target.stageId,
    attempt: nextAttempt,
  });
  const reason =
    target.stageType === "approval"
      ? EXECUTION_APPROVAL_REQUESTED_REASON
      : EXECUTION_REVIEW_REQUESTED_REASON;

  const executionStage = buildExecutionStageWakeContext({
    state: target.executionState,
    wakeRole: target.stageType === "approval" ? "approver" : "reviewer",
    allowedActions: ["approve", "request_changes"],
  });

  const payload = withRecoveryContext(
    {
      issueId: issue.id,
      mutation: "update",
      executionStage,
      reviewHandoffAttempt: nextAttempt,
      maxReviewHandoffAttempts: maxAttempts,
    },
    "normal_model",
  );

  const contextSnapshot = withRecoveryContext(
    {
      issueId: issue.id,
      taskId: issue.id,
      wakeReason: reason,
      source: "issue.review_handoff_retry",
      currentStageId: target.stageId,
      executionStage,
      reviewHandoffAttempt: nextAttempt,
      maxReviewHandoffAttempts: maxAttempts,
    },
    "normal_model",
  );

  return {
    kind: "enqueue",
    targetAgentId: target.reviewerAgentId,
    idempotencyKey,
    reason,
    attempt: nextAttempt,
    maxAttempts,
    payload,
    contextSnapshot,
  };
}

export async function escalateReviewHandoffExhaustion(
  db: Db,
  input: {
    companyId: string;
    issue: {
      id: string;
      identifier?: string | null;
      assigneeAgentId?: string | null;
    };
    stageId: string;
    stageType: "review" | "approval";
    reviewerAgentId: string;
    attemptsUsed: number;
    maxAttempts: number;
  },
) {
  const nextAction = `Automatic review handoff retries exhausted (${input.attemptsUsed}/${input.maxAttempts}) for this ${input.stageType} stage. Verify reviewer availability and explicitly reassign or trigger the review.`;

  // The recovery-action service owns the active-action invariant: a distinct
  // failure identity supersedes the prior action instead of overwriting its
  // cause, evidence, owner and attempt budget in place. The exhausted budget
  // is a board-owned action with no wake or monitor policy, which
  // `getExecutionBlocker` reports as the issue's one actionable blocker.
  return issueRecoveryActionService(db).upsertSourceScoped({
    companyId: input.companyId,
    sourceIssueId: input.issue.id,
    kind: "stranded_assigned_issue",
    ownerType: "board",
    returnOwnerAgentId: input.reviewerAgentId ?? input.issue.assigneeAgentId ?? null,
    cause: REVIEW_HANDOFF_EXHAUSTED_CAUSE,
    fingerprint: buildReviewHandoffRetryFingerprint({
      issueId: input.issue.id,
      stageId: input.stageId,
    }),
    evidence: {
      issueId: input.issue.id,
      stageId: input.stageId,
      stageType: input.stageType,
      reviewerAgentId: input.reviewerAgentId,
      attemptsUsed: input.attemptsUsed,
      maxAttempts: input.maxAttempts,
    },
    nextAction,
    attemptCount: input.attemptsUsed,
    maxAttempts: input.maxAttempts,
    supersedeOnIdentityChange: true,
  });
}

export type ReviewHandoffWake = { id: string } | null;

export type ReviewHandoffEnqueueWakeup = (
  agentId: string,
  request: {
    source: "assignment" | "automation" | "timer" | "on_demand";
    triggerDetail?: "system";
    reason: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string | null;
    requestedByActorType?: "system";
    requestedByActorId?: string | null;
    contextSnapshot?: Record<string, unknown>;
  },
) => Promise<ReviewHandoffWake>;

export type ReviewHandoffReconciliationResult = {
  action: "enqueued" | "exhausted" | "skipped";
  reason?: string;
  wake?: ReviewHandoffWake;
  recoveryActionId?: string;
};

export const REVIEW_HANDOFF_COALESCED_REASON =
  "durable review retry already queued for this attempt";
export const REVIEW_HANDOFF_REFUSED_REASON =
  "wake refused; this attempt is recorded and counts toward the retry budget";
export const REVIEW_HANDOFF_NO_RECEIPT_REASON =
  "wake persisted no receipt for this attempt";
/** The wake status the heartbeat writes for a refused or saved wake. */
const SKIPPED_WAKE_STATUS = "skipped";

/**
 * Starts or schedules the one handoff an `in_review` issue is owed once its
 * blocker is gone. Concurrent callers — a route, a heartbeat sweep, another
 * process — all resolve the same attempt and therefore the same idempotency
 * key, so the partial unique index admits exactly one wake and reports every
 * other caller through a unique violation, which is this function's coalesce
 * signal.
 */
export async function reconcileReviewHandoffAfterBlockerClear(
  db: Db,
  input: {
    issueId: string;
    companyId: string;
    enqueueWakeup: ReviewHandoffEnqueueWakeup;
    treeControlSvc?: Parameters<typeof isAutomaticRecoverySuppressedByPauseHold>[3];
    source?: string;
  },
): Promise<ReviewHandoffReconciliationResult> {
  const [issue] = await db
    .select({
      id: issues.id,
      companyId: issues.companyId,
      identifier: issues.identifier,
      status: issues.status,
      assigneeAgentId: issues.assigneeAgentId,
      executionState: issues.executionState,
    })
    .from(issues)
    .where(
      and(
        eq(issues.id, input.issueId),
        eq(issues.companyId, input.companyId),
        // A hidden issue is outside every other recovery sweep's candidate set
        // (see `hasValidReviewBlocker` and the resolved-dependency backstop),
        // so it must not receive an automatic handoff either.
        sql`${issues.hiddenAt} is null`,
      ),
    );

  if (!issue || issue.status !== "in_review") {
    return { action: "skipped", reason: "issue not in_review" };
  }

  const target = getPendingReviewStageTarget(issue);
  if (!target) {
    return { action: "skipped", reason: "no pending review stage target" };
  }

  const [blockerCheck, hasActive, hasQueued, attemptCount] = await Promise.all([
    hasValidReviewBlocker(db, issue, input.treeControlSvc),
    hasActiveReviewRun(db, issue.companyId, issue.id, target.reviewerAgentId),
    hasQueuedReviewRetry(db, issue.companyId, issue.id, target.stageId),
    getReviewHandoffAttemptCount(db, issue.companyId, issue.id, target.stageId),
  ]);

  const decision = decideReviewHandoffRetry({
    target,
    issue,
    hasBlocker: blockerCheck.hasBlocker,
    blockerReason: blockerCheck.reason,
    hasActiveRun: hasActive,
    hasQueuedWake: hasQueued,
    attemptCount,
    maxAttempts: DEFAULT_MAX_REVIEW_HANDOFF_ATTEMPTS,
  });

  if (decision.kind === "exhausted") {
    const action = await escalateReviewHandoffExhaustion(db, {
      companyId: issue.companyId,
      issue,
      stageId: decision.stageId,
      stageType: decision.stageType,
      reviewerAgentId: decision.reviewerAgentId,
      attemptsUsed: decision.attemptsUsed,
      maxAttempts: decision.maxAttempts,
    });
    return {
      action: "exhausted",
      reason: decision.reason,
      recoveryActionId: action.id,
    };
  }

  if (decision.kind === "skip") {
    return { action: "skipped", reason: decision.reason };
  }

  let wake: ReviewHandoffWake = null;
  try {
    wake = await input.enqueueWakeup(decision.targetAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: decision.reason,
      payload: decision.payload,
      idempotencyKey: decision.idempotencyKey,
      requestedByActorType: "system",
      requestedByActorId: null,
      contextSnapshot: decision.contextSnapshot,
    });
  } catch (error) {
    if (isReviewHandoffRetryIdempotencyConflict(error)) {
      return { action: "skipped", reason: REVIEW_HANDOFF_COALESCED_REASON };
    }
    throw error;
  }

  // The wake path returns no run both when it defers the handoff and when it
  // refuses it outright, and a refusal still writes its receipt under this
  // key. Read that receipt instead of trusting the null: reporting a refused
  // wake as enqueued would advertise a handoff nobody will run.
  const receiptStatuses = await getReviewHandoffWakeReceiptStatuses(
    db,
    issue.companyId,
    decision.idempotencyKey,
  );
  if (receiptStatuses.some((status) => status !== SKIPPED_WAKE_STATUS)) {
    return { action: "enqueued", wake };
  }
  if (receiptStatuses.length > 0) {
    return { action: "skipped", reason: REVIEW_HANDOFF_REFUSED_REASON };
  }
  await recordRefusedReviewHandoffAttempt(db, {
    companyId: issue.companyId,
    agentId: decision.targetAgentId,
    idempotencyKey: decision.idempotencyKey,
    reason: decision.reason,
    payload: decision.payload,
  });
  return { action: "skipped", reason: REVIEW_HANDOFF_NO_RECEIPT_REASON };
}
