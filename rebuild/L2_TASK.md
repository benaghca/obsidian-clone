# L2: Smaller startup bundle without a first-open delay (finding 17)

From Fable 5.2's 10 Nov 2026 Grove review, finding 17. Grok 4.7 builds on `rebuild/l2-grok`; Codex reviews later, read-only. Commit locally. Never push.

## Problem

`npm run build` produces one ~1.29 MB startup JS bundle holding canvas, Bases, graph, the drawing editor and settings, so every launch parses all of it before the first note shows. Fable's fix: load those views with dynamic imports.

## Goal

Grove should start faster, and **nothing visible may change**, including no new delay the first time someone opens a canvas, base, graph, drawing or settings. Chris's bar: the app must feel instant and seamless; a new first-open hitch would be a regression. So a plain lazy load is not enough on its own: e.g. warm the chunks after startup goes idle, and make sure a restored workspace that opens one of these views at launch still shows it without a flash or layout jump. Design the approach yourself and measure it (startup bundle size, time to first note, first-open time of each view before/after, headless only).

## Must hold

- Layout, shortcuts, look/theme and behaviour unchanged. No loading spinners or placeholders users can see.
- S1 (save/close flush) is still in review and changes `src/main.ts`, `src/noteEditors.ts`, `src/workspace.ts`, `src/fileOps.ts`; keep edits to those files as small as possible. Don't touch `src/vault.ts` (S9), `src/shell/sidebar.ts` (S7), `src/links/internal.ts`, `src/shell/searchRead.ts` (L1), or `src-tauri/`.
- CSP / offline audit stay green (chunks are local `'self'` scripts; no network, no worker-src change).
- Regression tests: e.g. a build check that the startup chunk no longer contains those views, and that each view still opens correctly (and from a restored workspace). Don't weaken existing assertions, including feel/friction budgets.
- No new crates or packages. No network. No app or GUI windows (headless Chromium only). Test vaults only under `/tmp`; never touch real vaults, `/tmp/grove-playground` or `~/grove-compare-vault`. No Obsidian/Excalidraw code or assets.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, `npm run audit:offline` pass. Restore screenshots the suite rewrites.
- Commit on `rebuild/l2-grok`, never push, don't commit `.x-*.txt` prompt files. Don't buy credits or change tool config.

## Notes

Write `rebuild/NOTES_L2-grok.md` (plain words: what got faster with numbers, proof there's no first-open delay or visible change, tests, net line change) and commit it with the code.
