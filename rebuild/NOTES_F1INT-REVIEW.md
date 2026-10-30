VERDICT: OK

Reviewed `rebuild/f1-fuzz-grok` at `0372988` (merge `360665b`, notes `0372988`) against integration `2f82a1f`. This branch is `rebuild/f1-review-grok`. Grok b's branch was not moved. Nothing was pushed. No product file was edited.

## What the catch-up changed

`2f82a1f` is an ancestor of this tip. `360665b` merges integration into F1 (`1ce52d2`). The net diff `2f82a1f..0372988` is 16 files, +284 / −38. Every hunk is the nameless-file rule or its notes and corpus. Nothing else from integration is missing: files the merge brought in (`link_sources`, the bench, Step 5, the contract, the review notes) match `2f82a1f` and do not appear in that diff.

`graph/source.ts` and `bases/view.ts` are identical to integration. They still call `graphFileLists` and `baseNoteFiles`. Both helpers filter with `isNoteFile`.

## Conflict resolutions

- `paths.ts`. One `isNoteFile`: the basename is longer than 3 characters and the last three characters are `.md` in any case. That is Rust `is_note_path` (`index.rs`, `base.len() > 3` and an ASCII-case `.md` suffix). `noteName` strips those three characters only when `isNoteFile` says the path is a note, so `.MD` stays `.MD` and `Upper.MD` becomes `Upper`.
- `paths.test.ts`. Integration's any-case checks stay (`Upper.MD`, `a.Md`, `Board.canvas`, `readme.markdown`). The new test says `.md`, `.MD`, and `Folder/.md` are not notes. `noteName(".MD")` is `.MD`.
- `graph/source.ts`. Integration's `graphFileLists` stayed. F1's inlined loop is gone. The helper calls `isNoteFile`, so a nameless file is an attachment.
- `graph/data.ts`. `graphFileLists` stays, and the import is both `isNoteFile` and `noteName`. Node labels use `noteName`, so a file named `.MD` is not labelled with an empty string.
- `bases/view.ts`. Integration's `baseNoteFiles` stayed. The inline filter is gone.

`Upper.MD` remains a note in `isNoteFile`, `searchVault`, the mock (`linkSources`, properties, frontmatter, tags), the graph, bases, canvas file cards, live preview, and hover preview. A file named `.md` or `.MD` is not a note on those paths. Rust already excluded it.

The mock's `linkSources` needles, scan, and return all use `isNoteFile`, matching Rust `link_sources`, which uses `is_note_path`. The old `NOTE = /\.md$/i` in `searchVault.ts` is gone. The `/\.md$/i` checks that remain decide whether a link target already has an extension, or skip a markdown-shaped name that `isNoteFile` rejects. They are still used.

## The three dot-name cases

`search.json` vault `dot-name` is `.MD` (`secretprobe`) and `Real.md` (`secretprobe also`). None of the three cases has `"rust": "todo"`.

- `secretprobe`: only `Real.md`, count 1, line 1.
- `file:md`: `.MD` is `{}`, and `Real.md` is a note with `lines: []`.
- `file:MD` with match case: only `.MD`, as `{}`.

`parity.test.ts` runs all 343 corpus cases, and `index::parity::corpus` runs the same file. Both passed, so the two sides agree on these three.

## Later C1-B merge

`NOTES_C1B-REVIEW.md` on `rebuild/c1b-review-grok` asked this merge to keep `graphFileLists`, `baseNoteFiles`, and F1's `isNoteFile`, and to import both names in `graph/data.ts`. This tip did that.

A dry `git merge-tree` of `rebuild/c1b-review-grok` onto this tip (merge base `2f82a1f`) conflicts only in `searchVault.ts` and `mock/backend.ts`. `paths.ts`, `paths.test.ts`, `graph/source.ts`, `graph/data.ts`, and `bases/view.ts` merge clean, including C1-B's `searchMatch` rewrite of `graph/source.ts`. That is easier than merging C1-B against the pre-catch-up F1 tip.

The two remaining conflicts are the ones that review already described. Keep C1-B's `createSearchVault` cache, and keep this tip's `isNoteFile(path)` note list. Do not bring back `const NOTE = /\.md$/i`. In the mock, import both `isNoteFile` and `createSearchVault`, and keep `isNoteFile` on the tags line. C1-B's new `searchFiles`, `searchNotes`, and `searchLines` use `/\.md$/i` and auto-merge; point those three filters at `isNoteFile` as well:

```ts
let text = isNoteFile(path) && !isBinary(file.content) ? file.content : "";
return Object.keys(matches ?? {}).filter(path => isNoteFile(path)).sort(pathOrder)
const matches = matchVault(source, query, matchCase, paths.filter(path => isNoteFile(path)));
```

## Tests

From `rebuild/app`: `npm run build` passed (`tsc --noEmit` and Vite). `npm run audit:offline` passed: 166 source files, dist, CSP, capabilities, and dependencies. The existing chunk-size warning is still printed.

From `rebuild/app/src-tauri`, offline: `cargo build` finished the dev profile in 0.24s. `cargo test` passed, 58 tests, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`).

`flock /tmp/grove-npm-test.lock npm test` exited 0. Vitest: 58 files, 673 tests, 824 ms, including `parity.test.ts` (343). The browser chain passed on the first run. The 300-card drag check was max 16.8 ms. The 1000-row Bases scroll was max 16.8 ms. `posttest` passed. No stage was rerun. Screenshot fixtures under `rebuild/round*-shots/` were restored and are not in this commit.

## Left open

The C1-B merge above is still to do. No decision is waiting on Chris.
