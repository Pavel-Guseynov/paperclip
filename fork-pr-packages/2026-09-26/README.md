# Upstream contribution audit — 2026-09-26

Reviewed all 20 implemented changes: 01–16 and 19–22. 17/18 are withdrawn. **None is ready to open:** 16 are blocked and 4 need an operator/maintainer decision. The operator alone opens PRs. No upstream PR, issue, comment or coordination message was created.

This dated package supersedes the 2026-09-25 readiness claims. It preserves incomplete work as explicit blockers; the PR bodies are drafts, not permission to submit incomplete changes. Source reviews are historical snapshots; the final heads and executed outcomes are in the per-change reports below. The packaging repository was read only.

Change 01 has a later focused follow-up against upstream `7f3c06dac4604dddcf870085f1a623c102261358`. Its [report](changes/01.md) and [evidence](evidence/01-focused/verification.md) supersede the earlier 01 status. The other 19 entries remain snapshots of the earlier audit; they were not re-reviewed against the later base. The operator requested a stop after 01.

## Readiness

| Change | Outcome | Disposition | Reason |
| --- | --- | --- | --- |
| [01](changes/01.md) | Managed MCP lifecycle authentication | **blocked** | Narrowed fix: 186 focused and 224 stable tests pass. Broader gates failed; main tests need authorized dependency synchronization. |
| [02](changes/02.md) | Gateway session-token verification | **blocked** | Depends on 01; database lifecycle tests and complete current-head gates are unverified. |
| [03](changes/03.md) | Codex runtime API reachability | **blocked** | Real local, sandbox and SSH callback/authentication acceptance remains unproven; full gates absent. |
| [04](changes/04.md) | Remote MCP timeout health | **blocked** | Timeout, concurrent health update and ambiguous write replay persistence proof lacks current-head gates. |
| [05](changes/05.md) | Gateway token log redaction | **blocked** | Logging defects fixed; regression, policy checks, typecheck and build pass. Full suites, coverage and remaining PR lanes are unverified. |
| [06](changes/06.md) | Approval return-assignee selection | **blocked** | Recorded exactly-once concurrent transition acceptance is not implemented or proven. |
| [07](changes/07.md) | Review handoff retry | **blocked** | Cross-attempt race can enqueue duplicate handoffs; migration 0284 collides with 09. |
| [08](changes/08.md) | Workspace recovery precedence | **blocked** | Broad stranded kind suppresses later specific causes; DB regression and upstream conflict resolution required. |
| [09](changes/09.md) | Verified terminal delivery evidence | **needs operator decision** | Open PR 11196 overlaps; required checks, provider-neutral coverage and native terminal path do not meet record; malformed evidence can pass. |
| [10](changes/10.md) | Revision-keyed review admission | **needs operator decision** | Implementation is best-effort bookkeeping; requested durable admission and exactly-one invocation are absent. |
| [11](changes/11.md) | Darwin lsof Unicode path decoding | **blocked** | Darwin regression and full current-head proof blocked by database fixture initialization; stable refinements pending. |
| [12](changes/12.md) | Workspace runtime exposure test isolation | **blocked** | Current-base repeatability, touched suites and full gates remain unverified; final stable test refinement pending. |
| [13](changes/13.md) | pnpm 11 toolchain migration | **needs operator decision** | Manual lockfile edits are forbidden; trusted master workflow pins pnpm 9; current lockfile merge conflicts. |
| [14](changes/14.md) | Client-safe gateway tool names | **blocked** | Provider selector removed; catalog changes can redirect names; reserved-name collisions and permanent alias path remain. |
| [15](changes/15.md) | Gateway context tools gated by token actions | **blocked** | Final-head gateway tests are unexecuted; adjacent stable05 tests skipped on their DB support gate. Full proof is absent. |
| [16](changes/16.md) | Profile tool_name selector identity | **blocked** | Startup rewrite guesses names, can broaden connection grants and can overwrite concurrent edits. |
| [19](changes/19.md) | Stage decision keeps the calling run | **blocked** | Cancellation exemption accepts unverified header run IDs from non-JWT actors. |
| [20](changes/20.md) | Antigravity conversation continuation | **blocked** | Synthetic markers do not prove cancel-to-next-wake behavior or restart ownership; full gates absent. |
| [21](changes/21.md) | Shutdown waits for adapter run stops | **needs operator decision** | The default increase from 5 to 60 seconds needs a compatibility decision; admission race and deadline validation remain defects. |
| [22](changes/22.md) | Release terminal run leases | **blocked** | Missing environments and fallback paths can report false cleanup; live/native guards and bounded sweep progress are incomplete. |

## Corrected source and integration

Change 05's deeper credential traversal and child logger metadata defects are fixed. The identical real HTTP test fails on current upstream and passes on the final contribution. Six further regressions fail before the correction; 100 logger tests pass afterward. Stable passes 95 logger and 29 adjacent tests; 62 gateway tests are skipped and are not acceptance proof. All executed policy checks and 474 policy-script tests pass, as do recursive typecheck and workspace build. Full suites, remaining PR lanes and 100% statement coverage remain unverified. [Exact commands and logs](evidence/05/current-head-verification.md).

Earlier 01/02 fixture-only proof remains [historical evidence](evidence/01-02/fixture-correction.md). The focused 01 follow-up excludes upstream's header fix and the unrelated UUID refactor, adds real database auth/lifecycle proof, and carries the remaining corrections to stable/main. Final contribution passes 186 tests; stable passes 224; main's command is blocked before Vitest by dependency synchronization. [Current 01 evidence](evidence/01-focused/verification.md).

