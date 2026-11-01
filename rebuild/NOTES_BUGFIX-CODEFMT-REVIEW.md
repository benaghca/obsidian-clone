# Code formatting rewrite review

Branch `rebuild/bugfix-codefmt-review-grok-a` from `rebuild/bugfix-codefmt-grok-c` (`e8f600d`). That branch is `rebuild/integration` at `278f8ba` plus the fix. Integration is not newer, so nothing was merged. Nothing was pushed.

## What was reviewed

Renames go through `rewriteLinks` in `rebuild/app/src/links/internal.ts`. There is no Rust rewriter of note bytes. The Rust link index already follows CommonMark in `fence_open`, `fence_close`, and `blank_inline_code` (`index/parse.rs`). `index/tags.rs` `without_inline_code` still blanks only single-backtick pairs, and the comment there says that is on purpose. `fixtures/parity/tags.json` expects it.

The submitted fix does the two things the task asked for:

- A backtick run is masked only when a later run has the same length, so `` ``[[Old]]`` `` and `` ``[[Old]] ` [[Still]]`` `` stay byte for byte. The blank is the same length, so match indexes still refer to the original line. An unclosed run does not swallow the rest of the line. That matches `blank_inline_code`.
- A fence opens with 3 or more backticks or tildes and at most three spaces of indent. A backtick fence whose info string contains a backtick does not open. It closes on the same marker, at least as long, with only whitespace after it. A four-space or tab-indented marker is not a fence. That matches `Fences` in `shell/linksTags.ts` and the Rust link index.

`stripFormatting` was left alone. It is the Clear formatting command, and `format.test.ts` expects a single-backtick span `c` to become the word `c`.

A link in an indented code block (four spaces, then the link) is still rewritten. `wikilinkTargets` and the Rust index both still see that link. `fixtures/parity/links.json` records that Obsidian skips it. That gap is unchanged, on purpose.

The line counts in `rebuild/BUGFIX_NOTES-codefmt-grok-c.md` match `git diff --numstat 278f8ba d53b0ff`: `internal.ts` +54/−8, `internal.test.ts` +96, `test-links-embeds-edge.mjs` +21/−1.

There was no skipped, todo, or `#[ignore]` test for this bug. The new vitest and the three new edge checks are ordinary passing tests. The three `bug()` records in the edge script stay as they were (`embed-first-line-block`, `embed-depth-off-by-one`, `daily-date-rollover`) and the script still exits 0.

The fuzz helper `scanLines` still tracks unindented `` ``` `` and `~~~` only. The comment says so, and the fuzz only emits those. It still reports 400 notes and 804 rewritten links.

## What this review changed

The new fence pattern is `/^ {0,3}(`{3,}|~{3,})(.*)$/`. JavaScript's `.` does not match `\r`, so a CRLF fence line never matched. `trim` never saw the carriage return. The notes said a trailing CR still counts as empty. That claim does not hold. The previous pattern `/^\s*(`{3,}|~{3,})/` did match those lines, so links inside a CRLF code fence were rewritten after this fix. `tagsInText` already drops one trailing CR before `Fences.step`. Rust `str::lines` and `note_tags` drop it too.

`rewriteLinks` now drops one trailing CR before the fence pattern and the inline-code mask, and writes that CR back when the line changes. `wikilinkTargets` had the same hole: it feeds `Fences` the raw split line. It now drops the trailing CR the way `tagsInText` does. The parity corpus has no CRLF fence case. A new unit test covers it, and the 444 parity tests still pass.

The edge script's second-pass check said it covered spans and fences. It only rewrote the fence sample. It now rewrites both, and it checks a CRLF fence.

| File | Lines added | Lines removed |
| --- | ---: | ---: |
| `rebuild/app/src/links/internal.ts` | 5 | 2 |
| `rebuild/app/src/links/internal.test.ts` | 58 | 0 |
| `rebuild/app/src/shell/linksTags.ts` | 3 | 1 |
| `rebuild/app/src/shell/linksTags.test.ts` | 5 | 0 |
| `rebuild/app/scripts/test-links-embeds-edge.mjs` | 5 | 1 |

Commit `4c8349e`. Shots under `rebuild/round*-shots/` were restored and are not in the commit.

## Bench

`rewrite_200` calls `rewriteLinks` on 200 lines with no backticks, so the mask returns on `includes("`")`. The trailing-CR check is one `replace` per line.

| Run | rewrite_200 median |
| --- | ---: |
| Links/embeds review, inside `npm test` | 0.65 ms |
| Bugfix notes, inside `npm test` | 0.41 ms |
| This review, the edge script alone | 0.45 ms |
| This review, inside `npm test` | 0.42 ms |

It did not get worse. In the same `npm test`: `link_targets` 2.12 ms, `tag_tree` 2.94 ms. Geometry passed. The 300-card pan and zoom frames stayed at 16.8 ms, with 0 compositor drops. K8 10k scroll: p95 16.8 ms, max 16.8 ms, scrollTop 279218. Bases edge 10k scroll: p95 16.7 ms, max 16.7 ms, scrollTop 160000. Property fuzz `cases=48`. No timing flake needed a rerun.

## Checks

All from this worktree. Exit 0.

- `npm run build` in `rebuild/app` (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app`. Vitest: 80 files, 1278 tests. The edge script printed `135 PASS`. Fuzz stayed at 400 rewrites and 804 links. `LEDGE_BENCH` `rewrite_200` was 0.42 ms. Posttest passed.
- `npm run audit:offline`: 191 source files, dist, CSP, capabilities, and dependencies.
- `cargo test --offline` and `cargo build --offline` in `rebuild/app/src-tauri`: 82 passed, 5 ignored, 0 failed.

## Left open

Nothing blocks the fix. These are unchanged on purpose, or they were already split before this bug:

- A link in an indented code block is still rewritten. Both indexes still see it.
- Tag scanning still blanks only single-backtick pairs.
- `mock/backend.ts` scans links with the same fence pattern and does not drop a trailing CR, so a CRLF fence is still a link in the in-memory stand-in. The rename path does not use that scan.
- A line that contains U+2028 or U+2029 does not match the fence pattern, which is what `Fences` and `tags.rs` do, because `.` stops at those characters. `parse.rs` `fence_open` does not reject them.
- A leading BOM is left in place. `parse_note` strips one leading BOM before it reads fences. `Fences` does not.

VERDICT: OK — double-backtick spans and CommonMark fences stay byte for byte on rename, CRLF fences included, and the full checks passed.
