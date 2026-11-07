<p align="center">
  <img src="doc/assets/banner.jpg" alt="Paperclip is the app people use to manage AI agents for work." width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://docs.paperclip.ing"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/paperclipai/paperclip"><strong>GitHub</strong></a> &middot;
  <a href="https://discord.gg/m4HZY7xNG3"><strong>Discord</strong></a> &middot;
  <a href="https://x.com/papercliping"><strong>Twitter</strong></a> &middot;
  <a href="https://paperclip.ing"><strong>Website</strong></a>
</p>

<p align="center">
  <a href="https://github.com/paperclipai/paperclip/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/paperclipai/paperclip/stargazers"><img src="https://img.shields.io/github/stars/paperclipai/paperclip?style=flat" alt="Stars" /></a>
  <a href="https://discord.gg/m4HZY7xNG3"><img src="https://img.shields.io/badge/discord-join-7289da" alt="Discord" /></a>
  <a href="https://superagent.sh"><picture><source media="(prefers-color-scheme: dark)" srcset="https://www.superagent.sh/api/badge/paperclipai/paperclip/shield.svg?theme=dark&accent=teal&variant=scanned" /><img src="https://www.superagent.sh/api/badge/paperclipai/paperclip/shield.svg?theme=light&accent=teal&variant=scanned" alt="Security posture verified by Superagent" /></picture></a>
</p>

<p align="center">
  <a href="https://www.star-history.com/paperclipai/paperclip"><img src="https://api.star-history.com/badge?repo=paperclipai/paperclip" alt="Star History Rank" /></a>
</p>

<br/>

<div align="center">
  <video src="https://github.com/user-attachments/assets/773bdfb2-6d1e-4e30-8c5f-3487d5b70c8f" width="600" controls></video>
</div>

<p align="center">
  <a href="https://paperclip.ing/waitlist/"><strong>Sign up for the Paperclip Cloud waitlist →</strong></a>
</p>

<br/>

# Paperclip is the app people use to manage AI agents for work.

Open-source orchestration for teams of AI agents.

**If OpenClaw is an _employee_, Paperclip is the _company_.**

Paperclip is a Node.js server and React UI that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track work and costs from one dashboard. Choose models and harnesses per agent while keeping your team's tasks, skills, permissions, and history in one place.

It looks like a task manager. Under the hood: org charts, budgets, governance, goal alignment, and agent coordination.

**Manage business goals, not pull requests.**

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the goal | _"Build the #1 AI note-taking app to $1M MRR."_                    |
| **02** | Hire the team   | CEO, CTO, engineers, designers, marketers — any bot, any provider. |
| **03** | Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard.  |

<br/>

<div align="center">
<table>
  <tr>
    <td align="center" rowspan="2"><strong>Works<br/>with</strong></td>
    <td align="center" valign="top"><img src="doc/assets/logos/openclaw.svg" width="32" height="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
    <td align="center" valign="top"><img src="doc/assets/logos/claude.svg" width="32" height="32" alt="Claude Code" /><br/><sub>Claude Code</sub></td>
    <td align="center" valign="top"><img src="ui/public/brands/codex-color.svg" width="32" height="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="ui/public/brands/adapters/cursor-dark.svg" /><img src="ui/public/brands/adapters/cursor.svg" width="32" height="32" alt="Cursor and Cursor Cloud" /></picture><br/><sub>Cursor<br/>+ Cloud</sub></td>
    <td align="center" valign="top"><img src="ui/public/brands/adapters/gemini-color.svg" width="32" height="32" alt="Gemini CLI" /><br/><sub>Gemini CLI</sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="ui/public/brands/opencode-logo-dark-square.svg" /><img src="ui/public/brands/opencode-logo-light-square.svg" width="32" height="32" alt="OpenCode" /></picture><br/><sub>OpenCode</sub></td>
    <td align="center" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="ui/public/brands/adapters/pi-dark.svg" /><img src="ui/public/brands/adapters/pi.svg" width="32" height="32" alt="Pi" /></picture><br/><sub>Pi</sub></td>
    <td align="center" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="ui/public/brands/adapters/hermesagent-dark.svg" /><img src="ui/public/brands/adapters/hermesagent.svg" width="32" height="32" alt="Hermes and Hermes Gateway" /></picture><br/><sub>Hermes<br/>+ Gateway</sub></td>
    <td align="center" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="ui/public/brands/adapters/grok-dark.svg" /><img src="ui/public/brands/adapters/grok.svg" width="32" height="32" alt="Grok Build" /></picture><br/><sub>Grok Build</sub></td>
    <td align="center" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="ui/public/brands/adapters/kimi-color.svg" /><img src="ui/public/brands/adapters/kimi-color-light.svg" width="32" height="32" alt="Kimi Code" /></picture><br/><sub>Kimi Code</sub></td>
  </tr>
</table>

<em>If it can receive a heartbeat, it's hired.</em>

</div>