Every new source correction reached its stable branch and main through ordinary commits, merges or cherry-pick -x. Change 05 also carried nine older reviewed contribution corrections that had been missing from stable. Upstream-only synchronization merges stayed on contribution branches; unreleased master was not imported into stable/main. [Commit mapping](evidence/05/README.md), [synchronization](evidence/synchronization.md).

**Packaging behavior to record:** the 05 backports restore stable upstream's API error-response behavior by removing earlier response-body sanitization changes from error-handler.ts and routes/tool-gateway.ts. The logging boundary remains redacted, including deep fields and child bindings. The later 01 merge also restricts the managed exception to POST, restores the public deployment-default actor, and removes notification double-charging and successful usage/identity writes. Main's existing Change 02 session verification is preserved but its merged tests remain blocked. No schema or configuration migration was added in this session.


The 01 stable/main POST-boundary gap is now fixed and stable verified. Stable02 and main still exempt session-token routes without the contribution02's scoped bearer condition; that separate 02 gap is unchanged. They need real authentication acceptance and verified backports. Earlier11/12 stable refinements also remain pending.

Two further older production differences remain: stable06/main remove the return-assignee exclusion for every approval stage; stable09/main construct evidence targets from caller input and use ambient provider tokens. The latter retains an SSRF/credential-exfiltration risk. Those lines still need the contribution's safer boundaries, verified before backport. Main has not passed complete acceptance and is not certified for deployment by this audit.

## Exact refs

| Ref | Full git rev-parse head |
| --- | --- |
| Earlier audit base; unchanged local master and origin/master | `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a` |
| Stable release v2026.916.1 | `d554c4789ed3930f8a53ac9fdf6503b3187097da` |
| Final fork main and origin/main after 01 | `e0e4336bea70cce0e925593dbaaa55e6d58f3a8e` |
| Focused 01 compared upstream/master | `7f3c06dac4604dddcf870085f1a623c102261358` |

The exact package commit is the commit containing this directory on fixed branch `fork/upstream-pr-packages`; it is reported to the operator after committing. A document cannot embed its own Git object ID before that object exists.

All 20 earlier contribution/stable heads are retained in [historical final-state.json](evidence/final-state.json). The current 01/main heads are in [01 final-state.json](evidence/01-focused/final-state.json) and manifest.json. Sixteen contributions contained the earlier audit base. 08, 10, 13 and 22 remain behind with recorded merge conflicts and acceptance blockers; no active merge is left. All 20 stable lines already contain v2026.916.1, despite older .0 branch names on 01–12. No branch identity or history was rewritten and no worktree was created.

## Dependencies and upstream coordination

- 02 includes earlier 01. The narrowed 01 preparation credits callisto-syn's overlapping draft [PR #12518](https://github.com/paperclipai/paperclip/pull/12518). Upstream's http_headers correction is excluded. No upstream coordination message was sent. Consider the latest 01 ancestry when proceeding to 02.
- 10 includes 09. Coordinate 09 with [PR #11196](https://github.com/paperclipai/paperclip/pull/11196). 10's ledger is not yet the required durable admission gate.
- 14 includes 16. 16's startup rewrite is unsafe for ambiguous and connection-specific grants. 14 must not depend on an unproved migration.
- 07 and 09 both add migration 0284. Settle integration order, then use the declared migration generator. Independently passing numbering against master would not eliminate this collision.
- 13 needs a maintainer-owned pnpm/toolchain and bot lockfile-refresh sequence. Current trusted master installs pnpm 9.15.4. The stable-branch [PR #13894](https://github.com/paperclipai/paperclip/pull/13894) is superseded.
- 21's global default increase from 5 to 60 seconds needs an explicit compatibility decision, in addition to fixing its admission races.

No complete upstream replacement was proved against a release by a passing regression. There are no retirement claims. The reports distinguish partial merged fixes, open overlaps and unverified absence. Substantial/core proposals still need upstream discussion; [unsent discussion drafts](discussion/README.md) are prepared for the operator.

## Evidence and unresolved limits

The universal [verification inventory](evidence/verification-contract.md) records every upstream policy and PR lane. Every per-change report includes those commands and a result/count or explicit not-run entry. GitHub CI and Greptile are post-open requirements, not fabricated before-open results. Existing warning output is retained; no suppression was added. No 100% coverage claim is made.

The earlier database baseline still has no retained causal stderr ([historical output](evidence/upstream-file-delivery.log)). A new observed execution proved PostgreSQL shmget permission denial; native permission review then allowed the same fixture to pass. Final 01 contribution/stable real DB tests pass. This does not retroactively establish the old run's cause or verify other changes. [Current diagnosis](evidence/01-focused/verification.md).

For 22, authoritative retained service evidence shows a server stop/start inside the historical run interval. It invalidates the earlier inference of uninterrupted process ownership. It does not identify the lease leak's cause. [Safe lifecycle summary](evidence/22-observability-summary.md). Complete projected query responses stay operator-local under `.git/fork-audit-2026-09-26/22-observability/`; they contain internal deployment metadata and are not in the public package.

No complete passing current-head full gate is claimed for any contribution. Readiness also requires the causal regressions and compatibility work in each report. Earlier 11/12 stable refinement gaps remain explicitly recorded; this session did not silently backport unverified older refinements.

## Operator files

- [Titles](pr/titles.tsv) and 20 [PR bodies](pr/01.md), using every section of the current upstream template.
- Each body links public related work, or supplies the required bug-template labels and substantive in-PR description. Upstream does not universally require a separate issue. No upstream issue was opened.
- [Verification authority](evidence/verification-contract.md), source reviews, before/after logs and sync evidence.
- [Workspace blockers](../../PROBLEMS.md), limited to unresolved environment/observability and submission constraints.

The exact served Codex model identifier/context size was not exposed; model disclosure says so rather than inventing it. Original author-model names are clearly labeled inherited provenance. Unmet template boxes remain unchecked.
