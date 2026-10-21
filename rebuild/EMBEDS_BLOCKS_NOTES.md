# Round 12: callouts, tables, embeds and images (as merged)

**Merged:** Claude's version (`rebuild/r12-claude`, `4288bf8`) as merge `af52122`, plus one small port: Grok's block-link find (`5d347aa`: Grok noticed that opening `[[Note#^id]]` landed at the top of the note because `headingPos` skipped `^` targets; it now lands on the line that ends in ` ^id`, with tests). Three agents did the same brief from `981ef82`; the comparison was headless (Vite preview of each branch and of the round-start base, with the mock vault plus one shared `Blocks12` note holding a note callout, a folded `[!tip]-`, an open `[!warning]+` with a list, an aligned table with bold and a link, a local image at `|200`, a `![[Ideas]]` embed, `==highlight==`, `%%comment%%` and a `js` code block, in headless Chromium at 1280×1150; Obsidian 1.14.4 on a private Xvfb display in its own network namespace, scratch profile, the same note in a copy of the test vault). Live Preview, unfolding the tip, and Reading view were shot for all four.

## How the three compared

Line counts from `rebuild/app` with the brief's commands (before = `981ef82`: TS app 16,294, tests 1,716, CSS 3,106, Rust 3,137, total 24,253):

| | Claude (merged) | Codex | Grok |
|---|---:|---:|---:|
| TypeScript, app | +1,123 | +678 | +1,669 |
| TypeScript, tests | +85 | +134 | +180 |
| CSS | +217 | +57 | +229 |
| Rust | +82 | +84 | +71 |
| **Total** | **+1,507** | **+953** | **+2,149** (over the ~1,500 budget) |
| Largest file after | 676 (`workspace.ts`) | 661 (`workspace.ts`) | 712 (`workspace.ts`) |
| New dependency / CSP / scope change | none | none | none |
| `#^block` embeds | done | skipped | done |
| Commits | 9 + notes | 16 + notes | 4 + notes |

- **Closest to Obsidian:** Claude. Side by side with Obsidian its callouts (no border, 12/24 px padding, chevron after the title), table, image, note embed (accent bar, bold note name, `maximize-2` open button), `%%` markers left visible in Live Preview, the "JavaScript" label on the code block and no label in Reading view all match what Obsidian draws. It also opens images from the file list in an image tab and checked `read_file_bytes` end to end in a Tauri window on a private display.
- **Codex:** the smallest and most careful about resource lifetimes (DOM-owned widget cleanup, per-path leases, path-targeted change events, a committed 106-line headless check script). Visible differences from Obsidian: the `%%` markers hide in Live Preview (Obsidian shows them), the embed has no note-name header, the code block label reads `js` and also shows in Reading view, and the inline `%%comment%%` was still visible in Reading view in this run. `#^block` embeds skipped.
- **Grok:** every item built, but a note embed shows the embedded note's raw frontmatter (`--- status: draft …`), callouts carry a left border and put the chevron before the icon (Obsidian has no border and the chevron after the title), and it went 43% over the line budget.
- **Checks:** all three build, pass their tests and the offline audit. On the merged tree on Cloud: `npm run build`, `npm test` (142 tests in 29 files), `npm run audit:offline`, `cargo build` and `cargo test` (31) pass.

## Ideas from the other two

