# Round 19 stage 3 fixes

Worktree: `grove-r19-codex`, branch `rebuild/r19-codex`. Baseline: `fef3fd7` (the hunter report and failing tests). All commits are local; no push or merge. Tests used headless Chromium, private profiles, loopback Vite servers and the in-memory mock vault. No real display or owner vault was used.

## Part 1 — committed first

`73a53fc` applies the supplied geometry patch: direct heading lines in Reading view use 16px top padding instead of margin; the direct Properties widget uses 40px bottom padding instead of its 32px margin plus 8px padding. Embedded content keeps its existing spacing. No editor input handler was changed for geometry.

Prompt and menu opening/closing animations were removed. The now-unused modal pop-in/pop-out keyframes were deleted; fade/popover keyframes still used elsewhere remain. Palette availability is evaluated only far enough to fill 50 ranked suggestions, cached for that opening, with the full command list still searchable.

`c06c7ec` preserves the palette's original focus in lazy availability checks. A native search regression reproduced the missing editing-command result before this correction. Editor-origin searches now find and run Toggle bold; title-origin and Reading-origin searches correctly exclude it. Execution still checks current availability after focus returns. Ordinary key dispatch is unchanged.

Permanent coverage is wired into `npm test`:

- `scripts/test-geometry.mjs` runs Live Preview, Source and Reading on both a plain paragraph/H1/H2/H3 note and the same note with frontmatter.
- Every rendered line's CodeMirror block top must match its DOM top within 1px, initially and after each heading click. Every direct content child must have zero vertical margins.
- All 18 heading cases use native clicks for caret placement, native drags selecting exactly the heading text, hover at the row's top/middle/bottom, a hidden arrow 4px above the row, and native arrow clicks that fold/unfold the section.
- Ctrl+O, Ctrl+P and native right-click menus are timed in all six note/mode combinations: visible within two frames, no frame over 20ms during the first 300ms. The final geometry run's longest frame was 17.1ms.
- The CDP driver moves the pointer over each control before pressing/releasing. It never uses DOM `.click()`. Each run creates its own profile and ports and removes its profile afterward.

Negative controls: restoring the original heading CSS made the test fail with a 16px margin and a -16px line-position error. Restoring only the original Properties CSS made the test fail on its 32px vertical margin. Both fixes were restored and the permanent geometry suite passed again.

## Part 2 — hunter bugs

Changes were grouped by the files they affect, as permitted by the task.

1. **Item children travel with Tab/Shift+Tab** (`376cc6d`). The existing syntax-tree/list-renumber command expands the moved item to include its continuation lines and descendants. Carried child lists retain their numbers, including non-default 5 and a deliberately non-sequential 5/9 selection. Unit tests cover spaces, tabs, outdent and selections; native tests verify child movement, renumbering, undo and redo.

2. **Quoted/callout indentation and clicks** (`376cc6d`). Indentation changes after quote markers. Quoted list levels use spaces so a tab's absolute column cannot shorten the Markdown indent. Callout clicks reuse the rendered row's `data-line` mapping to edit the clicked item, retaining the existing embedded-note special case. Native beta-row clicks followed by Tab/Shift+Tab verify the body changes rather than the header.

3. **Preview header stays visible** (`2df253e`). The existing embed title and Open control remain outside the independently scrolling body. Heading targets align 16px inside that body; bottom padding permits a deep heading near the note's end to align there too. Native hover and wheel tests check title/icon bounds with and without trailing paragraphs. Short previews still shrink to their content.

4. **Code/frontmatter Backspace deletes one character** (`41abc29`). At candidate indentation/marker positions, the existing frontmatter parser/state and syntax tree protect YAML and code. This explicitly deletes one character because CodeMirror's ordinary Backspace can also delete an indent unit. Unit cases include fenced indentation and YAML list-looking text. Native tests cover fenced indentation in editable modes and YAML indentation in Source; Reading remains read-only.

5. **Second quoted-list Backspace outdents** (`41abc29`). The indent parser shared with Tab separates structural quote markers from indentation. The second press removes one list level while retaining `>`. Unit and native tests verify marker removal, quoted outdent and tab indentation.

6. **Escape cancels blurred failed renames** (`cdb757f`). The existing error helper installs an abortable Escape listener only while a rename error is shown. Correction, cancellation, row removal and pane disposal release it. Both inline title and explorer reuse their cancel behavior. Native invalid-name, pointer-blur and Escape tests restore the real filename and remove the error in all three modes.

7. **Long preview titles wrap clear of Open** (`2df253e`). Titles wrap anywhere and reserve enough room for the icon. Native tests check every title text rectangle against the icon, content-sized height and equal scroll/client width; there is no horizontal scrollbar.

8. **Missing previews have a header** (`2df253e`). Preview rendering now builds the shared title/Open chrome before filling the missing-note message. Ordinary missing embeds keep their existing behavior. Native tests check title, icon and compact height, then click Open to create the missing mock note in each mode.

9. **Two Backspaces are two undo steps** (`41abc29`). Structural list marker removal and outdent use CodeMirror's existing history-isolation annotation. Unit and native tests perform two Backspaces 80ms apart, undo indentation only, undo the marker, then redo both. Tab plus its renumbering remains one transaction.

10. **No-op rename displays the trimmed name** (`cdb757f`). After a successful title commit, including a trimmed no-op, the title is refreshed from the active path. Native trailing-space/Enter cases verify the displayed title, unchanged path and absent error in every mode.

No requested item is deferred. Formatting work runs in the existing invoked Tab/Backspace commands; preview work runs while the popup exists; rename Escape handling exists only during an error. No document-walking plugin, general typing listener, dependency or new ordinary-typing pass was added. The largest changed production file is `pane.ts`, 664 lines.

## Verification

- `npm run build`: passed.
- `npm test`: passed, 223 unit tests in 40 files, then the permanent geometry and stage 3 browser suites. The browser scripts report 151 and 92 named checks respectively, plus per-line measurements, exact drag selections and other direct assertions.
- `npm run audit:offline`: passed; 128 source files, release output, CSP, capabilities and dependencies checked.
- `cargo build` and `cargo test`: passed; 32 Rust tests, no failures.
- `node scripts/test-round19.mjs`: passed, 29 earlier native browser checks; its scrolling assertions now inspect the preview body.
- `node scripts/test-round18.mjs`: passed, 43 earlier native browser checks; four assertions were updated for the explicitly requested measured heading padding and independent preview-body scrolling.
- Both new browser suites run automatically under `npm test`; `npm run test:geometry` and `npm run test:fixes` also run them independently. There were no browser exceptions.

## Final line counts

Counts cover tracked files under `rebuild/app`, excluding generated `/gen/` files, using the same newline/file counting convention as the earlier notes. Changes are relative to stage 3 baseline `fef3fd7`.

- TypeScript: 22,230 lines, **+129**: production 19,261 (**+85**), tests 2,969 (**+44**).
- CSS: 3,676 lines, **-4**.
- Rust: 3,104 lines, **0**.
- JavaScript (`.mjs`, tests/tools): 1,056 lines, **+373**.
- JSON: 2,227 lines, **+2** (test script wiring).
- Total for those languages: 32,293 lines, **+500**. Production TypeScript/CSS/Rust together: **+81**.

This Markdown report is separate from app counts: 70 new lines. The supplied untracked task/patch files were left untouched.
