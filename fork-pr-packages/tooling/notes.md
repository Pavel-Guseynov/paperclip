# Per-head fix notes (from 20 on; 01-19 see commit messages + plan table)

## 20 conversation-continuation (70c5245d5)
- Replaced pre-stamped-row/predicate tests with production-path test: reapOrphanedRuns() on a lost legacy run of a registered adapter declaring supportsConversationContinuation -> stamped continue_conversation_v1, no blocker, one retryOf run. Control: undeclared adapter not stamped.
- Import cycle check: conversation-continuation -> adapters/index; adapters registry imports only adapter-models-env, adapter-plugin-store, native-runtime/provider-profile (no heartbeat / continuation) -> no cycle. heartbeat.ts already imports adapters/index.
- Base: declared test fails (resultJson lacks conversationContinuation, stopReason process_lost). evidence 20-*.log

## 21 shutdown-waits-for-adapter-run-stops (0f035bea6)
- Removed test-only exports isShutdownInProgress, startNextQueuedRunForAgent; removed `as any` mock-db test.
- Removed redundant `shutdownInProgress = true` in drainRunningRunsForShutdown (upstream prepareHotRestartShutdown already sets it at start of every shutdown via coordinateHeartbeatSchedulerShutdown).
- Removed resumeQueuedRuns guard (scheduler stopped before drain) and deferred-promotion guard (promotion is DB-only; dispatch funnels through startNextQueuedRunForAgent). Single guard in startNextQueuedRunForAgent.
- Kept function default 5s in shutdown.ts (index passes config); config default 60 s (maintainer decision).
- Old head broke upstream shutdown.test.ts (info->error); updated that test to assert error + pendingRunIds.
- Docs row in docs/deploy/environment-variables.md.
- Tests: config default/env/invalid; real-DB wakeup after prepareHotRestartShutdown stays queued + adapter not executed (control: starts without shutdown).
- Base: 5 fail (config undefined; run 'succeeded' vs 'queued'; log.error not called). evidence 21-*.log
- Base failure seen: heartbeat-process-recovery "redacts opaque environment-bound credentials ...: result" -> 'ser***REDACTED***ce' fails identically on upstream base clone.

## 22 release-cancelled-interrupted-run-leases
- Rewritten. Dropped: releaseLeasesForRun options/default cleanupStatus success/pending_cleanup widening (no production caller -> dead); environment-runtime missing-environment "release with cleanupStatus success" (false success; upstream orphan+pending sweeps tear it down via recorded data); local shortcuts in sweepOrphanedActiveLeases/sweepPendingCleanupLeases (redundant: upstream local retryPendingSandboxTeardown is a no-op, sweeps release in same tick).
- Kept/fixed: release at cancelRunInternal, cancelActiveForAgentInternal (added, same bug class), stale-lock backstop; only legacy runs with no in-process executor (old head released unconditionally, racing executor copy-back).
- Tests: no synthetic environment row; ensureLocalEnvironment + environmentRuntimeService.acquireRunLease; removed "run 5661c208" reference; removed telemetry mock (hashPrivateRef missing).
- Base: lease 'active' in all three. evidence 22-*.log

## 22b guard-environment-lease-release-on-live-runs (b2d250fda, on 22)
- Old head put PID check in releaseEnvironmentLeasesForRun for ALL callers (incl. executor finally) with no adapter gate: remote PIDs misread on host; lingering process group blocks executor release forever. Moved guard to 22's no-executor helper + orphan sweep only, gated like reaper (legacy + SESSIONED_LOCAL_ADAPTERS via agent adapterType).
- Removed native-ownership check in sweep (isNativeRunnerOwnershipHeld requires status running; sweep only selects terminal runs -> dead).
- Removed native-resume (nativeRunFinalizations) guard: no reproducing path/test.
- Sweep defers (deferOrphanedActiveLease) instead of bare continue (page starvation).
- Tests: real spawned child process. Base (=22): 'expired' / 'pending_cleanup' vs 'active'. evidence 22b-*.log

