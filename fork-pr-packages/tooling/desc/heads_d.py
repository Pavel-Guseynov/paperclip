HEADS_D = [
{
"id": "25",
"branch": "pr/25-remote-mcp-socks-proxy",
"title": "feat(server): route a remote MCP connection through a declared SOCKS5 proxy",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Agents use remote MCP servers through connections that the tool gateway dials.",
"Some remote MCP servers are reachable only through a SOCKS5 proxy, but every request dials the server directly.",
"So such a server cannot be connected today.",
"This pull request lets a connection name a `socks5h` proxy for all of its traffic, with the same network guard for the proxy as for an endpoint.",
"The benefit is that operators can connect these servers without opening the network.",
],
"linked": """No issue exists. Issue description (feature):

**Problem or motivation**
A remote MCP server that is reachable only through a SOCKS5 proxy cannot be connected: catalog discovery, OAuth, and tool calls all dial the server directly.

**Proposed solution**
A connection's `config.proxy` may name a `socks5h://host:port` proxy. All of that connection's traffic goes through it. The proxy host is resolved, pinned, and checked with the private-network guard.

**Alternatives considered**
A process-wide proxy (`ALL_PROXY` or an HTTP proxy). That would send every connection through the proxy and bypass the per-connection network guard.

**Roadmap alignment**
This extends the completed MCP Tool Gateway & Apps milestone; it adds no new product area.

Related open pull request: #14291 adds an outbound connector for private-network MCP servers. It is a different approach (a connector, not a proxy) and does not overlap in code.""",
"what": [
"A connection's `config.proxy` may name a `socks5h://host:port` proxy (port 1080 when the URL has none). The connection's own traffic then goes through it: catalog discovery and health, OAuth metadata, client registration and token exchange, and tool calls. A connection without a proxy is unchanged.",
"The proxy host is resolved, pinned, and checked with the same private-network guard as an endpoint, both when the connection is saved and when a request is sent. In a deployment that denies private networks, a connection cannot name a proxy inside them.",
"The proxy resolves the target hostname (`socks5h`), so for proxied requests the private-network rule applies only to a literal target address and `localhost`. Link-local addresses stay denied in every mode: a link-local literal, and a hostname that this host resolves to a link-local address, are rejected before a socket opens. A hostname that does not resolve here is left to the proxy.",
"A target hostname longer than 255 bytes, which SOCKS5 cannot carry, is rejected before a socket opens.",
"A proxy URL with a username or password is rejected, because connection config is not secret storage. Schemes other than `socks5h` are rejected.",
"`doc/connections/CONNECTOR-PLAYBOOK.md` describes the option.",
"Tests run a SOCKS5 proxy and an MCP server, refresh a catalog and call a tool through the proxy, complete an OAuth sign-in (discovery, client registration, token exchange) through it, and check save-time rejection, the private proxy guard, the target guards, and that an unreachable proxy never falls back to a direct request.",
],
"risks": [
"Behavior change for proxied requests: the private-address guard is relaxed for the target. The proxy resolves the target hostname, so Paperclip cannot classify it, and the proxy can reach hosts in its own network by name. The operator who sets the proxy decides what it can reach. Literal private targets and `localhost` stay denied when private networks are denied.",
"The link-local check for a proxied hostname uses this host's resolver. A name that resolves differently at the proxy (split-horizon DNS, rebinding) is not caught here; the proxy's own egress policy must deny link-local addresses. That is an operator decision for each deployment.",
"Each proxied request makes one local DNS lookup of the target hostname for the link-local check (5 s timeout). A failed lookup does not block the request.",
"Authenticated SOCKS proxies are not supported. They need secret-backed proxy credentials, which is a separate decision.",
],
},
{
"id": "26",
"branch": "pr/26-external-mcp-runless-issue-update",
"title": "fix(issues): let an external client's agent key update authorized issues without a run",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"An external MCP client or the CLI can act for an agent with a standard agent API key.",
"Such a client has no heartbeat run.",
"Every `PATCH /api/issues/:id` that changed a field or added a comment failed for it, because the cross-issue influence check needs a run, and an in-progress issue needs the run header.",
"This pull request lets a standard agent key update an issue its agent is authorized to edit, without a run.",
"The benefit is that external clients can do the issue work that their agent may do.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
An external MCP client that authenticated with a standard agent API key got `403` "Cross-issue writes need a run" on `PATCH /api/issues/:id`, and `401` "Agent run id required" on its own in-progress issue.

**Expected behavior**
The key can update an issue its agent is authorized to edit, including blocker changes and the inline comment. It gets `409` while a run holds the issue.

**Steps to reproduce**
1. Create a standard agent API key.
2. Send `PATCH /api/issues/:id` with a title or blocker change for an issue assigned to that agent, without `X-Paperclip-Run-Id`.
3. See `403`.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #14683 adds a run-less `service` key scope that can comment on issues; `PATCH` still needs a run there. It solves a different part of the same need; the two are independent. #14562, #13926, and #14087 change run-scoped writes in `cross-issue-influence-limit.ts`; the second one to merge needs a rebase.""",
"what": [
"A standard-scope agent API key without a run may `PATCH` an issue that its agent is otherwise authorized to edit, including blocker changes and the inline comment. Company and responsible-user scope, status transitions, and the other governance checks still apply.",
"These runless writes have no run to count against, so they skip the per-run cross-issue influence cap.",
"The key may edit its own in-progress issue only while no run holds it. A checkout or execution lock answers `409`.",
"Restricted keys, agent JWTs, standalone comments, and other agent mutations still require a run.",
"`doc/SPEC-implementation.md` and `docs/api/issues.md` describe the contract.",
"Route tests on PostgreSQL, with the actor the agent-key middleware builds (acting for its responsible user), check a title and blocker update, the inline comment, the `409` while a checkout or execution run holds the issue and the success after the run ended, the company boundary, and that a restricted key still needs a run.",
],
"risks": [
"Behavior change: runless writes from a standard external key skip the cross-issue influence limit. That limit counts writes per run, and these writes have no run. Each write is still checked against the agent's own authorization and logged in the activity log.",
"Plugin host services that call `issueService` without a run are unchanged: the execution-lock rule is applied in the route, not in the shared service.",
],
},
{
"id": "27a",
"branch": "pr/27a-run-status-transition-authority",
"title": "refactor(heartbeat): route every run status write through one transition authority",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Heartbeat runs move through statuses such as queued, running, succeeded, failed, and cancelled.",
"`heartbeat_runs.status` was written from about thirty places, each with its own conditional update.",
"Nothing recorded which status a run left, when the change happened relative to a concurrent change, or whether a write changed the status at all.",
"This pull request makes one function the only writer of the status, under a row lock, and makes it return the transition.",
"The benefit is one place that knows every status change, which later work can build on.",
],
"linked": """No issue exists. Issue description (enhancement):

**What existing behavior does this improve?**
How the server writes `heartbeat_runs.status`.

**Subsystem affected**
Heartbeat, recovery, run dispatch, the wake queue, the watchdog, and the native runtime.

**Current behavior**
About thirty call sites write the status with their own conditional updates. Three of them set it through a conditional spread. No write reports the previous status or orders itself against a concurrent write.

**Proposed behavior**
`transitionHeartbeatRunStatus` is the only writer. It locks the row, reads `clock_timestamp()` under the lock, writes the status and a patch of other columns, and returns the run and the transition.

**Reason and benefit**
One authority makes concurrent transitions serialize and lets later changes react to committed transitions.

**Breaking changes**
None. Each caller keeps its compare-and-set condition.

No related open pull request was found. #11394 copies status publish logic into the recovery backstop; it does not overlap.""",
"what": [
"`transitionHeartbeatRunStatus` is the only writer of the status. It locks the run row, reads `clock_timestamp()` under that lock, writes the new status with a patch of other columns, and returns the run with the transition: previous status, new status, the timestamp, and an event ID unique per transition.",
"A transition to the status the run already has writes only the patch and reports no transition. An extra condition keeps each caller's compare-and-set: a run that does not match changes nothing.",
"A patch cannot carry the status: its type omits the column, and the function rejects one at runtime. The status helpers in heartbeat and legacy execution recovery take the same status-free patch type.",
"Every status write is converted, including three that set the status through a conditional spread in the native run finalizer and the native session executor. Where those sites update other columns without a status change, they keep a plain update.",
"A test scans `server/src` and fails on any `heartbeat_runs` update outside the authority that can set the status, including through a spread, a variable whose declaration does not exclude the status, or raw SQL. Tests on PostgreSQL check that a concurrent transition waits for the lock and sees the committed status, same-status writes, unique event IDs, rollback, a non-matching condition, and the rejected patch.",
],
"risks": [
"Each status write now takes a row lock first. Two concurrent transitions of one run serialize instead of racing.",
"The static check is a source scan. A new status write in an unusual form could pass it; the runtime rejection of a status in the patch still applies.",
],
},
{
"id": "27b",
"branch": "pr/27b-database-post-commit-hook",
"title": "feat(db): run registered work after a transaction commits",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Server code often writes inside a database transaction.",
"Some of that code must act on the result only once it is durable, for example to publish an event about a status change.",
"Acting inside the transaction publishes changes that can still roll back, and acting after the call returns makes every caller thread the work out of the transaction.",
"This pull request adds post-commit hooks to the database package.",
"The benefit is that code can register work that runs only after a commit.",
],
"linked": """No issue exists. Issue description (feature):

**Problem or motivation**
Code inside a transaction cannot run work only after that transaction commits.

**Proposed solution**
`registerPostCommitHook(tx, hook)` registers work on a transaction of a `createDb` database. The hooks run after the top-level transaction commits.

**Alternatives considered**
Returning the work to each caller, which every call site would have to thread through.

**Roadmap alignment**
Infrastructure for existing features; it adds no new product area.

No related open pull request was found.""",
"what": [
"`registerPostCommitHook(tx, hook)` registers work on a transaction of a `createDb` database. The hooks run in order after the top-level transaction commits.",
"A hook registered in a nested transaction is dropped when that savepoint rolls back, and every hook is dropped when the top-level transaction rolls back.",
"The function returns `false` outside a transaction, so the caller can run the work itself.",
"A failing hook is reported with `console.error` and does not fail the committed transaction or stop the later hooks.",
"`createDb` installs the tracking on every database it creates.",
"Tests on PostgreSQL check that a hook sees the committed row from another connection, that rollback and savepoint rollback drop hooks, the failure handling, and the call outside a transaction.",
],
"risks": [
"No existing caller changes. The tracking wraps the `transaction` method of each `createDb` database.",
],
},
{
"id": "27c",
"branch": "pr/27c-lifecycle-event-emission",
"title": "feat(server): log committed run and task status changes",
"stack": ("pr/27a-run-status-transition-authority + pr/27b-database-post-commit-hook", "This head is based on a plain merge commit of pull requests 27a and 27b. It reads the transition that 27a returns and logs through the post-commit hook that 27b adds. Until both merge, this pull request also shows their commits."),
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Operators want to follow when runs start, finish, or fail, and when tasks enter review.",
"Run and task status changes leave no record outside the database rows and the activity log, which has no previous status for most writers.",
"So an operator has to poll the database.",
"This pull request logs one structured record for each committed run and task status change, after the commit.",
"The benefit is that log pipelines can follow lifecycle changes without database access.",
],
"linked": """No issue exists. Issue description (feature):

**Problem or motivation**
An operator cannot follow run and task status changes from the logs, and the activity log does not carry the previous status for most writers.

**Proposed solution**
Log one structured record per committed status change, with the previous and new status taken at the transition, after the transaction commits.

**Alternatives considered**
Deriving the change from activity-log details, which do not carry the previous status reliably.

**Roadmap alignment**
This extends the completed activity log and run recovery work; it adds no new product area.

This is server log output (pino). It is not Telemetry, not an OpenTelemetry span, and not a run-log event.

No related open pull request was found.""",
"what": [
"Every heartbeat run transition from the status authority logs one record, \"heartbeat run status changed\", with the run, company, agent, task, previous and new status, whether the new status is terminal, the `clock_timestamp()` read under the row lock, and the transition's event ID.",
"Every status change made through the issue update logs one record, \"task status changed\", with the task, the previous and new status read under the row lock, the assignee, and the acting run.",
"Both records are logged through the server logger only after the transaction that made the change commits, through the post-commit hooks. A rolled-back change logs nothing. A write that keeps the status logs nothing, so entering review logs exactly one record.",
"`doc/SPEC-implementation.md` lists the records under logging.",
"Tests on PostgreSQL check one record after commit and none before, none for a rolled-back or same-status write, exactly one record on review entry, and unique event IDs.",
],
"risks": [
"Task records cover status changes made through `issueService.update`. Other code paths that write an issue status directly do not log a record yet.",
"The activity log is unchanged. Its timestamps still come from the existing column defaults, not from `clock_timestamp()`. Only the lifecycle record carries the `clock_timestamp()` that the transition reads under the row lock.",
"Log volume grows by one line per status change.",
],
},
{
"id": "27d",
"branch": "pr/27d-cancellation-attribution",
"title": "feat(heartbeat): attribute cancelled runs in their lifecycle record",
"stack": ("pr/27c-lifecycle-event-emission", "This pull request adds a field to the run lifecycle record that pull request 27c adds."),
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"A run can be cancelled by a board Stop, a reassignment, an agent pause, a discarded queued message, or a lost controller lease.",
"The run lifecycle record of a cancellation said only that the run moved to `cancelled`.",
"So an operator could not tell why.",
"This pull request adds the cause and the requester, read from the committed run row, to that record.",
"The benefit is that cancellations can be explained from the logs.",
],
"linked": """No issue exists. Issue description (feature):

**Problem or motivation**
A cancelled run's lifecycle record does not say who or what cancelled it.

**Proposed solution**
The record of a transition to `cancelled` carries the run's error code, the error message, and the requester that the cancel path recorded.

**Alternatives considered**
A new `cancel_source` column on `heartbeat_runs`, threaded through every cancel path. The run row already holds the cause in `errorCode`.

**Roadmap alignment**
This extends the completed activity log and action attribution milestone.

Related open pull request: #4510 adds a `cancel_source` column for the same purpose. This pull request needs no schema change because every cancel path already sets the run's error code. It supersedes #4510 for lifecycle attribution.""",
"what": [
"The record of a transition to `cancelled` carries a `cancellation` object: the run's error code (the cause the cancel path recorded, or null when it recorded none), the error message, and the requester when the cancel path recorded one, which is the board user of a Stop or the actor of a comment interrupt.",
"Every value comes from the committed run row. No cancel path changes.",
"`doc/SPEC-implementation.md` mentions the attribution.",
"Tests on PostgreSQL stop a run through the board route and pause its agent, and check the attribution in each record.",
],
"risks": [
"A cancel path that records no requester produces a record without one.",
],
},
{
"id": "28",
"branch": "pr/28-runchildprocess-stdin-stream-error",
"title": "fix(adapter-utils): fail the owning run when writing child stdin fails",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Adapters start agent CLIs as child processes and write the prompt to the child's stdin.",
"`runChildProcess` wrote that stdin without an error listener on the stream.",
"When the child closed its stdin before or during the write, the write failed with `EPIPE`, the stream emitted an unhandled error, and the server process crashed with every other run.",
"This pull request handles the stdin error and fails only the owning run.",
"The benefit is that one misbehaving child cannot stop the server.",
],
"linked": """No issue exists in this form; see the related pull requests below. Issue description (bug):

**What happened**
A child process that closed its stdin early made the prompt write fail with `EPIPE`. The unhandled stream error crashed the server, and every active run stopped.

**Expected behavior**
The run that owns the child fails with a clear error. Other runs continue.

**Steps to reproduce**
1. Configure an adapter command that exits or closes stdin at once.
2. Start a run with a large prompt.
3. See the server process exit.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests that fix the same crash:

- #12324 adds a stdin error listener and ignores `EPIPE`, so the run result follows the child's exit code.
- #14057 adds a listener and treats `EPIPE` and `ERR_STREAM_DESTROYED` as non-fatal; the child's exit decides the result.
- #7757 and #2111 are older versions of the same fix.

This pull request differs in one decision: a run whose prompt did not reach the child fails with the stdin error code, instead of taking the child's exit code. Maintainers choose the semantics. If they want the run to fail, this pull request supersedes the others. If they prefer the exit code to decide, this pull request should fold its tests into #14057.""",
"what": [
"`runChildProcess` listens for errors on the child's stdin whenever it writes stdin. A failed write is reported through `onLogError` with the owning run ID. The child gets `SIGTERM`, then `SIGKILL` after the grace period, and the result carries the error code (`EPIPE`, or `child_stdin_write_failed` without one) and a non-zero exit code. Other runs continue.",
"When the child has already exited before the write, the write is still skipped and the result follows the child's exit, as on master.",
"The adapter-utils README describes the contract.",
"Tests run real child processes that close their end of stdin before and during a 2 MB write next to a healthy run, and check that only the owning run fails. Another test checks that a child that ignores `SIGTERM` is killed.",
],
"risks": [
"Behavior change: a run whose child closes stdin early, while it keeps running, now fails with the stdin error even if the child then exits with code 0. A child that already exited before the write keeps the master behavior.",
],
},
]
