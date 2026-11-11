# L2: heavy views load after the first note

Canvas, Bases, the graph, the drawing editor, and the settings modal are no longer in the JavaScript the browser parses before the first note. They are separate chunks. After the first note is on screen, the app fetches them while the browser is idle (in dev, immediately, so tests do not wait on an idle timeout). A restored workspace waits for the chunks it is about to show, then paints the real view. A later open, once the chunk is in memory, still runs in the same turn as before. Nothing is swapped for a spinner or an empty board.

The drawing renderer stays in the startup graph. Notes embed drawings, and saving a drawing goes through that code. The editor (the tools) is the part that moved.

## What got faster

Measured on a production build, headless Chromium, cache disabled, five cold loads of the sample vault. The time is until the welcome note's text is in the editor. The median drops the first run, which pays for starting the browser.

Startup JavaScript the page loads before the first note (the entry plus every file it imports statically):

- Before: 1,374,261 bytes (one 1,294,265 byte file, plus two small files it imported).
- After: 1,053,891 bytes, across the entry (172,286 bytes) and the shell files it still imports.
- 320,370 bytes less, about 23 percent. That is the canvas, Bases, graph, drawing editor, and settings code.

Time until the welcome note:

- Before: 72 ms median (runs 129, 72, 70, 69, 74).
- After: 55 ms median (runs 105, 58, 53, 55, 50).

The chunks finished warming at 67 ms median (66 to 74 ms after the first run), about 12 ms after the note.

## No first-open delay, no flash

First open after that warm, same five runs, median:

- Graph (Ctrl+G): 9 ms before, 10 ms after.
- Settings (Ctrl+,): 3 ms both.
- New canvas (ribbon): 7 ms both.
- New drawing (ribbon): 7 ms before, 7 ms after.
- New base (command palette, so this includes the palette): 145 ms before, 144 ms after.

In the dev app, with the chunks already warm, opening each one left the view in the document before the call returned: canvas 5 ms, base 3 ms, drawing 7 ms, graph 7 ms, settings 4 ms. A note with a base block had the base mounted before the next frame.

A reload that restored a canvas (with the local graph dock open), a base, a drawing, and a note with a base block never showed the tab without its view. A watcher on the document sampled 15 to 18 mutations on each reload and did not flag a gap. The stylesheets for these views stay on the first page, except the kanban, list, and cards sheets (7 KB), which arrive with the base chunk before that view is shown.

Switching to a heavy tab that was not the one on screen, with Ctrl+Tab or a click, waits until that chunk is in hand before the tab header or the editor changes. Closing onto one does the same. The Local graph button stays on the previous view until the graph is actually there. A note with a `~~~base` fence waits the same way a backtick fence does. Opening a warm graph while a canvas is still loading keeps the graph: the late canvas does not replace it. A new tab or a split still does not cancel an open that is already on its way. Once a chunk is warm, the open is still the same turn as before. The production check holds the chunks, uses the idle scheduler (not the dev shortcut), and covers those routes.

## Tests

`scripts/test-startup-chunk.mjs` builds and checks that the startup JavaScript does not contain those views, that each one still exists in some other chunk, and that nothing in the preload list is one of them.

`scripts/test-lazy-views.mjs` opens each view, reloads a saved workspace, and, against the production build, holds a chunk to check the cold routes above. Both run from `npm test`.

Feel and friction budgets were not changed. The graph gap stays the known one. The locked `npm test` passed, including those budgets, the startup-chunk check, and the lazy-view check. `cargo test --offline` passed. `npm run build` passed. `npm run audit:offline` passed. The audit still accepts only the bare `https://` prefix a paste handler writes in front of a www address. That prefix now lives in the local chunks that hold the handlers, not in the entry file.

## Size of the change

1200 lines added, net, not counting this note. Most of that is the loader, the settings gate, and the tests. The edits in `main.ts` and `workspace.ts` stay small. `noteEditors.ts` and `fileOps.ts` were not touched.
