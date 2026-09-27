# Inbox as a sticky-note board

Date: 2026-09-27
Status: design approved in conversation; waiting on review of this spec

## Why

The user wants the Inbox to "feel more like a sticky note spot". Today it's a triage desk: what lands in `Inbox/` (phone notes, camera uploads, scans, typed captures, dropped files) is listed newest first by day, and can become a note, be appended, filed or deleted. The user wants four things from it:

- jot quick thoughts,
- see them at a glance,
- arrange them,
- keep reminders visible.

Triage stays: everything that lands in the inbox shows as a sticky, and the triage actions work from the board.

## Decisions made while brainstorming

| Question | Decision |
|---|---|
| What's it for? | All of: quick jotting, at-a-glance reading, arranging, pinned reminders. |
| What happens to triage? | The same place with a sticky look. Everything in `Inbox/` is a sticky (photos as picture stickies) and the triage actions stay. |
| Layout? | Lanes (option C in the mockups), chosen "because you have a little more control". |
| Which lanes? | **📌 Pinned**, **New** (where everything arriving lands), then lanes the user creates and names. |
| Where is the arrangement kept? | In `Inbox/Inbox.canvas`, a JSON Canvas file, so it syncs with the vault and Obsidian opens the same board. It isn't kept in frontmatter or only in Cinder's settings. |
| Sticky behaviour | As in the `stickies.html` mockup, approved with no changes. |

Mockups: `.superpowers/brainstorm/1911341-1790541328/content/layout.html` and `stickies.html` (local, not committed).

## Design

### The board file

- The board is `<inbox folder>/Inbox.canvas` (by default `Inbox/Inbox.canvas`), a JSON Canvas file read and written with the canvas module's `parseCanvas` and `serializeCanvas`.
- **Lanes** are `group` nodes. Pinned and New are the groups labelled `Pinned` (optionally with a leading 📌) and `New`, matched case-insensitively. Every other group is a user lane named by its label. Lanes appear in this order: Pinned, New, then the user lanes left to right by their `x`.
- **Stickies** are `file` nodes pointing at files in the inbox folder. A sticky's lane is the group that contains the centre of its card. This is checked by the board module itself: the canvas helper `inside` wants the whole card inside, which is too strict for a board tidied by hand in Obsidian. When groups overlap, the smallest one containing the centre wins. Within a lane, stickies are ordered top to bottom by `y`. A card inside no group, or pointing at a file that's gone or no longer in the inbox, is ignored when reading and left out when the board is next written.
- **Colour** is the node's `color`: presets `"1"`–`"6"` or a hex colour. On the board, no colour is yellow paper, and the six choices are pink (`"1"`), orange (`"2"`), yellow (`"3"`), green (`"4"`), blue (`"5"`) and purple (`"6"`). Hex colours are shown as they are.
- **Files with no card** (everything that arrived since the last arrangement) show at the top of New, newest first by modified time. The same goes for all inbox files when the board file doesn't exist yet.
- **When it's written:** only when the user changes the board (moving or reordering a sticky, pinning or unpinning, changing a colour, or adding, renaming, moving or deleting a lane). The whole file is then rewritten as tidy columns: lanes 300 wide with gaps of 40, starting at x = 0, and cards 260 wide stacked with gaps of 20. Card heights are estimated (text by length, 90–220; pictures 220; other files 80) so Obsidian shows a sensible board. New arrivals don't cause a write, so phone syncs don't churn the file.
- **Hidden from the Inbox:** the board file is never a sticky and never counted.
- **A board file that doesn't parse** (for example, one mangled by a sync conflict) is treated as absent: everything shows in New, with a notice saying the board file couldn't be read. It's rewritten only on the user's next change to the board. Version history keeps `.canvas` files, so the old one can be restored.
- **Renames:** moving or renaming a file already updates `.canvas` references, so a sticky's card follows its file.

### The Inbox view

- **The top** shows the title, a count ("9 stickies · 2 new") and a capture box, "Jot a thought…". Enter adds a sticky to the top of New. It works as today's capture: a note named by date and time.
- **Lanes** sit side by side and scroll sideways when they don't fit. Each lane header shows its name and count. User lanes and New have a ⋯ menu with *Make a note from this lane*. User lanes' menus also have *Rename…*, *Move left*, *Move right* and *Delete lane*. Deleting a lane moves its stickies to the top of New, and asks first if the lane has any. A **+ Lane** tile after the last lane asks for a name and adds an empty lane.
- **Stickies:**
  - **Text notes** show their rendered Markdown (frontmatter hidden, cut off after about 12 lines with a fade) on coloured paper, with a small time label.
  - **Pictures** show as polaroids (the picture on white, with the file name and time).
  - **Other files** show as a file-type tile.
  - Items that arrived since the last visit get the orange "new" outline, as today.
