# Review: M0b settings import

Branch `rebuild/m0b-review-grok-c`, from `rebuild/m0b-claude` (`724e65e`), on the reviewed M0a (`6bcd356`). The plan row is M0b in `rebuild/CINDER_GAP_PLAN.md`. Local commit only. Nothing pushed, no window was opened, and no real vault was touched.

Reviewed `724e65e` and `rebuild/NOTES_M0b-claude.md` against the plan and M0a's `read_foreign_config`. Scope is Choice 1 A: core templates and daily notes. Small fixes are on this branch.

## Scope

On the first open of a vault with no `.grove/` settings file, the main window reads the four allowlisted files and maps Cinder's or Obsidian's keys into `.grove/daily-notes.json`, `templates.json`, and `app.json` (attachment folder and new-note location). One notice lists what was imported and what was left out. A popout (`?note=`) skips the import. A vault switch reloads the page, so the next vault is checked on its own.

Cinder's file wins when it parses, including `{}`. A missing Cinder key means Cinder's default (`Templates`, `attachments`, `YYYY-MM-DD`), which is where Cinder put that setting. A file that cannot be read, is not JSON, or is not an object stops the whole import: nothing is written, the notice names the file, and the next open tries again. A broken Cinder file stays broken rather than falling back to Obsidian. When Cinder's file is good, Obsidian's errors are ignored. With neither source, or with only Grove's own defaults, nothing is written and no notice shows.

Weekly notes, monthly notes, folder templates, week start, web embeds, drawing format, and Templater are listed in the notice. Obsidian `autorun: true` is listed as opening today's daily note on startup. Grove does not switch core plugins. `GGGG`, a date format that contains a folder, and opening today's note on startup stay in C1.

## Fixes

In `src/settings/foreign.ts` and the mock, with tests:

- A daily-note template is a note path. Cinder and Obsidian values now go through the same slash trim as folder settings, so `/Templates/Daily/` and `./Templates/Daily` resolve. A `.md` suffix stays.
- `newFileLocation: "folder"` is saved only when `newFileFolderPath` is valid and differs from Grove's empty default. A missing path is listed as "New notes go in (no folder was set)". An invalid path is named on the path line only. `/` or empty is the vault folder, which is Grove's default, and stays quiet.
- With the periodic-notes plugin on, a weekly folder no longer hides monthly notes, and the reverse. Both periods already listed add nothing. The plugin alone still says "weekly and monthly notes". A `plugins` value that is not an object counts as one other Cinder setting.
- An Obsidian key Grove knows, given a type Grove refuses, is listed the same way as a schema refusal. A stale `newFileFolderPath` while the location is something other than `folder` is still ignored, whatever its type.
- The mock's `read_foreign_config` used to turn a `localStorage` throw into `null`, which is a missing file and can fall through to Obsidian. The throw now propagates, so the import treats it as a failed read and writes nothing.

## Writes

The import calls `read_foreign_config` only for the four allowlisted names, then `settings.adopt`, which calls `write_config` for `daily-notes.json`, `templates.json`, and `app.json`. `write_config` creates `.grove/<plain-name>.json` only. The mock stores those under `grove.mock.config:` and leaves `grove.mock.foreign:` untouched. The browser script and the Vitest import tests both check that `.cinder/settings.json` is unchanged. There is no write command for `.cinder` or `.obsidian`.

## Checks

From `rebuild/app/src-tauri`, `cargo test --offline`: **89 passed, 0 failed, 4 ignored**. Same as M0a. No Rust changed.

From `rebuild/app`. All exit 0. No timing test failed, so nothing was rerun. Screenshot files the suite rewrote were restored before this commit.

