# Task: Round 13, working inside rendered blocks: code highlighting, table editing, images, embeds and coloured highlights

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/EMBEDS_BLOCKS_NOTES.md` (round 12, as merged; read its "Known gaps" first), `rebuild/CLEANUP2_NOTES.md` (round 11) and `rebuild/MOTION_NOTES.md` first.

You are one of three agents given this same task in separate worktrees. Work only in yours. Commit locally, never push. Test headlessly. Never open app windows on this screen (no windows on Cloud's screen). Write the round notes file (see "Done when").

## The problem
Round 12 left Grove at 25,770 lines (TS 19,228 incl. 1,804 test lines, CSS 3,323, Rust 3,219), no file over 676 lines. Callouts, tables, local images, note embeds, highlights and comments now **look** like Obsidian's (`editor/blocks.ts`, `callouts.ts`, `tables.ts`, `embeds.ts`, `render.ts`, `embedHost.ts`, `styles/blocks.css`). Side by side with Obsidian 1.14.4, the gap is now **working with** those blocks: code blocks are one grey colour where Obsidian colours them, a table can only be edited as raw pipes, images can't be zoomed or resized, a task inside an embedded note can't be ticked, and Obsidian's coloured highlight commands are missing. This is a feature round (round 14 is cleanup: no new features, net lines down). Build on round 12's code with the smallest change that matches Obsidian.

## Requirements
Do them in this order. If time runs short, finish and polish fewer items rather than half-building all of them. Check each against Obsidian by observation (see the rules below), not from memory.

1. **Code block syntax highlighting**, in Live Preview, Source mode and Reading view (and in note embeds, which paint through `render.ts`):
   - A fixed, bundled set of languages, chosen by what notes actually hold: at least JavaScript/TypeScript (incl. `jsx`/`tsx`), JSON, CSS, HTML/XML, Python, Rust, Shell (`bash`/`sh`/`zsh`), YAML, SQL and Markdown, with the aliases Obsidian accepts (observe: `js`, `ts`, `py`, `rs`, `sh`, `yml` …). Unknown languages stay plain, as now.
   - Colours are CSS tokens in `theme.css` (light and dark), chosen by observing Obsidian's code colours (keyword, string, number, comment, function, property, operator, punctuation, tag, attribute …). Reuse CodeMirror's `syntaxHighlighting`/`HighlightStyle` with tag-to-class mapping; no inline colours.
   - **This needs a dependency.** Prefer the official `@codemirror/lang-*` packages and/or `@codemirror/legacy-modes` (one language per import, nothing fetched at runtime). Bundle them up front or as local lazy chunks served from the app's own origin, whichever is smaller. Add each package to the commented dependency allowlist in `scripts/audit-offline.mjs` with a one-line reason (that is how the audit expects a new dependency); loosen no other audit rule. Write the reason in the notes: each package, its version, its gzipped size in the bundle, and why our own code would be worse. **Budget: at most +60 kB gzipped** on `index.js` (plus any lazy chunks), measured before and after. No `@codemirror/language-data` catalog of 100+ languages.
   - Highlighting a code block costs nothing outside the viewport and nothing per keystroke beyond the edited block.
2. **Tables you can edit as in Obsidian.** Round 12 is source-on-touch. Observe Obsidian's table editing in Live Preview and then:
   - **Required:** `Tab` / `Shift+Tab` move to the next / previous cell (Tab in the last cell adds a row), `Enter` in the last row adds a row, and the table right-click menu with Obsidian's items, order and separators (observe: add row above/below, add column before/after, delete row/column, move row/column, align column left/centre/right, and whatever else it shows), each one rewriting the Markdown table with columns re-padded the way Obsidian pads them. Every change is one undo step.
   - **If it stays small and solid:** in-place cell editing (the table stays drawn and the caret moves inside a cell). If you do it, it must keep every editor feature that already works inside a line (links, `[[` suggest, formatting commands, undo); if it can't, keep source-on-touch and say why.
3. **Images**, as Obsidian shows them (observe first):
   - The zoom Obsidian offers on an image (click or its "Zoom in" control): the image fills the window over a dimmed backdrop, closes on click or `Escape`, with the motion tokens.
   - Drag-to-resize: dragging an image's edge or corner rewrites its size suffix (`![[pic.png|240]]`, or `![alt|240](pic.png)` for Markdown images, whatever Obsidian writes) as one undo step, live while dragging but written to the document only on release.
   - The image tab gets Obsidian's zoom controls if Obsidian's image view has them (observe).
4. **Note embeds you can work in**, where Obsidian allows it:
   - Ticking a task checkbox inside an embedded note writes that task's line in the *embedded* note (through the existing save path, `ws.editors` when it is open, else `read_note`/`write_note` with the mtime check the app already uses) and the embed redraws. Nothing else in the embed becomes editable.
   - Embeds inside a callout or table follow their target being created, renamed or deleted (round 12 caveat), without a vault-wide scan.
5. **Coloured highlights:** Obsidian 1.14.4's palette has "Toggle red highlight", orange, yellow, green, blue and purple next to "Toggle highlight". Observe exactly what Markdown each one writes and how it is drawn in Live Preview and Reading view (light and dark), and match it byte for byte; colours are tokens. If the syntax Obsidian writes would be unreadable in other Markdown apps, still match it and note that in the notes.
6. **If there is time:** Reading view and Live Preview spacing inside callouts (round 12 notes: a paragraph and a list in a callout sit closer than Obsidian's 16 px), and a callout's fold state surviving being scrolled away and back.

## Hard performance rules
- Typing on the 5,000-line Big note and note switching must be no slower than now; measure before and after (headless Chromium, mock vault) and report. Also measure typing **inside** a 300-line code block and in a 40-row table.
- Highlighting runs on the visible ranges only and only re-parses the edited block; the language parsers load once (or lazily from the app's own origin), never per block or per keystroke.
- Table commands touch only the table's lines. Image resize writes once on release. Ticking a task in an embed reads and writes only that one note.
- Graph open, pan and zoom, and search typing must not regress. Bundle size before/after in the notes.

## Size discipline (owner's rule; round 12's shape must survive)
- Smallest change that does the job. Reuse existing modules, helpers, tokens and icons (`editor/blocks.ts`, `tables.ts`, `embeds.ts`, `render.ts`, `embedHost.ts`, `editor/format.ts`, `shell/dom.ts` `h()`/`icon()`, the menu builder, `listeners.ts`, `perWorkspace.ts`, the Reading view, the motion tokens) before writing new ones.
- Delete dead code you make or find along the way.
- **Every new dependency needs a written reason** in the notes (what it does, its size in the bundle, why our own code would be worse). Only the code-highlighting languages are expected to need one; anything else is a red flag.
- No file over ~800 lines. If a file you touch would cross that, split it first by what it owns (for example `editor/tableEdit.ts` beside `tables.ts`, `editor/imageZoom.ts`, `editor/codeHighlight.ts`).
- Report the net line change by TS (app and tests), CSS and Rust in the notes file. A feature round will grow the code: keep the total under about **+1,500 lines** (dependencies don't count, the glue does), and explain any item that cost more than ~400.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews (a remote image or iframe is never loaded, embeds of URLs stay links). Language grammars are bundled, never fetched. `npm run audit:offline` must pass; the only audit change allowed is adding the highlighting packages to its dependency allowlist.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- **Look:** stay close to Obsidian's look. Obsidian's code colours, table menu, image zoom and resize handles are recreated **by observation** (palette, spacing, density, radii, colours, menu order and separators) with bundled Lucide icons; never copy Obsidian's code, CSS or assets, and don't read them out of `obsidian.asar` either. A subtle forest-teal accent is welcome.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private virtual display (for example `Xvfb :99`) with scratch `HOME`/`XDG_*` folders, and is closed when done. If that is impossible, say so and give Chromium numbers plus your reasoning.
- If you observe Obsidian, run it isolated (no network, e.g. `unshare -rn`), on a private virtual display or headless, with a scratch `HOME` and throwaway vaults. Never touch `~/.config/obsidian`.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Each item above is either done (with tests where it has logic: language alias lookup, the table rewrites for every menu item and for Tab/Enter, column padding, the size-suffix rewrite for both image syntaxes, the task-tick line rewrite in another note, the coloured highlight toggles) or explicitly skipped with a reason.
- A note with a highlighted code block, a table, a local image, a note embed holding tasks, and coloured highlights opens, edits and saves correctly in Live Preview, Reading view and Source mode (check it in the browser, not only in unit tests); every table, resize and tick change is one undo step, and the saved Markdown is exactly what Obsidian would write for the same action.
- Typing on the 5,000-line Big note, inside a long code block and inside a table, and note switching are no slower than now.
- Finish by writing `rebuild/BLOCK_EDITING_NOTES.md`:
  - per item, what you built, how it compares with Obsidian (what you observed), and what you skipped and why;
  - before/after line counts for TS (app and tests), CSS and Rust, with the net change for each and in total, measured from `rebuild/app` with
    ```
    for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
    git ls-files '*.test.ts' | xargs cat | wc -l
    git ls-files '*.ts' '*.css' '*.rs' | grep -v '/gen/' | xargs wc -l | sort -rn | head -15
    ```
  - any new module or file and what it owns; every dependency (name, version, gzipped bundle size, reason), permission, capability, command or CSP change, and why;
  - bundle size before/after, and performance before/after (typing on Big note, in a code block, in a table; note switch; search typing; graph open, pan/zoom).
