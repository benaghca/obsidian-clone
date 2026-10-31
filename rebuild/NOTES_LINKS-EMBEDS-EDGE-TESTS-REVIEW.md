# LINKS-EMBEDS-EDGE-TESTS-REVIEW

Branch `rebuild/links-embeds-edge-review-grok` from `5cd0b30` (`rebuild/links-embeds-edge-tests-grok`, based on `b5cffcb`). Integration `93dbb79` is merged in `98636eb`. Nothing was pushed. No Obsidian docs, code, or assets were used. The tests were checked against Grove's link, embed, callout, table, tag, and daily-note code.

## Verdict

The two scripts test the behaviour the source notes describe. Two assertions that did not observe what the notes claimed are now real. The three recorded bugs are real. A few more product bugs showed up on the same paths and were left unfixed. `src/` on the test branch is untouched. Ceilings stay at 50 ms.

VERDICT: OK

## What the review changed

| Commit | File | Lines |
| --- | --- | --- |
| `398cc61` | `rebuild/app/scripts/test-links-embeds-edge.mjs` | +3 / −2 |
| `398cc61` | `rebuild/app/scripts/test-links-embeds-edge-browser.mjs` | +3 / −1 |
| `1e70e5c` | `rebuild/app/package.json` `test` | +1 / −1 |
| `98636eb` | merge of `rebuild/integration` (`93dbb79`) | bases edge tests and notes |

The scripts are 451 and 359 lines. `links-embeds-edge-cm.ts` is unchanged at 5 lines. There is no new vitest file and no new Rust test on the links branch, so nothing of that kind was run three times. The merge brought `src/bases/edge.test.ts`, which ran once inside `vitest run`.

## Checks on the submitted tests

`5cd0b30` adds only the two scripts, the CodeMirror re-export, and the source notes. No `src/` edit, no dependency, and no raised ceiling. The frame cap is `max <= 50` with no long task over 50 ms, the same hitch bar the other edge scripts use. The first two `requestAnimationFrame` gaps are dropped, which is what the canvas and Bases scripts do. Node timings are printed and not asserted.

The sleeps match the older browser scripts. `wait` polls every 25 ms and fails if the DOM never arrives. `click` moves, pauses 40 ms, and pauses 50 ms after the buttons. A 40 ms pause follows `scrollIntoView` before a coordinate click. Typing waits 30 ms between keys in the Node process, so the page's frame clock is not frozen, then 120 ms before the sample is read. None of those pauses is the assertion. The doc, the embed text, the search box, and the daily-note paths are checked after the wait.

Fuzz seed `20261031` is fixed. Four runs rewrote the same 804 links across 400 notes, with fence bodies and inline code unchanged and a second pass of 0. The table, tag, callout, date, and resolver fuzz counts matched the notes. The embed fuzz is only a smoke check: a hit must have a line in range and a string body, and `embedStopped` must return a boolean. An `embedSection` that always returned null would still pass that loop. The explicit section checks above it would not, and the notes do not claim a stronger embed property.

Two checks did not match the notes.

- The block-ref click accepted any cursor within about 28 characters before `Section body`, which includes the `## Second` line above it. It now requires the cursor line to start with `Section body`.
- The tags pane asserted that `#zzledge-code` was absent, and the fixture never contained that tag. `ZzledgeTarget.md` now has `` `#zzledge-code` ``, and the test fails if that fixture disappears. The fenced `#zzledge-no` was already real.

`check(true)` after the tag-click wait and after the frame budget only counts a pass. The wait and the `max <= 50` assert already fail the run.

The three `BUG` lines are not expected failures. Each one asserts today's behaviour and exits 0, so fixing the product fails the suite until the assertion moves. There is no skipped test.

## The three recorded bugs

Confirmed, not fixed.

1. `embed-first-line-block`. On `^zzbid\n\npara\n`, `embedSection` returns null (`if (!at) return null` in `embedSection`) and `headingPos` returns 0, the id line. `wikilinkComplete.test.ts` already pins the same pair for a one-line `^target` as "an orphan standalone ID cannot crash". The mismatch is real. The unit test treats it as the contract.
2. `embed-depth-off-by-one`. `embedStopped` is `chain.length >= 5`. The chain passed into a note embed is the notes already drawn. Ancestor counts 0 through 4 still render, so five nested embeds show their text and the sixth is the first chip. The file comment says five embeds deep shows as a chip. `blocks.test.ts` only asserts that a chain of five returns true.
3. `daily-date-rollover`. `dateNamePattern("YYYY-MM-DD").parse("2026-02-29")` and `parse("2026-03-01")` are the same timestamp, `1772352000000` (`Sun Mar 01 2026`). `2026-13-40` equals `new Date(2026, 12, 40)`.

## Break attempts

A throwaway Vite SSR probe, not committed, exercised the rename, embed, and date helpers.

