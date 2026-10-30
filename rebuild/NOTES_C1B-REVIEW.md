VERDICT: OK

Reviewed `rebuild/c1b-search-codex` at `3cd98aa` (implementation `673674b`, notes `3cd98aa`) against `rebuild/STEP4_SEARCH_PLAN.md` §3, §5, §7 and §8, `NOTES_C1B.md`, `NOTES_C1A.md` and `NOTES_C1A-REVIEW.md`. This branch is `rebuild/c1b-review-grok`. Codex's branch was not moved. Nothing was pushed. No product file was edited.

## What C1-B changed

`2f82a1f..3cd98aa`: 18 files, +549 / −283. The implementation, apart from `NOTES_C1B.md`, is 17 files, +492 / −283. `package.json` only appends `node scripts/test-search-commands.mjs` to `test`. No dependency, crate, or lockfile change.

The search view and the graph call `search_notes`, `search_lines` and `search_match`. `shell/searchFacts.ts` is deleted (−96). The mock goes through `searchVault`. D1 is flush-then-search. D2 keeps `{path, count}` objects. The C1-A shown-line correction is in this tree: a `file:` or `path:` leaf has no text term, and shown lines skip it.

## Checks from R1

One `search_notes` is in flight. `searchReader` (`searchRead.ts`) keeps a version, the newest request, and a `running` flag, and drains in a loop. A reply whose version changed during the flush or the command is dropped. `cancel` bumps the version and clears the queued request. The view has its own `seq` and ignores a stale `render`. `readOrdering.test.ts` covers the newest query only, flush-before-search, a dropped old reply, and cancel during flush.

The view flushes with `ws.editors.flush()` before `search_notes`. The graph flushes before `search_match`.

`pagedRows` (`sideView.ts`) can prepare a batch before drawing it. `before` returning false draws nothing. A "more" row that has left the list draws nothing. `busy` stops a second load of the same pager. A path omitted from `search_lines` still draws a file row, with the matches element removed (`searchView.ts`). The browser case deletes `C1B/A.MD` from the line reply and still expects that row, with the total taken from the note counts (1 + 2 = 3).

Copy builds its text when the menu opens. The item starts `disabled: true`, and `selectable` ignores a disabled row, so a click before the fetch returns does not write. `Menu.refresh` updates `is-disabled` and `aria-disabled` on the open menu. `activate` calls `closeMenu()` and then `item.action()` in the click task. That action is `writeClipboard(text)`. The browser case records `navigator.userActivation.isActive` on the write. The first new colour group uses `GROUP_COLORS[0]`, which is `0xe05252`, so the painted-colour assertion matches the panel.

`.MD` stays in the sorted list. `searchResults` keeps a non-directory vault file, including `a.MD`, drops excluded and missing paths, and sorts with `compareFiles`. Rust `is_note_path` compares the extension without regard to case. The browser graph filter expects the `.MD` note among the two `c1bfilter` nodes.

A file named `.md` or `.MD` is already absent from Rust search. `is_note_path` (`index.rs`) requires the basename to be longer than three characters and to end in `.md` in any case. The search view does not add files the command omitted. TypeScript `isNoteFile` on this branch is still `path.toLowerCase().endsWith(".md")`, and the mock's new `searchFiles` / `searchNotes` / `searchLines` filters use `/\.md$/i`, so the graph file list and the mock still treat a nameless `.md` as a note. F1 (`1ce52d2` on `rebuild/f1-fuzz-grok`) is the change that aligns the TypeScript predicate. It merges first. This review does not edit `paths.ts`.

Excluded paths are dropped in `searchResults`. The graph passes `ws.vault.isExcluded` through `graphFileLists`.

