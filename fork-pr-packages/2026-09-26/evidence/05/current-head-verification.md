# Final Change 05 verification

This update supersedes the outstanding base-proof/typecheck/build statements in the earlier worker README. Source and policy inventories remain historical evidence.

- Current upstream base: `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a`.
- Contribution head: `e2809924bfe1736b1be359f3a1ef6fc804c3db8f`.
- Stable head: `e42ecc4c8c7161fc58c5a1012d294a558a6d9e28`.
- Final main after the later test-only correction: `c8041639ac066fbfe1d3d6e0cb081b252177b081`.

## Identical upstream/head regression

The exact fixture in `gateway-log-upstream-proof.test.ts` was temporarily added as `server/src/__tests__/gateway-log-upstream-proof.test.ts` on each revision. The production files were untouched. The fixture imports APIs present on both revisions, creates a real Express app, sends a real HTTP request with Supertest, and observes real Pino output. Its sentinel is a literal test value, not a credential.

`pnpm exec vitest run server/src/__tests__/gateway-log-upstream-proof.test.ts`:

| Revision | Exit | Passed | Failed | Skipped | Evidence |
| --- | --- | --- | --- | --- | --- |
| Current upstream above | 1 | 0 | 1 | 0 | [upstream-proof.log](upstream-proof.log) |
| Final contribution above | 0 | 1 | 0 | 0 | [head-proof.log](head-proof.log) |

The base fails because the raw gateway header value reaches the emitted log. The head removes the value, preserves the safe run identifier and returns HTTP200. The identical fixture was removed after each execution; neither branch contains a temporary proof file. The base log's final chunk was copied verbatim from the retained terminal tool result after a context handoff; it is observed output, not a reconstructed execution.

This proves the base HTTP leak. The separate six fail-before tests in [README.md](README.md) prove the newly corrected deep-object and child-binding defects against the pre-correction contribution. These are different comparisons.

## Executed final-head checks

Normal setup `CI=true pnpm install --frozen-lockfile` exited0 with managed pnpm9.15.4. No lockfile changed. [install.log](install.log) and [runtime.log](runtime.log).

P02–P15 all exited0. Their exact commands and full outputs are in the per-change gate table and Pxx.log files. P06/P08/P09/P10/P11/P12/P13 executed 14/3/377/24/11/39/6 passing tests respectively:474 total, zero failed or skipped. P14 reports30 release-enabled and4 disabled packages; P15 has no changed release-enabled manifest. Diff whitespace check passed.

`pnpm typecheck` exited0 and includes the declared workspace-link preflight and `pnpm -r typecheck`. [typecheck.log](typecheck.log).

`pnpm build` exited0 and includes the declared workspace-link preflight and `pnpm -r build`. [build.log](build.log). This does not stand in for the separate CI issue-thread build prerequisite or Linux-only compilation.

Warnings remain visible: the outer pnpm launcher warns about root pnpm configuration; Vite reports native-loader compatibility, ineffective dynamic imports and large chunks; Rust reports three dead-code warnings. The Darwin build skips the Linux SO_PEERCRED broker. No warning was suppressed or labeled pre-existing without a matching base execution. No claim of a warning-free gate is made.

## Not verified

Full general/serialized suites, release registry/build-gap checks, complete Runner lanes, Docker, browser shards, canary dry run, CI merge resolution and100% statement coverage were not completed. PostgreSQL fixture initialization failed on the base before assertions and the dependency discarded initdb stderr; its cause remains unobservable. The adjacent file-delivery failure is not this logger regression. No CI/Greptile result exists for an unopened PR. Change05 remains blocked pending complete proof.
