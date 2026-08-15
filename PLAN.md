# Plan: extlens — extension analysis + review client

## Overview

extlens is a standalone, protocol-first tool for analyzing and reviewing Chrome extensions.
It is an ink-based terminal client that connects to any host project which embeds the
extlens host SDK. v1 hosts are ExtPorter and AgenticMigrator. The SDK runs inside each host,
exposes the host's extension data over a simple documented JSON protocol, and the client
provides the analysis and review UI. A later phase adds a local folder mode where extlens
serves a directory of extensions itself (SQLite + ingest).

The old ExtPorter analyzer is reference material only. Its coupling (analysis mutated
Extension objects inside a migration pipeline) is fixed: analysis is a pure function, and
the client never touches host storage. The protocol is the contract.

Scope for v1: protocol, pure analyzer, host SDK, ExtPorter adapter, AgenticMigrator adapter,
client explorer tab, client analyzer tab (browser test + report form). Out of scope:
migration kickoff, database tab, LLM description/fix, CWS scraping, local folder mode
(phase 2, designed now).

## Stack

- bun (runtime, package manager, test runner)
- TypeScript, strict
- ink + react (client TUI)
- better-sqlite3 (SQLite backend, phase 2 only)
- playwright (dual-browser testing in the analyzer tab)
- zod (protocol message validation)
- ws (WebSocket server in the SDK; node-compatible, works under bun)
- tsup (SDK build: dual ESM + CJS output)

The SDK is a published npm package, `extlens-sdk`. Hosts import it from node:
`import { createExtlensServer, type Backend } from 'extlens-sdk'`. The SDK targets node
>= 18 (ESM and CJS builds) and works under bun. The client TUI stays in-repo and runs under
bun; it does not ship to npm in v1.

## Architecture

```
+-----------------+      +------------------+      +-------------------------+
| extlens client  |  WS  | host project     |      | host storage            |
| (ink TUI)       |----->| (embeds SDK)     |----->| ExtPorter: MongoDB      |
+-----------------+      |  rpc.ts          |      | AgenticMigrator: run/   |
                         |  backend.ts      |      +-------------------------+
                         |  profile.ts      |      | (phase 2) folder + SQLite |
                         +------------------+      +-------------------------+
```

Layering:

- Client speaks only the protocol. It does not know the host.
- The host embeds the SDK. The SDK validates messages, dispatches to a `Backend`, and
  computes profiles with the analyzer.
- The host implements `Backend` over its own storage. Adapters live in the host repos.
- Phase 2 adds a `FolderBackend` (SQLite + ingest) so any host can serve a plain folder,
  and extlens can run standalone.

## Files changed

Greenfield project at `/Users/daniel/Projects/extlens`. Bun workspace, four packages.
Host adapter files land in the host repos (listed at the end).

