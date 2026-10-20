# Round 5: splits and panes

Everything in `SPLITS_PANES_TASK.md` is done, except the items under "Skipped, deviations and caveats" at the end. `npm run build`, `npm test` (75 tests, up from 53), `npm run audit:offline` and `cargo build` all pass. Typing and note switching are as fast as before, also with the same note open in two panes (numbers below). The backend is unchanged, so `CONTRACT.md` is too.

Commits on `rebuild/r5-claude`, oldest first:

| Commit | What |
|---|---|
| `4dfb20b` | Layout model: tab groups in nested splits, DOM-free and tested |
| `2f7b4db` | Source mode: Obsidian's highlighted raw markdown instead of plain text |
| `3210a0a` | Menus: Obsidian's lighter shadow, edge and background |
| `1b26c03` | Splits and panes: tab groups, drag and drop, synced panes, longer menus |
| `15a5d98` | Outgoing links: Unlinked mentions, as in Obsidian |
| `a170993` | Tags view: count frontmatter tags |
| `647e295` | Unlinked mentions: read words without arrays, scan in short slices |
| `9f6ffc1` | Splits: one-frame split and close, both panes keep their top line |
| `5037827` | Source mode: tags keep their #, struck and code markers take their text's style |
| `b2e2584` | Split dividers: tolerate a pointer that can't be captured |
| (last) | These notes |

## How Obsidian was observed this time

Round 4 couldn't look at Obsidian live. This round I could, without touching the owner's setup:

- Obsidian 1.14.4 (the installed package) ran with `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_DATA_HOME` pointed at a throwaway folder in the session scratchpad. It opened a throwaway four-note vault there. The owner's `~/.config/obsidian` and vaults were never opened.
- It ran inside its own network namespace (`unshare --net`, loopback only), so it couldn't reach the network. It also ran headless (`--ozone-platform=headless`), so no window appeared.
- I drove it over the Chrome DevTools Protocol. I read what is on screen: menu items and their Lucide icon classes, layouts and sizes after each action, computed shadows and colours, and screenshots. I also read Obsidian's runtime command list (`app.commands`) for command names, ids and default hotkeys.
- I did not open, copy or read Obsidian's source, CSS files or bundled assets. Everything in Grove is written from these observations.

The facts below that say "observed" come from this. They replace several of round 4's guesses: menu contents and icons, the menu shadow and background, the quick-switcher width, and the ribbon.

## A. Tab groups and splits

### The layout model (`src/layout.ts`, tested in `layout.test.ts`)

