# fix(tool-access): use the catalog tool name as the tool_name selector identity

| Field | Value |
| --- | --- |
| Branch | `pr/16-tool-profile-tool-name-identity` |
| Head | `a213e96f2fa534281bdbdc6b51c8bb7f8567cb4d` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-access): use the catalog tool name as the tool_name selector identity` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/server-startup-feedback-export.test.ts` | +5 | -0 |
| `server/src/__tests__/tool-gateway.test.ts` | +184 | -25 |
| `server/src/index.ts` | +8 | -0 |
| `server/src/services/index.ts` | +1 | -0 |
| `server/src/services/tool-access-policy.ts` | +1 | -1 |
| `server/src/services/tool-gateway.ts` | +35 | -11 |
| `server/src/services/tool-profile-migration.ts` | +163 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Tool profiles allow or deny tools with selectors, and a `tool_name` selector stores a catalog tool name such as `query`.
> - The profile summary compares it with the catalog tool name, but the gateway policy matcher compared it with the connection-scoped gateway name `mcp.<app>-<connection>:<tool>`.
> - So an entry written through the profile UI never matched at the gateway, and deny-by-default profiles blocked the tools they allowed.
> - This pull request makes the catalog tool name the one identity, and converts stored entries that hold a gateway name.
> - The benefit is that profiles mean the same thing in the UI and at the gateway.

## Linked Issues or Issue Description

Fixes #11372.

No related open pull request was found.

## What Changed

- The policy matcher compares a `tool_name` entry with the request's upstream (catalog) tool name. Tools without one (built-in and plugin tools) fall back to the request tool name.
- A startup migration converts each stored `tool_name` entry that holds a gateway name into `catalog_entry` entries for the catalog entries that the name identifies, so its grant keeps the original connection scope. It covers the `mcp.`/`app.` names of connected tools and the `slack-bot.`/`github-bot.` names of chat bot tools, derived the way the gateway derives them (`connectedGatewayToolNames`) from the entries it can expose.
- It matches only exact names. When two exposable entries share a name, an exclude entry excludes both (fail closed), and an include entry is left unchanged and counted. Catalog names, built-in names, and unknown names stay unchanged. It writes only if the row still holds the name it read. It returns the scanned, migrated, and unresolved counts, and server start logs them.
- Tests on PostgreSQL check the matcher on every surface (tool lists, calls, the on-demand `run_tool`) and the migration: names read from the gateway output, a chat bot name, an inactive duplicate, ambiguous include and exclude entries, catalog and built-in names, an unknown name, the converted grant's connection scope, and a second run that changes nothing.

## Verification

Head `a213e96f2fa534281bdbdc6b51c8bb7f8567cb4d`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/tool-gateway.test.ts) were run against the base's production code. 5 tests fail there. A `tool_name` entry with the catalog name matches no tool at the gateway, and the stored gateway-name entries stay unconverted. On the head the same run gives: 105 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Data change at server start: matched entries change from `tool_name` to `catalog_entry`. No row gets a name that matches no catalog entry. The migration is idempotent.
- Behavior change: a `tool_name` entry now matches by catalog name at the gateway, so a deny-by-default profile allows the tools it lists.

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
