# fix(server): retry a skipped review handoff after its blocker clears

| Field | Value |
| --- | --- |
| Branch | `pr/07-retry-skipped-review-handoff` |
| Head | `787ebba3b4edc8c33bbb3888db8960e515617674` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(server): retry a skipped review handoff after its blocker clears` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `packages/db/src/migrations/0294_luxuriant_thena.sql` | +2 | -0 |
| `packages/db/src/migrations/meta/{0289_snapshot.json => 0294_snapshot.json}` | +- | -- |
| `packages/db/src/migrations/meta/_journal.json` | +- | -- |
| `packages/db/src/schema/agent_wakeup_requests.ts` | +7 | -0 |
| `server/src/__tests__/heartbeat-review-handoff-retry.test.ts` | +1238 | -0 |
| `server/src/routes/issues.ts` | +22 | -27 |
| `server/src/services/recovery/review-handoff-retry.test.ts` | +296 | -0 |
| `server/src/services/recovery/review-handoff-retry.ts` | +713 | -0 |
| `server/src/services/recovery/service.ts` | +88 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - When an implementer hands an issue to review, Paperclip wakes the reviewer or approver.
> - If an execution blocker is still recorded at that moment, for example the previous run has not released its environment lease, or a recovery action is unresolved, the wake is skipped.
> - That skip was terminal: the issue stayed `in_review` with no run, no retry, and no escalation.
> - This pull request records the owed handoff and retries it once the blocker clears, with escalation when the retries run out.
> - The benefit is that a review handoff no longer stalls silently.

## Linked Issues or Issue Description

Fixes #13532. The stranded sweep retries the handoff once the environment lease of #13532 is released; a test holds a lease, checks that no wake starts, releases it, and checks the one retried wake.

Related open pull request: #13880 fixes the same stall with a periodic pass in `resumeQueuedRuns` that re-admits skipped handoff wakes once the lease clears. It does not reference #13532. The two pull requests compete; maintainers merge one. This pull request reacts where the blocker clears (recovery-action resolve, a resolved blocker issue, and the stranded sweep), keeps a durable retry ledger with a database idempotency index, and escalates to the board after the last attempt. If #13880 merges first, this pull request should fold its escalation and its idempotency index into #13880. Otherwise this pull request supersedes #13880. #13769, #13150, #13332, and #14156 touch other parked-wake cases.

## What Changed

- A durable review-handoff retry: once no blocker remains, Paperclip enqueues one reviewer or approver wake for the pending stage, under an idempotency key per issue, stage, and attempt. After three attempts it escalates to the board with one actionable blocker. When the board closes that escalation, a new budget of three attempts starts.
- The owed handoff is reconciled before the recovery-action resolve response returns, when a resolved blocker issue releases its `in_review` dependents, and when the stranded sweep finds a review participant with no run. The sweep covers a blocker that clears without an event, such as a released environment lease.
- Migration `0294` adds a partial unique index on `agent_wakeup_requests (company_id, idempotency_key)` for `review-handoff:%` keys, so concurrent retries for the same key coalesce. It follows upstream's rolling snapshot window, so `0289_snapshot.json` moves to `0294_snapshot.json`.
- Tests on PostgreSQL drive the routes and the recovery service: one handoff after a stale blocker clears, a held and then released environment lease, a rejected second retry, coalesced concurrent triggers, a lost enqueue race, a restarted instance, escalation after the last attempt, a new budget after the board closes the escalation, every dependent of a cleared blocker, and reconciliation before the resolve response.

## Verification

Head `787ebba3b4edc8c33bbb3888db8960e515617674`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/heartbeat-review-handoff-retry.test.ts (the new retry module kept, the route and recovery-service wiring of master)) were run against the base's production code. 7 tests fail there. No handoff is enqueued after the blocker clears or the environment lease is released (`0` instead of `1`), and no escalation is created after the last attempt. On the head the same run gives: 28 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Migration: the index is created without `CONCURRENTLY`, because Drizzle migrations run in a transaction. The new key namespace has no existing rows, but the build scans `agent_wakeup_requests` once and takes a write lock for that time.
- With the retry module in place but the route and recovery-service wiring of master, seven of the route and sweep tests fail, so every reconciliation point is needed by a test.

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
