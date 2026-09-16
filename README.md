# extlens — extension analysis + review toolchain

extlens is a protocol-first tool for analyzing and reviewing Chrome extensions.
Two front ends connect over WebSocket to any host that embeds the `extlens-sdk`:
an ink terminal client and a local web UI. The SDK serves a documented JSON-RPC
protocol (PROTOCOL.md) and computes profiles with a pure analyzer. Neither
client touches host storage.

## What works today

- Pure analyzer (port of the ExtPorter v0 scoring modules): score, 14-part
  breakdown, feature tags, listener extraction, size.
- `extlens-sdk`: WebSocket JSON-RPC server, `Backend` interface, default
  profile computation, protocol validation.
- Ink client with two tabs: explorer (search, sort, pagination, score bars,
  tags) and analyzer (profile view, dual-browser launch via playwright, manual
  report form).
- Web UI (`npm run web`): a local React + Tailwind page (shadcn/ui components)
  served by a node process that keeps the browser launching. Dense sortable
  table, detail pane, real form controls, collapsible host log.
- A real adapter: AgenticMigrator (`src/extlens/` in that repo) serves its
  `run/` outputs.
- Folder mode: `extlens serve <folder>` ingests a plain directory of
  extensions into SQLite and serves it standalone, with no host project.
- Batch migration: AgenticMigrator's CLI auto-detects a corpus
  (`migrate ./corpus --out ./mv3-output`) and migrates every MV2 source into
  one output root.
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

Press `?` in the client for the full list. It is generated from
`packages/client/src/keys/keymap.ts`, which is also what the dispatcher reads — so the help
screen, the footer hints and the actual bindings cannot disagree. To add or change a key, edit
that table and nothing else.

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

## Web UI

```sh
npm run web                              # build, serve, print a tokenised localhost URL
npm run web -- --ssh daniel@10.0.0.5     # same, against a remote host
```

Flags after `--` reach the server: `--ws`, `--ssh`, `--remote-port`, `--port`
(default 8090).

The printed URL includes a one-off token; the server binds `127.0.0.1` and
rejects any bridge connection without it.

Everything the terminal client does locally, the web server does instead:

```
browser tab ──ws──► node server ──ws (or ssh -L)──► extlens host
                        └──► playwright ──► Chrome for Testing (MV2 / MV3)
```

That is why a web UI can still launch the test browsers. The page cannot spawn
a process, but the process serving the page can, and it is the same process that
runs the ssh tunnel and downloads remote file refs. Methods starting `local.*`
are handled by that process; everything else is relayed to the host untouched,
so the web UI adds nothing to the protocol.

Browser state (launching, loaded, download progress) is pushed to every open tab
rather than polled, because it changes on the server's schedule — a download
progressing, or Chrome being closed by hand.

`EXTLENS_WEB_TOKEN` pins the token instead of generating one per run. With
`--ssh`, the password prompt appears in the terminal running the server, before
any tab connects.

For UI development, `npm run web:dev` runs vite on :5173 with HMR; keep
`npm run start --workspace packages/web` running alongside it for the bridge,
and open the :5173 page with the same `?token=` query.

### The verification form

One row per surface the extension actually exposes, each with an instruction for what to check
(`packages/protocol/src/surface-copy.ts`, shared by both clients so two reviewers answer the same
question). Four states per surface — works / partly works / broken / can't test — and the verdict
and 0–1 score are computed from them, never asked for.

Two things are deliberately *not* on the form:

- **Listeners are not judged.** You cannot watch `chrome.contextMenus.onClicked` fire, only the
  menu entry doing something. Each listener is shown as evidence under the surface it exercises,
  so it reads as "here is what to trigger" rather than as a question.
- **No overall verdict field.** It is derived from the surface results; asking for it separately
  invites a reviewer to contradict their own observations.

For page interaction, content-script match patterns are turned into openable pages
(`https://*.github.com/*` → `https://github.com/`) and clicking one opens it in **both** running
test browsers at once, which is what makes MV2 and MV3 behaviour comparable rather than
remembered. A pattern that names no particular site (`<all_urls>`, `https://*/*`) is shown as
"any page" rather than resolved to an invented host.

### Review mode

Browse mode is a table; review mode is the loop you actually run a corpus
through — one extension at a time, with the queue keeping your place:

- pick a queue: not yet reviewed (default), migrated-but-unreviewed, or
  everything, in the current sort order
- the MV2/MV3 browsers launch automatically for each extension (toggleable), so
  the step between two verifications is one keystroke
- **Save & next** files the report and advances; **Skip** advances without one
- the queue is a snapshot taken when the pass starts, so an extension you file
  keeps its place instead of vanishing from under the cursor
- pages are fetched ahead of the cursor, so a pass runs past page boundaries
  without you noticing there were any

### Code mode

