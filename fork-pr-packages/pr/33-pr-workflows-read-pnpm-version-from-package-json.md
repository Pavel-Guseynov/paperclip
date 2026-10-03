# ci(workflows): let PR workflows install declared pnpm version from package.json

| Field | Value |
| --- | --- |
| Upstream PR | Drafted prerequisite for `paperclipai/paperclip#13894` |
| Branch | `pr/33-pr-workflows-read-pnpm-version-from-package-json` |
| Head | `b451ed8edc35e4d1262cb0a041d7a9ae7924563e` |
| Base commit | `78e003449827540175e2441c05bac9eeec8dae98` |
| Upstream base | `paperclipai/paperclip` master `78e003449827540175e2441c05bac9eeec8dae98` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `ci(workflows): let PR workflows install declared pnpm version from package.json` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `.github/workflows/docker-runner-check.yml` | +0 | -2 |
| `.github/workflows/e2e.yml` | +0 | -2 |
| `.github/workflows/pr-trusted.yml` | +0 | -15 |
| `.github/workflows/sentry-contract.yml` | +0 | -2 |
| `.github/workflows/storybook-visual.yml` | +0 | -2 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The repository's trusted pull request workflow (`.github/workflows/pr.yml`) invokes `.github/workflows/pr-trusted.yml@master` for security isolation.
> - In `pr-trusted.yml` and related PR workflows, `pnpm/action-setup` currently hardcodes `version: 9.15.4` (or `version: 9`).
> - Because GitHub Actions executes PR workflows from `master`, pull requests that update the toolchain (specifically #13894 migrating to pnpm 11) run under pnpm 9.15.4, causing 45 of 47 jobs to fail at "Setup pnpm".
> - `pnpm/action-setup` natively supports omitting the `version` parameter, falling back to reading `package.json#packageManager`.
> - This pull request removes the hardcoded pnpm versions from PR workflows executed from master.
> - The benefit is that `master` continues to run pnpm 9.15.4 while pull requests like #13894 run under their declared pnpm version.

## Linked Issues or Issue Description

Refs: #8827, #13894

**Why #13894 depends on this PR:**
Pull request #13894 migrates Paperclip from pnpm 9 to pnpm 11.27.0. However, when #13894 runs CI, GitHub Actions invokes `.github/workflows/pr-trusted.yml@master`. Because `pr-trusted.yml` on `master` explicitly pins `with: version: 9.15.4`, CI forces pnpm 9.15.4 into an environment configured with pnpm 11 workspace settings. This caused 45 of 47 jobs to fail at the "Setup pnpm" step on Run 36998312578 and Run 37118859727.

PR workflows cannot test or verify a toolchain upgrade until `master` allows the workflow to install the pnpm version declared by the pull request's own `package.json`.

**How `pnpm/action-setup` resolves the version:**
In `pnpm/action-setup` (pinned at `0977fd99725f1db4007ccb2928dbb4e90d06cc86`), the `version` input is optional. Its runtime implementation checks:
```javascript
if (s?.packageManager?.name === "pnpm" && s.packageManager.version)
  return s.packageManager.version;
if (o) return o;
```
When `version` (`o`) is omitted, the action inspects `package.json` in the checked-out workspace and parses the `packageManager` field:
- On `master`, `package.json` declares `"packageManager": "pnpm@9.15.4"`, so `master` workflows continue installing pnpm 9.15.4.
- On #13894, `package.json` declares `"packageManager": "pnpm@11.27.0"`, so PR workflows install pnpm 11.27.0.

Every PR workflow executed from master (`pr-trusted.yml`, `sentry-contract.yml`, `docker-runner-check.yml`, `storybook-visual.yml`) runs `actions/checkout` before `pnpm/action-setup`, ensuring `package.json` is always present on disk.

## What Changed

- In `.github/workflows/pr-trusted.yml`, removed hardcoded `version: 9.15.4` from all 8 jobs running `pnpm/action-setup` (`policy`, `typecheck_release_registry`, `general_tests`, `verify_paperclip_runner`, `build`, `verify_serialized_server`, `canary_dry_run`, `e2e_shards`).
- In `.github/workflows/sentry-contract.yml`, removed `with: version: 9.15.4` from `Setup pnpm`.
- In `.github/workflows/docker-runner-check.yml`, removed `with: version: 9.15.4` from `manual_image`.
- In `.github/workflows/storybook-visual.yml`, removed `with: version: 9.15.4` from `Setup pnpm`.
- In `.github/workflows/e2e.yml`, removed `with: version: 9` from `Setup pnpm`.

## Verification

Base commit: `78e003449827540175e2441c05bac9eeec8dae98` (upstream master)
Head commit: `b451ed8edc35e4d1262cb0a041d7a9ae7924563e`

- **Action implementation verification:** Inspected `pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86` (`dist/index.js`), confirming that omitting `version` triggers automatic resolution of `package.json#packageManager`.
- **Workflow test suite:** Ran `node --test .github/scripts/tests/*.test.mjs scripts/__tests__/release-verify-workflow.test.mjs` (395/395 tests pass).
- **Node policy check:** Ran `node scripts/check-node-version-policy.mjs` (passes).
- **Checkout ordering verification:** Confirmed that all 8 jobs in `pr-trusted.yml`, `sentry-contract.yml`, `docker-runner-check.yml`, and `storybook-visual.yml` execute `actions/checkout` before `pnpm/action-setup`, guaranteeing that `package.json` is readable by the action.
- **Unverified until merge:** Live execution of PR CI on upstream PR #13894 cannot be verified until a maintainer merges this change into `master`, because GitHub Actions executes `.github/workflows/pr-trusted.yml@master`.

## Risks

- Minimal. When `version` is omitted, `pnpm/action-setup` requires `package.json` with a valid `packageManager` field. Both `master` and feature branches define `packageManager`. Workflows not triggered by PRs (e.g. tag releases) remain pinned.

## Model Used

- Provider and model: Google DeepMind Antigravity (Advanced Agentic Coding)
- Capabilities used: code inspection, shell analysis, documentation verification.

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [x] I have run tests locally and they pass
- [ ] I have added or updated tests where applicable (existing 395 workflow tests cover all PR workflows)
- [ ] I have updated relevant documentation to reflect my changes (no documentation impacted)
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green (pending PR submission)
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups (pending PR review)
- [x] I will address all Greptile and reviewer comments before requesting merge
