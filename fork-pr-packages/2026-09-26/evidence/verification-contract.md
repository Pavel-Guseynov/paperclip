# Upstream verification contract

Recorded 2026-09-26; authority `upstream/master` = **4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a**.

**Inventory only. No gate, test, build, install, branch switch, or source edit was performed for this inventory. All upstream reads were ref-qualified.** This file owns no task runner or product configuration.

## Authority and before/after-open distinction

Sources inspected: CONTRIBUTING.md; AGENTS.md; .github/PULL_REQUEST_TEMPLATE.md; root package.json; .github/workflows/pr.yml and pr-trusted.yml; invoked policy checks, migration-order check, release package/bootstrap checks, stable Vitest runner, typecheck-build-gaps, workspace-link preflight, E2E partitioner/config, release.sh, Docker context Dockerfile, and Runner package scripts/lane wrapper/API authority/toolchain.

pr.yml delegates to `paperclipai/paperclip/.github/workflows/pr-trusted.yml@master`. A contribution's changed copy of that file does not control its trusted workflow. Reinspect target master before an eventual PR; this contract is pinned evidence.

| Stage | Requirement | Evidence required |
| --- | --- | --- |
| Before opening | Search public issues/PRs and link overlap; check ROADMAP; discuss substantial/core work in Discord #dev as CONTRIBUTING directs. | Actual public references/discussion, never invented. |
| Before opening | Focused regression proof; affected contracts/docs synchronized; local tests pass. Full PR-ready handoff uses `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`. | Exact head/commands, complete logs, exit status and separate skip counts. |
| Before opening | Fill Thinking Path, Linked Issues or Issue Description, What Changed, Verification, Risks, Model Used, Checklist. | Public issue links OR in-PR problem description with real issue-template labels/content. New issue creation is not universally mandatory. |
| Before opening | Accurate model disclosure and public-only references. | Only known provider/model/version/capabilities; do not invent context size. No internal ticket IDs/private URLs in public text. |
| After opening, before merge | Every CI gate succeeds on exact candidate head. | Actual CI check URLs; local runs cannot establish GitHub CI success. |
| After opening, before merge | Greptile **5/5**, no open P2+ comments, recommendations, or follow-ups; reviewer comments addressed. | Actual review state, not unchecked assumptions. |
| After opening | Applicable PR-quality automation and CODEOWNERS review. | Testing quality-gate scripts does not prove a nonexistent PR's body or reviews. |

The operator forbids opening upstream PRs in this task. Post-open CI/Greptile remain pending operator action. Never pre-check their template boxes. Upstream's operator contract declares pnpm commands; a packaging flake does not replace them. Root has no `lint` script: use the actual static and Rust format gates below.

## Runtime and clean-environment contract

| Requirement | Authority / consequence |
| --- | --- |
| Node | Engines `>=24.11.0`; trusted PR jobs install Node24. Policy checks manifests, workflow majors, Docker versions and selected source/install fragments. |
| pnpm | Root packageManager and trusted jobs use **9.15.4**. Record actual managed runtime, not only an outer launcher's banner. |
| Install | Relevant lanes first run `pnpm install --frozen-lockfile`. CI's explicit stale-lockfile retry is described below. Caches do not prove correctness. |
| Workspace preflight | `node cli/node_modules/tsx/dist/cli.mjs scripts/ensure-workspace-package-links.ts` repairs stale workspace links inside node_modules. Build/test preflight is not read-only. |
| Rust | Runner rust-toolchain.toml pins **1.97.1**, minimal profile plus rustfmt. Cargo/compiler/linker/network must work. Do not copy disposable CI toolchain removal onto a shared developer machine. |
| Filesystem/processes | Writable canonical temporary directories, subprocesses, usable embedded PostgreSQL where required, clean lifecycle cleanup. Builds write dist/generated files. |
| Browser | Google Chrome, Playwright, available local port and successful real UI/server/onboard/database startup. |
| Docker | Working Docker daemon/buildx and network; actual .dockerignore-filtered context is required. |
| Release | Clean disposable master checkout, Git/tag/npm registry access and build/packaging toolchain. Dry run skips npm authentication, not builds/network. |
| Platform | CI Linux AWS/GitHub Ubuntu routing does not prove Darwin behavior. A Darwin build does not prove Linux-only native C build paths. |
| Coverage | The inspected PR commands do not request/enforce100% statement coverage. Passing summaries are not that proof; the user's stronger floor remains unverified without real authorized coverage evidence. |

