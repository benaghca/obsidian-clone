# Switching from Cinder to Grove: gap plan

Written 2026-11-04 on `rebuild/cinder-gap-plan-claude`, from `rebuild/integration` `619ba27`. This is a plan only. No app code changed, nothing was pushed, no window was opened and no vault was touched.

Paths below are relative to `rebuild/app/` unless they start with `rebuild/` or `ui/`. Cinder is the old app at the repo root (`ui/`, `src/`). CONTRACT.md calls it "reference only; do not edit it". It is Chris's own code, so agents may read it for behaviour and test cases, but they rewrite in TypeScript and copy nothing from it that came from a third party (see Excalidraw).

## In plain words

**What Grove already has:**
- **Templates:** Insert template, a template folder, and the `{{title}}`, `{{date}}`, `{{time}}` variables with per-use formats.
- **Daily notes:** today's note, previous/next, and settings for date format, folder and template.
- **Bases:** table, cards, list and Kanban views, plus formulas, grouping, summaries, search and embeds. B0–B6 and K1–K8 are merged.
- **Canvas:** smooth zoom up to about 1,000 cards (CZ0–CZ5 and CZ-H are merged).
- **Images:** pasting or dropping saves to the attachment folder and writes `![[img]]`. Images can be resized by dragging their corner.

**What's missing before Chris can switch:**
1. **Pasting a screenshot almost certainly fails in the real app.** Cinder's own notes say WebKitGTK gives the page an empty paste event for images, so Cinder reads the clipboard natively. Grove has no native fallback.
2. **Grove doesn't read Cinder's settings, and it doesn't hide the `.cinder/` folder.** Chris's work vault would open with the wrong daily-note folder, template folder and attachment folder. Cinder's `.cinder/settings.md` and `.cinder/README.md` would also show up as notes.
3. **No calendar view.**
4. **Inserting a template doesn't merge its properties.** A template's `---` block is pasted into the middle of the note.
5. **No canvas presentation mode.**
6. **No web-page embeds.** Grove's lockdown blocks every frame (`frame-src 'none'`, and the navigation guard allows only Grove's own pages). Round 23 made link cards text-only on purpose.
7. **No drawings at all.** Grove doesn't open `.excalidraw` files.
8. **CZ6:** at 3,000 cards, one compositor frame during a wheel zoom still takes 55–78 ms. It hasn't been measured in the real app.

**Proposed order:** small, cheap pieces first, so Chris can switch soon. Most of them are Grok work. The steps are:
1. Switch-day settings import
2. Native image paste
3. Template fixes
4. Daily-note fixes
5. Calendar view
6. A Bases compatibility check
7. **Read-only drawings**, so existing `.excalidraw` files and their embeds show

After step 7 (about 40–50 agent hours) Chris can switch. Presentation, web embeds, drawing *editing* and CZ6 follow, one piece at a time (§10).

---

## 0. Switch day (a gap that isn't on the list but blocks switching)

**What Grove has.**
- Settings live in `.grove/*.json` (`src/settings/store.ts`, `src/settings/schema.ts`), read through `read_config`.
- `read_config` reads only from `.grove/` (CONTRACT.md).
- `SKIP_DIRS` in `src-tauri/src/fsutil.rs:15` hides `.obsidian`, `.git`, `.trash` and `.grove`.

**What's missing.**
- **`.cinder/` isn't hidden.** Cinder keeps `.cinder/settings.json`, `settings.md` and `README.md` in the vault (repo `README.md`, Settings section). Grove would list, index and search the two `.md` files.
- **Nothing is imported.** Cinder's keys (`ui/app/*.js`, `cfg.*`) that matter here are:
  - `dailyFolder`, `dailyFormat`, `dailyTemplate`;
  - `weeklyFolder`/`Format`/`Template`, `monthlyFolder`/`Format`/`Template`;
  - `templatesFolder`, `folderTemplates`;
  - `attachFolder`, `newNoteFolder`;
  - `weekStart`, `webEmbeds`, `drawingFormat`.

  Grove also doesn't read `.obsidian/daily-notes.json`, `templates.json` or `app.json` (`attachmentFolderPath`).

**Size:** S, about 5–7 hours.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **M0a** | **Rust.** Add `.cinder` to `SKIP_DIRS`. Add a read-only `read_foreign_config(source, name)` with a fixed allowlist: `.cinder/settings.json`, and `daily-notes.json`, `templates.json`, `app.json` in `.obsidian/`. Same 1 MB cap and symlink rule as `read_config`. Async. Update CONTRACT.md. | Grok a | `cargo test --offline` (hidden `.cinder`, allowlist refusals, symlink out of the vault); the `every_command_is_in_build_manifest_and_default_capability` test |
| **M0b** | **TS.** On the first open of a vault with no `.grove/` settings, map those keys into `daily-notes.json`, `templates.json` and the attachment/new-note settings. Show one notice listing what was imported. Never write to `.cinder/` or `.obsidian/`. Mock backend support. | Grok a | Vitest for the key mapping (Cinder, Obsidian, both, neither, bad JSON); a browser script on a mock vault holding a `.cinder/settings.json`; `npm run build`; `npm run audit:offline` |

**Chris (10 minutes, after M0):** copy the work vault to `/tmp` yourself, open the copy in a release build, and note anything that looks wrong. Agents may not open the real vault or a window.

