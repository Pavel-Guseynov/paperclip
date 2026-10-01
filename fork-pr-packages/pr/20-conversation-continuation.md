# fix(conversation): let adapters declare conversation continuation

| Field | Value |
| --- | --- |
| Branch | `pr/20-conversation-continuation` |
| Head | `f50e8f96ace3595e67cc6da2cd6a14b8cfc7b88b` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(conversation): let adapters declare conversation continuation` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `packages/adapter-utils/src/types.ts` | +8 | -0 |
| `server/src/__tests__/conversation-continuation.test.ts` | +154 | -0 |
| `server/src/__tests__/server-startup-feedback-export.test.ts` | +30 | -0 |
| `server/src/index.ts` | +4 | -0 |
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

Head `f50e8f96ace3595e67cc6da2cd6a14b8cfc7b88b`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/conversation-continuation.test.ts) were run against the base's production code. 1 test fails there. The lost run of the declaring adapter is not stamped for continuation (`stopReason: process_lost`). The control test passes on both. On the head the same run gives: 24 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- An adapter that declares the capability but cannot resume a session would get continuation runs that start fresh. The flag is opt-in.

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
