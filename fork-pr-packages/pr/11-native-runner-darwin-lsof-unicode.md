# fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode

| Field | Value |
| --- | --- |
| Branch | `pr/11-native-runner-darwin-lsof-unicode` |
| Head | `51039264b5ae2d9dfb7a5820b022ab18f321e794` |
| Base commit | `467125fafb47a8520856504fecc48d6e32055db1` |
| Upstream base | `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/services/native-runtime/native-runner-file-handoff.test.ts` | +170 | -0 |
| `server/src/services/native-runtime/native-runner-file-handoff.ts` | +46 | -2 |

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The native runner registers files that an agent delivers, and it checks the opened file descriptor first.
> - On macOS it reads the descriptor's path from `lsof -F0n`.
> - Under a non-UTF-8 locale, lsof prints every non-ASCII byte as `\xNN` and doubles a literal backslash.
> - The handoff resolved that escaped text as a path, so a deliverable with a non-ASCII name failed with `ENOENT`.
> - This pull request pins the lsof locale and decodes the escapes.
> - The benefit is that deliverables with non-ASCII names register on macOS.

## Linked Issues or Issue Description

No issue exists. Issue description (bug):

**What happened**
On macOS, registering a deliverable named "猫 picture.txt" or "résumé.pdf" failed with `ENOENT` for a path that contained `\xNN` escapes.

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

No related open pull request was found.

## What Changed

- The lsof call pins `LC_ALL=C`, so the name field has one format on every host.
- `\xNN` runs are decoded as UTF-8 and `\\` as one backslash, in one left-to-right pass. A byte run that is not valid UTF-8 fails closed with `paperclip_runner_file_handoff_descriptor_unverifiable`.
- Tests register deliverables through the Darwin branch on any host: they report the platform as Darwin and answer the lsof call the way lsof renders a name field. They run under a C and a UTF-8 server locale, with Chinese, accented, and backslash names, and with an invalid escape run.
- A macOS-only test registers the same names through the real `/usr/sbin/lsof`.

## Verification

Head `51039264b5ae2d9dfb7a5820b022ab18f321e794`. Base: `paperclipai/paperclip` master `467125fafb47a8520856504fecc48d6e32055db1`.

- Regression proof: the head's tests (server/src/services/native-runtime/native-runner-file-handoff.test.ts) were run against the base's production code. 2 tests fail there. Registration fails with `ENOENT` for the escaped path, and the invalid escape run fails with `ENOENT` instead of the descriptor error. On the head the same run gives: 20 passed | 1 skipped.
- Gates and complete suite: NOT RUN YET.

## Risks

- Only the macOS branch changes. Linux and other hosts read `/proc/self/fd` or `/dev/fd` as before.
- The macOS-only test is skipped on Linux CI. It was not run for this pull request; a run on a macOS host is still needed.

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