```
extlens/
  README.md                    — quickstart: run a host adapter, connect the client, keybindings
  PROTOCOL.md                  — the wire protocol spec (centerpiece, doc-driven)
  PLAN.md                      — this file
  ADAPTERS.md                  — guide: how to embed the SDK in a host project
  package.json                 — workspace root; scripts (dev, test, typecheck)
  tsconfig.base.json           — shared strict TS config
  flake.nix                    — dev shell: bun, nodejs_22, git (mirrors AgenticMigrator flake)
  .envrc                       — `use flake`; direnv activates the dev shell on entry
  fixtures/                    — 3 small synthetic MV2 extensions for tests
    one-ext/                   — single-extension fixture (popup + background + listeners)
    corpus-a/                  — corpus fixture (2 extensions: webpack-bundled, minimal)
  packages/
    protocol/
      src/index.ts             — public API: types + zod schemas + protocol version
      src/messages.ts          — zod schemas for every request/response envelope
      src/types.ts             — ExtensionLight, ExtensionProfile, Report, stats types
      tests/messages.test.ts   — schema round-trip and rejection of malformed messages
    analyzer/
      src/index.ts             — analyzeExtension(input) → AnalysisProfile (pure function)
      src/scoring.ts           — weights, DANGEROUS_PERMISSIONS, breakdown type (port of v0 scoring-config)
      src/file-analyzer.ts     — pattern counts in JS/HTML files (port of v0 file-analyzer)
      src/manifest-analyzer.ts — permissions, background, content scripts (port of v0 manifest-analyzer)
      src/feature-tagger.ts    — webpack/eval/minified/popup/etc. tags (port of v0 feature-tagger)
      src/listener-extractor.ts— chrome|browser *.on*.addListener inventory (port of v0 listener-extractor)
      src/size.ts              — extension size metric (port of v0 size-calculator)
      tests/scoring.test.ts    — golden score numbers on fixtures
      tests/listeners.test.ts  — extraction, dedupe, line numbers
      tests/tags.test.ts       — tag presence per fixture
    host-sdk/
      package.json           — `extlens-sdk`; exports map (import/require/types), deps: ws, zod
      tsup.config.ts         — dual ESM + CJS build, dts output
      src/index.ts           — public API: createExtlensServer, Backend, protocol types (re-exports)
      src/rpc.ts             — dispatch: validate (zod) → backend → result/error
      src/backend.ts         — Backend interface (the contract hosts implement)
      src/profile.ts         — default profile computation (runs analyzer over host files)
      src/ws.ts              — ws server wiring: upgrade, jsonrpc envelope, error mapping
      tests/rpc.test.ts      — validation, error codes, unknown method (stub backend)
      tests/consumer.test.ts — import the built package from node: ESM and CJS smoke tests
    client/
      src/index.ts             — entrypoint; `--ws` flag / EXTLENS_WS env for host URL
      src/app.tsx              — ink app: tab state, connection lifecycle, key routing
      src/api.ts               — protocol client: typed send/recv, reconnect, request ids
      src/types.ts             — UI state types
      src/components/explorer.tsx    — explorer tab: stats, search, sort, list, pagination
      src/components/analyzer.tsx    — analyzer tab: profile view + browser flow
      src/components/report-form.tsx — manual test report form
      src/components/status-bar.tsx  — connection state, tab hints
      src/browsers/manager.ts        — playwright dual-browser launch (MV2 old Chrome, MV3 latest)
      src/browsers/load-status.ts    — CDP extension load detection (port of v0 behavior)
  examples/
    stub-server.ts — reference adapter: Backend over ExtPorter's Mongo data model
    stub-server.ts           — runnable reference host: Backend over the fixtures
  phase2/                — designed now, not implemented (see Non-goals)
    schema.sql           — SQLite DDL for the folder mode (extensions, reports tables)
```

Files added to host repos (steps 5 and 6):

```
ExtPorter:  migrator/features/extlens/adapter.ts   — Backend over Mongo collections
            migrator/features/extlens/index.ts     — starts the extlens server alongside the app
AgenticMigrator: src/extlens/adapter.ts            — Backend over run/ outputs
                 src/extlens/index.ts              — starts the extlens server (optional flag)
```

## Protocol (v1, specified in PROTOCOL.md)

Transport: one WebSocket connection. Envelope is JSON-RPC 2.0 style:

```
request:  {"jsonrpc":"2.0","id":1,"method":"extensions.list","params":{...}}
success:  {"jsonrpc":"2.0","id":1,"result":{...}}
failure:  {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"..."}}
```

Methods:

- `ping` — health check. Result `{ok: true}`
- `extensions.list` — params `{page?, pageSize?, search?, sort?}` where sort is
  `interestingness_desc | interestingness_asc | name`. Result `{extensions: ExtensionLight[],
  stats: {total, analyzed, with_mv3, avg_score}, page, pageSize, totalPages}`
- `extensions.get` — params `{id}`. Result `{extension: ExtensionProfile}`
- `extensions.files` — params `{id}`. Result `{files: {mv2?: string, mv3?: string}}`. File
  references are transport-agnostic strings. v1 hosts return `file://` absolute paths.
  `mv2` is optional: a host without an MV2 source omits it.
  PROTOCOL.md documents `http(s)://` as the remote-host form
