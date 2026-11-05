# Review of X1: Drawing file model (`src/drawing/scene.ts`)

**VERDICT: APPROVE**

Reviewed Claude's X1 commit `c208b09` (`rebuild/x1-claude`) on review branch `rebuild/x1-review-gemini` against the X1 row in `rebuild/CINDER_GAP_PLAN.md` §8.

## Plan Checklist

- **Parse and validate with per-type defaults:** `parseScene` wraps each valid element record in a lazy `ElementView` whose getters apply Excalidraw/Cinder defaults without mutating the underlying JSON record (`scene.data`). Legacy fields (`strokeSharpness: "round"`, `boundElementIds`, `type: "draw"`, arrows without stored arrowheads) upgrade cleanly in the view while keeping their stored representation on disk. Out-of-range or malformed properties (`opacity`, `fillStyle`, `strokeStyle`, `points`, `pressures`, `scale`, `startBinding`/`endBinding`) fall back to safe defaults in the view only.
- **Serialize with key order and unknown fields kept:** `serializeScene(scene)` returns `scene.source` verbatim when `scene.dirty` is `false`. After edits, `stringifyScene(scene)` re-serializes `scene.data` using the detected indentation (`2` spaces, `\t`, or minified `""`), line ending (`\n` or `\r\n`), trailing newline, and UTF-8 BOM. `updateElement` mutates keys in place on the raw element object so existing key order is preserved, and `setKey` inserts newly added keys at their canonical position for that element type.
- **`version` / `versionNonce` / `updated` bumped on change:** `updateElement` increments `version` by 1, generates a new 31-bit integer `versionNonce`, and updates `updated` via injectable `Stamp` (`now`, `random`). No-op patches leave `version`, `versionNonce`, `updated`, and `scene.dirty` untouched.
- **Non-Excalidraw files refused and never overwritten:** `parseScene` returns `{ ok: false, error }` (producing no `Scene` to serialize) for invalid/truncated JSON, non-object JSON roots, any `type` other than `"excalidraw"` (such as `excalidrawlib` or `excalidraw/clipboard`), non-array `elements`, and objects lacking both `type` and `elements` (such as JSON Canvas or `{}`). Blank/whitespace-only files open as clean empty scenes and remain byte-identical unless edited.
- **Fixtures:** 9 valid fixtures in `rebuild/app/fixtures/drawings/` (4 generated from Cinder's `ui/draw-render.js` via test-only `rebuild/app/scripts/gen-drawing-fixtures.mjs` with pinned PRNG/clock, plus 5 hand-written fixtures covering `excalidraw.com` output, legacy fields, tabs/CRLF/BOM, minified JSON, and non-canonical hand-edited JSON) and 6 invalid fixtures in `rebuild/app/fixtures/drawings/bad/`.
- **Byte-stable round trip, unknown keys/types kept, deleted elements kept:** Verified across all fixtures. Unknown element types (`embeddable` with `known: false`), unknown element/binding/appState/file keys (`index`, `customData`, `baseline`, `fixedPoint`, `validated`, `futureField`, `lastRetrieved`), unused `files` entries, and unparseable element array entries (`null`, numbers, id-less objects) are preserved in place across edits. Deleted elements (`isDeleted: true`) remain in `scene.elements` and `scene.data.elements` and are filtered out only by `liveElements(scene)`; `deleteElement` marks `isDeleted: true` and bumps version metadata rather than splicing the record out.
- **Our own code only:** `rebuild/app/src/drawing/scene.ts` is original TypeScript with no Excalidraw, rough.js, lz-string, or Obsidian code or assets. `rebuild/app/scripts/gen-drawing-fixtures.mjs` is a standalone test helper and is never imported by shipped code.

## Decision & Small Fixes Made on `rebuild/x1-review-gemini`

1. **5,000-element parse under 20 ms (`src/drawing/scene.test.ts`, `src/drawing/scene.ts`):**
   - **Decision:** Keep the strict 20 ms target (`expect(parse).toBeLessThan(20)`) unconditionally, and measure with 3 warm-up runs followed by the median of 9 runs instead of gating the 20 ms assertion on `if (json < 15)`.
   - **Optimization in `src/drawing/scene.ts`:** Replaced `!body.trim()` in `parseScene` with `!/\S/.test(body)` and replaced `text.includes("\r\n")` and `body.trimEnd().includes("\n")` in `detectStyle` with first-newline inspection (`body.indexOf("\n")` plus `INDENT_RE` starting at that newline). Previously, on a 7.2 MB LF file ending in `\n`, `body.trim()`, `text.includes("\r\n")`, and `body.trimEnd()` scanned the entire 7.2 MB string and allocated a 7.2 MB trimmed copy on every parse.
   - **Measured 5,000-element (7.2 MB) medians (3 warm-up, 9 samples):**
     - Standalone Vitest run: `parseScene` median **9.9 ms** (`JSON.parse` alone 11.5 ms, parse + read 23 fields per element 12.6 ms).
     - Full parallel Vitest suite (81 test files): `parseScene` median **15.2 ms** (`JSON.parse` alone 15.6 ms, parse + read 23 fields per element 18.5 ms) — well under the unconditional 20 ms limit.
2. **Edge-case guards in `src/drawing/scene.ts`:**
   - Guarded `updateElement` against non-string `type` patches (`key === "type" && typeof patch[key] !== "string"`) so a patch cannot invalidate an element's required string `type`.
   - Mapped legacy `raw.type === "draw"` to `TYPE_KEYS.line` in `setKey` so adding line-specific keys to a legacy `draw` element places them in the canonical `line` key order.

## Checks Run

- `npm run build`: passed (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test`: passed (exit 0; 81 Vitest files / 1,319 tests, plus all geometry, browser, canvas, and bases scripts and `posttest`).
- `npm run audit:offline`: passed (192 source files, `dist/`, CSP, capabilities, and dependencies checked).
- `cargo test --offline` (in `rebuild/app/src-tauri`): passed (84 passed, 0 failed, 4 ignored).
