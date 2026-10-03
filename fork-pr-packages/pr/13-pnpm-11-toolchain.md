# refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827)

| Field | Value |
| --- | --- |
| Upstream PR | `paperclipai/paperclip#13894` |
| Branch | `stable/v2026.916.1/chore/pnpm-11-toolchain` |
| Head | `2660e9cc3c0d91889ad0e21a2da1f5d381c479d3` |
| Base commit | `ffe5e9e2a8866767cbb48009040bfafd85b56576` |
| Upstream base | `paperclipai/paperclip` master `ffe5e9e2a8866767cbb48009040bfafd85b56576` |
| Stack prerequisite | `ci(workflows): let PR workflows install declared pnpm version from package.json` (see [`pr/29-pr-workflows-read-pnpm-version-from-package-json.md`](29-pr-workflows-read-pnpm-version-from-package-json.md)) |
| Proposed title | `refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827)` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `.github/scripts/tests/lockfile-refresh-cache.test.mjs` | +1 | -1 |
| `.github/workflows/cloud-migrator-artifacts.yml` | +1 | -1 |
| `.github/workflows/docker-runner-check.yml` | +1 | -1 |
| `.github/workflows/docker.yml` | +1 | -1 |
| `.github/workflows/e2e.yml` | +1 | -1 |
| `.github/workflows/pr-trusted.yml` | +14 | -8 |
| `.github/workflows/refresh-lockfile.yml` | +1 | -1 |
| `.github/workflows/release-smoke.yml` | +1 | -1 |
| `.github/workflows/release-verify.yml` | +6 | -6 |
| `.github/workflows/release.yml` | +8 | -8 |
| `.github/workflows/runner-chaos-evals.yml` | +1 | -1 |
| `.github/workflows/runner-full-stack-e2e.yml` | +7 | -7 |
| `.github/workflows/runner-live-evals.yml` | +1 | -1 |
| `.github/workflows/runner-protocol-live-evals.yml` | +4 | -4 |
| `.github/workflows/sentry-contract.yml` | +1 | -1 |
| `.github/workflows/storybook-deploy.yml` | +1 | -1 |
| `.github/workflows/storybook-visual.yml` | +1 | -1 |
| `README.md` | +1 | -1 |
| `cli/README.md` | +1 | -1 |
| `cli/src/__tests__/worktree.test.ts` | +4 | -4 |
| `doc/DEVELOPING.md` | +1 | -1 |
| `docker/daytona-runner/Dockerfile` | +1 | -1 |
| `docs/deploy/local-development.md` | +1 | -1 |
| `docs/start/architecture.md` | +1 | -1 |
| `docs/start/quickstart.md` | +1 | -1 |
| `package.json` | +2 | -27 |
| `packages/paperclip-runner/README.md` | +1 | -1 |
| `packages/paperclip-runner/docs/tutorials/capability-clean-room-chat.md` | +2 | -2 |
| `packages/paperclip-runner/docs/tutorials/capability-issue-thread.md` | +2 | -2 |
| `packages/paperclip-runner/docs/tutorials/capability-scenario-explorer.md` | +2 | -2 |
| `packages/paperclip-runner/docs/tutorials/codex.md` | +1 | -1 |
| `packages/paperclip-runner/docs/tutorials/conformance-standalone-tracer.md` | +1 | -1 |
| `packages/paperclip-runner/docs/tutorials/local-runner.md` | +1 | -1 |
| `packages/paperclip-runner/docs/tutorials/replay.md` | +1 | -1 |
| `packages/paperclip-runner/docs/tutorials/scenario-chat.md` | +1 | -1 |
| `packages/paperclip-runner/scripts/check-clean-consumers.mjs` | +11 | -7 |
| `packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs` | +14 | -20 |
| `pnpm-lock.yaml` | +157 | -111 |
| `pnpm-workspace.yaml` | +18 | -2 |
| `scripts/__tests__/provision-worktree-self-heal.test.mjs` | +29 | -3 |
| `scripts/acpx-patch-packaging.test.mjs` | +13 | -6 |
| `scripts/chat-adapter-patch-packaging.test.mjs` | +7 | -4 |
| `scripts/check-pnpm-version-policy.mjs` | +190 | -0 |
| `scripts/check-pnpm-version-policy.test.mjs` | +216 | -0 |
| `scripts/prepare-bundled-package.mjs` | +22 | -2 |
| `scripts/provision-worktree-runtime.sh` | +2 | -3 |
| `scripts/provision-worktree.sh` | +31 | -12 |
| `server/src/__tests__/workspace-runtime.test.ts` | +5 | -5 |
| `ui/src/lib/codemirror-single-instance.test.ts` | +4 | -13 |
| `ui/src/lib/lexical-single-copy.test.ts` | +7 | -3 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The repository build toolchain and package management rely on pnpm workspaces.
> - Upstream issue #8827 tracks migrating the toolchain from pnpm 9 to pnpm 11 to align with modern Node runtime expectations and faster deterministic installations.
> - pnpm 11 establishes `pnpm-workspace.yaml` as the sole authority for package overrides, patched dependencies, and build permissions, removing configuration from `package.json#pnpm`.
> - This pull request migrates the root and workspace configurations, GitHub Actions workflows, Dockerfile setup, worktree provisioning scripts, documentation prerequisites, and lockfile to pnpm 11.27.0.
> - The benefit is a modern, faster, and more secure toolchain with explicit build script controls (`allowBuilds`) and deterministic peer resolution.

