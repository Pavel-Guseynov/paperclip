#!/usr/bin/env bash
# Runs regression.sh for every change whose clone is idle, one after another.
# Each step checks out the expected head (detached) in its fix clone and fails
# the step when the head differs. Labels are r<NN>-<project>.
set -u
S=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad
log="${S}/logs/regression-all.log"

at() { # at <clone> <expected-sha>
  git -C "${S}/$1" checkout -q --detach "$2" || { echo "checkout $2 in $1 failed" >> "${log}"; return 1; }
}

reg() { # reg <label> <clone> <project-dir> <files...>
  local label="$1" clone="$2"; shift 2
  bash "${S}/regression.sh" "${label}" "${S}/${clone}" "$@"
  echo "${label}: $(tr '\n' ' ' < "${S}/logs/${label}/REGRESSION")" >> "${log}"
}

at fix0102 9044c3df1abf7f523a142f3aa795472ff0246cf1 && {
  reg r01-server fix0102 server src/__tests__/agent-auth-middleware.test.ts src/__tests__/codex-local-execute.test.ts src/__tests__/tool-gateway.test.ts
  reg r01-codex-local fix0102 packages/adapters/codex-local src/server/codex-home.test.ts
}
at fix0102 4ef9dc846 && {
  reg r02-server fix0102 server src/__tests__/agent-auth-middleware.test.ts src/__tests__/codex-local-execute.test.ts src/__tests__/tool-gateway.test.ts
  reg r02-codex-local fix0102 packages/adapters/codex-local src/server/codex-home.test.ts
}
at fix03 191a0283e && {
  reg r03-cli fix03 cli src/__tests__/common.test.ts
  reg r03-adapter-utils fix03 packages/adapter-utils src/execution-target-sandbox.test.ts src/server-utils.test.ts
  reg r03-codex-local fix03 packages/adapters/codex-local src/server/execute.runtime-callback.test.ts
  reg r03-cursor-cloud fix03 packages/adapters/cursor-cloud src/server/execute.test.ts
  reg r03-server fix03 server src/__tests__/heartbeat-runtime-mcp-servers.test.ts src/__tests__/server-startup-feedback-export.test.ts
}
at fix04 7b9526e89 && {
  reg r04-shared fix04 packages/shared src/tool-connection-health.test.ts
  reg r04-server fix04 server src/__tests__/remote-mcp-timeout-health.test.ts
}
at fix05 d0768999e && reg r05-server fix05 server src/__tests__/http-log-redaction.test.ts
at fix0607 3c858b621 && reg r06-server fix0607 server src/__tests__/issue-execution-policy-routes.test.ts src/__tests__/issue-execution-policy.test.ts
at fix0607 6b754cea8 && reg r07-server fix0607 server src/__tests__/heartbeat-review-handoff-retry.test.ts src/services/recovery/review-handoff-retry.test.ts
at fix08 d9ea1f97a && reg r08-server fix08 server src/__tests__/workspace-validation-recovery-precedence.test.ts src/services/legacy-execution-recovery.test.ts src/services/recovery/stranded-notice.test.ts
at fix1112 ea6107e61 && reg r11-server fix1112 server src/services/native-runtime/native-runner-file-handoff.test.ts
at fix1112 127a04737 && reg r12-server fix1112 server src/__tests__/workspace-runtime-start-terminality.test.ts src/__tests__/workspace-runtime.test.ts src/services/workspace-runtime-exposure.test.ts
echo "regression-all: done $(date -u +%FT%TZ)" >> "${log}"
