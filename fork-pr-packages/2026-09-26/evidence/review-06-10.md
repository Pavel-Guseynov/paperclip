# Changes 06–10: upstream readiness source review

Date: 2026-09-26. Reviewer: audit_workflow subagent.

This is a read-only source review. No production source, branch, or remote was
modified. No test, build, typecheck, or runtime reproduction was executed by this
reviewer. Concerns below are distinguished from demonstrated test outcomes.
Historical counts in the registry are not current verification evidence.

## Authority and inspected state

Read the operator request attachment, the registry contract at
`/Users/pavelguseynov/paperclip/docs/paperclip-fork/README.md`, the registry JSON,
and records 06–10. Read current upstream `CONTRIBUTING.md` and the PR template
through ref-qualified Git inspection. Production and test source inspection
used branch-qualified Git reads because another agent controls the checkout.

Inspected upstream master: `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a`.
Current stable tag: `v2026.916.1`, commit
`d554c4789ed3930f8a53ac9fdf6503b3187097da`.
Each SHA in the following table was copied from `git rev-parse` output.
Contribution and stable heads matched their corresponding `origin/*` refs at
inspection. This is a local remote-tracking comparison, not a separate live
remote API query.

| Change | Contribution branch | Contribution head | Stable branch | Stable head |
| --- | --- | --- | --- | --- |
| 06 | `fix/approval-stage-return-assignee` | `3c858b6212b46907e0b5a70ba088c5ad772ad4a6` | `stable/v2026.916.0/fix/approval-stage-return-assignee` | `1c4a685f8e612229153d1249647a85c29a3f0d9a` |
| 07 | `fix/retry-skipped-review-handoff` | `4a6ce422dd655ceb80d2c38e71e7110556369e9a` | `stable/v2026.916.0/fix/retry-skipped-review-handoff` | `726fc47213895e6dc76e42045cebf0a5205530bc` |
| 08 | `fix/workspace-validation-recovery-precedence` | `d9ea1f97aa2a00f540e254ce3ae86cc502c192dc` | `stable/v2026.916.0/fix/workspace-validation-recovery-precedence` | `ccbf3a33b00fcc15c5393ecde10864fd000eb7b0` |
| 09 | `feat/verified-terminal-delivery-evidence` | `fd793881526ae41433115a2c28436c9671bad6f7` | `stable/v2026.916.0/feat/verified-terminal-delivery-evidence` | `cfe4b837e367da696c3163272207129171533da4` |
| 10 | `feat/revision-keyed-review-admission` | `bfd3092312d890c4f328ad9b90bda0329e41d02a` | `stable/v2026.916.0/feat/revision-keyed-review-admission` | `f4c410b8e0fcc16785022448957d9945f74c626e` |

The coordinating agent additionally reports merge-tree conflicts against current
upstream in Change 08's `server/src/services/legacy-execution-recovery.test.ts`
and Change 10's `packages/shared/src/index.ts`. The coordinating agent reports
that all stable branches already contain `v2026.916.1`. These are coordinating
agent findings, not independently rerun by this reviewer.

File inventories below describe each original contribution delta from its merge
base with inspected upstream. They are not final, post-sync PR inventories.
Change 10 additionally distinguishes its increment over Change 09. The final
package must regenerate inventories after upstream merges and fixes.

## Overall assessment

| Change | Assessment at inspected head | Main remaining item |
| --- | --- | --- |
| 06 | Blocked | Recorded concurrency acceptance proof and current-head gates absent |
| 07 | Blocked | Cross-attempt concurrency concern, migration collision and current-head gates |
| 08 | Blocked | Specific recovery causes suppressed by broad kind guard; upstream merge conflict |
| 09 | Blocked; operator coordination needed | Malformed provider response can pass; required-check and native-status outcome gaps; overlap with open PR |
| 10 | Blocked | Bookkeeping does not enforce the recorded admission outcome; dependency and merge conflict |

No retirement was established. No regression was executed on a released
upstream version. None of the branch-specific helper names or evidence/admission
schema surfaced in the inspected upstream paths searched, but absence of names
alone is not proof that no semantic equivalent exists.

Upstream contribution rules prefer helping related open PRs, require the current
template and meaningful verification, and call for maintainer discussion before
substantial core feature work. No such discussion was established for Changes
09 or 10. No upstream messages or PRs were created.

