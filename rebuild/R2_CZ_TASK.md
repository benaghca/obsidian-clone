# R2 CZ: canvas zoom (crisp + smooth)

Approved by Chris Nov 21, 2026, 11:24 PM PT. Last Grove piece of round R2 (wrap-up).

## The two problems he sees
1. **Blurry when zoomed in.** Canvas cards/text/edges go fuzzy when you zoom in. Likely cause (a hunch, verify it): a CSS transform scaling an already-rasterized layer (e.g. will-change: transform or a cached bitmap/canvas drawn at one scale). It must re-render crisp at every zoom level, both during and after a zoom.
2. **Zoom feels steppy and snappy.** It should feel smooth and modern, like Obsidian's canvas: eased, animated zoom toward the cursor for mouse wheel AND trackpad pinch (ctrl+wheel / gesture events), with no jumps, no lurch at the start or end, and the point under the cursor staying under the cursor.

## Limits
- Keep pan, keyboard shortcuts, zoom limits and the look exactly the same. No other visible change.
- No added lag on big canvases (hundreds of cards). Keep frame work bounded during a zoom animation; don't re-layout every card on every frame if you can avoid it.
- No new crates or npm packages. No network. No Obsidian or Excalidraw code or assets; build from observed behavior.
- Design the approach yourself; these are the goals, not the method.

## Done means
- Crisp text at zoom levels across the whole range (check at high zoom and after settling).
- Wheel and pinch both animate smoothly toward the cursor; rapid wheel ticks merge into one continuous glide instead of stacking jumps.
- Regression tests for the zoom math (anchor point stays fixed, easing converges, limits respected) and for crispness (e.g. no scaled raster layer at rest), plus existing canvas tests still passing.
- Notes in rebuild/NOTES_R2_CZ-claude.md: what caused each problem, what you changed, test results.
