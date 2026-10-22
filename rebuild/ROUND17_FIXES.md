# Round 17 stage 3 fixes

Work stayed on `rebuild/r17-codex`. Grok's report was cherry-picked from
`99a2791` as docs-only commit `382ba23`. Only its three confirmed bugs
were addressed; no new dependencies were added.

## Changes and regression tests

1. **Table source button — `0a13b0d`.** The hovered "Edit this block"
   control explicitly enters table source editing. A small mapped state
   field retains that choice while the caret stays in the table; ordinary
   cell clicks still use the nested editor. The state regression test
   covers explicit entry, typing, position mapping and leaving the table.
2. **Cell pairing — `ce9f094`.** The note and cell editors share the
   existing pairing extensions, independently respecting bracket and
   Markdown settings. Block-level Enter commands remain on the note.
   Cell escaping now maps transaction effects, retaining CodeMirror's
   inserted-closer tracking, and forwards the original user event for
   undo grouping. The new test covers quotes, backticks, stars, brackets,
   selection wrapping, empty-pair deletion, escaped pipes and both settings.
3. **Find selection/count — `470ca3e`.** Query changes select the first
   match at or after the selection start, wrapping when necessary. Using
   the start keeps the current match selected as the query grows. Find
   retains focus; an interior caret also counts as the current match.
   Added tests cover incremental queries, wrapping, empty results, exact
   selections, interior carets, adjacent matches and zero-width matches.

## Verification

All required gates passed on the final code:

- `npm run build`.
- `npm test`: **190 tests, 36 files**.
- `npm run audit:offline`: passed, including its production rebuild.
- `cargo build` and `cargo test`: **32 Rust tests**.
- `git diff --check`.

Interaction checks used Vite at `127.0.0.1:1420` and headless Chromium
with a private profile and the in-memory mock vault. Pointer actions were
CDP mouse moves followed by presses and releases; the table control's
hover visibility was checked before pressing. No visible window or real
vault was opened.

The source button revealed raw table text, stayed in source while typing,
and allowed subsequent ordinary cell editing. Native key events verified
all six pair types, closer skipping, Backspace, selection wrapping,
escaped pipes, Tab/Shift+Tab, Enter row creation, undo/redo, and settings.
Find selected matches while each character was typed without losing field
focus, retained the match as the query grew, searched forward from a later
caret, wrapped at the end, counted an interior caret, and preserved Enter,
Shift+Enter, Escape and `0 / 0` for no matches. The note text stayed intact.

Scratch CDP harnesses and captures remain ignored under
`rebuild/app/node_modules/.round17/` (`fixes.mjs`, `findfix.mjs`). Existing
round 17 screenshots were retained. Nothing was pushed or merged.

## Net app line changes

Compared with the accepted Part B commit `c4cee69`, counting newline lines
in tracked app files, excluding generated files, notes and images:

- TypeScript production: **18,817 → 18,863 (+46)**.
- TypeScript tests: **2,513 → 2,585 (+72)**.
- TypeScript total: **21,330 → 21,448 (+118)**.
- CSS: **3,572 → 3,572 (0)**.
- Rust: **3,104 → 3,104 (0)**.
- Total app: **28,006 → 28,124 (+118)**.

The longest app source file remains **642 lines**, below the requested
approximately 800-line ceiling.
