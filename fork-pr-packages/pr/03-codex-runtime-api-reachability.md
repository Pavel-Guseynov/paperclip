# fix(runtime): use the internal API origin for agent callbacks

| Field | Value |
| --- | --- |
| Branch | `pr/03-codex-runtime-api-reachability` |
| Head | `6d2f7c7c1f1b34a6cfdc5f5897fd7b15d98e76fd` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(runtime): use the internal API origin for agent callbacks` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `cli/src/__tests__/common.test.ts` | +5 | -0 |
| `cli/src/commands/client/common.ts` | +1 | -0 |
| `doc/AGENT-ARTIFACTS.md` | +2 | -1 |
| `doc/CLI.md` | +9 | -4 |
| `docs/deploy/environment-variables.md` | +2 | -0 |
| `packages/adapter-utils/src/execution-target-sandbox.test.ts` | +7 | -0 |
| `packages/adapter-utils/src/execution-target.ts` | +2 | -0 |
| `packages/adapter-utils/src/server-utils.test.ts` | +45 | -0 |
| `packages/adapter-utils/src/server-utils.ts` | +8 | -5 |
| `packages/adapters/claude-local/src/server/execute.acp-fallback.test.ts` | +20 | -0 |
| `packages/adapters/claude-local/src/server/execute.ts` | +5 | -2 |
| `packages/adapters/codex-local/src/server/execute.runtime-callback.test.ts` | +200 | -0 |
| `packages/adapters/codex-local/src/server/execute.ts` | +10 | -1 |
| `packages/adapters/cursor-cloud/src/server/execute.test.ts` | +5 | -0 |
| `packages/adapters/cursor-cloud/src/server/execute.ts` | +3 | -0 |
| `server/src/__tests__/cloud-runtime-identity.test.ts` | +19 | -0 |
| `server/src/__tests__/file-delivery-bridges.test.ts` | +27 | -0 |
| `server/src/__tests__/heartbeat-runtime-mcp-servers.test.ts` | +10 | -1 |
| `server/src/__tests__/server-startup-feedback-export.test.ts` | +45 | -0 |
| `server/src/index.ts` | +13 | -1 |
| `server/src/runtime-api.ts` | +8 | -0 |
| `server/src/services/cloud-runtime-identity.ts` | +6 | -0 |
| `server/src/services/heartbeat.ts` | +18 | -5 |
| `skills/paperclip/scripts/paperclip-upload-artifact.sh` | +4 | -3 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Agent processes call back into the Paperclip API from adapters, the CLI, and the artifact helper.
> - An operator can serve the dashboard through a tunnel or a tailnet-only hostname that agent processes cannot resolve.
> - Callbacks then fail, because they dial `PAPERCLIP_API_URL`, the public origin.
> - This pull request gives agents an internal callback origin, `PAPERCLIP_RUNTIME_API_URL`, that an operator can pin, and makes every callback path use it.
> - The benefit is that agents keep working when the public origin is unreachable from where they run.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
With the dashboard served through a tunnel hostname, Codex managed MCP calls, CLI calls from agents, and `paperclip-upload-artifact.sh` dialed that hostname from the agent process and failed.

**Expected behavior**
Agent callbacks use an origin that the agent process can reach. An operator can pin it.

**Steps to reproduce**
1. Set `PAPERCLIP_API_URL` to a public tunnel URL that the host itself cannot resolve.
2. Run a Codex agent that uses managed MCP tools.
3. See the MCP and API calls fail with a DNS or connection error.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any mode where the public URL differs from the internal one.

Related open pull requests that address the same reachability problem with other mechanisms: #14801 (opt-in local API listener), #12037 (separate internal runtime URL for local adapters), and #11564 (probe and rank allowed hostnames). This pull request does not depend on them. It supersedes #12037 and #11564 for the callback origin, because it covers the adapters, the CLI, and the artifact helper with one variable. If maintainers choose the #14801 design, this pull request should fold into it. Older related pull requests: #14525, #10517, #9916, #9228, and #12886.

## What Changed

- Server boot honors a pre-set `PAPERCLIP_RUNTIME_API_URL` as the internal callback origin and puts it first in the runtime API candidates. Without a pin, `PAPERCLIP_RUNTIME_API_URL` equals the configured `PAPERCLIP_API_URL`, and a Cloud identity claim moves both to the claimed origin. A pinned origin stays.
- `buildPaperclipEnv` exports `PAPERCLIP_RUNTIME_API_URL` next to `PAPERCLIP_API_URL`. Sandbox bridges set both to their in-target origin.
- Codex managed MCP endpoints, the Paperclip runtime MCP servers, and runtime tool access use the internal origin. The Codex and Claude network allowlists trust it.
- `cursor_cloud` drops `PAPERCLIP_RUNTIME_API_URL` together with `PAPERCLIP_API_URL` when it has no usable key.
- The CLI and `skills/paperclip/scripts/paperclip-upload-artifact.sh` prefer `PAPERCLIP_RUNTIME_API_URL`.
- `docs/deploy/environment-variables.md`, `doc/CLI.md`, and `doc/AGENT-ARTIFACTS.md` describe the variable and the resolution order.
- Tests cover server boot with and without a pin, the Cloud claim with and without a pin, `buildPaperclipEnv`, the sandbox bridges, the Codex MCP config and allowlist, the Claude allowlist, `cursor_cloud`, the CLI order, and an artifact upload through the internal origin while the public origin is unreachable.

## Verification

Head `6d2f7c7c1f1b34a6cfdc5f5897fd7b15d98e76fd`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (adapter-utils, claude-local, codex-local, cursor-cloud, CLI and server tests) were run against the base's production code. 20 tests fail there. The adapter environment, the sandbox bridges, the Codex MCP config, the Claude and Codex allowlists, the CLI, server boot, and the Cloud claim do not expose or use `PAPERCLIP_RUNTIME_API_URL` (for example `expected undefined to be 'http://10.0.0.5:3100'`). On the head the same run gives: 352 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: without a pin, `PAPERCLIP_RUNTIME_API_URL` now equals the configured `PAPERCLIP_API_URL`. Before, it was the URL derived from `authPublicBaseUrl`. A process that inherits the server environment (where `PAPERCLIP_API_URL` is removed) now falls back to the configured API URL.
- A pinned origin must be reachable from every agent process. The public API URL stays in the candidate list.
- Inside an agent process the CLI prefers `PAPERCLIP_RUNTIME_API_URL` over `PAPERCLIP_API_URL`, so a `PAPERCLIP_API_URL` set by hand in that environment no longer changes the CLI target. `--api-base` still overrides both.
- The other adapters' prompt text still names `PAPERCLIP_API_URL` (for example the curl examples of the Gemini, Grok, and Kimi adapters). With a pin, those examples dial the public origin. They are unchanged here and can follow in a separate change.

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
