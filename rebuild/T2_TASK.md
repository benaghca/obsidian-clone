# T2: Hide the close button when tabs are squeezed very narrow

Requested by Chris on 10 Nov 2026, 9:22 PM PT. After T1, Codex recommended this polish: at the narrowest width (40 px plain tabs) the active tab is mostly its "×", so a click on its middle closes it. **Chris approved this visible change.** It follows T1 (merged as `39ed539`; integration is ahead with later brief commits). Build this on `rebuild/t2-claude` from the current `rebuild/integration`. Claude builds; Codex reviews independently, read-only. Commit locally. Never push.

## In plain words

When the tab strip is crowded or a split is very narrow, plain note tabs shrink to 40 px. The active tab always shows its close "×", which at that width covers most of the tab. Clicking the middle of that tab — meaning to select it, or just clicking the tab you're already on — closes it instead.

Hide the close button when a tab is squeezed very narrow, so a click on the middle of the tab selects it (or keeps it selected) instead of closing it. Middle-click and Ctrl+W must still close tabs. At normal widths, nothing changes: the "×" still appears on hover, and is still always visible on the active tab.

The exact width at which the "×" hides is yours to choose, as long as it covers the 40 px case and does not hide the button at comfortable everyday widths.

## Scope (what Chris should see)

1. **Hide "×" on very narrow tabs.** When a tab is squeezed to a very narrow width, its close button is hidden (not just faded or covered). A left-click on the middle of that tab selects it if it is inactive, and does not close it if it is active.
2. **Keep close at normal widths.** Hover-to-show close on inactive tabs, and the always-visible close on the active tab, stay as they are today whenever tabs have enough width.
3. **Other ways to close still work.** Middle-click on the tab, and Ctrl+W, still close tabs at every width, including the narrowest.
4. **Keep T1 hit-target guarantees.** Linked, pinned, and Graph/Canvas view tabs must still keep unlink, view icon, pin, and close from overlapping at their minimum widths (plain 40 px, view-icon 53 px, linked note 56 px, linked view 76 px). Existing `test-tabs.mjs` checks for those must still pass.
5. **Nothing else visible changes.** Tab height, colours, hover on the new-tab button, drag-to-reorder, keyboard shortcuts, focus after tab actions, and theme variables stay as they are.

## Start from what exists

T1 already covers the tab strip (`src/shell/tabStrip.ts`, `src/styles/tabs.css`), middle-click close, and `scripts/test-tabs.mjs`. Claude's T1 notes (`rebuild/NOTES_T1-claude.md`) recorded this exact 40 px active-tab issue and left it alone because CSS alone cannot tell when a tab is at its minimum. A small class or measurement when the strip is squeezed is expected if CSS is not enough. Do not rewrite the tab strip.

## Tests

- Extend `scripts/test-tabs.mjs` with regressions at the narrowest widths (the existing squeezed-strip setup that forces `--tab-min-width`, 40 px for plain tabs):
  - On an active plain note tab at the narrowest width, the close button is not visible, and a left-click on the middle of the tab does not close it (the tab stays active).
  - On an inactive plain note tab at the narrowest width, a left-click on the middle of the tab selects it and does not close it.
  - At that same narrow width, middle-click still closes a tab, and Ctrl+W still closes the active tab.
  - At a normal, unsqueezed width, hover still shows the close button on an inactive tab, and the active tab still shows it.
  - Existing T1 min-width hit-target checks (linked note/Graph/Canvas unlink, view-icon select, pin) still pass.
- Each new check should fail before the change and pass after (check this). Do not weaken any existing assertion.

## Hard rules

- Work only under `rebuild/app/` TypeScript, CSS, scripts and tests, plus this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No Rust (`rebuild/app/src-tauri/`) unless essential; it should not be needed. If it is, explain why in the notes.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, icons or fetched pages.
- No network. `npm run audit:offline` must stay green.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser. Headless Chromium only.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline` must pass. `cargo test --offline` only if Rust changed.
- Restore any screenshots the suite rewrites before committing.
- Commit locally on `rebuild/t2-claude`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that hides the close button at very narrow widths and keeps T1 behaviour everywhere else. Reuse `shell/tabStrip.ts` and `styles/tabs.css`; do not add a new module unless you must.
- Delete code and CSS your changes make dead.
- Keep every file under ~800 lines.
- App code (TS + CSS) should stay very small; explain anything more than about +50 lines. Test additions are extra but keep them focused.

## Scope limits

**In scope:** hiding the tab close button at very narrow widths, and tests for that plus the existing T1 close/middle-close/Ctrl+W and hit-target behaviour.

**Out of scope:** changing min widths as the way to "fix" this (do not simply make the active tab wider), new tab features, splits redesign, sidebar tabs, Rust, opening or measuring the real app window, any other visible change.

## Done when

- At the narrowest width, a left-click on the middle of a plain tab selects it or keeps it selected instead of closing it. Middle-click and Ctrl+W still close. Normal widths still show the close button as today. T1 hit-target guarantees still hold.
- Every new behaviour has a regression assertion in `scripts/test-tabs.mjs` that fails before and passes after.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_T2-claude.md` before you finish, and commit it with the code. Include:

- In plain words: what Chris will see when tabs are squeezed, and what is unchanged at normal widths.
- The threshold you chose and why, and how the strip detects a narrow tab (class, measurement, etc.).
- How each new test failed before and passed after.
- Confirmation that middle-click, Ctrl+W, hover-to-show at normal widths, and T1 linked/pinned/view-tab hit targets still work.
- Net line change by language and by file; any new dependency (should be none).
