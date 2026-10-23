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