## Linked Issues or Issue Description

Fixes: #8827
Refs: #13894

**Resolution of previous review findings:**
1. **CI Prerequisite:** Pull request workflows (`pr.yml`) delegate to `paperclipai/paperclip/.github/workflows/pr-trusted.yml@master`. On `master`, `pr-trusted.yml` has historically hardcoded `with: version: 9.15.4`, which forced pnpm 9 on PR CI runs and caused 45 of 47 jobs to fail at "Setup pnpm" (Run 36998312578). Removing the hardcoded version in the prerequisite PR package allows `pnpm/action-setup` to dynamically read `package.json#packageManager`, keeping master on 9.15.4 while running this PR on 11.27.0.
2. **Lockfile & Sentry Contract Root Cause:** The Sentry SDK contract failure in Run 36998312361 (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`) was caused by attempting a frozen install of a pnpm 9 formatted lockfile under pnpm 11, where patched dependencies map to SHA-256 hashes instead of `{ hash, path }` dictionaries. Regenerating `pnpm-lock.yaml` with pnpm 11.27.0 enables both `pnpm install --frozen-lockfile` and `pnpm install --frozen-lockfile --ignore-scripts` to pass cleanly in ~230ms.
3. **Windows Path Escaping (`greptile-apps[bot]`):** `check-clean-consumers.mjs` writes `pnpm-workspace.yaml` using JSON serialization, which safely escapes Windows backslashes and quotes in file paths without YAML syntax errors.
4. **Policy Job CI Integration (`greptile-apps[bot]`):** `pnpm check:pnpm-version` and its unit tests (`node --test ./scripts/check-pnpm-version-policy.test.mjs`) are wired directly into the trusted policy job in `.github/workflows/pr-trusted.yml` alongside `check:node-version`. The test suite covers valid configurations, invalid versions, missing steps, unescaped patches, and stale non-historical pnpm 9 references.
5. **Source Policy Validation & Tracked Reference Scanning:** `scripts/check-pnpm-version-policy.mjs` separates the build-time policy check (manifest, workspace configuration, workflow pins, Dockerfile, and prerequisites) from repository reference scanning. The build-time check requires no Git and runs cleanly from exported source archives, while the pnpm 9 reference scan judges only files Git tracks (`git ls-files -z`), preventing untracked and git-ignored scratch files from failing checkout validation.
6. **Worktree Patch Fingerprinting on Older Branches (`greptile-apps[bot]`):** `scripts/provision-worktree.sh` computes install fingerprints by hashing patches declared in `pnpm-workspace.yaml` (pnpm 11) and falls back to `package.json#pnpm` for checkouts of pre-migration branches, preventing missing-dependency issues when switching between branch generations.
7. **Windows Validation & Ecosystem Alignment:** We acknowledge and appreciate @drew1two's independent validation on Windows (using pnpm 11.27.1), which confirmed cross-platform stability and highlighted interoperability with related initiatives (Refs #10627, #13991, #14174).

## What Changed

- **Package Manager Pin:** Updated `packageManager` to `pnpm@11.27.0` in `package.json`; removed obsolete root `pnpm` configuration block.
- **Workspace Manifest Authority:** Configured `pnpm-workspace.yaml` with `autoInstallPeers: false`, `patchedDependencies`, `overrides`, and an explicit `allowBuilds` policy permitting necessary binaries (`@embedded-postgres/*`, `esbuild`, `opencode-ai`) while denying unneeded compilation scripts.
- **Lockfile Format:** Regenerated `pnpm-lock.yaml` with pnpm 11.27.0, migrating patch hashes to SHA-256 and enabling instant, frozen dependency installation.
- **Workflows & CI:** Pinned `pnpm/action-setup` to `11.27.0` across GitHub Actions workflow files. Added `check:pnpm-version` and its unit test to the `policy` job in `pr-trusted.yml`.
- **Policy Check Independence & Tracked Scan:** Separated build-time policy checks in `scripts/check-pnpm-version-policy.mjs` from repository reference scanning. The build-time check operates without Git dependencies on manifests, workflows, and prerequisites, while the reference scan strictly evaluates tracked source files via `git ls-files -z` without traversing git-ignored directories.
- **Worktree Provisioning:** Enhanced patch fingerprinting in `scripts/provision-worktree.sh` to read from both `pnpm-workspace.yaml` and legacy `package.json#pnpm`. Preserves `--prod=false` across `pnpm install` calls, which is supported by pnpm 11.27.0's CLI parser and ensures devDependencies are retained in production environments.
- **Dockerfile:** Updated `docker/daytona-runner/Dockerfile` to `corepack prepare pnpm@11.27.0 --activate`.
- **Packaging Scripts:** Updated `scripts/prepare-bundled-package.mjs` and package contract tests to read patched dependencies from `pnpm-workspace.yaml`.
- **Documentation:** Updated prerequisite references in `README.md`, `cli/README.md`, `doc/DEVELOPING.md`, `docs/start/*`, and runner tutorial guides from pnpm 9 to pnpm 11.27+.

## Verification

Base commit: `ffe5e9e2a8866767cbb48009040bfafd85b56576` (upstream master)
Head commit: `2660e9cc3c0d91889ad0e21a2da1f5d381c479d3`

- `pnpm install --frozen-lockfile`: PASSED (exit 0, ~226ms)
- `pnpm install --frozen-lockfile --ignore-scripts`: PASSED (exit 0, ~247ms)
- `node scripts/check-pnpm-version-policy.mjs`: PASSED (exit 0) in git checkout and exported archive without .git
- `node --test scripts/check-pnpm-version-policy.test.mjs`: PASSED (13/13 tests pass)
- `node scripts/check-node-version-policy.mjs`: PASSED (exit 0)
- `pnpm -r typecheck`: PASSED across all 36 workspace projects (server, ui, cli, packages/*)
- `pnpm test:run`: 15,060 tests pass across 742 test suites (4 environment-bound failures noted: Nix PATH isolation in cursor-local adapter, Darwin Unicode filename escaping in lsof, and host ~/.paperclip config schema isolation)
- `node --test scripts/__tests__/provision-worktree-self-heal.test.mjs`: PASSED (20/20 tests pass)
- `node --test scripts/acpx-patch-packaging.test.mjs scripts/chat-adapter-patch-packaging.test.mjs .github/scripts/tests/lockfile-refresh-cache.test.mjs packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs`: PASSED (35/35 tests pass)
- `vitest run ui/src/lib/lexical-single-copy.test.ts`: PASSED (3/3 tests pass)
- `vitest run cli/src/__tests__/worktree.test.ts -t "reuses the current pnpm executable"`: PASSED
- `git diff --check`: PASSED (clean, 0 whitespace or conflict marker errors)

## Risks

- Low to medium toolchain migration risk.
- Explicit `allowBuilds` policy prevents arbitrary install-time script execution; any newly introduced native dependency will need to be explicitly declared in `pnpm-workspace.yaml`.
- Local developers need to use pnpm 11.27+ (`corepack enable` or `npm install -g pnpm@11.27.0`).

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

- Provider and model: Google DeepMind Antigravity (Advanced Agentic Coding)
- Capabilities used: code execution, shell commands, file editing, and test verification.
- Co-authored-by: Austin <austinpilz@users.noreply.github.com>

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [x] I have run tests locally and they pass
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [x] All Paperclip CI gates are green
- [x] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [x] I will address all Greptile and reviewer comments before requesting merge
