# feat(heartbeat): attribute cancelled runs in their lifecycle record

| Field | Value |
| --- | --- |
| Branch | `pr/27d-cancellation-attribution` |
| Head | `fd986357fc8d5f3cc4db5e721961073e5f581f57` |
| Base commit | `4e285289ce29f2597421bd8cf46399b396489dd1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | `pr/27c-lifecycle-event-emission` |
| Proposed title | `feat(heartbeat): attribute cancelled runs in their lifecycle record` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `doc/SPEC-implementation.md` | +3 | -1 |
| `server/src/__tests__/heartbeat-run-cancellation-attribution.test.ts` | +95 | -0 |
| `server/src/services/lifecycle-events.ts` | +28 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - A run can be cancelled by a board Stop, a reassignment, an agent pause, a discarded queued message, or a lost controller lease.
> - The run lifecycle record of a cancellation said only that the run moved to `cancelled`.
> - So an operator could not tell why.
> - This pull request adds the cause and the requester, read from the committed run row, to that record.
> - The benefit is that cancellations can be explained from the logs.

## Linked Issues or Issue Description

No issue exists. Issue description (feature):

**Problem or motivation**
A cancelled run's lifecycle record does not say who or what cancelled it.

**Proposed solution**
The record of a transition to `cancelled` carries the run's error code, the error message, and the requester that the cancel path recorded.

**Alternatives considered**
A new `cancel_source` column on `heartbeat_runs`, threaded through every cancel path. The run row already holds the cause in `errorCode`.

**Roadmap alignment**
This extends the completed activity log and action attribution milestone.

Related open pull request: #4510 adds a `cancel_source` column for the same purpose. This pull request needs no schema change because every cancel path already sets the run's error code. It supersedes #4510 for lifecycle attribution.

Stack: this pull request is based on `pr/27c-lifecycle-event-emission`. This pull request adds a field to the run lifecycle record that pull request 27c adds. Review and merge that pull request first.

## What Changed

- The record of a transition to `cancelled` carries a `cancellation` object: the run's error code (the cause the cancel path recorded, or null when it recorded none), the error message, and the requester when the cancel path recorded one, which is the board user of a Stop or the actor of a comment interrupt.
- Every value comes from the committed run row. No cancel path changes.
- `doc/SPEC-implementation.md` mentions the attribution.
- Tests on PostgreSQL stop a run through the board route and pause its agent, and check the attribution in each record.

## Verification

Head `fd986357fc8d5f3cc4db5e721961073e5f581f57`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`. Its base `4e285289ce29f2597421bd8cf46399b396489dd1` is the head of `pr/27c-lifecycle-event-emission`.

- Regression proof: the head's tests (server/src/__tests__/heartbeat-run-cancellation-attribution.test.ts) were run against the base's production code. 2 tests fail there. (Base: pull request 27c.) the cancellation record has no `cancellation` object. On the head the same run gives: 2 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- A cancel path that records no requester produces a record without one.

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
