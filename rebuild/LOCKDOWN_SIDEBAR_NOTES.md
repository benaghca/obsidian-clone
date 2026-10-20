# Round 3: offline lockdown, right sidebar, feel fixes

Everything in `LOCKDOWN_SIDEBAR_TASK.md` is done, except the items listed under "Skipped, not applicable, caveats" at the end. `npm run build`, `npm test` (31 tests), `npm run audit:offline` and `cargo build` / `cargo test` (18 tests) all pass. Typing and note switching are as fast as before, with the right sidebar open or closed (numbers below).

Commits on `rebuild/r3-claude`, oldest first:

| Commit | What |
|---|---|
| `3406c7d` | Lockdown: strict CSP, own-origin IPC, system opener for external links, offline audit |
| `17be11e` | Feel: keep a line typed under a checked task out of its strikethrough |
| `ee005b5` | Feel: quick switcher offers "create" only when nothing matches well |
| `18a686b` | Feel: tabs share the bar like Obsidian's and visibly grow and shrink |
| `ffddaa0` | Right sidebar with Backlinks and Outline; crisper, stable side docks |
| `4a2466e` | Lockdown: create the main window after the app state is managed |

## A. Offline lockdown

### Content-Security-Policy

The policy is in `src-tauri/tauri.conf.json` (`app.security.csp`). Release builds use:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: asset: http://asset.localhost; font-src 'self' data:;
connect-src ipc: http://ipc.localhost; media-src 'self' blob: asset: http://asset.localhost;
object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none';
child-src 'none'; worker-src 'none'; manifest-src 'none'
```

- Every source is the app itself or a Tauri protocol served in-process. `asset:` / `http://asset.localhost` are listed for future local vault images. The asset protocol is not enabled, so they load nothing today.
- `'unsafe-inline'` applies to styles only. It is needed: CodeMirror injects its base theme as a `<style>` element (checked in Chromium: one `<style>`, no adopted stylesheets). Tauri would add a style nonce, which disables `'unsafe-inline'`, only if `index.html` contained an inline `<style>`. The audit fails if one is added.
- `devCsp` is the same policy except `connect-src 'self' ipc: http://ipc.localhost ws://localhost:1420`. That covers Vite's hot-reload socket, in dev builds only.
- On desktop, `tauri dev` loads the Vite server directly, so Tauri never applies `devCsp` itself. `vite.config.ts` therefore reads both policies from `tauri.conf.json` and sends them as a header from the dev server (`devCsp`) and from `vite preview` (`csp`). The browser build, the dev build and the release build all run under the policy, from one source of truth.

Checked in headless Chromium against `vite preview` (production bundle and production CSP) and against the dev server. Both recorded zero `securitypolicyviolation` events and zero requests to anything but the local server, including after clicking links and opening the right sidebar. Hot reload still connects in dev.

### IPC capabilities (`src-tauri/capabilities/default.json`)

- The `remote.urls` block that granted `http://localhost:1420` / `http://127.0.0.1:1420` vault access in every build is gone. It was never needed: Tauri treats `devUrl` as a local origin in dev builds (`Webview::is_local_url` → `get_app_url`, under `cfg(dev)`), and in release builds only `tauri://localhost` is local. The capability now covers the main window on the app's own origin only.
- Permissions: the ten vault commands (`allow-open-vault` … `allow-link-index`), `core:default`, `core:event:default`, the four frameless-window permissions, and:

```json
{ "identifier": "opener:allow-open-url",
  "allow": [{ "url": "http://*" }, { "url": "https://*" }, { "url": "mailto:*" }] }
```

  `opener:default` is not used. That would also allow `tel:`, `reveal_item_in_dir` and the other opener permission sets. Scope entries leave `app` at its default, so the front end cannot pick which program opens a URL (`with` must be empty). `open_path` and `reveal_item_in_dir` are not permitted.
- `build.rs` registers the app commands in the app manifest, so each one needs an explicit permission. I corrected the comment there, which claimed this was needed because the dev server is a remote origin.

### Navigation guard and new windows (`src-tauri/src/lockdown.rs`)

The main window is now marked `"create": false` in the config and built in Rust from that same config entry, at the end of `setup`. This adds two guards the config cannot express:

- **`on_navigation`** allows only the app's origin: `tauri://localhost`, `http(s)://tauri.localhost` (Windows), `about:blank`, and in dev builds (`tauri::is_dev()`) the exact `devUrl` origin. Anything else is blocked and logged. That covers a dropped URL, a stray `<a href>` and script setting `location`. `is_app_url` has unit tests, including look-alikes such as `tauri.localhost.example.com`, `127.0.0.1:1420` in dev, and `file:` / `mailto:`.
- **`on_new_window`** denies every request (`window.open`, `target=_blank`).

