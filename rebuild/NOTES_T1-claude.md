# NOTES_T1: slim, clean tabs that keep your place

Built on `rebuild/g1-claude` from the brief commit `6c2a0af` (brief: `T1_TABS_TASK.md`). This file also keeps, below, the notes of an earlier, unrelated piece that was also called T1 (template merge, 4 Nov), unchanged. Headless Chromium only, against the mock's `?synthetic=5000` vault. Screenshots were kept under `/tmp` and are not committed.

## In plain words

What Chris will see and feel in the tab strip:

- **Slimmer tabs.** Tabs are 28 px tall instead of 34, as the feel spec measured in Obsidian.
  - They sit on the strip's bottom edge, under the 40 px title bar.
  - The active tab is a white (in dark themes, the page colour) rounded-top tab, and inactive tabs are plain text with thin separators, as before.
  - Hovering an inactive tab shows a smaller rounded highlight (21 px tall, was 29).
- **The "+" new-tab button no longer lights up as a big box.** Its hover is now the same small rounded square as the tab-list chevron next to it: 30×26 px, level with the tabs. Before, it was 24×39, from the top of the window to the tab bottom.
- **Titles get more room.** The close "×" now sits over the end of the title instead of always reserving space beside it.
  - An inactive tab's title uses the whole tab. With ten tabs open you now read "alpha del…" instead of "alph…".
  - Hovering fades the end of the title out under the "×", so nothing moves.
  - The active and pinned tabs, which always show their button, keep room for it.
- **You stay in your note.** In each of these cases focus used to fall to the page, so typing went nowhere until you clicked back into the note. Now the caret stays where it was:
  - clicking the "×" on another tab;
  - clicking the tab you're already on;
  - dragging a tab and dropping it outside any pane.
- **Unchanged and checked:**
  - middle-click closes a tab;
  - drag to reorder;
  - Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Shift+T;
  - pinning;
  - tabs shrinking evenly when many are open;
  - light and dark themes.

No new setting, command or feature.

## Review fixes and the seamless strip (after `e6a7157`)

The independent review passed `e6a7157` with three fixes required. Chris then asked for one more look change in the same round.

**In plain words:**

- **The unlink icon on a linked tab works on hover.** The close "×" used to sit on top of it when you hovered, so trying to unlink could close the tab. Linked tabs now keep room for both, side by side.
- **Middle-click closes a tab anywhere on it**, including over its "×" or its link icon. Before, a middle press there did nothing. A left click on those buttons still closes, unpins or unlinks as before.
- **Ctrl+T then Ctrl+W puts you back where you were.** Closing a new tab you haven't used returns to the note you opened it from, with the caret where you left it. Before, you landed on whichever tab sat next to it. Once the new tab has opened a note, closing it follows the usual nearest-neighbour rule.
- **No line under the tab strip.** The active tab, already in the note's colour, now runs straight into the note, as in Obsidian. Inactive tabs stay on the strip colour. Only existing theme tokens are used (`--background-primary`, `--background-secondary`); nothing new was added.

**What changed:**

- **`styles/tabs.css`:**
  - linked tabs keep 22 px clear for the close button, as the active and pinned ones do, and their title isn't masked on hover;
  - the strip's `border-bottom` is gone, and with it the tab's `margin-bottom: -1px`, which existed only to cover that border.
- **`shell/tabStrip.ts`:** the close and unlink buttons keep only non-middle presses to themselves (`own`), so a middle press reaches the tab, which closes it and cancels the press's default. That default would otherwise be autoscroll (Windows) or paste (Linux). The close button's `mousedown` still cancels its default, so focus stays in the note.
- **`workspace.ts`:**
  - `newTab` remembers the tab it was opened from, in a `WeakMap`.
  - `closeTabs` makes that tab active again when the closed tab is the group's active one and is still untouched: no note, no view, no history, and the origin still in the same group. Otherwise the old rule applies.
  - The caret comes back through the existing per-tab memory, the same as any tab switch.

**Tests (`scripts/test-tabs.mjs`)**, each checked against the old code. The sabotage put one app file at a time back to `e6a7157` and confirmed that only its own new checks failed:

| Check | With the old file |
|---|---|
| A hovered linked tab's unlink icon is clear of the "×" and is what's under the pointer; clicking it unlinks without closing or switching, and focus and caret stay | `tabs.css`: fails (gap −17 px; the click closed the tab) |
| A middle press on the unlink icon, and on the "×", closes that tab and cancels the press's default; focus and caret stay | `tabStrip.ts`: fails (nothing closed, no press handled) |
| From the first tab, with the caret set, Ctrl+T then Ctrl+W comes back to that tab at that caret | `workspace.ts`: fails (landed on Big note, the neighbour) |
| A new tab that opened a note closes to its neighbour, as before | passes both ways (the fallback) |
| A left click on a pinned tab's pin unpins it and keeps it open | passes both ways (preserved behaviour) |
| Light and dark: the active tab's background equals the note's, its bottom meets the note's top exactly, and nothing draws a line between them (strip border or shadow, leaf or view-header top border, `::after` lines) | strip border in place: fails (`1px rgb(224, 224, 224)` light, `1px rgb(51, 51, 51)` dark) |