## 1. Templates

**What Grove has.**
- **Commands** (`src/appCommands.ts:151-159`, `:481-486`): *Templates: Insert template*, *Insert current date* and *Insert current time*.
- **The picker** is `src/shell/templatePrompt.ts`.
- **Settings:** template folder, date format and time format (`src/settings/sections.ts:463-470`, schema `TEMPLATES` in `src/settings/schema.ts:106`).
- **Variables:** `fillTemplate` in `src/settings/dateFormat.ts` fills `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` and `{{time:FORMAT}}`, with Moment-style tokens. It is tested in `src/settings/dateFormat.test.ts`.
- **The core-plugin switch** is in `src/settings/plugins.ts`.
- **History:** recorded in `rebuild/ROUND19_NOTES.md`, `rebuild/BUGFIX_NOTES-dates-md-grok-b.md` and `rebuild/NOTES_BUGFIX-DATES-MD-REVIEW.md`.

**What's missing for how Chris works.**
- **Properties aren't merged.** `insertTemplate` puts the whole template text at the cursor. A template with a `---` block ends up as a second frontmatter block in the middle of the note. Obsidian merges the template's properties into the note's own.
- **No *Create new note from template*.** Cinder has it on Alt+N.
- **Cinder-only extras that Grove doesn't have:** Templater syntax (`<% tp.date.now() %>`, prompts, `tp.file.cursor()`), folder templates, and the template bar with preview and cheat sheet (`ui/templater.js`, 663 lines; `ui/app/template-help.js`). Whether these are needed depends on Chris's work templates (Choice 1).

**Size:** S for the core, about 5–6 hours. Templater would be L, about 14–20 hours, and only if Choice 1 says so.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **T1** | Merge the template's properties on insert. A pure function, `mergeTemplate(noteText, templateText)`. The note's existing keys win. List values are unioned. The body goes in at the cursor. CRLF is kept. A note with no frontmatter gets the template's block at the top. One undo step. | Grok b | Vitest: no frontmatter, both sides with frontmatter, list union, CRLF, BOM, empty template. The `test-paste.mjs` style browser check: insert into the mock note, then Ctrl+Z |
| **T2** | *Templates: Create new note from template*. Pick a template, create `Untitled` in the new-note folder (`newNote` in `src/fileOps.ts`), fill it in with the new title, focus the inline title. | Grok b | Browser script: the command palette flow, the template filled in, the title editable |
| *T3 (Choice 1)* | A Templater subset, rewritten in TS from Cinder's behaviour and test cases (`ui/test/templater.test.js`). It is three pieces. **T3a** is the pure interpreter (no `eval`, no JavaScript, no `tp.web`). **T3b** is the commands, `tp.system.prompt` and `suggester`, and `tp.file.cursor`. **T3c** is folder templates. | Claude (T3a), Grok (T3b, T3c) | Vitest corpus ported from Cinder's tests; `npm run audit:offline` (no network or `eval`) |

## 2. Bases

**What Grove has.** This is the most complete of the eight. `src/bases/` holds about 30 modules.
- **Views:**
  - table: `view.ts`, `columns.ts`, `cells.ts`;
  - cards: `cards.ts`;
  - list: `list.ts`;
  - Kanban: `kanban.ts`, `move.ts`, `history.ts`.
- **Logic:**
  - formula language: `expression.ts`, `functions.ts`, `dates.ts`;
  - filters: `filters.ts`, `filterMenu.ts`;
  - Group by and summaries: `groups.ts`, `summaries.ts`;
  - search: `search.ts`;
  - export: `results.ts`.
