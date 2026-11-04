# feat(build): allow skipping native runner binary compilation via PAPERCLIP_SKIP_RUNNER_BINARY

| Field | Value |
| --- | --- |
| Branch | `pr/32-optional-native-runner-binary` |
| Head | `34d6dd25beaa81838b2b3f195cdebea81cc40b58` |
| Base commit | `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Upstream base | `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e` |
| Stack prerequisite | none (based on upstream master) |
| Proposed title | `feat(build): allow skipping native runner binary compilation via PAPERCLIP_SKIP_RUNNER_BINARY` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
| `README.md` | +1 | -1 |
| `doc/DEVELOPING.md` | +1 | -0 |
| `docs/deploy/environment-variables.md` | +2 | -0 |
| `docs/deploy/local-development.md` | +1 | -0 |
| `docs/start/quickstart.md` | +1 | -1 |
| `packages/paperclip-runner/README.md` | +3 | -1 |
| `packages/paperclip-runner/package.json` | +2 | -2 |
| `packages/paperclip-runner/scripts/build-binary.mjs` | +65 | -0 |
| `packages/paperclip-runner/scripts/build-binary.test.mjs` | +116 | -0 |
| `server/package.json` | +1 | -1 |
| `server/src/services/native-runtime/native-codex-runner.test.ts` | +92 | -0 |

The pull request body follows the line. Copy it as it is.

---

## Thinking Path

> - Paperclip is the open source app people use to manage AI agents for work.
> - The root `pnpm build` and the server's `prepare:runner-vendor` step always compile and stage the Rust native runner binary (`paperclip-runnerd`).
> - Deployments and packaging environments that run only legacy CLI/API adapters still need to build the server, UI, CLI, and TypeScript workspace packages without installing a Rust toolchain.
> - Without an opt-out flag, `pnpm build` fails with `spawnSync cargo ENOENT` whenever `cargo` and `rustc` are absent.
> - This pull request adds `PAPERCLIP_SKIP_RUNNER_BINARY=1` to skip compiling and staging `paperclip-runnerd` while still building and vendoring the runner's TypeScript output.
> - The benefit is that operators and packagers who do not use the Rust native runner can build Paperclip without a Rust toolchain, while the default build remains unchanged.

## Linked Issues or Issue Description

No issue exists. Issue description (feature):

**Problem or motivation**
Building Paperclip from source always invokes `cargo build --release` for `paperclip-runnerd`, even when a deployment only uses TypeScript adapters and has no Rust toolchain installed.

**Proposed solution**
Honor `PAPERCLIP_SKIP_RUNNER_BINARY` (`1`, `true`, or `yes`, case-insensitive) in `packages/paperclip-runner/scripts/build-binary.mjs` and `server/package.json` so the TypeScript runner output builds and vendors cleanly without Cargo, while selecting a native-runtime provider without the binary fails explicitly with `paperclip_runner_binary_missing`.

**Alternatives considered**
Patching `package.json` scripts downstream during packaging, which duplicates build logic and drifts on upstream updates.

**Roadmap alignment**
Build and packaging ergonomics for existing runtime modes; adds no new product surface.

No related open pull request was found.

## What Changed

- `packages/paperclip-runner/scripts/build-binary.mjs` checks `PAPERCLIP_SKIP_RUNNER_BINARY` (`1`, `true`, `yes`, case-insensitive). When set, it skips Cargo compilation and binary staging and removes any stale `dist/bin` directory.
- `server/package.json` clears `dist/vendor/paperclip-runner` before copying the runner's `dist` output so stale vendored binaries are never retained when skipping the binary build.
- When `PAPERCLIP_SKIP_RUNNER_BINARY` is unset or `0`/`false`, the default `pnpm build` compiles and stages `paperclip-runnerd` unchanged.
- Selecting a native-runtime provider when the binary was not built fails explicitly with `paperclip_runner_binary_missing`.
- `README.md`, `doc/DEVELOPING.md`, `docs/deploy/environment-variables.md`, `docs/deploy/local-development.md`, `docs/start/quickstart.md`, and `packages/paperclip-runner/README.md` document the option.
- Unit and integration tests verify both `build-binary.mjs` modes and the explicit missing-binary error on native-runtime execution.

## Verification

Head `34d6dd25beaa81838b2b3f195cdebea81cc40b58`. Base: `paperclipai/paperclip` master `925965a09b8931c1791f2402f3e7595e2845e68e`.

- Regression proof: the head's tests (`packages/paperclip-runner/scripts/build-binary.test.mjs`, `server/src/services/native-runtime/native-codex-runner.test.ts`) were run against the base's production code. 4 tests fail there. On the base `packages/paperclip-runner/package.json` invokes `cargo build --release` unconditionally and fails without Cargo, while on the head `PAPERCLIP_SKIP_RUNNER_BINARY=1` skips the binary build cleanly and native-runtime execution without the binary fails explicitly with `paperclip_runner_binary_missing`. On the head the same run gives: 8 passed.
- Typecheck and Vitest suites (`pnpm -r typecheck` and `pnpm test:run` on the touched packages and test files) pass locally with PostgreSQL.

## Risks

- Default behavior is unchanged when `PAPERCLIP_SKIP_RUNNER_BINARY` is not set.
- A deployment built with `PAPERCLIP_SKIP_RUNNER_BINARY=1` cannot run native-runtime providers (`acpx`, `claude_managed`, `aws_agentcore`) until rebuilt without the flag or pointed at a `PAPERCLIP_RUNNER_BINARY`.

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
