import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWakeupRequests,
  heartbeatRuns,
  issueRecoveryActions,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { parseIssueExecutionState } from "../issue-execution-policy.js";
import { getExecutionBlocker } from "../execution-blocker.js";
import { isAutomaticRecoverySuppressedByPauseHold } from "./pause-hold-guard.js";
import { withRecoveryContext } from "./status-only-context.js";
import { issueRecoveryActionService } from "../issue-recovery-actions.js";

export const DEFAULT_MAX_REVIEW_HANDOFF_ATTEMPTS = 3;
export const REVIEW_HANDOFF_RETRY_IDEMPOTENCY_PREFIX = "review-handoff:";
export const EXECUTION_REVIEW_REQUESTED_REASON = "execution_review_requested";
export const EXECUTION_APPROVAL_REQUESTED_REASON = "execution_approval_requested";

export type ParsedExecutionState = NonNullable<ReturnType<typeof parseIssueExecutionState>>;

export type PendingReviewStageTarget = {
  stageId: string;
  stageType: "review" | "approval";
  reviewerAgentId: string;
  executionState: ParsedExecutionState;
};

export type ExecutionStageWakeContext = {
  wakeRole: "reviewer" | "approver";
  stageId: string;
  stageType: "review" | "approval";
  currentParticipant: ParsedExecutionState["currentParticipant"];
  returnAssignee: ParsedExecutionState["returnAssignee"];
  reviewRequest: ParsedExecutionState["reviewRequest"];
  lastDecisionOutcome: ParsedExecutionState["lastDecisionOutcome"];
  allowedActions: string[];
};

export function buildReviewHandoffRetryIdempotencyKey(input: {
  issueId: string;
  stageId: string;
}): string {
  return `${REVIEW_HANDOFF_RETRY_IDEMPOTENCY_PREFIX}${input.issueId}:${input.stageId}`;
}

export function buildExecutionStageWakeContext(input: {
  state: ParsedExecutionState;
  wakeRole: "reviewer" | "approver";
  allowedActions?: string[];
}): ExecutionStageWakeContext {
  const stageType = input.state.currentStageType === "approval" ? "approval" : "review";
  return {
    wakeRole: input.wakeRole,
    stageId: input.state.currentStageId ?? "",
    stageType,
    currentParticipant: input.state.currentParticipant,
    returnAssignee: input.state.returnAssignee,
    reviewRequest: input.state.reviewRequest ?? null,
    lastDecisionOutcome: input.state.lastDecisionOutcome,
    allowedActions: input.allowedActions ?? ["approve", "request_changes"],
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
  idempotencyKey: string,
): Promise<boolean> {
  const [queuedWake] = await db
    .select({ id: agentWakeupRequests.id })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, companyId),
        eq(agentWakeupRequests.idempotencyKey, idempotencyKey),
        inArray(agentWakeupRequests.status, [
          "queued",
          "deferred_issue_execution",
        ]),
      ),
    )
    .limit(1);
  return Boolean(queuedWake);
}