Ordinary standalone PRs run full CI. A verified middle stacked PR can skip full lanes only through trusted metadata. Path size or “small fix” does not invoke that exemption. Runner routing/trusted-stack GitHub API checks are CI orchestration, not local code gates.

## Universal policy lane

Use actual 40-character base/head SHAs and their merge-base diff `BASE...HEAD`. Placeholders below describe inputs, not literal arguments.

| ID | Exact command or policy | Required outcome |
| --- | --- | --- |
| P01 | Reject pnpm-lock.yaml in `git diff --name-only <base>...<head>` unless branch is exactly `chore/refresh-lockfile` or author exactly `dependabot[bot]`. | No ordinary-PR committed lockfile diff. Do not rename fixed branches or impersonate a bot. |
| P02 | `node .github/scripts/check-pr-migration-order.mjs <base> <head>` | New migrations have four-digit filenames and numbers greater than base maximum. |
| P03 | `node ./scripts/check-docker-deps-stage.mjs` | Docker deps COPY covers workspace manifests and patches. |
| P04 | `pnpm check:node-version` | Node24/>=24.11.0/@types-node^24.0.0 policy consistent. |
| P05 | `node ./scripts/check-no-git-push.mjs` | Adapter/runtime source has no unapproved remote-mutating git push invocation. |
| P06 | `node --test ./scripts/check-no-git-push.test.mjs` | Check behavior tests pass. |
| P07 | `pnpm check:module-boundaries` | Server domain/application/module API boundaries hold. |
| P08 | `node --test ./scripts/check-module-boundaries.test.mjs` | Boundary check tests pass. |
| P09 | `node --test '.github/scripts/tests/*.test.mjs'` | PR-quality gate script tests pass. |
| P10 | `node --test ./scripts/__tests__/run-vitest-stable-shard.test.mjs` | Vitest partition contract passes. |
| P11 | `node --test ./scripts/__tests__/e2e-shard.test.mjs` | E2E partition contract passes. |
| P12 | `node --test ./scripts/__tests__/release-verify-workflow.test.mjs ./scripts/cloud-source-verification.test.mjs ./scripts/standard-image-contract.test.mjs` | Release/cloud/image wiring tests pass. |
| P13 | `node --test ./scripts/__tests__/build-standalone-concurrency.test.mjs` | Standalone build concurrency tests pass. |
| P14 | `node ./scripts/release-package-map.mjs check` | Public package enrollment/dependency release graph consistent. |
| P15 | `PAPERCLIP_RELEASE_BOOTSTRAP_BASE_SHA=<base> node ./scripts/check-release-package-bootstrap.mjs <changed-path>...` | Changed release-enabled manifests/new enrollments checked against npm. |
| P16 | `pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile` | Disposable CI merge tree resolves; may mutate its lockfile. |

P15 uses changed paths from the merge-base diff. No relevant changed manifests means success without network. Relevant packages invoke `npm view <name> name --json`. Missing packages require maintainer first publication or removal from enrollment; registry/network errors are different blockers.

P02 does not prove migration runtime safety. DB build/typecheck also run `tsx src/check-migration-numbering.ts && tsx src/check-migration-safety.ts`. Independently unmerged07/09 can both pass against master yet collide on0284; settle integration order/numbering before combined acceptance.

Other lanes try frozen install, then the declared CI retry `pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile`, then frozen install again. This belongs to disposable CI trees. It does not authorize durable branch lockfile edits or a local workaround. Change13 needs explicit upstream-compatible disposition: trusted master remains pnpm9.15.4 and ordinary PRs cannot commit lockfiles; changing only the PR's trusted-workflow copy does not change the executing workflow.

