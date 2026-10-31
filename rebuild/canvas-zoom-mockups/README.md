# Canvas zoom mockups (CZ plan)

Static pages for `rebuild/CANVAS_ZOOM_PLAN.md`. Each page is plain HTML/CSS (`canvas.css`, Grove's dark-theme tokens) with Lucide icons from the app's own `lucide` dependency written inline. There are no scripts and no external assets. The PNGs come from headless Chromium.

Rebuild: `node rebuild/canvas-zoom-mockups/build.mjs` (from the repo root).

What the pages are based on: Chris's screenshots of Obsidian (zoomed-out cards, Ctrl+drag, the empty-canvas menu) and Obsidian's public Canvas help page. No Obsidian code, CSS, icons or assets were used. The sample board is made up.

| Page | Shows |
|---|---|
| `definition.png` | **Card definition, today vs proposed,** on the same board at 62%, 36% and 20%. Today: card fill = canvas colour, a border that thins as you zoom out, shrunk text. Proposed: raised fill, a 1 px screen border at every zoom, a full-colour 1.5 px border on coloured cards, groups outlined, edges 1.5 px. Below 45% the proposed cards show their titles. |
| `lod-options.png` | **Three zoomed-out looks** at 25%: **A** title only, centred (recommended); **B** title + faint content bars; **C** title + type icon. |
| `threshold.png` | **When cards switch:** the same board at 70%, 50% (full content), 40%, 18% (title only) and 6.3% (most cards too small for a title). The band shows the hysteresis: zooming out switches at 45%, zooming in switches back at 55%. The table lists what each card type shows. |
| `ctrl-drag.png` | **Ctrl+drag on empty canvas:** today a plain selection box. Proposed: an accent box, then a menu at the corner (Add card, Add note from vault, Add media from vault, Add web page, Create group); the new item takes the box's position and size. |
| `context-menu.png` | **Right-click on empty canvas:** today nothing. Proposed: the add items, Create group, Undo, Paste, Snap to grid ✓, Snap to objects ✓, Read-only. |

Colours: Grove's accent (teal) is used where Obsidian's screenshots show its purple accent.
