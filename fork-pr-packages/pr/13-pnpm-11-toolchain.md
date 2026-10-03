# refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827)

| Field | Value |
| --- | --- |
| Upstream PR | `paperclipai/paperclip#13894` |
| Branch | `stable/v2026.916.1/chore/pnpm-11-toolchain` |
| Head | `4a4d2e1624c7025ca2cd51b6dd5a12a4907410eb` |
| Base commit | `ffe5e9e2a8866767cbb48009040bfafd85b56576` |
| Upstream base | `paperclipai/paperclip` master `ffe5e9e2a8866767cbb48009040bfafd85b56576` |
| Stack prerequisite | `ci(workflows): let PR workflows install declared pnpm version from package.json` (see [`pr/33-pr-workflows-read-pnpm-version-from-package-json.md`](33-pr-workflows-read-pnpm-version-from-package-json.md)) |
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
> - This pull request migrates the root and workspace configurations, GitHub Actions workflows, Dockerfile setup, worktree provisioning scripts, and documentation prerequisites to pnpm 11.27.0.
> - Following the repository rule that CI owns lockfile updates, `pnpm-lock.yaml` is not part of this diff.
> - The benefit is a modern, faster, and more secure toolchain with explicit build script controls (`allowBuilds`) and deterministic peer resolution.

## Linked Issues or Issue Description
Fixes: #8827

