# extlens protocol v1

The wire contract between the extlens client and any host that embeds the
`extlens-sdk`. The protocol is the only contract the client knows. Hosts map
their own storage onto these messages; the client never touches host storage.

- Transport: one WebSocket connection. Client connects to the host, sends
  requests, receives responses. Requests are independent; the server may answer
  out of order.
- Envelope: JSON-RPC 2.0.
- Content: UTF-8 JSON text frames.
- Version: this document pins the protocol at v1. See the changelog at the end.

## Envelope

Every message is a JSON object. Requests and responses carry `"jsonrpc": "2.0"`.

```
request:  {"jsonrpc":"2.0","id":1,"method":"extensions.list","params":{...}}
success:  {"jsonrpc":"2.0","id":1,"result":{...}}
failure:  {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"..."}}
```

- `id`: a number or string chosen by the client. The response echoes it.
- `params`: optional. Omitted params are treated as `{}`.
- `result` and `error` are mutually exclusive.
- A malformed frame that is not valid JSON fails with code `-32700`.
- A well-formed frame that is not a valid request fails with `-32600`.

## Errors

Standard JSON-RPC codes plus one application code.

| code  | meaning                                            |
|-------|----------------------------------------------------|
| -32700| Parse error. The frame is not valid JSON.          |
| -32600| Invalid request. The frame is not a request.       |
| -32601| Method not found. Includes documented future methods. |
| -32602| Invalid params. Zod validation failed the schema.  |
| -32603| Internal error. The backend threw.                 |
| 404   | Unknown extension id. Applies to methods taking an `id`. |

An error frame:

```
{"jsonrpc":"2.0","id":1,"error":{"code":404,"message":"unknown extension id: xyz"}}
```

## Methods

### ping

Health check. No params.

```
→ {"jsonrpc":"2.0","id":1,"method":"ping"}
← {"jsonrpc":"2.0","id":1,"result":{"ok":true}}
```

### extensions.list

Params:

| field    | type   | default                | notes                                   |
|----------|--------|------------------------|-----------------------------------------|
| page     | int    | 1                      | 1-indexed                               |
| pageSize | int    | 50                     | 1..200                                  |
| search   | string | none                   | case-insensitive substring on name      |
| sort     | string | interestingness_desc   | one of the three values below           |
| filter   | object | none                   | facets to narrow by; see below          |

`sort` values:

- `interestingness_desc` — highest score first
- `interestingness_asc` — lowest score first
- `name` — name ascending

`filter` fields, all optional:

| field      | type     | notes                                                          |
|------------|----------|----------------------------------------------------------------|
| verdicts   | string[] | report verdicts to keep, from the four `ExtensionVerdict` values |
| unreviewed | bool     | `true` also keeps extensions with no report                     |
| migrated   | bool     | `true` keeps only extensions with an MV3 build; `false` only those without |

How the facets compose: OR within a facet, AND between them. `verdicts` and `unreviewed` are one
facet (the result), `migrated` is another, so
`{"verdicts":["working"],"unreviewed":true,"migrated":true}` means "has an MV3 build, and is either
working or not yet reviewed".

- An absent or empty facet constrains nothing, so `{}` is the same query as no filter.
- `verdicts` never matches an extension without a report: no report is the absence of a verdict,
  not one of them. An extension the host reports as reviewed but for which it has no verdict
  (a host from before the field) matches neither `verdicts` nor `unreviewed`.
- The filter applies before paging **and before `stats`**: `total`, `avgScore` and `totalPages`
  describe the filtered set, the same way they already describe a `search`. A client shows those
  numbers next to the rows it received, and they have to be about the same rows.
- Hosts should apply it with `matchesListFilter` from `@extlens/protocol` (re-exported by
  `extlens-sdk`) rather than reimplementing the rules, so the same filter selects the same
  extensions on every host.

Result:

```
{
  "extensions": [ ExtensionLight, ... ],
  "stats": { "total": 42, "analyzed": 40, "withMv3": 15, "avgScore": 73.5 },
  "page": 1,
  "pageSize": 50,
  "totalPages": 1
}
```

