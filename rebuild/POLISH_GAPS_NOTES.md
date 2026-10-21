# Round 9: polish and the biggest remaining Obsidian gaps (Claude)

All five items are done. Item 2 turned out different from the brief once Obsidian was observed: there, colour groups colour notes only, so Grove now does the same. Item 3 cost more than the ~400 lines one item should, for the reasons given under it. The round's total is +1,273 lines, under the +1,500 cap.

- **Checks:**
  - `npm run build`, `npm test` (118 tests in 27 files, up from 108 in 25), `npm run audit:offline`, `cargo build` and `cargo test` (28, up from 27) all pass.
- **Speed:**
  - In Chromium, typing on Big note and note switching are as fast as at the round's start (numbers at the end).
  - In the Tauri window (WebKitGTK, on a private Xvfb display), panning and wheel-zooming 1,011 nodes at 100% zoom went from 40–50 ms p95 frames to 17–22 ms.
- **Network:** nothing new reaches outside the machine. There is no new dependency, the CSP is unchanged, and the audit passes.

Commits on `rebuild/r9-claude`, oldest first:

| Commit | What |
|---|---|
| `d0dcd04` | Graph: draw at full resolution while moving unless that is far too slow (item 1) |
| `ce446ee` | Graph: colour groups colour notes only, as Obsidian does (item 2) |
| `4014943` | Properties in document: Obsidian's Properties block (item 3) |
| `25c4770` | Open in new window and Export to PDF, inside the lockdown (item 4; `CONTRACT.md` changed) |
| `9ea3875` | Tab drop overlay and ghost as in Obsidian 1.14.4 (item 5) |
| (last) | These notes |

## How things were observed and measured

**Obsidian 1.14.4** (the installed package) ran like this:
- Electron headless (`--ozone-platform=headless`), in its own user and network namespace (`unshare -rn`, loopback only).
- `HOME` and the `XDG_*` folders were scratch folders in the session scratchpad, with throwaway vaults there.
- A CDP script in the same namespace read the DOM, computed styles, the graph renderer's node data and screenshots, and drove the mouse, keys and native drag events.

No Obsidian source, CSS or asset was opened or copied. The owner's `~/.config/obsidian` and vaults were never touched.

**Grove in a browser:** headless Chromium against the Vite dev server (mock vault, `?synthetic=1000` for 1,011 nodes and 3,100 links). The round's start (`234d2fa`) was extracted and served on its own port for the before numbers.

