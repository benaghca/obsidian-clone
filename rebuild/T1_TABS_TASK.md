# T1: Tabs that work and look like Obsidian's (slim, clean, snappy)

Requested by Chris on 10 Nov 2026: Grove's tabs don't work like Obsidian's and don't look as clean, and the new-tab button highlights as a big box when hovered. **He approved this visible change.** It follows F1 (friction hunt, merged as `4efeb60`) and comes before new features, per his 9 Nov priority: core features, speed, responsiveness and look/feel first. Build this on `rebuild/g1-claude` from the brief commit on `rebuild/integration`. Claude builds; Codex reviews independently, read-only. Commit locally. Never push.

## In plain words

Tabs are touched dozens of times a day. In Obsidian they are slim, quiet strips: the active one is clearly marked, a close "x" shows on hover (and on the active tab), a middle click closes a tab, you can drag tabs to reorder them smoothly, and the "+" new-tab button only gets a small, subtle hover. Grove's tabs should feel the same: clean, light, instant, never jumping around, and never stealing focus from the note you are typing in.

Chris has also been building Grove on his Windows work PC (WebView2), so nothing here may rely on WebKitGTK-only behaviour.

## Start by auditing what exists

Grove already has a tab strip (`src/shell/tabStrip.ts`, `src/styles/tabs.css`), tab drag code (`tabDrag.ts`), a middle-click close and a close-tab animation. Before changing anything, drive the tab strip in headless Chromium at `?synthetic=5000` and record, in the notes, what each item below does today, what it looks like (screenshots under `/tmp` only), and what is off compared with `rebuild/OBSIDIAN_FEEL_SPEC.md`. Fix what is broken or unclean; do not rewrite what already works.

## Scope (what Chris should see)

1. **Slim, clean tabs.** Lower, lighter tab headers with clean spacing, a clear active tab, quiet inactive tabs, titles that truncate neatly with an ellipsis, no heavy borders or boxes. Widths shrink evenly when many tabs are open; no jumping widths.
2. **Close button on hover.** The close "x" appears when hovering a tab, and is always visible on the active tab. Its hover is a small, subtle rounded highlight. Pinned tabs keep their pin behaviour.
3. **Middle-click closes a tab.** Reliably, with no auto-scroll cursor, no paste and no focus jump (check `auxclick` and `mousedown` button 1 on both Chromium and WebView2 semantics).
4. **Drag to reorder.** Smooth, with no flicker, no remount of the editor, no empty-state flash, and the dragged tab and its order kept after drop. Dropping outside the strip cancels cleanly. A plain click must never start a drag.
5. **Subtle new-tab button hover.** Replace the big highlighted box with a small, subtle hover (icon-sized rounded background or colour change), matching the other header icon buttons.
6. **Keep what works.** Existing keyboard shortcuts (Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+W, Ctrl+T/new tab, reopen closed tab if present, pin) and theme variables keep working; colours come from existing CSS variables so all themes stay correct (light and dark).
7. **Focus.** After closing, middle-closing, reordering or creating a tab, focus and caret land where a user expects (in the editor of the now-active note, at its remembered position), not on the tab strip or `body`.

## Tests

- Extend `scripts/test-friction.mjs` (and/or `scripts/test-header.mjs`, existing tab tests) with assertions for: hover shows the close button, active tab always shows it; click on close closes; middle-click closes with no focus loss; drag reorders and the order sticks (and a click does not reorder); new-tab hover is a small highlight (computed size close to the icon button, not the full strip height); focus kept in the editor after each tab action; no layout shift of the editor or strip during hover/close/drag (stable bounding boxes); no long task > 50 ms and frame gaps within budget during these actions.
- Each fix gets a regression assertion that fails before and passes after (check this).
- The existing P0 `test-feel.mjs` and F1 `test-friction.mjs` budgets stay enforced. Do not weaken any assertion.

## Budgets

- Tab click/switch ≤ 50 ms to the note painted; close and middle-close ≤ 50 ms to the next note painted.
- Hover effects with no layout shift (no width/height change of the strip or editor on hover).
- Drag: frame gaps p95 ≤ 17 ms, no long task > 50 ms, no editor remount.
- No main-thread block over 50 ms in any tab action.

## Hard rules

- Work only under `rebuild/app/` TypeScript, CSS, scripts and tests, plus this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No Rust (`rebuild/app/src-tauri/`) unless essential; it should not be needed. If it is, explain why in the notes.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, icons or fetched pages. Build the look from Grove's own CSS and icons.
- No network. `npm run audit:offline` must stay green.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser. Headless Chromium only.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline` must pass. `cargo test --offline` only if Rust changed.
- Restore any screenshots the suite rewrites before committing.
- Commit locally on `rebuild/g1-claude`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config.

## Size discipline

- The smallest change that gets the look and behaviour right. Reuse and extend `shell/tabStrip.ts`, `tabDrag.ts`, `styles/tabs.css`, `workspace.ts`, `shell/pane.ts` before writing new modules.
- Delete code and CSS your changes make dead (old box hover rules, unused classes).
- Keep every file under ~800 lines; `shell/pane.ts` is ~770 and `workspace.ts` ~700, so split by responsibility first if a change would push one over.
- App code (TS + CSS) net change should stay under about +300 lines; explain anything over that. Test additions are extra but keep them focused.

## Scope limits

**In scope:** the tab strip, tab headers, the new-tab button, tab close/middle-close/reorder/focus, their styles and tests.

**Out of scope:** new tab features (tab groups, stacked tabs, tab previews, per-tab history UI), splits redesign, sidebar tabs, P2–P8 perf pieces, Rust, changing P0/F1 budgets, opening or measuring the real app window.

## Done when

- The audit of current tab behaviour and look is in the notes, with before/after.
- Every scope item above works and has a regression assertion that fails before and passes after.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_T1-claude.md` before you finish, and commit it with the code. Include:

- In plain words: what Chris will see and feel differently in the tab strip.
- The audit (what was off before), what changed, and before/after numbers for tab actions.
- What you could only reason about without a real window (WebKitGTK on Linux, WebView2 on Windows), and what you ruled out.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
