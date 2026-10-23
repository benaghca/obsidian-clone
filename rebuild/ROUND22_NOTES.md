# Round 22 — Part A cleanup

Branch `rebuild/r22-codex`; baseline `8cd63a8`. Part A only. All commits
are local; nothing pushed or merged. No Part B changes were made.

Production TypeScript and CSS are **108 lines smaller**; browser scripts
are **100 lines smaller**. This falls short of the 300-line production
cut aim. The existing prompt, paste, table-cell paste and hover-rendering
paths already share their implementations. Their remaining differences
carry selection, source-position, modifier and lifecycle behavior; no new
abstraction or formatting-only compression was introduced to reach a count.

## Cuts and reasons

- **`f1ed431` — 86 production TS lines and 1 CSS line saved.** Delete the
  unreachable animated-scroll branch, its cubic-bezier solver, cancellation
  machinery and frame helper. Keep the existing immediate CodeMirror
  `scrollIntoView` operation. `rg` across app source/public found no
  `--anim-duration-slow` definition or writer: `duration("slow")` always
  parsed the absent value as zero, so the early return always won. The only
  `smoothScrollTo`/`nextFrame` consumers were in that unreachable branch;
  the only `glide` caller discards its return. Narrow the duration type and
  remove `--anim-scale-from`, which had a declaration but no reference,
  including in public boot code. Other motion tokens and animations stay.
- **`4208d54` — 10 production TS lines saved.** Use the existing
  `dragPointer` driver for tabs, as explorer dragging already does. Delete
  the duplicate animation-frame scheduling and pointer up/cancel listeners;
  retain tab threshold, activation, measurement, ghost, drop-zone rendering
  and Escape handling. The native-input header suite passes background-tab
  activation/reordering/split drops and stationary repeated clicks.
- **`436a6c3` — 100 mjs lines saved.** Move the round 18/19 scripts onto
  `scripts/browser.mjs`, the helper already used by the permanent suites.
  Delete their duplicate Vite/Chromium launch, socket, evaluation, key,
  pointer and shutdown code. Add optional height/screenshot output to the
  existing helper. Preserve both suites' checks and screenshots, plus their
  extra click/fill settling waits. Fresh private profiles replace their
  fixed profiles/ports and make explicit storage resets unnecessary. Both
  legacy suites pass: **43** and **29** named checks respectively; browser
  exception checks remain in the shared helper.
- **`174ba20` — 11 CSS lines saved.** Share the existing label-clipping
  declarations in `base.css`, keeping every original selector and its
  specificity. Leave wrapping policies and more-specific search/editing
  overrides at their call sites. Remove the readable-column width already
  supplied by `.markdown-sizer`, the inactive-tab hover radius already
  supplied by `.workspace-tab-header-inner`, and preview scrolling already
  supplied by `.markdown-embed-content`. Also remove the default flex
  `justify-content: flex-start` and `flex: 0 1 auto` declarations. Visual
  and computed-style comparisons below cover these changes.

The dead-code/reference scan also checked literal and dynamic CSS classes,
export consumers, icon names and theme tokens. Dynamic heading/code classes
and callout colour tokens remain; for example `--color-gray` is reached via
`--color-${kind.color}`. No additional selector was proven wholly unused.
The breadcrumb already rebuilds only when its path changes; paste conversion
already serves native and async paste, including the nested cell editor;
previews already render through `NoteEmbedWidget`. Those paths stay intact.

## Before/after visual verification

Vite + headless Chromium, fresh private profiles, the in-memory mock vault,
1280×800, device scale 1. Fixture setup uses the mock API; interactions use
native CDP mouse/key input, with pointer movement before presses. No harness
DOM `.click()` calls. Screens cover light and dark themes, with frontmatter
on the block/breadcrumb fixtures. Capture assertions verify that Settings,
the switcher, the hover preview and the active drag actually exist.

The final comparison runs the original `8cd63a8` files and then the final
files at the same app root. Original files were temporarily loaded only in
this worktree, with final bytes restored in a `finally` block before the
second run. An earlier attempt to serve the baseline inside `node_modules`
was discarded: Vite treated source imports differently there, so its mock
API instance did not match the workspace. Only the final captures below
are retained.

**All 18 intended screens visually match.** Seventeen pairs are pixel
identical. Light Welcome has four differing RGBA pixels at the tab edge
(x=436, y=13–16), maximum channel difference 6/255; the rest of that screen
is identical. Every pair has identical captured element rectangles and
computed typography, colour, spacing, border, display, overflow and opacity.
This comparison does not claim identical animation-frame timing.

