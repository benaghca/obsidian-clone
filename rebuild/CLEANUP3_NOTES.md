# Round 14: cleanup 3 (Claude's notes)

Branch `rebuild/r14-claude`, from `98e4a99`. No features and no visible change; 27 commits (these notes included), one kind of change each.

## Summary

- **Checks:** all pass.
  - In `rebuild/app`: `npm run build`, `npm test` (158 tests in 31 files, up from 157), `npm run audit:offline`.
  - In `src-tauri`: `cargo build` and `cargo test` (32, up from 31).
- **Looks and behaves the same:** 144 headless screenshot states (72 light, 72 dark) and 18 Markdown outputs compared with the round's start.
  - 142 states are pixel-identical. The other 2 are the settings nav icon that also differs between two runs of the round-start build itself (see "How it was checked").
  - All 18 Markdown outputs are byte-identical in both themes. They cover Tab, Shift+Tab, Enter and Shift+Enter in a table, eight table menu actions, both image resizes, an embed task tick, a task tick, coloured highlights and the format commands.
- **Size:** **−241 lines net** (26,890 → 26,649, −0.9%). That is well short of the brief's 3–5%. "Lines" below says where the lines went and why it stopped there.
  - No test was deleted.
  - There is one new test in each language, plus new checks in two existing TypeScript tests (TypeScript test lines +19).
  - The Rust tests got shorter as tables, with every case kept.
- **Splits:**
  - `workspace.ts`: 676 → 639.
  - `graph/view.ts`: 649 → 609. The WebKitGTK performance code in the graph view is untouched.
  - The largest file in `src/` is now 639 lines.
- **Block code (rounds 12–13), done first:**
  - tables are one module;
  - callouts, tables and embeds share one widget kit;
  - one task-toggle rule;
  - one way for a colour to reach CSS;
  - one regex for an image's size.
- **Bugs:**
  - One fixed in its own commit: "Add file property" in Source mode put the new line in the note's body when the frontmatter closed with `--- `.
  - Two left as written down (see "Bugs found").
- **Code-block typing (item 4):** measured and traced, but not won back. The cost is the browser drawing the ~1,040 colour spans. Grove's own work per key is already at the round-start figure, and the two techniques the brief names are already in `codeHighlight.ts`. Every change I tried either changed pixels or measured as noise, so `codeHighlight.ts` is unchanged. Details are under "Code-block typing".
- **Performance:** everything the brief lists is unchanged (numbers below).
- **Dependencies:** none added or removed. No change to commands, permissions, capabilities, CSP, `CONTRACT.md` or the files Grove writes.

## Lines

Measured from `rebuild/app` with the brief's commands. Before is `98e4a99`.

| | Before | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 18,161 | 18,087 | −74 |
| TypeScript, tests | 2,028 | 2,047 | +19 |
| CSS | 3,482 | 3,436 | −46 |
| Rust | 3,219 | 3,079 | −140 |
| *of which Rust app code* | *2,243* | *2,179* | *−64* |
| *of which Rust tests* | *976* | *900* | *−76* |
| **Total** | **26,890** | **26,649** | **−241 (−0.9%)** |

**Where the lines went:**
- **Merges and removals in app code:** about −200 (TypeScript −91, CSS −46, Rust −64).
- **The two splits:** +17 net, for new headers and imports and for the moved code's documentation:
  - `workspace.ts` −37, against `tabs.ts` +30 and `editorHost.ts` +16;
  - `graph/view.ts` −40, against `graph/probe.ts` +43 and `graph/settings.ts` +5.
- **Rust tests:** −76.
  - −85 from the rewrites: resolver cases became a table, the watcher tests use a one-line expected-event helper, and link lists are compared with array literals.
  - +9 for the new wikilink test.
  - Every assertion is still there, except one duplicate: the outgoing-links check stayed, its `len() == 1` restatement went.
- **TypeScript tests:** +19, for the new and extended tests.

**Why it stopped at −241:**
- The previous cleanups (rounds 8 and 11) had already taken the copy-paste.
- A duplicate-run finder over all TypeScript and CSS found no repeated runs of 4+ lines left.
- A rule-by-rule CSS comparison found only the few true duplicates merged below.
- The language-service passes (below) found a handful of dead items in 18,000 lines.
- What remains are similar-looking pieces that behave differently in edge cases, listed under "Chose not to simplify". Merging those would change what Grove shows or writes.
- I didn't join lines, strip comments or delete tests to reach a number.

