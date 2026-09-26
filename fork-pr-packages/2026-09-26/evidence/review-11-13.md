# Changes 11–13: source review

Date: 2026-09-26. Current upstream master: `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a`. Stable tag `v2026.916.1`: `d554c4789ed3930f8a53ac9fdf6503b3187097da`. SHAs below are copied from the initial git rev-parse inventory; matching origin tracking refs were fetched before inspection.

## Findings

### 11 — Darwin descriptor paths

The change decodes doubled backslashes and hexadecimal UTF-8 byte runs in one pass, pins lsof's locale, and rejects invalid UTF-8. The added integration regression uses real files and the actual lsof path on Darwin. No additional correctness defect was established by source review. The public helper exists to test invalid bytes that APFS cannot create, as documented. The branch still needs current-base causal proof and the complete gates. Earlier contribution refinements have not all reached the stable line; historical claims of current equivalence must not be carried forward.

The only new baseline test executed in this audit was `pnpm exec vitest run server/src/__tests__/file-delivery-bridges.test.ts` on upstream master. It failed during PostgreSQL fixture initialization: one failed suite, three skipped tests. It is an adjacent baseline/environment check, NOT Change11's regression and NOT an lsof failure. Complete retained output: `upstream-file-delivery.log`. The dependency does not retain initdb stderr, so the deepest cause is unobservable. Do not call the change a fix for this startup failure or label unexecuted head tests as passing. No released replacement or retirement proof was established.

### 12 — runtime exposure isolation

The cleanup hook now resets in-flight reservations. Each automatic exposure case owns a distinct execution-workspace ID, and the allocator stays under test. The contiguous fixture helper holds ports in a bounded range rather than first asking the kernel for an ephemeral base. No new concrete source defect was established. This source inspection is not repeatability proof. Required suites are `server/src/__tests__/workspace-runtime-start-terminality.test.ts`, `server/src/__tests__/workspace-runtime.test.ts`, and `server/src/services/workspace-runtime-exposure.test.ts`; they and the full gates were not executed in this source review. The final contribution test refinement is not on the initial stable head. No upstream released equivalent was established.

### 13 — pnpm migration

