# extlens — extension analysis + review toolchain

extlens is a protocol-first tool for analyzing and reviewing Chrome extensions.
An ink terminal client connects over WebSocket to any host that embeds the
`extlens-sdk`. The SDK serves a documented JSON-RPC protocol (PROTOCOL.md) and
computes profiles with a pure analyzer. The client never touches host storage.

## What works today

- Pure analyzer (port of the ExtPorter v0 scoring modules): score, 14-part
  breakdown, feature tags, listener extraction, size.
- `extlens-sdk`: WebSocket JSON-RPC server, `Backend` interface, default
  profile computation, protocol validation.
- Ink client with two tabs: explorer (search, sort, pagination, score bars,
  tags) and analyzer (profile view, dual-browser launch via playwright, manual
  report form).
- A real adapter: AgenticMigrator (`src/extlens/` in that repo) serves its
  `run/` outputs.
- SSH mode: the client tunnels the WebSocket to a remote host and proxies its
  file refs, so a remote AgenticMigrator host works like a local one.

## Quickstart

```sh
npm install
npm run build          # build extlens-sdk (packages/host-sdk/dist)
npm test               # vitest: protocol, analyzer, host-sdk
npm run typecheck
```

Start a host. The in-repo stub server serves the fixtures:

```sh
tsx examples/stub-server.ts --port 8081
```

Serve a plain folder of Chrome extensions standalone (no host project):

```sh
node packages/host-sdk/bin/extlens.mjs serve ./corpus --port 8081
# after installing the sdk: `npx extlens serve ./corpus`
```

Folder mode indexes the corpus into SQLite once (`<folder>/.extlens.sqlite`);
lists, search, and sort then serve from indexed SQL. A changed manifest is
re-analyzed on the next `extensions.get`.

Or run the real AgenticMigrator adapter (see ADAPTERS.md):

```sh
cd ~/Projects/AgenticMigrator
# serve runs + pending sources; migrations start only via host.start
npx tsx src/cli.ts --out ./run --source-dir ./corpus --port 8081
# one-shot migration (no server): what host.start runs as a child
npx tsx src/cli.ts <extension-dir> --no-server
```

(`npm run cli -- ...` also works — npm needs the `--` before flags.)

Connect the client:

```sh
npm run client -- --ws ws://localhost:8081
```

Or connect to a remote host over SSH (the host must already run on the
remote):

```sh
npm run client -- --ssh myserver
npm run client -- --ssh user@host --remote-port 8081
```

## Client keybindings

- `/` — focus search
- `s` — cycle sort (interestingness desc / asc / name)
- arrows — select an extension
- `enter` — open the analyzer tab
- `tab` — switch tabs
- `q` — quit

Client environment:

- `EXTLENS_WS` — host URL (default `ws://localhost:8081`), or `--ws` flag
- `EXTLENS_SSH` — ssh destination (`user@host` or an `~/.ssh/config` alias),
  or `--ssh` flag. Takes precedence over `--ws`
- `EXTLENS_REMOTE_PORT` — the host's ws port on the remote (default 8081), or
  `--remote-port` flag
- `CHROME_OLD` — Chromium build that still runs MV2 (the analyzer tab's MV2
  browser)
- `CHROME_LATEST` — Chromium build for MV3 (defaults to playwright's chromium)
- `EXTLENS_BROWSER_DIR` — install dir for downloaded Chrome for Testing builds
  (default `/tmp/extlens`)

When a browser is missing, the analyzer tab asks whether to download Chrome
for Testing and installs it under `EXTLENS_BROWSER_DIR`. MV2 gets Chrome 116
(the last build that loads MV2 extensions); MV3 gets the latest stable build.

## SSH mode

With `--ssh`, the client uses the system `ssh` binary to reach the remote
host. It forwards the WebSocket through an `ssh -L` tunnel and downloads the
`extensions.files` refs into a local cache before the browser launches. The
client spawns OpenSSH, so `~/.ssh/config` aliases, jump hosts, host-key
verification, key auth, and password auth all work as they do with plain
`ssh`.

A password prompt appears in the terminal before the TUI starts. Key auth
needs no prompt. One control master serves the tunnel and the file downloads,
so nothing re-prompts mid-session. The client tears the master down on quit.

If the tunnel drops, the client reconnects automatically. Key auth reconnects
silently. Password auth re-prompts for the password. The client re-establishes
the forward on the same port, so the WebSocket client reconnects against one
URL. Quit the client to stop the retry loop.

## Repo layout

```
packages/protocol   — zod schemas + types; the single source of truth for the wire format
packages/analyzer   — pure analysis functions (no dependencies)
packages/host-sdk   — extlens-sdk: ws server, Backend contract, profile computation
packages/client     — ink TUI (private, not published)
examples/           — stub host server over the fixtures
fixtures/           — synthetic extensions with hand-computed golden scores
```

## Docs

- PROTOCOL.md — the wire protocol (methods, params, results, error codes,
  future methods)
- ADAPTERS.md — how to embed the SDK in a host project
- PLAN.md — the implementation plan and status

## Status

Implemented: protocol, analyzer, host SDK, client (explorer + analyzer tabs),
AgenticMigrator adapter, SSH mode, docs. Not implemented: ExtPorter adapter (see
ADAPTERS.md), phase 2 folder mode (SQLite `FolderBackend`, `extlens serve`).
