# Split tabs: drag a tab onto the page to split it

Date: 2026-09-26
Status: design approved in conversation; waiting on review of this spec

## Why

Cinder's split pane (commit `0b4bc0a`) is a side panel attached to the main editor, outside the tab system. It stays on screen whichever tab you're in, and the only ways to fill it are menus and a shortcut. The user expected it to work like Zen browser's split view, and above all wanted to **drag a tab onto the page** to split it. Next in importance is the split living in the tab bar as **one group** that you can leave and come back to.

## Scope

In scope, for two panes:

- Dragging a tab onto the left or right half of the page makes a group of it and the current tab.
- A group shows in the tab bar as one tab, "Project plan │ Meeting notes". Switching away hides the split, and switching back brings it back.
- Separating and closing: pane ×, group ×, *Separate tabs*, dragging a pane's grip back to the tab bar, and *Swap panes*.
- **Ctrl+Alt+click** on a link opens it in the other pane.
- Groups survive a restart, and today's global split is converted into a group once.

Not in scope, for the later "more panes" round:

- More than two panes, stacked (top/bottom) or grid layouts.
- Equal panes. The right pane keeps the lighter editor that canvas note cards use, and the left pane keeps the full editor.
- An "active pane" model. Plain link clicks and the file tree, search and switcher all still open in the left pane.
- Dragging files from the file tree onto the page.

## Decisions made while brainstorming

| Question | Decision |
|---|---|
| Where can you drop? | Left or right half. The half you drop on is where the note goes. |
| Where do links open? | The left pane, as today. **Ctrl+Alt+click** opens in the other pane. Ctrl+click already means "follow the link while its source is showing" in the editor, and Ctrl+Alt+click is Obsidian's shortcut for a split. |
| What does × do? | It closes. A pane's × closes that note, and the group tab's × closes both. Separating uses *Separate tabs* or dragging a pane's grip to the tab bar. |
| How does a group look? | One tab with both names and a divider: "Project plan │ Meeting notes". This is option A in the mockups. |
| How is it built? | Each tab gets a partner note, and today's split pane shows the current tab's partner. The main editor doesn't change. |

Mockups: https://claude.ai/artifact/Ltyfcyi3QAeESB9i7174Rc (private).

## Design

### Data

A tab (`newTabObj` in `ui/app/tabs.js`) gains a `split` field, which holds a file path or `null`. `key` is still the left pane, and `split` is the right pane. A tab with a `split` is a **group**.

- `split` is always a file that the split pane can show: a note, image, drawing, canvas or base, the cases `openSplit` handles today. A new helper, `canSplit(path)`, answers this in one place, and every rule below that says "a file the split pane can show" means `canSplit`. `key` can be anything a tab can hold, such as a note, `:graph` or `:tasks`.
- The saved tab list becomes `store('tabs', { keys, splits, active })`, where `splits[i]` belongs to `keys[i]`. A missing `splits` array means no groups, so older saved state still loads.
- **One-time conversion:** if the old `store('split')` exists and its file is still in the vault, `restoreTabs` sets it as the active tab's `split` and then clears `store('split')`. `boot.js` stops reopening the global split.
- The tab also remembers its right pane's reading/editing mode while the app is running (`splitMode`). This isn't saved, so a restart opens the right pane in editing mode as today.
- The group keeps the left tab's back/forward history (`hist`, `histIdx`). A note that joins a group gives up its own tab's history, and a note that leaves a group starts a new, empty one.

### Showing a tab

`activateTab` opens `key` as today and then:

- if the tab has a `split`, shows it with `openSplit(split, { keepMode })` using the tab's `splitMode`
- otherwise, hides the split pane with no side effects: no saving state and no changes to the tab.

`ui/app/split.js` changes from a global panel to a view of the current tab's partner:

- `SPLIT.path` always mirrors `curTab().split`.
- `openSplit(path)` sets the current tab's `split` and saves the tab list, where it used to save `store('split')`.
- `closeSplit()` becomes two functions: `hideSplit()`, which only hides the pane (used when switching tabs), and closing the note (pane ×), which clears the current tab's `split`.
- The pane's editor saves before it's torn down, whether it's hidden, closed or replaced. `SPLIT.handle.destroy()` already flushes, so this needs a check, not new code.