- `total`: every extension the host knows.
- `analyzed`: extensions that have a profile (score).

Host requirements for large catalogs:

- Hosts must slice to `pageSize`. The SDK rejects a page with more than 200 rows.
- Sort must be stable across pages. Tie-break by id.
- For 100k+ extensions, index the name search host-side. The `search` value is a case-insensitive substring.
- `withMv3`: extensions that have an MV3 variant.
- `avgScore`: mean interestingness over analyzed extensions. `0` when analyzed is 0.

ExtensionLight:

```
{
  "id": "abc123",
  "name": "Example",
  "version": "1.0.0",
  "manifestVersion": 2,
  "score": 74,
  "tags": ["HAS_BROWSER_POPUP", "USES_WEB_REQUEST"],
  "hasMv3": true,
  "hasReport": false,
  "verdict": null
}
```

`score` is the integer interestingness score. `tags` are the feature tags.
`hasMv3` is true when an MV3 variant exists (the extension was migrated).
`hasReport` is true when a report exists for the extension (it was tested).
`verdict` (v7, optional) is that report's verdict — `working | partially_working |
not_working | not_testable` — or null without one; hosts derive it with the
protocol's `reportVerdict` so legacy reports resolve identically everywhere.
The client marks migrated rows and tested rows with distinct icons; the
tested icon replaces the migrated one.

### extensions.get

Params: `{"id": "abc123"}`. Unknown id fails with code `404`.

Result:

```
{ "extension": ExtensionProfile }
```

ExtensionProfile:

| field          | type          | notes                                      |
|----------------|---------------|--------------------------------------------|
| id             | string        |                                            |
| name           | string        |                                            |
| version        | string|null   |                                            |
| manifestVersion| int           | 2 or 3                                     |
| score          | int           | integer interestingness score              |
| breakdown      | ScoreBreakdown| raw per-dimension counts                   |
| tags           | string[]      | feature tags                               |
| listeners      | Listener[]    | chrome/browser event listeners             |
| manifest       | ManifestSummary | summary of the analyzed manifest        |
| sizeBytes      | int           | total on-disk size of the extension        |
| hasMv3         | boolean       | does an MV3 variant exist in the host      |

ScoreBreakdown — raw counts before weighting. Weights live in the analyzer and
are not part of the protocol; the client renders counts as bars.

| field                   | notes                                        |
|-------------------------|----------------------------------------------|
| webRequest              | `webRequest` occurrences                     |
| htmlLines               | HTML lines                                   |
| storageLocal            | `storage.local` occurrences                  |
| backgroundPage          | 1 if a background page or service worker     |
| contentScripts          | 1 if content scripts declared                |
| dangerousPermissions    | count of dangerous permissions               |
| hostPermissions         | count of host-match permissions              |
| cryptoPatterns          | eval/Function/btoa/atob/crypto occurrences   |
| networkRequests         | fetch/XMLHttpRequest/ajax occurrences        |
| extensionSize           | size in hundreds of KB (floor)               |
| apiRenames              | migration signal; 0 in the pure analyzer     |
| manifestChanges         | migration signal; 0 in the pure analyzer     |
| fileModifications       | migration signal; 0 in the pure analyzer     |
| webRequestToDnr         | migration signal; 0 in the pure analyzer     |

The four migration fields are host-provided. Hosts with existing analysis fill
them; the pure analyzer always emits 0. The client renders them if nonzero.

Listener:

```
{ "api": "chrome.runtime.onMessage", "file": "background.js", "line": 1, "snippet": "chrome.runtime.onMessage.addListener(...)" }
```

ManifestSummary:

```
{
  "manifestVersion": 2,
  "name": "Example",
  "version": "1.0.0",
  "description": "...",
  "permissions": ["tabs", "storage"],
  "hostPermissions": ["*://*.example.com/*"],
  "background": { "type": "page", "scripts": ["background.js"] },
  "contentScripts": [ { "matches": ["https://*/*"], "js": ["content.js"], "css": [] } ],
  "action": { "defaultPopup": "popup.html", "defaultTitle": "Example" },
  "optionsPage": "options.html",
  "chromeUrlOverrides": { "newtab": "newtab.html" }
}
```

- `background.type` is `page` (MV2 scripts) or `service_worker` (MV3). `background`
  is null when the manifest declares none.
- `action` covers `action` (MV3), `browser_action`, and `page_action`.
- `contentScripts` is an array; an empty array means none.

### extensions.files

Params: `{"id": "abc123"}`. Unknown id fails with code `404`.

Result:

```
{ "files": { "mv2": "file:///host/exts/abc/manifest.json", "mv3": "file:///host/exts/abc/mv3/" } }
```

File references are transport-agnostic strings.

- v1 hosts are local: they return `file://` absolute paths on the same machine
  as the client. The client opens the browser against these paths.
