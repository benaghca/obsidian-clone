# Round 10: properties and search, the way Obsidian has them (Claude's version)

All six items are done; the gaps that remain are listed at the end. Branch `rebuild/r10-claude`, from `5ff2789`.

- **Checks:**
  - `npm run build`, `npm test` (126 tests in 27 files, up from 118) and `npm run audit:offline` pass.
  - `cargo build` and `cargo test` (29, up from 28) pass.
- **Size:** +1,428 lines in total, under the ~1,500 cap. Item 1 cost more than ~400 lines; the reasons are under its heading.
- **Speed:**
  - Typing on the 5,000-line Big note and note switching are as fast as at the round's start.
  - Search typing stays within about a frame, now with real results.
  - In the Tauri window, wheel zoom p95 went from 19–24 ms to 17–20 ms.
- **Lockdown:**
  - No dependency was added, and the CSP and `tauri.conf.json` are unchanged.
  - One backend command was added, `frontmatter`, with its permission `allow-frontmatter` in the existing capability.
  - Item 5 needed no new command, permission or capability.

| Commit | What |
|---|---|
| `7f33d55` | YAML safety, no frontmatter after `...`, type rules (item 1) |
| `e456d5e` | Backend `frontmatter` command (`CONTRACT.md` changed) |
| `4aae888` | Type menu, suggestions, "N properties", counts without frontmatter (item 1) |
| `19e5573` | Search operators, one parser for search and the graph (item 2) |
| `2e1c410` | All properties view (item 3) |
| `d82d26f` | Links to missing notes look unresolved (item 4) |
| `7417a3c` | Move to new window (item 5) |
| `8a8e839` | Wheel zoom: label size in whole device pixels (item 6) |
| `afac632` | One walker over the query tree (smaller) |
| (last) | These notes |

## How things were observed and measured

**Obsidian 1.14.4** (the installed package):
- It ran as Electron headless (`--ozone-platform=headless`) inside `unshare -rn` (its own user and network namespace, loopback only).
- `HOME` and `XDG_*` were scratch folders, and each run had a fresh copy of a throwaway vault, all in the session scratchpad.
- A CDP script read the DOM, computed styles, `types.json`, the files and the clipboard, and drove the mouse and keys.
- For Export to PDF, the save dialog was answered from the renderer with a path in the scratchpad, and the PDF it wrote was rendered with `pdftotext`/`pdftoppm`.
- No Obsidian source, CSS or asset was opened. The owner's `~/.config/obsidian` and vaults were never touched.

**Grove in a browser:** headless Chromium against the Vite dev server on private ports, with the mock vault and `?synthetic=1000`. For "before", the round's start (`5ff2789`) was extracted into the scratchpad and served on its own port, interleaved with the new code.

**Grove in the Tauri window (WebKitGTK 2.54.1):**
- **Display:** a private Xvfb (`:127`, 2560×1600, `GDK_SCALE=2`). The binary is the one round 9 had already unpacked; nothing was downloaded.
- **Environment:** `env -i` with scratch `HOME`/`XDG_*`.
- **Vault:** a scratch vault in the scratchpad: the sample notes plus 1,000 synthetic ones.
- **Build:** a debug binary built with `TAURI_CONFIG` pointing `devUrl` at a scratch Vite server, which injects a self-test that posts its numbers back. The normal binary was rebuilt afterwards.
- **Clean-up:** the window, Xvfb and the server were stopped after every run. No window ever opened on the owner's screen.
- **Caveat:** software GL on Xvfb (no DRI3), so absolute numbers differ from the owner's GPU path. Before and after were measured under the same conditions. Other agents were using the machine at the same time, so runs were interleaved.

## 1. Properties in document

### What Obsidian does (observed)

**Type menu:**
- Clicking a row's icon highlights the row and opens:
  - **Property type ▸**, a submenu: Automatic (*inferred type*) ✓, Checkbox, Date, Date & time, List, Number, Text;
  - Cut, Copy, Paste;
  - Remove (red).

  The icons are `info`, `scissors`, `copy`, `clipboard-check`, `trash-2`; in the submenu `loader` and each type's icon.
- For `tags` the submenu lists Checkbox, Date, Date & time, List, Number, Tags, Text, all disabled.
- The chosen type goes into `.obsidian/types.json` (`{"types": {"title": "number"}}`) **for the vault, and nothing in the note is rewritten**. That was checked for every pair of 9 kinds of value × 6 types.

