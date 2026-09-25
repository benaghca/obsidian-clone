# Folio

A local, plugin-free notes app that works like Obsidian and uses the same vault format.

Your notes are plain `.md` files in one folder. Folio is a single `.exe` that opens its own desktop window and reads and writes that one folder. You can open the same vault in Obsidian at home and nothing needs converting.

## Build and run (Windows)

You need:
- **Rust** (stable, 1.85 or newer) with the default `x86_64-pc-windows-msvc` toolchain from rustup.
- **The MSVC linker**: Visual Studio Build Tools with the "Desktop development with C++" workload. Rust on Windows already needs this, so if you've built Rust programs on this PC before, you have it.
- **The Microsoft Edge WebView2 Runtime.** It ships with Windows 11 and current Windows 10, so it's almost certainly already there.

```bat
cargo build --release
target\release\folio.exe
```

The first build takes a couple of minutes. After that, copy `folio.exe` wherever you like and pin it to the taskbar. It's the only file you need.

- **Where your notes go:** the first launch uses `Documents\Folio` (created if missing). To use a different folder, pass it once, as in `folio.exe "C:\Users\you\Documents\Notes"`, or pick it in the app with **Settings → Vault → Change…**. Folio remembers the last vault and your window size.
- **Offline build:** the build needs no network. The source of every Rust dependency needed for 64-bit Windows and Linux is in `vendor-crates/`, and `.cargo/config.toml` points cargo at it. To build from crates.io instead, delete `.cargo/config.toml`.

```
folio [VAULT_DIR] [--browser [--port N] [--no-open] [--app]]

VAULT_DIR   folder of .md notes (default: last vault, else Documents\Folio)
--browser   serve the UI to a browser tab on 127.0.0.1 instead of Folio's own window
  --port N    port for --browser (default 43117)
  --no-open   don't open a browser automatically
  --app       open a chromeless Edge/Chrome window
```

**The native window** (the default) passes every shortcut to Folio, including Ctrl+N, Ctrl+W, Ctrl+P and F5, because the webview's own browser shortcuts are switched off. External links open in your normal browser. Closing the window saves any unsaved edits first. Release builds show no console window.

**Browser mode** (`--browser`) is a fallback if the window won't start, for example because WebView2 is blocked. In a browser tab, the browser keeps some shortcuts for itself, such as Ctrl+N and Ctrl+W.

On Linux, the native window uses WebKitGTK (`libwebkit2gtk-4.1`).

## For IT: what this program does and doesn't do

- **Network:** in its default mode, Folio doesn't open any network port. The UI talks to the program through a private `folio://` protocol that is handled inside the process. It never makes outbound connections: no telemetry, no update checks, no CDN assets. The page has a Content-Security-Policy of `default-src 'self'`, and a navigation guard sends any external link to the system browser instead of loading it inside Folio.
- **Browser mode (optional):** only when started with `--browser`, it listens on `127.0.0.1`. Each launch creates a random 256-bit token that the page must present with every call. Requests whose `Host` header isn't `127.0.0.1` or `localhost` are rejected, which blocks DNS rebinding. Together these stop other websites in the same browser from reading or writing notes.
- **No plugin system:** there's no way to load third-party code. Everything the app runs is compiled into the binary, and Folio's own UI is about 10,300 lines of readable JS, HTML and CSS in `ui/`. The third-party front-end code is vendored, with pinned versions:
  - `CodeMirror` 6 (the editor, MIT license), bundled with Folio's editor module into `ui/vendor/editor.bundle.js`. The source is `ui/editor/editor.js`, and `ui/editor/package.json` pins every package version.
  - `marked` 12.0.2 (a Markdown parser for reading view, MIT license)
  - `DOMPurify` 3.4.16 (an HTML sanitizer, Apache-2.0/MPL-2.0)
  - The `Virgil` hand-drawn font from Excalidraw (`ui/vendor/Virgil.woff2`, SIL Open Font License 1.1, see `ui/vendor/virgil.LICENSE.md`). It's a font file, not code.
  - The drawing editor is Folio's own code (`ui/draw.js`, `ui/draw-render.js`). It reads and writes Excalidraw's file format, but none of Excalidraw's code is included. Its sketchy-line maths is adapted from rough.js and its decompression from lz-string, both MIT-licensed (see `ui/vendor/draw-ports.LICENSE`).
