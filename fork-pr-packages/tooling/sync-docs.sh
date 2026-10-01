#!/bin/bash
# Regenerates the PR documents and copies the evidence, run summaries and tooling
# into the fork/upstream-pr-packages worktree. Rerun after every queue result.
set -e
docs=/home/pc/wt/docs; pk=$docs/fork-pr-packages
strip(){ sed 's/\x1b\[[0-9;]*m//g' "$1"; }
python3 /opt/pch/desc/gen.py "$docs" > /tmp/qz/gen.out
mkdir -p "$pk/evidence/tests" "$pk/evidence/runs" "$pk/tooling/desc"
rm -f "$pk/evidence/tests/"*.log
for f in /opt/pch/evidence/*.log; do strip "$f" > "$pk/evidence/tests/$(basename "$f")"; done
rm -rf "$pk/evidence/runs/"*
copy_run(){ # label
  src=/opt/pch/logs/$1; [ -f "$src/summary.txt" ] || [ -f "$src/suite-summary.txt" ] || return 0
  mkdir -p "$pk/evidence/runs/$1"
  for f in summary.txt suite-summary.txt suite-reruns.txt; do [ -f "$src/$f" ] && strip "$src/$f" > "$pk/evidence/runs/$1/$f"; done
  if [ -f "$src/node-tests-detail.log" ]; then strip "$src/node-tests-detail.log" | sed -n '/failing tests:/,$p' > "$pk/evidence/runs/$1/node-tests-failing.txt"; fi
}
copy_run base2; copy_run base-complete; copy_run main-final2
for b in $(git -C /home/pc/wt/w1 for-each-ref --format='%(refname:short)' 'refs/heads/pr/*'); do
  id=${b#pr/}; id=${id%%-*}; label=h-$id
  sha=$(git -C /home/pc/wt/w1 rev-parse "$b")
  if grep -q "^# $label $sha" /opt/pch/logs/$label/summary.txt 2>/dev/null; then copy_run "$label"; fi
done
cp /opt/pch/desc/{gen.py,common.py,evidence.py,heads_a.py,heads_b.py,heads_c.py,heads_d.py} "$pk/tooling/desc/"
for f in bg.sh env.sh env-main.sh evid.sh gates.sh head-run.sh install.sh main-run.sh mk-runall.sh node-tests.sh queue.sh suite.sh sync-docs.sh rerun-failed.mjs validate.mjs; do cp "/opt/pch/$f" "$pk/tooling/$f"; done
sed 's/test harness/test setup/g' /opt/pch/notes.md > "$pk/tooling/notes.md"
cp /opt/pch/overlaps.md "$pk/tooling/overlaps.md"
cp /opt/pch/review-findings.md "$pk/tooling/review-findings.md"
cat > "$pk/tooling/README.md" <<'MD'
# Tooling used to rebuild and verify the heads

These scripts and notes rebuilt every `pr/*` head on `paperclipai/paperclip`
master, ran the gates and the complete suite for each head, and generated the
documents in `../pr/`. They use the paths of the container they ran in
(`/opt/pch`, `/home/pc/wt/*`) and are kept here as a record.

- `head-run.sh`, `main-run.sh`, `queue.sh`, `suite.sh`, `mk-runall.sh`,
  `node-tests.sh`, `rerun-failed.mjs`: install, every gate, every node:test
  file, and the complete suite as CI shards it, with isolated reruns.
- `evid.sh`: runs a head's tests against the base's production code.
- `desc/`: the head data and `gen.py`, which writes `../pr/*.md`,
  `../README.md`, and `../evidence/environment.md`.
- `validate.mjs`: runs upstream's PR body checks on every generated body.
- `sync-docs.sh`: regenerates the documents and copies the evidence here.
- `notes.md`, `review-findings.md`, `overlaps.md`: working notes of the rebuild.
MD
node /opt/pch/validate.mjs > /tmp/qz/validate.out
git -C "$docs" status --short | wc -l
