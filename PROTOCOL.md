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

`sort` values:

- `interestingness_desc` — highest score first
- `interestingness_asc` — lowest score first
- `name` — name ascending

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
  "hasMv3": true
}
```

`score` is the integer interestingness score. `tags` are the feature tags.

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

| field            | type              | notes                              |
|------------------|-------------------|------------------------------------|
| extensionId      | string            |                                    |
| tested           | boolean           | manual testing status              |
| overallWorking   | boolean|null      | does it basically work             |
| hasErrors        | boolean|null      | did you see errors                 |
| seemsSlower      | boolean|null      | noticeably slower                  |
| needsLogin       | boolean|null      | requires login to test             |
| isPopupBroken    | boolean|null      | popup broken (when popup exists)   |
| isSettingsBroken | boolean|null      | settings broken (when settings exist) |
| isInteresting    | boolean|null      | interesting for research           |
| notes            | string            | free text, may be empty            |
| listeners        | ListenerTestResult[] | per-listener verdicts           |

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

## Documented future methods

The server MUST answer these with `-32601` (method not found) in v1. The
protocol reserves their names so hosts can detect a newer client.

- `analysis.rerun` — recompute an extension profile on demand.
- `db.query` — raw database query UI (phase 2).
- HTTP file plane — `http(s)://` file references (phase 2).

## Changelog

- v1 — initial protocol: ping, extensions.list/get/files, reports.get/submit.
