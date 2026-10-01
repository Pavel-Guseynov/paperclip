#!/bin/bash
# usage: gates.sh <label> [phase...]   phases: typecheck build checks runner suite (default: all)
# Runs inside the repo dir as pc. Writes logs to /opt/pch/logs/<label>/ and summary.tsv.
. /opt/pch/env.sh
label="$1"; shift
phases="${*:-typecheck build checks runner suite}"
out=/opt/pch/logs/$label; mkdir -p "$out"
sum="$out/summary.tsv"
echo "# $(git rev-parse HEAD) $(date -Is)" >> "$sum"
run() { # name, command
  local name="$1"; shift
  local t0=$(date +%s)
  bash -c "$*" > "$out/$name.log" 2>&1
  local rc=$?
  printf '%s\t%s\t%ss\n' "$name" "$rc" "$(( $(date +%s) - t0 ))" >> "$sum"
  return $rc
}
for p in $phases; do case $p in
  typecheck) run typecheck "pnpm typecheck" ;;
  build) run build "pnpm build" ;;
  checks)
    for c in tokens token-gates node-version no-git-push module-boundaries; do run "check-$c" "pnpm check:$c"; done
    run check-migrations "pnpm --filter @paperclipai/db check:migrations" ;;
  runner)
    run runner-check-all "pnpm --filter @paperclipai/paperclip-runner check:all"
    for c in protocol-types capability-contract semantic-contracts semantic-action-catalog browser-tokens forbidden-imports tracked-imports numbered-milestones package-boundaries clean-consumers protocol-coverage capability-inventory runner-workflow-traceability; do
      run "runner-check-$c" "pnpm --filter @paperclipai/paperclip-runner check:$c"; done ;;
  suite) run suite "pnpm test:run" ;;
esac; done
cat "$sum"
