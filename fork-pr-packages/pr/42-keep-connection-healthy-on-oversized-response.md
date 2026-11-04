# fix(tool-gateway): keep remote MCP connection healthy when one response exceeds size limit

| Field | Value |
| --- | --- |
| Branch | `fix/keep-connection-healthy-on-oversized-response` |
| Head | `d6321a9dd17eafaa15adc3797f5a0d1ac5292c16` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-gateway): keep remote MCP connection healthy when one response exceeds size limit` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/mcp-http.test.ts` | +57 | -0 |
| `server/src/__tests__/tool-gateway-service.test.ts` | +154 | -0 |
| `server/src/services/mcp-http.ts` | +18 | -3 |
| `server/src/services/tool-gateway.ts` | +56 | -27 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The MCP tool gateway enforces a 1,000,000-byte response size limit (`MAX_REMOTE_MCP_RESPONSE_BYTES`) on remote MCP HTTP and SSE responses.
> - When a single tool or context call returned a valid HTTP 200 response whose payload exceeded 1 MB, the gateway classified the `mcp_remote_response_too_large` error as a connection fault and marked the entire connection `error`.
> - Marking the connection `error` hid all of its tools from discovery (`tool_not_found`) even though the remote server and credentials were healthy.
> - This pull request fails only the oversized tool or context call with HTTP 502 `mcp_remote_response_too_large` while keeping the connection `healthStatus = 'ok'` and preserving its cached MCP session.
> - The benefit is that one large tool output does not take down a healthy MCP connection for subsequent calls.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
One remote MCP tool call returned more than `MAX_REMOTE_MCP_RESPONSE_BYTES` (1,000,000 bytes). The gateway failed that call with `mcp_remote_response_too_large` and also marked the connection `healthStatus = "error"`, causing every subsequent tool call on that connection to fail with `tool_not_found`.

**Expected behavior**
An oversized HTTP-200 tool or context response fails only that individual request with `502 mcp_remote_response_too_large` (including `maxBytes` and `responseBytes`), while the connection stays `ok` and its MCP session stays reusable.

**Steps to reproduce**
1. Connect a remote MCP server with a tool that returns a >1 MB payload and another tool that returns a small payload.
2. Call the >1 MB tool through the gateway and observe `502 mcp_remote_response_too_large`.
3. Call the small tool and observe `404 tool_not_found` because the connection health was set to `error`.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `server/src/services/mcp-http.ts` rejects declared `Content-Length` overflow before consuming body bytes, measures UTF-8 byte length across JSON and SSE responses, cancels/releases streamed overflow immediately, and attaches `maxBytes` and `responseBytes` to `McpHttpResponseError`.
- `server/src/services/tool-gateway.ts` returns HTTP 502 with `mcp_remote_response_too_large`, `maxBytes`, `responseBytes`, and the tool/context identifiers when a tool or context response (`resources/list`, `resources/read`, `prompts/list`, `prompts/get`, and their `paperclip_*` wrappers) exceeds the limit.
- On an oversized HTTP-success response, the gateway keeps `healthStatus: "ok"`, clears stale `lastError`, and preserves the authenticated MCP session headers. Genuine auth, HTTP status, transport, and protocol faults still mark the connection unhealthy.
- Tests in `server/src/__tests__/mcp-http.test.ts` and `tool-gateway-service.test.ts` cover declared and streamed JSON/SSE overflow, UTF-8 multibyte measurement, session reuse on the next call, all four context actions and wrappers, and genuine fault controls.

## Verification

Head `d6321a9dd17eafaa15adc3797f5a0d1ac5292c16`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/mcp-http.test.ts`, `server/src/__tests__/tool-gateway-service.test.ts`) were run against the base's production code. 12 tests fail there. On the base an oversized HTTP-200 MCP response marks the connection `healthStatus = "error"` and drops its tools from subsequent calls. On the head the same run gives: 162 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- The 1,000,000-byte response limit itself is unchanged; only the connection health transition for an HTTP-success payload overflow changes.

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
