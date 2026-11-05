# T2 (Grok): create a new note from a template

Piece T2 of `CINDER_GAP_PLAN.md`. Built 2026-11-05 on `rebuild/t2-grok-a`, from `rebuild/t1-review-codex` at `6146d70`. Local commit only; nothing pushed. No new packages or crates, no network, no Obsidian or Excalidraw code or assets, no GUI windows. Chris's choices: only the core Obsidian-style templates. No Templater `<% %>`, no folder templates, no weekly or monthly notes.

## What changed

*Templates: Create new note from template* picks a note in the template folder, creates `Untitled` in the new-note folder, fills the core variables with that note's title, and selects the inline title.

- `app/src/editor/templateMerge.ts`: +11. `newNoteTemplate(templateText, title, now, dateFormat, timeFormat)` fills `{{title}}`, `{{date}}` and `{{time}}` with the existing `fillTemplate`, then calls `mergeTemplate("", filled)`. The template's properties become the new note's frontmatter.
- `app/src/appCommands.ts`: +45 / −1. Command `templates:create-new-note-from-template`, icon `file-plus`, core plugin `templates`. It calls `newNote(ws)` with no folder argument, applies the merge as one `input.template` transaction, saves, and focuses the inline title.
- `app/src/shell/templatePrompt.ts`: +2 / −2. `openTemplatePrompt` takes the Enter hint. Insert stays "to insert". Create passes "to create".
- `app/src/settings/plugins.ts`: the Templates description now names creating a note from a template.
- `app/src/editor/templateMerge.test.ts`: +31. Four cases. The file is 25 tests.
- `app/scripts/test-template-create.mjs`: new. A native-key browser check. Added to `npm test` immediately after `test-template-merge.mjs`.

## Rules, as built

- **Where the note goes.** `newNote(ws)` uses `fileSettings.newNoteFolder()`, which reads Settings → Files and links: vault root, the current note's folder, or the configured folder. Ctrl+N still passes `""` and stays at the vault root. The name is `Untitled.md`, then `Untitled 1.md`, and so on, chosen before the template is read, so `{{title}}` is that unique name.
- **Filling.** The same variables as Insert template: `{{title}}`, `{{date}}`, `{{time}}`, and `{{date:FORMAT}}` / `{{time:FORMAT}}`, case-insensitive, from the Templates date and time formats. `<% %>` is copied as written. A brand-new empty document goes through `newNoteTemplate`. If something was typed into the note before the template text came back, `mergeTemplate` runs on that document with the selection at the start, so the typed text stays and the body goes in after the frontmatter.
- **One frontmatter block.** The merge is the T1 merge onto an empty note: the template's properties are the note's properties, lists keep the template's style, and there is no second `---` block. An empty note is LF, so a CRLF template is stored as LF. A template BOM is dropped. An empty template or a properties-only template creates that text and inserts no body.
- **One undo step.** The fill is one editor change with `userEvent: "input.template"`, then `saveNow`, so the file matches the editor before a rename. If the editor never loaded the new note, the text is written with `writeNote`. A merge that sets `skipped` shows the same notice as Insert template.
- **The title.** When the new note is still the active tab, `focusTitle(true)` selects the whole inline title (`contenteditable="plaintext-only"`). Enter renames through the existing title commit. Escape cancels and returns to the editor. `{{title}}` is filled once and is left as written if the note is renamed. With *Show inline title* off, the title still opens for that rename (`is-renaming`).
- **One create at a time.** Picks are serialized, the same reason a new canvas is, so two creates cannot both take the name `Untitled`.
- **No folder set.** The command opens Settings → Templates, the same as Insert template, and creates nothing.
- **The picker.** Notes outside the template folder are absent. Escape closes the picker and creates nothing. Insert template's hint is unchanged.
- **The command is available** with no note open and from reading view or a canvas, because it does not edit the current document. Turning the Templates plugin off removes it from the palette. There is no ribbon button.

## Tests

