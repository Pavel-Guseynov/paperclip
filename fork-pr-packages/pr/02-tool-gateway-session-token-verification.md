# fix(tool-gateway): verify session bearer tokens on session routes

| Field | Value |
| --- | --- |
| Branch | `pr/02-tool-gateway-session-token-verification` |
| Head | `9c2d0afb55779e349e55aa996622d7254c6ba0ee` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-gateway): verify session bearer tokens on session routes` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `doc/MCP-ACCESS-GOVERNANCE.md` | +1 | -1 |
| `doc/MCP-DEMO-SCRIPT.md` | +2 | -2 |
| `server/src/__tests__/agent-auth-middleware.test.ts` | +97 | -0 |
| `server/src/__tests__/tool-gateway.test.ts` | +293 | -0 |
| `server/src/middleware/auth.ts` | +22 | -0 |
| `server/src/routes/tool-gateway.ts` | +11 | -1 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Agents call tools through the tool gateway with a run-scoped session token (`pcgt_…`).
> - Some runtimes can only send a standard `Authorization: Bearer` header, not the `X-Paperclip-Tool-Gateway-Token` header.
> - The actor middleware reads a `pcgt_` bearer as an agent JWT and rejects it before the gateway service can verify it.
> - This pull request hands a `pcgt_` bearer on the two session routes to the gateway service, which verifies it.
> - The benefit is that these runtimes can list and call their tools.

## Linked Issues or Issue Description

Refs #13140. That issue reports the "Agent token did not verify" rejection for a gateway token. This pull request fixes the same rejection for the run-scoped session token on `GET /api/tool-gateway/tools` and `POST /api/tool-gateway/tools/call`.

Related open pull request: #11812 accepts the session token as `Authorization: Bearer` on these routes as part of a larger move of bearer checks into the routes. This pull request supersedes that part if maintainers want the narrow fix. If maintainers adopt #11812, this pull request should fold into it: its tests carry over.

This pull request does not depend on pull request 01 (`pr/01-codex-managed-mcp-auth`). Both edit adjacent lines of `server/src/middleware/auth.ts`, so the second one to merge needs a small rebase.

## What Changed

- The actor middleware hands a `pcgt_` bearer on `GET /api/tool-gateway/tools` and `POST /api/tool-gateway/tools/call` to the gateway service, with no implicit board authority. Every other credential on these paths keeps normal actor authentication.
- The gateway routes read the session token from `Authorization` only when it is a `pcgt_` bearer. The `X-Paperclip-Tool-Gateway-Token` header wins when both are present.
- `doc/MCP-ACCESS-GOVERNANCE.md` and `doc/MCP-DEMO-SCRIPT.md` describe both transports.
- Tests run the real middleware and gateway on PostgreSQL: list and call over the bearer, header precedence, other bearers, and revoked, cross-session, unknown, malformed, other-agent, and finished-run sessions.

## Verification

Head `9c2d0afb55779e349e55aa996622d7254c6ba0ee`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/agent-auth-middleware.test.ts, server/src/__tests__/tool-gateway.test.ts) were run against the base's production code. 5 tests fail there. A `pcgt_` bearer gets `401` instead of `200`, and bad session bearers get the middleware error instead of the gateway reason codes (`session_revoked`, `session_run_inactive`). On the head the same run gives: 119 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Only a `pcgt_` bearer on the two session paths skips actor authentication. A board key, an agent JWT, or a browser session on these paths keeps the existing checks, including the run-id mismatch audit.
- The gateway service still decides every session-token request. A bad token gets the same reason codes as through the header.

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
