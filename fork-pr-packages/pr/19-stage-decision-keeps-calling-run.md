# fix(issues): do not cancel the calling run when recording a stage decision

| Field | Value |
| --- | --- |
| Branch | `pr/19-stage-decision-keeps-calling-run` |
| Head | `3ddbeec5efc44bbcddc627bbd4583eb3cb002db1` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(issues): do not cancel the calling run when recording a stage decision` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/issue-execution-policy-routes.test.ts` | +407 | -3 |
| `server/src/routes/issues.ts` | +25 | -8 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Review and approval participants are often agents that run in heartbeat runs.
> - A participant records its stage decision with `PATCH /api/issues/:id` from inside its own run.
> - The decision reassigns the issue, and the route then stopped the active issue run, which was the caller's own run.
> - So the decision request cancelled the run that was still executing it.
> - This pull request keeps the calling agent's own run when the request records a stage decision.
> - The benefit is that review and approval agents finish their runs normally.

## Linked Issues or Issue Description

No issue exists for the stage-decision case. Issue description (bug):

**What happened**
A reviewer agent approved a stage with `PATCH /api/issues/:id` from its heartbeat run. The route cancelled the active run of the issue, which was that same run.

**Expected behavior**
The calling agent's own run continues. Any other active run on the issue is still stopped.

**Steps to reproduce**
1. Configure an issue with a review stage whose participant is an agent.
2. Let the agent record `approved` or `changes_requested` from its run.
3. See its run cancelled.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related: issue #13730 and its open pull request #13782 fix the same self-cancel for a reassignment of the agent's own issue. #13834 keeps a review stage's run when the stage ends on a human. All three change the cancellation decision in `server/src/routes/issues.ts` for different cases. They are complementary; the second one to merge needs a rebase, and maintainers can combine the rules.

## What Changed

- When the request records a stage decision, the active run that belongs to the calling agent and matches its run id is kept.
- A run is kept only when it belongs to that agent, so a run id named by another agent or by a board actor never exempts a run. The run id comes from the agent's token when the `X-Paperclip-Run-Id` header is absent.
- Every other active run on the issue is still stopped.
- Route tests cover an approval decision, a changes-requested decision, another active run on the issue, and a missing run-id header.

## Verification

Head `3ddbeec5efc44bbcddc627bbd4583eb3cb002db1`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/issue-execution-policy-routes.test.ts) were run against the base's production code. 4 tests fail there. The route cancels the calling agent's own run. On the head the same run gives: 24 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: a stage decision from an agent run no longer cancels that run.

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