- **Embeds** (`![[x.base]]`, `![[x.base#View]]`, `` ```base `` blocks): `embed.ts` with the hooks in `src/editor/embeds.ts`.
- **Writing properties:** Kanban moves write through the Rust `set_property` command (CONTRACT.md).
- **Notes:**
  - plan: `rebuild/BASES_PLAN.md`;
  - pieces: `rebuild/NOTES_BASES-B0`…`B6*.md`;
  - Kanban: `rebuild/KANBAN_PLAN.md`, `rebuild/NOTES_K*.md`, `rebuild/NOTES_KANBAN-*.md`;
  - edge tests: `rebuild/NOTES_BASES-EDGE-TESTS*.md`.

**What's missing.**
- **For switching, nothing confirmed.** Nobody has checked that the `.base` files Cinder wrote open unchanged in Grove. Cinder's Bases (`ui/bases.js`) has table, cards, list and board views and writes view changes back into `` ```base `` blocks. Grove's model is Obsidian's, but Cinder may write keys Grove doesn't read.
- **Performance at large vaults:**
  - B7, the Rust pre-filter, waits on `RUST_PERF_PLAN.md` approval and on P2.
  - Grouped views take about 70 ms to update at 50,000 rows (`rebuild/NOTES_B6.md` item 3, `rebuild/NOTES_BASES-B6-REVIEW.md:63`).

  Neither matters below about 20,000 notes.

**Size:** S to confirm, about 2–3 hours. B7 is M, about 8–12 hours, after P2.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **BX1** | A Cinder → Grove `.base` corpus: every view type and key that `ui/bases.js` reads or writes (taken from its code and from `ui/test/bases.test.js`) becomes a fixture under `fixtures/`. Assert that Grove parses each one, draws the right view type, and makes no byte change on open or on a no-op edit. List anything unsupported in the notes. Fix only trivial gaps; anything bigger becomes a follow-up piece. | Grok c | Vitest over the fixtures; `test-bases-embed.mjs` and `test-bases-edge.mjs` still pass |
| *B7* | The Rust pre-filter, as in `RUST_PERF_PLAN.md` P7 / `BASES_PLAN.md` B7, after P2 (Choice 4). | Codex if it has usage, otherwise Claude | `cargo test`, parity fixture `bases-leaves.json`, `bench-bases-*.mjs` at 50k |

## 3. Canvas, including CZ6

**What Grove has.**
- **The canvas itself** (`src/canvas/`, 18 modules):
  - text, note, image and link cards;
  - groups;
  - edges with labels;
  - snapping and alignment guides.
- **Zoom work, CZ0–CZ5 and CZ-H, merged** (`rebuild/CANVAS_ZOOM_PLAN.md`, `rebuild/NOTES_CZ0`…`CZ5*.md`, `rebuild/NOTES_CZH*.md`):
  - nothing but the transform changes during a zoom frame (`navigation.ts`);
  - title mode below 45%, back to full content above 55%;
  - lazy bodies with a spatial index and a work queue (`bodies.ts`, `spatial.ts`, `work.ts`);
  - batched, clipped edges in title mode (`edges.ts`, `edgeClip.ts`);
  - the right-click menu, Add web page and Paste (`cards.ts`, `controls.ts`);
  - Ctrl+drag to create;
  - Ctrl+hover previews.
- **Measuring tools:**
  - `scripts/bench-canvas-zoom.mjs`;
  - the debug-only command *Canvas: measure zoom* (`src/canvas/measureZoom.ts`, registered in `src/appCommands.ts:254`).

**Where CZ6 stands** (`rebuild/NOTES_CZ3.md`, "Measurements and remaining limits", and `rebuild/NOTES_CZ3-REVIEW.md:69`):
- **Within target at 100–1,000 cards.** Headless Chromium (software) has no task over 50 ms. At 1,000 cards a pinch costs 3.1 ms per update.
- **Over target at 3,000 cards / 4,000 edges.** The wheel gesture still has 54.9 and 78.0 ms tasks and 6 dropped frames. One isolated 43 ms task broke down as:
  - `RunPaintLifecyclePhase` 24.8 ms;
  - `Layerize` 20.2 ms;
  - `Commit` 12.7 ms.

  That is one compositor frame, not JavaScript the work queue can slice. A full queue drain takes about 1.3 s.
- **Never measured in the real app.** Nobody has run CZ0's in-app command in WebKitGTK. The plan's CZ6 (Z8, freezing the raster during a gesture) was to ship "only if CZ0 shows per-step re-raster in WebKitGTK". WebKitGTK also caps every frame at 60 Hz on Chris's machine (§9), so the bar there is 16.7 ms.

**What's missing:** the real-app number, then a fix for 3,000-card zooming if it's still slow there. Nothing else in Canvas is a switch blocker. Presentation is §4, and web pages on canvas are §6.

**Size:** M, about 10–14 hours in total.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **CZ6a** | **Measure first.** A script that writes a scratch vault to `/tmp/grove-cz6-vault`: 300-, 1,000- and 3,000-card boards, the same generator as the bench, written as real `.canvas` files. Two-line run instructions in the notes. Then **Chris** opens it in a debug build, runs *Canvas: measure zoom* on each board, and pastes the p50/p95/max frame gaps into the notes. | Grok c (script), Chris (5 minutes) | Script unit-checked; `npm test` unchanged |
| **CZ6b** | **Only if the real 3,000-card numbers miss** (p95 over 17 ms or any gap over 50 ms). Try in this order and keep what measures best. **1.** Z8 as planned: during a gesture, drive the world transform with a paused Web Animation, so the engine reuses the raster, and re-raster once at settle. **2.** If 1 doesn't move the 3,000-card frame, then in title mode during a gesture draw the titles and batched edges into one `<canvas>` bitmap made at settle. The DOM cards stay hidden until the next settle, so the frame cost no longer grows with the card count. | Claude | `bench-canvas-zoom.mjs` before/after (all four sizes; 3,000 wheel: no task over 50 ms, at most 6 drops per 24 inputs; 1,000 no worse); `test-canvas-lazy.mjs`, `test-canvas-navigation.mjs`, `test-canvas-hit-area.mjs`; full `npm test`; Chris reruns CZ6a's command |

## 4. Canvas presentations

**What Grove has.**
- **Groups** (`src/canvas/groups.ts`) and **edges between them** (`edges.ts`) to build slides from.
- **`fit(bounds)` in `navigation.ts:118`,** which already zooms to a box. It jumps; there's no glide.
- **The CZ rule** that a frame only moves the transform.
- **No presentation mode.** Grove has no fullscreen call: the window capability doesn't include `set-fullscreen`.

**What Cinder does,** which is what Chris is used to (`ui/canvas.js:981-1030`, repo `README.md` Canvas section):
- **Slides:** each group is a slide, or each card if there are no groups. Arrows between groups set the order; otherwise it's reading order.
- **Starting:** F5 or the ▶ button. It goes full screen with the chrome hidden and glides between slides. If a group is selected, the presentation starts there.
- **Keys:** →, Space or click goes forward. ← or right-click goes back. Home and End jump to the ends. Esc stops.
- Links and embedded pages still work.

**Size:** M, about 10–13 hours.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **PR1** | `src/canvas/slides.ts`, pure: the slide order. Groups first; arrows between groups give the order (ignoring cycles, with a stable tie-break); otherwise reading order (rows by `y`, then `x`); cards if there are no groups; start index from the selection. | Grok a | Vitest: no groups, a chain, a branch, a cycle, nested groups, an empty board |
| **PR2** | **Presentation mode.** Start it with *Canvas: Start presentation* (F5 inside a canvas) or a ▶ in the canvas controls. Hide the ribbon, sidebars and tab strip. Go fullscreen through Tauri's window API, adding `core:window:allow-set-fullscreen` to `capabilities/default.json` (one line; the Rust owner reviews it). Glide between slides with one transform animation and nothing else written per frame. Render each slide's bodies *before* the glide, so a large group never shows title mode. The board is read-only while presenting. Esc restores the layout and the zoom. | Claude | Browser script `test-canvas-present.mjs` (keys, click, right-click, start from the selection, Esc restores the viewport and the chrome, links still open); compositor-frame check on a 300-card board during transitions, as in `test-canvas-navigation.mjs`; `cargo test` (capability test); `npm run audit:offline` |

## 5. Pasting and embedding images

**What Grove has.**
- **Where pasted or dropped files go** (`src/editor/attachments.ts`):
  - Obsidian's attachment folder rules (`/`, `./`, `./sub`, or a folder);
  - the name `Pasted image YYYYMMDDHHmmss.png`;
  - a free name when the file name is taken;
  - an embed written in the link style the settings ask for.

  Tested in `attachments.test.ts`.
- **The paste handler** (`src/editor/clipboard.ts`):
  - the paste event's files first;
  - then `navigator.clipboard.read()` (`pasteImages`).
- **Embeds and the viewer** (`src/editor/embeds.ts`):
  - `![[img.png|300]]` and `![alt|300](img.png)`;
  - drag the corner to resize, which writes the size in Obsidian's style (`resizedSize`);
  - the zoom view (`imageZoom.ts`).
- **Rust:**
  - `read_file_bytes` (8 image types, up to 20 MB);
  - `write_file_bytes` (CONTRACT.md, `src-tauri/src/vault.rs`).
- **Notes:** `rebuild/ROUND21_PASTE_TASK.md`, `rebuild/ROUND22_NOTES.md`, `rebuild/ROUND27J_NOTES.md`; browser test `scripts/test-paste.mjs`.

**What's missing.**
- **No native clipboard read, so screenshot paste likely fails in the real app.** Cinder's `src/clipboard.rs` explains why it reads the clipboard natively: "WebKitGTK (the Linux window) gives the page an empty paste event when the clipboard holds an image". Grove's fallback, `navigator.clipboard.read()`, needs WebKit's clipboard permission, which wry doesn't grant as far as we know. Every paste test so far ran in headless Chromium, never in WebKitGTK.
- **`write_file_bytes` is slow for big images.** It is a plain (sync) command, so it runs on the GTK main thread (`src-tauri/src/lib.rs`, the list of non-`async` commands). It also takes the bytes as a JSON array of numbers. A 5 MB screenshot becomes about 15–20 MB of JSON parsed on the UI thread, which would show as a visible hitch.
- **No pasting an image onto a canvas.** CZ4 added Paste for text and URLs only (`src/canvas/cards.ts`).

**Size:** S–M, about 8–10 hours.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **I1** | **Rust.** Add `read_clipboard_image() -> Option<bytes>`, async. On Wayland it uses `wl-paste --list-types`, then reads one image type; on X11, `xclip`. It uses only `std::process`, with no new crate and no network. "No clipboard tool" becomes a clear error. Make `write_file_bytes` async and have it take a raw body (`tauri::ipc::Request`) instead of a JSON number array. Update CONTRACT.md. The design follows Cinder's `src/clipboard.rs` (our own code), rewritten. | Grok b | `cargo test --offline` (type picking, a missing tool, size cap); capability test; a Rust bench writing 10 MB stays off the main thread |
| **I2** | **TS.** When a paste carries neither a file nor text, call `read_clipboard_image`, then save and embed it as today. Also pasting an image on a canvas makes an image card at the pointer, extending CZ4's Paste. Mock support. | Grok b | `test-paste.mjs` extended (no-file paste → mock command → embed written; canvas image paste → media card, undo); `npm run audit:offline` |
| **I3** | **Chris, 5 minutes in a release build:** take a screenshot (`grim -g "$(slurp)" - \| wl-copy`), paste it in a note and on a canvas, drag a file in from the file manager, and resize the image. | Chris | Pass or fail goes in the I2 notes |

## 6. Embedding web pages

**What Grove has, and why it can't yet.**
- **The CSP:** `src-tauri/tauri.conf.json` has `frame-src 'none'` and `child-src 'none'`.
- **The navigation guard:** `src-tauri/src/lockdown.rs` allows only the app's own origin and denies every new window. A frame's load is also a navigation, so it would be blocked too.
- **The audit:** `scripts/audit-offline.mjs` fails the build on network APIs and remote URLs.
- **What notes do today:** a remote image is a link chip that is never fetched (`src/editor/livePreview.ts:352`).
- **What canvas link cards do today:** they show the URL as text only (`src/canvas/view.ts:232-238`). That was a deliberate Round 23 rule: "no fetching, no iframe, no preview" (`rebuild/ROUND23_CANVAS_TASK.md:24`).
- **Add web page** (CZ4) makes link cards (`src/canvas/cards.ts:90-110`).

**What Cinder does** (repo `README.md`, Features and "For IT"; `src/native.rs:88-135`; `src/api.rs:124`):
- **In notes:** `![](https://…)` alone on a line becomes a live page in a sandboxed frame. Drag the corner to resize, which writes `![|600x400](…)`. YouTube and Vimeo links become their players. A bar above the page reloads it or opens it in the browser.
- **On canvases:** link cards show the page too.
- **Settings:** load pages always, on click, or not at all.
- **Security:** the CSP has `frame-src http: https:`. The page registers each frame's origin with the backend, and the navigation guard allows only those.

**What's missing:** all of it, plus security decisions that need to be explicit, because this is the one feature that breaks "no network by default":

- **Default: nothing loads until Chris clicks** (Choice 2). With the default setting, opening a vault, or a note or canvas with embeds, makes no network request. That keeps today's guarantee.
- **The frame:**
  - `sandbox="allow-scripts allow-same-origin allow-forms"`. With no `allow-top-navigation`, the page can't navigate Grove away. With no `allow-popups`, new windows are denied by the guard anyway.
  - `referrerpolicy="no-referrer"`.
  - No `allow=` features: no camera, microphone, location or clipboard.
  - `loading="lazy"`.
  - A cross-origin frame can't reach Grove's DOM.
- **IPC stays local:** Tauri's capabilities name only the app's windows and origin, so a framed page can't call Grove's commands. W1 adds a test for this rather than assuming it.
- **The guard:** the main frame stays locked to the app's origin. A frame may load only an `http(s)` origin that the page registered just before creating that frame (Cinder's design). Everything else is still blocked.
- **Cookies and storage:** framed sites keep cookies in WebKit's data folder, as a browser does. WebKit's default third-party cookie blocking applies. Settings gets *Clear embedded page data* if Chris wants it (a later piece).
- **The audit:** `audit-offline.mjs` gets a commented allowlist entry for the new `frame-src` and for the embed code. The audit still fails on `fetch`, XHR, WebSocket and the rest.

