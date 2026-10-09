import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { activityLog, agentWakeupRequests, heartbeatRunEvents, heartbeatRuns,
  issueComments, issueExecutionDecisions, issueRecoveryActions, issues, type Db } from "@paperclipai/db";
import { redactEventPayload, redactSensitiveText } from "../../redaction.js";

// Only test-owned lifecycle state is retained. Comment bodies, configuration,
// credentials and arbitrary wake payloads are deliberately excluded.
export async function preserveIssueWakeEvidence(db: Db, test: { id: string; name: string; file: string },
  directory = process.env.PAPERCLIP_TEST_EVIDENCE_DIR ?? path.resolve("test-results/vitest/direct")) {
  const snapshot = await db.transaction(async tx => {
    const [issueRows, comments, wakes, runs, events, decisions, recovery, activity] = await Promise.all([
      tx.select({ id: issues.id, companyId: issues.companyId, status: issues.status,
        assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId,
        executionRunId: issues.executionRunId, executionState: issues.executionState }).from(issues),
      tx.select({ id: issueComments.id, issueId: issueComments.issueId, companyId: issueComments.companyId,
        createdByRunId: issueComments.createdByRunId, createdAt: issueComments.createdAt }).from(issueComments),
      tx.select().from(agentWakeupRequests),
      tx.select().from(heartbeatRuns),
      tx.select().from(heartbeatRunEvents),
      tx.select({ id: issueExecutionDecisions.id, issueId: issueExecutionDecisions.issueId,
        companyId: issueExecutionDecisions.companyId, stageId: issueExecutionDecisions.stageId,
        outcome: issueExecutionDecisions.outcome }).from(issueExecutionDecisions),
      tx.select({ id: issueRecoveryActions.id, sourceIssueId: issueRecoveryActions.sourceIssueId,
        companyId: issueRecoveryActions.companyId, status: issueRecoveryActions.status,
        cause: issueRecoveryActions.cause, outcome: issueRecoveryActions.outcome,
        evidence: issueRecoveryActions.evidence }).from(issueRecoveryActions),
      tx.select({ id: activityLog.id, companyId: activityLog.companyId, runId: activityLog.runId,
        action: activityLog.action, entityType: activityLog.entityType, entityId: activityLog.entityId,
        details: activityLog.details, createdAt: activityLog.createdAt }).from(activityLog),
    ]);
    const safeText = (text: string | null) => text === null ? null : redactSensitiveText(text);
    const project = (raw: unknown, keys: string[]) => raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(keys.filter(key => key in raw).map(key => [key, (raw as Record<string, unknown>)[key]])) : null;
    const state = (raw: unknown) => project(raw, ["status", "currentStageId", "currentStageType",
      "currentStageIndex", "lastDecisionId", "lastDecisionOutcome", "returnAssignee", "currentParticipant",
      "completedStageIds", "changesRequestedCount"]);
    const wakeContext = (raw: unknown) => raw && typeof raw === "object" && !Array.isArray(raw) ? Object.fromEntries(
      ["issueId", "taskId", "commentId", "wakeCommentId", "wakeReason", "retryReason", "source", "executionStage"]
        .filter(key => key in raw).map(key => [key, (raw as Record<string, unknown>)[key]])) : null;
    return { issues: issueRows.map(row => ({ ...row, executionState: state(row.executionState) })), comments,
      wakes: wakes.map(row => ({ id: row.id, companyId: row.companyId, agentId: row.agentId,
        source: row.source, reason: row.reason, status: row.status, runId: row.runId,
        requestedAt: row.requestedAt, claimedAt: row.claimedAt, finishedAt: row.finishedAt,
        error: safeText(row.error), context: wakeContext(row.payload),
        wakeContext: wakeContext(row.payload?._paperclipWakeContext) })),
      runs: runs.map(row => ({ id: row.id, companyId: row.companyId, agentId: row.agentId,
        status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt, processPid: row.processPid,
        errorCode: row.errorCode, error: safeText(row.error), context: wakeContext(row.contextSnapshot),
        result: project(row.resultJson, ["stopReason", "timeoutSource", "errorCode", "outcome",
          "providerStarted", "providerStopped", "actionOutcome"]) })),
      events: events.map(row => ({ id: row.id, runId: row.runId, seq: row.seq,
        eventType: row.eventType, level: row.level, stream: row.stream,
        message: safeText(row.message), payload: redactEventPayload(project(row.payload,
          ["runId", "issueId", "commentId", "reason", "errorCode", "error", "phase", "cause", "status"])),
        createdAt: row.createdAt })),
      decisions,
      recovery: recovery.map(row => ({ ...row, evidence: {
        execution: project(row.evidence.execution, ["runId", "phase", "cause", "startedAt", "processPid"]),
        automaticRecovery: project(row.evidence.automaticRecovery, ["replay", "reason"]),
      } })),
      activity: activity.map(row => ({ ...row, details: project(row.details,
        ["commentId", "sourceIssueId", "runId", "wakeRunId", "reason", "outcome", "status", "previousStatus"]) })) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  const safeSnapshot = redactSensitiveText(JSON.stringify(snapshot));
  const evidence = { test, capturedAt: new Date().toISOString(), complete: true,
    snapshot: JSON.parse(safeSnapshot), snapshotUtf8Bytes: Buffer.byteLength(safeSnapshot),
    snapshotSha256: createHash("sha256").update(safeSnapshot).digest("hex"),
    counts: Object.fromEntries(Object.entries(snapshot).map(([key, rows]) => [key, rows.length])) };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${randomUUID()}.issue-wake.json`);
  await fs.writeFile(file, `${JSON.stringify(evidence)}\n`, { flag: "wx", mode: 0o600 });
  process.stderr.write(`${JSON.stringify({ jsonrpc: "2.0", method: "paperclip.test.fixture_evidence",
    params: { test, file, complete: true, counts: evidence.counts,
      snapshotUtf8Bytes: evidence.snapshotUtf8Bytes, snapshotSha256: evidence.snapshotSha256 } })}\n`);
  return file;
}
