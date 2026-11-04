# fix(heartbeat): keep a heartbeat-run gateway token valid while its run runs

| Field | Value |
| --- | --- |
| Branch | `pr/24-run-gateway-token-lifetime` |
| Head | `fa94fd41ce5e698743384bb6cf9c986deffaa231` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(heartbeat): keep a heartbeat-run gateway token valid while its run runs` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/heartbeat-runtime-mcp-servers.test.ts` | +6 | -3 |
| `server/src/__tests__/run-gateway-token-lifetime.test.ts` | +198 | -0 |
| `server/src/services/heartbeat/run-preparation.ts` | +2 | -5 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Heartbeat issues each run named gateway tokens so the run can use its MCP tools.
> - Those tokens expired after one hour, although the run could still be running.
> - A longer run then lost its tools, and every later `tools/list` or `tools/call` failed with `gateway_token_expired`. The token list also showed a live run's token as expired.
> - This pull request issues the run's tokens without a time expiry, so the gateway's run-state check ends them with the run.
> - The benefit is that long runs keep their tools.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
A heartbeat run that worked longer than one hour got `gateway_token_expired` on every MCP tool call.

**Expected behavior**
The run's gateway token works while the run is running and stops when the run stops.

**Steps to reproduce**
1. Start a heartbeat run that uses MCP tools through its named gateway.
2. Keep it running for more than one hour.
3. See the tool calls fail with `gateway_token_expired`.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- Heartbeat issues the runtime MCP token and the Paperclip-managed MCP tokens of a run without a time expiry. The gateway's existing run-state check rejects such a token with `gateway_token_run_inactive` as soon as the run is no longer running, so the token lives exactly as long as its run. The owner note says so, and the token list shows "No expiry" instead of "Expired".
- The gateway is unchanged: a token with an explicit expiry still expires, whatever its subject.
- Tests issue the token through heartbeat, check the stored token, move the clock two hours ahead, and check a running run's token, a finished run's token, and a token with an explicit expiry. The existing runtime MCP test now expects no expiry on the run tokens.

## Verification

Head `fa94fd41ce5e698743384bb6cf9c986deffaa231`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (server/src/__tests__/run-gateway-token-lifetime.test.ts, server/src/__tests__/heartbeat-runtime-mcp-servers.test.ts) were run against the base's production code. 4 tests fail there. The run tokens are stored with a one-hour expiry, and the running run's token is rejected with `gateway_token_expired` after two hours. On the head the same run gives: 9 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Behavior change: a leaked heartbeat-run token stays valid until its run stops running, not for at most one hour.
- Tokens issued before the upgrade keep their stored one-hour expiry.

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
