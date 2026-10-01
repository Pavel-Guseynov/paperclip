#!/bin/bash
# Processes /opt/pch/queue.list line by line (first line first; edit the file to reorder).
# Line forms: "main <label>" -> fork main (ref fork-main-local) through main-run.sh;
# "<ref> <label>" -> head-run.sh. Both run in /home/pc/wt/base, so they share one Rust build dir.
q=/opt/pch/queue.list; st=/opt/pch/logs/queue-status.txt; dir=/home/pc/wt/base
while true; do
  line=$(head -n1 "$q" 2>/dev/null); [ -z "$line" ] && break
  sed -i '1d' "$q"
  set -- $line
  echo "$(date -Is) start $line $(df -h / | awk 'NR==2{print $4}') free" >> "$st"
  if [ "$1" = main ]; then
    git -C "$dir" checkout -q -- . 2>/dev/null
    git -C "$dir" checkout -q --detach fork-main-local && /opt/pch/main-run.sh "$dir" "$2"
  else
    /opt/pch/head-run.sh "$dir" "$1" "$2"
  fi
  echo "$(date -Is) done $line $(df -h / | awk 'NR==2{print $4}') free" >> "$st"
  find /tmp -maxdepth 1 -mmin +30 -user qzrunner \( -name 'capability-live-*' -o -name 'pv-*' -o -name 'paperclip-*' -o -name 'pr-*' \) -exec rm -rf {} + 2>/dev/null
done
echo "$(date -Is) queue empty" >> "$st"
