# fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode

| Field | Value |
| --- | --- |
| Branch | `pr/11-native-runner-darwin-lsof-unicode` |
| Head | `c080ad87171d4e09d36e48e331c3169262a9f964` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `fix(native-runner): decode hex-escaped lsof paths without corrupting Unicode` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `server/src/services/native-runtime/native-runner-file-handoff.test.ts` | +143 | -0 |
| `server/src/services/native-runtime/native-runner-file-handoff.ts` | +17 | -2 |

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

Head `c080ad87171d4e09d36e48e331c3169262a9f964`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (server/src/services/native-runtime/native-runner-file-handoff.test.ts) were run against the base's production code. 2 tests fail there. Registration fails with `ENOENT` for the escaped path, and the invalid escape run fails with `ENOENT` instead of the descriptor error. On the head the same run gives: 21 passed (including the real macOS `/usr/sbin/lsof` check).
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Only the macOS branch changes. Linux and other hosts read `/proc/self/fd` or `/dev/fd` as before.

> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.

## Model Used

- Provider and model: Google Gemini 3.1 Pro (`gemini-3.1-pro`, 1M-token context window), used through Antigravity.
- Capabilities used: tool use (shell, file reads and edits), code execution, extended reasoning, and duplicate/issue search across `paperclipai/paperclip`.

## Checklist

- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used (with version and capability details)
- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work
- [x] I have searched GitHub for duplicate or related PRs and linked them above
- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template
- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)
- [x] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details
- [x] I have run tests locally and they pass
- [x] I have added or updated tests where applicable
- [x] I have updated relevant documentation to reflect my changes
- [x] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [x] I will address all Greptile and reviewer comments before requesting merge
