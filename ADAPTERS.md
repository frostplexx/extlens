# ADAPTERS.md — embedding the extlens SDK in a host

extlens is protocol-first. A host project (ExtPorter, AgenticMigrator, or anything
else) embeds `extlens-sdk`, implements one interface, and the ink client can
browse, analyze, and review its extensions. The host never talks to the client
directly; the SDK serves the protocol from PROTOCOL.md over one WebSocket.

## Adding the SDK to a host

The SDK is not yet published to npm. Until it is, reference it with a `file:`
dependency and build it first:

```sh
# in the extlens repo
npm run build                       # builds packages/host-sdk/dist
```

```json
{
  "dependencies": {
    "extlens-sdk": "file:../extlens/packages/host-sdk"
  }
}
```

`file:` dependencies copy the package directory, so `dist/` must exist before
the host runs `npm install`. Swap the `file:` path for `^1.0.0` once
`extlens-sdk` publishes. Run `npm install` (not `npm ci`) after adding the
dependency, so the lockfile reconciles.

Node >= 20. The SDK ships ESM and CJS builds plus type declarations.

## The Backend interface

Implement the five methods. The SDK validates every return value against the
protocol schema and reports -32603 on mismatches.

```ts
import { createExtlensServer, type Backend } from "extlens-sdk";

const backend: Backend = {
  async listExtensions(params) {
    // params: { page (1-indexed), pageSize, search?, sort }
    // sort: "interestingness_desc" | "interestingness_asc" | "name"
    return {
      extensions: [...],      // ExtensionLight: id, name, version, manifestVersion, score, tags, hasMv3
      stats: { total, analyzed, withMv3, avgScore },
      page: params.page,
      pageSize: params.pageSize,
      totalPages,
    };
  },

  async getExtension(id) {
    // Return null for an unknown id (the SDK maps it to -32601/404).
    return {
      source: { id, manifest, files: [{ path, type, content }] },
      profile: { /* optional Partial<ExtensionProfile> overrides */ },
    };
  },

  async getFiles(id) {
    // File references are transport-agnostic. v1 hosts return absolute paths:
    // { mv2: "/path/to/mv2", mv3: "/path/to/mv3" }
    // mv2 is optional: a host without an MV2 source omits it.
  },

  async getReport(extensionId) { /* Report | null */ },
  async submitReport(report) { /* returns the report id (string) */ },
};

const server = createExtlensServer({ port: 8081, backend });
await server.close(); // graceful shutdown
```

Profile fields returned by the backend win over the computed ones; anything
missing is filled by `computeProfile(source)` (the pure analyzer over the host's
files) plus `summarizeManifest`. A host with its own analysis (scores, tags,
breakdown, listeners) returns those in `profile` and the protocol shape wins.

One report per extension: `reports.submit` is an upsert keyed by `extensionId`.

## Reference implementation: AgenticMigrator

The real adapter lives at
[`AgenticMigrator/src/extlens/`](../../../AgenticMigrator/src/extlens/) — see
`adapter.ts` (the Backend) and `index.ts` (server wiring). This section is the
walkthrough; `examples/stub-server.ts` is a runnable in-repo example.

### Run layout

AgenticMigrator's `migrate` command writes one run directory (default `./run`):

```
run/
  out/                  migrated MV3 tree (manifest.json at its root)
  source-path.txt       the original MV2 extension directory
  analysis.json         static-analysis findings (host metadata, not in the protocol)
  report.json           migration verification: { passed, serviceWorker, extensionId,
                        reason, errors[], turns }
  plan.json, transcript.jsonl, migrate.jsonl
```

The adapter resolves runs like this:

- If the run root itself contains `out/manifest.json`, the root is one run.
- Otherwise each subdirectory containing `out/manifest.json` is one run.
- Extension ids are the run directory names.

Use `--out run/<name>` to accumulate multiple runs in one root.

### Mapping decisions

| Protocol concern | Adapter behavior |
| --- | --- |
| Profile | `computeProfile` over `out/` (the migrated MV3). `hasMv3` forced true. |
| Files | `mv2` from `source-path.txt`, `mv3` = `run/<id>/out` |
| reports.get | `report.manual.json` if a human report exists, else the migration `report.json` mapped to the protocol shape (`tested` = `passed`, `hasErrors` = errors present, notes = reason + errors + turns) |
| reports.submit | writes `report.manual.json`; the migration `report.json` is never overwritten |
| list stats | computed by running the analyzer per run (small corpora) |

### Wiring

Two entry points:

```sh
# serve runs + pending sources; migrations start only via host.start
migrate [--source-dir <corpus|ext-dir>] --port 8081

# one-shot migration (no server): what host.start runs as a child process
migrate <extension-dir> --no-server
# or the standalone entry (same thing as the first command)
EXLENS_RUN_DIR=./run tsx src/extlens/index.ts --port 8081
```

The server never auto-migrates. The client triggers a migration through the
protocol's `host.start {id}`; the controller (`src/extlens/migrator.ts`)
spawns a one-shot child (`cli.ts <source> --out run/<id> --no-server`) and
reports phases derived from the run dir (`preparing` → `migrating` →
`verifying` → `done`/`failed`, `stopped` after `host.stop`).

Environment: `EXLENS_PORT` (default 8081), `EXLENS_RUN_DIR` (default `./run`),
`EXLENS_SOURCE_DIR`. The server is on by default; `--no-server` with an
extension dir is the one-shot migration mode.

### Unmigrated extensions

`--source-dir` (or `EXLENS_SOURCE_DIR`) accepts a corpus — a directory of
extension subdirectories — or a single extension directory. A positional
`<extension-dir>` registers as an extra pending source (id = its directory
name). Every listed source that no run's `source-path.txt` points at is
unmigrated: MV2 profile, `hasMv3: false`, `files.mv2` only, read-only
(`reports.submit` rejects it). A migrated source is represented by its run row
instead, so the corpus does not double-list completed work.

### Host changes beyond src/extlens/

`src/cli.ts` starts the server (default port 8081) and then waits: with a
positional extension dir it logs the pending source id and blocks; without one
it serves existing runs. Nothing migrates until `host.start`. `--no-server`
runs the migration pipeline inline (convert → static analysis → docker) and
exits — that is the child the controller spawns per `host.start`.

## Not implemented: ExtPorter adapter

The original plan listed a Backend over ExtPorter's Mongo collections. It is
deliberately not implemented: ExtPorter's node_modules is not writable from a
reproducible build here, and the decision was to keep that repo untouched. The
shape would mirror the AgenticMigrator adapter: `getExtensionsPageWithStats` /
`findExtension` / `getReportByExtensionId` / `insertReport` map directly onto
the five Backend methods, and its stored `interestingness_score`,
`interestingness_breakdown` (snake_case), `tags`, and `event_listeners` become
`Partial<ExtensionProfile>` overrides.

## File references

`extensions.files` returns `{ mv2?, mv3? }`. v1 hosts return absolute local
paths (`file://` or plain paths; the client resolves both). PROTOCOL.md
reserves `http(s)://` for the remote-host form in a later phase.

## Distribution path

1. Local: `file:` dependency as above.
2. Publish `extlens-sdk` (`npm publish` from `packages/host-sdk`), switch hosts
   to a semver range.
3. Phase 2 adds a `FolderBackend` (SQLite) inside the SDK so extlens can serve
   a plain folder with no host at all.
