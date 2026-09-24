#!/usr/bin/env bash
# Reruns, in isolation, every failing test file of a branch gate run that is not
# also failing in the U baseline, to separate load-induced failures from real ones.
# A baseline file that the branch changes is rerun too ("baseline-rerun"), so its
# failing test names can be compared with U's.
# Usage: triage.sh <label> <lane-root>
# Writes logs/<label>/TRIAGE with one "<result>\t<project>\t<file>" line per file.
set -u
label="$1"; lane="$2"
scratch=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad
out="$scratch/logs/$label"
baseline="$(bash "$scratch/fails.sh" U U-full | cut -f2 | sed -E 's/ > .*//' | sort -u)"
changed="$(git -C "$lane" diff --name-only 7b7c4d4172d6aac14919e2682b702ae87bc17653 HEAD)"
: > "$out/TRIAGE"
bash "$scratch/fails.sh" "$label" | cut -f2 | grep '^|' | sed -E 's/ > .*//' | sort -u | while read -r project file; do
  project="${project//|/}"
  key="|$project| $file"
  result=""
  if grep -qxF "$key" <<< "$baseline"; then
    if grep -q "/${file}\$" <<< "$changed"; then
      result=baseline-rerun
    else
      printf 'baseline\t%s\t%s\n' "$project" "$file" >> "$out/TRIAGE"
      continue
    fi
  fi
  root="$(cd "$(mktemp -d /tmp/pv-XXXXXX)" && pwd -P)"
  mkdir -p "$root/h" "$root/t"
  extra=()
  [ "$project" = "@paperclipai/server" ] && extra=(--pool=forks --isolate)
  (cd "$lane" && env CI=true NODE_ENV=test PAPERCLIP_HOME="$root/h" PAPERCLIP_CONFIG="$root/h/config.json" \
    PAPERCLIP_INSTANCE_ID="vt-triage-$$" TMPDIR="$root/t" \
    pnpm exec vitest run --exclude '**/dist/**' --project "$project" "$file" "${extra[@]}") \
    > "$out/triage-$(basename "$file").log" 2>&1 < /dev/null
  rc=$?
  rm -rf "$root"
  [ -z "$result" ] && result="$([ $rc -eq 0 ] && echo isolated-pass || echo isolated-FAIL)"
  printf '%s\t%s\t%s\n' "$result" "$project" "$file" >> "$out/TRIAGE"
done
