# Piece NH: nested hover previews (Claude)

Branch `rebuild/nh-claude`, from integration 9203860. Approved behavior change (Chris, Nov 11, 2026).

## What was wrong
`src/shell/hoverPreview.ts` had two things stopping a second preview:

1. **The popover was a dead zone.** `inspect()` started with `if (popup?.contains(el)) return cancel();`, so any pointer move or Ctrl press inside the preview stopped there and never looked for a link. That's why Ctrl+hover inside a preview showed nothing.
2. **One global slot.** State was a single `key` / `popup` / `dispose`. Starting any new preview called `close()`, which removed the open popover first. Even without (1), a link in the preview would have replaced its own parent.

There was also a hidden third problem that nesting would have exposed: a preview's root `.markdown-embed` carries `data-embed-href` (`NoteEmbedWidget.toDOM` tags every embed for canvas hover). Once the inside of a popover is inspected, Ctrl over plain preview text would fall back to that attribute and preview the same note again.

## What changed
- **`hoverPreview.ts`**: the single slot became `layers: Layer[]`, the chain from the root up. Each layer keeps `{ key, popup, origin, source, dispose }`. The preview itself (`show()`: detached read-only context, `NoteEmbedWidget`, placement, `ResizeObserver`, click handling) is reused unchanged for every depth. It now pushes a layer instead of filling the global slot.
  - `inspect()` finds which layer the pointer is in (`layerOf`, deepest first, O(depth) `contains` calls). Inside layer *i*, links and embeds are looked up as before. They resolve from that preview's note (`origin`), not from the editor, and a hit opens layer *i + 1*. Inside a popover there is no editor, so `findFromDOM`/`linkAt` are skipped.
  - The `key` includes the depth. `layers[depth].key === next` means "on the link that opened the child", which plays the role the old `key === next` check did.
  - Every nested preview's `openLink` goes through the **root** editor host and source. Clicking a link three levels deep opens it where the first preview would have, then closes the whole chain.
  - A nested preview that can't open (for example a link to an image) leaves its parents alone. At depth 0 it closes the same way as before.
- **`embeds.ts`** (1 line): a page preview's root is no longer tagged `data-embed-href`. Embeds *inside* a preview keep the tag, so they still preview their own target.
- No CSS change. Popovers are still body-level `.hover-popover` siblings with the same z-index. A later one paints on top, so the existing look, size (450×400), 350 ms delay, 180 ms close delay, and below/above placement apply at every depth unchanged.

## How it closes
Three small operations:
- `drop(keep)` closes layers past `keep` right away and cancels a pending child.
- `leave(keep)` cancels pending work and schedules `drop(keep)` after the usual 180 ms. With `keep = 0` it schedules `close()`.
- `close()` closes everything and removes the dismissal listeners.

