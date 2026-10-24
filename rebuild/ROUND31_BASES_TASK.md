# Task: Round 31, Bases part 2 (Part A): match the table, edit cells, Sort/Properties menus, New base

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND30_BASES_TASK.md` and your own `rebuild/ROUND30_NOTES.md` first. Your round 30 code is merged (`src/bases/{yaml,expression,model,view}.ts`, `styles/bases.css`, `scripts/test-bases.mjs`). Reuse it, and reuse the property editing code (`src/editor/frontmatter.ts` `setValue`/`addProperty`/`yamlString`, `src/editor/propertyFields.ts` `editable`/`TYPE_ICONS`, `src/editor/properties.ts` `propertyRows`, `src/shell/propertiesView.ts`), the menu code (`src/shell/menu.ts` `showMenu`) and `newCanvas` (`src/shell/menus.ts`).

**Who builds.** You (Codex) build round 31. A bug hunter (Grok) tests your branch afterwards and confirmed bugs come back to you. **Your usage budget is tight (about 40% of the 5-hour plan is left): do Part A only, in small commits, and stop when Part A is done.** Part B is listed so you know what is next; only start it if Part A is finished, committed and checked and you clearly have budget left. Work only in your worktree. Commit locally, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is fixing non-canvas, non-Bases bugs in parallel** (properties UI, menus, backlinks/outline/search panes, sidebar, settings, Reading view) in another worktree. Keep new code in `src/bases/` and `src/styles/bases.css`. Touch shared files (`frontmatter.ts`, `propertyFields.ts`, `menus.ts`, `pane.ts`, `commands`, `icons.ts`) only for the few lines you need (exporting a helper, one menu item, one command, one icon), and say exactly what and why in your notes. `shell/pane.ts` is already 740 lines: do not grow it beyond a line or two. Do not refactor shared code.

Grove is now **33,840 lines** of TS/CSS/Rust (TS 26,287, CSS 4,239, Rust 3,314; scripts `*.mjs` 6,639), after round 30 merged (merge commit 0323354). Count lines from `rebuild/app` as in round 30.

## What was observed at the round 30 merge (Obsidian 1.14.4, default light theme, 1280x800, same scratch vault and `.base` files in both apps)
Fixtures: `BaseTest/Task A..F` (status/priority/due/tags; E has no priority, F ties A on priority 3 and is late), your round 30 sample base, and:
```yaml
filters:
  not:
    - status == "waiting"
properties:
  file.name:
    displayName: Task
  note.due:
    displayName: Due date
views:
  - type: table
    name: By due
    filters:
      or:
        - file.hasTag("work")
        - priority > 1
    order:
      - file.name
      - due
      - priority
      - status
    sort:
      - property: due
        direction: ASC
      - property: file.name
        direction: DESC
    limit: 3