**Largest files:**

| Before (`98e4a99`) | | After | |
|---|---:|---|---:|
| src/workspace.ts | 676 | src/workspace.ts | 639 |
| src/graph/view.ts | 649 | src/styles/settings.css | 629 |
| src/styles/settings.css | 647 | src/shell/pane.ts | 620 |
| src/shell/pane.ts | 625 | src/graph/view.ts | 609 |
| src-tauri/src/vault.rs | 561 | src-tauri/src/vault.rs | 554 |
| src/editor/livePreview.ts | 547 | src-tauri/src/index.rs | 531 |
| src/appCommands.ts | 546 | src/editor/livePreview.ts | 530 |
| src-tauri/src/index.rs | 535 | src/appCommands.ts | 528 |
| src/editor/properties.ts | 509 | src/editor/properties.ts | 512 |
| src-tauri/src/watch.rs | 495 | src/settings/sections.ts | 495 |
| src/settings/sections.ts | 495 | src/main.ts | 472 |
| src/main.ts | 473 | src/shell/menus.ts | 467 |
| src/shell/menus.ts | 471 | src/noteEditors.ts | 465 |
| src/noteEditors.ts | 465 | src-tauri/src/watch.rs | 442 |
| src/styles/editor.css | 421 | src/styles/editor.css | 417 |

## Module map (created, split, merged or renamed)

| File | Lines | What it owns |
|---|---:|---|
| `src/editor/tables.ts` (merged with `tableEdit.ts`) | 270 | Pipe tables, all of them. It parses rows: one pipe scanner, used by `splitRow` and by `tableAt`'s column count, which had its own copy of the escape loop. It draws the table widget. It holds the table model and Obsidian's padding, every row/column/align/sort operation, Tab/Enter/Shift+Enter and the one-transaction rewrite. |
| `src/editor/tables.test.ts` (was `tableEdit.test.ts`) | 122 | Unchanged tests, now beside the module they test. |
| `src/editor/render.ts` | 213 | Now also what every drawn widget shares: `DrawnWidget`, and `BlockWidget` (a callout's or table's text, chain and file version, and its click-to-edit box with "Edit this block"). Also `editAt` and `readingMode`. Callouts and tables used to import their base class from `embeds.ts` and `editAt` from each other. |
| `src/editorHost.ts` (was `embedHost.ts`) | 105 | What the editor modules ask of the app (`editor/host.ts`), in one place: following links, notes, the editor menu, properties, link existence, and the embeds' files. The workspace used to build the first half inline in its constructor. |
| `src/tabs.ts` | 109 | Now also three pure tab-model operations, tested: `pushBack` (what a tab showed goes on its back history; `open()` and `openImage()` had two copies), `tabFollowsMove` and `tabForgets` (a tab following moved or deleted files). |
| `src/workspace.ts` | 639 | Tabs, groups, splits, navigation, closing and Undo close tab, following files, the saved layout. |
| `src/graph/probe.ts` (new, out of `view.ts`) | 43 | Dev builds only: `__graphWork` and `__graphProbe` for the measuring harness. Release builds compile it out, as before. |
| `src/graph/settings.ts` | 43 | Now also which `graph.json` keys move the forces and which change the nodes (`FORCE_KEYS`, `DATA_KEYS`, `changedIn`). |
| `src/graph/view.ts` | 609 | Model, frame loop, resolution choice, typing yield, settings and data. The performance code (whole-pixel canvas, one-device-pixel links, low resolution only when full is too slow, every-other-frame settle, typing yield, nine-slice shadow, whole-device-pixel labels) is byte-for-byte as it was. |

**Import cycles:** none, before or after. Checked with a script over every value import; type-only imports are skipped.

## The block code (item 3)

- **Tables:**
  - `tables.ts` and `tableEdit.ts` are one module with one pipe scanner.
  - A table column's "fresh" cell parameter, which no caller passed, is gone.
