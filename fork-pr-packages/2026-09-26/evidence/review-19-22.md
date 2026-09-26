# Read-only review: Changes 19–22 and embedded PostgreSQL evidence

Review date: 2026-09-26. Reviewer responsibility: analysis only; no source edits,
branch switches, test runs, or upstream publication. This file is the only
artifact written by this reviewer. Other agents may advance the branches after
this snapshot. Findings below describe the exact reviewed heads, not an assertion
about a later repaired head.

## Authorities and scope

- User request: `/Users/pavelguseynov/.codex/attachments/65be05fe-4767-42e3-a6b3-f0f62df7a1b2/Pasted text.txt`.
- Registry: `/Users/pavelguseynov/paperclip/paperclip-fork.json`.
- Record contract: `/Users/pavelguseynov/paperclip/docs/paperclip-fork/README.md`.
- Change records: `19-stage-decision-keeps-calling-run.md`,
  `20-antigravity-conversation-continuation.md`,
  `21-shutdown-waits-for-adapter-run-stops.md`, and
  `22-release-cancelled-interrupted-run-leases.md` in that registry directory.
- Current upstream `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md` were
  inspected with ref-qualified `git show`. The parent owns the complete workflow
  and gate inventory. This reviewer did not independently inventory every gate.
- Registry and packaging files were read, never edited.

The user requires ordinary commits, fixed branch identities, current upstream
ancestry, genuine fail-on-base/pass-on-head evidence, full gates, stable/main
backports, and an operator-opened PR. This review does not certify those outcomes.

## Exact reviewed identities

Every SHA in this record was copied from `git rev-parse` output.

| Reference | Reviewed SHA |
| --- | --- |
| `upstream/master` | `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a` |
| Recorded contribution base | `efce9356b553a08f77a5877bb0ceac68d2cc4ad8` |
| `refs/upstream-tags/v2026.916.1` | `d554c4789ed3930f8a53ac9fdf6503b3187097da` |
| `fix/stage-decision-keeps-calling-run` | `7259b6efa64139d084236ea28b8738672979945f` |
| `stable/v2026.916.1/fix/stage-decision-keeps-calling-run` | `40d9dab4bff1d6166050c01764fcf785cdf6549a` |
| `fix/antigravity-conversation-continuation` | `f0f648ff8389a0d053d625fa651ecbac3e9546a0` |
| `stable/v2026.916.1/fix/antigravity-conversation-continuation` | `e1751a913e571f85316c65db63c4d965172bf3f5` |
| `fix/shutdown-waits-for-adapter-run-stops` | `d0d4996d466cc641130a56bd818e776280bf2f80` |
| `stable/v2026.916.1/fix/shutdown-waits-for-adapter-run-stops` | `a1396163b56de0e41f7ad0686bb2f368c139faa5` |
| `fix/release-cancelled-interrupted-run-leases` | `46e8948a8df775fa11e3d48e070a20188c91d61f` |
| `stable/v2026.916.1/fix/release-cancelled-interrupted-run-leases` | `b0c5236914c74a18f1c8819872d885599c1337ad` |

For each of the eight contribution/stable references, the corresponding
`origin/<reference>` resolved to the identical SHA at inspection time. This is a
remote-tracking-ref comparison, not a new network verification by this reviewer.

`git rev-list --left-right --count upstream/master...<contribution-branch>`
returned `11 1` for all four contribution branches: each lacked eleven upstream
commits and contained one contribution-only commit. File inventories below came
from `git diff upstream/master...<contribution-branch>` and therefore describe the
contribution delta from its merge base. They are not a claim that the branch
already contains current upstream.

| Change | Readiness at reviewed head | Principal reason |
| --- | --- | --- |
| 19 | Blocked | Unauthenticated run-header exemption; missing security regression proof and current-base gates. |
| 20 | Blocked | Generic capability needs contract cleanup and genuine cancellation/next-wake regressions. |
| 21 | Blocked | Shutdown admission race, configuration compatibility/validation defects, insufficient concurrency proof. |
| 22 | Blocked | False cleanup receipts, missing ownership protections, sweep starvation, undiagnosed in-process leak. |

No change was proven eligible for retirement. No regression or gate was run by
this reviewer. Claims in older registry records remain historical reports and
were not promoted to new verification evidence.

## Change 19: Stage decision preserves its calling run

### Changed files and roles

| File | Role |
| --- | --- |
| `server/src/routes/issues.ts` | Excludes a caller run during stage-decision reassignment and terminalization. |
| `server/src/__tests__/issue-execution-policy-routes.test.ts` | Adds four route regressions for response, cancellation exclusion, and participant wake behavior. |

