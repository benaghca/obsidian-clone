# S7: Cheap wins for the new-note / rename hitch (sidebar tree only)

From Fable 5.2's 10 Nov 2026 read-only review of Grove. This is the **sidebar half of finding 8**. Chris approved starting this work provided nothing visible changes. Build on `rebuild/s7-grok` from the brief commit on `rebuild/integration`. Grok 4.7 builds; Codex will review later, read-only. Commit locally. Never push.

The rest of finding 8 (patching the file list from the returned entry in `fileOps.ts` / `workspace.ts`, and the `main.ts` cache drop) is out of scope: S1 is already editing `fileOps.ts`, `workspace.ts`, and `main.ts`. The Rust help in finding 5 is S4's job.

## In plain words

Creating or renaming a note hitches for a few tens of milliseconds because the file explorer rebuilds its whole visible tree on every file-list change, and `buildTree` first sorts every file by path depth with `split("/")` inside the comparator. That depth sort is not needed: you can attach children through a folder map in a second pass. Speed the tree up. The explorer should look and behave exactly as it does today: same order, same folds, same selection and cursor, same expand/collapse.

## Problem (paths relative to `rebuild/app/`)

Fable finding 8, sidebar parts:

- `src/shell/sidebar.ts:131`: `buildTree` sorts by depth with `split("/")` inside the comparator. That sort is not needed; attach children through the folder map in a second pass.
- `src/shell/sidebar.ts:438-466`: each file-list change rebuilds every visible tree row (`render()` clears `rows` / `placed` and `replaceChildren`s the whole list).

Fable's estimate was 4–6 h for perhaps half the hitch when combined with the file-list patch and the Rust work. This piece only takes the sidebar share. Tree virtualisation stays with the later P6 work.

## Goal

**No visible behavior change.** Layout, shortcuts, look, theme, sort orders, folder-first ordering, fold state, keyboard cursor, and selection stay the same.

- Drop the depth sort in `buildTree`. Build the tree by attaching each entry to its parent folder map (parents can be recorded as you go, or in a first pass), then sort each children list with the existing name/date comparators.
- If there is a small, safe way to avoid throwing away every row on a file-list change (reuse unchanged row elements, or only rebuild what changed) without changing behavior, take it. If incremental reuse is not clearly smaller and safer than a full rebuild, skip it and just fix `buildTree`. Do not start tree virtualisation (P6).

## File ownership (do not fight the other builders)

- You own `src/shell/sidebar.ts` and tests that cover `buildTree` / explorer render (you may add `src/shell/sidebarTree.test.ts` or extend an existing shell test). There is already `treeSelect.test.ts` / `treeDrag.test.ts`.
- Do **not** edit `src/fileOps.ts`, `src/workspace.ts`, `src/main.ts`, `src/noteEditors.ts`, or other S1 files.
- Do **not** edit `src/vault.ts` (S9), `src/links/internal.ts` (S6), or CI / E2E files (S8).
- Do **not** edit `src-tauri/` (S3, S4, S5).

## Tests

Add regression tests that **fail before this change and pass after** (check this). Use vitest. No GUI windows.

Cover at least:

- `buildTree` produces the same tree shape and sort order as today for nested folders, root files, `alphabetical` and `alphabeticalReverse`, and a case where a file appears in the list before its parent folder (the depth sort used to paper over that). This is the important behavioral test.
- If you count work (path splits, or row DOM nodes recreated), a large file list does less of that work than the depth-sort / full-rebuild path did, without changing the tree.

Do not weaken any existing assertion, including tree selection and drag tests. A focused vitest file that runs as part of `vitest run` is enough.

## Hard rules

- Work only under `rebuild/app/` TypeScript, scripts, tests, plus this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green if you touch anything it covers.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser. Headless Chromium only, if you need the existing feel harness at all.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline` must pass.
- Restore any screenshots the suite rewrites before committing.
- Commit locally on `rebuild/s7-grok`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that drops the depth sort and, optionally, avoids a wasteful full row rebuild. Do not virtualise the tree.
- Delete code your changes make dead.
- Keep every file under ~800 lines. `sidebar.ts` is already large (~731 lines); split only if a change would push it over, and prefer extracting `buildTree` over a wider rewrite.
- No new dependency.

## Scope limits

**In scope:** `buildTree` construction/sort, a small safe render reuse if it is clearly worth it, tests and notes.

**Out of scope:** patching the file list in `fileOps.ts` / `workspace.ts`; `main.ts` cache invalidation; P6 virtualisation; Rust index work (S4); vault.ts maps and event coalescing (S9); path-style link scans (S6); CI / E2E (S8); visible behavior changes; the unmerged T1 tabs work; opening the real app.

## Done when

- The tree matches today's shape and order, without the depth sort, with tests that failed before and pass after.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S7-grok.md` before you finish, and commit it with the code. Include:

- In plain words: what is faster in the explorer, and confirmation that nothing visible changed.
- How you proved each test failed before and passed after, and whether you attempted incremental row reuse.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
