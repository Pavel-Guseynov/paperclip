import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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
import { replayActivityLogLifecycleEvents } from "../services/activity-log-replay.js";
import { deriveTaskLifecycleRecord } from "../services/task-lifecycle-logging.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("activity log lifecycle replay", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const capturedReplayRecords: any[] = [];
  let restoreStderr: (() => void) | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-activity-replay-");
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
              capturedReplayRecords.push(parsed);
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
    capturedReplayRecords.length = 0;
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  async function createCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme Replay Corp",
      issuePrefix: "RP",
      defaultResponsibleUserId: randomUUID(),
    });
    return companyId;
  }

  it("replays historical activity logs with deterministic eventIds, identical committedAtMs, and captures non-update status transitions", async () => {
    const companyId = await createCompany();
    const taskId = randomUUID();
    const t0 = new Date("2026-09-28T01:00:00.000Z");
    const t1 = new Date("2026-09-28T01:05:00.000Z");
    const t2 = new Date("2026-09-28T01:10:00.000Z");

    await db.insert(issues).values({
      id: taskId,
      companyId,
      issueNumber: 101,
      identifier: "RP-101",
      title: "Replay Test Task",
      status: "blocked",
      createdAt: t0,
      updatedAt: t2,
    });

    const act1Id = randomUUID();
    const act2Id = randomUUID();
    const act3Id = randomUUID();

    // 1. issue.created
    await db.insert(activityLog).values({
      id: act1Id,
      companyId,
      actorType: "user",
      actorId: randomUUID(),
      action: "issue.created",
      entityType: "issue",
      entityId: taskId,
      details: { status: "todo", identifier: "RP-101" },
      createdAt: t0,
    });

    // 2. issue.updated (todo -> in_progress)
    await db.insert(activityLog).values({
      id: act2Id,
      companyId,
      actorType: "agent",
      actorId: randomUUID(),
      action: "issue.updated",
      entityType: "issue",
      entityId: taskId,
      details: {
        status: "in_progress",
        identifier: "RP-101",
        changes: { status: { from: "todo", to: "in_progress" } },
      },
      createdAt: t1,
    });

    // 3. issue.workspace_preflight_blocked (in_progress -> blocked)
    await db.insert(activityLog).values({
      id: act3Id,
      companyId,
      actorType: "system",
      actorId: "preflight_checker",
      action: "issue.workspace_preflight_blocked",
      entityType: "issue",
      entityId: taskId,
      details: {
        identifier: "RP-101",
        reason: "Git worktree collision",
      },
      createdAt: t2,
    });

    // Replay
    const result = await replayActivityLogLifecycleEvents(db, { companyId });
    expect(result.eventsEmitted).toBe(3);

    const replayed = capturedReplayRecords.filter((r) => r.attributes?.taskId === taskId);
    expect(replayed).toHaveLength(3);

    // Event 1
    expect(replayed[0].attributes.eventId).toBe(`task:${taskId}:${act1Id}`);
    expect(replayed[0].attributes.committedAtMs).toBe(t0.getTime());
    expect(replayed[0].attributes.previousStatus).toBeNull();
    expect(replayed[0].attributes.newStatus).toBe("todo");
    expect(replayed[0].attributes.source).toBe("backfill");

    // Event 2
    expect(replayed[1].attributes.eventId).toBe(`task:${taskId}:${act2Id}`);
    expect(replayed[1].attributes.committedAtMs).toBe(t1.getTime());
    expect(replayed[1].attributes.previousStatus).toBe("todo");
    expect(replayed[1].attributes.newStatus).toBe("in_progress");
    expect(replayed[1].attributes.source).toBe("backfill");

    // Event 3 (workspace_preflight_blocked -> blocked)
    expect(replayed[2].attributes.eventId).toBe(`task:${taskId}:${act3Id}`);
    expect(replayed[2].attributes.committedAtMs).toBe(t2.getTime());
    expect(replayed[2].attributes.previousStatus).toBe("in_progress");
    expect(replayed[2].attributes.newStatus).toBe("blocked");
    expect(replayed[2].attributes.source).toBe("backfill");
  });

  it("stays within its batch bound during replay", async () => {
    const companyId = await createCompany();
    const taskId = randomUUID();
    const t0 = new Date("2026-09-28T02:00:00.000Z");

    await db.insert(issues).values({
      id: taskId,
      companyId,
      issueNumber: 102,
      identifier: "RP-102",
      title: "Batch Test Task",
      status: "done",
      createdAt: t0,
      updatedAt: t0,
    });

    for (let i = 0; i < 5; i++) {
      await db.insert(activityLog).values({
        id: randomUUID(),
        companyId,
        actorType: "agent",
        actorId: randomUUID(),
        action: i === 0 ? "issue.created" : "issue.updated",
        entityType: "issue",
        entityId: taskId,
        details: i === 0
          ? { status: "todo", identifier: "RP-102" }
          : { status: i === 1 ? "in_progress" : i === 2 ? "in_review" : i === 3 ? "blocked" : "done",
              identifier: "RP-102" },
        createdAt: new Date(t0.getTime() + i * 60_000),
      });
    }

    capturedReplayRecords.length = 0;
    // Replay with batchSize: 2
    const result = await replayActivityLogLifecycleEvents(db, { companyId, batchSize: 2 });
    expect(result.eventsEmitted).toBe(5);
    expect(result.totalActivitiesScanned).toBe(5);
    const replayed = capturedReplayRecords.filter((r) => r.attributes?.taskId === taskId);
    expect(replayed).toHaveLength(5);
  });

  it("live and replayed records match for every status-changing action type", async () => {
    const companyId = await createCompany();
    const taskId = randomUUID();
    const createdAt = new Date("2026-09-28T03:00:00.000Z");

    const testActions = [
      {
        action: "issue.created",
        details: { status: "todo", identifier: "RP-103", projectId: "p1", assigneeAgentId: "a1" },
        lastKnownStatus: null,
      },
      {
        action: "issue.updated",
        details: {
          status: "in_progress",
          identifier: "RP-103",
          changes: { status: { from: "todo", to: "in_progress" } },
        },
        lastKnownStatus: "todo",
      },
      {
        action: "issue.workspace_preflight_blocked",
        details: { identifier: "RP-103", previousStatus: "in_progress" },
        lastKnownStatus: "in_progress",
      },
    ];

    for (const testCase of testActions) {
      const activityId = randomUUID();
      const input = {
        activityId,
        action: testCase.action,
        companyId,
        entityId: taskId,
        entityType: "issue",
        createdAt,
        details: testCase.details,
        lastKnownStatus: testCase.lastKnownStatus,
      };

      const live = deriveTaskLifecycleRecord({ ...input, source: "live" });
      const replayed = deriveTaskLifecycleRecord({ ...input, source: "backfill" });

      expect(live.record).not.toBeNull();
      expect(replayed.record).not.toBeNull();
      expect(live.newStatus).toBe(replayed.newStatus);

      // Attributes must match exactly except source
      const { source: liveSource, ...liveAttr } = live.record!.attributes;
      const { source: replaySource, ...replayAttr } = replayed.record!.attributes;
      expect(liveSource).toBe("live");
      expect(replaySource).toBe("backfill");
      expect(liveAttr).toEqual(replayAttr);
    }
  });
});

