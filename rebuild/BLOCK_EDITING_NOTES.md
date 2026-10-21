# Round 13: working inside rendered blocks (as merged)

**Merged:** Claude's version (`rebuild/r13-claude`, `3368bb7`) as merge `1c8e82a`, with no ports. Three agents did the same brief from `5df7da9`. The comparison was headless: a Vite preview of each branch and of the round-start base, with the mock vault plus a shared `Blocks13` note (yellow, red, green and blue highlights; Python, JavaScript and Rust code blocks; an aligned table; a local image at `|200`; a `![[Tasks13]]` embed holding three tasks), in headless Chromium at 1280×1150. Obsidian 1.14.4 ran on a private Xvfb display in its own network namespace with a scratch profile and the same note in a copy of the test vault. For each version: Live Preview and Reading view shots, a right-click on a table cell (menu items recorded), hovering the image and pressing its "Zoom in" control, and ticking `alpha` in the embed and then opening `Tasks13` to check it was written there.

## How the three compared

Line counts from `rebuild/app` with the brief's commands (before = `5df7da9`: TS app 17,424, tests 1,804, CSS 3,323, Rust 3,219, total 25,770):

| | Claude (merged) | Codex | Grok |
|---|---:|---:|---:|
| TypeScript, app | +737 | +580 | +1,026 |
| TypeScript, tests | +224 | +175 | +182 |
| CSS | +159 | +87 | +91 |
| Rust | 0 | 0 | 0 |
| **Total** | **+1,120** | **+842** | **+1,299** |
| `index.js` gzip growth (whole round) | +20.9 kB | +40.6 kB | +41.4 kB (split into a preloaded shared chunk plus lazy language chunks) |
| Callout spacing and fold memory (item 6) | both | fold only | both |
| Commits | 10 + notes | 15 + notes | 3 + notes |

- **Closest to Obsidian: Claude.** Side by side on the same note, its code colours match Obsidian's editor token for token where the others miss some: Python parameter names and `str` types, Rust's `println!` and variables (with `u32` left plain, as Obsidian does), and JavaScript's arrow-function parameters. Its table right-click menu is Obsidian's editor menu with Row ›, Column › and the two sorts appended, as Obsidian shows it. It also built the optional callout spacing. It reached that with the smallest bundle growth, by using the legacy stream modes Obsidian's editor uses for Python, Rust, Shell, YAML and XML, and reusing the JS/CSS/HTML grammars that were already bundled through Markdown. Weak spots: typing inside a screen-full 300-line code block is about 1.5 ms slower per key (still within a frame), and the image "Zoom in" button is hidden in Reading view.
- **Codex:** the smallest code (+842) and the cleanest performance numbers (code-block and table typing back in the round-start range, by reusing Lezer tree fragments inside the edited block). It also guards embed task ticks against stale text and changed mtimes, keeps tables drawn while the menu is open, and committed a headless check script. Visible differences: fewer code colours than Obsidian (no parameter or macro colours), a click on the image itself opens the lightbox (Obsidian only zooms from the button), and no callout spacing. Its bundle grew about twice as much as Claude's.
- **Grok:** every item built, with lazy language chunks served from the app's own origin. But its table right-click menu drops the editor items (only Row, Column and the sorts), the submenu separators and sort order were guesses (its notes say so), it moved shared CodeMirror into a new preloaded chunk, and it was the largest in lines.
- **Checks:** all three build, pass their tests and the offline audit; in all three, ticking a task inside the embed wrote `- [x] alpha` to `Tasks13` and left the host note alone. On the merged tree on Cloud: `npm run build`, `npm test` (157 tests in 31 files), `npm run audit:offline`, `cargo build` and `cargo test` (31) pass.

## Ideas from the other two

