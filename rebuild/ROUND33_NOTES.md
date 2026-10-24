# Round 33 Part A — Bases configuration and measured gaps

Worktree/branch: `grove-r33-codex`, `rebuild/r33-codex`; baseline `fc7913c`.
Completed items 1–3 and item 5. Item 4 (view-option actions) and the optional tag
chip are held. Local commits only; no push or merge.

## Changes

- A reusable eight-line Bases notice helper stacks instant, auto-dismissed notices
  at the top right. Copy measures about 175×33 at x1095/y32 in the 1280×800 fixture:
  white text, black at 90%, 8px/12px padding, 8px radius. Two notices stack, then
  remove their empty container. Results has a 25px label, a 1px input border and
  a separator after the input section, followed by Show all and Copy together.
- A failed Base read now retries while the model is absent. Opening a missing
  file and then creating it recovers in the same tab, without the null `select`
  error or a manual reopen.
- Filter property pickers highlight the checked row, toggle closed on the same
  button and retain the parent. `file` uses the file icon; its initial operator
  reads `links to`. Incomplete filters still write nothing. The tag chip is held.
- Hovering a view row exposes Configure view. It replaces the list with one
  shared-menu page at the same anchor: Back, title, held More, Close, selected
  name input, Table-only Layout, and Short/Medium/Tall/Extra tall Row height.
  Name changes update the toolbar immediately through the existing write queue.
  Add view selects the new view and opens this page; Back returns to the list;
  Escape and Close dismiss it. The Configure page is 221px as requested; native
  public DOM measured 220px here. The existing 225px view list is retained.
- Row height uses native `rowHeight: medium`, `tall`, `extra` for 60/120/240px.
  Short is 30px and removes the key. Cell heights, virtual offsets and spacers
  share that value; headers/resizers remain 30px. Native name quoting is retained
  while every byte outside the edited block, including comments/other views and
  CRLF, is preserved. Default/empty files do not get duplicate `name` keys.
- Sort now has a 32.9px normal-color heading, 16px icons, 271px width and the text
  icon for file.name. Resizers retain their 6px accent fill with a neutral header
  tint. Grip behavior and 34px row pitch are unchanged.

All Base writes still use the serialized fresh-read queue in `menus.ts` and
`writeView`; no second write path/menu renderer/dependency was added. All new code
is in Bases/CSS except the minimal shared hooks below. No animations or editor
spacing changes. Largest Bases production file: `view.ts`, 183 lines.

## Shared files

- `shell/menu.ts`: one-line child-close export, used to toggle the picker while
  retaining Filter; two existing checks now allow native selects to receive
  mousedown and keyboard input. Rendering, positioning and cleanup are reused.
- `shell/icons.ts`: two checked, previously absent bundled Lucide keys:
  `chevron-left` for Back and `text` for Sort's file.name. No assets copied.
- `package.json`: one added `posttest` line runs the new CDP script last. This is
  npm's automatic final test-chain hook; the entire existing `test` line is
  untouched, including `test-r27s.mjs`, so Grok can append `test-r27t.mjs` there
  independently. Existing Bases scripts dismiss Configure after Add view and
  expect the updated picker toggle and notice layout.

No `pane.ts`, Rust or Grok feature files were changed.

## Native observation and return check

Obsidian 1.14.4, light theme, 1280×800, public vault/workspace APIs and rendered
controls only. The existing headless Electron driver uses a scratch vault,
private HOME/XDG paths and a loopback-only network namespace. Grove tests use
Vite and isolated headless Chromium. No real vault or visible window was used.

Native Configure selects the whole name on entry. Actual CDP key-down/text/key-up
typing produced `name: "Renamed: view"`. The four row-height choices write no key,
`medium`, `tall`, `extra`, with measured rows 30/60/120/240px. Back returns to the
view list; Add view immediately opens Configure with `View` selected. More offers
Default view, Duplicate view and Delete view. Escape from More dismissed both
pages; after Add view the focused name's first Escape left Configure visible in
this native run. Grove follows the brief's explicit Escape-closes requirement.