**Size:** M, about 16–20 hours.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **W1** | **Rust and config.** `frame-src https: http:` in both CSPs. An `allow_frame_origin(origin)` command (async, `http(s)` only, origin form checked). The guard: the main frame is unchanged; other navigations are allowed only to registered origins; new windows are still denied. The audit allowlist entry. Check that wry's `on_navigation` actually sees frame loads on WebKitGTK, which Cinder's design implies, and record the result. | Grok c | `cargo test --offline` (guard table: app origin, registered frame origin, unregistered, `file:`, `javascript:`, a main-frame navigation to a registered origin is refused if the API can tell main frame from subframe); `npm run audit:offline`; a test that IPC from a non-app origin is refused |
| **W2** | **Notes.** `![](https://…)` alone on a line becomes a web embed in live preview and reading view. It has a bar (Load, Reload, Open in browser), resizes to `![|WxH](url)`, and turns YouTube/Vimeo links into player URLs. Settings → Editor, *Embedded web pages*: Off / Click to load / Always (default from Choice 2). The sandbox attributes above. | Claude | Browser script against a **local** `127.0.0.1` fixture server (no internet): Off draws a chip; Click draws nothing until clicked; Always loads; resize writes the size, one undo step; Esc and the caret behave as with an image embed. `npm run audit:offline` |
| **W3** | **Canvas.** A link card shows its page with the same setting. Only on-screen cards above the title threshold get a frame, and there are at most 6 live frames (LRU through the `bodies.ts` queue). `pointer-events: none` until the card is selected, so the wheel still zooms. No frames in title mode. | Grok c | `test-canvas-cards.mjs` extended; `bench-canvas-zoom.mjs` with link cards and frames on vs off (no regression at 300 and 1,000 cards); `test-canvas-lazy.mjs` |

