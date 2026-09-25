# Upstream contribution branches: report

Date: 2026-09-25. Fork: `Pavel-Guseynov/paperclip`. Upstream: `paperclipai/paperclip`.

Base U (upstream `master`): `7b7c4d4172d6aac14919e2682b702ae87bc17653`.

## Outcome

- **`master` mirrors upstream.** `origin/master` moved from `d554c4789ed3930f8a53ac9fdf6503b3187097da` to `7b7c4d4172d6aac14919e2682b702ae87bc17653` with one lease-protected non-fast-forward push. Local `master` is at the same SHA.
- **13 branches, each based on U.** Each contains only its own change. 02 contains 01, and 10 contains 09. No branch contains a stable release-line commit, a merge of a stable base, `main`, or the excluded commits `012be06c6`, `46480d65e`, and `776b33836`. This was checked with `git rev-list` against `v2026.916.0`, `v2026.916.1`, and `main`.
- **Reviewed.** Independent reviews ran over four rounds, and the last commits of 04, 05, and 08 had a fifth round. Every finding is fixed, rejected with a stated reason, or listed below as open.
- **Regression proof for all 13.** Every regression test passes on its head and fails on U for the causal reason (table below).
- **Gates are incomplete.** The operator stopped the local gate runs before they finished. The full gate set completed at the exact head for 01, 03, 12, and 13 only. The per-branch status is below and in each PR body's "Gate results" section. Gates that were not reached are listed there as not reached.
- **PR packages.** All 13 PR bodies follow upstream's PR template. All pass upstream's offline PR checks (template, linked issue, dedup search, test coverage, lockfile). The one exception is 13's lockfile check, which is the documented blocker.

## Security items on `stable` and `main` (backport)

The first review found defects in content that came from the stable branches. The new branches fix them, but `main` still has them:

1. **02, auth bypass scope.** On `main`, `server/src/middleware/auth.ts` skips actor authentication for every request to `/api/tool-gateway/tools` and `/tools/call` (`|| sessionTokenEndpointsPath.test(req.path)`, with no credential condition). The route still requires a session token, but the agent-JWT run-header audit and the checks for terminated or pending agents do not run on these paths. Fixed on the branch by `263171cc1` and `4ef9dc846`.
2. **03, bridge authentication.** On `main`, `packages/adapter-utils/src/sandbox-callback-bridge.ts` relaxes bridge-token authentication for `/mcp/`, `/tool-gateway/`, and `/runtime-tools/`. On U this is an accepted security fix. Restored on the branch by `48cf95570`.
3. **09, SSRF and credential exfiltration.** On `main`, `server/src/services/delivery-verification.ts` takes the verification target from caller evidence (`evidence.repo`, `repoUrl`) and authenticates with `process.env.GITHUB_TOKEN`, `GH_TOKEN`, or `GITEA_TOKEN`. Fixed on the branch by `749711e4a`, which resolves the target only from server-held state, uses company-scoped credentials, and pins the host to `api.github.com`.
4. **06, approval gate.** The stable version dropped the approval-stage exclusion for all approval stages, which weakens the gate. Fixed on the branch by `dc66ea0e7`.

## Status per change

