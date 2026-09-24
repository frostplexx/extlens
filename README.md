# extlens — extension analysis + review toolchain

extlens is a protocol-first tool for analyzing and reviewing Chrome extensions.
A desktop app (Electron) connects over WebSocket to any host that embeds the `extlens-sdk`.
The SDK serves a documented JSON-RPC protocol (PROTOCOL.md) and computes
profiles with a pure analyzer. The client never touches host storage.

## What works today

- Pure analyzer (port of the ExtPorter v0 scoring modules): score, 14-part
  breakdown, feature tags, listener extraction, size.
- `extlens-sdk`: WebSocket JSON-RPC server, `Backend` interface, default
  profile computation, protocol validation.
- Desktop app (`npm run desktop`): an Electron app — a React + Tailwind page
  (shadcn/ui components) in a window, with the main process owning the host
  link and the test browsers. Dense sortable table with a host-side "filter by"
  (verdict, unreviewed, MV3 build), detail pane, real form controls, collapsible
  host log, and a settings page (host, browsers, keychain).
- A real adapter: AgenticMigrator (`src/extlens/` in that repo) serves its
  `run/` outputs.
- Folder mode: `extlens serve <folder>` ingests a plain directory of
  extensions into SQLite and serves it standalone, with no host project.
- Batch migration: AgenticMigrator's CLI auto-detects a corpus
  (`migrate ./corpus --out ./mv3-output`) and migrates every MV2 source into
  one output root.
- SSH mode: the app tunnels the WebSocket to a remote host and proxies its
  file refs, so a remote AgenticMigrator host works like a local one. Passwords
  can be remembered in the OS keychain.

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

Then build and start the app (see below):

```sh
npm run desktop:build   # once
npm run desktop -- --ws ws://localhost:8081
```

Or against a remote host over SSH (the host must already run on the remote):

```sh
npm run desktop -- --ssh myserver
npm run desktop -- --ssh user@host --remote-port 8081
```

Flags are optional: the app remembers the last host, and the settings page changes it.

Environment (all optional; the settings page overrides the browser ones):

- `EXTLENS_WS` — host URL (default `ws://localhost:8081`), or `--ws` flag
- `EXTLENS_SSH` — ssh destination (`user@host` or an `~/.ssh/config` alias),
  or `--ssh` flag. Takes precedence over `--ws`
- `EXTLENS_REMOTE_PORT` — the host's ws port on the remote (default 8081), or
  `--remote-port` flag
