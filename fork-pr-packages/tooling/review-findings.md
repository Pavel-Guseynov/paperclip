# Review round 2 findings (to verify and fix)
02: tests call createGatewayRouteApp(...,{withActorMiddleware:true}) - option exists only in 01 -> middleware not mounted (BLOCKER, rebase artifact); misleading test comments; vacuous audit assertion; path regex ignores method (nit)
02b: comment+commit say session endpoints don't consult allowedActions; tools/call does (executeTool assertGatewayTokenAction) -> only list path; dead ?./?? fallbacks
05: (1) credential text in structured string fields not stripped; (2) AUTH_SCHEME_PATTERN mangles "digest mismatch"/"basic x"; (3) redact-sensitive changes API responses (secret-sensitive routes) - scope; (4) err serializer can throw (no catch); (5) out-of-scope headers (dev-server status token, x-paperclip-signature, reorder); (6) unused exports CIRCULAR/HTTP_OBJECT/UNREADABLE markers, CREDENTIAL_LOG_FIELD_NAMES; (7) narration test comments l940,1202,1665; (8) circular assertions; issue #4759 ref
06: two extra production hunks (active-stage fallback, re-selection after policy edit) untested behavior change; nits (rewrites, comment narration/grammar, getExperimental as any mock, mockReset, commit claim)
07: unused `source` param; many unused/test-only exports; ledger never resets -> board resolve re-escalates; "upstream's" test comments; heartbeat.wakeup direct vs injectable; commit "unreleased environment lease" not covered by blocker check -> CHECK Fixes #13532 validity
08: isIncomingGenericSweep holds stranded_assigned_issue with specific causes (provider_quota/process_lost...) contradicting comment; heartbeat catch sites untested; event source/cause mix; notice wording
19: nits (comment, test names)
26: test actor lacks onBehalfOfUserId -> responsible-user check skipped; dead fixtures; docs drive-by (blockedByIssueIds list); untested inline comment/checkout 409/cross-company
03: cloud claim (applyCompatibilityEnvironment) doesn't update PAPERCLIP_RUNTIME_API_URL; GitHub broker URL not migrated; claude-local allowlist; env-variables doc; CLI precedence over explicit PAPERCLIP_API_URL; stale comments; boot pin self-inherit; cursor-cloud comment reflow
04: discovery serves all degraded incl. oauth_insufficient_scope / vercel auth failures (permanently advertised); ordering guard misses writers without lastHealthAt; unused export
04b: 409 details tool should be existing.toolName; isWrite refactor drive-by(nit)
23: missing fallback tests (grant, trust_rule, approval, wizard exemption, allow-default, tool_name include); applicationId column; commit claim on context-profile test
23b: no staleness test (nit)
24: stored expiresAt + "Short-lived" note contradict; UI shows Expired for live run token
25: link-local via proxied hostname (metadata) security; hostname >255 bytes length byte overflow; OAuth/token paths untested via proxy; SocketReader release without pause; port comment; duplicate checks; test issueId column
11: comment nits (pinned above/below, test wording in prod comment, requiredText claim)
12: comment nit
16: BLOCKER slack-bot./github-bot. tool_name entries stop matching (exclude widening); ambiguity from ineligible rows; circular migration test; doc comment
14: BLOCKER names unstable when eligibility changes; collision with virtual search_tools/run_tool; tautological length test; untested scope legacy
20: startup race: reap before waitForExternalAdapters; export unused; param widening; paused override inconsistency
21: BLOCKER shutdown flag per heartbeatService instance; TOCTOU before lock; timeout > 2^31; config-file key untested
28: removed destroyed guard -> spurious failure for quick-exit children (ERR_STREAM_DESTROYED); no SIGKILL escalation; possible flake; _phase naming
22: issue_terminal authority releases too; no error isolation in cancel paths (nit)
22b: stale comments; selects whole run row; test builds terminal state directly
27a: BLOCKER isLeaseLost hunk (legacy_controller_lease_expired) out of scope; native-review-dispatch CAS added; claimValues type admits status; comments; renames; "Upstream has 33" in commit msg
27c: SPEC overclaims every task status change; "transaction-time" vs clock_timestamp; exported types
27d: not every cancel path sets errorCode (status-decision-committer, native finalizer); lease-lost depends on 27a hunk; comment "Present when"
