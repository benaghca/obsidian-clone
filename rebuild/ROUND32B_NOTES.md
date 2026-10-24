# Round 32 Part B — Bases results and New row

Worktree/branch: `grove-r32b-codex`, `rebuild/r32b-codex`. Baseline: `8c696cd`.
Items 1–5 completed. Local commits only; no push or merge.

## Behavior and reuse

- Results opens the shared 220px menu: Limit number of results, conditional
  Show all (total), separator, Copy to clipboard. The input has `e.g. 10`, accepts
  non-negative integers including zero, and removes the selected view's `limit`
  when cleared. Enter saves and dismisses; Escape cancels; invalid input stays
  open. Only the edited YAML block changes, including in CRLF files.
- Copy uses the existing clipboard helper. TSV includes display-name headers and
  every selected result in view order, including results outside the virtualized
  DOM. Tabs/newlines/quotes are escaped, empty values stay empty, no final newline.
  The menu closes and an instant `Copied to your clipboard` notice appears.
- New uses existing `newNote`, editor changes/save and `addProperty`, preserving
  unique naming and undoable note edits. It opens a new tab with the inline title
  selected, as allowed by the brief. A separate popover editor is held. Note
  columns become empty properties; positive tag/folder calls and unambiguous
  literal property equalities seed values. Negated filters and conflicting
  equalities are skipped. This reuses the bounded comparison parser; it is not
  a general expression solver. Matching new notes appear when returning to the
  table without a manual refresh. Existing limits/sorts continue to apply.
- Add filter keeps its parent and incomplete row mounted. The shared menu's child
  renderer anchors the 247px, maximum-300px searchable picker under the live
  property button. Entries show muted property ids and the current checkmark.
  Incomplete rows write nothing. Escape closes the child first; hovering the
  parent does not reopen it. Existing-row and stationary repeated presses work.
- Sort retains the grips and type-based labels, adds bordered 28px property and
  direction controls with chevrons, checked direction choices, icon-only trash,
  34px row pitch, an unindented heading and a separator above Add sort.
- Resizer hover fills all 6px with Grove's accent and tints the header; dragging
  keeps the same treatment. Double-click still removes the last `columnSize`
  key entirely; native leaves `{}`, which the brief explicitly allows us to omit.

All Bases edits use the existing serialized fresh-read/write queue in `menus.ts`
and the byte-preserving writers in `write.ts`. No dependencies, animation,
`.cm-content` spacing changes, or duplicated menu renderer were introduced.
Largest Bases production file: `view.ts`, 183 lines.

## Shared files

- `src/shell/menu.ts`: six added physical lines: a five-line `showMenuChild` hook
  (one executable line) delegates to the existing child renderer and positioning;
  one `clearTimeout` in `openChild` cancels a pending hover-close timer when a
  control opens its picker. A real-pointer regression reproduced the early close
  before the fix and passes after it. Existing menu rendering, cleanup and keyboard
  handling remain the shared path.
- `package.json`: one changed test-chain line appends `test-bases-results.mjs` at
  the end, retaining every preceding entry. Existing Bases test scripts now search
  before choosing a property in the bounded picker, use two Escape presses to
  dismiss child and parent, and choose a Sort direction from its menu.

Production changes otherwise stay in `src/bases` and `src/styles/bases.css`.

## Native observation and evidence

Obsidian 1.14.4, default light theme, 1280×800. Observation and return checks used
the existing headless Electron driver, a scratch vault/private HOME and a separate
loopback-only network namespace. Grove used Vite and isolated headless Chromium.
No owner vault or visible screen window was used.

Native Results was 220px, with rotate-ccw for Show all, copy for Copy, then the held
Export CSV item. Native Enter dismissed the limit menu and showed 2 results. Its
copied three-row TSV matched Grove byte for byte. Native New wrote exactly
`---\ntags:\n  - work\nstatus:\ndue:\npriority:\n---\n` at the vault root and selected
`Untitled`; Grove matches those bytes and selection in its allowed new-tab flow.

[Side-by-side screenshots](round32b-shots/compare.html) compare Results, the filter
picker, Sort, New and the Grove-written limit-2 table. `observed.json` records public
DOM measurements/text and clipboard data; no native implementation/CSS/assets were
copied. `roundtrip.mjs` opened Grove's `.base` and seeded notes in Obsidian: identical
headers, row order, two-row copied TSV, unchanged YAML and unchanged note bytes.
The snapshots and assertions are in `round32b-shots/roundtrip.json`.