- **Filesystem scope:** it reads and writes only inside the vault folder. Paths containing `..`, absolute paths, hidden files and symlinks that leave the vault are all rejected (see `resolve()` in `src/api.rs`). Deleted notes are moved to `<vault>\.trash`, never hard-deleted. The only other thing it writes is `%LOCALAPPDATA%\Folio`, which holds `config.json` (last vault and window size) and the WebView2 profile.
- **Rust dependencies:** `wry` and `tao` from the Tauri project (the webview window), `serde_json`, `tiny_http` (browser mode only) and `windows-sys`, plus their transitive dependencies. Their source is all in `vendor-crates/`. Dev tools are disabled in release builds.

## Features

- A file tree with folders, drag-and-drop moves, file import from the desktop, and rename, move and delete from the context menu
- **Live preview editing**, like Obsidian's: Markdown syntax is hidden and rendered as you write, and appears only on the line or element the cursor is in. That covers headings, bold, italic, highlights, links, tags, checkboxes you can click, bullets, callouts, quotes, code blocks, tables and embedded images and notes. Switch to plain source mode in Settings or from the command palette.
- Switch vaults from **Settings**, the command palette or by clicking the vault name above the file tree
- A reading view (**Ctrl+E**), plus an inline title you can edit to rename the note. **↑** on the first line jumps to the title.
- Proper undo and redo, multiple cursors, find and replace in the note (**Ctrl+F**), and syntax highlighting for code blocks (Python, JS/TS, JSON, Rust, SQL, shell, PowerShell)
- `[[wikilinks]]`, `[[Note|alias]]`, `[[Note#Heading]]` and relative `[md](links.md)`. Clicking a link to a missing note creates it.
- Autocomplete as you type `[[` (add `#` to pick a heading) or a `#tag`
- Clicking a rendered link follows it. **Ctrl+click** follows a link while its source is showing.
- Renaming or moving a note rewrites the links that point to it across the vault
- Embeds: `![[image.png|300]]`, `![[Other note]]` and `![[Other note#Section]]`
- Pasting or dropping an image into a note saves it to `attachments/` and embeds it
- Tags, both `#inline` and nested (`#area/sub`), and frontmatter `tags:` and `aliases:`
- A properties box that shows frontmatter in reading view
- Callouts (`> [!warning] Title`), `==highlights==`, GFM tables, and task lists you can tick in reading view (**Ctrl+Enter** toggles one while editing)
- A backlinks panel with context, including unlinked mentions and a one-click **Link** button, plus outgoing links and an outline
- A quick switcher (**Ctrl+O**; **Shift+Enter** creates a note) and a command palette (**Ctrl+P**)
- Vault search (**Ctrl+Shift+F**) with `tag:`, `path:`, `file:`, `"exact phrase"` and `-exclude`
- Daily notes with an optional template, and an *Insert template* command. Templates support `{{date}}`, `{{time}}`, `{{title}}` and `{{date:dddd, MMMM DD}}`.
- **Templater-style templates**, the syntax of Obsidian's Templater plugin: `<% tp.date.now("dddd, MMMM Do") %>`, `<% tp.file.title %>`, `<% tp.frontmatter.status %>`, `<%* let who = await tp.system.prompt("Who?") %>`, `if`/`else`, `for…of`, `tR +=`, `tp.file.cursor()`, `tp.file.rename()` / `move()` / `include()` / `create_new()`, `tp.system.suggester()` and whitespace control (`<%-` `-%>` `<%_` `_%>`). Dates use moment.js formats and ISO durations (`"P1W"`).
  - *Create new note from template* and *Replace template commands in current note* commands.
  - **Folder templates** (Settings): new notes in a folder start from that folder's template.
  - Templates run in a small built-in interpreter, not as JavaScript, so a template can't reach anything outside the note and the vault. Arbitrary JavaScript, `tp.web` (network), `app` and user scripts aren't supported; using them gives a clear error.
