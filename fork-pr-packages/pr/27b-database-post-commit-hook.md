# feat(db): run registered work after a transaction commits

| Field | Value |
| --- | --- |
| Branch | `pr/27b-database-post-commit-hook` |
| Head | `543fe50af04cbff9ca44c7b966cf77390b6981b4` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `feat(db): run registered work after a transaction commits` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `packages/db/src/client.ts` | +54 | -0 |
| `packages/db/src/index.ts` | +2 | -0 |
| `packages/db/src/post-commit-hooks.test.ts` | +108 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Server code often writes inside a database transaction.
> - Some of that code must act on the result only once it is durable, for example to publish an event about a status change.
> - Acting inside the transaction publishes changes that can still roll back, and acting after the call returns makes every caller thread the work out of the transaction.
> - This pull request adds post-commit hooks to the database package.
> - The benefit is that code can register work that runs only after a commit.

## Linked Issues or Issue Description

No issue exists. Issue description (feature):

**Problem or motivation**
Code inside a transaction cannot run work only after that transaction commits.

**Proposed solution**
`registerPostCommitHook(tx, hook)` registers work on a transaction of a `createDb` database. The hooks run after the top-level transaction commits.

**Alternatives considered**
Returning the work to each caller, which every call site would have to thread through.

**Roadmap alignment**
Infrastructure for existing features; it adds no new product area.

No related open pull request was found.

## What Changed

- `registerPostCommitHook(tx, hook)` registers work on a transaction of a `createDb` database. The hooks run in order after the top-level transaction commits.
- A hook registered in a nested transaction is dropped when that savepoint rolls back, and every hook is dropped when the top-level transaction rolls back.
- The function returns `false` outside a transaction, so the caller can run the work itself.
- A failing hook is reported with `console.error` and does not fail the committed transaction or stop the later hooks.
- `createDb` installs the tracking on every database it creates.
- Tests on PostgreSQL check that a hook sees the committed row from another connection, that rollback and savepoint rollback drop hooks, the failure handling, and the call outside a transaction.

## Verification

Head `543fe50af04cbff9ca44c7b966cf77390b6981b4`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (packages/db/src/post-commit-hooks.test.ts) were run against the base's production code. 5 tests fail there. `registerPostCommitHook` does not exist on the base. This is a new primitive, so no base behavior can fail for a different reason. On the head the same run gives: 5 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- No existing caller changes. The tracking wraps the `transaction` method of each `createDb` database.

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
