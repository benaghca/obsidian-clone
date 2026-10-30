# Bases B0 — stop rebuilding on every keystroke

Branch `rebuild/bases-b0-grok`, commit `4c6eb51` on `1b17cbf`. Local only. Not pushed.

An open base no longer rebuilds its rows on each keystroke. A `doc` change waits 300 ms of quiet. A hidden base tab waits until it is shown. A change to a note outside the base's folder or tag pre-filter is skipped when that is decidable.

## What changed

| File | Lines |
|---|---|
| `rebuild/app/src/bases/view.ts` | +188 / −3 |
| `rebuild/app/src/bases/view.test.ts` | +93 (new) |
| `rebuild/app/scripts/test-bases.mjs` | +4 / −1 |

The `ws.on` handler is a thin call to `baseChange`. The quiet-period, hidden-tab, and pre-filter rules are pure functions in the same file (`baseChange`, `baseNeeds`, `missesPrefilter`, `docsOutsideFilter`) so a node test can prove coalescing. Vitest has no DOM library. `update`, paint, the menus, `model.ts`, and `expression.ts` are unchanged. `dispose` still clears the same timer.

`test-bases.mjs` is outside the owned handler. The old check read `Fresh.md` after the count became `1 results` and required the file to still be unsaved. The note save delay is also 300 ms and is armed first, so that check would fail on every run. The unsaved read now happens immediately after the keystroke. The 2 s wait that the count becomes 1 is unchanged.

## Decisions

- `doc` waits `DOC_QUIET_MS` (300), the same quiet period as `noteEditors` `SAVE_DELAY`. `files` and `links` stay at 20 ms, as do focus-out and a change to the `.base` file itself.
- Hidden means the view element is not connected, or this tab is not `group.active`. A base that is visible in an unfocused split still updates after 300 ms. It does not defer. `show`, `pane`, and `tabs` reveal a deferred base, which then rebuilds after 20 ms.
- A skip is allowed only when every changed open note fails a required `file.inFolder` or (when the row is not already on screen) a required `file.hasTag`. Requirements come from an `and` list, or from top-level `&&` in a string filter, with quotes and parentheses left intact. `or` and `not` add no requirement. Any other clause (`status != "done"`, `contains`, `hasLink`) does not cancel a sibling folder or tag requirement, and it does not become one.
- A folder miss always skips. Typing cannot move the file. `file.inFolder` uses `isUnder(parentDir(path), folder)`, the same parent folder `expression.ts` already uses. `Perf.md` at the vault root is not in `Perf`.
- A missing required tag skips only when that note is not a visible row. Adding the tag, or removing it from a row on screen, still rebuilds. If the note text is not loaded, the tag check is not decidable. A folder miss still skips.
- Empty source, a YAML throw, or no folder/tag requirement does not skip. A base that cannot be parsed still shows "Unable to open base".
- An outside edit does not cancel a rebuild that is already waiting. A hidden base cancels the waiting rebuild and sets a deferred flag.

## What this relied on

This is Grove's recompute timing, not an Obsidian gesture. `file.inFolder` and `file.hasTag` keep the meaning already in Grove's expression evaluator. `BASES_PLAN.md` §10 attributes that syntax to Obsidian's public Bases help ("Bases syntax"), from prior knowledge. No page was fetched. No Obsidian code or assets were used.

## Checks

- `npm run build` passed. Vite still warns that one chunk is over 1000 kB.
- `flock /tmp/grove-npm-test.lock npm test` passed on the first run (exit 0). Vitest: 59 files, 676 tests, including the 3 new tests in `view.test.ts`. No flake retry. The browser script still reports 0 results on the keystroke and 50 ms later, the file is still `# Fresh\n` at the keystroke, then the count becomes 1. The 1000-row scroll max frame was 16.8 ms. Configure view max frame was 16.8 ms.
- `npm run audit:offline` passed: 166 source files. The registry was not contacted.
- From `rebuild/app/src-tauri`, `flock /tmp/grove-npm-test.lock` then `cargo build --offline` and `cargo test --offline`: 58 passed, 0 failed, 2 ignored. The registry was not contacted.

Screenshot fixtures under `rebuild/round*-shots/` were restored before the commit and are not in it.

## Left open

The pre-filter does not understand formula results or property comparisons, so those edits still wait 300 ms and rebuild. A `doc` event whose note is not an open loaded editor is not classified, and it also waits 300 ms.

Export CSV is the next task, on `rebuild/bases-b3-grok` from this commit. The B3 fuzz of B1 is not part of this commit.