## Full PR execution lanes

Each row is a required successful execution for ordinary full CI, **not a result of this inventory**. User requests all upstream gates, so unexecuted lanes remain unverified even where narrow local work normally uses focused checks.

| ID | Exact command | Complete passing outcome |
| --- | --- | --- |
| V01 | `pnpm run typecheck:build-gaps` | SDK/server prerequisites, relevant workspace typechecks and copied runtime assets valid. |
| V02 | `pnpm run test:release-registry` | All named Node release/package/install tests pass. |
| V03 | `pnpm test:run:general -- --group general-server-without-chat --shard-index I --shard-count 12` | Every I=0..11 passes. |
| V04 | `pnpm test:run:general -- --group general-chat --shard-index I --shard-count 3` | Every I=0..2 passes. |
| V05 | `pnpm test:run:general -- --group general-workspaces-a --shard-index I --shard-count 2` | Both I=0..1 pass. |
| V06 | `pnpm test:run:general -- --group general-workspaces-b` | Unsharded group passes. |
| V07 | `pnpm --filter @paperclipai/paperclip-runner check:static` | Eval kernel, TS/protocol/prep/goldens, real API authority pass. |
| V08 | `pnpm --filter @paperclipai/paperclip-runner check:runner` | Rust format/check/test/conformance/replay parity pass. |
| V09 | `pnpm --filter @paperclipai/paperclip-runner test:typescript:vitest --shard=1/2` and `--shard=2/2` | Both pass; no extra -- before --shard. |
| V10 | `pnpm --filter @paperclipai/paperclip-runner build:issue-thread`, then `pnpm build` | All workspace builds/generated checks pass. |
| V11 | `docker buildx build --file .github/docker-context-checks.Dockerfile .` | Actual filtered Docker context has required manifests, traceability/replay fixtures/tests; capability contract/inventory pass. |
| V12 | `pnpm test:run:serialized -- --shard-index I --shard-count 9` | Every I=0..8 passes; selected suites serially isolated. |
| V13 | `./scripts/release.sh canary --skip-verify --dry-run` | In clean CI-prepared master checkout: build, standalone/server-UI prep and publish previews pass; no publication. |
| V14 | `node ./scripts/e2e-shard.mjs --shard-index I --shard-count 8` | Each I=0..7 gives its declared spec argument list. |
| V15 | `PAPERCLIP_E2E_SKIP_LLM=true PAPERCLIP_PLAYWRIGHT_CHANNEL=chrome pnpm run test:e2e <V14 specs>` | All eight shards pass; retain reports/test-results. |

A includes UI and CLI. B explicitly includes shared, skills-catalog, DB, adapter-utils, Claude/Codex/Grok/OpenClaw/OpenCode adapters, Daytona plugin, plugin SDK and plugin scaffolder; it is not all workspaces with test scripts. Root test:run does not implicitly run Runner Rust/browser/evals.

Stable Vitest runner excludes dist, creates canonical isolated temporary home/config/instance/TMPDIR, and sets NODE_ENV=test. CODEX_HOME is not isolated by it. Server/chat use declared lists/duration partitions. Under GITHUB_WORKFLOW=PR, native-codex-runner.integration.test.ts moves from general-server into the last Runner Vitest lane; local default root tests include it in general-server. Do not spoof CI markers, omit it, or double-count it.

typecheck-build-gaps discovers workspaces using `pnpm ls -r --depth -1 --json`, checks those whose build lacks tsc, and validates server copied assets. It does not replace AGENTS' full local recursive typecheck. UI Vite build does not typecheck. DB builds check migrations. Catalog builds validate/generated manifests. Linux tailscale broker native C build requires compiler/headers; a Darwin skip is not Linux proof.

### Aggregates

