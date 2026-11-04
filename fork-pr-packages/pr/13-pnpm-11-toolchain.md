# refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827)

| Field | Value |
| --- | --- |
| Branch | `stable/v2026.916.1/chore/pnpm-11-toolchain` |
| Head | `7661b5f483828ba16f903e4e9f0a5a6c7f70ee7f` |
| Base commit | `e0276e0166c59959014b5b087633975b45f61cdf` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | `pr/33-pr-workflows-read-pnpm-version-from-package-json` |
| Proposed title | `refactor(toolchain): migrate repository to pnpm 11.27.0 (#8827)` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `.github/scripts/tests/lockfile-refresh-cache.test.mjs` | +1 | -1 |
| `.github/workflows/*.yml` (20 workflow files) | +58 | -52 |
| `README.md` | +1 | -1 |
| `cli/README.md` | +1 | -1 |
| `cli/src/__tests__/worktree.test.ts` | +4 | -4 |
| `doc/DEVELOPING.md` | +1 | -1 |
| `docker/daytona-runner/Dockerfile` | +2 | -2 |
| `docs/deploy/local-development.md` | +1 | -1 |
| `docs/start/architecture.md` | +1 | -1 |
| `docs/start/quickstart.md` | +1 | -1 |
| `package.json` | +1 | -27 |
| `packages/paperclip-runner/README.md` | +1 | -1 |
| `packages/paperclip-runner/docs/tutorials/*.md` (8 files) | +11 | -11 |
| `packages/paperclip-runner/scripts/check-clean-consumers.mjs` | +11 | -7 |
| `packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs` | +14 | -20 |
| `pnpm-workspace.yaml` | +18 | -2 |
| `scripts/__tests__/provision-worktree-self-heal.test.mjs` | +29 | -3 |
| `scripts/__tests__/release-verify-workflow.test.mjs` | +6 | -4 |
| `scripts/acpx-patch-packaging.test.mjs` | +23 | -14 |
| `scripts/chat-adapter-patch-packaging.test.mjs` | +7 | -4 |
| `scripts/check-pnpm-version-policy.mjs` | +200 | -0 |
| `scripts/check-pnpm-version-policy.test.mjs` | +229 | -0 |
| `scripts/prepare-bundled-package.mjs` | +35 | -6 |
| `scripts/provision-worktree-runtime.sh` | +2 | -3 |
| `scripts/provision-worktree.sh` | +31 | -12 |
| `server/src/__tests__/workspace-runtime.test.ts` | +4 | -6 |
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

Related open pull requests:
- #13894 is this pull request on upstream (`paperclipai/paperclip#13894`).
- `pr/33-pr-workflows-read-pnpm-version-from-package-json` is the prerequisite workflow PR that lets `.github/workflows/pr-trusted.yml` read `package.json#packageManager` instead of hardcoding `version: 9.15.4`.

Stack: this pull request depends on `pr/33-pr-workflows-read-pnpm-version-from-package-json`. Pull request 33-pr-workflows removes the hardcoded `version: 9.15.4` input from `pnpm/action-setup` in `.github/workflows/pr-trusted.yml` on `master`, so PR CI installs the declared `packageManager` dynamically. Review and merge that pull request first.

## What Changed

- `packageManager` in `package.json` is `pnpm@11.27.0`; the obsolete root `pnpm` block in `package.json` is removed.
- `pnpm-workspace.yaml` holds `autoInstallPeers: false`, `patchedDependencies`, `overrides`, and an explicit `allowBuilds` policy permitting the needed binaries (`@embedded-postgres/*`, `esbuild`, `opencode-ai`) and denying other build scripts.
- `pnpm/action-setup` is pinned to `11.27.0` across non-reusable workflow files, and `pr-trusted.yml` omits the `version` input so `pnpm/action-setup` reads `package.json#packageManager`; `check:pnpm-version` and its unit test run in the `policy` job.
- `scripts/check-pnpm-version-policy.mjs` validates manifest, workspace configuration, workflow pins, Dockerfile, and tracked-file references.
- `scripts/provision-worktree.sh` reads patched dependencies from both `pnpm-workspace.yaml` and legacy `package.json#pnpm`, and `scripts/prepare-bundled-package.mjs` reads patched dependencies from `pnpm-workspace.yaml` with safe `JSON.stringify` workspace overrides in `check-clean-consumers.mjs`.
- Prerequisite references in `README.md`, `cli/README.md`, `doc/DEVELOPING.md`, `docs/start/*`, and runner tutorials move from pnpm 9 to pnpm 11.27+.

## Verification

Head `7661b5f483828ba16f903e4e9f0a5a6c7f70ee7f`. Base: `paperclipai/paperclip` master `e0276e0166c59959014b5b087633975b45f61cdf`.

- Regression proof: `scripts/check-pnpm-version-policy.test.mjs`, `scripts/acpx-patch-packaging.test.mjs`, `scripts/__tests__/provision-worktree-self-heal.test.mjs`, `scripts/__tests__/release-verify-workflow.test.mjs`, and `packages/paperclip-runner/test/acpx-codex-package-contract.test.mjs` fail on the base (`package.json` still has `pnpm@9.15.4` and `package.json#pnpm`) and pass on the head (`27 passed` across the policy and packaging suites, plus `Greptile Review` 5/5 and `commitperclip PR Review` passed on #13894).
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- The explicit `allowBuilds` policy blocks arbitrary install-time scripts; a new native dependency must be declared in `pnpm-workspace.yaml`.
- Local developers need pnpm 11.27+ (`corepack enable` or `npm install -g pnpm@11.27.0`).
- PR CI jobs in `pr-trusted.yml@master` fail at Setup pnpm until the prerequisite workflow PR merges into `master`.

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

- Provider and model: Google Gemini 3.1 Pro (`gemini-3.1-pro`, 1M-token context window), used through Antigravity.
- Capabilities used: tool use (shell, file reads and edits), code execution, extended reasoning, and duplicate/issue search across `paperclipai/paperclip`.

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
- [ ] All Paperclip CI gates are green
- [x] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [x] I will address all Greptile and reviewer comments before requesting merge
