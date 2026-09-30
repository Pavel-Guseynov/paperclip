import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  type Db,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";
import {
  logActivity,
  publishActivity,
  type ActivityPublication,
} from "../services/activity-log.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("task lifecycle events", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const capturedRecords: any[] = [];
  let restoreStderr: (() => void) | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-task-lifecycle-");
    db = createDb(tempDb.connectionString);

    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any, ...args: any[]) => {
      const str = typeof chunk === "string" ? chunk : chunk?.toString?.("utf8") ?? "";
      for (const line of str.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.action === "task_lifecycle") {
              capturedRecords.push(parsed);
            }
          } catch {}
        }
      }
      return originalWrite(chunk, ...args as any);
    }) as any;
    restoreStderr = () => {
      process.stderr.write = originalWrite;
    };
  }, 30_000);

  afterAll(async () => {
    restoreStderr?.();
    await tempDb?.cleanup();
  });

  afterEach(async () => {
    capturedRecords.length = 0;
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  async function createCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme Lifecycle Corp",
      issuePrefix: "LC",
      defaultResponsibleUserId: randomUUID(),
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Test Agent",
      role: "engineer",
      adapterType: "antigravity_local",
    });
    return { companyId, agentId };
  }

  async function createTask(
    companyId: string,
    input: { title: string; status: string; assigneeAgentId?: string; originRunId?: string },
    txOrDb: any = db,
  ) {
    const svc = issueService(txOrDb);
    const created = await svc.create(companyId, input);
    await logActivity(txOrDb, {
      companyId,
      actorType: "agent",
      actorId: input.assigneeAgentId ?? randomUUID(),
      agentId: input.assigneeAgentId ?? null,
      runId: input.originRunId ?? null,
      action: "issue.created",
      entityType: "issue",
      entityId: created.id,
      details: {
        title: created.title,
        identifier: created.identifier,
        status: created.status,
        assigneeAgentId: input.assigneeAgentId,
      },
    });
    return created;
  }

  async function updateTaskStatus(
    companyId: string,
    issueId: string,
    toStatus: string,
    txOrDb: any = db,
    postCommit?: ActivityPublication[],
  ) {
    const svc = issueService(txOrDb);
    const existing = await txOrDb
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, issueId))
      .for("update")
      .then((rows: any) => rows[0]);
    const fromStatus = existing?.status ?? "todo";
    const updated = await svc.update(issueId, { status: toStatus }, txOrDb);
    await logActivity(
      txOrDb,
      {
        companyId,
        actorType: "agent",
        actorId: randomUUID(),
        action: "issue.updated",
        entityType: "issue",
        entityId: issueId,
        details: {
          changes: {
            status: {
              from: fromStatus,
              to: toStatus,
            },
          },
        },
      },
      postCommit,
    );
    return updated;
  }

  it("emits a task_lifecycle record on issue creation with previousStatus: null and database committedAtMs", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();

    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
    });

    const created = await createTask(companyId, {
      title: "Task 1",
      status: "todo",
      assigneeAgentId: agentId,
      originRunId: runId,
    });

    const taskEvents = capturedRecords.filter((r) => r.action === "task_lifecycle" && r.attributes?.taskId === created.id);
    expect(taskEvents).toHaveLength(1);
    const event = taskEvents[0];
    expect(event.service).toBe("paperclip");
    expect(event.action).toBe("task_lifecycle");
    expect(event.attributes.taskId).toBe(created.id);
    expect(event.attributes.identifier).toBe(created.identifier);
    expect(event.attributes.previousStatus).toBeNull();
    expect(event.attributes.newStatus).toBe("todo");
    expect(event.attributes.isTerminal).toBe(false);
    expect(event.attributes.actingRun).toEqual({ runId });
    expect(typeof event.attributes.committedAtMs).toBe("number");
    expect(event.attributes.eventId).toMatch(new RegExp(`^task:${created.id}:`));

    // Verify committedAtMs matches activity_log.createdAt
    const activities = await db.select().from(activityLog).where(eq(activityLog.entityId, created.id));
    expect(activities).toHaveLength(1);
    expect(activities[0].action).toBe("issue.created");
    expect(event.attributes.committedAtMs).toBe(activities[0].createdAt.getTime());
    expect(event.attributes.eventId).toBe(`task:${created.id}:${activities[0].id}`);
  });

  it("emits distinct records for repeated visits to the same status with different eventIds and previousStatuses", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();

    const created = await createTask(companyId, {
      title: "Cycle Task",
      status: "todo",
      assigneeAgentId: agentId,
    });

    // todo -> in_progress
    await updateTaskStatus(companyId, created.id, "in_progress");
    // in_progress -> in_review
    await updateTaskStatus(companyId, created.id, "in_review");
    // in_review -> in_progress (second visit)
    await updateTaskStatus(companyId, created.id, "in_progress");

    const inProgressEvents = capturedRecords.filter(
      (r) => r.action === "task_lifecycle" && r.attributes?.taskId === created.id && r.attributes?.newStatus === "in_progress",
    );
    expect(inProgressEvents).toHaveLength(2);

    const [firstVisit, secondVisit] = inProgressEvents;
    expect(firstVisit.attributes.previousStatus).toBe("todo");
    expect(secondVisit.attributes.previousStatus).toBe("in_review");
    expect(firstVisit.attributes.eventId).not.toBe(secondVisit.attributes.eventId);
    expect(secondVisit.attributes.committedAtMs).toBeGreaterThanOrEqual(firstVisit.attributes.committedAtMs);
  });

  it("does not emit lifecycle records for rolled back transactions", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();

    const created = await createTask(companyId, {
      title: "Rollback Task",
      status: "todo",
      assigneeAgentId: agentId,
    });
    capturedRecords.length = 0;

    await expect(
      db.transaction(async (tx) => {
        const postCommit: ActivityPublication[] = [];
        await updateTaskStatus(companyId, created.id, "in_progress", tx, postCommit);
        throw new Error("Simulated transaction rollback");
      }),
    ).rejects.toThrow("Simulated transaction rollback");

    const rolledBackEvents = capturedRecords.filter(
      (r) => r.action === "task_lifecycle" && r.attributes?.taskId === created.id,
    );
    expect(rolledBackEvents).toHaveLength(0);

    const current = await issueService(db).getById(created.id);
    expect(current?.status).toBe("todo");

    // The next committed transition after a rollback gets a unique eventId
    await updateTaskStatus(companyId, created.id, "in_progress");
    const committedEvents = capturedRecords.filter(
      (r) => r.action === "task_lifecycle" && r.attributes?.taskId === created.id,
    );
    expect(committedEvents).toHaveLength(1);
    expect(committedEvents[0].attributes.previousStatus).toBe("todo");
    expect(committedEvents[0].attributes.newStatus).toBe("in_progress");
    expect(committedEvents[0].attributes.eventId).toMatch(new RegExp(`^task:${created.id}:`));
  });

  it("emits exactly one record when entering in_review status", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();

    const created = await createTask(companyId, {
      title: "Review Task",
      status: "in_progress",
      assigneeAgentId: agentId,
    });
    capturedRecords.length = 0;

    await updateTaskStatus(companyId, created.id, "in_review");

    const reviewEvents = capturedRecords.filter(
      (r) => r.action === "task_lifecycle" && r.attributes?.taskId === created.id,
    );
    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0].attributes.previousStatus).toBe("in_progress");
    expect(reviewEvents[0].attributes.newStatus).toBe("in_review");
    expect(reviewEvents[0].attributes.isTerminal).toBe(false);
  });

  it("serializes concurrent updates on the same task with row locks in strict timestamp order", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();

    const created = await createTask(companyId, {
      title: "Concurrent Task",
      status: "todo",
      assigneeAgentId: agentId,
    });
    capturedRecords.length = 0;

    // Launch two updates concurrently on the same issue
    const update1 = db.transaction(async (tx) => {
      const pubs: ActivityPublication[] = [];
      await updateTaskStatus(companyId, created.id, "in_progress", tx, pubs);
      return pubs;
    }).then((pubs) => pubs.forEach(publishActivity));

    const update2 = db.transaction(async (tx) => {
      const pubs: ActivityPublication[] = [];
      await updateTaskStatus(companyId, created.id, "in_review", tx, pubs);
      return pubs;
    }).then((pubs) => pubs.forEach(publishActivity));

    await Promise.all([update1, update2]);

    const events = capturedRecords.filter(
      (r) => r.action === "task_lifecycle" && r.attributes?.taskId === created.id,
    );
    expect(events.length).toBe(2);
    expect(events[1].attributes.committedAtMs).toBeGreaterThanOrEqual(events[0].attributes.committedAtMs);
    expect(events[1].attributes.previousStatus).toBe(events[0].attributes.newStatus);
  });

  it("emits isTerminal: true for terminal task transitions done and cancelled", async () => {
    const { companyId, agentId } = await createCompanyAndAgent();

    const created = await createTask(companyId, {
      title: "Terminal Task",
      status: "todo",
      assigneeAgentId: agentId,
    });
    capturedRecords.length = 0;

    await updateTaskStatus(companyId, created.id, "done");
    const doneEvent = capturedRecords.find(
      (r) => r.action === "task_lifecycle" && r.attributes?.taskId === created.id && r.attributes?.newStatus === "done",
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent.attributes.isTerminal).toBe(true);

    capturedRecords.length = 0;
    const task2 = await createTask(companyId, {
      title: "Cancelled Task",
      status: "todo",
      assigneeAgentId: agentId,
    });
    capturedRecords.length = 0;

    await updateTaskStatus(companyId, task2.id, "cancelled");
    const cancelledEvent = capturedRecords.find(
      (r) => r.action === "task_lifecycle" && r.attributes?.taskId === task2.id && r.attributes?.newStatus === "cancelled",
    );
    expect(cancelledEvent).toBeDefined();
    expect(cancelledEvent.attributes.isTerminal).toBe(true);
  });
});
