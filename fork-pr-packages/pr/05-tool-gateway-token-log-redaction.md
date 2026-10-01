# fix(logger): redact gateway credentials across log output

| Field | Value |
| --- | --- |
| Branch | `pr/05-tool-gateway-token-log-redaction` |
| Head | `fce03a0fd076957396dfee3cdf1d24556d4b7f77` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(logger): redact gateway credentials across log output` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/http-log-redaction.test.ts` | +1021 | -3 |
| `server/src/middleware/http-log-redaction.ts` | +460 | -18 |
| `server/src/middleware/logger.ts` | +110 | -9 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The server logs every HTTP request and many structured events.
> - Gateway session tokens (`pcgt_…`) and named gateway tokens (`pcgw_…`) could reach the logs where the HTTP redact paths did not cover them.
> - Examples are the `X-Paperclip-Tool-Gateway-Token` header, response headers, child-logger bindings, error messages, error cause chains, and messages that quote an `Authorization` value.
> - This pull request redacts credentials from one list of names and patterns in every log path.
> - The benefit is that gateway tokens do not leak into log storage.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
A rejected session token appeared in the `401` log line and in the logged error message. Response headers and unlisted credential headers such as `api-key` and `x-auth-token` were logged in clear text.

**Expected behavior**
Credential headers, fields, and token-shaped text are redacted in every log record.

**Steps to reproduce**
1. Send `POST /api/tool-gateway/tools` with an invalid token in `X-Paperclip-Tool-Gateway-Token`.
2. Read the server log.
3. See the token in the request headers and in the error message.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests:

- #10784 adds `api-key` and `x-auth-token` to the HTTP redact paths. This pull request redacts both headers through its credential header pattern (checked with a request that sends both on a `401`; master logs them). This pull request supersedes #10784. If #10784 merges first, this pull request still applies, because its header list and pattern cover the same names.
- #13742 (the `credentialValues` envelope) and #10467 (Cloudflare Access headers) change the same files for other fields. They are independent; the second one to merge needs a rebase.

## What Changed

- One list of credential header and field names (the existing credential headers plus `X-Paperclip-Tool-Gateway-Token` and the gateway token fields) drives the pino redact paths (request headers, response headers, top-level fields) and the name-based field redactor, in any separator spelling.
- The HTTP serializers redact credential-shaped headers on both the request and the response.
- `logMethod` and `streamWrite` hooks redact credential fields and remove credential text from messages and string fields: `Bearer` values, `Basic` and `Digest` values after an `Authorization` label, minted gateway tokens, and credential query parameters. Ordinary words such as "digest mismatch" stay.
- The `err` serializer folds the cause chain first, then sanitizes it, with a bounded walk. An error that cannot be read is logged as unreadable instead of aborting the log call.
- Live HTTP objects are logged as a content-free summary.
- Only the log path changes. API responses, including the error responses of secret-sensitive routes, are unchanged.
- Tests in `server/src/__tests__/http-log-redaction.test.ts` capture real pino output and check every path above with sentinel tokens.

## Verification

Head `fce03a0fd076957396dfee3cdf1d24556d4b7f77`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/http-log-redaction.test.ts) were run against the base's production code. 46 tests fail there. Sentinel tokens appear in the request headers, the response headers, unlisted credential headers, string fields, and the `401` log, and a logged error with a throwing property aborts the log call. On the head the same run gives: 108 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- The header pattern over-matches on purpose (for example any header with `token` or `secret` in its name). Such headers are logged as `[Redacted]`. Diagnostic headers such as `x-paperclip-run-id` stay visible.
- Every log record passes through one more redaction step, which also scans its string values. The walk is bounded.
- A string field whose text looks like `Bearer <word>` is redacted unless the word is a known placeholder or prose word. This can hide a harmless word in a log line, never a credential.

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
