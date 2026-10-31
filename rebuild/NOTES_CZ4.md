# CZ4: empty-canvas menu

Branch `rebuild/canvas-cz4-grok`, from `18f43a9`. Nothing pushed. No app window was opened. Browser checks were headless Chromium under `flock /tmp/grove-npm-test.lock`.

## What changed

Right-click on empty canvas (not a card, edge, or label) opens one menu at the pointer. It is the same menu for a plain right-click and Alt+right-click. A selection does not change it. Right-click on a card, edge, or label still opens the existing selection menu.

The menu, in order:

- Add card, Add note from vault, Add media from vault, Add web page, Create group
- Undo, and Redo only when there is something to redo
- Paste
- Snap to grid, Snap to objects, Read-only

In Read-only the add items, Create group, and Paste are hidden. Undo stays, disabled. There is no open animation.

Files (tracked diff `173` insertions, `23` deletions, plus the new test):

| File | + | − |
| --- | ---: | ---: |
| `rebuild/app/src/canvas/cards.ts` | 87 | 9 |
| `rebuild/app/src/canvas/controls.ts` | 10 | 5 |
| `rebuild/app/src/canvas/editing.ts` | 10 | 2 |
| `rebuild/app/src/canvas/view.ts` | 8 | 3 |
| `rebuild/app/src/editor/clipboard.ts` | 32 | 0 |
| `rebuild/app/src/links/external.ts` | 6 | 0 |
| `rebuild/app/src/links/external.test.ts` | 9 | 1 |
| `rebuild/app/src/shell/icons.ts` | 2 | 0 |
| `rebuild/app/src/styles/settings.css` | 6 | 0 |
| `rebuild/app/scripts/test-canvas-groups.mjs` | 2 | 2 |
| `rebuild/app/package.json` | 1 | 1 |
| `rebuild/app/scripts/test-canvas-board-menu.mjs` (new) | 205 | 0 |

`navigation.ts` and `canvas.css` were not edited.

## Decisions

- **One add list.** `canvasCards()` returns `addItems(place: CanvasAddPlace)`. The board menu composes that list with undo, redo, paste, and settings. CZ5 should call `addItems` with the drag box. Both `width` and `height` set means a media card keeps that box, clamped to 50×50, instead of the image-aspect fit. `insert()` itself is not clamped, so an image whose fitted side is under 50 stays as it is today.
- **One settings list.** `canvasSettingsItems` in `controls.ts` builds Snap to grid, Snap to objects, and Read-only for the gear menu and this menu.
- **Where the card sits.** Menu items place the top-left on the pointer (`atStart: true`). Double-click and drag-to-add still center on the pointer.
- **Sizes, chosen here.** Text card 250×60, the existing insert default. Web page 400×120, because Grove draws the URL and does not fetch a preview. Empty group 400×400, label `Untitled group`, same label and key order as the selection's Create group (`id`, `x`, `y`, `width`, `height`, `type`, `label`). Chris can change the web-page and group sizes.
- **Add web page.** The existing confirm dialog, with one URL field (`placeholder` `Link address`, so source has no `https://` literal). Enter confirms. Only a whole http(s) URL with a host is accepted (`loneWebUrl`). Anything else closes the dialog and adds nothing. The card is `type: "link"` with `url`. It is not fetched.
- **Paste.** Same order as the editor context menu: `document.execCommand("paste")`, then `navigator.clipboard.readText()`. A lone http(s) URL becomes a link card (the stored URL is trimmed). Any other non-blank text becomes a text card, stored as read, and the editor stays closed. A sentence that contains a URL stays text. Blank text adds nothing. An empty Add card still opens the editor.
- **Undo and Redo.** Undo is always listed. It is disabled when nothing differs from the current file, or the canvas is read-only, matching the toolbar. Redo is listed only when the redo stack has an entry different from the current file, and it is disabled in read-only.
- **Create group** from this menu adds an empty group at the pointer and does not open the label editor. The selection toolbar still wraps the selection and still opens the label editor.
- **Help** gained a row, Canvas menu / Right-click.
- **Icons** `globe` and `clipboard-paste` come from the Lucide package Grove already depends on.

Copying and pasting cards as a JSON Canvas fragment is not in this change. Ctrl+drag is CZ5.

Opening the menu is one canvas rectangle plus the existing world transform. It does not walk the cards or restyle the board. Adding a card still uses the existing full redraw. That redraw on a large board is CZ1/CZ3.

## What I relied on

Obsidian's public Canvas help page, `https://obsidian.md/help/plugins/canvas`, read once on 2026-10-30. It says to right-click the canvas and then Create group, so the empty canvas has a menu that includes Create group. It says nothing about zoomed-out cards, borders, Ctrl+drag, or performance. Those come from Chris's screenshots and from `rebuild/CANVAS_ZOOM_PLAN.md` section 9, which Chris approved on 2026-10-30, including D1–D4. Grove's own canvas code, tests, `NOTES_CANVAS-LAG.md`, and `NOTES_CANVAS_REVIEW.md` were the other sources. No Obsidian code, CSS, icons, or assets. The link-node shape (`type: "link"`, `url`) was already implemented in Grove. I did not re-read the JSON Canvas spec.

## Checks

From `rebuild/app`, on this branch:

- `npm run build` passed. The existing Vite chunk-size warning remains.
- `flock /tmp/grove-npm-test.lock npm test` passed, including browser scripts and posttest. Vitest: 70 files, 1227 tests, of which 444 are parity. No failure, so the known 300-card drag flake was not rerun.
- `npm run audit:offline` passed: 180 source files, dist, CSP, capabilities, and dependencies. The `loneWebUrl` check is a regex literal, and the production bundle does not add a new `https://` literal.

From `rebuild/app/src-tauri`, with `--offline`:

- `cargo build` passed.
- `cargo test` passed: 73 passed, 4 ignored.

Frame numbers from that locked `npm test`:

- 300-card drag: max 16.8 ms, 49 intervals.
- 300-card/400-edge pan: 70 samples, p95 16.8 ms, max 16.8 ms.
- 300-card/400-edge zoom: 47 samples, p95 16.7 ms, max 16.8 ms.
- 1,000-row Bases scroll: max 16.8 ms.
- Board menu: on screen within two frames, max 16.8 ms in the full run and 16.7 ms in the dedicated script, `getAnimations().length === 0`.

`rebuild/round*-shots` was restored and not committed. Prompt files were not committed.

## Left open

- Web-page size 400×120 and empty-group size 400×400 are choices, not measurements from the help page.
- A rejected URL closes with no message.
- Right-click on an edge, including when cards are selected, still uses the selection menu, so that menu can still offer Create group around the selection. Empty board space no longer does.
- CZ5 calls `addItems`. This change does not implement Ctrl+drag.
