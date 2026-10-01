# fix(adapter-utils): fail the owning run when writing child stdin fails

| Field | Value |
| --- | --- |
| Branch | `pr/28-runchildprocess-stdin-stream-error` |
| Head | `0d59ec64191235c292ee8c034a6277c0f69d1174` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(adapter-utils): fail the owning run when writing child stdin fails` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `packages/adapter-utils/README.md` | +9 | -0 |
| `packages/adapter-utils/src/server-utils.test.ts` | +72 | -0 |
| `packages/adapter-utils/src/server-utils.ts` | +26 | -5 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - Adapters start agent CLIs as child processes and write the prompt to the child's stdin.
> - `runChildProcess` wrote that stdin without an error listener on the stream.
> - When the child closed its stdin before or during the write, the write failed with `EPIPE`, the stream emitted an unhandled error, and the server process crashed with every other run.
> - This pull request handles the stdin error and fails only the owning run.
> - The benefit is that one misbehaving child cannot stop the server.

## Linked Issues or Issue Description

No issue exists in this form; see the related pull requests below. Issue description (bug):

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

This pull request differs in one decision: a run whose prompt did not reach the child fails with the stdin error code, instead of taking the child's exit code. Maintainers choose the semantics. If they want the run to fail, this pull request supersedes the others. If they prefer the exit code to decide, this pull request should fold its tests into #14057.

## What Changed

- `runChildProcess` listens for errors on the child's stdin whenever it writes stdin. A failed write is reported through `onLogError` with the owning run ID. The child gets `SIGTERM`, then `SIGKILL` after the grace period, and the result carries the error code (`EPIPE`, or `child_stdin_write_failed` without one) and a non-zero exit code. Other runs continue.
- When the child has already exited before the write, the write is still skipped and the result follows the child's exit, as on master.
- The adapter-utils README describes the contract.
- Tests run real child processes that close their end of stdin before and during a 2 MB write next to a healthy run, and check that only the owning run fails. Another test checks that a child that ignores `SIGTERM` is killed.

## Verification

Head `0d59ec64191235c292ee8c034a6277c0f69d1174`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (packages/adapter-utils/src/server-utils.test.ts) were run against the base's production code. 3 tests fail there. The owning run gets no `EPIPE` result, and the write raises an unhandled `EPIPE` error in the test process. On the head the same run gives: 129 passed.
- Gates and complete suite: NOT RUN YET.

## Risks

- Behavior change: a run whose child closes stdin early, while it keeps running, now fails with the stdin error even if the child then exits with code 0. A child that already exited before the write keeps the master behavior.

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