- **verify omits serialized-server and canary-dry-run.** Its dependencies are gate, policy, typecheck_release_registry, general_tests, verify_paperclip_runner, build, docker_context_integrity.
- e2e depends on gate, policy, e2e_shards.
- These aggregates accept skipped full lanes only with trusted full_ci=false. Ordinary standalone PRs have true.
- Policy10min, typecheck/general/Runner/build/serialized/canary20min, Docker15min, E2E30min are existing CI timeouts, not local force-stop authorization.

### Canary isolation

CI runs `git checkout -B master HEAD` in its disposable checkout and may make an ephemeral generated-lockfile commit before V13. **Do not run that preparation in the user's fixed contribution checkout or repoint master.** An authorized disposable environment or actual CI is required; otherwise mark it unverified.

Dry run still checks clean master, fetches release tags, queries npm/version availability, and always builds. It calls build-standalone-public-packages.mjs and prepare-server-ui-dist.sh, temporarily rewrites package versions, previews with `pnpm publish --dry-run --no-git-checks --tag ...`, and restores files. The packaging path uses npm10.9.7. --skip-verify skips initial duplicate verification only; it does not waive V01–V12 or remove the internal build.

### E2E isolation

CI checks `google-chrome --version` and writes a config under disposable HOME; never overwrite the operator's config. Playwright uses one worker, no retries, owns its server with no reuse, builds UI into server/ui-dist, and runs CLI onboard --yes --run in temporary instance state. Default port3199 supports PAPERCLIP_E2E_PORT. Embedded DB must work.