- **Block widgets:**
  - `CalloutWidget` and `TableWidget` had the same constructor (text, chain, file version) and the same mousedown handler (left button, not a link; outside Reading view, caret to the source; prevent default). Both are now `BlockWidget` in `render.ts`.
  - Callouts keep their fold-on-title behaviour through the box's `own` hook.
  - `readingMode` moved to `render.ts`, next to the rendering it switches, so callouts and tables no longer import `livePreview.ts`.
- **Task checkboxes:** Live Preview's checkbox ticked a task with its own regex (`toggleTask`). It now uses `toggledTask`, the rule embeds use, so there is one rule for which box a tick flips. A new test covers a line on its own (`  * [X] …`).
- **Highlight drawing:**
  - Six CSS rules mapped `cm-highlight-<colour>` classes to `--highlight-color`. The mark and its swatch now carry the custom property themselves, as a callout box carries `--callout-color`.
  - The swatches' own decoration cache joined the mark/line cache.
- **Plain widgets:** the checkbox and remote-image widgets get `eq` and `ignoreEvent` from `DrawnWidget`, which compares the same fields.
- **Image sizing:** `embedSize` and `resizedSize` read the size suffix with one regex.
- **CSS (`blocks.css`, `editor.css`):**
  - `.cm-formatting-code-fence { color: faint }` restated `.cm-formatting`, which every fence mark also has.
  - `.cm-formatting-header`'s `font-weight: 400` restated `.cm-formatting`'s `normal`.
- **Lifetimes:** the embed host's per-file watcher sets are `listeners()` lists, like the app's other callbacks.
- **Callout title and fold, block detection:** already single paths. Rendered text paints the same decorations as Live Preview (`render.ts`), so there is no second block detector or callout renderer to merge.

## Code-block typing (item 4)

**The measurements:** typing 100–150 keys inside the 300-line JavaScript block, key → painted frame. Mean ms, ranges over interleaved runs, all three builds side by side.

| Build | Mean |
|---|---:|
| Round-13 start (`5df7da9`, no highlighting) | 9.5–10.5 |
| Round-14 start (`98e4a99`) | 10.5–11.7 |
| This branch | 10.1–11.3 |

The +1.1 ms is real, and this round does not win it back.

**Where it goes:**
- **The DOM work per key is identical to round 12.** A mutation observer shows one text node changing in one line per key, on all three builds.
- **The key's own JavaScript is the same.** A CPU profile shows `dispatch` → `update` taking the same time on the key as in round 12.
- **The re-parse runs after the key's frame is drawn.** It takes about 0.7 ms per key (0.5 ms of Lezer re-parsing). Disabling it entirely left key → frame unchanged (10.6–11.3 ms with it, 11.1–11.4 ms without), so it is not what makes the key slower.
- **The rest is the browser.** A timeline trace shows the extra time in style recalculation, paint and the forced layout inside the input event (EventDispatch +0.75 ms, Paint +0.45 ms per key). Each of these walks the ~1,040 token spans CodeMirror keeps mounted. This matches round 13's finding that the same build with an unknown language types at round-12 speed.

**What the brief points to is already there:**
- `codeHighlight.ts` re-parses only the edited block, reusing its tree fragments (`TreeFragment.applyChanges`).
- For any edit, it maps the decorations at once and re-colours after the frame.
- So Codex's two techniques are already in place. What Codex's branch drew differently was fewer colours (no parameter or macro colours), which means fewer spans.

**What I tried, and why none was kept:**
- **No span for "plain" tokens** (definitions, `.`, `null`): these are 15% of the spans and have no colour. Typing improved by about 0.2 ms, but removing the span boundaries moved some glyphs by a sub-pixel. Screenshots of the code block differed (the pixels moved, not the colours), which fails the "no difference" check.
- **`contain: paint` on code lines:** no change beyond noise.
- **Colouring only the lines on screen:** rejected again for the reason round 13 gave. Lines would flash in uncoloured while scrolling.

`codeHighlight.ts` is unchanged (224 lines). Round 15 could weigh fewer spans against a sub-pixel change if the owner wants the 1 ms back.

## Removed as dead or duplicated, and how it was checked