**Values that don't fit the chosen type:**
- A value that fits is shown in the chosen type: text as a one-pill list, a date as text, a date-time as a date, an empty value as anything.
- A value that doesn't fit keeps its own editor, and the row gets an orange triangle ("Type mismatch, expected Number").
- Clicking the triangle asks **"Display as number?** Your text data is not compatible. It will be adapted to fit the new format." with Update and Cancel.
- Update shows the value adapted (a list as `a,b`, text as an empty number, anything but `true` as unticked) and **still writes nothing**. The next edit writes the new type.

**Copy, Cut and Paste:**
- Copy puts the property's YAML on the clipboard (`tags:\n  - alpha\n  - beta\n`).
- Paste adds a new name at the end, and replaces the value of a name the note already has.
- Cut is Copy plus Remove.

**Suggestions:**
- A name field lists the vault's other property names with their type icons, leaving out the names the note already has. The first is highlighted.
- A value field lists that name's values elsewhere in the vault, alphabetically, matched against what is already in the field.
- A tags field lists the vault's tags (inline ones too), less the note's own, with none highlighted until you type.

**Status bar and counts:**
- "9 properties" ("1 property"), between the backlinks and the editing mode. It is absent on a note without frontmatter.
- Word and character counts leave the frontmatter out. For example, `---\na: 1\n---\n\nabc def\n` counts 2 words and 9 characters: everything after the closing line's newline.

**YAML:**
- Obsidian reads `012`, `1e3`, `.5` and `0x1F` as numbers.
- **A `...` line does not close frontmatter:** such a note has none, and its lines show as text.

**Export to PDF:** the dialog offers "Include file name as title", page size, landscape, margin and downscale. With the defaults, **the PDF has no Properties block**, just the body.

### What Grove does now

**Type menu (`editor/properties.ts`):** the same menu, items and icons. Choosing a type stores it in `.grove/types.json`, in Obsidian's format (the settings store keeps it like `hotkeys.json`). Fit, mismatch, Update and writing on the next edit follow the observed rules: `fits()` and `asType()` in `frontmatter.ts`, which are tested.

**Copy and Paste:** Copy writes the property's lines exactly as written. Paste reads YAML from the clipboard: an existing name's lines are replaced, new ones are added at the end, and anything that isn't properties is ignored.

**Suggestions:**
- A small shared popover, `shell/suggest.ts`, drawn with the prompt's suggestion styles (fuzzy-ranked, matched letters bold, ↑↓ Enter Esc).
- Its data comes from **`shell/propertyIndex.ts`**:
  - It is built only when a suggestion, the All properties view or a `[property]` search first asks.
  - It reads the backend's new `frontmatter` command, which returns only the frontmatter blocks from the Rust index (a few KB for 1,000 notes, one call).
  - Each note is kept by modified time. After a save or a `vault-changed` from outside, only that note is read again.
  - Notes open in an editor are read from the editor, so unsaved edits count.
- Tags come from the existing tag reader.
- A backend command was chosen because the alternative was reading every note with frontmatter in full, one IPC call each.

**Status bar:** "N properties", read from the editor's frontmatter field (O(1) per keystroke). It belongs to the new "Properties view" core plugin.

**Counts:** `countsField` counts the body only. It recounts fully only when the frontmatter itself changes; the frontmatter field also keeps its old object when typing at the body's start leaves it the same. Typing in the body is unchanged (still incremental).

**YAML safety (tested):**
- **Read-only:** values with a trailing `# comment` (including in list items), and numbers YAML readers disagree on (`012`, `1e3`, `.5`, `0x1F`, `+5`, `1_000`, `.inf`, `10:30`). They keep their text as written, and edits to other properties leave them byte for byte.
- **Quoted:** text that looks like one of those numbers is written in double quotes.
- **`...` ends no frontmatter,** as in Obsidian, so nothing in such a note is rewritten. "Add file property" puts a new frontmatter above it and leaves those lines alone.

**Export to PDF:** Grove already left the block out, which matches the observation, so nothing changed. Grok's round 9 idea of printing it as rows would differ from Obsidian.

**Checked in Chromium:**
- the menu, `types.json`, the mismatch flow and writing in the new type;
- the menus of fixed-type keys;
- name, value and tag suggestions;
- Copy, Cut and Paste;
- the status bar count;
- editing and saving a note with frontmatter in Live Preview (block and body), Reading view (block shown, read-only) and Source mode (raw YAML), with the saved text read back.