## 23 scope-named-gateway-tool-discovery
- Old head scoped candidates by gateway.profileId whenever defaultAction != allow, ignoring defaultProfileMode, ignoring that allow/trust_rule/require_approval policies and tools:use grants can allow tools outside any profile (decide()), and ignoring multiple gateway bindings (profile change keeps old binding). -> visible tools changed (hid policy-allowed tools).
- New: policy service namedGatewayDiscoveryScope (co-located with decide) returns id scope only when gateway profile alone decides: gateway_only, gateway-tier bindings exist, no active allow-default profile, no allow/trust_rule/require_approval policy (app_gallery_finish approval exempt, decide skips it outside profile), no tools:use grant, include entries id-only (tool_name/risk_level -> null, naming left to 14/16). Conditions ignored (superset). Builtins unchanged.
- Removed own tool-name matcher, ':'-qualified branch, builtin filtering, defaultProfileMode on session, synthetic binding rows (tests use createProfile/createNamedGateway/createPolicy).
- policyActor helper extracted from policyInputForAgentTool (no behavior change).
- Tests: decide-call count via vi.mock wrapper; guards: allow policy outside profile still visible; gateway_then_context evaluates all. Base: beta/gamma evaluated (1 fail, 2 guards pass).

## 23b request-policy-context-cache (on 23)
- Old: ~420-line ToolEvaluationContextCache with per-entity loaders duplicating every query; also primed connection/application and was tied to old 23's profile scoping code.
- New: generic per-request memo createToolPolicyReadCache (read(key, load) + primeCatalogEntry) wrapping existing queries in loadContext/effectiveProfiles/decide(policies)/explicitGrant; decide(input, { readCache }) optional; writeAudit uncached; drizzle thenables wrapped in Promise.resolve so each executes once.
- Test: select count for 5 vs 20 tools equal. Base (=23): 194 vs 74 (8 reads per tool). Also fixed test wrapper to forward all decide args.

## 24 run-gateway-token-lifetime
- Verified run-state gating exists upstream: ACTIVE_GATEWAY_RUN_STATUSES={"running"} -> gateway_token_run_inactive. No other check on named-gateway session.expiresAt (1871 is pcgt sessions).
- Test rewritten: no `any`, production services (createProfile/createNamedGateway/createNamedGatewayToken), fake Date +2h. Base: running-run token rejected gateway_token_expired.
- Behavior change (Risks): a leaked run token is valid until the run stops running, not capped at 1h.

## 25 remote-mcp-socks-proxy
- Dropped README "Plugins" edit; playbook row rewritten to the actual contract.
- SECURITY FIX vs old head: proxy host was never guarded (old test even asserted a loopback proxy is allowed with allowPrivateNetwork=false) -> internal SOCKS proxy could reach internal hosts by name. Now proxy host resolved+pinned+peer-verified via resolveApprovedRemoteHttpAddresses/dialApprovedAddress, at save time (assertPublicRemoteHttpEndpoint) and request time.
- Proxy credentials rejected (config is not secret storage; playbook: secrets in company_secrets). Removed username/password SOCKS auth code.
- Removed global protocol check added to the non-proxied path.
- Rewrote SOCKS client compactly (SocketReader + socks5Connect + socks5Address), proxy option typed string|null, no dead port checks.
- Tests: production createConnection (active+enabled), bindProfile, catalog refresh + gateway tools/call via proxy; guards. Base: 5 fail (proxy ignored -> dns failures / no rejection), 2 guards pass.
- Behavior change (Risks): proxied requests skip DNS-based private check for target hostname (proxy resolves).

## 26 external-mcp-runless-issue-update
- Dropped README paragraph. Moved execution-lock rule out of issueService.assertCheckoutOwner (shared with plugin host services which pass null run ids -> would silently change plugin semantics) into the route's runless branch (409 when executionRunId held). Dropped the service test pinning the shared change.
- Replaced mocked-service route tests with real-PG route tests (title+blockers, 409 while run holds then 200, restricted key 401). Base: 403 cross-issue run context / 401. Ablation of route check -> held edit 200 (evidence 26-ablate-execution-lock.log).
- Docs state runless writes skip per-run cross-issue cap (Risks).

