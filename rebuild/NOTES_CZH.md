# CZ-H: canvas link previews

Branch `rebuild/canvas-czh-grok`, from `18f43a9`. Local commits only; nothing pushed. No GUI window was opened. Canvas zoom and editing files were left alone, because CZ1 is in that code at the same time.

## What was wrong

Ctrl+hover over a link in a normal note opens the page preview. The same hover inside a canvas note card did not, in the real app (WebKitGTK). Headless Chromium already opened it. A canvas click calls `preventDefault()` on `pointerdown`. The Pointer Events spec then suppresses compatibility mouse events until `pointerup`. Chromium clears that at `pointerup`. WebKitGTK can keep suppressing `mousemove` after the click. Pointer events are not suppressed, and ordinary notes never cancel `pointerdown`, which is why previews worked there.

## What changed

The hover listener in `shell/hoverPreview.ts` now uses `pointermove` for `pointerType` `mouse` or `pen`, instead of `mousemove`. Touch is ignored, so a touch pan is not a hover. A button held down means a drag or pan owns the pointer, so a preview does not start. An already open or pending preview can still follow the pointer, so dragging off the link can leave.

Pressing Ctrl (Cmd on macOS) while the pointer is already still re-checks the element under the last pointer position with `elementFromPoint`. Before this, the pointer had to move after the modifier, in notes and on the canvas. The modifier keydown passes "modified" as true rather than reading `ctrlKey`, because the keydown for Control itself can have `ctrlKey` false. Repeats are ignored. The platform check runs at event time, the same way the move path does, because unit tests stub `navigator.platform` after import.

Dismissal listeners are installed only while a hover is pending or open:

- `pointerdown` outside the popover closes it. A canvas `pointerdown` can swallow the `mousedown` that used to do that.
- `wheel` outside the popover closes it. Ctrl+wheel zooms the canvas and does not scroll, so the old scroll listener never saw it. A wheel whose target is inside the popover still scrolls the preview.
- `pointerout` with no related target leaves, in place of `mouseout`.
- The popover also cancels its close timer on `pointerenter` and leaves on `pointerleave`.

The popover stays a child of `document.body`, `position: fixed`, placed from `getBoundingClientRect()` (viewport coordinates). The canvas world is transformed and `overflow: hidden`, so a popover inside it would scale and clip. The hover listeners do not call `preventDefault` or `stopPropagation`, so pan, drag, and zoom keep the events.

`elementFromPoint` is not used on every move. It forces layout. Moves use `event.target`. The still-modifier case is the one that needs a hit test, because the key event's target is the focused element.

## Files

| File | Lines |
|---|---|
| `rebuild/app/src/shell/hoverPreview.ts` | +41 / −6 |
| `rebuild/app/src/shell/hoverPreview.test.ts` | +59 / −16 |
| `rebuild/app/scripts/test-canvas-hover.mjs` | +173 (new) |
| `rebuild/app/package.json` | +1 / −1 (the new script runs right after `test-canvas-notes.mjs`) |

## Browser test

`scripts/test-canvas-hover.mjs` dispatches synthetic `PointerEvent`s. A `mousemove` with Ctrl held must not open a preview. It then checks a text card, a note card with a pen pointer, Ctrl pressed while the pointer is still, a selected note card (the selection survives the hover; Escape is what clears it), a note card being edited, a text card being edited, and the same note card after two zoom-out steps (scale 0.5). The popover must be a body child, `position: fixed`, unscaled (`offsetWidth` matches the visual width, computed transform `none`), on top at its corners and center, fully on screen, and beside the link's visual rect. Horizontal overlap is the check, because a 450px popover clamps to the viewport (left 822 in the 1280px window). Opening it must not change the zoom. Ctrl+wheel must change the world transform and dismiss the preview. Dragging the note title must still move the card (480px to 520px). The gap under the link was 6px in every case, including at scale 0.5, where the popover stayed 450px wide.

A tall note lays the wikilink below the card's visible box. `getBoundingClientRect` reports the unclipped box, and `elementFromPoint` then hits the canvas behind the clip. The test scrolls every ancestor that actually clips before it points.

## Tests

- **`npm run build`:** passed, with the existing chunk-size warning only.
- **`npm run audit:offline`:** passed (180 source files).
- **`flock /tmp/grove-npm-test.lock npm test`:** passed on the first run (about 10 minutes), including `posttest`. Vitest 70 files, 1230 tests. `test-canvas-hover.mjs` passed every case above. `test-round19-fixes` still opens previews from CDP `mouseMoved` and still scrolls inside an open popover without dismissing it, in live, source, and reading mode. 300-card pan max 16.8 ms, zoom max 16.8 ms, drag max 16.8 ms. 1000-row Bases scroll max 16.8 ms. No timing flake, so nothing was rerun.
- **`cargo build --offline` and `cargo test --offline`** from `rebuild/app/src-tauri`: 73 passed, 4 ignored. No Rust files changed.
- **Screenshots:** the regenerated files under `rebuild/round*-shots/` were restored with `git checkout` and were not committed.

## Left open

Please confirm in the real WebKitGTK app: Ctrl+hover a link in a file card and in a text card, including after clicking the card once, and press Ctrl while the pointer is already on the link. The popover should sit beside the link and stay the normal size when the canvas is zoomed out. If it still fails, the next suspects are the canvas `pointerdown` focus handling stealing the hover target, then stacking of the popover (it is `z-index: 40` on the body, not the top layer). No debug log was added.