**How:**
- `tsc --noEmit`, which already enforces `noUnusedLocals` and `noUnusedParameters`.
- The tests, and an import-cycle script.
- Five passes with TypeScript's language service. It was a TypeScript 6.0.3 copy already on the machine (in an editor's bundle), loaded read-only from a scratch script; the project still builds with its own TypeScript 7. The passes looked for:
  - declarations and members with no references;
  - members that are written but never read;
  - functions whose every call discards the result;
  - optional parameters no call site passes;
  - single-caller declarations.
- For CSS:
  - a static scan of every class against the TypeScript and HTML;
  - a runtime selector-coverage pass over all 144 screenshot states;
  - a scan of custom properties defined but never read;
  - a rule-by-rule comparison of declarations.
- A scan of every icon name.

Everything removed was checked by hand against its callers.

**Dead:**
- `settings/controls.ts` `note()`: no section calls it, and its `mod-standalone` class has no CSS.
- `openPrompt`'s returned `Prompt` handle (`close`, `query`): all five pickers call it for its effect only.
- The `whole-word` icon: unused since round 11 dropped the core plugins' own icons.
- `dateNamePattern(...).regex`: only the tests read it; they now check `parse` instead.
- Parameters no caller passes: `animateOut`'s class, `linkTo`'s subpath and default note, the graph panel's inverted toggles, the default arguments of `closeGroup`, `closeAllOthers` and `neighbour`, and `pad`'s width.

**Duplication merged:**
- **The block code** (above).
- **Copying text:** `writeClipboard` is the one way to copy text. Copy path, Copy URL, both copy-path commands and the settings' Copy path each called `navigator.clipboard` with their own warning, and the settings received the function through their context.
- **Properties:** `showsBlock()` is the one rule for when the frontmatter shows as the Properties block. `build`, `covered` and `openNewProperty` each spelled it out.
- **"Add file property":** it found the closing `---` itself. It now uses `frontmatterField` and `addLines` (and that fixed a bug, below).
- **Shell factory types:** `LeftSidebar`, `RightSidebar`, `Sidedocks`, `Panes`, `TabStrip` and `GraphView` were interfaces that restated, member by member, what their create function returns. They are now `ReturnType<typeof create…>`, the idiom `menus.ts` already used. The members' notes moved onto the returned objects.
- **CSS:**
  - one modal box rule for the prompt, settings and confirm dialog;
  - one rule for the dock content and the two left-sidebar views;
  - one rule for the settings close button and the small buttons beside controls;
  - one base rule for the filter pills and hotkey chips;
  - a `--focus-ring` token for the 2 px ring written out eight times;
  - one rule for the graph panel's two corner buttons;
  - no restated `.tag-pane-tag .collapse-icon` offset.
- **Rust:**
  - `wiki_targets` uses `str::find` instead of a byte-pair scanner with its own `find_bytes`, with a new test also run against the old code;
  - `clean_target` uses `split`;
  - `visible` and `visible_files` are one function, and the watcher's event arms `extend` their sets;
  - `rel_of`, `norm_logical` and `yaml_scalar` return with `then`/`then_some`;
  - `entry_for`'s fallback uses `FileEntry::default()`.

## Bugs found

1. **Fixed:** "Add file property" put the new line in the note's body (`a617bbd`).
   - **When:** in Source mode, or wherever the block isn't shown, on a frontmatter closed by `--- ` (trailing spaces). Grove and Obsidian both read that line as closing the frontmatter.
   - **Why:** the command looked for a line that was exactly `---`.
   - **Reproduced** on the round's start in the browser: the line went before the next `---` in the body.
   - **The fix:** the command now uses the frontmatter the Properties block reads, with a test. Notes with a plain close, no frontmatter, or an unclosed one get byte-for-byte what they got before (checked on both builds).
2. **Not fixed:** after Tab adds a row to a table, the caret lands after the empty cell's padding. Typing then gives `|                     new<br>|`. The cell's text is right, and the next table edit pads it, but in Obsidian the text goes inside the padded cell. Changing where the caret lands is a visible change, so this is for round 15.
3. **Not fixed (an inconsistency more than a bug):** five places skip fenced code, each with its own rule. They are:
   - the tag reader (`Fences`, which matches the backend);
   - outgoing links (`wikilinkTargets`: any backtick or tilde line toggles);
   - unlinked mentions (marker and length, up to 3 spaces of indent);
   - the link rewrite on rename (marker only, any indent);
   - embed sections (any fence line toggles).

   They agree on ordinary notes and differ on odd fences (nested fences of different lengths, deep indents). Making them one would change what those views show for such notes.

