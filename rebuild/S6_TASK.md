# S6: Stop broken path-style links from scanning the whole vault (TypeScript)

From Fable 5.2's 10 Nov 2026 read-only review of Grove. This is the **TypeScript half of finding 10**. Chris approved starting this work provided nothing visible changes. Build on `rebuild/s6-grok` from the brief commit on `rebuild/integration`. Grok 4.7 builds; Codex will review later, read-only. Commit locally. Never push.

Finding 3A (stamp-check conflict detection) was not used for this wave: it lives in `vault.rs` / `watch.rs`, which S3, S4, and S5 already touch.

## In plain words

When a wiki or markdown link looks like a path (`[[folder/note]]` or `[text](dir/file.md)`) and that path does not resolve directly, Grove walks every note in the vault, lower-casing each path, to see if something ends with that path. That lookup can run for every such link on every decoration rebuild, so a note with many broken path-style links gets slower as the vault grows. Build a map (or memo) once per file-list snapshot instead of scanning every time. Resolved links and missing-link styling must stay the same.

## Problem (paths relative to `rebuild/app/`)

Fable finding 10, TypeScript side:

- `src/links/internal.ts:153-155`: a link with a `/` that doesn't resolve falls back to `notes.find`, lower-casing every path.
- `src/editor/livePreview.ts:179`: that runs per drawn link on every decoration rebuild (`:543-557`), through `Vault.linkExists` (`src/vault.ts:98-101`).
- The Rust resolver in `src-tauri/src/index.rs:394-409` has the same fallback. **Do not change Rust.** That half is out of scope so this branch does not fight S4.

Fable's suggested fix: memoise results per file-list snapshot, or build a suffix map once.

## Goal

**No visible behavior change.** Layout, shortcuts, look, theme, and which links resolve (or show as missing) stay the same, including case-insensitive matches, relative `./` and `../` targets, and "first in the snapshot wins" for partial paths.

- Make the partial-path fallback cheap: a structure built once per notes/files snapshot, or an equivalent memo keyed to that snapshot, so each lookup is not a full vault scan.
- Keep using that fast path from `resolveLink` / `linkResolver` / `linkTargets` so live preview and `Vault.linkExists` benefit without rewriting those callers, unless a tiny hook in `linkTargets` is needed.

## File ownership (do not fight the other builders)

- You own `src/links/internal.ts` and, if a tiny caller change is required, `src/links/internal.test.ts`. You may touch `src/editor/livePreview.ts` only if the memo must be wired there; prefer keeping the fix inside `internal.ts` so `linkTargets` / `resolveLink` stay the single entry points.
- Do **not** edit `src/vault.ts` (S9 owns event coalescing and the path-to-entry map there).
- Do **not** edit `src/noteEditors.ts`, `src/fileOps.ts`, `src/main.ts`, `src/workspace.ts`, canvas/drawing/settings, or capabilities (S1).
- Do **not** edit `src/shell/sidebar.ts` (S7) or CI / E2E harness files (S8).
- Do **not** edit `src-tauri/` at all (S3, S4, S5).

## Tests

Add or extend vitest coverage (there is already `src/links/internal.test.ts`) so the new tests **fail before this change and pass after** (check this). Cover at least:

- Partial-path and broken path-style links still resolve the same way as today (including case, `.md` vs bare, and first-in-snapshot wins).
- A large snapshot (thousands of notes, or a counted scan hook) shows the fallback does not walk every note on every lookup after the structure is built. A test hook, a counter on the scan, or an assertion that a suffix map/memo is reused is fine.
- `linkTargets` / `linkExists`-style checks still distinguish existing vs missing path-style targets.

Do not weaken any existing assertion. A focused vitest file that runs as part of `vitest run` is enough; only add a separate `npm test` script if it is fast and stable.

## Hard rules

- Work only under `rebuild/app/` TypeScript, scripts, tests, plus this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green if you touch anything it covers.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser. Headless Chromium only, if you need the existing feel harness at all.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline` must pass.
- Restore any screenshots the suite rewrites before committing.
- Commit locally on `rebuild/s6-grok`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that removes the per-lookup full scan. Reuse `indexNotes` / `linkTargets` if they already build per-snapshot sets.
- Delete code your changes make dead.
- Keep every file under ~800 lines. Split only if a change would push one over.
- No new dependency.

## Scope limits

**In scope:** TypeScript partial-path / path-style link lookup cost, tests and notes.

**Out of scope:** the Rust resolver in `index.rs`; stamp-check conflict detection (finding 3A); sidebar hitch (S7); vault event coalescing and file-list maps (S9); CI / real-app E2E (S8); save/retry work (S1); visible behavior changes; the unmerged T1 tabs work; opening the real app.

## Done when

- Path-style link lookups no longer scan the whole vault each time, with tests that failed before and pass after, and the same resolve results as today.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S6-grok.md` before you finish, and commit it with the code. Include:

- In plain words: what is faster, and confirmation that nothing visible changed (same resolve results).
- How you proved each test failed before and passed after, and how you showed the scan is no longer per-lookup.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
