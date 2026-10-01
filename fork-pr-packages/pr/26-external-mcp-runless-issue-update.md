# fix(issues): let an external client's agent key update authorized issues without a run

| Field | Value |
| --- | --- |
| Branch | `pr/26-external-mcp-runless-issue-update` |
| Head | `31cbc69c754e85165972186dc04df4f41e7a44c9` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(issues): let an external client's agent key update authorized issues without a run` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `doc/SPEC-implementation.md` | +11 | -3 |
| `docs/api/issues.md` | +3 | -1 |
| `server/src/__tests__/issue-runless-agent-key-routes.test.ts` | +225 | -0 |
| `server/src/routes/issues.ts` | +30 | -2 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - An external MCP client or the CLI can act for an agent with a standard agent API key.
> - Such a client has no heartbeat run.
> - Every `PATCH /api/issues/:id` that changed a field or added a comment failed for it, because the cross-issue influence check needs a run, and an in-progress issue needs the run header.
> - This pull request lets a standard agent key update an issue its agent is authorized to edit, without a run.
> - The benefit is that external clients can do the issue work that their agent may do.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

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

Related open pull requests: #14683 adds a run-less `service` key scope that can comment on issues; `PATCH` still needs a run there. It solves a different part of the same need; the two are independent. #14562, #13926, and #14087 change run-scoped writes in `cross-issue-influence-limit.ts`; the second one to merge needs a rebase.

## What Changed

- A standard-scope agent API key without a run may `PATCH` an issue that its agent is otherwise authorized to edit, including blocker changes and the inline comment. Company and responsible-user scope, status transitions, and the other governance checks still apply.
- These runless writes have no run to count against, so they skip the per-run cross-issue influence cap.
- The key may edit its own in-progress issue only while no run holds it. A checkout or execution lock answers `409`.
- Restricted keys, agent JWTs, standalone comments, and other agent mutations still require a run.
- `doc/SPEC-implementation.md` and `docs/api/issues.md` describe the contract.
- Route tests on PostgreSQL, with the actor the agent-key middleware builds (acting for its responsible user), check a title and blocker update, the inline comment, the `409` while a checkout or execution run holds the issue and the success after the run ended, the company boundary, and that a restricted key still needs a run.

## Verification

Head `31cbc69c754e85165972186dc04df4f41e7a44c9`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/issue-runless-agent-key-routes.test.ts) were run against the base's production code. 4 tests fail there. `403` "Cross-issue writes need a run" and `401` "Agent run id required" for the runless update, the inline comment, and the held-issue cases. On the head the same run gives: 6 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: runless writes from a standard external key skip the cross-issue influence limit. That limit counts writes per run, and these writes have no run. Each write is still checked against the agent's own authorization and logged in the activity log.
- Plugin host services that call `issueService` without a run are unchanged: the execution-lock rule is applied in the route, not in the shared service.

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