## Change 06 — approval return assignee

### Source findings

No new concrete sequential-transition defect was found. The branch preserves
independent approval participants first, selects the return assignee only when
the exclusion leaves no approval participant, and shares consecutive-stage
traversal between entry and approval. It retains upstream's forward-only stage
traversal after policy edits.

The registry requires exactly one selection or skip under concurrency. This
diff changes pure transition logic operating on a previously read execution
state; it does not add persistence concurrency control. The registry itself
records that the former concurrency test was removed as insufficient. Existing
transition and route tests cannot be represented as proof of this criterion.

Recommended regression, not executed: concurrent approval PATCH requests
through real persistence, asserting one decision and one resulting transition.
Whether the concurrency outcome belongs in this focused fix or requires an
explicit scope decision remains unresolved; do not silently waive acceptance.

### Upstream status

- https://github.com/paperclipai/paperclip/issues/4912 was retrieved and shown
  open. It describes the missing auto-skip loop in stage advancement.
- https://github.com/paperclipai/paperclip/pull/5951 could not be retrieved; the
  web tool returned a cache-miss error. Its current status is unverified. The
  registry's earlier inspection calls it a one-line partial overlap, not the
  complete outcome.
- No released equivalent or retirement proof was established.

### Diff files and purpose

| File | Rationale |
| --- | --- |
| `server/src/services/issue-execution-policy.ts` | Participant selection and consecutive-stage traversal |
| `server/src/__tests__/issue-execution-policy.test.ts` | Sequential identity, skip and invalid-configuration behavior |
| `server/src/__tests__/issue-execution-policy-routes.test.ts` | Public PATCH results and per-case route mock isolation |

Dependencies: none declared. Stable behavior still needs reconciliation with
the registry's recorded security backport item; this reviewer did not apply it.

## Change 07 — skipped review handoff

### Source findings and unexecuted concurrency concern

The durable index protects one attempt key, not one issue/stage handoff.
`reconcileReviewHandoffAfterBlockerClear` in
`server/src/services/recovery/review-handoff-retry.ts` reads active run, queued
wake and attempt count independently through `Promise.all`, without a shared
transactional claim. A permitted interleaving is:

1. Caller B reads no active or queued handoff.
2. Caller A persists attempt 1.
3. Caller B reads attempt count 1.
4. Caller B persists attempt 2; its different key passes the unique index.

This is a code-supported concurrency concern, not an executed failing test.
The existing test at `heartbeat-review-handoff-retry.test.ts:366` launches three
ordinary promises and substitutes a wake-row writer. It demonstrates same-key
coalescing in that schedule, not the interleaving above or actual dispatch.

Recommended regression, not executed: controlled ordering on separate database
connections, with active/queued reads preceding another caller's insert and
the attempt read following it. Assert one durable handoff and one eventual
review invocation. At least one concurrency case should exercise real heartbeat
admission rather than only a supplied insert callback.

Additional unverified concern: keys and budget identity include issue, stage and
attempt but no review round or revision. Later legitimate rounds reusing the
stage inherit previous consumption. A two-round test should establish intended
semantics before changing this.

### Migration and upstream overlap

`0284_rapid_prowler.sql` conflicts with Change 09's separate migration number,
snapshot and journal addition. Inspected upstream ends at
`0283_jittery_psynapse.sql`; each individual branch is next-numbered, but both
cannot merge unchanged. The index's transactional safety exception states a
reason, but a partial-index predicate does not remove index-build table scan
and write-lock operational risk.

- https://github.com/paperclipai/paperclip/issues/13532 was retrieved and shown
  open. It distinguishes a skipped lease-blocked review wake from adjacent
  restart recovery.
- https://github.com/paperclipai/paperclip/pull/13515 is the adjacent merged
  lease-recovery work referenced by that issue; the registry already includes
  it in the base.
- https://github.com/paperclipai/paperclip/pull/14028 is merged at
  `5b09d661831f0b2d265c696496a9528f9629bb7d`, as read from local upstream history
  and resolved with `git rev-parse`. Its diff queues drain-time wakes and retries
  interrupted corrective disposition runs. It does not add this branch's
  missing-review-participant retry path. Preserve both outcomes when syncing.
- No retirement proof was established.

### Diff files and purpose

