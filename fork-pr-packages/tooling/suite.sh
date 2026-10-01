#!/bin/bash
# usage (as qzrunner, inside a repo with scripts/.run-vitest-all.mjs): suite.sh <label>
# Complete suite = upstream's CI matrix: general-server shards 1/2+2/2, serialized shards 1/2+2/2,
# general-workspaces-a, general-workspaces-b; each through the non-aborting copy of
# scripts/run-vitest-stable.mjs, as four parallel streams. Logs: /opt/pch/logs/<label>/suite-*.log
. ${PCH_ENV:-/opt/pch/env.sh}
label="$1"; out=/opt/pch/logs/$label; mkdir -p "$out"; sum="$out/suite-summary.txt"
head=$(git rev-parse HEAD); t0=$(date +%s)
pnpm run preflight:workspace-links > "$out/suite-preflight.log" 2>&1; pre=$?
stream(){ name=$1; shift; : > "$out/suite-$name.log"; for a in "$@"; do node scripts/.run-vitest-all.mjs $a >> "$out/suite-$name.log" 2>&1; echo "# stream-exit $? $a" >> "$out/suite-$name.log"; done; }
stream s1 "--mode general --group general-server --shard-index 0 --shard-count 2" &
stream s2 "--mode general --group general-server --shard-index 1 --shard-count 2" &
stream s3 "--mode serialized" "--mode general --group general-workspaces-a" "--mode general --group general-workspaces-b" &
wait
# Files that failed under parallel load are rerun alone; only failures that persist count.
node /opt/pch/rerun-failed.mjs "$out"/suite-s?.log > "$out/suite-reruns.txt" 2>&1
fails=$(cat "$out"/suite-s?.log | grep -c "^# stream-exit [^0]")
{
  echo "head $head"
  echo "exit $([ $pre -eq 0 ] && [ $fails -eq 0 ] && echo 0 || echo 1) preflight $pre failed-streams $fails elapsed $(( $(date +%s) - t0 ))s"
  for f in "$out"/suite-s?.log; do sed 's/\x1b\[[0-9;]*m//g' "$f" | grep -E "^\[test:all\] FAILED|^# stream-exit"; done
  echo "invocations $(cat "$out"/suite-s?.log | grep -c '^\[test:run\] ')"
  echo "files: $(cat "$out"/suite-s?.log | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ Test Files ' | awk '{for(i=1;i<=NF;i++){if($(i+1)=="failed")f+=$i; if($(i+1)=="passed")p+=$i; if($(i+1)=="skipped")s+=$i}} END{print "failed",f+0,"passed",p+0,"skipped",s+0}')"
  echo "tests: $(cat "$out"/suite-s?.log | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^      Tests ' | awk '{for(i=1;i<=NF;i++){if($(i+1)=="failed")f+=$i; if($(i+1)=="passed")p+=$i; if($(i+1)=="skipped")s+=$i}} END{print "failed",f+0,"passed",p+0,"skipped",s+0}')"
  echo "failing tests (parallel run):"; cat "$out"/suite-s?.log | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ FAIL " | sort -u
  echo "isolated reruns of failing files:"; cat "$out/suite-reruns.txt"
} > "$sum"
cat "$sum"
