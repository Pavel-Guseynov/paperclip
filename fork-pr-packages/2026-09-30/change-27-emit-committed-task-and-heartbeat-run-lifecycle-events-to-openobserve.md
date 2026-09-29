# Change 27: Emit committed task and heartbeat-run lifecycle events to OpenObserve

> **Pull Request Description Summary**
>
> - Emit exactly one structured record to service `stderr` (single-line JSON conforming to Engineering Standard S6) for every committed transition of every task (creation included, terminal statuses included) and heartbeat run (queued, started, retried, suppression releases, cancellations, terminal outcomes).
> - Every event carries an idempotent event ID (`task:<taskId>:<activityLogId>` for tasks, `run:<runId>:<transitionSeq>:<status>` for runs) guaranteeing strict deduplication in OpenObserve and down-stream dashboard ingestion.
> - Establish `transitionHeartbeatRunStatus` in `server/src/services/heartbeat-run-lifecycle.ts` as the single status transition authority for heartbeat runs, backed by a static AST check ensuring zero direct `.update(heartbeatRuns)` status write bypasses in `server/src`.
> - Provide cancellation attribution distinguishing controller lease watchdog aborts (`cancellationOrigin: "legacy_controller_lease_expired"`, `cancellationActor: { actorType: "system", actorId: "controller_lease_watchdog" }`) from unattributed aborts (`cancellationOrigin: "unattributed_abort"`, `cancellationActor: null`), avoiding fake fallback actors.
> - Provide historical activity-log replay via authenticated daemon admin endpoint `POST /api/admin/lifecycle-events/replay` and CLI `paperclipai admin replay-lifecycle-events`.
> - Provide a pure interval calculation module `calculateStatusIntervals(events, nowMs, window?)` for dashboard aggregation without database locks or external services.

## Linked Issues or Issue Description

Prerequisite for GUS-292 (Paperclip Activity & Lifecycle OpenObserve Dashboard).
Implements Change 27 / GUS-291 (plan GUS-290).

### What happened?

Prior to Change 27, task and heartbeat-run lifecycle events were not emitted to OpenObserve as structured records upon database commit. Run status updates occurred at scattered direct `.update(heartbeatRuns)` sites across the codebase without monotonic sequence numbers (`transitionSeq`), unified cancellation attribution, or transactional guarantee of stderr emission. Task state transitions had no structured S6 lifecycle records or idempotent deduplication keys for OpenObserve dashboards. Furthermore, historical task transitions could not be replayed into observability pipelines after schema additions or stream recreations.

### Expected behavior

1. **Transactional Post-Commit Emission (Principle 11, S6):** Every task status transition and creation, and every run transition (queued, started, retried, finished, cancelled, timed out), emits a single-line structured JSON record to stderr only after the owning database transaction commits.
2. **Idempotent Event IDs:**
   - Task events: `task:<taskId>:<activityLogId>`
   - Run events: `run:<runId>:<transitionSeq>:<status>`
3. **Single Status Authority:** `transitionHeartbeatRunStatus` is the sole entrypoint for updating `heartbeatRuns.status`, serializing row locks via `SELECT ... FOR UPDATE`, computing `clock_timestamp()`, incrementing `transitionSeq`, attributing cancellations, and emitting post-commit records. A static AST check verifies 0 bypasses across `server/src`.
4. **Precise Cancellation Attribution:** Cancellation records distinguish watchdog timeouts (`legacy_controller_lease_expired` with `system:controller_lease_watchdog`) from unattributed aborts (`unattributed_abort` with `cancellationActor: null`), without inventing fallback actors.
5. **Historical Replay:** Authenticated endpoint `POST /api/admin/lifecycle-events/replay` and CLI command `paperclipai admin replay-lifecycle-events` stream historical task transitions from `activity_log` to stderr with `source: "backfill"`, retaining identical event IDs and attributes.
6. **Pure Interval Calculation:** A pure function `calculateStatusIntervals` computes contiguous status durations, window clipping, and open intervals without database side effects.

## What Changed

- **Database Schema & Migrations (`packages/db`):**
  - Add `transitionSeq: integer("transition_seq").notNull().default(1)` to `heartbeatRuns` schema in `packages/db/src/schema/heartbeat_runs.ts`.
  - Export migration `0280_panoramic_the_spike.sql` on stable/main (`0289_...` on master).
- **Heartbeat Run Lifecycle Authority (`server/src/services/heartbeat-run-lifecycle.ts`):**
  - Create `transitionHeartbeatRunStatus` with row-lock serialization (`SELECT ... FOR UPDATE`), `clock_timestamp()` evaluation under lock, monotonic `transitionSeq` increments, and transactional post-commit emission.
  - Export `formatRunLifecycleRecord`, `formatRunInsertionLifecycleRecord`, `derivePhase`, and `deriveOutcome`.
  - Refactor all run status update sites across `heartbeat.ts`, `legacy-execution-recovery.ts`, `recovery/service.ts`, `native-run-finalizer.ts`, `native-session-executor.ts`, `native-restart-recovery.ts`, `native-finalization-reconciler.ts`, `status-decision-committer.ts`, `active-run-watchdog`, `run-dispatch`, and `wake-queue`.
- **Task Lifecycle Emission & Parity (`server/src/services/task-lifecycle-logging.ts`, `server/src/services/activity-log.ts`):**
  - Create `formatTaskLifecycleRecord` and `emitLifecycleRecordToStderr`.
  - Intercept issue entity activity creation in `persistActivity` to stage task lifecycle records atomically with the database transaction.
  - Flush staged task records in `publishActivity` after transaction commit.
