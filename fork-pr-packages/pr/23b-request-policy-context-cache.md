# perf(tool-gateway): read the policy context once per tool discovery

| Field | Value |
| --- | --- |
| Branch | `pr/23b-request-policy-context-cache` |
| Head | `d71794f89347ffb0018e4a581db1535b66107869` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `perf(tool-gateway): read the policy context once per tool discovery` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/tool-policy-read-cache.test.ts` | +157 | -0 |
| `server/src/services/tool-access-policy.ts` | +76 | -28 |
| `server/src/services/tool-gateway.ts` | +11 | -1 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - `tools/list` runs a policy decision for every candidate tool.
> - Each decision reads the actor, the run context, the connection, the application, the catalog entry, the profile bindings, the profiles, the gateway mode, the profile entries, the policies, and the grants again.
> - A connection with many tools turns one `tools/list` into hundreds of queries.
> - This pull request memoizes those reads for one request.
> - The benefit is that the query count of `tools/list` no longer grows with the number of tools.

## Linked Issues or Issue Description

No issue exists. Issue description (enhancement):

**What existing behavior does this improve?**
`tools/list` query count.

**Subsystem affected**
Tool access policy decisions during tool gateway discovery.

**Current behavior**
Every candidate tool repeats about eight context reads. One `tools/list` over 20 tools ran 189 selects; over 5 tools, 69.

**Proposed behavior**
One request-scoped cache holds those reads. The select count is the same for 5 and for 20 tools.

**Reason and benefit**
Large connections make discovery slow and load the database.

**Breaking changes**
None. Callers that pass no cache read the database as before.

Related open pull request: #13115 speeds up the same decisions with a worker pool. It does not cache reads. The two are complementary.

This pull request does not depend on pull request 23 (`pr/23-scope-named-gateway-tool-discovery`). Both change the discovery function, so the second one to merge needs a small rebase.

## What Changed

- `createToolPolicyReadCache` memoizes the context reads of a policy decision for one request. `decide` accepts it as an option. Callers that pass no cache read the database as before.
- Discovery creates one cache per `tools/list`, seeds it with the catalog entries its candidate query already read, and passes it to every decision.
- A test on PostgreSQL counts the selects of one `tools/list` for 5 and for 20 tools of a named gateway, and checks that the counts are equal and every tool is listed. Another test changes the gateway profile between two `tools/list` calls and checks that the second call sees the change.

## Verification

Head `d71794f89347ffb0018e4a581db1535b66107869`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/tool-policy-read-cache.test.ts) were run against the base's production code. 1 test fails there. 189 selects for 20 tools against 69 for 5 tools. On the head the same run gives: 2 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- The cache lives for one request only, so a change to a policy or profile is seen by the next request.
- Within one `tools/list`, all decisions see the same snapshot of the context rows.

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
