# fix(workspace-runtime): recreate managed worktree directories no longer registered in git

| Field | Value |
| --- | --- |
| Branch | `fix/recreate-unregistered-managed-worktree` |
| Head | `97f49f85153bcdeaa1a038a3f359460eeaf049ac` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(workspace-runtime): recreate managed worktree directories no longer registered in git` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/workspace-runtime.test.ts` | +40 | -30 |
| `server/src/services/workspace-runtime.ts` | +30 | -15 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The `git_worktree` workspace runtime realizes isolated task worktrees under Paperclip's managed worktrees directory.
> - When a managed worktree directory still exists on disk (for example after an interrupted cleanup or manual `git worktree prune`) but is no longer registered in `git worktree list`, `realizeGitWorktree` refused the path and threw `already exists and is not a reusable git worktree`.
> - That left the task unable to start any run without manual filesystem cleanup on the host.
> - This pull request removes an unregistered directory inside the managed worktree root, records the removal as a `worktree_prepare` operation, and recreates the worktree on the task branch.
> - The benefit is that managed task worktrees self-heal cleanly when git's worktree registry and the managed directory drift out of sync.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
When a managed worktree directory existed on disk but was no longer listed in `git worktree list`, workspace setup failed with `already exists and is not a reusable git worktree`.

**Expected behavior**
If the path is inside Paperclip's managed worktree root and is not registered in `git worktree list`, Paperclip removes the stale directory, records a `worktree_prepare` operation, and recreates the worktree on the task branch.

**Steps to reproduce**
1. Create a task worktree under the managed worktrees root.
2. Remove its registration from `.git/worktrees` (or run `git worktree prune` after moving metadata) while leaving the directory on disk.
3. Run workspace realization for the task and observe setup fail with `already exists and is not a reusable git worktree`.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- In `server/src/services/workspace-runtime.ts`, when a managed `git_worktree` target path exists on disk but is absent from `git worktree list`, Paperclip removes the stale directory, records the cleanup as a `worktree_prepare` operation, and recreates the worktree attached to the task branch.
- Paths outside the managed worktree root keep the existing safety rejection.
- A regression test in `server/src/__tests__/workspace-runtime.test.ts` creates an unregistered managed worktree directory and verifies that realization removes it, records `worktree_prepare`, and re-attaches the existing task branch.

## Verification

Head `97f49f85153bcdeaa1a038a3f359460eeaf049ac`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/workspace-runtime.test.ts`) were run against the base's production code. 1 test fails there. On the base `realizeGitWorktree` fails with `already exists and is not a reusable git worktree` when a managed worktree directory is absent from `git worktree list`. On the head the same run gives: 88 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Only directories inside Paperclip's managed worktree root that `git worktree list` does not register are removed; user-owned checkouts outside the managed root are never deleted.

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
