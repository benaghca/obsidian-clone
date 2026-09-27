# Inbox Stickies Implementation Plan

> **For agentic workers:** executed natively (the user said "let's implement it"). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Inbox into a board of sticky notes in lanes (📌 Pinned, New, and the user's own), stored as `Inbox/Inbox.canvas`.

**Architecture:** A pure module `ui/inboxboard.js` (`CinderInboxBoard`) turns the board file plus the inbox's files into lanes, applies changes, and writes tidy JSON Canvas. It uses `CinderCanvas`'s `parseCanvas`, `serializeCanvas` and `randomId`, and is tested under Node. `ui/app/inbox.js` draws the lanes and handles the stickies, keeping today's triage functions.

**Tech Stack:** Plain browser JS embedded by `src/api.rs`. Node's `assert` for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-09-27-inbox-stickies-design.md`

## Global Constraints

- Board file: `<inbox folder>/Inbox.canvas`. It's written only on a user change to the board, and it's never a sticky or counted.
- Lanes: 300 wide, 40 apart, starting at x = 0. Cards: 260 wide, 20 apart. Heights: text 90–220 by length, pictures 220, other files 80.
- Colours: none is yellow paper; `"1"` pink, `"2"` orange, `"3"` yellow, `"4"` green, `"5"` blue, `"6"` purple; hex as it is.
- Pinned and New are matched by label, case-insensitively, with an optional leading 📌.
- A board file that doesn't parse: everything shows in New, with a notice, and nothing is written until the user's next change.
- Keys: arrows, Enter (edit or open), Esc, Space, P, and the existing Delete, Ctrl+A, C, A and M. Ctrl+Shift+J jots from anywhere.
- The badge counts New only.

## Review Focus

1. A second window or phone moving cards at the same time: saving the board with a stale base must not silently lose the other change (write with `X-Base-Mtime`; on a 409, reload the board and redo the change).
2. Re-rendering while a sticky is being edited must not destroy the editor or its unsaved text (renders wait until editing stops).
3. Non-board nodes a user adds to `Inbox.canvas` in Obsidian (text cards, edges) must survive Cinder's rewrite (unit test: extra nodes and edges kept).
4. Dragging from the file tree or dropping OS files must not be mistaken for moving a sticky (only drags carrying the sticky type move stickies).
5. A file with two cards (a hand-edited board) must show once, not twice (unit test: the first card in lane order wins).

---

### Task 1: `ui/inboxboard.js`

**Files:** Create `ui/inboxboard.js` and `ui/test/inboxboard.test.js`. Modify `ui/tsconfig.json` and `ui/types/globals.d.ts`.

**Interfaces (produced):**
- `readBoard(text, files, meta) → { lanes, broken, extra }`. `files` is the inbox's file paths without the board file. `meta(path)` gives `{ mtime, kind: 'text'|'picture'|'file', length }`. A lane is `{ id, name, kind: 'pinned'|'new'|'lane', stickies: [{ path, color, id }] }`, and `extra` is `{ nodes, edges }` (nodes and edges that aren't the board's).
- `applyChange(board, change, newId?) → board` (a new object). `change` is one of `{ move, to, index }`, `{ pin }`, `{ unpin }`, `{ color, value }`, `{ addLane }`, `{ renameLane, name }`, `{ moveLane, by }` or `{ deleteLane }`.
- `writeBoard(board, meta, newId?) → string` (JSON Canvas text).
- `laneOf(board, path) → lane|null`, `LAYOUT`.

- [ ] Write the tests for:
  - reading a written board;
  - reading a hand-arranged one (groups out of order, cards overhanging edges, overlapping groups where the smallest wins, a duplicate card, a card outside any group, a card for a missing file);
  - uncarded files going to the top of New, newest first;
  - label matching;
  - a broken file;
  - every change;
  - the layout numbers;
  - ids kept;
  - extra nodes and edges kept.
  
  Run them: they fail. Implement. Run them: they pass. Typecheck. Commit.

### Task 2: Lanes view, stickies, triage

**Files:** Modify:
- `ui/app/inbox.js`: the board state, `renderInbox` as lanes, the sticky markup, the toolbar, pin and colour, lane menus, drag and drop, editing in place, keys, the badge, and "make a note from this lane".
- `ui/style.css`: the lane and sticky styles.
- `src/api.rs`: `INBOXBOARD_JS`, the `/inboxboard.js` route, and the served-paths test.
- `ui/index.html`: the script tag after `canvas.js`.

**Interfaces:** `inboxBoardPath()`, `currentBoard() → board`, `changeBoard(change)` (apply, write and re-render), `startStickyEdit(path)`, `stopStickyEdit()`.

- [ ] Rewrite `ui/test/e2e/inbox.js` for lanes (it replaces the day-grouping checks) and add checks for:
  - capture into New;
  - dragging within and between lanes (checking `Inbox.canvas` on disk);
  - pinning and unpinning, and colour;
  - adding, renaming, moving and deleting a lane;
  - editing in place (checking the note on disk);
  - the triage bar, and a lane's "make a note";
  - the badge counting only New;
  - a new file on disk landing at the top of New with the board file unchanged;
  - a broken board file showing a notice;
  - the saved board opening in the canvas view.
  
  Run it: it fails. Implement. Run the inbox, canvas, keys and tabs suites: they pass. Commit.

### Task 3: Jot from anywhere, README

**Files:** Modify `ui/app/commands.js` (the `jot` command, Mod-Shift-j), `ui/app/inbox.js` (`jotSticky()`) and `README.md`.

- [ ] E2e: Ctrl+Shift+J from a note, type, and Enter gives a sticky at the top of New. Run it: it fails. Implement. Then rewrite the README's Inbox section, run the unit tests, the typecheck and `cargo test`, run the full e2e suite in the background, and commit and push `feat/inbox-stickies` (no merge).