- `npx vitest run src/editor/templateMerge.test.ts src/settings/dateFormat.test.ts`: 29 passed (25 merge, 4 date format). The four new cases: a filled meeting note (one frontmatter block, cursor at the end, body inserted), Templater syntax left as written and a template BOM dropped, a CRLF list template stored as LF, and empty or properties-only templates.
- `node scripts/test-template-create.mjs`: passed on its own and inside the full suite. Native keys. With no template folder, the palette opens Settings → Templates and creates nothing. A note outside the folder is not offered, and Escape creates nothing. Meeting → `Inbox/Untitled.md` with title, date and time filled, `<% tp.file.cursor() %>` literal, one frontmatter block, Properties showing `topic` and `created`, the previous tab kept, editing mode, and the inline title focused with `Untitled` selected. One Ctrl+Z clears the fill; one Ctrl+Shift+Z restores it. With the inline title hidden, the next create is `Inbox/Untitled 1.md`, the title still opens, typing and Enter rename it to `Inbox/Board notes.md`, the body keeps `# Untitled 1`, and both files are saved as shown. Current-folder location creates `Journal/Untitled.md` beside the open note. Root location creates `Untitled.md`. With Templates off, the command is absent from the palette. No console errors.
- `npm run build`: passed (`tsc --noEmit` and `vite build`, 2138 modules). The pre-existing chunk-size warning remains.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest **1307 passed** across 81 files (the T1 review suite was 1303; the four new cases are the difference). All browser scripts passed, including `test-template-merge.mjs` and `test-template-create.mjs`. `posttest` passed. No rerun was needed.
- `npm run audit:offline`: passed (192 source files, dist/, CSP, capabilities, dependencies).
- `cargo test --offline`: **84 passed**, 0 failed, 4 ignored. No Rust changed.
- The screenshots and canvas/Base outputs under `rebuild/round*-shots/` that the test run rewrote were restored with `git checkout`. They are not in the commit.

## Bench

`node scripts/bench-frontend.mjs` (5,000-note synthetic vault, medians of three runs, two invocations). This piece does not touch these paths. Other worktrees were running browser suites on the same machine. The medians sit on the T1 review numbers and inside the original implementation's recorded range (11.1 / 13.2–15.6 / 5.2–5.3 / 41.3–47.2 ms).

| | T1 review | T2 run 1 | T2 run 2 |
|---|---|---|---|
| vault tags | 10.9 ms | 10.8 ms | 10.9 ms |
| search | 13.9 ms | 13.3 ms | 13.5 ms |
| search page 5k | 4.7 ms | 5.6 ms | 5.3 ms |
| link refresh | 45.1 ms | 41.1 ms | 41.2 ms |

Run 1's page samples were 5.6, 6.5 and 4.4 ms, so that 5.6 ms median is the middle of a wide sample. Run 2's page median is 5.3 ms, the top of the original recorded range. Link refresh is at the fast end of that range.

## Decisions

- No default hotkey. Cinder binds this to Alt+N. Grove adds a default hotkey only where Obsidian has one, and this command has none. It is reached from the command palette.
- The note uses `newNote`'s default folder. Ctrl+N's explicit `""` would ignore Settings → Files and links.
- The merge stays in TypeScript. T1 already made `mergeTemplate` a pure function on the editor document, and T2 calls it. A Rust round trip would add IPC for the same string work.
- `{{title}}` is the file name at creation. Renaming the note does not rewrite the body. That is core templates, not a live Templater cursor.
- Folder templates and weekly or monthly notes are out of this piece.

T2 meets the plan and Chris's core-template scope. The command creates the note, fills it, and leaves the inline title editable, and the required checks passed with no meaningful benchmark change.

VERDICT: OK

## Merge with integration 5760368

`git merge --no-ff rebuild/integration`. This branch was `ea5b5f7`. Integration was `5760368` (X1, BX1, M0a, WK1, T1, I1, I2).

Conflicts:

- None. Git auto-merged every path. `rebuild/app/package.json` differed by one test step: this branch inserts `node scripts/test-template-create.mjs` immediately after `node scripts/test-template-merge.mjs`. That step stayed, and every integration step on `test`, `posttest`, and the other scripts stayed. No test file was edited on both sides, so both sides' cases remain. `templateMerge.test.ts` is still 25 tests.

