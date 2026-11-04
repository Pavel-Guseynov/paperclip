# fix(issues): deduplicate owner notifications when re-entering blocked with an unchanged self-owned unblockDescriptor

| Field | Value |
| --- | --- |
| Branch | `fix/unchanged-unblock-descriptor-deduplication` |
| Head | `3bb66e546ef335556a536abfb74e608a6ee91f2b` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(issues): deduplicate owner notifications when re-entering blocked with an unchanged self-owned unblockDescriptor` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/issues-service.test.ts` | +78 | -0 |
| `server/src/services/issues.ts` | +19 | -12 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When an agent blocks its own task with a self-owned `unblockDescriptor`, Paperclip records a blocked notification episode (`blockedTransitionAt`, `blockedOwnerNotifiedAt`) and notifies the owner once.
> - When that agent wakes up (for example on a checkout that temporarily moves the issue to `in_progress`) and finishes its turn still blocked for the exact same reason, it patches `status = 'blocked'` with the same self-owned `unblockDescriptor`.
> - Previously, `issueService.update` treated that `in_progress -> blocked` transition as a brand-new blocked episode, resetting `blockedTransitionAt` and clearing `blockedOwnerNotifiedAt`, which fired another owner notification wake and created an infinite self-wake loop.
> - This pull request compares the incoming self-owned `unblockDescriptor` (by `owner` and `action`, independent of JSON key order) against the persisted episode preserved across checkout: when unchanged, it retains `blockedTransitionAt` and `blockedOwnerNotifiedAt` so no duplicate owner wake is enqueued; when changed, it opens a fresh episode and notifies once.
> - The benefit is that agents re-recording the same self-owned blocker after a checkout turn do not trigger redundant wakeup loops.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
An agent checked out its blocked issue (moving it to `in_progress` while preserving `unblockDescriptor` and `blockedTransitionAt`), determined the blocker was still unresolved, and patched `status: "blocked"` with the identical self-owned `unblockDescriptor`. `issueService.update` reset `blockedTransitionAt` and cleared `blockedOwnerNotifiedAt`, enqueueing a duplicate `routable_blocked_owner` wakeup on every turn.

**Expected behavior**
Re-entering `blocked` with an unchanged self-owned `unblockDescriptor` preserves the existing `blockedTransitionAt` and `blockedOwnerNotifiedAt` episode so no duplicate owner notification is sent, while a changed `unblockDescriptor` or an undelivered notification still notifies once.

**Steps to reproduce**
1. Have an assigned agent transition its issue to `blocked` with a self-owned `unblockDescriptor` (`owner: { kind: "agent", agentId }`, `action: "await_dependency"`), delivering the initial owner notification.
2. Check out the issue as that agent (`in_progress`) and then patch `status: "blocked"` with the same `unblockDescriptor`.
3. Observe a second `routable_blocked_owner` wakeup enqueued for the same unchanged episode.

**Paperclip version or commit**
`paperclipai/paperclip` master `925965a09`.

**Deployment mode**
Any.

No related open pull request was found.

## What Changed

- `server/src/services/issues.ts` adds `isSameSelfOwnedUnblockDescriptor` (comparing `owner` and `action` independent of JSON property order) and preserves `blockedTransitionAt` and `blockedOwnerNotifiedAt` when an issue re-enters `blocked` with an unchanged self-owned `unblockDescriptor`.
- When the incoming `unblockDescriptor` changes `action` or `owner`, `issueService.update` starts a fresh episode (`blockedTransitionAt = now`, `blockedOwnerNotifiedAt = null`) and sends one owner notification.
- If the initial owner notification for the unchanged episode had not yet been recorded (`blockedOwnerNotifiedAt === null`), `notifyBlockedEpisodeOwner` still delivers it once.
- Tests in `server/src/__tests__/issues-service.test.ts` verify unchanged re-entry after checkout (including reordered keys), changed `action` re-notification, and undelivered-episode retry on PostgreSQL.

## Verification

Head `3bb66e546ef335556a536abfb74e608a6ee91f2b`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`server/src/__tests__/issues-service.test.ts`) were run against the base's production code. 1 test fails there. On the base `issueService.update` resets `blockedTransitionAt` and clears `blockedOwnerNotifiedAt` when re-entering `blocked` from `in_progress` with an unchanged self-owned `unblockDescriptor`, enqueueing a duplicate owner wake. On the head the same run gives: 45 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Only unchanged self-owned `unblockDescriptor` episodes preserve `blockedOwnerNotifiedAt`; any change to `owner` or `action` or any non-self-owned blocker still triggers a fresh owner notification.

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
