# Round 27f

Status bar, word count, vault footer, and Expand all on nested folders. No canvas files. Nothing was pushed.

## What changed

The status bar is the installed app's corner chip. It uses the secondary background, a 1px top and left border, an 8px top-left radius, and it sits flush in the bottom-right corner. Text is 12px and muted. The bar's minimum height is 18px, its padding is `4px 8px 4px 4px`, and the gap is 4px. The order is backlinks, properties (hidden when the note has no frontmatter), the editing-mode icon, then words and characters together as one item. The mode icon is no longer first.

Word count follows the installed app. A run of hyphens is a word, so a bullet `-` and a rule `---` each count. Digits stay together across commas and dots, and a hyphen joins that group to letters, so `5,000-line` is one word. An underscore splits a word. Han, hiragana, katakana, and Tibetan are one word per character. Hangul stays one word. Frontmatter is still left out. Characters are still the body length. The sample Welcome note is 174 words and 1,019 characters; the old counter said 169. The 42-versus-38 gap in the brief is four list-marker hyphens. The same rules turn that 38 into 42. Both numbers are locked in the unit test.

The editing-mode menu lists Reading, Source mode, and Live Preview. The installed app lists those three, so Reading stays. The menu does not animate.

The vault footer is an up/down chevron in the faint colour beside the vault name. The name is weight 500 and 13px. Help sits beside the settings gear and opens a short note about this vault. There is no address and no animation. The vault menu lists recent vaults and "Manage vaults...", which opens "Open another vault..." and "Create new vault..." through the same path prompt as before.

Expand all opens every folder at every depth, including empty folders and a folder of many files, and the button becomes Collapse all. Collapse all closes every depth at once and the button becomes Expand all. Closing a folder by hand does not flip the button back, and it remembers which nested folders were open. A new folder starts closed. Renaming a folder keeps it and its children open. Open folders are stored per vault and restored on reload. One folder still slides open and closed. Collapse all does not.

## How it was checked

From `rebuild/app`, headless only (Vite and headless Chromium, real pointer and key input). Scratch browser profiles and scratch vaults under `/tmp`. Chris's vaults were not opened. No window was opened on the real screen. The installed Obsidian app was not launched. The status bar, the editing-mode menu, the vault footer, and Expand all were read from that app's installed script and stylesheet, then measured on Grove's computed style.

- `npx tsc --noEmit`
- `npm test`: browser discovery, vitest (260, including the word-count cases), geometry in Live Preview, Source, and Reading on notes with frontmatter, the existing browser scripts, `scripts/test-r27a.mjs`, and `scripts/test-r27f.mjs`. All passed.
- `npm run audit:offline`: passed, 140 source files.
- Rust was not changed, so `cargo test` was not run.

## Left out

The editing-mode icons stay Grove's (`code-xml`, `pen-line`). The installed app draws `code-2` and `edit-3`.

Help does not open the installed app's help vault. That leaves the machine. The button explains the vault in a dialog.

The vault menu does not add Show in system explorer or Copy path.

The footer class stays `vault-switcher`.

The status bar is the flush corner chip from the installed stylesheet. The radius is only on the top-left.

The word pattern uses a Unicode flag this TypeScript target accepts.

## Net

+392 lines, counting this file. The screenshot files the browser tests rewrite were not kept.
