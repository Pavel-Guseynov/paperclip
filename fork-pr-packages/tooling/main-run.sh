#!/bin/bash
# usage (as qzrunner): main-run.sh <repo dir> <label>
# Fork main pins pnpm 11: frozen install with the repository's own configuration, then every gate,
# every node:test file and the complete suite (same matrix as head-run.sh).
export PCH_ENV=/opt/pch/env-main.sh; . /opt/pch/env-main.sh
dir="$1"; label="$2"
cd "$dir" || exit 2
out=/opt/pch/logs/$label; mkdir -p "$out"; sum="$out/summary.txt"
head=$(git rev-parse HEAD)
echo "# $label $head $(date -Is)" > "$sum"
run(){ n=$1; shift; t0=$(date +%s); bash -c "$*" > "$out/$n.log" 2>&1; echo "$n $? $(( $(date +%s)-t0 ))s" >> "$sum"; }
run install "pnpm install --frozen-lockfile"
run typecheck pnpm typecheck
run build pnpm build
for c in tokens token-gates node-version pnpm-version no-git-push module-boundaries; do run check-$c pnpm check:$c; done
run check-migrations pnpm --filter @paperclipai/db check:migrations
for c in $(node -e 'const s=require("./packages/paperclip-runner/package.json").scripts; console.log(Object.keys(s).filter(k=>k.startsWith("check:")).map(k=>k.slice(6)).join(" "))'); do run runner-check-$c pnpm --filter @paperclipai/paperclip-runner check:$c; done
run node-tests /opt/pch/node-tests.sh "$out/node-tests-detail.log"
/opt/pch/mk-runall.sh
echo "tracked-changes-after-gates: $(git status --short | grep -v '^??' | wc -l)" >> "$sum"
export PCH_ENV=/opt/pch/env-main.sh; . /opt/pch/env-main.sh
/opt/pch/suite.sh "$label" > /dev/null
echo "suite $(sed -n 2p $out/suite-summary.txt)" >> "$sum"
echo "# done $(date -Is)" >> "$sum"