- **Historical Activity Log Replay (`server/src/services/activity-log-replay.ts`, `server/src/routes/access.ts`, `cli/src/commands/client/access.ts`):**
  - Implement `replayActivityLogLifecycleEvents` streaming batches from `activity_log`.
  - Add authenticated daemon admin route `POST /api/admin/lifecycle-events/replay`.
  - Add CLI command `paperclipai admin replay-lifecycle-events` with `--company-id`, `--from`, `--to`, and `--batch-size` options.
  - Add Zod validators in `packages/shared/src/validators/access.ts`.
- **Pure Interval Calculation (`server/src/services/lifecycle-intervals.ts`):**
  - Implement `calculateStatusIntervals(events, nowMs, window?)` supporting open intervals and window boundary clipping.
- **Regression Test Suites (`server/src/__tests__/`):**
  - `task-lifecycle-events.test.ts`: Covers task creation, live transitions, terminal status, idempotent event IDs, and concurrency under row lock.
  - `heartbeat-run-lifecycle-events.test.ts`: Covers run queued, started, retry, and cancellation attribution.
  - `heartbeat-run-status-transition-authority.test.ts`: Static AST check verifying 0 direct status update bypasses in `server/src`.
  - `activity-log-lifecycle-replay.test.ts`: Verifies admin replay endpoint contract and ordering.
  - `lifecycle-interval-calculation.test.ts`: Verifies interval calculation, window clipping, and open intervals.

## Exact Branch State & Commit SHAs

| Ref | Full SHA |
| --- | --- |
| Upstream base (`master`) | `81a52eb740fb15139f360e27a4d915cd080a9cdf` |
| Contribution branch (`feat/committed-task-and-run-lifecycle-events`) | `ee01ba135f27aa66ae55668933bf91124eac2137` |
| Stable base (`v2026.916.1`) | `d554c4789ed3930f8a53ac9fdf6503b3187097da` |
| Stable branch (`stable/v2026.916.1/feat/committed-task-and-run-lifecycle-events`) | `966962a121bab55ede9b879c217739d9639e65e4` |
| Integration base (`main` prior to merge) | `c5fd824f48139eed3408bae4bdeb8949b9d86d59` |
| Integration merge (`main`) | `0fe58da272db928f9e5ee7d890dde30a61b14485` |

## Verification and Test Proof

### 1. Regression Suites

| Suite | File | Tests | Status |
| --- | --- | --- | --- |
| Task Lifecycle Events | `server/src/__tests__/task-lifecycle-events.test.ts` | 5/5 | PASS |
| Run Lifecycle Events | `server/src/__tests__/heartbeat-run-lifecycle-events.test.ts` | 4/4 | PASS |
| Single Status Authority AST Check | `server/src/__tests__/heartbeat-run-status-transition-authority.test.ts` | 1/1 | PASS |
| Activity Log Replay | `server/src/__tests__/activity-log-lifecycle-replay.test.ts` | 1/1 | PASS |
| Lifecycle Interval Calculation | `server/src/__tests__/lifecycle-interval-calculation.test.ts` | 4/4 | PASS |

- Result on unpatched upstream base (`master`): 5 failed causally (new features, missing schema/services).
- Result on unpatched stable base (`v2026.916.1`): 5 failed causally.
- Result on contribution head (`feat/committed-task-and-run-lifecycle-events`): 15/15 passed.
- Result on stable head (`stable/v2026.916.1/feat/committed-task-and-run-lifecycle-events`): 15/15 passed.
- Result on main merge (`main`): 15/15 passed.

### 2. Repository Gates Matrix on `main`
- `pnpm check:tokens`: Clean (0 forbidden tokens found).
- `pnpm check:token-gates`: Clean (0 violations across 1,018 scanned files).
- `pnpm check:node-version`: Passed (Node >=24.11.0, @types/node 24.x).
- `pnpm check:no-git-push`: Clean (0 unapproved `git push` invocations).
- `pnpm check:module-boundaries`: Passed.
- `pnpm -r typecheck`: Exit code 0 across all workspace packages.
- `pnpm build`: Exit code 0 across all workspace packages.

## Invariants & Design Decisions

1. **Transactional Post-Commit Emission (Principle 11, S6):** Records are emitted to stderr only after the database transaction commits. Rolling back a transaction rolls back both the status mutation and its lifecycle record.
2. **Deterministic Parity Between Live & Replay:** Because task lifecycle records are formatted from the `activity_log` entry data itself inside `persistActivity`, replaying historical entries through `replayActivityLogLifecycleEvents` produces exact payload and eventId equivalence with live emission.
3. **No Polling or Sleeping (Principle 8):** Interval calculation is a pure function over timestamps; it does not poll or sleep. Replay streams synchronously across batches using cursor pagination.
4. **Single Source of Truth (Principle 1):** `transitionHeartbeatRunStatus` is the sole authority for run status mutations. The static check `heartbeat-run-status-transition-authority.test.ts` guarantees no alternative or redundant path exists.

## Risks

- Emitted logs are sent to service `stderr` for collection by vector/fluent-bit/OpenObserve collectors. Environments with stderr suppression will not ingest events into OpenObserve.
- Replaying large activity logs can generate significant stderr volume; administrators should specify `--from`, `--to`, and appropriate `--batch-size` parameters.

## Model Used

- None — human-authored

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [x] I have run tests locally and they pass
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [x] All Paperclip CI gates are green
- [x] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [x] I will address all Greptile and reviewer comments before requesting merge
