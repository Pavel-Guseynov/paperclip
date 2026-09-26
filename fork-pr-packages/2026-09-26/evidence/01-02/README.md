# Change 01 and 02 upstream synchronization

This file records the initial synchronization checkpoint. A subsequent
authorized source correction fixes the temporary-home test fixture; final
identities and after-fix verification are in `fixture-correction.md`.

Status: synchronization committed and pushed to the existing origin feature
branches; verification remains blocked as described below. No PR readiness claim.

Initial clean checkout: main at fccd6876eb545ea8dc1f36294b5c8ce798bbfceb.
Current fetched upstream: 4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a.
Change 01 initial local/origin head: 9044c3df1abf7f523a142f3aa795472ff0246cf1.
Change 02 initial local/origin head: 4ef9dc8464bc00e1ecbd6295146337fa1ee94370.
All commit values were copied from git rev-parse output.

Scope: ordinary upstream merges on fixed contribution identities, preserving
Change 02's dependency on Change 01, followed by relevant non-database tests.
Upstream synchronization is an upstream-only adaptation and must not be merged
into stable branches or fork main. Source corrections beyond conflict
resolution, if any, require an explicit backport disposition.

Current upstream already contains the Codex http_headers fix from
18dac1e1efa48477df83b88ae9d8dbf134438e5e (PR #13942). The existing managed-route
and initialized-notification auth work remains relevant; Draft PR #12518 is its
upstream overlap. No upstream PR or message will be created by this work.

No flake.nix or PROBLEMS.md exists in this raw upstream fork. Verification uses
the repository's declared pnpm surface, as explicitly requested.

## Resulting identities

- Change 01 `fix/codex-managed-mcp-auth`:
  `39c71af9a82e49b1a143939aadb21acbff73ac12`.
  First parent `9044c3df1abf7f523a142f3aa795472ff0246cf1`; second parent
  `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a`.
- Change 02 `fix/tool-gateway-session-token-verification`:
  `d05d232fd7de92120e1f1066cf18b94f68c9d5c7`.
  First parent `4ef9dc8464bc00e1ecbd6295146337fa1ee94370`; second parent
  `39c71af9a82e49b1a143939aadb21acbff73ac12`.
- Origin tracking refs equal both resulting heads above, verified with
  `git rev-parse` after successful ordinary push. The parent explicitly
  authorized publication of these feature-branch updates with blocked evidence;
  this does not authorize or claim a ready PR or protected-branch merge.
- Main remained `fccd6876eb545ea8dc1f36294b5c8ce798bbfceb` throughout.

All identities above are full values copied from `git rev-parse`.
Both changes now contain current upstream; Change 02 contains updated Change 01.
No stable/main branch was merged, no source correction beyond conflict
resolution was made, and no backport is due from this synchronization.

## Merge review

Change 01 used `git merge --no-commit --no-ff upstream/master`; its only
conflict was the redundant three-line explanation immediately before the
already-upstream `http_headers` assertion in
`packages/adapters/codex-local/src/server/codex-home.test.ts`. Resolution kept
upstream's assertion and omitted that duplicate comment. The remaining fixture
correction to `http_headers` and stronger server execute assertion were retained.
The merge commit used message
`merge: synchronize managed MCP authentication with upstream master`.

Change 02 used `git merge --no-ff fix/codex-managed-mcp-auth` with message
`merge: synchronize gateway sessions with managed authentication`; it merged
without conflict. Its incremental source diff still restricts the actor handoff
to pcgt bearer session endpoints, preserves normal actor checks for other
credentials, reads only session bearer credentials from Authorization, and
rejects pcgw tokens lacking a named gateway locator. These are source-review
observations, not proof of database-backed route/service behavior.

`git diff --cached --check` during Change 01 and `git diff --check` on both
final contribution diffs exited 0 with empty output.
The final Change 01 diff against current upstream has eight files (no adapter
implementation diff remains because upstream already fixed `http_headers`):

- `packages/adapters/codex-local/src/server/codex-home.test.ts`: managed-home
  secret-bearing fixture uses Codex's actual header key.
- `server/src/__tests__/agent-auth-middleware.test.ts`: managed credential
  handoff boundaries and actor handling.
- `server/src/__tests__/codex-local-execute.test.ts`: generated managed MCP
  Authorization configuration assertion.
- `server/src/__tests__/tool-gateway.test.ts`: initialized-notification
  credential, protocol, write and limiter regression coverage.
- `server/src/lib/uuid.ts`: shared UUID text-shape matcher.
- `server/src/middleware/auth.ts`: POST managed MCP pcgw handoff.
- `server/src/routes/tool-gateway.ts`: authenticated notification status path
  and shared UUID validation.
- `server/src/services/tool-gateway.ts`: verification-only named bearer path.

Change 02's seven-file incremental diff retains the documented session bearer
contract in `doc/MCP-ACCESS-GOVERNANCE.md` and `doc/MCP-DEMO-SCRIPT.md`, auth
regressions in `server/src/__tests__/agent-auth-middleware.test.ts`, route and
service regressions in `server/src/__tests__/tool-gateway.test.ts`, and the
implementation in `server/src/middleware/auth.ts`,
`server/src/routes/tool-gateway.ts`, `server/src/services/tool-gateway.ts`.

## Executed verification and retained evidence

On exact Change 01 head above:

```
pnpm exec vitest run packages/adapters/codex-local/src/server/codex-home.test.ts server/src/__tests__/agent-auth-middleware.test.ts server/src/__tests__/codex-local-execute.test.ts
```

Exit 1; 3 files, 2 passed and 1 failed; 101 tests, 99 passed and 2 failed.
Complete retained stdout/stderr: `01-tests.log`. Merge command output:
`01-merge.log`. The failures are the two parameter values of
`retries missing resume only before a session starts (started=%s)` in
`server/src/__tests__/codex-local-execute.test.ts:717`.
Both fail before their resume assertions at the real filesystem operation:

```
Error: EPERM: operation not permitted, unlink '/Users/pavelguseynov/.paperclip/instances/default/companies/company-1/codex-home/auth.json'
ensureSymlink: packages/adapters/codex-local/src/server/codex-home.ts:247
seedManagedCodexHome: packages/adapters/codex-local/src/server/codex-home.ts:732
prepareManagedCodexHome: packages/adapters/codex-local/src/server/codex-home.ts:774
execute: packages/adapters/codex-local/src/server/execute.ts:697
test call: server/src/__tests__/codex-local-execute.test.ts:736
```

Source inspection finds that these two fixtures create and seed a temporary
root but do not set HOME to it, unlike adjacent fixtures. The retained failure
proves the attempted out-of-workspace unlink was rejected; it does not prove a
production authentication regression. No host auth file was read or changed by
the agent, no permission escalation or environment workaround was attempted,
and the known failing suite was not rerun on Change 02.

On exact Change 02 head above:

```
pnpm exec vitest run server/src/__tests__/agent-auth-middleware.test.ts
```

Exit 0; 1 file passed, 32 tests passed. Complete retained stdout/stderr:
`02-tests.log`. Complete merge command output: `02-merge.log`.

Both runs emitted the pnpm warning that package.json pnpm settings were ignored,
and a Vite native-config compatibility warning; no warning suppression was
added. A separate `pnpm --version` exited 0 with `9.15.4` plus the same pnpm
warning. Dependency installation was not repeated or changed.

Database gateway suites and full typecheck/test/build gates were not run under
the assigned non-database-only scope. Before readiness, resolve the
fixture isolation/environment blocker through the declared authority, obtain
passing touched regressions, and execute the remaining database/full gates on
the exact candidate heads. The overlap with upstream draft #12518 remains a
submission coordination concern. No upstream PR or message was sent.

## Publication and checkout handoff

`git push origin fix/codex-managed-mcp-auth fix/tool-gateway-session-token-verification`
exited 0. Complete output is in `push.log`. No forced refs were used.
The workspace returned to main; `git status --short --branch` returned only
`## main`, and `git rev-parse HEAD` returned
`fccd6876eb545ea8dc1f36294b5c8ce798bbfceb`. Checkout/ref ownership is released.