## Dependencies

None added or removed. The offline audit's allowlist is unchanged and accurate (`npm run audit:offline` passes).

## Performance

**Setup:**
- Headless Chromium 154 at 1280×800, against Vite dev servers with the mock vault plus test notes. `?synthetic=1000` was used for the Big note, switching, search and the graph.
- The round's start (`git archive 98e4a99`) and a snapshot of this branch, each on its own server.
- Interleaved runs: three for typing; five for note switching; six for search, graph open, pan and wheel.
- Each cell is mean / p95 ms as a range over the runs, unless noted.

| | Before (`98e4a99`) | After |
|---|---|---|
| Typing on Big note (line 2,500) | 9.5–11.3 / 16.4–18.9 | 9.7–10.8 / 17.0–18.5 |
| Typing inside a 300-line code block | 11.0–11.7 / 18.4–18.9 | 10.1–11.3 / 18.1–19.3 |
| Typing in a 40-row table | 10.1–10.4 / 17.4–18.1 | 10.1–10.4 / 17.1–18.1 |
| Note switch, Welcome ↔ Big note (means) | 15.9–16.0 | 15.9–16.1 |
| Note switch, two notes with frontmatter (means) | 15.9–16.0 | 15.9–16.0 |
| Search key → results painted, `alpha gamma` (means) | 9.9–11.3 | 10.9–11.2 |
| Search, `garden 12` (means) | 5.9–7.4 | 6.0–8.1 |
| Search, `e` (means) | 10.9–17.9 | 10.9–14.3 |
| Graph open → first painted frame (median of 6) | 29.1 (28.3–31.1) | 29.5 (28.5–30.4) |
| Pan, frame mean / p95 | 16.7 / 16.7–16.8 | 16.7 / 16.7–16.8 |
| Wheel zoom, frame mean | 29.2–29.9 | 29.2–30.6 |

**Notes on the numbers:**
- Same speed throughout.
- The graph-open figure includes dispatching the command, so it is not comparable with earlier rounds' 21 ms.
- Nothing moved onto the per-keystroke path. Highlighting still covers only the visible ranges and re-parses only the edited block.

**Bundle:**
- `index.js`: 920.29 → 919.10 kB (gzip 317.89 → 317.77).
- `index.css`: 66.53 → 65.44 kB (gzip 12.34 → 12.28).

No WebKitGTK numbers were taken and no Tauri window was opened. Nothing in this round changes what the webview is asked to do, and the Rust changes are covered by `cargo test`.

## How it was checked

All of this ran from the session scratchpad and is not committed.

**Setup:**
- The round's start was extracted with `git archive` and served by its own Vite server, sharing `node_modules`.
- The branch was served from a synced snapshot, so checks ran while work went on.
- Chromium was headless with a fresh profile per scenario, driven over CDP by a small dependency-free script.

**Test notes**, added to the mock vault through its own `create_note`:
- `Blocks14`, with:
  - yellow, red, green, blue, purple and orange highlights;
  - a `%%comment%%` and a comment block;
  - a tip callout with a list;
  - a folded warning;
  - an open callout holding a table;
  - an aligned table;
  - `![[photo.png|200]]` and `![a photo](…)`;
  - a `![[Tasks14]]` embed;
  - Python, JavaScript and Rust code;
  - tasks.
- `Tasks14`.
- A 300-line code block and a 40-row table.
- Two notes with frontmatter.

**States, light and dark:**
- Live Preview, Reading and Source, at three scroll positions.
- The caret in a highlight, a callout, the table, code, the embed, the image, a comment block and a task.
- The table's right-click menu and its Row submenu in Live Preview, and the menu in Reading view.
- Image hover, the lightbox open and closed.
- A callout unfolded, and still unfolded after scrolling away and back.
- Every settings page.
- Search, the command palette and the editor menu.
- The right sidebar's five views on a note with frontmatter.
- The graph.