File-only and path-only graph queries stay in TypeScript. `termsOf` / `textOf` return nothing for `file:` and `path:`, so `needsBackend` is false unless the query also has a text term, a tag, or a property. `facts` returns null when there is no backend query and tags are off, and those queries are never sent. Text queries are deduplicated and sent as one `search_match`. The last answer is reused until `forget()`. `showTags` reads `vaultTags` and does not send another match. A failed match promise clears the cache only while it is still the stored entry. Vault `files` and `links` changes call `forget()` and `scheduleRebuild()` (`REFRESH_DELAY` is 200 ms; the filter fields keep the panel's 250 ms debounce, which this commit does not touch). A `doc` change calls `forget()` and leaves the current picture until a later rebuild, which flushes before it reads the cache. `rebuild` drops a stale reply after the await.

`search_notes`, `search_lines` and `search_match` are in `api.ts`, the mock, `build.rs`, `lib.rs`'s handler, `capabilities/default.json` (`allow-search-notes`, `allow-search-lines`, `allow-search-match`), the generated permission toml files, and `CONTRACT.md`. `cargo test` includes `every_command_is_in_build_manifest_and_default_capability`, and it passed.

`searchFacts.ts` and `matchingNotes` are gone from the app. `scripts/bench-frontend.mjs` still imports both. This review was told to leave that file for its owner. The script is the open follow-up.

`scripts/test-search-commands.mjs` is a real driver. It fills the graph filter with `c1bfilter`, expects two nodes, adds a `c1bcolor` group, waits for one batched `searchMatch` of `['c1bfilter','c1bcolor']` and a `#e05252` fill, checks that toggling Tags does not call `searchMatch` again, then covers counts, the omitted `.MD` line reply, lazy context, the copy gesture, and `path:C1B` rows with no excerpts. Those ten checks passed in the full browser run.

## F1 merge

Do not merge F1 on this branch. `git merge-tree --write-tree` was only a dry run. The real merge base of `rebuild/f1-fuzz-grok` (`1ce52d2`) and this tip is `bcb430d`, and `2f82a1f` is not an ancestor of F1.

Merging F1 into integration `2f82a1f` already conflicts, before C1-B's two commits:

- `rebuild/app/src/paths.ts`
- `rebuild/app/src/paths.test.ts`
- `rebuild/app/src/graph/source.ts`
- `rebuild/app/src/graph/data.ts`
- `rebuild/app/src/bases/view.ts`

`searchVault.ts` and `mock/backend.ts` merge cleanly at that step. Merging C1-B onto that result then conflicts in `searchVault.ts` and `mock/backend.ts`. `graph/source.ts` conflicts in the second merge only if the first resolution kept F1's inlined file loop.

What makes that risky, and the resolution that keeps both sides:

- `paths.ts` / `paths.test.ts`: take F1. `isNoteFile` must be basename length greater than 3 and a case-insensitive `.md` suffix. C1-B does not edit these files, so a later C1-B merge leaves F1's version in place.
- `graph/data.ts`: import both `isNoteFile` and `noteName`. Integration added `graphFileLists` (it calls `isNoteFile`). F1 set `nameOf` to `noteName`. Either import alone fails to compile.
- `graph/source.ts`: keep `graphFileLists`. F1's only change there is the same note test, which the helper already performs. Then keep all of C1-B's `facts` / `searchMatch` body. Dropping that body puts the graph back on the deleted `searchFacts` path.
- `bases/view.ts`: keep integration's `baseNoteFiles(...)`. It calls `isNoteFile`, so F1's predicate applies once `paths.ts` is F1's.
- `searchVault.ts`: keep C1-B's `createSearchVault` cache, and filter notes with `isNoteFile(path)`. Leave `const NOTE = /\.md$/i` out. Taking C1-B's regex makes the reference count a file named `.md` as a note again.
- `mock/backend.ts`: import both `isNoteFile` and `createSearchVault`. On the tags line, keep `isNoteFile(path)`. The new `searchFiles`, `searchNotes` and `searchLines` functions use `/\.md$/i` and do not conflict, so they auto-merge. Point those three filters at `isNoteFile` as well:

```ts
let text = isNoteFile(path) && !isBinary(file.content) ? file.content : "";
return Object.keys(matches ?? {}).filter(path => isNoteFile(path)).sort(pathOrder)
const matches = matchVault(source, query, matchCase, paths.filter(path => isNoteFile(path)));
```

`search_notes` still omits a nameless `.md` if `searchVault` uses `isNoteFile`, because the reference never returns that path. The regex change keeps the mock's own filter saying the same thing as Rust.

## Tests

From `rebuild/app`: `npm run build` passed (`tsc --noEmit` and Vite). `npm run audit:offline` passed: 166 source files, dist, CSP, capabilities and dependencies. The existing chunk-size warning is still printed.

From `rebuild/app/src-tauri`, offline: `cargo build` finished the dev profile in 7.01s. `cargo test` passed, 58 tests, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`).

`flock /tmp/grove-npm-test.lock npm test` exited 0. Vitest: 58 files, 674 tests, 788 ms. The full browser chain and the Bases posttest passed, including the ten search/graph lines above. No stage failed and none was rerun. The command spent part of its 1309 s waiting on the shared lock. Screenshot fixtures under `rebuild/round*-shots/` were restored and are not in this commit.

I did not rerun the 5,000-note page bench. This review does not change the Rust evaluator. `NOTES_C1B.md` still records the Node page-work median of 6.528 ms on the 292,520-byte, 5,000-note payload.

## Left open

`scripts/bench-frontend.mjs` still calls `searchFacts` and `matchingNotes`. Gemini owns that update. No decision is waiting on Chris beyond the F1 resolution above.
