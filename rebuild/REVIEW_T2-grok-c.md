# T2 review (Grok c)

Reviewed `6c5e060` on `rebuild/t2-review-grok-c` against the T2 row in `CINDER_GAP_PLAN.md`, `NOTES_T2-grok-a.md`, and the reviewed T1 at `6146d70`. The review covers the create command, `newNoteTemplate`, the inline title, the mock-vault browser check, and the required builds.

## Result and fixes

The implementation meets T2. *Templates: Create new note from template* picks a core template, creates `Untitled` in the new-note folder through `newNote`, fills `{{title}}`, `{{date}}`, `{{time}}`, and `{{date:FORMAT}}` / `{{time:FORMAT}}` through `mergeTemplate`, and selects the inline title. Name collisions become `Untitled 1`, `Untitled 2`, and so on. An unset template folder opens Settings → Templates and creates nothing. An empty folder opens the picker, and Enter there creates nothing. Templater `<% %>` is copied as written. There is one frontmatter block and one undo of the fill. No folder templates, weekly notes, or monthly notes were added.

Two small issues were fixed on this review branch:

- After a successful create, the inline title stays selected. The command palette and the template picker both restore that focus before the next create. The pane skipped refreshing a focused title, so the new note still showed the previous name. Focusing the editor then blurred the title, and the blur handler committed that stale draft onto the new file. A path change now writes the new note's name even while the title is focused, and clears a rename error from the previous note. `focusTitle` sets the text from the active path before it selects. `commitTitle` leaves identical text alone, so a commit that finishes after a newer selection does not wipe it. The blur handler keeps `is-renaming` when the title is focused again. The browser check creates a second Meeting note while `Untitled` is still selected and expects `Inbox/Untitled 1.md`, the filled body, the selection `Untitled 1`, and no rename error.
- The template was read after `newNote`, so a missing file left a blank `Untitled`. The text is read first. A failed read shows "Couldn't read that template." and returns. A failed `newNote` shows "Couldn't create a note from that template." An empty template file still creates an empty note. The success path is unchanged: create the empty note, apply one `input.template` transaction, `saveNow`, then select the title. One Ctrl+Z still clears the fill. The browser check deletes the selected template and expects the notice and no new note.

## Choices checked

- The note uses `newNote`'s default folder, which is Settings → Files and links: the configured folder, the current note's folder, or the vault root. The browser check covers all three. Ctrl+N still passes `""` and stays at the vault root.
- Filling goes through `newNoteTemplate`, which calls `fillTemplate` and then `mergeTemplate` on an empty note. An empty note is LF, so a CRLF template is stored as LF. A template BOM is dropped. Both are unit-tested. `<% %>` stays literal, in the unit test and in the browser.
- The fill is one undo step back to the empty document. The file is created empty and then patched, so undo returns to that empty document. Daily notes write the filled text as the initial file and are not undoable to empty. T2 was required to go through `mergeTemplate`, and that undo is what the browser check asserts. The success path was left as it is.
- `{{title}}` is the file name at creation. Renaming `Inbox/Untitled 2.md` to `Inbox/Board notes.md` leaves `# Untitled 2` in the body. The browser check saves both files and reads them back.
- There is no default hotkey and no ribbon button. Cinder uses Alt+N. Grove adds a default hotkey only where Obsidian has one, and core Templates has none for this command. The ribbon still has only *Insert template*. The command is on the core Templates plugin, so turning the plugin off hides it. The browser check confirms that.
- The command's `when` is unset, so it is available with no note open. `newNote` opens a tab when the current tab is a canvas or another file, replaces an empty tab, and switches a reading-mode tab to the editing mode. Those three starts are covered by that code and are not in the browser script.
- Template creates are serialized on their own queue, so two picks cannot both take `Untitled`. The queue is separate from Ctrl+N and from `newCanvas`.
- The browser harness is the existing headless mock vault. `create_note` throws when the path already exists. No GUI window and no real vault was opened.

## Left as findings

- Ctrl+N and a template create can both call `freeName` before either `refreshFiles` returns. The template queue does not include Ctrl+N, so those two can both choose `Untitled`. Sequential template creates are tested. Sharing one queue with Ctrl+N and canvas creation would touch those other commands, so it is left as a finding.
- The template list sorts with `(a.name < b.name ? -1 : 1)` and shows the basename only. Equal names never compare as equal, and two templates with the same name are not distinguished. This picker predates T2. Insert template uses it too. It is left as it was.
- The browser script does not start from an empty tab, Reading view, or a canvas. Properties-only and CRLF templates are unit-tested and are not repeated in the browser.

## Validation

- `npm run build`: passed (`tsc --noEmit` and `vite build`, 2138 modules). The existing chunk-size warning remains.
- `npm run audit:offline`: passed. 192 source files, distribution, CSP, capabilities, and dependencies checked.
- Focused Vitest: 29 passed (25 merge, 4 date format).
- `node scripts/test-template-create.mjs`: passed, including the second create from a selected title, the missing template, and the Templates date format `D MMM YYYY` with time `HH:mm`.
- `flock /tmp/grove-npm-test.lock npm test`: passed, exit 0, including posttest. Browser discovery 6 passed. All 81 Vitest files and 1,307 tests passed. `test-template-merge.mjs` and `test-template-create.mjs` passed inside the suite. No rerun was needed.
- `cargo test --offline` in `rebuild/app/src-tauri`: 84 passed, 4 ignored, no failures. No Rust changed in T2.
- `git diff --check`: passed.

All browser tests use the existing headless mock-vault harness. No packages, crates, network access, or Obsidian/Excalidraw code or assets were added. No push was performed.

## Performance

`node scripts/bench-frontend.mjs` (5,000-note synthetic vault, median of three samples). T2 and these review edits do not touch tag collection, search, or link refresh. Two runs overlapped other worktrees' browser suites. A third run was after this suite finished.

| | T1 review | T2 author | This review, quiet run |
|---|---|---|---|
| vault tags | 10.9 ms | 10.8–10.9 ms | 10.8 ms |
| search | 13.9 ms | 13.3–13.5 ms | 13.0 ms |
| search page 5k | 4.7 ms | 5.3–5.6 ms | 5.3 ms |
| link refresh | 45.1 ms | 41.1–41.2 ms | 41.6 ms |

The quiet-run samples were tags 17.1, 10.8, 9.6 ms; search 23.8, 12.6, 13.0 ms; page 5.3, 5.6, 4.4 ms; link refresh 54.8, 41.6, 39.8 ms. The first sample of each series is the cold one. The medians sit on the T1 review and inside or just faster than the original recorded range (11.1 / 13.2–15.6 / 5.2–5.3 / 41.3–47.2 ms). The loaded runs were 11.9 / 13.8 / 5.1 / 42.2 ms and 11.2 / 13.7 / 5.2 / 42.5 ms, the same shape with a higher cold sample. There is no regression.

Generated files under `rebuild/round*-shots/` were restored after the suite. Only the review fixes, the browser check, and these notes are in the local review commit. Existing untracked prompt files were left alone.

T2 meets the plan and the core-template scope after the two small fixes. The required checks passed, and the benchmark medians hold.

VERDICT: OK