- **Grok (ported in `5d347aa`):** the `#^block` link landing bug above. Also worth knowing: its small in-code PNG encoder for the mock (`mock/png.ts`), not ported because Claude's mock already paints a PNG on an `OffscreenCanvas`.
- **Codex (not ported):** remote `![[https://…]]` wiki embeds as offline link chips (Claude shows a "could not be found" box; both are offline-safe); embeds that follow the open editor's unsaved text on every change rather than on save (Claude's update 300 ms after typing pauses, which is enough); its `scripts/check-embeds.mjs` headless check (candidate for a shared harness; it is tied to Codex's DOM). None was small and clean to lift onto Claude's structure.

## Merged line counts (from `rebuild/app`)

| | Round 11 merged (`4e57533`) | Round 12 merged (`5d347aa`) | Change |
|---|---:|---:|---:|
| TypeScript, app | 16,294 | 17,424 | +1,130 |
| TypeScript, tests | 1,716 | 1,804 | +88 |
| CSS | 3,106 | 3,323 | +217 |
| Rust | 3,137 | 3,219 | +82 |
| **Total** | **24,253** | **25,770** | **+1,517** |

Largest files: `workspace.ts` 676, `graph/view.ts` 649, `styles/settings.css` 647, `shell/pane.ts` 625, `src-tauri/src/vault.rs` 561. None over 680. New files: `editor/blocks.ts`, `editor/callouts.ts`, `editor/tables.ts`, `editor/embeds.ts`, `editor/render.ts`, `embedHost.ts`, `styles/blocks.css`, `editor/blocks.test.ts`. One new command and permission: `read_file_bytes` / `allow-read-file-bytes`. No dependency, scope, CSP or `tauri.conf.json` change.

## Known gaps left after the merge

- Tables are source-on-touch, not Obsidian's in-place cell editor; no table context menu.
- No syntax highlighting in code blocks (Obsidian colours them in every mode).
- Images: no "Zoom in" and no drag-to-resize corner.
- Tasks inside a note embed can't be ticked; embeds inside a callout or table don't follow a target being created or removed until redrawn.
- No coloured highlight commands (Obsidian 1.14.4 has red, orange, yellow, green, blue, purple).
- Round 13 takes these. Search pane and properties leftovers from round 10 (match-case toggle, sort menu, match counts; File properties view; Rename/Delete property) wait for round 15.

---

# Round 12: callouts, tables, embeds and images (Claude's notes)

Branch `rebuild/r12-claude`, from `981ef82`. Every item of the brief is done, item 6 (code blocks) included; nothing was skipped except the few details listed under each item, with reasons.

## Summary

- **Checks:** `npm run build`, `npm test` (142 tests in 29 files, up from 131 in 28), `npm run audit:offline`, `cargo build` and `cargo test` (31, up from 30) pass.
- **Built:** callouts (all of Obsidian's types and aliases, folding), pipe tables, vault images (`![[pic.png|200x100]]`, `![alt](pics/a.png)`), note embeds (`![[Note]]`, `#Heading`, `#^block`) with a cycle and depth guard, `==highlights==`, `%%comments%%`, code blocks' language label and copy button, and images opened from the file list in an image tab. Live Preview and Reading view, light and dark.
- **One rendering path:** what a callout's body, a table's cells or an embedded note show is the Live Preview decorations of that text, painted into plain DOM (`render.ts`). There is no second Markdown renderer and no new dependency.
- **One new command:** `read_file_bytes` (vault-confined, images only, 20 MB cap), with its `allow-read-file-bytes` permission. No CSP, scope or `tauri.conf.json` change; the asset protocol stays off.
- **Checked in the real window too:** the Tauri debug build on a private Xvfb display, in its own network namespace with scratch `HOME`, ran a self-test: images load through `blob:` URLs with no CSP violation, every bad path is refused, embeds, callouts, tables and the image tab work in WebKitGTK.
- **Speed:** typing on the 5,000-line Big note, note switching, search typing, graph open, pan and zoom are unchanged (numbers below). A note with 30 embeds shows its text on the first frame and fills its visible embeds within about 35 ms, without moving the caret or the scroll position.
- **Size:** +1,507 lines (TS app +1,123, tests +85, CSS +217, Rust +82), on the brief's budget of about +1,500. No file over 676 lines.

## How Obsidian was observed

Obsidian 1.14.4 (the installed package) ran as Electron headless (`--ozone-platform=headless`) inside `unshare -rn` (its own user and network namespace), with scratch `HOME`/`XDG_*` and a fresh copy of a throwaway vault in the session scratchpad: notes with every callout type and alias, a folded and an open callout, aligned and wide tables, images in four sizes and two missing ones, note and heading embeds, a self-embed and an A ↔ B pair, highlights, comments and code blocks in several languages. Small PNGs were generated in code. A CDP script read the DOM, computed styles (light and dark) and positions, and drove keys and the mouse. No Obsidian source, CSS or asset was opened; `~/.config/obsidian` and the owner's vaults were never touched. Grove was then shown the same notes (created in the mock vault) and compared screenshot to screenshot.

## Item by item

### 1. Callouts

**What Obsidian does (observed):**
- The box: the type's colour at 10% as the background, 4 px radius, padding 12 px 12 px 12 px 24 px, no border. The title row holds a 16 px Lucide icon and the title (weight 600) in the type's colour, 4 px apart; the body starts 16 px below it, in the normal text colour, rendered as markdown.
- Types, icons and colours (light / dark): note, info, todo (`pencil`, `info`, `circle-check`; blue #086ddd / #027aff); abstract/summary/tldr, tip/hint/important (`clipboard-list`, `flame`; cyan #00bfbc / #53dfdd); success/check/done (`check`; green #08b94e / #44cf6e); question/help/faq, warning/caution/attention (`circle-help`, `triangle-alert`; orange #ec7500 / #e9973f); failure/fail/missing, danger/error, bug (`x`, `zap`, `bug`; red #e93147 / #fb464c); example (`list`; purple #7852ee / #a882ff); quote/cite (`quote`; grey #9e9e9e). An unknown type looks like a note; the default title is the type with a capital (`[!NOTE]` → "Note", `[!tldr]` → "Tldr").
- `[!type]-` starts folded, `[!type]+` open, with a chevron after the title. Clicking the chevron or the title folds and unfolds, without moving the caret or changing the file.
- Live Preview: the caret anywhere in the callout shows **the whole callout** as source (every `>`), not per line. Clicking the body puts the caret at the callout's start; arrow keys step into it from the line above or below. "Edit this block" (`code-2`) shows on hover.

**What Grove does now:** all of the above. The colours are tokens in `theme.css` (`--callout-blue` … `--callout-gray`, light and dark), the icons bundled Lucide icons. The title is markdown too. "Insert callout" still inserts `> [!NOTE]\n> ` with the caret inside, so the new callout shows as source until the caret leaves.

**Differences:** Obsidian's body is HTML with paragraph margins (16 px between a paragraph and a list); Grove's body is Reading view's lines, so a paragraph and a list inside a callout sit closer together, as they do everywhere in Grove's Reading view. A callout's fold state lives in its drawn box (as in Obsidian it isn't saved), so it resets if the box is drawn again (scrolled far away and back).

### 2. Tables

**What Obsidian does (observed):** a table with 1 px borders (`--background-modifier-border`), 4 px × 8 px cells, a bold (600) header row, columns aligned by `:---:`, inline markdown in cells. In Live Preview the table sits in a strip 16 px wider on each side that scrolls sideways when the table is wider than the column; words in cells stay whole. Clicking a cell edits it in place (Obsidian's table editor); arrow keys move through the cells. Obsidian's palette has "Insert table", which Grove already had.

**What Grove does now:** the same drawing in Live Preview and Reading view, and the same scrolling strip (`contain: inline-size` keeps it to the column's width whatever the table's). **Editing is source-on-touch, not in place:** a click on a cell puts the caret in that cell's source, and the table shows as markdown while the caret is in it; arrow keys step into it row by row. An in-place cell editor would mean a nested editor per cell, its own keymap and table-wide rewrites on each edit: not small or solid enough for this round.

### 3. Local images

**What Obsidian does (observed):** `![[pic.png]]`, `![[pic.png|200]]`, `![[pic.png|100x30]]` and `![alt](pics/a.png)` show inline in the line, 4 px radius, at the given size (`|200` sets the width, `|100x30` both). **The source does not come back when the caret touches an image** (checked with the caret at every position, with selections and with arrow keys: the caret steps over the image as one unit). Only the hover button "Edit this block" shows the source, with the link's path selected, until the selection moves. A missing image shows a grey box ("“nothere.png” could not be found."). Clicking an image in the file list opens it in a tab (view type `image`), centred, titled with the file's name without extension.

**What Grove does now:** all of that. Targets resolve like links (`links/internal.ts`, now also by a file's full name, as the backend's `link_index` does). Images are read only when drawn: `read_file_bytes` → `Blob` → `blob:` URL, one per image file shared by every embed of it, revoked as soon as nothing shows it or the file changes. `decoding="async"`, and the `|WxH` sizes are set on the `img` so the box is sized before it decodes. Remote images stay link chips, never fetched. The mock backend serves an SVG and a PNG painted on an `OffscreenCanvas`.

**Not done:** Obsidian's "Zoom in" button and its drag-to-resize corner.

### 4. Note embeds

**What Obsidian does (observed):** a 2 px accent bar on the left, the note's name in bold above its text (none for a heading embed), the text 24 px in, rendered as in Reading view, at most 4,000 px tall, and an "Open link" button (`maximize-2`) top right that opens the note in the tab. Links inside work. In Live Preview the caret on the embed's line shows `![[Target]]` with the embed still drawn below it. A missing note: "“Nope” is not created yet. Click to create." (a click creates it). Obsidian has **no cycle guard**, only a depth limit: a self-embed shows once inside itself, and A ↔ B nests five deep before a file chip ("CycA.md").

**What Grove does now:** the same, plus a real cycle guard, as the brief asks: a note drawn inside itself, or anywhere in its own chain, shows that file chip at once (and so does the sixth level). `#Heading` shows the section to the next heading of its level; `#^block` (cheap, so done) the paragraph ending in ` ^id`, without the marker. The embed reads the note through the app (its editor's text when the note is open, else from disk, cached), and draws again when the file changes: on `vault-changed`, and when an editor saves the note (300 ms after typing pauses), never per keystroke. Frontmatter isn't shown in embeds.

**Not done:** tasks inside an embed can't be ticked (Obsidian lets you; the checkbox would have to write to the other note).

### 5. Highlights and comments

**Observed:** `==text==` gets a yellow at 30% (#e0ac00 light, #e0de71 dark), markers hidden like bold's. `%%comment%%` in Live Preview is dimmed (`--text-faint`) **with its `%%` always visible**, not only on touch (the brief expected touch; Obsidian 1.14.4 shows them always); block comments across lines likewise. Reading view hides both kinds. Obsidian has "Toggle highlight" and "Toggle comment" (Ctrl+/) with no hotkey for the former; Grove already had both, the same. (1.14.4 also has coloured highlights, "Toggle red highlight" and so on; not this round.)

**Grove now:** the parser has `Highlight` (delimited like GFM's strikethrough), `Comment` (inline, nothing inside is markdown) and `CommentBlock` (a line opening `%%` to the next line holding `%%`, across blank lines), and Live Preview and Reading view draw them as observed.

### 6. Code blocks

**Observed:** in Live Preview the fences hide while the caret is outside the block and the opening line shows the language top right (12 px, muted; `js` → "JavaScript", `ts` → "TypeScript", `rust` → "Rust", `bash` → "Shell", `py` and unknown names as written; nothing without a language), which copies the code when clicked. Reading view shows a copy button on hover instead.

**Grove now:** the same, the copy through the clipboard helper (`writeClipboard`, next to the editor menu's copy). In Reading view the button appears while the pointer is over the block's first line (each line is its own element, so CSS can't see a hover over the whole block).

**Syntax highlighting (not done, as the brief says):** `@codemirror/language-data` plus the legacy modes would load a parser per language on demand: about 1.2 MB unminified over 100 languages, roughly 25–40 kB gzipped for the five or six most common ones if bundled up front, and a lazy-loading path (dynamic imports) that the offline audit would need to allow. The highlighting itself would be one `syntaxHighlighting` extension and a small theme; worth it only with a fixed set of bundled languages.

## How it is built

**Block widgets in a state field (`editor/blocks.ts`).** Replacing whole lines must come from a state field, not the Live Preview plugin. The field keeps a list of callouts, tables and comment blocks found among the syntax tree's top-level nodes. On a change, the blocks are mapped through it and only the stretch the change touched is scanned again, widened to the old and new top-level nodes around it (so opening or closing a fence redraws what it swallows or releases). When the parser gets further down a long note, only the newly parsed part is scanned. Typing never walks the document; a widget is drawn again only when its own text changes. The field follows the editor's focus, as Live Preview does: a pane you aren't typing in shows its blocks drawn.

**Inline widgets in Live Preview.** Images and note embeds are replacing widgets in the existing visible-range pass (`livePreview.ts`), so they cost nothing outside the viewport. A note embed is a block-level element inside its line; CSS hides the two empty caret buffers CodeMirror puts around it, which would add a blank line above and below.

**Rendering (`editor/render.ts`).** `decorate(text)` makes a throwaway `EditorState` of the text, parses it fully and asks every registered decoration source (Live Preview's pass, in Reading view's settings, and the block field's scan) for decorations; `paintLines`/`paintRange` turn them into DOM (lines as `.cm-line` with their classes, marks as nested spans, widgets as their DOM). A table paints each cell's range; a callout its body; an embed the note. Everything drawn is released with the widget that drew it (images let go of their URL, embeds stop watching).

**The app side (`embedHost.ts`).** One per workspace (`ws.embeds`): resolve a target from the note in a view, read a note (editor text if open; else disk, up to 100 cached, dropped when the file changes), hand out image URLs by reference count, and call watchers when the vault reports a file modified (`Vault.onModified`, fed by `vault-changed` and our own saves).

### New files and what they own

| File | Lines | Owns |
|---|---:|---|
| `src/editor/blocks.ts` | 167 | The block field: callouts, tables, comment blocks; source on touch; arrow keys into a block. |
| `src/editor/callouts.ts` | 112 | Header parsing, types and aliases, the callout widget (fold, click to edit). |
| `src/editor/tables.ts` | 91 | Row splitting, alignment, the table widget (click a cell to edit it). |
| `src/editor/embeds.ts` | 212 | Embed size and section parsing, the cycle guard, image and note embed widgets, "Edit this block", the shared widget base. |
| `src/editor/render.ts` | 143 | Decorations painted into DOM; the embed chain facet. |
| `src/embedHost.ts` | 78 | Reads, caches and blob URLs for embeds and image tabs. |
| `src/styles/blocks.css` | 197 | Callouts, tables, embeds, images, highlights, comments, code block flair. |
| `src/editor/blocks.test.ts` | 68 | Tests: callout headers, aliases and folds, table rows and alignment, embed sizes and sections, the cycle and depth guard. |

Changed: `syntax.ts` (highlight, comment, `![[` wikilinks, one `markdownSyntax` for editor and renderer), `livePreview.ts` (the pass is a function of state and selection; highlights, comments, code blocks, images, embeds), `fold.ts` (no chevron beside a drawn block), `tabs.ts`/`savedLayout.ts`/`workspace.ts`/`pane.ts` (image tabs; `graphFile` is now `viewFile`, the file a view tab shows), `links/internal.ts` (files by full name), `vault.ts` (`onModified`), `api.ts`, the mock.

## Dependencies, permissions, commands, CSP

- **Dependencies:** none added. The tables are `@lezer/markdown`'s GFM `Table` nodes, already in the tree; cells are split the same way the parser splits them.
- **Command:** `read_file_bytes(path) -> bytes`, documented in `CONTRACT.md`. Same path checks as `read_note` (`fsutil::resolve_in_vault`: no `..`, no absolute paths, nothing in `.grove/`/`.obsidian/`/`.git`/`.trash`, symlinks resolved and refused if they leave the vault), image extensions only, refused over 20 MB (checked on the open file, and the read itself is capped). It returns a `tauri::ipc::Response`, so the page gets an `ArrayBuffer`, not a JSON array. Rust test covers a good read and each refusal, including a symlink out and a sparse 20 MB + 1 file.
- **Permission:** `allow-read-file-bytes` (generated from `build.rs`) added to the default capability, which every new command needs. No scope, CSP or `tauri.conf.json` change; the CSP's `img-src blob:` was already there.

## Lines

Measured from `rebuild/app` with the brief's commands. Before is `981ef82`.

| | Before | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 16,294 | 17,417 | +1,123 |
| TypeScript, tests | 1,716 | 1,801 | +85 |
| CSS | 3,106 | 3,323 | +217 |
| Rust | 3,137 | 3,219 | +82 |
| **Total** | **24,253** | **25,760** | **+1,507** |

Roughly by item (app code and CSS; shared parts counted once):
- shared rendering and the block field (`render.ts`, `blocks.ts`, the Live Preview refactor, the widget base): about 400;
- callouts: about 170 (with their CSS and colour tokens);
- tables: about 110;
- images (widget, embed host, mock images, Rust command) and the image tab: about 330;
- note embeds: about 150;
- highlights and comments (parser and drawing): about 90;
- code blocks: about 75.

No single item reaches 400 on its own; the shared rendering is the largest piece because callouts, tables and embeds all draw through it.

**Largest files after:**

| File | Lines |
|---|---:|
| src/workspace.ts | 676 |
| src/graph/view.ts | 649 |
| src/styles/settings.css | 647 |
| src/shell/pane.ts | 625 |
| src-tauri/src/vault.rs | 561 |
| src/appCommands.ts | 540 |
| src-tauri/src/index.rs | 535 |
| src/editor/livePreview.ts | 524 |
| src/editor/properties.ts | 509 |
| src-tauri/src/watch.rs | 495 |

`livePreview.ts` grew to 524 (from 409); the block kinds went to their own files, as the brief suggests.

## Performance

**Setup:** headless Chromium 154 at 1280×800 against the Vite dev server and its mock vault (`?synthetic=1000`), with round 11's harness (`perf.mjs`) unchanged. The round's start (`981ef82`) was extracted with `git archive` and served on its own port; the two were run interleaved, six runs each (three mid-round, three on the final tree). Means / p95 in ms, as ranges over the runs.

| | Before (`981ef82`) | After |
|---|---|---|
| Typing on Big note (line 2,500), key → painted frame | 10.0–10.7 / 17.4–18.2 | 10.3–11.6 / 17.0–18.2 (median of means 10.4 vs 10.35) |
| Typing next to the settled 1,011-node graph | 10.2–11.5 / 17.3–18.6 | 10.7–11.3 / 17.6–18.4 |
| Note switch, Welcome ↔ Big note | 16.5–16.7 / 22.4–23.0 | 16.4–16.7 / 22.4–23.7 |
| Note switch, two notes with frontmatter | 16.4 / 17.1–17.6 | 16.4 / 17.1–17.4 |
| Graph open → first painted frame | 20.3–21.3 | 20.4–22.8 (one run 28.3, as in round 11's runs) |
| Pan / wheel zoom, frame mean / p95 | 16.7 / 16.7–16.8 | 16.7 / 16.7–16.8 |
| Search key → painted frame (`alpha gamma`, `garden 12`, `e`) | 9.7–10.3, 5.8–6.8, 10.8–11.7 | 9.3–10.0, 5.4–6.1, 10.1–11.6 |

**Typing beside callouts and tables:** a copy of Big note with a callout and a table after every 100 lines (about 100 blocks), typing three lines above a drawn callout and table: 9.3–11.2 / 17.3–18.1 after, against 9.6–10.6 / 17.4–18.0 for the same note before (where the blocks are plain text). The block field maps its list and rescans only the edited paragraph; nothing walks the note.

**A note with 30 embeds** (15 images, 15 note embeds, text between them; three runs):
- the first frame already has the note's text: 10.2 ms of work, 18.3–18.6 ms to the painted frame (Welcome → the note);
- the embeds on screen are filled 24.6–30.3 ms after the open began; the others are drawn only when scrolled to;
- the caret and the scroll position didn't move while they filled (0 and 0 px);
- blob URLs: 2 alive after opening (one per image file, shared by every embed of it), still 2 after scrolling to the bottom and back five times, 0 after switching to another note.

**Embeds follow their note:** editing the embedded note in another pane redrew the embed 301 ms later (the save), not on each keystroke.

**Bundle:** `index.js` 848.4 → 866.5 kB (gzip 290.4 → 297.0 kB), `index.css` 62.6 → 63.9 kB: the new modules and nine more Lucide icons.

**In the Tauri window (WebKitGTK, private Xvfb, network namespace, scratch HOME; behaviour only, not timed):** the self-test opened the image, embed, callout, table and inline notes and an image tab, and wrote its findings into the scratch vault. All four images loaded through `blob:` URLs at their sizes (400, 200, 100 and 120 px wide), the two missing ones showed their boxes, the remote one stayed a link, no `securitypolicyviolation` fired, `read_file_bytes` returned an `ArrayBuffer` and refused `../outside.png`, `.grove/x.png`, `Target.md`, `nope.png`, `/etc/x.png` and `pics/../../outside.png`; callouts had their colours (`color-mix` works in WebKitGTK), the wide table scrolled (732 px wide, 2,043 px of table), and the self-embed and A ↔ B pair stopped at the file chip. Xvfb, Vite and the window were stopped afterwards; nothing opened on the owner's screen.

## Caveats

- Measured in headless Chromium; the Tauri window was checked for behaviour (Xvfb, software GL), not timed.
- The table editor is source-on-touch, not Obsidian's in-place cell editor (see item 2).
- A Reading view click on a callout body does nothing (Obsidian's Reading view doesn't edit either); in Live Preview it puts the caret in the callout, as Obsidian does.
- Embeds inside a callout or table don't redraw when a file they point at is created or removed until the callout is drawn again (their target is resolved when the callout is drawn); top-level embeds follow at once.
- The scratch harnesses (CDP drivers, the Obsidian sandbox, the Xvfb self-test, scratch vaults) are in the session scratchpad and not committed.
