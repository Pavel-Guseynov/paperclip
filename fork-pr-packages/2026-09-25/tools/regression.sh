#!/usr/bin/env bash
# Regression proof for one branch head checked out in <lane>: runs the branch's
# changed vitest files twice — with the branch's production files, then with
# every changed non-test file restored to U (files the branch adds are moved
# aside) — and records both results. The tree is restored afterwards.
# Usage: regression.sh <label> <lane> <vitest-project-dir> <test-file>...
#   <vitest-project-dir> is the package whose vitest config runs the files
#   (e.g. server); test files are given relative to it.
set -u
label="$1"; lane="$2"; project="$3"; shift 3
U=7b7c4d4172d6aac14919e2682b702ae87bc17653
out=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/logs/$label
mkdir -p "$out"
cd "$lane" || exit 2
head="$(git rev-parse HEAD)"
[ -z "$(git status --porcelain --untracked-files=no | grep -v ' pnpm-lock.yaml$')" ] || { echo "tree not clean" >&2; exit 2; }

# Runs the files with the runner's per-invocation isolation (own PAPERCLIP_HOME,
# config, instance id, and TMPDIR under a temp root that is removed afterwards).
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

run_tests "$out/regression-head.log" "$@"
echo "head=$head exit=$?" > "$out/REGRESSION"

# Without rename detection a renamed file is a D (exists only in U) plus an A
# (exists only in the head). The worktree is switched to U's production files
# without touching the index, so the index keeps the head and restores it.
modified=()
deleted=()
added=()
while IFS=$'\t' read -r status path; do
  case "$path" in
    *.test.ts|*.test.tsx|*.test.mjs|*/__tests__/*|*.md|pnpm-lock.yaml) continue ;;
  esac
  case "$status" in
    A) added+=("$path") ;;
    D) deleted+=("$path") ;;
    *) modified+=("$path") ;;
  esac
done < <(git diff --no-renames --name-status "$U" HEAD)

aside="$out/added-aside"
mkdir -p "$aside"
restore=("${modified[@]}" "${deleted[@]}")
[ ${#restore[@]} -gt 0 ] && git restore --source="$U" --worktree -- "${restore[@]}"
for path in "${added[@]}"; do mkdir -p "$aside/$(dirname "$path")"; mv "$path" "$aside/$path"; done
{ echo "restored-to-U: ${modified[*]}"; echo "restored-from-U (absent in head): ${deleted[*]}"; echo "moved-aside (added by branch): ${added[*]}"; } >> "$out/REGRESSION"

run_tests "$out/regression-base.log" "$@"
echo "base-production exit=$?" >> "$out/REGRESSION"

for path in "${added[@]}"; do mv "$aside/$path" "$path"; done
for path in "${deleted[@]}"; do rm -f "$path"; done
[ ${#modified[@]} -gt 0 ] && git restore --worktree -- "${modified[@]}"
[ -z "$(git status --porcelain | grep -v ' pnpm-lock.yaml$')" ] && echo "restored clean" >> "$out/REGRESSION" || echo "RESTORE NOT CLEAN" >> "$out/REGRESSION"
for log in regression-head regression-base; do
  printf '%s: %s\n' "$log" "$(grep -aE '^ +(Test Files|Tests) ' "$out/$log.log" | tr -s ' ' | tr '\n' ' ')" >> "$out/REGRESSION"
done
