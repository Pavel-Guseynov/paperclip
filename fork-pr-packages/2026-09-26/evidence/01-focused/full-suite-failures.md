# Change 01 — completed full-suite failure evidence

## Provenance and disposition

- Executed by the parent session: `pnpm test:run`; session `99491`; exit `1`.
- Tested contribution head: `bed8d5c5f80d7b756626c244f187ec12b06e1340`.
- Comparison base: `7f3c06dac4604dddcf870085f1a623c102261358` (`upstream/master` at verification).
- Authoritative retained combined stdout/stderr: `.git/fork-01-focus-2026-09-26/full-test.log` (4,564 lines, 597,773 bytes). The complete log was read; repeated records were inspected with identifiers and SQL parameters omitted from diagnostic presentation. This report does not reproduce credential-like fixture payloads.
- This diagnostic task ran no tests, changed no source, switched no branches, and managed no processes. It owns only this report. Later contribution commits and independent checks do not change this run's provenance.
- **The full gate failed.** No matching-base execution of these failures was available to this diagnostic task; they are not classified as pre-existing. No full gate or coverage completion is claimed.

## Execution phases and counts

`package.json:25` expands the command to `pnpm run preflight:workspace-links && node scripts/run-vitest-stable.mjs`. Log lines 3–16 show successful progression through the workspace-link preflight into the first Vitest invocation. Vitest is `4.1.11`.

| Phase | Observed outcome |
| --- | --- |
| Workspace-link preflight | Completed sufficiently for the following command to start; no failure reported. |
| `general-server` | Completed with failure: **3 failed, 695 passed, 3 skipped files; 8 failed, 13,594 passed, 80 skipped tests**. Totals: 701 files, 13,682 tests. Start `12:24:59`; duration `2396.73s`. |
| `general-workspaces-a` | **Not reached**: `@paperclipai/ui`, `paperclipai`. |
| `general-workspaces-b` | **Not reached**: shared, skills-catalog, db, adapter-utils, Claude/Codex/Grok/OpenClaw/OpenCode adapters, plugin-daytona, plugin-sdk, create-paperclip-plugin. |
| Serialized server suites | **Not reached: all 148 suites** excluded from the first invocation. |

The only phase marker in the log is line 11, `general-server server suites excluding 148 serialized suites`. Final counts appear at lines 4559–4562, followed by the lifecycle exit at line 4564. The wrapper's `runVitest` exits immediately on nonzero child status (`scripts/run-vitest-stable.mjs:354` at the tested head); the general group order is declared at line 99 and iterated at line 359. Serialized execution follows the general groups at line 561. Consequently, these final counts describe the first phase, not the entire root test command. The retained output does not enumerate the skipped tests' identities or reasons.

## Exact failed tests

All paths in this table are under `server/src/__tests__/`. Line references name the tested head, not a later checkout.

| File / test | Assertion or deepest retained error | Evidence |
| --- | --- | --- |
| `cursor-local-adapter-environment.test.ts` — `cursor environment diagnostics > prefers ~/.local/bin/cursor-agent for remote sandbox probes when using the default command` | Aggregate `result.status` was `fail`, expected `pass`; individual checks were not printed. | Test line 219; log 4405–4419. |
| `cursor-local-execute.test.ts` — `cursor execute > prefers ~/.local/bin/cursor-agent for remote sandbox execution when using the default command` | Final child `result.exitCode` was `127`, expected `0`. | Test line 376; log 4421–4438. |
| `cursor-local-execute.test.ts` — `cursor execute > keeps explicit command overrides for remote sandbox execution` | Final child `result.exitCode` was `127`, expected `0`. | Test line 442; log 4440–4457. |
| `workspace-runtime.test.ts` — `realizeExecutionWorkspace > provisions worktree-local pnpm node_modules instead of reusing base-repo links` (first definition) | `worktree init` rejects source config because `$meta`, `database`, `logging`, and `server` are undefined; exits 1. An earlier diagnostic says the copied worktree env lacks `PAPERCLIP_HOME` or `PAPERCLIP_INSTANCE_ID`, prompting regeneration. | Definition line 1877; call line 1941; log 4459–4486. |
| `workspace-runtime.test.ts` — `realizeExecutionWorkspace > provisions successfully when install is needed but there are no symlinked node_modules to move` | Same source-config schema rejection and `worktree init` exit 1. | Definition line 1981; call line 2022; log 4488–4513. |
| `workspace-runtime.test.ts` — `realizeExecutionWorkspace > reinstalls worktree-local pnpm dependencies when package metadata changes` | Provisioning subprocess fails with the same source-config schema rejection and `worktree init` exit 1. | Definition line 2055; log 4515–4520. |
| `workspace-runtime.test.ts` — `realizeExecutionWorkspace > retries worktree-local pnpm install without a frozen lockfile when the lockfile is outdated` | Provisioning subprocess fails with the same source-config schema rejection and `worktree init` exit 1. | Definition line 2298; log 4522–4527. |
| `workspace-runtime.test.ts` — `realizeExecutionWorkspace > provisions worktree-local pnpm node_modules instead of reusing base-repo links` (second definition) | Same source-config schema rejection, preceding stale-env diagnostic, and `worktree init` exit 1. This is a distinct test with a duplicate title. | Definition line 2375; call line 2439; log 4529–4556. |