### Layout

The tab bar moves out of `#main` so it spans both panes:

```
[#ribbon] [#left] [resizer] [#workspace                                   ] [resizer] [#right]
                            [  #tabbar ─────────────────────────────────  ]
                            [  #panes: #main ┃ #resize-split ┃ #split     ]
```

- `#workspace` is a column: the tab bar, then `#panes`. `#panes` is a row holding `#main`, the divider and `#split`. `#main` keeps the view bar, the views and the status bar.
- `splitDom()` places the divider and `#split` inside `#panes`, where it used to place them after `#main`.
- CSS: the selectors that hide `#tabbar` for focus mode and presenting keep working, because they don't depend on its parent. Check `.frame-custom.app-no-right #tabbar` (the room reserved for the window buttons). The tab bar now reaches the top-right corner whenever the right sidebar is closed, which is the case that rule covers.
- `ui/app/window.js`'s `DRAG_AREAS` already includes `#tabbar`, so dragging the window by the tab bar keeps working.

### The group tab

`renderTabs()` draws a group as a single `.tab.group`:

- The name reads `Project plan │ Meeting notes`: two `.tab-name` spans with a `.tab-sep` between them. Each name shortens with "…" on its own. The whole tab can be wider than a normal tab: `max-width` 320px instead of 220px.
- The hover title shows both full paths, one per line.
- `aria-label` is "Project plan and Meeting notes".
- × and middle-click close the whole group (`closeTab`).
- The right-click menu adds **Separate tabs** and **Swap panes**, and keeps the existing items.

### Pane headers

These show only while a group is on screen, controlled by `body.has-split` as today:

- **Left:** the view bar (`#viewbar`) gains a `.pane-grip` (⠿, draggable) as its first item and a `.pane-close` × as its last. Both are hidden unless `body.has-split` is set.
- **Right:** the split header keeps the title and the reading/editing button and gains a `.pane-grip`. The **swap** and **open in main** buttons are removed. Its × closes the right note.

### Dragging a tab onto the page

This uses the HTML5 drag and drop that already reorders tabs (`dragTab` in `tabs.js`).

- `#panes` handles `dragover`, `dragleave` and `drop` while `dragTab` is set. A `#drop-overlay` element covers the left or right half, depending on the pointer's x position against the middle of `#panes`, and shows "Open on the left" or "Open on the right".
- **When nothing lights up and a drop does nothing:**
  - the dragged tab is the current tab
  - the dragged tab is a group
  - the dragged tab's `key` isn't a file the split pane can show (`null`, `:graph`, `:tasks`, `:inbox`, or a file type `canSplit` rejects)
  - the pointer is over the left half and the current tab's `key` isn't a file the split pane can show, since the current thing would have to move right
- **Dropping on the right half:** the current tab's `split` becomes the dragged tab's `key`. If the current tab already had a `split`, that note is pushed out into a new ordinary tab right after the group. The dragged tab is then removed from the bar.
- **Dropping on the left half:** the current `key` becomes the `split` and the dragged `key` becomes the new `key`. If the current tab was already a group, its old `split` is pushed out into a new tab right after the group. The dragged tab is removed, and the tab reopens so the left pane shows the new note.
- Afterwards the tab list is saved and redrawn, and the overlay is cleared on `drop`, `dragend` and `dragleave` out of `#panes`.

### Dragging a pane's grip onto the tab bar

- The grip's `dragstart` sets `dragPane = 'left' | 'right'`, a new variable next to `dragTab`.
- The tab bar's `dragover` and `drop` accept `dragPane` as well as `dragTab`, with the same before/after markers. Dropping creates a new ordinary tab at that position holding the pane's note:
  - **Right grip:** the group's `split` is cleared.
  - **Left grip:** the group's `split` becomes its `key` and its `split` is cleared, so the group turns into an ordinary tab showing the former right note in the left pane.
- A grip dropped anywhere else does nothing.

### Commands and menus

