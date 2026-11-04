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
| [`pr/01-codex-managed-mcp-auth`](pr/01-codex-managed-mcp-auth.md) | `d9728534e99d` | `925965a09b89` | — | fix(server): authenticate managed MCP lifecycle requests |
| [`pr/02-tool-gateway-session-token-verification`](pr/02-tool-gateway-session-token-verification.md) | `cf20828a3bd8` | `925965a09b89` | — | fix(tool-gateway): verify session bearer tokens on session routes |
| [`pr/02b-session-routes-reject-gateway-tokens`](pr/02b-session-routes-reject-gateway-tokens.md) | `4c9cf6ec6667` | `cf20828a3bd8` | `pr/02-tool-gateway-session-token-verification` | fix(tool-gateway): reject named gateway tokens on session routes |
| [`pr/03-codex-runtime-api-reachability`](pr/03-codex-runtime-api-reachability.md) | `6528bf906976` | `925965a09b89` | — | fix(runtime): use the internal API origin for agent callbacks |
| [`pr/04-remote-mcp-timeout-health`](pr/04-remote-mcp-timeout-health.md) | `dd161293de8a` | `925965a09b89` | — | fix(tool-gateway): distinguish call timeouts from connection failure |
| [`pr/04b-refuse-ambiguous-timeout-replay`](pr/04b-refuse-ambiguous-timeout-replay.md) | `226f8c2a66e4` | `dd161293de8a` | `pr/04-remote-mcp-timeout-health` | fix(tool-access): refuse idempotent replay of an ambiguous timed-out write |
| [`pr/05-tool-gateway-token-log-redaction`](pr/05-tool-gateway-token-log-redaction.md) | `9dc925c02609` | `925965a09b89` | — | fix(logger): redact gateway credentials across log output |
| [`pr/06-approval-stage-return-assignee`](pr/06-approval-stage-return-assignee.md) | `078156be4fd9` | `925965a09b89` | — | fix(server): honor approval-stage returnAssignee participant selection |
| [`pr/07-retry-skipped-review-handoff`](pr/07-retry-skipped-review-handoff.md) | `992f7cf8204f` | `925965a09b89` | — | fix(server): retry a skipped review handoff after its blocker clears |
| [`pr/08-workspace-validation-recovery-precedence`](pr/08-workspace-validation-recovery-precedence.md) | `810a10c893e3` | `925965a09b89` | — | fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures |
| [`pr/11-native-runner-darwin-lsof-unicode`](pr/11-native-runner-darwin-lsof-unicode.md) | `c080ad87171d` | `925965a09b89` | — | fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode |
| [`stable/v2026.916.1/chore/pnpm-11-toolchain`](pr/13-pnpm-11-toolchain.md) | `7661b5f48382` | `e0276e0166c5` | `pr/33-pr-workflows-read-pnpm-version-from-package-json` | refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827) |
| [`pr/16-tool-profile-tool-name-identity`](pr/16-tool-profile-tool-name-identity.md) | `5e3b92f71c72` | `925965a09b89` | — | fix(tool-access): use the catalog tool name as the tool_name selector identity |
| [`pr/14-tool-gateway-client-safe-tool-names`](pr/14-tool-gateway-client-safe-tool-names.md) | `3b3d28a327d4` | `5e3b92f71c72` | `pr/16-tool-profile-tool-name-identity` | fix(tool-gateway): assign client-safe tool names and keep legacy names working |
| [`pr/15-tool-gateway-context-tools-token-actions`](pr/15-tool-gateway-context-tools-token-actions.md) | `2c5b10f0f921` | `925965a09b89` | — | fix(tool-gateway): gate context tools and capabilities by token allowedActions |
| [`pr/19-stage-decision-keeps-calling-run`](pr/19-stage-decision-keeps-calling-run.md) | `9398b5a2b145` | `925965a09b89` | — | fix(issues): do not cancel the calling run when recording a stage decision |
| [`pr/20-conversation-continuation`](pr/20-conversation-continuation.md) | `e87308807e92` | `925965a09b89` | — | fix(conversation): let adapters declare conversation continuation |
| [`pr/21-shutdown-waits-for-adapter-run-stops`](pr/21-shutdown-waits-for-adapter-run-stops.md) | `6469d12878d4` | `925965a09b89` | — | fix(server): let graceful shutdown wait for in-flight adapter runs |
| [`pr/23-scope-named-gateway-tool-discovery`](pr/23-scope-named-gateway-tool-discovery.md) | `44898faf7d22` | `925965a09b89` | — | perf(tool-gateway): scope named gateway discovery when its profile alone decides |
| [`pr/24-run-gateway-token-lifetime`](pr/24-run-gateway-token-lifetime.md) | `fa94fd41ce5e` | `925965a09b89` | — | fix(heartbeat): keep a heartbeat-run gateway token valid while its run runs |
| [`pr/25-remote-mcp-socks-proxy`](pr/25-remote-mcp-socks-proxy.md) | `d95f838099b9` | `925965a09b89` | — | feat(server): route a remote MCP connection through a declared SOCKS5 proxy |
| [`pr/26-external-mcp-runless-issue-update`](pr/26-external-mcp-runless-issue-update.md) | `6a5c6346e18c` | `925965a09b89` | — | fix(issues): let an external client's agent key update authorized issues without a run |
| [`pr/27a-run-status-transition-authority`](pr/27a-run-status-transition-authority.md) | `462cb89f7b6c` | `925965a09b89` | — | refactor(heartbeat): route every run status write through one transition authority |
| [`pr/27b-database-post-commit-hook`](pr/27b-database-post-commit-hook.md) | `a291f9e7b1cf` | `462cb89f7b6c` | `pr/27a-run-status-transition-authority` | feat(db): run registered work after a transaction commits |
| [`pr/27c-lifecycle-event-emission`](pr/27c-lifecycle-event-emission.md) | `f251f8e8dc88` | `a291f9e7b1cf` | `pr/27b-database-post-commit-hook` | feat(server): log committed run and task status changes |
| [`pr/27d-cancellation-attribution`](pr/27d-cancellation-attribution.md) | `77ec603a8a3b` | `f251f8e8dc88` | `pr/27c-lifecycle-event-emission` | feat(heartbeat): attribute cancelled runs in their lifecycle record |
| [`pr/28-runchildprocess-stdin-stream-error`](pr/28-runchildprocess-stdin-stream-error.md) | `afb9f3facc47` | `925965a09b89` | — | fix(adapter-utils): fail the owning run when writing child stdin fails |
| [`pr/32-optional-native-runner-binary`](pr/32-optional-native-runner-binary.md) | `34d6dd25beaa` | `925965a09b89` | — | feat(build): allow skipping native runner binary compilation via PAPERCLIP_SKIP_RUNNER_BINARY |
| [`fix/recover-stale-execution-and-finalization`](pr/33-recover-stale-execution-and-finalization.md) | `7ad2c4b28216` | `925965a09b89` | — | fix(recovery): preserve unknown action outcomes and allow explicit board reconciliation of settled holds |
| [`pr/33-pr-workflows-read-pnpm-version-from-package-json`](pr/33-pr-workflows-read-pnpm-version-from-package-json.md) | `9e283a896ce6` | `925965a09b89` | — | ci(workflows): let PR workflows install declared pnpm version from package.json |
| [`fix/codex-managed-mcp-approvals`](pr/37-codex-managed-mcp-approvals.md) | `30a9615043da` | `925965a09b89` | — | fix(codex-local): set default_tools_approval_mode to approve on managed MCP servers |
| [`fix/release-done-blocker-pending-finalize`](pr/39-release-done-blocker-pending-finalize.md) | `932819684a4c` | `925965a09b89` | — | fix(issues): release done blockers whose last workspace operation run is terminal |
| [`fix/recreate-unregistered-managed-worktree`](pr/40-recreate-unregistered-managed-worktree.md) | `97f49f85153b` | `925965a09b89` | — | fix(workspace-runtime): recreate managed worktree directories no longer registered in git |
| [`fix/review-escalation-unreachable-board-sentinel`](pr/40b-review-escalation-unreachable-board-sentinel.md) | `dde4d9f913ea` | `925965a09b89` | — | fix(server): honor board sentinel on review escalation and local-trusted board actor |
| [`fix/keep-connection-healthy-on-oversized-response`](pr/42-keep-connection-healthy-on-oversized-response.md) | `d6321a9dd17e` | `925965a09b89` | — | fix(tool-gateway): keep remote MCP connection healthy when one response exceeds size limit |
| [`fix/accept-resolved-blocked-local-task-review-handoff`](pr/44b-accept-resolved-blocked-local-task-review-handoff.md) | `a73f37e9b27c` | `925965a09b89` | — | fix(server): accept resolved-blocked local tasks into native review |
| [`fix/mcp-unsupported-method-errors`](pr/45-mcp-unsupported-method-errors.md) | `bc9f9bddf111` | `925965a09b89` | — | fix(tool-gateway): return JSON-RPC -32601 with HTTP 200 for unsupported MCP methods |
| [`fix/run-scoped-mcp-gateway-credentials`](pr/46-run-scoped-mcp-gateway-credentials.md) | `eb17ca8e1649` | `925965a09b89` | — | fix(codex-local): isolate per-run MCP gateway credentials in run-scoped Codex profiles |
| [`fix/mcp-remote-event-stream-tool-calls`](pr/47-mcp-remote-event-stream-tool-calls.md) | `b0f13ac34014` | `925965a09b89` | — | fix(tool-gateway): complete SSE remote MCP calls on matching response ID and use 30s default timeout |
| [`fix/concurrent-worktree-realization`](pr/48-concurrent-worktree-realization.md) | `3deb96d0e2d5` | `925965a09b89` | — | fix(workspace-runtime): serialize per-repo git worktree mutations and configure explicit upstream tracking |
| [`fix/unchanged-unblock-descriptor-deduplication`](pr/49-unchanged-unblock-descriptor-deduplication.md) | `3bb66e546ef3` | `925965a09b89` | — | fix(issues): deduplicate owner notifications when re-entering blocked with an unchanged self-owned unblockDescriptor |
