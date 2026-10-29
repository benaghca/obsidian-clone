# Rebuild contract (Tauri 2 + TypeScript + CodeMirror 6)

The new app lives entirely in `rebuild/app/` (a fresh Tauri 2 project). The old Cinder code at the repo root is reference only; do not edit it.

Goal: get as close as possible to how Obsidian looks, feels, and responds. `rebuild/OBSIDIAN_FEEL_SPEC.md` is the target. Notes are plain `.md` files in a vault folder (Obsidian vault format).

## Ownership
- Front end (Claude): `rebuild/app/src/`, `rebuild/app/index.html`, `rebuild/app/package.json`, `rebuild/app/vite.config.ts`, styles. Vite + TypeScript + CodeMirror 6. No React or other UI framework around the editor; plain TS + DOM for chrome.
- Backend (Grok): `rebuild/app/src-tauri/` (Rust, Tauri 2).
- Neither side edits the other's files. If the contract needs to change, edit this file and say so in the commit message.

## Tauri commands (backend implements, front end calls via `invoke`)
Read commands run off the main thread; replies to separate calls may arrive in any order.
- `open_vault(path: String) -> VaultInfo { path, name }` — remembers last vault.
- `create_vault(path: String) -> VaultInfo { path, name }` — creates one new empty vault folder and opens it (same remember and watch as `open_vault`). The parent must already be a folder. An empty path, a missing parent, and a path that already exists are refused, so nothing is overwritten. Added in round 27.
- `last_vault() -> Option<VaultInfo>`
- `list_files() -> Vec<FileEntry { path (vault-relative, forward slashes), name (no .md), is_dir, mtime_ms, ctime_ms, size }>` — recursive, skips `.obsidian`, `.git`, `.trash`, `.grove`. `ctime_ms` is when the file was created (its modified time where the file system doesn't record that; 0 for folders), for the "Created time" sort orders; added in round 15. `create_note` and `create_folder` return the same entry.
- `read_note(path: String) -> String`
- `read_file_bytes(path: String) -> bytes` — an image file's raw bytes (a `tauri::ipc::Response`, so the page gets an `ArrayBuffer`), for `![[embeds]]`. The same path checks as `read_note` (vault-relative, no `..`, no symlink out of the vault, nothing in `.grove/`, `.obsidian/` or the other hidden folders), only `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `avif` (any case), at most 20 MB. Permission `allow-read-file-bytes` in the default capability. The front end shows the bytes through a `blob:` URL it revokes when no embed shows it (the CSP already allows `img-src blob:`); Tauri's asset protocol stays off. Added in round 12.
- `write_note(path: String, content: String) -> ()` — atomic write (temp file + rename). Front end debounces saves ~300ms. Other windows (a note's own window) get a `vault-changed` `modify` for it; the window that saved does not. Changed in round 9.
- `write_file_bytes(path: String, bytes: number[]) -> FileEntry` — a new attachment (a pasted image or a dropped file). The same path checks as `write_note` (vault-relative, no `..`, no symlink out of the vault, nothing in `.grove/`, `.obsidian/`, `.git` or `.trash`). Fails if anything already exists at `path` (the caller picks a free name) or if `bytes` is over 20 MB. Any extension, including none; empty is allowed. Parents are created. The bytes are a JSON array of numbers (an attachment, not a hot path). Other windows get a `vault-changed` `create`; the window that saved does not. Permission `allow-write-file-bytes`. Added in round 27.
- `create_note(path: String, content: String) -> FileEntry`
- `create_folder(path: String) -> FileEntry` — creates an empty folder (the file explorer's "New folder"); errors if anything already exists at `path`. Added in round 4.
- `rename_path(from: String, to: String) -> ()` — and returns nothing; front end updates links itself later.
- `delete_path(path: String, permanent?: bool) -> ()` — move to `.trash/` in the vault; with `permanent: true` (the "Deleted files: Permanently delete" setting) remove it instead. `permanent` is optional and defaults to false. Changed in round 6.
- `read_config(name: String) -> Option<String>` — a settings file from the vault's config folder `.grove/` (Grove's `.obsidian/`), or `None` if it doesn't exist. Added in round 6.
- `write_config(name: String, content: String) -> ()` — write a settings file into `.grove/` (created if missing), atomically (temp file + rename). `content` must parse as JSON. Added in round 6.
  - For both: `name` must be a plain lower-case file name ending in `.json` (`[a-z0-9-]+\.json`, at most 64 characters before the extension), so nothing outside `.grove/` can be named; a `.grove` that leads outside the vault (a symlink) is refused; files over 1 MB are refused.
  - `.grove/` is hidden like `.obsidian/`: never listed, searched, indexed or reported by the watcher, and the note commands refuse paths inside it.
- `search(query: String, limit: u32) -> Vec<SearchHit { path, line, text }>` — case-insensitive; every word must be on the same line. File-name matches use `line: 0` and come first. Other hits are round-robin across files so one note cannot fill `limit`.
- `link_index() -> LinkIndex { outgoing: { [path]: string[] }, markdown: { [path]: string[] }, unresolved: { [path]: string[] } }` — `[[wikilinks]]` resolved by note name, case-insensitive.
  - `outgoing` holds wikilinks (and `![[embeds]]`) only. Linked mentions are fetched separately with `backlinks` (migration step 2).
  - `markdown` (added in round 7, for the graph view): per note, the resolved targets of its `[text](path)` and `![alt](path)` links to files in the vault. URLs (anything with a scheme) and `#heading` anchors are not links here; the path is percent-decoded and resolved like a wikilink path (from the note's folder, then the vault). Notes with none are omitted.
  - `unresolved` (added in round 7): per note, the link targets (wikilinks and markdown links) that match no file, as written without heading, alias or a markdown link's `.md`, deduplicated case-insensitively. Notes with none are omitted.
  - Links in fenced or inline code are skipped in all three.
- `backlinks(paths: string[]) -> { [path]: { from, line, text }[] }` — linked mentions resolving to the requested vault-relative targets only, from both wikilinks/embeds and Markdown links. Each occurrence is counted, including multiple links on one line; `line` is 1-based and `text` is the full source line. Targets without mentions (including missing paths) are omitted; an empty request returns `{}`. Uses the same resolution and code-skipping rules as `link_index`, runs off the main thread, and requires `allow-backlinks`. For renames/moves, fetch every moved note's backlinks **before** `rename_path` and pass that snapshot to link rewriting; old-name links may no longer resolve afterward. Added in migration step 2.

- `frontmatter(paths?: string[]) -> { [path]: string }` — each note's frontmatter block, from its first line (`---`) to the closing `---` (both included), lines joined with `\n`; for `paths` only when given, every note otherwise. Notes without frontmatter (or with more than 2,000 lines of it) are left out. Read from the index, never from disk. For the properties index (All properties view, property suggestions, `[property]` search). Added in round 10.
- `tags(paths?: string[]) -> { [path]: string[] }` — each note's tags without the `#`, in order, repeats kept: its frontmatter `tags:`/`tag:` values, then the body's `#tags` outside fenced and inline code. The rules are `tagsInText`'s (`src/shell/linksTags.ts`), ported in `index/tags.rs`; `fixtures/parity/tags.json` holds both to the same cases. For `paths` only when given, every note otherwise. Notes without tags are left out. Read from the index, never from disk. For the Tags view, `tag:` search, the graph and Bases (`vaultTags.ts`). Added in plan step 1 (both sides edited by one owner, as `RUST_MIGRATION_PLAN.md` §2 proposes).
- `open_note_window(note: String) -> ()` — "Open in new window": a window of its own (label `note-<n>`, the main window's settings, navigation guard and capability) on `index.html?note=<note>`. `note` is the vault path, percent-encoded in full (only `A-Za-z0-9%-._~`); anything else is refused. Added in round 9.

## Events (backend emits)
- `vault-changed` payload `{ kind: "create"|"modify"|"remove"|"rename", paths: string[] }` from a debounced (~100ms) file watcher. Ignore changes caused by our own `write_note` or `write_file_bytes` within 500ms.

## Feel/performance bar
- Typing never lags on a 5,000+ line note; note switching feels instant (<50ms); popups open instantly.
- All commands return in under 50ms for a 1,000-note vault (search may take up to 150ms).