- `reports.get` — params `{extensionId}`. Result `{report: Report | null}`
- `reports.submit` — params `{report}`. Result `{id}`

Error codes: standard JSON-RPC codes for parse/invalid params/method not found, plus app code
`404` for unknown extension id. PROTOCOL.md documents future methods explicitly as NOT
implemented: `analysis.rerun`, `db.query`, HTTP file plane.

## Host SDK design

The SDK publishes to npm as `extlens-sdk`. A host adds it as a dependency and imports it:

```ts
import { createExtlensServer, type Backend } from 'extlens-sdk';

const server = createExtlensServer({ port: 8081, backend: myBackend });
```

The `Backend` interface is the contract hosts implement:

- `listExtensions({page, pageSize, search, sort})` → light list + stats
- `getExtension(id)` → files (with contents), manifest, and any host-provided profile fields
- `getFiles(id)` → `{mv2: string, mv3?: string}` file references
- `getReport(extensionId)` → report or null
- `submitReport(report)` → id

The SDK provides `computeProfile(source)` (uses the analyzer) and a default flow: when the
backend returns no profile fields, the SDK computes a profile from the host's files. Hosts
with existing analysis (ExtPorter) can return their own fields; the protocol shape wins.

## Implementation steps

Step 1 — Scaffold the workspace
- Create flake.nix with a dev shell: bun, nodejs_22, git. Mirror AgenticMigrator's flake
  shape (nixpkgs + flake-utils inputs, mkShell output).
- Create .envrc with `use flake`; run `direnv allow` so the shell activates on entry.
- Create the workspace: root package.json, tsconfig.base.json, git init.
- Install deps per package: protocol (zod), analyzer (none), host-sdk (zod), client (ink,
  react, playwright, zod).
- Run `bunx playwright install chromium` once (needed by the analyzer tab).
- Verify `bun --version`, `node --version`, and a hello-world ink app all run inside the
  direnv shell.
- Build the SDK once (`bun run build` in host-sdk) so `tests/consumer.test.ts` can import
  the built package.

Step 2 — Define the protocol (doc-driven)
- Write PROTOCOL.md first: envelope, methods, params, results, errors, file references,
  future methods.
- Implement zod schemas and types in the protocol package.
- Test that schemas accept valid messages and reject malformed ones.

Step 3 — Port the analyzer as pure functions
- Port scoring weights, breakdown type, file/manifest analyzers, feature tagger, listener
  extractor, size calculator from v0. Fix the v0 bad design: input is an immutable
  `ExtensionSource {manifest, files: {path, type, content}[]}`, output is a new
  `AnalysisProfile`. No mutation, no global logger, no pipeline.
- Unit tests with golden numbers computed by hand from the v0 weights on the fixtures.

Step 4 — Host SDK (the `extlens-sdk` package)
- Implement backend.ts (interface), ws.ts (ws server wiring), rpc.ts (id tracking, zod
  validation, dispatch, error mapping), profile.ts (default profile computation), index.ts
  (public API surface).
- Configure tsup: dual ESM + CJS builds with .d.ts output; exports map in package.json
  (import, require, types). The SDK has no dependency on ink or react.
- Test over a real WebSocket with an in-memory stub backend: every method, error codes,
  unknown method, malformed params.
- Consumer smoke tests: a plain node ESM script and a plain node CJS script each import the
  built package, start a server, call ping, and shut down.

Step 5 — ExtPorter adapter
- NOT IMPLEMENTED by decision: the ExtPorter repo stays untouched. The intended shape is
  documented in ADAPTERS.md (a Backend over its Mongo Extension/Report collections, its
  stored score/breakdown/tags/listeners as profile overrides).

Step 6 — AgenticMigrator adapter (DONE)
- Add `extlens-sdk` as a dependency to the AgenticMigrator repo. Add `src/extlens/` with a
  Backend over the run/ directory: the migrated output (out/), report.json, and the
  recorded source path per run.