The profile says what the analyzer found; code mode shows the thing it found it
in. `c` (or the **Code** button) opens the selected extension as a file tree with
a read-only Monaco editor. When the host serves both variants, the tree carries
VS Code's git decorations — `A` added, `M` modified, `D` removed in MV3 — and a
changed file opens as a side-by-side MV2→MV3 diff; `Diff | MV2 | MV3` switches
the view, and "Changed only" narrows the tree to the migration's footprint.
Every `file:line` a listener shows is a link into it.

The files come through two `local.*` methods (`local.source.tree`,
`local.source.file`) that read the same directories a browser launch uses — so a
remote corpus is browsable once its refs have been downloaded, and the protocol
still adds nothing. Reads are confined to the extension directory; a path that
resolves outside it (`..`, a symlink out) is refused.

Code mode is a detour: `Esc` returns to wherever it was entered from, browse or
review, with the queue position intact.

Keyboard: `/` search, `b`/`x` launch/close browsers, `l` log, `c` code. In browse
mode `j`/`k` move the selection; in review mode `]`/`[` (or `j`/`k`) move through
the queue.

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
packages/session    — node-side session: ws client, ssh tunnel, Chrome for Testing control
packages/client     — ink TUI (private, not published)
packages/web        — local web UI: react + vite + tailwind page, plus the node server
                      that serves it and owns the browsers
examples/           — stub host server over the fixtures
fixtures/           — synthetic extensions with hand-computed golden scores
```

`packages/session` exists because driving a host and driving local browsers is
the same work whether the UI is a terminal or a browser tab. It has no UI
framework and no rendering; both front ends depend on it, so there is one
implementation of the tunnel, the reconnect logic and the browser launch.

### Client architecture

The client is split so that each file answers one question, and `app.tsx` is only wiring:

```
src/app.tsx            — composition root: hooks in, screen out, keys dispatched. No RPC.
src/layout.ts          — the vertical budget. Every fixed row of chrome is itemised here.
src/keys/keymap.ts     — the binding table: chords, scopes, help text, footer hints.
src/keys/useKeymap.ts  — dispatch, plus the modal "capture" stack (password, help, form, …).
src/state/*.ts         — one hook per concern, each taking `client` and returning actions:
                           useConnection  ws client + ssh tunnel + password prompt
                           useHost        migration status, log tail, start/stop
                           useExtensionList  paging, debounced search, sort, selection
                           useAnalyzer    profile/files/report for one extension, advance
                           useBrowsers    MV2/MV3 Chrome for Testing launch + download prompt
                           useReportForm  the manual verification form and its submit
src/components/*.tsx   — pure rendering: props in, ink nodes out.
```

Two rules keep it that way. Layout arithmetic lives only in `layout.ts` — a component that needs
to know its height takes it as a prop, so no view can quietly render taller than the terminal
(`tests/fits-terminal.test.ts` renders every view at eight sizes and measures). And keyboard
input lives only in `keys/` — a component never calls `useInput` for a binding; it either gets a
handler or, if it is modal, gets pushed onto the capture stack in `app.tsx`, where precedence is
visible as array order.

### Web architecture

```
packages/web/server/index.ts   — http + ws, static serving, token check, host link
packages/web/server/bridge.ts  — local.* methods: browser launch/close, download prompts
packages/web/src/bridge.ts     — the page's socket: RPC promises + pushed events
packages/web/src/hooks/*.ts    — useBridge, useExtensions, useProfile, useHostJob
packages/web/src/components/*  — table, detail pane, report form, log dock (presentational)
packages/web/src/components/ui — shadcn/ui components, generated; do not hand-edit
```

The table is TanStack Table over shadcn's `table` primitives, in manual sorting
and pagination mode: the host owns the corpus, so the table only owns the column
model and presentation.

The same rule as the TUI: hooks own behaviour, `App.tsx` is wiring.

Components come from shadcn/ui (`npx shadcn@latest add <name>`) and are left
exactly as generated, so they can be regenerated or updated. Theming is the
supported way — `src/index.css` maps shadcn's semantic tokens (`--background`,
`--primary`, `--border`) onto the Catppuccin Mocha palette that
`packages/client/src/theme.ts` uses, so the two front ends read as one tool
without any component being forked. Anything that encodes something about
*extensions* rather than about widgets (what a score colour means, what a
browser phase looks like) lives in `components/shared.tsx`.

Where a shadcn component needs a project colour — score bars, breakdown bars —
it is recoloured through its `data-slot` from the outside (`[&_[data-slot=
progress-indicator]]:bg-green`) rather than by forking the component.

## Docs

- PROTOCOL.md — the wire protocol (methods, params, results, error codes,
  future methods)
- ADAPTERS.md — how to embed the SDK in a host project
- PLAN.md — the implementation plan and status

## Status

Implemented: protocol, analyzer, host SDK, client (explorer + analyzer tabs),
AgenticMigrator adapter, SSH mode, folder mode (SQLite `FolderBackend`,
`extlens serve`), AgenticMigrator batch migration (`--batch`), docs. Not
implemented: ExtPorter adapter (see ADAPTERS.md).
