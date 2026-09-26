# Unresolved workspace problems

This log belongs to the upstream contribution package branch. It does not create a board task or change the packaging repository.

## Embedded PostgreSQL failure lacks retained stderr

- Status: blocked.
- Timestamp:2026-09-26T06:45:37Z.
- Context: operator's existing20-change upstream-readiness request; affected database-dependent acceptance across the fork. No new task identifier was created.
- Evidence: `fork-pr-packages/2026-09-26/evidence/upstream-file-delivery.log` and verification-contract.md.
- Description: the current-upstream adjacent baseline suite fails before assertions during initdb. Its five retries end at bootstrap exit1. Installed initialization code does not retain child stderr, and the fixture removes failed data directories. The underlying cause is not observable. This is not the Darwin lsof regression.
- Next step: restore authoritative complete subprocess diagnostics through the owning dependency/test contract, then complete real DB acceptance and full gates. Do not guess the cause, blindly retry, substitute a different database or count skips as passing.

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
- Context: existing Changes01,09,10,13 and21; no new board task.
- Evidence: per-change reports in `fork-pr-packages/2026-09-26/changes/`.
- Description: duplicate/core feature coordination is pending;13 cannot submit a manual lockfile or select its own trusted bootstrap;21 changes every deployment's shutdown default. Canary verification additionally requires a disposable CI-prepared checkout rather than repointing fixed refs.
- Next step: resolve the specific maintainer decisions in the prepared drafts, then complete the documented implementation and full gate evidence. Do not open incomplete PRs or rewrite branch identity.
