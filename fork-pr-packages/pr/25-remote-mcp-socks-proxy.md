# feat(server): route a remote MCP connection through a declared SOCKS5 proxy

| Field | Value |
| --- | --- |
| Branch | `pr/25-remote-mcp-socks-proxy` |
| Head | `5386986ac725a14e0fc60ad6497d2bbc4496b8c2` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `feat(server): route a remote MCP connection through a declared SOCKS5 proxy` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `doc/connections/CONNECTOR-PLAYBOOK.md` | +1 | -1 |
| `server/src/__tests__/remote-mcp-socks-proxy.test.ts` | +504 | -0 |
| `server/src/services/remote-http-endpoint-guard.ts` | +84 | -0 |
| `server/src/services/remote-http-fetch.ts` | +193 | -0 |
| `server/src/services/tool-access.ts` | +35 | -10 |
| `server/src/services/tool-gateway.ts` | +7 | -4 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Agents use remote MCP servers through connections that the tool gateway dials.
> - Some remote MCP servers are reachable only through a SOCKS5 proxy, but every request dials the server directly.
> - So such a server cannot be connected today.
> - This pull request lets a connection name a `socks5h` proxy for all of its traffic, with the same network guard for the proxy as for an endpoint.
> - The benefit is that operators can connect these servers without opening the network.

## Linked Issues or Issue Description

No issue exists. Issue description (feature):

**Problem or motivation**
A remote MCP server that is reachable only through a SOCKS5 proxy cannot be connected: catalog discovery, OAuth, and tool calls all dial the server directly.

**Proposed solution**
A connection's `config.proxy` may name a `socks5h://host:port` proxy. All of that connection's traffic goes through it. The proxy host is resolved, pinned, and checked with the private-network guard.

**Alternatives considered**
A process-wide proxy (`ALL_PROXY` or an HTTP proxy). That would send every connection through the proxy and bypass the per-connection network guard.

**Roadmap alignment**
This extends the completed MCP Tool Gateway & Apps milestone; it adds no new product area.

Related open pull request: #14291 adds an outbound connector for private-network MCP servers. It is a different approach (a connector, not a proxy) and does not overlap in code.

## What Changed

- A connection's `config.proxy` may name a `socks5h://host:port` proxy (port 1080 when the URL has none). The connection's own traffic then goes through it: catalog discovery and health, OAuth metadata, client registration and token exchange, and tool calls. A connection without a proxy is unchanged.
- The proxy host is resolved, pinned, and checked with the same private-network guard as an endpoint, both when the connection is saved and when a request is sent. In a deployment that denies private networks, a connection cannot name a proxy inside them.
- The proxy resolves the target hostname (`socks5h`), so for proxied requests the private-network rule applies only to a literal target address and `localhost`. Link-local addresses stay denied in every mode: a link-local literal, and a hostname that this host resolves to a link-local address, are rejected before a socket opens. A hostname that does not resolve here is left to the proxy.
- A target hostname longer than 255 bytes, which SOCKS5 cannot carry, is rejected before a socket opens.
- A proxy URL with a username or password is rejected, because connection config is not secret storage. Schemes other than `socks5h` are rejected.
- `doc/connections/CONNECTOR-PLAYBOOK.md` describes the option.
- Tests run a SOCKS5 proxy and an MCP server, refresh a catalog and call a tool through the proxy, complete an OAuth sign-in (discovery, client registration, token exchange) through it, and check save-time rejection, the private proxy guard, the target guards, and that an unreachable proxy never falls back to a direct request.

## Verification

Head `5386986ac725a14e0fc60ad6497d2bbc4496b8c2`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/remote-mcp-socks-proxy.test.ts) were run against the base's production code. 8 tests fail there. The proxy is ignored, so requests (also the OAuth sign-in) dial the target directly, and invalid or private proxies and oversized hostnames are accepted. On the head the same run gives: 11 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change for proxied requests: the private-address guard is relaxed for the target. The proxy resolves the target hostname, so Paperclip cannot classify it, and the proxy can reach hosts in its own network by name. The operator who sets the proxy decides what it can reach. Literal private targets and `localhost` stay denied when private networks are denied.
- The link-local check for a proxied hostname uses this host's resolver. A name that resolves differently at the proxy (split-horizon DNS, rebinding) is not caught here; the proxy's own egress policy must deny link-local addresses. That is an operator decision for each deployment.
- Each proxied request makes one local DNS lookup of the target hostname for the link-local check (5 s timeout). A failed lookup does not block the request.
- Authenticated SOCKS proxies are not supported. They need secret-backed proxy credentials, which is a separate decision.

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
