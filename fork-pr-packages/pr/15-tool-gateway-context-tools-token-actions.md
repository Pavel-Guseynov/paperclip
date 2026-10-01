# fix(tool-gateway): gate context tools and capabilities by token allowedActions

| Field | Value |
| --- | --- |
| Branch | `pr/15-tool-gateway-context-tools-token-actions` |
| Head | `6fdf1f6ce3593f1d1e74bf9aa2ab1fc9dd12c931` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-gateway): gate context tools and capabilities by token allowedActions` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/browser-use-connection.test.ts` | +1 | -1 |
| `server/src/__tests__/tool-gateway.test.ts` | +270 | -0 |
| `server/src/routes/tool-gateway.ts` | +57 | -23 |
| `server/src/services/native-runtime/assigned-mcp-tools.test.ts` | +9 | -6 |
| `server/src/services/native-runtime/assigned-mcp-tools.ts` | +2 | -2 |
| `server/src/services/native-runtime/paperclip-runner-tool-authority.test.ts` | +7 | -4 |
| `server/src/services/tool-gateway.ts` | +9 | -2 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - A named gateway token can limit its protocol actions, for example to `tools/list` and `tools/call`.
> - The gateway still advertised the resources and prompts capabilities on `initialize` and listed the four context tools on `tools/list`.
> - A call to those tools then failed with `gateway_token_action_denied`.
> - This pull request advertises a capability or a context tool only when the token allows its action.
> - The benefit is that a client sees only what it can use.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
A named gateway token limited to `tools/list` and `tools/call` saw `paperclip_list_resources`, `paperclip_read_resource`, `paperclip_list_prompts`, and `paperclip_get_prompt` on `tools/list`, and the resources and prompts capabilities on `initialize`. Calling them failed with `gateway_token_action_denied`.

**Expected behavior**
The gateway lists only the context tools and capabilities that the token's `allowedActions` permit.

**Steps to reproduce**
1. Create a named gateway token with `allowedActions: ["tools/list", "tools/call"]`.
2. Send `initialize` and `tools/list`.
3. See the resources and prompts capabilities and the four context tools.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull request: #14427 filters the same four context tools on `tools/list` by `allowedActions`. It does not change the `initialize` capabilities. This pull request supersedes #14427. If #14427 merges first, this pull request adds the capability gating on top of it.

## What Changed

- `initialize` advertises resources and prompts only when the token allows a matching action.
- `tools/list` includes a context tool only when the token allows its action.
- `listToolsForNamedGateway` returns `{ tools, allowedActions }` instead of an array of tools. Its two call sites read the new shape: the named gateway route and the native-runtime assigned MCP tools.
- A test on PostgreSQL checks the capabilities and the listed tools for a restricted and an unrestricted token.

## Verification

Head `6fdf1f6ce3593f1d1e74bf9aa2ab1fc9dd12c931`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/tool-gateway.test.ts) were run against the base's production code. 1 test fails there. `initialize` advertises resources and prompts to a token that allows neither. On the head the same run gives: 154 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- API change inside the server: `listToolsForNamedGateway` has a new return shape. Both call sites in this repository are updated. A plugin or fork that calls it must read `.tools`.
- Behavior change: a restricted token no longer sees the context tools it cannot call.

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
