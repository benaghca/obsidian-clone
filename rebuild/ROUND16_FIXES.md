# Round 16 stage 3 fixes

Fixed Grok's three confirmed bugs, on top of the reviewer trims:

1. `aa1f3bf` — Margin clicks reuse `editAt()` with CodeMirror's coordinate
   lookup instead of always selecting the document end. A click beside
   line 2 now lands on line 2 in Live Preview and Source mode; a click
   below the last line still selects the end. Regression: `blocks.test.ts`.
2. `7fbfb24` — Source mode's visible-line decorator adds the existing
   `cm-list-line` class to parsed list markers. It reuses Live Preview's
   padding; the monospace task marker stays inside the normal line box.
   Bullets, tasks, nested and numbered items all measure **26.375px**, with
   1.2px top/bottom padding. Fenced lookalikes stay code.
   Regression: `sourceMode.test.ts`.
3. `578ec22` — Reading view's existing decorator marks inline text as
   `cm-reading-text`; only those spans request `cursor: text`. Margins and
   trailing blank space keep the arrow, links keep `pointer`, and the view
   stays read-only. Regressions: `livePreview.test.ts`, `pointer.test.ts`.

Verified with headless Chromium against Vite, using real CDP pointer
moves, presses and releases for clicks, plus pointer movement onto words,
margins, trailing space and links. Live Preview and Reading view fixture
screenshots are byte-identical before/after; Source mode changes only as
expected for list spacing. Fold/unfold, double-click word selection and
drag-reveal checks also pass. The text column remains **700px**.

All required checks pass: `npm run build`, `npm test` (173 tests in 33
files), `npm run audit:offline`, `cargo build`, `cargo test` (32 tests).
No dependencies added; no app windows opened on the owner's screen.