**Differences and gaps:**
- The status bar count isn't clickable. Obsidian's opens a "File properties" view, which Grove doesn't have.
- A name picked from the suggestions starts as an empty text row. Obsidian may use the name's vault-wide type there; this wasn't observed.
- Obsidian's moment.js quirk of showing the number 42 as the date 2042-01-01 is not copied.

**Size:** +823 lines with tests: 143 + 84 + 596 across the first three commits. It is over ~400 because it includes:
- the properties index (143) and the backend command (84 with its Rust test), which items 2 and 3 also use;
- the suggestion popover (94);
- the type rules and YAML safety with their tests (~190).

## 2. Search operators

### What Obsidian does (observed)

38 queries were run on a throwaway vault:
- Plain words must **all be in the note, on any line, or in its name**. Case is ignored, and the frontmatter text counts.
- `"…"` matches a phrase.
- `-x` excludes; `-alpha` alone lists the notes without it.
- `OR` and `( )` work.
- `tag:gamma` and `tag:#gamma` match frontmatter and inline tags, and nested tags under them. `#gamma` is plain text.
- `file:` matches the file name and `path:` the path, both as substrings.
- `line:(a b)` needs both on one line; `content:` searches the text only.
- `[status]`, `["status"]`, `[status:dra]` (a substring), `[status:"in progress"]`, `[status:draft OR done]` and `[category:one]` (a list item) all work; `-[status]` excludes.
- Results show the matching lines with every term highlighted, sorted by file name.

### What Grove does now

**One parser.** `graph/query.ts` and the search view's own `path:` parser are gone. `shell/searchQuery.ts` parses the whole syntax above into a small tree, once per change, for both the search view and the graph's filter and colour groups.

**Matching** works on facts that `shell/searchFacts.ts` gathers:
- For each term, the backend's existing `search` is asked once. That call finds lines with all its words; a phrase is then checked whole. The limit is 4 lines per vault file; the backend's hits are round-robin, so every matching note is found.
- The tag reader and the properties index are asked only when the query uses them.
- Everything is kept until the vault changes, so typing asks the backend only about the term being typed.

**The search view** (now its own file, `shell/searchView.ts`):
- the matching notes by name with "N results";
- each note's matching lines (the first five), all terms highlighted;
- 50 notes at a time, with "Show N more".

**Other changes:**
- Tag clicks (Tags view, graph tag nodes) search `tag:#name`, as Obsidian's do.
- Search in folder (`path:"…"`) works as before.
- The graph's filter and groups now take the full syntax; checked: `tag:`, `path:`, `[status:draft]`, `-`, `OR`.

**Tests:** all 25 observed cases are a test (`searchQuery.test.ts`), plus the parser's tree, stray brackets, the terms asked for once, the lines shown and the highlights.

**Speed:** sorting 1,000 names took ~14 ms per keystroke, because `localeCompare` with options builds a collator on every call. `compareNames` now uses one `Intl.Collator`, which also helps the file tree. Typing numbers are at the end.

**Left out:**
- Regular expressions; `section:`, `block:` and `task:`.
- The match-case toggle, the sort menu, and "show more context".
- Every matching line: Grove shows the first five.
- The match count is a lower bound when a term is on more than ~4 lines in almost every note.

## 3. All properties view

### What Obsidian does (observed)

- "Properties view: Show all properties" opens it in the right sidebar after Tags, with the `archive` tab icon.
- Its header has "Change sort order" and "Show search filter" (which shows a filter field).
- Each row shows the type's icon, the name and how many notes have it, at 13px with 25px rows.
- The sort menu has Property name (A to Z), Property name (Z to A), Frequency (high to low) ✓ and Frequency (low to high). Ties sort by name.
- A click searches `["status"]`.
- Right-click offers Rename, Property type and Delete property.

### What Grove does now

`shell/propertiesView.ts`, built on `sideView.ts` and the Tags view's pattern:
- **Layout:** the same place, tab icon, header buttons, rows and sorts (the sort is remembered), the filter, and the `["name"]` search on click.
- **Right-click:** Property type, sharing its submenu with the row icon's menu.
- **Updates:** the view works only while shown. It updates when a vault change settles, and a moment after the open note's frontmatter changes (an O(1) check per keystroke).
- **Core plugin:** "Properties view" under Settings → Core plugins. Turning it off removes the tab, the command and the status bar count.

