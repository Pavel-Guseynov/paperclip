# fix(recovery): preserve unknown action outcomes and allow explicit board reconciliation of settled holds

| Field | Value |
| --- | --- |
| Branch | `fix/recover-stale-execution-and-finalization` |
| Head | `7ad2c4b282164cbee98c81ff2505fa5c02dccc45` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(recovery): preserve unknown action outcomes and allow explicit board reconciliation of settled holds` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `cli/src/__tests__/issue-subresources.test.ts` | +25 | -0 |
| `cli/src/commands/client/common.ts` | +5 | -2 |
| `cli/src/commands/client/issue.ts` | +14 | -1 |
| `doc/execution-semantics.md` | +27 | -0 |
| `packages/shared/src/index.ts` | +1 | -1 |
| `packages/shared/src/types/execution-projection.ts` | +5 | -1 |
| `packages/shared/src/validators/issue.ts` | +2 | -2 |
| `server/src/__tests__/issue-execution-reconciliation.test.ts` | +583 | -0 |
| `server/src/routes/issues.ts` | +55 | -10 |
| `server/src/services/execution-blocker.ts` | +1 | -2 |
| `server/src/services/execution-continuation.test.ts` | +15 | -0 |
| `server/src/services/execution-projection.ts` | +2 | -1 |
| `server/src/services/execution-recovery-resolution.ts` | +51 | -27 |
| `server/src/services/heartbeat/queue.ts` | +2 | -4 |
| `server/src/services/native-runtime/native-safe-replacement.test.ts` | +9 | -0 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When an agent run is interrupted after starting a side-effecting action whose completion is unknown, legacy execution recovery places a reconciliation hold (`legacy_execution_requires_reconciliation`) on the issue.
> - Once automatic recovery settles that action with `replay = 'blocked'`, the recovery action row is no longer `active`, yet `executionBlocker` remains on the issue.
> - Calling `POST /api/issues/:id/recovery-actions/resolve` without an active row returned `404 Active recovery action not found`, leaving the issue stranded in `todo` with no way for the board to resolve the hold and wake the assignee.
> - This pull request preserves unknown action outcomes in the durable receipt and prompt envelope, and lets the canonical resolution route resolve the settled reconciliation hold under the issue lock once the source run is terminal and stopped.
> - The benefit is that interrupted runs never fake an unknown action outcome and the board can cleanly reconcile settled holds to resume work.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
An interrupted run left `executionBlocker.cause = "legacy_execution_requires_reconciliation"` on an issue after automatic recovery settled the recovery action with `replay = "blocked"`. Calling `POST /api/issues/:id/recovery-actions/resolve` returned `404 Active recovery action not found`, and the issue stayed stranded in `todo` with no run.

**Expected behavior**
Unknown action outcomes remain explicitly marked unknown, and `POST /api/issues/:id/recovery-actions/resolve` resolves the settled reconciliation hold when the source run is terminal and stopped, clearing the stale blocker and waking the assignee once.

**Steps to reproduce**
1. Interrupt a run that has a started action with an unknown outcome so recovery settles the action with `replay = "blocked"`.
2. Call `POST /api/issues/:id/recovery-actions/resolve` with `executionReconciliation` to clear the hold.
3. Observe `404 Active recovery action not found` on master.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

Related pull requests: builds on the continuation recovery work in #15024 and #15033 (already on `master`). No open duplicate pull request was found.

## What Changed

- Unknown action outcomes remain `unknown` in the durable recovery receipt and the continuation prompt envelope instead of being coerced into failed or succeeded outcomes.
- `POST /api/issues/:id/recovery-actions/resolve` locates the settled recovery action referenced by `executionBlocker.recoveryActionId` under the issue lock when board-owned `executionReconciliation` is submitted.
- Resolution verifies that the source run is terminal and has no live process or active lease, preserves prior automatic-recovery audit history, clears the stale blocker, and delivers one idempotent fresh continuation wake.
- Repeated resolution repairs pending wake delivery and rejects a live provider, mismatched source run, missing termination evidence, or contradictory outcome.
- Tests in `server/src/__tests__/issue-execution-reconciliation.test.ts` and `execution-continuation.test.ts` verify unknown-outcome preservation, settled-hold resolution, idempotent retry, and live-run rejection on PostgreSQL.

## Verification

Head `7ad2c4b282164cbee98c81ff2505fa5c02dccc45`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/issue-execution-reconciliation.test.ts`, `server/src/services/execution-continuation.test.ts`) were run against the base's production code. 9 tests fail there. On the base `POST /api/issues/:id/recovery-actions/resolve` returns `404 Active recovery action not found` when the recovery action was already settled with `replay = 'blocked'` and `executionBlocker` remains on the issue. On the head the same run gives: 31 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Reconciliation still refuses to clear a hold while the source run is active or its local process is still alive.

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
