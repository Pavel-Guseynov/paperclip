# Change 22: historical observability supplement

Reviewed on 2026-09-26. This summary is suitable for the fork remote. Complete
query requests and responses remain operator-local under
`.git/fork-audit-2026-09-26/22-observability/`; those raw files must not be copied
into tracked files. Every source filename below is relative to that local
directory.

## Finding

The historical cause of the stranded environment lease remains unobservable in
the queried evidence. The records confirm correlated requests and a successful
issue PATCH, but do not show the executor entering its finalizer, deciding to
defer release, attempting lease release, or completing that release. Missing
warnings do not prove successful cleanup or non-execution.

The evidence corrects an earlier inference: one server process serving every
retained request does not prove uninterrupted execution from the reported run
start. The interval contains an earlier server's scheduler stop and another
server's startup. Neither that sequence nor a nearby uncorrelated error proves
the cause of the lease leak. The deployed revision and the run's executor
ownership also remain unobservable in these records.

## Precise observations

All times below are UTC on 2026-09-20. Structured records use their application
timestamp, recorded in milliseconds. Unstructured output has only the stream's
microsecond timestamp; those rows are marked accordingly.

| UTC time | Observation | Local source |
| --- | --- | --- |
| 08:48:26.343 | An earlier server process logged that its plugin job scheduler stopped. | `10-server-lifecycle-all-pids.json` |
| 08:48:26.592648–08:48:26.592657 | Sixteen unstructured stderr lines contain an unhandled `write EPIPE`, including the stack and syscall. They provide no process or run correlation. These are stream timestamps. | `11-unstructured-stderr.json` |
| 08:48:27.346136 onward | Unstructured stdout contains application launch, doctor, and server-startup output. These are stream timestamps. | `13-unstructured-stdout.json` |
| 08:48:28.188 | A different server process logged adapter loading. | `10-server-lifecycle-all-pids.json` |
| 08:48:29.051 | That server logged its listener bound with startup recovery in progress. | `10-server-lifecycle-all-pids.json` |
| 08:48:29.175 | Startup orphan recovery completed with zero runs reaped. | `08-server-diagnostics-excluding-git-scans.json` |
| 08:48:31.985 | Server startup recovery completed. | `10-server-lifecycle-all-pids.json` |
| 08:49:43.373 | The first of eight returned requests correlated to the affected run completed successfully. All eight were served by the later server process. | `02-run-identity-rows.json`, `04-run-correlated-rows.json` |
| 08:52:41.755 | The correlated issue PATCH returned HTTP 200. Its stream timestamp is 08:52:41.843374. | `04-run-correlated-rows.json` |
| 08:59:34.461 | An aggregate terminal-workspace reaper record reports zero cleanup failures, three skips for nonterminal trees, and eight skips for undelivered work. It does not identify this run or lease. | `10-server-lifecycle-all-pids.json` |

The prior incident record reports a run start at 08:47:47.000 and cancellation
at 08:52:41.617. These two lifecycle times were not independently returned by
the queries and are not treated as newly verified observations. Their provenance
and that distinction are preserved in local `DIAGNOSIS.md`.

## Query scope and completeness

The authoritative OpenObserve schema was read before searching the consolidated
`services` log stream. Queries cover 2026-09-20 08:47:47.000Z through
09:00:00.000Z. They use explicit field projections, run correlation, server
diagnostics, and separate unstructured stdout/stderr inspection. Request bodies,
tool arguments, and authentication values were not selected.

| Local source | Scope and completeness |
| --- | --- |
| `00-schema.json` | Complete returned schema: 825 declared fields. |
| `01-run-query-str-match-error.json` | Initial query failed with a type/parser error and a partial-data warning. Its empty result is not evidence of absence. |
| `02-run-identity-rows.json`, `04-run-correlated-rows.json` | Successful identity and expanded correlation queries each returned eight requests. No finalizer decision record was returned. |
| `03-server-level-counts.json`, `06-nonrequest-counts.json` | Aggregate counts establish the selected server and non-request result populations. |
| `05-nonrequest-initial-capped-page.json`, `07-server-initial-capped-page.json` | Exploratory 100-row pages are capped and explicitly incomplete. They were not used to establish absence of an event. |
| `08-server-diagnostics-excluding-git-scans.json` | Selected server diagnostics and non-request records, excluding workspace Git scans: 35 rows. |
| `09-unstructured-row-inventory.json` | All 97 unstructured records without process/request identifiers, with stream metadata and substring-match flags. |
| `10-server-lifecycle-all-pids.json` | Non-request records across server processes, excluding workspace Git scans: 27 rows. |
| `11-unstructured-stderr.json`, `13-unstructured-stdout.json` | Complete returned unstructured output in that scope: 16 stderr lines and 81 stdout lines, matching the 97-row inventory. |
| `12-run-correlation-all-services.json` | Correlation across all services using run fields, messages, raw log text, and run arrays: eight request rows. |
| `14-log-source-counts.json` | Stream/source aggregate: 1,568 structured stdout rows, 81 unstructured stdout rows, and 16 unstructured stderr rows for the application in the interval. |

Every successful final focused query returned fewer than the tool's 100-hit
summary cap and reported no partial-data or function error. Full tool responses
are retained locally, including any portions truncated in the interactive
display. Duplicate text and structured representations in a tool response are
not separate executions.

Completeness applies to each stated query scope. It does not mean every
historical trace, database run event, or agent artifact was examined. Aggregate
reaper counters and unrelated runs cannot establish this run's cleanup decision.
Newer source behavior cannot establish what the historical deployed process
executed.

## Remaining acceptance evidence

Change 22 still needs an authoritative lifecycle record connecting the affected
execution to its actual release decision, or a behavioral reproduction that
fails for a demonstrated cause and passes with the corresponding narrow fix.
This supplement supplies historical evidence and its limits; it does not supply
that missing causal proof.
