# ci(workflows): let PR workflows install declared pnpm version from package.json

| Field | Value |
| --- | --- |
| Upstream PR | Drafted prerequisite for `paperclipai/paperclip#13894` |
| Branch | `pr/33-pr-workflows-read-pnpm-version-from-package-json` |
| Head | `6ca13025d4807154135cdd9d985d6a1b6ce5d1f3` |
| Base commit | `78e003449827540175e2441c05bac9eeec8dae98` |
| Upstream base | `paperclipai/paperclip` master `78e003449827540175e2441c05bac9eeec8dae98` |
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
> - In `pr-trusted.yml`, all 8 jobs running `pnpm/action-setup` currently hardcode `version: 9.15.4`.
> - When a pull request updates the repository package manager (such as #13894 migrating to pnpm 11), `pnpm/action-setup` throws a version conflict error because the action's `version` input differs from the PR's `package.json#packageManager`.
> - Other PR workflows (`sentry-contract.yml`, `docker-runner-check.yml`, `storybook-visual.yml`) execute from the PR's merge ref and pick up branch workflow edits, but `pr-trusted.yml` is bound to `master`.
> - This pull request removes the hardcoded `version: 9.15.4` input from all `pnpm/action-setup` steps in `pr-trusted.yml`.
> - The benefit is that `master` runs continue installing pnpm 9.15.4 while pull requests run under their declared `packageManager` without version conflicts.

## Linked Issues or Issue Description

Refs: #8827, #13894

**Why #13894 depends on this PR:**
Pull request #13894 migrates the Paperclip repository to pnpm 11.27.0. On #13894 (e.g. head `4a4d2e162`), 45 of 47 jobs fail at the "Setup pnpm" step.

**Real failure mechanism:**
In `pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86`, the function `readTargetVersion` in `src/install-pnpm/run.ts` enforces:
```typescript
if (version) {
  if (packageManagerVersion && packageManagerVersion !== version) {
    throw new Error(`Multiple versions of pnpm specified:
  - version ${version} in the GitHub Action config with the key "version"
  - version ${packageManager} in the package.json with the key "packageManager"
Remove one of these versions to avoid version mismatch errors like ERR_PNPM_BAD_PM_VERSION`)
  }

  return version
}
```
When the GitHub Action workflow specifies `with: version: 9.15.4`, but `package.json` in the checked-out PR workspace declares `"packageManager": "pnpm@11.27.0"`, `readTargetVersion` throws this exact error and terminates the step.

When the `version` input is omitted, `readTargetVersion` falls back to reading `packageManagerVersion`:
```typescript
if (packageManagerVersion) {
  return packageManagerVersion
}
```
- On `master`, `package.json` specifies `"packageManager": "pnpm@9.15.4"`, so master runs install pnpm 9.15.4.
- On #13894, `package.json` specifies `"packageManager": "pnpm@11.27.0"`, so PR runs install pnpm 11.27.0.

**Which workflows run from `master` vs PR merge ref:**
- **Runs from `master`:** `.github/workflows/pr-trusted.yml`. The entry point `.github/workflows/pr.yml` delegates via `uses: paperclipai/paperclip/.github/workflows/pr-trusted.yml@master`. Reusable workflows pinned to `@master` run the definition stored on `master`, ignoring any workflow modifications on the PR branch.
- **Run from the PR's merge ref:** Other PR workflows, including `sentry-contract.yml`, `docker-runner-check.yml`, and `storybook-visual.yml`, run directly from the PR's merge ref (`refs/pull/<id>/merge`).
  - *Evidence:* On #13894 head `4a4d2e162`, Sentry SDK contract run `37119904279` ran the branch's own workflow definition pinning pnpm 11.27.0 and passed.
- **Dispatch only:** `e2e.yml` only triggers on `workflow_dispatch`.

Therefore, `pr-trusted.yml` is the sole workflow that must be updated on `master` to unblock PR toolchain validation.

## What Changed

- In `.github/workflows/pr-trusted.yml`, removed the `version: 9.15.4` input from all 8 jobs running `pnpm/action-setup`:
  - `policy` (kept `run_install: false`)
  - `typecheck_release_registry`
  - `general_tests` (matrix: `test_matrix`)
  - `verify_paperclip_runner` (matrix: `test_runner`)
  - `build`
  - `verify_serialized_server`
  - `canary_dry_run`
  - `e2e_shards`

## Verification

Base commit: `78e003449827540175e2441c05bac9eeec8dae98` (upstream master)
Head commit: `6ca13025d4807154135cdd9d985d6a1b6ce5d1f3`

- **Action implementation verification:** Inspected `src/install-pnpm/run.ts` in `pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86`, confirming that `readTargetVersion` throws on version mismatches and resolves `package.json#packageManager` when `version` is omitted.
- **Workflow test suite:** Ran `node --test .github/scripts/tests/*.test.mjs scripts/__tests__/release-verify-workflow.test.mjs` — exactly 395 tests ran, 395 passed, 0 failed.
- **Node policy check:** Ran `node scripts/check-node-version-policy.mjs` — passed (exit 0).
- **Checkout ordering verification:** Confirmed that all 8 jobs in `pr-trusted.yml` execute `actions/checkout` before `pnpm/action-setup`, ensuring `package.json` is present for `readTargetVersion`.
- **Unverified until merge:** Live execution of PR CI on upstream PR #13894 cannot run against this unpinned configuration until this PR is merged into upstream `master`.

## Risks

- Low. Omitting `version` requires `package.json` to define `packageManager`, which is present and validated on `master`. Workflows running outside PR CI (such as release and publish pipelines) retain explicit version pins.

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
- [ ] I have added or updated tests where applicable (395 existing workflow tests cover the PR workflow)
- [ ] I have updated relevant documentation to reflect my changes (no documentation impacted)
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green (pending PR submission)
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups (pending PR review)
- [x] I will address all Greptile and reviewer comments before requesting merge