## 27b database-post-commit-hook (on upstream)
- Rebased onto upstream client.ts (withTransientWriteRetry removed upstream #14773). installPostCommitHooks no longer exported (internal trackPostCommitHooks wired in createDb); single documented cast at createDb.
- Replaced mock-transaction unit tests with real-PG tests (commit visibility from a second connection, rollback, savepoint rollback, hook failure, outside tx). Base: new API missing (registerPostCommitHook is not a function) -- unavoidable for a new primitive.
- Whole packages/db suite: 46 files / 165 tests pass.

## 27a run-status-transition-authority (3c5ea46c0, on upstream)
- Removed 27c-only options (phase/outcome/error/events/postCommitRecords, stagedEvents); whereCondition:any -> where?: SQL; patch typed Omit<PgUpdateSetSource,"id"|"status"> + runtime rejection; helpers (setRunStatus/IfRunning/FromLive, terminalizeLegacyExecution, finalRunPatch) typed HeartbeatRunValuesPatch.
- Returns {run, transition|null}; transition has eventId/from/to/clock_timestamp-under-lock.
- MISSED BY OLD HEAD: 3 conditional-spread status writes (native-run-finalizer x2, native-session-executor x1) -> converted. Old static check (string scan, top-level only) passed while they existed.
- New static check: nearest-declaration resolution, spreads, identifiers typed status-free, raw SQL. Upstream: 33 violations; head 0; ablation (restore upstream native-session-executor) flags 7019 + 8922.
- DB tests: lock wait (second transition blocks, fromStatus=running), same-status, unique event ids, rollback, where mismatch, patch status rejected.
- Removed redundant `tx as unknown as Db` cast in queued-comment adapter.

## 27c lifecycle-event-emission (on merge 42728a6ee = 27a+27b)
- Rewritten: no activity-detail heuristics, no stderr writer, no activity_log clock_timestamp change. Run records from 27a transition; task records in issueService.update from receiptExisting (FOR UPDATE) -> updated; both via registerPostCommitHook + server logger.
- Coverage limit (Risks): task records only for status changes through issueService.update (~10 direct issue status writers elsewhere not covered).
- Tests real PG: after-commit only, rollback/same-status none, exactly one on review entry, unique ids. Base: 3 fail (no events), 2 guards pass.

## 27d cancellation-attribution (on 27c)
- Rewritten: no new plumbing through ~10 call sites, no string matching of abort messages ("Legacy controller lease lost"), no "unattributed_abort" invention. Attribution derived from committed run row: errorCode (cause), error, requestedBy from resultJson.cancelledBy* (board Stop) or interruptedBy* (comment interrupt).
- Old tests only echoed attribution passed to the function under test. New tests: real board route POST /heartbeat-runs/:id/cancel and cancelActiveForAgent (agent_paused). Base(27c): cancellation undefined.

## 28 runchildprocess-stdin-stream-error
- Comment change minimized to one line; removed extra blank line in test; README trailing blank line removed.
- Behavior change (Risks): write to already-destroyed stdin now fails the run (old skipped write silently).
- Base: errorCode undefined + unhandled EPIPE errors. evidence 28-*.log. server-utils.test.ts 128/128 on head.

## Recheck round 2 (after container restart)
- 11 a49a0b7e3: Linux-runnable regressions called decodeLsofPath directly and failed on base only with "not a function". Replaced with production-path tests: register_deliverable through the Darwin branch (process.platform stubbed, /usr/sbin/lsof answered by a vi.mock of node:child_process.execFile that renders the name field per locale like lsof), under LANG=C and en_US.UTF-8; invalid-UTF-8 escape guard. decodeLsofPath no longer exported. Base: ENOENT realpath of the escaped path (2 fail). Commit message corrected (base failed with ENOENT, not descriptor_unverifiable). Real-lsof macOS test kept (skipped on Linux).
- 02 b4c728cf3: was stacked on 01 only by textual adjacency in auth.ts; no code use of 01. Rebased onto upstream; comment "exactly as above" reworded. Tests 119 pass; base 5 fail (401 vs 200, session reason codes). 01 and 02 touch adjacent lines of auth.ts: second to merge needs a trivial rebase.
- 04b stays on 04: on upstream alone a timed-out remote MCP call marks the connection error, the tool disappears, replay returns 404 (verified: 3 fail with 404 / Tool not found). 04 keeps the connection callable, which makes the ambiguous replay reachable.
- 23b c6e0c8840: was stacked on 23 only by parameter position + test setup. Rebased onto upstream with its own test file tool-policy-read-cache.test.ts. Base: 189 vs 69 selects; head equal.
- 14 stays on 16 (selector identity), 22b on 22 (uses releaseLeasesForRunWithoutExecutor), 27c on 27a+27b, 27d on 27c.
- 27a 175248ad0: removed out-of-scope isLeaseLost hunk; restored native-review-dispatch CAS (no added where); claimValues typed HeartbeatRunStatusPatch (no PgUpdateSetSource); reverted claimPatch rename and |null change; fixed 2 comments; commit msg 'Upstream has' reworded. 27c 4e285289c on new merge d8ff9bc56: SPEC narrowed to issue-update task changes + clock_timestamp wording; record types internal; commit msg. 27d fd986357f: errorCode claim corrected (null when not recorded), lease-lost claim dropped, comment fixed, RunCancellation internal.
- 21 db03108b7: shutdown stop is process-wide (module flag runStartsStoppedForShutdown) set in prepareHotRestartShutdown; checked at entry and before each claim; timeout bounded to 2^31-1 (env+schema); config tests isolated via PAPERCLIP_CONFIG + file key + precedence; cross-instance DB test. Ablation (per-instance flag) fails cross-instance test (evidence 21-ablate-instance-flag.log).
- 28 0d59ec641: restored upstream stdin.destroyed guard (exited child: skip write, follow exit); SIGKILL after graceSec on stdin failure (timer cleared on close); deterministic tests (child closes fd 0 and stays alive); new SIGKILL test; README+msg updated. Base: 3 fail with unhandled EPIPE.
- 20 f50e8f96a: startup recovery awaits waitForExternalAdapters before reap (+ ordering test, ablation fails: evidence 20-ablate-startup-order.log); lookups consistent via findActiveServerAdapter; getConversationAdapterTypes internal; param not widened.
- 16 a213e96f2: migration covers slack-bot./github-bot. names (chat_endpoints), candidates = exposable rows (tool, active, not quarantined), ambiguous exclude -> catalog_entry excludes for all candidates (fail closed), ambiguous include unchanged+counted; test seeds names from gateway output (not the derivation), covers bot name, inactive duplicate, ambiguous include/exclude; doc comment fixed. Ablation (previous migration) fails. 14 85d28bc44db4b7f0286a4c940549822c3c10b83f: names claimed over all company tool rows (state-independent), reserved gateway names, legacy grant-scope test (selector-bearing scope), length test non-tautological, migration test reads legacyToolName; ablation (eligible-only claims) fails 2 tests. Found upstream issue: scopeAllowsTool falls back to selectorMatches which matches all when scope has only allow-list.
- 02 9c2d0afb5: test helper mounts real actor middleware (option was missing after rebase off 01); bypass limited to GET tools / POST tools/call; public endpoint used to show pcgw token valid; vacuous audit assertion removed. Ablation of middleware bypass fails 4 tests (02-ablate-middleware.log).
- 02b 2e1d72216: comments+msg corrected (only list path skips allowedActions).
- 01 e040a8134: unexpected notification verification errors logged; auth.ts comment 'Among /api routes'; doc row scoped to managed endpoint.

## 25 round-2 fixes (5386986ac)
- assertProxiedRemoteHttpEndpoint async: rejects hostname >255 bytes (mcp_remote_url_invalid); a hostname resolving locally to link-local is rejected (best effort; split-horizon/rebinding at the proxy is not caught -> operator policy item); lookup failure leaves it to the proxy.
- OAuth through proxy now tested (discovery, DCR, token, authenticated catalog); ablation of the OAuth proxy args fails (25-ablate-oauth-proxy.log); guard ablation fails 2 tests (25-ablate-guard.log).
- SocketReader.release: documented why no pause (same-turn handoff). Duplicate localhost/literal checks vs resolveApproved: declined (refactoring upstream function = drive-by).
- test fixture: heartbeatRuns uses contextSnapshot.issueId (no issueId column).
- Port message "port other than 0"; comment states default 1080.

## 04 round-2 (59442b855) / 04b (rebased)
- 04 discovery serves degraded only with the timeout message (REMOTE_CALL_TIMEOUT_HEALTH_MESSAGE = base's message "Remote MCP tool call timed out."); insufficient-scope/vercel/rotation degraded stay hidden as on base. Test "keeps hiding a connection degraded for another reason".
- 04 ordering guard now `updatedAt < observedAt` (covers writers that set no lastHealthAt, e.g. OAuth reauth). Shared constants + shared test removed (unused export gone). Ablation (old predicate+lastHealthAt guard) fails 2 tests: 04-ablate-narrowing.log.
- 04b: 409 details.tool = existing.toolName (asserted); isWrite drive-by refactor reverted. Evidence 04b-fail-on-04.log (3 fail), 04b-pass-on-head.log.

## 03 round-2
- Cloud claim: applyCompatibilityEnvironment moves an unpinned PAPERCLIP_RUNTIME_API_URL (== PAPERCLIP_API_URL) to the canonical origin; a pin stays. Tests in cloud-runtime-identity.test.ts.
- claude-local networkTrustedUrls adds PAPERCLIP_RUNTIME_API_URL (deduped). Test in execute.acp-fallback.test.ts. Codex trust test added.
- docs/deploy/environment-variables.md rows (server + agent runtime).
- Comments: buildPaperclipEnv comment rewritten (stale sanitize claim removed); cursor-cloud comment reflow reverted to base + 2 lines.
- GitHub broker URL: uses bridge env where both vars are the same in-target origin -> no change needed.
- CLI precedence (RUNTIME over an explicit PAPERCLIP_API_URL in the same env): kept, documented; Risks.
- Boot self-inherit: pre-existing on base for PAPERCLIP_API_URL (agent env carries both; base preserves inherited PAPERCLIP_API_URL at boot) -> not new; Risks note.
- Evidence: 03-fail-on-base.log (20 fail), 03-pass-on-head.log (352 pass), 03-ablate-round2.log (2 fail).

## 05 round-2 (fce03a0fd)
- redact-sensitive.ts reverted to base (it also shapes API responses via redactSensitiveValueOccurrences on secret-sensitive routes) -> API responses unchanged; logs covered by streamWrite.
- Auth-scheme: Bearer anywhere; Basic/Digest only after an Authorization/Proxy-Authorization label ("digest mismatch", "basic validation" kept; tests).
- redactCredentialFields strips credential text from string values (structured fields); test.
- err serializers never throw (UNREADABLE_ERROR); test with throwing enumerable getter (base throws).
- Header list: dropped dev-server-status-token and x-paperclip-signature; original order restored.
- Unexported markers/constants/helpers; serializeLoggedError internal.
- Test comments: #4759 reference removed (that issue is about reqBody secrets, open; unrelated), narration comments rewritten; circular redact-path test replaced by literal paths.
- Evidence: 05-fail-on-base.log (46 fail), 05-ablate-round2.log (6 fail vs previous head), 05-pass-on-head.log (108 pass).

## 06 round-2
- Removed the two untested extra hunks (active-stage currentParticipant fallback; re-selection after policy edit): back to base selectStageParticipant(exclude). Tests still pass -> they were untested.
- Reverted `policy` rewrites of original lines; `const policy` only for closures.
- Test mocks: `as any` removed from getExperimental; only addComment mockReset kept; comments shortened.
- Commit message: start path auto-skips only review stages; approval stage falls back (never skipped) on start and approval. Differs from #4912's suggestion (skip) -> description states it (approval gate invariant).
- Evidence: 06-fail-on-base.log (6 fail), 06-pass-on-head.log (102 pass).

## 07 round-2
- #13532 is the environment-lease case. hasValidReviewBlocker -> getExecutionBlocker -> getConversationOwnershipBlocker covers a held lease; the stranded sweep retries after release. New test "retries the handoff once the previous run releases its environment lease" (fails with base wiring: 07-fail-on-base-wiring.log). Fixes #13532 kept.
- Ledger: budget restarts after the board closes the exhaustion escalation (resolvedAt of the latest action with the fingerprint); attempt numbers keep counting (unique keys). Test + ablation (07-ablate-ledger.log).
- Removed unused `source` param; unexported internals (only route/service/test-used exports remain); unit test derives ParsedExecutionState locally.
- "upstream's" test comments rewritten. heartbeat.wakeup in the route matches existing route usage (line ~3554) -> unchanged.
- Overlap #13880 (open, proaction-paul): periodic re-admission of skipped stage wakes with execution_reconciliation_required. Same issue; 07 covers dependency/recovery-action blockers and escalation too. Maintainer decision.

## 08 round-2
- isIncomingGenericSweep by cause only (kind stranded_assigned_issue carries specific causes like process_lost/provider_quota); test "updates ... specific cause".
- Event source and recoveryCause both from recoveryAction.cause; held-sweep test asserts the activity details.
- Adapter catch site tested: wrapped WorkspaceValidationFailure -> run errorCode workspace_validation_failed (base: adapter_failed). Setup and branch-repair sites use the same helper (not separately driven).
- Notice wording: "The last run of the pending execution-review participant failed workspace validation ... Moving the issue to `blocked` until the participant workspace is repaired."
- Evidence: 08-fail-on-base.log, 08-ablate-round2.log (2 fail vs previous head), 08-pass-on-head.log (36 pass).

## 26 round-2
- Test actor now matches auth middleware (onBehalfOfUserId + onBehalfOfMemberships) so the responsible-user check runs.
- New tests: inline comment; 409 under checkoutRunId; cross-company 404 (not visible).
- docs/api/issues.md: reverted the "Updatable fields" drive-by; kept the runless paragraph.
- Evidence: 26-fail-on-base.log (4 fail), 26-pass-on-head.log (6 pass).

## 24 round-2 (redesign)
- Heartbeat issues run tokens (runtime MCP + managed MCP) without expiresAt; owner note "Valid while the run is running." Gateway change reverted (explicit expiry honored for every subject). UI shows "No expiry" instead of "Expired".
- Upstream test heartbeat-runtime-mcp-servers asserted 1 h expiry -> now asserts null (+ managed token assertion).
- 24 test issues the token through buildPaperclipRuntimeMcpServers. Evidence: 24-fail-on-base.log (4 fail), 24-pass-on-head.log (9 pass).
- Note: tokens issued before the upgrade keep their 1 h expiry (transitional).

## 23 round-2
- Scope filter uses toolApplications.id (the id the descriptor and the decision use), not toolCatalogEntries.applicationId.
- Tests for every fallback (allow-default, allow/trust_rule/require_approval policy, tools:use grant, tool_name include, context-profile mode) and the wizard exemption; application include scope test.
- Commit claim fixed (context-profile gateway: evaluates every tool).
- Evidence: 23-fail-on-base.log (11 fail; the scope function is new), 23-pass-on-head.log (12 pass).
- 11 round-2: comment nits ('pinned above' -> openedFilePath pins; test wording removed from prod comment). requiredText claim verified (workspace root + content_ref pass requiredText).
- 12 round-2: test comment 'Own identity only' rewritten; ranges verified (shared runtime-exposure/ports.ts).
- 19 round-2: resolveActiveIssueRun comment reworded; new test names in the suite's verb style.
- 22 round-2 (60b708bb7): release isolated in try/catch (logged; the cancel still finishes); commit message names the issue-terminal cancellation path too.
- 22b round-2 (0e7a3154e, rebased on new 22): sweep selects only the run columns it needs; param typed Pick; comments updated; sweep test ends the run through cancelRun instead of a direct DB write. Evidence 22b-fail-on-22.log (2 fail).
- 02b: the `?.`/`??` on namedGatewayProtocol after the guard are upstream lines (TS does not narrow from the guard) -> left unchanged.
- 23b round-2: cross-request staleness test (profile exclude between two tools/list calls).
