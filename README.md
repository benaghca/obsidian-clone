<img src="ui/logo.svg" alt="" width="96" height="96">

# Cinder

A local, plugin-free notes app that works like Obsidian and uses the same vault format.

Your notes are plain `.md` files in one folder. Cinder is a single `.exe` that opens its own desktop window and reads and writes that one folder. You can open the same vault in Obsidian at home and nothing needs converting.

## Build and run (Windows)

You need:
- **Rust** (stable, 1.85 or newer) with the default `x86_64-pc-windows-msvc` toolchain from rustup.
- **The MSVC linker**: Visual Studio Build Tools with the "Desktop development with C++" workload. Rust on Windows already needs this, so if you've built Rust programs on this PC before, you have it.
- **The Microsoft Edge WebView2 Runtime.** It ships with Windows 11 and current Windows 10, so it's almost certainly already there.

```bat
cargo build --release
target\release\cinder.exe
```

The first build takes a couple of minutes. After that, copy `cinder.exe` wherever you like and pin it to the taskbar. It's the only file you need.

- **Where your notes go:** the first launch uses `Documents\Cinder` (created if missing). To use a different folder, pass it once, as in `cinder.exe "C:\Users\you\Documents\Notes"`, or pick it in the app with **Settings → Vault → Change…**. Cinder remembers the last vault and your window size.
- **Offline build:** the build needs no network. The source of every Rust dependency needed for 64-bit Windows and Linux is in `vendor-crates/`, and `.cargo/config.toml` points cargo at it. To build from crates.io instead, delete `.cargo/config.toml`.

```
cinder [VAULT_DIR] [--browser [--port N] [--no-open] [--app]]

VAULT_DIR   folder of .md notes (default: last vault, else Documents\Cinder)
--browser   serve the UI to a browser tab on 127.0.0.1 instead of Cinder's own window
  --port N    port for --browser (default 43117)
  --no-open   don't open a browser automatically
  --app       open a chromeless Edge/Chrome window
```

**The native window** (the default) passes every shortcut to Cinder, including Ctrl+N, Ctrl+W, Ctrl+P and F5, because the webview's own browser shortcuts are switched off. External links open in your normal browser. Closing the window saves any unsaved edits first. Release builds show no console window.

**Vaults**: click the vault's name above the file tree, or run *Switch vault…*, to open the vault switcher.
- **Recent vaults** are listed with their locations. Click one (or use ↑↓ and Enter) to switch, and × drops it from the list without touching the folder.
- **Open folder…** uses the system's folder picker: the folder dialog on Windows, the folder chooser on macOS, zenity or kdialog on Linux. Where there's no picker, it uses a built-in folder browser that notices folders that already hold notes.
- **Create new vault…** asks for a name and a location.
- Typing a path still works, and it no longer creates a folder by mistake when the path is mistyped.

**Window frame**: by default the desktop app draws its own title bar in the app's theme (except on macOS). Drag the tab bar or a sidebar's top row to move the window, and double-click it to maximize. Minimize, maximize and close sit at the top right, and the edges resize. **Settings → Window frame** switches to the system's title bar, which then follows Cinder's light or dark theme too.

**Browser mode** (`--browser`) is a fallback if the window won't start, for example because WebView2 is blocked. In a browser tab, the browser keeps some shortcuts for itself, such as Ctrl+N and Ctrl+W.

On Linux, the native window uses WebKitGTK (`libwebkit2gtk-4.1`).

## For IT: what this program does and doesn't do