## 7. Calendar and daily notes

**What Grove has.**
- **`openDailyNote` in `src/editorHost.ts:37`:** opens today's note, or creates it from the daily-notes template with `{{date}}` and the other variables filled in for that day.
- **Commands** (`src/appCommands.ts:123-142`, `:281-285`): *Open today's daily note* and previous/next. Previous/next are ordered by `dateNamePattern`, which refuses impossible dates (`rebuild/BUGFIX_NOTES-dates-md-grok-b.md`).
- **Settings:** date format with a live preview, folder, and template (`src/settings/sections.ts:420-458`, schema `DAILY_NOTES`).
- **A ribbon button** (`src/main.ts:140`).
- **Date properties open their daily note** (`openDaily` in `src/editor/host.ts:39`, `src/editorHost.ts:121`).

**What's missing.**
- **A calendar view.** There is no calendar module anywhere in `src/`. Cinder's (`ui/app/calendar.js`) is a right-sidebar month view:
  - a dot on each day that has a note, with more dots for longer notes;
  - a ring on days with tasks due;
  - click a day to open or create its note, and Ctrl+click for a new tab;
  - click a week number for the weekly note, or the month's name for the monthly note;
  - weeks start on Monday or Sunday.
- **Small daily-note gaps:**
  - `formatDate` has no `GGGG`, the ISO week-year token Cinder's weekly format uses (`TOKENS` in `src/settings/dateFormat.ts`).
  - Formats with folders (`YYYY/MM/YYYY-MM-DD`) need a test that creating the note and moving to previous/next both work.
  - There's no *Open daily note on startup*.
