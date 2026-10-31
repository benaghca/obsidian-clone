VERDICT: OK

Reviewed Grok c's CZ4 on `rebuild/cz4-review-grok`, taken from `rebuild/canvas-cz4-grok` at `6102152`. That branch is still at `6102152`. Parent of the feature is `18f43a9`. No product code changed in this review. Nothing was pushed. No app window was opened.

Relied on `rebuild/CANVAS_ZOOM_PLAN.md` sections 1, 5.6 and 9, and on `rebuild/NOTES_CZ4.md`. The public source is Obsidian's Canvas help, `https://obsidian.md/help/plugins/canvas`, as read for the plan and for NOTES_CZ4 on 2026-10-30. It says to right-click the canvas and then Create group. It says nothing about zoomed-out cards, borders, Ctrl+drag, or performance. Those come from Chris's screenshots and from section 9, which Chris approved on 2026-10-30, including D1–D4. Card sizes 250×60, 400×120 and 400×400 are the builder's choices. No Obsidian code, CSS, icons, or assets were used. This review did not fetch the help page again.

## Scope

`git diff --name-only 18f43a9..6102152` is the notes file, `package.json`, the board-menu test, a two-line groups-test edit, and these sources: `cards.ts`, `controls.ts`, `editing.ts`, `view.ts`, `editor/clipboard.ts`, `links/external.ts`, `links/external.test.ts`, `shell/icons.ts`, `styles/settings.css`.

`navigation.ts`, `canvas.css`, and `shell/hoverPreview.ts` are absent from that diff. Zoom and pan stay on the CZ1 path. Hover preview stays on the CZ-H path.

Numstat matches NOTES_CZ4: source, package, and the small test edits are 173 insertions and 23 deletions, plus the new 205-line `test-canvas-board-menu.mjs` and the 86-line notes file. `globe` and `clipboard-paste` are `Globe` and `ClipboardPaste` from the Lucide package Grove already depends on.

The board menu is `addItems` (Add card, Add note from vault, Add media from vault, Add web page, Create group) plus Undo, Redo only when the redo stack differs from the file, Paste, and the same `canvasSettingsItems` list the gear menu uses. Read-only hides the add items, Create group, and Paste. Menu placement uses `atStart: true`, so the card's top-left sits on the pointer. Double-click and toolbar drag still center. Add web page uses the existing confirm dialog, accepts only `loneWebUrl`, and writes a `type: "link"` card with `url`. Creation does not fetch. Paste of a lone http(s) URL writes a link card. Any other non-blank text writes a text card and leaves the editor closed. Blank text adds nothing.

## What this review ran

Headless Chromium, from `rebuild/app`, under `flock /tmp/grove-npm-test.lock`.

The board-menu script passed on its own and again inside the full suite. Empty canvas, plain and Alt+right-click, opens that menu at the pointer within two frames, with `getAnimations().length === 0`. In the full run the open frame max was 16.7 ms. Escape and a pointerdown outside the menu close it and add nothing. Disabled Undo stays in the menu and does not write. Add card, Add web page, Paste of text, Paste of a trimmed URL, a sentence that merely contains a URL, and a blank clipboard are covered there. A link card stores `url` and the test sees no request whose name includes the host. Undo restores the exact file. Redo puts the same card back. Read-only hides the add rows and shares Snap to grid with the gear menu. Create group writes one 400×400 group named `Untitled group` at the front of `nodes` and keeps `future.keep`. Help lists Canvas menu / Right-click. A card right-click stays `Zoom to selection|Edit|Remove`.

A throwaway probe, deleted afterwards and not committed, placed an Add card at four views. World `x,y` matched the same DOMMatrix formula `point()` uses, and the screen top-left stayed within 0.6 px of the click:

| View | Scale | Card | Click | Screen top-left |
| --- | ---: | --- | --- | --- |
| Reset / fit | 1.000 | −68, −221 | 384, 158 | 384.0, 158.0 |
| Ctrl+wheel in | 1.587 | 90, −117 | 384, 158 | 383.4, 158.0 |
| Ctrl+wheel out | 0.630 | −319, −386 | 384, 158 | 384.3, 158.0 |
| After wheel pan | 1.000 | 81, −54 | 384, 158 | 384.2, 157.6 |

Ctrl+Z restored the node count after each add. Add web page with `https://example.com/zoom` landed on that same canvas point. An empty clipboard added nothing, and the capture-phase paste listener was gone afterwards: a later bubble `paste` listener ran.

Right-click on a selected edge stays `Zoom to selection|Delete`. Samples along the hit path at t = 0.2, 0.35, 0.65 and 0.8 are `path.canvas-edge-hit`. The midpoint is the label. An unselected stroke or label opens no menu. That early return (`if (!selected.size && !selectedEdges.size) return`) is the previous selection menu, and CZ4 only redirects clicks that are neither a card nor `[data-edge-id]`. Right-click on an edge while a card is selected stays the selection menu (`Zoom to selection|Create group|Delete`). NOTES_CZ4 already left that open. This review did not change it.