- A host without an MV3 variant omits `mv3`. The client then offers an MV2-only
  review.
- A host without an MV2 source omits `mv2`. The client then offers an MV3-only
  review.
- The protocol documents `http(s)://` as the remote-host form (future file
  plane). A `file://` path may point at a manifest.json or at a directory; the
  client resolves both.

### reports.get

Params: `{"extensionId": "abc123"}`.

Result:

```
{ "report": Report | null }
```

`null` means no report exists yet for this extension. The server does not fail
on unknown extension ids here; the client only calls this with extensions it
has listed.

### reports.submit

Params: `{"report": ReportDraft}`.

Result:

```
{ "id": "report-1" }
```

- Submitting replaces any existing report for the same `extensionId` (one
  report per extension) and returns the report id.
- The host stamps `id`, `createdAt`, and `updatedAt`. The client does not send
  them.

ReportDraft:

| field                    | type                | notes                                |
|--------------------------|---------------------|--------------------------------------|
| extensionId              | string              |                                      |
| tested                   | boolean             | true for a submitted report          |
| verificationDurationSecs | number|null         | seconds from form open to submit     |
| installs                 | boolean|null        | does it install                      |
| worksInMv2               | boolean|null        | does it work in MV2                  |
| needsLogin               | boolean|null        | needs login to test                  |
| isPopupWorking           | boolean|null        | popup works (when a popup exists)    |
| isSettingsWorking        | boolean|null        | settings work (when settings exist)  |
| isNewTabWorking          | boolean|null        | new tab works (when a new tab exists)|
| isInteresting            | boolean|null        | interesting for research             |
| overallWorking           | string|null         | yes | no | could_not_test         |
| notes                    | string              | free text, may be empty              |
| listeners                | ListenerTestResult[]| per-listener verdicts                |

ListenerTestResult:

```
{ "api": "chrome.runtime.onMessage", "file": "background.js", "line": 1, "status": "untested" }
```

`status` is one of `untested | yes | no`. `yes` means the listener worked,
`no` means it failed.

Full Report (reports.get result) adds:

| field     | type   | notes                          |
|-----------|--------|--------------------------------|
| id        | string | host-assigned                  |
| createdAt | string | ISO-8601 UTC                   |
| updatedAt | string | ISO-8601 UTC                   |

## Host lifecycle (optional)

Hosts with a `HostController` expose these methods. A host without one answers
`host.*` with `-32601` (method not found).

### host.status

No params.

```
→ {"jsonrpc":"2.0","id":1,"method":"host.status"}
← {"jsonrpc":"2.0","id":1,"result":{"status": HostStatus}}
```

HostStatus:

```
{
  "state": "idle",
  "extensionId": null,
  "phase": null,
  "startedAt": null,
  "message": null
}
```

- `state`: `idle | running | stopping`.
- `phase`: host-specific free text. AgenticMigrator uses
  `preparing | migrating | verifying | done | failed | stopped`.
- `message`: short human summary of the last log tail, or null.

### host.start

