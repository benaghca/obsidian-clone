# Round 4: icons, menus, command palette

Everything in `ICONS_MENUS_TASK.md` is done except the items under "Skipped, deviations and caveats" at the end. `npm run build`, `npm test` (51 tests, up from 31), `npm run audit:offline` and `cargo build` / `cargo test` (19 tests) all pass. Typing and note switching are as fast as before (numbers below).

Commits on `rebuild/r4-claude`, oldest first:

| Commit | What |
|---|---|
| `fea66d7` | Backend: `create_folder` for the file explorer's New folder |
| `e9ee032` | Icons, menus and command palette, matched to Obsidian |
| `88560ed` | Lockdown: turn off the opener plugin's injected link-click script |
| (last) | Reduced-motion fix for the reveal flash, and these notes |

**A caveat that applies to every "matches Obsidian" claim below:** Obsidian couldn't be observed live in this session. It is installed, but launching it would read and write the owner's real Obsidian config, which the brief rules out. Menu items, order, glyphs and sizes therefore come from my own knowledge of Obsidian 1.x and from Obsidian's publicly documented CSS variables. Nothing was copied from Obsidian's code, CSS or assets. The places where I'm least sure are listed at the end, so they can be checked side by side.

## A. Icons

### Approach and licence

- **One module, `src/shell/icons.ts`, backed by the `lucide` npm package** (1.60.0, ISC, no dependencies). It names the 74 icons Grove uses as ES imports, so the bundle carries only their path data (about 11 kB raw). Each icon is built once with `createElementNS` (no `innerHTML`) and then cloned. There is no icon font, no CDN, and nothing loads at run time.
- **Licence:** `rebuild/app/THIRD_PARTY_NOTICES.md` reproduces Lucide's LICENSE word for word. That covers the ISC licence, plus the Feather MIT notice that applies to some of the icons we use (`check`, `chevron-*`, `x` and others).
- **Offline audit:** `lucide` is on the npm allowlist in `scripts/audit-offline.mjs`, with a comment. The only URL in the icon code is the SVG namespace, which the audit already allows.

### Size, stroke and colour

These follow Obsidian's documented icon tokens, now in `theme.css`: `--icon-xs` 14px / 2px, `--icon-s` 16px / 2px, `--icon-m` and `--icon-l` 18px / 1.75px. Every size then draws a line about 1.3px thick. Each icon reads `--icon-size` and `--icon-stroke`, and each place sets them:

| Place | Size / stroke |
|---|---|
| Ribbon, sidebar view tabs, file-explorer header buttons, tab-bar buttons, view header (back/forward, mode, more options) | 18px / 1.75 (`--icon-m`) |
| Menu items, the prompt's clear button, small icons in sidebar lists (bookmarks, outgoing links), window buttons | 16px / 2 (`--icon-s`) |
| Tree chevrons, tab close/pin, the maximize square | 14px / 2 (`--icon-xs`) |

Icon buttons are muted (`--icon-color`, 0.85 opacity) and turn `--icon-color-hover` with a grey hover background, a 4px radius and 4px × 6px padding. A button whose dropdown is open keeps that hover look (`has-active-menu`).

### Glyph per place

| Place | Glyph |
|---|---|
| Ribbon | `panel-left` (toggle), `arrow-left-right` (quick switcher), `calendar-days` (daily note), `square-pen` (new note), `square-terminal` (command palette) |
| Left sidebar tabs | `folder-closed` (Files), `search`, `bookmark` |
| File explorer header | `square-pen` (New note), `folder-plus` (New folder), `arrow-up-narrow-wide` (Change sort order), `chevrons-down-up` (Collapse all) |
| Right sidebar tabs | `link` (Backlinks), `link-2` (Outgoing links), `tags`, `list` (Outline) |
| Tab bar | `plus`, `chevron-down` (tab list), `panel-right`; tabs show `x`, or `pin` when pinned |
| View header | `arrow-left`, `arrow-right`, `book-open` while editing / `pen-line` while reading, `ellipsis-vertical` |
| Menus | `file-plus` open in new tab · `files` make a copy · `folder-input` move · `bookmark` / `bookmark-minus` · `copy` copy path · `pencil` rename · `trash` delete · `folder-open` reveal · `x`, `circle-x`, `arrow-right-to-line`, `square-x` close variants · `pin` / `pin-off` · `type` / `pilcrow` / `plus` for the Format / Paragraph / Insert submenus · `bold`, `italic`, `strikethrough`, `highlighter`, `code`, `sigma`, `percent`, `eraser` · `list`, `list-ordered`, `list-checks`, `heading-1`…`heading-6`, `quote` · `table`, `message-square-quote`, `square-code`, `square-sigma`, `separator-horizontal` · `scissors`, `copy`, `clipboard-paste`, `clipboard-type`, `square-dashed-text` · `check` (checked) · `chevron-right` (submenu) |
| Quick switcher / palette | `circle-x` clear button (rows have no icons, as in Obsidian) |
| Status bar | none: Obsidian's default status bar has no icons (only Sync adds one) |

