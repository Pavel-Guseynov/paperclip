#!/usr/bin/env bash
# Regression proof that restores only the named production files to U (the
# wiring), keeping every other file of the head, then runs the tests.
# SOURCE (default U) names the revision the restored files come from.
# Usage: regression-partial.sh <label> <lane> <vitest-project-dir> <restore-file>... -- <vitest-arg>...
set -u
label="$1"; lane="$2"; project="$3"; shift 3
U=7b7c4d4172d6aac14919e2682b702ae87bc17653
source="${SOURCE:-$U}"
restore=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do restore+=("$1"); shift; done
shift
out=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/logs/$label
mkdir -p "$out"
cd "$lane" || exit 2
[ -z "$(git status --porcelain | grep -v ' pnpm-lock.yaml$')" ] || { echo "tree not clean" >&2; exit 2; }

run_tests() {
  local log="$1"; shift
  local root rc
  root="$(cd "$(mktemp -d /tmp/pv-XXXXXX)" && pwd -P)"
  mkdir -p "$root/h" "$root/t"
  (cd "$project" && env CI=true NODE_ENV=test PAPERCLIP_HOME="$root/h" PAPERCLIP_CONFIG="$root/h/config.json" \
    PAPERCLIP_INSTANCE_ID="vt-regression-$$" TMPDIR="$root/t" pnpm exec vitest run "$@") > "$log" 2>&1 < /dev/null
  rc=$?
  rm -rf "$root"
  return $rc
}

head="$(git rev-parse HEAD)"
run_tests "$out/regression-head.log" "$@"
echo "head=$head exit=$?" > "$out/REGRESSION"
git restore --source="$source" --worktree -- "${restore[@]}"
echo "restored-from-$source: ${restore[*]}" >> "$out/REGRESSION"
run_tests "$out/regression-base.log" "$@"
echo "base-production exit=$?" >> "$out/REGRESSION"
git restore --worktree -- "${restore[@]}"
[ -z "$(git status --porcelain | grep -v ' pnpm-lock.yaml$')" ] && echo "restored clean" >> "$out/REGRESSION" || echo "RESTORE NOT CLEAN" >> "$out/REGRESSION"
for log in regression-head regression-base; do
  printf '%s: %s\n' "$log" "$(grep -aE '^ +(Test Files|Tests) ' "$out/$log.log" | tr -s ' ' | tr '\n' ' ')" >> "$out/REGRESSION"
done