### Concrete findings

1. **P1: the exclusion trusts an unauthenticated run claim.** At the reviewed
   head, `routes/issues.ts:13360` chooses `actor.runId` or
   `X-Paperclip-Run-Id`, without checking actor source. Authentication middleware
   copies the header into cloud-tenant, session, board-key, local-implicit, and
   agent-key actor contexts. A permitted stage-decision caller can name the
   active run and exempt it from reassignment/terminalization cancellation.
2. Removing only the explicit header fallback is insufficient: the middleware
   has already placed the unchecked value in `actor.runId`.
3. Signed agent JWT authentication already rejects a header that differs from
   the token's `run_id`. `getActorInfo` exposes `actorSource`, so the route has
   a native distinction available without inventing another authentication path.
4. The four added tests inject actor objects directly and do not set
   `source: "agent_jwt"`. They prove the route's present exclusion logic, not
   the signed-identity security contract. Fixtures also contain repeated large
   setup blocks and `as any` values.

### Minimal correction and missing proof

Restrict automatic caller exemption to authenticated run ownership. A narrow
implementation can require the signed agent-JWT source and validate the run's
company, agent, and issue relationship. If agent-key support is desired, its
ownership validation must be explicit; an arbitrary header alone is not proof.

Required behavioral cases include signed caller success, omitted JWT header,
different active run cancellation, ordinary reassignment cancellation, forged
headers from each non-JWT actor source, and mismatched run ownership. Actual
stage-decision persistence and the next participant's wake must remain intact.
Fail-on-base/pass-on-head proof was not generated in this audit.

### Upstream status and dependencies

Web searches for upstream stage-decision cancellation and calling-run exemption
did not locate a directly equivalent PR. This is limited search evidence, not an
exhaustive GitHub API deduplication result. No release equivalence was proved.
Source change is independent; route/test overlap with Changes 06, 07, and 10 is
expected. No upstream issue or PR was opened or messaged.

## Change 20: External-adapter conversation continuation

### Changed files and roles

| File | Role |
| --- | --- |
| `packages/adapter-utils/src/types.ts` | Adds `supportsConversationContinuation` to the public server-adapter contract. |
| `server/src/services/conversation-continuation.ts` | Makes classification and historical SQL predicates include capable registered adapters. |
| `server/src/__tests__/antigravity-conversation-continuation.test.ts` | Intended external-adapter continuation coverage; currently tied to fork-specific adapter naming. |

### Concrete findings

1. The production capability is generic and does not require Antigravity source.
   A ref-qualified search found no direct use of `CONVERSATION_ADAPTER_TYPES`
   outside its defining module, the new type comment, and the new test. Existing
   consumers use `isConversationAdapter`, so the lookup change reaches those
   call sites. The SQL historical predicate also uses the expanded type list.
2. The test file, suite, fixture names, and session examples are all
   `antigravity_local`/`agy` specific. A generic external-adapter capability PR
   should use a generic fixture; the permanent branch identity must stay fixed.
3. The acknowledged-cancellation test manufactures a cancelled run and its
   continuation marker. Failed/timed-out cases manufacture the marker too.
   Neither proves heartbeat finalization stamps the real outcome.
4. The session-reuse case calls `resolveNextSessionState` and reads back its own
   inserted `agentTaskSessions` row. It never dispatches a subsequent wake or
   verifies the session passed to the adapter.
5. Both registry lookups are wrapped in silent catch blocks. Inspection shows
   `listServerAdapters` simply reads map values and `findActiveServerAdapter`
   performs synchronous map lookups. No documented recoverable exception
   justifies swallowing errors and silently changing continuation eligibility.
6. The public type comment promises continuation across non-successful runs
   without documenting acknowledged cancellation and process/lease ownership
   preconditions. That overstates what safely opting in means.

### Current upstream integration concern

The diff from the recorded base to current upstream adds
`workspaceRestoreFailure === "restore_unsafe_archive"` rejection to
`hasConversationContinuationPolicy`, `runUsedConversationAdapter`, and the
historical recovery SQL. Preserve those guards when merging current upstream;
the reviewed contribution predates them.

### Minimal correction and missing proof

