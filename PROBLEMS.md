# Unresolved workspace problems

This log belongs to the upstream contribution package branch. It does not create a board task or change the packaging repository.

## Change 01 broader gates and main dependency authorization

- Status: blocked for submission; focused fix and stable tests pass.
- Timestamp: 2026-09-26.
- Context: operator's existing Change 01 preparation request; no new task identifier was created. Operator requested stopping after 01.
- Evidence: `fork-pr-packages/2026-09-26/evidence/01-focused/verification.md`, commands.json and linked complete failure diagnoses.
- Description: broader gate head `bed8d5c5f80d7b756626c244f187ec12b06e1340` fails eight general-server tests, one Runner receipt test, one Rust peer-result assertion, and two browser scenarios. Docker is unavailable. Missing child/event diagnostics prevent full causal classification of Cursor, Runner and browser failures. No matching-base evidence establishes these failures as pre-existing. Final contribution `d7f732a84310958de14f5a02f859cd4e797cb48c` passes 186 focused tests; stable `aa542ea3d1c487c9725314a230581d6042269986` passes 224.
- Main blocker: merged `e0e4336bea70cce0e925593dbaaa55e6d58f3a8e` did not start tests because pnpm attempted dependency synchronization and aborted module purge without TTY. Automatic approval review rejected `pnpm install --frozen-lockfile` because installed dependency mutation is prohibited by the supplied instructions. No bypass occurred.
- Next steps: obtain operator authorization for normal frozen dependency synchronization before main verification; address the diagnosed gate failures through their owning scope with retained causal evidence; run missing required gates. Do not claim green submission or deployable main.

## Historical lease-release cause lacks execution correlation

- Status: blocked.
- Timestamp:2026-09-26T06:45:37Z.
- Context: existing Change22; operator's upstream-readiness request.
- Evidence: `fork-pr-packages/2026-09-26/evidence/22-observability-summary.md`; full projected responses retained locally under `.git/fork-audit-2026-09-26/22-observability/`.
- Description: retained requests and server lifecycle records do not identify the executor's finalizer/release decision. A stop/start inside the incident interval prevents an uninterrupted-process inference. An uncorrelated EPIPE is not a causal diagnosis.
- Next step: obtain retained execution-correlated evidence, or a real behavioral reproduction with a demonstrated cause and passing narrow fix. Correct false cleanup and ownership/sweep defects before acceptance.

## Upstream submission policy and decisions remain unresolved

- Status: blocked pending operator/maintainer decisions.
- Timestamp:2026-09-26T06:45:37Z.
- Context: existing Changes09,10,13 and21; no new board task.
- Evidence: per-change reports in `fork-pr-packages/2026-09-26/changes/`.
- Description: duplicate/core feature coordination is pending;13 cannot submit a manual lockfile or select its own trusted bootstrap;21 changes every deployment's shutdown default. Canary verification additionally requires a disposable CI-prepared checkout rather than repointing fixed refs.
- Next step: resolve the specific maintainer decisions in the prepared drafts, then complete the documented implementation and full gate evidence. Do not open incomplete PRs or rewrite branch identity.