**Resolution of previous review findings:**
1. **CI prerequisite:** `pr.yml` delegates to `paperclipai/paperclip/.github/workflows/pr-trusted.yml@master`, which pins `pnpm/action-setup` to `version: 9.15.4`. On this PR that makes 45 of 47 jobs fail at "Setup pnpm". A separate prerequisite PR (link to follow) removes the hardcoded version so `pnpm/action-setup` reads `package.json#packageManager`: master keeps running pnpm 9.15.4 and this PR runs on 11.27.0. Because PR CI always runs master's trusted workflow, the workflow and policy changes in this PR take effect only after merge.
2. **Lockfile policy:** `pnpm-lock.yaml` is excluded from the diff ("Block manual lockfile edits" passes). On the merge tree, pnpm 11's frozen install first fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`, because pnpm 11 records patched dependencies as SHA-256 hashes where the pnpm 9 lockfile has `{ hash, path }` entries. CI's existing fallback (`pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile`, then `pnpm install --frozen-lockfile --ignore-scripts`) resolves it inline: the Sentry SDK contract workflow on this head passes with master's lockfile.
3. **Windows path escaping (greptile-apps[bot]):** `packages/paperclip-runner/scripts/check-clean-consumers.mjs:195-197` writes `pnpm-workspace.yaml` with `JSON.stringify({ overrides: localOverrides(...) }, null, 2)`. JSON is valid YAML and escapes backslashes, so Windows paths cannot produce invalid escape sequences.
4. **Older worktree patch tracking (greptile-apps[bot]):** `scripts/provision-worktree.sh:735-760` reads `manifest.pnpm?.patchedDependencies` from `package.json` (lines 735–745) before `pnpm-workspace.yaml` (lines 746–760), so patches on pre-migration branches stay in the install fingerprint.
5. **Policy job CI integration (greptile-apps[bot]):** `package.json:46` defines `check:pnpm-version`, and `.github/workflows/pr-trusted.yml:309-314` runs `pnpm check:pnpm-version --scan-tracked` and `node --test ./scripts/check-pnpm-version-policy.test.mjs` in the policy job next to `check:node-version`. Since PR CI runs `pr-trusted.yml@master`, this step runs only after merge.
6. **Source policy validation and tracked reference scanning:** `scripts/check-pnpm-version-policy.mjs` separates the build-time policy check (manifest, workspace configuration, workflow pins, Dockerfile, prerequisites), which needs no Git and runs from exported source archives, from the pnpm 9 reference scan, which judges only files Git tracks (`git ls-files -z`).
7. **Windows validation:** thanks to @drew1two for independently validating the migration approach on Windows with pnpm 11.27.1 (related: #10627, #13991, #14174).

## What Changed
- **Package manager pin:** `packageManager` is `pnpm@11.27.0`; the obsolete root `pnpm` block in `package.json` is removed.
- **Workspace manifest authority:** `pnpm-workspace.yaml` holds `autoInstallPeers: false`, `patchedDependencies`, `overrides`, and an explicit `allowBuilds` policy permitting the needed binaries (`@embedded-postgres/*`, `esbuild`, `opencode-ai`) and denying other build scripts.
- **Workflows and CI:** `pnpm/action-setup` pinned to `11.27.0` across workflow files; `check:pnpm-version` and its unit test added to the `policy` job in `pr-trusted.yml`.
- **Policy check independence and tracked scan:** build-time policy checks are separate from the tracked-file reference scan, as described above.
- **Worktree provisioning:** patch fingerprinting in `scripts/provision-worktree.sh` reads both `pnpm-workspace.yaml` and legacy `package.json#pnpm`; `--prod=false` is kept in `pnpm install` calls, which pnpm 11.27.0 accepts.
- **Dockerfile:** `docker/daytona-runner/Dockerfile` uses `corepack prepare pnpm@11.27.0 --activate`.
- **Packaging scripts:** `scripts/prepare-bundled-package.mjs` and package contract tests read patched dependencies from `pnpm-workspace.yaml`.
- **Documentation:** prerequisite references in `README.md`, `cli/README.md`, `doc/DEVELOPING.md`, `docs/start/*`, and runner tutorials move from pnpm 9 to pnpm 11.27+.

## Verification
Base commit: `ffe5e9e2a8866767cbb48009040bfafd85b56576` (upstream master)
Head commit: `4a4d2e1624c7025ca2cd51b6dd5a12a4907410eb`
- `pnpm install --frozen-lockfile --ignore-scripts` on master's lockfile: fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`, as described above.
- CI fallback sequence (`--resolution-only --no-frozen-lockfile`, then `--frozen-lockfile`): passes locally (exit 0) and in this PR's Sentry SDK contract run.
- `node scripts/check-pnpm-version-policy.mjs`: passes in a Git checkout and in an exported archive without `.git`.
- `node --test scripts/check-pnpm-version-policy.test.mjs`: 13/13 pass.
- `node scripts/check-node-version-policy.mjs`: passes.
- `pnpm -r typecheck`: passes across all 36 workspace projects.
- `pnpm test:run`: 15,060 tests pass across 742 suites; 4 suites fail for environment reasons on the macOS/Nix test host:
  1. `packages/adapters/src/__tests__/cursor-local-adapter-environment.test.ts` (1 test) and
  2. `packages/adapters/src/__tests__/cursor-local-execute.test.ts` (2 tests): fake CLIs run via `#!/usr/bin/env node`, and the default macOS PATH omits the host's Nix profile.
  3. `packages/paperclip-runner/test/file-delivery-bridges.test.ts` (1 test): Darwin `lsof` hex-escapes UTF-8 filenames such as `"猫 picture.png"`.
  4. `server/src/__tests__/workspace-runtime.test.ts` (5 tests): the host's older `~/.paperclip/instances/default/config.json` lacks newer schema fields.
- `node --test scripts/__tests__/provision-worktree-self-heal.test.mjs`: 20/20 pass.
- `node --test scripts/acpx-patch-packaging.test.mjs scripts/chat-adapter-patch-packaging.test.mjs .github/scripts/tests/lockfile-refresh-cache.test.mjs packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs`: 35/35 pass.
- `vitest run ui/src/lib/lexical-single-copy.test.ts`: 3/3 pass.
- `vitest run cli/src/__tests__/worktree.test.ts -t "reuses the current pnpm executable"`: passes.
- `git diff --check`: clean.

## Risks
- Low to medium toolchain migration risk.
- The explicit `allowBuilds` policy blocks arbitrary install-time scripts; a new native dependency must be declared in `pnpm-workspace.yaml`.
- Local developers need pnpm 11.27+ (`corepack enable` or `npm install -g pnpm@11.27.0`).
- PR CI stays red at "Setup pnpm" until the prerequisite workflow PR is merged.

## Model Used
- Provider and model: Google DeepMind Antigravity (Advanced Agentic Coding)
- Capabilities used: code execution, shell commands, file editing, and test verification.

**Note for the merging maintainer:** commit `9ef9a9daa` carries a `Co-authored-by: Austin <austinpilz@users.noreply.github.com>` trailer copied by mistake from unrelated PR #9530. Austin did not contribute to this PR; please omit that trailer from the squash commit.

## Checklist
- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [ ] I have run tests locally and they pass (4 environment-bound suites fail, listed under Verification)
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green (45 jobs fail at "Setup pnpm" until the prerequisite workflow PR is merged)
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups (its three findings are answered above with file:line evidence)
- [x] I will address all Greptile and reviewer comments before requesting merge
