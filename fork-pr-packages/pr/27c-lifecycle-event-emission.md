# feat(server): log committed run and task status changes

| Field | Value |
| --- | --- |
| Branch | `pr/27c-lifecycle-event-emission` |
| Head | `4e285289ce29f2597421bd8cf46399b396489dd1` |
| Base commit | `d8ff9bc5625eab44006ff53dbc0354fe3e8cd611` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | `pr/27a-run-status-transition-authority + pr/27b-database-post-commit-hook` |
| Proposed title | `feat(server): log committed run and task status changes` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `doc/SPEC-implementation.md` | +5 | -0 |
| `server/src/__tests__/lifecycle-events.test.ts` | +127 | -0 |
| `server/src/services/heartbeat-run-lifecycle.ts` | +9 | -9 |
| `server/src/services/issues.ts` | +4 | -0 |
| `server/src/services/lifecycle-events.ts` | +101 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Operators want to follow when runs start, finish, or fail, and when tasks enter review.
> - Run and task status changes leave no record outside the database rows and the activity log, which has no previous status for most writers.
> - So an operator has to poll the database.
> - This pull request logs one structured record for each committed run and task status change, after the commit.
> - The benefit is that log pipelines can follow lifecycle changes without database access.

## Linked Issues or Issue Description

No issue exists. Issue description (feature):

**Problem or motivation**
An operator cannot follow run and task status changes from the logs, and the activity log does not carry the previous status for most writers.

**Proposed solution**
Log one structured record per committed status change, with the previous and new status taken at the transition, after the transaction commits.

**Alternatives considered**
Deriving the change from activity-log details, which do not carry the previous status reliably.

**Roadmap alignment**
This extends the completed activity log and run recovery work; it adds no new product area.

This is server log output (pino). It is not Telemetry, not an OpenTelemetry span, and not a run-log event.

No related open pull request was found.

Stack: this pull request is based on `pr/27a-run-status-transition-authority + pr/27b-database-post-commit-hook`. This head is based on a plain merge commit of pull requests 27a and 27b. It reads the transition that 27a returns and logs through the post-commit hook that 27b adds. Until both merge, this pull request also shows their commits. Review and merge that pull request first.

## What Changed

- Every heartbeat run transition from the status authority logs one record, "heartbeat run status changed", with the run, company, agent, task, previous and new status, whether the new status is terminal, the `clock_timestamp()` read under the row lock, and the transition's event ID.
- Every status change made through the issue update logs one record, "task status changed", with the task, the previous and new status read under the row lock, the assignee, and the acting run.
- Both records are logged through the server logger only after the transaction that made the change commits, through the post-commit hooks. A rolled-back change logs nothing. A write that keeps the status logs nothing, so entering review logs exactly one record.
- `doc/SPEC-implementation.md` lists the records under logging.
- Tests on PostgreSQL check one record after commit and none before, none for a rolled-back or same-status write, exactly one record on review entry, and unique event IDs.

## Verification

Head `4e285289ce29f2597421bd8cf46399b396489dd1`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`. Its base `d8ff9bc5625eab44006ff53dbc0354fe3e8cd611` is the head of `pr/27a-run-status-transition-authority + pr/27b-database-post-commit-hook`.

- Regression proof: the head's tests (server/src/__tests__/lifecycle-events.test.ts) were run against the base's production code. 3 tests fail there. (Base: the merge of 27a and 27b.) no record is logged. The rollback and same-status tests pass on both. On the head the same run gives: 5 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Task records cover status changes made through `issueService.update`. Other code paths that write an issue status directly do not log a record yet.
- The activity log is unchanged. Its timestamps still come from the existing column defaults, not from `clock_timestamp()`. Only the lifecycle record carries the `clock_timestamp()` that the transition reads under the row lock.
- Log volume grows by one line per status change.

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