**Grove in the Tauri window (WebKitGTK 2.54.1):**
- **Display:** a private Xvfb (`:117`, 2560×1600, `GDK_SCALE=2`, so a 1280×800 window at 2×). The Xvfb binary is the Arch `xorg-server-xvfb` 21.1.25-2 package, the same version as the installed `xorg-server`. It was already unpacked under `/tmp`; I copied it into the scratchpad. Nothing was downloaded.
- **Scratch folders and vault:** `env -i` with scratch `HOME`/`XDG_*`. The vault was a scratch one at `/tmp/grove-r9-claude-vault`: the sample notes plus 1,000 generated ones, regenerated before each run.
- **Build:** the debug binary was built with `TAURI_CONFIG` pointing `devUrl` at a scratch Vite server on its own port. That server's config (in the scratchpad) loads the app's own `vite.config.ts` and adds two things:
  - a self-test script injected into the page;
  - a `/__report` endpoint the self-test posts its numbers to (the page's own origin, which the dev CSP already allows).
- **Clean-up:** the window, Xvfb and the server were stopped after every run. No window ever opened on the owner's screen.
- **Input:** to press buttons in the GTK print dialog (item 4), a small ctypes/XTest script clicked on that private display only.

**Caveat:** Xvfb has no DRI3, so WebKitGTK composites with software GL (llvmpipe). The owner's window runs on Hyprland with the GPU, so absolute numbers differ. Every before/after pair below was measured under the same conditions.

## 1. Graph speed in the Tauri window

**What was found:**
- In the Tauri window, a variant run (the low-resolution path switched off, then forced on) showed the round-7 "low resolution while moving" fix had become the cause of the slow frames.
- The canvas's pixels then no longer match the screen's, and WebKitGTK resamples it every time it composites the page.

| Variant (1,011 nodes, 100% zoom) | Pan frames, mean / p95 | Wheel frames, mean / p95 | Typing next to it |
|---|---|---|---|
| As at round start | 16.5–19.5 / 18–44 ms | 22.7–23.9 / 49–50 ms | 8.8–9.2 ms |
| Always full resolution | 16.5 / 17–18 ms | 16.5–17.1 / 19–23 ms | 8.9 ms |
| Always 1× (forced) | 22.8–23.5 / 48 ms | 23.9–24.3 / 49–50 ms | **31.9 ms** |

Full-resolution drawing takes 7–12 ms here, mostly the links (4–5 ms). That fits in a frame, so the resampled canvas costs more than it saves.

**Change (9 lines):**
- Low resolution while moving now starts only when a full-resolution frame takes over 24 ms (it was 10 ms), i.e. when full resolution can't keep up anyway. The round-7 case (30 ms or more on a 2× screen) still gets it.
- Every other round-7 fix is untouched: the whole-pixel canvas, one-device-pixel HiDPI links, the every-other-frame settle (still at 10 ms), the typing yield and the nine-slice shadow.

**Other ideas tried:**
- `contain: strict` on the graph view and `will-change: transform` on the canvas: no measurable gain, so left out.
- `image-rendering: pixelated` on the low-resolution canvas: cheaper, but still slower than full resolution, and blocky.
- WebGL was not retried.

**Results** (3 rounds each, frame gaps from `requestAnimationFrame`; "work" is the graph's own JS per frame):

| WebKitGTK, 2×, 1,011 nodes | Before | After |
|---|---|---|
| Pan at 100%: frame mean / p95 / frames over 20 ms | 16.5–19.5 / 18–44 ms / 1–26 of 161 | 16.5–16.6 / 17–18 ms / 0–1 of 161 |
| Wheel zoom around 100%: frame mean / p95 / over 20 ms | 22.7–23.9 / 49–50 ms / 53–71 of 181 | 17.0–17.2 / 21–22 ms / 11–18 of 181 |
| Graph work per frame (pan / wheel) | 4–7 / 7–8 ms | 5–7 / 11–12.5 ms |
| Typing on Big note, next to a note | 9.8–10.2 ms | 9.3–10.3 ms |
| Typing on Big note, next to the settled graph | 8.8–9.2 ms | 8.9–9.2 ms |

How the item's targets came out:
- **Pan holds 60 fps.** Its p95 is well under 20 ms.
- **Wheel zoom is at 59 fps on average**, but its p95 (21–22 ms) sits just over the ~20 ms target. Those frames are the ones where zooming out puts all 3,100 links on screen at full resolution (11–12 ms of drawing).
- **The typing gap in the brief (14.5 vs 10 ms) does not show up under Xvfb.** Next to the graph and next to a note are within 1 ms of each other here, before and after. Round 7 put the gap down to WebKitGTK compositing the canvas layer with each editor frame on the GPU path. I couldn't reproduce that path on a private display, so I can't confirm it is fixed in the owner's window. The forced-1× row shows how much a resampled canvas costs each editor frame (32 ms), and after this change a settled graph is never left in that state.

## 2. Groups colour every node they match

**Observation (Obsidian 1.14.4, throwaway vault with tags, nested tags, three missing notes and an attachment, Tags and Attachments shown):** colour groups colour notes only.
- I read each node's group colour from the renderer for 30 queries, among them:
  - `tag:#x`, `#x` and `x`;
  - `file:Missing`, `Missing` and `"Missing note"`;
  - `Ghost` and `[[Ghost]]`;
  - `path:pic` and `file:pic`;
  - ones that match every note: `/.*/`, `path:/` and `-tag:#x`.
- Even the queries that match everything leave tag, missing-note and attachment nodes in their own colours (tags `#08b94e`, missing `#ababab`, attachments `#e0ac00`). `tag:#x` colours the notes tagged `#x` or `#x/deep`, never the `#x` node.

So the brief's premise doesn't hold for 1.14.4. Grove already left tag and missing-note nodes alone, but it did colour attachments, which Obsidian doesn't.

**Change:** groups colour notes only. The choice is a small pure function (`nodeColor` in `graph/data.ts`) with a test: a match-everything group colours a note but not the attachment, tag or missing note, and the first matching group wins.

## 3. Properties in document

**Observed in Obsidian:**
- **Layout and sizes:**
  - The block sits at the top of Live Preview and Reading view, 4px left of the text column.
  - A "Properties" heading at 16px/500, with a fold chevron in the margin that shows on hover.
  - Rows 28–29px high and 3px apart; a 144px key column holding a 20px type icon and the key at 14px; values at 14px.
  - Tags as accent pills; "Add property" 7px below the rows; 32px of space before the body.
- **Type icons** (Lucide): `text` for text, `list`, `binary` for numbers, `check-square` for checkboxes, `calendar`, `clock` for date and time, `tags`, `forward` for aliases, `file-question` for anything it can't edit (shown as JSON in orange).
- **Add file property (Ctrl+;):**
  - It adds a row with the key field focused, and nothing is written until a key is typed.
  - Enter moves from the key to the value; Enter in the value writes it and focuses the row.
  - Escape on the new row drops it.
  - On a note without frontmatter, it writes `---\nstatus: draft\n---\n` once a key and value are entered.
- **Rewrites:** Obsidian rewrites the whole frontmatter on any edit. For example, editing the title turned `aliases: [Hi]` into a block list.
- **The setting:**
  - Visible / Hidden / Source.
  - Hidden shows no frontmatter in either view.
  - Source shows the YAML as monospace text in Live Preview; Reading view still shows the block.

**Built (no new dependency, no YAML parser):**
- **`editor/frontmatter.ts`** (pure, tested), which:
  - finds the frontmatter, reading only its lines (the splitter is now shared with `shell/linksTags.ts`, which had its own);
  - reads properties and their types the way Obsidian does: `tags`, `aliases` and `cssclasses` by key; true/false, numbers, dates, date-times and lists by value; quoted text stays text;
  - writes edits. Each edit replaces only that property's lines and keeps its key as written (quoted or not). Text that would read back as something else (`42`, `true`, a date, `[[Link]]`, `#tag`, `a: b`) is written double-quoted.
  - **Round trip:**
    - Comments, blank lines, other properties and anything Grove can't edit stay byte for byte. Grove's frontmatter changes less than Obsidian's.
    - A value Grove can't edit safely is shown read-only, as written, in orange, with the "file question" icon, as Obsidian does. That covers nested maps, block scalars (`|`, `>`), anchors, multi-line plain text, and any property with a comment inside.
    - A frontmatter Grove can't read line by line (a line that isn't `key: value` at the top level) is shown as source, as the brief asks.
- **`editor/properties.ts`:**
  - **The block:** one block widget replacing the frontmatter's lines, rebuilt only when the frontmatter changes. Rows whose property didn't change are kept, and with them the focus.
  - **Value editors:**
    - text (a plain-text editable field);
    - number, date and date-time (native inputs);
    - checkbox (Grove's task checkbox style);
    - list, tags and aliases as pills with ×. Enter or `,` adds an item, Backspace in the empty field removes the last one, and `[[links]]` in a list open the note.
  - **Keys and removal:** a key can be renamed in place. A property is removed with Delete on its focused row or through its icon's menu ("Remove property").
  - **"Add property"** works as observed, and so does "Add file property" (Ctrl/Cmd+;), from Live Preview, Reading view and from inside the block.
  - **Folding:** the heading folds the block (per pane).
  - **Edits** are ordinary undoable changes to the note. Ctrl+Z in the editor undoes them.
  - **The caret** never rests inside the hidden YAML: it moves to the body's first line. Backspace there doesn't join the body onto the closing `---`.
- **Setting:** Editor → Display → **Properties in document** (Visible / Hidden / Source), with Obsidian's wording. It is in `app.json` as `propertiesInDocument` and reconfigures open editors in place through a compartment, like the other editor settings. Source mode always shows the raw frontmatter, as before.
- **Live Preview** no longer draws markdown decorations inside the frontmatter. It used to render list bullets, links and the closing `---` as a horizontal rule there.
- **Typing cost:** none in the body. The frontmatter is re-read only when an edit touches it, or the first lines of a note that has none.
- **Hotkeys:** editor hotkeys now stay out of every text field inside the editor, the Properties fields included. Before, Ctrl+B in a field inside the editor (the search panel's, for example) bolded the note.

**Checked** in headless Chromium with 23 interaction checks, all passing:
- the caret placement;
- Ctrl+; with and without frontmatter, Enter, Escape;
- the checkbox; adding and removing a tag; a text edit; a rename; removal; undo;
- typing in the body afterwards;
- Hidden, Source, Reading view and Source mode.

It also looks right in the dark theme.

**Size:** +1,058 lines.

| Part | Lines |
|---|---|
| `frontmatter.ts` | 305 |
| `properties.ts` | 406 |
| `properties.css` | 207 |
| Tests | 110 |
| Wiring (settings row, config compartment, command, Live Preview skip, icons) | ~30 |

Why it is over ~400:
- It is a small editor in its own right: seven value editors, keyboard and focus handling, and the caret guard.
- It needs YAML reading and writing that doesn't damage what it doesn't understand, without a YAML library. A YAML parser would be a dependency, and a parse-and-reserialise library would rewrite the user's formatting.

**Left out:**
- Choosing a property's type from the icon menu (Obsidian's "Property type" submenu) and a vault-wide `types.json`; Grove infers the type from the value each time.
- Suggestions of existing keys and values.
- The "N properties" status bar item.
- Leaving frontmatter out of the word count. Obsidian leaves it out; Grove still counts it.

## 4. Missing menu items

### Open in new window: built

Where it appears, as observed in Obsidian:
- **File menu:** after "Open to the right".
- **Link menu:** after "Open to the right".
- **Tab menu and More options:** after "Split down".
- **Command palette:** "Open current tab in new window".

The icon is Lucide `picture-in-picture-2`.

**What changed, exactly:**
- **`src-tauri/src/lockdown.rs`:** the main window and note windows are built by one function. A note window:
  - starts from the main window's config entry (same size, frameless);
  - gets the same navigation guard (only the app's own origin) and the same denial of every new-window request;
  - loads `index.html?note=<path>` on the app's own origin;
  - is labelled `note-<n>`.

  The note path has to arrive fully percent-encoded (`A-Za-z0-9%-._~` only), so it can't add anything to the URL; the check has a Rust test. No remote URL is reachable.
- **`src-tauri/src/lib.rs`:** a new command, `open_note_window(note)` (async, as Tauri requires for creating windows).
- **`src-tauri/src/lib.rs`, saves:** `write_note` now emits `vault-changed` (`modify`) to the other windows, not to the one that saved. A note open in both windows stays in step; the other window reloads it unless it has its own unsaved edits.
- **`src-tauri/build.rs`:** the command is registered in the app manifest. Its generated `permissions/autogenerated/open_note_window.toml` is committed.
- **`capabilities/default.json`:**
  - `"windows"` went from `["main"]` to `["main", "note-*"]`, so note windows get exactly the main window's permissions and nothing more;
  - one permission was added, `allow-open-note-window`.

  No `core:webview:allow-create-webview-window` (that would let the page create windows on any URL), and no other permission.
- **`tauri.conf.json`:** unchanged. The CSP is the same app-wide policy for every window.
- **The front end** (`?note=`):
  - shows only that note's tabs, with no ribbon, sidebars or status bar;
  - joins the vault the backend already has open, rather than opening it again;
  - saves no layout, so it never overwrites the main window's.
- **Closing:** the window close button (in both kinds of window) writes unsaved edits first, then closes.
- **`CONTRACT.md`:** documents `open_note_window` and the `write_note` change.

**Checked in the Tauri window on Xvfb:**
- The note window opened as `note-1` on the note, with only its tabs.
- An edit typed in it reached the main window's copy of the note. So did one typed just before pressing its close button.
- A malformed name (`x?y=<script>`) was refused by the backend.
- The main window carried on normally afterwards.

### Export to PDF: built

**Where it appears:** More options (after "Add file property", as in Obsidian) and the command palette ("Export to PDF...", icon `file-down`).

**How it works:**
- It prints the note through the webview: `window.print()`.
- Before printing, it switches the tab to Reading view and the light scheme for the duration.
- Print CSS (in `base.css`) hides everything except that pane's content and lets it run its whole length. CodeMirror already renders the whole document while printing.
- Afterwards it restores the view mode and the scheme.

**Where the PDF is written:**
- The system print dialog's **Print to File** writes the PDF where the user picks.
- No dependency was added and no permission was needed.
- The dialog lists the system's printers as any GTK app's does. Grove itself sends nothing anywhere.

**Checked:**
- **Chromium:** CDP's `printToPDF` with the command's print state gave all 5,000 lines of Big note on 162 pages, and nothing of the app chrome. The tab went back to Live Preview and the dark scheme afterwards.
- **WebKitGTK:**
  - The GTK print dialog opened from the Tauri window.
  - Choosing "Print to File" and Print (clicked on the private display) wrote a 2-page PDF of just the note, rendered as Reading view.
  - The app restored itself when the dialog closed.

**Differences from Obsidian:** Obsidian shows its own options dialog (page size, margins, file name as title) and then a save dialog. Grove uses the system print dialog, which has its own page setup. The note's file name is printed as its title (the inline title). The Properties block is left out of the PDF.

"Open in default app" and "Show in system explorer" stay out, as the brief says.

## 5. The tab drop overlay

Observed in Obsidian 1.14.4 by starting a real (native) tab drag through CDP's drag interception, and patching `setDragImage` to see the ghost element:

| | Obsidian 1.14.4 | Grove before | Grove now |
|---|---|---|---|
| Edge zone | The outer third of the left, right or bottom side; no top zone | A quarter, all four sides including top | Third; left, right, bottom |
| What an edge lights | That third of the whole group, tab bar included, no inset | Half the pane below the tab bar, 3px inset | As Obsidian |
| Pane's middle | Into that group: a marker after its last tab | The whole pane lit | As Obsidian |
| Between tabs | A 10px marker from 6px below the bar's top to its bottom | 4px marker | As Obsidian |
| Look | Accent a little lighter, 50% opacity, 8px radius | Lighter teal at 40%, scaled box (its radius distorted) | 8px radius kept; see below |
| Glide | Translate plus real width/height, 0.1s ease-in-out | Translate plus scale, 0.1s | As Obsidian (one fixed element, so resizing it costs nothing) |
| Ghost | Dark pill: 85% black, white 13px/500 text, `file` icon, 4px radius, 6px 8px padding, soft shadow, at most 300px; its corner at the pointer | Light bordered box, 10px from the pointer | As Obsidian |

**The colour:**
- Obsidian's overlay is its accent lightened 5%, at half strength. Its purple accent is light (66%).
- Grove's teal is dark (34%), so the same rule would come out much stronger than Obsidian's looks.
- So the light theme matches the result instead: teal at 70% lightness, half strength, which comes out about 85% light over white, like Obsidian's.
- Dark theme: Grove's dark accent text colour plus 5%, at half strength. Obsidian's dark theme wasn't measured.

**One difference kept:** a drop that would change nothing (the tab is already last in its own group) still shows nothing. Obsidian shows the marker anyway.

`dropTarget` now has tests.

## Lines

Measured from `rebuild/app` with the brief's commands. Before is `234d2fa` (the round's start).

| | Before | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 14,413 | 15,228 | +815 |
| TypeScript, tests | 1,287 | 1,445 | +158 |
| CSS | 2,909 | 3,144 | +235 |
| Rust | 3,064 | 3,129 | +65 |
| **Total** | **21,673** | **22,946** | **+1,273** |

Per item:

| Item | Lines |
|---|---:|
| 1 | +9 |
| 2 | +23 |
| 3 | +1,058 |
| 4 | +154 |
| 5 | +29 |

No file is over ~750 lines; none of the files touched crossed 800. The largest after the round:

```
 22946 total
   743 src/shell/pane.ts
   735 src/workspace.ts
   733 src/graph/view.ts
   681 src/styles/settings.css
   538 src/appCommands.ts
   534 src/settings/sections.ts
   522 src-tauri/src/watch.rs
   522 src-tauri/src/index.rs
   507 src-tauri/src/vault.rs
   490 src/shell/sidebar.ts
   471 src/main.ts
   470 src/noteEditors.ts
   428 src/styles/editor.css
   418 src/shell/menus.ts
```

Dead code removed along the way:
- `linksTags.ts`'s own frontmatter scanner (now the shared one);
- the drop overlay's workspace-sized base box and its scale maths;
- the "whole pane" drop path.

## Dependencies, permissions, capabilities, CSP

- **Dependencies:** none added (npm or Cargo). Lucide gained five icons from the package already in use: `binary`, `forward`, `file-question-mark`, `picture-in-picture-2` and `file-down`.
- **Capabilities:** `capabilities/default.json` now names the windows `main` and `note-*` (was `main`), and adds `allow-open-note-window`. Everything else is unchanged.
- **Commands:** one new backend command, `open_note_window`, registered in `build.rs` with its generated permission file. `write_note` now also notifies other windows.
- **CSP and `tauri.conf.json`:** unchanged.
- **Offline audit:** passes. It caught a `window.open` I had used for the browser preview's "new window"; that now only logs, like the preview's external links.

## Performance

**Chromium**, headless, 1280×800, mock vault plus 1,011 synthetic nodes. Two interleaved runs each of the round's start and the end. Means and p95 in ms; typing is real key presses at line 2,500 of Big note, keydown to the painted frame.

| | Before (`234d2fa`) | After |
|---|---|---|
| Typing on Big note | 11.2 (18.2), 10.8 (18.5) | 9.8 (17.7), 10.0 (17.8) |
| Typing with the settled 1,011-node graph in the right pane | 10.4 (17.9), 11.0 (17.9) | 11.7 (18.0), 10.5 (18.3) |
| Note switch, Welcome ↔ Big note, to the painted frame | 16.5 (22.1), 16.5 (22.4) | 16.7 (23.2), 16.7 (22.7) |
| Graph open, to the first painted frame | 22.3, 20.4 | 20.6, 21.6 |
| Pan at 100% zoom | 16.7 (16.7), 16.7 (16.8) | 16.7 (16.8), 16.7 (16.8) |
| Wheel zoom around 100% | 16.7 (16.8), 16.7 (16.8) | 16.7 (16.7), 16.7 (16.7) |

All within run-to-run noise. Opening a note with frontmatter adds one read of its frontmatter lines (nothing for notes without).

**WebKitGTK:** see item 1. The final run with every change in is the "After" column there.

## Skipped, deviations and caveats

- **Item 1:** the 14.5 ms typing gap couldn't be reproduced on a private display with software compositing, so it isn't confirmed fixed on the owner's GPU path. Wheel zoom is at 21–22 ms p95, just over the target.
- **Item 2:** follows the observation (notes only), not the brief's premise.
- **Item 3:** listed under item 3. In short: no type menu, no `types.json`, no key or value suggestions, no "N properties" in the status bar, and frontmatter is still counted in the word count.
- **Item 4:**
  - Export to PDF uses the system print dialog rather than Obsidian's options dialog plus save dialog.
  - Two windows with unsaved edits to the same note within the same 300ms still end with the last save winning.
  - "Move current tab to new window", "New window" and "Open link under cursor in new window" (Obsidian commands) were not added.
- **Item 5:**
  - A no-op drop shows no marker.
  - The dark-theme overlay colour is by rule, not measured.
- **Scratch only:** the harness, self-test, Obsidian sandbox, Xvfb copy, scratch vault and Vite config are in the session scratchpad or `/tmp`, not committed.
