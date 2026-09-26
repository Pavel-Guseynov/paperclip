# Change 01 verification, 2026-09-26

This focused follow-up supersedes the old Change 01 missing-DB/scope-decision status. It does not replace the historical evidence for the other 19 changes.

Compared base: `7f3c06dac4604dddcf870085f1a623c102261358`. Broad gate head: `bed8d5c5f80d7b756626c244f187ec12b06e1340`. Final contribution: `d7f732a84310958de14f5a02f859cd4e797cb48c`. Only two test files changed after the broad gates. The final tests passed before commit; the commit contains exactly that tested tree. No full final-head gate or coverage claim is made.

The [command record](commands.json) includes exact executed commands, exit codes, revisions and retained output paths. Native permission review permitted real PostgreSQL tests after a constrained setup execution recorded `shmget` denial. No database substitution or installed dependency edit was used. The final independent server typecheck passed. Stable passed 224 tests. Main Vitest never started; dependency installation was subsequently denied.

## Universal gate disposition

Commands are the upstream inventory. The results below state how they were exercised and explicitly identify aggregates that were not separately repeated.

| ID | Command / policy | Required outcome | This review's outcome |
| --- | --- | --- | --- |
| P01 | Reject pnpm-lock.yaml in `git diff --name-only <base>...<head>` unless branch is exactly `chore/refresh-lockfile` or author exactly `dependabot[bot]`. | No ordinary-PR committed lockfile diff. Do not rename fixed branches or impersonate a bot.  Pass by final diff inspection: no lockfile change. |
| P02 | `node .github/scripts/check-pr-migration-order.mjs <base> <head>` | New migrations have four-digit filenames and numbers greater than base maximum.  Exit 0, no migrations; run on bed8 before test-only refactor. |
| P03 | `node ./scripts/check-docker-deps-stage.mjs` | Docker deps COPY covers workspace manifests and patches.  Exit 0. |
| P04 | `pnpm check:node-version` | Node24/>=24.11.0/@types-node^24.0.0 policy consistent.  Exit 0. |
| P05 | `node ./scripts/check-no-git-push.mjs` | Adapter/runtime source has no unapproved remote-mutating git push invocation.  Exit 0. |
| P06 | `node --test ./scripts/check-no-git-push.test.mjs` | Check behavior tests pass.  Passed inside the 129-test release-registry run. |
| P07 | `pnpm check:module-boundaries` | Server domain/application/module API boundaries hold.  Exit 0. |
| P08 | `node --test ./scripts/check-module-boundaries.test.mjs` | Boundary check tests pass.  Passed in combined 460-test policy execution. |
| P09 | `node --test '.github/scripts/tests/*.test.mjs'` | PR-quality gate script tests pass.  Passed in combined policy execution. |
| P10 | `node --test ./scripts/__tests__/run-vitest-stable-shard.test.mjs` | Vitest partition contract passes.  Passed in combined policy execution. |
| P11 | `node --test ./scripts/__tests__/e2e-shard.test.mjs` | E2E partition contract passes.  Passed in combined policy execution. |
| P12 | `node --test ./scripts/__tests__/release-verify-workflow.test.mjs ./scripts/cloud-source-verification.test.mjs ./scripts/standard-image-contract.test.mjs` | Release/cloud/image wiring tests pass.  Passed in combined policy execution. |
| P13 | `node --test ./scripts/__tests__/build-standalone-concurrency.test.mjs` | Standalone build concurrency tests pass.  Passed in combined policy execution. |
| P14 | `node ./scripts/release-package-map.mjs check` | Public package enrollment/dependency release graph consistent.  Exit 0: 30 enabled packages, 4 disabled pending bootstrap. |
| P15 | `PAPERCLIP_RELEASE_BOOTSTRAP_BASE_SHA=<base> node ./scripts/check-release-package-bootstrap.mjs <changed-path>...` | Changed release-enabled manifests/new enrollments checked against npm.  Exit 0: no changed release-enabled manifests. |
| P16 | `pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile` | Disposable CI merge tree resolves; may mutate its lockfile.  Not run: requires disposable CI merge tree; fixed checkout/lockfile retained. |
| V01 | `pnpm run typecheck:build-gaps` | SDK/server prerequisites, relevant workspace typechecks and copied runtime assets valid.  Components passed: workspace build prerequisites and node scripts/run-typecheck-build-gaps.mjs (5 workspace checks, 15 assets). Aggregate wrapper not separately repeated. |
| V02 | `pnpm run test:release-registry` | All named Node release/package/install tests pass.  Native execution: 129 passed. Initial constrained execution: 128 passed, 1 EPERM failure at npm cache mkdtemp. |
| V03 | `pnpm test:run:general -- --group general-server-without-chat --shard-index I --shard-count 12` | Every I=0..11 passes.  Local equivalent general-server phase completed: 13,594 passed, 8 failed, 80 skipped; includes local chat/native suite. |
| V04 | `pnpm test:run:general -- --group general-chat --shard-index I --shard-count 3` | Every I=0..2 passes.  Included in local general-server phase; no separate sharded execution claimed. |
| V05 | `pnpm test:run:general -- --group general-workspaces-a --shard-index I --shard-count 2` | Both I=0..1 pass.  Not reached after root command failed general-server. |
| V06 | `pnpm test:run:general -- --group general-workspaces-b` | Unsharded group passes.  Not reached after root command failed general-server. |
| V07 | `pnpm --filter @paperclipai/paperclip-runner check:static` | Eval kernel, TS/protocol/prep/goldens, real API authority pass.  Constituents passed through typecheck/build, Runner prep (38), eval-kernel (3), API authority (1,742). Aggregate check:static not separately repeated. |
| V08 | `pnpm --filter @paperclipai/paperclip-runner check:runner` | Rust format/check/test/conformance/replay parity pass.  Rust format/check passed in typecheck. Independent Rust tests failed: core 293 passed, 1 failed. Full workspace/parity acceptance remains unverified. |
| V09 | `pnpm --filter @paperclipai/paperclip-runner test:typescript:vitest --shard=1/2` and `--shard=2/2` | Both pass; no extra -- before --shard.  Unsharded Runner Vitest ran through aggregate: 2,087 passed, 1 failed, 10 skipped. |
| V10 | `pnpm --filter @paperclipai/paperclip-runner build:issue-thread`, then `pnpm build` | All workspace builds/generated checks pass.  Both commands exited 0. |
| V11 | `docker buildx build --file .github/docker-context-checks.Dockerfile .` | Actual filtered Docker context has required manifests, traceability/replay fixtures/tests; capability contract/inventory pass.  Exit 127: Docker command not found; build did not run. |
| V12 | `pnpm test:run:serialized -- --shard-index I --shard-count 9` | Every I=0..8 passes; selected suites serially isolated.  Not reached: 148 serialized suites unrun by failed root command. |
| V13 | `./scripts/release.sh canary --skip-verify --dry-run` | In clean CI-prepared master checkout: build, standalone/server-UI prep and publish previews pass; no publication.  Not run: disposable CI-prepared master checkout unavailable under fixed-branch constraints. |
| V14 | `node ./scripts/e2e-shard.mjs --shard-index I --shard-count 8` | Each I=0..7 gives its declared spec argument list.  All 8 selection commands passed; union selection also passed (33 specs). Selection is not browser proof. |
| V15 | `PAPERCLIP_E2E_SKIP_LLM=true PAPERCLIP_PLAYWRIGHT_CHANNEL=chrome pnpm run test:e2e <V14 specs>` | All eight shards pass; retain reports/test-results.  One execution of all 33 union specs: 139 passed, 2 failed, 4 skipped, exit 1. |