- A graph view (**Ctrl+G**): global or local with a depth slider, optional tags, unresolved-link and attachment nodes, a filter, and zoom, pan and drag
- Detection of edits made outside Folio. If a note changed on disk while you also had unsaved edits, Folio asks which version to keep.
- **Drawings**, an Excalidraw-style whiteboard with a hand-drawn look. It has rectangles, diamonds, ellipses, arrows, lines, freehand pen, text, images and an eraser. Features:
  - Arrows attach to shapes and follow them when they move. Shapes and arrows can have labels (double-click or **Enter**).
  - Stroke and fill colours, hachure, cross-hatch and solid fills, stroke width and style, sloppiness, sharp or round edges, arrowheads, fonts, opacity and layer order.
  - Grouping, aligning, locking, element links (`[[Note]]` or a web address), a snap grid, zoom and pan, undo and redo, copy and paste, and a shortcut sheet (**?**).
  - Drawings are saved as `.excalidraw` files, the same format excalidraw.com uses, so you can open them there too. In **Settings**, you can switch to `.excalidraw.md`, the format of Obsidian's Excalidraw plugin. Folio reads and writes that format, including compressed drawings, and keeps its text and images in step with the plugin.
  - Embed a drawing in a note with `![[Drawing.excalidraw]]` or `![[Drawing.excalidraw|400]]`. It renders in live preview and reading view, and clicking it opens the drawing. Renaming a drawing updates those embeds.
  - Export to SVG or PNG next to the drawing, or copy the drawing to the clipboard.
  - Create drawings from the ribbon, the file tree's context menu or the command palette. *Create new drawing and embed it in the current note* does both in one step.
- **Canvas**, an infinite board of cards joined by arrows, saved as `.canvas` files in the open JSON Canvas format that Obsidian Canvas uses. The same file opens in both.
  - Cards can be Markdown text (with clickable links and checkboxes), notes from the vault (optionally one `#section`), images, drawings, web links or labelled groups. Cards come in six preset colours or any hex colour.
  - Connect cards by dragging a side dot onto another card, or drop the connection on empty space to create a new connected card there. Arrows can have labels, colours and arrowheads at either end.
  - Beyond Obsidian:
    - **Tab** adds a connected child card, mind-map style, and **Alt+arrows** jump between cards.
    - Alignment guides snap cards into line while you drag.
    - Text cards grow to fit what you type.
    - A floating toolbar acts on the selection, and there's a minimap.
    - Notes placed on a canvas show it as a backlink and appear connected to it in the graph. Renaming or moving a note updates every canvas that uses it.
  - Add notes and images by dragging them from the file tree, pasting, or using the toolbar. *Convert to note* turns a text card into a real note.
  - `![[Board.canvas]]` embeds a preview of the canvas in a note. Clicking the preview opens the canvas.
