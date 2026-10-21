# Round 11: cleanup 2 (Claude's notes)

Branch `rebuild/r11-claude`, from `ff1debd`. No features, no visible change; 37 small commits (these notes included), one kind of change each.

## Summary

- **Checks:** `npm run build`, `npm test` (131 tests in 28 files, up from 126 in 27), `npm run audit:offline`, `cargo build` and `cargo test` (30, up from 29) all pass.
- **Splits:** all four files the brief names are split. No file in `src/` is over 657 lines (was 761).
- **Looks and behaves the same:** 68 headless screenshot states, light and dark, are pixel-identical to the round's start. Interaction scripts give the same output on both. Details are under "How it was checked".
- **Size:** **−111 lines net** (24,396 → 24,285), or **−204 lines of app code** not counting the 93 lines of new tests. This is well short of the brief's 700–1,200 aim. What it cost and why it stopped there is under "Lines".
- **Bugs:** three found and fixed, each in its own commit and each tiny:
  - a Rust panic on file names ending in an emoji;
  - a stale All properties view;
  - unlinked mentions inside a `...`-"closed" frontmatter.
- **Speed and dependencies:** no performance regression. No dependency added or removed. `CONTRACT.md` is unchanged, and there is no new command, permission or setting.

## Lines

Measured from `rebuild/app` with the brief's commands. Before is `ff1debd`.

| | Before | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 16,380 | 16,294 | −86 |
| TypeScript, tests | 1,623 | 1,716 | +93 |
| CSS | 3,191 | 3,108 | −83 |
| Rust (tests inline and in `index/tests.rs`) | 3,202 | 3,167 | −35 |
| **Total** | **24,396** | **24,285** | **−111 (−0.5%)** |

