# fix(workspace-runtime): serialize per-repo git worktree mutations and configure explicit upstream tracking

| Field | Value |
| --- | --- |
| Branch | `fix/concurrent-worktree-realization` |
| Head | `e95ba1d66d8b5b65d833bc0dde156e8911f1ae3e` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(workspace-runtime): serialize per-repo git worktree mutations and configure explicit upstream tracking` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/workspace-runtime.test.ts` | +340 | -13 |
| `server/src/services/workspace-runtime.ts` | +141 | -63 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When multiple agent runs start or clean up task worktrees against the same repository at the same time, concurrent `git worktree` and `git config` subprocesses race on `.git/config.lock` and worktree metadata.
> - In addition, `git worktree add -b <branch> <path> <remote>/<base>` sets implicit upstream tracking pointing the new task branch's `branch.<name>.merge` at `refs/heads/<base>` instead of the task branch itself (`refs/heads/<branch>`), or leaves partial tracking if interrupted.
> - This pull request serializes worktree realization, restoration, and cleanup through an in-process queue keyed by canonical `repoRoot`, passes `--no-track` on fresh branch creation, configures explicit `branch.<name>.remote` and `branch.<name>.merge` transactionally (rolling back on failure), and repairs missing/partial upstream config on existing owned branches.
> - The benefit is that concurrent worktree starts on the same repository never fail with lock collisions and every task branch gets deterministic upstream tracking.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
Concurrent runs realizing or cleaning up worktrees in the same repository raced on Git locks and config writes, and newly created task branches inherited implicit tracking to the base branch ref (`refs/heads/main`) or partial tracking when interrupted.

**Expected behavior**
Worktree mutations for the same canonical `repoRoot` serialize through a per-repository queue while different repositories run in parallel, fresh branches disable implicit tracking (`--no-track`) and configure explicit upstream remote/merge transactionally with rollback on failure, and existing branches repair missing or partial upstream config while preserving recorded ownership.

**Steps to reproduce**
1. Trigger two concurrent `realizeExecutionWorkspace` calls for different tasks sharing the same local git repository and remote base ref.
2. Observe concurrent `git worktree` / `git config` mutations race and inspect `branch.<task>.merge` on the created branch.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `server/src/services/workspace-runtime.ts` serializes worktree realization, persisted-worktree restoration, and Git cleanup per canonical `repoRoot` (resolved via `resolvePathForWorktreeComparison`), releasing the queue slot on both success and failure while allowing different repositories to run concurrently.
- Fresh task-branch creation passes `--no-track` to `git worktree add` and explicitly sets `branch.<branch>.remote` and `branch.<branch>.merge = refs/heads/<branch>` inside the repository queue, rolling back the newly created worktree and branch if upstream configuration fails (surfacing both errors via `AggregateError` if rollback also fails).
- Existing worktrees repair missing or partial `remote`/`merge` configuration before returning, while preserving complete upstream configuration and recorded `createdByRuntime` ownership metadata.
- Eleven regression tests in `server/src/__tests__/workspace-runtime.test.ts` cover symlinked `repoRoot` aliases, concurrent starts, missing/partial/complete upstream tracking, transactional rollback, `AggregateError` reporting, independent repositories, owned-branch recreation, and unavailable remote base refs.

## Verification

Head `e95ba1d66d8b5b65d833bc0dde156e8911f1ae3e`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/workspace-runtime.test.ts`) were run against the base's production code. 11 tests fail there. On the base concurrent worktree realizations against the same repository overlap without serialization and `git worktree add -b <branch> <path> <remote>/<base>` leaves implicit tracking to `<base>` instead of `refs/heads/<branch>`. On the head the same run gives: 99 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Worktree git operations on the same canonical repository now execute sequentially within one server process; worktrees in different repositories continue to realize in parallel.

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
