# refactor(heartbeat): route every run status write through one transition authority

| Field | Value |
| --- | --- |
| Branch | `pr/27a-run-status-transition-authority` |
| Head | `175248ad04bb6c644ce36d0da6c9e32b34007c3f` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `refactor(heartbeat): route every run status write through one transition authority` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/heartbeat-run-status-transition-authority.test.ts` | +263 | -0 |
| `server/src/modules/active-run-watchdog/adapters/postgres.ts` | +8 | -9 |
| `server/src/modules/run-dispatch/adapters/postgres.ts` | +29 | -39 |
| `server/src/modules/wake-queue/adapters/queued-comment-postgres.ts` | +14 | -6 |
| `server/src/services/execution-control-reconciliation.ts` | +6 | -7 |
| `server/src/services/heartbeat-run-lifecycle.ts` | +93 | -0 |
| `server/src/services/heartbeat.ts` | +79 | -132 |
| `server/src/services/legacy-execution-recovery.ts` | +11 | -14 |
| `server/src/services/native-runtime/native-finalization-reconciler.ts` | +25 | -20 |
| `server/src/services/native-runtime/native-restart-recovery.ts` | +11 | -13 |
| `server/src/services/native-runtime/native-review-dispatch.ts` | +10 | -6 |
| `server/src/services/native-runtime/native-run-finalizer.ts` | +104 | -123 |
| `server/src/services/native-runtime/native-session-executor.ts` | +33 | -46 |
| `server/src/services/native-runtime/native-workspace-export-recovery.ts` | +13 | -4 |
| `server/src/services/native-runtime/native-workspace-export-retry.ts` | +13 | -3 |
| `server/src/services/native-runtime/status-decision-committer.ts` | +13 | -27 |
| `server/src/services/recovery/service.ts` | +51 | -55 |

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

Head `175248ad04bb6c644ce36d0da6c9e32b34007c3f`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/heartbeat-run-status-transition-authority.test.ts) were run against the base's production code. 1 test fails there. The source scan finds 33 status writes outside the authority. Restoring the base version of the native session executor alone makes it flag that file's hidden writes. On the head the same run gives: 7 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Each status write now takes a row lock first. Two concurrent transitions of one run serialize instead of racing.
- The static check is a source scan. A new status write in an unusual form could pass it; the runtime rejection of a status in the patch still applies.

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

- Provider and model: Anthropic Claude, used through Claude Code (an agentic coding CLI).
- Capabilities used: tool use (shell, file reads and edits), code execution, extended reasoning, and a subagent for the duplicate search.
- The commit trailers carry the Claude attribution. The person who opens this pull request adds the exact model ID and context window here.

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [ ] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [ ] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [ ] I have run tests locally and they pass
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [ ] I will address all Greptile and reviewer comments before requesting merge
