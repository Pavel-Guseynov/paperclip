# Change 01 browser verification

The CI root specification union ran on contribution head `bed8d5c5f80d7b756626c244f187ec12b06e1340` with `PAPERCLIP_E2E_SKIP_LLM=true PAPERCLIP_PLAYWRIGHT_CHANNEL=chrome pnpm run test:e2e` and all 33 specifications. The exact command is retained in completed-gates.json. The process exited 1: 139 passed, 2 failed, 4 skipped, duration 9.6 minutes. Partition selection alone is not test proof.

The complete retained output is operator-local at `.git/fork-01-focus-2026-09-26/browser.log`. It includes test credentials and internal fixture data and is intentionally not copied into the public package. Screenshots and error contexts remain in `tests/e2e/test-results/`. A read-only reviewer inspected the full log, both error contexts, screenshots, and implicated sources. No matching upstream execution was performed; neither failure is classified as pre-existing.

## Pipeline tutorial

`tests/e2e/pipelines-tutorial-flow.spec.ts:563` expected the Launch blog post card in Assets after confirming Move it. The card remained in Drafting and the dialog remained open. The complete execution interval at log lines 21370–21500 contains no transition request for that card. The UI handler in `ui/src/pages/Pipelines.tsx:1888` should issue that mutation. The event/click cause is not observable: this first attempt retained no trace because tracing was configured only for the first retry and retries were zero. A visible stale dialog is the symptom, not a proven source cause.

Artifact directory: `pipelines-tutorial-flow-Pi-2f642--review-queue-and-learnings-chromium`.

## Smoke Lab P5

`tests/e2e/smoke-lab.shared.ts:405` expected a positive quarantine count after schema refresh and received zero. P1–P4 passed; P6's session gateway operation was never reached. Sources show P1/P2 set the reusable sidecar schema to `changed`; setting it again does not toggle it. A later fresh connection can therefore discover the changed catalog as its initial state and yield no subsequent delta. Logs contain the earlier schema changes, P5 catalog GET, schema change, and successful HTTP refresh. They do not retain the exact sidecar PID/schema state or full discovery payload needed to prove this mechanism for the failing execution. This is a source-supported hypothesis, not an established root cause.

Artifact directory: `smoke-lab-p5-p7-Smoke-Lab--7a95d-o-the-results-API-smoke-lab-chromium`.

## Continuation blockers

The browser gate is red. Investigating the pipeline requires retained event/network trace; investigating Smoke Lab requires its actual catalog state across the preceding scenarios. Narrow reruns alone would only show reproduction or non-reproduction. No unrelated UI or fixture fix was added to Change 01.
