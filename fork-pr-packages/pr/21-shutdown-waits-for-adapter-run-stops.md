# fix(server): let graceful shutdown wait for in-flight adapter runs

| Field | Value |
| --- | --- |
| Branch | `pr/21-shutdown-waits-for-adapter-run-stops` |
| Head | `db03108b7103453f2b691d0d24d9d5154fc03d3a` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(server): let graceful shutdown wait for in-flight adapter runs` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `docs/deploy/environment-variables.md` | +1 | -0 |
| `packages/shared/src/config-schema.ts` | +1 | -0 |
| `server/src/__tests__/shutdown-waits-for-adapter-run-stops.test.ts` | +172 | -0 |
| `server/src/config.ts` | +15 | -0 |
| `server/src/index.ts` | +2 | -0 |
| `server/src/services/heartbeat.ts` | +10 | -2 |
| `server/src/shutdown.test.ts` | +4 | -3 |
| `server/src/shutdown.ts` | +5 | -3 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - On graceful shutdown, the server waits for in-flight adapter executions before it closes the database.
> - That wait was at most 5 seconds, so an adapter that needs longer to stop lost its final run update.
> - The timeout was logged at info level without the run IDs, and a queued run could start while shutdown waited.
> - This pull request makes the wait configurable with a 60-second default, logs the remaining runs as an error, and starts no queued run after shutdown begins.
> - The benefit is that runs end with their final state recorded.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
On `SIGTERM`, an adapter run that needed 20 seconds to stop its process lost its final update: the server closed the database after 5 seconds. A wakeup during the wait started a queued run that the exit then cut off.

**Expected behavior**
Shutdown waits a configurable time for in-flight runs, names the runs that did not finish, and starts no new run.

**Steps to reproduce**
1. Start a long-running adapter run.
2. Send `SIGTERM` to the server.
3. See the run left without its final status, and an info-level timeout log with no run IDs.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #6712 drains live runs on shutdown with a fixed 5-second race and cancels them. This pull request supersedes its drain part with a configurable wait; it does not cancel runs. #14796 changes how a graceful shutdown is recorded, not the drain.

## What Changed

- The wait is configurable with `PAPERCLIP_SHUTDOWN_DRAIN_TIMEOUT_MS` or `server.shutdownDrainTimeoutMs` in the config file, from 1 ms to the largest timer delay (2147483647 ms). The default is 60 seconds. The environment variable wins over the config file. A value that is not a whole number in that range falls back to the config file value, then to the default.
- When the wait times out, the drain logs an error with the IDs of the runs that are still executing.
- After shutdown begins, no queued run starts in the process, whichever heartbeat service instance (scheduler or route) wakes it. The check runs before the start lock and again before each claim. The run stays queued and the next server start resumes it.
- `docs/deploy/environment-variables.md` documents the setting.
- Tests check the config default, the environment value, the config file key, invalid values, the error log, and that a wakeup through a second heartbeat service instance after shutdown began leaves the run queued on PostgreSQL.

## Verification

Head `db03108b7103453f2b691d0d24d9d5154fc03d3a`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/shutdown-waits-for-adapter-run-stops.test.ts, server/src/shutdown.test.ts) were run against the base's production code. 6 tests fail there. The config has no drain timeout, a wakeup after shutdown begins starts the run instead of leaving it queued, and the timeout is not logged as an error with the run IDs. On the head the same run gives: 24 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: graceful shutdown can now take up to 60 seconds by default instead of 5. Process supervisors with a shorter stop timeout (for example a 30-second container stop) kill the process first. The default is a maintainer decision; the variable lets an operator lower it.
- `server/src/shutdown.test.ts` now expects the timeout at error level with the pending run IDs.

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
