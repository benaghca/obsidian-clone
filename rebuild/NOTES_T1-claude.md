# T1 (Claude): merge a template's properties on insert

Piece T1 of `CINDER_GAP_PLAN.md`. Built 2026-11-04 on `rebuild/t1-claude`, from `rebuild/integration` at `b5d0a34`. Local commit only; nothing pushed. No new packages or crates, no network, no Obsidian or Excalidraw code or assets, no GUI windows. Chris's choices: only the core Obsidian-style templates. No Templater `<% %>`, no folder templates, no weekly or monthly notes. None of those are touched here.

## What changed

*Templates: Insert template* no longer drops a second `---` block in the middle of the note. The template's properties are merged into the note's own, and only the body goes in at the cursor.

- `app/src/editor/templateMerge.ts`: +179, new. `mergeTemplate(noteText, templateText, selection?)` is pure, with no DOM or editor state. It returns `{ changes, text, cursor, skipped }`. `changes` are in the note's own offsets and in order, so one transaction applies them all.
- `app/src/appCommands.ts`: +6 / −2. `insertTemplate` fills the variables (`fillTemplate`, unchanged), calls `mergeTemplate` with the doc and the main selection, and dispatches one transaction (`userEvent: "input.template"`). If `skipped` is set, a notice says the properties weren't added.
- `app/src/editor/propertyEdit.ts`: +2 / −2. Exports `lineAt` and `Line` so the merge reads lines and line endings the same way `editProperty` does.
- `app/src/editor/templateMerge.test.ts`: +179, new. 19 Vitest cases.
- `app/scripts/test-template-merge.mjs`: +108, new. A browser check in the `test-paste.mjs` style. Added to `npm test` right after `test-paste.mjs`.

## Rules, as built

- **The note's existing keys win.** A template key the note already has, in any case (`Status` vs `status`), leaves the note's value alone. This holds even when the note's value is empty.
- **List values are unioned.** When both sides hold a list (`tags`, `aliases`, `cssclasses` or any list), the template's new items go after the note's own, without duplicates. Tags match without a leading `#` and in any case, as Obsidian tags do; other lists match exactly. A plain `tags: Work` counts as a list. If one side is a list and the other is not, the note wins. The rewrite goes through `editProperty`, so it keeps the note's list style (`[a, b]` or `- a` lines), its indent and its line endings, and it is validated the same way Kanban writes are.
- **New keys** are copied as written in the template, multi-line values included (a nested map, a `|` block), at the end of the note's frontmatter. Template comments and blank lines are not copied into an existing block.
- **A note with no frontmatter** gets the template's whole block on top, comments included, after a BOM if there is one.
- **The body** replaces the selection, the same as before. A caret inside the note's frontmatter, or before its BOM, puts the body right after the frontmatter. If the note ends on its closing `---` with no newline, a newline goes in first. An empty body leaves the selection alone instead of deleting it.
- **CRLF and BOM.** Everything inserted uses the note's line ending (CRLF or LF), whatever the template uses. The note's BOM stays first; the template's BOM is dropped. Editor documents are LF (CodeMirror normalises them), so CRLF mostly matters for T2's create-from-template, which will pass file text in.
- **Empty template** (`""`, BOM only, or `---\n---\n`): no changes.
- **Safety.** If the note's frontmatter can't be edited line by line, nothing in it is rewritten and only the body goes in, with a notice. That covers duplicate keys, a `---` that never closes, and a block over 2000 lines, the same limits as `frontmatter.ts`. After a merge, the frontmatter is read back: every expected key must have its expected value and the body must be byte-identical, or the merge is dropped the same way. A template whose `---` never closes has no frontmatter (Obsidian's reading), so all of it is body. A template block Grove can't read still goes on top of a note without frontmatter, as written.
- **One undo step.** The frontmatter edit is one minimal change between the fences, and it never splits a surrogate pair. The body is a second change, and both go in one dispatch. `input.template` is not a joinable history event, so typing just before the insert stays a separate undo step. The browser check covers that.

## Tests

- `npx vitest run src/editor/templateMerge.test.ts`: 19 passed. Each case also applies `changes` to the string, and for LF notes through a real CodeMirror `EditorState`, then checks that the result equals `text`. Cases: no frontmatter (caret mid-note, empty note), both sides with frontmatter, case-insensitive keys, list union (block, flow, `#Tag`, plain tags, empty list, a list vs a non-list, nothing new), CRLF (note CRLF / template LF, and the reverse), BOM (note and template, caret before the BOM), empty template (four forms, with a selection), a template without frontmatter over a selection, a caret inside the frontmatter, a note ending on its fence, unknown-type values, comments, unsafe frontmatter on either side, emoji, and a 3.6 MB note.
- `node scripts/test-template-merge.mjs`: 15 checks, all with native keys: Ctrl+P → "Insert template" → Enter → "Meeting" → Enter. In Source and in Live Preview, on a note with frontmatter: one block, `status` kept, tags unioned, `created` added with `{{date}}` filled, the body at the caret, the caret after it, the Properties block showing the new key (Live), one Ctrl+Z back to the exact original, one Ctrl+Shift+Z forward again. On a note without frontmatter: the block on top, and one Ctrl+Z that keeps text typed just before. A template without frontmatter still replaces the selection. The merged note is saved to disk as shown. No console errors.
- `npm run build`: passed.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest **1301 passed** across 81 files. All browser scripts passed, including `test-paste.mjs` and the new `test-template-merge.mjs`. `posttest` passed. No rerun was needed.
- `npm run audit:offline`: passed (192 source files, dist/, CSP, capabilities, dependencies).
- `cargo test --offline`: **84 passed**, 0 failed, 4 ignored. No Rust changed.
- The screenshots and canvas/Base outputs under `rebuild/round*-shots/` that the test run rewrote were restored. They are not in the commit.

## Bench

`node scripts/bench-frontend.mjs` (5,000-note synthetic vault, medians of three runs). This piece doesn't touch these paths. The numbers show no regression; the gaps are run-to-run noise.

| | before | after (run 1) | after (run 2) |
|---|---|---|---|
| vault tags | 11.1 ms | 10.8 ms | 11.1 ms |
| search | 13.2 ms | 13.3 ms | 15.6 ms |
| search page 5k | 5.3 ms | 5.2 ms | 5.3 ms |
| link refresh | 41.9 ms | 41.3 ms | 47.2 ms |

`mergeTemplate` on its own: a 40-property note plus a 4-property template, 25 runs, caret mid-note. 3.8 KB note: median 0.24 ms. 320 KB: 0.33 ms. 6.4 MB: 3.7 ms. The cost of a huge note is the one `doc.toString()` and the string build. The frontmatter work doesn't grow with the body. The script was a scratch file run through Vite's SSR loader, the same way `bench-properties.mjs` loads modules, and it isn't committed.

## Decisions and left open

- The function is TS, as the plan says. It is pure text work on the open editor's document, and a Rust round trip would add IPC for no gain.
- `mergeTemplate` takes an optional third argument, the selection, which defaults to the end of the note. The plan's two-argument call still works.
- I didn't find the exact Obsidian rule for a template list against a note scalar under the same key. Grove keeps the note's value, which follows "the note's existing keys win". No Obsidian code or docs were fetched.
- T2 (*Create new note from template*) can call `mergeTemplate("", filled, { from: 0, to: 0 })`. On disk text it keeps CRLF.