Keep the optional generic capability; remove silent registry catches; document
session reuse and verified stop/ownership requirements. Use typed generic
external-adapter fixtures. Exercise real interrupted, acknowledged-cancelled,
failed, and timed-out finalization; assert no recovery hold and inspect the next
adapter invocation's session. Also prove unlisted adapters remain held,
unacknowledged cancellation cannot continue, existing built-ins remain
unchanged, and unsafe archive restoration remains excluded.

No direct duplicate was found in the web searches for external-adapter
continuation or the capability name. This search is not exhaustive. No retirement
proof exists. Source independent; packaging records state that its Antigravity
opt-in requires its own verified stop implementation and Change 21's drain
behavior. Those live packaging assertions were not verified here.

## Change 21: Shutdown waits for adapter finalizers

### Changed files and roles

| File | Role |
| --- | --- |
| `packages/shared/src/config-schema.ts` | Accepts the optional server drain timeout in file configuration. |
| `server/src/config.ts` | Resolves environment/file/default timeout precedence. |
| `server/src/index.ts` | Passes timeout and pending-run identities into shutdown. |
| `server/src/shutdown.ts` | Bounds finalizer draining and logs overdue runs. |
| `server/src/services/heartbeat.ts` | Adds shutdown checks and pending-execution diagnostics; also adds unnecessary test surfaces. |
| `server/src/__tests__/shutdown-waits-for-adapter-run-stops.test.ts` | Intended ordering, deadline, and dispatch-suppression coverage. |

### Concrete findings

1. **P1: admission remains racy.** The new `shutdownInProgress` check in
   `startNextQueuedRunForAgent` is before asynchronous scheduling, worktree,
   lock, agent, and database operations (`19714–19833` at the reviewed head).
   Shutdown can start during those awaits, after which it still calls
   `executeRun`. That function checks `getSchedulingSuppression`, which does
   not include shutdown. Scheduled native-resume and reaper dispatch paths also
   lack a shutdown fence. This is a source-supported interleaving; it was not
   executed in this read-only audit.
2. The new test called “no queued or deferred run is dispatched during the wait”
   uses an empty fake DB, checks an exposed Boolean, and calls a newly exposed
   scheduler method. It does not exercise the above interleaving or deferred
   message dispatch.
3. The default finalizer timeout increases from 5 seconds to 60 seconds for
   every deployment. This is an observable compatibility change; the desired
   global policy is an operator/maintainer decision, not a proven bug by itself.
4. Environment parsing uses `parseInt`, accepting malformed suffixes and
   fractional strings rather than validating the complete value. It silently
   falls back on invalid/nonpositive input and permits values beyond Node's
   timer range. The file schema also lacks an upper bound.
5. `setShutdownInProgress` has no caller. `isShutdownInProgress` is referenced
   only by the new test. These are unnecessary production API additions.
6. Timeout produces duplicate error and info records. Consumer configuration
   documentation and parsing/precedence regressions are absent.
7. The ordering test manually calls `finalizeServerShutdown` after awaiting the
   drain. That does not establish the actual server orchestration order.

### Minimal correction and missing proof

Fence the authoritative claim/dispatch boundary and prove the race with an
observable paused admission that spans shutdown. Exercise deferred input and
native resume entry points, no-active-run behavior, the existing hot-restart
path, and actual finalizer-before-database ordering. Validate the entire timeout
value and a finite supported range; document precedence and default. Keeping the
upstream default while allowing an explicit deployment value is the least
surprising compatibility option, subject to the parent's final decision.

### Upstream status and dependencies

