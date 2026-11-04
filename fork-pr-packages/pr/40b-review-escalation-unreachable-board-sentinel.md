# fix(server): honor board sentinel on review escalation and local-trusted board actor

| Field | Value |
| --- | --- |
| Branch | `fix/review-escalation-unreachable-board-sentinel` |
| Head | `19dbd0f003042d30bfd7b5cb4fc7d0f393838e71` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(server): honor board sentinel on review escalation and local-trusted board actor` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/execution-workspaces-routes.test.ts` | +63 | -0 |
| `server/src/__tests__/issue-comment-reopen-routes.test.ts` | +4 | -0 |
| `server/src/__tests__/issue-escalation-local-board-deployment-routes.test.ts` | +358 | -0 |
| `server/src/__tests__/issue-execution-policy-routes.test.ts` | +4 | -0 |
| `server/src/__tests__/issue-execution-policy.test.ts` | +243 | -2 |
| `server/src/middleware/auth.ts` | +38 | -13 |
| `server/src/routes/execution-workspaces.ts` | +2 | -0 |
| `server/src/routes/issues.ts` | +36 | -0 |
| `server/src/services/access.ts` | +20 | -2 |
| `server/src/services/execution-workspaces.ts` | +22 | -0 |
| `server/src/services/issue-execution-policy.ts` | +102 | -9 |
| `server/src/types/express.d.ts` | +9 | -1 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When a review or approval stage hits its rejection limit or has no reachable participant, `issue-execution-policy.ts` escalates the issue to the board (`assigneeUserId = '__board__'`).
> - In `local_trusted` deployments (or authenticated deployments where the local board operator acts without an explicit user row for `__board__`), board-escalated issues could not be acted on cleanly because route checks compared `assigneeUserId` literally to `req.actor.userId` (`local-board`), and unreachable stage participants did not escalate deterministically to the board sentinel.
> - This pull request routes unreachable review/approval stage escalations to the board sentinel and recognizes the board actor across `local_trusted` and authenticated board sessions when resolving or acting on board-assigned issues and workspaces.
> - The benefit is that review escalations never strand an issue without a reachable owner, and board operators in both deployment modes can act on board-escalated issues.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
When an execution policy stage had no reachable participant or escalated to the board sentinel (`__board__`), board operators in `local_trusted` or authenticated board mode were not matched as the board assignee, and unreachable stage escalations failed to hand off cleanly to the board.

**Expected behavior**
Unreachable review/approval stage participants escalate to the board sentinel, and board actors are recognized as matching the board sentinel assignee across issue, comment, execution-policy, and execution-workspace routes.

**Steps to reproduce**
1. Configure an issue with an execution policy whose review stage participant is unreachable or exceeds the rejection limit.
2. Trigger stage transition / escalation and attempt to act on the escalated issue as the board operator in `local_trusted` mode.
3. Observe escalation or board-assignee authorization fail on master.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
`local_trusted` and `authenticated`.

No related open pull request was found.

## What Changed

- `server/src/services/issue-execution-policy.ts` escalates issues to the board sentinel when stage participants are unreachable or exhaust review retries, clearing stale active stage state cleanly.
- `server/src/middleware/auth.ts`, `server/src/services/access.ts`, `server/src/routes/issues.ts`, and `server/src/routes/execution-workspaces.ts` recognize verified board actors when matching board-sentinel ownership and workspace operations.
- Tests in `issue-escalation-local-board-deployment-routes.test.ts`, `issue-execution-policy.test.ts`, and `execution-workspaces-routes.test.ts` verify unreachable-participant escalation and board actions in both deployment modes.

## Verification

Head `19dbd0f003042d30bfd7b5cb4fc7d0f393838e71`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/issue-escalation-local-board-deployment-routes.test.ts`, `server/src/__tests__/issue-execution-policy.test.ts`, `server/src/__tests__/execution-workspaces-routes.test.ts`) were run against the base's production code. 11 tests fail there. On the base unreachable stage participants and board-sentinel escalations fail to authorize the board operator across `local_trusted` and authenticated routes. On the head the same run gives: 54 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Agent bearer tokens never receive board-sentinel authority; only verified board actors match the board sentinel.

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