- `npm run build`: passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test`: the lock was held by other agents' runs; this run waited, then passed. Vitest: **82 files, 1298 tests**. The notes had 82 / 1296; the two added cases are the template-and-folder test and the mock storage-failure test. The browser scripts passed, including `test-settings-import.mjs` (14 checks: neither source, one notice with the imported and skipped lines, the three `.grove` files, `.cinder` unchanged, today's note in the imported folder, click to close, no notice on reload, bad JSON writes nothing and imports once the file is fixed) and `posttest`. 1,000-card create drag max 16.7 ms. K8 10k scroll p95 16.8 ms, max 16.8 ms. Bases edge 10k scroll p95 16.8 ms, max 16.8 ms. Property fuzz `cases=48`.
- `npm run audit:offline`: passed (194 source files, dist/, CSP, capabilities and dependencies). The script builds again, and that build passed.

The notes timed the import itself in headless Chromium (no foreign files under 0.01 ms median; a Cinder file 0.5 ms median, 2.2 ms max). That timing is outside `npm test`, so this review left it as the notes measured it. The locked suite covers the same paths as behavior checks.

## Left

- If one of the three saves fails, `adopt` has already cleared `fresh` and the files that did save exist, so the next open skips the failed file. The notice says those values apply until Grove closes. If every save fails, no file exists and the next open tries again.
- The import runs once. Writing any Grove settings file, including while a bad foreign file is still unfixed, means those foreign files are left for a later pass.
- The mock's hidden-path set now includes `.cinder`, and that set is only used by `write_file_bytes` and `set_property`. List, search, read, and create still skip it. That matches the old `.obsidian` coverage in the mock. Rust hides both folders.
- Obsidian plugin `data.json` (Templater, periodic notes) is outside the allowlist, so the notice can name those only from Cinder's `plugins` map.
- Cinder `{}` applies Cinder's defaults and ignores Obsidian, including `./` attachments and `newFileLocation: "current"`, which Cinder's file cannot store. That is the Cinder-wins rule.
- A popout does not import. If it is the only window, the import waits for a main window. A BOM before the JSON fails the parse until the file is fixed. The notice stays 15 seconds, closes on click, sits above menus and modals, and has no max height. The usual list is short.
- The rest of `app.json` (link format, `useMarkdownLinks`, `promptDelete`, theme, hotkeys, property types) is counted as other settings, and Grove's core plugins stay as they are. Those are follow-ups, as the notes say. The plan's 10-minute check on a copy of the work vault is still Chris's.

VERDICT: OK. The first open maps the core daily-note, template, attachment, and new-note settings, one notice lists the rest, and nothing writes `.cinder` or `.obsidian`. The small bugs found here are fixed and tested, and build, the locked npm test, the offline audit, and cargo test passed.

## Merge with integration 5760368

Merged `rebuild/integration` (`5760368`) with `git merge --no-ff`. Two files conflicted. The resolution keeps both sides.

- `rebuild/app/package.json`: both sides edited the `test` script. The merged script keeps `node scripts/test-template-merge.mjs` after `node scripts/test-paste.mjs`, and `node scripts/test-settings-import.mjs` at the end. `posttest` and the other scripts matched on both sides.
- `rebuild/app/src/mock/backend.test.ts`: kept the two `read_foreign_config` cases and the `read_clipboard_image` case.

`rebuild/CONTRACT.md`, `rebuild/app/src/api.ts`, and `rebuild/app/src/mock/backend.ts` merged on their own. Each still has the foreign-config import and the clipboard image read.

Checks, all exit 0. Screenshot files under `rebuild/round*-shots/` that the suite rewrote were restored before this commit.

- `npm run build`: passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test`: the lock was held by other runs; this run waited, then passed. Vitest: **85 files, 1365 tests**, including `backend.test.ts` (9 tests). Browser scripts passed, including `test-template-merge.mjs`, `test-settings-import.mjs` (14 checks), and `posttest`. 1,000-card scroll max 16.7 ms. K8 10k scroll p95 16.8 ms, max 16.8 ms. Bases edge 10k scroll p95 16.8 ms, max 16.8 ms. Property fuzz `cases=48`.
- `npm run audit:offline`: passed (197 source files, dist/, CSP, capabilities and dependencies).
- `cargo test --offline` from `rebuild/app/src-tauri`: **102 passed, 0 failed, 4 ignored**.

No new packages. Nothing pushed.

## Merge with integration 7ba7d09

Merged `origin/rebuild/integration` (`7ba7d09`) with `git merge --no-ff`. One file conflicted. The resolution keeps both sides.

- `rebuild/app/package.json`: both sides edited the `test` script. The merged script keeps `node scripts/test-feel.mjs` after the browser-discovery step and before `vitest run`, and `node scripts/test-settings-import.mjs` at the end. `posttest` and the other scripts matched on both sides.
- `rebuild/app/src/main.ts` merged on its own. It calls `installHitchMeter()` after `registerAppCommands`, and `importForeignSettings()` after `settings.load()` in the main window.

`rebuild/NOTES_P0-codex.md`, `rebuild/NOTES_P0-REVIEW-gemini.md`, `rebuild/app/scripts/test-feel.mjs`, and `rebuild/app/src/shell/hitchMeter.ts` came in clean.

Checks, all exit 0. Screenshot files under `rebuild/round*-shots/` that the suite rewrote were restored before this commit.

- `npm run build`: passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test`: the lock was held by other runs; this run waited, then passed. Vitest: **85 files, 1365 tests**. `test-feel.mjs` passed. It logged the held graph gap (p95 33.4 ms, max 50.1 ms, 56 of 185 frames over 20 ms) and did not fail on it. Typing, the quick switcher, note switches, and folder expand stayed inside their budgets. `test-settings-import.mjs` passed (14 checks) and `posttest` passed. Virtualized 1,000-card scroll max 16.8 ms. K8 10k scroll p95 16.7 ms, max 16.8 ms. Bases edge 10k scroll p95 16.7 ms, max 16.8 ms. Property fuzz `cases=48`.
- `npm run audit:offline`: passed (198 source files, dist/, CSP, capabilities and dependencies).
- `cargo test --offline` from `rebuild/app/src-tauri`: **102 passed, 0 failed, 4 ignored**.

No new packages. Nothing pushed.
