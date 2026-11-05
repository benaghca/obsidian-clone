# NOTES_M0b — settings import (front end)

Branch `rebuild/m0b-claude`, from `rebuild/m0a-review-grok-b` (`6bcd356`). This is the M0b row of `rebuild/CINDER_GAP_PLAN.md`, built on M0a's `read_foreign_config`. It is a local commit only. Nothing was pushed, no window was opened, and no real vault was touched. Test vaults were the browser mock and Vitest fakes only.

Scope is Chris's choice (Choice 1 A): core templates and daily notes only. Templater, folder templates, and weekly and monthly notes are listed in the notice as not imported.

## What it does

On the first open of a vault whose `.grove/` has none of Grove's settings files, Grove reads the four allowlisted files. It maps the switch-day keys into `.grove/daily-notes.json`, `templates.json` and `app.json`, and shows one notice saying what was imported and what was not. Nothing is written to `.cinder/` or `.obsidian/`. There is no write path to them. The mock never writes its foreign keys, and the tests check that.

| Grove setting | From Cinder (`.cinder/settings.json`) | From Obsidian |
|---|---|---|
| Daily notes folder | `dailyFolder` | `daily-notes.json` `folder` |
| Daily note date format | `dailyFormat` | `daily-notes.json` `format` |
| Daily note template | `dailyTemplate` | `daily-notes.json` `template` |
| Template folder | `templatesFolder` | `templates.json` `folder` |
| Template date / time format | — (Cinder always used `YYYY-MM-DD` / `HH:mm`, Grove's defaults) | `templates.json` `dateFormat`, `timeFormat` |
| Attachment folder (`attachmentFolderPath`) | `attachFolder` (`""` becomes `/`) | `app.json` `attachmentFolderPath`, as is (Grove reads `./` the same way) |
| New note location and folder | `newNoteFolder` (non-empty becomes `newFileLocation: "folder"`) | `app.json` `newFileLocation`, plus `newFileFolderPath` only when the location is `folder` |

Rules, and why:

- **Cinder's file wins when it parses, and then Obsidian's files are not used.** Cinder seeds `.cinder/settings.json` from `.obsidian/` on its first open of a vault (`ui/app/core.js` `loadVaultSettings`, `ui/vaultsettings.js` `fromObsidian`) and keeps it since, so it is the newer truth. Obsidian's files are only used for a vault Cinder never opened.
- **A missing Cinder key means Cinder's default, not Grove's.** Cinder's file holds only what differs from its defaults. So `{}` still imports `Templates` as the template folder and `attachments` as the attachment folder. That is where Cinder put them. A value of the wrong type falls back to Cinder's default, the same way Cinder reads the file.
- **Any file that can't be read, isn't JSON, or isn't an object stops the whole import.** Nothing is written, the notice names the file, and the next open tries again. This follows M0a's note that a command error must not become an empty import that still writes `.grove/`. A broken Cinder file doesn't fall back to Obsidian's older settings. When Cinder's file is good, Obsidian's errors don't matter.
- Each value is checked against Grove's schema (`FILES[...].valid`). A refused value, for example a folder with a newline, is listed as not imported. Values equal to Grove's default are not listed or written.
- Folders lose slashes at both ends. Cinder folders also lose a leading `./`, because Cinder's folders are always from the vault root, while Grove reads `./` as relative to the note.
- **Not imported, listed by name when they differ from Cinder's defaults:** weekly notes, monthly notes, folder templates, calendar week start, web page embeds, drawing format, Templater syntax (the `templater` plugin on), and weekly and monthly notes (the `periodic-notes` plugin on). Every other key is counted, with up to five names: "3 other Cinder settings (plugins, theme, vim)". For Obsidian, `autorun` is "opening today's daily note on startup", and other keys are counted the same way.
- When something is imported or listed, all three target files are written, even if one holds only `{}`, so the import runs once. When the vault has no foreign settings, or they hold only Grove's defaults, nothing is written and no notice shows. The next open checks again, at the cost of four small reads.
- "No `.grove/` settings" means `read_config` returned `null` for every Grove settings file, including `hotkeys.json` and `types.json`. A file that exists but doesn't read counts as there. Only the main window imports. Popout note windows skip it.

## Files

- `src/settings/foreign.ts`: the pure mapping (`planImport`, `importMessage`). It has no DOM and no `api`.
- `src/settings/importSettings.ts`: reads the four files in parallel, plans, calls `settings.adopt`, and shows the notice. It is called from `main.ts` right after `settings.load()`, before the layout is restored.
- `src/settings/store.ts`: `fresh`, set by `load()`, and `adopt(values, files)`, which sets the values, tells listeners, and writes the named files at once. It returns the files that failed to save, and the notice says so.
- `src/shell/notice.ts` and `src/styles/base.css`: a general notice in the top right. It closes on click or after a timeout (15 s for this one). The only notice helper before was Bases' 2.5 s one.
- `src/api.ts`: `readForeignConfig(source, name)`.
- `src/mock/backend.ts`: `read_foreign_config` with the same allowlist, 1 MB cap and error text, served from `localStorage` keys `grove.mock.foreign:<source>/<name>`. `.cinder` is added to the mock's hidden-path set (left over from the M0a review).
- `rebuild/CONTRACT.md`: the caller and the mock are noted under `read_foreign_config`.

The mapping is TypeScript, not Rust. The plan row says TS, the Vitest cases are the check it asks for, and the logic is a small key-to-key table over at most four 1 MB files, read once. Rust already does the part that has to be safe: the allowlist, the cap, and the symlink rule.

## Tests

- **Vitest**
  - `src/settings/foreign.test.ts` (8 tests): Cinder; Cinder `{}` and wrong types giving Cinder's defaults; the not-imported list; Obsidian; both (Cinder wins, and Obsidian's bad file is ignored); neither; bad JSON, a non-object and a failed read; schema refusals.
  - `src/settings/importSettings.test.ts` (5 tests): the store and import against a fake backend. Writes only to `.grove`, and only once. Leaves a vault alone when it already has Grove settings. Bad JSON writes nothing and retries. Neither source means no notice. A failed save is named.
  - `src/mock/backend.test.ts`: the mock's allowlist, cap and hidden `.cinder`, and that it never writes.
