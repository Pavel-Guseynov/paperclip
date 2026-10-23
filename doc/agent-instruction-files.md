# Agent instruction file revisions

Reads and saves of agent instruction files carry a content-derived revision so a
caller cannot overwrite a file it has not seen. The shape matches upstream's
agent file API for what clients use; nothing is stored, and no revision or history
row exists.

## Read

`GET /api/agents/:id/instructions-bundle/file?path=...` returns the file with:

- `contentHash`: sha256 hex of the file bytes.
- `revision`: `{ id, contentHash }`. `id` is a UUID-shaped content token derived from
  the hash (`agentFileTokenFromHash`), so the same bytes always give the same id.

## Save

`PUT /api/agents/:id/instructions-bundle/file` accepts `baseRevisionId` (UUID, nullable)
or `baseHash` (64 lowercase hex, nullable). A `baseHash` is mapped to its token and wins
when both are sent. `null` means the file does not exist yet.

| Case | Response |
| --- | --- |
| Entry file, no base | 422 `INSTRUCTION_BASE_REQUIRED` |
| Base differs from the file now (including `null` for an existing file, or a token for a missing file) | 409 `INSTRUCTION_REVISION_CONFLICT` with `baseRevisionId` and `currentRevisionId` |
| Base matches | the file is written and the response carries the new revision |
| Other file, no base | written as before |
| Other file, base supplied | checked like the entry file |

The check and the write are two filesystem operations without a lock: two saves in
the same instant from the same base can both pass. The check runs before the bundle
is prepared, so a rejected save changes nothing.

The legacy `promptTemplate.legacy.md` pseudo-file is read with the same fields and
is not checked on save.

CLI: `agent instructions-file:put --base-revision-id <id> | --base-hash <sha256> | --new-file`.
