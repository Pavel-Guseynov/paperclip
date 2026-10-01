# fix(heartbeat): keep a run's lease while its detached local process runs

| Field | Value |
| --- | --- |
| Branch | `pr/22b-guard-environment-lease-release-on-live-runs` |
| Head | `0e7a3154e9f0488dc0587e8d550d0a1217045c26` |
| Base commit | `60b708bb7ccf3dd18c1a179358a65e67b7292628` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | `pr/22-release-cancelled-interrupted-run-leases` |
| Proposed title | `fix(heartbeat): keep a run's lease while its detached local process runs` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/release-cancelled-interrupted-run-leases.test.ts` | +44 | -0 |
| `server/src/services/heartbeat.ts` | +42 | -4 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - A local adapter run can leave a detached child process that this server holds no handle for.
> - A Stop cannot signal such a child, so the child can keep running after its run row is terminal.
> - Releasing that run's lease, when the run ends without an executor or in the orphaned-lease sweep, frees the environment while the child still works in it.
> - This pull request keeps the lease while the tracked local process is alive, with the same liveness rule the reaper uses.
> - The benefit is that a new run cannot take an environment that a live process still uses.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
With pull request 22 applied, a Stop of a run whose detached local child kept running released the run's lease. A new run could then acquire the environment while the old child still wrote to it. The orphaned-lease sweep did the same on master.

**Expected behavior**
The lease stays while the run's tracked process or process group is alive, and the sweep recovers it after the process exits.

**Steps to reproduce**
1. Start a legacy local run whose adapter spawns a detached child.
2. Stop the run while the child is alive.
3. See the lease released while the child runs.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf` with pull request 22 applied.

**Deployment mode**
Any, for local adapters.

Related open pull request: #11970 also keeps leases for live runs as part of a lease TTL change. It does not cover this release path. They are independent.

Stack: this pull request is based on `pr/22-release-cancelled-interrupted-run-leases`. This pull request guards the release helper that pull request 22 adds (`releaseLeasesForRunWithoutExecutor`) and the orphaned-lease sweep. Review and merge that pull request first.

## What Changed

- A legacy run of an adapter whose local child the reaper tracks keeps its lease while that child's PID or process group is alive, or while this server still holds its process handle. This is the rule the reaper applies before it ends such a run.
- The orphaned-lease sweep defers such a lease, so the rows behind it still reach the page, and recovers it once the process exits.
- Tests spawn a real child process, end the run with a Stop, and check that the lease stays active after the Stop and in the sweep, and that the sweep recovers it after the child exits.

## Verification

Head `0e7a3154e9f0488dc0587e8d550d0a1217045c26`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`. Its base `60b708bb7ccf3dd18c1a179358a65e67b7292628` is the head of `pr/22-release-cancelled-interrupted-run-leases`.

- Regression proof: the head's tests (server/src/__tests__/release-cancelled-interrupted-run-leases.test.ts) were run against the base's production code. 2 tests fail there. (Base: pull request 22.) the lease of a run with a live child is released (`expired`, `pending_cleanup`) instead of staying `active`. On the head the same run gives: 5 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- A lease whose process never exits stays held. The reaper handles such a process with its existing rules.
- Remote and sandbox adapters are unchanged: the guard applies only to adapters whose local child the reaper tracks.

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
