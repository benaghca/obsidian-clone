# Task: Round 32 Part B, Bases: results menu, New row, and the Part A gaps

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/ROUND32_BASES_TASK.md` (Part B section) and your own `rebuild/ROUND32_NOTES.md` first. All your round 30-32A Bases code is merged (`src/bases/*`, `styles/bases.css`, `scripts/test-bases*.mjs`). Reuse it: the serialized read/modify/write queue in `write.ts` stays the only Bases write path, and `showMenu` (`src/shell/menu.ts`) stays the only menu code.

**Your 5-hour budget is tight. Keep this small: items 1-3 first, in small commits; items 4-5 only if budget remains (otherwise list them as next improvements).** Work only in your worktree. Commit locally, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is fixing non-canvas, non-Bases bugs in parallel** (file explorer, search pane, link suggestions, dialogs, settings, editor) in another worktree. Keep new code in `src/bases/` and `src/styles/bases.css`. Touch shared files (`icons.ts`, `menu.ts`, `pane.ts`, `package.json`) only for the one or two lines you need (check `icons.ts` for an existing key first; duplicate keys break tsc), and say exactly what and why in your notes. `shell/pane.ts` is ~741 lines: do not grow it.

Grove is now **35,995 lines** of TS/CSS/Rust (TS 28,008, CSS 4,673, Rust 3,314) after round 32 Part A and Grok 27r merged (integration a56a9b8). Count lines as before: tracked files under `rebuild/app/src`, `src-tauri/src`, `vite.config.ts` and `src-tauri/build.rs`, excluding `/gen/`.

## Observed at the round 32 Part A merge (Obsidian 1.14.4, default light theme, 1280x800, `BaseTest/Task A..F` + `Multi.base` fixtures)
**Now matching (keep):** 6x30 `col-resize` resizers at the header edges; +60px drag writes `columnSize:` / `note.due: 188` (Obsidian +60 the same); shrinking clamps to 40px (Grove writes 40; Obsidian writes a negative number, its bug); header drag of `status` onto the left half of `Due date` writes `order: file.name, status, due, priority` in both; 16x16 `grab` sort grips, dragging row 1 below row 2 rewrites `sort` to `file.name DESC, due ASC` with the menu kept open; `Old to new` / `Z → A` labels; header menus with the ✓ and the red `Clear sort`; an incomplete Add filter writes nothing; Add view names `View`; view menu 225px; Properties `Add formula` normal colour; new-base title rename. Menus open on frame 1 with no animation.

**Gaps found (fix these, items 3-4 below):**
1. **Add filter property picker placement (bug).** In Grove, `Add filter` opens the property picker at the top-left of the window (x=8, y=8, 253x402) and the filter menu closes. In Obsidian the filter menu stays open with the new incomplete row (`file` / `links to` / `Empty`) and the picker (a 247x300 list with a `Search...` field) is anchored right under that row's property button (Obsidian: x=841 y=333 under a row at y~313). The picker rows show the display name on the left and the property id muted on the right (`file name   file.name`, `created time   file.ctime`), with ✓ on the current choice. Keep the filter menu open, anchor the picker under the row's property button, add the muted id column.
2. **Sort menu rows.** Obsidian's Sort menu: a `Sort by` header (unindented, muted), then per row: grip, a bordered combobox button for the property (icon + name + up/down chevrons) and a bordered combobox for the direction (`Old to new` + chevrons), then a trash icon only (no "Remove sort" text). Row pitch 34px (Grove 37). A separator above `+ Add sort`. Grove shows plain text buttons and a visible `Remove sort` label. Match the bordered comboboxes, icon-only trash, pitch and separator.
3. **Resizer hover.** Obsidian fills the whole 6px resizer with the accent colour on hover and also tints the header cell being resized; Grove draws a 2px line. Match (Grove's accent token, no animation).
4. **Double-click reset leftover:** Obsidian leaves `columnSize: {}` when the last key is removed; Grove removes the key entirely. Both open fine; keep Grove's behaviour (no change), just note it.

## Part B
1. **Results menu** (click `N results`): `Limit number of results` number input (placeholder `e.g. 10`, shows the current limit, writes `limit` in that view, empty removes it), `Show all (N)` when a limit hides rows, and **`Copy to clipboard`**, which copies the visible table as TSV: a header row of display names (`Task	status	Due date	priority`), then one row per result in view order, and shows a `Copied to your clipboard` notice (the menu closes). Export CSV is held. Use the app's existing clipboard path (no new permission or dependency). Re-observe the menu in Obsidian first (item order, icons, width).
2. **New row** (toolbar `New`): creates `Untitled.md` (`Untitled 1.md`...) and opens it with the title focused (Obsidian uses a popover; opening it in the current pane's new tab is acceptable if the popover is not small, say which). Its frontmatter holds the view's columns as empty properties, with a value filled in when a filter fixes it. Obsidian wrote `---\ntags:\n  - work\nstatus:\ndue:\npriority:\n---\n` for `Multi.base` using `file.hasTag("work")` from the view filter. Created at the vault root with no folder filter, in the filtered folder otherwise. The new row appears in the table at once. Reuse the existing property writer and note creation.
3. **Gap 1** (Add filter picker anchored under the row, filter menu kept open, muted id column).
4. **Gap 2** (Sort menu bordered comboboxes, icon-only trash, 34px pitch, separator).
5. **Gap 3** (resizer hover fill + header tint).

**Held (do not start; list in your notes):** Configure view page (Obsidian opens it right after Add view), the view options page (rename/duplicate/delete), cards/list views, Group by, Search, Summaries, formulas, Export CSV, header Summarize / Group by / Edit property / Property type (Grove greys them; Obsidian has them active), extra file facts in the Properties menu (backlinks, base name, embeds, full name, links), more expression/YAML coverage and visible formula errors, embedding bases, canvas items.

## Testing
**Real mouse input only:** CDP `Input.dispatchMouseEvent` (or Playwright `page.mouse`), hovering before pressing, including repeated clicks without moving. Never DOM `.click()` or synthetic events. Extend `scripts/test-bases-columns.mjs`/`test-bases-menus.mjs` or add `scripts/test-bases-results.mjs` (append it to the END of the `npm test` chain in `package.json`, which now ends `... test-bases-menus.mjs && node scripts/test-bases-columns.mjs && node scripts/test-r27r.mjs`; keep every existing entry). Unit tests next to `write.test.ts` for the `limit` writer and the New row frontmatter. Check:
- limit 2 writes `limit: 2` and shows 2 rows plus `Show all (3)`; clearing removes `limit` byte for byte;
- Copy to clipboard TSV text exactly (header + rows) and the notice;
- New row file name, location and frontmatter for `Multi.base`, and the row appears;
- Add filter picker position under the row with the filter menu still open; nothing written until the row is complete;
- Sort menu row pitch and combobox/trash structure; resizer hover fill;
- all Bases menus open on frame 1, no animation, no frame over 20 ms in the first 300 ms.
Open Grove-written files in Obsidian (scratch vault, private HOME, loopback-only) and confirm the same result. Put side-by-side screenshots in `rebuild/round32b-shots/`. Re-run the editor checks on notes with frontmatter and H1-H3 in Live Preview, Source and Reading with real hover and clicks (including repeated clicks without moving), and keep `npm run test:geometry` passing. Write `rebuild/ROUND32B_NOTES.md` with what you observed and each commit, every shared file touched and why, line counts and the **net line change by language** (production TS, test TS, CSS, Rust, mjs), what is held, and up to 3 next improvements (why each matters, roughly how big).

## Guardrails
- Smallest change that works; reuse existing code (writer queue, `showMenu`, icons, header/cell code, existing note creation and clipboard). Delete dead code you replace. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
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
- Items 1-3 work as above (4-5 if budget allowed), and `rebuild/ROUND32B_NOTES.md` is committed.