Default E2E partition excludes in-feed-native/**, multi-user.spec.ts and multi-user-authenticated.spec.ts; their specialized paths are not proved by default green E2E. LLM skip is declared CI behavior, not a DB/auth integration bypass.

## Root command expansion and conditional checks

Commands below are exact manifest scripts. Do not run both wrappers and every nested command redundantly on the final tree. During edits choose focused proof; record full unmet gates separately.

| Script | Exact declared command |
| --- | --- |
| `build` | `pnpm run preflight:workspace-links && pnpm -r build` |
| `typecheck` | `pnpm run preflight:workspace-links && pnpm -r typecheck` |
| `typecheck:build-gaps` | `pnpm run preflight:workspace-links && pnpm --filter @paperclipai/plugin-sdk ensure-build-deps && pnpm --filter @paperclipai/server build && node scripts/run-typecheck-build-gaps.mjs` |
| `test` | `pnpm run test:run` |
| `test:watch` | `pnpm run preflight:workspace-links && vitest` |
| `test:run` | `pnpm run preflight:workspace-links && node scripts/run-vitest-stable.mjs` |
| `test:run:general` | `pnpm run preflight:workspace-links && pnpm --filter @paperclipai/plugin-sdk ensure-build-deps && node scripts/run-vitest-stable.mjs --mode general` |
| `test:run:serialized` | `pnpm run preflight:workspace-links && pnpm --filter @paperclipai/plugin-sdk ensure-build-deps && node scripts/run-vitest-stable.mjs --mode serialized` |
| `test:release-registry` | `node --test scripts/verify-release-registry-state.test.mjs scripts/release-package-map.test.mjs scripts/check-release-package-bootstrap.test.mjs scripts/check-no-git-push.test.mjs scripts/release-lib.test.mjs scripts/release-registry-versions.test.mjs scripts/link-plugin-dev-sdk.test.js scripts/acpx-patch-packaging.test.mjs scripts/service-onboard-smoke.test.mjs scripts/docker-onboard-smoke.test.mjs scripts/preview-artifacts.test.mjs scripts/cloud-migrator-artifacts.test.mjs` |
| `check:node-version` | `node scripts/check-node-version-policy.mjs` |
| `check:no-git-push` | `node scripts/check-no-git-push.mjs` |
| `check:module-boundaries` | `node scripts/check-module-boundaries.mjs` |
| `test:check-no-git-push` | `node --test scripts/check-no-git-push.test.mjs` |
| `check:token-gates` | `node scripts/check-token-gates.mjs && node scripts/sync-agent-palette-tokens.mjs --check && node scripts/sync-cliplab-character.mjs --check` |
| `check:tokens` | `node scripts/check-forbidden-tokens.mjs` |
| `test:e2e` | `npx playwright test --config tests/e2e/playwright.config.ts` |
| `test:release-smoke` | `npx playwright test --config tests/release-smoke/playwright.config.ts` |

Schema changes additionally use `pnpm db:generate`, followed by full typecheck and synchronized DB/shared/server/UI contracts. Generation is mutating, not a read-only check. UI edits require `pnpm check:token-gates` before commit even though this pr-trusted file does not invoke that root gate directly. check:tokens is a separate check, not its replacement.

Telemetry paths require generated contract/README and privacy review. Observability requires endpoint/no-op gating and allowlist preservation; run logs have a separate DB contract. Determine applicability from actual paths.

## Runner invoked expansions

Package-local working directory is packages/paperclip-runner. These explain V07–V10; no redundant nested reruns are implied.

| Script | Exact declared command |
| --- | --- |
| `build` | `pnpm run check:protocol-manifest && pnpm run build:typescript && pnpm run check:capability-contract && pnpm run check:capability-inventory && pnpm run check:protocol-coverage && pnpm run check:semantic-contracts && pnpm run check:runner-workflow-traceability && pnpm run build:binary && node scripts/generate-replay-goldens.mjs --check && node scripts/generate-semantic-action-catalog.mjs --check` |
| `build:typescript` | `pnpm run ensure:eval-build-deps && pnpm run check:protocol-types && node ./node_modules/typescript/bin/tsc --version && node ./node_modules/typescript/bin/tsc -p tsconfig.json && node ./node_modules/typescript/bin/tsc -p tsconfig.surfaces.json && node scripts/build-verified-provider-entrypoints.mjs` |
| `build:rust` | `cargo build --manifest-path runner/Cargo.toml --locked --workspace --bins` |
| `build:binary` | `cargo build --release --manifest-path runner/Cargo.toml --locked -p paperclip-runner-core --bin paperclip-runnerd && node scripts/stage-runner-binary.mjs` |
| `build:issue-thread` | `vite build --config vite.issue-thread.config.ts` |
| `typecheck` | `pnpm run typecheck:typescript && pnpm run typecheck:rust` |
| `typecheck:typescript` | `pnpm run ensure:eval-build-deps && node --check scripts/protocol-contract.mjs && node --check scripts/generate-protocol-manifest.mjs && node --check scripts/generate-protocol-schema-module.mjs && node --check scripts/generate-acpx-sidecar-contract.mjs && node --check scripts/generate-replay-goldens.mjs && node --check scripts/generate-semantic-action-catalog.mjs && pnpm run check:protocol-types && node ./node_modules/typescript/bin/tsc --version && node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node ./node_modules/typescript/bin/tsc -p tsconfig.surfaces.json --noEmit` |
| `typecheck:rust` | `cargo fmt --manifest-path runner/Cargo.toml --all -- --check && cargo check --manifest-path runner/Cargo.toml --locked --workspace` |
| `test:typescript:prep` | `pnpm run ensure:eval-build-deps && pnpm run build:rust && node --test test/protocol-contract.test.mjs test/acpx-sidecar-contract.test.mjs test/acpx-codex-package-contract.test.mjs scripts/aws-agentcore-provisioning.test.mjs scripts/build-verified-provider-entrypoints.test.mjs scripts/local-provider-smoke-environment.test.mjs scripts/materialize-opencode-binary.test.mjs` |
| `test:typescript:vitest` | `node ./scripts/run-pr-vitest-lane.mjs` |
| `test:rust` | `cargo test --release --manifest-path runner/Cargo.toml --locked --workspace` |
| `check:static` | `pnpm run check:eval-kernel && pnpm run check:protocol-without-vitest && pnpm run check:api-authority` |
| `check:protocol-without-vitest` | `pnpm run typecheck:typescript && pnpm run check:protocol-manifest && pnpm run test:typescript:prep && pnpm run check:replay-goldens` |
| `check:runner` | `pnpm run typecheck:rust && pnpm run test:rust && pnpm run check:conformance-parity && pnpm run check:replay-parity` |
| `check:api-authority` | `node scripts/check-api-authority.mjs` |
| `check:eval-kernel` | `pnpm --filter @paperclipai/paperclip-eval-kernel test` |
| `ensure:eval-build-deps` | `pnpm --filter @paperclipai/paperclip-eval-kernel build` |
| `check:protocol-manifest` | `node scripts/generate-protocol-manifest.mjs --check` |
| `check:protocol-types` | `node scripts/generate-protocol-schema-module.mjs --check && node scripts/generate-acpx-sidecar-contract.mjs --check` |
| `check:replay-goldens` | `pnpm run build:typescript && node scripts/generate-replay-goldens.mjs --check` |
| `check:conformance-parity` | `cargo test --release --manifest-path runner/Cargo.toml --locked -p paperclip-runner-core runs_the_mock_core_path_with_stable_output` |
| `check:replay-parity` | `cargo test --release --manifest-path runner/Cargo.toml --locked -p paperclip-runner-core replay_fixture_parity` |
| `check:capability-contract` | `node scripts/generate-capability-contract.mjs --check` |
| `check:capability-inventory` | `node scripts/check-capability-inventory.mjs` |
| `check:protocol-coverage` | `node scripts/generate-protocol-coverage.mjs --check` |
| `check:semantic-contracts` | `pnpm run build:typescript && node scripts/generate-semantic-contracts.mjs --check` |
| `check:runner-workflow-traceability` | `pnpm run build:typescript && node scripts/check-runner-workflow-traceability.mjs` |

check-api-authority prepares plugin SDK dependencies, builds the release binary and runs real runner-api.test.ts, runner-api-rollout.test.ts and runner-api.integration.test.ts with PAPERCLIP_REQUIRE_RUNNER_API_INTEGRATION=1. Never remove that requirement to obtain a pass.

run-pr-vitest-lane prepares eval deps/Rust debug binaries then package Vitest, with native integration on the final PR shard as above. Eval-kernel test is `pnpm run build && node --test test/*.test.mjs`; its build is `tsc -p tsconfig.json`. Runner's larger verify includes additional browser/demo/consumer checks; pr-trusted deliberately selects the four check:all-equivalent lanes instead. Those optional checks are not automatically universal PR gates.

## Per-change applicability

All ordinary candidate PRs need P/V gates. Additional focused proof below does not waive them; final exact-head results belong in each change report.

| Change | Focus / prerequisite |
| --- | --- |
| 01 | Codex auth/config producer and real consumer behavior, secret boundary. |
| 02 | Session token gateway auth, dependency01. |
| 03 | Actual isolated sandbox API/network/auth boundary, not host-only reachability. |
| 04 | Remote MCP transport timeout/cancellation/failure/recovery. |
| 05 | Real emitted records: deep fields, child bindings, malformed/unserializable output, non-secret preservation and production/pretty sinks. Logger tests need no DB; skipped gateway tests prove no integration. |
| 06 | Policy/assignee database transitions and route auth. |
| 07 | Retry/skipped handoff state transitions and migration order/safety;0284 collision with09. |
| 08 | Workspace validation/recovery precedence and heartbeat integration. |
| 09 | Persisted terminal delivery evidence and migration safety/order; settle07 collision. |
| 10 | Revision identity/review admission/auth, dependency09. |
| 11 | Darwin lsof parser cases plus actual Darwin runtime evidence. |
| 12 | Independence from caller workspace/runtime pollution using declared isolated test path. |
| 13 | Explicit resolution of pnpm11 versus trusted9.15.4 and lockfile policy. |
| 14 | Client-safe gateway/selector names and real JSON-RPC consumer behavior, dependency16. |
| 15 | Token action allowlist acceptance/rejection and unrelated permission preservation. |
| 16 | Existing selector rewrite/collision/startup integration with real DB; startup rewrite is not necessarily a schema migration. |
| 19 | Calling-run/stage binding, board/agent/cloud identities and cross-company rejection via actual auth/DB paths. |
| 20 | Generic shared/adapter/server continuation capability consumption; fork-only Antigravity packaging outside upstream scope. |
| 21 | Default/configurable graceful drain, promises/events/children, failure and termination lifecycle. |
| 22 | Canceled/interrupted/swept/orphan lease state and actual DB/session cleanup. |

## Existing local evidence and blockers

No command in this inventory was executed. Reuse prior results only when exact tested head and relevant tree remain unchanged.

Retained baseline `.git/fork-audit-2026-09-26/upstream-file-delivery.log`: `pnpm exec vitest run server/src/__tests__/file-delivery-bridges.test.ts` at upstream/master4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a exited1; suite setup failed and three tests skipped. Embedded PostgreSQL initdb bootstrap reported exit1 after five attempts. **Underlying cause is not observable in retained evidence.** Investigation found installed embedded-postgres initialise() captures stdout without initdb stderr; helper retains final attempt's final eight lines and removes temporary directories. Missing initdb stderr is the diagnostic blocker. Do not infer memory/permissions/architecture/environment cause, retry blindly, replace PostgreSQL or count skipped tests as passing.

Prior stable05 tool-gateway run skipped all62 by its support gate. Logger success does not establish DB/gateway coverage; exact05 evidence is under `.git/fork-audit-2026-09-26/05/`.

Root reports `CI=true pnpm install --frozen-lockfile` succeeded with managed9.15.4. An outer pnpm11 launcher warning does not prove pnpm11 ran the install. Preserve warnings and actual runtime evidence; do not suppress them.

Rust/browser/Docker/registry unavailability is not assumed here; establish it from actual retained evidence before declaring a blocker. Canary disposable-checkout requirements and nonexistent post-open CI/Greptile results are explicit scope/environment limitations.

## Other declared root commands

These remaining root build/test/check/smoke/eval/performance commands are available but not all universal PR gates. They apply when touched features or a separately invoked contract require them. Live/service tasks, publication, baseline/update and model evaluation commands need corresponding scope; manifest presence alone grants none. Browser/release-smoke is opt-in for narrow local work per AGENTS, while full PR E2E above still applies.

| Script | Exact declared command |
| --- | --- |
| `build-storybook` | `pnpm --filter @paperclipai/ui build-storybook` |
| `build:feature-catalog` | `node cli/node_modules/tsx/dist/cli.mjs scripts/generate-feature-catalog.ts` |
| `test:runner-acceptance` | `vitest run --config tests/runner-acceptance/vitest.config.ts` |
| `test:runner-acceptance:typecheck` | `tsc -p tests/runner-acceptance/tsconfig.json` |
| `build:npm` | `./scripts/build-npm.sh` |
| `test:install-sh-docker` | `./scripts/test-install-sh-docker.sh` |
| `test:hermes-gateway-smoke` | `node --test scripts/smoke/hermes-gateway-smoke.test.mjs` |
| `smoke:hermes-gateway-join` | `./scripts/smoke/hermes-gateway-join.sh` |
| `smoke:hermes-gateway-e2e` | `./scripts/smoke/hermes-gateway-e2e.sh` |
| `smoke:openclaw-join` | `./scripts/smoke/openclaw-join.sh` |
| `smoke:openclaw-docker-ui` | `./scripts/smoke/openclaw-docker-ui.sh` |
| `smoke:openclaw-sse-standalone` | `./scripts/smoke/openclaw-sse-standalone.sh` |
| `smoke:mcp-fixtures` | `node scripts/smoke/mcp-fixture-harness.mjs` |
| `smoke:notion-generic-live` | `node scripts/smoke/notion-generic-live.mjs` |
| `smoke:posthog-live` | `node scripts/smoke/posthog-live.mjs` |
| `smoke:pipelines-tutorial` | `./scripts/smoke/pipelines-tutorial-smoke.sh` |
| `smoke:terminal-bench-loop-skill` | `node scripts/smoke/terminal-bench-loop-skill-smoke.mjs` |
| `storybook-visual:baseline` | `node scripts/storybook-visual-baseline.mjs` |
| `test:storybook-visual` | `node scripts/storybook-visual-baseline.mjs download && node scripts/storybook-visual-baseline.mjs verify && pnpm build-storybook && npx playwright test --config tests/storybook-visual/playwright.config.ts` |
| `test:storybook-visual:update` | `node scripts/storybook-visual-baseline.mjs download && pnpm build-storybook && npx playwright test --config tests/storybook-visual/playwright.config.ts --update-snapshots && node scripts/storybook-visual-baseline.mjs pack` |
| `test:e2e:runner` | `node cli/node_modules/tsx/dist/cli.mjs tests/runner-e2e/launch.ts` |
| `test:e2e:runner:image-id` | `node cli/node_modules/tsx/dist/cli.mjs tests/runner-e2e/daytona-image-content.ts` |
| `test:e2e:runner:judge-first-task` | `node cli/node_modules/tsx/dist/cli.mjs tests/runner-e2e/first-task-judge.ts` |
| `test:e2e:runner:dashboard` | `node cli/node_modules/tsx/dist/cli.mjs tests/runner-e2e/dashboard-regenerate.ts` |
| `test:e2e:runner:models:update` | `node cli/node_modules/tsx/dist/cli.mjs tests/runner-e2e/openrouter-models-update.ts` |
| `test:e2e:runner:history:publish` | `node cli/node_modules/tsx/dist/cli.mjs tests/runner-e2e/history-publish.ts` |
| `test:runner-recovery` | `vitest run server/src/services/native-runtime/native-replacement-evidence.test.ts server/src/services/native-runtime/stopped-codex-turn.test.ts server/src/services/native-runtime/native-safe-replacement.test.ts` |
| `test:e2e:runner:browser-support` | `playwright test --config tests/runner-e2e/playwright-support.config.ts` |
| `test:e2e:runner:unit` | `vitest run --config tests/runner-e2e/vitest.config.ts` |
| `test:e2e:runner:typecheck` | `tsc -p tests/runner-e2e/tsconfig.json` |
| `test:e2e:runner:report` | `node cli/node_modules/tsx/dist/cli.mjs tests/runner-e2e/report.ts` |
| `test:runner-workflow-evals` | `pnpm --filter @paperclipai/paperclip-eval-kernel build && pnpm --filter @paperclipai/paperclip-runner test:runner-workflow-evals` |
| `test:e2e:mcp-user-stories` | `node scripts/e2e-mcp-user-stories.mjs` |
| `test:e2e:connection-intents` | `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/connection-intents.spec.ts` |
| `test:e2e:headed` | `npx playwright test --config tests/e2e/playwright.config.ts --headed` |
| `test:e2e:multiuser-authenticated` | `npx playwright test --config tests/e2e/playwright-multiuser-authenticated.config.ts` |
| `evals:smoke` | `cd evals/promptfoo && npx promptfoo@0.103.3 eval` |
| `test:release-smoke:headed` | `npx playwright test --config tests/release-smoke/playwright.config.ts --headed` |
| `test:canary-onboarding-smoke` | `npx playwright test --config tests/canary-onboarding/playwright.config.ts` |
| `perf:issue-chat-long-thread` | `node scripts/measure-issue-chat-long-thread.mjs` |
| `test:lifecycle-baseline` | `node tests/lifecycle-baseline/run.mjs` |
| `test:lifecycle-baseline:support` | `node --test tests/lifecycle-baseline/report.test.mjs` |
| `test:lifecycle-baseline:typecheck` | `tsc -p tests/lifecycle-baseline/tsconfig.json` |

## Handoff evidence schema

Record full 40-character head/base, exact command/selectors/non-secret environment inputs, actual runtime/platform, start/end/exit, passed/failed/skipped counts, complete stdout/stderr path, deepest supported cause and blocker. For CI add check/run URL and exact checked head. Distinguish upstream baseline failure from contribution regression. Zero relevant executed tests is not acceptance; never check local-pass/CI-green/Greptile boxes without their evidence.
