#!/usr/bin/env bash
# Regression proofs for 09, 10 and 13, run one after another in idle clones.
set -u
S=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad
F=/Users/pavelguseynov/paperclip-fork
U=7b7c4d4172d6aac14919e2682b702ae87bc17653
H09=fd793881526ae41433115a2c28436c9671bad6f7
H10=bfd3092312d890c4f328ad9b90bda0329e41d02a
H13=e3fe89cf5
log="${S}/logs/regression-all.log"

git -C "${S}/fix05" fetch -q "${F}" feat/verified-terminal-delivery-evidence feat/revision-keyed-review-admission chore/pnpm-11-toolchain
git -C "${S}/fix05" checkout -q --detach "${H09}" && {
  bash "${S}/regression-run.sh" r09-server "${S}/fix05" server src/__tests__/delivery-verification.test.ts \
    src/__tests__/issue-execution-policy-routes.test.ts src/__tests__/issue-execution-policy.test.ts \
    src/__tests__/native-status-arbiter-corpus.test.ts
  echo "r09-server: $(tr '\n' ' ' < "${S}/logs/r09-server/REGRESSION")" >> "${log}"
}
git -C "${S}/fix05" checkout -q --detach "${H10}" && {
  bash "${S}/regression-partial.sh" r10-bind "${S}/fix05" server \
    server/src/services/native-runtime/status-decision-committer.ts -- \
    src/__tests__/review-admission.test.ts src/__tests__/native-status-arbiter-corpus.test.ts
  echo "r10-bind: $(tr '\n' ' ' < "${S}/logs/r10-bind/REGRESSION")" >> "${log}"
  SOURCE="${H09}" bash "${S}/regression-partial.sh" r10-decision "${S}/fix05" server \
    server/src/services/issue-thread-interactions.ts -- \
    src/__tests__/review-admission.test.ts src/__tests__/native-status-arbiter-corpus.test.ts
  echo "r10-decision: $(tr '\n' ' ' < "${S}/logs/r10-decision/REGRESSION")" >> "${log}"
}

# 13: the new policy check against U's tree (the script file is added untracked
# for the run and removed afterwards), then against the 13 head.
out="${S}/logs/r13-policy"; mkdir -p "${out}"
git -C "${S}/fix05" checkout -q --detach "${U}" && {
  git -C "${S}/fix05" show "${H13}:scripts/check-pnpm-version-policy.mjs" > "${S}/fix05/scripts/check-pnpm-version-policy.mjs"
  (cd "${S}/fix05" && node scripts/check-pnpm-version-policy.mjs) > "${out}/base.log" 2>&1
  echo "r13-policy base(U) exit=$?" > "${out}/REGRESSION"
  rm -f "${S}/fix05/scripts/check-pnpm-version-policy.mjs"
  [ -z "$(git -C "${S}/fix05" status --porcelain)" ] && echo "restored clean" >> "${out}/REGRESSION" || echo "RESTORE NOT CLEAN" >> "${out}/REGRESSION"
}
git -C "${S}/fix05" checkout -q --detach "${H13}" && {
  (cd "${S}/fix05" && node scripts/check-pnpm-version-policy.mjs) > "${out}/head.log" 2>&1
  echo "r13-policy head exit=$?" >> "${out}/REGRESSION"
  (cd "${S}/fix05" && node --test ./scripts/check-pnpm-version-policy.test.mjs) > "${out}/head-test.log" 2>&1
  echo "r13-policy head test exit=$?" >> "${out}/REGRESSION"
}
git -C "${S}/fix05" checkout -q --detach d0768999ede2cfc31c926468698aa833fb018e1f
echo "r13-policy: $(tr '\n' ' ' < "${out}/REGRESSION")" >> "${log}"
echo "regression-late: done $(date -u +%FT%TZ)" >> "${log}"