The Ctrl+Tab check now compares against the tab active just before the press. The test reaches it from a different tab than before, and the old comparison would have matched by wrap-around.

**`scripts/test-r27e.mjs`** asserted the old rule for exactly this case: from Welcome, "+" then "×" showed the neighbour. Its check now expects Welcome, the tab the new one came from, and keeps the same exact tab-order check. The behaviour changed as the review asked; the check is no looser.

**Seen, not changed in this round:** the sidebars' tab rows kept their line under the header. Chris has since approved removing it (see "Follow-up: no line under the side panels' tab rows" below). In a top/bottom split, the lower pane's strip sits directly under the upper note; its strip colour still separates the two (checked in `/tmp` screenshots).

**Line counts against `e6a7157`:**
- **App code:** CSS +7/−6, TS +11/−6 (`tabStrip.ts` +6/−6, `workspace.ts` +5/−0), net **+6**.
- **Tests:** `test-tabs.mjs` +67/−6, `test-r27e.mjs` +2/−1.
- **T1 app code since `6c2a0af`:** net +28.
- **File sizes:** `workspace.ts` is 706 lines (under 800), `tabStrip.ts` 163, `tabs.css` 225.
- No new dependency and no Rust.

**Results, on the final tree of this round:**

- **`flock /tmp/grove-npm-test.lock npm test` (with `posttest`):** exit 0. Vitest 99 files, 1,545 tests.
  - P0 `test-feel.mjs` passed, with the graph as its known gap.
  - F1 `test-friction.mjs` passed. It printed its P6 gap (raw long tasks 87, 94 and 124 ms) and the one-time list-Enter parse (46 ms).
  - `test-header.mjs`, `test-r27e.mjs` and `test-tabs.mjs` passed.
  - An earlier full run, with the three review fixes but before the seamless-strip change, also exited 0.
- **`npm run build`** and **`npm run audit:offline`:** passed. The existing Vite large-chunk warning remains.
- **Screenshots** the suite rewrote under `rebuild/round*-shots/` were restored before committing.

## Follow-up: no line under the side panels' tab rows (after `e33299e`)

**In plain words:** Chris approved this one. The left and right sidebars' icon tab rows no longer have a line under them, so each row runs straight into its panel, like the main tab strip.

**What changed:**
- **`styles/sidedock.css`:** the tab row's `border-bottom` is removed.
- **The light-theme override is deleted too.** It only recoloured that line, and it was the one hard-coded colour there (`#e4e4e4`).
- **No colours added.** The row and panel keep their existing theme backgrounds. The active icon's highlight (`--background-modifier-hover`) is unchanged.

**Tests:**
- **`scripts/test-tabs.mjs`:** in light and dark, for both the left and right sidebar, nothing draws a line between the tab row and the panel below. It looks at:
  - the row's bottom border, box shadow and `::after`;
  - the top border of the panel below the row, and of that panel's first child.

  With the border still in place it failed in both themes, on both sidebars (`1px rgb(228, 228, 228)` light, `1px rgb(51, 51, 51)` dark). It passes after the change.
- **`scripts/test-r27m.mjs`:** this older test asserted the opposite, a 1 px `rgb(228, 228, 228)` line under the left sidebar's tab row. Its check now asserts no line (`0px`), which is the approved design. It is still an exact check.
- **Screenshots:** left and right sidebars in light and dark, kept under `/tmp/grove-t1-shots` and not committed, show no seam.

**Line counts against `e33299e`:**
- **App code:** CSS +1/−5 in `sidedock.css`, net −4.
- **Tests:** `test-tabs.mjs` +17/−0, `test-r27m.mjs` +2/−1.
- **T1 app code since `6c2a0af`:** net +24.
- No new dependency and no Rust.

**Results:**

- **`flock /tmp/grove-npm-test.lock npm test` (with `posttest`):**
  - **First run: exit 1, on the same unrelated timing check as in the first T1 round.** `src/drawing/scene.test.ts` "parses a 5,000-element drawing in under 20 ms" measured 20.3 ms; even plain `JSON.parse` of that file took 20.1 ms under the load. Vitest stopping there means the later scripts and `posttest` didn't run. The check passed alone three times.
  - **Second run, same tree: exit 0.** Vitest 99 files, 1,545 tests. `test-tabs.mjs` and `test-r27m.mjs` ("the sidebar tab row has no bottom line") passed, along with the rest of `posttest`.