- **Browser:** `scripts/test-settings-import.mjs` (added to `npm test`) runs on the mock vault with `.cinder/settings.json` in place. It checks for one notice with the exact lines, in the top right, and the three `.grove` files with the right JSON. It checks that `.cinder/settings.json` is unchanged, that today's daily note opens in the imported folder, that a click closes the notice, that a reload shows no notice and keeps the settings, and that bad JSON writes nothing, says why, and imports once fixed. 14 checks.

## Checks

All exit 0. The screenshot files the suite rewrites (`rebuild/round*-shots/`) were restored before the commit.

- From `rebuild/app/src-tauri`, `cargo test --offline`: **89 passed, 0 failed, 4 ignored**. This is the same as M0a. No Rust changed.
- `npm run build`: passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first run, after waiting for the lock. That includes `posttest` and the new `test-settings-import.mjs`. Vitest: **82 files, 1296 tests** (M0a had 80 / 1282). 2,844 `PASS` lines.
- `npm run audit:offline`: passed (194 source files, dist/, CSP, capabilities and dependencies). No new package, crate, network use or `eval`.

**Benchmarks**, against the numbers in the M0a review:

| Measure | M0a | M0b |
|---|---|---|
| 1,000-card create drag max | 16.8 ms | 16.7 ms |
| K8 10k list scroll p95 / max | 16.8 / 16.8 ms | 16.8 / 16.8 ms |
| Bases edge 10k scroll p95 / max | 16.8 / 16.8 ms | 16.8 / 16.8 ms |
| Property fuzz | `cases=48` | `cases=48` |

None of these runs the new code: the import adds no work once the vault has `.grove` settings. The import itself was timed in headless Chromium on the mock, 20 runs each:

- no foreign files: median under 0.01 ms;
- a Cinder file: median 0.5 ms, max 2.2 ms, including the three `.grove` writes and the notice;
- a vault with Grove settings: no foreign reads at all.

In Tauri, the fresh case adds four small parallel `read_foreign_config` calls to the first open only.

## Left over

- Grove's `app.json` uses Obsidian's own keys, so the rest of `.obsidian/app.json` could be copied too: link format, `useMarkdownLinks`, `promptDelete`, and so on. That is outside this row, so those keys are counted as "other settings" in the notice. The same goes for Cinder keys that have a Grove equivalent: `defaultMode`, `livePreview`, `readable`, `properties`, `theme`, `hotkeys`, `propTypes` and the core-plugin switches. Each would be a small follow-up if Chris wants it.
- Cinder's `daily-notes` and `templates` plugins are off by default, and Grove's are on. The import doesn't switch plugins.
- Chris's 10-minute check from the plan still stands: copy the work vault to `/tmp`, open the copy in a release build, and check the notice and the folders.
