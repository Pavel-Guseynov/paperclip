# fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures

| Field | Value |
| --- | --- |
| Branch | `pr/08-workspace-validation-recovery-precedence` |
| Head | `ff4781f721aedf9669426c22c4ef7cd1677cc37b` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/workspace-validation-recovery-precedence.test.ts` | +858 | -0 |
| `server/src/services/heartbeat.ts` | +28 | -10 |
| `server/src/services/issue-recovery-actions.ts` | +64 | -6 |
| `server/src/services/recovery/service.ts` | +60 | -7 |
| `server/src/services/recovery/stranded-notice.test.ts` | +37 | -0 |
| `server/src/services/recovery/stranded-notice.ts` | +27 | -0 |

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

Head `ff4781f721aedf9669426c22c4ef7cd1677cc37b`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/workspace-validation-recovery-precedence.test.ts, server/src/services/recovery/stranded-notice.test.ts) were run against the base's production code. 10 tests fail there. The cause becomes `stranded_assigned_issue` or `execution_review_participant_recovery` instead of `workspace_validation_failed`, and a wrapped failure is recorded as `adapter_failed`. On the head the same run gives: 36 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: a stranded issue whose latest run failed workspace validation now shows `workspace_validation_failed` instead of a generic stranded cause.

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

- Provider and model: Anthropic Claude, used through Claude Code (an agentic coding CLI).
- Capabilities used: tool use (shell, file reads and edits), code execution, extended reasoning, and a subagent for the duplicate search.
- The commit trailers carry the Claude attribution. The person who opens this pull request adds the exact model ID and context window here.

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [ ] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [ ] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [ ] I have run tests locally and they pass
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [ ] I will address all Greptile and reviewer comments before requesting merge