- **`npm run build`** and **`npm run audit:offline`:** passed.
- **Screenshots** the suite rewrote were restored before committing.

## Re-review fix: unlinked view tabs at the minimum width (after `b6ebede`)

Codex's re-review of `b6ebede` confirmed the linked-tab fix and required one more. An unlinked Graph or Canvas tab could still shrink to 40 px. There, on hover, its close button covered 11 px of the view icon, including the icon's centre. A pinned tab's pin covered it the same way. So a click meant to select an inactive Graph or Canvas tab could close it, or unpin it.

**In plain words:** a tab that shows a view icon (Graph, Canvas, Bases, drawing, image and so on) now stops shrinking at 53 px. Its icon stays clear of the "×" or pin, so clicking the icon always selects the tab. Nothing else changes:
- plain note tabs still go down to 40 px;
- linked tabs keep their 56 px (note) and 76 px (view) minimums.

**What changed:**
- **`styles/tabs.css`:** `.mod-root .workspace-tab-header[data-icon] { min-width: max(var(--tab-min-width), 53px) }`.
- **Why 53:** 40 px plus the measured 11 px overlap, plus the same 2 px gap as the linked tabs.
- **The linked rules still win.** They are more specific, so linked tabs keep their own minimums.
- **I rejected collapsing the icon at the minimum,** for the same reason as before: CSS can't tell when a tab is at its minimum.

**Test (`scripts/test-tabs.mjs`):** in the squeezed-strip section, for an inactive unlinked Graph tab, Canvas tab and pinned Graph tab, with the pointer on the view icon:
- the icon is clear of the close button or pin;
- the close button or pin isn't what's under the icon's centre;
- clicking the icon's centre selects the tab and keeps it open, and pinned if it was;
- focus doesn't land in the tab strip;
- switching back to the note restores its focus and caret.

**Against the old CSS (`b6ebede`):** all three failed with `{"width":40,"gap":-11,"hit":false}`. The Graph and Canvas clicks closed their tabs, and the pinned Graph click unpinned it. With the fix all three are 53 px wide, with a 2 px gap, and select.

**Test fixes along the way:**
- **Switching back to the note.** The script now switches with `ws.activate` instead of a click. At 40 px the active tab is almost entirely its always-visible close button, so a click at its centre closed the note.
- **A step that loses its view tab reopens it,** so a regression lists every miss instead of crashing.

**Seen, not changed:** in a strip squeezed to 40 px, the active note tab is almost all close button, so clicking its centre closes it. This fix doesn't change it: the active tab always shows its 18 px button, and only 34 px of the tab is inside its padding. I didn't check how the pre-T1 layout behaved here. Clicking the tab you're on doesn't need to do anything, but a mistaken close is possible. Fixing it would need a wider active tab, which would widen crowded strips, or hiding its "×" at the minimum, which CSS can't detect. It's recorded for a decision, not changed here.

**Separate commit, optional per the brief: the drawing parse check.** `src/drawing/scene.test.ts` "parses a 5,000-element drawing" kept missing its flat 20 ms limit under full-suite load. It measured 20.3, 20.66 and 20.9 ms in T1 runs, with `JSON.parse` alone up to 20.1 ms. Alone it takes about 11.5–11.8 ms.
- **Change:** the flat limit is now 25 ms, still about twice the isolated time.
- **Kept as is:** the tighter relative check, under `JSON.parse` × 1.25 + 2 ms, which held in every failing run, and the 50 ms parse-plus-read check.

**Line counts against `b6ebede`:**
- **App code:** CSS +5/−0 in `tabs.css`.
- **Tests:** `test-tabs.mjs` +23/−0; `scene.test.ts` +4/−2, in its own commit.
- **T1 app code since `6c2a0af`:** net +38.
- No new dependency and no Rust.

**Results:**
- **`test-tabs.mjs` and `test-header.mjs`, run on their own:** passed.
- **`scene.test.ts`, run alone three times:** passed (median 11.8 ms).
- **`flock /tmp/grove-npm-test.lock npm test` (with `posttest`), with both changes:** exit 0 on the first run. Vitest 99 files, 1,545 tests, and every browser script passed.
- **`npm run build`** and **`npm run audit:offline`:** passed.
- **Screenshots** the suite rewrote were restored before committing.

## Re-review fix: linked view tabs at the minimum width (after `ea7b718`)

Codex's re-review of `ea7b718` passed it with one fix required. Linked Graph, Canvas and other view tabs show a view icon before the title. At the 56 px linked minimum, that icon pushed the unlink icon 17 px under the close button, so clicking unlink could still close those tabs.