**Left out:** Rename and Delete property in that menu. They rewrite every note that has the property, which is more than the smallest change.

## 4. Links to missing notes

### What Obsidian does (observed)

Light and dark, Live Preview and Reading view:
- An unresolved link keeps the link colour at **70% opacity**, with its underline at **30%** of the accent (`color-mix`).
- In Live Preview only wikilinks are marked. In Reading view, markdown links to missing notes are marked too.

### What Grove does now

- The same look, as `.is-unresolved` on the link marks the decorations already make.
- **Cost:** each link drawn costs one set lookup. `links/internal.ts` `linkTargets()` builds the vault's names and paths once per file list (tested); `resolveLink` itself builds a map of every note per call, so it is used only for relative or partial paths. There is no extra scan per keystroke.
- **Refresh:** links are drawn again when the file list changes, so a note created by clicking its link stops looking missing. Clicking still creates the note.
- **Extra fix:** markdown links to notes and headings lost the external-link arrow, which Obsidian draws only for links that leave the vault.

## 5. Move to new window

**Observed:**
- Obsidian's tab menu has "Move to new window" (`picture-in-picture`) just before "Split right", and "Open in new window" after "Split down".
- More options doesn't have it.
- The palette has "Move current tab to new window".

**Built:**
- Both, using the existing `open_note_window`.
- The note's unsaved edits are saved, the note window opens, and the tab closes here.
- No new command, permission, capability or CSP change.

**Checked in the Tauri window on Xvfb:**
- The main window kept only its other tab.
- `note-1` opened on the note, with the unsaved edit.
- The edit was on disk.

## 6. Wheel zoom in the Tauri window

**Found by timing each drawing phase in WebKitGTK:**
- Between 50% and 90% zoom a frame spent ~7 ms on links and **~6 ms on labels**.
- The labels' font size changes every frame while zooming, so every label's glyphs were rasterised afresh.

**Change (5 lines):** the label size is rounded to whole device pixels. Glyphs are then reused across frames, and labels take ~1–1.7 ms. Every other graph fix is untouched:
- whole-pixel canvas;
- one-device-pixel HiDPI links;
- low resolution only when full resolution can't keep up;
- every-other-frame settle;
- typing yield;
- nine-slice shadow.

WebKitGTK at 2×, 1,011 nodes and 3,100 links, wheel zoom around 100%: 6 rounds each, interleaved, round start against now.

| | Before (`5ff2789`) | After |
|---|---|---|
| Wheel: frame mean / p95 | 16.6–17.2 / 19–24 ms (four of six at 22) | 16.4–16.7 / 17–20 ms (four of six at 20) |
| Wheel: frames over 20 ms (of 181) | 3–23 (mean 15) | 0–9 (mean 6) |
| Wheel: graph work per frame, mean / p95 | 9.7–12.3 / 14–19 ms | 7.5–11 / 9–15 ms |
| Pan: frame mean / p95 | 16.5–16.6 / 17–18 ms | 16.5–16.6 / 17–18 ms |
| Typing on Big note, next to a note (mean / p95) | 9.0–10.3 / 17–19 ms | 10.0–10.6 / 18–19 ms |
| Typing on Big note, next to the settled graph | 8.7–9.2 / 10–11 ms | 9.0–9.2 / 10–11 ms |

The target was a p95 under 20 ms. It is reached in two rounds of six and is at 20 ms in the other four, so it is met only at the edge. What remains is stroking the 3,100 links (5–8 ms when zoomed out), which this round left alone.

## Lines

Measured from `rebuild/app` with the brief's commands. Before is `5ff2789`.

| | Before | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 15,240 | 16,371 | +1,131 |
| TypeScript, tests | 1,445 | 1,622 | +177 |
| CSS | 3,144 | 3,191 | +47 |
| Rust | 3,129 | 3,202 | +73 |
| **Total** | **22,958** | **24,386** | **+1,428** |

| Item | Lines |
|---|---:|
| 1. Properties: YAML safety, types, suggestions, counts, plus the shared index and backend command | +823 |
| 2. Search operators, net of the two parsers removed, plus the walker commit | +354 |
| 3. All properties view | +166 |
| 4. Unresolved links | +68 |
| 5. Move to new window | +13 |
| 6. Wheel zoom | +4 |

**Largest files:**

