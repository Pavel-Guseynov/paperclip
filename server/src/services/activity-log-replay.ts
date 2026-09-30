import { and, asc, eq, gt, gte, inArray, or } from "drizzle-orm";
import { activityLog, issues, type Db } from "@paperclipai/db";
import {
  deriveTaskLifecycleRecord,
  emitLifecycleRecordToStderr,
} from "./task-lifecycle-logging.js";

export interface ReplayOptions {
  companyId?: string;
  since?: string;
  dryRun?: boolean;
  batchSize?: number;
  source?: string;
}

export interface ReplayResult {
  totalActivitiesScanned: number;
  eventsEmitted: number;
  dryRun: boolean;
}

export async function replayActivityLogLifecycleEvents(
  db: Db,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const batchSize = Math.max(1, options.batchSize ?? 500);
  const source = options.source ?? "backfill";
  const issueMap = new Map<
    string,
    {
      id: string;
      identifier: string | null;
      projectId: string | null;
      assigneeAgentId: string | null;
      assigneeUserId: string | null;
      companyId: string;
    }
  >();
  const lastKnownStatusPerTask = new Map<string, string>();
  let totalActivitiesScanned = 0;
  let eventsEmitted = 0;
  let lastRow: { createdAt: Date; id: string } | null = null;

  while (true) {
    const whereClauses = [eq(activityLog.entityType, "issue")];
    if (options.companyId) {
      whereClauses.push(eq(activityLog.companyId, options.companyId));
    }
    if (options.since) {
      whereClauses.push(gte(activityLog.createdAt, new Date(options.since)));
    }
    if (lastRow) {
      whereClauses.push(
        or(
          gt(activityLog.createdAt, lastRow.createdAt),
          and(eq(activityLog.createdAt, lastRow.createdAt), gt(activityLog.id, lastRow.id)),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(activityLog)
      .where(and(...whereClauses))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id))
      .limit(batchSize);

    if (rows.length === 0) break;

    const issueIds = [...new Set(rows.map((r) => r.entityId))].filter((id) => !issueMap.has(id));
    if (issueIds.length > 0) {
      const issueRows = await db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          projectId: issues.projectId,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
          companyId: issues.companyId,
        })
        .from(issues)
        .where(
          issueIds.length === 1
            ? eq(issues.id, issueIds[0])
            : inArray(issues.id, issueIds),
        );
      for (const row of issueRows) {
        issueMap.set(row.id, row);
      }
    }

    for (const row of rows) {
      totalActivitiesScanned++;
      const issueInfo = issueMap.get(row.entityId) ?? null;
      const lastKnown = lastKnownStatusPerTask.get(row.entityId) ?? null;

      const { record, newStatus } = deriveTaskLifecycleRecord({
        activityId: row.id,
        action: row.action,
        companyId: row.companyId,
        entityId: row.entityId,
        entityType: row.entityType,
        runId: row.runId,
        createdAt: row.createdAt,
        details: (row.details as Record<string, unknown> | null) ?? {},
        issueFallback: issueInfo,
        lastKnownStatus: lastKnown,
        source,
      });

      if (newStatus !== null) {
        lastKnownStatusPerTask.set(row.entityId, newStatus);
      }

      if (record !== null) {
        if (!options.dryRun) {
          emitLifecycleRecordToStderr(record);
        }
        eventsEmitted++;
      }
    }

    lastRow = rows[rows.length - 1];
    if (rows.length < batchSize) break;
  }

  return {
    totalActivitiesScanned,
    eventsEmitted,
    dryRun: Boolean(options.dryRun),
  };
}