- Serve extension files via file references; compute the profile with the SDK default
  flow (runs the analyzer on the on-disk output).
- Start the server via a CLI flag (`--extlens-port`, `EXLENS_PORT`, `EXLENS_RUN_DIR`) or a
  standalone entry (`tsx src/extlens/index.ts --port N --run <dir>`).
- `src/cli.ts` records `source-path.txt` (the MV2 source) and can stay alive serving the
  completed run.
- Verified: typechecked against the SDK, scripted end-to-end over a real WebSocket against
  a synthetic run/ directory, standalone entry pinged and shut down cleanly.

Step 7 — Client explorer tab
- Connection lifecycle: connect, reconnect with backoff, status bar.
- Render stats header, search input, sort toggle, paginated list with score bars and tags.
- Keys: `/` search, `s` sort, arrows select, `enter` → analyzer tab, `q` quit.
- Verify against both hosts (ExtPorter and AgenticMigrator adapters).

Step 8 — Client analyzer tab
- Profile view: score + breakdown bars, tags, listeners, manifest summary.
- Review flow: request `extensions.files`, launch dual browsers via playwright (MV2 uses
  `CHROME_OLD` env, MV3 uses `CHROME_LATEST` env or bundled chromium), detect load status via
  CDP targets, show per-browser status.
- Report form: tested, working, errors, slower, login, popup, settings, interesting, notes,
  per-listener untested/yes/no. Submit via `reports.submit`.
- Handle MV3-missing extensions (MV2-only review).
- Verify manually against both hosts.

Step 9 — Docs and polish (DONE)
- README: quickstart (start a host adapter, connect the client), keybindings, env vars
  (EXTLENS_WS, CHROME_OLD/CHROME_LATEST, EXLENS_PORT/EXLENS_RUN_DIR).
- ADAPTERS.md: how to embed the SDK, Backend interface reference, AgenticMigrator
  walkthrough, ExtPorter status, distribution path.
- Error surfacing polish: server errors rendered in the client status bar.

Phase 2 (designed now, not implemented)
- Folder mode: ingest (discover + analyzer) and a SQLite FolderBackend (better-sqlite3),
  shipped in the SDK. Schema in phase2/schema.sql (extensions, reports tables; id is a stable
  sha256 of the absolute path; indexes on name and interestingness_score).
- `extlens serve <folder>` runs standalone with no host.
- The protocol and Backend interface do not change; FolderBackend is another implementation.

## Testing plan

- Analyzer: unit tests per module (scoring golden numbers, listener dedupe and line numbers,
  tag presence). Fixtures are synthetic, so expectations are hand-computable.
- Protocol: zod round-trip and rejection tests.
- Host SDK: integration tests against a stub in-memory backend over a real WebSocket; every
  protocol method exercised; error cases (unknown id, invalid params).
- AgenticMigrator adapter: scripted end-to-end over a synthetic run/ directory (list, get,
  files, report round trip, 404); verified against a real WebSocket server.
- Client: manual interactive verification (explorer navigation, browser launch, form submit,
  report persistence check via `reports.get`). No automated TUI tests in v1.
- SDK consumers: ESM and CJS smoke tests against the built package (step 4).

## Rollout

- The protocol pins at v1 in PROTOCOL.md with a changelog section.
- The SDK publishes to npm as `extlens-sdk` (free on npm). Hosts install it like any node
  dependency. A `prepublishOnly` build runs tsup (ESM + CJS + types).
- Adapters land in the host repos; each host owns its adapter code.
- Phase 2 (folder mode) is designed now and implemented after v1 review.

## Non-goals (v1)

- Migrator tab and migration orchestration (stays in AgenticMigrator)
- Database tab (raw query UI)
- LLM auto-description and auto-fix
- CWS (Chrome Web Store) scraping
- Terminal image previews (kitty protocol)
- Local folder mode (phase 2)