- **Weekly and monthly notes** (Cinder has them). Choice 1.

**Size:** M, about 9–12 hours, or about 14 with weekly and monthly notes.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **C1** | Add the `GGGG`/`gggg` tokens. Make formats with folders work for creating the note (parent folders) and for previous/next. Add *Open daily note on startup* (a setting, off by default). | Grok a | Vitest in `dateFormat.test.ts` (week-year at New Year, `YYYY/MM/…` round-trip); browser check that the startup option opens or creates the note once |
| **C2** | **The Calendar view** in the right sidebar, built on the `src/shell/sideView.ts` pattern. A month grid with today marked and a dot on days that have a daily note. Click a day to open or create its note (`openDailyNote`); Ctrl+click opens it in a new tab. Previous/next month and Today. A week-start setting. It updates on vault changes, reading from `ws.vault.notes`, and does no I/O while drawing. It is part of the Daily notes core plugin. Tasks-due rings are left out; they need the Tasks feature, which Grove doesn't have. | Grok b | Vitest for the month-grid maths (week start, leap years, the 6-row month); browser script: open the view, click a day with and without a note, check the template is applied, check the dot appears after a create |
| *C3 (Choice 1)* | Weekly and monthly notes: settings, commands, and week-number and month-name clicks in C2's view. | Grok a | Vitest and a browser check, as in C1 and C2 |

## 8. Excalidraw drawings (our own code)

**What Grove has: nothing.**
- `.excalidraw` files are listed in the file tree. `read_note` and `write_note` already read and write any text file (`src-tauri/src/vault.rs:54,92`).
- There's no view for them. `workspace.ts:475,514` routes only images, `.canvas` and `.base` to views.
- No embed, and no canvas card preview.

**What Cinder has, and what we must not reuse.** Cinder's drawing editor is Chris's own code: `ui/draw.js` (1,972 lines), `ui/draw-render.js` (1,208) and `ui/app/drawings.js` (340). It's a good guide to behaviour and the file format, but three parts of it fall under the rules:
- **The hand-drawn line and ellipse maths is adapted from rough.js,** and the `.excalidraw.md` decompression from lz-string (`ui/draw-render.js:7-8`, `ui/vendor/draw-ports.LICENSE`). Both are MIT third-party code. **Don't port them.**
- **The `Virgil` font is Excalidraw's** (`ui/vendor/Virgil.woff2`). **Don't ship it, or Excalifont.** Hand-drawn text uses a system cursive font, and "code" uses JetBrains Mono or monospace. Text boxes keep their stored `width` and `height`, so the layout holds even though the glyphs differ.
- **Equations use MathJax** (vendored). That would be a new package. **Leave it out.** A math element stays in the file untouched and draws as a labelled box.

**The format,** as Grove will handle it: `.excalidraw` is JSON `{type: "excalidraw", version: 2, source, elements[], appState, files}`.
- Elements have a common base: `id`, `type`, `x`, `y`, `width`, `height`, `angle`, `strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `strokeStyle`, `roughness`, `opacity`, `seed`, `version`, `versionNonce`, `isDeleted`, `groupIds`, `frameId`, `roundness`, `boundElements`, `updated`, `link`, `locked`.
- Then each type adds its own fields:
  - `points` for `line`, `arrow` and `freedraw`;
  - start and end bindings and arrowheads for `arrow`;
  - `text`, `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `containerId` and `lineHeight` for `text`;
  - `fileId`, `status` and `scale` for `image`.
- `files` maps `fileId` to `{mimeType, dataURL}`.

The rules for Grove:
- **Keep what it doesn't understand.** Unknown keys and unknown element types are kept, and a no-op save writes identical bytes. That is the same rule as JSON Canvas (`rebuild/ROUND23_CANVAS_TASK.md:16`).
- **Mark what it changes.** A changed element gets a new `version`, `versionNonce` and `updated`.
- **Leave `.excalidraw.md` alone.** That's the Obsidian plugin's format. Chris asked for `.excalidraw`, and Cinder writes it by default. Those files stay ordinary notes unless Chris asks; see Choice 1.

**Size:** L, about 45–60 hours. That makes it the biggest item. A read-only first step (X1 and X2, about 15 hours) lets Chris see his existing drawings and their embeds when he switches.

