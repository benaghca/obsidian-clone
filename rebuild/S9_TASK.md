# S9: Coalesce outside-change refreshes and stop linear file-list scans in Vault

From Fable 5.2's 10 Nov 2026 read-only review of Grove. These are **findings 13 and 14**, scoped to `src/vault.ts` so this branch does not fight S1 (which is already editing `workspace.ts`). Chris approved starting this work provided nothing visible changes. Build on `rebuild/s9-grok` from the brief commit on `rebuild/integration`. Grok 4.7 builds; Codex will review later, read-only. Commit locally. Never push.

## In plain words

When files change on disk, the backend can emit several events in a short burst. Each event makes the page re-read the whole file list and the link index, and reload paths one at a time. Stale replies are already dropped, but Rust still does the work. Also, helpers like `isFolder` and `touch` walk the whole file list every time. Queue those events and refresh once per frame, and keep a path-to-entry map for the current file list. What the user sees stays the same: the same files, the same open notes, the same folder checks, just less repeated work.

## Problem (paths relative to `rebuild/app/`)

Fable finding 13:

- `src/vault.ts:122-127`: `onChanged` handles one backend event at a time. Non-`modify` events call `refreshFiles()`; non-`remove` events `reload` each path; every event also `refreshLinks()`. The backend emits one event per kind per batch, so a burst still causes several full re-reads.

Fable finding 14, `vault.ts` call sites only:

- `src/vault.ts:103`: `isFolder` uses `files.some`.
- `src/vault.ts:108-112`: `touch` uses `files.find` on every save.
- Other call sites (for example `src/workspace.ts:276` and `:631`) also scan the list. **Do not edit `workspace.ts`.** S1 owns it in this wave. You may add a cheap public lookup on `Vault` (for example `entry(path)` / a path map) so later work can use it, and use that map inside `vault.ts` itself.

## Goal

**No visible behavior change.** Layout, shortcuts, look, theme, and which files/notes/links the page ends up with after a burst of disk events stay the same. Reloads still happen for paths that need them; they just batch.

- Queue `onChanged` events and refresh once per frame (or one microtask/animation-frame flush): one `refreshFiles` if any event in the batch needs it, a combined set of paths to `touch` / `reload`, and one `refreshLinks`.
- Keep a path-to-entry `Map` (or equivalent) for the current `files` snapshot. Rebuild it when `this.files` is replaced. Use it in `isFolder`, `touch`, and any other `vault.ts` helper that currently scans.
- Expose a cheap path lookup if that is a small addition, but do not go update callers in other files.

Preserve existing request-id dropping of stale `refreshFiles` / `refreshLinks` replies.

## File ownership (do not fight the other builders)

- You own `src/vault.ts` and a new or existing vitest file for it (for example `src/vault.events.test.ts`).
- Do **not** edit `src/workspace.ts`, `src/main.ts`, `src/fileOps.ts`, `src/noteEditors.ts` (S1).
- Do **not** edit `src/shell/sidebar.ts` (S7), or CI / E2E files (S8).
- Do **not** edit `src/links/internal.ts`, `src/editor/livePreview.ts`, `src/shell/searchRead.ts`, `src/shell/searchView.ts`, or the Rust link resolver (L1). If you must keep `linkExists` working, leave its body and `linkTargets` wiring alone — L1 may make a tiny edit there. Keep your diff to `onChanged`, the path-to-entry map, `isFolder`, and `touch`.
- Do **not** edit `src-tauri/` (S3, S4, S5). Do not change the Rust watcher protocol.

## Tests

Add regression tests that **fail before this change and pass after** (check this). Use vitest with a mock `api` / fake `listFiles`, `linkIndex`, and `reload`. No GUI windows.

Cover at least:

- Several `onChanged` events in the same frame (mixed kinds, including `modify`, `create`/`add` if that's what the backend sends, and `remove`) result in a constant number of `listFiles` / `linkIndex` calls (one each, or otherwise independent of the event count), not one per event. Reloads still cover the union of paths that should reload, and removed paths are not reloaded.
- `isFolder` and `touch` use the map: they find the right entry, and a hook or counter can show they do not walk every file.
- A later file-list refresh replaces the map, so lookups follow the new list.

Do not weaken any existing assertion. A focused vitest file that runs as part of `vitest run` is enough.

## Hard rules

- Work only under `rebuild/app/` TypeScript, scripts, tests, plus this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green if you touch anything it covers.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser. Headless Chromium only, if you need the existing feel harness at all.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline` must pass.
- Restore any screenshots the suite rewrites before committing.
- Commit locally on `rebuild/s9-grok`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that batches refreshes and adds the path map inside `Vault`. `vault.ts` is short; keep it that way.
- Delete code your changes make dead.
- Keep every file under ~800 lines. No new dependency.

## Scope limits

**In scope:** `onChanged` coalescing, path-to-entry map and its use inside `vault.ts`, a public lookup if tiny, tests and notes.

**Out of scope:** updating `workspace.ts` or other scan sites; Rust watcher changes; sidebar hitch (S7); path-style link scans (S6); CI / E2E (S8); save/retry (S1); visible behavior; the unmerged T1 tabs work; opening the real app.

## Done when

- Bursts of disk events refresh once per frame, lookups in `Vault` no longer scan the list, with tests that failed before and pass after, and the same end state as today.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S9-grok.md` before you finish, and commit it with the code. Include:

- In plain words: what repeated work is avoided, and confirmation that nothing visible changed.
- How you proved each test failed before and passed after.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