```
 24386 total
   755 src/workspace.ts
   743 src/shell/pane.ts
   733 src/graph/view.ts
   681 src/styles/settings.css
   622 src/editor/properties.ts
   540 src/appCommands.ts
   538 src-tauri/src/index.rs
   534 src/settings/sections.ts
   522 src-tauri/src/watch.rs
   511 src-tauri/src/vault.rs
   484 src/main.ts
   470 src/noteEditors.ts
   434 src/styles/editor.css
   426 src-tauri/src/index/parse.rs
```

No file is over 800 lines.

**New files:**
- `shell/searchView.ts` (out of `sidebar.ts`, which went from 490 to 418)
- `shell/searchFacts.ts`
- `shell/propertyIndex.ts`
- `shell/propertiesView.ts`
- `shell/suggest.ts`

**Removed:**
- `graph/query.ts`, and the search view's own query parser;
- the old `matchesPath` and `parseSearchQuery`.

## Dependencies, permissions, capabilities, commands, CSP

- **Dependencies:** none, npm or Cargo. Five Lucide icons were added from the package already in use: `archive`, `info`, `loader`, `triangle-alert`, `picture-in-picture`.
- **Command:** `frontmatter(paths?)` is new, documented in `CONTRACT.md` and registered in `build.rs`. Its generated permission file is committed.
- **Capability:** `allow-frontmatter` was added to `capabilities/default.json`, next to `allow-search` and `allow-link-index`, for the same windows. Nothing else changed.
- **CSP and `tauri.conf.json`:** unchanged. The offline audit passes.
- **Settings files:** `.grove/types.json` (Obsidian's format) is new, and the `properties` core plugin (on by default) is new in `core-plugins.json`.

## Performance (headless Chromium, mock vault + `?synthetic=1000`)

Two interleaved runs each, mean (p95) in ms.

| | Before (`5ff2789`) | After |
|---|---|---|
| Typing on Big note (line 2,500) | 9.9 (17.8), 9.7 (17.4) | 10.8 (17.5), 10.1 (18.0) |
| Typing next to the settled 1,011-node graph | 10.6 (18.0), 10.2 (17.9) | 10.5 (18.4), 10.8 (18.0) |
| Note switch, Welcome ↔ Big note | 16.6 (22.5), 16.7 (22.4) | 16.6 (22.6), 16.6 (22.5) |
| Graph open, first painted frame | 21.1, 20.9 | 20.0, 20.6 |
| Pan / wheel at 100% | 16.7 (16.7–16.8) | 16.7 (16.7–16.8) |
| Search typing, key to painted frame | | |
| `alpha gamma` (before: 0 results under the old same-line rule; after: 452 notes) | 5.5 (9.2), 6.1 (11.1) | 9.5 (20.6), 9.9 (16.8) |
| `garden 12` | 6.6 (8.6), 6.7 (8.1) | 5.6 (8.3), 6.1 (7.9) |
| `e` (all notes) | 7.1, 7.8 | 11.0, 16.1 |
| Results drawn after the last key | 1–2 ms | 2–5 ms |

**Reading the numbers:**
- Typing and note switching are within run-to-run noise.
- Search keys cost a few ms more where the query now finds many notes and draws 50 of them. In the browser the mock backend's search also runs on the page's own thread (1–9 ms of these numbers); in Tauri the Rust search runs off it.
- Opening a note with frontmatter costs one read of its frontmatter lines, as before.

## Skipped and caveats

- **Item 1:**
  - The status bar count isn't clickable (Grove has no "File properties" view).
  - New properties picked from suggestions start as text.
  - Paste accepts plain YAML text; whether Obsidian does wasn't settled (its own clipboard format was present when it pasted).
- **Item 2:** regex and `section:`/`block:`/`task:` are out, as are the search options (match case, sort), "show more context", and match counts past the backend limit.
- **Item 3:** Rename and Delete property in the name's menu are out, as is Obsidian's separate "File properties" view.
- **Item 6:** the p95 sits at the 20 ms target rather than clearly under it, on software GL under Xvfb. The owner's GPU path wasn't measured.
- **Search results:** clicking a property's line puts the caret on the body's first line, because the caret never rests inside the hidden frontmatter.
- **Scratch only:** the Obsidian sandbox, the Chromium and WebKitGTK harnesses, the scratch vaults and the copy of the round's start are in the session scratchpad and are not committed.
