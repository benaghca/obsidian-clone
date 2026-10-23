# Round 19 — Part A cleanup

Branch: `rebuild/r19-codex`. Baseline: `245c6c4`.
Part A only. All commits are local; nothing was pushed or merged.

Production TypeScript and CSS are **106 lines smaller**. This falls short of
the brief's 300-line aim. The remaining hover, find, embed and table paths
were reviewed, but their similar-looking branches have different selection,
modifier, task and source-position behavior. They were retained rather than
changing that behavior or adding an abstraction to meet a line count.

## Cuts and reasons

- **`e3edc79` — 22 production TS lines saved.** Extend the existing
  `sideView.ts` helpers with shared result groups and match rows. Search and
  Backlinks now use the same DOM construction, preview-path attribute,
  original-column selection and snippet highlighting. Their different title
  click modifiers, pagination, counts and empty-group handling remain at the
  call sites. The old duplicate builders were deleted.
- **`54ac1c2` — 6 production TS lines saved; 7 test lines added.** The eager
  `unlinkedMentions` wrapper had no production caller: `rg` and a scan of
  exported names against other production modules found only its definition
  and `unlinked.test.ts`. Move that convenience wrapper into its test;
  production continues using the existing sliced `scanUnlinked` generator.
  Remove 30 unnecessary export modifiers from module-local types and settings
  constants (no line reduction from those modifiers). Cross-module reference
  checks and the strict TypeScript build confirm no consumers were removed.
- **`feb6e3f` — 39 CSS lines saved.** Merge identical renderer visibility,
  positioning, hover, weight and cursor rules; share Source/Live Preview
  emphasis rules; combine the two code-block rules. Remove the inline-code
  marker's inherited font, a bullet's default zero margin, a graph heading's
  inherited size, the graph panel's default absent shadow and its unused
  row-pseudo-element override. Graph rows have no `.setting-items` ancestor,
  so the separator rule never generates their `::before` content. All
  original selector specificities are retained. Visibility checks include
  collapsed callouts, image controls, embeds and the find bar.
- **`ec31e8d` — 28 production TS lines saved.** Register Random note,
  Bookmark all tabs, Insert template and Add file property through the
  existing `pluginAction`/`conditionalAction` factories. Delete the repeated
  plugin, icon, availability and hotkey object construction; retain their
  callbacks and conditions.
- **`f29cbce` — 11 production TS lines saved.** Express the DOM helper's
  optional string attributes with one `Partial<Record<…>>`. Keep the same
  allowed names and value types, including the restricted spellcheck and
  contenteditable values and data/ARIA/event signatures. No runtime change.

The narrowed exports, grouped by module, are:

- `api`: VaultChange; `noteEditors`: EditorEvents; `tabs`: TabMemory.
- Editor `editor`: NoteStateOptions; `host`: LinkTarget; `linkAt`: LinkAt;
  `syntax`: MarkerStyles.
- Graph `data`: GraphSource, GraphOptions; `draw`: GraphFrame; `input`:
  GraphGestures, GraphInput; `panel`: PanelHost; `view`: GraphHost.
- Settings `controls`: RowOptions, TextOptions; `exclude`: ExcludeTest;
  `plugins`: CorePlugin; `schema`: DAILY_NOTES, TEMPLATES, BACKLINK,
  NOTE_COMPOSER.
- Shell `confirm`: ConfirmOptions; `fuzzy`: FuzzyMatch; `menu`: MenuAnchor,
  MenuOptions; `menus`: MenuHost; `paletteItems`: PaletteItem; `pane`:
  PaneExtras; `suggest`: SuggestOptions.

No further CSS selector or runtime flag was proven wholly unused. Dynamic names
were checked as well as literal references: for example, quote/cite callouts
use `--color-gray` through `--color-${kind.color}`, so that token stays.
Table source offsets also stay calculated from current text; replacing them
with existing DOM offsets would risk using stale positions after cell edits.
No table, editor-update or ordinary typing work was added.

## Before/after visual check

Vite and headless Chromium, private browser profile, 1280×800, scale 1,
fresh browser storage and the in-memory mock vault. The final comparison
serves baseline source extracted from `245c6c4` inside this worktree's ignored
`rebuild/app/dist/.round19-baseline/`, then the final source, with existing
transitions allowed to settle. Captures use native CDP
pointer movement and keyboard input. The hover capture uses Ctrl+hover and
moves into the preview; find/search fields use native mouse press/release.
No DOM `.click()` calls were used by the harness.

**All five required before/after screenshots match exactly: zero differing
pixels**, measured with ImageMagick `compare -metric AE` after the final
code changes. The linked pairs are committed with these notes:

- Welcome: [before](round19-shots/before-welcome.png), [after](round19-shots/after-welcome.png).
- Callouts/tables/embeds: [before](round19-shots/before-blocks.png), [after](round19-shots/after-blocks.png).
- Search: [before](round19-shots/before-search.png), [after](round19-shots/after-search.png).
- Find bar: [before](round19-shots/before-find.png), [after](round19-shots/after-find.png).
- Hover preview: [before](round19-shots/before-hover.png), [after](round19-shots/after-hover.png).

Additional CSS checks compare original styles from `245c6c4` with the final
styles in the same fixture: Source headings with emphasis, Reading view,
dark Reading view (including a cite callout and code block), and Settings.
All four additional screenshot pairs also have zero differing pixels.
Visible-element computed styles and geometry agree, apart from tiny sampling
differences during the sidebar button's existing hover-opacity transition.
Harnesses, style snapshots and supplemental captures remain ignored under
`rebuild/app/node_modules/.round19/` (`capture.mjs`, `style-check.mjs`).
No visible application window or Tauri app was launched. No owner's vault
was read or modified. WebKitGTK was not exercised.

## Verification

Final required gates passed:

- `npm run build`.
- `npm test`: **198 tests in 38 files**, unchanged test count.
- `npm run audit:offline`: source, release output, CSP, capabilities and
  dependency audit passed.
- `cargo build` and `cargo test`: **32 Rust tests** passed.
- `git diff --check`.

`node scripts/test-round18.mjs` passed all **43 native-input browser
assertions**, covering find/replace, tag clicks and drags, Search/Backlinks
selection, hover placement/lifetime/section scrolling, embed source clicks,
task toggling, embedded links and Reading heading styles. One attempt while
Cargo was doing its cold build reached the harness's fixed startup timeout
before `window.ws` existed; a later complete run passed, and no application
startup behavior was changed. No speedup is claimed; no new per-keystroke work or
new dependency was introduced.

## Net tracked app lines

The task's newline-count convention, under `rebuild/app`, excluding `/gen/`:

- Production TypeScript: **19,121 → 19,054 (−67)**.
- TypeScript tests: **2,742 → 2,749 (+7)**, from moving the test helper.
- TypeScript total: **21,863 → 21,803 (−60)**.
- CSS: **3,698 → 3,659 (−39)**.
- Rust: **3,104 → 3,104 (0)**.
- TS/CSS/Rust total: **28,665 → 28,566 (−99)**.
- JavaScript (`.mjs`, counted separately): **530 → 530 (0)**.
- Production TS plus CSS: **22,819 → 22,713 (−106)**.

The largest production file remains `src/shell/pane.ts` at **649 lines**;
no source file approaches 800 lines. These counts exclude this notes file
and screenshot artifacts. Part B is untouched. Stop here and await Part B.
