# Round 27a

File explorer collapse toggle, vault switcher, and status bar layout. No canvas files. Nothing was pushed.

## What changed

The file explorer header button toggles. With every folder closed it shows the expand-all icon (`chevrons-up-down`) and the tooltip "Expand all". Pressing it opens every folder and flips to "Collapse all" (`chevrons-down-up`). Closing the last open folder, including a parent that still had a nested folder open, flips it back. The command palette keeps "Files: Collapse all" and adds "Files: Expand all". Expand all rebuilds the tree immediately. Collapse all still slides the top-level folders shut, and the button flips as soon as they are marked closed.

The left sidebar footer is a vault icon plus the vault name. A click opens the recent vaults (current one checked), "Open another vault...", and "Create new vault...". The menu opens upward from the footer and does not animate. There is no native folder dialog in the app, so both actions use the existing instant path prompt, then `open_vault` or the new `create_vault`. The window reloads so the rest of the UI follows the new vault. Recent vaults (up to 8) live in localStorage. The backend still stores only the last vault.

`create_vault` makes one new empty folder and then remembers and watches it like `open_vault`. The parent must already be a folder. An empty path, a missing parent, and a path that already exists are refused, so nothing is overwritten and no missing parents are created. That command is in the contract, the capability, and the Tauri command list.

The status bar is one right-aligned row, 22px tall, 12px muted text, with the same padding on every item. Order: editing-mode icon (Obsidian shows that one), then backlinks, properties, words, characters. The backlink count is text only. There is no sync item. Properties stay hidden when the note has no frontmatter.

## How it was checked

From `rebuild/app`, headless only (Vite + headless Chromium, real pointer and key input). No windows on the real screen. Scratch paths under `/tmp` only. Chris's vaults were not opened.

- `npx tsc --noEmit`
- `npm test`: browser discovery, vitest (251, including `recentVaults`), geometry, the existing browser scripts, the explorer drag script, and `scripts/test-r27a.mjs`. All passed.
- `cargo test` in `src-tauri`: 36 passed, including the two `create_vault_dir` tests (new folder, refuse to clobber, refuse a missing parent, refuse an empty path). Those tests use the crate's temp directories.
- `npm run audit:offline`: passed, 140 source files.

The drag script's scroll measurement clicks "Collapse all" only when that label is showing, so a tree that is already collapsed is not expanded first.

## Left out

The mock does not create a directory on disk. A switched vault is remembered in `sessionStorage` and the next page load starts empty unless it is the sample vault. The real folder create is the Rust command.

Switching reloads the window. The open views are not retargeted in place.

The first Tauri launch still uses `window.prompt` when there is no last vault (`vault.ts`). The footer does not. No folder-picker plugin was added.

The status bar size is the public 12px / 22px bar. A live Obsidian window was not measured. The editing-mode icon stays, ahead of the four counts.

Individual folder open and close still slide. Menus and prompts do not animate.
