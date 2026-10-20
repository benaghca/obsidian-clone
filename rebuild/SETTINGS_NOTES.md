# Round 6: settings

Grove now has settings: an Obsidian-style settings modal, a dark theme, a hotkey editor, core plugins that can be turned off, and the Files and links behaviour (link format, link updating, delete options, excluded files). Everything in `SETTINGS_TASK.md` is done, or left out with a reason below.

- **Checks:** `npm run build`, `npm test` (89 tests, up from 75), `npm run audit:offline`, `cargo build` and `cargo test` (24 tests, up from 20) all pass.
- **Speed:** typing and note switching are as fast as before (numbers at the end).
- **Network:** zero requests to anything but the local dev server in every run.

Commits on `rebuild/r6-claude`, oldest first:

| Commit | What |
|---|---|
| `93e18e9` | Backend: `read_config` / `write_config` for the vault's `.grove` folder, permanent delete |
| `a5d388d` | Work in progress: schema, store, editor compartments, dark theme, links, registry hotkeys (didn't build on its own) |
| `d8c895d` | Settings modal, dark theme, hotkey editor, core plugins, Files and links, round 5 fixes |
| `49c1196` | Idle font detection, hotkeys page in two frames, one-recalc theme switch, narrow panes keep whole words |
| `82b0387` | Tauri window: whole empty tab bar drags, right-sidebar button clears the window buttons, local spellchecker on |
| `b4fc0e6` | Excluded files: also out of the quick switcher, search, the Tags view and unlinked mentions |
| (last) | These notes |

## How Obsidian was observed

As in round 5:
- Obsidian 1.14.4 ran with `HOME` and the `XDG_*` folders in the session scratchpad, on a throwaway three-note vault.
- It ran in its own network namespace (`unshare --net`, loopback only) and headless.
- A small bridge (a Unix socket into the namespace) let a CDP script read what is on screen: layout, sizes and computed colours of its elements, screenshots, and its documented theme variables' computed values.
- No Obsidian source, CSS file or asset was opened or copied. Everything in Grove is written from those observations.

Two observations changed the plan:

1. **Settings opens in its own window by default in Obsidian 1.14.** It has an Interface option, "Open settings in new window" (on by default). With it off, settings is an in-app modal, which is what the brief asks for and what Grove can do (no extra windows under the lockdown). Grove matches that modal:
   - At 1280×800 it measured 1100 × 680 (85vh), centred, 12px radius, a 1px #dadada border and a three-step shadow.
   - The navigation column is 250px with a search field.
   - The content is cards at most 700px wide, starting 48px from the top.
2. **The settings gear in 1.14 is at the right of the vault footer, under the left sidebar,** not in the ribbon. With the sidebar collapsed, 1.14's ribbon has no gear at all.
   - Grove puts the gear in the vault footer (observed).
   - While the left sidebar is closed, it shows at the foot of the ribbon instead (the brief's position), so a mouse can always reach settings.

## A. The settings modal

- **Opening and closing:**
  - Ctrl/Cmd+, opens it, so do the gear and the "Open settings" command (`app:open-settings`).
  - Esc, the × button or a click outside closes it.
  - It uses the existing modal motion (fade plus pop-in, `animateOut` on exit) and focus goes back where it was.
  - While it is open, app hotkeys stand aside.
- **Layout (`src/settings/modal.ts`):**
  - Left: a "Search settings..." field, then "Options" and "Core plugins", each item with its Lucide icon. The icons are Obsidian's: `circle-user`, `palette`, `monitor`, `pen-line`, `folder-cog`, `command`, `toy-brick`; plugin pages use their own.
  - Right: the selected section.
  - The last section shown is remembered while the app runs.
  - Up/Down move through the sections; Enter or Space opens one; Tab reaches everything.
- **Search** filters every section's rows by name and description, showing matches grouped under their section names. Rows stay live, so a setting can be changed straight from the results. Clearing the field (or Esc in it) goes back to the section.
- **Lazy:** opening builds the frame and the selected section only. Other sections are built the first time they are shown or searched.
- **Shared row component (`src/settings/controls.ts`):** a name, a muted 12px description, and the controls on the right. Rows sit in 12px-radius cards with 1px separators inset 20px, under an optional 15px/600 heading. All of this matches Obsidian's measured values.
  - **Toggle:** a 40×22 pill with an 18px white knob, accent when on. `role="switch"`; Space or Enter flips it.
  - **Dropdown:** a native `<select>` (keyboard and screen readers for free), 30px high, 5px radius, the input shadow, and Lucide's `chevrons-up-down` on the right.
  - **Slider:** a 100×4 track filled with the accent up to the knob. The value shows beside it, and a "Restore default" button appears while it differs. Arrow keys work natively.
  - **Text and number inputs:** 30px, with a focus ring.
  - **Buttons:** normal, call-to-action and warning.
  - **Small icon buttons:** Restore default, Options, Hotkeys.
  - **Hotkey chips** (below).
- **Every row is backed by a working setting.** Changes apply as they are made, with no reload.

## B. The sections, compared with Obsidian 1.14.4

Obsidian's settings are listed in its order. ✔ means in Grove; ✘ means left out, with the reason.

### General

| Obsidian | Grove |
|---|---|
| Version, Check for updates | ✔ "Version 0.1.0", followed by the statement that Grove makes no network connections and has no updater, account, sync or telemetry. ✘ Check for updates. |
| Automatic updates, early access, Language, Help, Account, licences | ✘ All need the network or don't apply. Grove is English only. |
| Notify if startup is slow, Command line interface, Hardware acceleration | ✘ Not applicable. |
| (open the vault's config folder) | ✘ The lockdown denies the opener's `open_path` / `reveal_item_in_dir`, so there is no "open folder" button. A "Settings folder" row shows the full path to `.grove` with a **Copy path** button instead. |

### Appearance

| Obsidian | Grove |
|---|---|
| Base color scheme: Dark / Light / Adapt to system | ✔ Same three, same default ("Adapt to system", which follows the system while the app runs). |
| Accent color, with a reset | ✔ A colour picker plus Restore default. The default is Grove's teal `#27867a`. |
| Themes, community themes, CSS snippets | ✘ No downloadable themes. CSS snippets would be outside code; left out. |
| Interface font, Text font, Monospace font | ✔ A text field per font, with suggestions of fonts installed on this computer, chosen by name. Nothing is ever downloaded. Names are checked (letters, digits, space, `_ . -`) so they can't break out of CSS. Obsidian opens a font-manager list; Grove uses a field with suggestions. |
| Font size slider | ✔ 10–30px, Restore default. Also driven by "Increase/Decrease font size". |
| Quick font size adjustment (Ctrl+scroll) | ✘ Not built. |
| Custom app icon | ✘ Not applicable. |

How the font suggestions work: a canvas measurement of about 60 common family names, run in idle slices the first time Appearance shows. Families that fontconfig aliases (Arial → Liberation Sans) count as installed, since they render.

### Interface (a separate section in 1.14)

| Obsidian | Grove |
|---|---|
| Show tab title bar | ✔ Hides the view header (back/forward, title, view buttons). |
| Show ribbon | ✔ Also "Toggle ribbon". It is now per vault in `appearance.json`. |
| Ribbon menu configuration | ✔ A "Ribbon" card with a toggle per ribbon button. The same set as the ribbon's right-click menu, stored per machine as before. |
| Zoom level slider (−2.5…3 in 0.5 steps, 100% at 0) | ✔ Same scale: factor 1.2^level, shown as a percentage. Applied with the webview's own zoom (new capability `core:webview:allow-set-webview-zoom`). Also the new commands Zoom in (Ctrl+=), Zoom out (Ctrl+−) and Reset zoom (Ctrl+0), Obsidian's defaults. In the browser preview, CSS zoom stands in. |
| Native menus, Window frame style, Open settings in new window | ✘ Not applicable (Grove's menus are its own; frameless only; no extra windows). |

### Editor

| Obsidian | Grove |
|---|---|
| Default view for new tabs (Editing / Reading) | ✔ New tabs start in that view. New notes always open for editing. |
| Default editing mode (Live Preview / Source) | ✔ |
| Show editing mode in status bar | ✘ Not built. |
| Inline title | ✔ Hidden when off. F2 / Rename shows it just for the rename. Obsidian has this under Editor in 1.14; the brief listed it under Appearance. |
| Readable line length | ✔ Moved from a per-machine flag into the setting. Also "Toggle readable line length". |
| Strict line breaks | ✘ Grove's Reading view is the editor made read-only, so each source line stays a line. Joining soft-wrapped lines would need replace decorations across line breaks for the whole note: not cheap, and a risk on the 5,000-line note. |
| Properties in document | ✘ No properties UI. |
| Fold heading, Fold indent | ✔ Both on by default, as in Obsidian. Details below. |
| Line numbers | ✔ Faint numbers in the margin left of the column; the text doesn't move. Also "Toggle line numbers". |
| Indentation guides, Right-to-left, Mermaid diagrams | ✘ Not built. Mermaid would need a renderer dependency. |
| Spellcheck | ✔ Also "Toggle spellcheck". Details below. |
| Spellcheck languages | ✘ The checker uses the locale's language. |
| Auto-pair brackets | ✔ CodeMirror's `closeBrackets` for ( [ {, Grove's set as before. With it off, `[[` no longer auto-closes, and the link suggester still writes the whole link. |
| Auto-pair Markdown syntax | ✔ Typing `* _ \` = ~ $` with text selected wraps the selection and keeps it selected, so `**` around a word is two key presses. This is what Obsidian does (observed: with nothing selected, nothing pairs). |
| Smart lists | ✔ On: Enter continues a list and an empty item ends it; Backspace removes markup (round 4's behaviour). Off: plain newline. |
| Indent using tabs, Indent visual width | ✔ Tab or N spaces (`indentUnit`) and the tab width (`tabSize`, 1–8). Obsidian's default is tabs, so Grove now indents with tabs by default (it was 4 spaces). |
| Convert pasted HTML, Vim key bindings | ✘ Not built. |

**Folding.**
- There is no fold gutter. When the pointer is over a line that can fold, a chevron appears in the margin beside it, as in Obsidian. It is worked out for that one line on pointer moves, never per keystroke.
- A folded line keeps a turned chevron, and its body shows as "…".
- Headings fold their section. Lists, quotes, code blocks and tables fold their block (fold indent).
- Commands: "Toggle fold on the current line", "Fold all headings and lists" and "Unfold all headings and lists".

**Spellcheck.**
- The webview's checker is WebKitGTK's: Enchant with the dictionaries installed on the machine. It is fully local (verified: `libwebkit2gtk` links `libenchant-2`, and nothing is networked).
- wry leaves it switched off, so the existing `spellcheck="true"` did nothing in the app.
- The backend now turns it on for the locale's language when it builds the window. `webkit2gtk` was already compiled in through wry; it is now named directly (Linux only) and is on the audit's crate allowlist.
- This machine has no Hunspell dictionaries installed (Enchant loaded, but found none), so no squiggles show here until one is installed (for example `hunspell-en_us`).

**How editor settings apply.** Each one is in its own CodeMirror `Compartment` (`src/editor/config.ts`).
- A change reconfigures each pane's editor on screen in place: one transaction per pane, nothing re-created.
- Notes off screen are brought up to date when next shown (an identity check on the compartment's extension, like the view-mode compartment).
- New and mirror states are created with the current settings.
- Checked with Big note in two panes: line numbers appeared in both, and both editors' DOM nodes stayed the same objects.

### Files and links

| Obsidian | Grove |
|---|---|
| Default file to open, Always focus new tabs | ✘ Not built. Grove restores the last layout and always focuses. |
| Default location for new notes: Vault folder / Same folder as current file / In the folder specified below (+ folder) | ✔ Used by "Create new note", the ribbon, the explorer header, and links to notes that don't exist yet. The folder row shows only for the third choice; the folder is created if missing. |
| Attachments settings, Show all file types | ✘ Grove handles notes only. |
| New link format: Shortest path / Path from current file / Path from vault folder | ✔ Used by the `[[` suggester, unlinked-mention linking and link updating. Shortest uses the full path when another note has the same name. |
| Use [[Wikilinks]] | ✔ Off writes `[Name](Name.md)` with spaces as `%20`, as Obsidian does. Markdown links to notes now open the note when clicked (they used to go to the external opener and be refused), and "Open in new tab" works on them. |
| Automatically update internal links | ✔ Off (Obsidian's default): after a rename or move Grove asks "Update links?", with "Update" / "Don't update" and "Don't ask again" (which turns the setting on). On: links are updated without asking. |
| Confirm before deleting files | ✔ Obsidian's dialog: "Delete file", message, red Delete, Cancel, "Don't ask again". It covers every delete path (menus, commands, explorer). |
| Delete attachments when deleting files | ✘ No attachments. |
| Deleted files: system trash / Obsidian trash / Permanently delete | ✔ "Move to Grove trash (.trash folder)" (default) and "Permanently delete". ✘ System trash: it would need a new crate (`trash`), and the brief allows it only without new permissions or dependencies. |
| Excluded files | ✔ Details below. |
| Override config folder, Allow URI callbacks, Rebuild vault cache | ✘ Not applicable. |

**Link updating after a rename (`src/links/update.ts`, `src/links/internal.ts`, tested).**
- **Which notes it looks in:** the link index's backlinks for the old path (read before the index refreshes), plus a search for the name for markdown links.
- **What it rewrites:** `[[target]]`, `[[target#heading|alias]]`, `![[embeds]]` and `[text](path.md)`. Headings and display text are kept; code blocks and inline code are skipped.
- **Folders:** each note inside a renamed folder is handled.
- **Where the changes land:** in the editor if the note is loaded (only changed lines are replaced, undoable, saved as usual), otherwise on disk.
- **Check:** renaming Welcome rewrote all 986 links in Big note.

**Excluded files.**
- Each filter is a folder or file path, or a `/regular expression/`. Filters are added and removed in a small list under the row.
- Matching notes are left out of the quick switcher, link suggestions, search results, the Tags view, unlinked mentions (both views) and Random note.
- Obsidian makes them "less noticeable" in the switcher and suggestions; Grove leaves them out entirely, which is simpler and clearer.

### Hotkeys (`src/settings/hotkeys.ts`)

This follows Obsidian 1.14's page as observed:
- A **Filter...** field. Its keyboard button filters by pressing a hotkey.
- Pills: **Conflicts N** (red, shown only when there are conflicts), **All**, **Assigned**, **Assigned by me**, **Unassigned**.
- One row per enabled command, sorted by name.
- Each row shows its hotkeys as chips (×  removes one), or a "Blank" chip. There is a restore button (`rotate-ccw`) when customised, and a `circle-plus` button that records a new hotkey.

**Recording:**
- The chip turns accent and reads "Press hotkey...".
- Modifiers alone wait; Escape on its own cancels; a click elsewhere cancels.
- Bracket and other layout-sensitive keys are taken from the physical key.

**Conflicts:**
- A hotkey shared with another enabled command shows as a red chip, titled "This hotkey conflicts with “…”". Checked with a real Ctrl+P on "Add cursor above": red, naming the command palette.
- Grove's handler runs the first available command, so a conflict is a warning, as in Obsidian.

**Effect:**
- Changes go to the settings store, which writes `hotkeys.json` and hands the custom hotkeys to the command registry.
- The registry rebuilds its key map and tells listeners. Menus, the palette's chips, the empty-tab hints and this page show the new hotkeys at once.

**Format:** `hotkeys.json` uses Obsidian's shape: `{ "editor:toggle-bold": [{ "modifiers": ["Mod"], "key": "B" }] }`. Only customised commands are listed; an empty list means "no hotkeys".

**Lazy build:** the first screenful of rows is built at once and the rest on the next frame. Its first build went from 12ms to 5ms.

**Core plugins' hotkeys button:** each plugin's `circle-plus` button opens this page filtered to that plugin.

### Core plugins

Obsidian's list has 29 entries. Grove offers the twelve of those it has, with Obsidian's names and descriptions (adapted where Grove's feature is smaller). There is no Community plugins entry. Turning one off removes it from the commands (and their hotkeys), the palette, the hotkey list, the ribbon, menus, views and the status bar, as listed:

| Plugin | Turning it off removes |
|---|---|
| Backlinks | "Show backlinks" and "Toggle backlinks in document"; the right sidebar's Backlinks tab; the status bar's backlink count; backlinks under notes; "Backlinks in document" and "Open backlinks" in menus |
| Bookmarks | Its four commands; the left sidebar's Bookmarks tab; every Bookmark / Remove bookmark / Bookmark N tabs menu item |
| Command palette | Ctrl+P and the ribbon button |
| Daily notes | Its three commands; the ribbon button |
| Note composer | "Merge current file with another file..."; every "Merge entire file with..." menu item |
| Outgoing links | Its command; the right sidebar tab; the linked-view menu item |
| Outline | Same as Outgoing links |
| Quick switcher | Ctrl+O, its ribbon button and the empty tab's "Go to file" |
| Random note | Its command and ribbon button |
| Tags view | Its command, the right sidebar tab, the linked-view menu item |
| Templates | Insert current date / time, the new "Templates: Insert template" and its ribbon button |
| Word count | The status bar's word and character counts |

- If every right-sidebar view is off, the right sidebar closes and its toggle button goes.
- Each row has Obsidian's gear (Options, for plugins with a page) and hotkeys buttons, shown while the plugin is on.
- Plugin pages under "Core plugins" appear and disappear in the navigation as plugins are switched.
- **Random note** defaults to on in Grove (it is off by default in Obsidian), so that nobody loses the ribbon button they have.

**Plugin pages:**

| Page | Settings |
|---|---|
| **Backlinks** | "Show backlinks at the bottom of notes": new tabs start with backlinks under the note. |
| **Daily notes** | **Date format:** Obsidian's four presets, shown as today's date, plus Custom with a live preview. **New file location.** **Template file location.** "Open today's daily note" builds the path from these and creates the note from the template. Previous/next daily note follow the format and folder. Checked: format `dddd D MMMM YYYY`, folder `Journal` → `Journal/Tuesday 20 October 2026.md`. |
| **Note composer** | "Confirm file merge" (Obsidian's), with a merge dialog. |
| **Templates** | Template folder location, Date format, Time format. "Templates: Insert template" lists the folder's notes and inserts one with `{{title}}`, `{{date}}`, `{{time}}` and `{{date:FORMAT}}` / `{{time:FORMAT}}` filled in. "Insert current date / time" now use these formats. |

Dates use a small Moment-style formatter (`src/settings/dateFormat.ts`, tested): YYYY, MM, DD, Do, ddd, dddd, MMM, MMMM, HH, hh, mm, ss, A, W, Q and `[literal]`.

Left out of the plugin pages:
- **Command palette:** pinned commands.
- **Quick switcher:** its options. Grove lists only existing notes and has no attachments.
- **Files and Search:** they can't be turned off; the left sidebar is built around them.

### New commands (with Obsidian's names)

| Command | Hotkey |
|---|---|
| Open settings | Ctrl+, |
| Toggle light/dark mode | none |
| Zoom in / Zoom out / Reset zoom | Ctrl+= (and Ctrl+Shift+=) / Ctrl+− / Ctrl+0 |
| Toggle line numbers | none |
| Toggle spellcheck | none |
| Toggle fold on the current line / Fold all headings and lists / Unfold all headings and lists | none |
| Add file property | Ctrl+; (Obsidian's default, observed) |
| Templates: Insert template | none |
| Backlinks: Toggle backlinks in document | none |

## C. Storage

- **Files:** per vault, in the vault's `.grove/` folder (Grove's `.obsidian/`), as plain two-space-indented JSON:
  - `app.json` (Editor, Files and links)
  - `appearance.json` (Appearance, Interface)
  - `hotkeys.json`
  - `core-plugins.json`
  - `daily-notes.json`, `templates.json`, `backlink.json`, `note-composer.json`
- **What goes in a file:** only the values that differ from the defaults, as in Obsidian. A file is therefore a readable list of what was changed. Keys Grove doesn't know are kept on the next write.
- **Defaults and bad values (`src/settings/schema.ts`, tested):**
  - A missing file means defaults.
  - Each value is checked (type, choices, ranges and slider steps, safe font names, `#rrggbb` colours). An invalid value falls back to its default quietly.
  - An unreadable file, or one that isn't JSON, is left alone on disk and treated as defaults, with a console warning.
- **Loading:** settings load right after the vault opens, before the first note shows, and apply in one pass.
- **Writing:** debounced 500ms per file, and flushed when the window closes. Only the settings UI and a few commands write; nothing on the typing path does.
- **Per machine:** window and layout state stays in localStorage, as allowed, and so do the ribbon's per-button visibility and recent commands.
- **Not migrated:** the old per-machine font-size, readable-line-length and ribbon flags. Those settings now come from the vault and start from their defaults.
- **Mock backend:** it keeps the `.grove` files in localStorage, so settings survive a reload of the dev page.

### Backend commands added (documented in `CONTRACT.md`, with Rust tests)

- `read_config(name) -> Option<String>` and `write_config(name, content)`:
  - `name` must be a plain lower-case `[a-z0-9-]+.json` (at most 64 characters), so nothing outside `.grove/` can be named.
  - A `.grove` that leads outside the vault (a symlink) is refused, through `fsutil`'s existing inside-the-vault check.
  - Files over 1 MB are refused.
  - `write_config` requires valid JSON and writes atomically (temp file and rename).
  - Each has its own `allow-read-config` / `allow-write-config` permission.
- `.grove` is in `fsutil`'s skip list, so it is never listed, searched, indexed or reported by the watcher, and the note commands refuse paths in it.
- `delete_path(path, permanent?)`: the optional flag removes for good instead of moving to `.trash` (for "Deleted files: Permanently delete").
- Tests: name checks, symlink refusal, round trip, refused writes leave the file unchanged, `.grove` not listed or searched, no temp files left, permanent delete of files and folders.
- Not a command: the spellchecker switch-on in `lockdown.rs` (above).

## The dark theme

- Obsidian 1.14.4's default dark theme was observed: computed colours of its body, ribbon, sidebars, tab strip, active tab, view, settings modal, cards, inputs and cover, and the computed values of its documented theme variables.
- Grove's `theme.css` now has a `.theme-dark` block with those values: backgrounds #1c1c1c / #232323 / #282828 / #333333, text #dadada / #b3b3b3 / #666666, borders #333333 / #3f3f3f, form fields #2e2e2e, settings cards #232323, the dark shadows and menu edge.
- Light is unchanged apart from new tokens the settings UI needs: card background, form field, toggle off, slider track, input shadow.
- **Accent:**
  - Settings give a hue, saturation and lightness (`src/settings/accent.ts`, tested).
  - The light theme uses the colour as chosen, darker on hover.
  - The dark theme lifts its lightness so links and toggles keep their contrast. Grove's teal becomes a seafoam #3ac6b3-ish for text, as Obsidian's dark theme lifts its violet.
  - The lightness values are computed in JS rather than with CSS `clamp()` in colours, which the webview might not support.
- **No flash at startup:**
  - `public/boot.js` is a plain blocking script in `<head>` (not inline, so the CSP and the audit are satisfied). It puts the last used scheme class, accent and font variables on `<html>` from localStorage before the first paint.
  - Checked: when `<body>` first appears, `<html>` already has `theme-dark` and the saved accent hue.
  - The vault's own `appearance.json` is applied once loaded. A vault whose settings differ from the last one used corrects itself then.
- **Switching scheme or accent:**
  - It flips one class or a few variables. No editor is touched; editors re-measure only when fonts or the text size change.
  - The app's 100ms hover-colour transitions would all fade at once and cost a style recalc per frame (measured: about 15 in 250ms). They are held off for the frame of the change (`.is-recolouring`). A switch is now one recalc, plus one to lift the hold.

## Round 5 findings

| # | Finding | What was found | Fix |
|---|---|---|---|
| 1 | Missing menu items | — | **Backlinks in document** is built: a per-tab Backlinks view under the note, in the tab and More options menus, first as in Obsidian, with a check. **Add file property** adds a property line to the note's frontmatter (creating `---` / `---` if none) with the caret on it; it sits after "Merge entire file with...", as in Obsidian. Both go with their plugin or in Reading view. Left out: **Open in new window** (the lockdown denies new windows), **Export to PDF** (printing needs a webview permission Grove doesn't grant), **Open version history** (that's Sync), **Link with tab** (linked panes are still not built; round 5). |
| 2 | Drop overlay flat and opaque | Observed in Obsidian: a light accent at half opacity, 8px radius. Grove's was the dark teal at 22%, which reads grey-teal and flat. | A light teal (the accent hue at 62% lightness, 40% alpha; a lifted teal in dark). It is lighter and see-through like Obsidian's lavender. |
| 3 | Pane minimum ~100px | Measured in Obsidian: a divider drag stops at **200px**, but window resizes still squeeze panes (76px seen, with words broken mid-word). Grove's drag minimum was 160px. The ~100px seen came from splits and the window. | Drag minimum raised to 200px (Obsidian's). Narrow panes give their text most of the room (container queries: 16px margins below 360px, 8px and a smaller title below 220px), so at 204px "Welcome" and ordinary words stay whole (checked). A 130px CSS floor was tried and dropped: an extra pane overflowed and was clipped, which was worse. |
| 4 | Active-pane cue | Measured in Obsidian: the inactive pane's active tab title and view-header title use the muted colour; header icons are not dimmed. | Titles keep Grok's faint (the owner found muted hard to see), and header icons are no longer dimmed, as in Obsidian. |
| 5 | Untested in the real Tauri window | Ran `tauri dev` (on port 1489 via a config override, since another session holds 1420), with a scratch vault in `/tmp` and scratch `XDG_*` folders, so the owner's remembered vault was never read. A temporary self-test (never committed) reported through a blocked navigation. | **Dragging by an upper pane's empty tab bar:** the spacer dragged, but the band above and between the tabs didn't, because Tauri's drag script only drags on the element carrying the attribute itself. Fixed; with two panes, both upper panes now drag from both places and tabs don't. **Right-sidebar button when split:** only the top-right pane has it, but it sat 2px under the window buttons (98px wide in WebKitGTK, 92px assumed). Their width is now measured; it clears them. **Also checked there:** the settings modal (11 sections), dark theme, line numbers in both panes, zoom (2024 → 1686 CSS px at 120%), `.grove/app.json` and `.grove/appearance.json` written and not listed, the spellchecker loaded. The screen was locked, so there was no visual check. The self-test, scratch vault and folders are removed. |
| 6 | `#` showing on headings | Observed in Obsidian: a newly opened note gets the caret on line 1 and focus, and its `# ` shows (faint). The same note in an unfocused pane, caret also at line 1, keeps it hidden. Obsidian reveals markup only in the focused editor. | Grove now does the same: Live Preview reveals around the selection only while that editor has focus (and rebuilds on focus change). Panes you aren't typing in keep their headings clean. |

## Performance

**Harness.**
- A dependency-free CDP harness (scratchpad, not committed) drives headless Chromium at 1280×800 against the Vite dev server and the mock vault (Big note: 5,000 lines).
- The baseline is this round's start, `dee8699`, extracted and served on its own port. Builds alternated.

**What each measurement does:**
- **Typing:** 80 keys at line 2,500, keydown to the end of the next painted frame. "Two panes" has Big note split, typing in one.
- **Switch:** 40 alternating opens of Welcome and Big note, to the painted frame, plus the synchronous work.
- **Settings open:** a real Ctrl+, keydown to the painted frame, checking the modal is in that frame; 15 times.
- **Section switch:** clicking each of the 11 sections, 15 times; the work and the painted frame.
- **Theme switch:** "Toggle light/dark mode", 20 times: work, painted frame and Chromium's style-recalc count and time.
- **Setting change:** "Toggle line numbers" with Big note in two panes, to the painted frame.

Means in ms (p95), two runs at 1×:

| | Before, 1× | After, 1× | Before, 4× CPU | After, 4× CPU |
|---|---|---|---|---|
| Typing, key to frame | 10.0 (17.6), 9.9 (17.7), 9.9 (17.7) | 9.9 (17.2), 10.4 (17.8) | 16.7 (22.0), 16.0 (21.6) | 16.8 (22.1) |
| Typing, same note in two panes | 11.0 (18.4), 10.7 (18.0), 10.4 (17.7) | 10.8 (17.7), 10.3 (17.3) | 19.5 (24.3), 18.3 (23.1) | 20.2 (24.3) |
| Note switch, to painted frame | 13.3 (19.1), 13.2 (18.6), 13.2 (18.4) | 13.2 (18.9), 13.0 (18.1) | 31.4 (46.9), 29.2 (41.8) | 29.3 (41.1) |
| Note switch, sync work | 1.9, 1.9, 2.1 | 2.1, 1.9 | 8.3, 7.8 | 8.1 |
| Switch in the right pane of a split | 12.2 (14.1), 11.6 (13.9), 12.1 (13.9) | 12.2 (13.9), 12.3 (14.0) | 20.6 (25.0), 20.5 (23.4) | 20.6 (24.0) |
| Settings open (Ctrl+, to painted frame) | n/a | 13.6 (20.3), 13.7 (20.3) | n/a | 17.7 (24.4) |
| Section switch, sync work | n/a | 1.4 (3.9), max 5.1; 1.5 (4.3), max 5.5 | n/a | 5.3 (14.5), max 22.5 |
| Section switch, to painted frame | n/a | 5.3 (12.9), 5.2 (13.9) | n/a | 15.9 (51.7) |
| Theme switch, sync / to painted frame | n/a | 0.2 / 14.9 (15.8) | n/a | 0.5 / 26.6 (33.6) |
| Theme switch, style recalcs in that frame / time | n/a | 1–2 / 3.4ms | n/a | 2 / 18ms |
| Line numbers on/off, two panes: sync / to painted frame | n/a | 0.8 / 16.1 (18.1) | n/a | 2.6 / 22.8 |

- **Typing:** still about 10ms, and about 11ms with the same note in two panes. Nothing new runs per keystroke. The settings, folding, link and exclusion code only runs on settings changes, pointer moves (the fold chevron, rAF-coalesced) or commands.
- **Note switching:** unchanged, about 13ms to paint and 2ms of work, in either pane. A note shown after a settings change gets one extra reconfigure transaction, once.
- **Settings:**
  - It opens on the first frame after Ctrl+, (the harness checks the modal is in that frame).
  - Sections switch within a frame at 1× (worst 5.5ms of work).
  - Two first builds were too slow and were fixed: Appearance took 94ms, from detecting installed fonts, which now runs in idle slices after it shows; Hotkeys took 12ms, and now builds its first screen first.
  - At 4×, the Hotkeys page's first build takes up to 22ms.
- **Theme switch:** one style recalc in the frame (3.4ms at 1×), no layout. A second, cheap recalc lifts the transition hold. It was about 15 recalcs over 250ms before the hold.
- **Motion:** only opacity and transform animate in anything new (the modal's pop-in, the confirm dialog). The toggle knob's slide is a transform; the toggle's colour fade is a 150ms background transition like the app's existing hovers. Under `prefers-reduced-motion` the tokens are 0ms, as before.
- **Network:** zero requests to anything but the dev server in every run.

**Bundle:** JS 713.5 → 786.9 kB (gzip 242.3 → 266.4 kB). CSS 35.5 → 54.7 kB (gzip 6.8 → 9.7 kB). `boot.js` is 1 kB.

## Skipped, deviations and caveats

- **Settings window.** Obsidian 1.14 opens settings in its own window by default. Grove uses the in-app modal (Obsidian's other mode), because the brief asks for a modal and Grove opens no extra windows.
- **Settings gear.** It is in the vault footer, as in 1.14 (observed), and at the ribbon's foot only while the left sidebar is closed. The brief asked for the ribbon.
- **Inline title** is under Editor and **Show tab title bar / Show ribbon / Zoom** under Interface, following 1.14's sections rather than the brief's grouping.
- **Defaults that change Grove's behaviour, matching Obsidian's:**
  - The scheme defaults to "Adapt to system", so a dark system makes Grove dark on its first start with this build.
  - Indentation now uses tabs.
  - Deleting now asks first.
  - Renaming asks before updating links (Obsidian's default for "Automatically update internal links" is off).
- **Left out, with reasons in section B:**
  - Strict line breaks
  - System trash
  - Open config folder
  - Quick font size adjustment
  - Show editing mode in status bar
  - Properties in document
  - Indentation guides
  - RTL
  - Mermaid
  - Spellcheck languages
  - HTML paste conversion
  - Vim
  - Default file to open
  - Always focus new tabs
  - Attachment settings
  - Command palette pinned commands
  - Quick switcher options
  - Themes and snippets
  - Every update, account, language and help setting
- **Link updating limits:**
  - A note that moves to another folder doesn't have its own *relative* links rewritten.
  - The backend's link index only knows `[[wikilinks]]`, so markdown links to a renamed note are found through search (which also finds the `%20` form), not the index. Backlinks views still count wikilinks only, as before.
- **Hotkeys:** on macOS, Obsidian's files can say "Ctrl" (the real Ctrl key) apart from "Mod" (Cmd); Grove reads both as its one modifier.
- **Zoom at startup:** the webview zoom is applied once the vault's settings load, so a non-100% zoom can show one frame at 100% while the app starts. The scheme and colours never flash.
- **Ribbon visibility per button** stays per machine (localStorage), as before; "Show ribbon" itself is now per vault.
- **Not checked by eye in the Tauri window:** the screen was locked. The window's checks were read from its DOM.
- **Harness and observation scripts** live in the session scratchpad, not the repo, as in earlier rounds. The Obsidian sandbox profile and vault were scratch-only and are shut down. The `/tmp` test vault and home were removed.
