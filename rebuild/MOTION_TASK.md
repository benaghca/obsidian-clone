# Task: Motion pass for Grove (Obsidian-feel animations)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app`. Read `rebuild/OBSIDIAN_FEEL_SPEC.md` and `rebuild/CONTRACT.md` first.

## The problem
The owner says: "Obsidian just has way smoother animations whereas this app feels like everything happens literally instantly." Everything snaps. We want the calm, eased motion Obsidian has, without ever making typing or note switching feel slower.

## Goal
Add a small, consistent motion system and apply it across the UI so Grove feels as smooth as Obsidian.

## Requirements
1. **Motion tokens** in CSS custom properties (one place), e.g. `--anim-duration-fast` (~100ms), `--anim-duration-moderate` (~150-200ms), `--anim-duration-slow` (~250-300ms), and easing curves (a standard ease-out such as `cubic-bezier(0.2, 0, 0, 1)` plus an ease-in-out). Use them everywhere; no ad-hoc magic numbers.
2. **Apply motion to** (at minimum, where the element exists):
   - Sidebar collapse/expand: animate width/translate, content fades; the editor reflows smoothly, not in a jump.
   - File tree folders: expand/collapse children with height + opacity; chevron rotates.
   - Hover and active states on tree items, buttons, tabs, and ribbon icons: short background/color transitions (~100ms) instead of instant swaps.
   - Quick switcher (Ctrl+O) and any modal: backdrop fades in, panel fades + scales from ~0.98 / slides a few px; reverse on close (close must actually animate before removal).
   - `[[` link suggestion popup and any menus/context menus: fade + slight translate in.
   - Tabs: opening/closing a tab animates width/opacity; active tab indicator transitions.
   - Note switching: a very subtle content fade (<=120ms) is OK ONLY if it never delays showing the text; prefer showing immediately with a quick opacity ease from ~0.6 to 1, or skip it if it feels laggy.
   - Editor: smooth caret (CSS `caret` / CodeMirror cursor blink easing), smooth scrolling for programmatic jumps (heading/link navigation), selection highlight not flickering.
3. **Performance rules (hard):**
   - Animate only `opacity` and `transform` where possible; avoid layout-thrashing animations on hot paths. If width must animate (sidebar), keep it to that one element and verify it stays at 60fps.
   - Never animate anything on keystroke. Typing latency on the 5,000-line note must stay where it is (~9ms).
   - Note switching must still show content in under 50ms.
   - Respect `prefers-reduced-motion: reduce` (collapse durations to ~0).
4. **Keep scope**: front end only (`rebuild/app/src`, `index.html`, styles). Don't touch `src-tauri` or the contract.
5. Use small reusable helpers (e.g. an `animateOut(el)` that waits for `transitionend`/`animationend` with a timeout fallback before removing).

## Done when
- `npm run build` passes in `rebuild/app`.
- Every item in section 2 is either animated or explicitly noted as not applicable.
- Commit your work on the current branch with clear messages (several small commits are fine). Do NOT push, do NOT merge into other branches.
- Finish by writing `rebuild/MOTION_NOTES.md`: what you animated, durations/easings chosen, anything you skipped and why, and how you verified performance.