| Pointer / event | Result |
|---|---|
| Moves inside layer *i* (not on the link holding *i+1*) | `leave(i+1)`: deeper layers close after 180 ms; layers 0..i stay. A brief pass through a parent on the way back to the child keeps the child. |
| On the link that opened layer *d* (Ctrl not needed) | `leave(d+1)`: layer *d* stays, anything above it closes after 180 ms |
| Ctrl over a *different* link at depth *d* | `drop(d)` now, new child pending (same as today's replace-on-new-link) |
| Leaves every popover and link | `leave(0)`: whole chain closes after 180 ms |
| Plain hover over a link inside a preview | nothing. Inside a preview, Ctrl (Cmd on macOS) is required, even when the root came from Reading view's plain hover. |
| Escape / any non-modifier key / input / window blur / resize / `show`·`mode`·`files` change | whole chain closes at once (today's rules) |
| Scroll, wheel, mousedown or pointerdown inside layer *i* | `drop(i+1)`: only the previews stacked above *i* close, because their anchor links moved or were clicked. Outside the chain these close it all, as today. |
| Click a link at any depth | opens via the root editor; whole chain closes |

The timer rules are the same as before. The 180 ms leave delay restarts on each move, exactly as the single-level code did. Dismissal listeners (`document` keydown/input/scroll/mousedown/pointerdown/wheel and `window` blur/resize) are still added once when the first preview of a chain starts, shared by all depths, and removed by one `AbortController` when the chain closes. Each popover's own listeners are on the popover node, which is removed. Each layer's `dispose` disconnects its `ResizeObserver` and destroys its widget and detached `EditorView`.

## What I tested
- **Unit (vitest, `src/shell/hoverPreview.test.ts`)**: the 9 existing single-level tests are unchanged and pass. That covers the 350 ms open and 180 ms close, Ctrl release on the link, Escape, Cmd on macOS, Ctrl press while still, embeds, and touch/pen/buttons. Nine new tests:
  - stacking to depth 4, with each nested link resolved from the parent preview's note
  - Ctrl required inside a preview even from Reading view
  - leaving a child into its parent closes that child and deeper ones after exactly 180 ms, and coming back in time keeps it
  - the opening link holds its child without Ctrl, and the root link keeps only the first preview
  - Ctrl on a sibling link replaces children at once
  - leaving a 12-deep chain closes all 12 after 180 ms with no live listeners left and all 24 popover/view destroys done
  - Escape and typing close the whole chain and its listeners
  - wheel, scroll or mousedown in a parent closes only the previews above it, and outside closes all
  - a non-note nested link leaves its parents open
- **Browser (`scripts/test-nested-hover.mjs`, added to `npm test`)**: headless Chromium driven by real CDP mouse and keyboard input on the mock vault, in Live Preview and Reading view. 30 checks:
  - Stacking and titles; each child inside the window at ≤450×400, under (or above) its link.
  - Plain hover inside a preview does nothing. Ctrl over preview text opens nothing (the `data-embed-href` fix).
  - Brief pass through a parent keeps children; resting in the parent closes just them after the delay.
  - Leaving the chain closes everything after the delay. Escape closes the chain.
  - Depth 12 opens fully, and 500 pointer moves over it took about 2 ms.
  - An embed inside a preview previews its target.
  - Wheel in a parent vs. outside.
  - Clicking a link at depth 3 opens `NH4` and clears the chain.
  - Leak checks use `DOMDebugger.getEventListeners` on `document`/`window`, filtered to listeners from `hoverPreview.ts`. The count rises while a chain is open and returns to baseline after every close path. (Unfiltered counts drift for unrelated reasons: the tooltip module adds its own listeners while the pointer is over a labelled icon, and the lazily loaded graph view adds a window keydown.) Zero `.hover-popover` nodes remain after each close.
- `cargo test --offline` in `src-tauri`: 156 passed, 4 ignored. `flock /tmp/grove-npm-test.lock npm test`: the first run failed one timing budget in `test-friction.mjs` (`open_ctrl_click_tree` painted in 73 ms, budget 50, with load average about 6.5). That path opens no preview. The rerun passed in full: exit 0, vitest 109 files / 1657 tests, `test-nested-hover.mjs`, and every browser and posttest script. The tracked `round*-shots` the run rewrote were restored.

## Size
`hoverPreview.ts` +84 / −50 (now 265 lines), `embeds.ts` +2 / −1, `package.json` one script entry. Tests: `hoverPreview.test.ts` +178 / −8, new `scripts/test-nested-hover.mjs` (136 lines). No new modules, dependencies, CSS or assets.

## Not changed / notes for review
- Deep chains clamp against the window edge like any preview does. Past the bottom-right corner, later previews overlap earlier ones (see the depth-12 run). The placement rule is unchanged, as the task asked.
- Ctrl is required for links inside previews even when the root preview came from Reading view's plain hover. Plain hover chaining would open previews while you move toward a link to click it. The task describes the chain as Ctrl+hover.