**In plain words:** a linked tab that shows a view icon now stops shrinking at 76 px. Its view icon, unlink icon and "×" all fit side by side, so clicking unlink only unlinks. Nothing else changes:
- plain tabs still shrink to 40 px;
- linked note tabs still stop at 56 px;
- no other tab is wider in a crowded strip.

**What changed:**
- **`styles/tabs.css`:** `.mod-root .workspace-tab-header.is-linked[data-icon] { min-width: max(var(--tab-min-width), 76px) }`.
- **Which tabs it covers:** `tabStrip.ts` already sets `data-icon` on every tab that shows a view icon: graph, local graph, canvas, Bases, drawing, image and backlinks. So this one rule covers them all.
- **Why 76:** the measured overlap was 17 px, so the targets touch at 73 px. 76 gives the same 2 px gap as a linked note tab.
- **I rejected collapsing the view icon at the minimum width.** CSS can't tell from inside a tab that it's at its minimum. Doing it in JS would mean measuring tabs on every resize, which is more code for the same result.

**Test (`scripts/test-tabs.mjs`):**
- **Setup:** the minimum-width section now runs for three linked, inactive, hovered tabs:
  - a note tab;
  - a Graph tab;
  - a Canvas tab, opened from a `T1 linked.canvas` file the test creates in the mock's in-memory vault.

  The strip is first squeezed to the minimum; a plain tab measuring exactly 40 px confirms it.
- **Checks on each tab:**
  - the unlink icon is clear of the close button;
  - the unlink icon is what's under the pointer at its centre;
  - clicking it unlinks the tab and keeps it open;
  - the active note, focus and caret stay as they were.
- **Cleanup:** afterwards the view tabs are closed, so the rest of the script sees the same tabs as before.
- **Against the old CSS (`ea7b718`):** the note tab passed, and Graph and Canvas both failed with `{"width":56,"gap":-17,"hit":false}`; their unlink click closed the tab. With the fix: note 56 px, gap 2; Graph and Canvas 76 px, gap 2; all clicks unlink.

**Line counts against `ea7b718`:**
- **App code:** CSS +5/−1 in `tabs.css`.
- **Tests:** `test-tabs.mjs` +30/−15.
- **T1 app code since `6c2a0af`:** net +33.
- No new dependency and no Rust.

**Results:**
- **`test-header.mjs`, `test-r27e.mjs` and `test-tabs.mjs`, run on their own:** passed.
- **`flock /tmp/grove-npm-test.lock npm test` (with `posttest`):**
  - **First run: exit 1, again on the unrelated drawing timing check.** `src/drawing/scene.test.ts` measured a 20.9 ms median parse against its 20 ms limit, under suite load. Vitest stopping there means the later scripts and `posttest` didn't run.
  - **Second run, same tree: exit 0.** Vitest 99 files, 1,545 tests, and every browser script passed.
  - That check has now missed under load in three of this T1's full runs. It may need a looser margin or a quieter slot, in its own piece; it isn't changed here.
- **`npm run build`** and **`npm run audit:offline`:** passed.
- **Screenshots** the suite rewrote were restored before committing.

## Re-review fix: linked tabs at the minimum width (after `60ac3ae`)

Codex's re-review of `e33299e` passed it with one fix required. A linked tab could still shrink to the strip's 40 px minimum, in a crowded strip or a narrow split. At that width the unlink icon and the close button overlap by 13 px, with the icon's centre under the "×", so aiming at unlink could close the tab.

**In plain words:** a linked tab now stops shrinking at 56 px instead of 40. Its unlink icon and "×" stay side by side, so clicking unlink only ever unlinks. Other tabs still shrink to 40 px, and nothing else about the look changes.

**What changed:**
- **`styles/tabs.css`:** `.mod-root .workspace-tab-header.is-linked { min-width: max(var(--tab-min-width), 56px) }`.
- **Why 56:** both buttons are 18 px. At 40 px they overlapped by 13 px, so they touch at about 53 px; at 56 the test measures 2 px between them (rounded). It still follows the theme token if that is ever larger.
- **I rejected hiding one control at tiny widths.** Either button hiding would still put the other where the user aims; reserving the room is simpler and never closes the tab by mistake.

**Test (`scripts/test-tabs.mjs`):**
- **Setup:** the strip's preferred tab width is set to 0, so every tab shrinks to its minimum. A plain tab must then measure exactly `--tab-min-width` (40 px), which proves the strip really is at the minimum.
- **Checks on the hovered, inactive linked tab:**
  - its unlink icon is clear of the close button;
  - the unlink icon is what's under the pointer at its centre;
  - clicking it unlinks the tab and keeps it open;
  - the active note, focus and caret stay as they were.
- **Against the old CSS:** it failed with `{"width":40,"plain":40,"min":40,"gap":-13,"hit":false}`, and the click closed the tab. It passes with the fix.

