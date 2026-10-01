#!/bin/bash
# usage (as qzrunner, in repo root): node-tests.sh <out log>
# Runs every tracked node:test file outside the vitest workspace packages.
files=$(git ls-files | grep -E "\.test\.(mjs|js|cjs)$" | grep -E "^(\.github/scripts/tests|scripts|\.agents/skills/[^/]+/scripts)/")
node --test --test-concurrency=2 $files > "$1" 2>&1; status=$?
echo "# node-tests exit $status files $(echo $files | wc -w)" >> "$1"
exit $status