- **Network:** in its default mode, Cinder doesn't open any network port. The UI talks to the program through a private protocol that is handled inside the process. It makes no outbound connections of its own: no telemetry, no update checks, no CDN assets. The only web traffic is a page you embed yourself with `![](https://…)` or a canvas link card, and you can set that to load on click, or not at all, in Settings. The page has a Content-Security-Policy of `default-src 'self'`. Embedded pages load in sandboxed frames of their own origin. A navigation guard sends every other external link to the system browser instead of loading it inside Cinder.
- **Browser mode (optional):** only when started with `--browser`, it listens on `127.0.0.1`. Each launch creates a random 256-bit token that the page must present with every call. Requests whose `Host` header isn't `127.0.0.1` or `localhost` are rejected, which blocks DNS rebinding. Together these stop other websites in the same browser from reading or writing notes.
- **No plugin system:** there's no way to load third-party code. Everything the app runs is compiled into the binary, and Cinder's own UI is about 11,300 lines of readable JS, HTML and CSS in `ui/`. The third-party front-end code is vendored, with pinned versions:
  - `CodeMirror` 6 (the editor, MIT license), bundled with Cinder's editor module into `ui/vendor/editor.bundle.js`. The source is `ui/editor/editor.js`, and `ui/editor/package.json` pins every package version.
  - `marked` 12.0.2 (a Markdown parser for reading view, MIT license)
  - `DOMPurify` 3.4.16 (an HTML sanitizer, Apache-2.0/MPL-2.0)
  - `KaTeX` 0.18.9 with its mhchem extension and fonts (math rendering, MIT, `ui/vendor/katex/`). It doesn't use `eval`, and "trusted" commands such as `\href` are off.
  - `MathJax` 3.2.2 (`tex-svg-full.js`, Apache-2.0, `ui/vendor/mathjax/`), which turns LaTeX into SVG for equations in drawings. It loads the first time a drawing needs it.
  - `@replit/codemirror-vim` 6.4.0 (Vim mode, MIT), bundled into `editor.bundle.js` and pinned in `ui/editor/package.json`.
  - The `Virgil` hand-drawn font from Excalidraw (`ui/vendor/Virgil.woff2`, SIL Open Font License 1.1, see `ui/vendor/virgil.LICENSE.md`). It's a font file, not code.
  - `JetBrains Mono` 2.304, the default code font, in regular, bold, italic and bold italic (`ui/vendor/JetBrainsMono-*.woff2`, SIL Open Font License 1.1, see `ui/vendor/jetbrains-mono.LICENSE`).
  - `Symbols Nerd Font Mono` from Nerd Fonts 3.5.1 (`ui/vendor/SymbolsNerdFontMono.woff2`) and its list of icon names (`ui/vendor/nerd-icons.txt`). Its icons come from Font Awesome and Codicons (CC BY 4.0), Material Design Icons (Apache 2.0), and Octicons, Devicons and others (MIT and SIL OFL). See `ui/vendor/nerd-fonts.LICENSE` for the full list and attributions.
  - The drawing editor is Cinder's own code (`ui/draw.js`, `ui/draw-render.js`). It reads and writes Excalidraw's file format, but none of Excalidraw's code is included. Its sketchy-line maths is adapted from rough.js and its decompression from lz-string, both MIT-licensed (see `ui/vendor/draw-ports.LICENSE`).
- **Filesystem scope:** it reads and writes only inside the vault folder. Paths containing `..`, absolute paths, hidden files and symlinks that leave the vault are all rejected (see `resolve()` in `src/api.rs`). Deleted notes are moved to `<vault>\.trash`, never hard-deleted. The only other thing it writes is `%LOCALAPPDATA%\Cinder`, which holds `config.json` (last vault and window size) and the WebView2 profile.
- **Rust dependencies:** `wry` and `tao` from the Tauri project (the webview window), `serde_json`, `tiny_http` (browser mode only) and `windows-sys`, plus their transitive dependencies. Their source is all in `vendor-crates/`. Dev tools are disabled in release builds.

## Features

- A file tree with folders, drag-and-drop moves, file import from the desktop, and rename, move and delete from the context menu
  - Opening a file reveals it in the tree: its folders open and the tree scrolls to it. The target button in the tree's header (or *Settings*) turns this off. The button next to it expands or collapses every folder.
- **Bookmarks** (the bookmark button in the ribbon), shared with Obsidian: they live in `.obsidian/bookmarks.json`, so the same list shows in both apps. Bookmark files, folders, headings (right-click in the Outline), searches (the button in the Search panel) and web links, and sort them into groups.
  - Bookmark the open file with the button at the top of the panel, *Bookmark* in the note's ⋯ menu or the file tree's right-click menu (several selected files at once too), the command palette, or by dragging files from the tree into the panel.
  - Click to open (Ctrl-click for a new tab). Drag to reorder: drop on the top or bottom half of a bookmark to put it before or after, or on a group to put it inside. Right-click to rename, move to a group or remove.
  - Bookmarks follow files when they're renamed or moved, and go when the file is deleted. In a folder without an `.obsidian` folder, Cinder keeps the list itself.
