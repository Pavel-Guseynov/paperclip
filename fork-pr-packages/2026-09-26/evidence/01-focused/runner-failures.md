# Change01 Runner verification blockers

Recorded 2026-09-26. This is a read-only diagnosis of retained executions owned by the root agent. No test, build, install, branch switch, source edit, or Git mutation was performed by the diagnosing agent. Only this evidence file was added.

- Candidate head: `bed8d5c5f80d7b756626c244f187ec12b06e1340`.
- Matching upstream base: `7f3c06dac4604dddcf870085f1a623c102261358`.
- Full logs inspected: `runner-test.log` (129 lines) and `runner-rust.log` (350 lines), in this directory. The middle section of the Rust log was read separately to recover the small portion truncated from the combined tool response.
- Neither failure is classified as pre-existing. There is no matching-base execution evidence in these logs.

## 1. TypeScript local-runner receipt timeout

Executed command: `pnpm --filter @paperclipai/paperclip-runner test`.

Its declared sequence is `pnpm run test:typescript && pnpm run test:rust`. The TypeScript command runs its preparation before package Vitest.

| Stage | Retained result |
| --- | --- |
| Eval-kernel TypeScript build | Succeeded. |
| Debug Rust workspace binaries | Build succeeded in 4.41 seconds, with three dead-code warnings. |
| Node preparation tests | 38 passed, zero failed/skipped. |
| Package Vitest | 1 failed, 2,087 passed, 10 skipped; 149 files: 1 failed, 147 passed, 1 skipped. |
| Shell result | Exit 1. The chained Rust tests did not execute. |

Failure: `src/mock-core/local-runner.test.ts`, suite `Local runner and fake harness`, test `runs lifecycle, tool, file, structured-result, and process-exit events`.

Observed exception: `Timed out waiting for command_happy_path_1`, thrown by the 3,000 ms receipt timer in `src/mock-core/local-runner.ts:354`. The failed test took approximately 3,010 ms. Overall Vitest duration was 267.89 seconds.

The authoritative source identifies this as the first `run.prepare` command. `LocalRunnerController.start()` creates a child process and awaits `#initialize()`; `#initialize()` awaits `run.prepare` before sending `session.open` and `turn.start`. Thus the receipt timeout precedes those later initialization commands and all assertions about the completed trace.

In Rust, `local_runner.rs:443` dispatches `run.prepare` through `start_harness()`, then emits its accepted command receipt at line 483. `start_harness()` starts the fake harness and waits for its ready message with a two-second deadline. This describes the path that must complete; the retained failing execution does not establish where it stopped or whether output was delayed.

### Deepest supported cause and observability limit

The controller did not observe the first command receipt before its timer fired. **Why that receipt was absent is not observable in the retained log.** The log has no child stdout/stderr, lifecycle trace, received message inventory, or child exit fact for the failed invocation.

The controller stores diagnostics in an internal, bounded in-memory array. Its test supplies no diagnostic callback. Initialization rejects before returning the handle/trace, and the timeout error does not include retained diagnostics. These source facts explain why the retained failure does not identify the child-side cause.

Do not diagnose CPU contention, a startup race, missing binaries, a particular OS defect, or a contribution regression from this timeout alone. The preceding successful build and other tests are relevant context, not causal proof. Do not increase timeouts or alter the Runner as part of the change01 classification task.

### Minimal same-command base/head comparison

Once active gates release the shared checkout, the owner can run this identical declared command separately at the candidate and matching base named above:

```sh
pnpm --filter @paperclipai/paperclip-runner test:typescript:vitest src/mock-core/local-runner.test.ts -t 'runs lifecycle, tool, file, structured-result, and process-exit events'
```

The declared wrapper prepares eval dependencies and rebuilds the debug Rust binaries before the selected package Vitest test, avoiding stale binaries from another source revision. Keep the normal local environment; do not set a fake `GITHUB_WORKFLOW=PR`, change timeout/concurrency settings, or bypass preparation. Retain full output and exact source head for each execution.