- A tree, as in Obsidian:
  - **Leaves are tab groups.** Each has its own tabs and active tab.
  - **Inner nodes are splits.** A split is `vertical` (children side by side, Obsidian's "Split right") or `horizontal` (stacked, "Split down"), and splits nest.
  - One group is the active pane.
- **Sizes are fractions of the parent split.** The DOM lays them out with `flex-grow`, so a window resize scales every pane (checked: 0.36/0.64 at 1280px and at 1000px).
- **Splitting a group:**
  - Next to a sibling in a split of the same direction, the new group joins that split.
  - Otherwise the group is replaced by a new two-child split.
  - Observed sizing: until a divider has been dragged, siblings share the space equally (two panes plus "Open to the right" gave 312/312/312). After a drag, the new group takes half of the group it split (318 became 159 + 159). The model keeps a `resized` flag per split to do the same.
- **Collapsing a group:**
  - Its space goes to the sibling before it, or the one after it if it was first.
  - A split left with one child is replaced by that child.
  - A child split in the same direction as its new parent merges into it.
  - The nearest group on the side that took the space becomes active.
  - The last group is never removed.
- **Also in the model:**
  - Moving a tab within or between groups. A group left empty collapses.
  - Moving a tab onto an edge. A group's only tab dropped on its own edge does nothing.
  - Resizing within a minimum per pane. Nested panes add up along the axis, so a row of two needs room for two.
  - Finding the neighbour group by geometry, for "Focus on tab group to the left" and similar.
  - Save and restore, dropping tabs whose notes are gone and tidying the tree.
- The module has no DOM or editor code; the tab type is a parameter. It has 11 tests.

### How it is saved

- The workspace is saved per vault in `localStorage` under `grove.workspace:<vault path>` (the webview's own storage; nothing networked). It holds:
  - the split tree with sizes and `resized` flags;
  - each group's tabs and active tab;
  - per tab: note, mode (Live Preview, Source or Reading), pinned flag, back/forward history (last 20 each way), scroll position and selection;
  - which group is active.
- It is written 500ms after any change to tabs, layout or mode, and when the window closes.
- On launch it is rebuilt before the first note shows:
  - Tabs whose notes no longer exist are dropped quietly, and so are history entries that point at missing notes.
  - Groups left empty disappear as if closed.
  - If nothing survives, Welcome opens as before.
- Checked by reloading: the tree, sizes, active pane and the Big note pane's scroll position (4000px) all came back.

### One editor per group; the same note in two panes (`src/workspace.ts`)

- Each tab group has its own `EditorView`. Note switching inside a group swaps `EditorState`s with `setState`, as before, so switching costs the same.
- **One source of truth per note.** Each loaded note has one main state, which holds its undo history, and exactly one view on screen shows it.
  - Any other pane showing the same note gets a light mirror state: the same document, no history, and its own selection.
  - A mirror copies the main state's word counts rather than recounting the note.
- **Every view dispatches through one function** (`dispatchTransactions`). A change is applied in the pane it was typed in, then forwarded to every other pane showing that note as a transaction carrying the same `ChangeSet`.
  - Forwarded copies are marked with an annotation and keep the original `userEvent`.
  - When a change made in a mirror reaches the main state, it is recorded in the main history, grouped like any typing. This is CodeMirror's split-view pattern.
- **Undo and redo in a mirror** (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) run on the main state, and the result is forwarded back.
- **Saving and the "doc" event** follow the original change only, so a note is saved once whichever pane it was typed in. Checked by counting `write_note` calls with the same note open in two panes: one write per burst of typing.
- **When the pane holding the main state stops showing the note** (another tab, a closed group), another pane showing it takes the main state over. It keeps its own selection and scroll. A note on screen therefore always has its main state on screen, and no keystroke ever updates a hidden copy. Checked: close the owner pane, type in the other, and Ctrl+Z still undoes.
- **Each pane keeps its own selection and scroll.** A tab remembers where it was in its note when it is hidden or moved, and gets it back when shown again.
- **Renames, moves, deletes and outside changes** reach every pane:
  - A rename keeps both panes in sync under the new name.
  - A delete leaves both panes in the empty state.
  - A change on disk goes through the main state and is forwarded like any edit, without scheduling a save.

### Splitting, closing, collapsing

- **Split right / Split down** (tab menu, More options, commands) put a new group beside or below the tab's group. It shows the same note in the same mode and selection, and becomes active.
  - Both panes are now narrower (or shorter), so the same scroll offset would show different text. Both are anchored instead to the line that was at the top of the old pane. Checked: line 2500 at the top before, and line 2500 at the top of both panes after.
- **Closing the last tab in a group** collapses the group, and its space goes to its sibling.
- **Closing the last tab in the last group** leaves the "New tab" empty state, as before.
- **"Close this tab group"** closes all its tabs. Undo close tab (Ctrl+Shift+T) brings them back one at a time, into their old group if it still exists.

### Resize handles

- Each boundary has a 1px line in the border colour with a 7px grab area centred on it, like Obsidian's.
  - Hovering a moment (300ms) or dragging lights it with a 3px accent bar. That is an opacity fade on a pseudo-element; nothing else changes.
  - Observed in Obsidian: a 3px handle with a 1px #e4e4e4 line, which turns accent while dragging.
- **A drag:**
  - reads the split's size once;
  - computes the two neighbours' sizes from the pointer each frame (rAF-coalesced, clamped by `Layout.resize`);
  - writes only their `flex-grow` and the divider's offset;
  - commits to the model and saves on release.
- No editor is re-created. Each CodeMirror view re-measures itself as its width changes.
- **Minimum pane size:** 160px across and 120px down. A row of two panes needs twice that. Dragging past the minimum stops at it (checked: dragged 2000px left, the pane stopped at 160px).

### Active pane

- A press or focus anywhere in a pane makes it active.
- With more than one pane, the other panes' active tab and title are drawn in the muted text colour. There are no borders and no accent. This follows Obsidian, where the inactive groups' tabs read slightly muted.
- Only the pane in the top-right corner has the right-sidebar button (observed). Only panes along the top edge double as the window's title bar (`data-tauri-drag-region`). The top-right one leaves room for the window buttons.

### Drag and drop (`src/shell/tabDrag.ts`)

- **Starting:** a press on a tab activates it, as before. Moving 5px starts a drag.
  - A small ghost (icon and title) follows the pointer.
  - The tab's own header fades to 50%.
  - Every pane, tab bar and tab header is measured once, when the drag starts.
- **Where it lands:**
  - **Over a tab bar:** the tab goes before the first tab whose middle is right of the pointer. A thin accent bar shows the spot. This works for reordering in its own bar and for moving into another group's bar.
  - **Over a pane's content:**
    - Within 25% of an edge, the pane splits on that side and the overlay covers that half.
    - Anywhere else, the tab moves into that group, at the end, and the overlay covers the whole pane.
  - Drops that would change nothing show nothing: a group's only tab over its own pane, or a tab over its own spot.
- **The overlay** is a translucent accent box with rounded corners, inset 3px, like Obsidian's (observed: an accent-tinted rounded box that glides between zones in about 100ms). It is one element the size of the workspace, placed and sized with `transform: translate() scale()`. It therefore glides between places on the compositor, with a 100ms ease-in-out transform and opacity transition. The first placement jumps.
- **Escape** cancels the drag. Releasing over nothing does nothing. Under reduced motion the overlay and ghost appear and go at once.
- **Moving a group's only tab to an edge** hands that group's editor to the new group. The editor DOM moves and nothing re-renders.
- **Moving a tab into an existing group** shows it there with `setState` and puts back its scroll and selection.

### Move tab between groups from the keyboard

Obsidian has no command for this (its command list was checked). Grove adds four, unbound: "Move current tab to the tab group to the left / right / above / below". They use the same neighbour lookup as the focus commands.

### Open to the right, Ctrl/Cmd+click

- **Observed: "Open to the right" always makes a new group immediately to the right of the active one.** It doesn't reuse an existing right-hand group (three times in a row gave four panes). Grove does the same.
- **In the editor:**
  - Ctrl/Cmd+click on a link opens it in a new tab placed after the active one (observed), as before.
  - Ctrl/Cmd+Alt+click opens it to the right.
  - The same choices apply to link clicks in the file explorer, search, bookmarks and the Outgoing links view.
- **Quick switcher:**
  - Ctrl+Alt+Enter opens to the right.
  - The footer has Obsidian's sixth hint, "ctrl alt ↵ to open to the right" ("⌘ ⌥ ↵" on macOS).
  - The footer is still one line (34px high at 700px wide).
- **Mode button:** Ctrl/Cmd+click on the view header's mode button opens the other view of the note to the right. Its tooltip says so, as Obsidian's does (observed: "Ctrl+Click to open to the right").

### Linked panes

Skipped. The brief makes them optional, and they don't fall out of this design cheaply: they would need a tab-to-tab link model, its own menu ("Link with tab...") and following logic. The "Link with tab..." item is left out of the tab menu for the same reason.

### Navigation history per pane

Back and forward belong to each tab (`back` / `forward`). The commands and buttons act on the active pane's tab, so each pane walks its own history only. Checked: following a link in the right pane enabled back there and not in the left pane, and back returned only the right pane.

### Existing features, per active pane

- The **right sidebar views** (Backlinks, Outgoing links, Tags, Outline) follow the active pane's note and editor. Focusing another pane refreshes them, after paint, as a note switch does. Checked: Backlinks showed 2 and then 988 linked mentions as focus moved between panes.
- The **status bar** shows the active pane's backlinks, words and characters. The words come from that pane's state (a mirror carries its own counts).
- **Reading / Source / Live Preview** stays per tab. The same note can be in Reading view in one pane and Live Preview in the other (checked).
- The **command palette and all editor commands** act on the active pane's editor. The editor's right-click menu first makes its pane active.

## B. Menu items and commands that need splits

### Menus compared with Obsidian 1.14.4 (observed), in Obsidian's order

Items in [brackets] are in Obsidian but left out of Grove, with the reason under each menu.

**File explorer, note.** Open in new tab · **Open to the right** · [Open in new window] │ Make a copy · Move file to... · Bookmark · **Merge entire file with...** │ Copy path ▸ │ [Open version history] │ [Open in default app · Show in system explorer] │ Rename... · Delete.
Icons now match Obsidian's: `file-plus`, `separator-vertical`, `files`, `folder-tree`, `bookmark`, `git-merge`, `clipboard`, `pen-line` (Obsidian's `edit-3`), `trash-2`.

**File explorer, folder.** New note · New folder · [New canvas · New base] │ [Make a copy] · Move folder to... · **Search in folder** · Bookmark │ Copy path ▸ │ [Show in system explorer] │ Rename... · Delete. "Search in folder" fills the search view with `path:"Folder" `. The search view now understands Obsidian's `path:` filter (`searchQuery.ts`, tested): on its own it lists the folder's notes, and with words it narrows the hits.

**File explorer, empty space.** New note · New folder (unchanged). [New canvas · New base].

**Editor, plain text.** **Add link** · **Add external link** │ Format ▸ · Paragraph ▸ · Insert ▸ │ Cut · Copy · Paste · Paste as plain text · Select all. These are Obsidian 1.14's labels and icons (`link`, `external-link`, `paintbrush`, `pilcrow`, `list-plus`, `clipboard-check`, and `square-dashed`, Obsidian's `box-select`). The submenus use Obsidian's short labels:
- Format: Bold · Italic · Strikethrough · Highlight │ Code · Math · Comment │ Clear formatting.
- Paragraph: Bullet list · Numbered list · Task list │ Heading 1–6 · Body │ Quote.
- Insert: **Footnote** · Table · Callout · Horizontal rule │ Code block · Math block. Footnote is new: "[^n]" at the caret, with its definition at the end of the note.