| Where | What |
|---|---|
| *Open to the right* (tab menu, file tree menu, **Ctrl+Alt+\\** picker) | Sets or replaces the current tab's `split`. A note it replaces is pushed out into its own tab, as when dropping. |
| *Open current file to the right too* | Unchanged: the same note on both sides. |
| *Close the split pane* | Closes the right note, the same as the right pane's ×. |
| **Separate tabs** (new command and group-tab menu item) | The group's `split` becomes a new ordinary tab right after it. |
| **Swap panes** (group-tab menu, and the existing `split-swap` command, renamed) | Swaps `key` and `split`. Only available when `canSplit(key)`. |
| *Move between the panes* | Unchanged. |
| **Ctrl+Alt+click** on a link, in the editor (`ui/editor/editor.js` click handler, which now checks `altKey` before following) and in reading view (`ui/app/markdown.js` link clicks) | Resolves the link as `followLink` does, then does *Open to the right* with the result. From the right pane, links already open on the left, so Ctrl+Alt+click there does the same as a plain click. An unresolved link creates the note as a plain click would, then opens it on the right. |

### Files changing on disk

- **Renames and moves:** `tabsAfterRename(moved)` maps every tab's `split` as it maps `key`, folder renames included. `splitFileMoved` goes away, because the pane on screen follows its tab. If the group on screen is affected, the tab is reopened.
- **Deletes:** in `tabsAfterDelete`, a deleted `split` is cleared, so the group becomes an ordinary tab. If a group's `key` is deleted and its `split` survives, the `split` moves over to `key`.
- **Changes from elsewhere:** `splitNoteChanged` still covers the group on screen. A hidden group reads its note fresh when you switch back.

### Closing and reopening

- `closeTab` on a group records `{ key, split }` in `closedTabs`, where it used to record just `key`, and *Reopen closed tab* brings the group back if both files still exist. If only one still exists, it comes back as an ordinary tab.
- Closing the last tab when it's a group leaves one empty tab, as closing the last tab does today.

## Error handling

Nothing here reaches the disk except saving notes, which the existing editors already do safely: the right pane saves against the index's modification time and settles real conflicts with the merge view.

- **Missing files on restore:** a `split` whose file is gone is dropped quietly, the same way a tab's `key` is.
- **Stale drag state:** `dragTab` and `dragPane` are cleared on `dragend`, so an interrupted drag leaves no overlay and no markers behind.
- **Drops that aren't allowed:** they do nothing. There's no toast, because the overlay never promised anything.

## Testing

Run targeted suites while working. Run the full regression (`ui/test/e2e/run.sh`, about ten minutes) in the background before merging.

- **New suite, `ui/test/e2e/splittabs.js`.** Drags are fired as synthetic `dragstart`, `dragover`, `drop` and `dragend` events with a shared `DataTransfer`. It checks:
  - dropping on the right half, dropping on the left half, and dropping onto an existing group, including the displaced note becoming a tab
  - no overlay for the current tab, a group, the graph, or the left half over the graph
  - the group tab's label and its hover title
  - switching away and back, with the split hidden and then restored
  - pane × on each side, group ×, *Separate tabs*, *Swap panes*, and dragging each pane's grip to the tab bar
  - *Reopen closed tab* on a group
  - Ctrl+Alt+click in the editor and in reading view
  - renaming a partner, deleting a partner, and deleting the left note
  - a restart keeping the groups, and conversion of the old `split` setting
- **Updated suite, `ui/test/e2e/split.js`:** drop the checks for the swap and "open in main" buttons, and check swapping through the menu instead.
- **Suites that touch the tab bar or layout, re-run:** `e2e1`, `e2e2`, `e2e3`, `keys`, `keys2`, `focus`, `present`, `nativeui`.
- **Unit tests, `ui/test/app.test.js`:** the saved shape is built and read by two pure functions, `tabsToStore(tabs, active)` and `tabsFromStore(saved, exists)`, so they can be tested without a page. Test round trips, state saved before this change (no `splits`), and dropping missing files.
- **Type check:** `npm run typecheck` in `ui/editor`, covering the new fields in `ui/types/`.
- **By hand, in the native window (WebKitGTK):** a real mouse drag of a tab onto each half, and of each grip back to the tab bar. The synthetic events in the suite don't prove the platform's drag and drop works.

Node is used only as a dev tool, for these tests and the type check. The app never contains or runs it.