| File | Rationale |
| --- | --- |
| `packages/db/src/schema/agent_wakeup_requests.ts` | Partial unique review retry index |
| `packages/db/src/migrations/0284_rapid_prowler.sql` | Creates that index |
| `packages/db/src/migrations/meta/0284_snapshot.json` | Generated schema state |
| `packages/db/src/migrations/meta/_journal.json` | Migration registration |
| `server/src/services/recovery/review-handoff-retry.ts` | Retry decisions, receipts, budget and escalation |
| `server/src/services/recovery/review-handoff-retry.test.ts` | Pure retry policy tests |
| `server/src/services/recovery/service.ts` | Reconciliation and dependency-clear entry points |
| `server/src/routes/issues.ts` | Awaited handoff reconciliation after blocker resolution |
| `server/src/__tests__/heartbeat-review-handoff-retry.test.ts` | Persistence, lifecycle, restart, refusal and coalescing cases |

Dependencies: none declared, but merge ordering with Change 09 requires a
regenerated migration. Recorded stable backports were not applied here.

## Change 08 — workspace recovery precedence

### Concrete source defect; regression not executed

At the inspected head, `server/src/services/issue-recovery-actions.ts:345–351`
classifies a write as a generic sweep whenever
`input.kind === "stranded_assigned_issue"`, even when `input.cause` is a
specific new failure. `strandedRecoveryActionKind` in
`server/src/services/recovery/service.ts:2363–2372` returns that kind for
`provider_quota`, `process_lost` and other specific causes. An existing
workspace-validation action therefore causes the early return to discard the
specific new failure, even if the caller explicitly asks for supersession.
This contradicts the comment promising that later failures naming their own
cause remain eligible.

The existing test named “still supersedes … a later failure that names its own
cause” uses `kind: "configuration_validation"`, so it does not exercise the
faulty broad-kind shortcut.

Small fix candidate: identify generic writes by generic cause rather than broad
recovery kind. Recommended regression, not executed: create an active workspace
validation action; upsert `kind: "stranded_assigned_issue"` with a new fingerprint,
specific `provider_quota` or `process_lost` cause, and
`supersedeOnIdentityChange: true`; assert the new action, its evidence, and
resolution of the prior action. Retain generic-sweep preservation coverage.

The real-Git tests inspect detached HEAD, unique commits and dirty workspace
preservation. The exact-commit recovery test manually performs the Git recovery;
it does not by itself execute the whole product reissue flow.

### Upstream status

Related issues were retrieved:

- https://github.com/paperclipai/paperclip/issues/7398 concerns reviewer
  independence and recovery reassignment; shown open.
- https://github.com/paperclipai/paperclip/issues/8767 concerns stranded
  classification of review-gated continuations.
- https://github.com/paperclipai/paperclip/issues/10497 concerns persistence of
  workspace preferences and later validation failures.

These are adjacent, broader outcomes. Use `Refs` rather than claim this
diagnostic-precedence change fully closes them. No exact replacement or
retirement proof was found. The coordinator reports a current-upstream merge
conflict in `server/src/services/legacy-execution-recovery.test.ts`.

### Diff files and purpose

| File | Rationale |
| --- | --- |
| `server/src/services/heartbeat.ts` | Unwrap typed workspace-validation failures through causes |
| `server/src/services/issue-recovery-actions.ts` | Preserve diagnosis and merge partial validation evidence |
| `server/src/services/recovery/service.ts` | Causal precedence and review-participant escalation |
| `server/src/services/recovery/stranded-notice.ts` | Specific operator guidance |
| `server/src/__tests__/workspace-validation-recovery-precedence.test.ts` | Real Git, durable actions and review/approval cases |
| `server/src/services/legacy-execution-recovery.test.ts` | Preserve exhausted workspace-validation holds |
| `server/src/services/recovery/stranded-notice.test.ts` | Guidance for combined workspace/participant blockers |

Dependencies: none declared. Recorded stable backports were not applied here.

## Change 09 — verified terminal evidence

### Concrete source defect: malformed responses can pass

`createGitHubDeliveryClient.getChecks` in
`server/src/services/delivery-verification.ts:512–521` converts invalid JSON or
absent `check_runs`/`statuses` into empty entries with `expected = null` and
`complete = true`. If the other endpoint returns one success, aggregate
verification can succeed despite the missing evidence source.