**Line counts against `60ac3ae`:**
- **App code:** CSS +5/−0 in `tabs.css`.
- **Tests:** `test-tabs.mjs` +23/−1.
- **T1 app code since `6c2a0af`:** net +29.
- No new dependency and no Rust.

**Results:**
- **`flock /tmp/grove-npm-test.lock npm test` (with `posttest`):** exit 0. Vitest 99 files, 1,545 tests, and every browser script passed.
- **`test-header.mjs`, `test-friction.mjs` and `test-r27e.mjs`, run on their own:** passed.
- **`npm run build`** and **`npm run audit:offline`:** passed.
- **Screenshots** the suite rewrote were restored before committing.

## Audit: what each item did before

Measured in headless Chromium at 1280×1000, `?synthetic=5000`, five tabs open with the 5,000-line note active and the caret at line 2,000.

| Item | Before | Verdict | After |
|---|---|---|---|
| Tab size | 166×34 px; the inactive hover highlight filled the tab (29 px tall) | Heavier than the spec's ~28 px tabs | 166×28 px; the hover highlight is 21 px tall |
| Even widths | All tabs the same width (166 px for 5; 83 px each for 10), shrinking evenly | Works | Unchanged (92 px each for 9 in the test) |
| Titles | Ellipsis on one line; but an inactive tab kept 25 px for its hidden close button, so with 10 tabs titles cut to 4 letters ("Welc…") | Truncated early | The close button overlays the end; inactive titles use the full tab, and the active and pinned tabs keep 22 px clear for their button |
| Close button | Hidden on inactive tabs, shown on hover and on the active tab; 20 px round hover | Works; slightly large | 18 px, `--radius-s` corners, same behaviour |
| New-tab "+" hover | 24×39 px highlight from the window top to the tab bottom | The "big box" Chris saw | 30×26 px, the same as the tab-list button, centred on the tabs |
| Middle-click | Closes on press; the press's default is cancelled; focus and caret stay | Works | Unchanged, now asserted |
| Click the "×" of another tab | Closes it, but focus fell to `body` | Focus loss | Focus and caret stay in the note |
| Click the active tab | Focus fell to `body` | Focus loss | Focus stays in the note |
| Click another tab | Switches in 12–13 ms, focus in its editor | Works | Unchanged |
| Close the active tab (× or middle-click) | The next note painted in 10–19 ms, focus in it at its caret | Works | Unchanged |
| Drag to reorder | p95 frame 17 ms, no long task, no editor remount, order kept, ghost and marker cleaned up | Works | Unchanged |
| A plain click | Never starts a drag (also covered by `test-header.mjs`) | Works | Unchanged, plus a 2 px-wobble check |
| Drop outside any pane | Order unchanged, nothing left behind, but focus fell to `body` | Focus loss | Focus and caret stay in the note |
| Ctrl+T / Ctrl+W / Ctrl+Tab / Ctrl+Shift+T / pin | Work | Works | Unchanged, asserted |
| Theme colours | The strip uses `--background-secondary`, the active tab `--background-primary`, in light and dark | Works | Unchanged, asserted in both |

**Cause of the focus losses:** a tab header isn't a focus target. Pressing one, or its close button, therefore blurred the editor, and only a switch to another tab focused an editor again. The middle press already cancelled its default, which is why middle-click kept focus.

## What changed

- **`styles/tabs.css`:**
  - tab height 28 px, with the corner radii taken from the theme's `--radius-m` and `--radius-s`;
  - the close button is absolutely placed over the title's end, and the title is masked under it while an inactive tab is hovered;
  - the active and pinned tabs keep room for their button;
  - the new-tab button is a plain icon button like the tab list. The special full-height rules (`align-self: stretch`, `height: 100%`, its padding) are deleted.
- **`shell/tabStrip.ts`:** a left or middle press on a tab, and any press on its close button, cancels the mousedown default, so focus stays in the note.
- **`shell/tabDrag.ts`:** a click on a tab (no drag) focuses that tab's editor if focus isn't already there. This covers clicking the tab you're on when focus was elsewhere, such as in the file tree.

**Before and after for tab actions**, at 5k, input to the note painted (budget ≤ 50 ms, no long task):

| Action | Before | After |
|---|---|---|
| Close a background tab (×) | 10 ms | 10 ms |
| Middle-close a background tab | 10 ms | 10 ms |
| Click the active tab | 10 ms | 10 ms |
| Click another tab / click back | 13 / 19 ms | 12–13 / 17–19 ms |
| Middle-close the active tab | 11 ms | 10 ms |
| Close the active tab (×) | 19 ms | 18 ms |
| Drag to reorder (20 pointer moves) | p95 frame 17 ms, no long task | p95 frame 17 ms, no long task |

The speed was already fine. What changed is the look, and where focus lands.

## Tests

