# Proposed upstream pull requests

One document per pull request head on this fork. Every head is based on
`paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`, directly or through the
prerequisite named in its row. Each document gives the exact head and base, the
own diff, and the pull request body to copy.

`evidence/environment.md` lists the failures that the unmodified upstream base
shows too, with the base output. `evidence/tests/` holds each head's test run
against the base's production code (`*-fail-on-base.log`) and on the head
(`*-pass-on-head.log`). `evidence/runs/` holds the gate and suite summaries of
the base, of fork main, and of every head run for its current SHA. `tooling/`
holds the scripts and notes used to rebuild and verify the heads.

| Branch | Head | Base commit | Prerequisite | Title |
| --- | --- | --- | --- | --- |
| [`pr/01-codex-managed-mcp-auth`](pr/01-codex-managed-mcp-auth.md) | `e040a813460a` | `467125fafb47` | — | fix(server): authenticate managed MCP lifecycle requests |
| [`pr/02-tool-gateway-session-token-verification`](pr/02-tool-gateway-session-token-verification.md) | `9c2d0afb5577` | `467125fafb47` | — | fix(tool-gateway): verify session bearer tokens on session routes |
| [`pr/02b-session-routes-reject-gateway-tokens`](pr/02b-session-routes-reject-gateway-tokens.md) | `2e1d722161ad` | `467125fafb47` | — | fix(tool-gateway): reject named gateway tokens on session routes |
| [`pr/03-codex-runtime-api-reachability`](pr/03-codex-runtime-api-reachability.md) | `6d2f7c7c1f1b` | `467125fafb47` | — | fix(runtime): use the internal API origin for agent callbacks |
| [`pr/04-remote-mcp-timeout-health`](pr/04-remote-mcp-timeout-health.md) | `59442b8551f9` | `467125fafb47` | — | fix(tool-gateway): distinguish call timeouts from connection failure |
| [`pr/04b-refuse-ambiguous-timeout-replay`](pr/04b-refuse-ambiguous-timeout-replay.md) | `75300f36c3c0` | `59442b8551f9` | `pr/04-remote-mcp-timeout-health` | fix(tool-access): refuse idempotent replay of an ambiguous timed-out write |
| [`pr/05-tool-gateway-token-log-redaction`](pr/05-tool-gateway-token-log-redaction.md) | `fce03a0fd076` | `467125fafb47` | — | fix(logger): redact gateway credentials across log output |
| [`pr/06-approval-stage-return-assignee`](pr/06-approval-stage-return-assignee.md) | `41a994f6aeca` | `467125fafb47` | — | fix(server): honor approval-stage returnAssignee participant selection |
| [`pr/07-retry-skipped-review-handoff`](pr/07-retry-skipped-review-handoff.md) | `787ebba3b4ed` | `467125fafb47` | — | fix(server): retry a skipped review handoff after its blocker clears |
| [`pr/08-workspace-validation-recovery-precedence`](pr/08-workspace-validation-recovery-precedence.md) | `ff4781f721ae` | `467125fafb47` | — | fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures |
| [`pr/11-native-runner-darwin-lsof-unicode`](pr/11-native-runner-darwin-lsof-unicode.md) | `51039264b5ae` | `467125fafb47` | — | fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode |
| [`pr/12-workspace-runtime-exposure-isolation`](pr/12-workspace-runtime-exposure-isolation.md) | `1c0f151d7d49` | `467125fafb47` | — | test(server): isolate workspace runtime port reservations between tests |
| [`pr/13-pnpm-11-toolchain`](pr/13-pnpm-11-toolchain.md) | `4a4d2e1624c7` | `ffe5e9e2a886` | `pr/33-pr-workflows-read-pnpm-version-from-package-json` | refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827) |
| [`pr/14-tool-gateway-client-safe-tool-names`](pr/14-tool-gateway-client-safe-tool-names.md) | `85d28bc44db4` | `a213e96f2fa5` | `pr/16-tool-profile-tool-name-identity` | fix(tool-gateway): assign client-safe tool names and keep legacy names working |
| [`pr/15-tool-gateway-context-tools-token-actions`](pr/15-tool-gateway-context-tools-token-actions.md) | `6fdf1f6ce359` | `467125fafb47` | — | fix(tool-gateway): gate context tools and capabilities by token allowedActions |
| [`pr/16-tool-profile-tool-name-identity`](pr/16-tool-profile-tool-name-identity.md) | `a213e96f2fa5` | `467125fafb47` | — | fix(tool-access): use the catalog tool name as the tool_name selector identity |
| [`pr/19-stage-decision-keeps-calling-run`](pr/19-stage-decision-keeps-calling-run.md) | `3ddbeec5efc4` | `467125fafb47` | — | fix(issues): do not cancel the calling run when recording a stage decision |
| [`pr/20-conversation-continuation`](pr/20-conversation-continuation.md) | `f50e8f96ace3` | `467125fafb47` | — | fix(conversation): let adapters declare conversation continuation |
| [`pr/21-shutdown-waits-for-adapter-run-stops`](pr/21-shutdown-waits-for-adapter-run-stops.md) | `db03108b7103` | `467125fafb47` | — | fix(server): let graceful shutdown wait for in-flight adapter runs |
| [`pr/22-release-cancelled-interrupted-run-leases`](pr/22-release-cancelled-interrupted-run-leases.md) | `60b708bb7ccf` | `467125fafb47` | — | fix(heartbeat): release leases of runs that end without an executor |
| [`pr/22b-guard-environment-lease-release-on-live-runs`](pr/22b-guard-environment-lease-release-on-live-runs.md) | `0e7a3154e9f0` | `60b708bb7ccf` | `pr/22-release-cancelled-interrupted-run-leases` | fix(heartbeat): keep a run's lease while its detached local process runs |
| [`pr/23-scope-named-gateway-tool-discovery`](pr/23-scope-named-gateway-tool-discovery.md) | `78294a7847dc` | `467125fafb47` | — | perf(tool-gateway): scope named gateway discovery when its profile alone decides |
| [`pr/23b-request-policy-context-cache`](pr/23b-request-policy-context-cache.md) | `d71794f89347` | `467125fafb47` | — | perf(tool-gateway): read the policy context once per tool discovery |
| [`pr/24-run-gateway-token-lifetime`](pr/24-run-gateway-token-lifetime.md) | `83b84c8b63a4` | `467125fafb47` | — | fix(heartbeat): keep a heartbeat-run gateway token valid while its run runs |
| [`pr/25-remote-mcp-socks-proxy`](pr/25-remote-mcp-socks-proxy.md) | `5386986ac725` | `467125fafb47` | — | feat(server): route a remote MCP connection through a declared SOCKS5 proxy |
| [`pr/26-external-mcp-runless-issue-update`](pr/26-external-mcp-runless-issue-update.md) | `31cbc69c754e` | `467125fafb47` | — | fix(issues): let an external client's agent key update authorized issues without a run |
| [`pr/27a-run-status-transition-authority`](pr/27a-run-status-transition-authority.md) | `175248ad04bb` | `467125fafb47` | — | refactor(heartbeat): route every run status write through one transition authority |
| [`pr/27b-database-post-commit-hook`](pr/27b-database-post-commit-hook.md) | `543fe50af04c` | `467125fafb47` | — | feat(db): run registered work after a transaction commits |
| [`pr/27c-lifecycle-event-emission`](pr/27c-lifecycle-event-emission.md) | `4e285289ce29` | `d8ff9bc5625e` | `pr/27a-run-status-transition-authority + pr/27b-database-post-commit-hook` | feat(server): log committed run and task status changes |
| [`pr/27d-cancellation-attribution`](pr/27d-cancellation-attribution.md) | `fd986357fc8d` | `4e285289ce29` | `pr/27c-lifecycle-event-emission` | feat(heartbeat): attribute cancelled runs in their lifecycle record |
| [`pr/28-runchildprocess-stdin-stream-error`](pr/28-runchildprocess-stdin-stream-error.md) | `0d59ec641912` | `467125fafb47` | — | fix(adapter-utils): fail the owning run when writing child stdin fails |
| [`pr/33-pr-workflows-read-pnpm-version-from-package-json`](pr/33-pr-workflows-read-pnpm-version-from-package-json.md) | `6ca13025d480` | `78e003449827` | — | ci(workflows): let PR workflows install declared pnpm version from package.json |
