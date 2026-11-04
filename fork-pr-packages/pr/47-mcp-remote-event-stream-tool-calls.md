# fix(tool-gateway): complete SSE remote MCP calls on matching response ID and use 30s default timeout

| Field | Value |
| --- | --- |
| Branch | `fix/mcp-remote-event-stream-tool-calls` |
| Head | `b0f13ac34014e1829421553219662b863ef6c047` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-gateway): complete SSE remote MCP calls on matching response ID and use 30s default timeout` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/mcp-http.test.ts` | +75 | -0 |
| `server/src/__tests__/tool-gateway.test.ts` | +78 | -0 |
| `server/src/services/mcp-http.ts` | +24 | -3 |
| `server/src/services/remote-http-fetch.ts` | +2 | -2 |
| `server/src/services/tool-gateway.ts` | +48 | -13 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Remote Streamable HTTP MCP servers often reply to `tools/call` with `Content-Type: text/event-stream` (SSE) and keep the SSE stream open after sending the JSON-RPC response frame, or take longer than 10 seconds to finish a tool call.
> - Previously, `mcp-http.ts` waited for the remote server to close the HTTP response body (EOF) before parsing SSE frames, and `remote-http-fetch.ts` defaulted every remote fetch without an explicit timeout to 10,000 ms.
> - As a result, SSE responses on persistent streams hung until the deadline and then failed with `Error: aborted` (misclassified as a transport `error` instead of `tool_timeout`), marking the connection `error`.
> - This pull request completes SSE body reading as soon as the `data:` frame matching the request's JSON-RPC `id` arrives, raises the default remote MCP call timeout to 30,000 ms, classifies deadline aborts (`Error: aborted` / `ECONNRESET` after deadline) as `504 tool_timeout` with `degraded` health, and records stream progress and sanitized error cause chains in call metadata.
> - The benefit is that Streamable HTTP MCP servers over direct HTTP(S) or `socks5h` complete immediately on matching SSE responses and report accurate timeout diagnostics.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
Calling a remote MCP tool that responded with `text/event-stream` and kept the stream open after the JSON-RPC response hung until the 10-second default fetch timeout, aborted the body with `Error: aborted`, returned a transport error instead of `504 tool_timeout`, and marked the connection `error`.

**Expected behavior**
The SSE reader resolves as soon as the JSON-RPC response matching the request `id` is received and cancels the rest of the stream; default remote MCP tool calls have a 30-second budget; deadline aborts map to `504 tool_timeout` (`invocation_timeout`) with `degraded` connection health and structured stream progress evidence.

**Steps to reproduce**
1. Connect a Streamable HTTP MCP server that answers `tools/call` with `text/event-stream`, writes the JSON-RPC response event, and leaves the SSE stream open.
2. Call the tool through the gateway.
3. Observe the call hang until timeout and mark the connection `error`.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `server/src/services/mcp-http.ts` parses SSE `data:` events incrementally as chunks arrive and resolves immediately when a JSON-RPC message matching the request `id` is observed, cancelling and releasing the reader without waiting for EOF.
- `server/src/services/remote-http-fetch.ts` exports `DEFAULT_REMOTE_MCP_TIMEOUT_MS = 30_000`, which `tool-gateway.ts` uses when a remote MCP call does not specify an explicit timeout (explicit timeouts remain clamped to `1..60_000` ms).
- One call-owned deadline controller covers session initialization and body consumption; if the call deadline expires while reading the body (`Error: aborted` / `ECONNRESET`), `tool-gateway.ts` classifies it as `504 tool_timeout` (`invocation_timeout`) with `degraded` health, while genuine peer resets before the deadline remain transport failures.
- `toolCallEvents.metadata.execution` and activity audit details record `execution.stream` counters (bytes, chunks, parsed SSE events, matched response ID, EOF) and a redacted error cause chain.
- Tests in `mcp-http.test.ts` and `tool-gateway.test.ts` verify open-ended SSE completion, 30s default timeout, deadline abort vs peer reset classification, and stream progress evidence.

## Verification

Head `b0f13ac34014e1829421553219662b863ef6c047`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/mcp-http.test.ts`, `server/src/__tests__/tool-gateway.test.ts`) were run against the base's production code. 9 tests fail there. On the base open-ended `text/event-stream` responses wait for EOF until the 10-second deadline expires, abort with `Error: aborted`, and mark the connection `error` instead of `degraded` `504 tool_timeout`. On the head the same run gives: 184 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Default timeout for remote MCP calls without an explicit timeout increases from 10s to 30s; other remote HTTP fetches keep the 10s default.

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
