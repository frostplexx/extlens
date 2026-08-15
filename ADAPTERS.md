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
# serve the run you just produced (server starts before the migration and
# keeps serving the completed run until Ctrl+C)
migrate <extension-dir> --port 8081

# serve a populated run directory without re-running a migration
migrate --out ./run --port 8081
# or the standalone entry (same thing)
EXLENS_RUN_DIR=./run tsx src/extlens/index.ts --port 8081

# serve runs plus every unmigrated extension from a corpus directory
migrate --out ./run --source-dir ./corpus --port 8081
```

Environment: `EXLENS_PORT` (default 8081), `EXLENS_RUN_DIR` (default `./run`),
`EXLENS_SOURCE_DIR`. The server is on by default; `--no-server` disables it
for one-shot runs.

### Unmigrated extensions

Every subdirectory of `--source-dir` (or `EXLENS_SOURCE_DIR`) that contains a
`manifest.json` is listed as an unmigrated extension unless its resolved path
is recorded as a run's `source-path.txt`. An unmigrated source has an MV2
profile, `hasMv3: false`, and `files.mv2` only; it is read-only
(`reports.submit` rejects it). A migrated source is represented by its run row
instead, so the corpus does not double-list completed work.

### Host changes beyond src/extlens/

`src/cli.ts` records the source extension path (`source-path.txt`) after
clearing the run dir, then starts the server (default port 8081) before the
migration so the client can watch the run dir fill in. The server stays alive
after the migration until Ctrl+C. With no extension dir argument, the CLI
serves the existing run dir without migrating (server-only mode).

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
