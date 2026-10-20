# Motion pass: notes

> Round 3 changed two things described below: the side docks now use their own `--anim-duration-sidebar` (130ms, ease-out both ways) with the note column held so it never re-wraps mid-move, and tabs grow and shrink with the Web Animations API at their settled width. See `LOCKDOWN_SIDEBAR_NOTES.md`.

Grove now has one small motion system: tokens in `app/src/styles/theme.css`, shared keyframes in `app/src/styles/motion.css`, and helpers in `app/src/motion.ts`. All animations below use them. Typing and note switching are as fast as before (numbers at the end).

Everything is local CSS and TypeScript. There are no new dependencies, fonts, CDN assets, telemetry or network requests. The verification run saw zero requests to anything other than the local dev server.

## Tokens

| Token | Value | Used for |
|---|---|---|
| `--anim-duration-fast` | 100ms | hover/active swaps, menu and suggester entrance, exits, note-switch fade |
| `--anim-duration-moderate` | 150ms | modal entrance, folder slide, chevron, tab grow/shrink, sidebar content fade-in |
| `--anim-duration-slow` | 250ms | sidebar width, smooth scrolling |
| `--anim-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | entrances, hover, scroll |
| `--anim-ease-in` | `cubic-bezier(0.3, 0, 1, 1)` | exits |
| `--anim-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | sidebar width, folder closing, caret blink |
| `--anim-offset` | 4px | slide distance for popovers and modals |
| `--anim-scale-from` | 0.98 | modal panel scale |
| `--anim-note-opacity-from` | 0.6 | note-switch fade start |

Exits are one step faster than entrances and use ease-in. Under `prefers-reduced-motion: reduce`, all three durations become `0ms`. The helpers read the same tokens, so the JS-driven motion (folder slide, smooth scroll) also becomes instant, and `animateOut` removes elements immediately.

## Helpers (`app/src/motion.ts`)

- `animateOut(el, cls = "is-closing")` adds the exit class, waits for the element's own `animationend` or `transitionend`, then removes it. A timeout (the longest computed duration + 50ms) is the fallback. With a 0ms duration it removes at once. Calling it again on an element that is already closing does nothing.
- `slideHeight(el, open, fromZero)` animates height and opacity with the Web Animations API, starting from wherever the element currently is. A re-toggle in the middle of an animation therefore reverses smoothly. It resolves `false` if a later slide interrupted it.
- `smoothScrollTo(el, target)` is a rAF scroll using the slow duration and the ease-out curve, read from the CSS token through a small cubic-bezier solver. A function target is re-read every frame. Wheel, pointer, key or touch input stops it.
- `duration()` / `easing()` read the tokens. They only run on clicks, never per keystroke.

## Section 2, item by item

