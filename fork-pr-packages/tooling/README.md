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