**Markdown written:** Tab, Shift+Tab, Enter and Shift+Enter in a table, Tab in Source mode, eight table menu actions, both image resizes, an embed task tick (and the host note left alone), a task tick, five coloured-highlight commands and nine format commands. All are identical to the round's start.

**Flaky states, on both sides:**
- The harness holds the caret's blink and the toggles' slide still.
- The settings nav icon of the clicked item still varies run to run (round 11 noted the same). A rerun of the round's start against itself differs in exactly those states.
- The search pane's scrollbar flashed once in a parallel run and not in any rerun.

## Chose not to simplify, and why

- **The five fenced-code trackers and the four wikilink/tag regexes** (`links/internal.ts`, `linksTags.ts`, `mentions.ts`, `unlinked.ts`). Each feeds a view or a file write, and each has different edge rules: what a target may contain, `^` blocks, indents. One shared version would change what some notes show or how a rename rewrites them.
- **`headingPos` and `embedSection`.** They find a heading or a `^block` by slightly different rules (fences skipped or not, case of the block id). They differ in which line a link opens on and what an embed shows.
- **Live Preview's callout check** (`> [!` prefix) **and `calloutHeader`** (a complete `[!type]`). While a header is being typed, Live Preview shows all of the quote's `>` markers. Using `calloutHeader` there would show only the caret line's marker until the `]` is typed.
- **Source mode's code band and Live Preview's.** A one-line fence (an unclosed ``` at the end of a note) gets the end-of-block rounding in Live Preview but not in Source mode. Sharing one helper would change one of them.
- **The `--code-*` tokens** stay as theme tokens, like the callouts' colours. Moving code colours to inline styles would put a style attribute on every token span on the typing path.
- **Two smaller merges that didn't pay:**
  - A shared "record a hotkey" helper for Settings → Hotkeys' two key listeners, and one nav-marking function in the settings modal. Each came out one or two lines longer.
  - A shared "list in a map" or "toggle in a set" helper (four or five two-line uses each) would have cost as many lines as it saved.
- **The mock backend's link resolution.** It is a dev fixture, and the screenshot comparisons depend on it. Changing it would change the baseline that every check here compares against.
- **`appCommands.ts`, `menus.ts` and `settings/sections.ts`.** They are mostly data, and none is near the limit.
- **Comments.** None were removed to save lines. The ones that moved (interface notes onto returned objects) kept their text.

## Round 14 comparison (added at merge)

Three agents did this brief from `98e4a99`. Claude's branch was merged as is (`476b5c6`); nothing was ported from the other two.

| Rank | Model | Net lines | Splits done | Bugs fixed | Visible change (headless before/after, 5 states) |
|---|---|---:|---|---|---|
| 1 | Claude | −241 (26,649) | `workspace.ts` 639, `graph/view.ts` 609 | 1 (Add file property with a `--- ` close) | none (2 stray pixels in the tab strip, also seen once on Codex) |
| 2 | Codex | −28 (26,862) | `workspace.ts` 648, `graph/view.ts` 620 | 0 | none |
| 3 | Grok | −11 (26,879) | `workspace.ts` 540, `graph/view.ts` 641 | 0 | none |

- **Why Claude:** the only branch that made a real dent in the size, while also uniting the round 12–13 block code (one table module, one widget kit for callouts/tables/embeds, one task-toggle rule, one colour path to CSS, one image-size regex), fixing a real bug and keeping every screenshot and written Markdown identical.
- **Codex's best idea:** pure table helpers in their own `editor/tableData.ts`, and moving shared editor facets into `editor/host.ts` so nothing imports Live Preview just to read a facet. Not ported: Claude's merged table module already covers the first, and the second would conflict with Claude's `editorHost.ts` rename. Worth a look next cleanup.
- **Grok's best idea:** recolour code only when an edit touches a fence, and the cleanest `workspace.ts` split (an `openNote.ts` that owns where notes open and Back/Forward). Not ported: Claude measured fence-only recolouring as noise or a pixel change, and two different `workspace.ts` splits can't be combined cleanly.
- **Checks after merge (on the owner's machine):** `npm run build`, `npm test` (158/158), `npm run audit:offline`, `cargo build`, `cargo test` (32/32) all pass.
