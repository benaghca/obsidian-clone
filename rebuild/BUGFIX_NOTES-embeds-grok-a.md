# Bugfix: block ids and embed depth

Branch `rebuild/bugfix-embeds-grok-a` from `rebuild/integration` (`278f8ba`). Local commits only. Nothing pushed.

Block ids and embed depth live in TypeScript (`editor/embeds.ts`, `editor/headings.ts`). The Rust index does not resolve `#^id` sections, so nothing there changed.

## What was wrong

1. **First line.** `embedSection` returned null when a standalone `^id` was line 0 (`if (!at) return null`). `headingPos` already returned 0, so the link landed and the embed said the block was missing.
2. **Depth.** `embedStopped` chipped when `chain.length >= 5`. `chain` is notes already drawn and does not include the embed being drawn, so the sixth nested embed was the first chip. The file comment says five embeds deep.
3. **Fences.** The first line ending in ` ^id`, including one inside a fence, won. A fenced `code ^id` was taken ahead of a later `para ^id`, and `headingPos` landed on the code line. Heading sections already skipped fences. Block ids did not.
4. **Blank lines.** A standalone id walked back with `while (b > 0 && blank)`, so it stopped on a blank line 0 and embedded `{ text: "", line: 0 }`. A real block above the blanks was already found (`para\n\n^id` was `para`). The empty embed was the blank line itself.

## What changed

| File | Lines |
| --- | ---: |
| `rebuild/app/src/editor/embeds.ts` | +38 / −14 |
| `rebuild/app/src/editor/headings.ts` | +59 / −12 |
| `rebuild/app/src/editor/blocks.test.ts` | +21 / −0 |
| `rebuild/app/src/editor/headings.test.ts` | +13 / −0 |
| `rebuild/app/src/editor/wikilinkComplete.test.ts` | +1 / −1 |
| `rebuild/app/scripts/test-links-embeds-edge.mjs` | +10 / −5 |

`codeFenceMask` follows the same CommonMark rule as `Fences` in `shell/linksTags.ts`: at most three spaces, the same marker at least as long, nothing after a closer. A shorter fence does not close a longer one, and `` ``` `` does not close `~~~`. Ids on those lines are skipped. A paragraph walk stops at a fence, so the later id does not swallow the code. A standalone id whose block is a fence still embeds that one fence, opener through closer, including blank lines inside it. Two fences in a row stay two blocks: the id attaches to the nearer one.

`embedStopped` is now `chain.length + 1 >= 5`. Four nested embeds still render. The fifth is a chip. A self-embed and a cycle still chip at once.

## Decisions

- A standalone `^id` on line 1 (nothing above it, including after frontmatter, where it is line 0 of the body) resolves to `{ text: "", line: 0 }` plus the frontmatter offset. The embed is an empty block, not the missing chip. Navigation stays on that line.
- Blank lines before a standalone id are skipped. If a block is above them, the id attaches to it. If every line above is blank (`\n^id`), there is no block, and both the embed and navigation return null. That is the empty-string bug: the blank line was being embedded.
- Fence detection matches tags, not the looser heading-section toggle (`/^\s*(```|~~~)/`, which still flips for headings only). A tab-indented or four-space fence is not a fence here, so an id in one still counts.

Obsidian Help, [Internal links / link to blocks](https://obsidian.md/help/link-to-blocks). The English page did not return a body. The official Japanese translation of that article says a manual id is `^your-id` after the block, an end-of-line id needs a space, a complex block takes the id on its own line with a blank line before and after, and that id refers to the block above. Prefix `!` to embed. No help sentence for the number 5 was retrieved. The depth change follows the task and the comment already in `embeds.ts` (five embeds deep is a chip). No Obsidian code or assets were used.

## Tests

Known-bug edge checks turned into ordinary checks. `bug("embed-first-line-block")` and `bug("embed-depth-off-by-one")` are gone. `daily-date-rollover` is unchanged and still recorded.

Edge script now expects: a first-line id is an empty block at line 0 and navigation returns 0; blank lines before an id are skipped; only blanks above an id are null; a fenced id does not beat the paragraph, and an id that exists only in a fence is null; five embeds deep is a chip and six still is.

Vitest regressions, one group per bug: first line and frontmatter (`blocks.test.ts`), blank lines, fences (including a four-backtick fence, a tilde fence that a backtick line does not close, and two adjacent fences), and depth four still rendering while five chips. `headings.test.ts` checks the same fence, blank, and first-line positions. The orphan-id test now expects the empty block instead of null.

## Checks

From `rebuild/app`, all exit 0. No timing flake needed a rerun.

- `npm run build` (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test`, then posttest. Vitest: 80 files, 1278 tests, 444 parity. Geometry stayed within 1px. Canvas drag/zoom frames 16.8 ms. K8 10k scroll p95 16.7 ms, max 16.8 ms. Bases edge 10k scroll p95 16.7 ms, max 16.8 ms. Property fuzz `cases=48`. Both links/embeds edge scripts passed inside this run.
- `npm run audit:offline`: 191 source files, dist, CSP, capabilities, and dependencies.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: 82 passed, 5 ignored, 0 failed.

`embed_section` in the edge script looks up heading `H250`. That loop was not edited. Median 0.10 ms, then 0.09 ms after the fence-extent tweak, and 0.18 ms inside the full `npm test`. That is the earlier 0.09–0.23 ms range. There is no bench for block-id scans. The depth check is one comparison.

After the full run, the fence-extent walk was narrowed so two adjacent fences do not merge. Unit tests and `scripts/test-links-embeds-edge.mjs` were run again on that walk. The full browser suite was not repeated for that one change.

## Left open

- `headingPos` still lowercases a block id. `embedSection` does not. A heading still ends a paragraph in `embedSection` and does not in `headingPos`. Both were already different.
- `daily-date-rollover` is still a recorded edge bug.
- An id inside inline code, or inside a fence indented by a tab or four spaces, is still an id.
