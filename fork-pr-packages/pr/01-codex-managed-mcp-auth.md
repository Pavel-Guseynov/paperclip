# fix(server): authenticate managed MCP lifecycle requests

| Field | Value |
| --- | --- |
| Branch | `pr/01-codex-managed-mcp-auth` |
| Head | `e040a813460a432decec03415bd1ef3cd56b668e` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(server): authenticate managed MCP lifecycle requests` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `doc/MCP-ACCESS-GOVERNANCE.md` | +1 | -0 |
| `server/src/__tests__/tool-gateway.test.ts` | +456 | -1 |
| `server/src/middleware/auth.ts` | +19 | -3 |
| `server/src/routes/tool-gateway.ts` | +17 | -0 |
| `server/src/services/tool-gateway.ts` | +28 | -6 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Agents reach their tools through the MCP tool gateway and its named gateways.
> - A managed MCP client sends its gateway token (`pcgw_…`) as a bearer to `POST /api/tool-gateway/gateways/:gatewayId/mcp`.
> - The actor middleware reads that bearer as an agent JWT and rejects it with "Agent token did not verify" before the gateway service can check it.
> - The `notifications/initialized` message on both gateway endpoints is also answered without a check of its credential.
> - This pull request hands the managed protocol POST to the gateway service and verifies the credential on the initialized notification.
> - The benefit is that managed MCP clients can connect, and a notification with a bad token is rejected.

## Linked Issues or Issue Description

Refs #13140. That issue reports the same "Agent token did not verify" rejection of a valid `pcgw_` token. It names the public `/mcp/gateways/…` path, which master already lets through. This pull request fixes the same rejection on the managed path `/api/tool-gateway/gateways/:gatewayId/mcp`.

Related open pull requests:

- #12518 (draft, by callisto-syn) changes the Codex config key to `http_headers` and lets gateway bearers through the middleware. Master already writes `http_headers` (since #14100). This pull request supersedes the remaining middleware and notification part. Credit to callisto-syn for the first analysis of the managed path.
- #11957 and #12287 only rename the Codex config key to `http_headers`. Master already does this, so this pull request has no code overlap with them. They can close as already fixed.
- #13025 exempts the same managed path from the actor middleware, for every method and every bearer, and does not check the notification. This pull request supersedes it: it limits the handoff to a `pcgw_` bearer on POST and adds the notification check.
- #11812 moves bearer checks for all gateway routes into the routes. If maintainers prefer that design, this pull request should fold into #11812: its notification check and tests carry over.

## What Changed

- The actor middleware hands a `pcgw_` bearer on `POST /api/tool-gateway/gateways/:gatewayId/mcp` (UUID path) to the gateway service, with no implicit board authority. The descriptor `GET` and every other API path keep normal actor authentication.
- Both gateway endpoints verify the credential on `notifications/initialized`. A valid notification returns an empty `202`. It does not use a protocol allowance, update token usage, or change run identity. An invalid one returns an empty `401` and stays in the failure limiter and the audit. An unexpected verification error returns an empty `500` and is logged.
- `doc/MCP-ACCESS-GOVERNANCE.md` describes the named gateway protocol authentication.
- Tests in `server/src/__tests__/tool-gateway.test.ts` run the real middleware and gateway on PostgreSQL in both deployment modes: managed initialize, tampered bearers, a gateway UUID without a version nibble, and a lost database client during notification verification.

## Verification

Head `e040a813460a432decec03415bd1ef3cd56b668e`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/tool-gateway.test.ts) were run against the base's production code. 59 tests fail there. Managed initialize and notifications get `401` with "Agent token did not verify" instead of the empty gateway response, in both deployment modes. On the head the same run gives: 154 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: a `notifications/initialized` message with an invalid or stale token now gets an empty `401` (or `429` when failures are throttled). Before, it got `202`.
- The middleware handoff applies only to POST on the exact UUID path with a `pcgw_` bearer. Tests cover the descriptor GET, malformed IDs, path suffixes, and other bearers.
- Pull request 02 (`pr/02-tool-gateway-session-token-verification`) edits adjacent lines of `server/src/middleware/auth.ts`. The second one to merge needs a small rebase. The two changes do not depend on each other.

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
