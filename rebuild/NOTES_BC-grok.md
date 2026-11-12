# BC: Bases on Canvas

A `.base` file can sit on a canvas as a normal file card, and the card shows that base's view while the card is on screen. Nothing was pushed. No new crates or packages. No Rust change.

## Cause

Dragging a file from the list already made a file node for any non-directory, including a `.base`, at 400×400. Connecting an edge and choosing "Add note from vault" already listed every non-directory file. The toolbar and board "Add note from vault" picker did not: it used `includedNotes()`, which is markdown only.

The renderer was the other gap. After images and drawings, a file that is not a note drew `Unsupported file: …`. `isNoteFile` is `.md` only, so a `.base` file node landed there. A text card's `![[Board.base]]` already mounted the base through the note embed host. That path was left as it is.

## What changed

The note picker appends non-excluded `.base` files after the notes. The edge-connect list, the media picker, and `isNoteFile` are unchanged. A base is still a file node. There is no new node type, and `dataset.path` stays notes only.

A file node whose path ends in `.base` gets `is-base`. Its body reuses `createBase` and `baseFile` from `bases/view.ts`, imported only when that card is wanted. `baseFile` reads with `readNote` and writes with `writeVaultNote`, the same path a base tab uses. A `#Name` subpath selects that view once. Later toolbar choices stay. The canvas file is not rewritten by opening, panning, or editing the base.

The mount sits in the canvas's existing lazy body. A card that is never ensured does not import the view or read the file. A culled card drops its element, so the view stops scheduling. Coming back on screen reloads that card once. Disposing the canvas disposes the view. Title mode mounts none of these bodies.

The card frame is the usual one. The view fills the body and scrolls itself. A wheel over an overflowing base scroller pans that scroller; Ctrl+wheel still zooms. Keys typed inside that view stay with the base. Dragging the card body, the label, or a resize handle still moves or sizes the card. Other cards, including a note card that embeds a base, keep the old key and wheel behavior.

## Tests

`scripts/test-canvas-bases.mjs` adds `Board.base` by the note picker, an explorer drag, and the connect picker's "Add note from vault". It also renders `![[Board.base]]` in a text card. The on-screen card lists both notes; `#Open` lists the open note. A card at x=8000 stays culled with no view and no read until the camera reaches it. Sorting to Z → A writes `direction: DESC` into `Board.base` and leaves the canvas bytes alone, including an unknown key and the `#Open` subpath. Move and resize keep the file node. Reload shows the same cards and does not rewrite the file. Every `.base` node stays `type: "file"`. A plain `.txt` card stays unsupported.

`cargo test --offline` from `rebuild/app/src-tauri`: 156 passed, 0 failed, 4 ignored.

The first `flock /tmp/grove-npm-test.lock npm test` failed in `scripts/test-feel.mjs` while that cargo build was still compiling (graph 40 long tasks, typing and switcher over the input budget). The rerun, with cargo finished, exited 0, including posttest. Graph stayed the held gap (p95 33.4 ms, max 33.4 ms, 58/185 frames over 20 ms) with 0 long tasks. Typing and the switcher had 0 long tasks. The cold bases embed opened in 26.6 ms. Screenshot dirt under `rebuild/round23-shots` through `rebuild/round33-shots` (62 files, including round31b and round32b) was restored and is not in the commit.

## Diff

Code and the new script, from `git diff --numstat` plus the untracked script. The notes file is this file.

| File | Insertions | Deletions |
| --- | ---: | ---: |
| `rebuild/app/package.json` | 1 | 1 |
| `rebuild/app/src/canvas/cards.ts` | 3 | 1 |
| `rebuild/app/src/canvas/editing.ts` | 1 | 1 |
| `rebuild/app/src/canvas/navigation.ts` | 5 | 1 |
| `rebuild/app/src/canvas/view.ts` | 54 | 0 |
| `rebuild/app/src/styles/canvas.css` | 4 | 0 |
| `rebuild/app/scripts/test-canvas-bases.mjs` | 211 | 0 |
| `rebuild/NOTES_BC-grok.md` | 42 | 0 |
