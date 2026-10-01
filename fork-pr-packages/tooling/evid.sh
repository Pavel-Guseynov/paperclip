#!/bin/bash
# usage: evid.sh <worktree> <baseref> <outlog> -- <test files...>
# Reverts every non-test file changed between baseref and HEAD (working tree), runs the tests, restores.
set -u
wt=$1; base=$2; out=$3; shift 3; [ "$1" = "--" ] && shift
cd "$wt"
save=$(mktemp -d /tmp/qz/evid.XXXX)
mapfile -t prod < <(git diff --name-only "$base" -- . | grep -v -E '(\.test\.(ts|tsx|mjs)$|__tests__/|\.md$)')
for f in "${prod[@]}"; do mkdir -p "$save/$(dirname "$f")"; if [ -e "$f" ]; then cp "$f" "$save/$f"; fi; if git cat-file -e "$base:$f" 2>/dev/null; then git show "$base:$f" > "$f"; else rm -f "$f"; fi; done
chown -R qzrunner "$wt" 2>/dev/null
runuser -u qzrunner -- bash -c ". /opt/pch/env.sh; cd $wt && npx vitest run $* 2>&1" > "$out" 2>&1
for f in "${prod[@]}"; do if [ -e "$save/$f" ]; then cp "$save/$f" "$f"; else rm -f "$f"; fi; done
rm -rf "$save"
git status --short | head
