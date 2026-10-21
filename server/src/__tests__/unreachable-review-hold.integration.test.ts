import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  executionWorkspaces,
  heartbeatRuns,
  issueComments,
  issueExecutionDecisions,
  issueRelations,
  issueWorkProducts,
  issues,
  projects,
  projectWorkspaces,
  setDatabaseObserver,
} from "@paperclipai/db";
import type { DeploymentMode, IssueExecutionPolicy, IssueExecutionState } from "@paperclipai/shared";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { issueRoutes } from "../routes/issues.js";
import { agentService } from "../services/agents.js";
import { boardAuthService } from "../services/board-auth.js";
import { heartbeatService } from "../services/heartbeat.js";
import { deliverReconciledExecutions } from "../services/execution-recovery-resolution.js";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { preserveIssueWakeEvidence } from "./helpers/issue-wake-evidence.js";

const exec = promisify(execFile);

describe("unreachable escalated review through native authentication", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let root: string;
  let fixtureNumber = 0;
  let previousJwtSecret: string | undefined;
  const servers: Server[] = [];
  const queryEvents = new EventEmitter();
  const children: Array<{ child: ChildProcessWithoutNullStreams; closed: Promise<unknown> }> = [];

  beforeAll(async () => {
    previousJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
    process.env.PAPERCLIP_AGENT_JWT_SECRET = randomUUID();
    // Observe real driver dispatch to synchronize the row-lock race. Queries
    // always execute against PostgreSQL, without interception or substitution.
    setDatabaseObserver({
      startStatement(info) {
        return {
          started() {
            if (info.table === "issues" && (info.operation === "UPDATE" || info.statement.toLowerCase().includes("for update"))) {
              queryEvents.emit("issue-mutation");
            }
          },
          finish() {},
        };
      },
      observePool() {},
    });
    root = await mkdtemp(path.join(tmpdir(), "unreachable-review-hold-"));
  }, 90_000);

  beforeEach(async () => {
    database = await startEmbeddedPostgresTestDatabase("unreachable-review-hold-");
    db = createDb(database.connectionString);
  }, 90_000);

  afterEach(async ({ task }) => {
    if (!database) return;
    try {
      const file = await preserveIssueWakeEvidence(db, { id: task.id, name: task.name, file: task.file.filepath });
      // Nix-owned failed build directories are private to its build user. Keep
      // the same redacted snapshot retrievable through the native build log.
      process.stderr.write(`${JSON.stringify({ jsonrpc: "2.0", method: "paperclip.test.fixture_snapshot",
        params: JSON.parse(await readFile(file, "utf8")) })}\n`);
    } finally {
      await heartbeatService(db).drainActiveRunExecutions();
      for (const { child, closed } of children.splice(0)) {
        child.stdin.end();
        await closed;
      }
      for (const server of servers.splice(0)) {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
      await database.cleanup();
      database = null;
    }
  });

  afterAll(async () => {
    await database?.cleanup();
    setDatabaseObserver(null);
    if (root) await rm(root, { recursive: true, force: true });
    if (previousJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousJwtSecret;
  });

  async function fixture(deploymentMode: DeploymentMode = "authenticated") {
    const companyId = randomUUID();
    const userId = randomUUID();
    const reviewerId = randomUUID();
    const authorId = randomUUID();
    const issueId = randomUUID();
    const stageId = randomUUID();
    const decisionId = randomUUID();
    const now = new Date();
    const prefix = `URH${++fixtureNumber}`;
    await db.insert(companies).values({
      id: companyId, name: "Review recovery", issuePrefix: prefix, issueCounter: 1,
    });
    await db.insert(authUsers).values({
      id: userId, name: "Board operator", email: `${userId}@example.test`,
      createdAt: now, updatedAt: now,
    });
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner",
    });
    if (deploymentMode === "local_trusted") {
      await db.insert(authUsers).values({
        id: "local-board", name: "Local board", email: "local-board@example.test",
        createdAt: now, updatedAt: now,
      }).onConflictDoNothing();
      await db.insert(companyMemberships).values({
        companyId, principalType: "user", principalId: "local-board",
        status: "active", membershipRole: "owner",
      });
    }
    await db.insert(agents).values([authorId, reviewerId].map((id) => ({
      id, companyId, name: id === authorId ? "Original author" : "Configured reviewer",
      adapterType: "process", adapterConfig: { command: "node", args: ["--version"] },
      runtimeConfig: { heartbeat: { wakeOnDemand: false } }, status: "active",
    })));
    const policy: IssueExecutionPolicy = normalizeIssueExecutionPolicy({
      stages: [{
        id: stageId, type: "review",
        participants: [{ type: "agent", agentId: reviewerId, userId: null }],
      }],
    })!;
    const state: IssueExecutionState = {
      status: "pending", currentStageId: stageId, currentStageIndex: 0,
      currentStageType: "review",
      currentParticipant: { type: "user", userId: "local-board", agentId: null },
      returnAssignee: { type: "agent", agentId: authorId, userId: null },
      completedStageIds: [], lastDecisionId: decisionId,
      lastDecisionOutcome: "changes_requested", changesRequestedCount: 3,
      reviewRequest: null, monitor: null,
    };
    await db.insert(issues).values({
      id: issueId, companyId, title: "Preserve the review and return author",
      issueNumber: 1, identifier: `${prefix}-1`, status: "in_review",
      assigneeUserId: "local-board", responsibleUserId: "local-board",
      executionPolicy: policy, executionState: state,
    });
    await db.insert(issueExecutionDecisions).values({
      id: decisionId, companyId, issueId, stageId, stageType: "review",
      actorAgentId: reviewerId, outcome: "changes_requested",
      body: "Finding F4 remains open; preserve its identity and evidence.",
    });
    const boardKey = await boardAuthService(db).createNamedBoardApiKey({ userId, name: "Test board" });
    const reviewerKey = await agentService(db).createApiKey(
      reviewerId, "Test reviewer", { kind: "standard" }, { responsibleUserId: userId },
    );
    const storage = createStorageService(createLocalDiskStorageProvider(path.join(root, companyId)));
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode }));
    app.use("/api", issueRoutes(db, storage));
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening", { signal: AbortSignal.timeout(5_000) });
    const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const patch = (body: Record<string, unknown>, token: string | null = boardKey.token) => {
      const pending = request(server).patch(`/api/issues/${issueId}`);
      if (token) pending.set("authorization", `Bearer ${token}`);
      return pending.send(body);
    };
    const read = async () => (await db.select().from(issues).where(eq(issues.id, issueId)))[0]!;
    const decisions = () => db.select().from(issueExecutionDecisions).where(eq(issueExecutionDecisions.issueId, issueId));
    const audit = () => db.select().from(activityLog).where(and(
      eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.updated"),
    ));
    return { app, server, apiUrl, patch, read, decisions, audit, policy, state, userId, companyId, authorId, reviewerId, issueId, reviewerKey, boardKey };
  }

  async function retainAuthorWorkspace(f: Awaited<ReturnType<typeof fixture>>) {
    const cwd = path.join(root, f.companyId, "retained-work");
    const branch = "author-work";
    await mkdir(cwd, { recursive: true });
    await exec("git", ["init", "--initial-branch", branch, cwd]);
    await exec("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "Original work"]);
    await writeFile(path.join(cwd, "finding-F4.txt"), "Original author correction remains unfinished.\n");
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Retained author project" }).returning();
    const [source] = await db.insert(projectWorkspaces).values({
      companyId: f.companyId, projectId: project!.id, name: "Existing repository", cwd, isPrimary: true,
    }).returning();
    const [workspace] = await db.insert(executionWorkspaces).values({
      companyId: f.companyId, projectId: project!.id, projectWorkspaceId: source!.id,
      sourceIssueId: f.issueId, mode: "shared_workspace", strategyType: "project_primary",
      name: "Retained author work", cwd, providerRef: cwd, branchName: branch,
    }).returning();
    const [product] = await db.insert(issueWorkProducts).values({
      companyId: f.companyId, projectId: project!.id, issueId: f.issueId,
      executionWorkspaceId: workspace!.id, type: "branch", provider: "git", externalId: branch,
      title: "Original correction branch", status: "active", reviewState: "changes_requested",
      metadata: { findingId: "F4", correctionRequired: true },
    }).returning();
    await db.update(issues).set({
      projectId: project!.id, projectWorkspaceId: source!.id, executionWorkspaceId: workspace!.id,
      executionWorkspacePreference: "reuse_existing", executionWorkspaceSettings: { mode: "shared_workspace" },
    }).where(eq(issues.id, f.issueId));
    await db.update(agents).set({
      adapterConfig: { command: "node", args: [fileURLToPath(new URL("./fixtures/review-recovery-agent.mjs", import.meta.url)), f.apiUrl, f.issueId], cwd },
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
    }).where(eq(agents.id, f.authorId));
    return { cwd, branch, workspace: workspace!, product: product! };
  }

  async function pendingReviewer() {
    const f = await fixture();
    const state = { ...f.state, currentParticipant: { type: "agent" as const, agentId: f.reviewerId, userId: null } };
    await db.update(issues).set({ assigneeAgentId: f.reviewerId, assigneeUserId: null, executionState: state })
      .where(eq(issues.id, f.issueId));
    return { ...f, state };
  }

  const eventMonitor = { nextCheckAt: null, kind: "external_service", serviceName: "gitea", externalRef: "test-review-binding" };

  async function localReviewCandidate() {
    const f = await fixture();
    await db.update(issues).set({ status: "blocked", assigneeUserId: f.userId, assigneeAgentId: null,
      executionPolicy: null, executionState: null }).where(eq(issues.id, f.issueId));
    const handoff = () => f.patch({ status: "done", executionPolicy: f.policy,
      comment: "Task Disposition: verified local work is ready for independent review." }, f.reviewerKey.token);
    return { ...f, handoff };
  }

  it("keeps the native reviewer checkout in review with its original stage, return author and finding history", async () => {
    const f = await pendingReviewer();
    const before = await f.read();
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId: f.companyId, agentId: f.reviewerId,
      status: "running", invocationSource: "on_demand", triggerDetail: "manual", contextSnapshot: { issueId: f.issueId } });
    const checkout = () => request(f.server).post(`/api/issues/${f.issueId}/checkout`)
      .set("authorization", `Bearer ${f.reviewerKey.token}`)
      .set("X-Paperclip-Run-Id", runId)
      .send({ agentId: f.reviewerId, expectedStatuses: ["in_review"] });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await checkout();
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await f.read()).toMatchObject({
        status: "in_review", assigneeAgentId: f.reviewerId,
        executionPolicy: f.policy, executionState: f.state, startedAt: before.startedAt,
      });
    }
    expect(await f.decisions()).toEqual([expect.objectContaining({ id: f.state.lastDecisionId })]);
  });

  it("arms a monitor-only PATCH without replacing the pending review or its original return author", async () => {
    const f = await pendingReviewer();
    const response = await f.patch({ executionPolicy: { monitor: eventMonitor } }, f.reviewerKey.token);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await f.read()).toMatchObject({
      status: "in_review", assigneeAgentId: f.reviewerId,
      executionPolicy: { ...f.policy, monitor: expect.objectContaining({ serviceName: "gitea" }) },
      executionState: { ...f.state, monitor: expect.objectContaining({ status: "scheduled" }) },
    });
    expect(await f.decisions()).toEqual([expect.objectContaining({ id: f.state.lastDecisionId })]);
  });

  it("clears only the native monitor while retaining the pending review and finding history", async () => {
    const f = await pendingReviewer();
    const armed = await f.patch({ executionPolicy: { ...f.policy, monitor: eventMonitor } }, f.reviewerKey.token);
    expect(armed.status, JSON.stringify(armed.body)).toBe(200);
    const cleared = await f.patch({ executionPolicy: { monitor: null } }, f.reviewerKey.token);
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await f.read()).toMatchObject({
      status: "in_review", assigneeAgentId: f.reviewerId,
      executionPolicy: f.policy,
      executionState: { ...f.state, monitor: expect.objectContaining({ status: "cleared", clearReason: "manual" }) },
    });
    expect(await f.decisions()).toEqual([expect.objectContaining({ id: f.state.lastDecisionId })]);
  });

  it("admits resolved-blocked user-owned local work directly to its explicit native review", async () => {
    const f = await localReviewCandidate();
    const response = await f.handoff();
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await f.read()).toMatchObject({ status: "in_review", assigneeAgentId: f.reviewerId, assigneeUserId: null,
      executionPolicy: f.policy, executionState: { status: "pending", currentStageId: f.policy.stages[0]!.id,
        returnAssignee: { type: "user", userId: f.userId, agentId: null }, completedStageIds: [] } });
    expect(await f.decisions()).toEqual([expect.objectContaining({ id: f.state.lastDecisionId })]);
  });

  it.each(["resume", "no_review", "unresolved_blocker", "active_execution"])(
    "preserves local handoff guards and ownership for %s", async (scenario) => {
      const f = await localReviewCandidate();
      if (scenario === "unresolved_blocker") {
        const [blocker] = await db.insert(issues).values({ companyId: f.companyId, title: "Unfinished prerequisite",
          issueNumber: 2, identifier: `BLOCKER-${fixtureNumber}`, status: "todo" }).returning();
        await db.insert(issueRelations).values({ companyId: f.companyId, issueId: blocker!.id, relatedIssueId: f.issueId, type: "blocks" });
      }
      if (scenario === "active_execution") {
        const child = spawn("cat", [], { stdio: "pipe" });
        const closed = once(child, "close");
        children.push({ child, closed });
        await once(child, "spawn", { signal: AbortSignal.timeout(5_000) });
        const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.reviewerId,
          status: "running", runtimeMode: "legacy", startedAt: new Date(), processPid: child.pid,
          invocationSource: "on_demand", contextSnapshot: { issueId: f.issueId } }).returning();
        await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, f.issueId));
      }
      const before = await f.read();
      const response = scenario === "resume"
        ? await f.patch({ status: "in_progress" }, f.reviewerKey.token)
        : scenario === "no_review"
          ? await f.patch({ status: "done" }, f.reviewerKey.token)
          : await f.handoff();
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(await f.read()).toEqual(before);
      expect(await f.decisions()).toHaveLength(1);
      expect(await f.audit()).toEqual([]);
    },
  );

  it("rolls a local review handoff back when its native audit cannot commit", async () => {
    const f = await localReviewCandidate();
    const before = await f.read();
    await db.execute(sql`alter table activity_log add constraint local_handoff_audit_must_commit check (action <> 'issue.updated') not valid`);
    try {
      const response = await f.handoff();
      expect(response.status, JSON.stringify(response.body)).toBe(500);
      expect(await f.read()).toEqual(before);
      expect(await f.decisions()).toHaveLength(1);
      expect(await f.audit()).toEqual([]);
    } finally {
      await db.execute(sql`alter table activity_log drop constraint local_handoff_audit_must_commit`);
    }
  });

  it("reselects the configured reviewer without resetting review history, then accepts their genuine changes-requested decision", async () => {
    const f = await fixture();
    const retained = await retainAuthorWorkspace(f);
    const recovery = await f.patch({ status: "todo", assigneeAgentId: f.authorId, assigneeUserId: null });
    expect(recovery.status, JSON.stringify(recovery.body)).toBe(200);
    expect(await f.read()).toMatchObject({
      status: "in_review", assigneeAgentId: f.reviewerId, assigneeUserId: null,
      executionPolicy: f.policy,
      executionState: {
        ...f.state,
        currentParticipant: { type: "agent", agentId: f.reviewerId, userId: null },
      },
    });
    expect(await f.decisions()).toHaveLength(1);
    expect(await f.audit()).toEqual([expect.objectContaining({ actorType: "user", actorId: f.userId })]);

    const decision = await f.patch({
      status: "in_progress", comment: "F4 still requires the original author to resolve the conflict.",
    }, f.reviewerKey.token);
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    const returned = await f.read();
    expect(returned).toMatchObject({
      status: "in_progress", assigneeAgentId: f.authorId, assigneeUserId: null,
      executionPolicy: f.policy,
      executionState: {
        status: "changes_requested", returnAssignee: f.state.returnAssignee,
        changesRequestedCount: 4, lastDecisionOutcome: "changes_requested",
      },
    });
    expect(await f.decisions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: f.state.lastDecisionId }),
      expect.objectContaining({
        id: returned.executionState?.lastDecisionId, actorAgentId: f.reviewerId,
        actorUserId: null, outcome: "changes_requested",
        body: "F4 still requires the original author to resolve the conflict.",
      }),
    ]));
    await heartbeatService(db).drainActiveRunExecutions();
    const initialRuns = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, f.companyId), eq(heartbeatRuns.agentId, f.authorId),
    ));
    expect(initialRuns).toHaveLength(1);
    process.stderr.write(`${JSON.stringify({ jsonrpc: "2.0", method: "review_recovery.predecessor_output", params: {
      runId: initialRuns[0]!.id, status: initialRuns[0]!.status, exitCode: initialRuns[0]!.exitCode,
      stdout: initialRuns[0]!.resultJson?.stdout ?? null, stderr: initialRuns[0]!.resultJson?.stderr ?? null,
    } })}\n`);
    expect(initialRuns[0]!.status).toBe("failed");
    expect(String(initialRuns[0]!.resultJson?.stderr)).toContain("Native author comment returned 403");

    // The old run cannot confer another person's authority. A new instruction
    // comes from the actual authenticated board user through the normal API.
    const direction = await request(f.server).post(`/api/issues/${f.issueId}/comments`)
      .set("authorization", `Bearer ${f.boardKey.token}`)
      .send({ body: "Continue the original F4 correction in its retained branch and workspace." });
    expect(direction.status, JSON.stringify(direction.body)).toBe(201);
    await heartbeatService(db).drainActiveRunExecutions();
    expect(await db.select().from(issueComments).where(and(
      eq(issueComments.issueId, f.issueId), eq(issueComments.authorAgentId, f.authorId),
    ))).toEqual([]);
    const reconciled = await request(f.server).post(`/api/issues/${f.issueId}/recovery-actions/resolve`)
      .set("authorization", `Bearer ${f.boardKey.token}`)
      .send({
        outcome: "restored", sourceIssueStatus: "todo",
        resolutionNote: "Resume the real board user's saved correction after the verified failed attempt.",
        executionReconciliation: {
          runId: initialRuns[0]!.id, providerStopped: true, actionOutcome: "not_performed",
          outcomeEvidence: `The test-owned native process exited 1 after its only write was refused with HTTP 403 RESPONSIBLE_USER_UNAVAILABLE. Native comment readback confirms no author write. The process is finished and its environment lease was released; resume the authenticated board user's saved F4 instruction.`,
        },
      });
    expect(reconciled.status, JSON.stringify(reconciled.body)).toBe(200);
    // Execute one real production maintenance pass, without a timer or polling.
    await deliverReconciledExecutions(db, heartbeatService(db).wakeup);
    await heartbeatService(db).drainActiveRunExecutions();
    const runs = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, f.companyId), eq(heartbeatRuns.agentId, f.authorId),
      sql`${heartbeatRuns.id} <> ${initialRuns[0]!.id}`,
    ));
    expect(runs).toHaveLength(1);
    process.stderr.write(`${JSON.stringify({ jsonrpc: "2.0", method: "review_recovery.successor_output", params: {
      runId: runs[0]!.id, responsibleUserId: runs[0]!.responsibleUserId,
      status: runs[0]!.status, exitCode: runs[0]!.exitCode,
      stdout: runs[0]!.resultJson?.stdout ?? null, stderr: runs[0]!.resultJson?.stderr ?? null,
    } })}\n`);
    expect(runs[0]!.responsibleUserId).toBe(f.userId);
    expect({ status: runs[0]!.status, exitCode: runs[0]!.exitCode,
      errorCode: runs[0]!.errorCode, error: runs[0]!.error, stderr: runs[0]!.resultJson?.stderr })
      .toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(JSON.parse(String(runs[0]!.resultJson?.stdout))).toMatchObject({
      jsonrpc: "2.0", method: "review_recovery.author_resumed",
      params: { runId: runs[0]!.id, branch: retained.branch, retained: "Original author correction remains unfinished.\n" },
    });
    expect(runs[0]!.startedAt).not.toBeNull();
    expect(await f.read()).toMatchObject({
      assigneeAgentId: f.authorId, executionWorkspaceId: retained.workspace.id,
      executionPolicy: f.policy, executionState: returned.executionState,
    });
    const [workspace] = await db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, retained.workspace.id));
    expect(workspace).toMatchObject({ cwd: retained.cwd, branchName: retained.branch });
    expect(await db.select().from(issueWorkProducts).where(eq(issueWorkProducts.id, retained.product.id))).toEqual([retained.product]);
    expect(await readFile(path.join(retained.cwd, "finding-F4.txt"), "utf8")).toBe("Original author correction remains unfinished.\n");
    expect((await exec("git", ["-C", retained.cwd, "symbolic-ref", "--short", "HEAD"])).stdout.trim()).toBe(retained.branch);
  });

  it("replaying the repair leaves the selected reviewer, counter and prior decision unchanged", async () => {
    const f = await fixture();
    expect((await f.patch({})).status).toBe(200);
    const first = await f.read();
    expect(first.assigneeAgentId).toBe(f.reviewerId);
    expect((await f.patch({})).status).toBe(200);
    const replay = await f.read();
    expect(replay.executionState).toEqual(first.executionState);
    expect(replay.executionPolicy).toEqual(first.executionPolicy);
    expect(replay.assigneeAgentId).toBe(f.reviewerId);
    expect(await f.decisions()).toHaveLength(1);
  });

  it("repairs the reviewer from authenticated middleware context before applying a requested status", async () => {
    const f = await fixture();
    const repaired = await f.patch({ status: "todo", assigneeAgentId: f.authorId, assigneeUserId: null });
    expect(repaired.status, JSON.stringify(repaired.body)).toBe(200);
    expect(await f.read()).toMatchObject({
      status: "in_review", assigneeAgentId: f.reviewerId, assigneeUserId: null,
      executionPolicy: f.policy,
      executionState: { currentParticipant: { type: "agent", agentId: f.reviewerId },
        returnAssignee: f.state.returnAssignee, changesRequestedCount: 3,
        lastDecisionId: f.state.lastDecisionId },
    });
    expect(await f.decisions()).toHaveLength(1);
  });

  it("escalates a future agent decision to the real creator when the responsible user is the legacy sentinel", async () => {
    const f = await fixture();
    await db.update(issues).set({
      assigneeAgentId: f.reviewerId, assigneeUserId: null, createdByUserId: f.userId,
      executionState: { ...f.state, changesRequestedCount: 2,
        currentParticipant: { type: "agent", agentId: f.reviewerId, userId: null } },
    }).where(eq(issues.id, f.issueId));
    const decision = await f.patch({ status: "in_progress", comment: "The creator must decide the remaining finding." }, f.reviewerKey.token);
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    expect(await f.read()).toMatchObject({
      status: "in_review", assigneeUserId: f.userId, assigneeAgentId: null,
      executionState: { status: "pending", changesRequestedCount: 3,
        currentParticipant: { type: "user", userId: f.userId, agentId: null }, returnAssignee: f.state.returnAssignee },
    });
  });

  it("refuses recovery without an eligible configured reviewer and preserves the stage", async () => {
    const f = await fixture();
    await db.update(issues).set({ executionPolicy: { ...f.policy, stages: [{
      ...f.policy.stages[0]!, participants: [{ id: randomUUID(), type: "agent", agentId: f.authorId, userId: null }],
    }] } }).where(eq(issues.id, f.issueId));
    const before = await f.read();
    const refused = await f.patch({});
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(await f.read()).toEqual(before);
    expect(await f.decisions()).toHaveLength(1);
  });

  it("refuses to repair a review while a real execution is still active", async () => {
    const f = await fixture();
    const child = spawn("cat", [], { stdio: "pipe" });
    const closed = once(child, "close");
    children.push({ child, closed });
    await once(child, "spawn", { signal: AbortSignal.timeout(5_000) });
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: f.companyId, agentId: f.authorId, status: "running", runtimeMode: "legacy",
      startedAt: new Date(), processPid: child.pid, invocationSource: "on_demand", contextSnapshot: { issueId: f.issueId },
    }).returning();
    await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, f.issueId));
    const before = await f.read();
    const refused = await f.patch({});
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(await f.read()).toEqual(before);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id))).toEqual([run]);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  });

  it("rolls the repair back when its native audit cannot commit", async () => {
    const f = await fixture();
    const before = await f.read();
    // Preserve the existing audit history and reject only new audit writes.
    await db.execute(sql`alter table activity_log add constraint review_audit_must_commit check (action <> 'issue.updated') not valid`);
    try {
      const refused = await f.patch({});
      expect(refused.status, JSON.stringify(refused.body)).toBe(500);
      expect(await f.read()).toEqual(before);
      expect(await f.decisions()).toHaveLength(1);
      expect(await f.audit()).toEqual([]);
    } finally {
      await db.execute(sql`alter table activity_log drop constraint review_audit_must_commit`);
    }
  });

  it.each(["recovery", "monitor"])("refuses a stale %s update when the human owner changes under the issue lock", async (operation) => {
    const f = operation === "monitor" ? await pendingReviewer() : await fixture();
    const humanState = { ...f.state, currentParticipant: { type: "user" as const, userId: f.userId, agentId: null } };
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const locked = once(queryEvents, "human-owner-locked", { signal: AbortSignal.timeout(5_000) });
    const ownershipChange = db.transaction(async (tx) => {
      await tx.select().from(issues).where(eq(issues.id, f.issueId)).for("update");
      await tx.update(issues).set({ assigneeAgentId: null, assigneeUserId: f.userId, executionState: humanState }).where(eq(issues.id, f.issueId));
      queryEvents.emit("human-owner-locked");
      await released;
    });
    let pending: Promise<request.Response> | undefined;
    let response: request.Response | undefined;
    try {
      await Promise.race([locked, ownershipChange]);
      const mutationStarted = once(queryEvents, "issue-mutation", { signal: AbortSignal.timeout(5_000) });
      pending = f.patch(operation === "monitor" ? { executionPolicy: { monitor: eventMonitor } } : {}).then((result) => result);
      await mutationStarted;
    } finally {
      release();
      await ownershipChange;
      if (pending) response = await pending;
    }
    expect(response!.status, JSON.stringify(response!.body)).toBe(409);
    expect(await f.read()).toMatchObject({
      status: "in_review", assigneeAgentId: null, assigneeUserId: f.userId,
      executionPolicy: f.policy, executionState: humanState,
    });
    expect(await f.decisions()).toHaveLength(1);
    expect(await f.audit()).toEqual([]);
  });

  it.each([
    { credential: "anonymous", expectedStatus: 404 },
    { credential: "invalid", expectedStatus: 401 },
    { credential: "other-company", expectedStatus: 404 },
  ])("refuses $credential recovery without changing the hold", async ({ credential, expectedStatus }) => {
    const f = await fixture();
    const before = await f.read();
    const token = credential === "anonymous" ? null
      : credential === "invalid" ? "pcp_board_invalid"
        : (await fixture()).boardKey.token;
    const response = await f.patch({}, token);
    expect(response.status, JSON.stringify(response.body)).toBe(expectedStatus);
    expect(await f.read()).toEqual(before);
    expect(await f.decisions()).toHaveLength(1);
    expect(await f.audit()).toEqual([]);
  });

  it("retains a legitimate human escalation and only accepts that human's decision", async () => {
    const f = await fixture();
    const heldState = {
      ...f.state, currentParticipant: { type: "user" as const, userId: f.userId, agentId: null },
    };
    await db.update(issues).set({ assigneeUserId: f.userId, executionState: heldState })
      .where(eq(issues.id, f.issueId));
    const otherUser = await fixture();
    await db.insert(companyMemberships).values({
      companyId: f.companyId, principalType: "user", principalId: otherUser.userId,
      membershipRole: "owner", status: "active",
    });
    const before = await f.read();
    const refused = await f.patch({ status: "todo", assigneeAgentId: f.authorId, assigneeUserId: null }, otherUser.boardKey.token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error).toBe("Only the escalated reviewer can advance the current execution stage");
    expect(await f.read()).toEqual(before);
    const decision = await f.patch({ status: "in_progress", comment: "Human requests the original correction." });
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    expect(await f.read()).toMatchObject({
      status: "in_progress", assigneeAgentId: f.authorId,
      executionState: { status: "changes_requested", changesRequestedCount: 0 },
    });
    expect(await f.decisions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorUserId: f.userId, actorAgentId: null, outcome: "changes_requested" }),
    ]));
  });

  it("keeps the local-board hold on a local-trusted server even for a real board-key request", async () => {
    const f = await fixture("local_trusted");
    const before = await f.read();
    const refused = await f.patch({ status: "todo", assigneeAgentId: f.authorId, assigneeUserId: null });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(await f.read()).toEqual(before);
    const decision = await f.patch({ status: "in_progress", comment: "The local board returns this to its author." }, null);
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    expect(await f.read()).toMatchObject({
      status: "in_progress", assigneeAgentId: f.authorId,
      executionState: { status: "changes_requested", changesRequestedCount: 0 },
    });
    expect(await f.decisions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorUserId: "local-board", actorAgentId: null, outcome: "changes_requested" }),
    ]));
  });
});