Custom processes, HTTP endpoints, and external adapter packages extend the roster. See the [adapter overview](https://docs.paperclip.ing/reference/adapters/overview/) for setup and capabilities.

<br/>

## Paperclip is right for you if

- ✅ You want to build **autonomous AI organizations**
- ✅ You **coordinate many different agents** (OpenClaw, Codex, Claude, Cursor) toward a common goal
- ✅ You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- ✅ You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- ✅ You want to **monitor costs** and enforce budgets
- ✅ You want a process for managing agents that **feels like using a task manager**
- ✅ You want to manage your autonomous businesses **from your phone**

<br/>

## The four pillars

Four things have to work for an organization of AI agents to actually produce: the tasks, the org, the training, and the infrastructure. Paperclip is built around exactly those four pillars.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-light.png">
  <img src="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-light.png" alt="The four pillars of Paperclip">
</picture>

| Pillar | Built for | What it covers |
| --- | --- | --- |
| **Agentic Task Manager** — Declare intent. Agents work. You verify the output. | Everyone, daily | Tasks, approvals & review gates · proactive agent coworkers · auditable routines & workflows · verify from diffs, screenshots & tests |
| **Org Chart for Agents** — Roles, permissions & boundaries for humans and agents. | Managers | Mixed human + agent org chart · responsibilities, delegation, specialization · governance: who can do what · scoped secrets & company boundaries · connection permissions & responsible-user identities |
| **Agent Employee Training** — Design, train & evaluate your AI employees. | Enablers | Skill Studio & shared org-wide skills · evals & saved test runs · active learning loops & quality metrics · performance reviews for agents · saved test inputs · skill version history & restore · reusable team templates |
| **Agentic OS** — The infrastructure that makes the work run. | IT & platform | Cross-provider runtime: any model, any agent · sandboxing, integrations & MCP servers · SSO, GRC, RBAC & cost controls · data privacy, internal trace collection, compounding data value · personal & shared app connections · run history & opt-in tracing |

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one org chart. If it can receive a heartbeat, it's hired.
</td>
<td align="center" width="33%">
<h3>🎯 Goal Alignment</h3>
Link tasks and projects to your organization goals. Agents receive the goal context behind their work.
</td>
<td align="center" width="33%">
<h3>💓 Heartbeats</h3>
Agents wake for assigned work, follow-up messages, or configured schedules. Delegation flows up and down the org chart.
</td>
</tr>
<tr>
<td align="center">
<h3>💰 Cost Control</h3>
Company, agent, and project <a href="https://docs.paperclip.ing/guides/day-to-day/costs/">budgets</a>. Track reported spend, get threshold alerts, and pause work at configured limits.
</td>
<td align="center">
<h3>🏢 Multi-Organization</h3>
One deployment, many organizations. Separate tasks, agents, permissions, and activity histories for each.
</td>
<td align="center">
<h3>🎫 Task Threads</h3>
Keep conversations, plans, blockers, files, and run history attached to the work. Assign tasks to agents or people.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Governance</h3>
Configure <a href="https://docs.paperclip.ing/guides/day-to-day/approvals/">review and approval stages</a>, approve hires, and pause, reassign, or stop work when needed.
</td>
<td align="center">
<h3>📊 Org Chart</h3>
Hierarchies, roles, reporting lines. Your agents have a boss, a title, and a job description.
</td>
<td align="center">
<h3>📱 Mobile Ready</h3>
Monitor and manage your autonomous businesses from anywhere.
</td>
</tr>
<tr>
<td align="center">
<h3>🔗 Apps & Connections</h3>
<a href="https://docs.paperclip.ing/connectors/">Connect services</a> such as GitHub, Notion, and Railway, or your own MCP server. Set gateway actions to Allowed, Ask first, or Off.
</td>
<td align="center">
<h3>👥 Shared Agents, Personal Accounts</h3>
Choose <a href="https://docs.paperclip.ing/connectors/access-model/">who can use a connection and which agents can access it</a>. Managed GitHub operations can use the account of the person directing the work.
</td>
<td align="center">
<h3>🧠 Skills & Skill Studio</h3>
Install or write <a href="https://docs.paperclip.ing/guides/org/skills/">shared skills</a>, test them with saved inputs, inspect results, and restore earlier versions.
</td>
</tr>
<tr>
<td align="center">
<h3>📅 Scheduled Routines</h3>
Run <a href="https://docs.paperclip.ing/guides/projects-workflow/routines/">recurring work</a> on a schedule or trigger it through an API or webhook. Each run has a task, an owner, and a history.
</td>
<td align="center">
<h3>📎 Artifacts & Feedback</h3>
Find the <a href="https://docs.paperclip.ing/guides/day-to-day/artifacts/">files and documents agents produce</a>. Preview supported formats and leave comments on specific passages in documents.
</td>
<td align="center">
<h3>📦 Ready-Made Teams</h3>
Preview and install <a href="https://docs.paperclip.ing/guides/org/team-catalog/">teams</a> with roles, skills, projects, and routines. Choose their runtimes and make the setup your own.
</td>
</tr>
</table>

Experimental **Agent Chat** and **chat/email connectors** add conversations with agents in Paperclip and through configured services such as Slack, Discord, Telegram, and AgentMail. Enable the relevant instance settings to try them.

<br/>

## Problems Paperclip solves

| Without Paperclip                                                                                                                     | With Paperclip                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ You have 20 Claude Code tabs open and can't track which one does what. On reboot you lose everything.                              | ✅ Tasks are ticket-based, conversations are threaded, sessions persist across reboots.                                                |
| ❌ You manually gather context from several places to remind your bot what you're actually doing.                                     | ✅ Context flows from the task up through the project and company goals — your agent always knows what to do and why.                  |
| ❌ Folders of agent configs are disorganized and you're re-inventing task management, communication, and coordination between agents. | ✅ Paperclip gives you org charts, ticketing, delegation, and governance out of the box — so you run a company, not a pile of scripts. |
| ❌ Runaway loops waste hundreds of dollars of tokens and max your quota before you even know what happened.                           | ✅ Spend tracking, budget alerts, and automatic pauses help you control the cost of ongoing work.                                       |
| ❌ You have recurring jobs (customer support, social, reports) and have to remember to manually kick them off.                        | ✅ Routines create assigned tasks on a schedule, with outputs and run history you can inspect.                                         |
| ❌ You have an idea, you have to find your repo, fire up Claude Code, keep a tab open, and babysit it.                                | ✅ Add a task in Paperclip. Your coding agent works on it until it's done. Management reviews their work.                              |

<br/>

## Why Paperclip is special

Paperclip handles the hard orchestration details correctly.

|                                   |                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Atomic task checkout.**         | A single assignee and execution locks prevent competing runs from claiming the same task.                    |
| **Persistent work context.**      | Tasks, comments, and documents stay in Paperclip. Supporting adapters resume saved sessions across runs.       |
| **Runtime skill injection.**      | Agents can learn Paperclip workflows and project context at runtime, without retraining.                      |
| **Governance with rollback.**     | Approval gates are enforced, config changes are revisioned, and bad changes can be rolled back safely.        |
| **Accountable connections.**      | Human access, agent eligibility, and gateway action permissions are separate controls. Approve a call once or save a revocable rule. |
| **Goal-aware execution.**         | Linked tasks and projects carry goal ancestry so agents see the "why," not just a title.                      |
| **Portable company templates.**   | Export/import orgs, agents, and skills with secret scrubbing and collision handling.                          |
| **Organization boundaries.**      | Company-scoped access checks keep each organization's work, agents, and activity separate within one deployment. |

<br/>

## What's Under the Hood

Paperclip is a full control plane, not a wrapper. Before you build any of this yourself, know that it already exists:

```
┌──────────────────────────────────────────────────────────────┐
│                       PAPERCLIP SERVER                       │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │Identity & │  │  Work &   │  │ Heartbeat │  │Governance │  │
│  │  Access   │  │   Tasks   │  │ Execution │  │& Approvals│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Org Chart │  │Workspaces │  │  Plugins  │  │  Budget   │  │
│  │ & Agents  │  │ & Runtime │  │           │  │ & Costs   │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Routines  │  │ Secrets & │  │ Activity  │  │  Company  │  │
│  │& Schedules│  │  Storage  │  │ & Events  │  │Portability│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
   ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
   │  Claude   │  │   Codex   │  │   CLI     │  │ HTTP/web  │
   │   Code    │  │           │  │  agents   │  │   bots    │
   └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

### The Systems

<table>
<tr>
<td width="50%">

**Identity & Access** — Two deployment modes (trusted local or authenticated), human roles and permissions, agent API keys, short-lived run JWTs, company memberships, and invite flows. Responsible-user attribution follows work through delegation and supported managed connections.

</td>
<td width="50%">

**Org Chart & Agents** — Agents have roles, titles, reporting lines, permissions, and budgets. Adapter examples match the diagram: Claude Code, Codex, CLI agents such as Cursor/Gemini/bash, HTTP/webhook bots such as OpenClaw, and external adapter plugins. If it can receive a heartbeat, it's hired.

</td>
</tr>
<tr>
<td>

**Work & Task System** — Issues carry company/project/goal/parent links, atomic checkout with execution locks, first-class blocker dependencies, comments, documents, attachments, work products, labels, and inbox state. Search across work, review document revisions, and leave anchored feedback.

</td>
<td>

**Heartbeat Execution** — DB-backed wakeup queue with coalescing, budget checks, workspace resolution, secret injection, skill loading, and adapter invocation. Runs produce logs, usage records, and adapter-specific session state. Bounded recovery handles supported failures and surfaces cases that need human action.

Run-bound named-gateway credentials remain valid past their expiry timestamp
while their company-scoped heartbeat is running. Session cleanup preserves those
rows, rechecking run activity at deletion, and removes expired credentials once
the run is inactive or missing. Non-run gateway credentials retain timestamp
expiry. Runtime connection tools likewise verify the signed company, agent,
run, user, instance and scope, then validate the live run and task through
`loadRunContext` on every MCP lifecycle call and connection operation. Their
one-hour `exp` does not interrupt active runs. Finished and cancelled runs are
refused immediately; the separate GitHub credential capability retains its
expiry. These contracts add no setting or migration. PostgreSQL/HTTP token
lifetime regressions and the separate `coverage.run-gateway-auth` operation
prove cleanup, continued access and terminal-run rejection.

</td>
</tr>
<tr>
<td>

**Workspaces & Runtime** — Project repositories and workspaces, optional isolated execution workspaces (git worktrees, operator branches), and runtime services (dev servers, preview URLs). Sandbox providers extend execution beyond the local host; availability depends on the configured environment and adapter.

A terminal task's execution workspace remains open while any queued or running
heartbeat references that workspace or a linked issue. The workspace service
uses the persisted run context, active environment leases and issue/run bindings
for close readiness, worktree contention and the terminal reaper's atomic archive
guard. Workspace preparation records `contextSnapshot.executionWorkspaceId`
before acquisition and after realization, including replacement workspaces.
Clearing task checkout ownership does not release the running heartbeat's
workspace. After all bound runs finish, existing delivery, terminal-tree and
cooldown checks govern cleanup. No setting or database migration is required.
The owning server buckets and `coverage.execution-workspaces` verify this
lifecycle against test-owned PostgreSQL and Git worktrees; the latter retains
statement reports for comparison with changed production lines.

</td>
<td>

**Governance & Approvals** — Board approval workflows, execution policies with review/approval stages, decision tracking, budget hard-stops, and agent pause/resume/terminate. Configured task reviews govern completion; connection action approvals govern calls through the tool gateway.

</td>
</tr>
<tr>
<td>

**Budget & Cost Control** — Token and cost tracking by company, agent, project, goal, issue, provider, and model. Scoped budget policies with warning thresholds and hard stops. Enforcement uses recorded spend; usage reporting and in-flight work can delay a stop.

</td>
<td>

**Routines & Schedules** — Recurring tasks with cron, webhook, and API triggers. Concurrency and catch-up policies. Each routine execution creates a tracked issue and wakes the assigned agent — no manual kick-offs needed.

</td>
</tr>
<tr>
<td>

**[Plugins](https://docs.paperclip.ing/administration/plugins/)** — Instance-wide plugin system with out-of-process workers, capability-gated host services, job scheduling, tool exposure, and UI contributions. Extend Paperclip without forking it.

</td>
<td>

**Secrets & Storage** — Company secrets and per-person secret values, encrypted credential storage, local or S3-compatible file storage, attachments, and work products. Secret references supply credentials to authorized runs without copying values into ordinary agent configuration.

</td>
</tr>
<tr>
<td>

**Activity & Events** — Mutating actions, heartbeat state changes, cost events, approvals, comments, and work products are recorded as durable activity so operators can audit what happened and why.

</td>
<td>

**[Company Portability](https://docs.paperclip.ing/guides/power/export-import/)** — Preview, export, and import organization packages with agents, skills, and optional projects, routines, tasks, and attachments. Referenced secret values are omitted; review packages before sharing because plain environment values and local paths can remain. Packages share an operating setup; full-instance recovery uses backups.

</td>
</tr>
</table>

<br/>

An external MCP client using a standard agent API key can update issues the
agent is authorized to edit without a heartbeat run. Edits to its own assigned
in-progress issue require a clear checkout and execution lock. See
[issue updates](docs/api/issues.md#update-issue) for the API contract.

## What Paperclip is not

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Not just a chatbot.**      | Conversations stay attached to tasks, plans, decisions, and outputs. Experimental Agent Chat can hand work off to assigned tasks.    |
| **Not an agent framework.**  | We don't tell you how to build agents. We tell you how to run a company made of them.                                |
| **Not just a workflow builder.** | Routines and experimental pipelines operate within an organization, with roles, goals, budgets, and governance.                  |
| **Not a prompt manager.**    | Agents bring their own prompts, models, and runtimes. Paperclip manages the organization they work in.               |
| **Not limited to one agent.** | Start with one agent and grow into a team with shared skills, delegation, and review.                                              |
| **Not only for code review.** | Coding and PR review fit alongside research, operations, content, and other work.                                                  |

<br/>

## Quickstart

Open source. Self-hosted. No Paperclip account required. Follow the [guided quickstart](https://docs.paperclip.ing/guides/getting-started/five-minute-path/) to set up your first agent.

### Just ask your agent to install Paperclip

Share the [installation guide](https://docs.paperclip.ing/reference/cli/installation/) with your agent.

### Or install it yourself

With **Node.js 24.11 or newer** installed:

```bash
npx paperclipai@latest onboard --yes
```

The CLI runs from npm's cache; your instance configuration and data persist locally.

See the [installation guide](https://docs.paperclip.ing/reference/cli/installation/) for managed installs, pinned versions, canary and git-ref installs, updates, rollback, service management, and uninstalling.

For an isolated manual test instance that is already initialized with a CEO
agent, use `test-drive`. It stays in the foreground, never installs a service
or creates a first task, and opens the browser only after setup succeeds:

```bash
ANTHROPIC_API_KEY=... npx paperclipai test-drive
OPENAI_API_KEY=... npx paperclipai test-drive --harness codex
OPENROUTER_API_KEY=... npx paperclipai test-drive \
  --harness opencode \
  --model openrouter/anthropic/claude-sonnet-4.5
```

Each run without `--data-dir` gets a unique, retained temporary directory; its
absolute path is printed at startup. Pass `--data-dir` to reuse one, or
`--no-browser` to leave the initialized instance unopened. When invoked from a
linked Git worktree, `test-drive` also enables task execution in that worktree.
See the [test-drive guide](https://docs.paperclip.ing/reference/cli/test-drive/) for credential and
reuse behavior.

> **Troubleshooting: private npm registry `.npmrc`**
>
> If this fails with an `E404` for `paperclipai` (or similar) and you use a private npm registry (for example GitHub Packages) via a global `~/.npmrc`, `npx` may be resolving `paperclipai` against that private registry instead of the public npm registry.
>
> Diagnostic:
>
> ```bash
> npm config get registry
> ```
>
> Workaround (cross-platform; force the public npm registry for this command):
>
> ```bash
> npx --registry https://registry.npmjs.org paperclipai@latest onboard --yes
> ```

That quickstart path now defaults to trusted local loopback mode for the fastest first run. To start in authenticated/private mode instead, choose a bind preset explicitly:

```bash
npx paperclipai@latest onboard --yes --bind lan
# or:
npx paperclipai@latest onboard --yes --bind tailnet
```

If you already have Paperclip configured, rerunning `onboard` keeps the existing config in place. Use `npx paperclipai configure` to edit settings.

Or manually:

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

This starts the UI and API at `http://localhost:3100`. An embedded PostgreSQL database is created automatically — no setup required. If database initialization fails, the startup error includes PostgreSQL's `initdb` diagnostic output and the temporary password file is removed.

> **Requirements:** Node.js 24.11+, pnpm 11.27+

Local Claude and Codex subscription sign-in also needs Python 3 and the
corresponding provider CLI on the Paperclip host. The Docker image includes them.

Source development also builds the native Paperclip Runner when enabled (the self-hosted default). Install a Rust toolchain, set `PAPERCLIP_RUNNER_BINARY` to a compatible prebuilt runner, or set `PAPERCLIP_SKIP_RUNNER_BINARY=1` to skip building the native runner binary (native-runtime providers require the binary at runtime).

<br/>

### Plugin HTTP access to private hosts

The deployment operator may set `PAPERCLIP_PLUGIN_FETCH_PRIVATE_HOSTS` to a
comma-separated list of exact lowercase hostnames, for example
`git.private.test,build.private.test`. Unset or empty means no private-host
exceptions. Whitespace, empty list entries, wildcards, IP literals (including
alternative numeric forms), URLs, schemes and ports fail configuration loading.
Changes take effect on the next server start.

This setting applies only to plugin host `http.fetch`. Listed hosts may reach
RFC 1918 or IPv6 ULA addresses; loopback, unspecified and link-local addresses
remain refused. Unlisted hosts retain public-only access. DNS is resolved once,
the first permitted result is dialed directly, and the original Host header
and TLS SNI are preserved. Redirects are returned to the caller, never followed.
If no resolved address is permitted, the existing private/reserved-ranges error
is returned before any connection. Public/private mixed answers retain the
existing filtering behavior. The native server test bucket for
`plugin-fetch-private-hosts.test.ts` proves configuration, exact-host matching,
pinning, Host and SNI through mocked DNS/dial boundaries and real HTTP/TLS
servers; `remote-http-rebinding.test.ts` retains its existing assertions.

### Execution recovery

A continuation cancelled before dispatch while waiting for review has no
provider work to reconcile. Paperclip verifies the dispatch receipt against
retained execution, coordinator and cleanup evidence before admitting Retry,
a new user message, or previously saved input. Ordinary operator cancellations
keep their existing stop safeguards.

For a run that started, the canonical
`POST /api/issues/:id/recovery-actions/resolve` endpoint accepts board or
authorized recovery-owner agent
`executionReconciliation` evidence for the current settled hold without an
`actionId`. It verifies the source run, owner, process and leases before clearing
the hold. The decision names the source `runId`, confirms `providerStopped: true`,
and records `actionOutcome` (`completed`, `not_performed`, `mixed`, or `unknown`)
with 20-12000 characters of `outcomeEvidence`. Missing local process identity
requires retained stop or pre-invocation evidence; the assertion alone is
insufficient. Live runs, live process ownership and unreleased leases return
409 and retain the guard.

An explicit `unknown` decision preserves uncertainty and starts a fresh
execution without resuming the ambiguous provider session or replaying its
actions. The recovery record retains both the automatic disposition and the
dated reconciliation actor/evidence, plus durable continuation delivery and
successor identity. Task execution stages, assignment, workspace and work
products are preserved. Duplicate resolution with or without `actionId`
returns the projected receipt with `replayed: true`, retries pending delivery
using the same idempotency key, and rejects a different run or action outcome
with 409.

CLI operators use `paperclipai issue recovery:resolve <issue-id> --outcome restored
--source-issue-status todo --run-id <source-run-id> --provider-stopped
--action-outcome unknown --outcome-evidence "<audit evidence>"`.
`--outcome-evidence` is repeatable and joins entries with newlines. On this
command, `--run-id` selects the guarded source; agent authentication uses
`PAPERCLIP_RUN_ID` for its current heartbeat header. This changes no
configuration option. Real PostgreSQL route tests, CLI request tests and the
continuation-envelope tests verify this contract through the declared Flake
bucket checks. See [execution semantics](doc/execution-semantics.md).

### Managed MCP authentication

Codex CLI runs require native profile-file support (Codex 0.134.0 or later).
Each run selects a fresh `paperclip-run-<uuid>.config.toml` profile in its
effective `CODEX_HOME`. The profile contains only that run's managed MCP
bearers and preserves an explicitly selected operator profile. Base config,
authentication and session storage retain their existing home. Profiles are
written with mode 0600, staged individually for remote runs, and removed on
normal or failed exit. A later run never selects a prior run's profile, including
after server interruption. Obsolete shared managed MCP blocks are removed
before profile preparation. Missing or malformed operator profiles and profile
write failures reject launch. No credential is added to command arguments.

Authentication refusals retain `tokenSubjectType`, `tokenSubjectId`,
`subjectRunId`, `subjectRunStatus`, `presentingRunId` and
`presentingRunIdSource` in `named_gateway_auth_failed`. Unknown values are null.
The presenting run comes from a UUID-validated `X-Paperclip-Run-Id` header;
`client_header` marks it as client-reported diagnostic evidence, never
authorization. Codex CLI profiles send this header. Token material and token
hashes are excluded from these fields. The normal run-finalization revocation
and active-run checks remain authoritative.

Managed MCP clients send their gateway bearer to
`POST /api/tool-gateway/gateways/:gatewayId/mcp`. Paperclip validates it against
that gateway and its current token and run state; it does not grant the bearer
board or agent API access. Other API paths and the gateway descriptor GET keep
their existing authentication requirements.

Clients send `initialize`, then `notifications/initialized`, before using tools.
The notification verifies the credential and returns an empty HTTP 202 on
success. It does not consume another protocol-action allowance or update token
usage or run identity. Invalid credentials remain subject to gateway failure
throttling and auditing. The same notification behavior applies to the public
MCP gateway endpoint. No new configuration option is required.

Both gateway endpoints answer an authenticated, unsupported JSON-RPC method
with HTTP 200 and error `-32601` (`Method not found`), preserving its request
id, including zero or null. An unknown notification without an id returns an
empty HTTP 202. Credential failures retain their HTTP authentication status.
The HTTP request log includes `mcpMethod` through the logger's credential
redaction even on successful transport responses, without logging request
arguments on those responses. The native gateway route tests exercise these
responses and capture the emitted log record.

Paperclip-managed Codex MCP entries set native
`default_tools_approval_mode = "approve"` so calls reach the gateway under
noninteractive execution. The gateway applies current tool policies, denies
unauthorized calls and creates a human approval card when review is required.
CLI profiles apply this setting. ACP supplies managed servers through its
native per-session MCP options rather than writing run bearers to shared
configuration. Unmanaged MCP entries retain their own
approval settings. See [execution semantics](doc/execution-semantics.md).

### Remote MCP tool-call deadlines and evidence

Remote MCP tools use the transport's 30-second response budget by default,
including HTTP 200 `text/event-stream` responses over direct and `socks5h`
connections. An explicit tool timeout remains clamped to 1-60,000 ms;
approved actions retain their 60-second budget and Railway commands retain
their existing command budget. Built-in, plugin and local stdio defaults
remain 10 seconds. The call deadline includes session initialization and
body consumption. SSE completes on the matching JSON-RPC result or error ID,
without waiting for the server to close the stream.

A deadline-triggered response reset is HTTP 504 `tool_timeout`, with
`invocation_timeout` and degraded connection health. A peer reset before the
deadline remains a transport failure and marks connection health error.
`toolCallEvents.metadata.execution` and the corresponding activity audit
retain HTTP status, content type, upstream request ID, the deadline and its
abort state, and the error's name, message, code, stack and recursive cause.
Error text uses the existing credential redactor; arbitrary request/provider
properties and response payloads are excluded. Cyclic causes have an explicit
marker. `execution.stream` reports received bytes/chunks, parsed SSE data
events, whether the requested response matched and whether EOF was observed.
Partial progress survives read errors; it does not imply a complete response.
These records share the existing invocation/run correlation and retention
and retrieval surfaces. No live Sentry payload is needed for verification:
the gateway, MCP HTTP and SOCKS suites exercise controlled streams and a real
test-owned proxy with virtual deadline advancement.

### Gateway write replay

Gateway write replay identity uses the complete canonical arguments, including
nested values. Different writes remain distinct when their audit display prefixes
match. Exact duplicates reuse their recorded invocation; an explicit idempotency
key reused with different arguments returns HTTP 409 `idempotency_key_conflict`
before provider execution. Audit displays remain bounded and secret-redacted;
the stored argument identity is a digest. See [connection reviews](doc/connections/TASK-REVIEWS.md).

## FAQ

**Q: Is this project maintained or just slop?**

**A:** Paperclip is maintained by the [Paperclip team](https://paperclip.ing). We've merged [over 2,700 pull requests](https://github.com/paperclipai/paperclip/pulls?q=is%3Apr+is%3Amerged).

<br/>

**Q: What does a typical setup look like?**

**A:** Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and goals — the agents take care of the rest.

For remote access, use authenticated mode with a private-network bind such as Tailscale, or deploy the persistent server with Docker. See [deployment modes](https://docs.paperclip.ing/reference/deploy/deployment-modes/) and the [Docker guide](https://docs.paperclip.ing/reference/deploy/docker/).

<br/>

**Q: Can I run multiple companies?**

**A:** Yes. A single deployment can host multiple organizations with company-scoped data and access checks.

<br/>

**Q: How is Paperclip different from agents like OpenClaw or Claude Code?**

**A:** Paperclip _uses_ those agents. It orchestrates them into a company — with org charts, budgets, goals, governance, and accountability.

<br/>

**Q: Why should I use Paperclip instead of just pointing my OpenClaw to Asana or Trello?**

**A:** Agent orchestration has subtleties in how you coordinate who has work checked out, how to maintain sessions, monitoring costs, establishing governance - Paperclip does this for you.

(Bring-your-own-ticket-system is on the Roadmap)

<br/>

**Q: Do agents run continuously?**

**A:** Agents wake for assigned work and follow-up messages. Optional timer heartbeats let them check for work periodically; routines create recurring tasks on their own schedules. You can also connect externally running agents such as OpenClaw. A mention alone does not assign work or wake another agent.

<br/>

## Agent lifecycle recovery

Startup execution recovery completes before the lifecycle worker resumes agent
transitions. It clears the interrupted `pausing` and `resuming` operation leases
and retry deadlines, retaining operation identity, plugin receipts and policy
holds. Preparation and verification keep their existing leases and retry rules.
The application startup hook owns this ordering; a recovery failure fails startup.

A cancelled legacy conversation-adapter startup can prove stopped execution
without a PID when its persisted stage is `settled`, or `preparing` with an
expired or cleared controller lease, and no retained dispatch or provider event
contradicts that evidence. Local workspace cleanup and remote termination
receipts remain required. The orphan reaper settles expired prior-boot cancelled
preparations and records a lifecycle event without replaying the cancelled run.
Live controllers, invoked adapters and unfinished cleanup remain stop barriers.

A board resume during `pausing` removes user holds, clears the pending pause
retry deadline and awaits lifecycle reconciliation before returning the current
state. It still completes stop and plugin work before entering `resuming` and
`ready`; budget and company holds continue to prevent readiness. No schema,
setting, credential or deployment change is required.

The real PostgreSQL lifecycle and legacy-controller regressions, startup tests
and the separate `coverage.agent-lifecycle` operation are declared in
[AGENTS.md](AGENTS.md). Coverage retains `statement-lines.json`; acceptance
requires zero uncovered ranges intersecting changed production statements,
without claiming whole-file 100 percent coverage.

## Blocked owner notifications

Checking out a blocked issue preserves its current unblock notification episode.
Re-blocking with the same self-owned `unblockDescriptor` preserves
`blockedTransitionAt` and `blockedOwnerNotifiedAt`, so it queues no new owner
wake. Descriptor equality compares the owner and action independently of JSON
key order. A changed descriptor starts a new episode and notifies its agent
owner once, including when the issue remains blocked. Explicitly leaving
blocked through an issue update clears the episode. Resolved dependencies and
new comments keep their existing wake paths. Agent-authored descriptors still
require the agent to name itself as owner.

The issue service compares and persists the episode under its existing row
lock. Native post-commit delivery records a notification receipt only after
delivery succeeds. A later blocked update can retry an undelivered episode.
No schema, migration or configuration change is required. The real PostgreSQL
checkout/re-block regression runs through the declared server test buckets in
[AGENTS.md](AGENTS.md).

The separate `coverage.unblock-notifications` operation runs the real
HTTP/PostgreSQL issue-service regressions and the existing owner/dependency
suites. It uses the same native V8 report path as gateway coverage and retains
Istanbul JSON, a summary and uncovered statement ranges for issue updates,
routes, owner notification and dependency wakeups. Review those ranges against
the production diff; this operation does not assert whole-file 100 percent
coverage. It adds no required merge status or runtime setting.

## Local task review handoff

The native `PATCH /api/issues/:id` route accepts a project lead's completion
handoff of human-owned local work from `blocked` (after blockers resolve) or
`in_progress` into the configured pending agent review stage. The request uses
`status: "done"`, a review execution policy and a `## Task Disposition` comment,
without assignee overrides, `resume` or `reopen`. The issue must have Gitea
`branch`, `commit` and `pull_request` work products with non-empty external IDs,
`status: "ready_for_review"` and `reviewState: "needs_board_review"`.

The authenticated agent must lead the issue's same-company, unpaused project.
Low-trust actors, unresolved dependencies, subtree pause holds, active recovery
actions and execution blockers cannot use this handoff. Invalid authority
returns HTTP 403; incomplete handoffs and execution holds return HTTP 409.
Ordinary unassigned blocked-task follow-ups still require an assigned agent.
Stage-less, human-owned `in_progress` work retains ordinary agent completion
to `done`; only a transition into review enters the local handoff guard.

The native policy transition assigns the reviewer and preserves the original
human in `executionState.returnAssignee`. Existing issue-update handling clears
blocked bookkeeping, attributes update/comment activity to the lead, and queues
`execution_review_requested`. Handoff creates no execution decision; the first
decision remains the reviewer's verdict. The Flake check
`test-paperclipai-server-local-task-handoff` proves the route against test-owned
PostgreSQL state, including rejection without issue mutation or reviewer wakeup.

## Development

Adapters using `@paperclipai/adapter-utils` `runChildProcess` receive a failed
process result with `errorCode` when writing supplied stdin fails. The helper
records the error with the owning run ID and requests a graceful child stop;
other runs remain independent. Callers should retain `errorCode` when reporting
the run outcome.

```bash
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm dev:mobile       # Serve prebuilt UI on :3101 for phones/tablets (proxies /api → :3100)
pnpm dev:both         # Run `pnpm dev` and `pnpm dev:mobile` together
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test             # Cheap default test run (Vitest only)
pnpm test:watch       # Vitest watch mode
pnpm test:e2e         # Playwright browser suite
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

`pnpm test` does not run Playwright. Browser suites stay separate and are typically run only when working on those flows or in CI.

The existing Vitest gate retains each Vitest invocation under
`test-results/vitest/<invocation>/`. Its `*.output.jsonl` contains ordered
JSON-RPC output notifications with the execution ID, channel and complete safe
line, including a final unterminated line. `*.manifest.json` records the child's
original exit/signal, received byte counts, safe byte/record counts and SHA-256
per channel, source revision and tracked-diff hash, and completion or original
launch/retention errors. The gate uses the existing adapter-utils diagnostic
redactor before forwarding or saving recognized credential forms; it never
persists the child environment. Invalid UTF-8 or failed evidence delivery fails
acceptance. A native SIGINT/SIGTERM is forwarded once, and the parent awaits the
child's completion and evidence flush without a kill timeout. Preflight commands
before the Vitest gate are outside this capture. Each channel preserves its
line order; the shared sequence orders complete-line delivery, rather than
reconstructing cross-channel byte interleaving.

The worktree-local dependency fixture emits JSON-RPC 2.0 `test.phase`
notifications to stderr for setup, install, commit, realization and assertions.
Its failure hook includes the active phase, child command, cwd, completion code
and captured stdout/stderr, plus workspace operations recorded before each child
starts and updated on completion. The gate retains these records with its
original output; an unfinished child has an explicit running status.

The Discord socket teardown fixture emits JSON-RPC 2.0 `test.phase` records
for server listen, initial handshake/close, recovery handshake, shard destroy,
server close and assertions. Its failure hook includes mode, phase, socket,
connection, session and failure counts, child command, exit code, signal,
killed status and complete stdout/stderr in the retained diagnostic and test
failure message. Test failure requests graceful child cleanup and awaits exit;
there is no subprocess kill timeout. Hello cancellation follows handshake and
close-listener registration, and recovery connections retain 2,000 ms deadlines.
Historical command-only child failures do not establish their original cause.

The gate sets `PAPERCLIP_TEST_EVIDENCE_DIR` and its source-identity metadata for
fixtures. The issue-reconciliation fixture saves a repeatable-read lifecycle
snapshot before cleanup: test, issue, comment, wake, run, decision and recovery
IDs; admission state; safe native errors/events; counts and a payload digest.
Comment bodies, credentials, configuration and arbitrary wake payloads are
excluded. Direct editing runs retain these snapshots in
`test-results/vitest/direct/`. Local artifacts remain until explicitly removed;
PR and release test shards upload them even on failure with 14-day retention.
Read the manifest and referenced records/snapshot before diagnosing a failed
test; a missing or incomplete artifact does not establish its cause.

Comment wake decisions remain asynchronous. The heartbeat drain now includes
the complete decision before its first wake is enqueued, and waits for all its
enqueue/audit results. The decision's start, completion or original failure is
logged with company, issue and comment IDs. This completion contract supports
graceful shutdown and deterministic database-fixture teardown without polling.

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

<br/>

Concurrent worktree preparation, persisted-worktree restoration and terminal Git
cleanup share a queue per canonical owner repository within one server process.
Different repositories prepare independently. New branches are created without
implicit tracking, then receive their remote upstream before preparation returns.
If that setup fails, preparation removes its new worktree and branch; a refused
rollback surfaces both failures and requires explicit repair. Missing upstream
configuration on a task branch is restored from its remote-tracking base.
Complete upstream configuration and recorded branch ownership are preserved;
historical branches without ownership evidence are never adopted as runtime-owned.
These operations retain their existing workspace-operation records, native Git
output and run correlation. No new setting or credential is required.

### Nix

`flake.nix` defines the fork's cached typechecks and tests (`nix flake check`), the installed workspace dependencies (`packages.<system>.nodeModules`) and a development shell (`nix develop`). The command inventory and what invalidates a check are in [AGENTS.md](AGENTS.md).

The separately requested `coverage.server-ports` output runs the native
server port/workspace suites and measures statements in workspace-runtime.ts.
It retains the same reports and changed-line review contract as the gateway
coverage operation below. Concurrent-start, interrupted-upstream recovery and
real configuration-lock rollback regressions use test-owned Git repositories.

The separately requested `coverage.run-gateway-auth` output measures native
Vitest V8 statements for heartbeat, gateway, remote HTTP transport, policy and
Codex credential and runtime-tools token source files, using the route, token
lifetime, HTTP/SSE, SOCKS proxy, pinned
transport/rebinding, policy,
execution and profile suites. It preserves
`coverage-final.json`, `coverage-summary.json` and repository-relative
`statement-lines.json` (statement totals and uncovered start/end lines) in its output and
prints a text report in the retained Nix log. A successful measurement does not
assert 100 percent coverage: uncovered statements must be reviewed against the
source diff. Test or report generation failure fails the operation. The provider
is a locked development dependency. The native `.pnpmfile.cjs` policy removes debug's unused
optional `supports-color` peer so Istanbul's development-only color dependency
cannot be pulled into production through workspace peer resolution. The native
`pnpm-production-peer-policy` check validates the policy and regenerated lock;
the packaging production-dependency gate verifies the actual deployment.

The locked fleet Nix input supplies the single Nixpkgs authority. One native
derivation factory applies its producer-owned `lib.tmpdirAuditPolicy`
unchanged to workspace dist, typecheck and test recipes, the PostgreSQL
template, the import graph and its comparison check. This skips the selected
temporary-directory audits through the producer's native attribute; it does
not repair or diagnose the classifier SIGSEGV. The factory verifies that
every other recipe attribute, including output declarations, toolchains and
dependency identities, is unchanged by policy application.
Dependency installation and its fixed-output fetch retain their existing recipes.
The prerequisite-audit-policy check verifies every handoff-gate prerequisite
carries the producer's exact policy values. The factory also retains the
producer's `lib.tmpdirAuditCorrection` setup hook. The Darwin prerequisite-audit
check explicitly enables auditing only in its test-owned plugin SDK control,
injects the producer's unreadable-directory failure, and proves child-status
propagation, cleanup and reaping. Failure diagnostics and original child
output remain in the native Nix build log.

## Roadmap

- ✅ Plugin system (e.g. add a knowledge base, custom tracing, queues, etc)
- ✅ Get OpenClaw / claw-style agent employees
- ✅ companies.sh - import and export entire organizations
- ✅ Easy AGENTS.md configurations
- ✅ Skills Manager, Skill Studio & Skills Store
- ✅ Scheduled Routines
- ✅ Better Budgeting
- ✅ Agent Reviews and Approvals
- ✅ Multiple Human Users
- ✅ Cloud / Sandbox agents (e2b, Cloudflare, Daytona, Modal, Novita, self-hosted Kubernetes)
- ✅ Artifacts & Work Products
- ✅ Deep Planning (planning mode, revisioned plans, plan approvals)
- ✅ Enforced Outcomes (watchdogs, recovery actions, review gates)
- ✅ MCP Tool Gateway & Apps (governed tool access)
- ✅ Secrets Manager with per-agent access
- ✅ Activity log & action attribution
- ✅ Self-healing runs & automatic recovery
- ✅ Agent evals & feedback
- ✅ Connected Apps
- ✅ Personal & Shared AI Accounts
- ✅ Shared Agents Use Personal GitHub Identities
- ✅ Skill Version History & Restore
- ✅ Document Comments & Revision History
- ✅ Company-Wide Search
- ✅ Multi-Model & Multi-Harness Teams
- 🟡 Memory / Knowledge
- ⚪ MAXIMIZER MODE
- ⚪ Work Queues
- ⚪ Self-Organization
- ⚪ Automatic Organizational Learning
- 🟡 Agent Chat
- 🟡 Cloud deployments
- ⚪ Desktop App
- ⚪ Bring-your-own-ticket-system (Asana / Linear / Jira as on-ramps)

This is the short roadmap preview. See the full roadmap in [ROADMAP.md](ROADMAP.md).

<br/>

## Community & Plugins

Find Plugins and more at [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip)

## Observability

Paperclip ships with opt-in OpenTelemetry auto-instrumentation for the server (traces and metrics, including database statement spans and connection-pool metrics). It activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and supports `grpc`, `http/protobuf`, and `http/json` via the standard `OTEL_EXPORTER_OTLP_PROTOCOL` env var. `@opentelemetry/api`, the SDK, the auto-instrumentation bundle, and the `http/protobuf` exporter are installed with the server as optional dependencies at exact versions; the gRPC and HTTP/JSON exporters remain optional peer dependencies you install yourself. See [doc/observability.md](doc/observability.md) for install commands and the full env-var reference.

Paperclip also ships with opt-in Sentry error monitoring for the server and the browser. Set `SENTRY_DSN_FRONTEND` to activate it for the browser and `SENTRY_DSN_BACKEND` to activate it for the server — each variable is optional, and the legacy `SENTRY_DSN` variable still works as a fallback for either component. The supported server SDK version is `@sentry/node@10.71.0`; it is an optional peer dependency for the server, so install it only if you want error monitoring. The browser SDK, `@sentry/browser`, is pinned to the same exact version. See [doc/observability.md](doc/observability.md#sentry-error-monitoring) for the install command, the privacy settings, and the full default capture set.

## Telemetry

Paperclip collects anonymous usage telemetry to help us understand how the product is used and improve it. No personal information, issue content, prompts, file paths, or secrets are ever collected. Private repository references are hashed with a per-install salt before being sent.

Contributors changing emitted telemetry events should follow the [Telemetry Data Contract](packages/shared/src/telemetry/README.md).
For proposed first-party events that are not in the generated contract yet, follow [Telemetry Workflow](doc/TELEMETRY_WORKFLOW.md).

Telemetry is **enabled by default** and can be disabled with any of the following:

| Method               | How                                                     |
| -------------------- | ------------------------------------------------------- |
| Environment variable | `PAPERCLIP_TELEMETRY_DISABLED=1`                        |
| Standard convention  | `DO_NOT_TRACK=1`                                        |
| CI environments      | Automatically disabled when `CI=true`                   |
| Config file          | Set `telemetry.enabled: false` in your Paperclip config |

## Contributing

We welcome contributions. See the [contributing guide](CONTRIBUTING.md) for details
and [AGENTS.md](AGENTS.md) for contributor commands and verification requirements.

**[We're hiring](https://paperclip.ing/about/#careers)**

<br/>

## Community

- [Discord](https://discord.gg/m4HZY7xNG3) — Join the community
- [Twitter / X](https://x.com/papercliping) — Follow updates and announcements
- [GitHub Issues](https://github.com/paperclipai/paperclip/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/paperclipai/paperclip/discussions) — ideas and RFC

<br/>

## License

MIT &copy; 2026 [Paperclip Labs, Inc](https://paperclip.ing)

## Star History

<a href="https://www.star-history.com/?repos=paperclipai%2Fpaperclip&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&theme=dark&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" />
    <img src="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" alt="Star History Chart" />
  </picture>
</a>

<br/>

---

<p align="center">
  <sub>Open source under MIT. Built for people who want to get work done, not babysit agents.</sub>
</p>
