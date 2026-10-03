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
> - In compliance with upstream repository CI policy ("CI owns lockfile updates"), `pnpm-lock.yaml` is excluded from the pull request diff and will be updated by CI upon merge.
> - The benefit is a modern, faster, and more secure toolchain with explicit build script controls (`allowBuilds`) and deterministic peer resolution.

## Linked Issues or Issue Description

Fixes: #8827
Refs: #13894

**Resolution of previous review findings:**
1. **CI Prerequisite:** Pull request workflows (`pr.yml`) delegate to `paperclipai/paperclip/.github/workflows/pr-trusted.yml@master`. On `master`, `pr-trusted.yml` hardcodes `with: version: 9.15.4`, which forces pnpm 9 on PR CI runs and caused 45 of 47 jobs to fail at "Setup pnpm" (Run 36998312578). Removing the hardcoded version in the prerequisite PR package allows `pnpm/action-setup` to dynamically read `package.json#packageManager`, keeping master on 9.15.4 while running this PR on 11.27.0. Because PR workflows run `pr-trusted.yml@master`, all workflow and policy adjustments in this PR will take effect only after merge.
2. **Lockfile Policy Compliance:** Upstream CI enforces "Block manual lockfile edits" ("Do not commit pnpm-lock.yaml in pull requests. CI owns lockfile updates."). In accordance with this rule, `pnpm-lock.yaml` is excluded from the PR diff. On a merge tree with master's lockfile, pnpm 11's frozen install fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` because pnpm 11 expects SHA-256 patch hashes whereas the pnpm 9 lockfile uses `{ hash, path }` dictionaries; the two-step fallback sequence (`pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile` followed by `pnpm install --frozen-lockfile --ignore-scripts`) updates the lockfile inline.
3. **Windows Path Escaping (`greptile-apps[bot]`):** In `packages/paperclip-runner/scripts/check-clean-consumers.mjs:195-197`, `check-clean-consumers.mjs` writes `pnpm-workspace.yaml` using JSON serialization (`JSON.stringify({ overrides: localOverrides(...) }, null, 2)`). Because JSON is valid YAML and safely escapes backslashes in Windows file paths, unescaped backslash sequences cannot occur.
4. **Older Worktree Patch Tracking (`greptile-apps[bot]`):** In `scripts/provision-worktree.sh:735-760`, `provision-worktree.sh` inspects `package.json` for `manifest.pnpm?.patchedDependencies` (lines 735–745) before parsing `pnpm-workspace.yaml` (lines 746–760), ensuring patches on older pre-migration branches are included in the worktree install fingerprint hash.
5. **Policy Job CI Integration (`greptile-apps[bot]`):** `package.json:46` defines `"check:pnpm-version": "node scripts/check-pnpm-version-policy.mjs"`. In `.github/workflows/pr-trusted.yml:309-314`, `pnpm check:pnpm-version --scan-tracked` and its unit tests (`node --test ./scripts/check-pnpm-version-policy.test.mjs`) are wired directly into the trusted policy job alongside `check:node-version`. Because PR CI runs `pr-trusted.yml@master`, this policy step takes effect only after merge into master.
6. **Source Policy Validation & Tracked Reference Scanning:** `scripts/check-pnpm-version-policy.mjs` separates the build-time policy check (manifest, workspace configuration, workflow pins, Dockerfile, and prerequisites) from repository reference scanning. The build-time check requires no Git and runs cleanly from exported source archives, while the pnpm 9 reference scan judges only files Git tracks (`git ls-files -z`), preventing untracked and git-ignored scratch files from failing checkout validation.
7. **Windows Validation & Ecosystem Alignment:** We acknowledge and appreciate @drew1two's independent validation on Windows (using pnpm 11.27.1), which confirmed cross-platform stability and highlighted interoperability with related initiatives (Refs #10627, #13991, #14174).

## What Changed

- **Package Manager Pin:** Updated `packageManager` to `pnpm@11.27.0` in `package.json`; removed obsolete root `pnpm` configuration block.
- **Workspace Manifest Authority:** Configured `pnpm-workspace.yaml` with `autoInstallPeers: false`, `patchedDependencies`, `overrides`, and an explicit `allowBuilds` policy permitting necessary binaries (`@embedded-postgres/*`, `esbuild`, `opencode-ai`) while denying unneeded compilation scripts.
- **Lockfile Policy Compliance:** In compliance with repository CI policy ("CI owns lockfile updates"), `pnpm-lock.yaml` is excluded from the pull request diff.
- **Workflows & CI:** Pinned `pnpm/action-setup` to `11.27.0` across GitHub Actions workflow files. Added `check:pnpm-version` and its unit test to the `policy` job in `pr-trusted.yml`.
- **Policy Check Independence & Tracked Scan:** Separated build-time policy checks in `scripts/check-pnpm-version-policy.mjs` from repository reference scanning. The build-time check operates without Git dependencies on manifests, workflows, and prerequisites, while the reference scan strictly evaluates tracked source files via `git ls-files -z` without traversing git-ignored directories.
- **Worktree Provisioning:** Enhanced patch fingerprinting in `scripts/provision-worktree.sh` to read from both `pnpm-workspace.yaml` and legacy `package.json#pnpm`. Preserves `--prod=false` across `pnpm install` calls, which is supported by pnpm 11.27.0's CLI parser and ensures devDependencies are retained in production environments.
- **Dockerfile:** Updated `docker/daytona-runner/Dockerfile` to `corepack prepare pnpm@11.27.0 --activate`.
- **Packaging Scripts:** Updated `scripts/prepare-bundled-package.mjs` and package contract tests to read patched dependencies from `pnpm-workspace.yaml`.
- **Documentation:** Updated prerequisite references in `README.md`, `cli/README.md`, `doc/DEVELOPING.md`, `docs/start/*`, and runner tutorial guides from pnpm 9 to pnpm 11.27+.

## Verification

Base commit: `ffe5e9e2a8866767cbb48009040bfafd85b56576` (upstream master)
Head commit: `4a4d2e1624c7025ca2cd51b6dd5a12a4907410eb`

- `pnpm install --frozen-lockfile --ignore-scripts` (on master's lockfile): Fails as expected with `[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH]` due to pnpm 11 patch hash format differences.
- CI fallback install sequence (`pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile` followed by `pnpm install --frozen-lockfile --ignore-scripts`): PASSED (exit 0).
- `node scripts/check-pnpm-version-policy.mjs`: PASSED (exit 0) in git checkout and exported archive without .git
- `node --test scripts/check-pnpm-version-policy.test.mjs`: PASSED (13/13 tests pass)
- `node scripts/check-node-version-policy.mjs`: PASSED (exit 0)
- `pnpm -r typecheck`: PASSED across all 36 workspace projects (server, ui, cli, packages/*)
- `pnpm test:run`: 15,060 tests pass across 742 test suites. 4 environment-bound failures noted:
  1. `packages/adapters/src/__tests__/cursor-local-adapter-environment.test.ts` (1 test: Darwin PATH isolates host Nix environment for `#!/usr/bin/env node`)
  2. `packages/adapters/src/__tests__/cursor-local-execute.test.ts` (2 tests: Darwin PATH isolates host Nix environment for `#!/usr/bin/env node`)
  3. `packages/paperclip-runner/test/file-delivery-bridges.test.ts` (1 test: Darwin `lsof` hex-escapes UTF-8 filenames like `"猫 picture.png"`; isolated fix in fork PR 11)
  4. `server/src/__tests__/workspace-runtime.test.ts` (5 tests: legacy host `~/.paperclip/instances/default/config.json` lacks newly required schema fields `$meta`, `database`, `logging`, `server`; isolated fix in fork PR 12)
- `node --test scripts/__tests__/provision-worktree-self-heal.test.mjs`: PASSED (20/20 tests pass)
- `node --test scripts/acpx-patch-packaging.test.mjs scripts/chat-adapter-patch-packaging.test.mjs .github/scripts/tests/lockfile-refresh-cache.test.mjs packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs`: PASSED (35/35 tests pass)
- `vitest run ui/src/lib/lexical-single-copy.test.ts`: PASSED (3/3 tests pass)
- `vitest run cli/src/__tests__/worktree.test.ts -t "reuses the current pnpm executable"`: PASSED
- `git diff --check`: PASSED (clean, 0 whitespace or conflict marker errors)

## Risks

- Low to medium toolchain migration risk.
- Explicit `allowBuilds` policy prevents arbitrary install-time script execution; any newly introduced native dependency will need to be explicitly declared in `pnpm-workspace.yaml`.
- Local developers need to use pnpm 11.27+ (`corepack enable` or `npm install -g pnpm@11.27.0`).
- Because `pr-trusted.yml@master` pins pnpm 9.15.4, PR CI requires prerequisite PR #33 to pass against the declared `packageManager`.

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

- Provider and model: Google DeepMind Antigravity (Advanced Agentic Coding)
- Capabilities used: code execution, shell commands, file editing, and test verification.
*(Note: An earlier draft erroneously listed Austin as co-author due to an attribution carried over from unrelated PR #9530 in commit `9ef9a9daa`; Austin was not a contributor to this PR and the line has been removed).*

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [ ] I have run tests locally and they pass (15,060 tests pass across 742 suites; 4 environment-bound suites fail as documented under Verification)
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green (PR CI runs master's workflow pinning pnpm 9.15.4; gates will turn green once prerequisite PR #33 is merged and CI updates the lockfile)
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups (3 findings addressed with file:line evidence above, awaiting maintainer review)
- [x] I will address all Greptile and reviewer comments before requesting merge
