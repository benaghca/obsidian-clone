# MDC: upper-case .MD notes

On `rebuild/md-cleanup-grok`, branched from `rebuild/integration` `2bb6aeb`, 2026-10-29. Local commit only. Nothing pushed.

`.MD` files already count as notes in the vault list (`toLowerCase().endsWith(".md")`) and in Rust `is_note_path`. Several screens still tested only a lower-case `.md`.

## What changed

`7b21afd`. 16 files, +84 / −30.

`paths.ts` exports `isNoteFile`: the same check the vault list used. The vault list calls it. So does:

- Bases rows (`baseNoteFiles` in `bases/model.ts`, used by `bases/view.ts`)
- The graph's note versus attachment split (`graphFileLists` in `graph/data.ts`, used by `graph/source.ts`)
- The file menu (`shell/menus.ts`): open, copy, merge, rename
- The explorer's extension tag (`shell/sidebar.ts`): a `.MD` file does not show an extension badge
- Unlinked mentions (`shell/backlinksView.ts`)
- The open note's unsaved tags (`shell/tagsView.ts`)
- A drop into a note (`shell/treeSelect.ts`): `Upper.MD` is a wikilink, not an embed. This check was already any-case; it now uses `isNoteFile`.

Settings path suggestions (`settings/sections.ts`) strip the extension with `noteName`, so `Folder/Upper.MD` is offered as `Folder/Upper`.

## Tests

- `paths.test.ts`: `isNoteFile` accepts `Note.md`, `Upper.MD`, and `a.Md`, and rejects `photo.png`, `Board.canvas`, and `readme.markdown`. `noteName("Folder/Upper.MD")` is `Upper`.
- `bases/model.test.ts`: `baseNoteFiles` keeps `Upper.MD` and drops `pic.png`, a folder, and an excluded note. The Base row's `file.name` is `Upper`.
- `graph/graph.test.ts`: `graphFileLists` puts `Upper.MD` with the notes. `buildGraph` draws it as a note labelled `Upper`, and `pic.png` as an attachment.
- `treeSelect.test.ts`: dropping `Upper.MD` writes `[[Upper]]`.

## Full checks

From `rebuild/app`:

- `npm run build`: passed.
- `npm test` under `flock /tmp/grove-npm-test.lock`: exit 0. Browser discovery 4 passed. Vitest 58 files, 535 tests passed. `300-card drag frames under 20ms (max 16.8ms, 48 intervals)` passed on the first run. Posttest passed (`Configure view: frame 1, max 16.7ms`).
- `npm run audit:offline`: passed, 165 source files.

From `rebuild/app/src-tauri`, `cargo build --offline` and `cargo test --offline`: both passed. `grove_lib` 47 passed, 1 ignored (`index::bench::bench_vault`), the binary 0, doc-tests 0. The registry was not contacted. No Rust files changed.

Screenshot fixtures were restored with `git checkout` and are not in the commit.

## Left alone

These still treat only a lower-case `.md` as a note, and this task was not to edit them:

- `src/mock/backend.ts` lines 347 and 356: search lines and note content use `path.endsWith(".md")`. A `.MD` file's text is skipped in the browser mock. The tag scan just above (line 337) already uses `/\.md$/i`.
- `src/fileOps.ts`: `renameError` and `renameFile` save a non-canvas, non-base file as `.md`, so renaming `Upper.MD` writes `Name.md`. `copyNote` does the same unless the path ends in `.canvas`, so a copy of `Upper.MD` is `….md`.

Two test doubles only label lower-case fixture names: `searchQuery.test.ts` `names` and `propertyIndex.test.ts` `includedNotes`. They are not product checks.

These already accept `.md` in any case and were left as they are: `editorHost.ts`, `hoverPreview.ts`, the canvas file checks, `livePreview.ts`, `links/internal.ts`, the graph's `nameOf`, and `workspace.ts`.
