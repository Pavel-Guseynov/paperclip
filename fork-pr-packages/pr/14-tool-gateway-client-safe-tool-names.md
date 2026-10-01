# fix(tool-gateway): assign client-safe tool names and keep legacy names working

| Field | Value |
| --- | --- |
| Branch | `pr/14-tool-gateway-client-safe-tool-names` |
| Head | `85d28bc44db4b7f0286a4c940549822c3c10b83f` |
| Base commit | `a213e96f2fa534281bdbdc6b51c8bb7f8567cb4d` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | `pr/16-tool-profile-tool-name-identity` |
| Proposed title | `fix(tool-gateway): assign client-safe tool names and keep legacy names working` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `packages/shared/src/types/tool-access.ts` | +1 | -0 |
| `server/src/__tests__/tool-gateway.test.ts` | +260 | -18 |
| `server/src/services/tool-access-policy.ts` | +4 | -1 |
| `server/src/services/tool-gateway.ts` | +121 | -8 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Connected MCP tools are exposed to agents as `mcp.<app>-<connection>:<tool>`.
> - MCP clients accept only letters, digits, `_`, and `-` in tool names, and some prefix the name with the server name under a 64-character limit.
> - So clients reject or rewrite these names.
> - This pull request exposes each connected tool under a short client-safe name and keeps the previous name working.
> - The benefit is that MCP clients can call connected tools, and existing calls and policies keep working.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
An MCP client rejected the gateway's tool list because names such as `mcp.linear-workspace:create_issue` contain `.` and `:`. Clients that prefix the server name exceeded their 64-character limit.

**Expected behavior**
Every connected tool has a name with only letters, digits, `_`, and `-`, short enough for a server-name prefix.

**Steps to reproduce**
1. Connect a remote MCP application.
2. Point an MCP client that validates tool names at a named gateway.
3. See the client reject or rename the tools.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #14017 shortens the same names under a 128-character limit but keeps `.` and `:`. This pull request supersedes #14017, because its names are both client-safe and within 40 characters. #12872 changes only the display label.

Stack: this pull request is based on `pr/16-tool-profile-tool-name-identity`. Pull request 16 makes the catalog tool name the identity of `tool_name` selectors and adds `connectedGatewayToolNames`, the derivation of the previous gateway names. This pull request renames the exposed tools, and it uses that derivation for the legacy name. Without pull request 16, every stored `tool_name` selector would compare against the renamed tools. Review and merge that pull request first.

## What Changed

- Each connected tool is exposed as `<app>_<tool>`, at most 40 characters, from the same slug rules for every connection.
- A second connection or catalog entry with the same name gets a connection suffix, then a catalog entry suffix.
- Names are claimed across every connected tool of the company, whatever its connection's state, oldest connection and oldest catalog entry first. Adding a connection or a tool never renames an existing tool, and a connection that becomes unhealthy or disabled keeps its names.
- A connected tool never takes a name the gateway uses for its own tools (`search_tools`, `run_tool`, and the four `paperclip_*` context tools).
- The previous name is kept as `legacyToolName`. A call by that name still resolves, and policy selectors and `tools:use` grant scopes stored under it still match.
- Tests on PostgreSQL list and call connected tools by the new name and by the legacy name, and check collisions, a name that stays when a second or unhealthy connection appears, reserved names, a policy and a grant scope stored under the legacy name, and the length limit.

## Verification

Head `85d28bc44db4b7f0286a4c940549822c3c10b83f`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`. Its base `a213e96f2fa534281bdbdc6b51c8bb7f8567cb4d` is the head of `pr/16-tool-profile-tool-name-identity`.

- Regression proof: the head's tests (server/src/__tests__/tool-gateway.test.ts) were run against the base's production code. 22 tests fail there. (Base: pull request 16.) the tools are listed under the old `mcp.<app>-<connection>:<tool>` names. On the head the same run gives: 91 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: agents see new tool names. Calls by the legacy name keep working.
- An action request that was approved for a call under the legacy name does not match a call under the new name. The caller requests approval again. This pull request does not relax the approval snapshot comparison.

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
