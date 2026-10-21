# Task: Round 12, callouts, tables, embeds and images, the way Obsidian renders them

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/CLEANUP2_NOTES.md` (round 11, as merged), `rebuild/PROPERTIES_SEARCH_NOTES.md` (round 10) and `rebuild/MOTION_NOTES.md` first.

You are one of three agents given this same task in separate worktrees. Work only in yours. Commit locally, never push. Test headlessly. Never open app windows on this screen (no windows on Cloud's screen). Write the round notes file (see "Done when").

## The problem
Round 11 left Grove at 24,253 lines (TS 18,010 incl. 1,716 test lines, CSS 3,106, Rust 3,137), no file over 657 lines, and Obsidian's shell, settings, graph, properties and search are close. Open a real note side by side with Obsidian 1.14.4, though, and the biggest gap is now **what the note body looks like**: callouts (`> [!note]`) show as plain quotes, tables stay as pipes and dashes, `![[Other note]]` embeds and local images (`![[diagram.png]]`, `![](pics/a.png)`) stay as raw text, and `==highlights==` and `%%comments%%` aren't styled. This is a feature round (round 13 is also a feature round, round 14 is cleanup): build these on the Live Preview and Reading view code that exists (`editor/livePreview.ts`, `editor/syntax.ts`, `editor/fold.ts`, `editor/editor.ts`), with the smallest change that matches Obsidian.

## Requirements
Do them in this order. If time runs short, finish and polish fewer items rather than half-building all of them. Check each against Obsidian by observation (see the rules below), not from memory.

1. **Callouts** in Live Preview and Reading view:
   - `> [!type] Optional title` renders as Obsidian's callout box: tinted background, coloured icon and title, body rendered as Markdown (links, tags, emphasis, lists work inside). With the cursor inside the callout, show the source the way Obsidian does (observe whether it is the whole block or per line).
   - The types Obsidian ships and their aliases (note, abstract/summary/tldr, info, todo, tip/hint/important, success/check/done, question/help/faq, warning/caution/attention, failure/fail/missing, danger/error, bug, example, quote/cite); an unknown type looks like `note`. Icons are bundled Lucide icons; colours are CSS tokens in `theme.css`, light and dark, chosen by observation.
   - Foldable callouts: `[!type]-` starts folded, `[!type]+` starts open; clicking the chevron folds and unfolds without editing the note.
   - The existing "Insert callout" command keeps working.
2. **Tables** (GitHub-style pipe tables, which Obsidian uses):
   - Live Preview: a table renders as a table (header row bold, column alignment from `:---:`, inline Markdown in cells) while the cursor is outside it; with the cursor in it, the source shows (Obsidian edits cells in place; match that only if it stays small and solid, otherwise source-on-touch is fine; say which you did).
   - Reading view renders it the same way. Wide tables scroll horizontally inside the readable line width, as Obsidian's do.
   - The "Insert table" command if Obsidian's palette has one and Grove doesn't.
3. **Local images**, as Obsidian shows them:
   - `![[pic.png]]`, `![[pic.png|200]]` / `|200x100` (size), and `![alt](relative/path.png)` for files inside the vault (png, jpg, jpeg, gif, webp, svg, bmp, avif) render inline in Live Preview and Reading view; the source shows when the cursor touches it, as Obsidian does.
   - Resolve the target like a wikilink or markdown link already resolves (`link_index` rules, the `markdown` map); a missing file shows as Obsidian shows a missing embed.
   - **Backend:** one new command if needed, for example `read_file_bytes(path) -> bytes`, vault-confined with the same path checks as `read_note` (no `..`, no symlink escape, refuses `.grove/` and anything outside the vault), image extensions only, a size cap (say 20 MB), documented in `CONTRACT.md` with its permission. The front end turns the bytes into a `blob:` URL (revoked when no longer used); the CSP already allows `img-src 'self' data: blob:`, so **no CSP, capability-scope or `tauri.conf.json` change**. Do not enable Tauri's asset protocol or `convertFileSrc`. The mock backend serves one or two small images (generated in code, no binary files fetched) so it can be checked headlessly.
   - Remote images stay exactly as now: a link chip, never fetched.
   - Images in the file tree open in a tab as an image view if Obsidian does (observe), reusing the same command.
4. **Note embeds** `![[Other note]]`, `![[Other note#Heading]]` (and `#^block` only if it is cheap; otherwise skip and say so):
   - Rendered as Obsidian's embed: the embedded note's content (or that section), read-only, in a block with its own subtle border/indent and an "open link" icon that opens the note; clicking a link inside follows it.
   - Depth limit and cycle guard (a note embedding itself, or A ↔ B, shows a short marker instead of recursing). A missing note shows as Obsidian shows a missing embed.
   - The embed updates when the embedded note changes (from `vault-changed` or the open editor's own text), not by polling.
   - Reuse the existing Reading view rendering for the embedded content; do not write a second Markdown renderer.
5. **Inline styling Obsidian has and Grove lacks:** `==highlight==` (highlight colour, markers hidden like bold's), `%%comment%%` (hidden in Reading view, dimmed in Live Preview with markers shown on touch, as Obsidian does). Add the matching "Toggle highlight" command and hotkey if Obsidian has them and Grove doesn't.
6. **If there is time: code blocks** as Obsidian shows them in Reading view and Live Preview: the language label and the copy button on hover (copy uses the existing clipboard path). No syntax-highlighting language packs this round (that would be a new dependency; write down what it would cost instead).

## Hard performance rules
- Typing on the 5,000-line Big note and note switching must be no slower than now; measure before and after (headless Chromium, mock vault) and report.
- Nothing new runs on every keystroke beyond what the Live Preview decorations already visit: callout, table and embed decorations are built from the syntax tree for the visible ranges only, and only rebuilt where the document changed.
- Embedded notes and images are read lazily (when their widget is first drawn), cached by path and mtime, and dropped when the vault changes them or the widget goes away; never read the whole vault, never read per keystroke. A note with 30 image and note embeds must show its text first (under 50 ms) and fill embeds in afterwards without moving the caret or jumping the scroll position more than Obsidian does.
- Images are decoded off the typing path (`decoding="async"`, sized boxes from `|200x100` where given). Blob URLs are revoked; no memory growth from scrolling a note with many images up and down.
- Graph open, pan and zoom, and search typing must not regress.

## Size discipline (owner's rule; round 11's shape must survive)
- Smallest change that does the job. Reuse existing modules, helpers, tokens and icons (`editor/livePreview.ts`, `editor/syntax.ts`, `editor/fold.ts`, `shell/dom.ts` `h()`/`icon()`, `links/internal.ts`, `paths.ts`, `listeners.ts`, `perWorkspace.ts`, the Reading view, `link_index`, the motion tokens) before writing new ones.
- Delete dead code you make or find along the way.
- **No new dependency** without a written reason in the notes (what it does, its size, why our own code would be worse). A Markdown renderer or table parser counts; `@lezer/markdown` already has the GFM `Table` and `Strikethrough` extensions in the tree, so check what the parser already gives you first.
- No file over ~800 lines. If a file you touch would cross that (for example `livePreview.ts`), split it first, by block kind (for example `editor/callouts.ts`, `editor/tables.ts`, `editor/embeds.ts`).
- Report the net line change by TS (app and tests), CSS and Rust in the notes file. A feature round will grow the code: keep the total under about **+1,500 lines**, and explain any item that cost more than ~400.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews (a remote image or iframe is never loaded, embeds of URLs stay links). `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- **Look:** stay close to Obsidian's look. Obsidian's callouts, tables, embeds and menus are recreated **by observation** (palette, spacing, density, radii, colours) with bundled Lucide icons; never copy Obsidian's code, CSS or assets, and don't read them out of `obsidian.asar` either. A subtle forest-teal accent is welcome.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run (for example to check `read_file_bytes` end to end) happens only on a private virtual display (for example `Xvfb :99`) with scratch `HOME`/`XDG_*` folders, and is closed when done. If that is impossible, say so and give Chromium numbers plus your reasoning.
- If you observe Obsidian, run it isolated (no network, e.g. `unshare -rn`), on a private virtual display or headless, with a scratch `HOME` and throwaway vaults (add a callout, a table, an image and an embed to a scratch copy). Never touch `~/.config/obsidian`.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Each item above is either done (with tests where it has logic: callout header parsing and aliases, fold markers, table alignment parsing, embed target resolution with size suffixes, the cycle/depth guard, the new command's path checks in Rust) or explicitly skipped with a reason.
- A note with a callout, a table, a local image and a note embed opens, edits and saves correctly in Live Preview, Reading view and Source mode (check it in the browser, not only in unit tests), and the saved Markdown is byte-for-byte what was typed.
- Typing on the 5,000-line Big note and note switching are no slower than now.
- Finish by writing `rebuild/EMBEDS_BLOCKS_NOTES.md`:
  - per item, what you built, how it compares with Obsidian (what you observed), and what you skipped and why;
  - before/after line counts for TS (app and tests), CSS and Rust, with the net change for each and in total, measured from `rebuild/app` with
    ```
    for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
    git ls-files '*.test.ts' | xargs cat | wc -l
    git ls-files '*.ts' '*.css' '*.rs' | grep -v '/gen/' | xargs wc -l | sort -rn | head -15
    ```
  - any new module or file and what it owns; any dependency, permission, capability, command or CSP change, and why;
  - performance before/after (typing, note switch, opening a note with many embeds, search typing, graph open, pan/zoom).
