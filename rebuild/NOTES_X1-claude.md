# X1: the drawing file model (claude)

Branch `rebuild/x1-claude`, from `rebuild/integration` `b5d0a34`. Piece X1 of `rebuild/CINDER_GAP_PLAN.md` §8. Committed locally, not pushed. No window was opened and no vault was touched.

## What I built

`rebuild/app/src/drawing/scene.ts` (our own code, nothing taken from Cinder or Excalidraw) is the `.excalidraw` file model. Nothing in the app imports it yet; X2 will.

- **`parseScene(text)`** returns `{ok: true, scene}` or `{ok: false, error}`.
  - The scene keeps the parsed document as it was read (`scene.data`) and the source text.
  - Beside them it keeps a typed view of each element (`scene.elements`, in file order, deleted ones included), `appState` with defaults, and `files` as a Map.
- **Refusing files.** A file that isn't Excalidraw JSON is refused, and then there's no scene, so nothing can save over it. That covers:
  - bad or truncated JSON;
  - anything that isn't an object;
  - a `type` other than `"excalidraw"` (a JSON Canvas, an `excalidrawlib` library, `excalidraw/clipboard`);
  - `elements` that isn't an array;
  - an object with neither `type` nor `elements`.

  A blank file opens as an empty drawing and stays blank until something is added.
- **Defaults per element type** follow what Cinder's `newElement` writes and how Excalidraw upgrades old files:
  - `strokeSharpness` becomes `roundness`;
  - `boundElementIds` becomes `boundElements`;
  - an arrow with no stored arrowheads gets an end arrow;
  - `draw` reads as `line`.

  Bad values (out-of-range opacity, unknown fill style, broken points) read as defaults. Defaults live only in the view and are never written to the file.
- **The view is lazy.** Each element is a small read-only `ElementView` whose fields are getters over the raw record. Lists (points, bound elements and so on) are worked out once, on first read. This is what keeps the parse inside its budget (see below).
  - Fields belonging to other types read as their defaults.
  - Unknown types have `known: false`, and `liveElements()` leaves them out along with deleted elements.
  - `slot` is the record's position in the file; it is not Excalidraw's own `index` key, which is kept untouched.
- **Saving.**
  - `serializeScene(scene)` returns the source bytes unchanged while nothing has been edited.
  - After an edit, `stringifyScene` writes the file back in its own layout: indent (2 spaces, tab, or one line), LF or CRLF, the final newline, and the BOM.
  - Files written by Excalidraw or Cinder (`JSON.stringify(doc, null, 2)`) come back byte for byte, so an edit changes only the edited element's lines.
- **Edits.**
  - `updateElement(scene, id, patch)` patches the raw record in place, so unknown keys and their order stay. A key the record didn't have goes where a fresh element has it; `undefined` removes a key.
  - Each real change gives the element a new `version` (+1), `versionNonce` and `updated`. A patch that changes nothing changes nothing, including the dirty flag.
  - `deleteElement` sets `isDeleted` and keeps the record, as Excalidraw does.
  - `addElement` and `newElementRecord` write a complete new element.
  - `emptyDrawing()` gives the text of a new file.
  - Clock and random source can be injected (`Stamp`), for tests.

**Fixtures** are in `rebuild/app/fixtures/drawings/`; its README describes each one.
- **Cinder's editor:** four files (`cinder-empty`, `-shapes`, `-bindings`, `-image`). The test-only `rebuild/app/scripts/gen-drawing-fixtures.mjs` writes them by running Cinder's `ui/draw-render.js` with a fixed seed and clock. Two runs give identical bytes. Nothing from Cinder ships.
- **Hand-written:** five files:
  - an excalidraw.com-style file with unknown keys, an unknown `embeddable` type, a deleted element, bindings, a frame, an image and an unused file;
  - an old-format file, including `null`, a number and a record without an id in `elements`;
  - a tab-indented file with CRLF and a BOM;
  - a one-line file;
  - a hand-edited file that `JSON.stringify` can't reproduce.
- **Refused:** six files in `bad/`.

## Checks run

- `npx vitest run src/drawing`: **37 passed.** The plan's X1 checks are all covered:
  - **Byte-stable round trip** on every fixture: a save with no edit writes the same bytes, and re-serializing reproduces each fixture byte for byte. The one exception is the hand-edited file, which comes back as the same data.
  - **Unknown keys and types kept** through edits, at all levels (element, binding, `customData`, `appState`, `files`). After an edit, only the five changed lines of the edited element differ.
  - **Deleted elements kept**, and deleting marks rather than removes.
  - **Bad files refused:** all six `bad/` fixtures plus nine inline cases.
  - **The 5,000-element parse** is far under the limit.

  | Run | `parseScene`, best of 7 | `JSON.parse` alone | Parse and read every field |
  |---|---|---|---|
  | Test file alone | 9.5–11.1 ms | 9.3–9.5 ms | 12–12.8 ms |
  | Full suite, all cores busy | 12.6–12.7 ms | 13.2–13.4 ms | 18.7–23.2 ms |
  | Cold first call, standalone Node | ≈15 ms | 14.6–15.9 ms | not measured |

  The test drawing has 5,000 mixed elements, including 1,000 freedraw strokes of 40 points each, and is 7.2 MB.
- `npx vitest run` (whole suite), run twice: **81 files, 1,319 tests passed** both times.
- `npx tsc --noEmit -p .`: clean.
- `npm run audit:offline`: passed (build and offline audit).
- The full `npm test` browser-script chain was not run. X1 adds no UI, and the X1 checks are Vitest only.

## Things to know

- **Why the view is lazy.** My first version built every element's view eagerly. Warm, it parsed in about 12 ms, but cold or with every core busy it reached 17–26 ms. While the code is still unoptimized, building 5,000 objects of about 35 fields costs about as much as `JSON.parse` itself. With the getter view, the parse costs about what `JSON.parse` does, and reading every field afterwards adds 2–3 ms.
- **How the speed test asserts.**
  - Always: `parseScene` must stay within 1.25 × `JSON.parse` + 2 ms.
  - Always: the parse plus reading every field must stay under 50 ms.
  - The flat 20 ms limit applies only when `JSON.parse` alone takes under 15 ms. Under a fully loaded machine `JSON.parse` alone has taken 23 ms in my runs, and a flat limit would just be flaky. In every full-suite run so far the 20 ms limit held anyway.
- **What an edit can disturb.** After an edit, a hand-edited file (`1.50`, `é`, odd spacing) is rewritten in `JSON.stringify` form; its data is unchanged. Object keys that look like integers (a `fileId` that is all digits, say) would also move to the front of their object, because JavaScript orders them that way. Excalidraw's file ids are hex hashes, so this shouldn't come up in practice. A save with no edit always writes the original bytes.
- **What Grove doesn't drop.** Cinder drops deleted elements and unused `files` entries when it saves. Grove keeps both.
- **`.excalidraw.md` isn't handled**, as the plan says (Choice 1). There's no lz-string port and no rough.js code.
