import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog, agents, agentRuntimeState, agentTaskSessions, agentWakeupRequests, authUsers,
  companies, companySkills, createDb, documentRevisions, documents, environmentLeases, executionWorkspaces,
  heartbeatRunEvents, heartbeatRuns, issueComments, issueDocuments, issueRecoveryActions,
  issueRelations, issues, projects, projectWorkspaces, workspaceOperations,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { resolveManagedProjectWorkspaceDir } from "../home-paths.js";
import { heartbeatService } from "../services/heartbeat.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const exec = promisify(execFile);

describe("persisted workspace reuse through real Git, heartbeat, routes and Postgres", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  const roots: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-workspace-reuse-");
    db = createDb(database.connectionString);
    heartbeat = heartbeatService(db);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });
  }, 90_000);

  afterEach(async () => {
    await heartbeat.drainActiveRunExecutions();
    await db.delete(activityLog);
    await db.delete(workspaceOperations);
    await db.delete(issueRecoveryActions);
    await db.delete(issueComments);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(heartbeatRunEvents);
    await db.delete(environmentLeases);
    await db.delete(agentTaskSessions);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(companySkills);
    await db.delete(companies);
    await db.delete(authUsers);
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await db?.$client.end();
    await database?.cleanup();
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
  });

  async function fixture() {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "workspace-reuse-")));
    roots.push(root);
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_CONFIG", path.join(root, "config.json"));
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Test operator", email: `${userId}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    const [company] = await db.insert(companies).values({ name: "Workspace reuse",
      issuePrefix: `W${randomUUID().slice(0, 6).toUpperCase()}`, defaultResponsibleUserId: userId,
      requireBoardApprovalForNewAgents: false }).returning();
    const [project] = await db.insert(projects).values({ companyId: company!.id, name: "Project" }).returning();
    const original = resolveManagedProjectWorkspaceDir({ companyId: company!.id, projectId: project!.id, repoName: "original" });
    const replacement = resolveManagedProjectWorkspaceDir({ companyId: company!.id, projectId: project!.id, repoName: "replacement" });
    const repoUrl = "https://example.invalid/original.git";
    for (const repo of [original, replacement]) {
      await fs.mkdir(repo, { recursive: true });
      await exec("git", ["init", repo]);
      await exec("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
      await exec("git", ["-C", repo, "remote", "add", "origin", repo === original ? repoUrl : "https://example.invalid/replacement.git"]);
    }
    const branch = "tasks/TEST-retain-original-work";
    const cwd = path.join(original, ".paperclip", "worktrees", branch);
    await exec("git", ["-C", original, "worktree", "add", "-b", branch, cwd]);
    await fs.writeFile(path.join(cwd, "retained.txt"), "original uncommitted work\n");
    const [source] = await db.insert(projectWorkspaces).values({ companyId: company!.id, projectId: project!.id,
      name: "Original", cwd: original, repoUrl, repoRef: "HEAD", isPrimary: true }).returning();
    const [agent] = await db.insert(agents).values({ companyId: company!.id, name: "Executor", role: "engineer",
      status: "idle", adapterType: "process", adapterConfig: { command: "git", args: ["rev-parse", "--show-toplevel"], cwd,
        workspaceStrategy: { type: "git_worktree", baseRef: "HEAD" } },
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).returning();
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId: company!.id, projectId: project!.id,
      projectWorkspaceId: source!.id, mode: "isolated_workspace", strategyType: "git_worktree", name: branch,
      status: "active", cwd, providerRef: cwd, providerType: "git_worktree", repoUrl, baseRef: "HEAD", branchName: branch,
      metadata: { createdByRuntime: true, gitBranchOwnershipVersion: 1 } }).returning();
    const [issue] = await db.insert(issues).values({ companyId: company!.id, projectId: project!.id,
      projectWorkspaceId: source!.id, title: "Retain workspace source", status: "in_progress",
      assigneeAgentId: agent!.id, responsibleUserId: userId, executionWorkspaceId: workspace!.id,
      executionWorkspacePreference: "reuse_existing", executionWorkspaceSettings: { mode: "isolated_workspace" } }).returning();
    await db.update(executionWorkspaces).set({ sourceIssueId: issue!.id }).where(eq(executionWorkspaces.id, workspace!.id));
    await db.delete(projectWorkspaces).where(eq(projectWorkspaces.id, source!.id));
    const [newSource] = await db.insert(projectWorkspaces).values({ companyId: company!.id, projectId: project!.id,
      name: "Replacement", cwd: replacement, repoUrl: "https://example.invalid/replacement.git", repoRef: "HEAD",
      isPrimary: true }).returning();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "board", userId, source: "local_implicit", isInstanceAdmin: true }; next(); });
    app.use("/api", issueRoutes(db, {} as Parameters<typeof issueRoutes>[1]));
    app.use(errorHandler);
    return { company: company!, agent: agent!, issue: issue!, workspace: workspace!, newSource: newSource!, original, replacement, cwd, branch, app };
  }

  it("runs a retained worktree from its original repository after the project source is replaced, preserving work and null bindings", async () => {
    const f = await fixture();
    const finished = await runFixture(f);
    expect(finished, JSON.stringify({ errorCode: finished?.errorCode, error: finished?.error, result: finished?.resultJson })).toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(finished!.resultJson?.stdout).toBe(`${f.cwd}\n`);
    await expectRetained(f);
  }, 30_000);

  async function runFixture(f: Awaited<ReturnType<typeof fixture>>) {
    const run = await heartbeat.wakeup(f.agent.id, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
      payload: { issueId: f.issue.id }, requestedByActorType: "system", requestedByActorId: "workspace-reuse-test",
      contextSnapshot: { issueId: f.issue.id } });
    expect(run).not.toBeNull();
    await heartbeat.drainActiveRunExecutions();
    const [finished] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    return finished!;
  }

  async function expectRetained(f: Awaited<ReturnType<typeof fixture>>, projectWorkspaceId: string | null = null) {
    const issue = await request(f.app).get(`/api/issues/${f.issue.id}`).expect(200);
    expect(issue.body).toMatchObject({ assigneeAgentId: f.agent.id, executionWorkspaceId: f.workspace.id, projectWorkspaceId });
    const [workspace] = await db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, f.workspace.id));
    expect(workspace).toMatchObject({ cwd: f.cwd, branchName: f.branch, repoUrl: f.workspace.repoUrl, projectWorkspaceId: null });
    expect(await fs.readFile(path.join(f.cwd, "retained.txt"), "utf8")).toBe("original uncommitted work\n");
    expect((await exec("git", ["-C", f.cwd, "symbolic-ref", "--short", "HEAD"])).stdout.trim()).toBe(f.branch);
  }

  it.each([
    ["changed origin", "source_repository_mismatch"],
    ["ambiguous origin", "source_repository_mismatch"],
    ["explicit replacement binding", "explicit_project_workspace_conflict"],
    ["conflicting provider path", "source_path_unproven"],
    ["lost worktree registration", "source_registration_unproven"],
  ])("rejects %s before process launch and preserves the retained workspace", async (scenario, reasonCode) => {
    const f = await fixture();
    if (scenario === "changed origin") {
      await exec("git", ["-C", f.original, "remote", "set-url", "origin", "https://example.invalid/foreign.git"]);
    } else if (scenario === "ambiguous origin") {
      await exec("git", ["-C", f.original, "config", "--add", "remote.origin.url", f.workspace.repoUrl!]);
    } else if (scenario === "explicit replacement binding") {
      await db.update(issues).set({ projectWorkspaceId: f.newSource.id }).where(eq(issues.id, f.issue.id));
    } else if (scenario === "conflicting provider path") {
      await db.update(executionWorkspaces).set({ providerRef: f.replacement }).where(eq(executionWorkspaces.id, f.workspace.id));
    } else {
      const { stdout } = await exec("git", ["-C", f.cwd, "rev-parse", "--absolute-git-dir"]);
      await fs.rename(path.join(stdout.trim(), "gitdir"), path.join(stdout.trim(), "gitdir.saved"));
    }
    const finished = await runFixture(f);
    expect(finished).toMatchObject({ status: "failed", errorCode: "workspace_validation_failed", processPid: null,
      resultJson: { workspaceValidation: { reason: "persisted_workspace_source_conflict", reasonCode, executionWorkspaceId: f.workspace.id } } });
    expect(finished.resultJson).not.toHaveProperty("stdout");
    await expectRetained(f, scenario === "explicit replacement binding" ? f.newSource.id : null);
  }, 30_000);
});
