# refactor(heartbeat): route every run status write through one transition authority

| Field | Value |
| --- | --- |
| Branch | `pr/27a-run-status-transition-authority` |
| Head | `462cb89f7b6c340450f5c8662715fd1ce44b7714` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `refactor(heartbeat): route every run status write through one transition authority` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/heartbeat-run-status-transition-authority.test.ts` | +251 | -0 |
| `server/src/modules/active-run-watchdog/adapters/postgres.ts` | +8 | -9 |
| `server/src/modules/run-dispatch/adapters/postgres.ts` | +37 | -49 |
| `server/src/modules/wake-queue/adapters/queued-comment-postgres.ts` | +14 | -6 |
| `server/src/services/execution-control-reconciliation.ts` | +6 | -7 |
| `server/src/services/heartbeat-run-lifecycle.ts` | +75 | -0 |
| `server/src/services/heartbeat/queue.ts` | +67 | -105 |
| `server/src/services/heartbeat/run-completion.ts` | +2 | -1 |
| `server/src/services/heartbeat/run-lifecycle.ts` | +17 | -22 |
| `server/src/services/legacy-execution-recovery.ts` | +12 | -15 |
| `server/src/services/native-runtime/native-finalization-reconciler.ts` | +25 | -20 |
| `server/src/services/native-runtime/native-restart-recovery.ts` | +11 | -13 |
| `server/src/services/native-runtime/native-review-dispatch.ts` | +10 | -6 |
| `server/src/services/native-runtime/native-run-finalizer.ts` | +40 | -38 |
| `server/src/services/native-runtime/native-run-projection.ts` | +7 | -10 |
| `server/src/services/native-runtime/native-session-executor.ts` | +27 | -26 |
| `server/src/services/native-runtime/native-workspace-export-recovery.ts` | +13 | -4 |
| `server/src/services/native-runtime/native-workspace-export-retry.ts` | +13 | -3 |
| `server/src/services/native-runtime/status-decision-committer.ts` | +13 | -27 |
| `server/src/services/recovery/service.ts` | +7 | -8 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Heartbeat runs move through statuses such as queued, running, succeeded, failed, and cancelled.
> - `heartbeat_runs.status` was written from about thirty places, each with its own conditional update.
> - Nothing recorded which status a run left, when the change happened relative to a concurrent change, or whether a write changed the status at all.
> - This pull request makes one function the only writer of the status, under a row lock, and makes it return the transition.
> - The benefit is one place that knows every status change, which later work can build on.

## Linked Issues or Issue Description

No issue exists. Issue description (enhancement):

**What existing behavior does this improve?**
How the server writes `heartbeat_runs.status`.

**Subsystem affected**
Heartbeat, recovery, run dispatch, the wake queue, the watchdog, and the native runtime.

**Current behavior**
About thirty call sites write the status with their own conditional updates. Three of them set it through a conditional spread. No write reports the previous status or orders itself against a concurrent write.

**Proposed behavior**
`transitionHeartbeatRunStatus` is the only writer. It locks the row, reads `clock_timestamp()` under the lock, writes the status and a patch of other columns, and returns the run and the transition.

**Reason and benefit**
One authority makes concurrent transitions serialize and lets later changes react to committed transitions.

**Breaking changes**
None. Each caller keeps its compare-and-set condition.

No related open pull request was found. #11394 copies status publish logic into the recovery backstop; it does not overlap.

## What Changed

- `transitionHeartbeatRunStatus` is the only writer of the status. It locks the run row, reads `clock_timestamp()` under that lock, writes the new status with a patch of other columns, and returns the run with the transition: previous status, new status, the timestamp, and an event ID unique per transition.
- A transition to the status the run already has writes only the patch and reports no transition. An extra condition keeps each caller's compare-and-set: a run that does not match changes nothing.
- A patch cannot carry the status: its type omits the column, and the function rejects one at runtime. The status helpers in heartbeat and legacy execution recovery take the same status-free patch type.
- Every status write is converted, including three that set the status through a conditional spread in the native run finalizer and the native session executor. Where those sites update other columns without a status change, they keep a plain update.
- A test scans `server/src` and fails on any `heartbeat_runs` update outside the authority that can set the status, including through a spread, a variable whose declaration does not exclude the status, or raw SQL. Tests on PostgreSQL check that a concurrent transition waits for the lock and sees the committed status, same-status writes, unique event IDs, rollback, a non-matching condition, and the rejected patch.

## Verification

Head `462cb89f7b6c340450f5c8662715fd1ce44b7714`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (server/src/__tests__/heartbeat-run-status-transition-authority.test.ts) were run against the base's production code. 1 test fails there. The source scan finds 33 status writes outside the authority. Restoring the base version of the native session executor alone makes it flag that file's hidden writes. On the head the same run gives: 7 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Each status write now takes a row lock first. Two concurrent transitions of one run serialize instead of racing.
- The static check is a source scan. A new status write in an unusual form could pass it; the runtime rejection of a status in the patch still applies.

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

- Provider and model: Google Gemini 3.1 Pro (`gemini-3.1-pro`, 1M-token context window), used through Antigravity.
- Capabilities used: tool use (shell, file reads and edits), code execution, extended reasoning, and duplicate/issue search across `paperclipai/paperclip`.

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
- [ ] All Paperclip CI gates are green
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [x] I will address all Greptile and reviewer comments before requesting merge
