# Change 05 correction evidence

Parent audit owns full gate and upstream-status evidence. This directory retains focused redaction regression output and branch corrections.

Upstream: `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a`
Pre-correction contribution merge: `a4d14ae17f69ba9948000b713eeea97f8788f866`

## Result

- Contribution: `fix/tool-gateway-token-log-redaction` at `e2809924bfe1736b1be359f3a1ef6fc804c3db8f`.
- Stable: `stable/v2026.916.0/fix/tool-gateway-token-log-redaction` at `e42ecc4c8c7161fc58c5a1012d294a558a6d9e28`.
- Main after ordinary stable merge: `fccd6876eb545ea8dc1f36294b5c8ce798bbfceb`.
- All three were pushed to origin through ordinary fast-forward updates; see `push.log`. Remote tracking rev-parse matched all three after push.
- Checkout left clean on main. No PR opened. Packaging repository unchanged.

## Defects and correction

The bounded field traversal returned uninspected original subtrees at depth six. Nested gateway credential fields therefore reached the sink unchanged. Pino `logMethod` never sees child bindings, so nested fields in child/grandchild/setBindings metadata also escaped the recursive policy. Pino resets child bindings formatters, so a root bindings formatter alone would not fix this.

The traversal now replaces uninspected deep subtrees with `[Redacted]`. Pino's native `streamWrite` hook applies the existing field authority to final serialized output, which includes child bindings. It preserves the original serialized string when unchanged. The live-object prepass remains to protect the serializer from hostile getters and stray HTTP objects. Existing redaction markers remain stable across those two stages. Malformed final JSON becomes a constant content-free error record, with no original content included.

## Files in contribution diff

- `server/src/middleware/http-log-redaction.ts`: shared credential-name/text/error policy and bounded field redaction.
- `server/src/middleware/logger.ts`: native logger/HTTP serializers and hooks apply that policy to all transport output.
- `server/src/middleware/redact-sensitive.ts`: consume the shared credential authority for sensitive request/error payloads.
- `server/src/__tests__/http-log-redaction.test.ts`: integration coverage of real Pino/HTTP output; six new corrections cover child/grandchild/setBindings, deep records and child metadata, and malformed output.

## Commands and evidence

1. `git merge master --no-edit` on the contribution branch: clean ordinary merge, `a4d14ae17f69ba9948000b713eeea97f8788f866`.
2. With six new tests and old production code, `pnpm exec vitest run server/src/__tests__/http-log-redaction.test.ts`: **6 failed / 94 passed**; all six failures expose literal non-secret fixture sentinels in output. Complete retained stdout/stderr: `regression-before.log`.
3. After correction, same command on the contribution tree: **100 passed**, exit 0; `regression-after.log`.
4. Same command on stable: **95 passed**, exit 0; `stable-regression.log`. Five webhook cases exist only in newer upstream development history.
5. Stable command `pnpm exec vitest run server/src/__tests__/redact-sensitive.test.ts server/src/__tests__/error-handler.test.ts server/src/__tests__/log-redaction.test.ts server/src/__tests__/tool-gateway.test.ts`: **3 suites passed / 29 passed tests; 1 suite / 62 tests skipped**, exit 0; `stable-adjacent.log`. The skipped suite is tool-gateway, whose declared embedded-Postgres support gate skipped it. This is not evidence that gateway runtime tests passed.
6. `git diff --check`: passed on contribution changes and stable backport range.
7. `pnpm --version`: `9.15.4`; the installed launcher emits a pnpm configuration warning before dispatch. Test logs also retain the pre-existing Vite native-loader warning.
8. `git push origin fix/tool-gateway-token-log-redaction stable/v2026.916.0/fix/tool-gateway-token-log-redaction main`: exit 0, all ordinary fast-forward pushes.

No full suite, build, static gate or typecheck is claimed here. These are parent audit work. The new correction was proved failing on the pre-correction contribution head, not rerun on bare current upstream: upstream lacks the exported `basePinoOptions` test seam. Current upstream fail-on-base proof remains outstanding. Full database-dependent evidence is blocked by the parent's separately investigated embedded-Postgres initialization failure and missing retained stderr.

## Stable backports and packaging behavior

Nine review commits from the older contribution audit had never reached stable. They were carried with `git cherry-pick -x` before the new correction:

| Contribution commit | Stable commit |
| --- | --- |
| `98fa66a99e36a695f3f0d0673901ee81a32f3df9` | `e11f461d2e5d80b612ad5f0f196db452a7eb9b39` |
| `87de1554a1084d183bdaf8923c1b9eac4086172a` | `b9dc8d0d1b7edb7d672c11f17557be671bedb7b5` |
| `f48b21b95db2c3cfdcca4e3dea21b90e3bf1fd3f` | `122bf910989ef18dbbba49649b42e6ba8d51f8ad` |
| `9ad1ba3b17ee9606c919ecd0edf63ed0ce0e3a7c` | `f99832cb122e999364b0f2a4e0ae864ca07df0ae` |
| `8d98d429bb50ae5faf9031a41f026f1fc6e346f3` | `76f372604a789676c659c25c400e4970c85d4fff` |
| `257a8d09f8f338097a5948b3608973028c568ecb` | `56f5b17252eb6e181a85612b55dc99dbfe0bd968` |
| `d0768999ede2cfc31c926468698aa833fb018e1f` | `f985d52c898b74318a35c0d1cb693745b99f5a53` |
| `8802f09f1da56a3ddde3d54eaad4305445e70dec` | `0bd85550ba8d00f4a3951e29a1a2b6508810d96b` |
| `ad28f68df8bce0b2fa5709ac641d462861984e04` | `4e984b9f379febf11089ba5064f6ed54a187d42a` |
| `e2809924bfe1736b1be359f3a1ef6fc804c3db8f` | `e42ecc4c8c7161fc58c5a1012d294a558a6d9e28` |

The first backport conflicted only at the header-list conversion. Resolution retained credential names and the GitHub capability entry in the single new authority, dropping obsolete explicit req.headers path entries. Remaining cherry-picks and main merge applied cleanly.

The earlier review correction also removes stable-only changes to API error response sanitization in `error-handler.ts` and `routes/tool-gateway.ts`, returning those files exactly to the stable upstream base. Packaging must know that response bodies again follow the original upstream contract, while logging remains redacted. The stable redaction implementation is otherwise equivalent to contribution; contribution additionally inherits newer upstream private routine-webhook handling and malformed-body handling. No database/schema migration belongs to Change 05.
