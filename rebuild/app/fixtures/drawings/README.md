# Drawing fixtures

`.excalidraw` files for the drawing file model (`src/drawing/scene.ts`, checked by `src/drawing/scene.test.ts`).

- `cinder-*.excalidraw`: saved by Cinder's own drawing model. `scripts/gen-drawing-fixtures.mjs` writes them by running `ui/draw-render.js` with a fixed random seed and clock. It is test-only; nothing from Cinder ships. Rerun it only to refresh these files.
- `excalidraw-web.excalidraw`: hand-written in the layout excalidraw.com saves (2-space indent, no final newline). It has unknown keys (`index`, `customData`, `baseline`, `fixedPoint`, `validated`, `futureField`), an unknown element type (`embeddable`), a deleted element, a bound text, an arrow binding, a frame, an image and an unused file entry.
- `legacy.excalidraw`: an old file: `strokeSharpness` instead of `roundness`, `boundElementIds`, an arrow with no stored arrowheads, the old `draw` type, and records with no id, `null` and a number in `elements`.
- `tabs-crlf-bom.excalidraw`: tab indent, CRLF line endings, a byte-order mark and a final newline.
- `minified.excalidraw`: one line, no final newline.
- `non-canonical.excalidraw`: hand-edited JSON (`1.50`, `2e1`, `é`, odd spacing) that `JSON.stringify` can't reproduce. A save with no edit still writes its bytes back.
- `bad/`: files that must be refused: invalid or truncated JSON, a JSON Canvas, an Excalidraw library, a top-level array, `elements` as an object, and Markdown.