Per-file summaries at log lines 41–51 report workspace-runtime 161 tests / 5 failures; Cursor execute 5 / 2; Cursor environment 6 / 1.

## Workspace provisioning: supported causal chain

The test helper `writeRegisteredSourceConfig` (`workspace-runtime.test.ts:150`) writes literal `{}` to the fixture base repository's `.paperclip/config.json` and writes only an instance identifier to its fixture env. All five failing cases call this helper. The failing source-config paths in the log point into those temporary fixture base repositories.

The production provisioning script selects the base repository's config (`scripts/provision-worktree.sh:50`) and supplies that path as `--from-config` when invoking a usable CLI (`run_isolated_worktree_init`, line 134). Real CLI initialization reads that source through `readConfig` (`cli/src/commands/worktree.ts:2421`); `cli/src/config/store.ts:91` migrates and validates it with `paperclipConfigSchema`, then throws the exact `Invalid config at ...` message when validation fails. The retained diagnostics explicitly identify four missing object fields. The script propagates the non-127 initialization failure at lines 629–633, before dependency installation. `runWorkspaceCommand` (`server/src/services/workspace-runtime.ts:2945`) includes stderr and stdout in its thrown error for the service-driven cases.

**Supported cause:** these fixtures supply an incomplete source config to a real CLI initialization path, and the schema validation failure blocks provisioning before the intended dependency assertions. The stale-env message in two cases is an earlier regeneration trigger, not the deepest failing operation. Neither an outdated lockfile nor a failed dependency download is established as the failure cause.

The tests are sensitive to available CLI candidates: the script checks the base checkout CLI, `pnpm paperclipai`, and bare `paperclipai`; two fixtures prepend a fake `pnpm` while retaining the inherited PATH. Their fake `pnpm` deliberately rejects `paperclipai --help`, leaving the script able to discover a bare CLI on PATH. The log proves a real CLI initialization ran, but does not record the resolved executable path/candidate, so that exact selection remains unobservable. No PATH manipulation, removal of installed tools, or config-validation bypass was attempted.

## Cursor: retained failure and observability boundary

The execution cases reached the final result assertion, so a final spawned child returned exit 127; command-resolution exceptions would have thrown before that assertion. `execute.ts:724` returns the child exit code and also derives `errorMessage` from stderr, while `runChildProcess` retains the child output. Both test callbacks discard the log streams, and neither failure assertion prints `errorMessage`. The environment diagnostic similarly retains per-check detail but the test prints only aggregate status. Fixtures remove their temporary roots in `finally`.

**Supported outcome:** two final child exits of 127 and one failed aggregate environment diagnostic. **Unobservable cause:** the exact failed executable/interpreter and its stderr; 127 alone does not establish which command was unavailable.

A source-backed hypothesis, not a diagnosis, is shared PATH isolation: `packages/adapters/cursor-local/src/server/remote-command.ts:215` calls `ensurePathInEnv(input.env)`; `packages/adapter-utils/src/server-utils.ts:3612` inserts `defaultPathForPlatform()` when PATH is omitted. All three remote fixtures omit a configured PATH, and their fake executables use `#!/usr/bin/env node`. An unavailable `node` on that substituted PATH could explain both default and explicit-command failures. The explicit absolute-command failure means default Cursor command selection alone cannot explain all three. The retained log contains no child stderr or resolved PATH to confirm this hypothesis.

## Scope and comparison limits

Read-only `git diff --name-status` between the base and tested head reports no changes in the implicated workspace provisioning tests/script/service/CLI config code, Cursor tests/adapter, or adapter-utils. The complete contribution diff contains README, the three auth/gateway/Codex test files, and auth middleware plus gateway route/service. This establishes source scope only; it does **not** establish that the observed failures reproduce on the base or that the changed auth behavior cannot affect suite execution.

Any later baseline comparison must preserve the command and relevant environment, retain complete stdout/stderr, and identify the exact tested revision. A focused Cursor comparison can use the repository's Vitest surface:

```sh
pnpm exec vitest run server/src/__tests__/cursor-local-adapter-environment.test.ts server/src/__tests__/cursor-local-execute.test.ts -t 'remote sandbox'
```

This is an unexecuted diagnostic proposal, not equivalent proof of the isolated full-run environment or a substitute for the failed gate. A plain rerun may still omit the causal child diagnostics. The declared general-server phase (`pnpm test:run:general --group general-server`) preserves the runner's isolation policy for a matched phase comparison. No baseline comparison was run by this diagnostic task.

The log also contains application WARN/ERROR records from other tests and native-build/listener warnings. None is an additional Vitest failed test in the completed result, and none supplies the missing Cursor diagnostics. This report does not attribute the eight failed tests to those unrelated records or infer additional failures from log severity alone.