| Item | What happens |
|---|---|
| Sidebar collapse/expand | `.mod-left-split` animates `width` (and its 1px border) over 250ms with ease-in-out. Its children keep their full 199px width and are clipped, so nothing inside re-wraps. They fade out in 100ms when collapsing, and fade in over 150ms after a 100ms delay when expanding. `visibility: hidden` applies once collapsed, so hidden controls can't take focus. The main pane is `flex: 1`, so the editor column re-centres frame by frame. This is the only animated layout property in the app. |
| File tree folders | Each open folder's rows now live in a `.tree-item-children` box. A toggle slides only that box: height plus opacity over 150ms, ease-out to open and ease-in-out to close. Rows are removed only once it is fully closed. The chevron rotates over 150ms. "Collapse all" slides the top-level folders shut. Auto-revealing the active note's folder on a note switch stays instant, to keep the switch path untouched. |
| Hover/active states | Background, colour and opacity transitions at 100ms on `.clickable-icon` (ribbon, sidebar tab icons, nav buttons, view actions, window buttons), tree rows, tab headers and their close buttons, menu items, search results, and the search input's focus ring. |
| Quick switcher (the only modal) | On open, the container (backdrop and panel) fades in over 150ms, and the panel settles from `translateY(-4px) scale(0.98)`. The input has focus on the first frame. On close, it fades out over 100ms with ease-in while the panel scales back to 0.98, then `animateOut` removes it. Clicks pass through while it closes, and a new Ctrl+O isn't blocked by a closing overlay. Choosing a note opens it immediately; the overlay fades on top for its last 100ms. |
| `[[` suggester, menus | The suggester tooltip and `.menu` (context menus, tab-list dropdown, the "More options" kebab) fade in and drop 4px into place over 100ms. They use translate only, never scale, so the size CodeMirror and `showMenu` measure for placement is unaffected. Menus fade out on close. CodeMirror reuses the suggester element while you keep typing, so the entrance plays once per opening (checked: same element, no animation running after further keystrokes). |
| Tabs | Tab headers are now keyed by tab id and updated in place instead of being rebuilt on every change. A new tab grows from 0 to its content width over 150ms. A closed tab pins its current width, shrinks to 0 and fades over 150ms, then is removed. Other tabs keep their order around it. The active tab's lighter background and border fade over 100ms. All inactive tabs now carry a transparent 1px border, so the active border fades in rather than appearing (this also removes a 1px text shift on activation). |
| Note switching | The workspace emits a new `"show"` change when it swaps the displayed note. The pane then restarts a 100ms ease-out opacity animation from 0.6 to 1 on `.markdown-sizer`. It alternates between two identical keyframe names, so the restart forces no style flush. The text is painted on the first frame (measured opacity 0.60 on frame 1, 1.00 by about 100ms). Renames don't trigger it. |
| Caret | CodeMirror restarts its blink by alternating the `cm-blink` / `cm-blink2` keyframes. Both are redefined in `editor.css`, which loads after CodeMirror's injected styles and so takes precedence. The caret is fully visible for 40% of the 1.2s cycle, fades out over about 120ms with ease-in-out, and fades back in. Each selection change restarts the cycle, so it never dims while typing. Under reduced motion it falls back to the hard `steps(1)` blink. |
| Smooth scrolling | Programmatic jumps within the note on screen (search-result line hits, and now `[[#Heading]]` / `[[Note#Heading]]` links) glide over 250ms with ease-out. A jump longer than two screens first cuts to one screen short of the target, waits two frames for CodeMirror to measure, then glides the last screen, so the editor never renders the whole 5,000-line span. The target is re-aimed every frame, so there's no snap when CodeMirror refines line heights. A jump into a note that was just opened lands instantly, so its first frame already shows the target. Under reduced motion it uses CodeMirror's own `scrollIntoView`. |
| Selection highlight | Nothing in the editor content has a transition or animation, so selection changes, Live Preview marker reveals and link restyling can't flicker or lag. The selection is still drawn by CodeMirror's layer as before. |

Small extra: switching sidebar views (Files / Search / Bookmarks) fades the new view in over 100ms.

## Skipped or not applicable, and why

- **`[[` suggester exit.** CodeMirror removes the tooltip as soon as completion closes. Animating it out would mean taking over CodeMirror's tooltip lifecycle. Obsidian's Esc-dismiss is instant anyway.
- **Quick switcher selected row and result-list resizing.** These are left instant. Both are driven by arrow keys and typing, and the task says nothing may animate on a keystroke.
- **Caret movement.** Not animated, for the same reason: it moves on every keystroke. Only the blink is eased.
- **Command palette, right sidebar, other modals, splits.** They don't exist in Grove yet, so they are not applicable. The modal and menu CSS (`.modal-container`, `.prompt`, `.menu`, `is-closing` with `animateOut`) is generic and will apply to them.
- **Auto-revealing a folder on note switch.** Left instant on purpose, to keep the switch path untouched.

## Changes beyond pure styling

