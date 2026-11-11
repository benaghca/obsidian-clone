# L1: Lag fixes for broken path links and search replies

From Fable 5.2's 10 Nov 2026 read-only review of Grove (the relevant parts are quoted below). This is **finding 10** (both sides) and the **page half of finding 9**. Chris approved this work provided nothing visible changes. Build on `rebuild/l1-grok` from `rebuild/integration` (T1 tabs and S4 are merged there). Grok 4.7 builds; Codex reviews later, read-only. Commit locally. Never push.

## In plain words

Two things make Grove lag on big vaults. A note with links like `[[folder/note]]` that don't resolve makes Grove scan every file in the vault for each such link, on every keystroke and after every save. And each search reply rebuilds and re-sorts a map of every file, which costs ~31 ms at 20k notes and ~92 ms at 50k. Make both cheap. Nothing the user sees may change: same links resolved the same way, same search results in the same order, same look and timing of when results appear (no debounce; that would be visible).

## Fable's findings

10. Broken path-style links scan the whole vault
- `src/links/internal.ts:153-155`: a link with a / that doesn't resolve falls back to `notes.find`, lower-casing every path.
- `src/editor/livePreview.ts:179`: that runs per drawn link on every decoration rebuild (`:543-557`), through `Vault.linkExists` (`src/vault.ts:98-101`).
- `src-tauri/src/index.rs:394-409`: the Rust resolver has the same fallback, used by link_index and backlinks for every such link.
- Fix: memoise results per file-list snapshot, or build a suffix map once.

9 (page part only). Search typing at 20k
- `src/shell/searchRead.ts:9-13`: each reply builds a Map of every file, copies each entry, and sorts with Intl.Collator.
- Fix, page: cache the file map and a sort rank per file list so the sort compares integers, and build only the first page of rows (if more rows are shown later, they must appear exactly as today).

(Line numbers may have shifted slightly.)

## File ownership (other builders are working in parallel)

- You own `src/links/internal.ts`, `src/editor/livePreview.ts` (link checks only), `src/shell/searchRead.ts`, `src/shell/searchView.ts` (no debounce, no visible change), and the resolver fallback in `src-tauri/src/index.rs`.
- `src/vault.ts`: only if `linkExists` truly needs it, and keep the edit tiny (S1 is changing save code nearby).
- Do **not** touch `src/fileOps.ts`, `src/main.ts`, `src/workspace.ts`, `src/noteEditors.ts`, save/close code (S1); `src-tauri/src/lib.rs`, `watch.rs`, the Rust search scan or its lock (S5); `read_note`/`write_note` in `vault.rs` (S3).

## Tests

Add regressions that fail before and pass after (check this): broken path links do not scan the whole file list per link (count or bound the work), resolution results match today's for resolved, broken, case-different, and suffix-matched links; the search reply path does not rebuild the per-file map or call the collator per reply for an unchanged file list, and results/order match today's. Keep everything passing: `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` (restore any screenshots the suite rewrites before committing), `npm run audit:offline`, and `cargo test --offline` in `rebuild/app/src-tauri`. Do not weaken any assertion.

## Hard rules

- Work only under `rebuild/app/` and this brief's notes. Cinder at the repo root is reference only.
- No new crates or npm packages. No Obsidian or Excalidraw code, assets, or fetched pages. No network.
- No app or GUI windows. Test/bench vaults only under `/tmp`. Never touch `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`, `/tmp/grove-playground`, or `~/grove-compare-vault`.
- Commit locally on `rebuild/l1-grok`. Never push or force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.
- Smallest change that works; delete code it makes dead; keep files under ~800 lines.

## Done when

Both lag sources are gone with tests that failed before and pass after, behavior and look are unchanged, all suites pass, and `rebuild/NOTES_L1-grok.md` is committed with: what got faster in plain words, before/after numbers (at 5k/20k if you can measure), how each test failed before, and net line changes by file.
