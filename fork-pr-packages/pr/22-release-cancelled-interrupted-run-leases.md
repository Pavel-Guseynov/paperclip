# fix(heartbeat): release leases of runs that end without an executor

| Field | Value |
| --- | --- |
| Branch | `pr/22-release-cancelled-interrupted-run-leases` |
| Head | `60b708bb7ccf3dd18c1a179358a65e67b7292628` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(heartbeat): release leases of runs that end without an executor` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/release-cancelled-interrupted-run-leases.test.ts` | +142 | -0 |
| `server/src/services/heartbeat.ts` | +32 | -0 |
| `server/src/services/recovery/service.ts` | +15 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - A run holds an environment lease while it works, and its executor releases the lease at the end of its own cleanup.
> - A legacy run that ends while no executor runs it in this process never reaches that point: a cancellation (Stop, reassignment, or the issue reaching done or cancelled), a cancellation because the agent paused, and the stale-lock sweep.
> - Its lease stays active, so the conversation blocker keeps the issue blocked until the orphaned-lease sweep recovers the lease one reaper interval later.
> - This pull request releases the lease on those paths, through the same release path the executor uses.
> - The benefit is that the issue unblocks as soon as the run ends.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
After a board user stopped an agent run, the issue stayed blocked by the conversation blocker, because the run's environment lease stayed `active`.

**Expected behavior**
When a run ends without an executor, its lease is released at once.

**Steps to reproduce**
1. Start a legacy local run that holds an environment lease.
2. Stop it from the board, pause its agent, or let the stale-lock sweep interrupt it after its process died.
3. See the lease stay `active` and the issue stay blocked until the next orphaned-lease sweep.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #11970 adds a lease TTL and a sweep for terminal runs, #13880 re-admits wakes blocked by a held lease, and #14286 is a test-only change for orphaned-run leases. None releases the lease on these three paths. They are independent.

## What Changed

- A cancellation (Stop, reassignment, or the issue reaching done or cancelled), a cancellation because the agent paused, and the stale-lock sweep release the run's environment leases when the run is a legacy run and no executor in this process owns it.
- They use the release path the executor uses. A run with an active executor is unchanged: the executor releases after its workspace copy-back.
- Tests on PostgreSQL acquire a local lease through the environment runtime, end the run through each path, and check that the lease is released and the issue is no longer blocked.

## Verification

Head `60b708bb7ccf3dd18c1a179358a65e67b7292628`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/release-cancelled-interrupted-run-leases.test.ts) were run against the base's production code. 3 tests fail there. The lease stays `active` after each path. On the head the same run gives: 3 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- A failed release is logged and does not stop the cancellation or the sweep. The orphaned-lease sweep still recovers such a lease later.
- Pull request 22b adds the live-process guard on top of this change.

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