```
**Match:** rows, order, result counts (5 and 3), column order, displayName labels, sort on multiple keys with ties, `not`/`or`/view+global filters, `limit`, `file.hasTag`, the `late` formula, number right-alignment, 30px header and body rows, 13.125px header and cell text, header text colour rgb(92,92,92) weight 400, sorted-column indicators on the same columns.

**Real gaps (fix in Part A, item 1):**
- **Toolbar.** Obsidian: a 29px toolbar row starting 5px below the view top (view-content y 78, toolbar y 83, header row at y 118). Left: a view button (lucide `table` icon, view name 13px, then `chevrons-up-down`) and a results button (`text-align-start` icon, `5 results` in 12px muted). Right-aligned: `Sort` (accent colour plus a count badge when the view has sorts), `Group`, `Filter` (accent when filters exist), `Properties`, `Search`, `New`; each is an icon+label text button, 13px. Grove: 40px row in a 12px 24px padded view (toolbar y 101, header y 130), name and count both 13.125px, `chevron-down`, no right-side buttons.
- **Table position.** Obsidian's table is flush with the view's left edge (x 344 = view x) and cell text starts 8px in (x 352). Grove has 24px side padding (table x 368, text x 376).
- **Column widths.** Obsidian sizes each column from its header (icon + label + padding, plus room for the sort indicator), dates wider: `file name` 92, `Status` 73, `priority` (sorted) 96, `due` 136, `tags` 92, and the **last column fills the remaining width** (434). In the second base: `Task` 78, `Due date` 136, `priority` 80, `status` 629 (last). Grove gives every column the same width (148 / 222).
- **Header details.** Header type icons are 14x14 at cell x+8 and the label starts at x+26 (Grove: 18x18 icons, label at x+32). `file.name` uses the lucide `info` icon and formula columns a function icon (Grove: text-lines icon for both). The sort indicator is a 14px `chevron-down` (DESC) / `chevron-up` (ASC) at the right of the header cell on every sorted column (Grove: `arrow-down`/`arrow-up` right after the label). No header background (Grove: white sticky header; keep sticky if you need it, but match the look).
- **Grid lines.** Obsidian draws a 1px line between rows and between columns in rgb(228,228,228) (as box-shadows) plus a line under the header. Grove uses 1px borders in rgb(224,224,224) on every cell; match the colour (use the existing border token if it already gives 228 elsewhere, do not change a shared token for everything).
- **Date cells.** Obsidian shows dates like the Properties date field (input with 24px left padding, the small grey calendar glyph inside it, faint separators: text at cell x+24, like the round 27m property date input) plus a right-side `Open daily note` icon on hover. Grove puts a separate 18px calendar icon before the input (text at cell x+32). Reuse the Properties date styling.
- **Tags/list pills.** Obsidian: accent-tinted, fully rounded pills (radius ~26px, accent text, 20.6px tall, with an `x` remove button), as the Properties tags field. Grove: grey 4px-radius pills. Reuse the Properties multi-select pill rendering.
- **file name links** are underlined accent links in Obsidian (Grove: not underlined until hover).
- Your held items from ROUND30_NOTES: (1) measured column widths: done by the widths item above. View switching goes with the view menu in Part B. (2) Cell editing: Part A, item 2. (3) More expressions/YAML: held (see below).

**Obsidian's own writes (important for item 3).** When Obsidian saves a view change (and even when you leave and reopen a base after a resize), it **re-serializes the whole file** canonically: comments dropped, flow lists `[a, b]` expanded to block lists, and quotes removed where YAML allows (`'status != "done"'` becomes `status != "done"`, `name: "Quoted"` becomes `name: Quoted`). Obsidian reads both forms. Grove is stricter: **change only the keys being edited and keep every other byte of the file**, writing the edited part in Obsidian's canonical style (2-space indents, block lists `- property: x` / `direction: ASC|DESC`, plain scalars unless quoting is required).

**Observed menus and editing:**
- Sort menu (toolbar `Sort`): title `Sort by`, then one row per sort key (drag handle, property button `priority ⌃`, direction button `1 → 0` for numbers / `A → Z` text style labels, trash icon), then `Add sort`. Writes `views[i].sort`.
- Properties menu (toolbar `Properties`): search field `Find or create...`, then a checkbox list: the view's columns in `order` (checked, with type icon and a `›` button), then the other properties unchecked (file backlinks, file base name, created time, file embeds, file extension, folder, file full name, file links, modified time, file path, file size, file tags, and note properties), then `Add formula` and `Hide all`. Toggling writes `views[i].order`.
- Filter menu (toolbar `Filter`): sections `All views` (count badge, the global `filters`) and `This view`; each a group with a conjunction dropdown (`All the following are true` / `Any of the following are true` / `None of the following are true` = and/or/not), rows `where [property] [operator] [value]` with a code toggle and trash, `Add filter`, `Add filter group`.
- Header right-click menu: `Hide column`, `Summarize...`, `Group by this property` | `Sort A → Z`, `Sort Z → A`, `Clear sort` | `Edit property...` | `Property type ›`. A plain header click does nothing (no write).
- Cell editing: a single click on a text cell puts the caret in it immediately (contenteditable, caret where clicked); typing and Enter wrote `status: Xopen` into that note's frontmatter right away; the `.base` file was not touched. Number cells are number inputs, dates are date inputs, tags are multi-select pills; formula and `file.*` cells are not editable.
- `New` (toolbar) creates a note in the filtered folder with empty properties for the columns (`---\nstatus:\npriority:\ndue:\ntags:\n---`) and opens it in a popover: held.
- New base (command `bases:new-file`, file explorer and folder context menu `New base`): creates `Untitled.base` (then `Untitled 1.base`...) containing `views:\n  - type: table\n    name: View\n`.

Re-check anything you rely on in Obsidian yourself (private HOME/profile, scratch vault, no network, as in round 30).

## Part A (this round)
1. **Fix the gaps above** with the smallest CSS/TS change: toolbar row layout and fonts (view button with icons, 12px results count; show `Sort`, `Filter`, `Properties` on the right; leave `Group`, `Search`, `New` out or visibly disabled, say which), flush table, header-based column widths with the last column filling, 14px header icons (`info` for file name, a function icon for formulas), chevron sort indicators, grid line colour, Properties-style date and pill rendering, underlined file links. Measure both apps side by side again at 1280x800 and record the numbers in your notes.
2. **Edit cells**, writing to the note's frontmatter through the existing property code (no second YAML writer for notes): text (single click puts the caret where clicked, Enter or blur commits, Escape cancels), number, date/datetime, checkbox, list/tags pills (add/remove). Writing to a note that is open in an editor goes through its editor state (as the Properties view does) so undo and the open note stay in sync; otherwise write the file. Missing properties are added. `file.*` and formula cells stay read-only. After an edit, the row re-sorts/re-filters like Obsidian (check what Obsidian does with the edited row while the cell is focused, and match it). The `.base` file is never written by cell edits.
3. **Sort menu, Properties menu and header right-click menu** writing the `.base` file: Sort (change property, toggle direction, remove, Add sort; reorder by drag only if cheap), Properties (toggle columns in `order`, Hide all; `Find or create...` filters the list; Add formula held), header right-click `Sort A → Z` / `Sort Z → A` / `Clear sort` / `Hide column` (the rest held). Writes replace only the edited view's `sort` / `order` block (insert it at the end of that view if missing) and keep every other byte; the table updates from the written file. A small `src/bases/write.ts` with unit tests (round trips of your round 30 fixtures, comments and quoted strings elsewhere unchanged, Obsidian opens the result with the same rows/columns) is the expected shape.
4. **New base**: a `Bases: Create new base` command plus `New base` in the file explorer / folder context menus next to `New canvas` (and the empty-tab action if it is one line), reusing `newCanvas`'s naming and open logic: creates `Untitled.base` (`Untitled 1.base`...) with exactly `views:\n  - type: table\n    name: View\n` and opens it.

## Part B (only if Part A is done and budget remains; otherwise list it as next improvement 1)
- Filter menu writing `filters` (global `All views` and `This view`): and/or/not groups, `where property operator value` rows for the comparisons you already evaluate, Add filter / Add filter group, trash. Same byte-preserving writes.
- View menu: list the file's views, click to switch (read-only switch, remembered per tab), `Add view` adding `- type: table name: View N`.

**Held for later rounds (do not start; say so in your notes):** cards and list views, Group by, Search, the `New` item button/popover, Summaries, the results menu (limit field, Copy to clipboard, Export CSV), formulas (Add formula, the full formula language, per-cell formula errors as Obsidian shows them instead of the blank cell + notice), more YAML/expression coverage (your round 30 item 3), column resize and drag-to-reorder, `Edit property...`/`Property type` from the header menu, embedding bases in notes (` ```base ` blocks and `![[x.base]]`), Bases for non-Markdown files (Obsidian's empty base also lists `.base`/other files). Also held: canvas indexing for search/backlinks/graph, the seven disabled canvas Align items, and the round 29 canvas leftovers listed in `ROUND30_BASES_TASK.md`.

## Testing
**Test with real mouse input**: CDP `Input` events (or Playwright `page.mouse`) with the pointer moved over the target before pressing (hover, then click), including repeated clicks without moving, never DOM `.click()`. Extend `scripts/test-bases.mjs` or add `scripts/test-bases-edit.mjs` (append to the `npm test` chain in `package.json`), plus unit tests for `write.ts`. Check: the measured layout numbers above (toolbar y/height, table x, header icon size and label x, column widths with the last one filling, row height 30); cell edits change exactly one frontmatter line of the right note (also when that note is open in Live Preview, Source and Reading, and undo works there); sort/order writes change only that block (diff the bytes), and the rows/columns update; New base content is byte-exact; menus open on the first frame with no animation and no frame over 20ms in the first 300ms. Open the Grove-written `.base` files in Obsidian (scratch vault) and confirm the same rows, order and columns (side-by-side screenshots in `rebuild/round31-shots/`). Re-run the editor checks on notes with frontmatter and H1 to H3 headings in Live Preview, Source and Reading with real hover and clicks (including repeated clicks without moving). Write `rebuild/ROUND31_NOTES.md`: what you observed, each commit, every shared file touched and why, line counts and net line change by language (production TS, test TS, CSS, Rust, mjs), what is held, and up to 3 next improvements (each with why it matters and roughly how big).

## Guardrails
- The smallest change that works; reuse existing code (property editing and rendering, menus, icons, `newCanvas`, your round 30 model); delete dead code you find on the way (for example round 30 date/pill rendering you replace). Any new dependency needs a written reason in the notes (prefer none). Files stay under about 800 lines.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) and all real-pointer checks passing (Live Preview, Source, Reading; frontmatter; H1 to H3). Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` keeps zero vertical margin and every rendered line's CodeMirror top stays within 1px of its DOM top. Fold arrows stay visible after stationary fold and unfold clicks.
- **No prompt, menu, popover or tooltip animations.** Ctrl+O, Ctrl+P, right-click menus and the new Bases menus open within two frames with no frame over 20ms in the first 300ms.
- **File compatibility.** `.base` files stay Obsidian's YAML and open in Obsidian with the same result; untouched bytes are preserved; notes' frontmatter stays Obsidian-compatible (same writer as the Properties view). Match Obsidian from observation only. `.canvas` and `.md` behaviour is otherwise unchanged.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin (unchanged); external links open only on an explicit click through the system opener; no remote previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches. Do not touch other worktrees.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run test:geometry`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass. `npm test` rewrites screenshot/canvas fixtures: restore the ones you did not mean to change with `git checkout` before committing.
- Part A works as above, Obsidian opens Grove-written `.base` files with the same rows and columns, and `rebuild/ROUND31_NOTES.md` has its notes, line counts, held items and up to 3 next improvements.

