# ci(workflows): let PR workflows install declared pnpm version from package.json

| Field | Value |
| --- | --- |
| Branch | `pr/33-pr-workflows-read-pnpm-version-from-package-json` |
| Head | `9e283a896ce6d908a24a141ed21429a74f55f518` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `ci(workflows): let PR workflows install declared pnpm version from package.json` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `.github/workflows/pr-trusted.yml` | +0 | -15 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The repository's trusted pull request workflow (`.github/workflows/pr.yml`) invokes `.github/workflows/pr-trusted.yml@master` for security isolation.
> - In `pr-trusted.yml`, all 8 jobs running `pnpm/action-setup` hardcode `version: 9.15.4`.
> - When a pull request updates `package.json#packageManager` (such as #13894 migrating to pnpm 11), `pnpm/action-setup` throws `ERR_PNPM_BAD_PM_VERSION` because the action's `version` input conflicts with `package.json#packageManager`.
> - This pull request removes the hardcoded `version: 9.15.4` input from all 8 `pnpm/action-setup` steps in `pr-trusted.yml`.
> - The benefit is that `master` continues installing pnpm 9.15.4 from its `package.json` while pull requests that update `packageManager` run under their declared pnpm version.

## Linked Issues or Issue Description

Refs: #8827, #13894

Prerequisite workflow change for #13894 so `.github/workflows/pr-trusted.yml@master` reads `packageManager` from the checked-out `package.json`.

## What Changed

- Removed the hardcoded `version: 9.15.4` input from all 8 `pnpm/action-setup` steps in `.github/workflows/pr-trusted.yml` (`policy`, `typecheck_release_registry`, `general_tests`, `verify_paperclip_runner`, `build`, `verify_serialized_server`, `canary_dry_run`, and `e2e_shards`).
- All 8 jobs run `actions/checkout` before `pnpm/action-setup`, so `pnpm/action-setup` resolves the exact version from `package.json#packageManager`.

## Verification

Head `9e283a896ce6d908a24a141ed21429a74f55f518`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Verification: `.github/workflows/pr-trusted.yml`. All 8 `pnpm/action-setup@v4` steps run after `actions/checkout@v4` and read `package.json#packageManager` when `version` is omitted. Result on head: workflow YAML validated.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Low risk: `package.json` on `master` already declares `"packageManager": "pnpm@9.15.4"`, and release/publish workflows keep their explicit pins.

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
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [x] I will address all Greptile and reviewer comments before requesting merge
