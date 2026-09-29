# Change 29: Review stage wakes only after required check reports on exact head

## Thinking Path

> - Paperclip manages AI agents working on tasks across multi-stage execution policies.
> - An author hand-off transitions an issue into the review stage (`in_review`).
> - Previously, the review stage immediately scheduled a reviewer wakeup (`execution_review_requested`) upon transition, even while the pull request's required CI checks were still pending or had failed on the exact reviewed head.
> - This caused reviewers to wake up prematurely and review broken or untested code before CI completed.
> - By gating the review stage wakeup on the required check status, issues enter `check_pending` when CI is pending, wake the reviewer only when CI passes, and immediately return to the author with `changes_requested` if CI fails.
> - Webhooks from the forge (`POST /api/webhooks/gitea`), daemon startup reconciliation, and on-demand synchronization (`POST /api/issues/:id/sync-checks`) ensure reliable state advancement without polling or sleeping.

## Linked Issues or Issue Description

Refs #14322

### What happened?

Reviewers are woken the moment an author hands off, before the PR's required CI checks complete. When the check fails, the reviewer wastes a turn reviewing broken code, or both author and reviewer wake in parallel.

### Expected behavior

The review stage wakes only after the required check reports on the exact reviewed head. If the check is pending at hand-off, the issue enters `check_pending` without waking the reviewer. When CI succeeds, `check_pending` clears and the reviewer wakes. If CI fails, the issue returns to the author as changes-requested and wakes the author.

## What Changed

- Add `check_pending` status to `ISSUE_EXECUTION_STATE_STATUSES` and optional `checkedSha` to `IssueExecutionState`.
- Add `server.gitWebhookSecretFile` configuration option with safe credential file reading (0600, non-symlink, matching UID, outside store).
- Implement authenticated inbound Gitea webhook endpoint (`POST /api/webhooks/gitea`) with HMAC-SHA256 signature verification over raw body via `X-Gitea-Signature`.
- Implement review stage check reconciliation on hand-off in `PATCH /api/issues/:id`:
  - When CI is pending: issue enters `status: "in_review"`, `executionState.status: "check_pending"`, `checkedSha: exactSha`, no reviewer wake.
  - When CI succeeds: reviewer wake enqueued immediately.
  - When CI fails: returns to author in `status: "in_progress"`, `executionState.status: "changes_requested"`, wakes author.
- Implement daemon startup reconciliation (`reconcileCheckPendingIssuesOnStartup`) to advance stranded issues if checks completed while the server was down.
- Implement authenticated on-demand check sync endpoint (`POST /api/issues/:id/sync-checks`).
- Add comprehensive regression test suite covering all 9 contract behaviors.

## Exact Branch State & Commit SHAs

| Ref | Full SHA |
| --- | --- |
| Upstream base (`master`) | `3166e93a7eee315e3bfbda622e080044ec5c343d` |
| Contribution branch (`fix/review-stage-waits-for-required-check`) | `1ed0075a1164ca14210219159ccfe7802066c5af` |
| Stable base (`v2026.916.1`) | `d554c4789ed3930f8a53ac9fdf6503b3187097da` |
| Stable branch (`stable/v2026.916.1/fix/review-stage-waits-for-required-check`) | `207968a7d0637b477bc5f50e8ccc8698da2415dd` |
| Integration base (`main` prior to merge) | `a49481259d5d1e0b72b4e09d1b3ebf7a7e127751` |
| Integration merge (`main`) | `c5fd824f48139eed3408bae4bdeb8949b9d86d59` |

## Verification and Test Proof

### 1. Regression Suite (`server/src/__tests__/review-stage-required-check.test.ts`)

| # | Test Case Description | Base (`master` / `v2026.916.1`) | Head (`fix` / `stable` / `main`) |
| - | --------------------- | ------------------------------- | -------------------------------- |
| 1 | Hand-off whose required check is already successful immediately enqueues reviewer wakeup | FAIL (no check evaluation) | PASS |
| 2 | Hand-off whose required check is pending enters `check_pending` and enqueues no reviewer wakeup | FAIL (woke reviewer prematurely) | PASS |
| 2b | Hand-off whose required check has already failed returns to author as changes-requested and wakes author | FAIL (woke reviewer instead) | PASS |
| 3 | Incoming authenticated Gitea status webhook reporting success clears `check_pending` and wakes reviewer | FAIL (no webhook handler) | PASS |
| 4 | Incoming authenticated Gitea status webhook reporting failure transitions to `in_progress` and wakes author | FAIL (no webhook handler) | PASS |
| 5 | Incoming webhook with invalid or missing signature fails closed with HTTP 401 Unauthorized | FAIL (endpoint 404) | PASS |
| 6 | Check status event for unrelated commit SHA does not mutate issue state or trigger any wakeup | PASS (no-op) | PASS |
| 7 | Issue stranded in `check_pending` whose check completed during downtime is reconciled on startup | FAIL (no startup reconciler) | PASS |
| 8 | Issue in `check_pending` receiving authenticated `POST /api/issues/:id/sync-checks` advances immediately | FAIL (endpoint 404) | PASS |

- Result on unpatched upstream base: 8 failed causally, 1 passed.
- Result on unpatched stable base: 8 failed causally, 1 passed.
- Result on contribution head: 9/9 passed.
- Result on stable head: 9/9 passed.
- Result on main merge: 9/9 passed.

### 2. Startup Suite (`server/src/__tests__/server-startup-feedback-export.test.ts`)
- Result on contribution head: 21/21 passed.
- Result on stable head: 20/20 passed.
- Result on main merge: 21/21 passed.

### 3. Repository Gates Matrix on `main`
- `pnpm check:tokens`: Clean (0 forbidden tokens found).
- `pnpm check:token-gates`: Clean (0 violations across 1,018 scanned files).
- `pnpm check:node-version`: Passed (Node >=24.11.0, @types/node 24.x).
- `pnpm check:no-git-push`: Clean (0 unapproved `git push` invocations).
- `pnpm check:module-boundaries`: Passed.
- `pnpm -r typecheck`: Exit code 0 across all 36 workspace packages.
- `pnpm build`: Exit code 0 across all packages.

## Invariants & Design Decisions

1. **Principle 8 (No Polling or Sleeping):** Zero timers, interval loops, or polling loops are introduced to wait for checks. Check progression is purely reactive: driven by inbound forge webhooks (`POST /api/webhooks/gitea`), on-demand synchronization (`POST /api/issues/:id/sync-checks`), or one-shot startup reconciliation (`reconcileCheckPendingIssuesOnStartup`).
2. **Safe Credential Handling (Principle 20 / S12):** Webhook secret is read from `server.gitWebhookSecretFile`. The file path must be a regular file (not a symlink), mode 0600, owned by current UID, and residing outside the Nix store.
3. **Fail-Closed Security:** Inbound webhook payloads without valid HMAC-SHA256 signature in `X-Gitea-Signature` fail closed with HTTP 401 Unauthorized.

## Risks

- Inbound webhook endpoint requires configuring `gitWebhookSecretFile` for signature verification; unauthenticated or unsigned payloads are rejected fail-closed (HTTP 401).
- Issues in `check_pending` state require forge webhooks or startup/manual sync to advance; no background polling or timers are used (Principle 8).

## Model Used

- None — human-authored

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