A later probe step threw `getBoundingClientRect` because it right-clicked the new card's top-left, which opens the card menu. That menu has no Undo row. The product path undoes with Ctrl+Z, which the earlier steps already did. The official board-menu test covers blank paste.

## Performance

Menu open is one canvas rectangle, one world transform, and `showMenu` of about ten rows. It does not walk the cards beyond the existing `nodes.find` on `contextmenu`, and it does not restyle the board. Adding a card still uses the existing full redraw.

From this branch's locked `npm test`:

- Board menu: on screen within two frames, max 16.7 ms, no open animation.
- 300-card drag: max 16.8 ms, 49 intervals.
- 300-card/400-edge pan: 69 samples, p95 16.7 ms, max 16.7 ms.
- 300-card/400-edge zoom: 50 samples, p95 16.8 ms, max 16.8 ms.
- 1,000-row Bases scroll: max 16.8 ms.

NOTES_CZ4 reported the same band (pan 70 samples at 16.8 ms, zoom 47 samples at 16.8 ms, board menu 16.8 ms in its full run). Nothing in this run exceeded 50 ms. Sample counts move by a few frames between runs. That is not a regression.

## Scratch merge

`git worktree add --detach /tmp/cz4-int rebuild/integration` at `ba9e4ac` ("Merge branch 'rebuild/czh-review-grok' into rebuild/integration"). `git merge --no-commit --no-ff rebuild/cz4-review-grok`. Integration was still `ba9e4ac` when this note was written. The merge was not committed. The worktree was removed afterwards.

The only conflict was `rebuild/app/package.json`. Resolution, in the throwaway tree only: keep integration's `test` and `posttest` scripts, and insert `node scripts/test-canvas-board-menu.mjs` immediately after `node scripts/test-canvas-groups.mjs`. That keeps `test-canvas-hover.mjs` before the groups script and keeps `test-bases-kanban-move.mjs` in `posttest`. Those two scripts are not on this review branch, so `package.json` here was left as Grok c wrote it.

`controls.ts`, `editing.ts`, and `view.ts` auto-merged. The merged help row keeps CZ1's Zoom shortcut and CZ4's Canvas menu / Right-click. `editing.ts` keeps CZ1's lazy connection dots and CZ4's empty-board return. `view.ts` keeps CZ-H `dataset.path` on text cards and note file cards, opens the label editor for a selection-wrapped group, and opens the editor after `add()` only for a single empty text node. `navigation.ts` and `hoverPreview.ts` were unchanged against `ba9e4ac`.

`npm run build` on that tree passed (`tsc`, Vite, 2130 modules). Vitest passed: 72 files, 1241 tests. The first full `npm test` then stopped in `test-canvas-notes.mjs` while measuring the embedded editor. `node_modules` was a symlink to this worktree, on another filesystem, and Vite served `@codemirror/view/dist/index.js` with its bare `@codemirror/state` import. The same script passes in this worktree, where `node_modules` is a real directory. After copying `node_modules` into the scratch tree, the notes script and everything after it, including hover, groups, the board menu, Bases, and `posttest`, passed. Board menu max 16.8 ms. 1,000-row scroll max 16.7 ms. Pan on that tree was 70 samples, max 16.8 ms. Zoom was 70 samples, max 16.8 ms. 300-card drag max 16.8 ms. The merged tree's Kanban cold open was 66.2 ms (one long task of 65 ms) and the warm opens were 21.7 / 20.7 / 17.0 ms. This branch's full run recorded cold 62.6 ms and warm 18.1 ms. CZ4 does not touch Kanban. Both runs pass the warm-open check, which is the one that requires no long task over 50 ms.

## Checks

From `rebuild/app`, on this branch:

- `npm run build` passed. The existing Vite chunk-size warning remains.
- `flock /tmp/grove-npm-test.lock npm test` passed, including browser scripts and posttest. Vitest: 70 files, 1227 tests, of which 444 are parity. No failure, so the known 300-card drag flake was not rerun.
- `npm run audit:offline` passed: 180 source files, dist, CSP, capabilities, and dependencies.

From `rebuild/app/src-tauri`, with `--offline`:

- `cargo build` passed.
- `cargo test` passed: 73 passed, 4 ignored.

`rebuild/round*-shots` was restored and not committed. Prompt files were not committed.

## Left open

- Web-page size 400×120 and empty-group size 400×400 are choices, not measurements from the help page. A rejected URL closes with no message.
- Right-click on an edge while cards are selected still opens the selection menu. Right-click on an unselected edge or its label opens nothing. Both are the previous edge path. CZ5 is still the task that should call `addItems` for Ctrl+drag.
- If `document.execCommand("paste")` returns true and no paste event arrives, `readClipboardText` resolves to `""` and does not call `navigator.clipboard.readText()`. The headless Chromium path used here does fire the event, and the board-menu test covers the `readText` fallback by forcing `execCommand` to return false. A WebKitGTK build that returns true without an event would paste nothing.
