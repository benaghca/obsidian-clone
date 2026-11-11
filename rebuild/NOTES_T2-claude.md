# NOTES_T2: hide the close button on very narrow tabs

Built on `rebuild/t2-claude` from the brief commit `1537271` (brief: `T2_TASK.md`). Headless Chromium only, against the mock's `?synthetic=5000` vault. Screenshots were kept under `/tmp` and are not committed.

## In plain words

What Chris will see when the tab strip is crowded or a split is very narrow:

- **A squeezed plain tab no longer shows a "×".** This applies once a tab is under 53 px wide, and plain note tabs go down to 40 px.
  - Clicking anywhere on the tab selects it, and clicking the tab you're already on does nothing.
  - Before, the active tab's "×", and the "×" that appears on hover, covered most of the tab, so a click on its middle closed it.
  - The active tab now shows a letter or two of its title where the "×" was.
- **Middle-click and Ctrl+W still close tabs** at every width.
- **A pinned tab keeps its pin**, since it shows the tab is pinned. While the tab is squeezed, the pin no longer takes clicks, so a click there selects the tab instead of unpinning it. Unpin still works from the tab's menu and the pin command.
- **At normal widths nothing changes.** The "×" still fades in on hover, and the active tab always shows it.
- **Graph, Canvas and other view tabs, and linked tabs, are unchanged.** They never get narrower than 53 px (T1's minimums), so they always keep their "×", unlink icon and view icon, apart as T1 left them.

Tab height, colours, the "+" hover, drag to reorder, shortcuts, focus after tab actions and theme variables are unchanged.

## Threshold and how the strip knows

- **Threshold:** the "×" hides when a tab is under 53 px.
  - **It covers the 40 px case:** plain tabs are the only ones that get that narrow, down to their 40 px minimum.
  - **It's below every tab that carries an icon.** 53 px is T1's minimum for a tab with a view icon; linked note tabs stop at 56 and linked view tabs at 76. So this can only ever affect plain tabs, and all of T1's hit-target guarantees stay exactly as they were.
  - **It's far below everyday widths.** Tabs are 200 px wide while there's room, and it takes about 20 tabs in one pane, or a very narrow split, to get under 53.
  - **It's where the "×" starts to matter.** The button is 18 px at the tab's right end. At about 46 px it covers the middle of the tab; up to 52 px it leaves a sliver of title.
- **Detection:** a CSS container query; no script.
  - Each main-strip tab header is a size container (`container-type: inline-size`).
  - `@container (width < 47px)` hides the button. The query reads the content box, inside the tab's 3 px side padding, so 47 px there is 53 px outside.
  - It's re-checked by the browser on every layout: when tabs are added or closed, the window or a split resizes, or a tab grows or shrinks in its open or close animation.
  - There's no measuring, class toggling or listener. In T1 I wrote that CSS couldn't tell when a tab is at its minimum. That was wrong: the tab can be its own container.
- **What the query changes on a squeezed tab:**
  - an unpinned tab's close button is `display: none` (hidden, not faded or covered), and its title gets the room back (right padding 3 px);
  - a pinned tab's pin stays visible with `pointer-events: none`;
  - the hover fade on the title's end is off, as there's no button for it to fade under.
- **Engine support:** container queries need Chromium 105+ (WebView2 is evergreen) and WebKitGTK 2.40+ (Safari 16). `styles/noteView.css` already uses `@container` for squeezed panes, so this adds no new requirement.
- **The header being a container doesn't change its size.** Its width is set explicitly (`--tab-width` with a min-width), never from its content, so inline-size containment changes nothing about it. Its height isn't contained.

## Tests (`scripts/test-tabs.mjs`)

**Where they run:** in T1's squeezed-strip section, where the preferred tab width is set to 0 so every tab sits at its minimum. A plain tab measuring exactly 40 px confirms that. The section first closes the Graph and Canvas tabs left from T1's checks. It then opens two extra plain tabs, which are closed again by the checks, so the steps after this section see the same tabs as before.

| Check | Old CSS (`1537271`) | New |
|---|---|---|
| The active plain tab, 40 px wide, doesn't show its close button | fails (shown) | passes |
| A click on the middle of the active 40 px tab keeps it open and active, with the note's focus and caret | fails (the tab closed; focus went to another note at 0) | passes |
| Hovering an inactive 40 px tab doesn't show its close button | fails (shown) | passes |
| A click on the middle of an inactive 40 px tab selects it, with focus in its note | fails (the tab closed; still on Big note) | passes |
| A pinned 40 px tab keeps its pin visible, and a click on its middle selects it and keeps it pinned | fails (the click unpinned it and didn't select it) | passes |
| At 40 px a middle click still closes a tab; focus and caret stay | passes | passes |
| At 40 px Ctrl+W still closes the active tab, landing on the note it sat next to at its caret | passes | passes |
| Back at a normal width, the active tab shows its close button and hovering an inactive tab shows its own | passes | passes |

- **The new-behaviour checks** are the first five rows. Each fails on the old CSS and passes now.
- **The last three rows guard what must not change,** so they pass both ways.
- **The old CSS failed on nothing else.** I checked it by putting back the brief commit's `tabs.css`.
- **Reopening after a regression:** on the old CSS a regression closes tabs these steps go on to use. A small `ensure` step reopens them (the note at its caret), so a regression lists every miss instead of crashing.
- **T1's checks** pass unchanged: the min-width unlink checks for linked note, Graph and Canvas tabs, the view-icon select checks (including pinned Graph), middle-click over the buttons, Ctrl+T/Ctrl+W back to origin, drag, focus, and the seamless strip.
- **No existing assertion was changed or weakened.** T1's squeezed section still switches back to the note with `ws.activate` instead of a click. That's no longer needed, but it's left as it was.

**One T1 timing check missed once.** While I was debugging, one `test-tabs` run reported one long task during drag-to-reorder. That run also had the leftover Graph and Canvas tabs, and the next five runs had none; see Results. The drag budget is unchanged.

**Screenshot:** a strip with 26 note tabs, a pinned one and a Graph tab, kept under `/tmp/grove-t1-shots/t2-squeezed.png`. The active 40 px tab shows "R…" with no "×", the pinned tab its pin, and the Graph tab its icon at 53 px.

## Confirmed still working

- **Middle-click** closes at 40 px (new check) and at normal width, including over a tab's buttons (T1 checks).
- **Ctrl+W** closes at 40 px (new check) and at normal width, and an untouched new tab still goes back to its origin (T1 check).
- **Hover-to-show at normal widths:** T1's hover checks at 166 px tabs, plus the new check after the strip is released from its squeeze.
- **T1 hit targets:**
  - linked note 56 px, linked Graph and Canvas 76 px: unlink clear of close by 2 px;
  - Graph, Canvas and pinned Graph 53 px: view icon clear of close or pin by 2 px.

## Line counts (against `1537271`)

| File | Added | Removed |
|---|---:|---:|
| `app/src/styles/tabs.css` | 22 | 0 |
| **CSS (app code)** | **22** | **0** |
| `app/scripts/test-tabs.mjs` | 46 | 0 |
| `NOTES_T2-claude.md` | this file | |

- **TypeScript:** none changed.
- **App code net:** +22 lines, all CSS, under the brief's ~+50.
- **No new dependency.** No Rust.
- **Dead code:** nothing became unused.
- **File sizes:** `tabs.css` is 261 lines and `test-tabs.mjs` 369; no file is near 800.

## Results

- **Run on their own, on the final tree:** `test-tabs.mjs`, `test-header.mjs`, `test-friction.mjs` and `test-r27e.mjs` passed. In `test-tabs`, drag-to-reorder had no long task and frames at p95 17 ms.
- **`flock /tmp/grove-npm-test.lock npm test` (with `posttest`):** exit 0 on the first run. Vitest 99 files, 1,545 tests; P0 feel, F1 friction and every browser script passed. Drag in the suite's `test-tabs` run: p95 17 ms, no long task.
- **`npm run build`:** passed. The existing Vite large-chunk warning remains.
- **`npm run audit:offline`:** passed. 220 source files, dist, CSP, capabilities and dependencies checked.
- **`cargo test`:** not run, because no Rust changed.
- **Screenshots** the suite rewrote under `rebuild/round*-shots/` were restored before committing.