- **Hovering** a sticky shows its toolbar: 📌 pin or unpin, six colour dots, and ✓ select.
- **Pin and unpin:** pinning moves a sticky to the top of Pinned; unpinning moves it to the top of New.
- **Dragging** a sticky with the mouse moves it. Dropping it within a lane reorders it, and dropping it on another lane moves it there, at the drop position. A placeholder shows where it will land.
- **Editing:**
  - Clicking a text sticky edits it in place with the live-preview editor that canvas note cards use (`mountCardEditor`). It saves as you type, and Esc or clicking outside stops editing.
  - Double-clicking opens the note in a tab.
  - Clicking a picture opens the image viewer. Clicking another file opens it.
- **Selecting** (✓ or Space) shows the triage bar, as today: *Make a note*, *Add to a note…*, *File to folder…*, *Delete*, *Clear*. Filed or deleted stickies leave the board.
- **Keys:**
  - Arrows move between stickies: up and down within a lane, left and right to the nearest sticky in the neighbouring lane. Up from the top of a lane goes to the capture box.
  - Enter edits a text sticky, or opens other files.
  - Esc stops editing. Space selects. P pins or unpins.
  - Existing keys keep their meaning: Delete, Ctrl+A, C (make a note), A (add to a note) and M (file).
- **Photos no note uses yet** stays below the board, unchanged.
- **The ribbon badge** counts the stickies in New (unsorted things), not the whole board, so pinned reminders don't keep it lit. This is a decision made when writing the spec, not discussed in the conversation.

### Jot from anywhere

- **Ctrl+Shift+J** (the command "Jot a sticky…") opens a small box from anywhere in the app. Enter adds the text as a sticky at the top of New, and Esc cancels. It uses the same capture as the Inbox's box.

## Code structure

- **`ui/inboxboard.js`** (`CinderInboxBoard`) is pure, with no DOM, and is tested under Node:
  - `readBoard(canvasText, files, meta) → { lanes: [{ id, name, kind: 'pinned'|'new'|'lane', stickies: [{ path, color }] }], broken: bool }`. Here `files` is the inbox's files (not the board file), and `meta(path)` gives `{ mtime, kind: 'text'|'picture'|'file', length }`.
  - `applyChange(board, change) → board`. The changes are `{ move: path, to: laneId, index }`, `{ pin: path }`, `{ unpin: path }`, `{ color: path, value }`, `{ addLane: name }`, `{ renameLane: id, name }`, `{ moveLane: id, by: ±1 }` and `{ deleteLane: id }`.
  - `writeBoard(board, meta) → canvasText`, the tidy JSON Canvas described above. Existing node and group ids are kept, and new ones come from `CinderCanvas.randomId`.
- **`ui/app/inbox.js`** gets the lanes view, drag and drop, the toolbar, editing in place, the lane menus, the keys and the badge. It reads the board from `S.files` plus the board file's content (read through the API, and cached with its mtime), and writes with `writeFile`. The existing triage functions (`inboxCombine`, `inboxAppend`, `inboxAct`, `inboxCapture`, and orphans) stay.
- **Commands:** `jot` ("Jot a sticky…", Mod-Shift-j) goes in `commands.js`.
- **Wiring:**
  - `src/api.rs` serves `/inboxboard.js`.
  - `ui/index.html` gets its script tag after `canvas.js`.
  - `ui/tsconfig.json` and `ui/types/globals.d.ts` (`CinderInboxBoard`) are updated.
  - `ui/style.css` gets the sticky and lane styles.
  - The README's Inbox section is rewritten.

## Testing

- **`ui/test/inboxboard.test.js` (Node):**
  - Reading a board Cinder wrote, and one arranged by hand the way Obsidian might leave it (groups out of order, cards overlapping group edges, extra non-file nodes).
  - Files with no card going to the top of New, newest first.
  - Cards for missing files or files outside the inbox being ignored.
  - Pinned and New matched with and without the 📌 and in any case.
  - A broken board file.
  - Every change, written and read back.
  - The layout numbers.
  - Ids kept across writes.
- **E2e:** `ui/test/e2e/inbox.js` is updated for lanes, plus new checks:
  - capture into New, and Ctrl+Shift+J from a note;
  - drag within and between lanes, checked in the saved `Inbox.canvas`;
  - pin and unpin, colour, and adding, renaming and deleting a lane;
  - editing a sticky in place, checked in the note on disk;
  - the triage bar and lane "make a note";
  - the badge counting New only;
  - a new file arriving on disk showing at the top of New without the board file changing;
  - the saved `Inbox.canvas` opening in Cinder's canvas view with the lanes as groups.