- Sidebar toggles like Obsidian's: the top of the ribbon shows or hides the left sidebar (**Ctrl+\\**), and the right end of the tab bar does the same for the right sidebar (**Ctrl+Shift+\\**).
- **Live preview editing**, like Obsidian's: Markdown syntax is hidden and rendered as you write, and appears only on the line or element the cursor is in. That covers headings, bold, italic, highlights, links, tags, checkboxes you can click, bullets, callouts, quotes, code blocks, tables and embedded images and notes. Switch to plain source mode in Settings or from the command palette.
- Switch vaults from **Settings**, the command palette or by clicking the vault name above the file tree
- A reading view (**Ctrl+E**), plus an inline title you can edit to rename the note. **↑** on the first line jumps to the title.
- Proper undo and redo, multiple cursors, find and replace in the note (**Ctrl+F**), and syntax highlighting for code blocks (Python, JS/TS, JSON, Rust, SQL, shell, PowerShell)
- `[[wikilinks]]`, `[[Note|alias]]`, `[[Note#Heading]]` and relative `[md](links.md)`. Clicking a link to a missing note creates it.
- Autocomplete as you type `[[` (add `#` to pick a heading) or a `#tag`
- Clicking a rendered link follows it. **Ctrl+click** follows a link while its source is showing.
- Renaming or moving a note rewrites the links that point to it across the vault
- Embeds: `![[image.png|300]]`, `![[Other note]]` and `![[Other note#Section]]`
- **Embedded web pages**: `![](https://example.com)` on its own line shows the live page in a sandboxed frame, in live preview and reading view. Drag the page's bottom-right corner to resize it. That writes `![|600x400](…)` into the note, which you can also type, and double-clicking the corner goes back to the default size. YouTube and Vimeo links become their players. The bar above the page reloads it or opens it in your browser. Canvas link cards show the live page too (click a card to use its page). **Settings** can load pages on click instead, or show just the link.
- **Embed any link**: right-click a link in the editor and choose **Embed** to turn `[[Note]]`, `[text](url)` or a bare address into its embed, or **Show as a link** to turn it back. *Embed the link under the cursor* is a command too.
- **Hover previews**: hover a link in reading view to preview the note, or just the `#section` it points to. In the editor, hold **Ctrl/Cmd** while hovering. Ctrl/Cmd+hover a web link to see the live page. **Esc** closes the preview. It can be turned off in Settings.
- Pasting or dropping an image into a note saves it to `attachments/` and embeds it
- **Images and screenshots**:
  - **Ctrl+Shift+S** (*Insert screenshot*) lets you drag out an area of the screen and embeds it in the note, or adds it to the canvas, as `Screenshot <date> <time>.png`. It uses the system's own region picker: grim + slurp on Wayland, then gnome-screenshot, spectacle, xfce4-screenshooter, maim, scrot, ImageMagick or flameshot; `screencapture` on macOS. Without one of those (and on Windows), it falls back to the browser's screen capture followed by a crop step. To use a different tool, set `CINDER_SCREENSHOT_CMD` to a command that prints a PNG to stdout (it gets `CINDER_SCREENSHOT_MODE=region` or `screen`).
    - **Ctrl+Alt+S** takes a screenshot and opens it straight in a drawing to mark up. The note (or canvas) gets the drawing. **Settings → After a screenshot** can make that the default for Ctrl+Shift+S.
    - *Insert screenshot of the whole screen* skips the region picker.
    - The desktop app hides its window while you capture, so you can grab what's behind it (**Settings** can turn that off). **Settings → Screenshot delay** waits 3, 5 or 10 seconds first, with a countdown, for catching menus and hover states.
  - Click an image, in live preview, reading view or a canvas, to open it in a viewer. The viewer zooms with the wheel, **+**/**-**/**0**/**1** or a double-click, pans by dragging, and moves through the note's other images with **←**/**→**. Image files open in the same viewer, and the arrows go through the folder.
  - Drag an image's corner in live preview to resize it. That writes `![[img.png|420]]`, or `![alt|420](img.png)` for Markdown images, which reading view also honours.
  - Right-click an image to open, copy, resize, crop, annotate, rename, reveal, remove or delete it. **Crop** saves a cropped copy next to the original and points the embed at it. **Annotate** turns the image into a drawing with the image locked underneath, embeds the drawing in its place and opens it, so you can mark up a screenshot with arrows and text.
