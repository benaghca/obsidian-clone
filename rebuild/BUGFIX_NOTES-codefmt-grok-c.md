# Code formatting rewrites

Branch `rebuild/bugfix-codefmt-grok-c` at `278f8ba`, plus the commits from this fix. Nothing was pushed.

## What was wrong

Renaming a note rewrites links in other notes through `rewriteLinks` in `rebuild/app/src/links/internal.ts` (`updateLinks` in `links/update.ts` calls it). That is the path that changed code bytes. Saving a note does not run a separate normaliser.

Two mistakes in that function:

1. Inline code was blanked with `` /`[^`\n]*`/g ``, which only pairs a single backtick with the next one. A double-backtick span was not masked as one span. `` ``[[Old]]`` `` and `` ``[[Old]] ` [[Still]]`` `` were rewritten, so the span bytes changed. The same mask is what touches `` `` a`b `` `` and `` ``x`` `` when a rename runs on that line.
2. A fence toggled on `/^\s*(`{3,}|~{3,})/` and closed on the same marker character at any indent. A three-backtick line closed a four-backtick fence, and the link still inside the longer fence was rewritten. A line of four spaces or a tab plus `` ``` `` counted as a fence, so it closed a real fence early or hid the unindented link under it.

The links/embeds review (`rebuild/NOTES_LINKS-EMBEDS-EDGE-TESTS-REVIEW.md`) recorded both. Rust indexing already followed CommonMark (`fence_open`, `fence_close`, and `blank_inline_code` in `index/parse.rs`). There is no Rust rewriter of note bytes for this path. `index/tags.rs` `without_inline_code` still blanks only single-backtick pairs, on purpose; `fixtures/parity/tags.json` expects that.

No skip, todo, or `#[ignore]` test named this bug. The `#[ignore]` tests in the tree are benches or other cases (`legacy_name_search`, property and search benches, the edit-fuzz crash child).

## What changed

`rewriteLinks` now follows the same CommonMark rule as `Fences` in `shell/linksTags.ts` and the Rust parser.

- A fence opens with 3 or more backticks or tildes and at most three spaces of indent. A backtick fence whose info string contains a backtick does not open. It closes on the same marker, at least as long, with nothing else on the line (`trim`, so a trailing CR still counts as empty). A four-space or tab-indented marker is not a fence.
- Inline code is blanked by `maskInlineCode`: a backtick run is a span only when a later run has the same length, and the blank is the same length so match indexes still refer to the original line. An unclosed run does not swallow the rest of the line. Lines with no backtick skip the walk.
- Opening and closing fence lines are left as written. A second pass is a no-op. CRLF stays, because lines are still split and joined on `\n` only. A leading BOM is not touched.

A four-space or tab `` ``` `` line is left byte for byte. The unindented link under it is rewritten, because that line is not a fence. That matches `wikilinkTargets`. An indented code block (four spaces, then a link) is still rewritten. `fixtures/parity/links.json` already records that both indexes lack an indented-code-block rule, and Obsidian skips those links. That gap is unchanged.

`stripFormatting` (Clear formatting) was left alone. It is a user command, and its existing test expects a single-backtick span `c` to become the word `c`.

| File | Lines added | Lines removed |
| --- | ---: | ---: |
| `rebuild/app/src/links/internal.ts` | 54 | 8 |
| `rebuild/app/src/links/internal.test.ts` | 96 | 0 |
| `rebuild/app/scripts/test-links-embeds-edge.mjs` | 21 | 1 |

The edge script's `scanLines` helper still tracks the simple unindented `` ``` `` and `~~~` fences the fuzz emits. The comment now says so. Simple fences still match the rewriter, and the fuzz still reports 400 notes and 804 rewritten links.

## Tests

New vitest: `renaming leaves double-backtick spans and short or deeply indented fences byte for byte` in `internal.test.ts`. It checks `` `` a`b `` ``, `` ``x`` ``, spans that contain a link and an interior backtick, a one-line `` ```[[Old]]``` `` span, a shorter closer inside a longer fence, a four-space closer, a tab closer, trailing text on a closer, a backtick in the info string, a tilde fence, CRLF, and a second pass. The existing single-backtick and simple-fence rename test still expects 4 rewrites.

New edge checks in `test-links-embeds-edge.mjs` (the suite went from 131 to 134 passing checks):

- double-backtick spans stay byte for byte
- a shorter or deeply indented fence does not end the code block
- a second pass leaves those fences and spans unchanged

No skip or `#[ignore]` was turned on. The three unrelated `bug()` records in that script stay as they were (`embed-first-line-block`, `embed-depth-off-by-one`, `daily-date-rollover`) and the script still exits 0.

## Bench

`rewrite_200` in `scripts/test-links-embeds-edge.mjs` is the bench that calls `rewriteLinks`. Those 200 lines have no backticks, so the new mask returns on `includes("`")`.

| Run | rewrite_200 median |
| --- | ---: |
| Before this change, same script | 0.58 ms |
| After, same script alone | 0.42 ms |
| After, inside full `npm test` | 0.41 ms |

The links/embeds review recorded 0.43–0.65 ms for this bench. It did not get worse. `scripts/bench-feel.mjs` also calls `rewriteLinks` (`rename_one_note`, folder move). It was not re-run; the lines it rewrites are ordinary links, and the edge bench covers the changed function.

## Checks

All from this worktree. Exit 0. No timing flake needed a rerun.

- `npm run build` in `rebuild/app` (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app`. Vitest: 80 files, 1276 tests. Geometry, drag, paste, canvas, Bases, and the links edge script passed, including posttest. Edge fuzz stayed at 400 rewrites and 804 links. `LEDGE_BENCH` `rewrite_200` was 0.41 ms.
- `npm run audit:offline`: 191 source files, dist, CSP, capabilities, and dependencies.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: 82 passed, 5 ignored, 0 failed. `--offline` keeps the run off the network.

`rebuild/round*-shots/` was restored with `git checkout` and is not in the commits.

## What this relied on

CommonMark fence and code-span rules as Grove already implements them in `Fences` (`shell/linksTags.ts`) and in `index/parse.rs`. The links/embeds review for the rename behaviour. No Obsidian source, assets, or help pages. No network, and no new crates or packages.

## Left open

Nothing blocks the fix. Two choices are unchanged on purpose:

- A link in an indented code block (four spaces, then the link) is still rewritten.
- Tag scanning still blanks only single-backtick pairs.