- **New: `scripts/test-tabs.mjs`**, in `npm test` after the friction script. It runs at 5k, takes `GROVE_FEEL_N`, and with `GROVE_FRICTION_REPORT=1` prints every sample and asserts nothing.
  - **Look:** every tab 24–30 px tall and the same width; titles clip with an ellipsis on one line; an inactive title spans the tab; the active title stops before its close button. The strip and active tab colours equal the theme variables, in light and dark.
  - **Hover:** an inactive tab shows its close button. The close button's hover is a small rounded highlight (≤ 22 px). The new-tab hover is the tab-list button's size, shorter than the strip by at least 10 px and level with the tabs. No box of the strip, any tab, any title, the "+" button or the note moves by a pixel on either hover.
  - **Close, middle-close, click:** each one paints the next note within 50 ms, with no long task, no flash and no editor remount.
    - Focus and caret must be unchanged after a background close, a background middle-close, a click on the active tab, and clicking away and back.
    - After closing the active tab, focus must land in the next note.
    - The middle press must cancel its default and must not change the note's text.
  - **Drag:**
    - The first tab dragged past the third lands there and stays there.
    - Frames stay within p95 ≤ 17 ms, with no long task, no editor remount and no flash, and focus and caret are kept.
    - Nothing is left behind (ghost, marker, grabbing cursor).
    - A click with a 2 px wobble switches tabs and never reorders.
    - A drop outside any pane changes nothing and keeps focus.
  - **Keyboard and pin:** Ctrl+T adds a tab at the end; Ctrl+W closes it with focus in a note; Ctrl+Tab moves on with focus; Ctrl+Shift+T reopens a closed tab in its place; a pinned tab shows its pin with the title clear of it.
  - **Many tabs:** they shrink evenly and leave "+" in place.
- **Checked against the old code.** With `tabs.css`, `tabStrip.ts` and `tabDrag.ts` put back to `6c2a0af`, the script fails on exactly the fixed items and nothing else:
  - the tab height (34 px);
  - the title room (25 px short);
  - the new-tab hover (24×39);
  - focus lost after closing a background tab, after clicking the active tab, and after a drop outside.

  Each step refocuses the note first, so one step's focus loss can't fail the next.
- **`scripts/test-header.mjs`:** its tab-height value changed from 34 to 28. It's the same exact-value check on the new design, not a looser one.
- **The F1 harness moved, unchanged, into `scripts/frictionHarness.mjs`,** so both browser tests share it. That includes the in-page frame loop and observers, `measure`, and opening the synthetic vault. `test-friction.mjs` is otherwise unchanged and still asserts everything it did.
- **P0 `test-feel.mjs` and F1 `test-friction.mjs` budgets:** unchanged and passing. No assertion was weakened.

**Full runs on the final tree:** see "Results" below.

## Only reasoned about, without a real window

- **WebView2 (Windows):**
  - Middle-click autoscroll is on by default there, and is off in headless Linux Chromium, so it couldn't be seen. The middle press cancels both `pointerdown` (which also stops the compatibility `mousedown` being dispatched) and `mousedown`, the two places a page can stop it in Chromium.
  - Focus kept by cancelling `mousedown` is standard in every engine.
- **WebKitGTK (Linux):**
  - **Middle-click paste:** it pastes the primary selection into an editable element under the pointer on release. The tab header and strip aren't editable, and the header is already closing (no pointer events) by then. So there's nowhere for a paste to land.
  - **New CSS:** the title mask uses `mask-image` with the `-webkit-` prefix too. The close button is centred with the `translate` property, which needs WebKitGTK 2.32 or later (Safari 14.1).
- **Frameless window:** tab headers and buttons stay `no-drag`. The strip above the slimmer tabs is 6 px taller than before, and it's window-drag area, as the strip's empty space already was.

## Seen, not changed (out of scope or not friction)

- **Ctrl+T leaves focus on the page.** The new tab is empty, with no editor to focus. Recorded only.
- ~~**Ctrl+W right after Ctrl+T** lands on the tab next to the closed one.~~ Fixed in the review round below.
- **One reorder can move several header elements.** Moving a tab two places moves the headers it passes (three DOM moves for one reorder). They're the same elements, not remounts, and nothing flickers (checked frame by frame). Recorded only.
- ~~**Inactive linked tabs:** the hover "×" covers the link icon.~~ Fixed in the review round below.

## Line counts (against `6c2a0af`)

