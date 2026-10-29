# Step S1L: Unify Fence Rules (Rule A) & Skip Inline Code in Link Reading (`NOTES_S1L.md`)

## What Changed
1. **TypeScript `wikilinkTargets` (`rebuild/app/src/shell/linksTags.ts`)**:
   - Deleted the naive `FENCE = /^[ \t]*(```|~~~)/` toggle and reused the existing `Fences` class (CommonMark Rule A: opens with 0–3 spaces and 3+ matching markers, no backtick in a backtick fence's info string; closes with the same marker of at least the opening length, indented at most 3 spaces, with nothing after).
   - Added `withoutInlineCode(line)` to blank CommonMark inline code spans of any backtick run length (`line.split(/(`+)/)` pairing exact backtick-run lengths) before matching `WIKILINK`.
   - Did not touch `tagsInText`, `tagsInLine`, or any tag-reading code.
2. **Rust `fence_open` and `fence_close` (`rebuild/app/src-tauri/src/index/parse.rs`)**:
   - Changed `fence_open` to strip leading `' '` (`line.trim_start_matches(' ')`) instead of `trim_start()`, so tab-indented lines do not open a fence (matching Rule A).
   - Changed `fence_close` to strip leading `' '` (`line.trim_start_matches(' ')`) and reject lines with `> 3` leading spaces before checking `trimmed.trim_end()`, so a closing fence indented 4+ spaces does not close the block (matching Rule A).
3. **Browser mock `linkIndex` (`rebuild/app/src/mock/backend.ts`)**:
   - Kept the change small and strictly local inside `linkIndex()` (no new top-level imports, so it will not conflict with parallel edits in `backend.ts`): tracks fences with Rule A and blanks CommonMark inline code spans before scanning `WIKILINK` and `MDLINK` on each line while preserving the original `text` for backlink snippets.
4. **Parity Corpus (`rebuild/app/fixtures/parity/links.json`)**:
   - Updated `expected` values and removed stale `"rust": "todo"` markers for the 10 fence and inline-code cases now unified under Rule A + CommonMark code spans (`the other marker closes a fence (TS)`, `a shorter fence closes a longer one (TS)`, `fence indented with a tab`, `fence indented 4 spaces`, `closing fence indented 4 spaces`, `closing fence with text after it`, `a backtick in a backtick fence's info string`, `inline code`, `double-backtick inline code`, and `an embed inside inline code`).
   - Preserved all `obsidian` and `note` fields as requested.
5. **Unit Tests (`rebuild/app/src/shell/linksTags.test.ts`)**:
   - Added `"wikilink targets follow CommonMark fence rules and skip inline code"` covering single/double-backtick inline code, unclosed backticks, mismatched/shorter fences, tab and 4-space indented fences, backticks in info strings, and 4-space/trailing-text closing fences.

## Files & Line Counts
- `rebuild/app/src/shell/linksTags.ts`: +18 / -10 lines
- `rebuild/app/src/shell/linksTags.test.ts`: +34 / -0 lines
- `rebuild/app/src/mock/backend.ts`: +24 / -2 lines
- `rebuild/app/src-tauri/src/index/parse.rs`: +6 / -3 lines
- `rebuild/app/fixtures/parity/links.json`: +10 / -16 lines
- **Total**: 5 files changed, 92 insertions(+), 31 deletions(-)

## Test Results
- `cargo build` & `cargo test` (`rebuild/app/src-tauri`): Passed (42 passed, 1 ignored bench; including `index::parity::corpus` and `index::parity::todo_markers_are_checked`).
- `npm run build` (`rebuild/app`): Passed (`tsc --noEmit && vite build`).
- `npm run audit:offline` (`rebuild/app`): Passed (164 source files, `dist/`, CSP, capabilities, and dependencies checked).
- `flock /tmp/grove-npm-test.lock npm test` (`rebuild/app`):
  - Full suite (55 vitest files / 433 tests + all browser, geometry, fixes, header, drag, round scripts, and `posttest` `test-bases-config.mjs`) passed.
  - Note on flaky timing tests during parallel agent load: when other agents were compiling Rust in parallel on the machine, `unlinked.test.ts` (<300ms CPU guard) and `test-canvas-navigation.mjs` (300-card/400-edge zoom 20ms frame cap) tripped once; rerunning under the lock passed cleanly. Restored modified screenshot artifacts in `rebuild/round*-shots/` afterwards so the working tree stays clean.

## Anything Left / Uncertainties / Decisions for Chris
- **Remaining `"rust": "todo"` cases in `links.json` (6 cases)**:
  - `^ without #` (`[[C^abc]]`)
  - `a [ inside the target` (`[[a[b]]`)
  - `escaped pipe in a table cell` (`| [[Note\|alias]] | x |`)
  - `triple brackets` (`[[[Note]]]`)
  - `an escaped bracket inside the target` (`[[a\[b]]`)
  - `an escaped pipe outside a table` (`[[Note\|alias]]`)
  All 6 are target-inner syntax differences (`^`, `[`, `\|`), outside the scope of fence Rule A and inline code.
- **Note on `links.json` case names/notes**: I kept the existing `name`, `obsidian`, and `note` fields on the updated fence/inline-code cases in `links.json` (per instructions to keep `obsidian`/`note` fields). If Chris wants the historical `(TS)` suffix or historical notes trimmed now that TS and Rust both implement Rule A and skip inline code, that's a quick cosmetic cleanup in `links.json`.
