# Task: Offline lockdown, right sidebar, and feel fixes for Grove

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app`. Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/MOTION_NOTES.md` first. The motion pass is already merged; reuse its motion tokens and helpers in `src/motion.ts` and `theme.css`.

## Why Grove exists (non-negotiable)
Grove is an Obsidian the owner can use at work without infosec concerns: source available, no downloadable community plugins, and **nothing in the app ever reaches outside the machine**. Every change you make must keep that true.

## The problem
Side by side with Obsidian, three things stand out:
1. **Security is not locked down.** `src-tauri/tauri.conf.json` has `"csp": null` (no Content-Security-Policy at all). `capabilities/default.json` grants the dev-server origins (`http://localhost:1420`, `http://127.0.0.1:1420`) full vault-command access in every build, not just dev. External links either call `window.open` (which can load a remote page inside an app window) or do nothing. Source maps ship in `dist`.
2. **There is no right sidebar.** Obsidian shows Backlinks (linked and unlinked mentions) and an Outline in a collapsible right sidebar. Grove only shows a "1 backlink" count in the status bar.
3. **Feel bugs found in testing:**
   - Typing a new line after a checked task (`- [x] Done task`) renders the new line grey with strikethrough, as if it were still part of the done task. Obsidian renders it as plain text.
   - Collapsing the left sidebar makes the editor text slide and reflow sideways. In Obsidian the readable-width text column stays visually stable.
   - Sidebar collapse/expand takes ~230ms; Obsidian's is ~130ms and crisper.
   - Opening or closing a tab snaps (no visible grow/shrink), and a second tab truncates the first to "Welco…" while Obsidian's tabs share the bar width more generously and sit flush with the toolbar.
   - The quick switcher shows an "Enter to create" row for every query; Obsidian only offers create when there's no good match (or via Shift+Enter).

## Requirements
### A. Offline security lockdown (do this first)
1. Set a strict CSP in `tauri.conf.json` that allows only the app's own origin: at minimum `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: asset: http://asset.localhost; font-src 'self' data:; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'`. Adjust only as needed for local vault images to load; never allow a remote host. Also set `devCsp` if needed so dev still works against the local Vite server only.
2. External links (`http`, `https`, `mailto`) open **only on an explicit user click** (or Ctrl/Cmd+click per Obsidian's behavior) via the system opener using `tauri-plugin-opener`, with a capability that permits only `http:`, `https:` and `mailto:` URLs through `open_url`. Never fetch, preview, or load them inside the app. Remove `window.open` usage. In the browser mock, log the URL instead of opening it.
3. Restrict IPC capabilities so the dev-server origins are not granted in release builds (use the app's own origin only; keep dev working).
4. No remote embeds: markdown images or embeds pointing at `http(s)` URLs must not be fetched. Render them as a plain link/placeholder the user can click to open externally.
5. Turn off production source maps (keep them for dev).
6. Add a test or script (e.g. `npm run audit:offline`) that greps `src`, `index.html`, styles and the built `dist` for `http(s)://` URLs, `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, remote `@import`/`url()`, and fails on anything not on a small, commented allowlist (SVG namespace, `$schema`, localhost dev URL).
7. Dependencies: `tauri-plugin-opener` is the only new dependency allowed. No updater, HTTP client, analytics, crash reporter, or telemetry crate/package. Bundle any fonts/icons locally.

### B. Right sidebar
1. A collapsible right sidebar, toggled from a button at the top right of the tab bar area (like Obsidian) and a command, with the same motion tokens as the left sidebar. Remember open/closed state and width per vault.
2. **Backlinks view** for the active note: "Linked mentions" grouped by source note with a snippet of context and the link highlighted, and "Unlinked mentions" (plain-text occurrences of the note title) collapsed by default. Clicking a result opens that note at the mention.
3. **Outline view**: the active note's headings as an indented tree; clicking scrolls to the heading (reuse the existing heading-jump/glide logic). Highlight the heading currently in view.
4. Tabs or icons at the top of the right sidebar switch between Backlinks and Outline, styled like Obsidian's.
5. Use the existing backend wikilink index/search. If you need a new backend command, add it in `src-tauri` and the mock, and document it in `CONTRACT.md`.

### C. Feel fixes
Fix every bug listed in "The problem" item 3. Sidebar duration should land around 120-150ms; tabs should visibly grow/shrink using transform/opacity (or a single width transition on the tab being added/removed) and share bar width more like Obsidian.

## Performance rules (hard)
- Typing latency on the 5,000-line note must stay at the current ~10ms key-to-frame. Never recompute backlinks or the outline on every keystroke: debounce (>=300ms idle) and do it off the typing path; update the outline incrementally from the syntax tree.
- Note switching must still show content in under 50ms with the right sidebar open.
- Animate only `opacity` and `transform` where possible; at most one width transition per sidebar. 60fps, and respect `prefers-reduced-motion`.
- Measure key-to-frame and note-switch time before and after (a CDP or Performance-API harness is fine) and record the numbers.

## Scope
`rebuild/app` front end, `rebuild/app/src-tauri` (config, capabilities, opener plugin, any backlinks command), the mock backend, and `CONTRACT.md` if a command is added. Do not touch the owner's real vaults or anything outside this worktree.

## Done when
- `npm run build`, `npm test`, the offline audit script, and `cargo build` (in `rebuild/app/src-tauri`) all pass.
- Every requirement above is done or explicitly noted as not applicable with a reason.
- Commit your work on the current branch with clear messages (several small commits are fine). Do NOT push, do NOT merge into other branches.
- Finish by writing `rebuild/LOCKDOWN_SIDEBAR_NOTES.md`: what you changed, the final CSP and capabilities, how external links are opened, the audit script, the right sidebar design, the bug fixes, performance numbers before/after, and anything skipped and why.