Recommended regression, not executed: `/check-runs` returns `{}` or invalid
JSON with HTTP 200 while `/status` returns one successful status. Expect a
stable verification error and no terminal write. Exercise the symmetric bad
status response too. Provider payload validation must fail closed.

### Required outcome gaps observed in source

- Required checks are not discovered. The implementation only reads existing
  `/check-runs` and `/status` entries. It never queries configured required
  contexts or rules. A required check which never reports cannot be detected
  when an unrelated check succeeds. Optional failed checks also block closing.
  Thus “all reported checks pass” differs from the record's required-check
  contract. Recommended regression: a required context absent from reported
  runs/statuses while an optional check passes; terminal completion must fail.
- Native status authority directly writes `done` without evidence verification.
  The branch's documentation explicitly exempts this path. It does not meet the
  record's universal code-task completion invariant. Correct integration must
  happen in the arbiter decision path; adding a permanent finalizer refusal
  would not resolve the recorded retry-loop concern.
- The implementation supports github.com only and explicitly rejects Gitea and
  GitHub Enterprise. This avoids the stable line's ambient credential risk, but
  the record requires a provider-neutral service and Gitea fixtures. This scope
  difference must be resolved explicitly, not silently marked complete.

The issue-row-locked binding recheck rereads workspace and work-product rows.
Its promised protection against concurrent target changes additionally depends
on those mutation paths using compatible locks. This reviewer did not establish
that locking contract; this remains unverified, not a proven race.

### Tests and upstream overlap

`delivery-verification.test.ts` has actual provider request assertions and real
persistence. It includes company-scoped credentials, host pinning, provider
head comparison, pagination and stale binding cases. The malformed check payload
and absent required-context regressions above are absent. No tests were run here.

- https://github.com/paperclipai/paperclip/pull/11196 was retrieved and shown
  open. It provides the initial opt-in evidence predicate. The branch preserves
  its original two commits, as the registry states.
- https://github.com/paperclipai/paperclip/issues/11145 is the recorded related
  issue; this reviewer did not independently verify its live status.
- Upstream CONTRIBUTING prefers helping existing PRs. Recommend operator
  coordination to fold into that work or explain a credited successor with the
  expanded provider-verification scope. No upstream communication occurred.
- No retirement proof was established.

Migration `0284_keen_mac_gargan.sql` collides with Change 07's next migration.

### Diff files and purpose

| File | Rationale |
| --- | --- |
| `doc/execution-semantics.md` | Evidence contract, supported provider and native exemption |
| `packages/db/src/schema/issue_execution_decisions.ts` | Persisted evidence column type |
| `packages/db/src/migrations/0284_keen_mac_gargan.sql` | Adds evidence column |
| `packages/db/src/migrations/meta/0284_snapshot.json` | Generated schema state |
| `packages/db/src/migrations/meta/_journal.json` | Migration registration |
| `packages/shared/src/types/issue.ts` | Claim and verified receipt contracts |
| `packages/shared/src/types/index.ts` | Type exports |
| `packages/shared/src/index.ts` | Public exports |
| `packages/shared/src/validators/issue.ts` | Evidence request and policy validation |
| `packages/shared/src/validators/index.ts` | Validator export |
| `server/src/services/delivery-verification.ts` | Repository binding, scoped credentials and provider verification |
| `server/src/services/issue-execution-policy.ts` | Evidence requirement and terminal-transition protection |
| `server/src/routes/issues.ts` | Provider checks, binding recheck and evidence persistence |
| `server/src/services/execution-workspaces.ts` | Declares system evidence provenance |
| `server/src/services/recovery/service.ts` | Declares system evidence provenance |
| `server/src/services/issue-thread-interactions.ts` | Refuses evidence-free review-card completion |
| `server/src/__tests__/delivery-verification.test.ts` | Provider, credential, binding and receipt cases |
| `server/src/__tests__/issue-execution-policy.test.ts` | Evidence-required transition cases |
| `server/src/__tests__/issue-execution-policy-routes.test.ts` | Public completion and bypass cases |
| `server/src/__tests__/native-status-arbiter-corpus.test.ts` | Review-card refusal and rollback cases |

Dependencies: none declared; Change 10 depends on this change. The stable line's
recorded credential-security repair and other backports were not applied here.

