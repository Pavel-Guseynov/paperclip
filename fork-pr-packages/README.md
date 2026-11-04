# Proposed upstream pull requests

One document per pull request head on this fork. Every head is based on
`paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`, directly or through the
prerequisite named in its row (with `#13894` at `7661b5f48382` on its green reviewed head). Each document gives the exact head and base, the
own diff, and the pull request body to copy.

`evidence/environment.md` lists the failures that the unmodified upstream base
shows too, with the base output. `evidence/tests/` holds each head's test run
against the base's production code (`*-fail-on-base.log`) and on the head
(`*-pass-on-head.log`). `tooling/` holds the scripts and notes used to rebuild and verify the heads.

| Branch | Head | Base commit | Prerequisite | Title |
| --- | --- | --- | --- | --- |
| [`pr/01-codex-managed-mcp-auth`](pr/01-codex-managed-mcp-auth.md) | `970c099fe52a` | `925965a09b89` | — | fix(server): authenticate managed MCP lifecycle requests |
| [`pr/02-tool-gateway-session-token-verification`](pr/02-tool-gateway-session-token-verification.md) | `e105dc50909b` | `925965a09b89` | — | fix(tool-gateway): verify session bearer tokens on session routes |
| [`pr/02b-session-routes-reject-gateway-tokens`](pr/02b-session-routes-reject-gateway-tokens.md) | `26c29739538b` | `e105dc50909b` | `pr/02-tool-gateway-session-token-verification` | fix(tool-gateway): reject named gateway tokens on session routes |
| [`pr/03-codex-runtime-api-reachability`](pr/03-codex-runtime-api-reachability.md) | `90cdc5f8def1` | `925965a09b89` | — | fix(runtime): use the internal API origin for agent callbacks |
| [`pr/04-remote-mcp-timeout-health`](pr/04-remote-mcp-timeout-health.md) | `4f8f54bf7bbf` | `925965a09b89` | — | fix(tool-gateway): distinguish call timeouts from connection failure |
| [`pr/04b-refuse-ambiguous-timeout-replay`](pr/04b-refuse-ambiguous-timeout-replay.md) | `4e7674814321` | `4f8f54bf7bbf` | `pr/04-remote-mcp-timeout-health` | fix(tool-access): refuse idempotent replay of an ambiguous timed-out write |
| [`pr/05-tool-gateway-token-log-redaction`](pr/05-tool-gateway-token-log-redaction.md) | `9674edffe409` | `925965a09b89` | — | fix(logger): redact gateway credentials across log output |
| [`pr/06-approval-stage-return-assignee`](pr/06-approval-stage-return-assignee.md) | `9c7cf5bd8f14` | `925965a09b89` | — | fix(server): honor approval-stage returnAssignee participant selection |
| [`pr/07-retry-skipped-review-handoff`](pr/07-retry-skipped-review-handoff.md) | `c500848b02dc` | `925965a09b89` | — | fix(server): retry a skipped review handoff after its blocker clears |
| [`pr/08-workspace-validation-recovery-precedence`](pr/08-workspace-validation-recovery-precedence.md) | `273220e26e34` | `925965a09b89` | — | fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures |
| [`pr/11-native-runner-darwin-lsof-unicode`](pr/11-native-runner-darwin-lsof-unicode.md) | `6fd4cf278a7f` | `925965a09b89` | — | fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode |
| [`stable/v2026.916.1/chore/pnpm-11-toolchain`](pr/13-pnpm-11-toolchain.md) | `7661b5f48382` | `e0276e0166c5` | `pr/33-pr-workflows-read-pnpm-version-from-package-json` | refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827) |
| [`pr/16-tool-profile-tool-name-identity`](pr/16-tool-profile-tool-name-identity.md) | `07a20f571e85` | `925965a09b89` | — | fix(tool-access): use the catalog tool name as the tool_name selector identity |
| [`pr/14-tool-gateway-client-safe-tool-names`](pr/14-tool-gateway-client-safe-tool-names.md) | `6883cf4a034e` | `07a20f571e85` | `pr/16-tool-profile-tool-name-identity` | fix(tool-gateway): assign client-safe tool names and keep legacy names working |
| [`pr/15-tool-gateway-context-tools-token-actions`](pr/15-tool-gateway-context-tools-token-actions.md) | `03b919300853` | `925965a09b89` | — | fix(tool-gateway): gate context tools and capabilities by token allowedActions |
| [`pr/19-stage-decision-keeps-calling-run`](pr/19-stage-decision-keeps-calling-run.md) | `49e33f198f6d` | `925965a09b89` | — | fix(issues): do not cancel the calling run when recording a stage decision |
| [`pr/20-conversation-continuation`](pr/20-conversation-continuation.md) | `92b693f00609` | `925965a09b89` | — | fix(conversation): let adapters declare conversation continuation |
| [`pr/21-shutdown-waits-for-adapter-run-stops`](pr/21-shutdown-waits-for-adapter-run-stops.md) | `cfb0906b153b` | `925965a09b89` | — | fix(server): let graceful shutdown wait for in-flight adapter runs |
| [`pr/23-scope-named-gateway-tool-discovery`](pr/23-scope-named-gateway-tool-discovery.md) | `f38d37159bce` | `925965a09b89` | — | perf(tool-gateway): scope named gateway discovery when its profile alone decides |
| [`pr/24-run-gateway-token-lifetime`](pr/24-run-gateway-token-lifetime.md) | `bf4e743daeab` | `925965a09b89` | — | fix(heartbeat): keep a heartbeat-run gateway token valid while its run runs |
| [`pr/25-remote-mcp-socks-proxy`](pr/25-remote-mcp-socks-proxy.md) | `0ac65719c46e` | `925965a09b89` | — | feat(server): route a remote MCP connection through a declared SOCKS5 proxy |
| [`pr/26-external-mcp-runless-issue-update`](pr/26-external-mcp-runless-issue-update.md) | `d08ad6d54460` | `925965a09b89` | — | fix(issues): let an external client's agent key update authorized issues without a run |
| [`pr/27a-run-status-transition-authority`](pr/27a-run-status-transition-authority.md) | `60ede799488c` | `925965a09b89` | — | refactor(heartbeat): route every run status write through one transition authority |
| [`pr/27b-database-post-commit-hook`](pr/27b-database-post-commit-hook.md) | `27540ead55dc` | `925965a09b89` | — | feat(db): run registered work after a transaction commits |
| [`pr/27c-lifecycle-event-emission`](pr/27c-lifecycle-event-emission.md) | `eb2209947255` | `55c2884d9121` | `pr/27a-run-status-transition-authority + pr/27b-database-post-commit-hook` | feat(server): log committed run and task status changes |
| [`pr/27d-cancellation-attribution`](pr/27d-cancellation-attribution.md) | `318d4b1187e8` | `eb2209947255` | `pr/27c-lifecycle-event-emission` | feat(heartbeat): attribute cancelled runs in their lifecycle record |
| [`pr/28-runchildprocess-stdin-stream-error`](pr/28-runchildprocess-stdin-stream-error.md) | `df2bd81af74e` | `925965a09b89` | — | fix(adapter-utils): fail the owning run when writing child stdin fails |
| [`pr/32-optional-native-runner-binary`](pr/32-optional-native-runner-binary.md) | `34d6dd25beaa` | `925965a09b89` | — | feat(build): allow skipping native runner binary compilation via PAPERCLIP_SKIP_RUNNER_BINARY |
| [`fix/recover-stale-execution-and-finalization`](pr/33-recover-stale-execution-and-finalization.md) | `44db3e212588` | `925965a09b89` | — | fix(recovery): preserve unknown action outcomes and allow explicit board reconciliation of settled holds |
| [`pr/33-pr-workflows-read-pnpm-version-from-package-json`](pr/33-pr-workflows-read-pnpm-version-from-package-json.md) | `9e283a896ce6` | `925965a09b89` | — | ci(workflows): let PR workflows install declared pnpm version from package.json |
| [`fix/codex-managed-mcp-approvals`](pr/37-codex-managed-mcp-approvals.md) | `7e821633252a` | `925965a09b89` | — | fix(codex-local): set default_tools_approval_mode to approve on managed MCP servers |
| [`fix/release-done-blocker-pending-finalize`](pr/39-release-done-blocker-pending-finalize.md) | `8fa08dc94f57` | `925965a09b89` | — | fix(issues): release done blockers whose last workspace operation run is terminal |
| [`fix/recreate-unregistered-managed-worktree`](pr/40-recreate-unregistered-managed-worktree.md) | `45a23d98e60a` | `925965a09b89` | — | fix(workspace-runtime): recreate managed worktree directories no longer registered in git |
| [`fix/review-escalation-unreachable-board-sentinel`](pr/40b-review-escalation-unreachable-board-sentinel.md) | `19dbd0f00304` | `925965a09b89` | — | fix(server): honor board sentinel on review escalation and local-trusted board actor |
| [`fix/keep-connection-healthy-on-oversized-response`](pr/42-keep-connection-healthy-on-oversized-response.md) | `d6321a9dd17e` | `925965a09b89` | — | fix(tool-gateway): keep remote MCP connection healthy when one response exceeds size limit |
| [`fix/accept-resolved-blocked-local-task-review-handoff`](pr/44b-accept-resolved-blocked-local-task-review-handoff.md) | `a73f37e9b27c` | `925965a09b89` | — | fix(server): accept resolved-blocked local tasks into native review |
| [`fix/mcp-unsupported-method-errors`](pr/45-mcp-unsupported-method-errors.md) | `bc9f9bddf111` | `925965a09b89` | — | fix(tool-gateway): return JSON-RPC -32601 with HTTP 200 for unsupported MCP methods |
| [`fix/run-scoped-mcp-gateway-credentials`](pr/46-run-scoped-mcp-gateway-credentials.md) | `b6827d03b98d` | `925965a09b89` | — | fix(codex-local): isolate per-run MCP gateway credentials in run-scoped Codex profiles |
| [`fix/mcp-remote-event-stream-tool-calls`](pr/47-mcp-remote-event-stream-tool-calls.md) | `45a75ca28295` | `925965a09b89` | — | fix(tool-gateway): complete SSE remote MCP calls on matching response ID and use 30s default timeout |
| [`fix/concurrent-worktree-realization`](pr/48-concurrent-worktree-realization.md) | `e95ba1d66d8b` | `925965a09b89` | — | fix(workspace-runtime): serialize per-repo git worktree mutations and configure explicit upstream tracking |
| [`fix/unchanged-unblock-descriptor-deduplication`](pr/49-unchanged-unblock-descriptor-deduplication.md) | `912c3b0b5263` | `925965a09b89` | — | fix(issues): deduplicate owner notifications when re-entering blocked with an unchanged self-owned unblockDescriptor |