- **Heading navigation in `Workspace.openLink`.** It now handles `Note#Heading` and `#Heading`, scanning heading lines for a case-insensitive match. Before this, heading links did nothing (`[[#Heading]]`) or opened the note at its old scroll position. Without it there would be no in-note link jump to smooth-scroll. Block refs (`#^id`) are still ignored.
- **`"show"` in `Change`.** A new change kind, emitted by `Workspace.show()` just before `"tabs"`. Existing listeners ignore it.
- **Keyed tab headers and nested tree rows.** These DOM changes were needed for the enter/exit animations. They also make a tab switch cheaper, since it now flips classes instead of rebuilding every header.

Nothing in `src-tauri` or `CONTRACT.md` changed.

## How performance was verified

The harness is a small dependency-free CDP driver, run outside the repo. It drives headless Chromium 154 at 1280×800 against the Vite dev server and its mock vault (5,000-line "Big note", about 330k chars). The untouched base commit `a40d953` was served from a scratch worktree, and both builds ran through the identical harness, alternating runs.

- **Typing:** 80 key presses at line 2,500 of Big note, timed from the keydown timestamp to the end of the next rendered frame (rAF, then a posted message). This includes up to one vsync of waiting.
- **Note switch:** `ws.open()` alternating between Welcome and Big note (both cached), timed to the end of the next rendered frame and also for the synchronous work.
- **Animations:** rAF frame gaps recorded across four runs of each animation with Big note open; frames over 20ms are counted. The recorder was sanity-checked by injecting 25ms of work per frame, which it reports as 33ms gaps.

Mean ms (p95 in brackets):

| | baseline 1× | motion 1× | baseline 4× CPU | motion 4× CPU |
|---|---|---|---|---|
| Typing, key to frame | 10.1 (17.5) | 9.3–10.2 (17.2) | 15.1–16.0 (21.4) | 15.1–16.6 (21.7) |
| Note switch, to painted frame | 15.6 (18) | 15.5–15.8 (18.3) | 23.5–23.8 (29) | 21.5–23.9 (27) |
| Note switch, sync work | 2.3 | 2.2 | 8.9 | 8.9 |

Typing stays at about 9–10ms. Note switching stays well under 50ms, even with the CPU throttled 4×.

Frame pacing: sidebar collapse/expand, folder open/close, quick switcher open/close and tab open/close all held 16.7ms frames, with 0 frames over 20ms out of about 110 per animation, at 1× and 4×. One run at 4× showed a single 20ms+ frame on the switcher. It did not recur in three further runs of each build, so I treat it as noise.

Narrow window (900px): the editor column is under 700px there, so the sidebar animation re-wraps Big note on every frame. It still recorded 0 frames over 20ms out of 162, at 1×, 4× and 6× CPU throttle.

Behaviour was checked by sampling computed styles each frame:
- The sidebar width eases 200 → 0 → 200.
- Folder height and opacity ease in, and a quick open-close-open lands open with a single children box.
- The switcher and menu are removed after their exits, and a note chosen in the switcher is shown within one frame while the overlay is still fading.
- Tab widths grow and shrink, and closing a middle tab keeps the order.
- Note opacity reads 0.60 on frame 1 with the text present.
- The caret keyframes and easing apply.
- The suggester entrance plays once per opening.
- Heading glides land the line centred, both near and far.
- Under emulated `prefers-reduced-motion: reduce`, every one of these lands in its final state on the first frame.

`npm run build` and `npm test` pass, and each commit type-checks and builds on its own.

## Caveats

- Everything was measured in Chromium, not in the Tauri WebKitGTK window. The techniques used are all supported in WebKit: CSS transitions and keyframes, `var()` inside keyframes, the Web Animations API and `getAnimations()`. Even so, a quick look inside `npm run tauri dev` is worth doing, especially the sidebar on a large monitor and the caret blink.
- The sidebar width animation re-lays out the main pane on each of its roughly 15 frames. That is the one deliberate exception to "opacity and transform only". It measured clean, but it is the first place to look if a slower machine shows a hitch.
