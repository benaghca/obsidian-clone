# Settings in the vault: `.cinder/settings.json`

## Why

Cinder's settings lived only in the window's browser storage, so:
- nothing outside the app could read or change them (the user, an agent, a script);
- they didn't travel with the vault, so home and work had to be set up twice;
- a vault first opened in Cinder didn't pick up what Obsidian already knew (daily notes, templates…).

The user asked for "a settings.json" and left the design calls to Claude (2026-09-27, overnight). These are those calls.

## The file

- **Where:** `<vault>/.cinder/settings.json`. It's a dot-folder, which Obsidian and Cinder's file tree both ignore. It works whether or not the vault has `.obsidian`, and it syncs with the vault.
- **What:** each vault setting whose value differs from Cinder's default, with the keys sorted and pretty-printed (as Obsidian's `app.json` does). A key that isn't there means the default. Every vault Cinder opens gets the file, `{}` when every setting is at its default (changed 2026-09-28: a vault with default settings got no `.cinder` at all, so no guide either). The key names are those in `DEFAULTS` (`ui/app/core.js`), plus:
  - `hotkeys`: custom shortcuts, as Obsidian keeps them per vault;
  - `propTypes`: property types, only used when the vault has no `.obsidian/types.json`.
- **Kept local, never in the file:**
  - `fontText` and `fontMono`, because installed fonts differ between machines;
  - `windowFrame`, which lives in the app's own config;
  - `screenshotHide` and `screenshotDelay`, which depend on the machine's screenshot tools.
- **Unknown keys are kept.** When Cinder writes the file, it keeps keys it doesn't know. An older Cinder on another machine therefore won't drop settings a newer one wrote.

## Reading and writing

- **The file wins; browser storage is a cache.** At start-up the settings come from the cache at once, then from the file. If the file differs, it's applied: theme, tree, CSS snippets, calendar, editor and hotkeys are refreshed.
- **Outside edits.** The vault watcher already reports changes inside `.cinder/`. So when the page checks the vault (on a change, and when the window comes back into view), it also reads the file. If the file changed, it's applied.
- **Changes made in Settings** are written to the file shortly after, on a 400 ms debounce, and flushed before the window closes. While a write is pending, reading the file doesn't undo the change.
- **A change not yet written survives a reload or crash.** Until the file has it, the cache is marked as newer, and at the next start-up the cache is written to the file rather than replaced by it.
- **A file with a JSON mistake is never overwritten.** Cinder shows what's wrong once, keeps using the last good settings, and doesn't write until the file reads again.

## First run

- **A vault Cinder already has settings for** (in the cache): those settings are written to the new file.
- **A vault Cinder has never opened:** the file starts from Obsidian's settings, when there are any:

| Obsidian file | Setting | Cinder setting |
|---|---|---|
| `daily-notes.json` | `folder`, `format`, `template` | daily notes |
| `templates.json` | `folder` | `templatesFolder` |
| `plugins/templater-obsidian/data.json` | `templates_folder` (if core Templates didn't set one) | `templatesFolder` |
| `plugins/templater-obsidian/data.json` | `folder_templates` | `folderTemplates` lines |
| `app.json` | `attachmentFolderPath` (a folder, not `./…`) | `attachFolder` |
| `app.json` | `newFileLocation: folder` and `newFileFolderPath` | `newNoteFolder` |
| `plugins/periodic-notes/data.json` | `weekly`, `monthly` (and `daily`), when enabled | the periodic notes |

## Pieces

- **`src/api.rs`: `GET /api/settings`.** Returns:
  - `{ exists, settings | error }` for the file;
  - `obsidian: { daily, templates, app, templater, periodic }`, the raw JSON of those Obsidian files, when there's a `.obsidian` folder.
- **`src/api.rs`: `PUT /api/settings`.** Takes an object, at most 256 KB, and writes it pretty-printed through a temp file and rename. It creates `.cinder/` if needed.
- **`ui/vaultsettings.js` (pure, tested under Node):**
  - `forFile(cfg, defaults, previous)`: the object to write;
  - `fromFile(obj, defaults)`: the vault settings to apply;
  - `fromObsidian(o)`: a settings subset;
  - `LOCAL_KEYS`.
- **`ui/app/core.js`:**
  - `loadVaultSettings()`, at boot and from `poll()`;
  - `saveCfg()`, which also schedules the file write;
  - `applyAllSettings()`.

## Tests

- **Rust:** GET with and without the file and `.obsidian`; PUT round trip, the size cap, and no temp file left behind.
- **Node (`ui/test/vaultsettings.test.js`):** only non-defaults are written, local keys are left out, unknown keys are kept, and the Obsidian mapping.
- **Browser (`ui/test/e2e/vaultsettings.js`):**
  - changing a setting writes the file;
  - an outside edit of the file is applied;
  - a broken file is reported and not overwritten;
  - the first run moves the cached settings into the file;
  - a new vault with `.obsidian` is seeded from it.