## Causal and integration evidence

- [Final focused tests](focused-final.log): 186 passed, no skips, three files.
- [Matching upstream production with final regression overlay](gateway-final-base.log): six causal failures, 137 intentionally filtered tests. Managed initialize fails authentication; public notification skips verification; managed notification rejection comes from the actor error contract.
- [Stable tests](stable-focused.log): 224 passed, no skips, four files.
- [Main command](main-focused.log): dependency status check invokes install, then aborts module purge without TTY; zero tests executed.
- [Exact pushed refs](final-state.json).
- [Full suite failures](full-suite-failures.md), [Runner failures](runner-failures.md), [browser failures](browser-failures.md).

The original embedded PostgreSQL setup symptom was insufficient for diagnosis. A temporary Node diagnostics_channel child observer captured every owned initdb stdout/stderr/close event in the new constrained run: all five failed because shmget was denied (size 56, flags 03600). The observer was removed. The unchanged file-delivery test then passed 3/3 through native permission review. This explains that newly observed run, not the earlier historical run whose stderr was absent.

The release-registry constrained run failed at npm cache mkdtemp with EPERM; the same native command passed 129/129. The generic npm suggestion of root-owned files was not established.

## Retention and unverified claims

Full raw logs, including build/typecheck warnings and intermediate failed runs, remain operator-local under `.git/fork-01-focus-2026-09-26/`. Full browser/server logs include fixture credentials or deployment metadata and were not copied into the public package. Completed command metadata is retained there in `completed-gates.json`; the original setup child evidence is `initdb-diagnostic.json`. The published safe summaries were reviewed against complete retained logs.

Earlier gateway-head audit assertions failed four times because fixture gateway creation had also written an audit row. The corrected test selects the single gateway_auth_throttled event and separately checks all returned audits for credentials. Intermediate output remains `gateway-head.log`; it is not represented as a pass.

The final source review found no actionable in-scope defect, but review is not test coverage. Matching-base runs for the unrelated broad failures were not performed, so they are not called pre-existing. Their failure causes are separated from symptoms and missing observability in the linked diagnoses.

Warnings remain visible: ignored pnpm manifest settings, Vite loader migration notice, Rust unused-code warnings, and existing migration baseline notices. No warning suppression was added. The supplied 100% statement coverage floor remains undemonstrated. No new coverage provider, dependency, configuration or test runner was added.

Native automatic approval review rejected the requested main frozen install: it would rewrite installed dependencies prohibited by the supplied instructions. No bypass was attempted. Completing main tests requires operator authorization for that normal dependency synchronization. The operator requested stopping after 01, so broader repair work and the other changes are not continuing.
