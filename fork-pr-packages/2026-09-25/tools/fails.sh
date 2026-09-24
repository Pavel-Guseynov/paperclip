#!/usr/bin/env bash
# Lists the failing test identifiers in every gate log of one or more labels,
# one "<gate>\t<test>" line each, sorted. Usage: fails.sh <label>...
set -u
logs=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/logs
for label in "$@"; do
  for log in "$logs/$label"/*.log; do
    gate="$(basename "$log" .log)"
    # Vitest failure headers, node:test "not ok" lines, and cargo "... FAILED" lines.
    grep -aE '^ FAIL  |^not ok [0-9]+ - |^test [^ ]+ \.\.\. FAILED' "$log" 2>/dev/null \
      | sed -E 's/^ FAIL  //; s/^not ok [0-9]+ - //; s/^test ([^ ]+) \.\.\. FAILED/\1/' \
      | sed -E 's/\x1b\[[0-9;]*m//g' \
      | awk -v g="$gate" '{print g "\t" $0}'
  done
done | sort -u
