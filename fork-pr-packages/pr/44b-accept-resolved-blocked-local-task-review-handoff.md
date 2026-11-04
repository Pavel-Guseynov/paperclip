# fix(server): accept resolved-blocked local tasks into native review

| Field | Value |
| --- | --- |
| Branch | `fix/accept-resolved-blocked-local-task-review-handoff` |
| Head | `a73f37e9b27c134639586405e1c1eed7c469d50a` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(server): accept resolved-blocked local tasks into native review` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/issue-local-task-review-handoff-routes.test.ts` | +198 | -0 |
| `server/src/routes/issues.ts` | +70 | -0 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When a human-owned local task (`assigneeUserId` set, no `assigneeAgentId`) has an execution policy with a review or approval stage, the human operator hands the finished task into native review by patching `status: "done"` with `comment` and `unblockDescriptor: null` (or after resolving a previous `blocked` state).
> - In `server/src/routes/issues.ts`, the completion-entry guard rejected `status: "done"` when the issue was in `blocked` status or carried a stale `unblockDescriptor` before the handoff transition could clear it and advance into the review stage.
> - This pull request admits a board-owned local task from `in_progress`, `todo`, or resolved `blocked` into its configured review/approval stage when `status: "done"` is submitted with a handoff comment and no active blocker remains.
> - The benefit is that human-owned local tasks that were previously blocked can enter the native review and committer workflow cleanly once their blocker is resolved.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
When a human-owned local task with an execution policy was in `blocked` status (or had a resolved blocker) and the board operator patched `status: "done"` with `unblockDescriptor: null` and a handoff comment to enter native review, `PATCH /api/issues/:id` rejected the transition instead of clearing the resolved blocker and advancing into the first review stage.

**Expected behavior**
A board-owned local task with an execution policy and a handoff comment can transition to `done` (entering `in_review` on the first configured stage) when `unblockDescriptor` is cleared or absent, while still rejecting transitions that leave an active blocker or lack an execution policy stage.

**Steps to reproduce**
1. Create a board-assigned local task (`assigneeUserId` set) with a review stage in its execution policy, and mark it `blocked` with an `unblockDescriptor`.
2. Patch `status: "done"`, `unblockDescriptor: null`, and a handoff `comment` as the board owner.
3. Observe the route reject the review handoff on master.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `server/src/routes/issues.ts` allows a board-owned local task with an execution policy to enter native review on `status: "done"` when any prior `blocked` state is cleared (`unblockDescriptor: null`) and a handoff comment is provided, while still rejecting unresolved blockers, active agent runs, or missing review stages.
- `server/src/__tests__/issue-local-task-review-handoff-routes.test.ts` tests resolved-blocked local task review admission and all rejection guards against PostgreSQL.

## Verification

Head `a73f37e9b27c134639586405e1c1eed7c469d50a`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/issue-local-task-review-handoff-routes.test.ts`) were run against the base's production code. 4 tests fail there. On the base `PATCH /api/issues/:id` rejects a resolved-blocked local task's `status: "done"` review handoff. On the head the same run gives: 8 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Rejection guards for agent-owned tasks, unresolved `blocked` issues, active execution runs, and missing review stages remain enforced.

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
