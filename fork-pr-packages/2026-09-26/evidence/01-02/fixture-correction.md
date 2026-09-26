# Codex resume fixture isolation correction

Status: the targeted tests pass on both contribution branches, both stable
branches, and main after declared dependency installation. No PR readiness claim.

The initial Change 01 run preserved in `01-tests.log` reproduced two failures
at `ensureSymlink` attempting to unlink a host default-instance auth path.
Source inspection showed that the parameterized resume fixture seeded its
temporary `.codex` directory but omitted the HOME setup/restoration used by
adjacent tests. The parent explicitly authorized fixing this fixture at source.

Commit `8725503d84f758548b9560e1c62762044f7d5293` adds four lines in
`server/src/__tests__/codex-local-execute.test.ts`: save HOME, set it to the
fixture's existing root immediately before its try block, restore/delete HOME
in finally before deleting that root. The normal managed-home implementation
therefore resolves inside the fixture root. Production code and execution
environment configuration are unchanged; no host auth file was inspected.

This correction has the required before/after execution evidence:

- Before, on `39c71af9a82e49b1a143939aadb21acbff73ac12`: 99 passed and
  2 failed; both resume parameter cases hit EPERM before their assertions.
- After, on Change 01 `8725503d84f758548b9560e1c62762044f7d5293`:
  `pnpm exec vitest run packages/adapters/codex-local/src/server/codex-home.test.ts server/src/__tests__/agent-auth-middleware.test.ts server/src/__tests__/codex-local-execute.test.ts`
  exited 0, 3 files / 101 tests passed. Complete output: `01-fixed-tests.log`.
- Change 02 received an ordinary merge of Change 01, preserving dependency,
  at `967b5a6cc73a86be8552e0be6e4eee964574076d`.
  `pnpm exec vitest run server/src/__tests__/agent-auth-middleware.test.ts server/src/__tests__/codex-local-execute.test.ts`
  exited 0, 2 files / 54 tests passed. Complete output: `02-fixed-tests.log`.

All commit IDs were copied from `git rev-parse` and are full 40-character values.
Database and full repository gates are still unexecuted in this assigned scope;
passing the targeted tests does not establish upstream readiness.

## Backports and exact-head proof

Each backport used `git cherry-pick -x 8725503d84f758548b9560e1c62762044f7d5293`
and contains only the four fixture lines. No upstream merge reached these lines.

| Branch | Before | After | Touched suite |
| --- | --- | --- | --- |
| `stable/v2026.916.0/fix/codex-managed-mcp-auth` | `33ed8b206a5b180e1e62ce40840cfec04895c02f` | `f88dc63d163e4a3449eda3566125fc53387f5657` | 21/21 passed |
| `stable/v2026.916.0/fix/tool-gateway-session-token-verification` | `8217e22a822dd5aa269824d762e4bfae98bf7483` | `0389fe2111cd5fdb75eaca58cb0f3bb0381abc54` | 21/21 passed |
| `main` | `fccd6876eb545ea8dc1f36294b5c8ce798bbfceb` | `c8041639ac066fbfe1d3d6e0cb081b252177b081` | 21/21 passed after setup |

The exact command on each was:

```
pnpm exec vitest run server/src/__tests__/codex-local-execute.test.ts
```

Complete outputs: `stable-01-fixed-tests.log`, `stable-02-fixed-tests.log`,
`main-fixed-tests.log`. Both stable executions exited 0; main exited 1 before
Vitest started. Main's pnpm 11 dependency precheck invoked `pnpm install`, which
aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. This is the deepest
failure the retained output exposes. No test assertion ran on main, no CI or
confirmation environment override was set, and no install/retry workaround was
attempted. The test-source correction itself has passing evidence on both
contribution branches and both stable branches; main still needs its declared
dependency installation/verification completed by the owning integration task.

The parent then authorized the declared noninteractive setup
`CI=true pnpm install --frozen-lockfile`. It completed successfully in 38.8s
using pnpm 11.21.0, with the lockfile unchanged. Full stdout/stderr is retained
in `main-install.log`. This was the repository's normal installer; no alternate
runner, hand-edited dependency tree, or host-home override was introduced.
The main touched suite was retried after this setup.

That retry exited 0 on the same exact main head: one file, 21/21 tests passed.
Complete output is in `main-fixed-retest.log`. Both initial failure outputs
remain retained so this final result does not erase the observed lifecycle.

The earlier EPERM is fixed at its fixture source, with before/after evidence.
Warnings from pnpm/Vite remain visible in the retained successful logs; they
were not suppressed. No database, complete repository test, build, or typecheck
claim is made.

## Final publication and handoff

Ordinary pushes succeeded for both contribution branches, both stable branches,
and main. Full outputs: `fixed-push.log` and `main-push.log`.
All five origin tracking refs match their local full heads listed above, as
verified by `git rev-parse`. No forced refs, upstream PRs, or upstream messages
were used. Final `git status --short --branch` is only `## main`.
Checkout ownership is released to the parent at main
`c8041639ac066fbfe1d3d6e0cb081b252177b081`.

The fixture correction changes no production behavior packaging consumes. The
upstream-only synchronization stays on the contribution branches. Readiness
still requires the separately documented complete/database gate evidence and
resolution of Change 01's overlap with upstream draft PR #12518.