Obsidian's own Backlinks and Outgoing links icons are custom glyphs, not Lucide, so I used Lucide's `link` and `link-2` rather than copy them.

## B. The menu component (`src/shell/menu.ts`)

- **Items:** icon, title, a right-aligned hotkey hint, disabled, checked (a check on the right), danger (red; on highlight it turns red-filled with white text), and submenus (a chevron on the right). Separators split sections. `tidy()` drops falsy entries, doubled separators and separators at either end, so menus can be built with `cond && item` (tested).
- **One highlight:** the mouse (`mousemove`) and the keyboard move the same `selected` state. Separators and disabled items are skipped. The highlight is instant, as in Obsidian, and nothing animates on a key.
- **Keyboard:** while a menu is open it owns the keyboard (capture phase on `window`; the menu never takes focus, so the editor keeps its caret).
  - ↑ / ↓ move and wrap. Home / End go to the first / last item.
  - Enter or Space activates; on an item with a submenu it opens the submenu with its first item highlighted. → also opens it.
  - ← or Escape closes the innermost submenu, then the menu.
  - A letter jumps to the next item starting with it (type-ahead).
  - While a menu or a prompt is open, the command hotkeys stand aside.
- **Submenus** open after hovering an item for 150ms, or straight away from the keyboard. Moving onto another item closes the open submenu after the same delay, so a diagonal move into the submenu doesn't lose it. A submenu is built only when it opens.
- **Placement:**
  - Context menus open at the pointer, and flip to the other side of it when there's no room.
  - Dropdowns open 4px under their button, left- or right-aligned (the tab list and More options align right). They flip above the button if there's no room below.
  - Everything is clamped 8px inside the window. A second click on a dropdown's button closes it.
  - The menu closes on a press outside it, on window blur or on resize.
  - The editor menu opened from the keyboard (Menu key, Shift+F10) appears at the caret with the first item highlighted, and the caret doesn't move.
- **Look:** 6px padding, 8px menu radius, 6px item radius (the brief's figure), 4px × 8px item padding at 13px, 8px icon gap, a separator line with 4px above and below that runs to the menu's edges, a 1px border and a soft two-layer shadow. The existing motion is kept: a 100ms fade and 4px drop on entrance, a fade on exit, a fade only for submenus, and nothing under `prefers-reduced-motion`.

The browser's own context menu is suppressed everywhere except in text inputs, since Obsidian shows none.

### Each menu compared with Obsidian

These are built in `src/shell/menus.ts`. Command items come from the registry, so they carry the command's icon, hotkey and availability (disabled when the command can't run).

