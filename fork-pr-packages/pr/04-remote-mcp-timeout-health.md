# fix(tool-gateway): distinguish call timeouts from connection failure

| Field | Value |
| --- | --- |
| Branch | `pr/04-remote-mcp-timeout-health` |
| Head | `59442b8551f90ff4329dd90cd20b2f53ffa08cc1` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(tool-gateway): distinguish call timeouts from connection failure` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/remote-mcp-timeout-health.test.ts` | +681 | -0 |
| `server/src/services/tool-gateway.ts` | +106 | -7 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Agents call tools on remote MCP connections through the tool gateway.
> - When one remote tool call hits its deadline, the gateway marks the whole connection as `error`.
> - Discovery then hides every tool of that connection until an explicit health check, although one timeout proves nothing about the connection.
> - This pull request marks the connection `degraded` after an abandoned call and keeps a connection in that state in discovery.
> - The benefit is that one slow call does not remove all tools of a connection.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
One remote MCP `tools/call` that timed out set the connection health to `error`. Every tool of the connection disappeared from `tools/list` until a health check.

**Expected behavior**
A timeout marks the connection `degraded`. Its tools stay listed. The next exchange clears the warning or marks the connection `error`. A connection that is `degraded` for another reason stays hidden, as before.

**Steps to reproduce**
1. Connect a remote MCP server whose tool does not answer before the call deadline.
2. Call that tool once through the gateway.
3. List tools: the connection's tools are gone.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull request: #11910 keeps the health `ok` after a timed-out call and also after a JSON-RPC error. This pull request supersedes #11910: it covers the timeout case, records the outcome as `degraded` with an audit failure kind, and keeps protocol failures as connection errors. If maintainers prefer #11910, the `degraded` state and the audit `failureKind` can fold into it. #12611 changes HTTP status mapping of tool errors and does not overlap.

## What Changed

- An abandoned call marks the connection `degraded` with the message "Remote MCP tool call timed out.", not `error`.
- Gateway discovery serves a connection in exactly that state. The next call clears the warning or marks the connection `error`. A connection that is `degraded` for another reason (insufficient OAuth scope, a Vercel Connect failure, a credential due for rotation) stays hidden, as on master.
- The timeout is recorded only when the connection row is unchanged since the call started, so it never overwrites a newer write, also one that sets no observation time.
- Failed remote calls carry a `failureKind` in the audit: `invocation_timeout`, `transport_failure`, or `protocol_failure`.
- Tests on PostgreSQL run the gateway against a remote MCP fake: abandoned calls, a connection degraded for another reason, recovery, transport and protocol failures, and timeouts after a newer health state, with and without an observation time.

## Verification

Head `59442b8551f90ff4329dd90cd20b2f53ffa08cc1`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/remote-mcp-timeout-health.test.ts) were run against the base's production code. 9 tests fail there. After a timeout the connection health is `error` instead of `degraded`, the tools disappear, and the audit has no `failureKind`. On the head the same run gives: 12 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: after a timed-out call, the connection's tools stay listed with health `degraded`. A connection that really failed is still marked `error` by the next exchange or by a transport or protocol failure.
- Discovery recognizes the timeout state by its health message. A later change of that message must change both places; both use one constant.

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