## Part B notes (measured at the round 31 Part A merge, Obsidian 1.14.4, 1280x800, same fixtures)
Part A matched: cell text/number edits (note saved only on Enter, `.base` untouched, row re-sorts), Sort menu content, header Sort A → Z writing `sort` with that key first, Hide column writing `order`, Properties menu content, New base naming, menu item height 24.9px / 13px, menus on frame 1 with no animation. Obsidian also re-serializes the whole `.base` about 2 s after a change. Grove's byte-preserving write is intended: keep it.
Small Bases-only gaps for Part B, after the Filter menu and the view menu:
1. Header right-click: Obsidian shows `Clear sort` only when that column is sorted, and every item has an icon (Hide column, Clear sort too). Grove always shows Clear sort, and Hide column and Clear sort have no icons.
2. Properties menu: Obsidian greys out the unchecked property rows (muted text and icon) and the menu is narrower (225px wide vs Grove 310px). Grove draws every row in normal text.
3. New base: Obsidian opens the new base with its title selected for rename (like a new note). Grove does not select it. Obsidian 1.14.4 writes an empty `Untitled.base` (0 bytes) and shows a default `View` table. Keep Grove's 3-line content; both apps open both forms.
Still held: header Summarize / Group by / Edit property / Property type, drag handles and reordering in Sort and Properties, and the extra file facts (backlinks, base name, embeds, full name, links) until they are supported.