**File explorer, note.** Open in new tab │ Make a copy · Move file to... · Bookmark (Remove bookmark when bookmarked) │ Copy path ▸ (From vault folder, From system root) │ Rename... · **Delete** (red).
*Left out:* Open to the right and Open in new window (no splits or windows); Merge entire file with... (no Note composer); Copy Obsidian URL (no URI scheme); Open version history (no Sync); Open in default app and Show in system explorer (they would need the opener's `open_path` / `reveal_item_in_dir` permissions, which the lockdown denies). Obsidian's "Bookmark..." opens a dialog; Grove bookmarks at once, so the label has no ellipsis.

**File explorer, folder.** New note · New folder │ Move folder to... · Bookmark │ Copy path ▸ │ Rename... · **Delete**. *Left out:* New canvas, Search in folder (if Obsidian has it), and the same system items as for notes.

**File explorer, empty space.** New note · New folder. *Left out:* New canvas.

**Editor.**
- On plain text: Add internal link · Insert Markdown link (Ctrl+K) │ Format ▸ · Paragraph ▸ · Insert ▸ │ Cut · Copy · Paste · Paste as plain text · Select all. Cut and Copy are disabled without a selection.
- On a `[[link]]`: Open link · Open in new tab replace the two link items. On an external link: Open link (through the system opener, from this explicit click) · Copy URL.
- With a selection: the same list, with Cut and Copy enabled, and the link items wrapping the selection.
- In Reading view: only the link items, Copy and Select all.
- Format: Bold · Italic · Strikethrough · Highlight · Code · Math · Comment │ Clear formatting.
- Paragraph: Bullet list · Numbered list · Task list │ Heading 1–6 · Body │ Quote.
- Insert: Table · Callout · Code block · Math block · Horizontal rule.
- *Left out:* Insert ▸ Footnote, and spelling suggestions. The submenu items use the command names ("Toggle bold"), which may differ slightly from Obsidian's shorter menu labels.

**Tab (right-click).** Close (shows Ctrl+W on the active tab) · Close others · Close tabs to the right · Close all │ Pin / Unpin │ Rename... · Move file to... · Bookmark │ Copy path ▸ · Reveal file in navigation │ **Delete file**. The "others", "to the right" and "all" items leave pinned tabs open and are disabled when they would close nothing. *Left out:* Split right / down, Move to new window, Open in new window.

**Tab list dropdown.** One row per open tab (`file-text`, or `file` for an empty tab), with a check on the active one │ Close all. *Left out:* Stack tabs (no stacked tabs) and Bookmark N tabs....

**More options (three dots).** Reading view / Editing view (Ctrl+E) · Source mode (checked when on) │ Rename... · Move file to... · Bookmark │ Find... (Ctrl+F) · Replace... (Ctrl+H) │ Copy path ▸ · Open linked view ▸ (Open backlinks, outgoing links, tags, outline: each opens that view in the right sidebar) │ Reveal file in navigation │ **Delete file**. That is 13 items plus submenus. *Left out* from Obsidian's ~25: Backlinks in document, Split right / down, Open in new window, Merge entire file with..., Add file property, Open version history, Open local graph, Open in default app, Show in system explorer, Export to PDF.... The help and settings placeholders are gone. The Reading view button is now real.

**Ribbon (right-click).** Each ribbon action with its icon and a check; clicking one shows or hides it (remembered in localStorage). As far as I know Obsidian's ribbon menu works the same way.

**Sort order dropdown** (file explorer header). File name (A to Z) · File name (Z to A) · Modified time (new to old) · Modified time (old to new), with a check on the current one. It is remembered per vault. *Left out:* the two Created time entries, because `list_files` has no creation time.

## C. Command registry, palette and quick switcher

### Registry (`src/commands.ts`, `src/appCommands.ts`)

- A `Command` has an `id`, a `name`, an optional `icon`, default `hotkeys`, an optional `when()` (whether it can run now) and `run()`. Each command is registered exactly once; registering an id twice throws (tested).
- **Names follow Obsidian's palette.** Core actions are plain ("Toggle bold", "Navigate back", "Create new note"); the views and tools are "Group: Action" ("Backlinks: Show backlinks", "Quick switcher: Open quick switcher", "Daily notes: Open today's daily note"). Ids follow Obsidian's where I know them (`editor:toggle-bold`, `app:go-back`, `markdown:toggle-preview`, …).
- **There are 62 commands:**
  - app and tabs: palette, switcher, new note, new folder, daily note, new tab, close tab, close others, next / previous tab, toggle pin, back / forward, left / right sidebar, Reading view, Source mode;
  - the open file: rename, delete, make a copy, move, reveal, copy path, bookmark / remove bookmark;
  - views: files, collapse all, search, bookmarks, backlinks, outgoing links, tags, outline;
  - editing: bold, italics, strikethrough, highlight, code, math, comment, clear formatting, Markdown link, internal link, bullet / numbered / task list, checkbox status, blockquote, headings 1–6, body, table, callout, code block, math block, horizontal rule, find, find and replace.
- **Hotkeys** are Obsidian's defaults: Ctrl+P, O, N, T, W, Tab, Shift+Tab, E, B, I, K, L, /, F, H, Shift+F, Ctrl+Alt+←/→, F2. The sidebar toggles keep round 3's Ctrl+Alt+[ / ] (Obsidian has none). On macOS, Ctrl is ⌘ and labels print as "⌘ P".
- **One global handler**, in the capture phase on `window`, so a command's hotkey beats the editor's own binding for the same keys (Ctrl+I is italics, not CodeMirror's select-parent). Plain typing returns at the first check, because without Ctrl, Cmd, Alt or an F-key nothing is looked up. Bracket hotkeys also match the physical key, since Alt changes the character on some layouts (tested).
- **Editor commands** are available only when a note is open, the tab isn't in Reading view, and focus isn't in another text field (the inline title, a search box).
- **Everything goes through the registry:** the ribbon, the tab-bar and view-header buttons, the file-explorer header, the empty-state links (whose hotkey hints now come from the registry), menus and hotkeys. `window.grove` is the registry in dev builds.

### Command palette (Ctrl+P, `src/shell/commandPalette.ts`)

- The shared prompt (below) lists every command that can run right now. Availability is read before the prompt takes focus, and focus goes back to where it was before the chosen command runs, so editor commands act on the editor.
- With an empty query, recently used commands come first (the last 10 run from the palette, kept in localStorage), then the rest alphabetically. With a query, fuzzy matches come best first, with matched letters in bold. Ties go to the more recently used command, then alphabetical (`paletteItems.ts`, tested).
- Each hotkey shows as a chip on the right. The footer reads "↑↓ to navigate · ↵ to use · esc to dismiss".
- Fuzzy matching all 62 commands takes **0.012ms on average and 0.03ms at worst per keystroke** (0.045 / 0.108ms with the CPU throttled 4×). The brief's limit is 2ms. A unit test checks that 200 commands stay under 2ms.

### Shared prompt and quick switcher (`src/shell/prompt.ts`)

- The quick switcher, the palette and "Move file to..." are now one component.
- It is a centred modal over a dim overlay: an input with a Lucide clear button, rows 8px × 12px at 14px with a grey highlight on the selected one, matched letters in bold, ↑↓ (or Ctrl+N / Ctrl+P) that wrap, Enter, Esc, and the hint footer. It keeps round 2's motion (fade, plus a 4px drop with a 0.98 scale settle) and reduced-motion behaviour.
- **The quick switcher keeps its round-3 behaviour:** recents first, the create row only when nothing matches well, Shift+Enter to create, Ctrl+Enter for a new tab. Its footer is now one centred line: "↑↓ to navigate · ↵ to open · ctrl ↵ to open in new tab · shift ↵ to create · esc to dismiss". Obsidian's "ctrl alt ↵ to open to the right" is left out because Grove has no splits.
- **Width:** the prompt now uses `--prompt-width: 700px` capped at 80vw, Obsidian's documented defaults, instead of 465px. See the deviations section.

## Other fixes from the round-3 side-by-side

| Finding | Fix |
|---|---|
| Right sidebar has only Backlinks and Outline | Added **Outgoing links** and **Tags** icon tabs with working views.<br>**Outgoing links** lists the notes the open note links to, with counts, and unresolved links faded underneath (clicking one creates the note, as in Obsidian). It reads the note's text, skipping fenced code, after a switch has painted or after the link index refreshes.<br>**Tags** shows every `#tag` in the vault with use counts. Nested tags form a collapsible tree (a parent counts its children), case is ignored, and clicking a tag runs a vault search for it. The backend has no tag index, so this view asks `search` for lines containing `#` and parses tags from those lines, only while the view is shown and 300ms after a vault change. |
| Bookmarks | Built cheaply and put in the left sidebar, where Grove (and the spec) already had a dead Bookmarks tab. Bookmarks are stored per vault in localStorage and follow renames and moves. Click a note to open it, or a folder to reveal it; right-click for the file menu. Added through the Bookmark menu items and the two palette commands. Not added to the right sidebar, because a second copy of the same view there would be odd. |
| Linked mentions count shows source notes | The count is now total link occurrences, like Obsidian (138 for Ideas in the test vault; the backend's link index has one entry per occurrence). Per-note counts are occurrences too, and Unlinked mentions counts every mention. Section headers are now 12px, weight 500, muted (they were 13px, 600, normal colour). |
| Outline highlights the active heading in the accent colour | Removed, including the scroll listener behind it; rows only get the grey hover. |
| Enter twice after a checked task leaves a blank line | CodeMirror's default turns a one-item list "loose" on the second Enter. The editor now uses `insertNewlineContinueMarkupCommand({ nonTightLists: false })`, so an empty item just drops its marker (or steps out one level). Checked in the app: `- [x] Done`, Enter, Enter, "plain" gives `- [x] Done\nplain`. Unit tests cover tasks, numbered lists and nested items. |
| Switcher footer missing hints, wraps | Now a single line (above). |
| Tab-list dropdown is plain titles | Icons, a check on the active tab, Close all. |
| "Not available yet" placeholders | **Reading view is real.** Ctrl+E, the view-header button and the menus switch a tab between Live Preview, **Source mode** (raw markdown) and **Reading view** (everything rendered and read-only, links still followed on click, checkboxes still toggle). The mode is per tab, applied through a CodeMirror compartment on note switch only when it differs, so it costs nothing on the default path. **Help and Settings are removed**: help would need the network, and there are no settings yet. |

Other additions that menu items needed:
- pinned tabs (links opened from a pinned tab go to a new tab);
- close others / to the right / all;
- make a copy ("Name 1.md");
- move to folder (a folder prompt; open tabs, history, loaded notes and recents follow the move);
- folder rename;
- New folder (new `create_folder` command, below; it starts an inline rename);
- New note in a folder;
- sort order;
- reveal in navigation (expands, scrolls to the row and flashes it, with no flash under reduced motion);
- editor formatting commands (`src/editor/format.ts`, tested);
- a muted forest-teal accent (`#27867a`) in place of Obsidian's violet. Only the accent tokens changed, so links, tags, checkboxes and selection turn teal while structure and spacing stay Obsidian's.

### Backend change (documented in `CONTRACT.md`)

`create_folder(path) -> FileEntry` creates an empty folder inside the vault and indexes it. It rejects escapes and ignored folders, and errors if anything already exists. It has a Rust test, an `allow-create-folder` permission, and a mock version. Nothing else in `src-tauri` changed except the lockdown fix below.

## D. Leftover lockdown work: the real Tauri window

**How it was run, without touching the owner's setup.**
- A throwaway vault and a home folder were created inside the worktree, with `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` pointed into it. Tauri's config folder, WebKit's storage and the remembered-vault file all follow those variables, so a pre-seeded `config.json` there opened the test vault.
- That folder's `mimeapps.list` made the "browser" a script that only writes the URL to a log. `xdg-open` was checked against it first, with a `.invalid` address.
- I used `tauri build --debug --no-bundle` rather than `tauri dev`, for two reasons. Another session's dev server holds port 1420, so `tauri dev` would have loaded that worktree's front end. And a built bundle runs on `tauri://localhost` under Tauri's own CSP, which is the configuration that matters.
- A temporary self-test module ran inside the window. It reported back through a deliberately blocked navigation, which the lockdown prints to the terminal. It was never committed. It, the vault and the home folder were deleted afterwards, and the final build was made without it.

**Results in WebKitGTK** (WebKit 605.1.15):
- **External links:** `api.openExternal("https://example.com/…")` reached the system handler. `openUrl("file:///etc/hostname")` was refused by the capability scope ("Not allowed to open url"). A synthetic (untrusted) click on a rendered link opened nothing.
- **Blocked navigation is logged:** `grove: blocked navigation to https://grove-selftest.invalid/report…`. The page stayed put.
- **Found and fixed: the opener plugin's injected link script.** A scripted click on an `<a target="_blank">` *did* reach the system browser. tauri-plugin-opener injects, by default, a page script that hands such clicks (and Ctrl/Shift-clicks on links) to the browser without checking `isTrusted`. Grove never renders those anchors and has its own trusted-click path, so the plugin is now built with `open_js_links_on_click(false)`. The offline audit fails if that setting is dropped (checked by flipping it). After the fix, the same scripted click opened nothing.
- **The docks animate:**
  - Each dock gets a `CSSTransition` on `width` of 130ms with `cubic-bezier(0.2, 0, 0, 1)`.
  - The pane's column-hold animation (130ms) is found and runs.
  - Widths step over 7–8 frames (for example 260 → 196 → 104 → 59 → … → 0, and 64 → 156 → 201 → 227 → … → 260), with the worst frame gap 17–18ms for all four moves.
  - `requestIdleCallback` is missing in WebKitGTK; the one place that uses it falls back to `setTimeout`.
- **Menus and the palette in WebKitGTK:** the file menu builds in 2–3ms and the editor menu in 6ms; the palette takes 3ms on first open and 1ms after; a submenu opens on hover. Reading view makes the content non-editable.
- **Not checked by eye:** the session was locked and the display mostly off, so there are no screenshots of the WebKitGTK window. A capture I tried showed the lock screen, and I deleted it. The checks above were read from the DOM and timing inside the window.

## Bundle size

| | Before (`3c473c6`) | After |
|---|---|---|
| `index-*.js` | 614.38 kB (gzip 211.78 kB) | 661.32 kB (gzip 225.91 kB) |
| `index-*.css` | 25.95 kB (gzip 5.40 kB) | 29.32 kB (gzip 5.93 kB) |

That is +47 kB of JS (+14 kB gzipped). The 74 Lucide icons account for about 11 kB raw, against about 4 kB for the old hand-inlined set. The rest is the new code: menus, commands, palette, formatting, views and bookmarks.

## Performance

**How it was measured.** The CDP harness from rounds 2 and 3 (dependency-free, kept in the session's scratchpad) drives headless Chromium at 1280×800 against the Vite dev server and the mock vault (Big note: 5,000 lines, 386k characters).
- The base commit `3c473c6` was served from a scratch copy on its own port.
- Both builds ran through the same harness, alternating.
- Both servers were bound to 127.0.0.1 on ports no other session uses. My first baseline run hit `localhost:1421`, which turned out to be shared with another session's dev server, so I threw those numbers away and re-measured.

Means in ms, p95 in brackets:

| | Before | After, sidebar closed | After, Outgoing links open | After, Tags open |
|---|---|---|---|---|
| Typing, key to frame, 1× | 9.9 (17.5), 9.8 (17.1), 9.9 (17.5), 10.2 (17.8) | 10.1 (17.5), 10.2 (18.0) | 10.4 (17.7) | 10.3 (18.0) |
| Note switch to painted frame, 1× | 19.9 (23.3), 20.3 (22.7), 20.1 (23.1), 19.9 (22.8) | 19.6 (22.7), 20.1 (23.1) | 20.4 (23.2) | 20.1 (23.0) |
| Switch, synchronous work, 1× | 2.4 | 2.4 | 2.4 | 2.4 |
| Typing, 4× CPU | 17.8 (22.6), 17.1 (22.3) | 17.5 (22.6) | 16.2 (21.9) | 17.2 (22.5) |
| Note switch, 4× CPU | 32.9 (42.9), 32.8 (43.7) | 32.6 (43.0) | 32.7 (42.3) | 32.9 (41.8) |
| Longest frame in the 250ms after a switch | 16.7–16.8 | 16.8 | 16.8 | 16.8 |

Typing stays at about 10ms and note switching well under 50ms. Nothing new runs per keystroke beyond two O(1) checks:
- the hotkey handler's first `if`;
- Enter's list command, which is CodeMirror's own, now configured differently.

**Menus and prompts**, timed from the real input event to the end of the next painted frame (15 opens each, Big note open, mean / p95):

| | 1× | 4× CPU |
|---|---|---|
| File menu (right-click) | 16.3 / 17.2 | 17.7 / 19.2 |
| Editor menu (right-click) | 16.9 / 17.5 | 19.1 / 27.8 |
| Tab menu (right-click) | 10.1 / 17.7 | 12.7 / 19.4 |
| More options (click) | 9.1 / 16.1 | 12.4 / 18.3 |
| Command palette (Ctrl+P) | 10.8 / 21.5 | 16.7 / 42.1 |
| Quick switcher (Ctrl+O) | 9.5 / 15.7 | 13.2 / 19.3 |

At 1× everything shows on the first frame after the input, because ~16.7ms is one vsync of waiting. Synchronous build times are 2–3ms for the palette and about 2ms for the switcher.

The palette's p95 outliers came from a cost that predates this round:
- The first prompt of the session took about 16ms of layout. The cause was the system font fallback for the footer's ↑ ↓ ↵ glyphs, which Noto Sans lacks. The base build's quick switcher showed the same 16ms first open.
- That layout now happens once, hidden, while the app is idle after startup (`warmUpPromptGlyphs`; about 10ms, off any interaction). The first palette opening dropped from 19ms to 4ms of synchronous work.
- I also swapped `localeCompare` for a plain comparison in the palette's sort, to avoid building a collator on first open.
- The table above was measured before both changes.

**Motion.** Only opacity and transform animate in anything new: menus, submenus, the prompt and the reveal flash (an overlay that fades). Under emulated `prefers-reduced-motion: reduce`, menus and the palette appear and disappear at once (checked: animation duration 0s, removed immediately).

## Skipped, deviations and caveats

- **Obsidian wasn't observed live** (see the top). The items to check side by side, most uncertain first:
  - the quick-switcher ribbon glyph (`arrow-left-right`; round 3 had used the terminal glyph, which I gave to the command palette so the two don't repeat);
  - the tab menu containing the file items;
  - the Close-variant icons;
  - the menu background (white, as before);
  - the tag pane showing nested children as "#later" rather than "later";
  - the exact More options order.
  Each is a one-line change in `menus.ts` or `icons.ts`.
- **Prompt width differs from the spec.** `OBSIDIAN_FEEL_SPEC.md` says about 465px, but the round-3 finding says Obsidian's footer fits all its hints, including "ctrl alt ↵ to open to the right", on one line. That can't happen at 465px with 12px text. Obsidian's documented default is `--prompt-width: 700px` with an 80vw cap, so I used that. If the owner's Obsidian really is 465px, set the token back; the footer would then need smaller text.
- **Teal accent:** the brief invites it, so I made it the accent. It is a single set of tokens in `theme.css` if the owner wants it subtler or back to violet.
- **No splits or windows**, so every "to the right", split and new-window item and hint is left out rather than dead.
- **System-integration items** are left out: Open in default app, Show in system explorer (the lockdown denies the needed opener permissions), version history, Copy Obsidian URL, Export to PDF, file properties, Merge with.
- **Clipboard in the editor menu:**
  - Cut and Copy use the native commands (CodeMirror handles them), with the async clipboard API as fallback.
  - Paste tries `execCommand("paste")` and falls back to `navigator.clipboard.readText()`. In headless Chromium the fallback asks for permission. I couldn't test real pasting in WebKitGTK; wry is expected to allow `execCommand("paste")` there, but that is unverified.
  - These four aren't registered commands, since Obsidian's palette doesn't list them either.
- **Tags view limits:** it reads `#tags` from lines the backend's `search` returns, so frontmatter `tags:` aren't counted, and inline code is skipped only within a line. A `tag_index` backend command would be the clean fix if this matters.
- **Outgoing links:** it has no "Unlinked mentions" section; matching every note title against a 386k-character note was too slow to run on a note switch. Only `[[wikilinks]]` count, not markdown links to `.md` files.
- **Bookmarks** live in localStorage, not `.obsidian/bookmarks.json`, so they aren't shared with Obsidian. The backend skips `.obsidian/`, and reading it would mean a new command.
- **Created-time sort** is left out, because `list_files` has no creation time.
- **Source mode** shows plain text. Live Preview's styling (heading sizes and so on) comes from its decorations, which source mode turns off. Ctrl+click on links doesn't work there either.
- **Tests run in node,** so DOM behaviour (menus, prompt, views) was checked through real input events in headless Chromium and partly in the WebKitGTK window, not by unit tests. Pure logic has unit tests: menu tidying, registry and hotkeys, palette ranking and timing, formatting commands, list Enter, link detection, tag parsing and tag tree, wikilink extraction.
