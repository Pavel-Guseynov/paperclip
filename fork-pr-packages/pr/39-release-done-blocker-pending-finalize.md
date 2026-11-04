# fix(issues): release done blockers whose last workspace operation run is terminal

| Field | Value |
| --- | --- |
| Branch | `fix/release-done-blocker-pending-finalize` |
| Head | `8fa08dc94f571c7cd4b9e68c07f0d3f1092adb6d` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(issues): release done blockers whose last workspace operation run is terminal` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/issues-service.test.ts` | +96 | -0 |
| `server/src/services/issues.ts` | +16 | -2 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When an issue finishes (`status = 'done'`), dependent issues wait until the blocker's workspace finalization completes (`listPendingFinalizeBlockerIssueIds`).
> - If the blocker's last heartbeat run recorded a `workspace_provision` or failed `workspace_finalize` operation and then terminated without writing a succeeded `workspace_finalize`, `listPendingFinalizeBlockerIssueIds` kept that `done` blocker in the pending-finalize set forever.
> - Every dependent issue stayed stuck in `pending_finalize` (`isDependencyReady: false`) with no active run to ever finish finalization.
> - This pull request holds a `done` blocker in `pending_finalize` only while the heartbeat run that owns its latest workspace operation is still live (`queued`, `claimed`, or `running`).
> - The benefit is that a `done` blocker whose last workspace run has already terminated no longer deadlocks its dependent issues.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
A blocker issue reached `done`, and its heartbeat run terminated after recording a workspace operation without a final succeeded `workspace_finalize`. Dependent issues remained stuck in `workspace_finalize_pending` indefinitely and never dispatched.

**Expected behavior**
`listPendingFinalizeBlockerIssueIds` holds a `done` blocker in `pending_finalize` only while the heartbeat run owning its latest workspace operation is still live; once that run is terminal or absent, dependents are released.

**Steps to reproduce**
1. Create blocker Issue A and dependent Issue B (`blockedBy: [A]`).
2. Record a `workspace_provision` operation for Issue A's workspace on a run that then finishes, and transition Issue A to `done`.
3. Inspect dependency readiness for Issue B: on master, Issue A remains in `pendingFinalizeBlockerIssueIds` forever.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `listPendingFinalizeBlockerIssueIds` in `server/src/services/issues.ts` checks the status of the heartbeat run that owns the latest workspace operation on a `done` blocker's execution workspace.
- When that owning run is terminal (`succeeded`, `failed`, `cancelled`, `timed_out`, `interrupted`) or missing, the `done` blocker is no longer reported as pending finalization, releasing its dependent issues.
- When a live run still owns the latest unfinalized workspace operation, the blocker remains in `pendingFinalizeBlockerIssueIds` until the run finishes.
- Tests in `server/src/__tests__/issues-service.test.ts` verify that a `done` blocker with a terminal or missing workspace-operation run releases its dependents while a live run still holds them.

## Verification

Head `8fa08dc94f571c7cd4b9e68c07f0d3f1092adb6d`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/issues-service.test.ts`) were run against the base's production code. 2 tests fail there. On the base `listPendingFinalizeBlockerIssueIds` keeps a `done` blocker in `pendingFinalizeBlockerIssueIds` even after the run owning its latest workspace operation has terminated. On the head the same run gives: 46 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Low risk: only `done` blockers whose latest workspace operation belongs to a non-live run are released; active runs still gate dependents until finalization.

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