## Validation

- `npm run build`: passed.
- `npm test`: passed the complete chain, including 52 unit suites / 298 tests.
- Separate `npm run test:geometry`: passed in all modes, with/without frontmatter.
- `npm run audit:offline`: passed, 162 source files plus dist/CSP/capabilities/deps.
- `cargo build --offline`: passed.
- `cargo test --offline`: passed, 37 Rust tests plus binary/doc tests.

Two earlier full runs stopped at the existing 300-card canvas drag timing check
(one 33.3ms frame each). Its isolated rerun passed at 16.7ms. No canvas code or
timing threshold was changed. The final full chain runs from the start as
`taskset -c 4-11 npm test`, limiting only this test process and its children to
eight CPU cores to reduce scheduling variation.
That complete run passed the canvas drag check at 16.8ms (48 intervals).

Final Sort / Filter / Properties / View maxima were 16.8 / 16.8 / 16.7 / 16.8ms,
all visible on frame 1. Results and the Filter picker were also frame 1 at 16.8ms;
the new Filter toggle sample was 16.7ms. No animations were detected. Warm opening
the 1,000-note Base took 8.9ms against the unchanged 100ms guard.

The added real CDP pointer/key script checks exact limit-2/zero/clear/Escape/invalid
writes, a three-result Show all case, preservation of another view, actual isolated
clipboard text and the notice, New naming/frontmatter/folder/title rename/indexing,
picker geometry/checkmark/search/parent retention/no incomplete write, Sort row
metrics/direction choices and resizer fill/tint. Results, Filter and its picker
must open on frame 1, with no frame ≥20ms during the first 300ms and no animation.
The existing columns script retains the same first-frame requirement for Sort,
Filter, Properties and View. Stationary repeated button clicks are included.

Notes with frontmatter and H1–H3 are exercised in Live Preview, Source and Reading
using actual hover/click/key input, including repeated clicks without moving.
The separate geometry suite also checks stationary fold/unfold arrows, zero direct
child vertical margins and every rendered CodeMirror line within 1px of its DOM top.

Three added unit tests cover selected-view limit edits/removal/insertion/CRLF,
native New row frontmatter/filter seeds and TSV escaping. Restored 49 generated
older-round screenshots/canvas fixtures and `performance.json` with `git checkout`
before the final commit; only this round's evidence is retained.

## Line counts

Tracked app source (`src`, `src-tauri/src`, `vite.config.ts`, `src-tauri/build.rs`),
excluding `/gen/`, counting newline bytes. Baseline `8c696cd`:

- Production TS: 24,279 → 24,359 (**+80**).
- Test TS: 3,729 → 3,751 (**+22**).
- All TS: 28,008 → 28,110 (**+102**).
- CSS: 4,673 → 4,683 (**+10**).
- Rust: 3,314 → 3,314 (**0**).
- TS/CSS/Rust: 35,995 → 36,107 (**+112**).
- App test mjs: 8,402 → 8,487 (**+85**).
- New evidence scripts: **+36 mjs**; total task mjs net **+121**.

## Local commits

- `60959b7` — Results limits, TSV copy and filtered New row.
- `308904a` — Keep property pickers under the live row with Filter open.
- `b92be37` — Sort comboboxes and resizer hover.
- `108521f` — Trusted pointer regression coverage and npm chain.
- `2799cff` — Cancel pending picker hover-close; dismiss valid limit Enter edits.
- `1d1a301` — Native observations, exact return check and side-by-side screenshots.
- This notes commit — Final validation, line counts and held work.

## Held and next improvements

Held: Configure view; view rename/duplicate/delete; cards/list; Group by; Search;
Summaries; formulas and visible formula errors; Export CSV; header Summarize,
Group by, Edit property and Property type; extra file facts (backlinks, base name,
embeds, full name, links); more expression/YAML coverage; embedding Bases;
non-Markdown rows; canvas indexing and earlier canvas leftovers. New uses a tab
instead of the native popover. Items 4–5 are completed, not held.

1. Configure view/view options: gives view creation and management their next
   usable controls; roughly one small round for a bounded set.
2. More native filter-seed/expression fixtures: improves creation from compound
   predicates and formula diagnostics; one small round per supported subset.
3. Export CSV: offers a file artifact alongside clipboard TSV; a small follow-up
   using the existing dialog/file path, with quoting and native return checks.