A matching base failure supports a shared failure at that scope, but still does not recover the missing child trace. Two focused passes show only that this isolated comparison did not reproduce the full-suite failure. They do not establish load as its cause, erase the full-run failure, or establish complete suite acceptance.

## 2. Rust listener invalid-peer assertion

Independent executed command: `pnpm --filter @paperclipai/paperclip-runner test:rust`.

Declared expansion: `cargo test --release --manifest-path runner/Cargo.toml --locked --workspace` from the Runner package.

| Stage | Retained result |
| --- | --- |
| Release Rust build | Succeeded in 21.93 seconds. Three library dead-code warnings; library-test build reports two duplicated warnings. |
| Core library test binary | 294 tests ran: 293 passed, 1 failed, zero ignored/measured/filtered; 18.68 seconds. |
| Shell result | Exit 101. No later binary/integration/doc-test completion is shown; do not claim the full Rust workspace suite passed. |

Failure: `durable::transport::tests::listener_rejects_invalid_peer_before_accepting_valid_bootstrap_peer`, panic at `crates/runner-core/src/durable/transport.rs:2195:22`:

> invalid listener peer unexpectedly authenticated

### What the assertion actually establishes

`AuthenticatedTransport::connect()` returns `Result<Option<(Self, Welcome)>, ConnectFailure>` (`transport.rs:950–957`). A nonblocking listener with no immediately accepted peer returns `Ok(None)` when `accept()` returns `WouldBlock` (`transport.rs:321`, propagated at line 984). An authenticated connection is a distinct `Ok(Some((transport, welcome)))` result.

The failing test matches `Err(error)` as expected and sends **every `Ok(_)` result**, including `Ok(None)`, into the quoted panic. Therefore the panic proves only that the call returned an `Ok` variant. **It does not prove that the invalid peer authenticated.** The log does not record the inner option value, accepted socket state, or authentication exchange.

The invalid-peer fixture establishes a TCP connection, sends a channel notification, begins WebSocket negotiation, reads the auth hello, and sends an `auth_challenge` with an empty payload. Normal authentication deserializes that payload into `AuthChallenge`, whose credential/nonce/identity/proof fields are required, then validates envelope/binding/HMAC and awaits a secure welcome. Those checks do not treat the fixture's empty payload as a valid authentication. The separate valid-peer phase is after the failed assertion and was not reached in the failing test.

### Deepest supported cause and observability limit

The test expected a connection error and received an `Ok` result; its failure message conflates “no accepted peer yet” with “authenticated peer.” This result-discrimination problem is directly visible in the source. The retained execution does not reveal which inner result occurred or establish an OS or scheduling cause. **Do not report an authentication bypass, a macOS bug, a race, or a pre-existing failure from this evidence.**

### Minimal same-command base/head comparison

At each of the two exact revisions above, after active gates release the checkout, use the existing package script with native Cargo/libtest selection:

```sh
pnpm --filter @paperclipai/paperclip-runner test:rust --lib durable::transport::tests::listener_rejects_invalid_peer_before_accepting_valid_bootstrap_peer -- --exact
```

This retains release mode, the manifest, the lockfile, and workspace selection, and selects only the failing library test. It does not rerun the 293 unrelated library tests or later integration targets. Do not add a thread-count workaround, retry loop, sleep, or source change. Retain exact head, complete stdout/stderr, exit code and counts. A narrow pass does not establish that the original complete run was healthy; a matching base failure must actually be observed before describing it as shared with base.

## Scope and disposition

Read-only `git diff --name-status upstream/master...HEAD -- packages/paperclip-runner packages/paperclip-eval-kernel pnpm-lock.yaml package.json pnpm-workspace.yaml patches` returned no paths. These Runner and dependency sources are unchanged by change01. That is scope evidence, **not proof that either observed failure pre-existed**.

Both are independent verification blockers for claiming all upstream gates green. The first command did not reach Rust tests; the second independent command ran and failed its library binary. Existing full-server/browser gates must finish without switching their checkout. Matching-base and candidate comparisons remain unexecuted by this diagnosis. No Runner correction or widened task scope is proposed.
