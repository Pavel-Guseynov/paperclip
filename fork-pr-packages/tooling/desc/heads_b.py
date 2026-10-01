HEADS_B = [
{
"id": "07",
"branch": "pr/07-retry-skipped-review-handoff",
"title": "fix(server): retry a skipped review handoff after its blocker clears",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"When an implementer hands an issue to review, Paperclip wakes the reviewer or approver.",
"If an execution blocker is still recorded at that moment, for example the previous run has not released its environment lease, or a recovery action is unresolved, the wake is skipped.",
"That skip was terminal: the issue stayed `in_review` with no run, no retry, and no escalation.",
"This pull request records the owed handoff and retries it once the blocker clears, with escalation when the retries run out.",
"The benefit is that a review handoff no longer stalls silently.",
],
"linked": """Fixes #13532. The stranded sweep retries the handoff once the environment lease of #13532 is released; a test holds a lease, checks that no wake starts, releases it, and checks the one retried wake.

Related open pull request: #13880 fixes the same stall with a periodic pass in `resumeQueuedRuns` that re-admits skipped handoff wakes once the lease clears. It does not reference #13532. The two pull requests compete; maintainers merge one. This pull request reacts where the blocker clears (recovery-action resolve, a resolved blocker issue, and the stranded sweep), keeps a durable retry ledger with a database idempotency index, and escalates to the board after the last attempt. If #13880 merges first, this pull request should fold its escalation and its idempotency index into #13880. Otherwise this pull request supersedes #13880. #13769, #13150, #13332, and #14156 touch other parked-wake cases.""",
"what": [
"A durable review-handoff retry: once no blocker remains, Paperclip enqueues one reviewer or approver wake for the pending stage, under an idempotency key per issue, stage, and attempt. After three attempts it escalates to the board with one actionable blocker. When the board closes that escalation, a new budget of three attempts starts.",
"The owed handoff is reconciled before the recovery-action resolve response returns, when a resolved blocker issue releases its `in_review` dependents, and when the stranded sweep finds a review participant with no run. The sweep covers a blocker that clears without an event, such as a released environment lease.",
"Migration `0294` adds a partial unique index on `agent_wakeup_requests (company_id, idempotency_key)` for `review-handoff:%` keys, so concurrent retries for the same key coalesce. It follows upstream's rolling snapshot window, so `0289_snapshot.json` moves to `0294_snapshot.json`.",
"Tests on PostgreSQL drive the routes and the recovery service: one handoff after a stale blocker clears, a held and then released environment lease, a rejected second retry, coalesced concurrent triggers, a lost enqueue race, a restarted instance, escalation after the last attempt, a new budget after the board closes the escalation, every dependent of a cleared blocker, and reconciliation before the resolve response.",
],
"risks": [
"Migration: the index is created without `CONCURRENTLY`, because Drizzle migrations run in a transaction. The new key namespace has no existing rows, but the build scans `agent_wakeup_requests` once and takes a write lock for that time.",
"With the retry module in place but the route and recovery-service wiring of master, seven of the route and sweep tests fail, so every reconciliation point is needed by a test.",
],
},
{
"id": "08",
"branch": "pr/08-workspace-validation-recovery-precedence",
"title": "fix(recovery): keep the typed workspace-validation diagnosis ahead of generic failures",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Recovery records why a run failed and what the operator must do.",
"A run that fails workspace validation records a typed diagnosis: the expected and actual branch, the HEAD source, and whether a safe repair exists.",
"Generic recovery paths replaced that diagnosis: a setup wrapper that rethrew the failure lost its type, and the periodic stranded sweeps rewrote the recovery action with a generic cause.",
"This pull request keeps the typed diagnosis ahead of generic causes in every recovery path.",
"The benefit is that the operator sees the real reason and the repair guidance.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
A run failed workspace validation. Some minutes later the issue's recovery action showed `stranded_assigned_issue` with generic guidance, and the typed workspace-validation evidence was gone.

**Expected behavior**
The recovery action keeps `workspace_validation_failed` and its typed evidence until a failure with its own explicit cause replaces it.

**Steps to reproduce**
1. Let an agent run fail workspace validation (for example a branch mismatch) inside a setup step that rethrows the error as a cause.
2. Wait for the stranded sweep.
3. Read the issue's recovery action.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #14110 stops a finalization sweep from erasing a run's own error code, on a different code path. #8871, #14546, and #9641 change other parts of `recovery/service.ts`. None of them changes this precedence, so they are independent; the second one to merge needs a rebase.""",
"what": [
"A workspace-validation failure is found anywhere in the error cause chain, in the workspace restore, adapter, setup, and branch-repair failure paths.",
"A stranded sweep names no cause of its own, so a typed workspace-validation diagnosis on the latest run decides the recovery cause. An explicit, observed cause keeps precedence.",
"A sweep with a generic cause does not rewrite an active workspace-validation action. A sweep or failure that names a specific cause (for example a lost process) still updates or supersedes it.",
"A preserving upsert merges the `workspaceValidation` evidence field by field, so a partial rebuild does not drop the complete diagnosis.",
"A pending review participant whose run failed workspace validation is escalated with a notice that carries both blockers.",
"Recovery events report the cause and source of the recorded action.",
"Tests on PostgreSQL cover the wrapped failure in the restore and adapter paths, the escalation of a failed review participant, both blockers, a later generic sweep and its event, and a later sweep with a specific cause.",
],
"risks": [
"Behavior change: a stranded issue whose latest run failed workspace validation now shows `workspace_validation_failed` instead of a generic stranded cause.",
],
},
{
"id": "11",
"branch": "pr/11-native-runner-darwin-lsof-unicode",
"title": "fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"The native runner registers files that an agent delivers, and it checks the opened file descriptor first.",
"On macOS it reads the descriptor's path from `lsof -F0n`.",
"Under a non-UTF-8 locale, lsof prints every non-ASCII byte as `\\xNN` and doubles a literal backslash.",
"The handoff resolved that escaped text as a path, so a deliverable with a non-ASCII name failed with `ENOENT`.",
"This pull request pins the lsof locale and decodes the escapes.",
"The benefit is that deliverables with non-ASCII names register on macOS.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
On macOS, registering a deliverable named "猫 picture.txt" or "résumé.pdf" failed with `ENOENT` for a path that contained `\\xNN` escapes.

**Expected behavior**
The deliverable registers. The handoff resolves the real path of the opened descriptor.

**Steps to reproduce**
1. Run the server on macOS with a non-UTF-8 locale (for example `LANG=C`).
2. Let a native-runner agent register a deliverable whose filename has non-ASCII characters.
3. See the registration fail.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any, on a macOS host.

No related open pull request was found.""",
"what": [
"The lsof call pins `LC_ALL=C`, so the name field has one format on every host.",
"`\\xNN` runs are decoded as UTF-8 and `\\\\` as one backslash, in one left-to-right pass. A byte run that is not valid UTF-8 fails closed with `paperclip_runner_file_handoff_descriptor_unverifiable`.",
"Tests register deliverables through the Darwin branch on any host: they report the platform as Darwin and answer the lsof call the way lsof renders a name field. They run under a C and a UTF-8 server locale, with Chinese, accented, and backslash names, and with an invalid escape run.",
"A macOS-only test registers the same names through the real `/usr/sbin/lsof`.",
],
"risks": [
"Only the macOS branch changes. Linux and other hosts read `/proc/self/fd` or `/dev/fd` as before.",
"The macOS-only test is skipped on Linux CI. It was not run for this pull request; a run on a macOS host is still needed.",
],
},
{
"id": "12",
"branch": "pr/12-workspace-runtime-exposure-isolation",
"title": "test(server): isolate workspace runtime port reservations between tests",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Workspace runtime services claim ports, and the tests for them share module state.",
"`resetRuntimeServicesForTests()` cleared services, claims, and exposure ports, but not the in-flight port reservations.",
"A reservation left by one test could make a later test fail to claim its port.",
"This pull request clears the reservations on reset and gives the exposure tests their own identities and port range.",
"The benefit is that the workspace runtime tests do not depend on each other's leftovers.",
],
"linked": """No issue exists. The problem: a port reservation left in module state by one workspace runtime test made a later test fail to claim its port. This pull request changes test isolation only.

Related open pull request: #10624 (draft) makes `resetRuntimeServicesForTests()` stop registered services before it clears its maps. The two changes are independent; the second one to merge needs a small rebase.""",
"what": [
"`resetRuntimeServicesForTests()` also clears the in-flight port reservations.",
"The exposure lifecycle tests use their own execution workspace identity.",
"Contiguous fixture ports come from a fixed range below the Linux and Darwin ephemeral ranges and outside the runtime exposure ranges.",
"A test reserves a port, resets the services, and checks that the reservation is gone.",
],
"risks": [
"Test-only behavior: `resetRuntimeServicesForTests()` is called only by tests.",
],
},
{
"id": "14",
"branch": "pr/14-tool-gateway-client-safe-tool-names",
"title": "fix(tool-gateway): assign client-safe tool names and keep legacy names working",
"stack": ("pr/16-tool-profile-tool-name-identity", "Pull request 16 makes the catalog tool name the identity of `tool_name` selectors and adds `connectedGatewayToolNames`, the derivation of the previous gateway names. This pull request renames the exposed tools, and it uses that derivation for the legacy name. Without pull request 16, every stored `tool_name` selector would compare against the renamed tools."),
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Connected MCP tools are exposed to agents as `mcp.<app>-<connection>:<tool>`.",
"MCP clients accept only letters, digits, `_`, and `-` in tool names, and some prefix the name with the server name under a 64-character limit.",
"So clients reject or rewrite these names.",
"This pull request exposes each connected tool under a short client-safe name and keeps the previous name working.",
"The benefit is that MCP clients can call connected tools, and existing calls and policies keep working.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
An MCP client rejected the gateway's tool list because names such as `mcp.linear-workspace:create_issue` contain `.` and `:`. Clients that prefix the server name exceeded their 64-character limit.

**Expected behavior**
Every connected tool has a name with only letters, digits, `_`, and `-`, short enough for a server-name prefix.

**Steps to reproduce**
1. Connect a remote MCP application.
2. Point an MCP client that validates tool names at a named gateway.
3. See the client reject or rename the tools.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull requests: #14017 shortens the same names under a 128-character limit but keeps `.` and `:`. This pull request supersedes #14017, because its names are both client-safe and within 40 characters. #12872 changes only the display label.""",
"what": [
"Each connected tool is exposed as `<app>_<tool>`, at most 40 characters, from the same slug rules for every connection.",
"A second connection or catalog entry with the same name gets a connection suffix, then a catalog entry suffix.",
"Names are claimed across every connected tool of the company, whatever its connection's state, oldest connection and oldest catalog entry first. Adding a connection or a tool never renames an existing tool, and a connection that becomes unhealthy or disabled keeps its names.",
"A connected tool never takes a name the gateway uses for its own tools (`search_tools`, `run_tool`, and the four `paperclip_*` context tools).",
"The previous name is kept as `legacyToolName`. A call by that name still resolves, and policy selectors and `tools:use` grant scopes stored under it still match.",
"Tests on PostgreSQL list and call connected tools by the new name and by the legacy name, and check collisions, a name that stays when a second or unhealthy connection appears, reserved names, a policy and a grant scope stored under the legacy name, and the length limit.",
],
"risks": [
"Behavior change: agents see new tool names. Calls by the legacy name keep working.",
"An action request that was approved for a call under the legacy name does not match a call under the new name. The caller requests approval again. This pull request does not relax the approval snapshot comparison.",
],
},
{
"id": "15",
"branch": "pr/15-tool-gateway-context-tools-token-actions",
"title": "fix(tool-gateway): gate context tools and capabilities by token allowedActions",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"A named gateway token can limit its protocol actions, for example to `tools/list` and `tools/call`.",
"The gateway still advertised the resources and prompts capabilities on `initialize` and listed the four context tools on `tools/list`.",
"A call to those tools then failed with `gateway_token_action_denied`.",
"This pull request advertises a capability or a context tool only when the token allows its action.",
"The benefit is that a client sees only what it can use.",
],
"linked": """No issue exists. Issue description (bug):

**What happened**
A named gateway token limited to `tools/list` and `tools/call` saw `paperclip_list_resources`, `paperclip_read_resource`, `paperclip_list_prompts`, and `paperclip_get_prompt` on `tools/list`, and the resources and prompts capabilities on `initialize`. Calling them failed with `gateway_token_action_denied`.

**Expected behavior**
The gateway lists only the context tools and capabilities that the token's `allowedActions` permit.

**Steps to reproduce**
1. Create a named gateway token with `allowedActions: ["tools/list", "tools/call"]`.
2. Send `initialize` and `tools/list`.
3. See the resources and prompts capabilities and the four context tools.

**Paperclip version or commit**
`paperclipai/paperclip` master `467125faf`.

**Deployment mode**
Any.

Related open pull request: #14427 filters the same four context tools on `tools/list` by `allowedActions`. It does not change the `initialize` capabilities. This pull request supersedes #14427. If #14427 merges first, this pull request adds the capability gating on top of it.""",
"what": [
"`initialize` advertises resources and prompts only when the token allows a matching action.",
"`tools/list` includes a context tool only when the token allows its action.",
"`listToolsForNamedGateway` returns `{ tools, allowedActions }` instead of an array of tools. Its two call sites read the new shape: the named gateway route and the native-runtime assigned MCP tools.",
"A test on PostgreSQL checks the capabilities and the listed tools for a restricted and an unrestricted token.",
],
"risks": [
"API change inside the server: `listToolsForNamedGateway` has a new return shape. Both call sites in this repository are updated. A plugin or fork that calls it must read `.tools`.",
"Behavior change: a restricted token no longer sees the context tools it cannot call.",
],
},
{
"id": "16",
"branch": "pr/16-tool-profile-tool-name-identity",
"title": "fix(tool-access): use the catalog tool name as the tool_name selector identity",
"stack": None,
"thinking": [
"Paperclip is the open source app people use to manage AI agents for work.",
"Tool profiles allow or deny tools with selectors, and a `tool_name` selector stores a catalog tool name such as `query`.",
"The profile summary compares it with the catalog tool name, but the gateway policy matcher compared it with the connection-scoped gateway name `mcp.<app>-<connection>:<tool>`.",
"So an entry written through the profile UI never matched at the gateway, and deny-by-default profiles blocked the tools they allowed.",
"This pull request makes the catalog tool name the one identity, and converts stored entries that hold a gateway name.",
"The benefit is that profiles mean the same thing in the UI and at the gateway.",
],
"linked": """Fixes #11372.

No related open pull request was found.""",
"what": [
"The policy matcher compares a `tool_name` entry with the request's upstream (catalog) tool name. Tools without one (built-in and plugin tools) fall back to the request tool name.",
"A startup migration converts each stored `tool_name` entry that holds a gateway name into `catalog_entry` entries for the catalog entries that the name identifies, so its grant keeps the original connection scope. It covers the `mcp.`/`app.` names of connected tools and the `slack-bot.`/`github-bot.` names of chat bot tools, derived the way the gateway derives them (`connectedGatewayToolNames`) from the entries it can expose.",
"It matches only exact names. When two exposable entries share a name, an exclude entry excludes both (fail closed), and an include entry is left unchanged and counted. Catalog names, built-in names, and unknown names stay unchanged. It writes only if the row still holds the name it read. It returns the scanned, migrated, and unresolved counts, and server start logs them.",
"Tests on PostgreSQL check the matcher on every surface (tool lists, calls, the on-demand `run_tool`) and the migration: names read from the gateway output, a chat bot name, an inactive duplicate, ambiguous include and exclude entries, catalog and built-in names, an unknown name, the converted grant's connection scope, and a second run that changes nothing.",
],
"risks": [
"Data change at server start: matched entries change from `tool_name` to `catalog_entry`. No row gets a name that matches no catalog entry. The migration is idempotent.",
"Behavior change: a `tool_name` entry now matches by catalog name at the gateway, so a deny-by-default profile allows the tools it lists.",
],
},
]
