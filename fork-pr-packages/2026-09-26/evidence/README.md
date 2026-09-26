# Evidence format and provenance

This directory contains retained execution results and source-review snapshots. The final per-change reports supersede stale status statements in earlier review snapshots; those snapshots are preserved to show what was known then.

Each `.log` file is a JSON document with one `output` string. JSON.parse(file).output recovers the complete captured tool-output text, including its original trailing whitespace and blank lines. JSON escaping preserves evidence without turning incidental terminal whitespace into repository formatting defects. A log can contain the originally captured command/exit annotation as well as stdout/stderr. No diagnostic line or warning is suppressed. Original local copies remain under `.git/fork-audit-2026-09-26/`.

The current-upstream05 proof's final terminal chunk was transcribed verbatim from its retained tool result after a context handoff, as stated in05/current-head-verification.md. The associated identical fixture and head output are retained. The proof fixture's final extra blank line is omitted from this presentation; executable statements are identical.

JSON source/synchronization snapshots preserve their recorded Git output; abbreviated IDs inside command output are not replacement head claims. Final report heads are full git rev-parse identities. Source-review snapshots describe inspection, not executed gates.

Live service query responses include private deployment metadata and remain local. Only22-observability-summary.md is published. Local test logs contain fixture values and workspace paths; PR bodies do not paste those internal paths or identifiers.
