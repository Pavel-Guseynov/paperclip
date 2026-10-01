HEADS_C = [
{
"id": "19",
"branch": "pr/19-stage-decision-keeps-calling-run",
"title": "fix(issues): do not cancel the calling run when recording a stage decision",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Review and approval participants are often agents that run in heartbeat runs.",
"A participant records its stage decision with `PATCH /api/issues/:id` from inside its own run.",
"The decision reassigns the issue, and the route then stopped the active issue run, which was the caller's own run.",
"So the decision request cancelled the run that was still executing it.",
"This pull request keeps the calling agent's own run when the request records a stage decision.",
"The benefit is that review and approval agents finish their runs normally.",
],
"linked": """No issue exists for the stage-decision case. Issue description (bug):

**What happened**
A reviewer agent approved a stage with `PATCH /api/issues/:id` from its heartbeat run. The route cancelled the active run of the issue, which was that same run.

**Expected behavior**
The calling agent's own run continues. Any other active run on the issue is still stopped.

**Steps to reproduce**
1. Configure an issue with a review stage whose participant is an agent.
2. Let the agent record `approved` or `changes_requested` from its run.
3. See its run cancelled.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related: issue #13730 and its open pull request #13782 fix the same self-cancel for a reassignment of the agent's own issue. #13834 keeps a review stage's run when the stage ends on a human. All three change the cancellation decision in `server/src/routes/issues.ts` for different cases. They are complementary; the second one to merge needs a rebase, and maintainers can combine the rules.""",
"what": [
"When the request records a stage decision, the active run that belongs to the calling agent and matches its run id is kept.",
"A run is kept only when it belongs to that agent, so a run id named by another agent or by a board actor never exempts a run. The run id comes from the agent's token when the `X-Paperclip-Run-Id` header is absent.",
"Every other active run on the issue is still stopped.",
"Route tests cover an approval decision, a changes-requested decision, another active run on the issue, and a missing run-id header.",
],
"risks": [
"Behavior change: a stage decision from an agent run no longer cancels that run.",
],
},
{
"id": "20",
"branch": "pr/20-conversation-continuation",
"title": "fix(conversation): let adapters declare conversation continuation",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Some adapters resume their session across turns, so a lost run can continue the conversation instead of starting over.",
"Conversation continuation was limited to the built-in adapter types in `CONVERSATION_ADAPTER_TYPES`.",
"An external adapter that resumes its session had no way to opt in, so a lost run was held for board reconciliation.",
"This pull request adds an adapter capability, `supportsConversationContinuation`, that recovery reads.",
"The benefit is that external adapters get the same continuation as built-in ones.",
],
"linked": """No issue exists. Issue description (feature):

**Problem or motivation**
A lost run of an external adapter that resumes its session was held for board reconciliation, because only built-in adapter types could continue a conversation.

**Proposed solution**
`ServerAdapterModule` gets an optional `supportsConversationContinuation` flag. Recovery treats every registered adapter that sets it like the built-in conversation adapters.

**Alternatives considered**
Adding external adapter types to the built-in list. That couples core to each external adapter.

**Roadmap alignment**
This extends the completed bounded run recovery and plugin adapter work; it adds no new product area.

No related open pull request was found.""",
"what": [
"`ServerAdapterModule` gets an optional `supportsConversationContinuation` capability.",
"`isConversationAdapter` and the run predicate used by recovery and the execution blocker include every registered adapter that declares it, read through the active adapter registration (a paused external override falls back to its built-in adapter). The built-in list is unchanged.",
"Startup recovery waits for external adapters to register before it reaps orphaned runs, so a lost run of a declaring external adapter is continued after a restart.",
"A test reaps a lost run through the heartbeat service for a registered adapter that declares the capability. The run is stamped with `continue_conversation_v1`, the issue is not blocked, and one continuation run is queued. A second adapter without the declaration is not stamped. A startup test checks that the reap waits for external adapters.",
],
"risks": [
"An adapter that declares the capability but cannot resume a session would get continuation runs that start fresh. The flag is opt-in.",
],
},
{
"id": "21",
"branch": "pr/21-shutdown-waits-for-adapter-run-stops",
"title": "fix(server): let graceful shutdown wait for in-flight adapter runs",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"On graceful shutdown, the server waits for in-flight adapter executions before it closes the database.",
"That wait was at most 5 seconds, so an adapter that needs longer to stop lost its final run update.",
"The timeout was logged at info level without the run IDs, and a queued run could start while shutdown waited.",
"This pull request makes the wait configurable with a 60-second default, logs the remaining runs as an error, and starts no queued run after shutdown begins.",
"The benefit is that runs end with their final state recorded.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
On `SIGTERM`, an adapter run that needed 20 seconds to stop its process lost its final update: the server closed the database after 5 seconds. A wakeup during the wait started a queued run that the exit then cut off.

**Expected behavior**
Shutdown waits a configurable time for in-flight runs, names the runs that did not finish, and starts no new run.

**Steps to reproduce**
1. Start a long-running adapter run.
2. Send `SIGTERM` to the server.
3. See the run left without its final status, and an info-level timeout log with no run IDs.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #6712 drains live runs on shutdown with a fixed 5-second race and cancels them. This pull request supersedes its drain part with a configurable wait; it does not cancel runs. #14796 changes how a graceful shutdown is recorded, not the drain.""",
"what": [
"The wait is configurable with `PAPERCLIP_SHUTDOWN_DRAIN_TIMEOUT_MS` or `server.shutdownDrainTimeoutMs` in the config file, from 1 ms to the largest timer delay (2147483647 ms). The default is 60 seconds. The environment variable wins over the config file. A value that is not a whole number in that range falls back to the config file value, then to the default.",
"When the wait times out, the drain logs an error with the IDs of the runs that are still executing.",
"After shutdown begins, no queued run starts in the process, whichever heartbeat service instance (scheduler or route) wakes it. The check runs before the start lock and again before each claim. The run stays queued and the next server start resumes it.",
"`docs/deploy/environment-variables.md` documents the setting.",
"Tests check the config default, the environment value, the config file key, invalid values, the error log, and that a wakeup through a second heartbeat service instance after shutdown began leaves the run queued on PostgreSQL.",
],
"risks": [
"Behavior change: graceful shutdown can now take up to 60 seconds by default instead of 5. Process supervisors with a shorter stop timeout (for example a 30-second container stop) kill the process first. The default is a maintainer decision; the variable lets an operator lower it.",
"`server/src/shutdown.test.ts` now expects the timeout at error level with the pending run IDs.",
],
},
{
"id": "22",
"branch": "pr/22-release-cancelled-interrupted-run-leases",
"title": "fix(heartbeat): release leases of runs that end without an executor",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"A run holds an environment lease while it works, and its executor releases the lease at the end of its own cleanup.",
"A legacy run that ends while no executor runs it in this process never reaches that point: a cancellation (Stop, reassignment, or the issue reaching done or cancelled), a cancellation because the agent paused, and the stale-lock sweep.",
"Its lease stays active, so the conversation blocker keeps the issue blocked until the orphaned-lease sweep recovers the lease one reaper interval later.",
"This pull request releases the lease on those paths, through the same release path the executor uses.",
"The benefit is that the issue unblocks as soon as the run ends.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
After a board user stopped an agent run, the issue stayed blocked by the conversation blocker, because the run's environment lease stayed `active`.

**Expected behavior**
When a run ends without an executor, its lease is released at once.

**Steps to reproduce**
1. Start a legacy local run that holds an environment lease.
2. Stop it from the board, pause its agent, or let the stale-lock sweep interrupt it after its process died.
3. See the lease stay `active` and the issue stay blocked until the next orphaned-lease sweep.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #11970 adds a lease TTL and a sweep for terminal runs, #13880 re-admits wakes blocked by a held lease, and #14286 is a test-only change for orphaned-run leases. None releases the lease on these three paths. They are independent.""",
"what": [
"A cancellation (Stop, reassignment, or the issue reaching done or cancelled), a cancellation because the agent paused, and the stale-lock sweep release the run's environment leases when the run is a legacy run and no executor in this process owns it.",
"They use the release path the executor uses. A run with an active executor is unchanged: the executor releases after its workspace copy-back.",
"Tests on PostgreSQL acquire a local lease through the environment runtime, end the run through each path, and check that the lease is released and the issue is no longer blocked.",
],
"risks": [
"A failed release is logged and does not stop the cancellation or the sweep. The orphaned-lease sweep still recovers such a lease later.",
"Pull request 22b adds the live-process guard on top of this change.",
],
},
{
"id": "22b",
"branch": "pr/22b-guard-environment-lease-release-on-live-runs",
"title": "fix(heartbeat): keep a run's lease while its detached local process runs",
"stack": ("pr/22-release-cancelled-interrupted-run-leases", "This pull request guards the release helper that pull request 22 adds (`releaseLeasesForRunWithoutExecutor`) and the orphaned-lease sweep."),
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"A local adapter run can leave a detached child process that this server holds no handle for.",
"A Stop cannot signal such a child, so the child can keep running after its run row is terminal.",
"Releasing that run's lease, when the run ends without an executor or in the orphaned-lease sweep, frees the environment while the child still works in it.",
"This pull request keeps the lease while the tracked local process is alive, with the same liveness rule the reaper uses.",
"The benefit is that a new run cannot take an environment that a live process still uses.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
With pull request 22 applied, a Stop of a run whose detached local child kept running released the run's lease. A new run could then acquire the environment while the old child still wrote to it. The orphaned-lease sweep did the same on master.

**Expected behavior**
The lease stays while the run's tracked process or process group is alive, and the sweep recovers it after the process exits.

**Steps to reproduce**
1. Start a legacy local run whose adapter spawns a detached child.
2. Stop the run while the child is alive.
3. See the lease released while the child runs.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf` with pull request 22 applied.

**Deployment mode**
Any, for local adapters.

Related open pull request: #11970 also keeps leases for live runs as part of a lease TTL change. It does not cover this release path. They are independent.""",
"what": [
"A legacy run of an adapter whose local child the reaper tracks keeps its lease while that child's PID or process group is alive, or while this server still holds its process handle. This is the rule the reaper applies before it ends such a run.",
"The orphaned-lease sweep defers such a lease, so the rows behind it still reach the page, and recovers it once the process exits.",
"Tests spawn a real child process, end the run with a Stop, and check that the lease stays active after the Stop and in the sweep, and that the sweep recovers it after the child exits.",
],
"risks": [
"A lease whose process never exits stays held. The reaper handles such a process with its existing rules.",
"Remote and sandbox adapters are unchanged: the guard applies only to adapters whose local child the reaper tracks.",
],
},
{
"id": "23",
"branch": "pr/23-scope-named-gateway-tool-discovery",
"title": "perf(tool-gateway): scope named gateway discovery when its profile alone decides",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"A named gateway exposes the tools that its profiles and the company policies allow.",
"Discovery runs a policy decision for every connected tool of the company, and each decision reads its context from the database.",
"A gateway whose profile includes one connection still pays for every other connection's tools, which all come back denied.",
"This pull request reads only the profile's tools when the gateway profile alone can allow a tool.",
"The benefit is a faster `tools/list` with the same visible tools.",
],
"linked": """No issue exists. Issue description (enhancement):

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

Related open pull request: #13115 speeds up the same discovery with a bounded worker pool and early exit. It does not scope the candidates. The two are complementary; the second one to merge needs a rebase. Pull request 23b (`pr/23b-request-policy-context-cache`) is a separate, independent change to the same discovery.""",
"what": [
"The policy service gets `namedGatewayDiscoveryScope`. It returns the application, connection, and catalog entry IDs that the gateway's active profiles include, but only when nothing else can allow a tool: the gateway uses `gateway_only`, it has a gateway profile binding, no bound profile allows by default, the company has no allow, trust-rule, or approval policy (an app-wizard approval policy cannot reach a tool outside the profiles, so it does not count), the actor has no `tools:use` grant, and every include entry selects by ID. In every other case it returns null.",
"Discovery then reads only those tools. With null it reads every company tool, as before. Each candidate still goes through the same policy decision.",
"Discovery filters by the application of the connection, the same ID the policy decision uses.",
"Tests create the profile, gateway, and policy through the production services and count the policy decisions during `tools/list`. They check the connection and application scopes, that an allow policy outside the profile still lists its tool, that a gateway with context profiles evaluates every tool, and that each fallback condition (an allow-by-default profile, an allow, trust-rule, or approval policy, a `tools:use` grant, a `tool_name` include) returns null while the app-wizard approval policy does not.",
],
"risks": [
"If a future policy kind can allow a tool outside the profiles, `namedGatewayDiscoveryScope` must return null for it. The function sits next to `decide` for that reason.",
"The default profile mode stays effective: any mode other than `gateway_only` reads every company tool.",
],
},
{
"id": "23b",
"branch": "pr/23b-request-policy-context-cache",
"title": "perf(tool-gateway): read the policy context once per tool discovery",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"`tools/list` runs a policy decision for every candidate tool.",
"Each decision reads the actor, the run context, the connection, the application, the catalog entry, the profile bindings, the profiles, the gateway mode, the profile entries, the policies, and the grants again.",
"A connection with many tools turns one `tools/list` into hundreds of queries.",
"This pull request memoizes those reads for one request.",
"The benefit is that the query count of `tools/list` no longer grows with the number of tools.",
],
"linked": """No issue exists. Issue description (enhancement):

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

This pull request does not depend on pull request 23 (`pr/23-scope-named-gateway-tool-discovery`). Both change the discovery function, so the second one to merge needs a small rebase.""",
"what": [
"`createToolPolicyReadCache` memoizes the context reads of a policy decision for one request. `decide` accepts it as an option. Callers that pass no cache read the database as before.",
"Discovery creates one cache per `tools/list`, seeds it with the catalog entries its candidate query already read, and passes it to every decision.",
"A test on PostgreSQL counts the selects of one `tools/list` for 5 and for 20 tools of a named gateway, and checks that the counts are equal and every tool is listed. Another test changes the gateway profile between two `tools/list` calls and checks that the second call sees the change.",
],
"risks": [
"The cache lives for one request only, so a change to a policy or profile is seen by the next request.",
"Within one `tools/list`, all decisions see the same snapshot of the context rows.",
],
},
{
"id": "24",
"branch": "pr/24-run-gateway-token-lifetime",
"title": "fix(heartbeat): keep a heartbeat-run gateway token valid while its run runs",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Heartbeat issues each run named gateway tokens so the run can use its MCP tools.",
"Those tokens expired after one hour, although the run could still be running.",
"A longer run then lost its tools, and every later `tools/list` or `tools/call` failed with `gateway_token_expired`. The token list also showed a live run's token as expired.",
"This pull request issues the run's tokens without a time expiry, so the gateway's run-state check ends them with the run.",
"The benefit is that long runs keep their tools.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
A heartbeat run that worked longer than one hour got `gateway_token_expired` on every MCP tool call.

**Expected behavior**
The run's gateway token works while the run is running and stops when the run stops.

**Steps to reproduce**
1. Start a heartbeat run that uses MCP tools through its named gateway.
2. Keep it running for more than one hour.
3. See the tool calls fail with `gateway_token_expired`.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

No related open pull request was found.""",
"what": [
"Heartbeat issues the runtime MCP token and the Paperclip-managed MCP tokens of a run without a time expiry. The gateway's existing run-state check rejects such a token with `gateway_token_run_inactive` as soon as the run is no longer running, so the token lives exactly as long as its run. The owner note says so, and the token list shows \"No expiry\" instead of \"Expired\".",
"The gateway is unchanged: a token with an explicit expiry still expires, whatever its subject.",
"Tests issue the token through heartbeat, check the stored token, move the clock two hours ahead, and check a running run's token, a finished run's token, and a token with an explicit expiry. The existing runtime MCP test now expects no expiry on the run tokens.",
],
"risks": [
"Behavior change: a leaked heartbeat-run token stays valid until its run stops running, not for at most one hour.",
"Tokens issued before the upgrade keep their stored one-hour expiry.",
],
},
]
