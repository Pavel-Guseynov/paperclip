# fix(tool-gateway): reject named gateway tokens on session routes

| Field | Value |
| --- | --- |
| Branch | `pr/02b-session-routes-reject-gateway-tokens` |
| Head | `2e1d722161adb73cef0855281a877d1a18cd2953` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-gateway): reject named gateway tokens on session routes` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/tool-gateway.test.ts` | +71 | -0 |
| `server/src/services/tool-gateway.ts` | +12 | -0 |

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

Head `2e1d722161adb73cef0855281a877d1a18cd2953`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/tool-gateway.test.ts) were run against the base's production code. 1 test fails there. A named gateway token on the session routes gets `200` instead of `401`. On the head the same run gives: 83 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: a client that used a named gateway token on the session routes now gets `401`. Such a client must use the named gateway endpoint or a session token.

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
