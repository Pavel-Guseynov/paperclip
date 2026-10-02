export interface TaskLifecycleEventRecord {
  eventId: string;
  taskId: string;
  identifier?: string;
  companyId?: string;
  projectId?: string;
  previousStatus: string | null;
  newStatus: string;
  committedAtMs: number;
  isTerminal?: boolean;
  actingRun?: { runId: string } | null;
  source?: string;
}

export interface StatusInterval {
  taskId: string;
  identifier?: string;
  status: string;
  startTimeMs: number;
  endTimeMs: number | null;
  durationSeconds: number;
  isOpen: boolean;
  isTerminal: boolean;
}

export interface IntervalWindow {
  fromMs: number;
  toMs: number;
}

export function calculateStatusIntervals(
  events: readonly TaskLifecycleEventRecord[],
  nowMs: number,
  window?: IntervalWindow,
): StatusInterval[] {
  // 1. Deduplicate by eventId
  const seenEventIds = new Set<string>();
  const deduped: TaskLifecycleEventRecord[] = [];
  for (const event of events) {
    if (!seenEventIds.has(event.eventId)) {
      seenEventIds.add(event.eventId);
      deduped.push(event);
    }
  }

  // 2. Group by taskId
  const byTask = new Map<string, TaskLifecycleEventRecord[]>();
  for (const event of deduped) {
    let list = byTask.get(event.taskId);
    if (!list) {
      list = [];
      byTask.set(event.taskId, list);
    }
    list.push(event);
  }

  const result: StatusInterval[] = [];

  for (const [taskId, taskEvents] of byTask.entries()) {
    // Sort chronologically by committedAtMs
    taskEvents.sort((a, b) => a.committedAtMs - b.committedAtMs);

    for (let i = 0; i < taskEvents.length; i++) {
      const current = taskEvents[i];
      const next = i + 1 < taskEvents.length ? taskEvents[i + 1] : null;
      const isTerminal = Boolean(
        current.isTerminal || current.newStatus === "done" || current.newStatus === "cancelled",
      );

      const startTimeMs = current.committedAtMs;
      let endTimeMs: number | null = null;
      let durationSeconds = 0;
      let isOpen = false;

      if (next) {
        endTimeMs = next.committedAtMs;
        durationSeconds = Math.max(0, (endTimeMs - startTimeMs) / 1000);
        isOpen = false;
      } else if (isTerminal) {
        endTimeMs = null;
        durationSeconds = 0;
        isOpen = false;
      } else {
        endTimeMs = null;
        durationSeconds = Math.max(0, (nowMs - startTimeMs) / 1000);
        isOpen = true;
      }

      const interval: StatusInterval = {
        taskId,
        identifier: current.identifier,
        status: current.newStatus,
        startTimeMs,
        endTimeMs,
        durationSeconds,
        isOpen,
        isTerminal,
      };

      if (window) {
        if (endTimeMs !== null) {
          // Closed interval: include if it ended within or after window start and started on or before window end
          if (endTimeMs >= window.fromMs && startTimeMs <= window.toMs) {
            result.push(interval);
          }
        } else {
          // Open interval: include if started on or before window end
          if (startTimeMs <= window.toMs) {
            result.push(interval);
          }
        }
      } else {
        result.push(interval);
      }
    }
  }

  return result;
}