| File | Added | Removed |
|---|---:|---:|
| `app/src/styles/tabs.css` | 30 | 16 |
| **CSS** | **30** | **16** |
| `app/src/shell/tabStrip.ts` | 8 | 3 |
| `app/src/shell/tabDrag.ts` | 4 | 1 |
| **TypeScript, app code** | **12** | **4** |
| `app/scripts/test-tabs.mjs` (new) | 185 | 0 |
| `app/scripts/frictionHarness.mjs` (new, moved from `test-friction.mjs`) | 134 | 0 |
| `app/scripts/test-friction.mjs` | 3 | 125 |
| `app/scripts/test-header.mjs` | 2 | 2 |
| `app/package.json` (the new test in `npm test`) | 1 | 1 |
| `NOTES_T1-claude.md` | this file | |

- **App code net:** +22 lines (CSS +14, TS +8), far under the +300 limit.
- **No new dependency.** No Rust.
- **Files near 800 lines:** none touched. `shell/pane.ts` (770) and `workspace.ts` (701) weren't changed. `tabStrip.ts` is 163 lines, `tabDrag.ts` 192 and `tabs.css` 224.
- **Dead code:** the new-tab button's full-height rules are deleted. Nothing else became unused.

## Results

- **`flock /tmp/grove-npm-test.lock npm test` (with `posttest`):**
  - **First run: exit 1, on one unrelated timing check.** `src/drawing/scene.test.ts` "parses a 5,000-element drawing in under 20 ms" measured 20.66 ms under full-suite load. Nothing in this change touches drawings. It passed alone three times in a row.
  - **Second run, same tree: exit 0.** Vitest 99 files, 1,545 tests.
    - P0 `test-feel.mjs` at 5k passed, with the graph reported as its known gap.
    - F1 `test-friction.mjs` passed. It printed the P6 gap (raw long tasks 86, 96 and 124 ms) and the one-time list-Enter parse (43 ms).
    - The new `test-tabs.mjs` passed.
  - That drawing check sits close to its 20 ms limit on this machine and can miss under load. It's recorded here, not changed.
- **`npm run build`:** passed. The existing Vite large-chunk warning remains.
- **`npm run audit:offline`:** passed. 220 source files, dist, CSP, capabilities and dependencies checked.
- **`cargo test`:** not run, because no Rust changed.
- **Screenshots** the suite rewrote under `rebuild/round*-shots/` were restored before committing.

---

## Earlier piece also named T1 (Claude): merge a template's properties on insert

An unrelated piece from 4 Nov 2026 (commit `872bee5`), kept here unchanged; only its headings moved down one level.

Piece T1 of `CINDER_GAP_PLAN.md`. Built 2026-11-04 on `rebuild/t1-claude`, from `rebuild/integration` at `b5d0a34`. Local commit only; nothing pushed. No new packages or crates, no network, no Obsidian or Excalidraw code or assets, no GUI windows. Chris's choices: only the core Obsidian-style templates. No Templater `<% %>`, no folder templates, no weekly or monthly notes. None of those are touched here.

### What changed

*Templates: Insert template* no longer drops a second `---` block in the middle of the note. The template's properties are merged into the note's own, and only the body goes in at the cursor.

- `app/src/editor/templateMerge.ts`: +179, new. `mergeTemplate(noteText, templateText, selection?)` is pure, with no DOM or editor state. It returns `{ changes, text, cursor, skipped }`. `changes` are in the note's own offsets and in order, so one transaction applies them all.
- `app/src/appCommands.ts`: +6 / −2. `insertTemplate` fills the variables (`fillTemplate`, unchanged), calls `mergeTemplate` with the doc and the main selection, and dispatches one transaction (`userEvent: "input.template"`). If `skipped` is set, a notice says the properties weren't added.
- `app/src/editor/propertyEdit.ts`: +2 / −2. Exports `lineAt` and `Line` so the merge reads lines and line endings the same way `editProperty` does.
- `app/src/editor/templateMerge.test.ts`: +179, new. 19 Vitest cases.
- `app/scripts/test-template-merge.mjs`: +108, new. A browser check in the `test-paste.mjs` style. Added to `npm test` right after `test-paste.mjs`.

### Rules, as built