[Side-by-side screenshots](round33-shots/compare.html) cover Results, Copy,
Configure and the Grove-written renamed/Medium view. `observed.json` contains
the measured public UI and written YAML. The return check verifies that Obsidian
opens Grove's file with the identical name, ordered rows, 60px height, selected
Configure values and unchanged YAML bytes. Native may rewrite the whole document
when editing; Grove preserves unrelated bytes as required.

## Validation

- `npm run build`: passed.
- `npm test`: passed the complete existing chain and final `posttest`, including
  53 unit suites / 300 tests.
- Separate `npm run test:geometry`: passed with/without frontmatter in all modes.
- `npm run audit:offline`: passed, 164 source files plus dist/CSP/capabilities/deps.
- `cargo build --offline`: passed.
- `cargo test --offline`: passed, 37 Rust tests plus binary/doc tests.

Final Sort / Filter / Properties / View maxima were 16.8 / 16.7 / 16.8 / 16.7ms,
all on frame 1. Results / Filter picker / Configure were frame 1 at 16.8 / 16.7 /
16.8ms. The 300-card canvas drag passed at 16.8ms (46 intervals); warm opening the
1,000-note Base took 12.9ms against the unchanged 100ms guard.

Focused checks already pass: native-size copy notice/color/stack/dismissal and
section layout, stale-tab recovery, highlighted/toggling file picker, hover
chevron, single-page geometry/selected name, immediate rename and exact YAML,
all row heights/reset, Back/Escape/Add view, Sort measurements/icons and neutral
tint. A 220-row virtual table scrolls to its final 240px row using real CDP wheel
input. New Configure opens on frame 1, with no animation or frame ≥20ms during
the first 300ms. Existing Bases scripts retain their first-frame checks.

The full chain also exercises frontmatter and H1–H3 notes in Live Preview, Source
and Reading with actual hover, clicks, keys and repeated stationary clicks.
Geometry checks retain zero direct-child vertical margins, ≤1px line-top error
and stationary fold/unfold arrows. Two added unit tests cover name and rowHeight
edits, deletion/insertion, default/inline views, other-view/comment preservation
and CRLF. No thresholds were relaxed. As in round 32B, the full npm run is pinned
to CPUs 4–11 to reduce host scheduling variation.

Restored 53 generated older-round fixtures and `performance.json` with
`git checkout` before the final commit. Only this round's evidence is retained.

## Line counts

Tracked app source under `src`, `src-tauri/src`, `vite.config.ts` and
`src-tauri/build.rs`, excluding `/gen/`, counting newline bytes; baseline `fc7913c`:

- Production TS: 24,429 → 24,462 (**+33**).
- Test TS: 3,751 → 3,767 (**+16**).
- All TS: 28,180 → 28,229 (**+49**).
- CSS: 4,735 → 4,754 (**+19**).
- Rust: 3,314 → 3,314 (**0**).
- TS/CSS/Rust: 36,229 → 36,297 (**+68**).
- App mjs: 8,662 → 8,708 (**+46**).
- New evidence scripts: **+34 mjs**; total task mjs net **+80**.

## Local commits

- `75274ce` — Results section layout and stacked notices.
- `7c8502d` — Missing-file recovery and picker toggle/icon/operator.
- `857f772` — Configure page, native heights, lossless writes and tests.
- `088ce8b` — Sort measurements, neutral tint and notice-size proof.
- `3f7e3c2` — Native observations, return check and side-by-side screenshots.
- This notes commit — Final checks, cleanup, counts and held work.

## Held and next improvements

Held: Part A item 4's Default/Duplicate/Delete view actions (More is explicitly
disabled); tag chip; cards/list; Group by; Search; Summaries; formulas/visible
formula errors; Export CSV; header Summarize/Group by/Edit property/Property type;
extra file facts in Properties/picker; broader expression/YAML coverage;
embedding Bases; non-Markdown rows; New row popover; canvas items.

1. View options: enable useful management actions with byte-preserving view-block
   duplication/deletion, default-view behavior and last-view protection; roughly
   one small round, rather than a few safe lines each.
2. Filter tag chips: improves consistency and inline clearing/editing; a small
   follow-up reusing property controls, with keyboard/pointer regressions.
3. More native expression/YAML fixtures: improves compatibility and visible
   diagnostics; one small round per bounded subset.
