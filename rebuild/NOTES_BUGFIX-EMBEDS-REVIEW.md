# Review: block ids and embed depth

Branch `rebuild/bugfix-embeds-review-grok-b`, from `rebuild/bugfix-embeds-grok-a` (`4e41786`). `rebuild/integration` is still `278f8ba`, the base of that branch, so there was nothing newer to merge. Local commits only. Nothing pushed.

Reviewed `8ac9d27` and `rebuild/BUGFIX_NOTES-embeds-grok-a.md` against the code, the call sites, and the links/embeds edge script on `rebuild/integration`.

## The four bugs

Block sections live in TypeScript. `embedSection` / `embedPart` decide what an embed draws. `headingPos` decides where a `#^id` link lands. The Rust index resolves `Target#^nope` to the note file (`index/search_props_edge.rs`) and does not slice a block. There is no second copy of the depth check. Leaving Rust alone matches that.

1. **First line.** On integration, a standalone `^id` at line 0 hit `if (!at) return null`, so the embed took the missing path (`shown === null` draws “Unable to find”). `headingPos` already returned 0. The fix returns `{ text: "", line: 0 }`. `embedPart` adds the frontmatter offset, so a body that is only `^abc` after frontmatter is line 3 of the file. An empty string is painted as an embed, so it is distinct from the missing chip. Navigation still lands on the id line. `wikilinkComplete.test.ts` used to pin the null return as a crash guard; it now expects the empty block, which is the same case the edge script called a bug.

2. **Depth.** `embedChain` defaults to `[]` on the note on screen and does not include that note. `NoteEmbedWidget` passes that chain into `embedStopped`, then paints children with `[...chain, path]`. A chain of four is the fifth nested embed. `chain.length >= 5` chipped the sixth. `chain.length + 1 >= MAX_DEPTH` (`MAX_DEPTH` is 5) chips the fifth. A self-embed still chips because `path === top`, and a cycle still chips because `chain.includes(path)`. The edge labels match that counting: a chain of three still renders (“four embeds deep”), a chain of four chips (“five embeds deep”).

3. **Fences.** The first line ending in ` ^id` used to win, including a line inside a fence, and `headingPos` landed on that code line. Both lookups now skip lines `codeFenceMask` marks. The mask matches `Fences.step` in `shell/linksTags.ts`: at most three spaces, the same marker at least as long, nothing after a closer, and a backtick info string that itself contains a backtick does not open. A four-backtick fence is not closed by ```, and `~~~` is not closed by ```. An id that exists only inside a fence is null. The edge script’s old result (the fence id wins, and the embed still contains the later paragraph) is now the paragraph alone.

4. **Blank lines.** The old walk was `while (b > 0 && blank)`, so it stopped on a blank line 0 and returned `{ text: "", line: 0 }`. A real block above the blanks was already found. The walk is now `while (b >= 0 && blank)`. A block above is used. Only blanks above (`\n^id`) return null from both the embed and navigation.

The notes’ line counts match `git show --numstat 8ac9d27`: `embeds.ts` +38/−14, `headings.ts` +59/−12, `blocks.test.ts` +21, `headings.test.ts` +13, `wikilinkComplete.test.ts` +1/−1, the edge script +10/−5. `bug("embed-first-line-block")` and `bug("embed-depth-off-by-one")` are gone. `bug("daily-date-rollover")` is still recorded, and the full run printed that one bug.

## Review fix

`codeFenceMask` was right about which lines are inside a fence. The extent walk was not. `fenceStart` and the same loop in `blockPos` searched backward for a line whose trimmed text started with the closer’s whole marker, and the loop stopped at index 0 without testing that line. A longer closer is valid CommonMark (```` closes ```). That search missed the shorter opener and included the paragraph above the fence. A content line that merely begins with the marker (four spaces plus ```, or ```foo`bar, which does not open a fence) cut the fence short.

The mask now records each fenced line’s opener. A standalone id whose block is a fence uses that opener, in both the embed and `headingPos`. Two adjacent fences stay two blocks, because the closer’s opener is the nearer one. The backward helper is gone.

| File | Lines |
| --- | ---: |
| `rebuild/app/src/editor/embeds.ts` | +3 / −12 |
| `rebuild/app/src/editor/headings.ts` | +20 / −20 |
| `rebuild/app/src/editor/blocks.test.ts` | +7 / −0 |
| `rebuild/app/src/editor/headings.test.ts` | +6 / −0 |
| `rebuild/app/scripts/test-links-embeds-edge.mjs` | +2 / −0 |

Commit `c195ee2`. The new tests cover a longer backtick closer, a longer tilde closer, a four-space marker line inside the fence, a backtick line whose info contains a backtick, and a paragraph sitting between a fence and the id.

## Checks

From `rebuild/app`, then `rebuild/app/src-tauri`. All exit 0. No timing failure needed a rerun. `rebuild/round*-shots/` was restored before the commit.

- `npm run build` (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test`, including posttest. Vitest: 80 files, 1278 tests, 444 parity. Geometry stayed within 1px. 300-card drag max 16.8 ms. Zoom samples p50 16.7 ms, p95 16.7 ms, max 16.8 ms. K8 10k scroll p95 16.7 ms, max 16.8 ms. Bases edge 10k scroll p95 16.7 ms, max 16.8 ms. Property fuzz `cases=48`. The links/embeds edge script passed, including the two new fence checks.
- `npm run audit:offline`: 191 source files, dist, CSP, capabilities, and dependencies.
- `cargo build --offline` and `cargo test --offline`: 82 passed, 5 ignored, 0 failed.

`LEDGE_BENCH` inside that `npm test`: `embed_section` 0.10 ms, `link_targets` 1.87 ms, `tag_tree` 2.23 ms. The notes’ full-suite `embed_section` was 0.18 ms, inside the earlier 0.09–0.23 ms range. That sample looks up heading `H250` and does not scan block ids. The depth check is one comparison. Frame caps match the integration runs in the edge review (16.7–16.8 ms).

## Left open

These were already true, and the notes say so. They are outside the four bugs.

- `embedSection` matches a block id as written. `headingPos` lowercases it. A heading stops the paragraph walk in `embedSection` and does not stop it in `headingPos`.
- An id inside inline code, or inside a fence indented by a tab or four spaces, still counts. Four spaces is an indented code block under the same CommonMark rule the tag scanner uses.
- Heading sections still flip fences with `/^\s*(```|~~~)/`. A tilde line inside an open backtick fence can still expose a heading. Block ids use `codeFenceMask`.
- `daily-date-rollover` is still a recorded edge bug.
- Obsidian Help’s English “link to blocks” page did not return a body for this review either. The empty first-line embed follows the task (the id must not be missing) and the Japanese help summary already in the source notes: a standalone id refers to the block above, and there is no block above line 1.

VERDICT: OK
