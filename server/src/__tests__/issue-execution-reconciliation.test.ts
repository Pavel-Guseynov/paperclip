import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog, agents, agentRuntimeState, agentWakeupRequests, authUsers, companies,
  createDb, documentRevisions, documents, heartbeatRunEvents, heartbeatRuns,
  issueComments, issueDocuments, issueRecoveryActions, issueRelations, issues,
} from "@paperclipai/db";
import { ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { agentRoutes } from "../routes/agents.js";
import { createPostgresRunDispatchAdapter } from "../modules/run-dispatch/adapters/postgres.js";
import { heartbeatService } from "../services/heartbeat.js";
import { trackWakeupDecision } from "../services/heartbeat-wake-lifecycle.js";
import { settleUnrecoverableExecutions } from "../services/execution-recovery-resolution.js";
import { terminalizeLegacyExecution } from "../services/legacy-execution-recovery.js";
import { preserveIssueWakeEvidence } from "./helpers/issue-wake-evidence.js";

describe("issue execution reconciliation with real routes and Postgres", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  const children: Array<{ child: ChildProcessWithoutNullStreams; closed: Promise<unknown> }> = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-execution-reconciliation-");
    db = createDb(database.connectionString);
    heartbeat = heartbeatService(db);
  }, 90_000);

  afterEach(async ({ task }) => {
    try {
      await preserveIssueWakeEvidence(db, { id: task.id, name: task.name, file: task.file.filepath });
    } finally {
      await heartbeat.drainActiveRunExecutions();
      for (const { child, closed } of children.splice(0)) {
        child.stdin.end();
        await closed;
      }
      await db.delete(activityLog);
      await db.delete(issueRecoveryActions);
      await db.delete(issueComments);
      await db.delete(issueDocuments);
      await db.delete(documentRevisions);
      await db.delete(documents);
      await db.delete(heartbeatRunEvents);
      await db.delete(issueRelations);
      await db.delete(issues);
      await db.delete(heartbeatRuns);
      await db.delete(agentWakeupRequests);
      await db.delete(agentRuntimeState);
      await db.delete(agents);
      await db.delete(companies);
      await db.delete(authUsers);
    }
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  async function startProvider() {
    const child = spawn("cat", [], { stdio: "pipe" });
    const closed = once(child, "close");
    children.push({ child, closed });
    await once(child, "spawn");
    return { child, closed, startedAt: new Date() };
  }

  async function fixture() {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Test operator",
      email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    const [company] = await db.insert(companies).values({ name: "Reconciliation",
      issuePrefix: `R${randomUUID().slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: userId, requireBoardApprovalForNewAgents: false }).returning();
    const [agent] = await db.insert(agents).values({ companyId: company!.id,
      name: "Executor", role: "engineer", status: "active", adapterType: "process",
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).returning();
    const [issue] = await db.insert(issues).values({ companyId: company!.id,
      title: "Recover continuation", status: "in_progress", assigneeAgentId: agent!.id,
      responsibleUserId: userId }).returning();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "board", userId, source: "local_implicit", isInstanceAdmin: true };
      next();
    });
    app.use("/api", issueRoutes(db, {} as Parameters<typeof issueRoutes>[1]));
    app.use("/api", agentRoutes(db));
    app.use(errorHandler);
    return { company: company!, agent: agent!, issue: issue!, app };
  }

  async function occupyDispatchSlot(f: Awaited<ReturnType<typeof fixture>>) {
    const provider = await startProvider();
    await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id,
      invocationSource: "on_demand", status: "running", startedAt: provider.startedAt,
      processPid: provider.child.pid });
  }

  it("drain waits for an unfinished wake decision before its first heartbeat wake is registered", async () => {
    const f = await fixture();
    await occupyDispatchSlot(f);
    const provider = await startProvider();
    const control = createInterface({ input: provider.child.stdout });
    const received = once(control, "line");
    const decision = trackWakeupDecision((async () => {
      const [line] = await received;
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0", method: "paperclip.test.release_wake_decision" });
      return heartbeat.wakeup(f.agent.id, { source: "on_demand", reason: "issue_commented",
        payload: { issueId: f.issue.id }, requestedByActorType: "user",
        requestedByActorId: f.company.defaultResponsibleUserId! });
    })());
    let drained = false;
    const draining = heartbeat.drainActiveRunExecutions().then(() => { drained = true; });
    try {
      await db.select({ id: issues.id }).from(issues);
      expect(drained).toBe(false);
    } finally {
      provider.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "paperclip.test.release_wake_decision" })}\n`);
      try {
        await decision;
        await draining;
      } finally {
        control.close();
      }
    }
    expect(drained).toBe(true);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.status, "queued"))).toHaveLength(1);
  });

  it("retains correlated safe fixture state after the test-owned database rows are deleted", async () => {
    const f = await fixture();
    const [comment] = await db.insert(issueComments).values({ companyId: f.company.id,
      issueId: f.issue.id, body: "A body excluded from diagnostics" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id,
      invocationSource: "on_demand", status: "failed", errorCode: "known_failure",
      error: "original fixture cause; TOKEN=fixture-only-private-value",
      contextSnapshot: { issueId: f.issue.id, wakeCommentId: comment!.id } }).returning();
    const [wake] = await db.insert(agentWakeupRequests).values({ companyId: f.company.id,
      agentId: f.agent.id, source: "on_demand", status: "failed", runId: run!.id,
      payload: { issueId: f.issue.id, commentId: comment!.id, token: "fixture-only-private-value" } }).returning();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "issue-wake-evidence-"));
    try {
      const file = await preserveIssueWakeEvidence(db, { id: "retention-proof", name: "known failure", file: import.meta.url }, directory);
      await db.delete(issueComments);
      await db.delete(agentWakeupRequests);
      await db.delete(heartbeatRuns);
      await db.delete(issues);
      const raw = await fs.readFile(file, "utf8");
      const evidence = JSON.parse(raw);
      expect(evidence.complete).toBe(true);
      expect(evidence.counts).toMatchObject({ issues: 1, comments: 1, wakes: 1, runs: 1 });
      expect(evidence.snapshot.wakes).toEqual([expect.objectContaining({ id: wake!.id,
        runId: run!.id, context: { issueId: f.issue.id, commentId: comment!.id } })]);
      expect(evidence.snapshot.runs[0]).toMatchObject({ id: run!.id, status: "failed",
        errorCode: "known_failure", error: "original fixture cause; TOKEN=***REDACTED***",
        context: { issueId: f.issue.id, wakeCommentId: comment!.id } });
      const encoded = JSON.stringify(evidence.snapshot);
      expect(evidence.snapshotUtf8Bytes).toBe(Buffer.byteLength(encoded));
      expect(evidence.snapshotSha256).toBe(createHash("sha256").update(encoded).digest("hex"));
      expect(raw).not.toContain("fixture-only-private-value");
      expect(raw).not.toContain("A body excluded from diagnostics");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("a queued review continuation cancelled before process start has no executionBlocker and the next board comment queues a run", async () => {
    const f = await fixture();
    await db.insert(issues).values({ companyId: f.company.id, parentId: f.issue.id,
      title: "Board review", status: "todo", assigneeUserId: f.company.defaultResponsibleUserId });
    await occupyDispatchSlot(f);
    const documentId = randomUUID();
    const revisionId = randomUUID();
    const body = "# Continuation Summary\n\n## Next Action\n\n- Wait for reviewer feedback or approval before continuing executor work.";
    await db.insert(documents).values({ id: documentId, companyId: f.company.id,
      title: "Continuation Summary", format: "markdown", latestBody: body,
      latestRevisionId: revisionId, latestRevisionNumber: 1, createdByAgentId: f.agent.id });
    await db.insert(documentRevisions).values({ id: revisionId, companyId: f.company.id,
      documentId, revisionNumber: 1, title: "Continuation Summary", format: "markdown",
      body, createdByAgentId: f.agent.id });
    await db.insert(issueDocuments).values({ companyId: f.company.id, issueId: f.issue.id,
      documentId, key: ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY });
    const [queued] = await db.insert(heartbeatRuns).values({ companyId: f.company.id,
      agentId: f.agent.id, invocationSource: "retry", status: "queued",
      contextSnapshot: { issueId: f.issue.id, wakeReason: "issue_continuation_needed",
        retryReason: "issue_continuation_needed" } }).returning();
    expect(await createPostgresRunDispatchAdapter(db).cancelStaleQueuedRun({
      companyId: f.company.id, runId: queued!.id, expectedStatus: "queued", now: new Date(),
    })).toMatchObject({ outcome: "cancelled", errorCode: "issue_continuation_waiting_on_review" });
    const [cancelled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, queued!.id));
    expect(cancelled).toMatchObject({ status: "cancelled", startedAt: null, processPid: null,
      resultJson: { stopReason: "issue_continuation_waiting_on_review", timeoutSource: "stale_queued_run_gate" } });

    await heartbeat.reconcileStrandedAssignedIssues();
    await settleUnrecoverableExecutions(db);
    const before = await request(f.app).get(`/api/issues/${f.issue.id}`).expect(200);
    expect.soft(before.body.executionBlocker).toBeNull();
    const comment = await request(f.app).post(`/api/issues/${f.issue.id}/comments`)
      .send({ body: "Continue with the revised task." }).expect(201);
    await heartbeat.drainActiveRunExecutions();
    const successors = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, f.company.id),
      sql`${heartbeatRuns.contextSnapshot}->>'wakeCommentId' = ${comment.body.id}`,
    ));
    expect.soft(successors).toHaveLength(1);
    expect.soft(successors[0]).toMatchObject({ status: "queued", startedAt: null, processPid: null });
    expect.soft((await request(f.app).get(`/api/issues/${f.issue.id}`).expect(200)).body.executionBlocker).toBeNull();
  });

  it.each([false, true])("the retry route admits only a verified review-wait receipt (contradictory provider evidence: %s)", async contradictory => {
    const f = await fixture();
    await db.update(agents).set({ role: "ceo" }).where(eq(agents.id, f.agent.id));
    await occupyDispatchSlot(f);
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id,
      invocationSource: "retry", status: "cancelled", finishedAt: new Date(),
      errorCode: "issue_continuation_waiting_on_review", contextSnapshot: { issueId: f.issue.id },
      resultJson: { stopReason: "issue_continuation_waiting_on_review", timeoutSource: "stale_queued_run_gate" } }).returning();
    if (contradictory) await db.insert(heartbeatRunEvents).values({ companyId: f.company.id, agentId: f.agent.id,
      runId: run!.id, seq: 1, eventType: "adapter.invoke", level: "info", stream: "system", message: "Provider invoked" });
    const response = await request(f.app).post(`/api/agents/${f.agent.id}/wakeup`)
      .send({ reason: "retry_failed_run", failedRunId: run!.id });
    expect(response.status).toBe(contradictory ? 409 : 202);
    const successors = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, f.company.id), eq(heartbeatRuns.status, "queued"),
    ));
    expect(successors).toHaveLength(contradictory ? 0 : 1);
  });

  async function settledProcessHold(stopped = true) {
    const f = await fixture();
    const provider = await startProvider();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.company.id,
      agentId: f.agent.id, invocationSource: "on_demand", status: "running",
      startedAt: provider.startedAt, processPid: provider.child.pid,
      contextSnapshot: { issueId: f.issue.id } }).returning();
    if (stopped) {
      provider.child.stdin.end();
      await provider.closed;
    }
    await terminalizeLegacyExecution({ db, run: run!, status: "cancelled",
      patch: { finishedAt: new Date(), errorCode: "process_lost" } });
    await settleUnrecoverableExecutions(db);
    return { ...f, run: run! };
  }

  function resolutionBody(runId: string) {
    return { outcome: "restored", sourceIssueStatus: "todo", resolutionNote: "The test provider exited without actions.",
      executionReconciliation: { runId, providerStopped: true, actionOutcome: "not_performed",
        outcomeEvidence: "The test-owned cat process exited after stdin closed and performed no external actions." } };
  }

  it("a run cancelled after process start retains a settled hold accepted by the canonical resolve route", async () => {
    const f = await settledProcessHold();
    const issue = await request(f.app).get(`/api/issues/${f.issue.id}`).expect(200);
    expect(issue.body.executionBlocker).toMatchObject({ runId: f.run.id,
      cause: "legacy_execution_requires_reconciliation" });
    const actions = await request(f.app).get(`/api/issues/${f.issue.id}/recovery-actions`).expect(200);
    expect(actions.body.actions).toEqual([]);
    const [settled] = await db.select().from(issueRecoveryActions).where(eq(
      issueRecoveryActions.id, issue.body.executionBlocker.recoveryActionId,
    ));
    expect(settled).toMatchObject({ status: "resolved", outcome: "blocked",
      evidence: { automaticRecovery: { replay: "blocked" } } });
    await occupyDispatchSlot(f);
    const resolution = await request(f.app).post(`/api/issues/${f.issue.id}/recovery-actions/resolve`)
      .send(resolutionBody(f.run.id));
    expect(resolution.status).toBe(200);
    expect(resolution.body.issue).toMatchObject({ status: "todo" });
    expect(resolution.body.recoveryAction).toMatchObject({ id: settled.id, status: "resolved", outcome: "handed_back" });
    expect((await request(f.app).get(`/api/issues/${f.issue.id}`).expect(200)).body.executionBlocker).toBeNull();
  });

  it.each(["live_provider", "wrong_source", "missing_evidence"])("preserves a settled hold on %s", async kind => {
    const f = await settledProcessHold(kind !== "live_provider");
    const body = resolutionBody(kind === "wrong_source" ? randomUUID() : f.run.id);
    const { executionReconciliation, ...withoutEvidence } = body;
    await request(f.app).post(`/api/issues/${f.issue.id}/recovery-actions/resolve`)
      .send(kind === "missing_evidence" ? withoutEvidence : body)
      .expect(kind === "missing_evidence" ? 404 : 409);
    const issue = await request(f.app).get(`/api/issues/${f.issue.id}`).expect(200);
    expect(issue.body.executionBlocker).toMatchObject({ runId: f.run.id });
    expect((await db.select().from(issueRecoveryActions).where(eq(
      issueRecoveryActions.id, issue.body.executionBlocker.recoveryActionId,
    )))[0]).toMatchObject({ status: "resolved", outcome: "blocked" });
  });
});
