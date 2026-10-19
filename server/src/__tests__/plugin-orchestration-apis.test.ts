import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agentWakeupRequests,
  agents,
  approvals,
  assets,
  companies,
  companySkills,
  companyMemberships,
  costEvents,
  createDb,
  executionWorkspaces,
  heartbeatRunEvents,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issueRelations,
  issueThreadInteractions,
  issueWorkProducts,
  issues,
  pluginManagedResources,
  plugins,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { buildHostServices } from "../services/plugin-host-services.js";
import { heartbeatService } from "../services/heartbeat.js";
import { issueExecutionStateSchema } from "@paperclipai/shared";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: async () => {},
        subscribe: () => {},
      };
    },
  } as any;
}

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres plugin orchestration API tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("plugin orchestration APIs", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-plugin-orchestration-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  function isHeartbeatRunDependentFkError(error: unknown) {
    const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
    return (
      message.includes("heartbeat_run_events_run_id_heartbeat_runs_id_fk")
      || message.includes("activity_log_run_id_heartbeat_runs_id_fk")
    );
  }

  // A real (fire-and-forget) heartbeat run may still be executing in the
  // background when a test's own createComment-triggered wakeup completes —
  // retry deletion so that race doesn't fail cleanup with an FK violation.
  async function deleteHeartbeatRunsWithDependents() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await db.delete(heartbeatRunEvents);
      await db.delete(activityLog);
      try {
        await db.delete(heartbeatRuns);
        return;
      } catch (error) {
        if (!isHeartbeatRunDependentFkError(error) || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
    // Await every in-flight background heartbeat run to quiescence before the
    // deletes below. A createComment-triggered wakeup dispatches its run
    // fire-and-forget (void heartbeat.wakeup(...)), so a run or wakeup can still
    // write heartbeat_runs and issues rows when teardown starts and would race
    // the deletes. The heartbeat service tracks in-flight run and wakeup
    // promises in module state shared across service instances, so a fresh
    // instance here drains the runs the per-test host services dispatched.
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    await db.delete(costEvents);
    await deleteHeartbeatRunsWithDependents();
    await db.delete(agentWakeupRequests);
    await db.delete(issueRelations);
    await db.delete(issueComments);
    await db.delete(issueThreadInteractions);
    await db.delete(issueAttachments);
    await db.delete(assets);
    await db.delete(approvals);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(pluginManagedResources);
    await db.delete(projects);
    await db.delete(plugins);
    await db.delete(companyMemberships);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: issuePrefix(companyId),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Engineer",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: { command: "true" },
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function makeLocalRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-plugin-host-folder-"));
    tempRoots.push(root);
    return root;
  }

  it("returns plugin-safe execution workspace metadata scoped to the company", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const otherCompanyId = randomUUID();
    const projectId = randomUUID();
    const workspaceId = randomUUID();
    await db.insert(companies).values({
      id: otherCompanyId,
      name: "Other",
      issuePrefix: issuePrefix(otherCompanyId),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Workspaces",
      status: "in_progress",
    });
    await db.insert(executionWorkspaces).values({
      id: workspaceId,
      companyId,
      projectId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Feature workspace",
      status: "active",
      cwd: "/tmp/paperclip-feature",
      repoUrl: "https://example.com/paperclip.git",
      baseRef: "main",
      branchName: "feature/workspace",
      providerType: "git_worktree",
      providerRef: "/tmp/paperclip-feature",
      metadata: {
        providerMetadata: { sandboxId: "sandbox-1" },
        workspaceRealizationRequest: { hiddenInternal: true },
      },
    });

    const services = buildHostServices(db, "plugin-record-id", "paperclip.workspace", createEventBusStub());

    await expect(services.executionWorkspaces.get({ workspaceId, companyId })).resolves.toMatchObject({
      id: workspaceId,
      companyId,
      projectId,
      projectWorkspaceId: null,
      path: "/tmp/paperclip-feature",
      cwd: "/tmp/paperclip-feature",
      repoUrl: "https://example.com/paperclip.git",
      baseRef: "main",
      branchName: "feature/workspace",
      providerType: "git_worktree",
      providerMetadata: { sandboxId: "sandbox-1" },
    });
    await expect(services.executionWorkspaces.get({ workspaceId, companyId: otherCompanyId })).resolves.toBeNull();
  });

  it("returns persisted review work products only within the issue company", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const other = await seedCompanyAndAgent();
    const [issue] = await db.insert(issues).values({ companyId, title: "Review CI", status: "in_review" }).returning();
    const [product] = await db.insert(issueWorkProducts).values({ companyId, issueId: issue.id,
      type: "pull_request", provider: "gitea", title: "Review", status: "active", isPrimary: true,
      url: "https://git.example/owner/repo/pulls/1", metadata: { headSha: "abc123" },
    }).returning();
    const services = buildHostServices(db, "plugin-record-id", "paperclip.ci-wake", createEventBusStub());
    await expect(services.issues.get({ companyId, issueId: issue.id })).resolves.toMatchObject({
      id: issue.id, workProducts: [expect.objectContaining({ id: product.id, type: "pull_request",
        provider: "gitea", url: product.url, metadata: { headSha: "abc123" } })],
    });
    await expect(services.issues.get({ companyId: other.companyId, issueId: issue.id })).resolves.toBeNull();
  });

  it("creates plugin-origin issues with full orchestration fields and audit activity", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const blockerIssueId = randomUUID();
    const originRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: originRunId,
      companyId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: { issueId: blockerIssueId },
    });
    await db.insert(issues).values({
      id: blockerIssueId,
      companyId,
      title: "Blocker",
      status: "todo",
      priority: "medium",
      identifier: `${issuePrefix(companyId)}-blocker`,
    });

    const services = buildHostServices(db, "plugin-record-id", "paperclip.missions", createEventBusStub());
    const issue = await services.issues.create({
      companyId,
      title: "Plugin child issue",
      status: "todo",
      assigneeAgentId: agentId,
      billingCode: "mission:alpha",
      originId: "mission-alpha",
      blockedByIssueIds: [blockerIssueId],
      actorAgentId: agentId,
      actorRunId: originRunId,
    });

    const [stored] = await db.select().from(issues).where(eq(issues.id, issue.id));
    expect(stored?.originKind).toBe("plugin:paperclip.missions");
    expect(stored?.originId).toBe("mission-alpha");
    expect(stored?.billingCode).toBe("mission:alpha");
    expect(stored?.assigneeAgentId).toBe(agentId);
    expect(stored?.createdByAgentId).toBe(agentId);
    expect(stored?.originRunId).toBe(originRunId);

    const [relation] = await db
      .select()
      .from(issueRelations)
      .where(and(eq(issueRelations.issueId, blockerIssueId), eq(issueRelations.relatedIssueId, issue.id)));
    expect(relation?.type).toBe("blocks");

    const activities = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issue.id)));
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: "plugin",
          actorId: "plugin-record-id",
          action: "issue.created",
          agentId,
          details: expect.objectContaining({
            sourcePluginId: "plugin-record-id",
            sourcePluginKey: "paperclip.missions",
            initiatingActorType: "agent",
            initiatingActorId: agentId,
            initiatingRunId: originRunId,
          }),
        }),
      ]),
    );
  });

  it("enforces plugin origin namespaces", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const services = buildHostServices(db, "plugin-record-id", "paperclip.missions", createEventBusStub());

    const featureIssue = await services.issues.create({
      companyId,
      title: "Feature issue",
      originKind: "plugin:paperclip.missions:feature",
      originId: "mission-alpha:feature-1",
    });
    expect(featureIssue.originKind).toBe("plugin:paperclip.missions:feature");

    await expect(
      services.issues.create({
        companyId,
        title: "Spoofed issue",
        originKind: "plugin:other.plugin:feature",
      }),
    ).rejects.toThrow("Plugin may only use originKind values under plugin:paperclip.missions");

    await expect(
      services.issues.update({
        issueId: featureIssue.id,
        companyId,
        patch: { originKind: "plugin:other.plugin:feature" },
      }),
    ).rejects.toThrow("Plugin may only use originKind values under plugin:paperclip.missions");
  });

  it("creates plugin operation issues with the generic operation origin", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const services = buildHostServices(db, "plugin-record-id", "paperclip.missions", createEventBusStub());

    const issue = await services.issues.create({
      companyId,
      title: "Background operation",
      surfaceVisibility: "plugin_operation",
      originId: "mission-alpha:operation-1",
    });

    expect(issue.originKind).toBe("plugin:paperclip.missions:operation");
    expect(issue.originId).toBe("mission-alpha:operation-1");
  });

  it("lets bootstrap-style actions initialize required local folders from an empty root", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "paperclipai.plugin-llm-wiki",
      packageName: "@paperclipai/plugin-llm-wiki",
      version: "0.1.0",
      manifestJson: {
        id: "paperclipai.plugin-llm-wiki",
        apiVersion: 1,
        version: "0.1.0",
        displayName: "LLM Wiki",
        description: "Local-file LLM Wiki plugin",
        author: "Paperclip",
        categories: ["automation"],
        capabilities: ["local.folders"],
        entrypoints: { worker: "./dist/worker.js" },
        localFolders: [
          {
            folderKey: "wiki-root",
            displayName: "Wiki root",
            access: "readWrite",
            requiredDirectories: ["raw", "wiki", "wiki/concepts", ".paperclip"],
            requiredFiles: ["WIKI.md", "AGENTS.md"],
          },
        ],
      },
      status: "ready",
    });
    const root = await makeLocalRoot();
    const services = buildHostServices(
      db,
      pluginId,
      "paperclipai.plugin-llm-wiki",
      createEventBusStub(),
      undefined,
      {
        manifest: {
          id: "paperclipai.plugin-llm-wiki",
          apiVersion: 1,
          version: "0.1.0",
          displayName: "LLM Wiki",
          description: "Local-file LLM Wiki plugin",
          author: "Paperclip",
          categories: ["automation"],
          capabilities: ["local.folders"],
          entrypoints: { worker: "./dist/worker.js" },
          localFolders: [
            {
              folderKey: "wiki-root",
              displayName: "Wiki root",
              access: "readWrite",
              requiredDirectories: ["raw", "wiki", "wiki/concepts", ".paperclip"],
              requiredFiles: ["WIKI.md", "AGENTS.md"],
            },
          ],
        },
      },
    );

    const configured = await services.localFolders.configure({
      companyId,
      folderKey: "wiki-root",
      path: root,
      access: "readWrite",
      requiredDirectories: ["raw", "wiki", "wiki/concepts", ".paperclip"],
      requiredFiles: ["WIKI.md", "AGENTS.md"],
    });
    expect(configured.healthy).toBe(false);
    expect(configured.missingDirectories).toEqual([]);
    expect(configured.missingFiles).toEqual(["WIKI.md", "AGENTS.md"]);

    await fs.rm(path.join(root, "raw"), { recursive: true, force: true });
    await fs.rm(path.join(root, "wiki"), { recursive: true, force: true });
    await expect(services.localFolders.readText({ companyId, folderKey: "wiki-root", relativePath: "WIKI.md" }))
      .rejects.toThrow("Local folder is not healthy");
    await services.localFolders.writeTextAtomic({
      companyId,
      folderKey: "wiki-root",
      relativePath: "WIKI.md",
      contents: "# Wiki\n",
    });
    await services.localFolders.writeTextAtomic({
      companyId,
      folderKey: "wiki-root",
      relativePath: "AGENTS.md",
      contents: "# Agents\n",
    });

    const finalStatus = await services.localFolders.status({ companyId, folderKey: "wiki-root" });
    expect(finalStatus.healthy).toBe(true);
    await expect(fs.stat(path.join(root, "raw"))).resolves.toMatchObject({});
    await expect(fs.stat(path.join(root, "wiki/concepts"))).resolves.toMatchObject({});
    await expect(fs.readFile(path.join(root, "WIKI.md"), "utf8")).resolves.toBe("# Wiki\n");
  });

  it("rejects worker local-folder access for undeclared manifest keys", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "paperclip.local-folders",
      packageName: "@paperclip/plugin-local-folders",
      version: "0.1.0",
      manifestJson: {
        id: "paperclip.local-folders",
        apiVersion: 1,
        version: "0.1.0",
        displayName: "Local Folders",
        description: "Local folder fixture",
        author: "Paperclip",
        categories: ["automation"],
        capabilities: ["local.folders"],
        entrypoints: { worker: "./dist/worker.js" },
        localFolders: [
          {
            folderKey: "content-root",
            displayName: "Content root",
            access: "readWrite",
          },
        ],
      },
      status: "ready",
    });
    const services = buildHostServices(
      db,
      pluginId,
      "paperclip.local-folders",
      createEventBusStub(),
      undefined,
      {
        manifest: {
          id: "paperclip.local-folders",
          apiVersion: 1,
          version: "0.1.0",
          displayName: "Local Folders",
          description: "Local folder fixture",
          author: "Paperclip",
          categories: ["automation"],
          capabilities: ["local.folders"],
          entrypoints: { worker: "./dist/worker.js" },
          localFolders: [
            {
              folderKey: "content-root",
              displayName: "Content root",
              access: "readWrite",
            },
          ],
        },
      },
    );
    await expect(services.localFolders.configure({
      companyId,
      folderKey: "ssh",
      path: "/tmp",
      access: "read",
    })).rejects.toThrow("Local folder key is not declared");
    await expect(services.localFolders.status({ companyId, folderKey: "ssh" }))
      .rejects.toThrow("Local folder key is not declared");
    await expect(services.localFolders.readText({ companyId, folderKey: "ssh", relativePath: "id_rsa" }))
      .rejects.toThrow("Local folder key is not declared");
    await expect(services.localFolders.writeTextAtomic({
      companyId,
      folderKey: "ssh",
      relativePath: "id_rsa",
      contents: "secret",
    })).rejects.toThrow("Local folder key is not declared");
  });

  it("resolves plugin-managed projects by stable key without overwriting user edits", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "paperclip.missions",
      packageName: "@paperclip/plugin-missions",
      version: "0.1.0",
      apiVersion: 1,
      categories: ["automation"],
      status: "ready",
      manifestJson: {
        id: "paperclip.missions",
        apiVersion: 1,
        version: "0.1.0",
        displayName: "Missions",
        description: "Mission orchestration",
        author: "Paperclip",
        categories: ["automation"],
        capabilities: ["projects.managed"],
        entrypoints: { worker: "./dist/worker.js" },
        projects: [{
          projectKey: "operations",
          displayName: "Mission Operations",
          description: "Plugin operation inspection area",
          status: "in_progress",
          color: "#14b8a6",
          settings: { surface: "operations" },
        }],
      },
    });

    const services = buildHostServices(db, pluginId, "paperclip.missions", createEventBusStub());
    const missing = await services.projects.getManaged({ companyId, projectKey: "operations" });
    expect(missing.status).toBe("missing");
    expect(missing.projectId).toBeNull();
    await expect(
      db
        .select()
        .from(pluginManagedResources)
        .where(and(
          eq(pluginManagedResources.companyId, companyId),
          eq(pluginManagedResources.pluginId, pluginId),
          eq(pluginManagedResources.resourceKind, "project"),
          eq(pluginManagedResources.resourceKey, "operations"),
        )),
    ).resolves.toHaveLength(0);

    const created = await services.projects.reconcileManaged({ companyId, projectKey: "operations" });

    expect(created.status).toBe("created");
    expect(created.projectId).toEqual(expect.any(String));
    expect(created.project?.managedByPlugin).toMatchObject({
      pluginId,
      pluginKey: "paperclip.missions",
      pluginDisplayName: "Missions",
      resourceKind: "project",
      resourceKey: "operations",
    });

    await db
      .update(projects)
      .set({ name: "Renamed by operator", description: "User-owned text", updatedAt: new Date() })
      .where(eq(projects.id, created.projectId!));
    await db
      .update(plugins)
      .set({
        manifestJson: {
          id: "paperclip.missions",
          apiVersion: 1,
          version: "0.2.0",
          displayName: "Missions",
          description: "Mission orchestration",
          author: "Paperclip",
          categories: ["automation"],
          capabilities: ["projects.managed"],
          entrypoints: { worker: "./dist/worker.js" },
          projects: [{
            projectKey: "operations",
            displayName: "Upgraded Default Name",
            description: "Upgraded default description",
            status: "planned",
            color: "#f97316",
            settings: { surface: "operations", upgraded: true },
          }],
        },
        updatedAt: new Date(),
      })
      .where(eq(plugins.id, pluginId));

    const resolved = await services.projects.reconcileManaged({ companyId, projectKey: "operations" });

    expect(resolved.status).toBe("resolved");
    expect(resolved.projectId).toBe(created.projectId);
    expect(resolved.project?.name).toBe("Renamed by operator");
    expect(resolved.project?.description).toBe("User-owned text");
    expect(resolved.project?.managedByPlugin?.defaultsJson).toMatchObject({
      displayName: "Upgraded Default Name",
      settings: { upgraded: true },
    });
  });

  it("asserts checkout ownership for run-scoped plugin actions", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const issueId = randomUUID();
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: { issueId },
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Checked out issue",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
      executionRunId: runId,
    });

    const services = buildHostServices(db, "plugin-record-id", "paperclip.missions", createEventBusStub());
    await expect(
      services.issues.assertCheckoutOwner({
        issueId,
        companyId,
        actorAgentId: agentId,
        actorRunId: runId,
      }),
    ).resolves.toMatchObject({
      issueId,
      status: "in_progress",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
    });
  });

  it("refuses plugin wakeups for issues with unresolved blockers", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const blockerIssueId = randomUUID();
    const blockedIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: blockerIssueId,
        companyId,
        title: "Unresolved blocker",
        status: "todo",
        priority: "medium",
      },
      {
        id: blockedIssueId,
        companyId,
        title: "Blocked issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
      },
    ]);
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerIssueId,
      relatedIssueId: blockedIssueId,
      type: "blocks",
    });

    const services = buildHostServices(db, "plugin-record-id", "paperclip.missions", createEventBusStub());
    await expect(
      services.issues.requestWakeup({
        issueId: blockedIssueId,
        companyId,
        reason: "mission_advance",
      }),
    ).rejects.toThrow("Issue is blocked by unresolved blockers");
  });

  async function seedCiReviewWait(serviceName = "gitea") {
    const { companyId, agentId } = await seedCompanyAndAgent();
    await db.update(companies).set({ defaultResponsibleUserId: "review-owner" }).where(eq(companies.id, companyId));
    const stageId = randomUUID();
    const externalRef = JSON.stringify({ pullRequestUrl: "https://git.example/owner/repo/pulls/1",
      headSha: "current-head", context: "Flake Check" });
    const monitor = { nextCheckAt: null, kind: "external_service", serviceName, externalRef,
      scheduledBy: "assignee", maxAttempts: 1 };
    const executionState = issueExecutionStateSchema.parse({ status: "pending", currentStageId: stageId,
      currentStageIndex: 0, currentStageType: "review", currentParticipant: { type: "agent", agentId },
      returnAssignee: { type: "user", userId: "review-owner" }, completedStageIds: [], lastDecisionId: null,
      lastDecisionOutcome: null, monitor: { ...monitor, externalRef: "[redacted]", status: "scheduled", lastTriggeredAt: null,
        attemptCount: 0, notes: null, clearedAt: null, clearReason: null } });
    const executionPolicy = normalizeIssueExecutionPolicy({ maxReviewRounds: 4, stages: [{ id: stageId, type: "review",
      participants: [{ type: "agent", agentId }] }], monitor });
    const [issue] = await db.insert(issues).values({ companyId, title: "Await CI", status: "in_review",
      assigneeAgentId: agentId, executionPolicy: executionPolicy as Record<string, unknown>, executionState, monitorNextCheckAt: null }).returning();
    return { companyId, agentId, stageId, externalRef, executionState, executionPolicy, issue };
  }

  it.each(["matching", "wrong head", "wrong context", "provider quota"])(
    "consumes only the bound external CI wait (%s)", async (scenario) => {
      const { companyId, agentId, stageId, externalRef, executionState, executionPolicy, issue } =
        await seedCiReviewWait(scenario === "provider quota" ? "provider_quota" : "gitea");
      const heartbeat = heartbeatService(db);
      await heartbeat.tickTimers(new Date("2099-01-01T00:00:00Z"));
      expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId))).toHaveLength(0);
      const services = buildHostServices(db, "plugin-record-id", "paperclip.ci-wake", createEventBusStub());
      const event = { pullRequestUrl: "https://git.example/owner/repo/pulls/1", headSha: "current-head", context: "Flake Check" };
      if (scenario === "wrong head") event.headSha = "old-head";
      if (scenario === "wrong context") event.context = "Other Check";
      const result = await services.issues.requestWakeup({ companyId, issueId: issue.id,
        monitor: { serviceName: "gitea", externalRef: JSON.stringify(event) } });
      await heartbeat.drainActiveRunExecutions();
      const [after] = await db.select().from(issues).where(eq(issues.id, issue.id));
      expect(after).toMatchObject({ status: "in_review", assigneeAgentId: agentId, monitorNextCheckAt: null });
      expect(after.executionState).toMatchObject({ status: "pending", currentStageId: stageId,
        currentParticipant: { type: "agent", agentId }, returnAssignee: { type: "user", userId: "review-owner" } });
      if (scenario === "matching") {
        expect(result.queued).toBe(true);
        expect(after.executionPolicy?.monitor).toBeUndefined();
        expect(after.executionPolicy?.maxReviewRounds).toBe(4);
        expect(after.executionState?.monitor).toMatchObject({ status: "triggered", attemptCount: 1 });
        await expect(services.issues.requestWakeup({ companyId, issueId: issue.id,
          monitor: { serviceName: "gitea", externalRef } })).resolves.toEqual({ queued: false, runId: null });
        expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId))).toHaveLength(1);
      } else {
        expect(result).toEqual({ queued: false, runId: null });
        await expect(services.issues.requestWakeup({ companyId, issueId: issue.id }))
          .rejects.toThrow("An armed issue monitor requires an exact external-service binding");
        await expect(services.issues.requestWakeups({ companyId, issueIds: [issue.id] }))
          .rejects.toThrow("An armed issue monitor requires an exact external-service binding");
        expect(after.executionState).toEqual(executionState);
        expect(after.executionPolicy).toEqual(executionPolicy);
        expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId))).toHaveLength(0);
      }
    },
  );

  it("retains a matching CI wake while a real reviewer runs and promotes it on release", async () => {
    const { companyId, agentId, issue, externalRef, stageId } = await seedCiReviewWait();
    const heartbeat = heartbeatService(db);
    let heldResponse: ServerResponse | null = null;
    let fixtureRunId: string | null = null;
    const server = createServer((_request, response) => {
      if (!heldResponse) heldResponse = response;
      else response.end("complete");
    });
    const listening = once(server, "listening", { signal: AbortSignal.timeout(20_000) });
    server.listen(0, "127.0.0.1");
    await listening;
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Reviewer fixture has no TCP address");
      const ready = once(server, "request", { signal: AbortSignal.timeout(20_000) });
      await db.update(agents).set({ adapterConfig: { command: process.execPath,
        args: ["--input-type=module", "-e", `await fetch("http://127.0.0.1:${address.port}/ready");`] },
      }).where(eq(agents.id, agentId));
      const run = await heartbeat.wakeup(agentId, { source: "assignment", reason: "execution_review_requested",
        requestedByActorType: "user", requestedByActorId: "review-owner",
        payload: { issueId: issue.id }, contextSnapshot: { issueId: issue.id, wakeReason: "execution_review_requested" } });
      fixtureRunId = run?.id ?? null;
      expect(run).toBeTruthy();
      await ready;
      const services = buildHostServices(db, "plugin-record-id", "paperclip.ci-wake", createEventBusStub());
      await expect(services.issues.requestWakeup({ companyId, issueId: issue.id,
        monitor: { serviceName: "gitea", externalRef } })).resolves.toEqual({ queued: true, runId: null });
      const wakes = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId));
      expect(wakes).toEqual(expect.arrayContaining([expect.objectContaining({
        reason: "issue_execution_deferred", status: "deferred_issue_execution", runId: null,
        payload: expect.objectContaining({ issueId: issue.id,
          _paperclipWakeContext: expect.objectContaining({ wakeReason: "plugin_issue_wakeup_requested" }) }),
      })]));
      heldResponse!.end("complete");
      await heartbeat.drainActiveRunExecutions();
      const [after] = await db.select().from(issues).where(eq(issues.id, issue.id));
      expect(after).toMatchObject({ status: "in_review", assigneeAgentId: agentId, executionRunId: null });
      expect(after.executionState).toMatchObject({ status: "pending", currentStageId: stageId,
        monitor: { status: "triggered", attemptCount: 1 } });
      const completedRuns = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
      expect(completedRuns.map(({ id, status, retryOfRunId, contextSnapshot }) => ({
        id, status, retryOfRunId, contextSnapshot,
      }))).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: run!.id, status: "succeeded" }),
        // The process fixture posts no comment, so native policy requires its one bounded retry.
        expect.objectContaining({ retryOfRunId: run!.id, status: "succeeded",
          contextSnapshot: expect.objectContaining({ retryReason: "missing_issue_comment" }) }),
      ]));
      expect(completedRuns.filter((entry) => entry.contextSnapshot?.source === "issue.monitor"))
        .toEqual([expect.objectContaining({ status: "succeeded", retryOfRunId: null,
          contextSnapshot: expect.objectContaining({ wakeReason: "plugin_issue_wakeup_requested", monitorAttemptCount: 1 }) })]);
    } finally {
      heldResponse?.end();
      if (fixtureRunId) await heartbeat.cancelRun(fixtureRunId, "CI-wake fixture cleanup");
      await heartbeat.drainActiveRunExecutions();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 60_000);

  it("narrows orchestration cost summaries by subtree and billing code", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const rootIssueId = randomUUID();
    const childIssueId = randomUUID();
    const unrelatedIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: rootIssueId,
        companyId,
        title: "Root mission",
        status: "todo",
        priority: "medium",
        billingCode: "mission:alpha",
      },
      {
        id: childIssueId,
        companyId,
        parentId: rootIssueId,
        title: "Child mission",
        status: "todo",
        priority: "medium",
        billingCode: "mission:alpha",
      },
      {
        id: unrelatedIssueId,
        companyId,
        title: "Different mission",
        status: "todo",
        priority: "medium",
        billingCode: "mission:alpha",
      },
    ]);
    await db.insert(costEvents).values([
      {
        companyId,
        agentId,
        issueId: rootIssueId,
        billingCode: "mission:alpha",
        provider: "test",
        model: "unit",
        inputTokens: 10,
        cachedInputTokens: 1,
        outputTokens: 2,
        costCents: 100,
        occurredAt: new Date(),
      },
      {
        companyId,
        agentId,
        issueId: childIssueId,
        billingCode: "mission:alpha",
        provider: "test",
        model: "unit",
        inputTokens: 20,
        cachedInputTokens: 2,
        outputTokens: 4,
        costCents: 200,
        occurredAt: new Date(),
      },
      {
        companyId,
        agentId,
        issueId: childIssueId,
        billingCode: "mission:beta",
        provider: "test",
        model: "unit",
        inputTokens: 30,
        cachedInputTokens: 3,
        outputTokens: 6,
        costCents: 300,
        occurredAt: new Date(),
      },
      {
        companyId,
        agentId,
        issueId: unrelatedIssueId,
        billingCode: "mission:alpha",
        provider: "test",
        model: "unit",
        inputTokens: 40,
        cachedInputTokens: 4,
        outputTokens: 8,
        costCents: 400,
        occurredAt: new Date(),
      },
    ]);

    const services = buildHostServices(db, "plugin-record-id", "paperclip.missions", createEventBusStub());
    const summary = await services.issues.getOrchestrationSummary({
      companyId,
      issueId: rootIssueId,
      includeSubtree: true,
    });

    expect(new Set(summary.subtreeIssueIds)).toEqual(new Set([rootIssueId, childIssueId]));
    expect(summary.costs).toMatchObject({
      billingCode: "mission:alpha",
      costCents: 300,
      inputTokens: 30,
      cachedInputTokens: 3,
      outputTokens: 6,
    });
  });

  it("rejects a human-attributed plugin comment when actorUserId is not an active company member", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Needs human input",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.issues.createComment({
        issueId,
        companyId,
        body: "Here's my answer",
        actorUserId: randomUUID(),
      }),
    ).rejects.toThrow("is not an active human member of this company");

    await expect(db.select().from(agentWakeupRequests)).resolves.toHaveLength(0);
  });

  it("rejects a human-attributed plugin comment when actorUserId is a viewer-role (read-only) member", async () => {
    // LOOA-648: a viewer is a real active member but is read-only in the web
    // app (routes/authz.ts "Viewer access is read-only"). Attributing a comment
    // to them is a write the paired user could not make interactively.
    const { companyId, agentId } = await seedCompanyAndAgent();
    const viewerUserId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: viewerUserId, status: "active", membershipRole: "viewer",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Needs human input", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });

    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.issues.createComment({ issueId, companyId, body: "Here's my answer", actorUserId: viewerUserId }),
    ).rejects.toThrow("viewer (read-only) access");

    // No comment persisted, no assignee woken.
    await expect(db.select().from(agentWakeupRequests)).resolves.toHaveLength(0);
    const comments = await services.issues.listComments({ issueId, companyId });
    expect(comments).toHaveLength(0);
  });

  it("creates a human-attributed plugin comment and wakes the issue's assignee", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const humanUserId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: humanUserId,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Needs human input",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    // Cap concurrency at 1 and pre-seed a running run so enqueueWakeup's
    // queued-run bookkeeping is exercised without startNextQueuedRunForAgent
    // going on to actually claim/execute the new run — that path spins up
    // real environment/adapter orchestration this test has no business
    // depending on (and which races the test's own db teardown).
    await db.update(agents).set({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
    await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: {},
    });

    const services = buildHostServices(
      db,
      "plugin-record-id",
      "paperclip.gateway",
      createEventBusStub(),
      undefined,
      { heartbeatRuntimeEnv: {} },
    );
    const comment = await services.issues.createComment({
      issueId,
      companyId,
      body: "Here's my answer",
      actorUserId: humanUserId,
    });

    expect(comment).toMatchObject({
      authorType: "user",
      authorUserId: humanUserId,
      authorAgentId: null,
      body: "Here's my answer",
    });

    const [wakeupRequest] = await db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId)));
    expect(wakeupRequest).toMatchObject({
      reason: "issue_commented",
      requestedByActorType: "user",
      requestedByActorId: humanUserId,
    });
    expect(wakeupRequest?.status).toBe("queued");
    expect(wakeupRequest?.runId).toEqual(expect.any(String));

    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, wakeupRequest!.runId!));
    expect(run).toMatchObject({ agentId, companyId, status: "queued" });
  });

  it("skips the assignee wakeup when the issue is cancelled concurrently with the comment being written", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const humanUserId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: humanUserId,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Needs human input",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());

    // Hold a row lock on the issue so createComment's own `UPDATE issues SET
    // updated_at` (inside addComment) blocks until this transaction commits a
    // concurrent cancellation. That deterministically reproduces "another
    // request closes the issue while the comment is being written" — the
    // race Greptile flagged on the pre-insert `issue` snapshot — without
    // relying on timing luck for the outcome, only for scheduling.
    const lockAndCancelPromise = db.transaction(async (tx) => {
      await tx.select().from(issues).where(eq(issues.id, issueId)).for("update");
      await new Promise((resolve) => setTimeout(resolve, 50));
      await tx.update(issues).set({ status: "cancelled" }).where(eq(issues.id, issueId));
    });

    const commentPromise = services.issues.createComment({
      issueId,
      companyId,
      body: "Here's my answer",
      actorUserId: humanUserId,
    });

    const [comment] = await Promise.all([commentPromise, lockAndCancelPromise]);

    expect(comment).toMatchObject({
      authorType: "user",
      authorUserId: humanUserId,
      body: "Here's my answer",
    });
    await expect(db.select().from(agentWakeupRequests)).resolves.toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // LOOA-641 — interactions.respond / approvals.decide impersonation surface.
  // The host must independently re-verify the paired user's active membership
  // at apply time and never trust the plugin-supplied identity.
  // ---------------------------------------------------------------------------

  async function seedInteraction(
    companyId: string,
    issueId: string,
    overrides: Partial<typeof issueThreadInteractions.$inferInsert> = {},
  ) {
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId,
      issueId,
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "wake_assignee",
      payload: { version: 1, prompt: "Proceed?" } as never,
      ...overrides,
    });
    return interactionId;
  }

  it("respondInteraction fails closed when actorUserId is omitted", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(companyId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.issues.respondInteraction({ issueId, interactionId, companyId, action: "accept" }),
    ).rejects.toThrow("actorUserId is required");
  });

  it("respondInteraction rejects an actorUserId that is not an active company member", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(companyId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.issues.respondInteraction({
        issueId, interactionId, companyId, action: "accept", actorUserId: randomUUID(),
      }),
    ).rejects.toThrow("is not an active human member of this company");

    // The interaction must remain pending — no resolution was applied.
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row?.status).toBe("pending");
  });

  it("respondInteraction rejects a viewer-role active member and leaves the interaction pending", async () => {
    // LOOA-648: viewers are read-only board members (routes/authz.ts). A plugin
    // holding issue.interactions.respond must not resolve an interaction on
    // their behalf — that is a write the viewer is 403'd on in the web app.
    const { companyId, agentId } = await seedCompanyAndAgent();
    const viewerUserId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: viewerUserId, status: "active", membershipRole: "viewer",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(companyId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.issues.respondInteraction({
        issueId, interactionId, companyId, action: "accept", actorUserId: viewerUserId,
      }),
    ).rejects.toThrow("viewer (read-only) access");

    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row?.status).toBe("pending");
  });

  it("respondInteraction applies for a non-viewer human role (operator)", async () => {
    // LOOA-648 regression: owner/admin/operator must still pass the write bar.
    // Issue has no assignee so the continuation wakeup is a no-op — this
    // isolates the membership check from run orchestration.
    const { companyId } = await seedCompanyAndAgent();
    const operatorUserId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: operatorUserId, status: "active", membershipRole: "operator",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Decision", status: "in_review", priority: "medium",
    });
    const interactionId = await seedInteraction(companyId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    const result = await services.issues.respondInteraction({
      issueId, interactionId, companyId, action: "accept", actorUserId: operatorUserId,
    });
    expect(result.applied).toBe(true);
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row?.status).toBe("accepted");
  });

  it.each(["accept", "reject"] as const)(
    "respondInteraction rejects %s after the issue closes",
    async (action) => {
      const { companyId } = await seedCompanyAndAgent();
      const operatorUserId = randomUUID();
      await db.insert(companyMemberships).values({
        companyId,
        principalType: "user",
        principalId: operatorUserId,
        status: "active",
        membershipRole: "operator",
      });
      const issueId = randomUUID();
      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Closed decision",
        status: "done",
        priority: "medium",
      });
      const interactionId = await seedInteraction(companyId, issueId);
      const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());

      await expect(services.issues.respondInteraction({
        issueId,
        interactionId,
        companyId,
        action,
        actorUserId: operatorUserId,
      })).rejects.toThrow("Interaction is no longer actionable because the issue is closed");

      const [row] = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interactionId));
      expect(row?.status).toBe("pending");
    },
  );

  it("respondInteraction converges (applied:false) when the interaction is already resolved", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const humanUserId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: humanUserId, status: "active", membershipRole: "owner",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(companyId, issueId, { status: "rejected" });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    const result = await services.issues.respondInteraction({
      issueId, interactionId, companyId, action: "accept", actorUserId: humanUserId,
    });
    expect(result.applied).toBe(false);
    expect(result.interaction).toMatchObject({ id: interactionId, status: "rejected" });
  });

  it("approvals.decide fails closed when actorUserId is omitted", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, companyId, type: "request_board_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.approvals.decide({ approvalId, companyId, action: "approve" }),
    ).rejects.toThrow("actorUserId is required");
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("pending");
  });

  it("approvals.decide rejects an actorUserId that is not an active company member", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, companyId, type: "request_board_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.approvals.decide({ approvalId, companyId, action: "approve", actorUserId: randomUUID() }),
    ).rejects.toThrow("is not an active human member of this company");
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("pending");
  });

  it("approvals.decide rejects a viewer-role active member and leaves the approval pending", async () => {
    // LOOA-648: the exploit at the heart of the review — a plugin holding
    // approvals.respond decides an approval for a viewer who is 403'd in the
    // web UI. The host must reject the viewer before applying the decision.
    const { companyId } = await seedCompanyAndAgent();
    const viewerUserId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: viewerUserId, status: "active", membershipRole: "viewer",
    });
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, companyId, type: "request_board_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.approvals.decide({ approvalId, companyId, action: "approve", actorUserId: viewerUserId }),
    ).rejects.toThrow("viewer (read-only) access");
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("pending");
  });

  it("approvals.decide applies for a non-viewer human role (admin)", async () => {
    // LOOA-648 regression: owner/admin/operator must still pass the write bar.
    const { companyId } = await seedCompanyAndAgent();
    const adminUserId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: adminUserId, status: "active", membershipRole: "admin",
    });
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, companyId, type: "request_board_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    const result = await services.approvals.decide({
      approvalId, companyId, action: "approve", actorUserId: adminUserId,
    });
    expect(result.applied).toBe(true);
    expect(result.approval).toMatchObject({ id: approvalId, status: "approved", decidedByUserId: adminUserId });
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("approved");
  });

  it("approvals.decide applies for an active member and redacts secret payload fields", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const humanUserId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: humanUserId, status: "active", membershipRole: "owner",
    });
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId,
      companyId,
      type: "request_board_approval",
      status: "pending",
      payload: { title: "Ship it", botToken: "xoxb-super-secret" },
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    const result = await services.approvals.decide({
      approvalId, companyId, action: "approve", actorUserId: humanUserId, decisionNote: "lgtm",
    });
    expect(result.applied).toBe(true);
    expect(result.approval).toMatchObject({ id: approvalId, status: "approved", decidedByUserId: humanUserId });
    // Bridge output must be redacted the same way the web app redacts approvals.
    expect(result.approval.payload.title).toBe("Ship it");
    expect(result.approval.payload.botToken).toBe("***REDACTED***");

    // Persisted row is decided; the raw stored secret is untouched (redaction is
    // an output transform, not a mutation).
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("approved");
  });

  it("approvals.list redacts payloads and is company-scoped", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const otherCompany = randomUUID();
    await db.insert(companies).values({
      id: otherCompany, name: "Other", issuePrefix: issuePrefix(otherCompany), requireBoardApprovalForNewAgents: false,
    });
    await db.insert(approvals).values({
      id: randomUUID(), companyId, type: "request_board_approval", status: "pending",
      payload: { title: "Mine", accessToken: "sekret" },
    });
    await db.insert(approvals).values({
      id: randomUUID(), companyId: otherCompany, type: "request_board_approval", status: "pending",
      payload: { title: "Theirs" },
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    const rows = await services.approvals.list({ companyId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.title).toBe("Mine");
    expect(rows[0]!.payload.accessToken).toBe("***REDACTED***");
  });

  it("getAttachmentContent returns null for a cross-company attachment id", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const otherCompany = randomUUID();
    await db.insert(companies).values({
      id: otherCompany, name: "Other", issuePrefix: issuePrefix(otherCompany), requireBoardApprovalForNewAgents: false,
    });
    const otherIssueId = randomUUID();
    await db.insert(issues).values({
      id: otherIssueId, companyId: otherCompany, title: "Theirs", status: "todo", priority: "medium",
    });
    const assetId = randomUUID();
    await db.insert(assets).values({
      id: assetId, companyId: otherCompany, provider: "local_disk", objectKey: "k", contentType: "image/png",
      byteSize: 10, sha256: "abc",
    });
    const attachmentId = randomUUID();
    await db.insert(issueAttachments).values({
      id: attachmentId, companyId: otherCompany, issueId: otherIssueId, assetId,
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    // Requested under our own company: the cross-company id must be invisible.
    void agentId;
    const content = await services.issues.getAttachmentContent({ attachmentId, companyId });
    expect(content).toBeNull();
  });

  it("getAttachmentContent refuses an over-cap attachment", async () => {
    const { companyId } = await seedCompanyAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Has asset", status: "todo", priority: "medium",
    });
    const assetId = randomUUID();
    await db.insert(assets).values({
      id: assetId, companyId, provider: "local_disk", objectKey: "k", contentType: "image/png",
      byteSize: 5_000_000, sha256: "abc",
    });
    const attachmentId = randomUUID();
    await db.insert(issueAttachments).values({
      id: attachmentId, companyId, issueId, assetId,
    });
    const services = buildHostServices(db, "plugin-record-id", "paperclip.gateway", createEventBusStub());
    await expect(
      services.issues.getAttachmentContent({ attachmentId, companyId, maxBytes: 1_000_000 }),
    ).rejects.toThrow("over the");
  });
});