**Editor, on a [[link]].**
- **Open in new tab** · **Open to the right** · [Open in new window]
- │ Add link · Add external link
- │ **Edit link** (selects the link's target text) · Paragraph ▸ · Insert ▸
- │ Cut ... Select all
- │ Copy path ▸
- │ Rename... · Move file to... · Bookmark
- │ [Open in default app · Show in system explorer] · Reveal file in navigation

The copy, rename, move, bookmark and reveal items act on the linked note, as observed. Round 4's "Open link" item is gone; Obsidian 1.14 has none, since a plain click follows the link. On an external link: Open link · Copy URL, then the usual items (unchanged).

**Tab (right-click).** Observed: every tab gets the close and pin items, and only the active tab of its group gets the rest.
- Any tab: Close · Close others · **Close tabs after** (Obsidian's label) · Close all │ Pin, all acting within the tab's group.
- The active tab adds: [Link with tab...] · [Backlinks in document] · Reading view · Source mode │ [Move to new window] · **Split right** · **Split down** · [Open in new window] │ Rename... · Move file to... · Bookmark · **Merge entire file with...** · [Add file property · Export to PDF...] │ Find... · Replace... │ Copy path ▸ │ [Open version history] · Open linked view ▸ │ [Open in default app · Show in system explorer] · Reveal file in navigation │ Delete file.
- An empty tab gets Split right / Split down after Pin.

**Tab list (chevron).** Observed order: [Stack tabs] · **Bookmark N tabs** │ Close all │ the group's tabs, with a check on the active one. It lists the tabs of its own group.

**More options (three dots).** [Backlinks in document] · Reading view · Source mode │ **Split right** · **Split down** · [Open in new window] │ Rename... · Move file to... · Bookmark · **Merge entire file with...** · [Add file property · Export to PDF...] │ Find... · Replace... │ Copy path ▸ │ [Open version history] · Open linked view ▸ │ [Open in default app · Show in system explorer] · Reveal file in navigation │ Delete file.

**Why items are left out:**
- **Open in default app, Show in system explorer:** they need the opener's `open_path` / `reveal_item_in_dir` permissions, which the lockdown denies on purpose.
- **Open in new window, Move to new window:** no windows (new windows are denied by the lockdown's `on_new_window`).
- **Link with tab...:** linked panes are skipped (above).
- **Stack tabs:** no stacked tabs.
- **Backlinks in document:** this would need a backlinks panel embedded under each pane's editor. It's possible but not cheap, so it is not done this round.
- **Add file property:** no properties UI.
- **Export to PDF...:** printing needs a webview permission Grove doesn't grant.
- **Open version history:** that's Sync.
- **New canvas / New base:** no canvas or bases.
- **Folder "Make a copy":** it would copy only the `.md` files, since `read_note` is text-only. A partial copy would mislead.

**What the new items do:**
- **Merge entire file with...** is new (a note picker, `mergePrompt.ts`). It appends this note's text to the chosen note after a blank line, then deletes this note to the vault's `.trash`. Tabs showing it switch to the merged note.
- **Bookmark items** still bookmark at once, so they have no "..." (Obsidian's open a dialog).

### Commands and hotkeys

Names, ids and default hotkeys come from Obsidian's own command list (read from its registry). The brief's examples used a "Workspace: " prefix, but Obsidian's palette actually says "Split right", "Split down", "Close this tab group", so Grove uses those exact names. Obsidian has no default hotkeys for splitting, so those are unbound. The palette went from 62 commands to 112.

New, for splits and panes:

| Command (id) | Hotkey |
|---|---|
| Split right (`workspace:split-vertical`) | none (as Obsidian) |
| Split down (`workspace:split-horizontal`) | none |
| Close this tab group (`workspace:close-tab-group`) | none |
| Close others in tab group (`workspace:close-others-tab-group`) | none |
| Close all other tabs (`workspace:close-others`), now in every group | none |
| Focus on tab group to the left / right / above / below (`editor:focus-left` ...) | none (as Obsidian) |
| Move current tab to the tab group to the left / right / above / below (Grove's own) | none |
| Undo close tab (`workspace:undo-close-pane`) | Ctrl+Shift+T |
| Go to tab #1–#8, Go to last tab | Ctrl+1–8, Ctrl+9 |
| Go to next / previous tab | now also Ctrl+PageDown / Ctrl+PageUp (Obsidian's second hotkeys) |
| Open link under cursor in new tab / to the right / Follow link under cursor | Ctrl+Enter / Ctrl+Alt+Enter / Alt+Enter (internal links only; available only when the caret is on one) |
| Create note to the right (`file-explorer:new-file-in-new-pane`) | Ctrl+Shift+N |
| Create new note in current tab | none |

Other existing actions now registered (round 4 finding 2), with Obsidian's names:

- Note composer: Merge current file with another file...
- Copy current file path from vault folder / from system root (round 4's "Copy file path" renamed to Obsidian's)
- Save current file (Ctrl+S)
- Bookmarks: Bookmark all tabs
- Daily notes: Open previous / next daily note
- Random note: Open random note
- Templates: Insert current date / time (YYYY-MM-DD and HH:mm, Obsidian's defaults)
- Insert footnote
- Move line up / down
- Add cursor above / below
- Delete paragraph (Ctrl+D)
- Indent / Unindent list item
- Remove heading
- Show context menu under cursor
- Focus on last note
- Toggle ribbon
- Toggle readable line length (remembered)
- Increase / Decrease font size (remembered)

Some existing names were corrected to Obsidian's: "Toggle italic", "Toggle inline math", "Set as heading n", "Files: Create new folder", "Tags view: Show tags". Command icons follow Obsidian's where it has them (e.g. `navigation` for the quick switcher command, `file-plus` for new note).

Hotkey conflicts follow Obsidian:
- Ctrl+D is Delete paragraph, not CodeMirror's select-next-occurrence.
- Ctrl+Enter on a link opens it in a new tab. Off a link it falls through to CodeMirror's insert-blank-line, because the command is only available on a link.

## C. Round 4 findings

| # | Finding | Fix |
|---|---|---|
| 1 | Menus shorter than Obsidian's | All menus rebuilt from the observed 1.14.4 menus (section B): split items, Open to the right, Search in folder, Merge, Edit link, Footnote, Close tabs after, Bookmark N tabs, the linked note's file items on a link, Obsidian's short submenu labels and its icons. Open in default app and Show in system explorer stay out (lockdown); the other left-out items and reasons are listed above. No dead items. |
| 2 | Small command list | 62 → 112 commands (section B). |
| 3 | Fewer ribbon icons | Observed default ribbon: quick switcher (`file-search`), graph, canvas, daily note (`calendar`), insert template, command palette (`terminal`), bases, plus Random note (`dices`) when that core plugin is on. Grove now uses Obsidian's glyphs and order for what it has, and adds **Random note**. Graph, canvas, templates and bases are left out (no such features). Grove's own "Create new note" button stays, last; Obsidian has none in its ribbon, and it can be hidden from the ribbon's menu. |
| 4 | Heavy menu shadow | Measured on Obsidian: a three-step shadow (0 1px 2px .027, 0 3.4px 6.7px .043, 0 15px 30px .07), a #dadada edge and the secondary background (#f6f6f6). These are now the `--menu-*` tokens. Round 4 had flagged the white menu background as unsure; it was wrong and is fixed. The prompt's shadow was measured the same way and updated. |
| 5 | Quick switcher width unchecked | Measured: Obsidian's switcher and palette are **700px** wide at 1280px, still 700px at 900px (the 80vw cap is 720px), and 120px from the top. The six-hint footer fits on one line (32px). Grove's 700px stays. The spec's ~465px is out of date; at 465px the footer couldn't fit. Grove's footer, with the new sixth hint, is one line (34px). |
| 6 | Source mode unstyled | `src/editor/sourceMode.ts`, loaded only through Source mode's compartment, so Live Preview and Reading view are unchanged. A class-based highlighter in the normal text font: faint marks (heading #, list markers, quote >, link brackets), accent links and URLs (URLs underlined), bold, italic, struck and inline-code text with their markers in the same style, `[ ]` task markers in monospace and muted, tags as pills, and code blocks on the grey band. Headings are bold at the body size, as the brief asks. See the caveat about heading sizes below. |
| 7 | Outgoing links lacks Unlinked mentions | Added, collapsed by default. Observed: one card per mention with the line and the match highlighted, and under it a button with the note's name that turns the mention into a link. Grove does the same. The button writes `[[text]]` (or `[[Name\|text]]` when the case or spacing differs) and only if the line is unchanged. Clicking a card selects the mention in the editor. Matching is in `unlinked.ts` (tested): other notes' names, whole words, any case, any whitespace between words, longest name first; skipping the note itself, fenced code, frontmatter, inline code, wikilinks, markdown links, URLs and tags. It never runs on a keystroke: only while the section is open, after a switch has painted and 300ms after typing stops. It works in one pass whatever the number of notes, and in 6ms slices, so no long task. Big note takes about 19ms in total; 5,000 lines against 1,000 note names about 95ms, spread over slices. |
| 8 | Frontmatter tags not counted | `frontmatterTags` (tested) reads `tags:` (or `tag:`) as a YAML list, an inline list or a plain value, with or without `#`, quoted or not, and treats " #" as a YAML comment as YAML does. Observed in Obsidian: `- "#beta"` counts as beta. Saved notes: a search for the key finds the notes that have it, and only those are read, again only when their modified time changes (Grove's own saves and watcher "modify" events now bump it). The open note is still read from the editor, so unsaved frontmatter counts (checked by typing a tag into it). Fenced-code skipping is unchanged, and a `#` inside frontmatter is no longer read as an inline tag. |

## Performance

**How it was measured.**
- A small dependency-free CDP harness (scratchpad, not committed; earlier rounds' wasn't in this worktree) drives headless Chromium at 1280×800.
- It runs against the Vite dev server and the mock vault (Big note: 5,000 lines, 386k characters).
- The baseline is this round's start, commit `3225bb9`, extracted to a scratch folder and served on its own port.
- Builds alternated, two runs each.

What each measurement does:
- **Typing:** 80 keys at line 2,500, from the keydown timestamp to the end of the next rendered frame. The 2-pane run has Big note open side by side with both panes at line 2,500.
- **Switch:** 40 alternating opens of Welcome and Big note, to the painted frame, plus the longest frame in the 250ms after.
- **Split / close / move:** 20 of each, as synchronous work and to the painted frame.
- **Resize:** a 60-step divider drag with both panes showing Big note, rAF gaps recorded.

Means in ms (p95):

| | Before, 1× | After, 1× | Before, 4× CPU | After, 4× CPU |
|---|---|---|---|---|
| Typing, key to frame | 9.7 (17.2), 10.9 (18.0) | 10.4 (18.3), 10.3 (17.4) | 16.9 (33.3), 16.2 (28.0) | 16.5 (22.9), 18.4 (31.6) |
| Typing, same note in two panes | n/a | 11.0 (18.7), 10.9 (18.2) | n/a | 19.3 (24.8), 23.0 (27.3) |
| Note switch, to painted frame | 18.1 (21.7), 18.4 (21.6) | 18.4 (21.6), 18.4 (22.7) | 34.0 (48.4), 33.4 (46.1) | 33.4 (48.5), 33.9 (47.6) |
| Note switch, sync work | 2.5, 2.6 | 2.2, 2.3 | 9.5, 9.0 | 8.1, 8.9 |
| Note switch in the right pane of a split | n/a | 13.2 (14.4) to paint, 2.2 sync | n/a | 20.7 (24.8), 8.6 sync |
| Longest frame after a switch | 17.1 | 17.1–17.4 | 17.5–17.6 | 18.6–19.0 |
| Split right, sync work | n/a | 1.9–2.3 (4.9) | n/a | 7.5–8.6 (16.5) |
| Split right, to painted frame | n/a | 18.0–18.5 (20.5) | n/a | 37–39 (45.6) |
| Close tab group, sync / to paint | n/a | 4.0 / 7.3–7.7 | n/a | 16 / 21 |
| Move a tab between groups, sync / to paint | n/a | 3.5 / 13.4 (17.0) | n/a | 14.4 / 38.7 |
| Resize drag frames | n/a | 16.7 mean, max 16.8, 0 of 88 over 20ms | n/a | 0 of 94 over 20ms once the split has settled (see below) |

- **Typing** stays at about 10ms, and at about 11ms with the same note in two panes. The extra ~0.6ms is the second pane drawing the same change, which can't be avoided.
- **Note switching** is unchanged (about 18ms to the painted frame, about 2ms of work), and faster in a half-width pane.
- **Splitting** costs about 2ms of work and is painted in the next frame.
  - The first version took 12.3ms. Three causes:
    - the new pane re-counted Big note's words;
    - the old pane's DOM moved into a new split container, so its scroll was lost and restored, forcing layouts;
    - focus forced a layout.
  - Fixes:
    - mirrors copy their counts;
    - the top split is drawn by the root element itself, so splitting a lone pane moves nothing;
    - scroll is only restored for panes that actually moved;
    - focus moves on the next frame.
- **Resize drags** hold 16.7ms frames at 1×, and at 4× once the split has settled. At 4× CPU the first ~100ms after a split can show two ~50ms frames. That is CodeMirror's background parse of the new pane's state, its normal idle-time parsing (as when a long note is first opened), not the drag. With a 1.5s pause before dragging, 4× showed 0 slow frames out of 94.
- **Motion:** only transform and opacity animate in anything new (the drop overlay, ghost and divider highlight; tabs keep round 3's grow and shrink). Under emulated `prefers-reduced-motion: reduce` the overlay has 0s transitions and is removed at once, and nothing else animates (checked: no animation running right after a split).
- **Network:** zero requests to anything other than the local dev server in every run.

**Bundle:** JS 662.7 → 713.5 kB (gzip 226.5 → 242.3 kB), CSS 29.6 → 35.4 kB (gzip 6.0 → 6.8 kB).

## WebKitGTK smoke test

Tauri renders with WebKitGTK, so the main flows were also run in WebKitGTK 2.54.1's MiniBrowser against the dev server, with an injected test script:
- split (6ms), and typing kept in sync;
- the drag overlay and a drop on a pane's edge;
- a divider drag (sizes 0.36/0.64);
- Source mode classes;
- frontmatter tags in the Tags view;
- closing a group (4ms).

All passed. One fix came out of it: WebKit refuses `setPointerCapture` for a pointer it doesn't know (the synthetic test's), which stopped the divider drag. The handle now carries on without capture (commit `b2e2584`). Real pointers were never affected.

The window appeared briefly on screen and was closed by the test. MiniBrowser needed `WEBKIT_DISABLE_DMABUF_RENDERER=1` on this NVIDIA/Wayland machine (a WebKitGTK driver issue, not Grove's). If the Tauri window ever shows the same "Error 71 (Protocol error)", that variable is the known fix.

## Skipped, deviations and caveats

- **Source-mode heading sizes.** The brief asks for heading sizes off, and Grove does that. Observed in a clean Obsidian 1.14.4 profile, however, source mode keeps the heading sizes (H1 at about 26px) with a faint `#`. If the owner's Obsidian shows body-size headings, it may come from a theme or snippet. Flipping it is one rule (`.is-source-mode .cm-s-heading`).
- **Linked panes** ("Link with tab"): skipped, as the brief allows (above).
- **Menu items left out:** listed per menu in section B. The two the brief named (Open in default app, Show in system explorer) are left out because of the lockdown.
- **Command names** are Obsidian's actual ones ("Split right"), not the brief's "Workspace: Split right" example.
- **Merge entire file with...** asks no confirmation. The merged note goes to `.trash` (recoverable), and the target gets the text. Links pointing at the merged note are not rewritten; Grove doesn't rewrite links on rename either.
- **Undo close tab** reopens a tab into its old group only while that group exists; otherwise into the active pane.
- **Ribbon:** Grove's "Create new note" button stays, although Obsidian's ribbon doesn't have one.
- **Tags view:** frontmatter tags in notes that can't be read (deleted between the search and the read) are skipped silently.
- **Tauri window not run this round.** The Tauri-specific parts are unchanged in kind: `data-tauri-drag-region` now sits only on the top panes' strips, and the window-button padding only on the top-right pane. Worth a look in `npm run tauri dev` with a test vault, as round 4 did:
  - dragging the window by an upper pane's empty tab-bar space;
  - the right-sidebar button with the window buttons in a split.
- **WebKit's CSP warning.** WebKit logs "Unrecognized Content-Security-Policy directive 'manifest-src'" for round 3's CSP. It's harmless (Chromium knows the directive) and left as is.
- **The CDP harness and the Obsidian observation scripts** live in the session scratchpad, not the repo, as in earlier rounds. The throwaway Obsidian profile and vault were scratch-only.