The target policy explicitly rejects manual `pnpm-lock.yaml` changes. The trusted workflow is selected from master and installs pnpm 9.15.4, so editing a PR's copy to install 11 does not solve bootstrap. Both are hard opening/verification blockers. The branch also conflicts with current master's lockfile. Do not drop the regenerated lockfile, bypass the policy, use the stable branch PR, or override the trusted runner as a workaround. The operator must coordinate a maintainer-owned toolchain/bot-refresh sequence. [Issue8827](https://github.com/paperclipai/paperclip/issues/8827) remains relevant; [PR13894](https://github.com/paperclipai/paperclip/pull/13894) is the superseded stable-branch submission, not the contribution head.

The manifest moves patch/override policy to the workspace YAML and adds explicit build permissions. Source review also found the patch-manifest reader deliberately duplicated between prepare-bundled-package and provision-worktree, with a 'keep in sync' comment. This is a second implementation of the same parser contract; resolve through one shared authority before readiness. Its hand-written parsing accepts only a YAML subset, so supported syntax needs a declared contract or the established parser. No fresh branch tests/gates were run because the contribution-policy blocker already prevents opening it cleanly.

## Initial heads and file inventory

### 11

Contribution `fix/native-runner-darwin-lsof-unicode`: `ea6107e611ac3febf075111fd2cc5cdaa7522ac8`.
Stable `stable/v2026.916.0/fix/native-runner-darwin-lsof-unicode`: `c14cff2716ebfe60ef64529b9cda6c675438981e`.
Both matched fetched origin. All three stable branches already contain v2026.916.1 despite older names on11/12.

| File | Purpose |
| --- | --- |
| `server/src/services/native-runtime/native-runner-file-handoff.test.ts` | Real Darwin deliverable registration for Unicode, ASCII and literal backslashes; direct malformed UTF-8 rejection. |
| `server/src/services/native-runtime/native-runner-file-handoff.ts` | Decode lsof name-field escapes after pinning the child locale to C. |

### 12

Contribution `test/workspace-runtime-exposure-isolation`: `127a0473701fdfe7ae0171d6695df63c96582b90`.
Stable `stable/v2026.916.0/test/workspace-runtime-exposure-isolation`: `8ab66bdb320b81aac4677f2b2051196ad4e855e2`.
Both matched fetched origin. All three stable branches already contain v2026.916.1 despite older names on11/12.

| File | Purpose |
| --- | --- |
| `server/src/__tests__/workspace-runtime-start-terminality.test.ts` | Proves resetting runtime services releases port reservations. |
| `server/src/__tests__/workspace-runtime.test.ts` | Reserves contiguous fixture ports outside the default ephemeral and exposure ranges. |
| `server/src/services/workspace-runtime-exposure.test.ts` | Uses independent workspace identities while retaining automatic allocation coverage. |
| `server/src/services/workspace-runtime.ts` | Clears in-flight port reservation state during test cleanup. |

### 13

Contribution `chore/pnpm-11-toolchain`: `e3fe89cf5bcb645866a8ef4d68dbdc83f7394851`.
Stable `stable/v2026.916.1/chore/pnpm-11-toolchain`: `c8a267aabe2a7d9a789ce3985a11250baa0e8aa0`.
Both matched fetched origin. All three stable branches already contain v2026.916.1 despite older names on11/12.

| File | Purpose |
| --- | --- |
| `.github/scripts/tests/lockfile-refresh-cache.test.mjs` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `.github/workflows/cloud-migrator-artifacts.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/docker.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/e2e.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/pr-trusted.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/refresh-lockfile.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/release-smoke.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/release-verify.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/release.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/runner-chaos-evals.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/runner-full-stack-e2e.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/runner-live-evals.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/runner-protocol-live-evals.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/sentry-contract.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/storybook-deploy.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `.github/workflows/storybook-visual.yml` | Update CI/toolchain installation or cache behavior for pnpm 11. |
| `README.md` | Update documented pnpm prerequisite or runner commands. |
| `cli/README.md` | Update documented pnpm prerequisite or runner commands. |
| `cli/src/__tests__/worktree.test.ts` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `doc/DEVELOPING.md` | Update documented pnpm prerequisite or runner commands. |
| `docker/daytona-runner/Dockerfile` | Select pnpm 11 in the runner container. |
| `docs/deploy/local-development.md` | Update documented pnpm prerequisite or runner commands. |
| `docs/start/architecture.md` | Update documented pnpm prerequisite or runner commands. |
| `docs/start/quickstart.md` | Update documented pnpm prerequisite or runner commands. |
| `package.json` | Select pnpm 11 and register its policy check; remove duplicate package.json pnpm configuration. |
| `packages/paperclip-runner/README.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/capability-clean-room-chat.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/capability-issue-thread.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/capability-scenario-explorer.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/codex.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/conformance-standalone-tracer.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/local-runner.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/replay.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/docs/tutorials/scenario-chat.md` | Update documented pnpm prerequisite or runner commands. |
| `packages/paperclip-runner/scripts/check-clean-consumers.mjs` | Read patches from the workspace manifest or update provisioning/packaging consumers. |
| `packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `pnpm-lock.yaml` | Regenerated dependency graph; blocked by upstream's bot-only lockfile policy. |
| `pnpm-workspace.yaml` | Declare the active patch/override authority and explicit dependency build policy. |
| `scripts/__tests__/provision-worktree-self-heal.test.mjs` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `scripts/acpx-patch-packaging.test.mjs` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `scripts/chat-adapter-patch-packaging.test.mjs` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `scripts/check-pnpm-version-policy.mjs` | Check toolchain pins, patch declarations, build permissions and documented prerequisites. |
| `scripts/check-pnpm-version-policy.test.mjs` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `scripts/prepare-bundled-package.mjs` | Read patches from the workspace manifest or update provisioning/packaging consumers. |
| `scripts/provision-worktree-runtime.sh` | Read patches from the workspace manifest or update provisioning/packaging consumers. |
| `scripts/provision-worktree.sh` | Read patches from the workspace manifest or update provisioning/packaging consumers. |
| `server/src/__tests__/workspace-runtime.test.ts` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `ui/src/lib/codemirror-single-instance.test.ts` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |
| `ui/src/lib/lexical-single-copy.test.ts` | Update package-manager, patch-manifest or single-copy verification for pnpm 11. |


These are the original contribution inventories, not a claim that every branch is synchronized. See the final per-change package for final heads and containment. No stable/main source changes were made in this review. All commands not explicitly evidenced are unrun.