- **The note's existing keys win.** A template key the note already has, in any case (`Status` vs `status`), leaves the note's value alone. This holds even when the note's value is empty.
- **List values are unioned.** When both sides hold a list (`tags`, `aliases`, `cssclasses` or any list), the template's new items go after the note's own, without duplicates. Tags match without a leading `#` and in any case, as Obsidian tags do; other lists match exactly. A plain `tags: Work` counts as a list. If one side is a list and the other is not, the note wins. The rewrite goes through `editProperty`, so it keeps the note's list style (`[a, b]` or `- a` lines), its indent and its line endings, and it is validated the same way Kanban writes are.
- **New keys** are copied as written in the template, multi-line values included (a nested map, a `|` block), at the end of the note's frontmatter. Template comments and blank lines are not copied into an existing block.
- **A note with no frontmatter** gets the template's whole block on top, comments included, after a BOM if there is one.
- **The body** replaces the selection, the same as before. A caret inside the note's frontmatter, or before its BOM, puts the body right after the frontmatter. If the note ends on its closing `---` with no newline, a newline goes in first. An empty body leaves the selection alone instead of deleting it.
- **CRLF and BOM.** Everything inserted uses the note's line ending (CRLF or LF), whatever the template uses. The note's BOM stays first; the template's BOM is dropped. Editor documents are LF (CodeMirror normalises them), so CRLF mostly matters for T2's create-from-template, which will pass file text in.
- **Empty template** (`""`, BOM only, or `---\n---\n`): no changes.
- **Safety.** If the note's frontmatter can't be edited line by line, nothing in it is rewritten and only the body goes in, with a notice. That covers duplicate keys, a `---` that never closes, and a block over 2000 lines, the same limits as `frontmatter.ts`. After a merge, the frontmatter is read back: every expected key must have its expected value and the body must be byte-identical, or the merge is dropped the same way. A template whose `---` never closes has no frontmatter (Obsidian's reading), so all of it is body. A template block Grove can't read still goes on top of a note without frontmatter, as written.
- **One undo step.** The frontmatter edit is one minimal change between the fences, and it never splits a surrogate pair. The body is a second change, and both go in one dispatch. `input.template` is not a joinable history event, so typing just before the insert stays a separate undo step. The browser check covers that.

### Tests

- `npx vitest run src/editor/templateMerge.test.ts`: 19 passed. Each case also applies `changes` to the string, and for LF notes through a real CodeMirror `EditorState`, then checks that the result equals `text`. Cases: no frontmatter (caret mid-note, empty note), both sides with frontmatter, case-insensitive keys, list union (block, flow, `#Tag`, plain tags, empty list, a list vs a non-list, nothing new), CRLF (note CRLF / template LF, and the reverse), BOM (note and template, caret before the BOM), empty template (four forms, with a selection), a template without frontmatter over a selection, a caret inside the frontmatter, a note ending on its fence, unknown-type values, comments, unsafe frontmatter on either side, emoji, and a 3.6 MB note.
- `node scripts/test-template-merge.mjs`: 15 checks, all with native keys: Ctrl+P → "Insert template" → Enter → "Meeting" → Enter. In Source and in Live Preview, on a note with frontmatter: one block, `status` kept, tags unioned, `created` added with `{{date}}` filled, the body at the caret, the caret after it, the Properties block showing the new key (Live), one Ctrl+Z back to the exact original, one Ctrl+Shift+Z forward again. On a note without frontmatter: the block on top, and one Ctrl+Z that keeps text typed just before. A template without frontmatter still replaces the selection. The merged note is saved to disk as shown. No console errors.
- `npm run build`: passed.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest **1301 passed** across 81 files. All browser scripts passed, including `test-paste.mjs` and the new `test-template-merge.mjs`. `posttest` passed. No rerun was needed.
- `npm run audit:offline`: passed (192 source files, dist/, CSP, capabilities, dependencies).
- `cargo test --offline`: **84 passed**, 0 failed, 4 ignored. No Rust changed.
- The screenshots and canvas/Base outputs under `rebuild/round*-shots/` that the test run rewrote were restored. They are not in the commit.

### Bench

`node scripts/bench-frontend.mjs` (5,000-note synthetic vault, medians of three runs). This piece doesn't touch these paths. The numbers show no regression; the gaps are run-to-run noise.

| | before | after (run 1) | after (run 2) |
|---|---|---|---|
| vault tags | 11.1 ms | 10.8 ms | 11.1 ms |
| search | 13.2 ms | 13.3 ms | 15.6 ms |
| search page 5k | 5.3 ms | 5.2 ms | 5.3 ms |
| link refresh | 41.9 ms | 41.3 ms | 47.2 ms |

`mergeTemplate` on its own: a 40-property note plus a 4-property template, 25 runs, caret mid-note. 3.8 KB note: median 0.24 ms. 320 KB: 0.33 ms. 6.4 MB: 3.7 ms. The cost of a huge note is the one `doc.toString()` and the string build. The frontmatter work doesn't grow with the body. The script was a scratch file run through Vite's SSR loader, the same way `bench-properties.mjs` loads modules, and it isn't committed.

### Decisions and left open

- The function is TS, as the plan says. It is pure text work on the open editor's document, and a Rust round trip would add IPC for no gain.
- `mergeTemplate` takes an optional third argument, the selection, which defaults to the end of the note. The plan's two-argument call still works.
- I didn't find the exact Obsidian rule for a template list against a note scalar under the same key. Grove keeps the note's value, which follows "the note's existing keys win". No Obsidian code or docs were fetched.
- T2 (*Create new note from template*) can call `mergeTemplate("", filled, { from: 0, to: 0 })`. On disk text it keeps CRLF.
