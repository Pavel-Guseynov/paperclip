# fix(conversation): let adapters declare conversation continuation

| Field | Value |
| --- | --- |
| Branch | `pr/20-conversation-continuation` |
| Head | `e87308807e927bac4fead199e6a921439ea39aa4` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(conversation): let adapters declare conversation continuation` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `packages/adapter-utils/src/types.ts` | +2 | -0 |
| `server/src/__tests__/conversation-continuation.test.ts` | +153 | -0 |
| `server/src/__tests__/server-startup-feedback-export.test.ts` | +30 | -0 |
| `server/src/index.ts` | +2 | -0 |
| `server/src/services/conversation-continuation.ts` | +18 | -3 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Some adapters resume their session across turns, so a lost run can continue the conversation instead of starting over.
> - Conversation continuation was limited to the built-in adapter types in `CONVERSATION_ADAPTER_TYPES`.
> - An external adapter that resumes its session had no way to opt in, so a lost run was held for board reconciliation.
> - This pull request adds an adapter capability, `supportsConversationContinuation`, that recovery reads.
> - The benefit is that external adapters get the same continuation as built-in ones.

## Linked Issues or Issue Description

No issue exists. Issue description (feature):

**Problem or motivation**
A lost run of an external adapter that resumes its session was held for board reconciliation, because only built-in adapter types could continue a conversation.

**Proposed solution**
`ServerAdapterModule` gets an optional `supportsConversationContinuation` flag. Recovery treats every registered adapter that sets it like the built-in conversation adapters.

**Alternatives considered**
Adding external adapter types to the built-in list. That couples core to each external adapter.

**Roadmap alignment**
This extends the completed bounded run recovery and plugin adapter work; it adds no new product area.

No related open pull request was found.

## What Changed

- `ServerAdapterModule` gets an optional `supportsConversationContinuation` capability.
- `isConversationAdapter` and the run predicate used by recovery and the execution blocker include every registered adapter that declares it, read through the active adapter registration (a paused external override falls back to its built-in adapter). The built-in list is unchanged.
- Startup recovery waits for external adapters to register before it reaps orphaned runs, so a lost run of a declaring external adapter is continued after a restart.
- A test reaps a lost run through the heartbeat service for a registered adapter that declares the capability. The run is stamped with `continue_conversation_v1`, the issue is not blocked, and one continuation run is queued. A second adapter without the declaration is not stamped. A startup test checks that the reap waits for external adapters.

## Verification

Head `e87308807e927bac4fead199e6a921439ea39aa4`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (server/src/__tests__/conversation-continuation.test.ts) were run against the base's production code. 1 test fails there. The lost run of the declaring adapter is not stamped for continuation (`stopReason: process_lost`). The control test passes on both. On the head the same run gives: 24 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- An adapter that declares the capability but cannot resume a session would get continuation runs that start fresh. The flag is opt-in.

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
