# TODO

## Verify on your machine (the sandbox cannot run browsers, docker, or git in host repos)

- [ ] Verify the browser extension load fix — commit `1dc1699` removes playwright's default `--disable-extensions`; the analyzer tab launch (`l`/`d`) must show the extension icon and `loaded as <id>` (packages/client/src/browsers/manager.ts)
- [ ] Verify `host.start`/`host.stop` end-to-end — `running` → `preparing` → `migrating` → `verifying` → `done`; stop mid-migration → `stopped` (npm converts SIGTERM to exit 1, so the controller trusts the stop flag — src/extlens/migrator.ts in AgenticMigrator)
- [ ] Verify `--source-dir` unmigrated listing — corpus dir and single extension dir; `hasMv3: false`, read-only (`reports.submit` rejects)
- [ ] Verify backspace/Delete in explorer search and report notes — ink maps macOS `\x7f` to `key.delete`
- [ ] Verify the missing-browser prompt downloads Chrome for Testing into `EXTLENS_BROWSER_DIR`
- [ ] Verify the explorer list loads when the connection becomes ready — refetch-on-connect
- [ ] Verify MV2 Chrome for Testing 116.0.5845.96 loads MV2 without enterprise policy

## Blocked on user action

- [ ] Commit AgenticMigrator — `src/cli.ts`, `src/extlens/adapter.ts`, `src/extlens/index.ts`, `src/extlens/migrator.ts` (sandbox cannot write that repo's `.git`)
- [ ] Run a full live migration on your machine — docker and `npm run build` (writing `dist/`) are sandbox-blocked; the migration path has not run end-to-end yet

## Missing features

- [ ] Add host lifecycle UI to the ink client — `host.start`/`host.stop` controls on explorer rows; the protocol and AgenticMigrator controller exist, but the client only speaks wire-level
- [ ] Publish `extlens-sdk` to npm — remove `"private": true`, add a `prepublishOnly` tsup build, publish or bundle `@extlens/protocol` + `@extlens/analyzer`, then switch AgenticMigrator's `file:` dep to a semver range (packages/host-sdk/package.json)
- [ ] Update the PROTOCOL.md changelog — `host.status`/`host.start`/`host.stop`, `HOST_BUSY: 409`, and optional `FileRefs.mv2` are missing (PROTOCOL.md:281)

## Phase 2 (designed, out of v1 scope)

- [ ] Folder mode — `FolderBackend` (better-sqlite3, `phase2/schema.sql`) and `extlens serve <folder>`; no protocol or Backend interface changes