| Piece | What | Agent | Checks |
|---|---|---|---|
| **X1** | **`src/drawing/scene.ts`: the file model.** Parse and validate, with defaults per element type. Serialize with key order and unknown fields kept. Bump `version`/`versionNonce`/`updated` on change. Refuse, and never overwrite, a file that isn't Excalidraw JSON. Fixtures: hand-written ones, plus a few saved by Cinder's editor. Generating those from Cinder's own code in a test-only script is fine; nothing from it ships. | Claude | Vitest: a byte-stable round trip on every fixture, unknown keys and types kept, a deleted element kept, a bad file refused, a 5,000-element parse in under 20 ms |
| **X2** | **Read-only rendering.** `src/drawing/render.ts` turns a scene into SVG. It covers: rectangle, diamond and ellipse with roundness; line, and arrow with the stored arrowheads; freedraw as a smoothed path; text with stored size, alignment and container placement; image from `files` through a `blob:` URL; solid, hachure and cross-hatch fills (our own pattern code); dashed and dotted strokes; opacity; angle; and dark mode. Clean lines first (Choice 3). Also: a `drawing` tab type for `.excalidraw`, with pan and zoom using the canvas's transform-only rule; `![[x.excalidraw]]` and `![[x.excalidraw\|400]]` embeds in notes; previews in canvas file cards. | Claude | Vitest: an SVG snapshot per fixture; browser script: open a drawing, an embed in a note, a canvas card; a 2,000-element drawing opens with no task over 50 ms; `npm run audit:offline` |
| **X3a** | **The editor core:** the select tool, and move/resize/rotate handles with a marquee. Rectangle, diamond and ellipse tools. A style panel: stroke, fill, width, stroke style, opacity. Undo and redo. Saves through `write_note` with the usual debounce. Our own keyboard set, listed in a help sheet. | Claude | Vitest for hit-testing and resize/rotate maths; real-mouse browser script (draw, move, resize, rotate, undo, save, reopen); a save keeps unknown fields |
| **X3b** | **More tools:** line and arrow with editable points and simple bindings to shapes, which follow when a shape moves; freedraw with pressure; text, including text inside a shape (`containerId`); the eraser. | Claude | Vitest for the binding maths; browser script for each tool, and a Cinder-made fixture still round-trips after an edit |
| **X4** | **Integration:** *New drawing* from the palette, the ribbon and the file-tree menu; *New drawing and embed it here*; rename updates `![[x.excalidraw]]` embeds (check `src/links/update.ts` covers non-`.md` targets, and add a test); export to SVG or PNG next to the file; copy as PNG. | Grok c | Browser script for each command; vitest for the rename rewrite |
| *X5* | **Later:** images inside drawings (paste and drop), groups, z-order, copy and paste, align, element links. | Grok a | Per feature |
| *X6 (Choice 3)* | A hand-drawn look written from scratch: a seeded wobble from each element's `seed`, deterministic. | Claude | Vitest: same seed, same path; snapshot fixtures |

## 9. Folded-in work: RUST_PERF_PLAN / B7 and WebKit

