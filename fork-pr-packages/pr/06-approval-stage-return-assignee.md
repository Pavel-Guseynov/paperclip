# fix(server): honor approval-stage returnAssignee participant selection

| Field | Value |
| --- | --- |
| Branch | `pr/06-approval-stage-return-assignee` |
| Head | `41a994f6aeca973a63dc79bbefd914d1660af6fc` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(server): honor approval-stage returnAssignee participant selection` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/issue-execution-policy-routes.test.ts` | +198 | -2 |
| `server/src/__tests__/issue-execution-policy.test.ts` | +500 | -0 |
| `server/src/services/issue-execution-policy.ts` | +148 | -48 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - An issue can run through review and approval stages, each with its own participants.
> - When a stage approves with a comment, Paperclip picks a participant for the next stage and excludes the return assignee.
> - When the next approval stage names only the return assignee, the selection is empty and the approval fails with `422`. Entering the workflow fails the same way for such a stage.
> - The workflow-start path auto-skips a review stage that only the return assignee could take; the approval path did not.
> - This pull request lets an approval stage fall back to the return assignee, and reuses the start-path review-stage skip on the approval path.
> - The benefit is that a valid workflow does not stop at `422`.

## Linked Issues or Issue Description

Fixes #4912.

#4912 suggests skipping such an approval stage. This pull request does not skip it: skipping would bypass an approval gate that the policy names. The named approver, here the return assignee, approves instead. A review stage that only the return assignee could take is skipped, as on the start path. If maintainers prefer the skip, the change is in `selectEligibleStageParticipant` and `canAutoSkipPendingStage`.

Related open pull requests:

- #5951 removes the return-assignee exclusion from one participant selection in the approved branch. This pull request supersedes #5951: it keeps the exclusion for review stages, and it applies the same skip traversal as the start path.
- #10960 rejects, when a policy is saved, approval stages whose only participant is excluded. That is a different answer to the same case: this pull request keeps such policies usable. Maintainers choose one. They do not conflict in code.
- #7967 and #4429 change the same selection function for other cases.

## What Changed

- An approval stage falls back to the return assignee when the exclusion leaves nobody, on workflow start and on approval. Another approver named on the stage is still selected first. A review stage keeps the exclusion.
- The approval path uses the same review-stage skip traversal as the workflow-start path, through one shared stage-assignment resolver. One approval lands on one assignable stage or completes the workflow.
- Tests cover the transition logic and the `PATCH /api/issues/:id` route: return-assignee selection, a skipped self-review stage, consecutive skipped stages, and the first entry into an approval stage.

## Verification

Head `41a994f6aeca973a63dc79bbefd914d1660af6fc`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/issue-execution-policy.test.ts, server/src/__tests__/issue-execution-policy-routes.test.ts) were run against the base's production code. 6 tests fail there. The approval returns `422` instead of `200`, and the transitions select no participant. On the head the same run gives: 102 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: the return assignee can now be selected for an approval stage when nobody else is configured, on workflow start and after an approval. A review stage still never selects the return assignee.
- Re-selecting a participant after a policy edit, and an active stage without a recorded participant, keep the exclusion as on master.

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