[Upstream PR #14028](https://github.com/paperclipai/paperclip/pull/14028), merged
as `5b09d661831f0b2d265c696496a9528f9629bb7d`, keeps task-drain wakes queued and
retries interrupted disposition handoffs. Its commit and diff were inspected.
It is adjacent to this work, not a replacement for external-adapter finalizer
draining. Current upstream `shutdown.ts` has no diff from the recorded base.
No released equivalent or passing retirement regression was established.

This source change is independent. Packaging must account explicitly for the
eventual deadline and supervisor window; packaging's stated Antigravity use of
Change 20 depends on the stop/drain contract.

## Change 22: Terminal-run environment leases

### Changed files and roles

| File | Role |
| --- | --- |
| `server/src/services/heartbeat.ts` | Adds cancellation release and stranded-lease recovery guards/shortcuts. |
| `server/src/services/recovery/service.ts` | Adds lease-release dependency after orphan terminalization, with unsafe bulk fallback. |
| `server/src/services/environment-runtime.ts` | Handles absent environment context, currently by fabricating successful local cleanup. |
| `server/src/services/environments.ts` | Extends bulk release to pending-cleanup leases and cleanup/failure options. |
| `server/src/__tests__/release-cancelled-interrupted-run-leases.test.ts` | Intended cancellation/recovery/reconciliation coverage; does not reproduce the real in-process leak. |

### Concrete findings

1. **P1: missing environment falsely certifies cleanup.**
   `environment-runtime.ts:3761` marks the orphan lease cleanup successful and
   fabricates an archived local environment object. A missing/deleted
   environment may refer to a real remote provider resource. No provider
   teardown occurs before the success receipt.
2. **P1: a second release path bypasses provider cleanup.**
   `recovery/service.ts:5703` falls back to `environmentService.releaseLeasesForRun`
   when its dependency is absent. It marks active and pending-cleanup leases
   expired/successful without provider termination. The change to the bulk
   helper permits this false result for remote resources too.
3. **P1: pending local cleanup bypasses execution ownership.**
   `heartbeat.ts:18527` releases local/null-provider pending-cleanup leases
   without checking process, process group, active executor, or native ownership.
4. **P1: orphan sweep guards are incomplete.** New checks consult PID/group,
   `runningProcesses`, and native ownership, but not `activeRunExecutions` or
   the native-finalization coordinator conditions added to the normal release
   helper. A terminal row can precede executor cleanup; terminal status alone
   does not prove that resource authority has ended.
5. **P2: new guards reintroduce page starvation.** The sweep selects the oldest
   20 leases. New live-process/native-owner branches skip without advancing
   `updatedAt`. Twenty guarded rows can indefinitely hide eligible rows behind
   them. Upstream's existing shared-resource guard intentionally updates the
   timestamp to prevent exactly that bounded-page starvation.
6. PID liveness checks omit the recorded process-start-time comparison that
   conversation ownership already uses. A recycled PID can therefore hold an
   unrelated old lease. This is a source-supported edge case, not a reproduced
   incident from the historical run.
7. The purported in-process regression inserts a fake `runningProcesses`
   child/PID and mocks `terminateLocalService`. It never enters `executeRun`
   or its finalizer and cannot explain why the genuine finalizer missed release.
8. Fixture runs omit historical adapter identity. Some assertions that
   `getConversationOwnershipBlocker` returns null therefore do not prove the
   blocker cleared: the fixture is not classified as a conversation run in the
   first place. Reconciliation assertions are a separate check and do not repair
   that missing precondition.

### Exact historical root cause: not observable

The registry's in-process incident lacks lifecycle/log evidence showing whether
`executeRun.finally` ran and which condition skipped release. The new test
does not reproduce that execution. The missing cancellation-path release for
a run without an active executor is demonstrable from source, but it does not
explain a genuine executor finalizer failing to release. No claim that the
historical in-process cause has been diagnosed is justified.

### Upstream overlap and release evidence

[PR #13515](https://github.com/paperclipai/paperclip/pull/13515) merged on
September 16 as `e1f245a6607f3920d1618409ee0d5b90c822d81e`. Its commit/diff and
public merged state were inspected. It adds the bounded orphaned-active-lease
sweep, shared-provider-resource protection, same-tick pending cleanup, and page
progress by deferring guarded rows. That sweep already exists in the reviewed
contribution base; it is not original implementation supplied by Change 22.

`git merge-base --is-ancestor e1f245a6607f3920d1618409ee0d5b90c822d81e refs/upstream-tags/v2026.916.1`
returned exit 1. A ref-qualified search found no `sweepOrphanedActiveLeases`
function in that stable tag either. Stable-side addition of the sweep is thus
an upstream backport. These observations do not certify every release behavior;
no regression was run against the tag.

The complete Change 22 outcome is not proven supplied by upstream, so it is not
a verified retirement candidate. The source-independent relation to Change 19
is that 19 removes a trigger while 22 repairs other paths/existing leases.
Changes 07 and 21 can overlap heartbeat/recovery files without being prerequisite
PRs for the focused outcome.

### Minimal correction and missing proof

Reuse the existing upstream sweep and provider-backed cleanup receipt path.
Avoid fabricated environment records and the bulk-success fallback. Centralize
the actual ownership predicate, including active executor/native finalization,
and defer every guarded row. Add behavioral cases for genuine in-process
cancellation, no-executor cancellation, orphan terminalization, historical
stranded leases, live PID/group/executor ownership, native recovery/finalization,
missing environments with live remote resources, failed/pending cleanup, and
page progress. The historical in-process cause remains a separate explicit
acceptance blocker until complete evidence or a faithful reproduction exists.

## Embedded PostgreSQL startup diagnostic audit

The parent reported an actual upstream-base `file-delivery-bridges` run that
completed with exit 1 and three skipped tests. Its terminal error said five
embedded PostgreSQL startup attempts failed, ending with `Postgres init script
exited with code 1` and progress including `selecting default shared_buffers ...
400kB` and `running bootstrap script ...`. The parent read the complete retained
test output; it did not contain a deeper PostgreSQL cause. This reviewer did not
run or independently read that test execution's output file. The findings below
come from the authoritative source and installed dependency implementation.

### Exact inspected implementation

- `packages/db/src/test-embedded-postgres.ts`.
- `packages/db/src/embedded-postgres-error.ts` and its tests.
- `packages/db/src/embedded-postgres-native.ts`.
- `server/src/__tests__/helpers/embedded-postgres.ts`, which reexports the DB helper.
- Installed dependency resolved by `packages/db/node_modules/embedded-postgres`:
  `node_modules/.pnpm/embedded-postgres@18.1.0-beta.16_patch_hash=55uhvnotpqyiy37rn3pqpukhei/node_modules/embedded-postgres/`.
- Its `dist/index.js`, `dist/binary.js`, type declarations, and README.
- Repository patch `patches/embedded-postgres@18.1.0-beta.16.patch`.
- Root/DB command declarations and relevant documented diagnostic references.

Installed dependency inspection was read-only. No installed file was modified.

### Confirmed observability defect

1. `initialise()` in installed `dist/index.js:129–149` spawns `initdb` with
   default piped stdio. It attaches only `process.stdout.on('data', ...)`,
   forwarding those chunks to `options.onLog`.
2. Despite the adjacent comment saying “Connect to stderr,” it never subscribes
   to `process.stderr` and never forwards initdb stderr to `options.onError`.
   The advertised `onError` option therefore does not expose this bootstrap
   stderr. The actual server `start()` path does attach postgres stderr, but
   bootstrap fails before that path is reached.
3. The init wrapper rejects on the child's `exit` event with only a generic
   code string. It does not await stream `close` or retain complete subprocess
   output in the error. No log file is written by this wrapper.
4. Paperclip's `createEmbeddedPostgresLogBuffer` retains only 40 received lines;
   `formatEmbeddedPostgresError` includes only the final eight. The retry helper
   replaces the prior attempt's error and finally throws only the last attempt.
5. Each failed test attempt calls `stopEmbeddedPostgresBounded` and removes its
   temporary data directory. For an init failure, dependency `stop()` immediately
   returns because its server process was never assigned. There is no retained
   complete attempt log referenced by this helper.
6. The repository's existing dependency patch changes locale and environment
   inheritance only; it does not repair stderr capture.
7. `prepareEmbeddedPostgresNativeRuntime()` is Linux-only, adding library-path
   setup and aliases. It adds no Darwin diagnostics.

**Conclusion:** initdb's decisive stderr is discarded by the installed wrapper.
The exact bootstrap failure cause is not observable from the reported retained
output. `shared_buffers ... 400kB` is a progress value, not evidence establishing
a memory, sandbox, permission, or other environmental cause. The formatter's
shared-memory hint test supplies a fabricated FATAL line and does not establish
that line occurred in the actual failure.

### Diagnostic continuation boundary

No inspected declared diagnostic option recovers the discarded stderr. Repeating
the same test unchanged cannot repair this evidence path. A proper evidence
repair would capture initdb stderr, settle on stream closure, and retain complete
per-attempt diagnostics before cleanup. Any such source/patch/lockfile changes
need the parent's scope and command-surface decision; this reviewer made none.

The existing retry tests replace the entire constructor and invoke callbacks
themselves. They verify helper formatting but not the real dependency's stderr
wiring. No diagnostic process, test, arbitrary script, or outside-workspace
inspection was executed during this audit.

## PR package constraints and outstanding verification

Current upstream contribution rules accept a complete in-PR issue description;
a separately opened issue is not mandatory. PR bodies must follow the current
template, including public issue/PR context and no private instance identifiers.
Neither full green gates nor Greptile approval can be checked truthfully before
they occur. The operator, not this session, opens upstream PRs.

This record is review evidence only. Missing for the reviewed heads: current
upstream merges, applied fixes, genuine fail-on-base/pass-on-head evidence,
complete static/type/build/test gates, stable-line verification after repairs,
live packaging proof, final PR packages, and post-repair remote identity checks.
The parent owns subsequent execution and the final readiness report.
