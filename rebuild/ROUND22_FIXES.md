# Round 22 stage 3 fixes

Baseline: `d95733a` on `rebuild/r22-codex`. Cherry-picked Grok's hunter
commit `2a73f84` as `e3aae4c`, including `ROUND22_BUGS.md`, its browser
regression and the `npm test` entry. The original regression reproduced all
three bugs before changes. Work and commits are local; nothing was pushed
or merged.

## Fixes and reasons

- `3306a38` — Escaped Markdown destinations now resolve, index and rewrite
  on rename. Both TypeScript destination patterns consume escaped parentheses;
  resolution shares the existing Markdown escape decoder with rendering.
  Rename searches cover raw, escaped and percent-encoded names, including
  notes absent from a stale backlink index. Rewrites preserve backslash
  escaping or percent encoding, along with labels and heading fragments.
  Rust skips escaped parentheses when tracking nesting and unescapes the
  destination before percent decoding. Resolved Markdown mentions now appear
  in backlinks in both backends; `CONTRACT.md` and the API comments describe
  this change. The separate outgoing wikilink map remains intact.
  Added TypeScript resolution/rewrite coverage, a Rust parsing/index/backlink
  test, and browser checks for escaped-only and percent-only rename candidates.
- `cea5da6` — Tab invokes the existing completion acceptance command before
  the indentation fallback. Native-key checks highlight a different row in
  Live Preview and Source, accept it, check the caret after the closed link,
  and verify that Tab still indents without completion. Reading stays read-only.
- `1cb810b` — Properties decoration ranges rebuild after document edits.
  Mapping the old frontmatter replacement across a full-document change
  stretched it over the new body when the YAML object was reused. Equal
  widgets retain their existing DOM. Native select-all paste and undo are
  covered in Live Preview and Source; whole-document replacement and body
  edits are covered in all three modes, including DOM retention.

## Line counts

Counts are newline counts of tracked files under `rebuild/app`, excluding
`gen/`, generated build output and dependencies. Rust includes Rust tests;
TypeScript tests are separated below. Markdown documentation is excluded.

- Production TypeScript: 19,623 → **19,630** (**+7**).
- Test TypeScript: 3,076 → **3,090** (**+14**); all TypeScript **+21**.
- CSS: 3,746 → **3,746** (**0**).
- Rust: 3,104 → **3,134** (**+30**).
- JavaScript (`.mjs`, test scripts): 1,991 → **2,120** (**+129**).
  Of these, 97 lines came from the hunter cherry-pick and 32 from the fixes.
- JSON: **0** net lines (the hunter added its test to the existing command).

TypeScript/CSS/Rust total: **29,600**, net **+51** from the stage-3 baseline.
Including `.mjs`: **31,720**, net **+180**. Relative to the hunter cherry-pick,
the fixes add **83** code/test lines across these languages.

## Verification

All requested gates passed:

- `npm run build`.
- `npm test`: 4 browser-discovery tests; 234 TypeScript tests in 41 files;
  666 named browser checks, including all 26 expanded round-22 bug checks;
  and 53 paste-converter cases. All existing test scripts ran.
- `npm run audit:offline`: 130 source files, production assets, CSP,
  capabilities and dependencies checked.
- `cargo build` and `cargo test`: all 33 Rust tests passed.
- `git diff --check`.

The full browser run used Vite on loopback and headless Chromium with private
profiles and scratch mock notes. Interaction used real CDP pointer/key input:
move over controls first, then repeated stationary clicks. Geometry passed
with and without frontmatter in Live Preview, Source and Reading: line
positions within 1px, no direct-child vertical margins, and fold arrows
remaining visible after stationary unfold. All 18 instant prompt/menu checks
passed: visible within two frames, no opening animation, longest sampled frame
17.1ms. No Tauri or Obsidian window was launched and no real vault was used.

The first full run, concurrent with builds, exceeded the unchanged command
palette timing gate (2.13ms against 2ms). A complete rerun after the builds
finished passed; no threshold or test was weakened.

A supplemental native-input sample on frontmatter notes measured
`beforeinput` to the next animation frame, using 35 insertions and discarding
five warmups. Big note (5,000 body lines): p50 2.9ms, p95 16.3ms, maximum
16.6ms. A 40-row editable table: p50 1.9ms, p95 15.7ms, maximum 16.8ms.
The previous Part B p95 values were 15.5ms and 16.9ms respectively; this
small sample shows no material typing regression and is not a speedup claim.
