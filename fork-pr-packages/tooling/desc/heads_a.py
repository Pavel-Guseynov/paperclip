HEADS_A = [
{
"id": "01",
"branch": "pr/01-codex-managed-mcp-auth",
"title": "fix(server): authenticate managed MCP lifecycle requests",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Agents reach their tools through the MCP tool gateway and its named gateways.",
"A managed MCP client sends its gateway token (`pcgw_…`) as a bearer to `POST /api/tool-gateway/gateways/:gatewayId/mcp`.",
"The actor middleware reads that bearer as an agent JWT and rejects it with \"Agent token did not verify\" before the gateway service can check it.",
"The `notifications/initialized` message on both gateway endpoints is also answered without a check of its credential.",
"This pull request hands the managed protocol POST to the gateway service and verifies the credential on the initialized notification.",
"The benefit is that managed MCP clients can connect, and a notification with a bad token is rejected.",
],
"linked": """Refs #13140. That issue reports the same "Agent token did not verify" rejection of a valid `pcgw_` token. It names the public `/mcp/gateways/…` path, which master already lets through. This pull request fixes the same rejection on the managed path `/api/tool-gateway/gateways/:gatewayId/mcp`.

Related open pull requests:

- #12518 (draft, by callisto-syn) changes the Codex config key to `http_headers` and lets gateway bearers through the middleware. Master already writes `http_headers` (since #14100). This pull request supersedes the remaining middleware and notification part. Credit to callisto-syn for the first analysis of the managed path.
- #11957 and #12287 only rename the Codex config key to `http_headers`. Master already does this, so this pull request has no code overlap with them. They can close as already fixed.
- #13025 exempts the same managed path from the actor middleware, for every method and every bearer, and does not check the notification. This pull request supersedes it: it limits the handoff to a `pcgw_` bearer on POST and adds the notification check.
- #11812 moves bearer checks for all gateway routes into the routes. If maintainers prefer that design, this pull request should fold into #11812: its notification check and tests carry over.""",
"what": [
"The actor middleware hands a `pcgw_` bearer on `POST /api/tool-gateway/gateways/:gatewayId/mcp` (UUID path) to the gateway service, with no implicit board authority. The descriptor `GET` and every other API path keep normal actor authentication.",
"Both gateway endpoints verify the credential on `notifications/initialized`. A valid notification returns an empty `202`. It does not use a protocol allowance, update token usage, or change run identity. An invalid one returns an empty `401` and stays in the failure limiter and the audit. An unexpected verification error returns an empty `500` and is logged.",
"`doc/MCP-ACCESS-GOVERNANCE.md` describes the named gateway protocol authentication.",
"Tests in `server/src/__tests__/tool-gateway.test.ts` run the real middleware and gateway on PostgreSQL in both deployment modes: managed initialize, tampered bearers, a gateway UUID without a version nibble, and a lost database client during notification verification.",
],
"risks": [
"Behavior change: a `notifications/initialized` message with an invalid or stale token now gets an empty `401` (or `429` when failures are throttled). Before, it got `202`.",
"The middleware handoff applies only to POST on the exact UUID path with a `pcgw_` bearer. Tests cover the descriptor GET, malformed IDs, path suffixes, and other bearers.",
"Pull request 02 (`pr/02-tool-gateway-session-token-verification`) edits adjacent lines of `server/src/middleware/auth.ts`. The second one to merge needs a small rebase. The two changes do not depend on each other.",
],
},
{
"id": "02",
"branch": "pr/02-tool-gateway-session-token-verification",
"title": "fix(tool-gateway): verify session bearer tokens on session routes",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Agents call tools through the tool gateway with a run-scoped session token (`pcgt_…`).",
"Some runtimes can only send a standard `Authorization: Bearer` header, not the `X-Paperclip-Tool-Gateway-Token` header.",
"The actor middleware reads a `pcgt_` bearer as an agent JWT and rejects it before the gateway service can verify it.",
"This pull request hands a `pcgt_` bearer on the two session routes to the gateway service, which verifies it.",
"The benefit is that these runtimes can list and call their tools.",
],
"linked": """Refs #13140. That issue reports the "Agent token did not verify" rejection for a gateway token. This pull request fixes the same rejection for the run-scoped session token on `GET /api/tool-gateway/tools` and `POST /api/tool-gateway/tools/call`.

Related open pull request: #11812 accepts the session token as `Authorization: Bearer` on these routes as part of a larger move of bearer checks into the routes. This pull request supersedes that part if maintainers want the narrow fix. If maintainers adopt #11812, this pull request should fold into it: its tests carry over.

This pull request does not depend on pull request 01 (`pr/01-codex-managed-mcp-auth`). Both edit adjacent lines of `server/src/middleware/auth.ts`, so the second one to merge needs a small rebase.""",
"what": [
"The actor middleware hands a `pcgt_` bearer on `GET /api/tool-gateway/tools` and `POST /api/tool-gateway/tools/call` to the gateway service, with no implicit board authority. Every other credential on these paths keeps normal actor authentication.",
"The gateway routes read the session token from `Authorization` only when it is a `pcgt_` bearer. The `X-Paperclip-Tool-Gateway-Token` header wins when both are present.",
"`doc/MCP-ACCESS-GOVERNANCE.md` and `doc/MCP-DEMO-SCRIPT.md` describe both transports.",
"Tests run the real middleware and gateway on PostgreSQL: list and call over the bearer, header precedence, other bearers, and revoked, cross-session, unknown, malformed, other-agent, and finished-run sessions.",
],
"risks": [
"Only a `pcgt_` bearer on the two session paths skips actor authentication. A board key, an agent JWT, or a browser session on these paths keeps the existing checks, including the run-id mismatch audit.",
"The gateway service still decides every session-token request. A bad token gets the same reason codes as through the header.",
],
},
{
"id": "02b",
"branch": "pr/02b-session-routes-reject-gateway-tokens",
"title": "fix(tool-gateway): reject named gateway tokens on session routes",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The tool gateway has run-scoped session routes and named gateway routes, each with its own token type.",
"The session routes `GET /api/tool-gateway/tools` and `POST /api/tool-gateway/tools/call` also accepted a named gateway token (`pcgw_…`) in the session header.",
"These routes do not supply a gateway locator and do not read the token's `allowedActions`.",
"So a named gateway token limited to `tools/call` could still list the gateway's tools there.",
"This pull request rejects a named gateway token on the session routes.",
"The benefit is that a named gateway token is limited to the actions it allows.",
],
"linked": """No issue exists. Issue description (bug):

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

Related open pull request: #11812 moves bearer checks into the gateway routes per credential family. It does not state that a `pcgw_` token is rejected on the session routes. The two changes are independent. If #11812 merges first, this check still applies inside its route-owned check.""",
"what": [
"The session-token check rejects a `pcgw_` token with `session_invalid` when the call has no gateway locator.",
"Named gateway endpoints and internal callers that pass a gateway locator are unchanged.",
"A test on PostgreSQL sends a named gateway token to both session routes and expects `401`.",
],
"risks": [
"Behavior change: a client that used a named gateway token on the session routes now gets `401`. Such a client must use the named gateway endpoint or a session token.",
],
},
{
"id": "03",
"branch": "pr/03-codex-runtime-api-reachability",
"title": "fix(runtime): use the internal API origin for agent callbacks",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Agent processes call back into the Paperclip API from adapters, the CLI, and the artifact helper.",
"An operator can serve the dashboard through a tunnel or a tailnet-only hostname that agent processes cannot resolve.",
"Callbacks then fail, because they dial `PAPERCLIP_API_URL`, the public origin.",
"This pull request gives agents an internal callback origin, `PAPERCLIP_RUNTIME_API_URL`, that an operator can pin, and makes every callback path use it.",
"The benefit is that agents keep working when the public origin is unreachable from where they run.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
With the dashboard served through a tunnel hostname, Codex managed MCP calls, CLI calls from agents, and `paperclip-upload-artifact.sh` dialed that hostname from the agent process and failed.

**Expected behavior**
Agent callbacks use an origin that the agent process can reach. An operator can pin it.

**Steps to reproduce**
1. Set `PAPERCLIP_API_URL` to a public tunnel URL that the host itself cannot resolve.
2. Run a Codex agent that uses managed MCP tools.
3. See the MCP and API calls fail with a DNS or connection error.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any mode where the public URL differs from the internal one.

Related open pull requests that address the same reachability problem with other mechanisms: #14801 (opt-in local API listener), #12037 (separate internal runtime URL for local adapters), and #11564 (probe and rank allowed hostnames). This pull request does not depend on them. It supersedes #12037 and #11564 for the callback origin, because it covers the adapters, the CLI, and the artifact helper with one variable. If maintainers choose the #14801 design, this pull request should fold into it. Older related pull requests: #14525, #10517, #9916, #9228, and #12886.""",
"what": [
"Server boot honors a pre-set `PAPERCLIP_RUNTIME_API_URL` as the internal callback origin and puts it first in the runtime API candidates. Without a pin, `PAPERCLIP_RUNTIME_API_URL` equals the configured `PAPERCLIP_API_URL`, and a Cloud identity claim moves both to the claimed origin. A pinned origin stays.",
"`buildPaperclipEnv` exports `PAPERCLIP_RUNTIME_API_URL` next to `PAPERCLIP_API_URL`. Sandbox bridges set both to their in-target origin.",
"Codex managed MCP endpoints, the Paperclip runtime MCP servers, and runtime tool access use the internal origin. The Codex and Claude network allowlists trust it.",
"`cursor_cloud` drops `PAPERCLIP_RUNTIME_API_URL` together with `PAPERCLIP_API_URL` when it has no usable key.",
"The CLI and `skills/paperclip/scripts/paperclip-upload-artifact.sh` prefer `PAPERCLIP_RUNTIME_API_URL`.",
"`docs/deploy/environment-variables.md`, `doc/CLI.md`, and `doc/AGENT-ARTIFACTS.md` describe the variable and the resolution order.",
"Tests cover server boot with and without a pin, the Cloud claim with and without a pin, `buildPaperclipEnv`, the sandbox bridges, the Codex MCP config and allowlist, the Claude allowlist, `cursor_cloud`, the CLI order, and an artifact upload through the internal origin while the public origin is unreachable.",
],
"risks": [
"Behavior change: without a pin, `PAPERCLIP_RUNTIME_API_URL` now equals the configured `PAPERCLIP_API_URL`. Before, it was the URL derived from `authPublicBaseUrl`. A process that inherits the server environment (where `PAPERCLIP_API_URL` is removed) now falls back to the configured API URL.",
"A pinned origin must be reachable from every agent process. The public API URL stays in the candidate list.",
"Inside an agent process the CLI prefers `PAPERCLIP_RUNTIME_API_URL` over `PAPERCLIP_API_URL`, so a `PAPERCLIP_API_URL` set by hand in that environment no longer changes the CLI target. `--api-base` still overrides both.",
"The other adapters' prompt text still names `PAPERCLIP_API_URL` (for example the curl examples of the Gemini, Grok, and Kimi adapters). With a pin, those examples dial the public origin. They are unchanged here and can follow in a separate change.",
],
},
{
"id": "04",
"branch": "pr/04-remote-mcp-timeout-health",
"title": "fix(tool-gateway): distinguish call timeouts from connection failure",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Agents call tools on remote MCP connections through the tool gateway.",
"When one remote tool call hits its deadline, the gateway marks the whole connection as `error`.",
"Discovery then hides every tool of that connection until an explicit health check, although one timeout proves nothing about the connection.",
"This pull request marks the connection `degraded` after an abandoned call and keeps a connection in that state in discovery.",
"The benefit is that one slow call does not remove all tools of a connection.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
One remote MCP `tools/call` that timed out set the connection health to `error`. Every tool of the connection disappeared from `tools/list` until a health check.

**Expected behavior**
A timeout marks the connection `degraded`. Its tools stay listed. The next exchange clears the warning or marks the connection `error`. A connection that is `degraded` for another reason stays hidden, as before.

**Steps to reproduce**
1. Connect a remote MCP server whose tool does not answer before the call deadline.
2. Call that tool once through the gateway.
3. List tools: the connection's tools are gone.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull request: #11910 keeps the health `ok` after a timed-out call and also after a JSON-RPC error. This pull request supersedes #11910: it covers the timeout case, records the outcome as `degraded` with an audit failure kind, and keeps protocol failures as connection errors. If maintainers prefer #11910, the `degraded` state and the audit `failureKind` can fold into it. #12611 changes HTTP status mapping of tool errors and does not overlap.""",
"what": [
"An abandoned call marks the connection `degraded` with the message \"Remote MCP tool call timed out.\", not `error`.",
"Gateway discovery serves a connection in exactly that state. The next call clears the warning or marks the connection `error`. A connection that is `degraded` for another reason (insufficient OAuth scope, a Vercel Connect failure, a credential due for rotation) stays hidden, as on master.",
"The timeout is recorded only when the connection row is unchanged since the call started, so it never overwrites a newer write, also one that sets no observation time.",
"Failed remote calls carry a `failureKind` in the audit: `invocation_timeout`, `transport_failure`, or `protocol_failure`.",
"Tests on PostgreSQL run the gateway against a remote MCP fake: abandoned calls, a connection degraded for another reason, recovery, transport and protocol failures, and timeouts after a newer health state, with and without an observation time.",
],
"risks": [
"Behavior change: after a timed-out call, the connection's tools stay listed with health `degraded`. A connection that really failed is still marked `error` by the next exchange or by a transport or protocol failure.",
"Discovery recognizes the timeout state by its health message. A later change of that message must change both places; both use one constant.",
],
},
{
"id": "04b",
"branch": "pr/04b-refuse-ambiguous-timeout-replay",
"title": "fix(tool-access): refuse idempotent replay of an ambiguous timed-out write",
"stack": ("pr/04-remote-mcp-timeout-health", "With pull request 04, a timed-out remote MCP connection stays callable, so a replay with the same idempotency key reaches the stored timed-out invocation at once. On master the connection is hidden after a timeout and the replay ends with `404`. The tests also use the remote MCP test file that pull request 04 adds."),
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Tool calls through the gateway can carry an idempotency key, and a repeated key replays the stored invocation.",
"A call that times out is abandoned with an unknown outcome. It can already have changed state upstream.",
"A later call with the same key returned the stored timed-out invocation as an ordinary replay, so the caller could treat an unknown write as settled.",
"This pull request refuses that replay for calls that can change state.",
"The benefit is that a caller must confirm the outcome before it retries a write.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
After a write tool call timed out, a second call with the same idempotency key returned the timed-out invocation as `replayed`. The caller could not tell that the write outcome was unknown.

**Expected behavior**
The replay is refused with `409` and `ambiguous_invocation_timeout`. Reads and low-risk calls keep the ordinary replay.

**Steps to reproduce**
1. Call a write tool on a remote MCP connection with an idempotency key, and let the call time out.
2. Call it again with the same key.
3. See the stored timed-out invocation returned as a replay.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf` with pull request 04 applied.

**Deployment mode**
Any.

Related open pull requests in the same function: #12835 replays stored failed invocations instead of asking for approval again, and #13024 adds a gateway scope check (`idempotency_gateway_mismatch`) to the replay. Neither refuses a timed-out write. These changes are independent; the second one to merge needs a small rebase.""",
"what": [
"When the stored invocation timed out and its risk level can change state (write, destructive, medium, high, critical, or not recorded), the policy service refuses the replay with `409 ambiguous_invocation_timeout`.",
"Reads and low-risk calls keep the ordinary replay.",
"The risk check reads the stored invocation, because the idempotency key is unique per company and not per tool.",
"The `409` details name the tool of the stored invocation.",
"Tests on PostgreSQL time out a call through the gateway and replay it: a write, a read, a read tool named on a write's key, a low-risk call, and a call with no recorded risk level.",
],
"risks": [
"Behavior change: a client that retried a timed-out write with the same idempotency key now gets `409` and must use a new key after it confirms the outcome.",
"An invocation with no recorded risk level is treated as able to change state.",
],
},
{
"id": "05",
"branch": "pr/05-tool-gateway-token-log-redaction",
"title": "fix(logger): redact gateway credentials across log output",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The server logs every HTTP request and many structured events.",
"Gateway session tokens (`pcgt_…`) and named gateway tokens (`pcgw_…`) could reach the logs where the HTTP redact paths did not cover them.",
"Examples are the `X-Paperclip-Tool-Gateway-Token` header, response headers, child-logger bindings, error messages, error cause chains, and messages that quote an `Authorization` value.",
"This pull request redacts credentials from one list of names and patterns in every log path.",
"The benefit is that gateway tokens do not leak into log storage.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
A rejected session token appeared in the `401` log line and in the logged error message. Response headers and unlisted credential headers such as `api-key` and `x-auth-token` were logged in clear text.

**Expected behavior**
Credential headers, fields, and token-shaped text are redacted in every log record.

**Steps to reproduce**
1. Send `POST /api/tool-gateway/tools` with an invalid token in `X-Paperclip-Tool-Gateway-Token`.
2. Read the server log.
3. See the token in the request headers and in the error message.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests:

- #10784 adds `api-key` and `x-auth-token` to the HTTP redact paths. This pull request redacts both headers through its credential header pattern (checked with a request that sends both on a `401`; master logs them). This pull request supersedes #10784. If #10784 merges first, this pull request still applies, because its header list and pattern cover the same names.
- #13742 (the `credentialValues` envelope) and #10467 (Cloudflare Access headers) change the same files for other fields. They are independent; the second one to merge needs a rebase.""",
"what": [
"One list of credential header and field names (the existing credential headers plus `X-Paperclip-Tool-Gateway-Token` and the gateway token fields) drives the pino redact paths (request headers, response headers, top-level fields) and the name-based field redactor, in any separator spelling.",
"The HTTP serializers redact credential-shaped headers on both the request and the response.",
"`logMethod` and `streamWrite` hooks redact credential fields and remove credential text from messages and string fields: `Bearer` values, `Basic` and `Digest` values after an `Authorization` label, minted gateway tokens, and credential query parameters. Ordinary words such as \"digest mismatch\" stay.",
"The `err` serializer folds the cause chain first, then sanitizes it, with a bounded walk. An error that cannot be read is logged as unreadable instead of aborting the log call.",
"Live HTTP objects are logged as a content-free summary.",
"Only the log path changes. API responses, including the error responses of secret-sensitive routes, are unchanged.",
"Tests in `server/src/__tests__/http-log-redaction.test.ts` capture real pino output and check every path above with sentinel tokens.",
],
"risks": [
"The header pattern over-matches on purpose (for example any header with `token` or `secret` in its name). Such headers are logged as `[Redacted]`. Diagnostic headers such as `x-paperclip-run-id` stay visible.",
"Every log record passes through one more redaction step, which also scans its string values. The walk is bounded.",
"A string field whose text looks like `Bearer <word>` is redacted unless the word is a known placeholder or prose word. This can hide a harmless word in a log line, never a credential.",
],
},
{
"id": "06",
"branch": "pr/06-approval-stage-return-assignee",
"title": "fix(server): honor approval-stage returnAssignee participant selection",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"An issue can run through review and approval stages, each with its own participants.",
"When a stage approves with a comment, Paperclip picks a participant for the next stage and excludes the return assignee.",
"When the next approval stage names only the return assignee, the selection is empty and the approval fails with `422`. Entering the workflow fails the same way for such a stage.",
"The workflow-start path auto-skips a review stage that only the return assignee could take; the approval path did not.",
"This pull request lets an approval stage fall back to the return assignee, and reuses the start-path review-stage skip on the approval path.",
"The benefit is that a valid workflow does not stop at `422`.",
],
"linked": """Fixes #4912.

#4912 suggests skipping such an approval stage. This pull request does not skip it: skipping would bypass an approval gate that the policy names. The named approver, here the return assignee, approves instead. A review stage that only the return assignee could take is skipped, as on the start path. If maintainers prefer the skip, the change is in `selectEligibleStageParticipant` and `canAutoSkipPendingStage`.

Related open pull requests:

- #5951 removes the return-assignee exclusion from one participant selection in the approved branch. This pull request supersedes #5951: it keeps the exclusion for review stages, and it applies the same skip traversal as the start path.
- #10960 rejects, when a policy is saved, approval stages whose only participant is excluded. That is a different answer to the same case: this pull request keeps such policies usable. Maintainers choose one. They do not conflict in code.
- #7967 and #4429 change the same selection function for other cases.""",
"what": [
"An approval stage falls back to the return assignee when the exclusion leaves nobody, on workflow start and on approval. Another approver named on the stage is still selected first. A review stage keeps the exclusion.",
"The approval path uses the same review-stage skip traversal as the workflow-start path, through one shared stage-assignment resolver. One approval lands on one assignable stage or completes the workflow.",
"Tests cover the transition logic and the `PATCH /api/issues/:id` route: return-assignee selection, a skipped self-review stage, consecutive skipped stages, and the first entry into an approval stage.",
],
"risks": [
"Behavior change: the return assignee can now be selected for an approval stage when nobody else is configured, on workflow start and after an approval. A review stage still never selects the return assignee.",
"Re-selecting a participant after a policy edit, and an active stage without a recorded participant, keep the exclusion as on master.",
],
},
]