**RUST_PERF_PLAN.md (still waiting for Chris's approval).**
- **Partly done.** The per-snapshot link resolver (`rebuild/NOTES_LINK-INDEX.md`) covers part of P1: lookups no longer rebuild the vault map per link.
- **Not started:** P0 (hitch tests), the rest of P1 (single-pass folder moves), P2 (quiet saves, deltas) and P3 to P8.
- **`write_note` and `write_file_bytes` still run on the GTK main thread** (plain `fn` commands in `src-tauri/src/lib.rs`). I1 fixes `write_file_bytes` for images; `write_note` stays P2's.
- **What matters for switching** depends on how big the work vault is. At 5,000 notes the plan measured Grove as smooth almost everywhere, apart from the graph and renames.

**Recommendation (Choice 4):** approve **P0** now (Grok, small: one test and a dev hitch meter). It gives the WebKit-side numbers Chris can't otherwise see. Re-run `scripts/bench-feel.mjs` on a 20k `/tmp` vault before picking P1/P2. B7 stays after P2.

**WebKit follow-ups** (`rebuild/WEBKIT_PERF_NOTES.md`, merged; `rebuild/WEBKIT_HZ_NOTES.md`, which is only on `rebuild/webkit-hz-claude` `9710815` and **not yet merged** into integration).
- **The 60 fps cap.** It comes from two limits outside Grove:
  - WebKit's vblank fallback timer is hard-coded to 60 Hz, because `nvidia_drm` ships with `vblank=0`.
  - GTK 3's frame clock stays at 16.667 ms on the DMA-BUF GL path.

  Nothing in Grove lifts it. The GPU path (60 fps at 5–9% CPU) is the best that WebKitGTK 4.1 offers there.
- **NVIDIA vblank.** Setting `nvidia_drm.vblank=1` on its own lifts idle rAF only; drawn frames stay at 60. **Not recommended.**
- **Upstream reports.** Two reports with a ready repro (MiniBrowser plus `rebuild/webkit-hz/raf.html` and `vblankshim.c`). Filing them is an outward action, so **Chris** files them; an agent drafts the text.
- **Open question from WEBKIT_PERF_NOTES:** set `__NV_DISABLE_EXPLICIT_SYNC=1` on every Wayland session (as now; harmless on Mesa), or only when an NVIDIA GPU is found. **Recommendation: leave it as is.**

| Piece | What | Agent | Checks |
|---|---|---|---|
| **WK1** | Merge `rebuild/webkit-hz-claude` (notes and repro files only) into integration. Draft the two upstream bug reports as `rebuild/WEBKIT_UPSTREAM_REPORTS.md`, ready to paste. **Chris files them.** | Grok b | `npm run build`, `cargo test` (no app code changed) |
| **P0** | As in RUST_PERF_PLAN §7. | Grok | As in RUST_PERF_PLAN §7 |

**How WebKit affects this plan:**
- **The canvas bar.** Every canvas and presentation target here is 60 fps, not 240. Chris will see Grove at 60 next to Chromium apps at 240.
- **CZ6.** CZ6b only needs to keep each frame within 16.7 ms in WebKitGTK.
- **Web embeds.** Each live frame is extra raster work on the same 60 Hz path, which is why W3 caps it at 6 frames.

## 10. Suggested order (one piece at a time)

Pick the next piece only after the last is merged. S pieces in TypeScript can be reviewed in batches by one Grok, to save usage. Pieces that touch Rust, security or more than about 300 lines get their own review by a different agent.

**Wave A: switch-ready, about 40–50 agent hours.** Each step lists the payoff that comes with it.

| # | Piece | Agent | Hours | Payoff |
|---|---|---|---:|---|
| 1 | **M0a** `.cinder` hidden, foreign config read | Grok a | 2–3 | |
| 2 | **M0b** Settings import | Grok a | 3–4 | The work vault opens with the right folders |
| 3 | **I1** Native clipboard image, async raw-bytes write | Grok b | 4–5 | |
| 4 | **I2** Paste fallback and canvas image paste | Grok b | 3 | Screenshots paste (Chris checks, I3) |
| 5 | **T1** Template properties merge | Grok b | 3 | |
| 6 | **T2** New note from template | Grok b | 2–3 | Templates work as in Cinder's core |
| 7 | **C1** Daily-note gaps | Grok a | 2–3 | |
| 8 | **C2** Calendar view | Grok b | 6–8 | Calendar and daily notes done |
| 9 | **BX1** Cinder `.base` corpus | Grok c | 2–3 | Bases confirmed on Cinder's files |
| 10 | **X1** Drawing file model | Claude | 5–6 | |
| 11 | **X2** Read-only drawings, embeds, canvas previews | Claude | 8–10 | **Chris can switch here.** Drawings show but aren't editable yet |

If Chris rarely embeds drawings, X1 and X2 can move after Wave B, and he can switch after step 9, at about 25–35 hours.

**Wave B: the rest of the list.**

| # | Piece | Agent | Hours | Note |
|---|---|---|---:|---|
| 12 | **PR1** Slide order | Grok a | 2–3 | |
| 13 | **PR2** Presentation mode | Claude | 8–10 | |
| 14 | **X3a** Drawing editor core | Claude | 8–10 | |
| 15 | **X3b** Arrows, freedraw, text, eraser | Claude | 8–10 | |
| 16 | **X4** Drawing commands, rename, export | Grok c | 4–6 | |
| 17 | **W1** Frame lockdown changes | Grok c | 5–6 | Choice 2 decides the default first |
| 18 | **W2** Web embeds in notes | Claude | 8–10 | |
| 19 | **W3** Web pages on link cards | Grok c | 4 | |
| 20 | **CZ6a** Real-app measure | Grok c + Chris | 1–2 | Can run any time; it's cheap |
| 21 | **CZ6b** | Claude | 8–12 | Only if CZ6a misses |

**Wave C: when needed.**
- **WK1:** any time; it's cheap.
- **P0**, then whatever P-tasks Choice 4 approves, then **B7**.
- **X5, X6.**
- **T3a–c and C3,** if Choice 1 asks for them.

If Codex has usage, it can take X1 or W1 instead of Claude or Grok. Its proven strengths are pure-logic and Rust pieces (B1, B5, CZ3).

**Every piece follows the usual rules:**
- one branch and one notes file;
- no new crates or npm packages;
- no network;
- no app windows;
- scratch vaults under `/tmp`;
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, `npm run audit:offline`, and `cargo test --offline` when Rust changed;
- screenshots restored before committing;
- never push.

## 11. Choices for Chris

1. **Cinder-only extras: Templater syntax `<% %>`, folder templates, weekly and monthly notes.** Do the work vault's templates use them? A quick check is `grep -rl '<%' <templates folder>`, plus whether any `GGGG-[W]WW` notes exist.
   - **A. Obsidian core only now, extras later if missed** (recommended if that grep finds nothing). It saves about 20 hours.
   - **B. Port the Templater subset and weekly/monthly notes before switching** (T3a–c and C3, about 20–25 hours).
   - **C. Weekly and monthly notes only** (C3, about 4 hours).

2. **The default for embedded web pages.**
   - **A. Click to load** (recommended). The page shows a bar with the address and a Load button. Nothing reaches the network until Chris clicks.
   - **B. Always load,** as Cinder does by default. Opening a note can make network requests.
   - **C. Off,** so links only. The feature exists but has to be switched on in Settings.

3. **The drawings' hand-drawn look.**
   - **A. Clean lines first, our own wobble later** (recommended). Drawings look tidier than in Cinder or Excalidraw, but every shape is exact, and it saves about 6 hours up front.
   - **B. Our own wobble from the start** (X6 inside X2, about 6 more hours).
   - **C. Port Cinder's rough.js-derived maths with its MIT notice.** Not recommended: it's third-party code, which this task rules out.

4. **RUST_PERF_PLAN.**
   - **A. Approve P0 (hitch tests) now, and decide the rest after switching, from real numbers** (recommended).
   - **B. Approve the whole plan** (P0–P8, then B7). That's a lot of Codex and Claude usage.
   - **C. Hold all of it.**

5. **WebKit upstream reports.**
   - **A. An agent drafts both reports, and Chris files them** (recommended; about 1 hour, WK1).
   - **B. Skip it.** The 60 fps cap then stays until a Tauri/wry release supports WebKitGTK 6.