| ID | Branch | Stable head | Old fork head | New head | Regression on U | Gates at head | Review |
|---|---|---|---|---|---|---|---|
| 01 | `fix/codex-managed-mcp-auth` | `33ed8b206` | `14e3a9326` (on origin) | `9044c3df1` | 6/116 + 1/53 fail | complete | ready (R3) |
| 02 | `fix/tool-gateway-session-token-verification` | `8217e22a8` | `936969a60` (on origin) | `4ef9dc846` | 8/74, 4/54, 1/53 fail | partial: stopped after the runner gates | ready (R3) |
| 03 | `fix/codex-runtime-api-reachability` | `1cb7ece9c` | `f69a9b097` | `191a0283e` | 16 fail across 5 projects | complete, plus `cursor-cloud` | ready (R3) |
| 04 | `fix/remote-mcp-timeout-health` | `a450acc1e` | `925db9b34` | `cc46b33bc` | 15/17 + 2/2 fail | partial: stopped after the runner gates | ready (R5) |
| 05 | `fix/tool-gateway-token-log-redaction` | `387ffdcd4` | `fcc5dff7d` | `ad28f68df` | 35/94 fail | partial, at the earlier head `d0768999e` | ready (R5) |
| 06 | `fix/approval-stage-return-assignee` | `1c4a685f8` | `457f8d657` | `3c858b621` | 6/102 fail | not run | ready (R3) |
| 07 | `fix/retry-skipped-review-handoff` | `726fc4721` | `1791326a4` | `4a6ce422d` | 6/26 fail (wiring restored) | partial, at the earlier head `6b754cea8` | ready (R4); `4a6ce422d` not reviewed |
| 08 | `fix/workspace-validation-recovery-precedence` | `ccbf3a33b` | `6b6cd45b2` | `d9ea1f97a` | 11/48 fail | complete at the earlier head `3d317726f` | ready (R5) |
| 09 | `feat/verified-terminal-delivery-evidence` | `cfe4b837e` | `3386eb295` (on origin) | `fd7938815` | 27/159 fail | partial: serialized suites not reached | ready (R4) |
| 10 | `feat/revision-keyed-review-admission` | `f4c410b8e` | `391697849` | `bfd309231` | 3/66 and 2/66 fail (wiring) | not run (`check:migrations` passes) | ready (R4) |
| 11 | `fix/native-runner-darwin-lsof-unicode` | `c14cff271` | (new name) | `ea6107e61` | 4/22 fail | at the earlier head `66f851174` | ready (R3) |
| 12 | `test/workspace-runtime-exposure-isolation` | `8ab66bdb3` | (new name) | `127a04737` | causal test fails | complete | ready (R2) |
| 13 | `chore/pnpm-11-toolchain` | `c8a267aab` | (new name; old PR #13894) | `e3fe89cf5` | policy check fails on U | complete, plus pnpm policy and `sentry-contract` | ready (R3) |
| 14 | `fix/tool-gateway-client-safe-tool-names` | `6099ee048` | `8496e273e` | `21175f393` | 1/63 fail | complete | ready |
| 15 | `fix/tool-gateway-context-tools-token-actions` | `b3ea01a40` | `4272b3200` | `736b368ce` | 1/63 fail | complete | ready |
| 16 | `fix/tool-profile-tool-name-identity` | `f3f864e28` | `b947ac9bd` | `cdd35852c` | 1/72 fail | complete | ready |

"Old fork head" is the local branch head before this work. The three names already on origin (01, 02, 09) were updated with ordinary fast-forward pushes; their old heads are ancestors of the new heads. The other ten names are new on origin.

## Per change

For each change, the commits (with authors and cherry-pick sources), the changed files, and the commits that differ from its stable branch are listed in the appendix. The PR title and body are in `pr/<ID>.md` and `pr/titles.tsv`. Each body has the regression commands and results, and the gate results at its head.

### 01 Codex managed MCP authentication

- Title: `fix(server): authorize managed MCP gateway bearers for Codex`
- Conflicts against U: none. `git merge-tree` was clean. Upstream `f589660ec` (#13637) is adjacent to the auth hunk but does not overlap it.
- Review: R1 found 1 major issue (`notifications/initialized` double-charged the `sessionSetup` limiter and could return a JSON-RPC body) and 4 minor issues. All 5 were fixed in `9b1ac5dd5`. R2 found 1 minor issue and 2 nits, fixed in `9044c3df1`. R3: ready. Open, informational: the bearer prefix match is case-insensitive while the parser is case-sensitive. There is no bypass.
- Regression: `agent-auth-middleware`, `codex-local-execute`, and `tool-gateway` 116/116 on the head, 6 fail on U (`expected 401 to be 200`, missing `http_headers` Authorization). `codex-home` 53/53, 1 fails on U.
- Gates: complete. Every failure also fails on U, or passed when rerun alone. `db` `client.test.ts` passed 19/19 on its second isolated rerun, with the load average at 35.
- Duplicate check: open #12518 has the same production diff. It is a near-duplicate that has not merged, with a stale base. This branch was prepared because 02 depends on it. The PR body credits #12518 and offers to fold into it. #11957, #12287, #13112, and #11812 overlap only partly.
- Backport: `9b1ac5dd5` and `9044c3df1` need backport to stable. `ba859b917` is the upstream adaptation of stable `a11727785`.

### 02 Gateway session-token verification

- Title: `fix(server): accept run-scoped gateway session tokens as Authorization bearers`. Depends on 01.
- Conflicts: none against U. The merges of 01 into 02 resolve `auth.ts` to carry all three bypasses, with the managed bypass limited to POST.
- Review: R1 found a blocker (the bypass had no credential condition), 2 major issues, and 3 minor issues. These were fixed in `263171cc1`. The session-lookup rewrite was dropped in favor of upstream's lookup. The residual items were fixed in `4ef9dc846`. R3: ready.
- Regression: 128/128 and 53/53 on the head. On U, `tool-gateway.test.ts` fails 8/74 (`session_revoked` and `session_run_inactive` missing, `401` vs `200`).
- Gates: partial. The policy, typecheck, registry, build, and runner gates ran. The runner failures are U baselines. General-server, the projects, and the serialized suites were not reached.
- Duplicate check: none. #13140 describes the public `/mcp/gateways` path, which U has bypassed since #12345, so it is a related issue, not this change's exact scope. The body uses `Refs #13140`.
- Backport: `263171cc1` and `4ef9dc846` need backport to stable (security item 1).

### 03 Codex runtime API reachability

- Title: `fix(codex): give agents the internal runtime API URL, not the public origin`
- Conflicts: none textual. There are semantic interactions with U's bridge security fix, a new `brokerUrl` call site in U's heartbeat, and U's `sanitizeInheritedPaperclipEnv`. All are resolved in favor of U.
- Review: R1 found 3 blockers, 6 major, 3 minor, and 1 nit. The fixes are `48cf95570` (restores the bridge boundary byte for byte), `422f887ec` (removes the unwired reachability layer), and `74d3a4474`. R2 found one high issue (the default path still used the public URL), fixed in `191a0283e`. R3: ready. Open by design, as a non-goal: managed MCP from sandbox or SSH namespaces. That needs a cross-namespace auth design.
- Regression: cli 1/10, adapter-utils 7/267, codex-local 4/4, cursor-cloud 1/12, and server 3/27 fail on U. All pass on the head.
- Gates: complete. `agent-live-run-routes.test.ts` failed alone once on its first test's 15 s timeout. It passed 74/74 on a rerun. The first test takes the same time on U (7.6 s and 11.0 s) and on the head (7.7 s and 10.0 s). `@paperclipai/adapter-cursor-cloud` is not in the CI Vitest groups. It was run separately: 20/20.
- Duplicate check: #8130 was closed unmerged by its author. #4991, #12037, #9228, #10517, and #9916 overlap only partly. None delivers the change.
- Backport: `48cf95570` (security item 2), `74d3a4474`, and `191a0283e` need backport. `422f887ec` removes dead code and changes no behavior. Stable-only: `3c28049e2` (Nix `/run/current-system/sw/bin` PATH) stays out of the upstream branch.

### 04 Remote MCP timeout health

- Title: `fix(gateway): keep remote MCP tools listed after an ambiguous invocation timeout`
- Conflicts: four conflict markers in `tool-gateway.ts` against upstream's `useDefaultTimeout`, `sessionExpired` guard, and provider-pending 409 path. Each was resolved to keep both sides (merge `c949a27d7`).
- Review: R1 found 2 blockers, 6 major, and 5 minor issues, fixed in `1be2f68a6`. R2 found 2 medium issues (fail-open staleness, replay decided from the request), fixed in `6a4c573ad`. R3 and R4 found only comment accuracy issues, fixed in `b87489782` and `7b9526e89`. R5 found a missing call-time writer in the comment, fixed in `cc46b33bc` (comment only). The same review re-swept every `healthStatus` writer and judged it ready.
- Regression at `cc46b33bc`: 15/17 and 2/2 fail on U, and all pass on the head.
- Gates: partial at `cc46b33bc`. The policy, typecheck, build, and runner gates ran. The tests were not reached.
- Duplicate check: #11910 keeps the connection `ok` after a timeout. That is a partial overlap with a weaker contract.
- Backport: `1be2f68a6`, `6a4c573ad`, and `b87489782` need backport. `925db9b34` and `7b63b4134` adapt stable's `5275fbab4` and `ebc935173` to U; the `heartbeat.ts` and `runtime-context.ts` hunks are excluded. `7b9526e89` and `cc46b33bc` are comment-only.

### 05 Gateway token log redaction

- Title: `fix(logger): redact tool gateway credentials from every log path`
- Conflicts: none textual. A defect in the clean auto-merge was fixed: the `x-paperclip-github-capability` redact path appeared twice (upstream #13826 and the fork). All paths now derive from one list.
- Review: R1 found 3 blockers, 5 major, and more; fixed in `f48b21b95`. R2 found one high issue (unbounded or cyclic recursion could throw out of the logger), fixed in `9ad1ba3b1` and `8d98d429b`. The fixes in R3 and R4 are `257a8d09f` and `d0768999e`. R5 found a low, security-shaped issue: a proxy trap that threw in a type probe at the top level returned the record unredacted. That was fixed in `8802f09f1` and `ad28f68df`, and ready was confirmed. Open, low: holes in a sparse array are read as `undefined`. Open, nit: an `[Unreadable]` sentinel collides with a literal value; the output is the same. Out of scope and fail-closed: a hostile proxy inside an `err` property makes the log call throw. `master` behaves the same.
- Regression at `ad28f68df`: 35/94 fail on U (sentinel tokens in the 200, 401, 502, and 500 records). On `d0768999e`, the new probe test leaked the `pcgt_` token. 94/94 pass on the head.
- Gates: partial, at the earlier head `d0768999e`. The serialized suites were not reached, and the other failures were not triaged.
- Duplicate check: #10784 adds three header names. It is a partial overlap that this change covers.
- Backport: `98fa66a99`, `87de1554a`, `9ad1ba3b1`, `257a8d09f`, `d0768999e`, `8802f09f1`, and `ad28f68df` need backport. `fcc5dff7d` adapts stable `c81f32727`. Stable also changes `error-handler.ts` and the tool gateway routes. Those changes were reverted out of this branch's scope, so every error response on stable differs from upstream.

### 06 Approval return-assignee selection

- Title: `fix(server): honor approval-stage returnAssignee participant selection`
- Conflicts: none. The merged test file unions upstream #13539's mocks with this branch's.
- Review: R1 found 4 major issues, 2 minor, and 1 nit. `dc66ea0e7` fixed A1 (the exclusion dropped for all approval stages), A2, A6, and A7. A3 was rejected: the lines are upstream context. A4 was resolved by removing a concurrency test that proved nothing; the invariant cannot be checked at the PATCH level. A5 was fixed in `3c858b621`. R3: ready. Open: the registry document's criterion "concurrency coverage must prove one selection or skip" is now unmet. It needs a document change or a separate lost-update issue.
- Regression: 6/102 fail on U (`No eligible approval participant`, `422` vs `200`).
- Gates: not run (the runs were stopped first).
- Duplicate check: #5951 deletes one exclusion line. That is a partial overlap and not enough on its own; it is linked.
- Backport: `dc66ea0e7` needs backport (security item 4). `3c858b621` changes tests only.

### 07 Review handoff retry

- Title: `fix(server): retry a skipped review handoff after its stale blocker clears`
- Conflicts: none. The merged `routes/issues.ts` carries both imports.
- Review: R1 found 2 blockers (no durable index; escalation bypassed the recovery-action service), 4 major, 3 minor, and 2 nits, fixed in `bea674b14`. R2 found one medium-high issue (a refused wake looped forever), fixed in `eecdd783f`. R3 found 2 medium issues, fixed in `6b754cea8`. R4: ready.
- Found by the gates after review: at `6b754cea8`, `pnpm -r typecheck` and `pnpm build` failed in `@paperclipai/db` `check:migrations` (`large-create-index-not-concurrently` on `0284_rapid_prowler.sql`). Fixed in `4a6ce422d` with upstream's documented `migration-safety-ignore` justification. Upstream's check splits a migration that has no breakpoints on every semicolon, so the comment contains none. At `4a6ce422d`, `check:migrations`, the db typecheck, and the db build pass, and 26/26 tests pass. `4a6ce422d` has not had an independent review.
- Regression: with only the wiring restored to U, 6/26 fail (`expected +0 to be 1`, no wake).
- Gates: partial, at the earlier head `6b754cea8`. The serialized suites were not reached.
- Duplicate check: none.
- Note: this branch's migration number is `0284`, and so is 09's. The second pull request to merge must regenerate its migration.
- Backport: `bea674b14`, `eecdd783f`, and `6b754cea8` need backport. `6488168d9` adapts stable `726fc4721` (test teardown). Stable `353b1a4c0` (retry and sleep teardown) stays excluded. `4a6ce422d` is an upstream-only migration annotation.

### 08 Workspace recovery precedence

- Title: `fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures`
- Conflicts: none textual. There are semantic interactions (U's operator-owned `branch_mismatch` contract, and both call sites of `resolveStrandedRecoveryCause`), and both were resolved.
- Review: R1 found 2 blockers, 4 major, and 6 minor issues, fixed across `84f5a6b95`, `87c709570`, and `56d33552e`. R2's findings were fixed in `6548c1abd` and `cc317726f`, which dropped the whole `workspace-runtime.ts` hunk. R3's findings were fixed in `3d317726f`, which removed the legacy-recovery exemption as dead code. R4: ready. Upstream's module-boundary check then failed on a deep import into `wake-queue/domain/values.js`. That was fixed in `d9ea1f97a` with upstream's literal, because the module index would create an import cycle. R5 confirmed it: behavior is unchanged, and it is ready. Nit: the code value has no single authority in upstream. That is upstream debt and a follow-up, not in this branch.
- Regression: 11/48 fail on U, and 48/48 pass on the head.
- Gates: complete at `3d317726f`. The module-boundary failures there are fixed at `d9ea1f97a`, where the boundary check, its test, and the server typecheck pass.
- Duplicate check: none. #5135 points the opposite way on the same code path, so it would be a design conflict if it lands.
- Backport: `84f5a6b95`, `6548c1abd`, and `3d317726f` need backport. `d9ea1f97a` is an upstream-only adaptation to U's module boundary. The other commits change tests only.

### 09 Verified terminal delivery evidence

- Title: `feat(issues): verify delivery evidence before an evidence-gated issue closes`
- Conflicts: only the migration snapshot and journal. The migration was renumbered 0282 → 0284 and regenerated with `pnpm --filter @paperclipai/db generate` on U.
- Review: R1 found 4 blockers (security item 3, an inverted containment predicate, an empty-SHA prefix match, and caller-writable `verified`/`receipt`), fixed in `749711e4a`. R2 found 2 high and 1 medium issue, fixed in `432f33087` and `b4c4fa460`. The native status committer is a documented scope limit: gating it would livelock the retry loop. R3 found a high bypass by stage replacement, fixed in `94382e34c`. R4 found a low issue (an idempotent re-close returned 422), fixed in `fd7938815`. Ready.
- Regression: 27 of the 159 loadable tests fail on U. 208/208 pass on the head.
- Gates: partial. The serialized suites were not reached, and the other failures were not triaged.
- Duplicate check: #11196 is a near-duplicate of the first half. Its two commits are kept with their authorship, and the body offers to fold into #11196.
- Backport: `749711e4a` (security item 3), `432f33087`, `94382e34c`, and `fd7938815` need backport. `da340c929` and the migration are upstream-only adaptations. Stable-only: `c6e473214` and `1fa4c9440`, stable's migration snapshots.

### 10 Revision-keyed review admission

- Title: `feat(review): record revision-keyed review admissions`. Depends on 09.
- Conflicts: `packages/shared` index and type tails, resolved by appending both sides. The migration was renumbered 0283 → 0285, because U already has `0283_jittery_psynapse`.
- Review: R1 found a blocker: no production path created an admission. That was fixed in `242da9c42` and `c748ea50f`. R2 found 3 medium issues, fixed in `975e27783` (a round column, a savepoint, and an acceptance-only digest). R3's findings were fixed in `6e54a49b2`. R4: ready. Open by design: nothing reads `review_admissions` yet. The typed PR-read and review-submit half is superseded by U's `chat-github-tools.ts` (#13717).
- Regression: with only the wiring restored, 3/66 fail (U committer) and 2/66 fail (09's interactions file).
- Gates: not run. `check:migrations` passes.
- Duplicate check: none.
- Backport: `c748ea50f` and `975e27783` need backport. `242da9c42` removes unreachable tools and changes no behavior. `f8f263c7b` adapts stable `e934d66c6`.

### 11 Native runner lsof Unicode

- Title: `fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode`
- Conflicts: none.
- Review: R1's findings were fixed across `710d22f91`, `fb87e63e7`, and `66f851174`; the history was rebuilt so that no commit carries the corrupting decoder. R2 found a medium issue (lsof escaping depends on the locale), fixed in `ea6107e61`. R3 checked this against the real `/usr/sbin/lsof`: ready.
- Regression: 4/22 fail on U. Upstream's own `file-delivery-bridges.test.ts` fails on U on macOS for this defect, and it passed at `66f851174`.
- Gates: at the earlier head `66f851174`, with an older set of gate phases.
- Duplicate check: none. The CONTRIBUTING line "We do not gate PRs on a pre-existing issue" means no issue is required, and the body describes the bug in the issue template's shape.
- Backport: `710d22f91`, `fb87e63e7`, and `ea6107e61` need backport. Stable's `45376158d` and `f1a6e7867` are the superseded decoder.

### 12 Workspace runtime exposure isolation

- Title: `test(server): isolate workspace runtime port reservations between tests`
- Conflicts: none. It merges coherently with upstream #13895 and #13824.
- Review: R1 found 1 major issue (the isolation change swapped the code path under test), fixed in `145ab9fba` and `127a04737`. R2: ready.
- Regression: `clears in-flight port reservations when runtime services are reset for tests` fails on U and passes on the head.
- Gates: complete.
- Duplicate check: none. No issue is required, as for 11.
- Backport: `127a04737` changes tests only. `0567e60e1` adapts stable `d453bb3ee`.

### 13 pnpm 11 toolchain

- Title: `refactor(toolchain): migrate the repository to pnpm 11.21.0`. A `chore` title would fail upstream's test-coverage check.
- Conflicts (six): upstream #13827 deleted `docker-cloud.yml`; the deletion was accepted. In `package.json`, all upstream scripts were kept. In `pnpm-workspace.yaml`, upstream's `postgres@3.4.9` and `@lezer/common` were kept. The lockfile was regenerated. The acpx contract and CodeMirror tests were re-applied on U's versions.
- Review: R1 found 1 blocker (the title), 3 major, and more issues, fixed in `49d6f1fed`. R2 was not ready: there was no test for the policy script, and the lockfile movements were not disclosed. `e3fe89cf5` added 10 fixture tests, and the body discloses the movements. R3: ready. N13-1 (fingerprint fail-open) was rejected with a stated reason.
- Regression: the policy check fails on U with the full list (package manager, `package.json#pnpm`, `autoInstallPeers`, `allowBuilds`, 44 workflow pins, the Dockerfile, and docs) and passes on the head.
- Gates: complete, plus `pnpm check:pnpm-version`, its test, and the `sentry-contract` job, which all pass.
- **Blockers (maintainer direction needed):**
  1. `check-pr-lockfile.mjs` accepts `pnpm-lock.yaml` only from `github-actions[bot]` on `chore/refresh-lockfile`.
  2. `pr.yml` runs `pr-trusted.yml@master`. That file pins pnpm 9.15.4, so this branch's workflow pins cannot apply to its own CI.
- Supersedes #13894. #13894 was built on `d554c4789`, which is not an ancestor of U, and it carried four leaked hunks: the older lsof decoder, the Nix PATH entry, a `vitest.config.ts` `testTimeout`, and a fixture rewrite. #13894 was left untouched.
- Backport: `49d6f1fed` needs backport. `72300cd3c` adapts stable `c8a267aab`. Stable-only: the four leaked hunks in `c8a267aab`.

### 14 Client-safe gateway tool names

- Title: `fix(tool-gateway): assign client-safe tool names and preserve legacy tool transition`
- Conflicts against U: none.
- Regression: `lists client-safe tool names matching ^[A-Za-z0-9_-]{1,40}$ for harness-mcp-openobserve` fails on U with `expected 'mcp-remote-fixture:echo' to match /^[A-Za-z0-9_-]{1,40}$/` and passes on the head (77/77 passed on contribution head, 68/68 on stable, 71/71 on fork main).
- Gates: complete. `pnpm -r typecheck` (0), `pnpm build` (0), `pnpm check:tokens && pnpm check:token-gates` (0), and `tool-gateway.test.ts` pass cleanly.
- Dependency: Depends on Change 16 (`fix/tool-profile-tool-name-identity`). The dual lookup fallback `legacyNames.includes(entry.toolName)` was removed in favor of single catalog identity, and legacy profile entries are migrated to catalog identity via `migrateLegacyProfileToolNameEntries`.
- Backport: merged `stable/v2026.916.1/fix/tool-profile-tool-name-identity` into `stable/v2026.916.1/fix/tool-gateway-client-safe-tool-names` (`6099ee048`).

### 15 Gateway context tools gated by token actions

- Title: `fix(tool-gateway): gate context tools and capabilities by token allowedActions`
- Conflicts against U: none.
- Regression: `gates gateway context tools and capabilities by token allowedActions` fails on base with `expected { tools: {}, resources: {}, prompts: {} } to deeply equal { tools: {} }` and passes on the head (72/72 passed on contribution head, 63/63 on stable, 71/71 on fork main).
- Behavioral tests: Token with all six actions lists and calls all four context tools (`paperclip_list_resources`, `paperclip_read_resource`, `paperclip_list_prompts`, `paperclip_get_prompt`) returning 200 `isError: false`; token with subset actions lists only matching tools/capabilities and forbidden calls return 403 `gateway_token_action_denied`.
- Gates: complete. `pnpm -r typecheck` (0), `pnpm build` (0), `pnpm check:tokens && pnpm check:token-gates` (0), and `tool-gateway.test.ts` pass cleanly.
- Backport: clean cherry-pick `b3ea01a40` onto `stable/v2026.916.1/fix/tool-gateway-context-tools-token-actions`.

### 16 Tool profile tool_name selector identity

- Title: `fix(tool-access): use catalog tool name as single identity for tool_name profile selectors`
- Conflicts against U: none.
- Regression: `resolves tool_name profile selector against catalog upstream tool name` fails on base with `AssertionError: expected undefined to be defined` and passes on the head (73/73 passed on contribution head, 64/64 on stable, 71/71 on fork main).
- Migration: Verified against real database (`tool_profile_entries`) across three distinct states: clean database (0 migrated), unmigrated database (legacy and client-safe entries converted to catalog tool name, fixture and plugin tools preserved untouched), and converted database (0 migrated, converted exactly once).
- Gates: complete. `pnpm -r typecheck` (0), `pnpm build` (0), `pnpm check:tokens && pnpm check:token-gates` (0), and `tool-gateway.test.ts` pass cleanly.
- Backport: clean cherry-pick `f3f864e28` onto `stable/v2026.916.1/fix/tool-profile-tool-name-identity`.

## Environment and baseline

- The machine was macOS arm64 (14 cores) with Node 24.19.0. pnpm was 9.15.4, or 11.21.0 on branch 13. Up to six gate runs ran in parallel, with a load average of 30 to 49. Every test-file failure that is not a U baseline was rerun alone. Only the files listed as not triaged in the PR bodies were not rerun, because the operator stopped the runs.
- U's lockfile does not match U's manifests. Installs used upstream CI's fallback (`pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile`, then a frozen install).
- Gates that fail on U itself here: the runner Rust test `verified_launch_preserves_homebrew_node_loader_layout` (a Nix store Node binary, `Permission denied` on snapshot), the runner Vitest files `runnerd-codex-transport` and `mock-core/local-runner`, the server files `cursor-local-adapter-environment`, `cursor-local-execute`, `file-delivery-bridges` (fixed by 11), and `workspace-runtime` (five worktree pnpm-install tests), seven serialized suites, one `db` migration test, four `adapter-utils` files, and the `paperclipai` `company-import-transfer` test. The Rust sources are identical to U on all 13 branches. A `--no-fail-fast` run gave 581 passed and 1 failed (the test above). The two parity checks pass.
- Not run for any branch: Docker context integrity and the image jobs (no Docker daemon); the e2e shards (a live instance uses port 3100 and `~/.paperclip`); the canary dry run (it needs `git checkout -B master HEAD`); `storybook-visual` (label-gated). `docker-runner-check` is path-triggered and not triggered by any branch.

## Registry updates (for the registry owner)

- The branches, heads, and PR titles are as in the status table. No `contributionPullRequest` exists yet, because the operator opens the pull requests.
- `upstreamPullRequests` to add or confirm: 04 → #11910, 05 → #10784, 06 → #5951, 09 → #11196 (already listed), 13 → #13894 (superseded by the new branch).
- 01: near-duplicate of open #12518. 02: #13140 is related, but its public `/mcp/gateways` path is outside this change.
- 07: #13515 is merged. It is adjacent recovery work, not a duplicate.
- 06: the document's concurrency criterion is unmet (see 06). 10: `review_admissions` has no reader. 03: the non-goals are listed in the body.
- 11 and 12: upstream's CONTRIBUTING (line 55) does not require an issue before a PR.
- The security backports to `stable`/`main` are listed above.

## Housekeeping

- The pre-existing stash in the main checkout (`stash@{0}`, from 2026-09-20, "uncommitted changes on fix/tool-gateway-session-token-verification", 6 files) is preserved without changes. It is also committed as branch `wip/stash-2026-09-20` on the fork.
- An orphaned `paperclip-runnerd` from an early test run in a scratch clone had written a durable-session state directory inside the live instance's home: `~/.paperclip/instances/default/runtime/paperclip-runner/durable-sessions/dbff127049d0e89b0fd55325e2dff1e56adffe538c9ff8c318f110fabd6ec3ef/`. The process was stopped with SIGTERM. The directory was left in place, because it is not in `/tmp` and it belongs to the live instance's data tree.

## Appendix: commits, files, and differences from stable per branch
### 01 `fix/codex-managed-mcp-auth`

- Head: `9044c3df1abf7f523a142f3aa795472ff0246cf1`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 7 commits (1 merges); diff vs U: 9 files changed, 360 insertions(+), 21 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `05aa608d3` Codex: fix(codex-local): use HTTP headers for managed MCP (cherry picked from `b684a47c0`)
  - `ba859b917` Codex: fix(server): authorize managed MCP gateway bearers (cherry picked from `f57a8c556`)
  - `48f3d917e` Codex: fix(server): harden managed MCP lifecycle (cherry picked from `a4ff57049`)
  - `14e3a9326` pavel.guseynov: test(server): verify full managed gateway lifecycle with actor middleware
  - `87b944d14` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/codex-managed-mcp-auth
  - `9b1ac5dd5` pavel.guseynov: fix(server): scope managed MCP gateway auth and stop double-charging its handshake
  - `9044c3df1` pavel.guseynov: fix(server): keep an MCP notification free of writes and the descriptor authenticated
- Files:
  - M `packages/adapters/codex-local/src/server/codex-home.test.ts`
  - M `packages/adapters/codex-local/src/server/codex-home.ts`
  - M `server/src/__tests__/agent-auth-middleware.test.ts`
  - M `server/src/__tests__/codex-local-execute.test.ts`
  - M `server/src/__tests__/tool-gateway.test.ts`
  - A `server/src/lib/uuid.ts`
  - M `server/src/middleware/auth.ts`
  - M `server/src/routes/tool-gateway.ts`
  - M `server/src/services/tool-gateway.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/codex-managed-mcp-auth`:
  - `ba859b917` fix(server): authorize managed MCP gateway bearers (cherry picked from `f57a8c556`)
  - `9b1ac5dd5` fix(server): scope managed MCP gateway auth and stop double-charging its handshake
  - `9044c3df1` fix(server): keep an MCP notification free of writes and the descriptor authenticated
- Stable-only commits (not on this branch):
  - `a11727785` fix(server): authorize managed MCP gateway bearers

### 02 `fix/tool-gateway-session-token-verification`

- Head: `4ef9dc8464bc00e1ecbd6295146337fa1ee94370`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 14 commits (4 merges); diff vs U: 11 files changed, 812 insertions(+), 28 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `05aa608d3` Codex: fix(codex-local): use HTTP headers for managed MCP (cherry picked from `b684a47c0`)
  - `ba859b917` Codex: fix(server): authorize managed MCP gateway bearers (cherry picked from `f57a8c556`)
  - `48f3d917e` Codex: fix(server): harden managed MCP lifecycle (cherry picked from `a4ff57049`)
  - `14e3a9326` pavel.guseynov: test(server): verify full managed gateway lifecycle with actor middleware
  - `936969a60` pavel.guseynov: fix(server): repair run-scoped gateway session-token verification
  - `87b944d14` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/codex-managed-mcp-auth
  - `73fec6c33` pavel.guseynov: Merge fix/codex-managed-mcp-auth (upstream master 7b7c4d417) into fix/tool-gateway-session-token-verification
  - `875ed9c70` pavel.guseynov: style(tool-gateway): remove trailing blank line at EOF (cherry picked from `8963d0006`)
  - `9b1ac5dd5` pavel.guseynov: fix(server): scope managed MCP gateway auth and stop double-charging its handshake
  - `11554b8e1` pavel.guseynov: Merge branch 'fix/codex-managed-mcp-auth' into fix/tool-gateway-session-token-verification
  - `263171cc1` pavel.guseynov: fix(server): narrow the session-token handoff and drop the redundant lookup rewrite
  - `9044c3df1` pavel.guseynov: fix(server): keep an MCP notification free of writes and the descriptor authenticated
  - `72642f3c1` pavel.guseynov: Merge branch 'fix/codex-managed-mcp-auth' into fix/tool-gateway-session-token-verification
  - `4ef9dc846` pavel.guseynov: fix(server): read only a session-token bearer on the run-scoped endpoints
- Files:
  - M `doc/MCP-ACCESS-GOVERNANCE.md`
  - M `doc/MCP-DEMO-SCRIPT.md`
  - M `packages/adapters/codex-local/src/server/codex-home.test.ts`
  - M `packages/adapters/codex-local/src/server/codex-home.ts`
  - M `server/src/__tests__/agent-auth-middleware.test.ts`
  - M `server/src/__tests__/codex-local-execute.test.ts`
  - M `server/src/__tests__/tool-gateway.test.ts`
  - A `server/src/lib/uuid.ts`
  - M `server/src/middleware/auth.ts`
  - M `server/src/routes/tool-gateway.ts`
  - M `server/src/services/tool-gateway.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/tool-gateway-session-token-verification`:
  - `ba859b917` fix(server): authorize managed MCP gateway bearers (cherry picked from `f57a8c556`)
  - `9b1ac5dd5` fix(server): scope managed MCP gateway auth and stop double-charging its handshake
  - `263171cc1` fix(server): narrow the session-token handoff and drop the redundant lookup rewrite
  - `9044c3df1` fix(server): keep an MCP notification free of writes and the descriptor authenticated
  - `4ef9dc846` fix(server): read only a session-token bearer on the run-scoped endpoints
- Stable-only commits (not on this branch):
  - `a11727785` fix(server): authorize managed MCP gateway bearers

### 03 `fix/codex-runtime-api-reachability`

- Head: `191a0283e7b28c2e064a9aabec3e72f027c9c36c`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 7 commits (1 merges); diff vs U: 18 files changed, 400 insertions(+), 27 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `7daba2412` FlopBut: fix(server): honor pre-set PAPERCLIP_RUNTIME_API_URL (cherry picked from `ac3324fa0`)
  - `f69a9b097` pavel.guseynov: fix(codex): ensure runtime API reachability across CLI and ACP execution modes
  - `fdece1082` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/codex-runtime-api-reachability
  - `48cf95570` pavel.guseynov: fix(security): restore the sandbox callback bridge authentication boundary
  - `422f887ec` pavel.guseynov: refactor(codex): drop the unwired reachability probe layer
  - `74d3a4474` pavel.guseynov: fix(codex): resolve the agent callback URL in the namespace that dials it
  - `191a0283e` pavel.guseynov: fix(server): keep a PAPERCLIP_API_URL override as the internal callback URL
- Files:
  - M `cli/src/__tests__/common.test.ts`
  - M `cli/src/commands/client/common.ts`
  - M `doc/AGENT-ARTIFACTS.md`
  - M `doc/CLI.md`
  - M `packages/adapter-utils/src/execution-target-sandbox.test.ts`
  - M `packages/adapter-utils/src/execution-target.ts`
  - M `packages/adapter-utils/src/server-utils.test.ts`
  - M `packages/adapter-utils/src/server-utils.ts`
  - A `packages/adapters/codex-local/src/server/execute.runtime-callback.test.ts`
  - M `packages/adapters/codex-local/src/server/execute.ts`
  - M `packages/adapters/cursor-cloud/src/server/execute.test.ts`
  - M `packages/adapters/cursor-cloud/src/server/execute.ts`
  - M `server/src/__tests__/heartbeat-runtime-mcp-servers.test.ts`
  - M `server/src/__tests__/server-startup-feedback-export.test.ts`
  - M `server/src/index.ts`
  - M `server/src/runtime-api.ts`
  - M `server/src/services/heartbeat.ts`
  - M `skills/paperclip/scripts/paperclip-upload-artifact.sh`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/codex-runtime-api-reachability`:
  - `48cf95570` fix(security): restore the sandbox callback bridge authentication boundary
  - `422f887ec` refactor(codex): drop the unwired reachability probe layer
  - `74d3a4474` fix(codex): resolve the agent callback URL in the namespace that dials it
  - `191a0283e` fix(server): keep a PAPERCLIP_API_URL override as the internal callback URL
- Stable-only commits (not on this branch):
  - `3c28049e2` fix(adapter-utils): include /run/current-system/sw/bin in defaultPathForPlatform

### 04 `fix/remote-mcp-timeout-health`

- Head: `cc46b33bc9f46b1dd08cf1117e15582a22f6996c`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 8 commits (1 merges); diff vs U: 6 files changed, 1148 insertions(+), 12 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `925db9b34` pavel.guseynov: fix(gateway): preserve remote MCP catalogs after ambiguous invocation timeouts
  - `7b63b4134` pavel.guseynov: fix(gateway): omit degraded connections from runtime MCP servers and guard against stale timeout health update (cherry picked from `ebc935173`)
  - `c949a27d7` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/remote-mcp-timeout-health
  - `1be2f68a6` pavel.guseynov: fix(gateway): classify remote MCP failures at one point and order health writes
  - `6a4c573ad` pavel.guseynov: fix(gateway): order only the ambiguous health observation and decide replay from the stored call
  - `b87489782` pavel.guseynov: fix(gateway): serve every non-terminal attention state from the tool catalog
  - `7b9526e89` pavel.guseynov: docs(gateway): describe every writer of the degraded catalog state accurately
  - `cc46b33bc` pavel.guseynov: docs(gateway): name the call-time and catalog-refresh writers of the degraded state
- Files:
  - M `packages/shared/src/constants.ts`
  - M `packages/shared/src/index.ts`
  - A `packages/shared/src/tool-connection-health.test.ts`
  - A `server/src/__tests__/remote-mcp-timeout-health.test.ts`
  - M `server/src/services/tool-access-policy.ts`
  - M `server/src/services/tool-gateway.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/remote-mcp-timeout-health`:
  - `925db9b34` fix(gateway): preserve remote MCP catalogs after ambiguous invocation timeouts
  - `7b63b4134` fix(gateway): omit degraded connections from runtime MCP servers and guard against stale timeout health update (cherry picked from `ebc935173`)
  - `1be2f68a6` fix(gateway): classify remote MCP failures at one point and order health writes
  - `6a4c573ad` fix(gateway): order only the ambiguous health observation and decide replay from the stored call
  - `b87489782` fix(gateway): serve every non-terminal attention state from the tool catalog
  - `7b9526e89` docs(gateway): describe every writer of the degraded catalog state accurately
  - `cc46b33bc` docs(gateway): name the call-time and catalog-refresh writers of the degraded state
- Stable-only commits (not on this branch):
  - `5275fbab4` fix(gateway): preserve remote MCP catalogs after ambiguous invocation timeouts
  - `ebc935173` fix(gateway): omit degraded connections from runtime MCP servers and guard against stale timeout health update

### 05 `fix/tool-gateway-token-log-redaction`

- Head: `ad28f68df8bce0b2fa5709ac641d462861984e04`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 14 commits (1 merges); diff vs U: 4 files changed, 1490 insertions(+), 32 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `fcc5dff7d` pavel.guseynov: fix(logger): redact Paperclip gateway credentials from every log path
  - `6d99a1014` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/tool-gateway-token-log-redaction
  - `e0c7c3ba6` pavel.guseynov: fix(logger): preserve diagnostic bearer prose and error messages without over-redaction (cherry picked from `11fb87d7f`)
  - `e1bfa48fb` pavel.guseynov: style: remove trailing blank lines at EOF (cherry picked from `34814acf1`)
  - `b64f1376e` pavel.guseynov: fix(logger): preserve request serialization and redact credentials in production httpLogger (cherry picked from `387ffdcd4`)
  - `98fa66a99` pavel.guseynov: fix(logger): redact gateway credentials through one derived redaction authority
  - `87de1554a` pavel.guseynov: fix(logger): drop the redundant error-context scrub and cover unlisted headers
  - `f48b21b95` pavel.guseynov: test(logger): prove the redactor leaves Node HTTP objects untouched
  - `9ad1ba3b1` pavel.guseynov: fix(logger): bound the error sanitizer and redact nested credential fields
  - `8d98d429b` pavel.guseynov: test(logger): prove one authority decides every credential field name
  - `257a8d09f` pavel.guseynov: fix(logger): project stray HTTP objects and match every credential spelling
  - `d0768999e` pavel.guseynov: fix(logger): keep redacting a record past a field it cannot read
  - `8802f09f1` pavel.guseynov: fix(logger): redact a record whose proxy trap throws in a type probe
  - `ad28f68df` pavel.guseynov: fix(logger): guard the top-level HTTP-object probe under req, res, and err
- Files:
  - M `server/src/__tests__/http-log-redaction.test.ts`
  - M `server/src/middleware/http-log-redaction.ts`
  - M `server/src/middleware/logger.ts`
  - M `server/src/middleware/redact-sensitive.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/tool-gateway-token-log-redaction`:
  - `fcc5dff7d` fix(logger): redact Paperclip gateway credentials from every log path
  - `98fa66a99` fix(logger): redact gateway credentials through one derived redaction authority
  - `87de1554a` fix(logger): drop the redundant error-context scrub and cover unlisted headers
  - `f48b21b95` test(logger): prove the redactor leaves Node HTTP objects untouched
  - `9ad1ba3b1` fix(logger): bound the error sanitizer and redact nested credential fields
  - `8d98d429b` test(logger): prove one authority decides every credential field name
  - `257a8d09f` fix(logger): project stray HTTP objects and match every credential spelling
  - `d0768999e` fix(logger): keep redacting a record past a field it cannot read
  - `8802f09f1` fix(logger): redact a record whose proxy trap throws in a type probe
  - `ad28f68df` fix(logger): guard the top-level HTTP-object probe under req, res, and err
- Stable-only commits (not on this branch):
  - `c81f32727` fix(logger): redact Paperclip gateway credentials from every log path

### 06 `fix/approval-stage-return-assignee`

- Head: `3c858b6212b46907e0b5a70ba088c5ad772ad4a6`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 4 commits (1 merges); diff vs U: 3 files changed, 865 insertions(+), 58 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `457f8d657` pavel.guseynov: fix(server): honor approval-stage returnAssignee participant selection (#4912)
  - `0b5fc2e2e` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/approval-stage-return-assignee
  - `dc66ea0e7` pavel.guseynov: fix(server): keep the approval-stage exclusion while honoring returnAssignee
  - `3c858b621` pavel.guseynov: test(server): keep the execution-policy route mocks per case
- Files:
  - M `server/src/__tests__/issue-execution-policy-routes.test.ts`
  - M `server/src/__tests__/issue-execution-policy.test.ts`
  - M `server/src/services/issue-execution-policy.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/approval-stage-return-assignee`:
  - `dc66ea0e7` fix(server): keep the approval-stage exclusion while honoring returnAssignee
  - `3c858b621` test(server): keep the execution-policy route mocks per case
- Stable-only commits (not on this branch):

### 07 `fix/retry-skipped-review-handoff`

- Head: `4a6ce422dd655ceb80d2c38e71e7110556369e9a`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 8 commits (1 merges); diff vs U: 9 files changed, 2242 insertions(+), 28 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `1791326a4` pavel.guseynov: fix(server): retry skipped review handoffs after stale blockers clear (#13532)
  - `7079ee13e` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/retry-skipped-review-handoff
  - `297b2430b` pavel.guseynov: style: remove trailing blank line at EOF in server/src/services/recovery/index.ts (cherry picked from `f94cfeabe`)
  - `6488168d9` pavel.guseynov: test(server): deterministic lifecycle completion for review handoff retry teardown (cherry picked from `353b1a4c0`, `726fc4721`)
  - `bea674b14` pavel.guseynov: fix(server): make the review handoff retry durable across processes
  - `eecdd783f` pavel.guseynov: fix(server): decide the review handoff from its persisted wake receipt
  - `6b754cea8` pavel.guseynov: fix(server): keep the review handoff live when a dependent or wake fails
  - `4a6ce422d` pavel.guseynov: fix(db): declare the review-handoff index exception to the migration safety check
- Files:
  - A `packages/db/src/migrations/0284_rapid_prowler.sql`
  - D `packages/db/src/migrations/meta/0279_snapshot.json`
  - A `packages/db/src/migrations/meta/0284_snapshot.json`
  - M `packages/db/src/migrations/meta/_journal.json`
  - M `packages/db/src/schema/agent_wakeup_requests.ts`
  - A `server/src/__tests__/heartbeat-review-handoff-retry.test.ts`
  - M `server/src/routes/issues.ts`
  - A `server/src/services/recovery/review-handoff-retry.test.ts`
  - A `server/src/services/recovery/review-handoff-retry.ts`
  - M `server/src/services/recovery/service.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/retry-skipped-review-handoff`:
  - `6488168d9` test(server): deterministic lifecycle completion for review handoff retry teardown (cherry picked from `353b1a4c0`, `726fc4721`)
  - `bea674b14` fix(server): make the review handoff retry durable across processes
  - `eecdd783f` fix(server): decide the review handoff from its persisted wake receipt
  - `6b754cea8` fix(server): keep the review handoff live when a dependent or wake fails
  - `4a6ce422d` fix(db): declare the review-handoff index exception to the migration safety check
- Stable-only commits (not on this branch):
  - `353b1a4c0` test(server): harden database teardown in review handoff retry tests against async run race
  - `726fc4721` test(server): deterministic lifecycle completion for review handoff retry teardown

### 08 `fix/workspace-validation-recovery-precedence`

- Head: `d9ea1f97aa2a00f540e254ce3ae86cc502c192dc`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 10 commits (1 merges); diff vs U: 7 files changed, 1204 insertions(+), 23 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `6b6cd45b2` pavel.guseynov: fix(workspace): preserve workspace-validation recovery guidance and precedence (#7398)
  - `d2524613c` pavel.guseynov: Merge upstream master 7b7c4d417 into fix/workspace-validation-recovery-precedence
  - `bd12089ac` pavel.guseynov: fix(workspace): quarantine worktrees on branch incoherence and update runtime test fixtures (cherry picked from `c90213f8c`)
  - `84f5a6b95` pavel.guseynov: fix(recovery): address review findings on workspace-validation precedence
  - `87c709570` pavel.guseynov: test(recovery): construct the recovery service with its required deps
  - `56d33552e` pavel.guseynov: test(recovery): use the declared recovery-action kind for the superseding case
  - `6548c1abd` pavel.guseynov: fix(recovery): deliver the workspace diagnosis to the operator, drop dead evidence
  - `cc77bcf77` pavel.guseynov: test(recovery): prove the generic-sweep hold at the sweep's own call shape
  - `3d317726f` pavel.guseynov: fix(recovery): keep exhausted workspace-validation retries held for reconciliation
  - `d9ea1f97a` pavel.guseynov: fix(recovery): name the workspace-validation cause without a wake-queue deep import
- Files:
  - A `server/src/__tests__/workspace-validation-recovery-precedence.test.ts`
  - M `server/src/services/heartbeat.ts`
  - M `server/src/services/issue-recovery-actions.ts`
  - M `server/src/services/legacy-execution-recovery.test.ts`
  - M `server/src/services/recovery/service.ts`
  - M `server/src/services/recovery/stranded-notice.test.ts`
  - M `server/src/services/recovery/stranded-notice.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/workspace-validation-recovery-precedence`:
  - `84f5a6b95` fix(recovery): address review findings on workspace-validation precedence
  - `87c709570` test(recovery): construct the recovery service with its required deps
  - `56d33552e` test(recovery): use the declared recovery-action kind for the superseding case
  - `6548c1abd` fix(recovery): deliver the workspace diagnosis to the operator, drop dead evidence
  - `cc77bcf77` test(recovery): prove the generic-sweep hold at the sweep's own call shape
  - `3d317726f` fix(recovery): keep exhausted workspace-validation retries held for reconciliation
  - `d9ea1f97a` fix(recovery): name the workspace-validation cause without a wake-queue deep import
- Stable-only commits (not on this branch):

### 09 `feat/verified-terminal-delivery-evidence`

- Head: `fd793881526ae41433115a2c28436c9671bad6f7`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 10 commits (1 merges); diff vs U: 20 files changed, 3020 insertions(+), 9 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `0171a81d3` SHIFT: feat(issues): opt-in evidence predicate on terminal stage approval
  - `af094638c` SHIFT: fix(issues): let terminal evidence flow through the API and persist it
  - `da340c929` pavel.guseynov: chore(db): generate migration 0282 for issue execution decision evidence
  - `3386eb295` pavel.guseynov: feat(issues): require verified delivery evidence before terminal completion (#11145)
  - `f6b4d8b2d` pavel.guseynov: Merge upstream master 7b7c4d417 into feat/verified-terminal-delivery-evidence
  - `749711e4a` pavel.guseynov: fix(delivery): bind terminal delivery verification to server-side state
  - `432f33087` pavel.guseynov: fix(delivery): evaluate the evidence gate from the persisted policy
  - `b4c4fa460` pavel.guseynov: test(delivery): assert the refused terminal write before its status code
  - `94382e34c` pavel.guseynov: fix(delivery): let an evidence-gated issue reach done only through its decision
  - `fd7938815` pavel.guseynov: fix(delivery): let a retried close of an already-done issue through
- Files:
  - M `doc/execution-semantics.md`
  - A `packages/db/src/migrations/0284_keen_mac_gargan.sql`
  - D `packages/db/src/migrations/meta/0279_snapshot.json`
  - A `packages/db/src/migrations/meta/0284_snapshot.json`
  - M `packages/db/src/migrations/meta/_journal.json`
  - M `packages/db/src/schema/issue_execution_decisions.ts`
  - M `packages/shared/src/index.ts`
  - M `packages/shared/src/types/index.ts`
  - M `packages/shared/src/types/issue.ts`
  - M `packages/shared/src/validators/index.ts`
  - M `packages/shared/src/validators/issue.ts`
  - A `server/src/__tests__/delivery-verification.test.ts`
  - M `server/src/__tests__/issue-execution-policy-routes.test.ts`
  - M `server/src/__tests__/issue-execution-policy.test.ts`
  - M `server/src/__tests__/native-status-arbiter-corpus.test.ts`
  - M `server/src/routes/issues.ts`
  - A `server/src/services/delivery-verification.ts`
  - M `server/src/services/execution-workspaces.ts`
  - M `server/src/services/issue-execution-policy.ts`
  - M `server/src/services/issue-thread-interactions.ts`
  - M `server/src/services/recovery/service.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/feat/verified-terminal-delivery-evidence`:
  - `da340c929` chore(db): generate migration 0282 for issue execution decision evidence
  - `749711e4a` fix(delivery): bind terminal delivery verification to server-side state
  - `432f33087` fix(delivery): evaluate the evidence gate from the persisted policy
  - `b4c4fa460` test(delivery): assert the refused terminal write before its status code
  - `94382e34c` fix(delivery): let an evidence-gated issue reach done only through its decision
  - `fd7938815` fix(delivery): let a retried close of an already-done issue through
- Stable-only commits (not on this branch):
  - `c6e473214` chore(db): generate migration 0282 for issue execution decision evidence
  - `1fa4c9440` chore(db): regenerate 0282 migration snapshot from stable schema

### 10 `feat/revision-keyed-review-admission`

- Head: `bfd3092312d890c4f328ad9b90bda0329e41d02a`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 21 commits (6 merges); diff vs U: 28 files changed, 4488 insertions(+), 9 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `0171a81d3` SHIFT: feat(issues): opt-in evidence predicate on terminal stage approval
  - `af094638c` SHIFT: fix(issues): let terminal evidence flow through the API and persist it
  - `da340c929` pavel.guseynov: chore(db): generate migration 0282 for issue execution decision evidence
  - `3386eb295` pavel.guseynov: feat(issues): require verified delivery evidence before terminal completion (#11145)
  - `f8f263c7b` pavel.guseynov: feat(review): make review admission atomic and revision-keyed (#11390)
  - `391697849` pavel.guseynov: style: remove trailing blank lines at EOF
  - `f6b4d8b2d` pavel.guseynov: Merge upstream master 7b7c4d417 into feat/verified-terminal-delivery-evidence
  - `bb938a595` pavel.guseynov: Merge feat/verified-terminal-delivery-evidence (upstream master 7b7c4d417) into feat/revision-keyed-review-admission
  - `242da9c42` pavel.guseynov: fix(review): remove unreachable native review read_pr and submit_review tools
  - `749711e4a` pavel.guseynov: fix(delivery): bind terminal delivery verification to server-side state
  - `37a2b5a7c` pavel.guseynov: Merge feat/verified-terminal-delivery-evidence into feat/revision-keyed-review-admission
  - `c748ea50f` pavel.guseynov: fix(review): record review admissions from the path that launches reviews
  - `432f33087` pavel.guseynov: fix(delivery): evaluate the evidence gate from the persisted policy
  - `b4c4fa460` pavel.guseynov: test(delivery): assert the refused terminal write before its status code
  - `4dd2b1aae` pavel.guseynov: Merge feat/verified-terminal-delivery-evidence into feat/revision-keyed-review-admission
  - `975e27783` pavel.guseynov: fix(review): key admissions by round and keep recording out of the launch
  - `94382e34c` pavel.guseynov: fix(delivery): let an evidence-gated issue reach done only through its decision
  - `cac83f182` pavel.guseynov: Merge feat/verified-terminal-delivery-evidence into feat/revision-keyed-review-admission
  - `6e54a49b2` pavel.guseynov: test(review): fail the admission savepoint inside Postgres, not before it
  - `fd7938815` pavel.guseynov: fix(delivery): let a retried close of an already-done issue through
  - `bfd309231` pavel.guseynov: Merge feat/verified-terminal-delivery-evidence into feat/revision-keyed-review-admission
- Files:
  - M `doc/execution-semantics.md`
  - A `packages/db/src/migrations/0284_keen_mac_gargan.sql`
  - A `packages/db/src/migrations/0285_massive_wonder_man.sql`
  - D `packages/db/src/migrations/meta/0279_snapshot.json`
  - D `packages/db/src/migrations/meta/0280_snapshot.json`
  - A `packages/db/src/migrations/meta/0284_snapshot.json`
  - A `packages/db/src/migrations/meta/0285_snapshot.json`
  - M `packages/db/src/migrations/meta/_journal.json`
  - M `packages/db/src/schema/index.ts`
  - M `packages/db/src/schema/issue_execution_decisions.ts`
  - A `packages/db/src/schema/review_admissions.ts`
  - M `packages/shared/src/index.ts`
  - M `packages/shared/src/types/index.ts`
  - M `packages/shared/src/types/issue.ts`
  - A `packages/shared/src/types/review-admission.ts`
  - M `packages/shared/src/validators/index.ts`
  - M `packages/shared/src/validators/issue.ts`
  - A `server/src/__tests__/delivery-verification.test.ts`
  - M `server/src/__tests__/issue-execution-policy-routes.test.ts`
  - M `server/src/__tests__/issue-execution-policy.test.ts`
  - M `server/src/__tests__/native-status-arbiter-corpus.test.ts`
  - A `server/src/__tests__/review-admission.test.ts`
  - M `server/src/routes/issues.ts`
  - A `server/src/services/delivery-verification.ts`
  - M `server/src/services/execution-workspaces.ts`
  - M `server/src/services/issue-execution-policy.ts`
  - M `server/src/services/issue-thread-interactions.ts`
  - M `server/src/services/native-runtime/status-decision-committer.ts`
  - M `server/src/services/recovery/service.ts`
  - A `server/src/services/review-admission.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/feat/revision-keyed-review-admission`:
  - `da340c929` chore(db): generate migration 0282 for issue execution decision evidence
  - `f8f263c7b` feat(review): make review admission atomic and revision-keyed (#11390)
  - `391697849` style: remove trailing blank lines at EOF
  - `242da9c42` fix(review): remove unreachable native review read_pr and submit_review tools
  - `749711e4a` fix(delivery): bind terminal delivery verification to server-side state
  - `c748ea50f` fix(review): record review admissions from the path that launches reviews
  - `432f33087` fix(delivery): evaluate the evidence gate from the persisted policy
  - `b4c4fa460` test(delivery): assert the refused terminal write before its status code
  - `975e27783` fix(review): key admissions by round and keep recording out of the launch
  - `94382e34c` fix(delivery): let an evidence-gated issue reach done only through its decision
  - `6e54a49b2` test(review): fail the admission savepoint inside Postgres, not before it
  - `fd7938815` fix(delivery): let a retried close of an already-done issue through
- Stable-only commits (not on this branch):
  - `c6e473214` chore(db): generate migration 0282 for issue execution decision evidence
  - `e934d66c6` feat(review): make review admission atomic and revision-keyed (#11390)
  - `1fa4c9440` chore(db): regenerate 0282 migration snapshot from stable schema
  - `3296f0cbf` chore(db): regenerate 0283 migration snapshot from stable schema

### 11 `fix/native-runner-darwin-lsof-unicode`

- Head: `ea6107e611ac3febf075111fd2cc5cdaa7522ac8`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 4 commits (0 merges); diff vs U: 2 files changed, 130 insertions(+), 2 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `710d22f91` pavel.guseynov: fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode (cherry picked from `45376158d`, `f1a6e7867`)
  - `fb87e63e7` pavel.guseynov: fix(native-runner): fail closed on an lsof escape run that is not UTF-8
  - `66f851174` pavel.guseynov: test(native-runner): prove lsof path decoding from the colocated unit home
  - `ea6107e61` pavel.guseynov: fix(native-runner): pin the lsof locale and decode its doubled backslash
- Files:
  - M `server/src/services/native-runtime/native-runner-file-handoff.test.ts`
  - M `server/src/services/native-runtime/native-runner-file-handoff.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/fix/native-runner-darwin-lsof-unicode`:
  - `710d22f91` fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode (cherry picked from `45376158d`, `f1a6e7867`)
  - `fb87e63e7` fix(native-runner): fail closed on an lsof escape run that is not UTF-8
  - `66f851174` test(native-runner): prove lsof path decoding from the colocated unit home
  - `ea6107e61` fix(native-runner): pin the lsof locale and decode its doubled backslash
- Stable-only commits (not on this branch):
  - `45376158d` fix(native-runner): decode hex-escaped paths from lsof on Darwin
  - `f1a6e7867` fix(native-runner): preserve unescaped Unicode in decodeLsofPath and add regression test

### 12 `test/workspace-runtime-exposure-isolation`

- Head: `127a0473701fdfe7ae0171d6695df63c96582b90`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 3 commits (0 merges); diff vs U: 4 files changed, 36 insertions(+), 10 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `0567e60e1` pavel.guseynov: test(services): isolate workspace runtime exposure lifecycle tests (cherry picked from `d453bb3ee`)
  - `145ab9fba` pavel.guseynov: test(services): isolate workspace runtime test port reservations deterministically (cherry picked from `8ab66bdb3`)
  - `127a04737` pavel.guseynov: test(services): keep automatic exposure allocation under test and tighten fixtures
- Files:
  - M `server/src/__tests__/workspace-runtime-start-terminality.test.ts`
  - M `server/src/__tests__/workspace-runtime.test.ts`
  - M `server/src/services/workspace-runtime-exposure.test.ts`
  - M `server/src/services/workspace-runtime.ts`
- Commits without a patch-equivalent on `stable/v2026.916.0/test/workspace-runtime-exposure-isolation`:
  - `0567e60e1` test(services): isolate workspace runtime exposure lifecycle tests (cherry picked from `d453bb3ee`)
  - `127a04737` test(services): keep automatic exposure allocation under test and tighten fixtures
- Stable-only commits (not on this branch):
  - `d453bb3ee` test(services): isolate workspace runtime exposure lifecycle tests

### 13 `chore/pnpm-11-toolchain`

- Head: `e3fe89cf5bcb645866a8ef4d68dbdc83f7394851`; base U `7b7c4d4172d6aac14919e2682b702ae87bc17653`; 3 commits (0 merges); diff vs U: 49 files changed, 843 insertions(+), 402 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `72300cd3c` pavel.guseynov: chore(toolchain): migrate repository to pnpm 11.21.0 (#8827) (cherry picked from `c8a267aab`)
  - `49d6f1fed` pavel.guseynov: fix(toolchain): harden the pnpm 11 policy check and patch readers
  - `e3fe89cf5` pavel.guseynov: test(toolchain): cover the pnpm 11 policy check with fixture repositories
- Files:
  - M `.github/scripts/tests/lockfile-refresh-cache.test.mjs`
  - M `.github/workflows/cloud-migrator-artifacts.yml`
  - M `.github/workflows/docker.yml`
  - M `.github/workflows/e2e.yml`
  - M `.github/workflows/pr-trusted.yml`
  - M `.github/workflows/refresh-lockfile.yml`
  - M `.github/workflows/release-smoke.yml`
  - M `.github/workflows/release-verify.yml`
  - M `.github/workflows/release.yml`
  - M `.github/workflows/runner-chaos-evals.yml`
  - M `.github/workflows/runner-full-stack-e2e.yml`
  - M `.github/workflows/runner-live-evals.yml`
  - M `.github/workflows/runner-protocol-live-evals.yml`
  - M `.github/workflows/sentry-contract.yml`
  - M `.github/workflows/storybook-deploy.yml`
  - M `.github/workflows/storybook-visual.yml`
  - M `README.md`
  - M `cli/README.md`
  - M `cli/src/__tests__/worktree.test.ts`
  - M `doc/DEVELOPING.md`
  - M `docker/daytona-runner/Dockerfile`
  - M `docs/deploy/local-development.md`
  - M `docs/start/architecture.md`
  - M `docs/start/quickstart.md`
  - M `package.json`
  - M `packages/paperclip-runner/README.md`
  - M `packages/paperclip-runner/docs/tutorials/capability-clean-room-chat.md`
  - M `packages/paperclip-runner/docs/tutorials/capability-issue-thread.md`
  - M `packages/paperclip-runner/docs/tutorials/capability-scenario-explorer.md`
  - M `packages/paperclip-runner/docs/tutorials/codex.md`
  - M `packages/paperclip-runner/docs/tutorials/conformance-standalone-tracer.md`
  - M `packages/paperclip-runner/docs/tutorials/local-runner.md`
  - M `packages/paperclip-runner/docs/tutorials/replay.md`
  - M `packages/paperclip-runner/docs/tutorials/scenario-chat.md`
  - M `packages/paperclip-runner/scripts/check-clean-consumers.mjs`
  - M `packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs`
  - M `pnpm-lock.yaml`
  - M `pnpm-workspace.yaml`
  - M `scripts/__tests__/provision-worktree-self-heal.test.mjs`
  - M `scripts/acpx-patch-packaging.test.mjs`
  - M `scripts/chat-adapter-patch-packaging.test.mjs`
  - A `scripts/check-pnpm-version-policy.mjs`
  - A `scripts/check-pnpm-version-policy.test.mjs`
  - M `scripts/prepare-bundled-package.mjs`
  - M `scripts/provision-worktree-runtime.sh`
  - M `scripts/provision-worktree.sh`
  - M `server/src/__tests__/workspace-runtime.test.ts`
  - M `ui/src/lib/codemirror-single-instance.test.ts`
  - M `ui/src/lib/lexical-single-copy.test.ts`
- Commits without a patch-equivalent on `stable/v2026.916.1/chore/pnpm-11-toolchain`:
  - `72300cd3c` chore(toolchain): migrate repository to pnpm 11.21.0 (#8827) (cherry picked from `c8a267aab`)
  - `49d6f1fed` fix(toolchain): harden the pnpm 11 policy check and patch readers
  - `e3fe89cf5` test(toolchain): cover the pnpm 11 policy check with fixture repositories
- Stable-only commits (not on this branch):
  - `c8a267aab` chore(toolchain): migrate repository to pnpm 11.21.0 (#8827)

### 14 `fix/tool-gateway-client-safe-tool-names`

- Head: `21175f393c7a39bca4f61f63d32832d74f41f2fc`; base U `efce9356b553a08f77a5877bb0ceac68d2cc4ad8`; 3 commits (1 merge); diff vs U: 7 files changed, 747 insertions(+), 46 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `8496e273e` pavel.guseynov: fix(tool-gateway): assign client-safe tool names and preserve legacy tool transition
  - `cdd35852c` pavel.guseynov: fix(tool-profile): preserve fixture/plugin tools and harden multi-state profile migration
  - `21175f393` pavel.guseynov: Merge branch 'fix/tool-profile-tool-name-identity' into fix/tool-gateway-client-safe-tool-names
- Files:
  - M `packages/shared/src/types/tool-access.ts`
  - M `server/src/__tests__/tool-gateway.test.ts`
  - M `server/src/index.ts`
  - M `server/src/services/index.ts`
  - M `server/src/services/tool-access-policy.ts`
  - M `server/src/services/tool-gateway.ts`
  - A `server/src/services/tool-profile-migration.ts`
- Commits without a patch-equivalent on `stable/v2026.916.1/fix/tool-gateway-client-safe-tool-names`: none.
- Stable-only commits (not on this branch):
  - `20df18689` fix(tool-gateway): assign client-safe tool names and preserve legacy tool transition (cherry picked from `8496e273e`)
  - `f3f864e28` fix(tool-profile): preserve fixture/plugin tools and harden multi-state profile migration (cherry picked from `cdd35852c`)
  - `6099ee048` Merge branch 'stable/v2026.916.1/fix/tool-profile-tool-name-identity' into stable/v2026.916.1/fix/tool-gateway-client-safe-tool-names

### 15 `fix/tool-gateway-context-tools-token-actions`

- Head: `736b368cec47445e2d2e1c1d806feed3e0a1feaa`; base U `efce9356b553a08f77a5877bb0ceac68d2cc4ad8`; 2 commits (0 merges); diff vs U: 3 files changed, 340 insertions(+), 142 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `4272b3200` pavel.guseynov: fix(tool-gateway): gate context tools and capabilities by token allowedActions
  - `736b368ce` pavel.guseynov: test(tool-gateway): cover full 4-tool context execution and subset action denials
- Files:
  - M `server/src/__tests__/tool-gateway.test.ts`
  - M `server/src/routes/tool-gateway.ts`
  - M `server/src/services/tool-gateway.ts`
- Commits without a patch-equivalent on `stable/v2026.916.1/fix/tool-gateway-context-tools-token-actions`: none.
- Stable-only commits (not on this branch):
  - `9d787c3c8` fix(tool-gateway): gate context tools and capabilities by token allowedActions (cherry picked from `4272b3200`)
  - `b3ea01a40` test(tool-gateway): cover full 4-tool context execution and subset action denials (cherry picked from `736b368ce`)

### 16 `fix/tool-profile-tool-name-identity`

- Head: `cdd35852c507446574f22a87cc175bb1f3b1288e`; base U `efce9356b553a08f77a5877bb0ceac68d2cc4ad8`; 2 commits (0 merges); diff vs U: 5 files changed, 412 insertions(+), 14 deletions(-).
- Commits (oldest first; author; cherry-pick source):
  - `b947ac9bd` pavel.guseynov: fix(tool-access): use catalog tool name as single identity for tool_name profile selectors
  - `cdd35852c` pavel.guseynov: fix(tool-profile): preserve fixture/plugin tools and harden multi-state profile migration
- Files:
  - M `server/src/__tests__/tool-gateway.test.ts`
  - M `server/src/index.ts`
  - M `server/src/services/index.ts`
  - M `server/src/services/tool-access-policy.ts`
  - A `server/src/services/tool-profile-migration.ts`
- Commits without a patch-equivalent on `stable/v2026.916.1/fix/tool-profile-tool-name-identity`: none.
- Stable-only commits (not on this branch):
  - `26636c2b5` fix(tool-access): use catalog tool name as single identity for tool_name profile selectors (cherry picked from `b947ac9bd`)
  - `f3f864e28` fix(tool-profile): preserve fixture/plugin tools and harden multi-state profile migration (cherry picked from `cdd35852c`)