No behaviour change beyond taking integration's tree.

Checks, from `rebuild/app` (cargo from `src-tauri`):

- `npm run build` — exit 0. `tsc --noEmit && vite build`, 2139 modules. The chunk-size warning is the existing one.
- `flock /tmp/grove-npm-test.lock npm test` — exit 0. Vitest: 83 files, 1353 tests, including 444 parity and the 25 template-merge cases. Geometry stayed within 1px. Ctrl+o frames were 16.8–16.9 ms. `test-template-create.mjs` passed, including a missing template creating nothing and the inline title staying selected. `test-paste.mjs` passed, including the empty paste and the canvas image card. 300-card pan and zoom stayed under 20 ms. 300-card drag max 16.8 ms (49 intervals). Create and reconnect drag max 16.8 ms. K8 10k scroll: p95 16.8 ms, max 16.8 ms, scrollTop 279218. Kanban edge 10k scroll: p95 16.8 ms, max 16.8 ms, scrollTop 140000. Bases edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 160000. Property fuzz `cases=48`. `LEDGE_TYPE` max 16.8 ms, p95 16.7 ms. `LEDGE_SWITCH` max 16.8 ms, p95 16.8 ms.
- `npm run audit:offline` — passed. 194 source files, dist, CSP, capabilities, and dependencies. The script runs the build above.
- `cargo test --offline` — 102 passed, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`).

`rebuild/round*-shots/` was restored with `git checkout` after the suite.

## Merge with integration 7ba7d09

`git merge --no-ff origin/rebuild/integration`. This branch was `6b7e441`. Integration was `7ba7d09` (P0 on top of `5760368`).

Conflicts:

- `rebuild/app/package.json` only. Both sides edited the `test` script. The resolved script keeps every step from both sides: `node scripts/test-feel.mjs` stays where P0 put it, before `vitest run`, and `node scripts/test-template-create.mjs` stays immediately after `node scripts/test-template-merge.mjs`. `posttest` and the other scripts were unchanged. No test file was edited on both sides, so both sides' cases remain. `templateMerge.test.ts` is still 25 tests.

No behaviour change beyond taking integration's tree. P0 adds `scripts/test-feel.mjs` and the opt-in dev hitch meter (`src/shell/hitchMeter.ts`, called from `src/main.ts`).

Checks, from `rebuild/app` (cargo from `src-tauri`):

- `npm run build` — exit 0. `tsc --noEmit && vite build`, 2140 modules. The chunk-size warning is the existing one.
- `flock /tmp/grove-npm-test.lock npm test` — exit 0 on the rerun. The first attempt exited 1 because the graph phase reported 2 long tasks (max 62 ms) while other suites were running; that budget stays strict. The rerun had `long_tasks` 0 on every phase, including graph, and printed the held graph frame gap (`p95` 33.4 ms, max 33.4 ms, 58/186 frames over 20 ms). Vitest: 83 files, 1353 tests, including 444 parity and the 25 template-merge cases. Geometry stayed within 1px. Ctrl+o frames were 16.8–16.9 ms. `test-template-create.mjs` passed, including a missing template creating nothing and the inline title staying selected. `test-paste.mjs` passed, including the empty paste and the canvas image card. 300-card pan and zoom stayed under 20 ms. 300-card drag max 16.8 ms (49 intervals). Create and reconnect drag max 16.8 ms. K8 10k scroll: p95 16.8 ms, max 16.8 ms, scrollTop 279218. Kanban edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 140000. Bases edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 160000. Property fuzz `cases=48`. `LEDGE_TYPE` max 16.8 ms, p95 16.7 ms. `LEDGE_SWITCH` max 16.7 ms, p95 16.7 ms.
- `npm run audit:offline` — passed. 195 source files, dist, CSP, capabilities, and dependencies. The script runs the build above.
- `cargo test --offline` — 102 passed, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`).

`rebuild/round*-shots/` was restored with `git restore` after the suite. 61 rewritten shot paths were put back. Nothing was pushed.