Params: `{"id": "abc123"}`. Starts a job (migration) for the extension. An
unknown id fails with `404`; a running job fails with `409`.

Result: `{"status": HostStatus}`.

### host.startAll

No params. Starts a job over the whole corpus; the host decides which
extensions are outstanding (AgenticMigrator: every source without a successful
run). The host runs them in sequence, so `host.status` reports the current
extension, and `phase`/`message` summarize the queue when it ends. An already
running job fails with `409`.

Result: `{"status": HostStatus}`.

### host.stop

No params. Aborts the running job. Returns `{"status": HostStatus}`.

### host.log

Params:

| field  | type | default | notes                             |
|--------|------|---------|-----------------------------------|
| offset | int  | 0       | last `seq` the client already has |

Result:

```
{
  "lines": [ LogLine, ... ],
  "nextOffset": 17
}
```

- `lines` holds only entries with `seq > offset`, so the client polls and appends.
- `nextOffset` is the largest `seq` emitted so far. Pass it back as the next
  `offset`. It is `0` when no line was emitted yet.
- Hosts that capture no structured log may return an empty result.

LogLine:

```
{ "seq": 3, "ts": "2025-01-01T00:00:00.000Z", "stream": "stderr", "text": "boom" }
```

- `seq` is a monotonic per-run line number starting at 1.
- `ts` is the ISO-8601 capture time, or null when unknown.
- `stream` is `stdout | stderr`. stderr lines are typically errors.

## Failure explanation (optional)

### analysis.explain

Ask the host's model why the migration of an extension failed, as judged by
its stored report. Params: `{"extensionId": "abc123"}`.

Result:

```
{ "explanation": "**Likely cause** — …", "model": "claude-sonnet-5" }
```

- `explanation` is Markdown, a few short paragraphs: the likely cause, the
  evidence in the report and the diff, and what would fix it.
- `model` names the model that wrote it.
- The prompt is built by the SDK (`createExplainer`) from the stored report —
  verdict, per-surface results, the reviewer's notes — the manifest summaries of
  both variants, and a unified diff of the two source trees when the host has
  both. Hosts gather those inputs; the SDK owns the wording so explanations are
  comparable across hosts.
- Hosts without a model answer `-32601`. The SDK's folder mode and the stub
  offer the method when `ANTHROPIC_API_KEY` is set in the host's environment
  (`EXTLENS_EXPLAIN_MODEL` overrides the model).
- Unknown id fails with `404`. A call can take tens of seconds.

## Agent transcripts (optional)

### transcript.get

The agent's own record of a migration: the conversation, the tool calls, the failures.

Optional. A host that runs no agent answers `-32601`; a host that runs one but recorded nothing
for this extension answers with `available: false`. Those are different facts and the client
words them differently.

Params:

| field       | type   | default | notes                                  |
|-------------|--------|---------|----------------------------------------|
| extensionId | string | —       | required                               |
| offset      | int    | 0       | entries to skip                        |
| limit       | int    | 200     | 1..500 entries per call                |

Result:

```
{
  "available": true,
  "entries": [ TranscriptEntry, ... ],
  "total": 128,
  "offset": 0,
  "limit": 200,
  "summary": { "model": "...", "messages": 124, "toolCalls": 54, "toolErrors": 3,
               "errors": 6, "compactions": 1, "startedAt": "...", "endedAt": "...",
               "usage": { "input": 0, "output": 0, "total": 0, "costUsd": null } }
}
```

- `total` counts the whole transcript, not the page.
- `summary` is computed over every entry, not the page, so it does not change as a reader pages.
  Derive it with `summarizeTranscript` (`@extlens/protocol`, re-exported by `extlens-sdk`) rather
  than counting host-side: a corpus comparison quotes these numbers, and they have to mean the
  same thing on every host.

TranscriptEntry:

