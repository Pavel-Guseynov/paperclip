# test(server): isolate workspace runtime port reservations between tests

| Field | Value |
| --- | --- |
| Branch | `pr/12-workspace-runtime-exposure-isolation` |
| Head | `1c0f151d7d49618cb11b29b8c967e83badac76ca` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `test(server): isolate workspace runtime port reservations between tests` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/__tests__/workspace-runtime-start-terminality.test.ts` | +8 | -0 |
| `server/src/__tests__/workspace-runtime.test.ts` | +12 | -6 |
| `server/src/services/workspace-runtime-exposure.test.ts` | +14 | -4 |
| `server/src/services/workspace-runtime.ts` | +1 | -0 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Workspace runtime services claim ports, and the tests for them share module state.
> - `resetRuntimeServicesForTests()` cleared services, claims, and exposure ports, but not the in-flight port reservations.
> - A reservation left by one test could make a later test fail to claim its port.
> - This pull request clears the reservations on reset and gives the exposure tests their own identities and port range.
> - The benefit is that the workspace runtime tests do not depend on each other's leftovers.

## Linked Issues or Issue Description

No issue exists. The problem: a port reservation left in module state by one workspace runtime test made a later test fail to claim its port. This pull request changes test isolation only.

Related open pull request: #10624 (draft) makes `resetRuntimeServicesForTests()` stop registered services before it clears its maps. The two changes are independent; the second one to merge needs a small rebase.

## What Changed

- `resetRuntimeServicesForTests()` also clears the in-flight port reservations.
- The exposure lifecycle tests use their own execution workspace identity.
- Contiguous fixture ports come from a fixed range below the Linux and Darwin ephemeral ranges and outside the runtime exposure ranges.
- A test reserves a port, resets the services, and checks that the reservation is gone.

## Verification

Head `1c0f151d7d49618cb11b29b8c967e83badac76ca`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/__tests__/workspace-runtime-start-terminality.test.ts) were run against the base's production code. 1 test fails there. The port reservation survives `resetRuntimeServicesForTests()`. On the head the same run gives: 1 failed | 203 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Test-only behavior: `resetRuntimeServicesForTests()` is called only by tests.

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