Committed pairs (each directory also contains the dark-theme captures):

- Welcome: [before](round22-shots/before/light-welcome.png), [after](round22-shots/after/light-welcome.png).
- Callouts/tables/embeds, Live Preview: [before](round22-shots/before/light-blocks-live.png), [after](round22-shots/after/light-blocks-live.png).
- Blocks, Source: [before](round22-shots/before/light-blocks-source.png), [after](round22-shots/after/light-blocks-source.png).
- Blocks, Reading: [before](round22-shots/before/light-blocks-reading.png), [after](round22-shots/after/light-blocks-reading.png).
- Active explorer drag: [before](round22-shots/before/light-drag.png), [after](round22-shots/after/light-drag.png).
- Long breadcrumb: [before](round22-shots/before/light-breadcrumb.png), [after](round22-shots/after/light-breadcrumb.png).
- Settings: [before](round22-shots/before/light-settings.png), [after](round22-shots/after/light-settings.png).
- Quick switcher: [before](round22-shots/before/light-switcher.png), [after](round22-shots/after/light-switcher.png).
- Hover preview: [before](round22-shots/before/light-hover.png), [after](round22-shots/after/light-hover.png).

Per-screen raw pixel results: [comparison.txt](round22-shots/comparison.txt).

## Required verification

- `npm run build`: passed.
- `npm test`: passed on the final code: **4** browser-discovery tests,
  **231** TypeScript tests in **41** files, and **560** named browser checks.
- Both migrated legacy scripts also pass separately, retaining **72** named
  checks beyond the scripts currently wired into `npm test`.
- Permanent geometry suite: every rendered line within **1px** of its
  CodeMirror top, zero direct-child vertical margins, stationary fold/unfold
  arrows still visible, plain/frontmatter notes in all three modes.
- Ctrl+O, Ctrl+P and right-click menus open within two frames, with no
  sampled opening frame over **20ms**. No prompt/menu animation was added.
- `npm run audit:offline`: passed, including release build, **130** source
  files, release output, CSP, capabilities and dependencies.
- `cargo build` and `cargo test`: passed; **32** Rust tests.
- `git diff --check`: passed. Largest tracked app source remains
  `src/shell/pane.ts`, **664** lines; `settings.css` is now **602**.

No dependency, permission, backend command, network operation, editor
transaction listener or ordinary typing-path work was added. Big-note and
40-row-table typing paths are unchanged; no measured speedup is claimed.
Obsidian and Tauri were not launched. No visible app window or owner's real
vault was opened or modified.

## Tracked app line counts

Newline counts under `rebuild/app`, tracked files only, excluding `/gen/`,
as in the brief. Compare `8cd63a8` with the completed cleanup:

- Production TypeScript: **19,651 → 19,555 (−96)**.
- Test TypeScript: **3,054 → 3,054 (0)**.
- TypeScript total: **22,705 → 22,609 (−96)**.
- CSS: **3,733 → 3,721 (−12)**.
- Rust: **3,104 → 3,104 (0)**.
- TS/CSS/Rust total: **29,542 → 29,434 (−108)**.
- mjs scripts/tools: **1,928 → 1,828 (−100)**.
- Net across these languages: **−208** lines. Production TS/CSS: **−108**.

Notes and PNG evidence are outside these app-source counts. The supplied
`.r22-codex-task.md` remains untracked. Part A complete; stop here. Part B
requires its separate message.

# Part B — three small fixes

Baseline: completed Part A, `e576f87`. The user's separate Part B request
supersedes the earlier Part-A-only stop instruction. Same worktree and
branch; all changes committed locally, nothing pushed or merged.

## Obsidian observation first

Observed installed **Obsidian 1.14.4** (`pacman`: `1.14.4-2`) before editing
production code. Electron used headless Ozone, an explicit private profile,
private HOME/XDG directories and a newly created scratch vault under ignored
`rebuild/app/node_modules/.round22b/reference`. DISPLAY and WAYLAND_DISPLAY
were empty. The whole driver and app ran inside `unshare -Urn`, with only
loopback enabled and no external route. Attempted reference-app requests
failed with `ERR_INTERNET_DISCONNECTED`. No owner's vault or visible desktop
window was opened. Tauri was not launched.

The scratch vault contained frontmatter, Alpha/Zulu/Test notes, a note under
Projects, PNG/SVG attachments, and two unresolved targets. Public workspace
APIs prepared/opened fixture notes; CDP native text/key/mouse input opened
suggestions, hovered and pressed controls, and pasted Electron clipboard HTML.
Only rendered UI, computed measurements and public editor APIs were inspected;
no Obsidian implementation, CSS or assets were reused.

