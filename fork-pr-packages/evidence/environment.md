# Failures that the unmodified base shows too

Every run used a Linux container, Node.js 24, PostgreSQL 16, pnpm 11.21.0, and a non-root user.
The runs of the upstream base `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` and of each head used the same commands.
Head runs compared here: 0 of 30.

## pnpm version pin

Upstream pins pnpm 9.15.4. The runs used pnpm 11.21.0 with `pnpm_config_pm_on_fail=ignore`. A frozen install fails the same way on the base and on a head, because pnpm 11 ignores the `pnpm.patchedDependencies` and `pnpm.overrides` fields of the upstream `package.json`, which the lockfile records:

Base:

```
[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] Cannot proceed with the frozen installation. The current "patchedDependencies" configuration doesn't match the value found in the lockfile

Update your lockfile using "pnpm install --no-frozen-lockfile"
```

Head `pr/01-codex-managed-mcp-auth`:

```
[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] Cannot proceed with the frozen installation. The current "patchedDependencies" configuration doesn't match the value found in the lockfile

Update your lockfile using "pnpm install --no-frozen-lockfile"
```

So every run installed with `--no-frozen-lockfile` and restored `pnpm-lock.yaml` and `pnpm-workspace.yaml` afterwards. No head changes a toolchain file.

## `@paperclipai/paperclip-runner` checks

| Check | Base exit code | Base output | Heads with another exit code |
| --- | --- | --- | --- |
| `check:protocol` | 1 | ` ❯ src/live/runnerd-codex-transport-settlement.test.ts (19 tests \| 19 failed) 33651ms<br>   × settles only retained control authority without starting another provider turn (false/false/undefined/undefined/undefined/undefined/undefined/undefined/undefined) startup-failure-proof=undefined completed-ack=undefined retired-revocation=undefined 1849ms<br>   × settles only retained control authority without starting another provider turn (true/false/undefined/undefined/undefined/undefined/undefined/undefined/undefined) startup-failure-proof=undefined completed-ack=undefined retired-revocation=undefined 1779ms` | none |
| `check:all` | 1 | ` ❯ src/live/runnerd-codex-transport-settlement.test.ts (19 tests \| 19 failed) 33958ms<br>   × settles only retained control authority without starting another provider turn (false/false/undefined/undefined/undefined/undefined/undefined/undefined/undefined) startup-failure-proof=undefined completed-ack=undefined retired-revocation=undefined 1909ms<br>   × settles only retained control authority without starting another provider turn (true/false/undefined/undefined/undefined/undefined/undefined/undefined/undefined) startup-failure-proof=undefined completed-ack=undefined retired-revocation=undefined 1770ms` | none |
| `check:runner` | 101 | `thread 'durable::transport::tests::authenticates_bootstrap_and_receives_bound_lease' (31498) panicked at crates/runner-core/src/durable/transport.rs:2415:9:<br>assertion `left == right` failed<br>  left: Some(252ms)` | none |
| `check:all-without-vitest` | 101 | `thread 'durable::transport::tests::authenticates_bootstrap_and_receives_bound_lease' (15487) panicked at crates/runner-core/src/durable/transport.rs:2415:9:<br>assertion `left == right` failed<br>  left: Some(252ms)` | none |
| `check:forbidden-imports` | 1 | `Standalone boundary check failed:<br>- scripts/check-clean-consumers.mjs:201 imports "@paperclipai/paperclip-runner/evals": runner consumers may import only declared public subpaths<br>- src/catalog/semantic-action-catalog.test.ts:24 imports "../../../shared/src/constants.js": relative imports may not escape packages/paperclip-runner` | none |
| `check:tracked-imports` | 1 | `Tracked import check failed:<br>- src/catalog/semantic-action-catalog.test.ts:24 imports "../../../shared/src/constants.js": resolves only to an untracked file, so a clean checkout cannot build it<br>- src/drivers/acpx/installation-integrity.test.ts:923 imports "./value.js": does not resolve to any tracked file` | none |
| `check:clean-consumers` | 1 | `npm error Exit handler never called!<br>npm error This is an error with npm itself. Please report this error at:<br>npm error   <https://github.com/npm/cli/issues>` | none |

`check:forbidden-imports` and `check:tracked-imports` report upstream files that no head changes. The other failures depend on the container: timing under load and the npm client.

## Tests of the complete suite

These tests also fail when their file runs alone on the unmodified base:

- `|@paperclipai/adapter-utils| src/acpx-engine/execute.test.ts > ACPX engine remote session-lifecycle re-staging (PR 3: stage once / reuse on compatible resume) > test_idle_staged_runtime_cleanup_waits_for_active_turn_release`: times out after 5 s in the container.
- `|@paperclipai/adapter-utils| src/acpx-engine/execute.test.ts > ACPX engine run lifecycle corrections (F1: settle every failure after buildRuntime) > test_sandbox_startup_span_ends_exactly_once_on_every_exit_path`: times out after 5 s in the container.
- `|@paperclipai/server| src/__tests__/agent-live-run-routes.test.ts > agent live run routes > heartbeat run ID validation > rejects malformed run ID "undefined" before any run lookup`: fails intermittently on the base; it passed in a later isolated base run.
- `|@paperclipai/server| src/__tests__/railway-connection.test.ts > Railway connection lifecycle and gateway > preserves the dedicated SSH grant key on reconnect and removes it while disconnected`: stops with "Generating a Railway key requires system OpenSSH (ssh-keygen) on the Paperclip runtime", because the container has no `ssh-keygen`.
- `|@paperclipai/server| src/__tests__/railway-ssh.test.ts > Railway isolated container command runner > generates a fresh real key without retaining files`: the same missing `ssh-keygen`.
- `|@paperclipai/server| src/__tests__/workspace-runtime.test.ts > workspace runtime service control persistence > does not accept an occupied allocated port when listener ownership is unavailable`: times out after 20 s in the container.

## node:test files

The 65 tracked node:test files under `scripts/`, `.github/scripts/tests/`, and `.agents/skills/*/scripts/` run with `node --test`. These tests fail on the unmodified base:

- Storybook viewport config uses the Storybook 10 parameter shape
- TS2578 expires the directive once a fixture event is registered
- extractor emits deterministic proposed-telemetry-extractor.v2 records
- extractor flags a missing proposed-telemetry suffix without hard-failing
- extractor rejects invalid rationale issue references when present
- extractor scans TelemetryClient wrappers whose receiver is not named client
- extractor scans variable-assigned wrappers and ignores nullable union members

The storybook test reports two upstream story files that still use the old viewport parameter shape. The extractor and TS2578 tests import `typescript` and use its JavaScript compiler API, but the root `typescript` dependency of upstream (and of its lockfile) is 7.0.2, whose package entry exports only its version. So `ts.ScriptTarget` is undefined and they fail with `TypeError: Cannot read properties of undefined (reading 'Latest')` (and `'ES2023'`). This does not depend on the pnpm version. No CI workflow runs these tests.

## Heads

No head run shows a suite or node:test failure outside these lists.