### External links

- `window.open` is gone. Editor links call `host.openUrl` → `api.openExternal(url)` (`src/api.ts`), which accepts only `http(s)://host…` and `mailto:` (`src/links.ts`, tested). In Tauri it calls `openUrl` from `@tauri-apps/plugin-opener`, which hands the URL to the system's default handler. In the browser mock it logs `[mock] would open externally: …`.
- They open only on an explicit click. A rendered link follows on a plain click, and raw link text on Ctrl/Cmd+click (Obsidian's behaviour). The handler now claims the link on `mousedown` but follows it only on the `click` that completes on the same link, and only if `event.isTrusted`. A drag-selection that starts on a link, or a scripted click, opens nothing. Before, links followed on `mousedown`.
- Nothing fetches, previews or loads a link. There is no link-preview code.

### Remote images and embeds

`![alt](https://…)` is never fetched. When the selection is outside it, Live Preview replaces it with a small image-icon link chip showing the alt text (tooltip: "Remote image, not loaded: <url>"). Clicking the chip opens the URL externally, like any link. Local images stay as text, as before (see skipped items). Raw HTML (`<img>`, `<iframe>`) was never rendered, and the CSP blocks remote images and frames anyway.

### Source maps and other bundle changes

- `build.sourcemap` is `mode !== "production"`. Release builds have no `.map` files and no `sourceMappingURL` comments. The dev server always serves maps, and `vite build --mode development` keeps them.
- `build.modulePreload.polyfill: false`. Vite's polyfill contained a `fetch()` call (same-origin, but the webview supports modulepreload natively and the bundle should contain no network calls).

### Offline audit: `npm run audit:offline`

`scripts/audit-offline.mjs` has no dependencies. `npm run audit:offline` builds and then runs it. It fails on any of the following:

1. **Network APIs and remote URLs** in `src/**` (tests excluded, since they never ship), `index.html`, `vite.config.ts`, `tauri.conf.json`, the capability files and every file in `dist/`. It matches URLs (`http`, `https`, `ws`, `wss`, `ftp`), `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `RTCPeerConnection`, `serviceWorker`, `importScripts(`, `window.open(`, remote `@import`, remote or protocol-relative `url()`, and `sourceMappingURL=`. Each exception is on a commented allowlist with the file it may appear in:
   - the SVG namespace `http://www.w3.org/2000/svg`;
   - `$schema` in `tauri.conf.json`;
   - `devUrl` `http://localhost:1420` and the dev-only `ws://localhost:1420`;
   - `http://asset.localhost` / `http://ipc.localhost`, Tauri's in-process protocols;
   - the opener scope patterns in the capability file;
   - the sample-note link text in the browser mock (`https://obsidian.md`, `https://example.com/…`);
   - one `https://` string in `@codemirror/lang-markdown`, which prefixes a pasted `www.` address when wrapping it in a link.
2. **`dist/`**: no `.map` files.
3. **`index.html`**: no inline `<script>` or `<style>`.
4. **CSP**: present, every source local, and `'unsafe-inline'` allowed only in `style-src`. It requires `default-src 'self'`, `script-src 'self'`, `connect-src ipc: http://ipc.localhost`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'` and `frame-src 'none'`. The same check runs on `devCsp`, plus the local Vite socket. `dangerousDisableAssetCspModification` must be unset, and no window may load a URL.
5. **Capabilities**: no `remote` block, and no `http:`, `updater:`, `shell:`, `websocket:`, `upload:`, `fs:` or `process:` permissions. Opener is allowed only as `opener:allow-open-url` with `http://*`, `https://*` and `mailto:*` scope entries and no `app`.
6. **Dependencies**: `package.json` and `Cargo.toml` direct dependencies must be on an explicit allowlist. Every `package-lock.json` package, and every crate `cargo tree` reports as compiled for this machine, is checked against a deny pattern: reqwest, hyper, ureq, curl, axios, node-fetch, undici, socket.io, tungstenite, websocket, updater, plugin-http, sentry, bugsnag, posthog, mixpanel, amplitude, segment, analytics, telemetry, datadog, newrelic, crash-report, opentelemetry. If cargo is missing, that one check is skipped with a warning.

I checked that it catches violations by adding `fetch("https://…")` plus `new WebSocket("wss://…")` to `main.ts`, a remote host to `connect-src`, a `remote` block and `opener:default`. Each was reported, with file:line and context.

### Dependencies

The only new dependency is `tauri-plugin-opener` 2.7.2 (crate) / `@tauri-apps/plugin-opener` ^2.7.2 (npm). The crate brings `open` (launches the system handler) and `zbus` (D-Bus, local IPC, used by its reveal-in-folder function). Nothing networked. `reqwest` and `hyper` already appear in `Cargo.lock` from before this round: they are Tauri's dev-server proxy for mobile targets. `cargo tree` for the Linux target shows they are not compiled into the desktop app. `soup3` (libsoup) is compiled in because WebKitGTK itself needs it; the CSP and the navigation guard keep the webview on the app's origin. There are no fonts or icon packs to bundle: the fonts are system fonts and the icons are inline Lucide SVG.

## B. Right sidebar

### Layout and controls

- A full-height dock to the right of the pane (`src/shell/rightSidebar.ts`). It has Obsidian-style icon tabs at the top: Backlinks (link icon) and Outline (list icon). The active tab gets the grey pill, like the left sidebar's.
- **Toggle:** the panel-right button at the right end of the tab strip, `Ctrl+Alt+]`, or the `toggleRightSidebar` command. `showBacklinks` / `showOutline` open it on that view. `Ctrl+Alt+[` toggles the left sidebar. Grove has no command palette yet, so these commands live in the `commands` map in `main.ts` (exposed as `window.grove` in dev).
- **Resize** by dragging its inner edge (160–560px). While dragging, the dock follows the pointer with transitions off, coalesced to one update per frame.
- **Remembered per vault:** open or closed, width and selected view, in `localStorage` under `grove.layout:<vault path>` (`src/shell/prefs.ts`). Restored without animating on startup; defaults are closed, 260px, Backlinks. Storage errors fall back to defaults.
- **Frameless window:** the window buttons moved out of the tab strip. They now float in the top-right corner, and the rightmost header (the tab strip, or the open right sidebar's header) leaves room for them, easing that padding with the dock.

### Motion (shared with the left sidebar, `src/shell/sidedock.ts`)

Both docks share one implementation and the motion tokens:

- New token `--anim-duration-sidebar: 130ms`, ease-out both ways (0ms under reduced motion).
- The dock's `width` is its one animated layout property. Its edge line is now an inset `box-shadow`, so the border width no longer animates alongside it.
- Contents keep the dock's full width and are clipped, anchored to the outer edge. They fade out in 100ms (ease-in) when closing, and fade back in over 100ms after a 43ms delay when opening.

### Backlinks view (`src/shell/backlinksView.ts`)

- **Linked mentions** come from `link_index` (`ws.links.backlinks[path]`), grouped by source note and sorted by name. Each match shows the line around the link (`snippetParts` in `src/shell/mentions.ts`): list, task and quote markers dropped, and the line cut at a word boundary with "…" when the link is far in. Every `[[link]]` on that line that resolves to this note is highlighted. The section and each note group collapse with a chevron, and group collapse state survives refreshes.
- **Unlinked mentions** are collapsed by default and searched only while expanded. They use the existing `search` command with the note title, keeping hits where the title appears as a whole phrase (any case) outside `[[links]]`, `[markdown](links)` and `#tags`, in other notes.
- Clicking a match opens that note at the line with the mention selected (`Workspace.open` gained `ch: [from, to]`). Clicking a note title opens the note.
- A heavily linked note shows 25 matches per source, then a "Show N more" row (Welcome has 986 links from Big note). Highlight spans are worked out only for rows that are drawn, and link-target resolution is cached per refresh. If the link index hasn't changed, the DOM is left alone, which keeps scroll position and collapsed groups.
- No new backend command was needed, so `CONTRACT.md` is unchanged.

### Outline view (`src/shell/outlineView.ts`, `src/editor/outline.ts`)

- Headings are read from the CodeMirror syntax tree's top-level blocks (ATX and setext). Headings inside code blocks, quotes and lists are excluded, and heading text has its markdown stripped. They are shown as a tree indented by nesting depth, like Obsidian's: an H3 directly under an H1 is one step in.
- Clicking a heading calls the new `Workspace.jumpTo`, the same glide used for `[[#Heading]]` links (a long jump cuts to one screen short, then glides).
- The heading of the section in the middle of the editor is highlighted, and kept scrolled into view in the outline. This is updated from a passive, rAF-coalesced scroll listener. I use the middle so that the heading you just jumped to is the one highlighted.
- **Never on the typing path.** An edit only records the time and restarts a 300ms timer. After 300ms idle, `ensureSyntaxTree` returns the tree, which CodeMirror re-parses incrementally, so only the edited stretch is parsed again. Walking the root's children takes under 1ms for the 5,000-line note. Rows are rebuilt only if the heading list (levels and text) changed. Measured: typing "## Fresh heading" with keys 60ms apart caused no outline DOM change until exactly 300ms after the last key, then one.
- CodeMirror parses only about 100k characters ahead of the viewport, so a long note's tree may not reach the end. In that case the outline parses the rest in 4ms slices, one per idle task. Big note (386k characters) shows its full outline (50 headings) about 80ms after opening, without a long task.

### Not on the switch path

The selected view refreshes only while the sidebar is open. On a note switch it refreshes after the switch's frame has painted (`requestAnimationFrame` → `setTimeout 0`). Hidden views do no work and catch up when shown.

## C. Feel fixes

| Bug | Cause | Fix | Verified |
|---|---|---|---|
| New line under `- [x] Done task` grey and struck through | Ending the list (Enter twice) or Shift+Enter leaves the next line as a markdown lazy continuation: it is inside the same `Task` node, and the strikethrough covered `Task.from…to` | Strike only from after `[x] ` to the end of the task's own line (`checkedTaskText`) | Unit tests; in the app, Enter, Enter, "plain": the old build struck "plain", the new build doesn't |
| Collapsing the left sidebar slides and reflows the text | Width animated over 250ms with an ease-in-out curve. The column re-centred every frame, and in narrow windows it re-wrapped every frame (measured at 900px: column width 607→700 across frames, line heights flipping 48↔24) | Docks are 130ms ease-out. While a dock moves, the pane holds the column at the narrower of its start and end widths. It also eases the column's left margin from its current value to its final centred value, with the dock's own transition timing and start time (read from its `CSSTransition`). Margin and pane edge move on the same curve, so the left edge travels straight from its old place to its new one. The text re-wraps at most once, at the start or end, and that moves only line ends | Per-frame samples at 900px: no width change mid-move, left edge continuous (261→114.5), one re-wrap at the end with the edge unchanged. When the right dock opens or closes, the text's left edge doesn't move at all. 1280px: a single 100px glide in ~140ms |
| Sidebar takes ~230ms | 250ms token | `--anim-duration-sidebar: 130ms` | Width settles in 8–9 frames (~140ms) |
| Opening or closing a tab snaps | The new tab was measured with `flex: none` (title width, ~73px), grew to that, then snapped to its flex width (85px) while its neighbour jumped 96→85px | The new tab is measured in the settled strip, and only its `max-width` animates from 0 (Web Animations, 150ms ease-out). A closed tab shrinks from its current width (150ms ease-in-out; plain ease-in left the last third to vanish in one frame), then is removed | Per-frame widths: new tab 2→40→110→…→200, neighbour fixed at 200; closed tab 193→109→33→6→2→gone. Instant under reduced motion |
| Second tab truncates the first to "Welco…"; tabs not flush | The tab container sized itself to the titles' content width, so every tab shrank to ~85px and the reserved close button cut the inactive title | Tabs are a full 200px while there is room and all shrink evenly (min 40px) when there is not. The + button follows the last tab, and the + / tab-list / right-toggle buttons sit centred on the 28px tab row | Two tabs: 200px each, full titles. Nine tabs: 110px each |
| Quick switcher always offers "Enter to create" | The create row was appended unless a name matched exactly | The create row appears only when nothing matches, or every match is weak (`isStrongMatch`: one contiguous run, or every run starts a word). With weak matches it comes after them, so Enter still opens the best match. Shift+Enter creates from any query. Logic moved to `shell/switcherItems.ts` with tests | "wel", "rl", "proj road": no create row. "eoa": weak match, then create. "Meeting notes": create only |

## Performance

Measured with a dependency-free CDP harness (kept outside the repo, like round 2's). It drives headless Chromium at 1280×800 against the Vite dev server and the mock vault (Big note: 5,000 lines, 386k characters). The old build is commit `18d1865`, served from a scratch copy, and every pair ran through the identical harness.

- **Typing:** 80 keys at line 2,500 of Big note, from the keydown timestamp to the end of the next rendered frame.
- **Note switch:** 40 alternating opens of Welcome and Big note, timed to the end of the frame that shows the new note. The longest frame in the following 250ms is also recorded, to catch deferred work such as the sidebar refresh.

Means in ms, p95 in brackets, two runs each:

| | Old build | New, sidebar closed | New, Backlinks open | New, Outline open |
|---|---|---|---|---|
| Typing, 1× | 10.5 (17.7), 10.1 (17.7) | 9.9 (17.2), 10.3 (17.7) | 10.1 (17.7), 10.2 (17.4) | 11.0 (18.2), 10.5 (17.4) |
| Note switch to painted frame, 1× | 18.7 (22.9), 19.9 (22.8) | 20.2 (23.0), 20.1 (23.0) | 19.9 (22.9), 19.9 (23.0) | 20.2 (23.1), 19.9 (23.6) |
| Switch, synchronous work, 1× | 2.5 | 2.4 | 2.4 | 2.4 |
| Typing, 4× CPU | 17.5 (23.1), 19.7 (24.1) | 17.2 (23.2), 20.4 (24.6) | 17.3, 17.6, 16.6 (21.8–23.8) | 18.1 (23.3), 16.9 (22.6) |
| Note switch, 4× CPU | 33.4 (44.0), 34.8 (46.0) | 35.3 (45.5), 33.0 (42.8) | 33.3, 33.7, 33.2 (41.5–45.1) | 35.4 (44.2), 34.2 (42.7) |
| Longest frame after a switch | 16.8 | 16.8 | 16.8 | 16.8 |

At the very start of this work, before any changes, the round-2 version of the harness measured the same build at typing 10.4ms (p95 17.7) and note switch 16.3ms at 1× (28.1–28.7ms at 4×). Those figures used a different gap between switches, so compare within the table above.

Two things changed during measurement:

- **A harness ordering bug.** At first the harness registered its "frame painted" probe after the switch. The sidebar's after-paint refresh (`rAF` → `setTimeout`) was then queued ahead of the probe's message, so its work was counted as switch time: 4× read ~39ms with the sidebar open against ~33ms. The frame itself had already painted. Registering the probe before the switch removes the artefact, and the numbers above use that. CSS containment on the docks made no difference, which confirmed it wasn't layout.
- **A real cost, fixed.** One early 4× Backlinks run had a single 33ms frame (one missed vsync) after one of 40 switches. That was the Welcome refresh running `linkSpans` and note resolution over all 986 links. Spans are now computed only for drawn rows, and resolution is cached. Three further 4× runs and a long-task observer showed no frame over 16.8ms and no long tasks.

Dock animations: per-frame rAF gaps for left and right, open and close, at 1280px and 900px, at 1×, 4× and 6× CPU throttle, with Big note open (and the outline active in one set). All held 16.7ms frames, with 0 frames over 20ms out of 19–20 per animation.

## Skipped, not applicable, caveats

- **Not run inside the Tauri window.** I did not launch `tauri dev`. It would open the last vault from the real config (the owner's vaults are off-limits), and the WebKitGTK window can't be driven headlessly from here. `cargo build` and `cargo test` pass, and `tauri-build` validated the capability (including the opener scope). The CSP, link handling and motion were verified in Chromium. Worth a quick look in `npm run tauri dev` against a test vault:
  - external links open the system browser;
  - a blocked navigation logs `grove: blocked navigation to …`;
  - the window buttons sit over the right sidebar header;
  - the 130ms dock and the column hold work in WebKitGTK. The hold uses `getAnimations()` and `CSSTransition`, both supported in WebKit, and falls back to the token timing if they aren't found.
- **Local vault images** (`![](img.png)`, `![[img.png]]`) are not rendered, as before. That would need the asset protocol scoped to the open vault at runtime. The CSP already allows `asset:` / `http://asset.localhost` for it. Remote images are handled as required.
- **Obsidian's other right-sidebar views** (Outgoing links, Tags) and the backlink pane's extras (sort, "show more context", per-mention "Link" button) are not built. Outline items have no collapse chevrons.
- **Left sidebar** width is not resizable or remembered. The task asked for this only for the right sidebar.
- **No command palette,** so the new commands are reachable by button and `Ctrl+Alt+[` / `]`. Obsidian has no default hotkeys for these. The two are my choice, and on layouts where Ctrl+Alt acts as AltGr they may need rebinding later.
- **Unlinked mentions** rely on the backend's `search` (all words on one line, up to 500 hits), then a whole-phrase filter in the front end. A title mentioned more than 500 times across the vault would show only the first 500 matching lines.
- **`MOTION_NOTES.md`** gained a one-line pointer to the round-3 changes (sidebar timing, tab animation). The rest is left as the round-2 record.
- **A clippy warning** (`question_mark` in `index.rs:564`) predates this round. I left it alone.
