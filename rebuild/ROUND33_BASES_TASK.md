# Task: Round 33 Part A, Bases: round 32B gaps and the Configure view page

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read this brief and your own `rebuild/ROUND32B_NOTES.md` first. All your round 30-32B Bases code is merged (`src/bases/*`, `styles/bases.css`, `scripts/test-bases*.mjs`). Reuse it: the serialized read/modify/write queue in `write.ts` stays the only Bases write path, and `showMenu` (`src/shell/menu.ts`) stays the only menu code.

**Your budget is very tight (5-hour limit about 21% left at 10:43 AM PT, resets 12:26 PM PT; weekly 25% left). Keep this small: items 1-3 first, in small commits; items 4-5 only if budget remains (otherwise list them as next improvements).** Work only in your worktree. Commit locally, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is fixing non-canvas, non-Bases bugs in parallel** (link suggestions, rename, delete dialog, file explorer, search, settings, editor) in another worktree. Keep new code in `src/bases/` and `src/styles/bases.css`. Touch shared files (`icons.ts`, `menu.ts`, `pane.ts`, `package.json`) only for the one or two lines you need (check `icons.ts` for an existing key first; duplicate keys break tsc), and say exactly what and why in your notes. `shell/pane.ts` is 744 lines: do not grow it.

Grove is now **36,229 lines** of TS/CSS/Rust (TS 28,180, CSS 4,735, Rust 3,314) after round 32 Part B and Grok 27s merged (integration a2520f5). Count lines as before: tracked files under `rebuild/app/src`, `src-tauri/src`, `vite.config.ts` and `src-tauri/build.rs`, excluding `/gen/`.

## Observed at the round 32 Part B merge (Obsidian 1.14.4, default light theme, 1280x800, `BaseTest/Task A..F` + `Multi.base` fixtures)
**Now matching (keep):** Results menu items (`Limit number of results` input with placeholder `e.g. 10`, `Show all (4)` with rotate-ccw, `Copy to clipboard`); limit 2 via Enter writes `limit: 2`, closes the menu and shows `2 results`; Show all removes `limit`; New row writes byte-identical frontmatter (`---\ntags:\n  - work\ndue:\npriority:\nstatus:\n---\n`) and selects `Untitled`; Add filter keeps the filter menu open with the incomplete row and anchors the 247x300 picker under the property button, muted ids, ✓ on the current choice, nothing written; Sort rows at 34px pitch with bordered comboboxes, chevrons-up-down, grips and icon-only trash; 6x30 resizer filled with the accent. All menus open on frame 1, no animation.

**Gaps found (items 1-2 below):**
1. **Copy notice.** Obsidian shows `Copied to your clipboard` at the **top right** (x 1095, y 32, 175x33), dark background (black at 90% opacity), white text, padding 8px 12px, radius 8px. Grove's `.bases-copy-notice` sits at the bottom right (183x42), light background, dark text, padding 12px 16px, radius 6px. Make it a small reusable notice (top right, stacked, no animation, auto-dismiss) in `src/bases/` or a tiny shared helper if you must, and note it.
2. **Results menu layout.** Obsidian: a `Limit number of results` label row (about 25px) at the top with the input below it (1px border), a separator after the input section, then `Show all` and `Copy to clipboard` with **no separator between them** (and `Export CSV`, still held). Grove puts a separator between Show all and Copy and draws a 2px input border.
3. **Sort menu.** Obsidian's `Sort by` header is a 32.9px row in the normal text colour (Grove muted, 16.9px); row icons are 16px (Grove 14px); the menu is about 271px wide (Grove 289); `file.name` uses the `text` icon (Grove `info`).
4. **Filter picker.** Obsidian highlights the current choice's row with the hover background (not only ✓); a second click on the same property button closes the picker (Grove keeps it open); the new row's operator for `file` is named `links to` (Grove `has link`); the `file` property icon is `file` (Grove `lines`); tag values show as a pill chip `work ×`.
5. **Resizer hover header tint.** Obsidian tints the header cell with a neutral grey (black at about 6.7%), Grove uses an accent tint. Keep the accent fill on the 6px resizer itself.
6. **Stale base tab (bug).** A base tab opened while its file did not exist (`No such file: Multi.base`), then the file is created: Grove shows the notice `Cannot read properties of null (reading 'select')`. Reopening works. The tab should load the new file (or show the same empty state without an error).

