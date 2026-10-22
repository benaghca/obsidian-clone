# Round 16: cleanup 4 and editor feel fixes

Baseline: round 15 merge `326d13f`. Claude built through `fbbfca1`;
Codex reviewed/trimmed through `60fc1c0`, then took over the builder role
and fixed Grok's three confirmed bugs in `aa1f3bf`, `7fbfb24`, `578ec22`.
These notes reconstruct Claude's work from his commits, then record the
reviewer and builder relay stages. All work stayed on local branches;
this pass used `rebuild/r16-codex`, without pushing or merging.

## Claude's editor changes (`326d13f` → `fbbfca1`)

- **Reachable fold chevron** (`ddfeadc`, later `e33d9b4`, `6fe07f9`): the
  editor extends 22px into the left margin with matching padding, keeping
  the chevron inside its hover area without moving the text.
- **Stable markup during mouse gestures** (`0ef009f`): freeze the reveal
  selection from mousedown until mouseup, dragend or blur. Map it through
  edits while held, then reveal around the new selection after release.
- **Double-click word selection** (`09e7c6d`): select the word at the first
  click's caret, so the markup revealed after that click cannot shift the
  second click onto the markers. Subsequent dragging extends by words.
- **Native main selection and caret** (`5f092a0`, `10c43b5`): replace
  CodeMirror's drawn main selection with the browser's selection; keep
  small drawn layers for additional ranges and selection-head cursors.
  Remove the obsolete drawn-caret styles and keyframes. Grok confirmed
  text-hugging selection and unselected list bullets against Obsidian;
  fully selected blank lines still show a bar in both apps.
- **Cursor scope** (`022b648`): remove broad text cursors from the pane and
  inline title. Grok later found that read-only paragraph text needed an
  explicit inline cursor target; stage 3 supplies it below.
- **Measured typography** (`65372dc`): heading sizes H1–H6 are 1.618,
  1.462, 1.318, 1.188, 1.076 and 1em, with per-level line heights, weights
  and tracking, and 16px above headings in the note. Lists gain 0.075em
  top/bottom padding (1.2px at the normal 16px font). Remove forced font
  smoothing. **The text column remains 700px**: Claude's measurements and
  Grok's independent check found that this already matches Obsidian.

Claude also added the editor element to the pane's blank-space click
handler (`fc9eea5`); that caused the margin-click bug fixed in stage 3.

## Claude's cleanup

- `73589c7`, `00d5956`: one fuzzy picker for Move file, Insert template and
  Swap file; shared open/split menu pairs. One small recorded difference:
  equal-scoring templates now tie by name rather than path.
- `63a8f02`, `5b48496`, `8b5a8bc`: shared sidebar tab/header/content
  construction, folded-group callbacks, and plain fields for live view
  data instead of getters over closure variables.
- `64b964e`, `133e27a`: shared slider rows; the graph panel synchronizes
  through the slider's own setter instead of duplicating its DOM updates.
- `454fd6f`, `6419c1e`, `361ca84`: rename `perWorkspace.ts` to `memo.ts`,
  introduce `kept(map, key, make)`, and reuse it for decoration/extension
  caches, icons, settings pages, properties, watcher lists, callouts,
  embeds, editor panes, backlinks, tags and unlinked-mention grouping.
- `f1689f6`, `ab39923`: one free-name finder for new notes/folders/copies,
  and the mock backend's links use the existing frontend resolver. The
  mock now also follows path-form wikilinks, like the real backend.
- `016bcc9`, `1cb402b`: one change set with mapped selection for format
  wrapping/unwrapping; AbortControllers stop drag/held-pointer listeners.
- `de80b80`, `c14dda0`, `a25c5f5`, `4b4c6b7`, `fbbfca1`: share bookmark
  context-menu handling, simplify menu classes, reuse folder search,
  remove the close-group wrapper and the repeated column-holder interface.
- `535b242`, `91f529e`, `6fe07f9`, `e33d9b4`: remove redundant hidden/fold
  CSS and one redundant Rust assertion; reuse `afterPaint` for code colour
  scheduling. The Rust test cases remain; the removed assertion merely
  restated the equality immediately above it.

The graph simulation, drawing and WebKitGTK performance work are intact.

## Reviewer trims and confirmed bug fixes

Reviewer commits saved **23 more lines**:

- `5647ae0`: lazy cached search counts avoid recomputing matching lines
  on a cache hit; reuse cache helpers and append backlink groups in place.
- `208b755`: group identical toolbar/sidebar/settings CSS declarations.
- `81cf965`: borrow both indexes' paths during vault rescans instead of
  cloning complete temporary path lists.