- **Codex (not ported, handed to round 14):** reusing parse fragments inside the edited code block, which would win back Claude's ~1.5 ms in large code blocks; it fits a cleanup round that may touch `codeHighlight.ts` with no visible change. Its stale-tick guard (watched mtime plus exact painted text) is safer than Claude's path, which loads the note fresh through `ws.editors` and follows outside changes; worth folding in if it stays small. Not ported: zoom on a plain image click (Obsidian doesn't do that).
- **Grok (not ported):** lazy, origin-served language chunks. With Claude's grammars at 16 kB there's little to save, and lazy loading would add a redraw path. Its stable, numeric-aware sort (`localeCompare` with `numeric: true`) is a detail to compare against Claude's sort in round 15.

## Merged line counts (from `rebuild/app`)

| | Round 12 merged (`5d347aa`) | Round 13 merged (`1c8e82a`) | Change |
|---|---:|---:|---:|
| TypeScript, app | 17,424 | 18,161 | +737 |
| TypeScript, tests | 1,804 | 2,028 | +224 |
| CSS | 3,323 | 3,482 | +159 |
| Rust | 3,219 | 3,219 | 0 |
| **Total** | **25,770** | **26,890** | **+1,120** |

Largest files: `workspace.ts` 676, `graph/view.ts` 649, `styles/settings.css` 647, `shell/pane.ts` 625, `src-tauri/src/vault.rs` 561, `editor/livePreview.ts` 547, `appCommands.ts` 546. None over 680. New files: `editor/codeHighlight.ts` (224), `editor/tableEdit.ts` (186), `editor/imageZoom.ts` (58), plus tests. New dependencies, all bundled and on the audit allowlist with a reason: `@codemirror/lang-json`, `@codemirror/lang-sql`, `@codemirror/legacy-modes`, with `lang-javascript`, `lang-css` and `lang-html` now direct (they were already bundled). No permission, command, CSP or `tauri.conf.json` change.

## Known gaps left after the merge

- Typing inside a screen-full code block is ~1.5 ms slower per key (round 14 may recover it with no visible change).
- The image "Zoom in" button is hidden in Reading view; check Obsidian. The image right-click menu (Copy image, Reset size …) isn't built.
- Obsidian draws indent guides inside code blocks and a lighter code-block background; Grove has neither.
- Tasks inside a callout or table *inside* an embedded note can't be ticked.
- Tables stay source-on-touch (no in-place cell editor, in all three versions).
- Round 15 (feature) picks these up together with the round 10 leftovers (search match-case and sort menu, File properties view, Rename/Delete property).

---

# Round 13: working inside rendered blocks (Claude's notes)

Branch `rebuild/r13-claude`, from `5df7da9`. All six items of the brief are built, the optional one (callout spacing and fold state) included. One brief item is skipped because Obsidian doesn't have it: zoom controls in the image tab. One hard rule is not fully met: typing inside a long code block (see Performance).

## Summary

- **Checks:** all of these pass:
  - in `rebuild/app`: `npm run build`, `npm test` (157 tests in 31 files, up from 142 in 29) and `npm run audit:offline`;
  - in `src-tauri`: `cargo build` and `cargo test` (31).
- **Built:**
  1. **Code blocks are coloured** as Obsidian colours them, in Live Preview, Source mode, Reading view and rendered text (callouts, tables, embeds).
  2. **Tables:** Tab, Shift+Tab, Enter and Shift+Enter, and Obsidian's table menu (Row ›, Column ›, two sorts). Each edit is one undo step and writes the table padded as Obsidian pads it.
  3. **Images:** Obsidian's "Zoom in" lightbox, and its drag-to-resize corner, which writes the size as Obsidian writes it.
  4. **Note embeds:** a task can be ticked inside an embedded note, which writes that note. Embeds inside callouts and tables now follow their target being created, renamed or deleted.
  5. **Coloured highlights:** "Toggle red/orange/yellow/green/blue/purple highlight", written byte for byte as Obsidian writes them (`==🔴text==`).
  6. **Callouts:** Obsidian's 16 px block spacing inside the body, and a fold that survives being scrolled away and back.
- **Dependencies:** `@codemirror/lang-json`, `@codemirror/lang-sql` and `@codemirror/legacy-modes` are new to the bundle. `@codemirror/lang-javascript`, `lang-css` and `lang-html` were already bundled through `lang-markdown` and are now direct dependencies. All six are on the audit's allowlist with a reason; no other audit rule changed.
- **Size:** `index.js` grew by 20.9 kB gzipped for the whole round. The highlighting alone added 16.3 kB, against a 60 kB budget. No permission, command, capability, CSP or `tauri.conf.json` change.
- **Lines:** +1,120 in total (TS app +737, tests +224, CSS +159, Rust 0), under the ~1,500 budget. No item cost more than ~285, and no file is over 676 lines.
- **Speed:** these are unchanged from the round's start:
  - typing on the 5,000-line Big note;
  - typing in a 40-row table;
  - note switching, search typing, and graph open, pan and zoom.

  Typing inside a 300-line code block that fills the screen is about 1.5 ms slower per key (key to painted frame, still within one frame). Grove's own work per key is back to the round-start figure. The rest is the browser drawing the ~1,200 token spans on screen. Details and what I tried are under Performance.

## How Obsidian was observed

Obsidian 1.14.4 (the installed package) ran with a throwaway setup:

- Electron in headless mode (`--ozone-platform=headless`), inside `unshare -rn` (its own user and network namespace);
- a scratch `HOME`/`XDG_*` and a fresh copy of a throwaway vault in the session scratchpad.

The vault held:
- code blocks in 13 languages plus 58 language names and aliases;
- an aligned table;
- PNGs generated in code;
- a note of tasks embedded at the top level and inside a callout;
- highlights;
- a callout with paragraphs, a list, a heading and code, plus a folded callout.

A CDP script did the observing. It:
- read the DOM, classes and computed colours (light and dark);
- drove the keyboard, the mouse and the menus;
- ran every highlight command;
- dragged the resize corner;
- read the Markdown Obsidian wrote after each action.

No Obsidian source, CSS or asset was opened; `~/.config/obsidian` and the owner's vaults were never touched. Grove was checked in headless Chromium against the Vite dev server and its mock vault, with the same notes.

## Item by item

### 1. Code block syntax highlighting

**What Obsidian does (observed):**
- **Two engines.** Live Preview and Source mode colour code with CodeMirror's legacy modes (classes `cm-keyword`, `cm-def`, `cm-variable` …). Reading view uses a different highlighter.
- **Colours (light / dark):**

  | Tokens | Colour |
  |---|---|
  | keywords | pink #d53984 / #fa99cd |
  | strings | green #08b94e / #44cf6e |
  | numbers | purple #7852ee / #a882ff |
  | operators and HTML tags | red #e93147 / #fb464c |
  | properties, types, builtins, attributes | yellow #e0ac00 / #e0de71 |
  | variables | cyan #00bfbc / #53dfdd |
  | comments and meta | faint #ababab / #666 |
  | HTML angle brackets, SQL punctuation | muted |
  | definitions, `true`/`null`, brackets | the text colour |

  The colours are the same palette as the callouts.
- **Names accepted, in either view, in any case:**
  - `js`, `javascript`, `jsx`, `ts`, `typescript`, `tsx`;
  - `json`, `css`, `html`, `xml`, `svg`;
  - `py`, `python`, `rust`;
  - `sh`, `bash`, `zsh`, `shell`;
  - `yml`, `yaml`, `sql`, `md`, `markdown`.
- **Not every name works in both views:**
  - `py` and `md` are coloured only in Reading view;
  - `zsh` only in Live Preview;
  - `rs` in neither.
- **Block labels (Live Preview):**
  - `jsx` → "JSX", `tsx` → "TypeScript-JSX";
  - `bash`, `zsh`, `sh` → "Shell";
  - `yml` → "YAML", `markdown` → "Markdown";
  - `py`, `rs`, `md` and unknown names as written.

**What Grove does now:**
- **Languages:** the languages and names above, coloured the same way in every mode. Grove has one engine, so a name either view accepts is coloured in all of them; `rs` stays plain, as in Obsidian.
- **Labels:** as observed.
- **Colours:** token kinds map to `--code-*` tokens in `theme.css` (light and dark), built on a shared `--color-*` palette. The callouts now use the same palette; it was `--callout-*`.
- **Where the mapping follows which view:** where Obsidian's two views disagree, Grove follows its Live Preview (definitions, `true`, `null` and brackets plain; regexes green).
- **Unknown languages stay plain.**

**How it's built** (`editor/codeHighlight.ts`):
- **Parsing:** each visible fenced block is parsed on its own with its language's parser, and its tree is kept. An edit maps the marks with the text at once and marks the edited part of that tree for re-parsing. Right after that frame is drawn, the block is coloured again; only what the edit touched is re-parsed, using the fragments the edit left.
- **Cost:** blocks out of view cost nothing, and typing outside code costs only a mark mapping.
- **Rendered text** (`render.ts`) paints the same marks.
- **No highlighter of its own:** CodeMirror's `tagHighlighter`/`highlightTree` maps tags to classes; there are no inline colours.
- **Where the code is found:** fenced code inside lists and callouts is found too (`eachCodeBlock`, now shared with Source mode's grey band).

**Why not lang-markdown's `codeLanguages` (nested parsing)?** I built that first, but it re-parsed the whole 300-line block on every key: Lezer can't reuse a nested tree that an edit lands in, which cost +1.2 ms per key. It also let a code block's language data (quote pairing, indentation) leak into the editor. Parsing each block apart fixed both.

### 2. Tables

**What Obsidian does (observed):**
- **Editing in place.** Each cell is a small editor of its own.
- **Clicking into a table re-pads it and saves it.** Every column becomes as wide as its widest cell (at least 3), padded per its alignment; centred cells put the extra space on the right.
- **Tab and Shift+Tab** go to the next or previous cell and select its text.
- **Tab in the last cell** adds an empty padded row and goes to its first cell.
- **Enter** goes to the cell below. In the last row it adds a row, keeping the column.
- **Shift+Enter** writes `<br>`.
- **The menu.** A right-click on a cell ends the editor menu with:
  - "Row ›": Add row above, Add row below | Move row up, Move row down | Duplicate row, Delete row;
  - "Column ›": Add column to the left, Add column to the right | Move column left, Move column right | Align left, Align center, Align right | Duplicate column, Delete column;
  - then a separator, "Sort by column (A to Z)" and "Sort by column (Z to A)".

  Paragraph and Insert are disabled in a table. A move that can't happen (up on the header, right on the last column) isn't shown. The header counts as a row: moving the first body row up makes it the header.
- **Details of what each item writes:**
  - a new column takes the alignment of the column it was added next to (`:-:` for a centred one);
  - deleting a row doesn't narrow a column;
  - sorting leaves the header in place.
- **Undo:** each edit is one undo step.

**What Grove does now** (`editor/tableEdit.ts`, the menu in `shell/menus.ts`):
- **Everything above,** with the same Lucide icons. A right-click on the drawn table puts the caret in that cell first.
- **Same Markdown:** for every menu item and for Tab/Enter, the result is what Obsidian wrote. The tests use Obsidian's output as their expected text.
- **One transaction per edit:** it replaces only the table's lines, so it is one undo step. A Tab that moves within an already padded table changes nothing, so it adds no empty undo step.
- **Precedence:** the keys run ahead of list continuation and indenting, but only while the caret is in a table and the `[[` suggester isn't open.

**Differences:**
- Grove pads a table on its first table edit, not on a mere click. Merely clicking into a table doesn't rewrite the note.
- **Cells stay source-on-touch (round 12), not edited in place.** Obsidian's in-place editor is a nested editor per cell. In Grove, that would need its own copy of every inline feature (links, the `[[` suggester, formatting commands) and an undo history shared with the note. A decoration-drawn table, edited in the real text, can't size columns to their content without measuring every row. Neither is small and solid, so the caret edits the table's Markdown, where every editor feature already works.

### 3. Images

**What Obsidian does (observed):**
- **On hover,** an image shows two buttons, "Zoom in" (`zoom-in`) and "Edit this block". A 30 px resize corner sits bottom-right (cursor `nwse-resize`). A click on the image itself does nothing special.
- **Zoom in** opens a lightbox:
  - the image at its own size, at most the window's;
  - a black backdrop fading to 90%;
  - the image gliding from its place in the note to the centre;
  - the alt text or file name in a 30 px bar along the top (13 px, white), and a close X at the top right.

  Escape or a click on the backdrop closes it, gliding back; a click on the image doesn't.
- **Dragging the corner** resizes the image live, and on release writes the width:

  | Before | After |
  |---|---|
  | `![[pic.png]]` | `![[pic.png\|358]]` |
  | `![[pic.png\|100x30]]` | `![[pic.png\|160]]` |
  | `![alt](a.png)` | `![alt\|348](a.png)` |
  | `![](a.png)` | `![348](a.png)` |
  | `![\|80](a.png)` | `![\|128](a.png)` |

  Each resize is one undo step. Dragging an edge does nothing.
- **The image tab** (an image opened from the file list) has no zoom controls: only Bookmark and More options. A click or Ctrl+wheel doesn't zoom.

**What Grove does now:**
- The same hover buttons, lightbox (`editor/imageZoom.ts`) and corner, with the motion tokens. Focus goes back to the editor when the lightbox closes.
- The resize writes what Obsidian writes (`resizedSize`, tested). It writes once, on release, as one undo step.

**Skipped:** image tab zoom controls (Obsidian has none). Also not built: the image's right-click menu (Copy image, Swap file, Remove image, Reset size …), which the brief didn't ask for.

### 4. Note embeds

**What Obsidian does (observed):** ticking a task inside an embedded note writes that note (`- [x] first task`), at the top level and inside a callout. Undo in the host note doesn't undo it; the host's text is untouched.

**What Grove does now:**
- **Ticking.** A task's box in an embed writes that line of the embedded note:
  - the line is mapped back through the frontmatter and the `#section` the embed shows (`embedPart`, `toggledTask`, tested);
  - the write goes through the note's editor state (`ws.editors.load` + `change`), the path "Merge with" already uses, so it is saved like any edit (the 300 ms debounced `write_note`);
  - every embed of that note redraws at once;
  - it reads and writes only that note.

  Nothing else in an embed is editable. The host's undo history is untouched, as in Obsidian.
- **Following targets.** A callout or table holding an embed is drawn again when the vault's files change: the existing `filesChanged` effect, applied to that note's blocks containing `![`, with no vault scan. A missing target created later (or renamed or deleted) now shows in callouts and tables at once.

**Note on the brief's "mtime check the app already uses":** there is no such check in the app; saves are plain atomic `write_note`s. The tick uses the editor path instead. That path reads the note fresh from disk when it isn't open, and follows outside changes through `vault-changed`, as any open note does.

**Not done:** a task inside a callout or table *inside* the embedded note stays disabled. Only the embed's own lines can be ticked.

### 5. Coloured highlights

**What Obsidian 1.14.4 writes (observed, byte for byte):**
- **The commands:** `editor:toggle-highlight-red` … `-purple`, named "Toggle red highlight" and so on, with no default hotkeys.
- **The syntax:** the colour's emoji goes just inside the opening `==`:

  | Colour | Written |
  |---|---|
  | red | `==🔴word==` |
  | orange | `==🟠word==` |
  | yellow | `==🟡word==` |
  | green | `==🟢word==` |
  | blue | `==🔵word==` |
  | purple | `==🟣word==` |
- **What they apply to:** the selection, or the word at the caret. "Toggle highlight" also wraps the word at the caret now; before, it inserted an empty `====`.
- **Toggling:** the same colour again removes the highlight. Another colour recolours it, and a plain `==word==` takes the colour.
- **Drawing:** both views hide the emoji and tint the text with the colour at 30%. Yellow is the plain highlight's colour. While the caret is inside, the `==` markers show with the highlight's tint, and a 0.9 em swatch of the colour stands in for the emoji.

**What Grove does now:**
- **The same.** The commands are in the palette, and the menu's Format › Highlight uses the new toggle.
- **Colours** are tokens: the `--color-*` palette, light and dark, at 30% via `color-mix`.
- **Assumption:** what plain "Toggle highlight" does inside a coloured highlight wasn't observed. Grove removes it, as the same command would.

**In other Markdown apps:** the syntax reads as `==🔴word==`. Apps without `==` highlights show the emoji and the markers as text; apps with them show a yellow highlight starting with a red dot. It is readable, but not coloured.

### 6. Callout spacing and fold state

**Observed** (Live Preview and Reading view alike):
- blocks in a callout's body sit 16 px apart, and headings 40 px;
- blank lines take no room;
- a callout folded or unfolded by a click stays so after being scrolled far away and back.

**Grove now:**
- **Spacing.** Rendered text marks the first line of each block and the blank lines between them. CSS spaces these only inside a callout's body.

  | Element | Obsidian (px) | Grove (px) |
  |---|---:|---:|
  | first paragraph | 49 | 49 |
  | list | 89 | 89 |
  | next paragraph | 158 | 153 |
  | heading | 246 | 241 |
  | code | 330 | 332 |

  The few pixels left come from Obsidian's 26 px list items and taller code padding.
- **Folds.** A clicked fold is remembered per editor by the callout's text. Checked: the round's start re-folds after scrolling back; this branch doesn't.

## New modules and files

| File | Lines | Owns |
|---|---:|---|
| `src/editor/codeHighlight.ts` | 224 | The languages and aliases, Obsidian's labels, the tag-to-class mapping, each visible block's own incremental tree, the editor plugin, the marks for rendered text, `eachCodeBlock`. |
| `src/editor/tableEdit.ts` | 186 | The table model and Obsidian's padding, every row/column/align/sort operation, Tab/Enter/Shift+Enter, the table and cell under the caret, the one-transaction rewrite. |
| `src/editor/imageZoom.ts` | 58 | The "Zoom in" lightbox. |
| `src/editor/codeHighlight.test.ts` | 53 | Aliases, labels, token kinds, what isn't coloured, code in lists and quotes. |
| `src/editor/tableEdit.test.ts` | 122 | Every menu operation and Tab/Enter against Obsidian's output, padding, the cell under the caret, the one-change rewrite. |

**Changed:**

| File | Change |
|---|---|
| `livePreview.ts` | Coloured highlights; code labels from `codeHighlight.ts`. |
| `embeds.ts` | Zoom and resize buttons, `resizedSize`, `embedPart`/`toggledTask`. |
| `render.ts` | `onTask` for an embed's boxes. |
| `embedHost.ts`, `host.ts` | `toggleTask`. |
| `blocks.ts` | Embeds in blocks follow file changes. |
| `callouts.ts` | Spacing marks, remembered folds. |
| `tables.ts` | Right-click. |
| `format.ts` | `toggleHighlight`. |
| `appCommands.ts` | Six commands. |
| `menus.ts` | The table items. |
| `icons.ts` | Ten Lucide icons. |
| `sourceMode.ts` | Uses `eachCodeBlock`. |
| `editor.ts` | The plugin and the table keys. |
| `theme.css`, `blocks.css` | The colour and code tokens; code, table, image, lightbox and highlight styles. |
| `mock/sampleVault.ts` | A coloured highlight in the blocks note. |
| `scripts/audit-offline.mjs` | Allowlist only. |

## Dependencies, permissions, commands, CSP

All are bundled up front; nothing is fetched or loaded lazily. Sizes are gzipped, measured by building each package on top of what the app already bundles.

| Package | Version | Gzipped in `index.js` | What for |
|---|---|---:|---|
| `@codemirror/lang-javascript` | 6.2.5 | 0 (already bundled) | JavaScript, TypeScript, JSX, TSX |
| `@codemirror/lang-css` | 6.3.1 | 0 (already bundled) | CSS |
| `@codemirror/lang-html` | 6.4.12 | 0 (already bundled) | HTML |
| `@codemirror/lang-json` | 6.0.2 (+ `@lezer/json` 1.0.3) | 1.2 kB | JSON |
| `@codemirror/lang-sql` | 6.10.0 | 4.1 kB | SQL (standard dialect) |
| `@codemirror/legacy-modes` | 6.5.5 | 8.8 kB | Python 2.8, Rust 2.0, XML/SVG 2.2, Shell 1.1, YAML 0.65 kB |

The rest of the 16.3 kB that the highlighting added is CodeMirror's stream-parser runtime and the glue.

**Rejected** because they were larger: `lang-rust` (29.8 kB), `lang-python` (17.3 kB), `lang-yaml` (5.2 kB), `lang-xml` (3.7 kB) and legacy `sql` (10.8 kB). The legacy modes are also what Obsidian's own editor uses, so they colour Python, Rust, Shell, YAML and XML as it does.

**Why not our own code:** tokenizers for these eleven languages would be thousands of lines that we would have to keep right. That includes JSX, TS generics, template strings, f-strings, heredocs and YAML's indentation. These packages are the CodeMirror maintainers' own grammars (MIT). They have no runtime dependencies beyond what is already bundled, and they make no network calls. The audit's allowlist names each one with this reason.

**No** new permission, command, capability, CSP, scope or `tauri.conf.json` change.

## Lines

Measured from `rebuild/app` with the brief's commands. Before is `5df7da9`.

| | Before | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 17,424 | 18,161 | +737 |
| TypeScript, tests | 1,804 | 2,028 | +224 |
| CSS | 3,323 | 3,482 | +159 |
| Rust | 3,219 | 3,219 | 0 |
| **Total** | **25,770** | **26,890** | **+1,120** |

Roughly by item (app code and CSS):

| Item | Lines | Tests |
|---|---:|---:|
| Code highlighting | ~285 (incl. the incremental per-block parse, ~60) | +53 |
| Tables | ~260 | +122 |
| Images | ~160 | +7 |
| Coloured highlights | ~105 | +25 |
| Embeds | ~60 | +17 |
| Callouts | ~40 | — |

None reaches 400.

**Largest files after:**

| File | Lines |
|---|---:|
| `src/workspace.ts` | 676 |
| `src/graph/view.ts` | 649 |
| `src/styles/settings.css` | 647 |
| `src/shell/pane.ts` | 625 |
| `src-tauri/src/vault.rs` | 561 |
| `src/editor/livePreview.ts` | 547 |
| `src/appCommands.ts` | 546 |
| `src-tauri/src/index.rs` | 535 |

## Bundle

| | Before | After | Change |
|---|---|---|---|
| `index.js` | 866.6 kB (gzip 297.0) | 920.3 kB (gzip 317.9) | +20.9 kB gzipped for the whole round |
| `index.css` | 63.9 kB (gzip 11.8) | 66.5 kB (gzip 12.3) | |

The highlighting was +16.3 kB of the +20.9 (budget 60); the table, image, embed and highlight code and ten icons make up the rest.

## Performance

**Setup:**
- headless Chromium 154 at 1280×800 against Vite dev servers with the mock vault (`?synthetic=1000`);
- round 11's harness (`perf.mjs`), plus a second script that types 60 keys:
  - inside a 300-line JavaScript block (line 150, inside a string);
  - in row 20 of a 40-row table;
- the round's start (`git archive 5df7da9`) and a frozen snapshot of the final tree, each on its own server;
- four interleaved runs per side.

Means / p95 in ms, as ranges over the runs.

| | Before (`5df7da9`) | After |
|---|---|---|
| Typing on Big note (line 2,500), key → painted frame | 9.9–10.6 / 17.6–18.0 | 10.1–10.9 / 17.4–18.2 |
| Typing next to the settled 1,011-node graph | 10.0–10.8 / 18.3–18.4 | 9.3–10.8 / 17.8–18.5 |
| Typing in a 40-row table (source showing) | 9.6–11.1 / 16.8–18.2 | 10.0–11.2 / 17.6–18.8 |
| **Typing inside a 300-line code block** | **8.8–10.4 / 17.2–17.7** | **10.4–12.4 / 17.8–19.0** |
| Note switch, Welcome ↔ Big note | 16.5–17.3 / 22.5–24.8 | 16.4–16.7 / 22.3–23.1 |
| Note switch, two notes with frontmatter | 16.4 / 17.1–18.0 | 16.4 / 17.2–17.9 |
| Graph open → first painted frame | 20.6–21.5 | 20.2–20.7 (one run 28.3, as in earlier rounds) |
| Pan / wheel zoom, frame mean / p95 | 16.7 / 16.7–16.8 | 16.7 / 16.7–16.8 |
| Search key → painted frame (`alpha gamma`, `garden 12`, `e`) | 9.4–10.3, 5.4–6.1, 10.2–11.0 | 8.9–10.5, 6.0–6.4, 10.9–11.5 |

**The code block, in detail.** Before this round the block was plain text; now it is coloured. Breaking the key → frame time down:

- **Grove's own work per key is back to the round-start figure.**
  - A programmatic edit in the block takes 0.99–1.00 ms against 0.91–1.02 ms before (and 2.4–2.9 ms with nested parsing, the first version).
  - Key → animation frame is 8.2–9.9 ms against 7.4–9.2 ms.
  - The re-parse (about 1.2 ms for this block) runs after the key's frame is drawn, not before.
- **The rest is drawing.** From the animation frame to the painted frame takes 2.3–2.5 ms against 1.1–1.4 ms. That is the browser laying out and committing the ~1,200 token spans CodeMirror keeps mounted (80 lines: the 39 on screen plus its margin).
  - The same build with the block's language unknown (no spans) types at 10.0–10.2 ms, the same as before.
  - Uncoloured spans cost the same as coloured ones.
  - CSS containment, no ligatures and no kerning made no difference.
- **What could recover more.** Colouring only the lines on screen (half the spans) recovered about 0.6 ms in a trial, but it would mean re-colouring on every scroll, with uncoloured lines flashing in when scrolling fast. I left it out. This is a screen full of dense code, the worst case; a short block in a note costs a few spans.

**Other checks:**
- **Bracket pairing** in a code block is unchanged from the round's start.
- **A note** with a coloured Python block, a table, a local image, an embed with tasks and coloured highlights:
  - it opened, edited and saved correctly in Live Preview, Reading view and Source mode, checked in the browser;
  - the saved Markdown was as listed above: the table rewritten padded with a new row from Tab, `==🟢words==`, `- [x] beta` in the embedded note, and a Source-mode edit saved after it.

## Caveats

- **Measured in headless Chromium,** not in the Tauri window. The code needs nothing newer than WebKitGTK 2.54 (on this machine) provides: `Array.prototype.toSpliced`/`with`, `color-mix`, the Web Animations API and pointer capture. No Tauri window was opened this round.
- **Colours across views:** Obsidian's Reading view colours code with a different engine from its editor (more tokens: function names yellow, brackets muted). Grove has one look in all modes, Obsidian's editor's.
- **Not observed:** what plain "Toggle highlight" does inside a coloured highlight, and whether Obsidian's coloured-highlight swatch is clickable. Grove removes the highlight, and the swatch isn't clickable.
- **Not committed:** the scratch harnesses (the CDP drivers, the Obsidian sandbox and its vault, the perf scripts, the snapshots) are in the session scratchpad.
