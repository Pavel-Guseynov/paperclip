#!/usr/bin/env bash
# Reruns, in isolation, each failing runner-vitest file and runner-rust test of a
# branch gate run that is not also failing in the U baseline. Appends
# "<result>\t<gate>\t<file-or-test>" lines to logs/<label>/TRIAGE.
# Usage: triage-runner.sh <label> <lane-root>
#   <lane-root> must be checked out at the label's head and hold the Rust build.
set -u
label="$1"; lane="$2"
scratch=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad
out="$scratch/logs/$label"
baseline="$(bash "$scratch/fails.sh" U U-full | sed -E 's/ > .*//' | sort -u)"
bash "$scratch/fails.sh" "$label" | grep -E '^runner-(vitest|rust)	' | sed -E 's/ > .*//' | sort -u | while IFS=$'\t' read -r gate item; do
  if grep -qxF "$gate	$item" <<< "$baseline"; then
    printf 'baseline\t%s\t%s\n' "$gate" "$item" >> "$out/TRIAGE"
    continue
  fi
  root="$(cd "$(mktemp -d /tmp/pv-XXXXXX)" && pwd -P)"
  mkdir -p "$root/h" "$root/t"
  if [ "$gate" = runner-vitest ]; then
    (cd "$lane/packages/paperclip-runner" && env CI=true PAPERCLIP_HOME="$root/h" \
      pnpm exec vitest run "$item") > "$out/triage-runner-$(basename "$item").log" 2>&1 < /dev/null
  else
    (cd "$lane/packages/paperclip-runner" && env TMPDIR="$root/t" \
      cargo test --release --manifest-path runner/Cargo.toml --locked --workspace "$item") \
      > "$out/triage-runner-$item.log" 2>&1 < /dev/null
  fi
  rc=$?
  rm -rf "$root"
  printf '%s\t%s\t%s\n' "$([ $rc -eq 0 ] && echo isolated-pass || echo isolated-FAIL)" "$gate" "$item" >> "$out/TRIAGE"
done
