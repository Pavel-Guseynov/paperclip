#!/usr/bin/env bash
# Runs upstream's commitperclip PR checks that work offline against a drafted PR.
# Usage: pr-checks.sh <pr-body-file> <title> <clone> <branch> <author-login> <head-branch-name>
set -u
body_file="$1"; title="$2"; clone="$3"; branch="$4"; author="$5"; head_branch="$6"
cd /Users/pavelguseynov/paperclip-fork || exit 2
body="$(cat "$body_file")"
files="$(git -C "$clone" diff --name-status 7b7c4d4172d6aac14919e2682b702ae87bc17653 "$branch" \
  | awk '{s=($1=="D")?"removed":($1=="A")?"added":"modified"; printf "%s{\"filename\":\"%s\",\"status\":\"%s\"}", (NR>1?",":""), $NF, s}')"
for script in check-pr-template check-pr-linked-issue check-pr-dedup-search; do
  printf '%s: ' "$script"
  PR_BODY="$body" PR_TITLE="$title" node ".github/scripts/$script.mjs"
done
printf 'check-pr-test-coverage: '
PR_FILES="[$files]" PR_TITLE="$title" node .github/scripts/check-pr-test-coverage.mjs
printf 'check-pr-lockfile: '
PR_FILES="[$files]" PR_AUTHOR="$author" PR_BRANCH="$head_branch" node .github/scripts/check-pr-lockfile.mjs
