# fix(tool-gateway): return JSON-RPC -32601 with HTTP 200 for unsupported MCP methods

| Field | Value |
| --- | --- |
| Branch | `fix/mcp-unsupported-method-errors` |
| Head | `bc9f9bddf111028185816c727e2ac5de9d2f81f8` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-gateway): return JSON-RPC -32601 with HTTP 200 for unsupported MCP methods` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/tool-gateway.test.ts` | +144 | -0 |
| `server/src/middleware/logger.ts` | +13 | -10 |
| `server/src/routes/tool-gateway.ts` | +12 | -2 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - MCP clients talk JSON-RPC 2.0 over HTTP to Paperclip's public (`/mcp/gateways/:gatewayId`) and managed (`/api/tool-gateway/gateways/:gatewayId/mcp`) named gateway endpoints.
> - When an authenticated MCP client sent an unsupported JSON-RPC request method (such as `ping`, `Logging/SetLevel`, or `completion/complete`) or an unsupported notification (such as `notifications/cancelled`), the gateway returned HTTP 404 instead of an HTTP 200 JSON-RPC `-32601 Method not found` response or HTTP 202 for a notification.
> - Streamable HTTP MCP clients treat HTTP 404 on the endpoint as a missing server or broken transport rather than a JSON-RPC method-not-found error.
> - This pull request verifies the gateway credential first, returns HTTP 202 for unsupported id-less notifications and HTTP 200 with JSON-RPC `-32601` and the caller's `id` for unsupported requests, and records the sanitized `mcpMethod` in the request completion log.
> - The benefit is that standard MCP clients handle unsupported optional methods and notifications gracefully without dropping the gateway connection.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
Sending an authenticated JSON-RPC request or notification with an unsupported method to `/mcp/gateways/:gatewayId` or `/api/tool-gateway/gateways/:gatewayId/mcp` returned HTTP 404, causing MCP clients to treat the gateway endpoint as missing.

**Expected behavior**
After non-consuming credential verification, an unsupported notification (no `id`) returns an empty HTTP 202, an unsupported request returns HTTP 200 with JSON-RPC `-32601 Method not found` and the original `id`, and missing/invalid credentials still return HTTP 401.

**Steps to reproduce**
1. Authenticate against a named MCP gateway endpoint.
2. Send `{"jsonrpc":"2.0","id":1,"method":"ping"}` or `{"jsonrpc":"2.0","method":"notifications/cancelled"}`.
3. Observe HTTP 404 instead of HTTP 200 JSON-RPC `-32601` / HTTP 202.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- On both named gateway MCP endpoints (`server/src/routes/tool-gateway.ts`), unsupported methods first run non-consuming gateway credential verification so unauthenticated requests still get HTTP 401.
- An authenticated unsupported notification (where `id` is absent) returns an empty HTTP 202 response.
- An authenticated unsupported request (with string, number, or `null` `id`) returns HTTP 200 with JSON-RPC 2.0 error `-32601` (`Method not found: <method>`) and the caller's exact `id`.
- `server/src/middleware/logger.ts` logs the sanitized `mcpMethod` from `res.locals` on request completion without logging request arguments or bearer tokens.
- Tests in `server/src/__tests__/tool-gateway.test.ts` cover both endpoints, string/numeric/null IDs, notifications, unauthenticated requests, and pino-http log output.

## Verification

Head `bc9f9bddf111028185816c727e2ac5de9d2f81f8`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/tool-gateway.test.ts`) were run against the base's production code. 8 tests fail there. On the base unsupported MCP methods return HTTP 404 instead of HTTP 200 JSON-RPC `-32601` (or HTTP 202 for notifications). On the head the same run gives: 162 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Low risk: supported MCP methods (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`) keep their existing dispatch paths.

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
