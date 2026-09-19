# TODO

## Verify on your machine (the sandbox cannot run browsers, docker, or git in host repos)

- [ ] Verify the browser extension load fix — commit `1dc1699` removes playwright's default `--disable-extensions`; Launch must show the extension icon and `loaded as <id>` (packages/session/src/browsers/manager.ts)
- [ ] Verify `host.start`/`host.stop` end-to-end — `running` → `preparing` → `migrating` → `verifying` → `done`; stop mid-migration → `stopped` (npm converts SIGTERM to exit 1, so the controller trusts the stop flag — src/extlens/migrator.ts in AgenticMigrator)
- [ ] Verify `--source-dir` unmigrated listing — corpus dir and single extension dir; `hasMv3: false`, read-only (`reports.submit` rejects)
- [ ] Verify the missing-browser prompt downloads Chrome for Testing into `EXTLENS_BROWSER_DIR`
- [ ] Verify the explorer list loads when the connection becomes ready — refetch-on-connect
- [ ] Verify MV2 Chrome for Testing 116.0.5845.96 loads MV2 without enterprise policy
- [ ] Verify SSH key auth — `npm run web -- --ssh <alias>` starts the server without a
  prompt, Launch opens browsers from cached files, and `ssh -O exit` tears the
  master down on exit (packages/session/src/ssh.ts)
- [ ] Verify SSH password auth — the prompt appears in the server's terminal before any
  tab connects; the tunnel connects after entry; downloads do not re-prompt
- [ ] Verify the SSH session against a jump-host alias and against a `file://` ref
  (mv2 as a manifest.json file, mv3 as a directory)
- [ ] Verify `extensions.list` pagination at scale — the SDK rejects a page over 200
  rows (`Too many items`), the client requests one screen per page, and search is
  debounced (packages/protocol/src/messages.ts, packages/web/src/hooks/useExtensions.ts)
- [ ] Verify host lifecycle UI — Migrate all starts a batch (top bar shows progress and an
  ETA), Stop stops it, the list refetches when the job ends, and hosts without a
  HostController hide the controls (packages/web/src/hooks/useHostJob.ts)
- [ ] Verify folder mode — `node packages/host-sdk/bin/extlens.mjs serve <corpus>`
  then open the web UI; first connect indexes, later connects are fast; search
  and sort run host-side; reports persist across restarts; `--db PATH` moves the
  sqlite file (packages/host-sdk/src/folder.ts)
- [ ] Verify better-sqlite3 installs on your machine — the sandbox installed it
  offline from the npm cache; a normal `npm install` must fetch it and build the
  native binding (it is in package-lock.json and packages/host-sdk/package.json)

## Blocked on user action

- [ ] Commit AgenticMigrator — `src/cli.ts`, `src/extlens/adapter.ts`, `src/extlens/index.ts`, `src/extlens/migrator.ts` (sandbox cannot write that repo's `.git`)
- [ ] Run a full live migration on your machine — docker and `npm run build` (writing `dist/`) are sandbox-blocked; the migration path has not run end-to-end yet

## Missing features

- [ ] Nothing pending. (Host lifecycle UI and Phase 2 folder mode are done;
  see the verify items below.)
- [ ] Publish `extlens-sdk` to npm — remove `"private": true`, add a `prepublishOnly` tsup build, publish or bundle `@extlens/protocol` + `@extlens/analyzer`, then switch AgenticMigrator's `file:` dep to a semver range (packages/host-sdk/package.json)
- [ ] Update the PROTOCOL.md changelog — `host.status`/`host.start`/`host.stop`, `HOST_BUSY: 409`, and optional `FileRefs.mv2` are missing (PROTOCOL.md:281)

## Phase 2 (designed, out of v1 scope)

- [ ] Folder mode — `FolderBackend` (better-sqlite3, `phase2/schema.sql`) and `extlens serve <folder>`; no protocol or Backend interface changes
