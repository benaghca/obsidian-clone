# Task: Round 32, Bases part 3 (Part A): resize and reorder columns, reorder sorts, close the round 31 menu gaps

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND31_BASES_TASK.md`, and your own `rebuild/ROUND31_NOTES.md` and `rebuild/ROUND31B_NOTES.md` first. All your round 30-31 Bases code is merged (`src/bases/{yaml,expression,model,view,cells,menus,filterMenu,filters,write,new}.ts`, `styles/bases.css`, `scripts/test-bases.mjs`, `test-bases-edit.mjs`, `test-bases-menus.mjs`). Reuse it: the serialized read/modify/write queue in `write.ts` stays the only Bases write path, and `showMenu` (`src/shell/menu.ts`) stays the only menu code.

**Who builds.** You (Codex) build round 32. A bug hunter (Grok) tests your branch afterwards and sends confirmed bugs back to you. **Your 5-hour budget is tight. Do Part A only, in small commits, and stop when Part A is done.** Part B is listed so you know what comes next. Only start it if Part A is finished, committed and checked, and you clearly have budget left. Work only in your worktree. Commit locally, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is fixing non-canvas, non-Bases bugs in parallel** (search pane, file explorer, link suggestions, dialogs, settings, backlinks) in another worktree. Keep new code in `src/bases/` and `src/styles/bases.css`. Touch shared files (`icons.ts`, `menu.ts`, `pane.ts`, `package.json`) only for the one or two lines you need, and say exactly what and why in your notes. Do not edit Grok's non-Bases files or refactor shared code. `shell/pane.ts` is ~741 lines: do not grow it.

Grove is now **35,596 lines** of TS/CSS/Rust (TS 27,724, CSS 4,558, Rust 3,314) after round 31 Part B merged (merge commit a68cf5c). Count lines as before: tracked files under `rebuild/app/src`, `src-tauri/src`, `vite.config.ts` and `src-tauri/build.rs`, excluding `/gen/`.

## Observed in Obsidian 1.14.4 at the round 31 Part B merge (default light theme, 1280x800, same `BaseTest/Task A..F` fixtures and the `Multi.base` from ROUND31_BASES_TASK.md)
**Already matching (keep):** table rows, order and headers. Filter popover is 520px with All views 1 / This view 2, conjunction, `where file has tag work` / `or priority > 1`, Advanced filter and trash icons, Add filter / Add filter group. Add view appends a table view and switches to it, keeping every other byte. Switching views writes nothing. Header menu shows Clear sort only on sorted columns and every item has an icon. Properties menu is 225px with unchecked rows in rgb(171,171,171). New base selects the `Untitled` title and Enter renames it, keeping `.base`. Filter, View, Sort and Properties menus open on frame 1 with no animation, and a second click without moving closes them.

**Column resize (table header).** Each header cell has a 6px resizer straddling its right edge (x from edge-5 to edge+1, full 30px header height, `col-resize` cursor). On hover it shows a thin accent line (rgb(152,115,247) in Obsidian's purple theme; use Grove's accent token). Dragging follows the pointer 1:1 (+60px gives exactly +60, no snapping), and the minimum displayed width is 40px. On release Obsidian writes a `columnSize` map at the end of that view, keyed by full property id (`note.due: 196`, `note.priority: 177`, `file.name: ...`, `formula.x: ...`). Double-clicking the resizer resets that column to its automatic width and removes its key; the map stays while other keys remain. The last column still fills the remaining width unless it was sized. **Obsidian bug, do not copy:** shrinking below the minimum wrote `note.status: -228` while showing 40px. Grove writes the clamped value (40). Read existing `columnSize` values (including invalid ones, clamped on display).

**Column reorder (table header).** Header cells are draggable. Dragging a header and dropping it on the left part of another header moves the column before that one, and dropping on the right part moves it after. Obsidian rewrote `order` from `file.name, due, priority, status` to `file.name, status, due, priority` after dropping `status` on the left half of `Due date`. Show a drop indicator line while dragging and do not write on a cancelled drag (Escape, or a drop outside the header). Keep the first column (`file.name`) draggable like the others unless Obsidian pins it (check).

**Sort menu reordering and labels.** Every sort row starts with a 16x16 grip handle (`grip-vertical`, `grab` cursor). Dragging the first row below the second swaps them and rewrites `sort` (`due ASC, file.name DESC` became `file.name DESC, due ASC`). The menu stays open and redraws. Direction labels depend on the type: text `A → Z` / `Z → A`, numbers `0 → 1` / `1 → 0`, **dates `Old to new` / `New to old`** (Grove shows `A → Z` for dates). Grove's Sort rows have no grip.

**Properties menu reordering.** Obsidian 1.14.4 has **no** drag handle in the Properties menu: dragging a checked row did nothing and wrote nothing. Columns are reordered by dragging headers only. Do not add Properties-menu dragging. If you find it in Obsidian, describe what you saw and hold it.

**Measured gaps from the round 31 Part B merge (fix in Part A, item 4):**
1. **Add filter** in Grove immediately writes `file.name == ""` into the file. Obsidian adds an incomplete row (`file` / `links to` / empty value), opens its property picker (search field, then file properties, then note properties), and **writes nothing until the row is complete**. Closing the menu with the row incomplete leaves the file unchanged. Match this: keep incomplete rows in the menu only (session state) and write when the row has a property, operator and value, or for operators that need no value.
2. **Filter row metrics.** Obsidian rows are 28px tall (Grove 32), icon buttons 28x24 (Grove 26x22), value inputs 28px (Grove 29), and the conjunction is a 226px dropdown (Grove 200px button). The tag value shows an `x` clear.
3. **Add view naming and config.** Obsidian names the first added view `View` (then `View 1`...). Grove writes `View 1`. Match the naming. Obsidian then shows a `Configure view` page in the same menu (`Layout: Table`, `Row height: Short / Medium / Tall / Extra tall`). This is held unless trivial: say which.
4. **View menu.** Obsidian's is 225px wide, with a `Search...` field at the top and the current view highlighted, with a `›` that opens that view's options. Grove's is 160px with a checkmark and no search. Match the width, the search filter and the highlight. Hold the `›` view-options page (rename/duplicate/delete) unless it is tiny.
5. **Header menu details.** Obsidian marks the active direction with a check (✓ on `Sort A → Z` for an ASC column), draws `Clear sort` in the danger red (rgb(233,49,71), use Grove's error token), and separates the groups (Hide/Summarize/Group | Sort A → Z / Z → A / Clear | Edit property | Property type). Grove has no check, normal text, no separators.
6. **Properties menu details.** `Add formula` is normal text (rgb(34,34,34)) with its icon in Obsidian. Grove greys it. `Hide all` has an `eye-off` icon. The `Find or create...` field is Obsidian's raised search input with a search icon, not a bordered text box.
7. One Properties-menu open frame measured 20.9 ms on the box (others 16.9-17.2 ms). Make sure the first 300 ms stay under 20 ms.

Re-check anything you rely on in Obsidian yourself (private HOME/profile, scratch vault, loopback-only network namespace, as in round 31).

## Part A (this round)
1. **Column resize** as observed: resizer, 1:1 drag, 40px minimum, `columnSize` written once on release (not on every move), double-click reset, and existing `columnSize` read on open. Writes add or replace only that view's `columnSize` block (append it at the end of the view if missing) and keep every other byte.
2. **Column drag reordering** on header cells: drop indicator, before/after by half, rewrite only that view's `order` block, no write on cancel. Pointer-driven with real `pointerdown`/`pointermove`/`pointerup` (or HTML5 drag if that is what fits). It must not break header right-click or the plain-click-does-nothing behaviour.
3. **Sort menu grip handles and reordering** (rewrite only that view's `sort` block, menu stays open), plus the type-based direction labels (dates `Old to new` / `New to old`).
4. **The 7 gaps above** with the smallest change.

## Part B (only if Part A is done and budget remains; otherwise make it next improvement 1)
- **Results menu** (click `N results`): `Limit number of results` number input (placeholder `e.g. 10`, shows the current limit, writes `limit` in that view, empty removes it), `Show all (N)`, and **`Copy to clipboard`**, which copies the visible table as TSV: a header row of display names (`Task	status	Due date	priority`), then one row per result in view order, and shows a `Copied to your clipboard` notice (the menu closes). Export CSV is held. Use the app's existing clipboard path (no new permission or dependency).
- **New row** (toolbar `New`): creates `Untitled.md` (`Untitled 1.md`...) and opens it in a popover with the title focused. Its frontmatter holds the view's columns as empty properties, and a value is filled in when a filter fixes it. Obsidian wrote `---\ntags:\n  - work\nstatus:\ndue:\npriority:\n---\n` for `Multi.base`, using `file.hasTag("work")` from the view filter. Obsidian created it at the vault root when there was no folder filter, and in the filtered folder otherwise. The new row appears in the table at once. Do this only if it is small with the existing property writer and popover code. Otherwise hold it and say why.

**Held (do not start; list in your notes):** cards/list views, Group by, Search, Summaries, Add formula and the full formula language, Export CSV, the view options page (rename/duplicate/delete), the Configure view page, header Summarize / Group by / Edit property / Property type, embedding bases, non-Markdown files in bases, the extra file facts (backlinks, base name, embeds, full name, links), canvas indexing, the disabled canvas Align items and the earlier canvas leftovers.

## Testing
**Test with real mouse input:** CDP `Input.dispatchMouseEvent` (or Playwright `page.mouse`), moving the pointer over the target before pressing (hover, then click), including repeated clicks without moving. Never use DOM `.click()` or synthetic drag events. Extend `scripts/test-bases-menus.mjs` or add `scripts/test-bases-columns.mjs` (append it to the `npm test` chain in `package.json`, keeping every existing entry). Add unit tests for the `columnSize`/`order`/`sort` writers next to `write.test.ts` and `filters.test.ts`. Check:
- resize by +60 and -400 (clamped at 40), with the written `columnSize` diffed byte for byte;
- a double-click reset removes the key;
- header drag before and after, and a cancelled drag writes nothing;
- sort grip drag swaps rows, and the date labels are right;
- an incomplete Add filter writes nothing until completed;
- Add view naming `View`, then `View 1`;
- view menu width, search and highlight; header menu check, red Clear sort and separators; Properties Add formula and Hide all icons;
- all Bases menus open on frame 1 with no animation and no frame over 20 ms in the first 300 ms.
Open the Grove-written `.base` files in Obsidian (scratch vault) and confirm the same rows, columns, order and widths. Put side-by-side screenshots in `rebuild/round32-shots/`. Re-run the editor checks on notes with frontmatter and H1-H3 in Live Preview, Source and Reading, with real hover and clicks (including repeated clicks without moving), and keep `npm run test:geometry` passing. Write `rebuild/ROUND32_NOTES.md` with:
- what you observed and each commit;
- every shared file touched and why;
- line counts and the **net line change by language** (production TS, test TS, CSS, Rust, mjs);
- what is held;
- up to 3 next improvements (each with why it matters and roughly how big).

## Guardrails
- Make the smallest change that works and reuse existing code (the writer queue, `showMenu`, icons, the header and cell code). Delete dead code you replace. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines (`view.ts` is 170: split before it grows past ~300).
- **Geometry.** Never space lines or widgets inside `.cm-content` with vertical margins (use padding). Every direct child of `.cm-content` keeps zero vertical margin, and every rendered line's CodeMirror top stays within 1px of its DOM top. Fold arrows stay visible after stationary fold and unfold clicks.
- **No animations** on prompts, menus, popovers, tooltips, drop indicators or resize lines.
- **File compatibility.** `.base` files stay Obsidian's YAML and open in Obsidian with the same result. Every byte outside the edited block is preserved, and the edited block is written in Obsidian's canonical style (2-space indents, block lists, plain scalars unless quoting is needed). Match Obsidian from observation only.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics, and no remote fonts, scripts, styles or images. The strict CSP is unchanged. `npm run audit:offline` must pass.
- **No downloadable plugins**, only built-in features. Keep dependencies minimal and reviewable.
- Recreate Obsidian's look **by observation** with bundled Lucide icons. Never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Run Tauri only on a private Xvfb display with scratch `HOME`/`XDG_*`.
- Commit locally only. Do NOT push and do NOT merge. Do not touch other worktrees.

## Done when
- In `rebuild/app`, `npm run build`, `npm test`, `npm run test:geometry` and `npm run audit:offline` pass. In `rebuild/app/src-tauri`, `cargo build` and `cargo test` pass. `npm test` rewrites screenshot and canvas fixtures: restore the ones you did not mean to change (including `round30-shots/performance.json`) with `git checkout` before committing.
- Part A works as above, Obsidian opens Grove-written `.base` files with the same rows, columns, order and widths, and `rebuild/ROUND32_NOTES.md` is committed.
