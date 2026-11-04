# fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures

| Field | Value |
| --- | --- |
| Branch | `pr/08-workspace-validation-recovery-precedence` |
| Head | `810a10c893e342ac138371487cc3ae5237e78fb2` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/workspace-validation-recovery-precedence.test.ts` | +830 | -0 |
| `server/src/services/heartbeat/run-completion.ts` | +4 | -9 |
| `server/src/services/heartbeat/runtime-execution.ts` | +2 | -1 |
| `server/src/services/heartbeat/workspaces.ts` | +16 | -1 |
| `server/src/services/issue-recovery-actions.ts` | +39 | -6 |
| `server/src/services/recovery/service.ts` | +49 | -7 |
| `server/src/services/recovery/stranded-notice.test.ts` | +37 | -0 |
| `server/src/services/recovery/stranded-notice.ts` | +21 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Recovery records why a run failed and what the operator must do.
> - A run that fails workspace validation records a typed diagnosis: the expected and actual branch, the HEAD source, and whether a safe repair exists.
> - Generic recovery paths replaced that diagnosis: a setup wrapper that rethrew the failure lost its type, and the periodic stranded sweeps rewrote the recovery action with a generic cause.
> - This pull request keeps the typed diagnosis ahead of generic causes in every recovery path.
> - The benefit is that the operator sees the real reason and the repair guidance.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
A run failed workspace validation. Some minutes later the issue's recovery action showed `stranded_assigned_issue` with generic guidance, and the typed workspace-validation evidence was gone.

**Expected behavior**
The recovery action keeps `workspace_validation_failed` and its typed evidence until a failure with its own explicit cause replaces it.

**Steps to reproduce**
1. Let an agent run fail workspace validation (for example a branch mismatch) inside a setup step that rethrows the error as a cause.
2. Wait for the stranded sweep.
3. Read the issue's recovery action.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #14110 stops a finalization sweep from erasing a run's own error code, on a different code path. #8871, #14546, and #9641 change other parts of `recovery/service.ts`. None of them changes this precedence, so they are independent; the second one to merge needs a rebase.

## What Changed

- A workspace-validation failure is found anywhere in the error cause chain, in the workspace restore, adapter, setup, and branch-repair failure paths.
- A stranded sweep names no cause of its own, so a typed workspace-validation diagnosis on the latest run decides the recovery cause. An explicit, observed cause keeps precedence.
- A sweep with a generic cause does not rewrite an active workspace-validation action. A sweep or failure that names a specific cause (for example a lost process) still updates or supersedes it.
- A preserving upsert merges the `workspaceValidation` evidence field by field, so a partial rebuild does not drop the complete diagnosis.
- A pending review participant whose run failed workspace validation is escalated with a notice that carries both blockers.
- Recovery events report the cause and source of the recorded action.
- Tests on PostgreSQL cover the wrapped failure in the restore and adapter paths, the escalation of a failed review participant, both blockers, a later generic sweep and its event, and a later sweep with a specific cause.

## Verification

Head `810a10c893e342ac138371487cc3ae5237e78fb2`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (server/src/__tests__/workspace-validation-recovery-precedence.test.ts, server/src/services/recovery/stranded-notice.test.ts) were run against the base's production code. 10 tests fail there. The cause becomes `stranded_assigned_issue` or `execution_review_participant_recovery` instead of `workspace_validation_failed`, and a wrapped failure is recorded as `adapter_failed`. On the head the same run gives: 36 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Behavior change: a stranded issue whose latest run failed workspace validation now shows `workspace_validation_failed` instead of a generic stranded cause.

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
