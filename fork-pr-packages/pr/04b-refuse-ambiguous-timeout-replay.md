# fix(tool-access): refuse idempotent replay of an ambiguous timed-out write

| Field | Value |
| --- | --- |
| Branch | `pr/04b-refuse-ambiguous-timeout-replay` |
| Head | `75300f36c3c0394f264172c603e70e87f7a6f2c2` |
| Base commit | `59442b8551f90ff4329dd90cd20b2f53ffa08cc1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | `pr/04-remote-mcp-timeout-health` |
| Proposed title | `fix(tool-access): refuse idempotent replay of an ambiguous timed-out write` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/remote-mcp-timeout-health.test.ts` | +212 | -3 |
| `server/src/services/tool-access-policy.ts` | +43 | -1 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Tool calls through the gateway can carry an idempotency key, and a repeated key replays the stored invocation.
> - A call that times out is abandoned with an unknown outcome. It can already have changed state upstream.
> - A later call with the same key returned the stored timed-out invocation as an ordinary replay, so the caller could treat an unknown write as settled.
> - This pull request refuses that replay for calls that can change state.
> - The benefit is that a caller must confirm the outcome before it retries a write.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
After a write tool call timed out, a second call with the same idempotency key returned the timed-out invocation as `replayed`. The caller could not tell that the write outcome was unknown.

**Expected behavior**
The replay is refused with `409` and `ambiguous_invocation_timeout`. Reads and low-risk calls keep the ordinary replay.

**Steps to reproduce**
1. Call a write tool on a remote MCP connection with an idempotency key, and let the call time out.
2. Call it again with the same key.
3. See the stored timed-out invocation returned as a replay.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf` with pull request 04 applied.

**Deployment mode**
Any.

Related open pull requests in the same function: #12835 replays stored failed invocations instead of asking for approval again, and #13024 adds a gateway scope check (`idempotency_gateway_mismatch`) to the replay. Neither refuses a timed-out write. These changes are independent; the second one to merge needs a small rebase.

Stack: this pull request is based on `pr/04-remote-mcp-timeout-health`. With pull request 04, a timed-out remote MCP connection stays callable, so a replay with the same idempotency key reaches the stored timed-out invocation at once. On master the connection is hidden after a timeout and the replay ends with `404`. The tests also use the remote MCP test file that pull request 04 adds. Review and merge that pull request first.

## What Changed

- When the stored invocation timed out and its risk level can change state (write, destructive, medium, high, critical, or not recorded), the policy service refuses the replay with `409 ambiguous_invocation_timeout`.
- Reads and low-risk calls keep the ordinary replay.
- The risk check reads the stored invocation, because the idempotency key is unique per company and not per tool.
- The `409` details name the tool of the stored invocation.
- Tests on PostgreSQL time out a call through the gateway and replay it: a write, a read, a read tool named on a write's key, a low-risk call, and a call with no recorded risk level.

## Verification

Head `75300f36c3c0394f264172c603e70e87f7a6f2c2`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`. Its base `59442b8551f90ff4329dd90cd20b2f53ffa08cc1` is the head of `pr/04-remote-mcp-timeout-health`.

- Regression proof: the head's tests (server/src/__tests__/remote-mcp-timeout-health.test.ts) were run against the base's production code. 3 tests fail there. (Base: pull request 04.) the timed-out write is returned as `replayed` instead of `409`. On the head the same run gives: 17 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: a client that retried a timed-out write with the same idempotency key now gets `409` and must use a new key after it confirms the outcome.
- An invocation with no recorded risk level is treated as able to change state.

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
