# Round 8: cleanup (merged result)

Written at merge time by the build loop, not by an agent: r8-claude hit its session limit before writing notes. The agents' own notes are on `rebuild/r8-grok` and `rebuild/r8-codex`.

Merged: `rebuild/r8-claude` at `0501274` (19 commits; its one uncommitted change to `settings/sections.ts` was left out), plus a port of Codex's command builders (`rebuild/r8-codex` `1751713`, adapted to Claude's module split).

## Lines (tracked files under `rebuild/app`, excluding `/gen/`)

| | Before (`ada4ed4`) | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 14,516 | 14,413 | −103 |
| TypeScript, tests | 1,171 | 1,287 | +116 |
| CSS | 2,991 | 2,909 | −82 |
| Rust (tests inline/separate) | 3,202 | 3,064 | −138 |
| **Total** | **21,880** | **21,673** | **−207 (−0.9%)** |

The brief's 8–10% aim was not met by any of the three agents (Claude −54, Codex −100, Grok −8 on their own branches). The round's value is shape, not size: no file is over ~750 lines now (was 1,354).

Largest files after: `shell/pane.ts` 743, `workspace.ts` 734, `graph/view.ts` 727, `styles/settings.css` 681, `settings/sections.ts` 529, `src-tauri/src/watch.rs` 522, `src-tauri/src/index.rs` 522, `src-tauri/src/vault.rs` 507, `shell/sidebar.ts` 490, `appCommands.ts` 490, `noteEditors.ts` 470, `main.ts` 458.

## New modules (from Claude's branch)

- `workspace.ts` split: `tabs.ts` (tab shapes, history entries), `noteEditors.ts` (pane editors, docs, saves), `savedLayout.ts` (saved split tree), `fileOps.ts` (create/rename/move/delete/copy), `paths.ts` (path and name helpers).
- `graph/view.ts` split: `graph/draw.ts` (canvas painting), `graph/camera.ts` (zoom/pan maths, with tests), `graph/source.ts` (data loading). All round 7 WebKitGTK fixes kept (whole-pixel canvas, one-device-pixel HiDPI links, low-resolution draw while moving, every-other-frame settle, 400 ms typing yield, nine-slice panel shadow).
- `styles/app.css` split by area: `base`, `fileTree`, `menu`, `noteView`, `panes`, `prompt`, `sideViews`, `sidedock`, `tabs`.
- `src-tauri/src/index.rs` split: note parsing and tests in their own files.
- Shared helpers: `listeners.ts` (one listener list instead of six), `storage.ts` (localStorage read/write), `shell/sideView.ts` (sidebar view tree parts), one pointer-drag helper, one keyboard-button helper, shared fuzzy ranking for pickers.
- Removed: `editorConfig`, `isValid`, `closeSettings`, a debug `__graphRatio`, 14 unused Lucide icons, duplicate CSS bodies and unused tokens, duplicate Rust folder walks/readers.

No dependency added or removed. `CONTRACT.md` unchanged.

## Bug fixed

Renaming a note with "Automatically update internal links" rewrote links in closed notes on disk without refreshing the link index, so the renamed note showed no backlinks from them until another save (Claude, `20371c1`).

Bugs found and left for a later round: `is_note_path` in Rust can panic on file names ending in some multi-byte characters (Codex); `Index::adopt_children` does not skip `.grove` the way the full scan does (Grok).

## Checks and verification

- `npm run build`, `npm test` (108 tests, 25 files), `npm run audit:offline`, `cargo build`, `cargo test` (27) all pass.
- Headless Chromium, dark theme, 1024×800: editor with file tree, command palette, settings modal and settled graph view are pixel-identical to `ada4ed4` for the merge (and for each of the three branches).
- The command registry (128 commands: id, name, icon, plugin, hotkeys, availability with a note open) is identical to `ada4ed4` after the Codex port.
- Performance was not re-measured for the merge; the graph's performance code paths were checked to be unchanged. Codex and Grok measured no regressions on their branches with the same structure of split.
