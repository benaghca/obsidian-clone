# Round 21 bugs

Hunter pass on `rebuild/r21-grok` at `685dc5f` (Codex's round 21, notes in `ROUND21_NOTES.md`). Nothing in the app was changed. Grove was checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release). Stationary clicks send press and release again at the same point with no `mouseMoved` between them. Keys are `Input.dispatchKeyEvent`. No remote URL was requested.

Obsidian 1.14.4 was observed headless (Ozone, `unshare -Urn` with only loopback, scratch `HOME` / `XDG_*` / user-data-dir, scratch vault under `/tmp`). HTML was written with Electron's clipboard API and pasted with CDP Ctrl+V. Only the public editor API and the rendered page were read. The process was killed afterward. No visible window was opened, and the real config and vaults were not used.

`scripts/test-r21-bugs.mjs` encodes the four bugs below. It fails on this commit. `npm run test:geometry` passed in this pass: stationary fold and unfold on `Geometry.md` and `GeometryFM.md` in Live Preview, Source, and Reading, and Ctrl+O, Ctrl+P, and the right-click menu were visible within two frames. The longest sampled frame was 17.2ms.

## Bugs

### 1. A Google Docs bold span pastes as plain text

Severity: moderate.

Repro:

1. Copy a Docs fragment whose outer wrapper is a normal-weight bold tag and whose text is a real bold span: `<b id="docs-internal-guid-1" style="font-weight:normal"><span style="font-weight:700">Docs bold</span></b>`, with plain text `Docs bold`.
2. Ctrl+V into a note. The same call to `htmlToMarkdown` returns null.

Expected: `**Docs bold**`. Obsidian 1.14.4 produced that. The brief's exception is only that the normal-weight `docs-internal-guid` wrapper must not make the whole fragment bold.

Actual: the converter returns null, so the paste keeps the plain clipboard text `Docs bold`. No bold markers are written.

Suspected: `src/editor/htmlToMarkdown.ts` lines 84–89 and 91. Font weight is consulted only to unwrap a `b`/`strong` whose weight is `normal` or `400`. A `span` falls through to its text and never sets `rich`, so a fragment that is only that wrapper plus a bold span is treated as unformatted. Failing test: `scripts/test-r21-bugs.mjs`.

### 2. Live Preview does not convert HTML pasted into a table cell

Severity: moderate.

Repro:

1. Open a note whose body is `| one | two |` / `| --- | --- |` / `| a | b |` in Live Preview.
2. Click the `one` header cell. Ctrl+V with HTML `<b>bold</b>` and plain text `bold`.

Expected: the cell text is bold markdown. Obsidian 1.14.4, with the cursor at the same place in the row, produced `| **bold**one | two |` and kept a single table. The same HTML pasted into a normal Grove paragraph becomes `**bold**`.

Actual: the note becomes `| boldone | two |`. The markers are missing, so Reading has nothing to render as bold.

Suspected: `src/editor/tables.ts` lines 170–208. The nested cell `EditorView` does not include the `clipboard` extension, so the paste uses CodeMirror's plain-text paste. The outer editor's handler in `src/editor/clipboard.ts` never sees it. Failing test: `scripts/test-r21-bugs.mjs`.

### 3. A pre whose lines are block elements joins those lines

Severity: moderate.

Repro:

1. Paste `<pre class="language-py"><div>line1</div><div>line2</div></pre>` (plain text `line1` / `line2`).

Expected: a `py` fence with the two lines still separated, which is what `pre` plus a `language-` class is specified to produce:

```py
line1
line2
```

Obsidian 1.14.4 kept the break and did not emit a fence (`line1`, a blank line, then `line2`). Grove keeps the fence and drops the break.

Actual: ` ```py ` then `line1line2` then the closing fence. A `<br>` inside `<pre><code>` is a separate case: both apps produce `line1  line2` on one line, so that one is not filed.

Suspected: `src/editor/htmlToMarkdown.ts` lines 51–58. The fence is built from `textContent`, which concatenates block children and does not turn `<div>` or `<br>` into newlines. Failing test: `scripts/test-r21-bugs.mjs`.

### 4. Quick switcher Tab then Enter opens the other note with the same name

Severity: moderate.

Repro:

1. Create `FolderA/Same.md` and `FolderB/Same.md`. Open FolderB, then FolderA, then some other note.
2. Ctrl+O. The empty query lists `Same` in FolderA, then `Same` in FolderB (most recently opened first, current note omitted).
3. Move the pointer onto the FolderB row. Press Tab, then Enter.

Expected: Tab writes `Same` into the box and Enter opens the row that was selected, `FolderB/Same.md`.

Actual: Tab writes `Same` and leaves the caret at the end of the box, then the list is rebuilt and the highlight jumps to `FolderA/Same`. Enter opens `FolderA/Same.md`. A third fuzzy hit (`Callouts, tables and embeds` in the sample vault) appears on that rebuilt list. Tab with an empty list, and Tab on the create row when nothing matches, correctly stay in the box and open nothing.

Suspected: `src/shell/quickSwitcher.ts` lines 37–39 call `setQuery(selected.name)`. `setQuery` in `src/shell/prompt.ts` lines 127–130 runs `update()`, and `update` (line 123) forces `selected = 0`. The two notes share a name, the fuzzy scores tie, and the stable sort keeps vault order, so the first `Same` wins. Failing test: `scripts/test-r21-bugs.mjs`.

## Checked, not filed

- Obsidian 1.14.4 joins a block to the surrounding line in the same way Grove does. Mid-line heading, list, quote, and fence all produced `Hello ## HeadingMIDDLE world`, `Hello - one` / `- twoMIDDLE world`, `Hello > quotedMIDDLE world`, and `Hello ```js` / `let y = 2;` / `` ```MIDDLE world ``. Pasting a one-item list into `- alpha BETA gamma` produced `- alpha - subBETA gamma` in both.
- Link text and link URLs with a `]` match Obsidian: `[see ] this](https://example.com/doc)` and `[docs](https://example.com/a]b)`. A URL over the selection `a]b` matches too. Obsidian then selects the whole inserted link; Grove leaves the caret after it, which is the caret the brief asks for. A balanced `(b)` in a URL-over-selection stays a working link in both (`[docs](https://example.com/a(b))`).
- Parentheses in an HTML link destination: Grove percent-encodes (`a%28b%29%20c`), Obsidian backslash-escapes (`a\(b\)%20c`). Both destinations resolve. The converter's existing test locks the percent form.
- `<pre><code class="language-js">line1<br>  line2</code></pre>` becomes one line, `line1  line2`, in both apps. Real newlines already in the code text are kept.
- Three `&nbsp;` before a bold word: Obsidian keeps three U+00A0 characters (`a\u00a0\u00a0\u00a0**b**`). Grove collapses them to one ordinary space (`a **b**`). The brief says to collapse whitespace like a browser, and the paste suite locks that.
- A Word paragraph whose only marker is `<span style="mso-list:Ignore">1.&nbsp;</span>`: Obsidian produces `1.` + U+00A0 + `**bold** item`. Grove produces `**bold** item`. The brief says to drop `mso-list:Ignore`. Listed below as a follow-up.
- Numbered-list paste from `start="100"` and `start="10"`, and a task with `<br>`, match Obsidian's markdown exactly, including the four-space child line. In Grove, `    - nested` under `100. hundred` is not a `cm-list-line` in Source, Live Preview, or Reading; under `10. ten` it is. `    two` under `- [ ] one` is not a list line either. That is how this markdown parses; the paste text matches Obsidian, so it is not filed as a converter bug.
- A text property (`contenteditable="plaintext-only"`) pasted with `<b>ZZ</b>` / `ZZ` stores `title: ZZ`. Source frontmatter staying plain is covered by the existing paste suite.
- Replacing a selection with bold HTML, typing one character, and undoing twice restores the selection on the second undo. The paste is one history step.
- Rename of an open recent updates that recent in place and leaves the other recents in order. An empty vault shows `No notes found.`; typing a name and Enter creates it. Tab on an empty result list does not leave the input.
- Mid-note `## Middle`, with another heading and more text below it, stayed at the same y and the same scroll in Live Preview, Source, and Reading. The second click, with no mouse move, unfolded, and the hover arrow was visible again. The absolute-bottom clamp is the case already measured against Obsidian in `ROUND21_NOTES.md`.
- `.menu` and `.prompt` computed `animation-name: none`. The geometry suite's open-timing checks passed.
- Pasting `https://example.com/pic.png` as an image still produces the remote-image chip. No off-host resource was requested during the probe.

## Next improvements

- Keep a Word list number when the only marker is an `mso-list:Ignore` span. Obsidian pastes `1.` and a nonbreaking space in front of `**bold** item`; Grove drops the span and the number goes with it. The brief currently wants that span dropped, and a real `<ul>` already pastes correctly. Small, on the order of 20 lines plus one fixture.
- Save clipboard files as attachments. The baseline still has no byte-writing command, so a PNG on the clipboard falls through to its plain text. Medium: a backend write, the existing attachment path, and the offline rule.
- Match Obsidian's backslash escapes for parentheses in HTML link destinations (`a\(b\)`) instead of percent-encoding. Both forms open, and the current encoding is tested. Small, a change to `destination()` and that one fixture.
