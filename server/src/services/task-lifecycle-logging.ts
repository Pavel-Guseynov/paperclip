export interface TaskLifecycleEventAttributes {
  eventId: string;
  eventType: "task_transition";
  taskId: string;
  identifier: string;
  projectId: string | null;
  companyId: string;
  committedAtMs: number;
  previousStatus: string | null;
  newStatus: string;
  isTerminal: boolean;
  assignee: { type: "agent" | "user"; id: string } | null;
  actingRun: { runId: string } | null;
  source: string;
}

export interface TaskLifecycleRecord {
  schemaVersion: 1;
  timestamp: string;
  time_unix_nano: string;
  level: "info";
  service: "paperclip";
  action: "task_lifecycle";
  message: string;
  attributes: TaskLifecycleEventAttributes;
  error: null;
}

export function formatTaskLifecycleRecord(
  attributes: TaskLifecycleEventAttributes,
): TaskLifecycleRecord {
  const ts = new Date(attributes.committedAtMs).toISOString();
  const timeUnixNano = (BigInt(attributes.committedAtMs) * 1_000_000n).toString();
  const msg = attributes.previousStatus
    ? `Task ${attributes.identifier} transitioned from ${attributes.previousStatus} to ${attributes.newStatus}`
    : `Task ${attributes.identifier} created with status ${attributes.newStatus}`;

  return {
    schemaVersion: 1,
    timestamp: ts,
    time_unix_nano: timeUnixNano,
    level: "info",
    service: "paperclip",
    action: "task_lifecycle",
    message: msg,
    attributes,
    error: null,
  };
}

export function emitLifecycleRecordToStderr(record: unknown): void {
  try {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Fail-safe
  }
}

export interface DeriveTaskLifecycleInput {
  activityId: string;
  action: string;
  companyId: string;
  entityId: string;
  entityType: string;
  runId?: string | null;
  createdAt: Date;
  details?: Record<string, unknown> | null;
  issueFallback?: {
    identifier?: string | null;
    projectId?: string | null;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
  } | null;
  lastKnownStatus?: string | null;
  source: string;
}

export function deriveTaskLifecycleRecord(
  input: DeriveTaskLifecycleInput,
): { record: TaskLifecycleRecord | null; newStatus: string | null } {
  if (input.entityType !== "issue") return { record: null, newStatus: null };

  const details = input.details ?? {};
  let previousStatus: string | null = null;
  let newStatus: string | null = null;

  if (input.action === "issue.created") {
    newStatus = typeof details.status === "string" ? details.status : "todo";
    previousStatus = null;
  } else if (input.action === "issue.updated") {
    const changes = details.changes as Record<string, any> | undefined;
    const prev = details._previous as Record<string, any> | undefined;
    const statusFromChanges = changes?.status?.to;
    const statusFromDetails = details.status;
    const toStatus = details.toStatus;

    const candidateNew = typeof statusFromChanges === "string"
      ? statusFromChanges
      : typeof statusFromDetails === "string"
      ? statusFromDetails
      : typeof toStatus === "string"
      ? toStatus
      : null;

    const candidatePrev = typeof changes?.status?.from === "string"
      ? changes.status.from
      : typeof prev?.status === "string"
      ? prev.status
      : typeof details.previousStatus === "string"
      ? details.previousStatus
      : typeof details.fromStatus === "string"
      ? details.fromStatus
      : input.lastKnownStatus ?? null;

    if (candidateNew && candidatePrev && candidateNew !== candidatePrev) {
      newStatus = candidateNew;
      previousStatus = candidatePrev;
    } else if (candidateNew && changes && "status" in changes) {
      newStatus = candidateNew;
      previousStatus = changes.status?.from ?? input.lastKnownStatus ?? null;
    } else if (candidateNew && candidateNew !== input.lastKnownStatus) {
      newStatus = candidateNew;
      previousStatus = candidatePrev ?? input.lastKnownStatus ?? null;
    }
  } else if (input.action === "issue.workspace_preflight_blocked") {
    if (input.lastKnownStatus !== "blocked") {
      newStatus = "blocked";
      previousStatus = typeof details.previousStatus === "string"
        ? details.previousStatus
        : input.lastKnownStatus ?? null;
    }
  } else if (typeof details.status === "string" && details.status !== input.lastKnownStatus) {
    newStatus = details.status;
    previousStatus = typeof details.previousStatus === "string"
      ? details.previousStatus
      : typeof details.fromStatus === "string"
      ? details.fromStatus
      : input.lastKnownStatus ?? null;
  } else if (typeof details.toStatus === "string" && details.toStatus !== input.lastKnownStatus) {
    newStatus = details.toStatus;
    previousStatus = typeof details.fromStatus === "string"
      ? details.fromStatus
      : input.lastKnownStatus ?? null;
  }

  if (newStatus === null || (previousStatus !== null && newStatus === previousStatus)) {
    return { record: null, newStatus: null };
  }

  const taskId = input.entityId;
  const identifier = (typeof details.identifier === "string" ? details.identifier : null) ??
    input.issueFallback?.identifier ??
    taskId;
  const projectId = (typeof details.projectId === "string" ? details.projectId : null) ??
    input.issueFallback?.projectId ??
    null;

  const assigneeAgentId = (typeof details.assigneeAgentId === "string" ? details.assigneeAgentId : null) ??
    input.issueFallback?.assigneeAgentId ??
    null;
  const assigneeUserId = (typeof details.assigneeUserId === "string" ? details.assigneeUserId : null) ??
    input.issueFallback?.assigneeUserId ??
    null;

  const isTerminal = newStatus === "done" || newStatus === "cancelled";
  const actingRun = input.runId ? { runId: input.runId } : null;
  const assignee = assigneeAgentId
    ? { type: "agent" as const, id: assigneeAgentId }
    : assigneeUserId
    ? { type: "user" as const, id: assigneeUserId }
    : null;

  const committedAtMs = input.createdAt instanceof Date
    ? input.createdAt.getTime()
    : new Date(input.createdAt).getTime();

  const record = formatTaskLifecycleRecord({
    eventId: `task:${taskId}:${input.activityId}`,
    eventType: "task_transition",
    taskId,
    identifier,
    projectId,
    companyId: input.companyId,
    committedAtMs,
    previousStatus,
    newStatus,
    isTerminal,
    assignee,
    actingRun,
    source: input.source,
  });

  return { record, newStatus };
}
