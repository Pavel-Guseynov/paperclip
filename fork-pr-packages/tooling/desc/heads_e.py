HEADS_E = [
{
"id": "13",
"doc_name": "13-pnpm-11-toolchain.md",
"branch": "stable/v2026.916.1/chore/pnpm-11-toolchain",
"title": "refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827)",
"stack": ("pr/33-pr-workflows-read-pnpm-version-from-package-json", "Pull request 33-pr-workflows removes the hardcoded `version: 9.15.4` input from `pnpm/action-setup` in `.github/workflows/pr-trusted.yml` on `master`, so PR CI installs the declared `packageManager` dynamically."),
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The repository build toolchain and package management rely on pnpm workspaces.",
"Upstream issue #8827 tracks migrating the toolchain from pnpm 9 to pnpm 11 to align with modern Node runtime expectations and faster deterministic installations.",
"pnpm 11 establishes `pnpm-workspace.yaml` as the sole authority for package overrides, patched dependencies, and build permissions, removing configuration from `package.json#pnpm`.",
"This pull request migrates the root and workspace configurations, GitHub Actions workflows, Dockerfile setup, worktree provisioning scripts, and documentation prerequisites to pnpm 11.27.0.",
"Following the repository rule that CI owns lockfile updates, `pnpm-lock.yaml` is not part of this diff.",
"The benefit is a modern, faster, and more secure toolchain with explicit build script controls (`allowBuilds`) and deterministic peer resolution.",
],
"linked": """Fixes: #8827

Related open pull requests:
- #13894 is this pull request on upstream (`paperclipai/paperclip#13894`).
- `pr/33-pr-workflows-read-pnpm-version-from-package-json` is the prerequisite workflow PR that lets `.github/workflows/pr-trusted.yml` read `package.json#packageManager` instead of hardcoding `version: 9.15.4`.""",
"what": [
"`packageManager` in `package.json` is `pnpm@11.27.0`; the obsolete root `pnpm` block in `package.json` is removed.",
"`pnpm-workspace.yaml` holds `autoInstallPeers: false`, `patchedDependencies`, `overrides`, and an explicit `allowBuilds` policy permitting the needed binaries (`@embedded-postgres/*`, `esbuild`, `opencode-ai`) and denying other build scripts.",
"`pnpm/action-setup` is pinned to `11.27.0` across non-reusable workflow files, and `pr-trusted.yml` omits the `version` input so `pnpm/action-setup` reads `package.json#packageManager`; `check:pnpm-version` and its unit test run in the `policy` job.",
"`scripts/check-pnpm-version-policy.mjs` validates manifest, workspace configuration, workflow pins, Dockerfile, and tracked-file references.",
"`scripts/provision-worktree.sh` reads patched dependencies from both `pnpm-workspace.yaml` and legacy `package.json#pnpm`, and `scripts/prepare-bundled-package.mjs` reads patched dependencies from `pnpm-workspace.yaml` with safe `JSON.stringify` workspace overrides in `check-clean-consumers.mjs`.",
"Prerequisite references in `README.md`, `cli/README.md`, `doc/DEVELOPING.md`, `docs/start/*`, and runner tutorials move from pnpm 9 to pnpm 11.27+.",
],
"risks": [
"The explicit `allowBuilds` policy blocks arbitrary install-time scripts; a new native dependency must be declared in `pnpm-workspace.yaml`.",
"Local developers need pnpm 11.27+ (`corepack enable` or `npm install -g pnpm@11.27.0`).",
"PR CI jobs in `pr-trusted.yml@master` fail at Setup pnpm until the prerequisite workflow PR merges into `master`.",
],
},
{
"id": "32",
"doc_name": "32-optional-native-runner-binary.md",
"branch": "pr/32-optional-native-runner-binary",
"title": "feat(build): allow skipping native runner binary compilation via PAPERCLIP_SKIP_RUNNER_BINARY",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The root `pnpm build` and the server's `prepare:runner-vendor` step always compile and stage the Rust native runner binary (`paperclip-runnerd`).",
"Deployments and packaging environments that run only legacy CLI/API adapters still need to build the server, UI, CLI, and TypeScript workspace packages without installing a Rust toolchain.",
"Without an opt-out flag, `pnpm build` fails with `spawnSync cargo ENOENT` whenever `cargo` and `rustc` are absent.",
"This pull request adds `PAPERCLIP_SKIP_RUNNER_BINARY=1` to skip compiling and staging `paperclip-runnerd` while still building and vendoring the runner's TypeScript output.",
"The benefit is that operators and packagers who do not use the Rust native runner can build Paperclip without a Rust toolchain, while the default build remains unchanged.",
],
"linked": """No issue exists. Issue description (feature):

**Problem or motivation**
Building Paperclip from source always invokes `cargo build --release` for `paperclip-runnerd`, even when a deployment only uses TypeScript adapters and has no Rust toolchain installed.

**Proposed solution**
Honor `PAPERCLIP_SKIP_RUNNER_BINARY` (`1`, `true`, or `yes`, case-insensitive) in `packages/paperclip-runner/scripts/build-binary.mjs` and `server/package.json` so the TypeScript runner output builds and vendors cleanly without Cargo, while selecting a native-runtime provider without the binary fails explicitly with `paperclip_runner_binary_missing`.

**Alternatives considered**
Patching `package.json` scripts downstream during packaging, which duplicates build logic and drifts on upstream updates.

**Roadmap alignment**
Build and packaging ergonomics for existing runtime modes; adds no new product surface.

No related open pull request was found.""",
"what": [
"`packages/paperclip-runner/scripts/build-binary.mjs` checks `PAPERCLIP_SKIP_RUNNER_BINARY` (`1`, `true`, `yes`, case-insensitive). When set, it skips Cargo compilation and binary staging and removes any stale `dist/bin` directory.",
"`server/package.json` clears `dist/vendor/paperclip-runner` before copying the runner's `dist` output so stale vendored binaries are never retained when skipping the binary build.",
"When `PAPERCLIP_SKIP_RUNNER_BINARY` is unset or `0`/`false`, the default `pnpm build` compiles and stages `paperclip-runnerd` unchanged.",
"Selecting a native-runtime provider when the binary was not built fails explicitly with `paperclip_runner_binary_missing`.",
"`README.md`, `doc/DEVELOPING.md`, `docs/deploy/environment-variables.md`, `docs/start/quickstart.md`, and `packages/paperclip-runner/README.md` document the option.",
"Unit and integration tests verify both `build-binary.mjs` modes and the explicit missing-binary error on native-runtime execution.",
],
"risks": [
"Default behavior is unchanged when `PAPERCLIP_SKIP_RUNNER_BINARY` is not set.",
"A deployment built with `PAPERCLIP_SKIP_RUNNER_BINARY=1` cannot run native-runtime providers (`acpx`, `claude_managed`, `aws_agentcore`) until rebuilt without the flag or pointed at a `PAPERCLIP_RUNNER_BINARY`.",
],
},
{
"id": "33",
"doc_name": "33-recover-stale-execution-and-finalization.md",
"branch": "fix/recover-stale-execution-and-finalization",
"title": "fix(recovery): preserve unknown action outcomes and allow explicit board reconciliation of settled holds",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"When an agent run is interrupted after starting a side-effecting action whose completion is unknown, legacy execution recovery places a reconciliation hold (`legacy_execution_requires_reconciliation`) on the issue.",
"Once automatic recovery settles that action with `replay = 'blocked'`, the recovery action row is no longer `active`, yet `executionBlocker` remains on the issue.",
"Calling `POST /api/issues/:id/recovery-actions/resolve` without an active row returned `404 Active recovery action not found`, leaving the issue stranded in `todo` with no way for the board to resolve the hold and wake the assignee.",
"This pull request preserves unknown action outcomes in the durable receipt and prompt envelope, and lets the canonical resolution route resolve the settled reconciliation hold under the issue lock once the source run is terminal and stopped.",
"The benefit is that interrupted runs never fake an unknown action outcome and the board can cleanly reconcile settled holds to resume work.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
An interrupted run left `executionBlocker.cause = "legacy_execution_requires_reconciliation"` on an issue after automatic recovery settled the recovery action with `replay = "blocked"`. Calling `POST /api/issues/:id/recovery-actions/resolve` returned `404 Active recovery action not found`, and the issue stayed stranded in `todo` with no run.

**Expected behavior**
Unknown action outcomes remain explicitly marked unknown, and `POST /api/issues/:id/recovery-actions/resolve` resolves the settled reconciliation hold when the source run is terminal and stopped, clearing the stale blocker and waking the assignee once.

**Steps to reproduce**
1. Interrupt a run that has a started action with an unknown outcome so recovery settles the action with `replay = "blocked"`.
2. Call `POST /api/issues/:id/recovery-actions/resolve` with `executionReconciliation` to clear the hold.
3. Observe `404 Active recovery action not found` on master.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

Related pull requests: builds on the continuation recovery work in #15024 and #15033 (already on `master`). No open duplicate pull request was found.""",
"what": [
"Unknown action outcomes remain `unknown` in the durable recovery receipt and the continuation prompt envelope instead of being coerced into failed or succeeded outcomes.",
"`POST /api/issues/:id/recovery-actions/resolve` locates the settled recovery action referenced by `executionBlocker.recoveryActionId` under the issue lock when board-owned `executionReconciliation` is submitted.",
"Resolution verifies that the source run is terminal and has no live process or active lease, preserves prior automatic-recovery audit history, clears the stale blocker, and delivers one idempotent fresh continuation wake.",
"Repeated resolution repairs pending wake delivery and rejects a live provider, mismatched source run, missing termination evidence, or contradictory outcome.",
"Tests in `server/src/__tests__/issue-execution-reconciliation.test.ts` and `conversation-continuation.test.ts` verify unknown-outcome preservation, settled-hold resolution, idempotent retry, and live-run rejection on PostgreSQL.",
],
"risks": [
"Reconciliation still refuses to clear a hold while the source run is active or its local process is still alive.",
],
},
{
"id": "33-pr-workflows",
"doc_name": "33-pr-workflows-read-pnpm-version-from-package-json.md",
"branch": "pr/33-pr-workflows-read-pnpm-version-from-package-json",
"title": "ci(workflows): let PR workflows install declared pnpm version from package.json",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The repository's trusted pull request workflow (`.github/workflows/pr.yml`) invokes `.github/workflows/pr-trusted.yml@master` for security isolation.",
"In `pr-trusted.yml`, all 8 jobs running `pnpm/action-setup` hardcode `version: 9.15.4`.",
"When a pull request updates `package.json#packageManager` (such as #13894 migrating to pnpm 11), `pnpm/action-setup` throws `ERR_PNPM_BAD_PM_VERSION` because the action's `version` input conflicts with `package.json#packageManager`.",
"This pull request removes the hardcoded `version: 9.15.4` input from all 8 `pnpm/action-setup` steps in `pr-trusted.yml`.",
"The benefit is that `master` continues installing pnpm 9.15.4 from its `package.json` while pull requests that update `packageManager` run under their declared pnpm version.",
],
"linked": """Refs: #8827, #13894

Prerequisite workflow change for #13894 so `.github/workflows/pr-trusted.yml@master` reads `packageManager` from the checked-out `package.json`.""",
"what": [
"Removed the hardcoded `version: 9.15.4` input from all 8 `pnpm/action-setup` steps in `.github/workflows/pr-trusted.yml` (`policy`, `typecheck_release_registry`, `general_tests`, `verify_paperclip_runner`, `build`, `verify_serialized_server`, `canary_dry_run`, and `e2e_shards`).",
"All 8 jobs run `actions/checkout` before `pnpm/action-setup`, so `pnpm/action-setup` resolves the exact version from `package.json#packageManager`.",
],
"risks": [
"Low risk: `package.json` on `master` already declares `\"packageManager\": \"pnpm@9.15.4\"`, and release/publish workflows keep their explicit pins.",
],
},
{
"id": "37",
"doc_name": "37-codex-managed-mcp-approvals.md",
"branch": "fix/codex-managed-mcp-approvals",
"title": "fix(codex-local): set default_tools_approval_mode to approve on managed MCP servers",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The Codex local adapter writes Paperclip-managed MCP gateway entries into the agent's Codex configuration (`codex-home.ts`).",
"When Codex runs non-interactively with `approval_policy = 'never'`, Codex's own client-side tool approval check refuses write tool calls on MCP servers that do not set `default_tools_approval_mode = 'approve'`, before the request ever reaches Paperclip's governed tool gateway.",
"That client-side refusal prevents Paperclip's tool gateway from evaluating company policies or creating a human approval card on the issue thread.",
"This pull request sets `default_tools_approval_mode = 'approve'` on every Paperclip-managed MCP server entry in the managed configuration block while leaving unmanaged user MCP entries untouched.",
"The benefit is that governed MCP calls reach Paperclip's tool gateway, which remains the single authority for policy enforcement, denials, and human approval cards.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
Under `approval_policy = "never"`, Codex refused MCP write tool calls locally before sending them to Paperclip's managed MCP gateway, so Paperclip could neither allow policy-permitted calls nor create human approval cards for review-gated calls.

**Expected behavior**
Paperclip-managed MCP server entries in Codex's configuration set `default_tools_approval_mode = "approve"` so tool calls reach the governed Paperclip gateway, while unmanaged MCP server entries keep their user-configured approval mode.

**Steps to reproduce**
1. Configure a Codex agent with a Paperclip-managed MCP gateway and `approval_policy = "never"`.
2. Invoke a write tool through the managed MCP server.
3. Observe Codex refuse the tool call locally before contacting the Paperclip gateway.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.""",
"what": [
"`packages/adapters/codex-local/src/server/codex-home.ts` writes `default_tools_approval_mode = \"approve\"` on every Paperclip-managed MCP server entry (including `paperclip-assigned` and collision-renamed gateway entries) inside the managed config block.",
"Updating or removing the managed block updates or removes `default_tools_approval_mode` cleanly alongside the entry, and unmanaged MCP server entries outside the block preserve their own settings.",
"Paperclip's tool gateway remains the authority for tool permissions, automatic approvals, denials, and human approval cards.",
"Tests in `packages/adapters/codex-local/src/server/codex-home.test.ts` verify multiple named gateways, collision renaming, preservation of unmanaged `writes` entries, and complete removal of the managed block.",
],
"risks": [
"Applies only to Paperclip-managed MCP gateway entries (`paperclip-assigned` and named Paperclip gateways). Unmanaged MCP servers configured by the user keep their own approval mode.",
],
},
{
"id": "39",
"doc_name": "39-release-done-blocker-pending-finalize.md",
"branch": "fix/release-done-blocker-pending-finalize",
"title": "fix(issues): release done blockers whose last workspace operation run is terminal",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"When an issue finishes (`status = 'done'`), dependent issues wait until the blocker's workspace finalization completes (`listPendingFinalizeBlockerIssueIds`).",
"If the blocker's last heartbeat run recorded a `workspace_provision` or failed `workspace_finalize` operation and then terminated without writing a succeeded `workspace_finalize`, `listPendingFinalizeBlockerIssueIds` kept that `done` blocker in the pending-finalize set forever.",
"Every dependent issue stayed stuck in `pending_finalize` (`isDependencyReady: false`) with no active run to ever finish finalization.",
"This pull request holds a `done` blocker in `pending_finalize` only while the heartbeat run that owns its latest workspace operation is still live (`queued`, `claimed`, or `running`).",
"The benefit is that a `done` blocker whose last workspace run has already terminated no longer deadlocks its dependent issues.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
A blocker issue reached `done`, and its heartbeat run terminated after recording a workspace operation without a final succeeded `workspace_finalize`. Dependent issues remained stuck in `workspace_finalize_pending` indefinitely and never dispatched.

**Expected behavior**
`listPendingFinalizeBlockerIssueIds` holds a `done` blocker in `pending_finalize` only while the heartbeat run owning its latest workspace operation is still live; once that run is terminal or absent, dependents are released.

**Steps to reproduce**
1. Create blocker Issue A and dependent Issue B (`blockedBy: [A]`).
2. Record a `workspace_provision` operation for Issue A's workspace on a run that then finishes, and transition Issue A to `done`.
3. Inspect dependency readiness for Issue B: on master, Issue A remains in `pendingFinalizeBlockerIssueIds` forever.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.""",
"what": [
"`listPendingFinalizeBlockerIssueIds` in `server/src/services/issues.ts` checks the status of the heartbeat run that owns the latest workspace operation on a `done` blocker's execution workspace.",
"When that owning run is terminal (`succeeded`, `failed`, `cancelled`, `timed_out`, `interrupted`) or missing, the `done` blocker is no longer reported as pending finalization, releasing its dependent issues.",
"When a live run still owns the latest unfinalized workspace operation, the blocker remains in `pendingFinalizeBlockerIssueIds` until the run finishes.",
"Tests in `server/src/__tests__/issues-service.test.ts` verify that a `done` blocker with a terminal or missing workspace-operation run releases its dependents while a live run still holds them.",
],
"risks": [
"Low risk: only `done` blockers whose latest workspace operation belongs to a non-live run are released; active runs still gate dependents until finalization.",
],
},
{
"id": "40",
"doc_name": "40-recreate-unregistered-managed-worktree.md",
"branch": "fix/recreate-unregistered-managed-worktree",
"title": "fix(workspace-runtime): recreate managed worktree directories no longer registered in git",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The `git_worktree` workspace runtime realizes isolated task worktrees under Paperclip's managed worktrees directory.",
"When a managed worktree directory still exists on disk (for example after an interrupted cleanup or manual `git worktree prune`) but is no longer registered in `git worktree list`, `realizeGitWorktree` refused the path and threw `already exists and is not a reusable git worktree`.",
"That left the task unable to start any run without manual filesystem cleanup on the host.",
"This pull request removes an unregistered directory inside the managed worktree root, records the removal as a `worktree_prepare` operation, and recreates the worktree on the task branch.",
"The benefit is that managed task worktrees self-heal cleanly when git's worktree registry and the managed directory drift out of sync.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
When a managed worktree directory existed on disk but was no longer listed in `git worktree list`, workspace setup failed with `already exists and is not a reusable git worktree`.

**Expected behavior**
If the path is inside Paperclip's managed worktree root and is not registered in `git worktree list`, Paperclip removes the stale directory, records a `worktree_prepare` operation, and recreates the worktree on the task branch.

**Steps to reproduce**
1. Create a task worktree under the managed worktrees root.
2. Remove its registration from `.git/worktrees` (or run `git worktree prune` after moving metadata) while leaving the directory on disk.
3. Run workspace realization for the task and observe setup fail with `already exists and is not a reusable git worktree`.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.""",
"what": [
"In `server/src/services/workspace-runtime.ts`, when a managed `git_worktree` target path exists on disk but is absent from `git worktree list`, Paperclip removes the stale directory, records the cleanup as a `worktree_prepare` operation, and recreates the worktree attached to the task branch.",
"Paths outside the managed worktree root keep the existing safety rejection.",
"A regression test in `server/src/__tests__/workspace-runtime.test.ts` creates an unregistered managed worktree directory and verifies that realization removes it, records `worktree_prepare`, and re-attaches the existing task branch.",
],
"risks": [
"Only directories inside Paperclip's managed worktree root that `git worktree list` does not register are removed; user-owned checkouts outside the managed root are never deleted.",
],
},
{
"id": "42",
"doc_name": "42-keep-connection-healthy-on-oversized-response.md",
"branch": "fix/keep-connection-healthy-on-oversized-response",
"title": "fix(tool-gateway): keep remote MCP connection healthy when one response exceeds size limit",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The MCP tool gateway enforces a 1,000,000-byte response size limit (`MAX_REMOTE_MCP_RESPONSE_BYTES`) on remote MCP HTTP and SSE responses.",
"When a single tool or context call returned a valid HTTP 200 response whose payload exceeded 1 MB, the gateway classified the `mcp_remote_response_too_large` error as a connection fault and marked the entire connection `error`.",
"Marking the connection `error` hid all of its tools from discovery (`tool_not_found`) even though the remote server and credentials were healthy.",
"This pull request fails only the oversized tool or context call with HTTP 502 `mcp_remote_response_too_large` while keeping the connection `healthStatus = 'ok'` and preserving its cached MCP session.",
"The benefit is that one large tool output does not take down a healthy MCP connection for subsequent calls.",
],
"linked": """No issue exists. Issue description (bug):

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

No related open pull request was found.""",
"what": [
"`server/src/services/mcp-http.ts` rejects declared `Content-Length` overflow before consuming body bytes, measures UTF-8 byte length across JSON and SSE responses, cancels/releases streamed overflow immediately, and attaches `maxBytes` and `responseBytes` to `McpHttpResponseError`.",
"`server/src/services/tool-gateway.ts` returns HTTP 502 with `mcp_remote_response_too_large`, `maxBytes`, `responseBytes`, and the tool/context identifiers when a tool or context response (`resources/list`, `resources/read`, `prompts/list`, `prompts/get`, and their `paperclip_*` wrappers) exceeds the limit.",
"On an oversized HTTP-success response, the gateway keeps `healthStatus: \"ok\"`, clears stale `lastError`, and preserves the authenticated MCP session headers. Genuine auth, HTTP status, transport, and protocol faults still mark the connection unhealthy.",
"Tests in `server/src/__tests__/mcp-http.test.ts` and `tool-gateway.test.ts` cover declared and streamed JSON/SSE overflow, UTF-8 multibyte measurement, session reuse on the next call, all four context actions and wrappers, and genuine fault controls.",
],
"risks": [
"The 1,000,000-byte response limit itself is unchanged; only the connection health transition for an HTTP-success payload overflow changes.",
],
},
{
"id": "45",
"doc_name": "45-mcp-unsupported-method-errors.md",
"branch": "fix/mcp-unsupported-method-errors",
"title": "fix(tool-gateway): return JSON-RPC -32601 with HTTP 200 for unsupported MCP methods",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"MCP clients talk JSON-RPC 2.0 over HTTP to Paperclip's public (`/mcp/gateways/:gatewayId`) and managed (`/api/tool-gateway/gateways/:gatewayId/mcp`) named gateway endpoints.",
"When an authenticated MCP client sent an unsupported JSON-RPC request method (such as `ping`, `Logging/SetLevel`, or `completion/complete`) or an unsupported notification (such as `notifications/cancelled`), the gateway returned HTTP 404 instead of an HTTP 200 JSON-RPC `-32601 Method not found` response or HTTP 202 for a notification.",
"Streamable HTTP MCP clients treat HTTP 404 on the endpoint as a missing server or broken transport rather than a JSON-RPC method-not-found error.",
"This pull request verifies the gateway credential first, returns HTTP 202 for unsupported id-less notifications and HTTP 200 with JSON-RPC `-32601` and the caller's `id` for unsupported requests, and records the sanitized `mcpMethod` in the request completion log.",
"The benefit is that standard MCP clients handle unsupported optional methods and notifications gracefully without dropping the gateway connection.",
],
"linked": """No issue exists. Issue description (bug):

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

No related open pull request was found.""",
"what": [
"On both named gateway MCP endpoints (`server/src/routes/tool-gateway.ts`), unsupported methods first run non-consuming gateway credential verification so unauthenticated requests still get HTTP 401.",
"An authenticated unsupported notification (where `id` is absent) returns an empty HTTP 202 response.",
"An authenticated unsupported request (with string, number, or `null` `id`) returns HTTP 200 with JSON-RPC 2.0 error `-32601` (`Method not found: <method>`) and the caller's exact `id`.",
"`server/src/middleware/logger.ts` logs the sanitized `mcpMethod` from `res.locals` on request completion without logging request arguments or bearer tokens.",
"Tests in `server/src/__tests__/tool-gateway.test.ts` cover both endpoints, string/numeric/null IDs, notifications, unauthenticated requests, and pino-http log output.",
],
"risks": [
"Low risk: supported MCP methods (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`) keep their existing dispatch paths.",
],
},
{
"id": "46",
"doc_name": "46-run-scoped-mcp-gateway-credentials.md",
"branch": "fix/run-scoped-mcp-gateway-credentials",
"title": "fix(codex-local): isolate per-run MCP gateway credentials in run-scoped Codex profiles",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"When a Codex local run starts with managed MCP gateways, Paperclip mints run-scoped gateway bearer tokens and revokes them as soon as that run finishes.",
"Previously, `prepareCodexHome` wrote those run-scoped bearer tokens directly into the shared `[mcp_servers.*]` blocks of `$CODEX_HOME/config.toml`.",
"When two runs shared a Codex home (or a second run prepared its home while another run was finishing), one run overwrote or read the other run's bearer token, and ending one run caused the still-running run to present a revoked token (`gateway_token_revoked`).",
"This pull request isolates each run's managed MCP server URL and bearer headers inside a run-scoped Codex profile (`--profile paperclip-run-<id>`) in a mode-`0600` config that is cleaned up when the run exits, and logs subject/presenter run attribution on `named_gateway_auth_failed`.",
"The benefit is that overlapping Codex runs never clobber or inherit each other's revoked MCP gateway tokens.",
],
"linked": """No issue exists. Issue description (bug):

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

No related open pull request was found.""",
"what": [
"`packages/adapters/codex-local/src/server/codex-home.ts`, `codex-args.ts`, and `execute.ts` isolate each run's managed MCP gateway configuration inside a dedicated run-scoped profile (`paperclip-run-<runId>`) passed via `--profile`, merging any operator-configured base profile settings and removing the run profile on exit.",
"File locks serialize concurrent `config.toml` updates within the same Codex home using `0600` permissions.",
"`server/src/services/tool-gateway.ts` enriches `named_gateway_auth_failed` audit/log records with token subject type/ID, subject run ID/status, and presenting-run header attribution (`client_header`) without exposing bearer material.",
"Tests across `codex-home.test.ts`, `codex-local-execute.test.ts`, `execute.remote.test.ts`, and `tool-gateway.test.ts` prove that overlapping runs keep separate tokens, a live run succeeds after a peer run finishes and revokes its token, and the ended run's token stays rejected.",
],
"risks": [
"Run-scoped profile entries in `config.toml` are removed in a `finally` block when the child process exits; stale run profiles from a hard server crash are pruned on the next `prepareCodexHome` pass.",
],
},
{
"id": "47",
"doc_name": "47-mcp-remote-event-stream-tool-calls.md",
"branch": "fix/mcp-remote-event-stream-tool-calls",
"title": "fix(tool-gateway): complete SSE remote MCP calls on matching response ID and use 30s default timeout",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Remote Streamable HTTP MCP servers often reply to `tools/call` with `Content-Type: text/event-stream` (SSE) and keep the SSE stream open after sending the JSON-RPC response frame, or take longer than 10 seconds to finish a tool call.",
"Previously, `mcp-http.ts` waited for the remote server to close the HTTP response body (EOF) before parsing SSE frames, and `remote-http-fetch.ts` defaulted every remote fetch without an explicit timeout to 10,000 ms.",
"As a result, SSE responses on persistent streams hung until the deadline and then failed with `Error: aborted` (misclassified as a transport `error` instead of `tool_timeout`), marking the connection `error`.",
"This pull request completes SSE body reading as soon as the `data:` frame matching the request's JSON-RPC `id` arrives, raises the default remote MCP call timeout to 30,000 ms, classifies deadline aborts (`Error: aborted` / `ECONNRESET` after deadline) as `504 tool_timeout` with `degraded` health, and records stream progress and sanitized error cause chains in call metadata.",
"The benefit is that Streamable HTTP MCP servers over direct HTTP(S) or `socks5h` complete immediately on matching SSE responses and report accurate timeout diagnostics.",
],
"linked": """No issue exists. Issue description (bug):

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

No related open pull request was found.""",
"what": [
"`server/src/services/mcp-http.ts` parses SSE `data:` events incrementally as chunks arrive and resolves immediately when a JSON-RPC message matching the request `id` is observed, cancelling and releasing the reader without waiting for EOF.",
"`server/src/services/remote-http-fetch.ts` exports `DEFAULT_REMOTE_MCP_TIMEOUT_MS = 30_000`, which `tool-gateway.ts` uses when a remote MCP call does not specify an explicit timeout (explicit timeouts remain clamped to `1..60_000` ms).",
"One call-owned deadline controller covers session initialization and body consumption; if the call deadline expires while reading the body (`Error: aborted` / `ECONNRESET`), `tool-gateway.ts` classifies it as `504 tool_timeout` (`invocation_timeout`) with `degraded` health, while genuine peer resets before the deadline remain transport failures.",
"`toolCallEvents.metadata.execution` and activity audit details record `execution.stream` counters (bytes, chunks, parsed SSE events, matched response ID, EOF) and a redacted error cause chain.",
"Tests in `mcp-http.test.ts`, `tool-gateway.test.ts`, and `remote-mcp-socks-proxy.test.ts` verify open-ended SSE completion, 30s default timeout, deadline abort vs peer reset classification, and stream progress evidence over both direct HTTP and SOCKS5.",
],
"risks": [
"Default timeout for remote MCP calls without an explicit timeout increases from 10s to 30s; other remote HTTP fetches keep the 10s default.",
],
},
{
"id": "48",
"doc_name": "48-concurrent-worktree-realization.md",
"branch": "fix/concurrent-worktree-realization",
"title": "fix(workspace-runtime): serialize per-repo git worktree mutations and configure explicit upstream tracking",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"When multiple agent runs start or clean up task worktrees against the same repository at the same time, concurrent `git worktree` and `git config` subprocesses race on `.git/config.lock` and worktree metadata.",
"In addition, `git worktree add -b <branch> <path> <remote>/<base>` sets implicit upstream tracking pointing the new task branch's `branch.<name>.merge` at `refs/heads/<base>` instead of the task branch itself (`refs/heads/<branch>`), or leaves partial tracking if interrupted.",
"This pull request serializes worktree realization, restoration, and cleanup through an in-process queue keyed by canonical `repoRoot`, passes `--no-track` on fresh branch creation, configures explicit `branch.<name>.remote` and `branch.<name>.merge` transactionally (rolling back on failure), and repairs missing/partial upstream config on existing owned branches.",
"The benefit is that concurrent worktree starts on the same repository never fail with lock collisions and every task branch gets deterministic upstream tracking.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
Concurrent runs realizing or cleaning up worktrees in the same repository raced on Git locks and config writes, and newly created task branches inherited implicit tracking to the base branch ref (`refs/heads/main`) or partial tracking when interrupted.

**Expected behavior**
Worktree mutations for the same canonical `repoRoot` serialize through a per-repository queue while different repositories run in parallel, fresh branches disable implicit tracking (`--no-track`) and configure explicit upstream remote/merge transactionally with rollback on failure, and existing branches repair missing or partial upstream config while preserving recorded ownership.

**Steps to reproduce**
1. Trigger two concurrent `realizeExecutionWorkspace` calls for different tasks sharing the same local git repository and remote base ref.
2. Observe concurrent `git worktree` / `git config` mutations race and inspect `branch.<task>.merge` on the created branch.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.""",
"what": [
"`server/src/services/workspace-runtime.ts` serializes worktree realization, persisted-worktree restoration, and Git cleanup per canonical `repoRoot` (resolved via `resolvePathForWorktreeComparison`), releasing the queue slot on both success and failure while allowing different repositories to run concurrently.",
"Fresh task-branch creation passes `--no-track` to `git worktree add` and explicitly sets `branch.<branch>.remote` and `branch.<branch>.merge = refs/heads/<branch>` inside the repository queue, rolling back the newly created worktree and branch if upstream configuration fails (surfacing both errors via `AggregateError` if rollback also fails).",
"Existing worktrees repair missing or partial `remote`/`merge` configuration before returning, while preserving complete upstream configuration and recorded `createdByRuntime` ownership metadata.",
"Eleven regression tests in `server/src/__tests__/workspace-runtime.test.ts` cover symlinked `repoRoot` aliases, concurrent starts, missing/partial/complete upstream tracking, transactional rollback, `AggregateError` reporting, independent repositories, owned-branch recreation, and unavailable remote base refs.",
],
"risks": [
"Worktree git operations on the same canonical repository now execute sequentially within one server process; worktrees in different repositories continue to realize in parallel.",
],
},
{
"id": "49",
"doc_name": "49-unchanged-unblock-descriptor-deduplication.md",
"branch": "fix/unchanged-unblock-descriptor-deduplication",
"title": "fix(issues): deduplicate owner notifications when re-entering blocked with an unchanged self-owned unblockDescriptor",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"When an agent blocks its own task with a self-owned `unblockDescriptor`, Paperclip records a blocked notification episode (`blockedTransitionAt`, `blockedOwnerNotifiedAt`) and notifies the owner once.",
"When that agent wakes up (for example on a checkout that temporarily moves the issue to `in_progress`) and finishes its turn still blocked for the exact same reason, it patches `status = 'blocked'` with the same self-owned `unblockDescriptor`.",
"Previously, `issueService.update` treated that `in_progress -> blocked` transition as a brand-new blocked episode, resetting `blockedTransitionAt` and clearing `blockedOwnerNotifiedAt`, which fired another owner notification wake and created an infinite self-wake loop.",
"This pull request compares the incoming self-owned `unblockDescriptor` (by `owner` and `action`, independent of JSON key order) against the persisted episode preserved across checkout: when unchanged, it retains `blockedTransitionAt` and `blockedOwnerNotifiedAt` so no duplicate owner wake is enqueued; when changed, it opens a fresh episode and notifies once.",
"The benefit is that agents re-recording the same self-owned blocker after a checkout turn do not trigger redundant wakeup loops.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
An agent checked out its blocked issue (moving it to `in_progress` while preserving `unblockDescriptor` and `blockedTransitionAt`), determined the blocker was still unresolved, and patched `status: "blocked"` with the identical self-owned `unblockDescriptor`. `issueService.update` reset `blockedTransitionAt` and cleared `blockedOwnerNotifiedAt`, enqueueing a duplicate `routable_blocked_owner` wakeup on every turn.

**Expected behavior**
Re-entering `blocked` with an unchanged self-owned `unblockDescriptor` preserves the existing `blockedTransitionAt` and `blockedOwnerNotifiedAt` episode so no duplicate owner notification is sent, while a changed `unblockDescriptor` or an undelivered notification still notifies once.

**Steps to reproduce**
1. Have an assigned agent transition its issue to `blocked` with a self-owned `unblockDescriptor` (`owner: { kind: "agent", agentId }`, `action: "await_dependency"`), delivering the initial owner notification.
2. Check out the issue as that agent (`in_progress`) and then patch `status: "blocked"` with the same `unblockDescriptor`.
3. Observe a second `routable_blocked_owner` wakeup enqueued for the same unchanged episode.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.""",
"what": [
"`server/src/services/issues.ts` normalizes and compares `unblockDescriptor` by `owner` and `action` (independent of JSON property order) inside the issue update transaction.",
"When an issue re-enters `blocked` (or updates while `blocked`) with the same self-owned `unblockDescriptor` and an existing `blockedTransitionAt` episode, `issueService.update` retains `blockedTransitionAt` and `blockedOwnerNotifiedAt` instead of starting a new episode.",
"When `unblockDescriptor` changes while `blocked` (or on re-entry), `issueService.update` starts a fresh episode (`blockedTransitionAt = now`, `blockedOwnerNotifiedAt = null`) so `notifyRoutableBlockedOwner` in `server/src/services/routable-blocked.ts` notifies the agent owner once under the new episode stamp.",
"If a prior episode never recorded `blockedOwnerNotifiedAt` (for example delivery failed before receipt), the retained episode still attempts notification delivery.",
"Seven HTTP/PostgreSQL regression tests in `server/src/__tests__/issues-service.test.ts` cover unchanged re-block after checkout, key-order invariance, changed descriptors, descriptor-only updates while blocked, undelivered notification retry, and dependency-ready wake deduplication.",
],
"risks": [
"Leaving `blocked` through a normal non-checkout status update still clears `unblockDescriptor`, `blockedTransitionAt`, and `blockedOwnerNotifiedAt` as before.",
],
},
]