## Part A
1. **Gaps 1-2** (copy notice style/position, results menu label/separators/border).
2. **Gap 6** (stale base tab error) and **gap 4** (filter picker current-row highlight, repeat click closes, `links to` naming, `file` icon). Leave the tag chip for later unless it is a few lines.
3. **Configure view page.** In Obsidian, hovering the current view row in the view menu shows a `>` chevron button at its right; clicking it turns **the same menu** (221px wide) into a `Configure view` page: a header row with a back `<` chevron, the title `Configure view`, a `⋮` more button and a close `×`; a text input with the view name (focused, text selected); `Layout` with a select (`Table`; cards/list are held, show only Table or show them disabled); `Row height` with a select (`Short`, `Medium`, `Tall`, `Extra tall`). Re-observe it in Obsidian first (exact YAML key and values Obsidian writes for row height and for a rename, what `⋮` offers, what back/Escape do, and that Obsidian opens this page right after `Add view`). Renaming writes the view's `name:` byte for byte like Obsidian (the view menu and toolbar update at once); Row height writes Obsidian's key and changes the table row height. Use `showMenu` and the existing writer; no new dependency.
4. **`⋮` view options** from the Configure view page (Obsidian's items, likely duplicate/delete view) if they are a few lines each.
5. **Gaps 3 and 5** (Sort menu header/icons/width/`text` icon; neutral header tint).

**Held (do not start; list in your notes):** cards/list views, Group by, Search, Summaries, formulas and visible formula errors, Export CSV, header Summarize / Group by / Edit property / Property type, extra file facts in the Properties menu and picker, more expression/YAML coverage, embedding bases, non-Markdown rows, the New row popover (Grove's tab is fine), canvas items.

## Testing
**Real mouse input only:** CDP `Input.dispatchMouseEvent` (or Playwright `page.mouse`), hovering before pressing, including repeated clicks without moving. Never DOM `.click()` or synthetic events. Extend `scripts/test-bases-results.mjs`/`test-bases-menus.mjs` or add `scripts/test-bases-config.mjs` (append it to the END of the `npm test` chain in `package.json`, which now ends `... test-r27r.mjs && node scripts/test-bases-results.mjs && node scripts/test-r27s.mjs`; keep every existing entry; Grok will append `test-r27t.mjs` after `test-r27s.mjs` too, so keep your addition on its own line edit). Unit tests next to `write.test.ts` for the rename and row-height writers. Check:
- copy notice position/colours; results menu separators and label row;
- the stale-tab case loads without an error notice;
- filter picker repeat click closes; current row highlighted;
- Configure view: chevron on hover, page opens in the same menu, rename writes `name:` and updates the toolbar, row height writes Obsidian's key and changes row height, back returns to the view list, Escape closes;
- all Bases menus open on frame 1, no animation, no frame over 20 ms in the first 300 ms.
Open Grove-written files in Obsidian (scratch vault, private HOME, loopback-only) and confirm the same result. Put side-by-side screenshots in `rebuild/round33-shots/`. Re-run the editor checks on notes with frontmatter and H1-H3 in Live Preview, Source and Reading with real hover and clicks (including repeated clicks without moving), and keep `npm run test:geometry` passing. Write `rebuild/ROUND33_NOTES.md` with what you observed and each commit, every shared file touched and why, line counts and the **net line change by language** (production TS, test TS, CSS, Rust, mjs), what is held, and up to 3 next improvements (why each matters, roughly how big).

## Guardrails
- Smallest change that works; reuse existing code (writer queue, `showMenu`, icons, header/cell code, existing clipboard and note creation). Delete dead code you replace. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- **Geometry.** Never space lines or widgets inside `.cm-content` with vertical margins (use padding). Every direct child of `.cm-content` keeps zero vertical margin, and every rendered line's CodeMirror top stays within 1px of its DOM top. Fold arrows stay visible after stationary fold and unfold clicks.
- **No animations** on prompts, menus, popovers, tooltips, notices, drop indicators or resize lines.
- **File compatibility.** `.base` and `.md` files stay Obsidian's formats and open in Obsidian with the same result. Every byte outside the edited block is preserved; edited blocks use Obsidian's canonical style. Match Obsidian from observation only.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics, no remote fonts/scripts/styles/images. Strict CSP unchanged. `npm run audit:offline` must pass.
- **No downloadable plugins.** Bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Tauri only on a private Xvfb display with scratch `HOME`/`XDG_*`.
- Commit locally only. Do NOT push and do NOT merge. Do not touch other worktrees.

## Done when
- In `rebuild/app`, `npm run build`, `npm test`, `npm run test:geometry` and `npm run audit:offline` pass; in `src-tauri`, `cargo build` and `cargo test` pass. `npm test` rewrites screenshot and canvas fixtures: restore the ones you did not mean to change with `git checkout` before committing.
- Items 1-3 work as above (4-5 if budget allowed), and `rebuild/ROUND33_NOTES.md` is committed.