- `CHROME_OLD` — Chromium build that still runs MV2
- `CHROME_LATEST` — Chromium build for MV3 (defaults to playwright's chromium)
- `EXTLENS_BROWSER_DIR` — install dir for downloaded Chrome for Testing builds
  (default `/tmp/extlens`)

When a browser is missing, the detail pane asks whether to download Chrome
for Testing and installs it under the browser dir. MV2 gets Chrome 116 (the
last build that loads MV2 extensions); MV3 gets the latest stable build. The
settings page can set the executables and the dir explicitly, and download
either browser ahead of time.

## Desktop app

```sh
npm run desktop:build                      # renderer + main; needed once, and after source changes
npm run desktop                            # launch what is built
npm run desktop -- --ssh daniel@10.0.0.5   # launch already pointed at a remote host
npm run desktop:dev                        # vite with HMR + electron against it; no build step
npm run desktop:pack                       # unpacked app bundle under packages/desktop/release
```

Flags after `--` reach the app: `--ws`, `--ssh`, `--remote-port`. Without
them the app reconnects to the last host it was pointed at; the host is
changed on the settings page (the top-bar host indicator goes there).

The page cannot spawn processes; the main process does:

```
renderer ──ipc──► main process ──ws (or ssh -L)──► extlens host
                       └──► playwright ──► Chrome for Testing (MV2 / MV3)
```

Methods starting `local.*` are handled by the main process — browsers, source
files, the connection, settings; everything else is relayed to the host
untouched, so the app adds nothing to the protocol. The renderer reaches main
through one preload function (`window.extlens.call`) and one event channel; it
has no node access.

Browser state (launching, loaded, download progress) is pushed to the page
rather than polled, because it changes on the process's schedule — a download
progressing, or Chrome being closed by hand.

The renderer is served on its own `app://` scheme with a CSP, not from
`file://`; the top bar is the window's title bar (native chrome is hidden).

### The verification form

One row per surface the extension actually exposes, each with an instruction for what to check
(`packages/protocol/src/surface-copy.ts`, in the protocol so every client asks the same
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

### Why did it fail?

A saved report with a failing verdict gets a **Why did it fail?** card with an
**Explain** button. The host asks a model to read the report — the per-surface
results and the reviewer's notes are the centre of the prompt — against both
manifest summaries and the MV2→MV3 diff, and answers with the likely cause, the
evidence, and what would fix it. Nothing is stored unless you click **Add to
notes**, which appends it to the report under an attribution line.

The model runs on the host (`analysis.explain`), not in the page: set
`ANTHROPIC_API_KEY` where the host runs (`EXTLENS_EXPLAIN_MODEL` picks the
model). A host without a key says so in the card instead of failing.

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

For an ssh target, the app uses the system `ssh` binary to reach the remote
host. It forwards the WebSocket through an `ssh -L` tunnel and downloads the
`extensions.files` refs into a local cache before the browser launches. It
spawns OpenSSH, so `~/.ssh/config` aliases, jump hosts, host-key
verification, key auth, and password auth all work as they do with plain
`ssh`.

Key auth needs no prompt. When ssh wants a password, the app shows a modal prompt;
the password goes to ssh through an askpass helper and is never written
anywhere in the clear. Ticking "remember" stores it with Electron's
`safeStorage` — encrypted under a key the OS keychain holds (login Keychain on
macOS, DPAPI on Windows, secret service on Linux) — and only once the tunnel
has actually come up with it, so a wrong password is never saved. The settings
page lists saved hosts and forgets them. One control master serves the tunnel
and the file downloads, so nothing re-prompts mid-session; the app tears the
master down on exit.

If the tunnel drops, the app reconnects automatically. Key auth and a
remembered password reconnect silently; otherwise the dialog reappears. The
forward is re-established on the same port, so the WebSocket client reconnects
against one URL. Changing the host in the dialog stops the retry loop.

## Repo layout

```
packages/protocol   — zod schemas + types; the single source of truth for the wire format
packages/analyzer   — pure analysis functions (no dependencies)
packages/host-sdk   — extlens-sdk: ws server, Backend contract, profile computation
packages/session    — node-side session: ws client, ssh tunnel, Chrome for Testing control
packages/desktop    — the Electron app: renderer (react + vite + tailwind), main process
                      (host link, browsers, settings, keychain), preload
examples/           — stub host server over the fixtures
fixtures/           — synthetic extensions with hand-computed golden scores
```

`packages/session` holds the node-side work of driving a host and driving local
browsers — the ws client, the ssh tunnel, the reconnect logic and the Chrome for
Testing launch. It has no UI framework and no rendering, so a front end other
than this one (the ink terminal client this repo once had) can reuse it
unchanged.

### Desktop architecture

```
packages/desktop/src/main/index.ts       — window, app:// scheme, ipc, native pickers
packages/desktop/src/main/core.ts        — the process's behaviour: host link, ssh password flow,
                                           settings; testable without Electron
packages/desktop/src/main/bridge.ts      — local.* methods: browser launch/close, downloads, source
packages/desktop/src/main/credentials.ts — safeStorage-backed keychain vault
packages/desktop/src/preload/index.ts    — window.extlens: call + on, nothing else
packages/desktop/src/renderer/bridge.ts  — the page's side of that
packages/desktop/src/renderer/hooks/*    — useBridge, useExtensions, useProfile, useHostJob
packages/desktop/src/renderer/components — table, detail pane, report form, log dock, settings, connection
packages/desktop/src/renderer/components/ui — shadcn/ui components, generated; do not hand-edit
```

The table is TanStack Table over shadcn's `table` primitives, in manual sorting
and pagination mode: the host owns the corpus, so the table only owns the column
model and presentation.

Hooks own behaviour; `App.tsx` is wiring.

Components come from shadcn/ui (`npx shadcn@latest add <name>`) and are left
exactly as generated, so they can be regenerated or updated. Theming is the
supported way — `src/index.css` maps shadcn's semantic tokens (`--background`,
`--primary`, `--border`) onto the Catppuccin Mocha palette, without any
component being forked. Anything that encodes something about
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
