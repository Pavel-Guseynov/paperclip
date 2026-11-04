# fix(codex-local): isolate per-run MCP gateway credentials in run-scoped Codex profiles

| Field | Value |
| --- | --- |
| Branch | `fix/run-scoped-mcp-gateway-credentials` |
| Head | `b6827d03b98dac6df1d56d7b860a0bb0d67770d7` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(codex-local): isolate per-run MCP gateway credentials in run-scoped Codex profiles` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `packages/adapters/codex-local/src/server/codex-args.ts` | +2 | -1 |
| `packages/adapters/codex-local/src/server/codex-auth-cache.test.ts` | +72 | -67 |
| `packages/adapters/codex-local/src/server/codex-home.test.ts` | +68 | -0 |
| `packages/adapters/codex-local/src/server/codex-home.ts` | +59 | -3 |
| `packages/adapters/codex-local/src/server/execute.remote.test.ts` | +11 | -2 |
| `packages/adapters/codex-local/src/server/execute.ts` | +10 | -3 |
| `server/src/__tests__/codex-local-execute.test.ts` | +6 | -2 |
| `server/src/__tests__/tool-gateway.test.ts` | +96 | -0 |
| `server/src/services/tool-gateway.ts` | +31 | -0 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When a Codex local run starts with managed MCP gateways, Paperclip mints run-scoped gateway bearer tokens and revokes them as soon as that run finishes.
> - Previously, `prepareCodexHome` wrote those run-scoped bearer tokens directly into the shared `[mcp_servers.*]` blocks of `$CODEX_HOME/config.toml`.
> - When two runs shared a Codex home (or a second run prepared its home while another run was finishing), one run overwrote or read the other run's bearer token, and ending one run caused the still-running run to present a revoked token (`gateway_token_revoked`).
> - This pull request isolates each run's managed MCP server URL and bearer headers inside a run-scoped Codex profile (`--profile paperclip-run-<id>`) in a mode-`0600` config that is cleaned up when the run exits, and logs subject/presenter run attribution on `named_gateway_auth_failed`.
> - The benefit is that overlapping Codex runs never clobber or inherit each other's revoked MCP gateway tokens.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
Overlapping Codex runs wrote their run-scoped MCP gateway bearer tokens into the shared `$CODEX_HOME/config.toml`. When one run finished and revoked its token, another live run read and presented that revoked token, failing with `401 gateway_token_revoked`.

**Expected behavior**
Each Codex CLI run receives its own run-scoped profile (`--profile`) carrying its managed MCP gateway credentials, cleaned up when the run exits, so ending one run never revokes or overwrites another live run's MCP credentials.

**Steps to reproduce**
1. Start two overlapping Codex runs that share a Codex home and use a managed MCP gateway.
2. Finish the first run so its run-scoped gateway token is revoked.
3. Make an MCP call from the second run and observe `401 gateway_token_revoked`.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `packages/adapters/codex-local/src/server/codex-home.ts`, `codex-args.ts`, and `execute.ts` isolate each run's managed MCP gateway configuration inside a dedicated run-scoped profile (`paperclip-run-<runId>`) passed via `--profile`, merging any operator-configured base profile settings and removing the run profile on exit.
- File locks serialize concurrent `config.toml` updates within the same Codex home using `0600` permissions.
- `server/src/services/tool-gateway.ts` enriches `named_gateway_auth_failed` audit/log records with token subject type/ID, subject run ID/status, and presenting-run header attribution (`client_header`) without exposing bearer material.
- Tests across `codex-home.test.ts`, `codex-local-execute.test.ts`, `execute.remote.test.ts`, and `tool-gateway.test.ts` prove that overlapping runs keep separate tokens, a live run succeeds after a peer run finishes and revokes its token, and the ended run's token stays rejected.

## Verification

Head `b6827d03b98dac6df1d56d7b860a0bb0d67770d7`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`packages/adapters/codex-local/src/server/codex-home.test.ts`, `server/src/__tests__/tool-gateway.test.ts`) were run against the base's production code. 7 tests fail there. On the base overlapping Codex runs overwrite the shared `[mcp_servers.*]` bearer token in `config.toml`, so finishing one run revokes the token presented by the other live run (`401 gateway_token_revoked`). On the head the same run gives: 176 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Run-scoped profile entries in `config.toml` are removed in a `finally` block when the child process exits; stale run profiles from a hard server crash are pruned on the next `prepareCodexHome` pass.

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
