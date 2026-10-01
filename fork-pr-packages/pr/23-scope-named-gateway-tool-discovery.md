# perf(tool-gateway): scope named gateway discovery when its profile alone decides

| Field | Value |
| --- | --- |
| Branch | `pr/23-scope-named-gateway-tool-discovery` |
| Head | `78294a7847dc62a6c6ad096afdd6f8b892a03fad` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `perf(tool-gateway): scope named gateway discovery when its profile alone decides` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/scope-named-gateway-tool-discovery.test.ts` | +255 | -0 |
| `server/src/services/tool-access-policy.ts` | +88 | -0 |
| `server/src/services/tool-gateway.ts` | +37 | -8 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - A named gateway exposes the tools that its profiles and the company policies allow.
> - Discovery runs a policy decision for every connected tool of the company, and each decision reads its context from the database.
> - A gateway whose profile includes one connection still pays for every other connection's tools, which all come back denied.
> - This pull request reads only the profile's tools when the gateway profile alone can allow a tool.
> - The benefit is a faster `tools/list` with the same visible tools.

## Linked Issues or Issue Description

No issue exists. Issue description (enhancement):

**What existing behavior does this improve?**
`tools/list` on a named gateway.

**Subsystem affected**
Tool gateway discovery and the tool access policy service.

**Current behavior**
Discovery runs a policy decision for every connected tool of the company, also when the gateway's deny-by-default profile includes only one connection.

**Proposed behavior**
When nothing but the gateway's own profiles can allow a tool, discovery reads only the tools those profiles include. Every candidate still goes through the same policy decision.

**Reason and benefit**
Companies with many connections pay for tools a gateway can never show.

**Breaking changes**
None. The visible tools do not change.

Related open pull request: #13115 speeds up the same discovery with a bounded worker pool and early exit. It does not scope the candidates. The two are complementary; the second one to merge needs a rebase. Pull request 23b (`pr/23b-request-policy-context-cache`) is a separate, independent change to the same discovery.

## What Changed

- The policy service gets `namedGatewayDiscoveryScope`. It returns the application, connection, and catalog entry IDs that the gateway's active profiles include, but only when nothing else can allow a tool: the gateway uses `gateway_only`, it has a gateway profile binding, no bound profile allows by default, the company has no allow, trust-rule, or approval policy (an app-wizard approval policy cannot reach a tool outside the profiles, so it does not count), the actor has no `tools:use` grant, and every include entry selects by ID. In every other case it returns null.
- Discovery then reads only those tools. With null it reads every company tool, as before. Each candidate still goes through the same policy decision.
- Discovery filters by the application of the connection, the same ID the policy decision uses.
- Tests create the profile, gateway, and policy through the production services and count the policy decisions during `tools/list`. They check the connection and application scopes, that an allow policy outside the profile still lists its tool, that a gateway with context profiles evaluates every tool, and that each fallback condition (an allow-by-default profile, an allow, trust-rule, or approval policy, a `tools:use` grant, a `tool_name` include) returns null while the app-wizard approval policy does not.

## Verification

Head `78294a7847dc62a6c6ad096afdd6f8b892a03fad`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/scope-named-gateway-tool-discovery.test.ts) were run against the base's production code. 11 tests fail there. Discovery evaluates the other connections' tools, and `namedGatewayDiscoveryScope` does not exist. The allow-policy guard test passes on both. On the head the same run gives: 12 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- If a future policy kind can allow a tool outside the profiles, `namedGatewayDiscoveryScope` must return null for it. The function sits next to `decide` for that reason.
- The default profile mode stays effective: any mode other than `gateway_only` reads every company tool.

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
