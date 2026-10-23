# Round 22 bugs

Hunter pass on `rebuild/r22-grok` at `d95733a` (Codex's round 22, notes in `ROUND22_NOTES.md`). Nothing in the app was changed. Grove was checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release). Stationary clicks send press and release again at the same point with no `mouseMoved` between them. Keys are `Input.dispatchKeyEvent`. No remote URL was requested. Obsidian was not started in this pass; the expected behavior below is the round 22 brief, and for the escaped destination it is also the note Grove already opens when that link is clicked.

`scripts/test-r22-bugs.mjs` encodes the three bugs below. It fails on this commit. `npm run test:geometry` passed in this pass: stationary fold and unfold on `Geometry.md` and `GeometryFM.md` in Live Preview, Source, and Reading, and Ctrl+O, Ctrl+P, and the right-click menu were visible within two frames. The longest sampled frame was 17.1ms.

## Bugs

### 1. A markdown link that backslash-escapes parentheses is not that note

Severity: high.

Repro:

1. With frontmatter on each note, create `Projects/a(b).md`, `Linker.md` containing `[[a(b)]]`, `[a(b)](Projects/a\(b\).md)`, `[pct](Projects/a%28b%29.md)` and `[plain](Projects/Plain.md)`, and `LinkerHidden.md` containing only `[see](Projects/a\(b\).md)`.
2. Turn on Settings → Files and links → Automatically update internal links. Rename `a(b)` to `c(d)` (the file becomes `Projects/c(d).md`).

Expected: every link that points at `Projects/a(b).md` points at `Projects/c(d).md` afterward, and the backlinks of `a(b)` include `LinkerHidden.md` before the rename. Clicking `[see](Projects/a\(b\).md)` in Live Preview and in Reading already opens `Projects/a(b).md`, with `data-href="Projects/a(b).md"`. The percent-encoded destination and the wikilink already update (`[[c(d)]]`, `[pct](c%28d%29.md)` under shortest-path format).

Actual: the escaped destination is indexed as the unresolved target `Projects/a\(b\` (the capture stops at the `)` of `\(`). `LinkerHidden.md` is not a backlink of `Projects/a(b).md`. After the rename, `Linker.md` still contains `[a(b)](Projects/a\(b\).md)`, and `LinkerHidden.md` and a third note that only has that escaped link are unchanged. The wikilink on the same line of `Linker.md` was rewritten, so the file was visited; the escaped destination on that line was skipped.

Suspected: `src/mock/backend.ts` line 11 (`MDLINK` stops at the first `)`) and lines 128–133 (that capture is resolved and, on a miss, stored with `.md` stripped). `src/links/internal.ts` line 139 is the same shape of pattern, and `rewriteLinks` at lines 182–189 therefore never sees `Projects/a\(b\).md` as the old path. `bareTarget` (lines 59–66) percent-decodes and does not remove `\(`. `src/links/update.ts` lines 35–40 search for the note name and the `%20` form only, so a note whose only hit is `a\(b\)` is never opened. The desktop index in `src-tauri/src/index/parse.rs` lines 217–235 treats `(` / `)` as nesting and then percent-decodes only, so `\)` stays in the target (read, not run under Tauri). Failing test: `scripts/test-r22-bugs.mjs`.

### 2. Tab indents the line instead of accepting the link suggestion

Severity: moderate.

Repro:

1. Open a note with frontmatter in Live Preview. Click at the end of the body and type `[[BlockNote`, where `BlockNote.md` exists.
2. The suggestion popup is open and `BlockNote` is the highlighted row. Press Tab.

Expected: Tab accepts that row, the way Enter does and the way the brief lists Tab next to Enter and Escape. The body becomes a closed link `[[BlockNote]]`.

Actual: the popup closes and the line is indented. The text is a tab character followed by `[[BlockNote`, still unclosed. Enter on an unresolved row still inserts the link, and Escape still closes the popup and leaves `#`, `^`, and `|` suffixes in place.

Suspected: `src/editor/editor.ts` lines 237–243. `completionKeymap` binds Enter to accept and does not bind Tab. The Tab binding is `indentList`, and `src/editor/format.ts` line 253 sends a non-list line through `indentMore`. Failing test: `scripts/test-r22-bugs.mjs`.

### 3. Select-all paste of the same frontmatter hides the new body

Severity: moderate.

Repro:

1. Open `PasteBody.md` in Live Preview. Its text is `---`, `tags: [r22hunt]`, `---`, then `old body`.
2. Copy plain text that keeps that same frontmatter and replaces the body with `VISIBLE BODY LINE`. Click the editor, Ctrl+A, Ctrl+V.

Expected: the note shows `VISIBLE BODY LINE` under the properties block. The document contains that line.

Actual: the document does contain `VISIBLE BODY LINE`, and the editor shows only the properties block (`Properties`, `r22hunt`, `Add property`). `contentDOM` has no `.cm-line` for the body. The same hiding happens if the whole document is replaced in one editor transaction that leaves the YAML bytes identical.

Suspected: `src/editor/frontmatter.ts` lines 92–94 return the existing frontmatter object when the new YAML matches and `next.end === fm.end`. `src/editor/properties.ts` lines 101–107 then map the old block decoration across the replacement instead of rebuilding it. That decoration is a replace from 0 to the frontmatter end (`build`, lines 80–81), and the mapped range covers the new body. Failing test: `scripts/test-r22-bugs.mjs`.

## Checked, not filed

- Outline, search, and backlink jumps put the target line inside the visible editor on a frontmatter note (`LongJump.md`, 80 lines, then `## TargetHeading` and `UniqueSearchTokenZZZ`). The heading's box was inside `.view-content` (y 508, leaf from 78 to 1000).
- Tab drag on frontmatter notes: a press and release with no move activates the tab; a second stationary click stays there and shows no ghost; Escape after the ghost appears leaves the order unchanged and the ghost is gone once its exit finishes; a drag reorders; a drop in the right edge zone splits into a second group.
- Long labels ellipsize. The deep note's explorer row is `text-overflow: ellipsis` (scroll width 365, client width 120) and stays inside the sidebar (row right 221, sidebar right 229). The tab title, a long breadcrumb, and the search result file name do the same. Search snippets still wrap (`white-space: pre-wrap`, `text-overflow: clip` in `.search-view .search-result-file-match`).
- Readable line length on sets `.markdown-sizer` to `max-width: 700px` (measured width 700). Off sets `max-width: none` and the sizer uses the pane's content width.
- A hover preview of a 40-paragraph embed is taller than its box (`scrollHeight` 5472, `clientHeight` 311, `overflow-y: auto`). A wheel event on that box moves `scrollTop` from 0 to 240.
- Two `photo.png` files plus `Attachments/photo.png` are three rows with folder details, and choosing `FolderB/` inserts `[[FolderB/photo.png]]`. `[[ZzUncreated]]` is offered and Enter keeps it. `[[missing-pic.png]]` is not rewritten to `missing-pic.png.md`. Reading view does not open the suggester. At 900×640 the popup rect stayed inside the viewport, hint on one line.
- Recents: after a rename the new name is offered and the old name is not; after a delete the removed note is not offered as a file.
- Typing `[[BlockNote#Section`, `[[BlockNote|Alias`, and `[[BlockNote^blockid` leaves those suffixes in the text. Enter does not strip `^blockid`.
- A Word list inside a real `<ol><li>` pastes as `1. One` / `2. Two`. A standalone `mso-list:Ignore` number is kept (`1. First`). Nested parentheses, a space, `%28`/`%29`, and a mix of percent-encoded and raw parentheses paste as `a\(b\(c\)\)`, `a%20b\(c\)`, `a%28b%29`, and `a%28b%29/c\(d\)`. Clicking those external URLs in Live Preview and Reading calls `openExternal` and does not call `window.open`. Clicking `[see](Projects/a\(b\).md)` opens `Projects/a(b).md` in both modes.
- Ribbon tooltip: absent at 80ms, present at about 500ms, `mod-right`, to the right of the button, gone after the pointer leaves. The status-bar "Show backlinks" tooltip is `mod-top` and sits above the bar. Typing in the editor shows no tooltip. The four tooltip selectors have no `title`. Closing the tab removes the tooltip that was on its close button. A right-click in the editor opens a menu with `animation-name: none` and no tooltip left on screen.
- Fold arrows stayed visible after a stationary unfold in Live Preview, Source, and Reading, with and without frontmatter. Menus and prompts opened within two frames.

## Next improvements

- Save clipboard images and files as attachments. A pasted PNG still falls through to its plain text because there is no byte-writing command. That is a common way notes pick up screenshots. Medium: a backend write, the existing attachment path, and the offline rule.
- Offer headings and blocks after `#` and `^`. The suggestion footer already says to type `#` for a heading and `^` for a block, and those characters only close the file list. Obsidian then lists that note's headings or block ids. Medium: a second completion source for the note named before the marker, reusing the current popup.
- Drag a file from the explorer into the note to insert a link. Obsidian does this, and the round 22 brief is holding it. Medium: the explorer drag already exists; the drop needs a link insertion in the editor, including an attachment path when the name is ambiguous.
