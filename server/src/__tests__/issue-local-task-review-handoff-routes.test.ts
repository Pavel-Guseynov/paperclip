import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog, agents, agentWakeupRequests, companies, companyMemberships,
  createDb, heartbeatRuns, issueComments, issueExecutionDecisions, issueRecoveryActions,
  issueRelations, issues, issueTreeHolds, issueWorkProducts, projects,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { activeWakeupPromises } from "../services/heartbeat-wake-lifecycle.js";

describe("human-owned local task review handoff", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-local-review-handoff-");
    db = createDb(tempDb.connectionString);
  }, 20_000);
  afterAll(async () => { await tempDb?.cleanup(); });

  async function seed(status = "blocked") {
    const [company] = await db.insert(companies).values({
      name: "Local handoff", issuePrefix: `LH${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning();
    const [lead, reviewer, peer] = await db.insert(agents).values(
      ["Lead", "Reviewer", "Peer"].map((name) => ({
        companyId: company.id, name, role: "engineer", status: "active",
        adapterType: "process", runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
      })),
    ).returning();
    const [project] = await db.insert(projects).values({
      companyId: company.id, name: "Local project", leadAgentId: lead.id,
    }).returning();
    const userId = `human-${randomUUID()}`;
    await db.insert(companyMemberships).values({
      companyId: company.id, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active",
    });
    const [issue] = await db.insert(issues).values({
      companyId: company.id, projectId: project.id, title: "Resolved local work",
      status, assigneeUserId: userId,
      unblockDescriptor: status === "blocked" ? { owner: { userId }, action: "Resolve dependency" } : null,
      blockedTransitionAt: status === "blocked" ? new Date("2026-10-20T00:00:00Z") : null,
      blockedOwnerNotifiedAt: status === "blocked" ? new Date("2026-10-20T01:00:00Z") : null,
    }).returning();
    await db.insert(issueWorkProducts).values(["branch", "commit", "pull_request"].map((type) => ({
      companyId: company.id, issueId: issue.id, type, provider: "gitea",
      externalId: `${type}-head`, title: type, status: "ready_for_review", reviewState: "needs_board_review",
    })));
    // Occupy the reviewer's capacity with unrelated work. The native wake
    // queues durably without launching an agent process during this route test.
    await db.insert(heartbeatRuns).values({
      companyId: company.id, agentId: reviewer.id, status: "running", startedAt: new Date(),
    });
    const body: Record<string, unknown> = {
      status: "done", comment: "## Task Disposition\n\nVerified local work is ready for review.",
      executionPolicy: { mode: "normal", stages: [{
        id: randomUUID(), type: "review", participants: [{ type: "agent", agentId: reviewer.id }],
      }] },
    };
    const actor: Express.Request["actor"] = {
      type: "agent", agentId: lead.id, companyId: company.id, source: "agent_key", keyScope: { kind: "standard" },
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    return { company, project, lead, reviewer, peer, userId, issue, body, actor, app };
  }

  async function effects(f: Awaited<ReturnType<typeof seed>>) {
    return {
      issue: await db.select().from(issues).where(eq(issues.id, f.issue.id)),
      comments: await db.select().from(issueComments).where(eq(issueComments.issueId, f.issue.id)),
      decisions: await db.select().from(issueExecutionDecisions).where(eq(issueExecutionDecisions.issueId, f.issue.id)),
      wakes: await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, f.company.id)),
    };
  }

  it.each(["lead", "peer"] as const)("allows the %s to complete stage-less human-owned in-progress work", async (actor) => {
    const f = await seed("in_progress");
    f.actor.agentId = f[actor].id;
    const before = await effects(f);
    expect(before.issue[0].executionPolicy).toBeNull();
    const response = await request(f.app).patch(`/api/issues/${f.issue.id}`).send({ status: "done" });
    await Promise.all([...activeWakeupPromises]);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      status: "done", assigneeAgentId: null, assigneeUserId: f.userId,
    });
    const after = await effects(f);
    expect(after.issue[0]).toMatchObject({
      status: "done", assigneeAgentId: null, assigneeUserId: f.userId,
    });
    expect(after.decisions).toEqual(before.decisions);
    expect(after.comments).toEqual(before.comments);
    expect(after.wakes).toEqual(before.wakes);
  });

  it.each(["blocked", "in_progress"])("hands %s local work to review with human return ownership and lead attribution", async (status) => {
    const f = await seed(status);
    const before = await effects(f);
    const response = await request(f.app).patch(`/api/issues/${f.issue.id}`).send(f.body);
    await Promise.all([...activeWakeupPromises]);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      status: "in_review", assigneeAgentId: f.reviewer.id, assigneeUserId: null,
      unblockDescriptor: null, blockedTransitionAt: null, blockedOwnerNotifiedAt: null,
      executionState: { status: "pending", currentStageType: "review",
        returnAssignee: { type: "user", userId: f.userId } },
    });
    const after = await effects(f);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.comments).toEqual([expect.objectContaining({
      body: f.body.comment, authorAgentId: f.lead.id, authorUserId: null,
    })]);
    const activities = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, f.company.id), eq(activityLog.entityId, f.issue.id),
    ));
    for (const action of ["issue.updated", "issue.comment_added"]) {
      expect(activities).toContainEqual(expect.objectContaining({ action, actorType: "agent", actorId: f.lead.id }));
    }
    expect(after.wakes).toContainEqual(expect.objectContaining({
      agentId: f.reviewer.id, reason: "execution_review_requested",
      requestedByActorType: "agent", requestedByActorId: f.lead.id,
    }));
  });

  it.each([
    ["unresolved dependency", 409], ["execution blocker", 409], ["recovery action", 409],
    ["pause hold", 409], ["non-lead", 403], ["wrong project", 403], ["missing project", 403],
    ["paused project", 403], ["low trust", 403],
    ["missing human", 409], ["missing disposition", 409], ["missing review", 409],
    ["missing branch", 409], ["missing commit", 409], ["missing pull_request", 409],
    ["unready product", 409], ["unreviewable product", 409], ["empty external id", 409],
    ["wrong provider", 409], ["assignee override", 409], ["resume", 409], ["reopen", 409],
    ["todo", 409], ["in_progress", 409], ["inactive reviewer", 409],
  ] as const)("rejects %s without changing the issue or waking review", async (scenario, expected) => {
    const f = await seed();
    if (scenario === "unresolved dependency") {
      const [blocker] = await db.insert(issues).values({ companyId: f.company.id, title: "Unresolved", status: "todo" }).returning();
      await db.insert(issueRelations).values({ companyId: f.company.id, issueId: blocker.id, relatedIssueId: f.issue.id, type: "blocks" });
    } else if (scenario === "execution blocker" || scenario === "recovery action") {
      await db.insert(issueRecoveryActions).values({
        companyId: f.company.id, sourceIssueId: f.issue.id, ownerAgentId: f.lead.id,
        kind: "execution", cause: "uncertain_external_action", fingerprint: randomUUID(), nextAction: "Reconcile",
        status: scenario === "execution blocker" ? "resolved" : "active",
        evidence: scenario === "execution blocker" ? { automaticRecovery: { replay: "blocked" } } : {},
      });
    } else if (scenario === "pause hold") {
      await db.insert(issueTreeHolds).values({ companyId: f.company.id, rootIssueId: f.issue.id, mode: "pause", status: "active" });
    } else if (scenario === "non-lead") {
      f.actor.agentId = f.peer.id;
    } else if (scenario === "wrong project") {
      await db.update(projects).set({ leadAgentId: f.peer.id }).where(eq(projects.id, f.project.id));
    } else if (scenario === "missing project") {
      await db.update(issues).set({ projectId: null }).where(eq(issues.id, f.issue.id));
    } else if (scenario === "paused project") {
      await db.update(projects).set({ pausedAt: new Date() }).where(eq(projects.id, f.project.id));
    } else if (scenario === "low trust") {
      await db.update(agents).set({ permissions: { authorizationPolicy: {
        trustPreset: "low_trust_review", trustBoundary: { mode: "low_trust_review", issueIds: [f.issue.id] },
      } } }).where(eq(agents.id, f.lead.id));
    } else if (scenario === "missing human") {
      await db.update(issues).set({ assigneeUserId: null }).where(eq(issues.id, f.issue.id));
    } else if (scenario === "missing disposition") {
      f.body.comment = "Ready for review";
    } else if (scenario === "missing review") {
      f.body.executionPolicy = { mode: "normal", stages: [] };
    } else if (scenario.startsWith("missing ")) {
      await db.delete(issueWorkProducts).where(and(eq(issueWorkProducts.issueId, f.issue.id), eq(issueWorkProducts.type, scenario.slice(8))));
    } else if (scenario === "unready product" || scenario === "unreviewable product" || scenario === "empty external id" || scenario === "wrong provider") {
      const patch = scenario === "unready product" ? { status: "draft" }
        : scenario === "unreviewable product" ? { reviewState: "none" }
        : scenario === "empty external id" ? { externalId: " " } : { provider: "github" };
      await db.update(issueWorkProducts).set(patch).where(eq(issueWorkProducts.issueId, f.issue.id));
    } else if (scenario === "assignee override") {
      f.body.assigneeAgentId = f.reviewer.id;
    } else if (scenario === "resume" || scenario === "reopen") {
      f.body[scenario] = true;
    } else if (scenario === "inactive reviewer") {
      await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.reviewer.id));
    } else {
      f.body.status = scenario;
    }
    const before = await effects(f);
    const response = await request(f.app).patch(`/api/issues/${f.issue.id}`).send(f.body);
    await Promise.all([...activeWakeupPromises]);
    expect(response.status, JSON.stringify(response.body)).toBe(expected);
    expect(await effects(f)).toEqual(before);
  });
});
