# fix(codex-local): set default_tools_approval_mode to approve on managed MCP servers

| Field | Value |
| --- | --- |
| Branch | `fix/codex-managed-mcp-approvals` |
| Head | `30a9615043da7f44beb5f8426ec51edb7c3165db` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(codex-local): set default_tools_approval_mode to approve on managed MCP servers` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `README.md` | +12 | -0 |
| `doc/execution-semantics.md` | +7 | -0 |
| `packages/adapters/codex-local/src/server/codex-home.test.ts` | +28 | -0 |
| `packages/adapters/codex-local/src/server/codex-home.ts` | +1 | -0 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The Codex local adapter writes Paperclip-managed MCP gateway entries into the agent's Codex configuration (`codex-home.ts`).
> - When Codex runs non-interactively with `approval_policy = 'never'`, Codex's own client-side tool approval check refuses write tool calls on MCP servers that do not set `default_tools_approval_mode = 'approve'`, before the request ever reaches Paperclip's governed tool gateway.
> - That client-side refusal prevents Paperclip's tool gateway from evaluating company policies or creating a human approval card on the issue thread.
> - This pull request sets `default_tools_approval_mode = 'approve'` on every Paperclip-managed MCP server entry in the managed configuration block while leaving unmanaged user MCP entries untouched.
> - The benefit is that governed MCP calls reach Paperclip's tool gateway, which remains the single authority for policy enforcement, denials, and human approval cards.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
Under `approval_policy = "never"`, Codex refused MCP write tool calls locally before sending them to Paperclip's managed MCP gateway, so Paperclip could neither allow policy-permitted calls nor create human approval cards for review-gated calls.

**Expected behavior**
Paperclip-managed MCP server entries in Codex's configuration set `default_tools_approval_mode = "approve"` so tool calls reach the governed Paperclip gateway, while unmanaged MCP server entries keep their user-configured approval mode.

**Steps to reproduce**
1. Configure a Codex agent with a Paperclip-managed MCP gateway and `approval_policy = "never"`.
2. Invoke a write tool through the managed MCP server.
3. Observe Codex refuse the tool call locally before contacting the Paperclip gateway.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `packages/adapters/codex-local/src/server/codex-home.ts` writes `default_tools_approval_mode = "approve"` on every Paperclip-managed MCP server entry (including `paperclip-assigned` and collision-renamed gateway entries) inside the managed config block.
- Updating or removing the managed block updates or removes `default_tools_approval_mode` cleanly alongside the entry, and unmanaged MCP server entries outside the block preserve their own settings.
- Paperclip's tool gateway remains the authority for tool permissions, automatic approvals, denials, and human approval cards.
- Tests in `packages/adapters/codex-local/src/server/codex-home.test.ts` verify multiple named gateways, collision renaming, preservation of unmanaged `writes` entries, and complete removal of the managed block.

## Verification

Head `30a9615043da7f44beb5f8426ec51edb7c3165db`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`packages/adapters/codex-local/src/server/codex-home.test.ts`) were run against the base's production code. 3 tests fail there. On the base `codex-home.ts` omits `default_tools_approval_mode = "approve"` from managed MCP server blocks, causing Codex under `approval_policy = "never"` to reject write tool calls locally before contacting Paperclip's gateway. On the head the same run gives: 14 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Applies only to Paperclip-managed MCP gateway entries (`paperclip-assigned` and named Paperclip gateways). Unmanaged MCP servers configured by the user keep their own approval mode.

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
