import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issueComments,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

vi.mock("../services/issue-assignment-wakeup.js", () => ({
  queueIssueAssignmentWakeup: vi.fn(),
}));

const postgresSupport = await getEmbeddedPostgresTestSupport();
const describePostgres = postgresSupport.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const { issueRoutes } = await import("../routes/issues.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as never));
  app.use((error: { status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message ?? "Internal server error" });
  });
  return app;
}

describePostgres("issue updates from an agent API key without a heartbeat run", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-runless-agent-key-");
    db = createDb(tempDb.connectionString);
    await import("../routes/issues.js");
  }, 60_000);

  afterAll(async () => tempDb?.cleanup());

  async function seed(status: "todo" | "in_progress") {
    const [company] = await db.insert(companies).values({
      name: "External client company",
      issuePrefix: `EX${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
    }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company!.id,
      name: "External agent",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    }).returning();
    const responsibleUserId = `responsible-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({
      id: responsibleUserId,
      name: "Responsible User",
      email: `${responsibleUserId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companyMemberships).values({
      companyId: company!.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "member",
    });
    const [issue, blocker] = await db.insert(issues).values([
      {
        companyId: company!.id,
        identifier: `${company!.issuePrefix}-1`,
        issueNumber: 1,
        title: "Assigned issue",
        status,
        priority: "medium" as const,
        assigneeAgentId: agent!.id,
        responsibleUserId,
      },
      {
        companyId: company!.id,
        identifier: `${company!.issuePrefix}-2`,
        issueNumber: 2,
        title: "Blocking issue",
        status: "todo" as const,
        priority: "medium" as const,
        responsibleUserId,
      },
    ]).returning();
    // The shape the agent-key middleware builds: every key acts on behalf of
    // its responsible user.
    const actor = (keyScope: { kind: "standard" } | { kind: "skill_test"; issueId: string }): Express.Request["actor"] => ({
      type: "agent",
      agentId: agent!.id,
      companyId: company!.id,
      source: "agent_key",
      keyId: randomUUID(),
      keyScope,
      onBehalfOfUserId: responsibleUserId,
      onBehalfOfMemberships: [{ companyId: company!.id, membershipRole: "member", status: "active" }],
    });
    return { company: company!, agent: agent!, issue: issue!, blocker: blocker!, actor };
  }

  async function readIssue(id: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, id));
    return row!;
  }

  it("updates the title and blockers of its assigned issue", async () => {
    const { issue, blocker, actor } = await seed("todo");
    const app = await createApp(db, actor({ kind: "standard" }));

    const res = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .send({ title: "Edited by an external client", blockedByIssueIds: [blocker.id] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await readIssue(issue.id)).title).toBe("Edited by an external client");
    const relations = await db.select().from(issueRelations).where(eq(issueRelations.relatedIssueId, issue.id));
    expect(relations.map((relation) => relation.issueId)).toEqual([blocker.id]);
  });

  it("edits its own in-progress issue only while no run holds it", async () => {
    const { company, agent, issue, actor } = await seed("in_progress");
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "running",
      contextSnapshot: { issueId: issue.id },
    }).returning();
    await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, issue.id));
    const app = await createApp(db, actor({ kind: "standard" }));

    const held = await request(app).patch(`/api/issues/${issue.id}`).send({ title: "Edited while running" });

    expect(held.status, JSON.stringify(held.body)).toBe(409);
    expect((await readIssue(issue.id)).title).toBe("Assigned issue");

    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, run!.id));
    const free = await request(app).patch(`/api/issues/${issue.id}`).send({ title: "Edited after the run" });

    expect(free.status, JSON.stringify(free.body)).toBe(200);
    expect((await readIssue(issue.id)).title).toBe("Edited after the run");
  });

  it("adds the inline comment of a runless update", async () => {
    const { agent, issue, actor } = await seed("todo");
    const app = await createApp(db, actor({ kind: "standard" }));

    const res = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .send({ title: "Edited with a note", comment: "Updated from an external client." });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, issue.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ body: "Updated from an external client.", authorAgentId: agent.id });
  });

  it("answers 409 while a checkout run holds its in-progress issue", async () => {
    const { company, agent, issue, actor } = await seed("in_progress");
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "running",
      contextSnapshot: { issueId: issue.id },
    }).returning();
    await db.update(issues).set({ checkoutRunId: run!.id }).where(eq(issues.id, issue.id));
    const app = await createApp(db, actor({ kind: "standard" }));

    const res = await request(app).patch(`/api/issues/${issue.id}`).send({ title: "Edited during checkout" });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await readIssue(issue.id)).title).toBe("Assigned issue");
  });

  it("cannot update an issue of another company", async () => {
    const own = await seed("todo");
    const other = await seed("todo");
    const app = await createApp(db, own.actor({ kind: "standard" }));

    const res = await request(app).patch(`/api/issues/${other.issue.id}`).send({ title: "Cross-company edit" });

    // The issue of another company is not visible to the key.
    expect(res.status).toBe(404);
    expect((await readIssue(other.issue.id)).title).toBe("Assigned issue");
  });

  it("still requires a run for a restricted agent key", async () => {
    const { issue, actor } = await seed("in_progress");
    const app = await createApp(db, actor({ kind: "skill_test", issueId: issue.id }));

    const res = await request(app).patch(`/api/issues/${issue.id}`).send({ title: "Restricted edit" });

    expect(res.status).toBe(401);
    expect((await readIssue(issue.id)).title).toBe("Assigned issue");
  });
});