- A link inside a single-backtick span stays `[[Old]]`. A link inside a double-backtick span is rewritten to `[[New]]`. `index/tags.rs` says inline code is a pair of single backticks, on purpose. `rewriteLinks` says code is left alone and uses the same one-backtick mask.
- A four-backtick fence closed by a three-backtick line rewrote the link that was still inside the longer fence. A line of four spaces plus ` ``` ` was treated as a fence and protected the unindented link under it. Tag scanning uses CommonMark's rule: at most three spaces, same marker, at least as long. Link rewrite compares only the marker character and allows any indent.
- `embedSection` flips a fence on any ` ``` ` or `~~~` line. Inside an open backtick fence, a tilde line made `## Real` a heading, and the real closing ` ``` ` hid `## After`, so the section included that next heading. `## Fake`, still inside the opener, stayed hidden.
- A block id on `code ^zzbid` inside a fence is taken before `para ^zzbid`. The embed text starts at the fence and still contains `para ^zzbid`. `headingPos` returns offset 4, the code line. Heading sections skip fences. Block ids do not.
- `\n^zzbid\n` embeds `{ text: "", line: 0 }` rather than null, so a leading blank line draws an empty embed instead of the missing chip.

No product code was changed.

## Wiring and the merge

The source notes' `test` line is in place. `npm test` ends with `test-links-embeds-edge.mjs` and then `test-links-embeds-edge-browser.mjs`, after `test-search-commands.mjs`. The helper is loaded by the node script.

`rebuild/integration` was `93dbb79`. One conflict, `rebuild/app/package.json`. The `test` line is this branch's. The `posttest` line is integration's: `test-bases-edge.mjs` stays after `fuzz-property-edit.mjs`. The combined lists have 60 `test` scripts and 12 `posttest` scripts, with no duplicate. No other file conflicted. The merge adds the Bases edge script, `src/bases/edge.test.ts`, and the two Bases edge notes.

## Commands and results

From `rebuild/app`, after `npm run build` (exit 0). Each new script three times under `flock /tmp/grove-npm-test.lock`, then once more inside full `npm test`. All exited 0. Node fuzz counts were identical every time: 400 rewrites, 804 links, 200 embeds, 80 tables, 100 tags, 60 callouts, 40 dates, 300 resolves. Node pass count 131. Browser pass count 49 (the notes' 48, plus the fixture check).

Node medians, in ms. `0` is under 0.01 ms. Nothing is near 50 ms.

| Run | link targets | rewrite 200 | embed section | tags 2000 | tag tree | table 100×8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.29 | 0.43 | 0.10 | 0.22 | 2.08 | 0.20 |
| 2 | 1.94 | 0.47 | 0.13 | 0.21 | 2.06 | 0.19 |
| 3 | 2.09 | 0.44 | 0.11 | 0.24 | 3.44 | 0.43 |
| npm test | 2.33 | 0.65 | 0.23 | 0.40 | 2.70 | 0.28 |

`resolveLink`, `formatDate`, and `fillTemplate` stayed at 0. The source notes' `linkTargets` median was 1.70 ms and `tagTree` was 2.87 ms. These runs sit in that range.

Browser frames, first two dropped. Long-task lists were empty. Max stayed on one 60 fps frame. The asserted cap is still 50 ms.

| Run | type max | type p95 | switch max | switch p95 | open + two frames, ms |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 16.8 | 16.7 | 16.8 | 16.8 | 26, 33, 33, 33, 33, 33 |
| 2 | 16.7 | 16.7 | 16.8 | 16.8 | 19, 33, 33, 34, 33, 33 |
| 3 | 16.8 | 16.7 | 16.7 | 16.7 | 18, 33, 33, 34, 33, 33 |
| npm test | 16.8 | 16.7 | 16.8 | 16.8 | 20, 33, 33, 34, 33, 33 |

The typed string is ` edge probe text ok` (19 characters). The source notes say 20. The text landed, and the cursor line for the block ref starts with `Section body`. The inline-code tag stayed out of the tags pane. The rename confirm said `Update 8 links in 1 file`, which is the links outside code. Today's daily note was Saturday 2026-10-31.

Full checks on `98636eb`, all exit 0. No timing flake needed a rerun.

- `npm run build` (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test`. Vitest: 74 files, 1255 tests, 444 parity. Geometry Ctrl+o stayed at 16.7–16.9 ms. The 300-card drag and pan/zoom frames stayed at 16.8 ms. K8 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 279218. Bases edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 160000. Property fuzz `cases=48`. Both new scripts passed inside this run.
- `npm run audit:offline`: 186 source files, dist, CSP, capabilities, and dependencies.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: 73 passed, 4 ignored, 0 failed. `--offline` keeps the run off the network.

`rebuild/round*-shots/` was restored with `git checkout` and is not in the commits.

## Left open

Nothing blocks the merge. Four product calls are unfixed:

- The orphan first-line block id is already the crash-guard contract in `wikilinkComplete.test.ts`. The edge notes call the same result a bug.
- "Five embeds deep" can mean the fifth nested embed chips, or a chain of five. Today the sixth chips.
- Link rewrite could follow the tag scanner's fence rule. Double-backtick spans are rewritten; the tag index leaves that limit documented.
- A block id inside a fence wins over the later paragraph, and a blank line before a standalone id embeds an empty string.

VERDICT: OK