Observed:

- `[[` offers PNG/SVG attachments and unresolved names, including
  `Projects/Uncreated`. A note named Plan has **Projects/** underneath it;
  this is the folder-detail label, not a selectable folder entry. The
  reference popup measured about **425px** wide, and its heading/block/alias
  hints fit on one line.
- The fresh reference vault placed newly created attachments before the
  opened notes. Its public recent-file history also differed from the
  visible list. Grove follows the explicit requested recently-*opened*
  ordering, using the same `ws.recent` list as the quick switcher; it does
  not manufacture recency from file creation time.
- Ribbon tooltips sit beside the button; header tooltips sit below it,
  with an arrow. Measured text was **13px**, padding **8px 12px**, radius
  **12px**, light text on a black background at about 90% opacity. Native
  title attributes were absent. Warm hovers can appear sooner than the
  first hover; Grove uses a simple fixed **500ms** delay and no animation.
- A Word paragraph whose number exists only in an `mso-list:Ignore` span
  pasted as numbered text: `1.` then First, a blank line, then `2.` and
  Second. Obsidian retained two nonbreaking spaces after each marker;
  Grove keeps its existing normalized whitespace and writes one space.
- Pasting a labelled HTML anchor produced exactly
  `[docs](https://example.com/a\(b\))`.
- The reference duplicated the number when that Word span was inside a
  real `<ol><li>` wrapper (`1. 1.One`). Grove preserves its existing single
  structural list marker instead; a regression prevents double numbering.

Reference/Grove captures:

- Link suggester: [Obsidian](round22-shots/partb/obsidian-link-suggester.png), [Grove](round22-shots/partb/grove-link-suggester.png).
- Ribbon tooltip: [Obsidian](round22-shots/partb/obsidian-ribbon-tooltip.png), [Grove](round22-shots/partb/grove-ribbon-tooltip.png).
- Header tooltip: [Obsidian](round22-shots/partb/obsidian-header-tooltip.png), [Grove](round22-shots/partb/grove-header-tooltip.png).

## Commits and implementation

- **`eb04e1f` — link suggester (#18).** Supply completion candidates through
  the existing editor host: included vault files, deduplicated unresolved
  targets, and the existing workspace recents first. Keep CodeMirror's
  cached query filtering and matching; use its existing sort key to retain
  recent order on ties. Show attachment extensions and trailing slashes in
  folder details. Reuse `formatLink` for insertion and include all files in
  its existing ambiguity check, so two attachments named photo.png produce
  the intended qualified path. Widen the popup to at most 520px, keep the
  full footer on one line, and remove its entrance animation and the now
  unused popover keyframe/token. Reading never supplies completions.
  Adds native browser checks and an attachment-ambiguity unit test.
  Production TS **+17**, test TS **+8**, CSS **−11**, mjs **+63**.
- **`653e755` — styled tooltips (#15).** One delegated hover helper in
  `shell/dom.ts`, driven by current ARIA labels. It places a delayed tooltip
  beside ribbon controls or below other controls, flips above at the bottom
  edge, clamps to the viewport and draws an arrow. Pointer press, keyboard
  input, leaving, scrolling, blur or resize dismiss it. Dismissal listeners
  exist only during an active/pending hover; ordinary typing installs none.
  Remove covered native titles from shared icon buttons, header/status
  controls, tab links, embeds and the styled find toolbar. No entry/exit
  animation or transition. Native tests cover delay, label, title removal,
  positioning, arrow, motion, dismissal and stationary repeated clicks.
  Production TS **+42**, CSS **+36**, mjs **+46**.
- **`e2b2664` — paste parity.** Retain standalone Word numbers, including an
  orphan list item; skip redundant markers only when a real list wrapper
  supplies them. Backslash-escape destination parentheses, preserving space
  encoding and already percent-encoded parentheses. Extend the existing
  link-command module with one small destination unescaper shared by the
  renderer, so displayed links, remote-image chips and link commands use
  actual URLs. Image source-selection offsets still refer to original
  Markdown. Reuse the existing clipboard handler, settings, protection and
  undo behavior. Add seven converter cases, a link-command unit test, native
  paste/caret/undo checks and a native Reading click on an escaped local
  destination. Production TS **+9**, test TS **+14**, mjs **+54**.

No dependency, backend command, permission, network API, or document-wide
editor scan was added. Candidate construction runs when completion opens;
CodeMirror's existing `validFor` cache handles query refinement. The ordinary
editor transaction pipeline is unchanged. URL unescaping is confined to the
existing link paths, and rich conversion still runs only on paste.

## Final verification

All required gates pass on the final code:

- `npm run build`.
- `npm test`: **4** browser-discovery tests, **233** TypeScript unit tests in
  **41** files, and **640** named browser checks. This includes **53** real
  DOMParser converter cases and **73** round-22 native browser checks.
- The new native checks use frontmatter notes in Live Preview, Source and
  Reading. They establish recency through explorer clicks, choose suggestions
  with real input, and repeat clicks at stationary coordinates. Ribbon,
  explorer toolbar and header interactions run in all three modes; the
  existing find toolbar is also checked while editing. Reading
  rejects completion insertion and both new paste fixtures. Paste retains
  one-step undo and the caret after the full insertion.
- The permanent geometry suite passes: every rendered line stays within
  **1px** of CodeMirror's top, direct content children have zero vertical
  margins, and fold arrows remain visible through stationary fold/unfold.
- Ctrl+O, Ctrl+P and right-click menus appear within two frames. The largest
  sampled opening frame was **17.0ms**, below the **20ms** bound.
- `npm run audit:offline`: release build, **130** source files, release
  output, CSP, capabilities and dependencies all pass.
- `cargo build` and `cargo test`: pass; **32** Rust tests. Rust is unchanged.
- `git diff --check`: passes. Largest app source is **663** lines.

A small native-input typing sample compares Part A with Part B in the same
headless setup: a frontmatter copy of the 5,000-line Big note and a 40-row
table's nested cell editor. After five warmup characters, each has 30 samples
measuring `beforeinput` to the next animation frame. Big-note p95 was
**16.2 → 15.5ms**; table p95 **16.7 → 16.9ms**, with maximum table latency
**17.2ms** in both runs. No meaningful slowdown was observed in this sample;
these are frame timings, not a CPU-only parser benchmark. Baseline files
were temporarily loaded in this worktree and final bytes restored in a
`finally` block. Raw samples' summaries:
[before](round22-shots/partb/typing-before.json), [after](round22-shots/partb/typing-after.json).

## Final tracked app line counts

Same newline convention and `/gen/` exclusion as Part A; compare `e576f87`:

- Production TypeScript: **19,555 → 19,623 (+68)**.
- Test TypeScript: **3,054 → 3,076 (+22)**.
- TypeScript total: **22,609 → 22,699 (+90)**.
- CSS: **3,721 → 3,746 (+25)**.
- Rust: **3,104 → 3,104 (0)**.
- TS/CSS/Rust total: **29,434 → 29,549 (+115)**.
- mjs scripts/tools: **1,828 → 1,991 (+163)**.
- Part B across these languages: **+278**; production TS/CSS **+93**.

Across the whole round from `8cd63a8`: production TS **−28**, test TS
**+22**, CSS **+13**, Rust **0**, mjs **+63**. Production TS/CSS remains
**15 lines smaller**; TS/CSS/Rust is **7 lines larger**, and the total
including mjs is **+70**. JSON source line count is unchanged; only the test
command changed. Notes and screenshot/timing evidence are outside these
app-source counts.

## Up to three next improvements

1. **Clipboard attachments — medium.** Actually save pasted image/file bytes
   into the vault instead of falling through to text. Requires the held
   backend byte-write operation, attachment naming and existing path/offline
   guards; it removes a common manual import step.
2. **Escaped Markdown targets in indexes/renames — small to medium.** The
   renderer and link commands now decode destination escapes, but source
   review shows the existing Rust index and mock/rename parsers do not fully
   handle them. Extend those existing parsers with regressions so internal
   links such as `[local](Projects/a\(b\).md)` also remain correct in graph
   indexing and rename updates. External pasted URLs and native navigation
   are covered by this round; this parser limit remains.
3. **Whole-document replacements with identical frontmatter — small.** During
   fixture setup, replacing the entire document while retaining identical
   YAML exposed the existing Properties decoration mapping across the whole
   replacement, hiding the body. Rebuild that decoration when its covered
   range is replaced; add a Select All/paste regression. This improves bulk
   edits independently of the rich-paste converter. The round-22 fixtures
   replace only the body to keep their tested frontmatter intact.

The three requested fixes are complete. All commits are local; nothing was
pushed or merged. The supplied `.r22-codex-task.md` remains untracked. Stop
here.