Without the new TypeScript tests, app code went down by 204 lines (Rust's +9 test lines are inside its −35).

**Where the lines went:**
- **The four splits cost about +110.** Each new module needs a header, imports and an interface:
  - `workspace.ts` + `vault.ts` + the hooks moved into `fileOps.ts`: +19;
  - `pane.ts` + `tabStrip.ts`: +20;
  - `graph/view.ts` + `input.ts` + the neighbour lists in `data.ts`: +65;
  - `properties.ts` + `propertyFields.ts`: +5.
- **The merges and deletions came to about −310** (Rust −44 of it).
- **New tests: +93 TypeScript and +9 Rust.**
  - the properties index (+66);
  - search result building (+16);
  - the neighbour lists (+9);
  - unlinked mentions (+2);
  - Rust `is_note_path` (+9).

**Why it stopped at −111:**
- Round 8 had already removed the easy duplication. A check of every class and interface member found only one unused member (`ws.scroller`).
- A duplicate-run finder found almost no copy-paste left.
- What was left was many small overlaps. I merged them where the result was clearer. I didn't press lines together or strip comments to reach a number.
- The candidates I looked at and left alone are listed at the end, with reasons.

**Largest files:**

| Before (`ff1debd`) | | After | |
|---|---:|---|---:|
| src/workspace.ts | 761 | src/workspace.ts | 657 |
| src/shell/pane.ts | 743 | src/graph/view.ts | 649 |
| src/graph/view.ts | 733 | src/styles/settings.css | 647 |
| src/styles/settings.css | 681 | src/shell/pane.ts | 606 |
| src/editor/properties.ts | 622 | src/appCommands.ts | 540 |
| src/appCommands.ts | 540 | src-tauri/src/index.rs | 535 |
| src-tauri/src/index.rs | 538 | src-tauri/src/vault.rs | 511 |
| src/settings/sections.ts | 534 | src/editor/properties.ts | 509 |
| src-tauri/src/watch.rs | 522 | src-tauri/src/watch.rs | 495 |
| src-tauri/src/vault.rs | 511 | src/settings/sections.ts | 495 |
| src/main.ts | 484 | src/main.ts | 472 |
| src/noteEditors.ts | 470 | src/noteEditors.ts | 465 |
| src/styles/editor.css | 434 | src/styles/editor.css | 421 |
| src-tauri/src/index/parse.rs | 426 | src/shell/menus.ts | 420 |
| src/shell/menus.ts | 420 | src/shell/sidebar.ts | 418 |

## Module map (created, split or merged)

| File | Lines | What it owns |
|---|---:|---|
| `src/vault.ts` (new, out of `workspace.ts`) | 105 | The open vault, as `ws.vault`, which already held its path and name. It holds the file list, the notes, the link index, excluded files (`includedNotes`), link targets (`linkExists`) and our own saves (the link index is read again a moment later). It also handles changes on disk (`vault-changed`). |
| `src/workspace.ts` | 657 | Tabs, groups, splits, navigation and history, closing and Undo close tab, following renames and deletes, and the saved layout. |
| `src/fileOps.ts` | 163 | Now also `fileSettings`: the file operations' hooks, moved off `Workspace` (their only user). They are: the new-note folder, the editing mode for new notes, trash or delete, the delete and merge confirmations, and rename → update links. |
| `src/shell/tabStrip.ts` (new, out of `pane.ts`) | 157 | A group's tab strip: tab headers kept per tab id and animated open and closed, New tab, the tab list chevron and the right-sidebar toggle. It starts tab drags (`tabDrag.ts`). There is one header map instead of two. |
| `src/shell/pane.ts` | 606 | The split tree and its dividers, the graph tabs, and each pane's view header, note view, backlinks and column hold. |
| `src/graph/input.ts` (new, out of `view.ts`) | 132 | Pointer events on the canvas turned into gestures: hover, node drag, click, pan, wheel and menu. The view decides what each does. |
| `src/graph/view.ts` | 649 | Model, frame loop, resolution choice, typing yield, settings and data. Drawing stays in `draw.ts`. |
| `src/graph/data.ts` | 234 | Now also `neighbours()`, the packed neighbour lists for hover (pure, tested). |
| `src/editor/propertyFields.ts` (new, out of `properties.ts`) | 118 | Type icons and names, the Property type submenu (shared with the All properties view), and the two suggesting fields a row is made of. |
| `src/editor/properties.ts` | 509 | The Properties block's decorations and caret guard, and the Block widget: rows, menu, clipboard and the mismatch flow. |
| `src/perWorkspace.ts` (new) | 14 | "One per workspace", replacing three copies of the same WeakMap pattern (tag reader, properties index, search facts). |
| `src/shell/vaultTags.ts` | 52 | Now *the* tag reader, one per workspace. Its result is kept until the vault changes. Frontmatter tags come from the `frontmatter` command. |
| `src/shell/sideView.ts` | 118 | Now also `liveData()`: the read-while-shown state the Tags and All properties views both had. `section()` folds with `foldToggle()`. |
| `src/shell/searchQuery.ts` | 277 | Now also the pure result building: `matchingNotes`, `propertyLine` and `spansOf`, tested. |
| `src/editor/config.ts` | 125 | `EditorConfig` is the app.json settings it uses, by name, with the schema's defaults. |

**Import cycles:** none. The check was a script over all value imports. Type-only imports and the existing type-only cycles, such as `tabDrag` ↔ `pane`, are not counted.

## What was removed or merged, and how it was checked

### Dead code

**How it was found:**
- A find-references pass, using the TypeScript language service, over every class, interface and object member, counting reads only.
- A scan for exports with no importers.
- For CSS: testing every selector with `querySelector` in each of the 68 states, then checking the never-matched ones by hand against the code that makes the classes. Most never-matched selectors are real states the list doesn't reach, such as closing animations, the frameless window or print.

**What was dead:**
- `ws.scroller` and `NoteEditors.scrollerOf`: no callers.
- The core plugin list's per-plugin `icon`: nothing reads it.
- The `mod` parameter of `settings/controls.ts` `button()`: never passed.
- 14 exports used only in their own module were unexported (no line change).
- CSS:
  - the `::-moz-range-thumb` block (Grove never runs in Gecko);
  - `-webkit-appearance` next to `appearance`;
  - three dark-theme tokens that restated the light value;
  - the lint and active-line gutter rule (neither extension is loaded);
  - the settings modal's `mod-cta`/`mod-warning` buttons (no settings button has them);
  - the whole `.search-input` block. Its two inputs sit in `.search-input-container`, whose more specific rules set every one of those declarations, the focus state included.

### Duplication merged

**Round 10 overlaps the brief named:**
- **Tag reader:**
  - The Tags view, search's facts and the properties index each built their own tag reader, each with its own frontmatter cache. Two of them also cached the result until the vault changed.
  - Now there is one reader, so a vault change triggers at most one tag read instead of up to three.
  - It no longer reads each tagged note's full text (one IPC call per note, plus an mtime cache). It asks the round 10 `frontmatter` command for just those blocks, in one call.
- **Tags view and All properties view:** they carried the same active/stale/timer/sequence code. It is now `liveData()`.
- **Search view:** it asked the properties index a second time. The facts it already waits for now carry each note's frontmatter lines.
- **Merge prompt:** it listed notes with its own copy of the quick switcher's rules (recent first, never itself, at most 50, fuzzy best first). It now uses `switcherItems`.
- **Settings store:** `hotkeys.json` and `types.json` were set by two copies of the same copy-set-emit-schedule steps. They now share one path.

**Hand-built copies of an existing helper:**
- Settings rows built by hand where `row()` makes the same element: the hotkeys page and the graph panel.
- Toggle rows built by hand where `toggleRow()` does the same (it gains an `invert`).
- Settings pages wrapped in a `div` that the modal's section element already provides.
- `section()` re-implemented `foldToggle()`.
- **`h()` field attributes:** fields were made with `h()` and then given `type`, `placeholder`, `spellcheck`, `value` and so on one line each. `h()` now takes these as attributes. Editor widgets, the fold chevron (a hand-drawn Lucide SVG) and the highlight spans use `h()`/`icon()`.
- `links/internal.ts`: the strip-heading-and-decode block appeared twice.
- Editor config: its own names and defaults for ten app.json settings, copied field by field in `main.ts`.

**Rust:**
- `Note::frontmatter` (round 10) and `parse_aliases` each found the closing `---`. There is now one lazy `frontmatter_close()`.
- The watcher's rename bookkeeping: one record per tracker, one arm for both halves, and no `get_mut().unwrap()` after registering.
- `display_name` reuses `strip_md`.

**CSS:**
- One base rule for the dropdown and the three kinds of button.
- Source mode's tag pill and URL underline share Live Preview's.
- The property suggestions share the link suggester's popover box.
- The graph panel buttons restated `.clickable-icon`, whose class they already have.
- One rule for white on the accent, and one for white on red.

**Each merge was checked with:**
- `tsc`;
- the tests;
- the screenshot states for what it touches (new states were added as needed: hotkeys, hovers, editor settings, Source mode, folding and others);
- where behaviour could differ, a small script run against the round's start and the branch, comparing output.

## Bugs found

All three are fixed, each in its own commit.

1. **Rust `is_note_path` panicked on a name ending in a multi-byte character** (`a😀`). It sliced the last three bytes inside the character. This was found in round 8 and left open. It now uses `str::get`, with a test (`7a9c642`).
2. **All properties view kept an old type icon.** If a property's type was chosen while the view was hidden (another right-sidebar view selected), showing the view again kept the old icon. A refresh was scheduled, but the view was never marked stale. Reproduced against the round's start (`7945c83`).
3. **Unlinked mentions treated a YAML `...` line as closing the frontmatter.** Round 10 made Grove stop doing that, as Obsidian doesn't, so mentions on those lines were missed. It now uses `splitFrontmatter()`, with a test that fails on the old code (`377eeb8`).

## Dependencies

None added or removed. All the npm and Cargo dependencies are still in use.

For the find-references pass, a TypeScript 5 copy that was already on the machine (in an editor's bundle) was loaded read-only from a scratch script. The project itself is unchanged and uses its own `typescript` 7 for `tsc`.

## Performance

**Setup:**
- Headless Chromium (Vite dev server, mock vault plus `?synthetic=1000`), with the round 10 harness (`perf.mjs`).
- A note switch between two notes with frontmatter was added.
- Three interleaved runs per side. Each cell below is a mean / p95 in ms, or the range of the three means.

| | Before (`ff1debd`) | After |
|---|---|---|
| Typing on Big note (line 2,500) | 10.7–10.9 / 17.7–18.1 | 9.4–11.3 / 17.4–17.7 |
| Typing next to the settled 1,011-node graph | 10.5–11.2 / 18.0–18.4 | 10.3–10.6 / 16.9–18.3 |
| Note switch, Welcome ↔ Big note | 16.6–16.7 / 22.7–22.8 | 16.4–16.6 / 22.4–23.7 |
| Note switch, two notes with frontmatter | 16.4 / 17.1–17.6 | 16.4 / 17.2–17.4 |
| Pan / wheel zoom at 100% (frame mean / p95) | 16.7 / 16.7–16.8 | 16.7 / 16.7–16.8 |
| Search key → painted frame, `alpha gamma` | 9.2–9.8 | 9.1–9.7 |
| Search key → painted frame, `garden 12` | 5.6–5.8 | 5.6–6.8 |
| Search key → painted frame, `e` | 10.7–11.4 | 10.8–12.4 |
| Graph open → first painted frame | see below | see below |

**Graph open:** in the three-run table the work side had one sample at 28.5 ms. A dedicated measurement settled it: 10 fresh pages each, interleaved, from the command to the first painted frame.

| | Median | Range | First frame's graph work |
|---|---:|---:|---:|
| Before | 22.9 ms | 20.2–25.9 ms | 3.8–4.7 ms |
| After | 21.3 ms | 20.3–27.1 ms | 3.8–4.2 ms |

Same speed.

**Bundle:** `index.js` 850.6 → 848.4 kB, `index.css` 62.6 → 60.3 kB.

**Nothing moved onto the per-keystroke path:**
- The properties index is still lazy and incremental (now tested).
- Counts and link styling are untouched.
- Search still parses its query once per change.

**Graph performance code:** the WebKitGTK fixes in `graph/view.ts` and `draw.ts` were not touched:
- whole-pixel canvas;
- one-device-pixel HiDPI links;
- low resolution only when full resolution is too slow;
- every-other-frame settle;
- the 400 ms typing yield;
- the nine-slice shadow;
- whole-device-pixel labels.

No WebKitGTK numbers were taken, and no Tauri window was opened.

## How it was checked

All of this ran in the session scratchpad and is not committed.

**Setup:**
- The round's start (`ff1debd`) was extracted with `git archive` and served by a second Vite server with its own copy of `node_modules`.
- Headless Chromium was driven over CDP, with a fresh profile per state.

**Screenshots:** 68 states, light and dark, compared pixel for pixel:
- the editor with frontmatter in Live Preview, Reading and Source;
- the Properties type menu, name, value and tag suggestions;
- search with operator and `[property]` queries;
- All properties, Tags, Backlinks, Outgoing and Outline views;
- the file tree;
- every settings page, settings search and the hotkey states;
- the confirm dialog;
- the command palette, quick switcher and `[[` suggester;
- tab, editor and graph menus;
- tab drag overlay and drop;
- folding and the fold chevron on hover;
- the graph, its panel, colour groups, tag nodes, button hover and the local graph.

All are identical. The one exception is a settings nav icon that varies run to run *on both sides*. It is the clicked item's 14 px icon: four runs each gave the same two variants on the round's start and on this branch.

**Interaction scripts**, run on both sides with identical output:
- Properties: edit, pick a suggestion, add, rename, change the type, list pills, remove.
- The round 10 All properties script: sorts, filter, search, type submenu, core plugin off.
- Graph gestures: hover, drag, pan, wheel, menu, click and Ctrl+click.
- Merge prompt lists and settings store writes.
- Every toggle on the Editor and Files and links pages.
- Backlinks and Outgoing sections, folding by header and by chevron.
- Tags across a 300-note synthetic vault.
- Editor settings reaching the editor.

## Chose not to simplify, and why

- **`shell/suggest.ts` vs the `[[` suggester vs the prompt** — they already share the fuzzy ranking, the highlighting and the suggestion CSS (`fuzzy.ts`, `prompt.css`); the CSS now shares the popover box too. They aren't merged further, for three reasons:
  - The `[[` suggester is CodeMirror's autocompletion: its keymap, positioning, and keeping the element while the query is refined.
  - The prompt is a modal that owns focus.
  - Suggest is a popover that never takes focus.

  Making one serve the others would change how each behaves. Reusing the prompt's `suggestionText()` in `suggest.ts` would have added lines.
- **`propertyIndex.ts` vs the tag parser in `linksTags.ts`:**
  - The index now shares the backend call (`frontmatter`) and the one-per-workspace cache.
  - The YAML readers stay separate. Properties are strict (unreadable YAML becomes read-only). Tags are lenient, as Obsidian's tag pane is.
  - Reading tags through `readProperties` would drop tags from notes whose frontmatter has one odd line.
- **The Tags view's and All properties view's row rendering:** the DOM differs (nested tags with chevrons vs a flat list with type icons). A shared row helper came out longer than the two calls.
- **One tab-header helper for both sidebars, and one overlay helper for the three modals:** each came out line-neutral. Left as they are.
- **`-webkit-mask` next to `mask` (the external-link and remote-image icons):** older macOS WebKit may still need the prefix, so it stays.
- **`cm-blink` / `cm-blink2` keyframes:** identical bodies, but CSS can't give one `@keyframes` two names, and CodeMirror alternates the two names.
- **The graph's dev-only `__graphProbe` / `__graphWork` hooks:** the measuring harness (this round's and earlier ones) depends on them. They are compiled out of release builds.
- **`appCommands.ts` (540), `menus.ts` (420), `sections.ts` (495):**
  - They are mostly data: command definitions, menu items, setting rows.
  - Splitting them would move lines without removing any.
  - They are 110+ lines under the limit.