## Change 10 — revision-keyed admission

### Recorded outcome is not implemented

The code records review bookkeeping rather than admission control:

- `server/src/services/review-admission.ts:106–112` explicitly permits review
  launch without revision identity and says the service records rather than
  gates.
- `server/src/services/native-runtime/status-decision-committer.ts:614–648`
  creates the interaction first, calls `admitReview`, ignores its returned
  `admitted`/`created` fields, and catches admission errors so launch continues.
- A completed identity admits another round rather than returning its immutable
  decision. This differs from the registry's repeated-request contract.
- No provider preflight denial before invocation or admission-owned recovery of
  an interrupted launch exists.
- Admissions are read for decision bookkeeping, but no production consumer uses
  them to determine whether to launch the review.

The concurrency test proves one ledger row for the same identity; it does not
prove one actual review invocation. A savepoint test explicitly establishes
that bookkeeping failure does not prevent launch, the opposite of durable
admission-before-external-work acceptance.

Additional source concern: reusing an active admission retains its original
`reviewInteractionId`. If a repeated launch creates a new interaction, the
caller ignores the reused admission and decision bookkeeping for the new
interaction finds no row. Recommended regression, not executed: repeat the
public review launch for the same revision, assert the same interaction and
one invocation, then verify its immutable decision is retained on repetition.

Fixing or explicitly rescoping these semantics requires a product decision;
renaming the change to match bookkeeping does not satisfy the supplied record.

### Upstream and dependencies

- https://github.com/paperclipai/paperclip/issues/11390 was retrieved through
  search and describes broader workflow orchestration requirements.
- https://github.com/paperclipai/paperclip/issues/10550 is a recorded prior
  discussion; live status was not independently verified here.
- https://github.com/paperclipai/paperclip/pull/13717 is present in upstream at
  `8813a501058b29ae293fee7e94038a737d7d1594`, resolved with `git rev-parse`.
  Its GitHub review tooling supersedes the typed PR-read/review-submit portion;
  the branch removed its unreachable duplicates. This does not establish an
  equivalent revision-admission outcome or permit retirement.
- The contribution contains Change 09. Open after that dependency is accepted,
  or explicitly review a stack. The diff against master is not independent.
- The coordinator reports a current-upstream conflict in
  `packages/shared/src/index.ts`.

### Incremental files and purpose

The full diff against upstream includes Change 09's complete inventory above.
These files are added or further changed by Change 10 relative to Change 09:

| File | Rationale |
| --- | --- |
| `packages/db/src/schema/review_admissions.ts` | Admission ledger and uniqueness |
| `packages/db/src/schema/index.ts` | Schema export |
| `packages/db/src/migrations/0285_massive_wonder_man.sql` | Admission table and constraints |
| `packages/db/src/migrations/meta/0285_snapshot.json` | Generated schema state |
| `packages/db/src/migrations/meta/_journal.json` | Migration registration |
| `packages/shared/src/types/review-admission.ts` | Admission and decision contracts |
| `packages/shared/src/types/index.ts` | Type exports |
| `packages/shared/src/index.ts` | Public exports |
| `server/src/services/review-admission.ts` | Digest, ledger insert and decision methods |
| `server/src/services/delivery-verification.ts` | Resolve recorded reviewed head SHA |
| `server/src/services/native-runtime/status-decision-committer.ts` | Best-effort ledger write after review creation |
| `server/src/services/issue-thread-interactions.ts` | Review-card decision bookkeeping |
| `server/src/__tests__/review-admission.test.ts` | Digest, uniqueness, company scope and decision cases |
| `server/src/__tests__/native-status-arbiter-corpus.test.ts` | Production bookkeeping and savepoint behavior |
| `doc/execution-semantics.md` | Explicitly documents non-gating semantics |

## Evidence limits and next use

This artifact records source inspection, fetched-web observations and separately
attributed coordinator findings. It contains no new fail-on-base/pass-on-head
results. All five current-head gate runs, stable-line touched tests, full
regressions after upstream synchronization, final diff inventories and release
retirement proofs remain unverified by this reviewer.

Use this artifact as input to fixes and the eventual package branch. Do not
check template assertions about passing gates, readiness, Greptile scores or
retirement on the strength of this source audit.