export async function getReviewHandoffAttemptCount(
  db: Db,
  companyId: string,
  issueId: string,
  stageId: string,
): Promise<number> {
  const fingerprint = `review-handoff:${issueId}:${stageId}`;
  const [action] = await db
    .select({ attemptCount: issueRecoveryActions.attemptCount })
    .from(issueRecoveryActions)
    .where(
      and(
        eq(issueRecoveryActions.companyId, companyId),
        eq(issueRecoveryActions.sourceIssueId, issueId),
        eq(issueRecoveryActions.fingerprint, fingerprint),
      ),
    )
    .limit(1);
  if (action) return action.attemptCount;

  // Check heartbeat runs for this issue and stage
  const runs = await db
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
      contextSnapshot: heartbeatRuns.contextSnapshot,
    })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`,
        sql`${heartbeatRuns.contextSnapshot}->>'currentStageId' = ${stageId}`,
      ),
    );

  let maxAttemptInRuns = 0;
  for (const r of runs) {
    const snap = r.contextSnapshot as Record<string, unknown> | null;
    const attempt = Number(snap?.reviewHandoffAttempt ?? 0);
    if (attempt > maxAttemptInRuns) maxAttemptInRuns = attempt;
  }
  if (maxAttemptInRuns > 0) return maxAttemptInRuns;

  const key = buildReviewHandoffRetryIdempotencyKey({ issueId, stageId });
  const rows = await db
    .select({
      id: agentWakeupRequests.id,
      status: agentWakeupRequests.status,
      coalescedCount: agentWakeupRequests.coalescedCount,
      payload: agentWakeupRequests.payload,
    })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, companyId),
        eq(agentWakeupRequests.idempotencyKey, key),
        ne(agentWakeupRequests.status, "skipped"),
      ),
    );
  if (rows.length === 0) return 0;

  let maxAttemptInWakes = 0;
  for (const row of rows) {
    const p = row.payload as Record<string, unknown> | null;
    const ctx = (p?._paperclipWakeContext ?? null) as Record<string, unknown> | null;
    const att = Number(p?.reviewHandoffAttempt ?? ctx?.reviewHandoffAttempt ?? 0);
    if (att > maxAttemptInWakes) maxAttemptInWakes = att;
  }
  if (maxAttemptInWakes > 0) return maxAttemptInWakes;

  return rows.reduce((acc, row) => acc + 1 + (row.coalescedCount ?? 0), 0);
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
  const cause = "execution_recovery_budget_exhausted";
  const nextAction = `Automatic review handoff retries exhausted (${input.attemptsUsed}/${input.maxAttempts}) for this ${input.stageType} stage. Verify reviewer availability and explicitly reassign or trigger the review.`;
  const fingerprint = `review-handoff:${input.issue.id}:${input.stageId}`;

  // First check if an active action already exists for this issue
  const existing = await issueRecoveryActionService(db).getActiveForIssue(
    input.companyId,
    input.issue.id,
  );
  if (existing) {
    const [escalated] = await db
      .update(issueRecoveryActions)
      .set({
        status: "escalated",
        ownerType: "board",
        ownerAgentId: null,
        ownerUserId: null,
        returnOwnerAgentId: input.reviewerAgentId ?? input.issue.assigneeAgentId,
        cause,
        fingerprint,
        evidence: {
          ...(existing.evidence ?? {}),
          issueId: input.issue.id,
          stageId: input.stageId,
          stageType: input.stageType,
          reviewerAgentId: input.reviewerAgentId,
          attemptsUsed: input.attemptsUsed,
          maxAttempts: input.maxAttempts,
          exhaustedAt: new Date().toISOString(),
        },
        nextAction,
        wakePolicy: null,
        monitorPolicy: null,
        attemptCount: input.attemptsUsed,
        maxAttempts: input.maxAttempts,
        outcome: "escalated",
        updatedAt: new Date(),
      })
      .where(eq(issueRecoveryActions.id, existing.id))
      .returning();
    return escalated;
  }

  // Insert a fresh escalated action
  const now = new Date();
  const [created] = await db
    .insert(issueRecoveryActions)
    .values({
      companyId: input.companyId,
      sourceIssueId: input.issue.id,
      recoveryIssueId: null,
      kind: "active_run_watchdog",
      status: "escalated",
      ownerType: "board",
      ownerAgentId: null,
      ownerUserId: null,
      previousOwnerAgentId: null,
      returnOwnerAgentId: input.reviewerAgentId ?? input.issue.assigneeAgentId,
      cause,
      fingerprint,
      evidence: {
        issueId: input.issue.id,
        stageId: input.stageId,
        stageType: input.stageType,
        reviewerAgentId: input.reviewerAgentId,
        attemptsUsed: input.attemptsUsed,
        maxAttempts: input.maxAttempts,
        exhaustedAt: now.toISOString(),
      },
      nextAction,
      wakePolicy: null,
      monitorPolicy: null,
      attemptCount: input.attemptsUsed,
      maxAttempts: input.maxAttempts,
      timeoutAt: null,
      lastAttemptAt: now,
      outcome: "escalated",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

const reconciliationQueues = new Map<string, Promise<void>>();

async function runExclusiveReconciliation<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = reconciliationQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => current);
  reconciliationQueues.set(key, next);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (reconciliationQueues.get(key) === next) {
      reconciliationQueues.delete(key);
    }
  }
}

export async function reconcileReviewHandoffAfterBlockerClear(
  db: Db,
  input: {
    issueId: string;
    companyId: string;
    enqueueWakeup: (
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
    ) => Promise<any>;
    treeControlSvc?: Parameters<typeof isAutomaticRecoverySuppressedByPauseHold>[3];
    source?: string;
  },
): Promise<{
  action: "enqueued" | "exhausted" | "skipped";
  reason?: string;
  wake?: any;
  recoveryActionId?: string;
}> {
  const queueKey = `${input.companyId}:${input.issueId}`;
  return runExclusiveReconciliation(queueKey, async () => {
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
      .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));

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
      hasQueuedReviewRetry(
        db,
        issue.companyId,
        buildReviewHandoffRetryIdempotencyKey({
          issueId: issue.id,
          stageId: target.stageId,
        }),
      ),
      getReviewHandoffAttemptCount(
        db,
        issue.companyId,
        issue.id,
        target.stageId,
      ),
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
        recoveryActionId: action?.id,
      };
    }

    if (decision.kind === "skip") {
      return { action: "skipped", reason: decision.reason };
    }

    const wake = await input.enqueueWakeup(decision.targetAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: decision.reason,
      payload: decision.payload,
      idempotencyKey: decision.idempotencyKey,
      requestedByActorType: "system",
      requestedByActorId: null,
      contextSnapshot: decision.contextSnapshot,
    });

    return {
      action: "enqueued",
      wake,
    };
  });
}
