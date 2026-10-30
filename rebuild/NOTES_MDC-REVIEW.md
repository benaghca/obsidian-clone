VERDICT: OK

Reviewed `rebuild/md-cleanup-grok` at `859beed` (code `7b21afd`, notes `859beed`) against integration `2bb6aeb`. Did not edit that branch, did not check it out in this worktree, did not commit, and did not push. This worktree is still `rebuild/s5-linksources-grok` at `6686339`.

No required fix.

Diff `2bb6aeb..7b21afd`: 16 files, +84 / −30. With `NOTES_MDC.md`: 17 files, +135 / −30. No changes to `package.json`, `package-lock.json`, `Cargo.toml`, or `Cargo.lock`. No new crates or npm packages. No Rust files changed.

## Claude's list

Each lower-case `.md` check Claude listed in `NOTES_S3-REVIEW.md` section 5 now uses `isNoteFile` (`path.toLowerCase().endsWith(".md")`) or the same rule through `noteName`.

- Bases rows (`bases/view.ts`) go through `baseNoteFiles` (`bases/model.ts`). A row must be a file, `isNoteFile`, and not excluded. `file.name` is `noteName`, so `Upper.MD` is `Upper`. `file.ext` stays the existing literal `"md"`.
- The graph (`graph/source.ts`) uses `graphFileLists` (`graph/data.ts`). Directories and excluded paths are skipped. `.MD` paths go to notes. Everything else, including `pic.png`, stays an attachment. `nameOf` was already `/\.md$/i`, so the label is `Upper`.
- The file menu (`shell/menus.ts`) uses `isNoteFile` for the note check.
- The explorer extension badge (`shell/sidebar.ts`) is hidden for notes, including `.MD`.
- Unlinked mentions (`shell/backlinksView.ts`) skip a hit unless `isNoteFile`.
- The open note's unsaved tags (`shell/tagsView.ts`) are included when the open path is `isNoteFile`.
- Settings path suggestions (`settings/sections.ts`) rebuild `parentDir + "/" + noteName` from `vault.notes`. `vault.notes` is already only notes, so `Folder/Upper.MD` is offered as `Folder/Upper`.

`vault.ts` now calls `isNoteFile` for the note list. That list already used the same any-case check. `treeSelect.ts` now calls `isNoteFile` for a drop. That check was already any-case, so `Upper.MD` is still a wikilink and `photo.png` is still an embed. Both swaps stay inside this cleanup.

Non-notes stay non-notes. `isNoteFile` is false for `photo.png`, `Board.canvas`, `readme.markdown` (it does not end in `.md`), and a folder. Excluded notes stay out of Bases and the graph. `.base` does not end in `.md`, so it stays off the note list.

## Tests

The new cases are real assertions:

- `paths.test.ts`: `Note.md`, `Upper.MD`, and `a.Md` are notes. `photo.png`, `Board.canvas`, and `readme.markdown` are not. `noteName("Folder/Upper.MD")` is `Upper`.
- `bases/model.test.ts`: `baseNoteFiles` keeps `Upper.MD` and `Note.md`, and drops `pic.png`, a folder, and excluded `Hidden.md`. The selected `file.name` values are `Note` and `Upper`.
- `graph/graph.test.ts`: `graphFileLists` puts `Upper.MD` with the notes and `pic.png` with the attachments, and drops a folder and an excluded note. `buildGraph` draws `Upper.MD` as kind `note`, label `Upper`.
- `treeSelect.test.ts`: dropping `Upper.MD` writes `[[Upper]]`. Dropping `photo.png` still writes an embed.

Menus, the sidebar badge, unlinked mentions, the tags view, and the settings path list are one-line swaps onto `isNoteFile` or `noteName`. Those helpers are what the tests cover.

## Left as they are

These are fine to leave.

`mock/backend.ts` still has two lower-case checks, and they are not the ones `NOTES_MDC.md` describes. Line 347 is `frontmatter`. Line 356 is `tags`. Both use `path.endsWith(".md")`. Line 337 is `properties`, and it already uses `/\.md$/i`. `search()` does not filter on `.md`. It searches every non-binary file. The real app reads tags and properties through Rust `is_note_path`, which already accepts `.MD`. In the browser mock, saved tags of a closed `.MD` note are missing, and its properties are present. Unsaved tags of the open note are overlaid in `tagsView.ts` through `isNoteFile`. That mock gap is the browser stand-in only.

`fileOps.ts` was not edited. `renameError` and `renameFile` keep a `.canvas` or `.base` extension in any case, and otherwise use `.md`. If the stem is unchanged, rename returns before writing, so `Upper.MD` stays `Upper.MD`. Changing the stem writes `Name.md`. `copyNote` keeps a `.canvas` ending and otherwise uses `.md`. `Upper.MD` sliced by three characters is `Upper`, then `.md` is appended, so the copy is `Upper.md`. `moveFile` keeps `fileName`, so a move keeps `.MD`. New notes are already created as `.md`. This is the existing extension rule, and it does not decide whether a `.MD` file is a note.

Two test doubles still strip only a lower-case `.md` from fixture names: `searchQuery.test.ts` `names` and `propertyIndex.test.ts` `includedNotes`. They are not product checks.

A file whose whole name is `.md` is a note in TypeScript (`endsWith`) and is not a note in Rust (`len > 3`). That difference was already there. This branch does not change it.

## Merge

In a throwaway clone, detached at current `rebuild/integration` `9da930c`:

- `cacf8d0` (`rebuild/k1-search-grok`) is already an ancestor. Merging it reported "Already up to date."
- `6686339` (`rebuild/s5-linksources-grok`) merged clean.
- `859beed` merged clean on top of that.

No overlapping paths between this branch and K1, S5, or integration since `2bb6aeb`.

## Checks run here

On a throwaway checkout of `859beed` under `/tmp`, not in this worktree. First run for each. No timing flake.

From `rebuild/app`:

- `npm run build`: passed.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Browser discovery 4 passed. Vitest 58 files, 535 tests passed. `300-card drag frames under 20ms (max 16.8ms, 49 intervals)` passed. Posttest passed (`Configure view: frame 1, max 16.8ms`).
- `npm run audit:offline`: passed, 165 source files.

From `rebuild/app/src-tauri`, both `--offline`:

- `cargo test`: `grove_lib` 47 passed, 1 ignored (`index::bench::bench_vault`). The binary and doc-tests ran 0 tests.
- `cargo build`: finished the dev profile.