```
{
  "index": 0,                       // position in the whole transcript
  "at": "2026-08-19T13:10:00.000Z", // ISO, or null when the agent logged no usable time
  "kind": "message",                // message | meta | compaction
  "role": "assistant",              // user | assistant | tool, null for meta/compaction
  "blocks": [
    { "type": "text", "text": "...", "truncated": false },
    { "type": "thinking", "text": "...", "truncated": false },
    { "type": "tool_call", "name": "ls", "arguments": "{...}", "callId": "c1", "truncated": false }
  ],
  "toolName": null, "callId": null, "isError": false,   // tool entries
  "model": null, "provider": null, "stopReason": null,  // assistant entries
  "error": null,                    // the turn itself failed (a 500, a refusal)
  "usage": null,                    // { input, output, cacheRead, cacheWrite, total, costUsd }
  "label": "", "detail": ""         // meta/compaction, in the host's own words
}
```

- Hosts **normalize** their agent's log onto these entries. The client renders entries and knows
  nothing about any agent framework; a host that passed its raw log through would have a viewer
  that works for its agent and blanks for every other host.
- `isError` is a tool reporting failure; `error` is the turn breaking. A transcript needs both,
  and counting them together makes a run that hit one flaky `curl` look like a run that fell over
  six times.
- `truncated` on a block means the host cut it (see `TRANSCRIPT_BLOCK_LIMIT`, 20,000 characters).
  Clients must show that it was cut: silently shortened evidence is worse than less of it.
- `kind: "compaction"` marks the agent summarising its own history away. The entries before it are
  gone from the model's context, and a reader who cannot see that happened will read the summary
  as the model's own words.

## Documented future methods

The server MUST answer these with `-32601` (method not found) in v1. The
protocol reserves their names so hosts can detect a newer client.

- `analysis.rerun` — recompute an extension profile on demand.
- `db.query` — raw database query UI (phase 2).
- HTTP file plane — `http(s)://` file references (phase 2).

## Changelog

- v9 — `transcript.get`: the migration agent's conversation, tool calls, thinking and failures for one extension, normalized by the host into `TranscriptEntry` and paged. `Backend.getTranscript` is optional; hosts without an agent answer `-32601`, hosts with one but no record answer `available: false`. `summarizeTranscript` derives the headline numbers so they mean the same thing on every host.
- v8 — `extensions.list` params gain an optional `filter`: report verdicts, unreviewed rows, and whether an MV3 build exists. OR within a facet, AND between them; applied before paging and before `stats`. `matchesListFilter` applies it identically on every host.
- v7 — `ExtensionLight` gains an optional `verdict`, the stored report's verdict, so a list can show what a review found rather than only that one exists. `reportVerdict` derives it for reports of every generation.
- v6 — `analysis.explain`: an optional, model-backed explanation of a failing report, built by the SDK from the report, both manifest summaries and the MV2→MV3 diff. `Backend.explainFailure` is optional; hosts without it answer `-32601`.
- v5 — `ExtensionLight` gains `hasReport`: true when a report exists for the extension. The client marks migrated (`hasMv3`) and tested (`hasReport`) rows with distinct unicode icons; the tested icon replaces the migrated one.
- v4 — the report form matches the ExtPorter form: installs, works in MV2, needs login, popup/settings/new-tab working, interesting, and a tri-state overall working verdict (yes/no/could_not_test). Legacy reports survive via field defaults; boolean overallWorking values normalize to the string form.
- v3 — `host.log` adds incremental structured host logs (`seq`, `ts`, `stream`, `text`) with offset polling. The host lifecycle methods `host.status` / `host.start` / `host.stop` are documented; `host.log` joins them. `HostController.getLog` is optional; the SDK returns an empty result when a host omits it.
- v2 — `extensions.list` page arrays cannot exceed 200 rows. Hosts must paginate; the SDK rejects oversized pages. Client requests one screen per page and debounces search. Manifest summaries gain an optional key-derived `id`; extension profiles gain an optional `mv2` summary. The SDK resolves `__MSG_...__` names and descriptions from `_locales`.
- v1 — initial protocol: ping, extensions.list/get/files, reports.get/submit.