- Tags, both `#inline` and nested (`#area/sub`), and frontmatter `tags:` and `aliases:`
- **Properties**, like Obsidian's: the frontmatter at the top of a note shows as a table you can edit, in live preview and reading view.
  - Each property has a type: text, list, number, checkbox, date, date & time, tags or aliases. Each type gets a matching editor: tag and list chips, a date picker, a checkbox. Links in values stay clickable.
  - Click a property's icon to change its type (the value converts) or remove it. Edit the name to rename it; it keeps its place and its value exactly as written.
  - *Add property* (or **Ctrl+;**, which also starts the frontmatter in a note without any) suggests names used in other notes and keeps their types. Values suggest what other notes use.
  - Types are shared across the vault and saved to `.obsidian/types.json` when the vault has an `.obsidian` folder, so Obsidian sees the same types. Otherwise they're saved in Cinder's settings.
  - Keyboard: **↑** from the first line goes into the properties. **↑/↓** move between rows, **Enter** saves and moves on, and **Esc** goes back to the text. Every edit is a normal change, so **Ctrl+Z** undoes it.
  - **All properties** (a sidebar panel) lists every property in the vault with its type and how many notes use it. Open one to see its values, and click a name or value to find the notes. Right-click to **rename it in every note**, change its type or remove it everywhere.
  - Search understands Obsidian's property syntax: `[status]`, `[status:done]`, `[status:"in progress"]` and `-[status]`.
  - `cssclasses` works as in Obsidian: the note's classes go on its view. Built in: `wide`, `narrow`, `small`, `large`, `serif`, `no-title` and `center-images`. **Settings → CSS snippets folder** applies every `.css` file in a vault folder of your choice, reloading as you edit them, so your own classes can do anything.
  - Frontmatter that isn't valid YAML stays as text. **Settings → Properties** can show the YAML instead.
