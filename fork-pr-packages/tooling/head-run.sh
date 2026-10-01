#!/bin/bash
# usage (as qzrunner): head-run.sh <repo dir> <git ref> <label>
# Checks out <ref> (detached), installs if needed, runs every gate and the complete suite.
. /opt/pch/env.sh
dir="$1"; ref="$2"; label="$3"
cd "$dir" || exit 2
out=/opt/pch/logs/$label; mkdir -p "$out"; sum="$out/summary.txt"
git checkout -q --detach "$ref" || exit 2
git checkout -q -- . 2>/dev/null
head=$(git rev-parse HEAD)
echo "# $label $head $(date -Is)" > "$sum"
run(){ n=$1; shift; t0=$(date +%s); bash -c "$*" > "$out/$n.log" 2>&1; echo "$n $? $(( $(date +%s)-t0 ))s" >> "$sum"; git checkout -q -- pnpm-lock.yaml packages/paperclip-runner/test/fixtures/fake-opencode-server.mjs 2>/dev/null; }
run install "pnpm install --no-frozen-lockfile --config.auto-install-peers=false --config.dangerously-allow-all-builds=true; git checkout -- pnpm-lock.yaml pnpm-workspace.yaml"
run typecheck pnpm typecheck
run build pnpm build
for c in tokens token-gates node-version no-git-push module-boundaries; do run check-$c pnpm check:$c; done
run check-migrations pnpm --filter @paperclipai/db check:migrations
for c in protocol-manifest protocol-types capability-contract semantic-contracts semantic-action-catalog protocol protocol-without-vitest runner all all-without-vitest static api-authority replay-goldens browser-tokens forbidden-imports tracked-imports numbered-milestones package-boundaries clean-consumers eval-kernel protocol-coverage capability-inventory runner-workflow-traceability conformance-parity replay-parity; do run runner-check-$c pnpm --filter @paperclipai/paperclip-runner check:$c; done
run node-tests /opt/pch/node-tests.sh "$out/node-tests-detail.log"
/opt/pch/mk-runall.sh
echo "tracked-changes-after-gates: $(git status --short | grep -v '^??' | wc -l)" >> "$sum"
/opt/pch/suite.sh "$label" > /dev/null
echo "suite $(sed -n 2p $out/suite-summary.txt)" >> "$sum"
echo "# done $(date -Is)" >> "$sum"
