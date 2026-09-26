# Contribution synchronization disposition

Upstream master: `4ca404b49ab3ec5513b9cfa824ff2eeaef941f7a`.

Sixteen contribution branches now contain this exact upstream head. Changes01 and02 needed a Codex test conflict resolution. Change05 merged cleanly. The other thirteen synchronized branches and full command output are in `upstream-sync.json`.

The clean merges were pushed as ordinary fast-forward branch updates. They are upstream-only synchronization adaptations. They were not merged into the stable release lines or fork main, because doing so would import unreleased development changes into those integration lines. Every actual source correction from this session (01 test isolation, inherited by02;05 log redaction) was separately backported and verified on its stable line and carried to main.

The four remaining branches were stopped at their existing acceptance blockers and current-upstream conflicts:

| Change | Conflict | Acceptance blocker |
| --- | --- | --- |
|08|server/src/services/legacy-execution-recovery.test.ts|Specific-cause suppression needs a real persistence regression; database proof is unavailable.|
|10|packages/shared/src/index.ts|The requested durable review admission is not implemented; depends on09 and needs core-work coordination.|
|13|pnpm-lock.yaml|Bot-only lockfile policy and trusted pnpm9 bootstrap prevent the current submission path.|
|22|server/src/services/heartbeat.ts|Cleanup can be falsely certified, ownership guards are incomplete, and historical in-process cause remains unobservable.|

No conflicted merge was left active. These branches still lack current upstream and are not ready to open. The conflict observations come from retained `git merge-tree` output in `initial-state.json`; they are not failed gate runs. No history was rewritten and no worktree was created.