- Callouts (`> [!warning] Title`), `==highlights==`, GFM tables, and task lists you can tick in reading view (**Ctrl+Enter** toggles one while editing)
- A backlinks panel with context, including unlinked mentions and a one-click **Link** button, plus outgoing links and an outline
- A quick switcher (**Ctrl+O**; **Shift+Enter** creates a note) and a command palette (**Ctrl+P**)
- Vault search (**Ctrl+Shift+F**) with `tag:`, `path:`, `file:`, `"exact phrase"` and `-exclude`
- Daily notes with an optional template, and an *Insert template* command. Templates support `{{date}}`, `{{time}}`, `{{title}}` and `{{date:dddd, MMMM DD}}`.
- **Templater-style templates**, the syntax of Obsidian's Templater plugin: `<% tp.date.now("dddd, MMMM Do") %>`, `<% tp.file.title %>`, `<% tp.frontmatter.status %>`, `<%* let who = await tp.system.prompt("Who?") %>`, `if`/`else`, `for…of`, `tR +=`, `tp.file.cursor()`, `tp.file.rename()` / `move()` / `include()` / `create_new()`, `tp.system.suggester()` and whitespace control (`<%-` `-%>` `<%_` `_%>`). Dates use moment.js formats and ISO durations (`"P1W"`).
  - *Create new note from template* and *Replace template commands in current note* commands.
  - **You don't need to remember the syntax.** Type `<%` in a note to pick a command from a list in plain words, like *Today's date*, *Ask a question*, *Pick from a list* or *Put the cursor here*. Each one shows what it would give right now. **Tab** moves through the parts to fill in. Inside a tag, `tp.` and `tp.date.` list what comes next. *Insert template command…* in the command palette does the same.
  - A note in the templates folder shows a bar with **Insert command…**, **Preview** (the template filled in for an example note, asking its questions, with where the cursor lands and any renames or moves) and **Cheat sheet** (every command with today's result, plus the date formats). *Create new template* starts one with the usual commands.
  - **Folder templates** (Settings): new notes in a folder start from that folder's template.
  - Templates run in a small built-in interpreter, not as JavaScript, so a template can't reach anything outside the note and the vault. Arbitrary JavaScript, `tp.web` (network), `app` and user scripts aren't supported; using them gives a clear error.
- A graph view (**Ctrl+G**): global or local with a depth slider, optional tags, unresolved-link and attachment nodes, a filter, and zoom, pan and drag. **Click a node** to select it: its links light up and everything else dims, and a card lists what it links to and what links to it. Click an entry in the card to hop there. Click the node again, click empty space or press **Esc** to clear. **Double-click** (or **Enter**) opens a note, and **Ctrl+click** opens it in a new tab. *Click opens notes* in the graph controls brings back one-click opening. Tick **3D** for a 3D graph: drag to orbit, use the wheel to zoom, and right-drag or **Shift**+drag to pan. Nearer notes are larger and farther ones fade. **Rotate** turns it slowly, and selection works the same as in 2D.
- Detection of edits made outside Cinder. If a note changed on disk while you also had unsaved edits, Cinder asks which version to keep.
- **Drawings**, an Excalidraw-style whiteboard with a hand-drawn look. It has rectangles, diamonds, ellipses, arrows, lines, freehand pen, text, images, an eraser and a **laser pointer** (**K**). The laser draws a smooth glowing trail that stays short and fades after a second. It never changes the drawing, which makes it handy for pointing things out while presenting. You can pick its colour (red, the theme accent, green or blue) while the laser is selected. Features:
  - Arrows attach to shapes and follow them when they move. Shapes and arrows can have labels (double-click or **Enter**).
  - Stroke and fill colours, hachure, cross-hatch and solid fills, stroke width and style, sloppiness, sharp or round edges, arrowheads, fonts, opacity and layer order.
  - **LaTeX equations**: press **M** (or use the Σ button, or right-click › *Insert equation…*), type LaTeX and watch it render live, then press **Enter**. The equation box works like math in a note: type `\` and a letter for a list of commands with a preview of each, **Tab** through the fields of `\frac`, `\sum` and friends, and use the math shortcuts (`//` for a fraction, `@a` for α and so on). Double-click or **Enter** edits an equation. Equations take the stroke colour, follow the light and dark themes, stay sharp at any zoom and export to SVG and PNG. In `.excalidraw.md` drawings they're saved as `id: $$…$$` under *Embedded Files*, the same way Obsidian's Excalidraw plugin saves them, so equations made in either app open in the other.
  - Grouping, aligning, locking, element links (`[[Note]]` or a web address), a snap grid, zoom and pan, undo and redo, copy and paste, and a shortcut sheet (**?**).
  - Drawings are saved as `.excalidraw` files, the same format excalidraw.com uses, so you can open them there too. In **Settings**, you can switch to `.excalidraw.md`, the format of Obsidian's Excalidraw plugin. Cinder reads and writes that format, including compressed drawings, and keeps its text and images in step with the plugin.
  - Embed a drawing in a note with `![[Drawing.excalidraw]]` or `![[Drawing.excalidraw|400]]`. It renders in live preview and reading view, and clicking it opens the drawing. Renaming a drawing updates those embeds.
  - Export to SVG or PNG next to the drawing, or copy the drawing to the clipboard.
  - Create drawings from the ribbon, the file tree's context menu or the command palette. *Create new drawing and embed it in the current note* does both in one step.
- **Canvas**, an infinite board of cards joined by arrows, saved as `.canvas` files in the open JSON Canvas format that Obsidian Canvas uses. The same file opens in both.
  - Cards can be Markdown text (with clickable links and checkboxes), notes from the vault (optionally one `#section`), images, drawings, web links or labelled groups. Cards come in six preset colours or any hex colour.
  - **Edit in place**: press **Enter** or double-click a text card *or a note card* to edit it right on the canvas, using the same live-preview editor as notes (rendered math, links, autocomplete, checkboxes, pasted images). A note card edits the note itself and saves as you type. **Esc** finishes, and **Shift+Enter** opens the note in full.
  - Connect cards by dragging a side dot onto another card, or drop the connection on empty space to create a new connected card there. Arrows can have labels, colours and arrowheads at either end.
  - Beyond Obsidian:
    - **Tab** adds a connected child card, mind-map style, and **Alt+arrows** jump between cards.
    - Alignment guides snap cards into line while you drag.
    - Text cards grow to fit what you type.
    - A floating toolbar acts on the selection, and there's a minimap.
    - Notes placed on a canvas show it as a backlink and appear connected to it in the graph. Renaming or moving a note updates every canvas that uses it.
  - Add notes and images by dragging them from the file tree, pasting, or using the toolbar. *Convert to note* turns a text card into a real note.
  - `![[Board.canvas]]` embeds a preview of the canvas in a note. Clicking the preview opens the canvas.
  - **Presentation mode** (**F5**, the ▶ button, or *Present canvas*):
    - Each group is a slide, or each card if there are no groups. Arrows between groups set the order; otherwise it's reading order.
    - It goes full screen with everything else hidden and glides from slide to slide. Links and embedded pages still work.
    - **→**/**Space**/click moves forward, **←**/right-click moves back, **Home**/**End** jump to the first or last slide, and **Esc** ends it.
    - If a group is selected, the presentation starts there.
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
- **Inbox**: a triage desk for things you capture away from your desk. It shows what lands in the vault's `Inbox/` folder, whether from Obsidian on your phone, OneDrive's camera upload or scans, typing at the top, or dropping files. The folder can be changed in Settings.
  - Items are grouped by the day they were made (not the day they synced), newest first. Photos show as thumbnails and notes as their first lines. A dot marks what arrived since your last visit, and the ribbon button counts what's waiting.
  - **Make a note from this day** turns a day's items into one note, with photos embedded and notes as sections in the order they were made. It offers to move the photos to attachments and clear the scraps.
  - Or select items (click the corner, Ctrl/Shift-click, or **Space**) and **make a note**, **add them to an existing note**, **file them to a folder** or **delete** them. Keys: arrows, **Enter** opens, **C**/**A**/**M**/**Del**.
  - At the bottom, *Photos no note uses yet* lists images elsewhere in the vault that nothing links to.
- **Tasks** across the whole vault, in the format of Obsidian's Tasks plugin, so existing Tasks vaults work as they are. Tasks use `📅` due, `⏳` scheduled, `🛫` start and `✅` done dates, `🔺⏫🔼🔽⏬` priorities and `🔁` recurrence. Dataview-style `[due:: …]` fields are read too.
  - **The Tasks view** (**Ctrl+Shift+T**, or the checkbox icon, which shows how many tasks are due) has lists down the side, each with a count:
    - **Today** (overdue and today's tasks, with a ring showing how much of today is done, and *Move them all to today* for what's overdue), **Upcoming** (day by day, then later), **Anytime** (no date), **Everything** and the **Logbook** (done and cancelled in the last 30 days).
    - A list for each note and tag with open tasks. A note's list groups by heading and new tasks go into that note; a tag's list tags new tasks.
    - Group any list by date, note or priority, filter it, and show what's done.
  - **Working with a task**: tick the round checkbox (it stays ticked for a moment, and the message that follows has **Undo**). Click the text to edit it; its dates and flags stay put. The buttons on the right, or its chips, do *today*, *tomorrow*, *pick a date* and *details*. **Details** sets when (today, tomorrow, this weekend, next week, in a month, a date or none), priority and repeat (presets or typed, like `every mon, thu`), opens the note, cancels it or deletes it (with Undo). Drag a task onto a day, or onto *Today* or *Anytime* in the side bar, to reschedule it.
  - Keys in a list: arrows or **J**/**K** move, **Space**/**X** ticks, **T** today, **M** tomorrow, **D** date, **P** details, **E** edit, **Del** deletes, **Enter** opens the note.
  - **Natural-language quick add**, in the Tasks view or with *Add task…* from anywhere: `Pay rent tomorrow !high every month #home` becomes `- [ ] Pay rent #home ⏫ 🔁 every month 📅 2026-09-25`. A live preview shows how the text was understood. New tasks go to today's daily note or to a note you choose in Settings. **Adds to …** under the box picks another note for this session. In *Today*, a task without a date is for today.
  - Ticking a task, whether in the editor, reading view, the Tasks view or a query, adds `✅ <date>`. Ticking a recurring task (`every week`, `every weekday`, `every mon, thu`, `every month on the 15th`, `… when done`) adds its next occurrence above it.
  - `` ```tasks `` query blocks use the Tasks plugin's query language (`not done`, `due before tomorrow`, `tag includes #work`, `path includes Projects`, `priority is above none`, `sort by due`, `group by heading`, `limit 10`, …) and render live lists you can tick.
- **Math** with KaTeX: `$E=mc^2$` inline and `$$ … $$` blocks, in the editor, reading view, canvas cards, tasks and embeds, including chemistry with `\ce{2H2 + O2 -> 2H2O}` (mhchem). In live preview, a formula renders until you click into it; while you edit it, a rendered preview sits beside the source. Typing `\` inside math suggests LaTeX commands with a preview of each. Structures like `\frac`, `\sum`, matrices, `cases` and `aligned` insert as snippets, and **Tab** moves between their fields. **Ctrl+M** wraps the selection in `$…$`, and **Ctrl+Shift+M** makes a math block. `$5 and $10` stays plain text.
  - **Math shortcuts**, in the style of the LaTeX Suite plugin (a setting, on by default):
    - `mk`+**Tab** starts inline math and `dm`+**Tab** a math block.
    - Inside math, `//` makes a fraction (**Tab** moves between its parts, then out of the braces and the closing `$`). `sq` makes a square root.
    - `x1` → `x_1`, `sr`/`cb` → squared and cubed, `td` → a superscript, `__` → a subscript.
    - `@a @b @g…` → Greek letters (`@G` for capitals), and `sum`, `prod`, `lim`, `dint`, `par`.
    - Also `<=`, `>=`, `!=`, `->`, `=>`, `~~`, `xx`, `**`, `inn`, `RR`, `NN`, `ZZ`, `hat`, `bar`, `vec`, `bf`, `cal`, `lr(`, `pmat` and `case`.
    - Commands you type out yourself, such as `\sqrt`, are left alone.
- **Vim key bindings** in the editor, available as a setting.
- **Fonts and Nerd Font icons**: JetBrains Mono comes with Cinder and is the default code font. **Settings** can set the text and code fonts to any font installed on the computer, with a live preview. All of Nerd Fonts' roughly 11,000 icons (Font Awesome, Material Design, Codicons, Devicons, Octicons and more) work in every font Cinder uses, including notes, code, canvases and drawings. The icon font only loads on pages that contain an icon. *Insert icon (Nerd Fonts)…* searches the icons by name. Icons are private-use Unicode characters, so a note that uses them needs a Nerd Font wherever else you open it.
- Colour themes, each with a light and a dark variant. **Volcanic** is the default: obsidian and basalt darks with a lava-orange accent, and warm ash in light mode. The others are Violet (Cinder's original purple), Catppuccin (Mocha, Macchiato or Frappé, with Latte for light), Everforest, Gruvbox, Nord, Rosé Pine, Tokyo Night, Dracula and Solarized. Choose one in **Settings** or with *Change colour theme…* in the command palette, which previews each theme as you move through the list.
- Autosave, back and forward history (**Alt+←/→**), light and dark modes, readable line length, and resizable sidebars
- Editor shortcuts: **Ctrl+B** bold, **Ctrl+I** italic, **Ctrl+Shift+H** highlight, **Ctrl+K** wrap in `[[ ]]`, **Ctrl+Enter** toggle checkbox, **Ctrl+1**…**6** headings (the same level again removes it), **Ctrl+Shift+8/7/9** bullet, numbered and task lists, **Ctrl+M** / **Ctrl+Shift+M** math, and **Tab**/**Shift+Tab** to indent list items
- **Tabs**:
  - Clicking a file opens it in the current tab. Middle-click, **Ctrl+Enter** in the quick switcher or file tree, or *Open in new tab* opens it in a new one, and middle-clicking a link does too.
  - **Ctrl+T** new tab, **Ctrl+W** close, **Ctrl+PageUp/PageDown** previous and next, **Alt+1…8** a tab and **Alt+9** the last one. *Reopen closed tab* is in the command palette.
  - Each tab keeps its own back and forward history, and a note keeps its cursor and undo history while its tab is open.
  - Drag tabs to reorder them. Right-click for close others, close to the right, duplicate and reveal.
  - Tabs come back when you reopen Cinder, and they follow renames and moves.
  - In a browser tab the browser keeps Ctrl+T and Ctrl+W for itself, so rebind them in Hotkeys.
- **Select several files in the tree** with **Ctrl/Cmd-click**, **Shift-click** or **Shift+↑/↓**, then drag them onto a folder or right-click to *Move N items to…*, group them into a *New folder with N items…*, open them in tabs or delete them. Links are updated for every move.
- **Settings** (**Ctrl+,**) is a window with a page for each area (General, Editor, Appearance, Files & links, Daily notes, Templates, Tasks, Inbox, Images & screenshots, Drawings, Hotkeys) and a search box that finds any setting on any page. Changes apply as you make them, with no Save button. A changed setting shows ↺ to put the default back. Colour themes are picked from swatches.
- **Keyboard first**:
  - **Ctrl+/** shows every shortcut.
  - **Settings → Hotkeys** rebinds any command, including the formatting commands above. Click a shortcut, press the new keys, and clashes are flagged. The command palette lists your recent commands first and shows each command's current keys.
  - **Ctrl+Shift+E** moves to the file tree:
    - arrows move and expand or collapse folders, and typing a name jumps to it
    - **Enter** opens the file in the editor, and **Space** opens it while staying in the tree
    - **F2** renames, **Del** deletes and **Ctrl+N** makes a note in that folder
    - **Esc** goes back to the page
  - Search results, tags and task lists work the same way with arrows, **Enter** and **Esc**. In task lists, **Space**/**X** ticks a task, **T** makes it due today and **M** makes it due tomorrow.
  - **Ctrl+Shift+B** and **Ctrl+Shift+O** jump into Backlinks and Outline:
    - arrows move, and **←/→** switch between Backlinks, Outgoing and Outline
    - **Enter** opens the item or goes to the heading
    - **Space** previews a heading without leaving the pane
    - **L** turns an unlinked mention into a link
  - **Ctrl+Tab** switches between recent files, like an editor's tab switcher: hold Ctrl, tap Tab (Shift+Tab goes back), and let go to open. A quick Ctrl+Tab flips back to the previous file. The quick switcher also lists recent files first. (In browser mode the browser keeps Ctrl+Tab, so rebind it in Hotkeys.)
  - **Ctrl+\** and **Ctrl+Shift+\** hide and show the sidebars.
  - Dialogs return focus to where you were.

UI preferences (theme, panel sizes and so on) are stored in the webview's local storage for each vault. Nothing is written into the vault except your notes and attachments.

## Layout

```
src/main.rs        startup, arguments, mode selection
src/api.rs         file API, path safety, embedded UI (shared by both modes)
src/native.rs      the desktop window (wry/tao), cinder:// protocol, close-to-save
src/server.rs      --browser mode: the 127.0.0.1 server
src/config.rs      %LOCALAPPDATA%\Cinder\config.json
src/screenshot.rs  Insert screenshot: runs the platform region-capture tool
ui/index.html      shell
ui/app/*.js        the app itself, one file per concern (core, vault index, navigation, tabs,
                   file tree, markdown, properties, commands, panels, graph, boot…); src/api.rs
                   joins them in order into /app.js, so they share one scope with no build step
ui/editor/         editor.js (CodeMirror setup + live preview) and its build config
ui/graph.js        graph view (canvas + force layout)
ui/themes.js       colour themes (Catppuccin, Everforest, …)
ui/templater.js    Templater-syntax template interpreter (tp.date, tp.file, tp.system, …)
ui/draw.js         drawing editor (tools, selection, text, undo, clipboard, panels)
ui/canvas.js       canvas editor and JSON Canvas files
ui/bases.js        bases: YAML, expressions, queries, table/cards/list/board views
ui/tasks.js        tasks: Tasks-plugin format, recurrence, quick add, Tasks view, queries
ui/images.js       image viewer / lightbox, crop tool, browser screen capture
ui/properties.js   the Properties table (frontmatter at the top of notes)
ui/draw-render.js  drawing scene model, hand-drawn renderer, SVG export, .excalidraw/.excalidraw.md files
ui/test/           Node tests for the drawing, template, canvas, bases, tasks and properties modules (no packages needed)
ui/style.css       themes and layout
ui/vendor/         editor.bundle.js (built from ui/editor), marked, DOMPurify, KaTeX, MathJax, fonts (Virgil, JetBrains Mono, Nerd Fonts symbols)
vendor-crates/     vendored Rust dependencies (Windows + Linux x64) for offline builds
```

The UI files are embedded with `include_str!`, so the binary is self-contained. After changing anything in `ui/`, run `cargo build` again.

The editor bundle is already built and checked in, so building Cinder doesn't need Node. If you change `ui/editor/editor.js`, rebuild the bundle with Node 18 or newer (this step needs npm access), then run `cargo build`:

```sh
cd ui/editor && npm install && npm run build
```

`cargo test` runs the Rust tests. The front-end tests run under plain Node: `node ui/test/draw-render.test.js`, `node ui/test/templater.test.js`, `node ui/test/canvas.test.js`, `node ui/test/bases.test.js`, `node ui/test/tasks.test.js` and `node ui/test/properties.test.js`.

## Ideas for round two

- Tabs and split panes
- Hover previews of links
- Using the `notify` crate to push file changes to the UI instead of polling every 2s
- An embedded `.exe` icon so Explorer shows it too. It needs the Windows SDK's `rc.exe` at build time. Right now the icon appears on the window and taskbar only.