- **Bases**: database views of your notes and their frontmatter properties, in the format of Obsidian Bases (`.base` files, or `` ```base `` blocks inside a note).
  - Views: **table**, **cards** (with a cover image property), **list** and **board**. The board is a kanban view: dragging a card to another column changes that note's property, and columns stay put even when they empty.
  - Filters and formulas use Bases' expression syntax, for example `file.hasTag("book")`, `status != "done"`, `file.mtime > now() - "7d"` or `price / pages`. Filters can apply to the whole base or to one view. Views also sort, group and limit.
  - Most changes happen without writing YAML:
    - Click a column header to sort; right-click it to group, rename, move or hide the column.
    - The filter builder, the property picker and formulas are all in the toolbar.
    - Double-click a cell to edit a note's property, and click a checkbox to toggle a true/false property. Edits go into the note's frontmatter and leave the rest of the note untouched.
  - A quick search box, a summary row (counts, and sums and averages for numbers), relative dates on hover and sensible default columns.
  - **New note** from a view fills in the view's simple filters (tag, folder, `status == "todo"`), and on a board, the column you clicked it in.
  - Embed a base in a note with `![[Books.base]]` or `![[Books.base#Board]]`. `` ```base `` blocks render live in both live preview and reading view, and view changes you make there are written back into the block.
  - Expressions run in a small built-in interpreter, never as JavaScript.
- Colour themes, each with a light and a dark variant: Catppuccin (Mocha, Macchiato or Frappé, with Latte for light), Everforest, Gruvbox, Nord, Rosé Pine, Tokyo Night, Dracula and Solarized. Choose one in **Settings** or with *Change colour theme…* in the command palette, which previews each theme as you move through the list.
- Autosave, back and forward history (**Alt+←/→**), light and dark modes, readable line length, and resizable sidebars
- Editor shortcuts: **Ctrl+B** bold, **Ctrl+I** italic, **Ctrl+Shift+H** highlight, **Ctrl+K** wrap in `[[ ]]`, **Ctrl+Enter** toggle checkbox, and **Tab**/**Shift+Tab** to indent list items

UI preferences (theme, panel sizes and so on) are stored in the webview's local storage for each vault. Nothing is written into the vault except your notes and attachments.

## Layout

```
src/main.rs        startup, arguments, mode selection
src/api.rs         file API, path safety, embedded UI (shared by both modes)
src/native.rs      the desktop window (wry/tao), folio:// protocol, close-to-save
src/server.rs      --browser mode: the 127.0.0.1 server
src/config.rs      %LOCALAPPDATA%\Folio\config.json
ui/index.html      shell
ui/app.js          index, preview, panels, search, commands
ui/editor/         editor.js (CodeMirror setup + live preview) and its build config
ui/graph.js        graph view (canvas + force layout)
ui/themes.js       colour themes (Catppuccin, Everforest, …)
ui/templater.js    Templater-syntax template interpreter (tp.date, tp.file, tp.system, …)
ui/draw.js         drawing editor (tools, selection, text, undo, clipboard, panels)
ui/canvas.js       canvas editor and JSON Canvas files
ui/bases.js        bases: YAML, expressions, queries, table/cards/list/board views
ui/draw-render.js  drawing scene model, hand-drawn renderer, SVG export, .excalidraw/.excalidraw.md files
ui/test/           Node tests for the drawing, template, canvas and bases modules (no packages needed)
ui/style.css       themes and layout
ui/vendor/         editor.bundle.js (built from ui/editor), marked, DOMPurify, Virgil font
vendor-crates/     vendored Rust dependencies (Windows + Linux x64) for offline builds
```

The UI files are embedded with `include_str!`, so the binary is self-contained. After changing anything in `ui/`, run `cargo build` again.

The editor bundle is already built and checked in, so building Folio doesn't need Node. If you change `ui/editor/editor.js`, rebuild the bundle with Node 18 or newer (this step needs npm access), then run `cargo build`:

```sh
cd ui/editor && npm install && npm run build
```

`cargo test` runs the Rust tests. The front-end tests run under plain Node: `node ui/test/draw-render.test.js`, `node ui/test/templater.test.js`, `node ui/test/canvas.test.js` and `node ui/test/bases.test.js`.

## Ideas for round two

- Tabs and split panes
- Hover previews of links
- Using the `notify` crate to push file changes to the UI instead of polling every 2s
- An embedded `.exe` icon so Explorer shows it too. It needs the Windows SDK's `rc.exe` at build time. Right now the icon appears on the window and taskbar only.
