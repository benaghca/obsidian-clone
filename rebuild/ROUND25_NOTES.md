# Round 25 — Part A cleanup

Baseline: `c44239facf38ac361d8bc0de2a9d88c56f1f8556`, worktree
`grove-r25-codex`, branch `rebuild/r25-codex`. Part A only. Part B remains
unimplemented. All commits are local; nothing was pushed or merged.

The production cut is **22 lines** (8 TypeScript, 14 CSS), below the
suggested 250-line target. Including browser scripts, the cut is **31 lines**.
I kept the cuts small rather than remove useful code, compress formatting,
or change behavior to meet the aspirational count. No dependencies were added.

## Cuts and reasons

- `716ea03` — Remove obsolete prompt/menu exit-motion plumbing: **10 lines
  saved** (TS −4, CSS −6; 4 added, 14 deleted). Checked the menu and modal
  selectors across all stylesheets: neither has entry/exit animation or
  transitions. `animateOut` therefore already removed these elements
  synchronously. Direct removal preserves focus restoration and listener
  cleanup. The two closing-state pointer rules are unreachable during a
  rendered frame; removed the old comments claiming an animated exit.
- `9e13775` — Reuse canvas link, bounds and keyboard-button helpers:
  **1 TS line saved** (13 added, 14 deleted), also removing a duplicated
  bounds calculation and link-resolution body. Cards and navigation use
  the shell's existing `keyButton`; navigation retains its distinct key
  propagation/focus behavior. Rendered card links call their existing
  editor host. Narrowed `whereFromEvent`'s type to its actual three return
  values; its implementation is unchanged.
- `5a7558b` — Share canvas fixture and native double-click test helpers:
  **9 mjs lines saved** (23 added, 32 deleted). The round-22 driver already
  owned Vite, Chromium, CDP and scratch-profile setup in every canvas
  suite. Extended it with the repeated fixture-open, current-file-read and
  double-click operations, then removed their local copies in the card,
  editing and round-24 regression suites. All assertions remain. Different
  drag sampling/timing and specialized fixtures stay local.
- `d347d6a` — Remove redundant canvas rules and share pane declarations:
  **8 CSS lines saved** (14 added, 22 deleted). The four exact side-resizer
  offsets were duplicated by the later prefix/suffix selectors at the same
  specificity. Canvas H1 line-height already comes from `.cm-line.cm-h1`.
  Merged the two canvas-view rules and grouped identical pane declarations,
  retaining selector specificity and the root's original minimum height.
- `640bc31` — Share recent-note ordering between links and the switcher:
  **3 TS lines saved** (13 added, 16 deleted). Their duplicate selection
  loops now use `recentNotes` in the existing switcher-items module. Links
  still normalize lookup keys case-insensitively, include attachments and
  unresolved names, and append every remaining candidate. The switcher
  still excludes the active file and caps results at 50.

## Review boundaries

TypeScript already enables `noUnusedLocals` and `noUnusedParameters`;
`tsc --noEmit` passed. Searches of exported names and CSS classes found no
safe wholesale module/selector deletion. Dynamic class names and token
uses were checked as well: for example, `--color-gray` has no literal
`var()` reference but is used by quote callouts, so it remains.

Canvas gestures already use `dragPointer`, card pickers already use the
shared prompt/switcher/media helpers, and all icon tooltips already use
`installTooltips`. Ordinary tag-row native titles serve a different label
and were retained. Canvas history checkpoints have different lifetimes
(gesture versus text session versus addition); their no-op checkpoint
handling and serializer's unknown-field/key-order preservation remain.
No per-keystroke note processing was added.

No file needed splitting. The existing largest production files remain
678 lines (`pane.ts`), 644 (`workspace.ts`), 611 (`livePreview.ts`), 609
(`graph/view.ts`) and 602 (`settings.css`).

## Visual comparison

[Reproduction driver](round25-shots/compare.mjs), run with `before` and
`after`, captures 1280×800 headless Chromium using only the in-memory mock
vault and an added mock canvas. It hides the caret in both runs for stable
comparison; input uses native CDP pointer/key events.

All **16 PNG pairs are byte-identical**, including their pixels
([hash comparison](round25-shots/screenshot-comparison.json)):

- Light and dark Welcome with the file explorer.
- Light and dark Callouts/tables/image embeds in Live Preview, Source and
  Reading (six pairs).
- Light and dark canvas with a group, labelled edge and selected card.
- Light and dark Settings, quick switcher and the shared tooltip.

Before/after examples: [Welcome before](round25-shots/before/light-welcome-explorer.png),
[after](round25-shots/after/light-welcome-explorer.png);
[canvas before](round25-shots/before/light-canvas.png),
[after](round25-shots/after/light-canvas.png);
[blocks before](round25-shots/before/dark-blocks-reading.png),
[after](round25-shots/after/dark-blocks-reading.png).

## Verification

All required checks passed on the completed code:

- `npm test`: **42 TypeScript test files, 238 tests**, **850 named browser
  checks**, four browser-discovery tests and the existing paste checks.
  [Full output](round25-shots/full-tests.txt). Assertions and thresholds
  were retained, including all round-23/24 hunter regressions.
- Permanent geometry: line tops within 1px, zero direct-child vertical
  margins and stationary folding checks passed, including frontmatter
  notes in Live Preview, Source and Reading.
- All **18** instant switcher/palette/context-menu checks passed within
  two frames, without a frame over 20ms. The 300-card/400-edge pan and
  zoom checks each sampled 70 frames, maximum **16.8ms**. The native card
  drag sampled 49 intervals, maximum **16.8ms**.
- `npm run audit:offline`, including `npm run build`: passed, checking
  137 source files, built output, CSP, capabilities and dependencies.
  [Output](round25-shots/offline-audit.txt).
- `cargo build --offline` and `cargo test --offline`: passed; all **34**
  Rust tests. [Build](round25-shots/cargo-build.txt),
  [tests](round25-shots/cargo-test.txt). Tauri was never launched.
- `git diff --check`: passed. No owner's vault was accessed and no window
  was opened on the owner's screen.

The [first full attempt](round25-shots/full-tests-first-attempt.txt)
stopped when the header test's background-tab lookup returned null after
its first split/drop/reset sequence. The unchanged test then passed all
56 checks [in isolation](round25-shots/header-rerun.txt), and a complete
second `npm test` passed. The final full run had no concurrent build.
No test assertions, waits or performance thresholds were relaxed.

## Net app line counts

Tracked newline counts under `rebuild/app`, excluding `/gen/`, compared
with the baseline above. Screenshot/evidence scripts and these notes live
outside the app-source totals. [Machine-readable counts](round25-shots/line-counts.json).

- Production TypeScript: **20,336 → 20,328 (−8)**.
- Test TypeScript: **3,133 → 3,133 (0)**.
- CSS: **3,850 → 3,836 (−14)**.
- Rust: **3,145 → 3,145 (0)**.
- mjs: **2,778 → 2,769 (−9)**.
- TS/CSS/Rust: **30,464 → 30,442 (−22)**.
- Including mjs: **33,242 → 33,211 (−31)**.

The final notes/evidence commit contains this file and the verification
artifacts. Stop after Part A and wait for the separate Part B request.
