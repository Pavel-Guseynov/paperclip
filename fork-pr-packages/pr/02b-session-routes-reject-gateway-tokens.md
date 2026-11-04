# fix(tool-gateway): reject named gateway tokens on session routes

| Field | Value |
| --- | --- |
| Branch | `pr/02b-session-routes-reject-gateway-tokens` |
| Head | `4c9cf6ec66673068ced92346f46d97ac1aab1bdd` |
| Base commit | `cf20828a3bd81fc38dc9cc9e2c416e53a52476f3` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | `pr/02-tool-gateway-session-token-verification` |
| Proposed title | `fix(tool-gateway): reject named gateway tokens on session routes` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/tool-gateway.test.ts` | +67 | -0 |
| `server/src/services/tool-gateway.ts` | +7 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The tool gateway has run-scoped session routes and named gateway routes, each with its own token type.
> - The session routes `GET /api/tool-gateway/tools` and `POST /api/tool-gateway/tools/call` also accepted a named gateway token (`pcgw_…`) in the session header.
> - These routes do not supply a gateway locator and do not read the token's `allowedActions`.
> - So a named gateway token limited to `tools/call` could still list the gateway's tools there.
> - This pull request rejects a named gateway token on the session routes.
> - The benefit is that a named gateway token is limited to the actions it allows.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
`GET /api/tool-gateway/tools` with a named gateway token (`pcgw_…`) in `X-Paperclip-Tool-Gateway-Token` returned the gateway's tools, although the token allowed only `tools/call`.

**Expected behavior**
The session routes accept only a run-scoped session token. A named gateway token gets `401` with `session_invalid`.

**Steps to reproduce**
1. Create a named gateway and a token with `allowedActions: ["tools/call"]`.
2. Send `GET /api/tool-gateway/tools` with that token in `X-Paperclip-Tool-Gateway-Token`.
3. See `200` and the tool list.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Both `local_trusted` and `authenticated`.

Related open pull request: #11812 moves bearer checks into the gateway routes per credential family. It does not state that a `pcgw_` token is rejected on the session routes. The two changes are independent. If #11812 merges first, this check still applies inside its route-owned check.

## What Changed

- The session-token check rejects a `pcgw_` token with `session_invalid` when the call has no gateway locator.
- Named gateway endpoints and internal callers that pass a gateway locator are unchanged.
- A test on PostgreSQL sends a named gateway token to both session routes and expects `401`.

## Verification

Head `4c9cf6ec66673068ced92346f46d97ac1aab1bdd`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`. Its base `cf20828a3bd81fc38dc9cc9e2c416e53a52476f3` is the head of `pr/02-tool-gateway-session-token-verification`.

- Regression proof: the head's tests (server/src/__tests__/tool-gateway.test.ts) were run against the base's production code. 1 test fails there. A named gateway token on the session routes gets `200` instead of `401`. On the head the same run gives: 83 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Behavior change: a client that used a named gateway token on the session routes now gets `401`. Such a client must use the named gateway endpoint or a session token.

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