- `cd88d33`: use the menu's conditional-entry pattern for Edit link.

See [ROUND16_REVIEW.md](ROUND16_REVIEW.md) for per-commit savings and checks.

Grok's report was read with
`git show rebuild/r16-grok:rebuild/ROUND16_BUGS.md`. Stage 3 fixes:

- `aa1f3bf`: margin clicks map to the pointer's line through the existing
  `editAt` helper; below-document clicks still go to the end.
- `7fbfb24`: Source lists reuse `cm-list-line` padding, including tasks,
  nested and numbered items; fenced lookalikes are excluded by the parser.
- `578ec22`: inline Reading text gets the text cursor; blank margins stay
  arrows and links keep their pointer. Editing remains disabled.

See [ROUND16_FIXES.md](ROUND16_FIXES.md) for the short fix record. Each bug
has a regression test. No dependency, command, permission, file format,
default or text-column change was introduced in the relay stages.

## Lines from round 15 to the final app

Tracked `.ts`, `.css`, `.rs` under `rebuild/app`, excluding `/gen/`, counted
with the brief's newline convention. Markdown notes are excluded. The
final documentation commit does not alter these app counts.

- TypeScript app: **18,563 → 18,510 (−53)**.
- TypeScript tests: **2,165 → 2,306 (+141)**.
- TypeScript total: **20,728 → 20,816 (+88)**.
- CSS: **3,573 → 3,541 (−32)**.
- Rust: **3,115 → 3,104 (−11)**.
- **Total: 27,416 → 27,461 (+45, about +0.16%).**

By relay stage: Claude **−7**, reviewer **−23**, bug fixes and their tests
**+75** (TypeScript app +12, tests +57, CSS +6). Production code is down
96 lines across the round, but the complete app including tests grew 45.
The ~800-line cleanup target was not achieved. No further trims were
attempted during the narrowly scoped bug-fix stage.

The largest source files are `workspace.ts` (641), `settings.css` (626),
`shell/pane.ts` (623), `graph/view.ts` (609), `editor/livePreview.ts` (594).
Every file in `src/` remains under 650 lines. Apart from `memo.ts` replacing
`perWorkspace.ts`, no app module was created, split or merged; stage 3 adds
`editor/sourceMode.test.ts`.

## Validation and limits

Final app checks pass:

- `npm run build`.
- `npm test`: **173 tests in 33 files** (round 15 had 166 in 31 files).
- `npm run audit:offline`: source, bundle, CSP, capabilities, dependencies.
- `cargo build`, `cargo test`: **32 Rust tests**.
- `git diff --check`.

Vite plus headless Chromium, mock vault, 1280×800 at device scale 1,
scratch browser profiles, CDP pointer movement followed by press/release:

- Before the fix, left-margin clicks beside fixture line 2 selected the
  end (line 15, offset 183). Afterwards they select line 2 (offset 10), in
  Live Preview and Source. Below-last-line clicks still select offset 183.
- Source bullets, tasks, nested and numbered items measure **26.375px**
  with 1.2px top/bottom padding, matching Live Preview. The fenced
  `- code, not a list` line keeps its 21px code height and no list padding.
- Mouse hover over Reading paragraph text reports `cursor: text`; left
  margin/trailing blank space report `default`/`auto`; links report
  `pointer`. These are computed-style checks, not captured OS cursor art.
- Live Preview and Reading fixture PNGs are byte-identical before/after
  stage 3. Source PNGs reflect the intended list-spacing change. The
  reviewer had already compared 12 states in both themes byte-for-byte
  against `fbbfca1`, including search rows/counts and properties/settings.
- Fold-arrow traversal, folding/unfolding in Live Preview and Source,
  double-click selection of a bold word, frozen markup during a real drag
  and reveal on release all still pass. No page exceptions were observed.

Harnesses, captures and JSON measurements are scratch artifacts under the
ignored `rebuild/app/node_modules/.review-r16/` directory. Grok's separate
Obsidian 1.14.4 comparison is recorded on his branch. No fresh Obsidian or
WebKitGTK comparison was run in stage 3, and the full typing/search/graph
timing suite was not repeated. Removed work in the trim commits is not
presented as a measured latency gain. No Tauri window was launched, no app
window opened on the owner's display, and no Documents vault was accessed.

Remaining suggestions are recorded in the reviewer and hunter notes;
table-cell editing, linked-tab persistence and the hunter's Source/Reading
heading-spacing differences were not implemented in this round.
