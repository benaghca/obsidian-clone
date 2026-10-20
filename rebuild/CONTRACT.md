# Rebuild contract (Tauri 2 + TypeScript + CodeMirror 6)

The new app lives entirely in `rebuild/app/` (a fresh Tauri 2 project). The old Cinder code at the repo root is reference only; do not edit it.

Goal: get as close as possible to how Obsidian looks, feels, and responds. `rebuild/OBSIDIAN_FEEL_SPEC.md` is the target. Notes are plain `.md` files in a vault folder (Obsidian vault format).

## Ownership
- Front end (Claude): `rebuild/app/src/`, `rebuild/app/index.html`, `rebuild/app/package.json`, `rebuild/app/vite.config.ts`, styles. Vite + TypeScript + CodeMirror 6. No React or other UI framework around the editor; plain TS + DOM for chrome.
- Backend (Grok): `rebuild/app/src-tauri/` (Rust, Tauri 2).
- Neither side edits the other's files. If the contract needs to change, edit this file and say so in the commit message.

## Tauri commands (backend implements, front end calls via `invoke`)
- `open_vault(path: String) -> VaultInfo { path, name }` — remembers last vault.
- `last_vault() -> Option<VaultInfo>`
- `list_files() -> Vec<FileEntry { path (vault-relative, forward slashes), name (no .md), is_dir, mtime_ms, size }>` — recursive, skips `.obsidian`, `.git`, `.trash`, `.grove`.
- `read_note(path: String) -> String`
- `write_note(path: String, content: String) -> ()` — atomic write (temp file + rename). Front end debounces saves ~300ms.
- `create_note(path: String, content: String) -> FileEntry`
- `create_folder(path: String) -> FileEntry` — creates an empty folder (the file explorer's "New folder"); errors if anything already exists at `path`. Added in round 4.
- `rename_path(from: String, to: String) -> ()` — and returns nothing; front end updates links itself later.
- `delete_path(path: String, permanent?: bool) -> ()` — move to `.trash/` in the vault; with `permanent: true` (the "Deleted files: Permanently delete" setting) remove it instead. `permanent` is optional and defaults to false. Changed in round 6.
- `read_config(name: String) -> Option<String>` — a settings file from the vault's config folder `.grove/` (Grove's `.obsidian/`), or `None` if it doesn't exist. Added in round 6.
- `write_config(name: String, content: String) -> ()` — write a settings file into `.grove/` (created if missing), atomically (temp file + rename). `content` must parse as JSON. Added in round 6.
  - For both: `name` must be a plain lower-case file name ending in `.json` (`[a-z0-9-]+\.json`, at most 64 characters before the extension), so nothing outside `.grove/` can be named; a `.grove` that leads outside the vault (a symlink) is refused; files over 1 MB are refused.
  - `.grove/` is hidden like `.obsidian/`: never listed, searched, indexed or reported by the watcher, and the note commands refuse paths inside it.
- `search(query: String, limit: u32) -> Vec<SearchHit { path, line, text }>` — case-insensitive; every word must be on the same line. File-name matches use `line: 0` and come first. Other hits are round-robin across files so one note cannot fill `limit`.
- `link_index() -> LinkIndex { outgoing: { [path]: string[] }, backlinks: { [path]: { from, line, text }[] } }` — `[[wikilinks]]` resolved by note name, case-insensitive.

## Events (backend emits)
- `vault-changed` payload `{ kind: "create"|"modify"|"remove"|"rename", paths: string[] }` from a debounced (~100ms) file watcher. Ignore changes caused by our own `write_note` within 500ms.

## Feel/performance bar
- Typing never lags on a 5,000+ line note; note switching feels instant (<50ms); popups open instantly.
- All commands return in under 50ms for a 1,000-note vault (search may take up to 150ms).
