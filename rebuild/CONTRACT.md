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
- `list_files() -> Vec<FileEntry { path (vault-relative, forward slashes), name (no .md), is_dir, mtime_ms, size }>` — recursive, skips `.obsidian`, `.git`, `.trash`.
- `read_note(path: String) -> String`
- `write_note(path: String, content: String) -> ()` — atomic write (temp file + rename). Front end debounces saves ~300ms.
- `create_note(path: String, content: String) -> FileEntry`
- `rename_path(from: String, to: String) -> ()` — and returns nothing; front end updates links itself later.
- `delete_path(path: String) -> ()` — move to `.trash/` in the vault.
- `search(query: String, limit: u32) -> Vec<SearchHit { path, line, text }>`
- `link_index() -> LinkIndex { outgoing: { [path]: string[] }, backlinks: { [path]: { from, line, text }[] } }` — `[[wikilinks]]` resolved by note name, case-insensitive.

## Events (backend emits)
- `vault-changed` payload `{ kind: "create"|"modify"|"remove"|"rename", paths: string[] }` from a debounced (~100ms) file watcher. Ignore changes caused by our own `write_note` within 500ms.

## Feel/performance bar
- Typing never lags on a 5,000+ line note; note switching feels instant (<50ms); popups open instantly.
- All commands return in under 50ms for a 1,000-note vault (search may take up to 150ms).
