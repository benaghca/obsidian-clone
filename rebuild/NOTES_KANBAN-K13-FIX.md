RESULT: OK

Combined Kanban K1 and K3, then stopped `order` and `hidden` from showing up as unsupported group settings. Branch `rebuild/kanban-k13-fix-grok`, started at `rebuild/k3-review-grok` `19b86c6`. Merged `rebuild/k1-review-grok` `74cd188` with `--no-ff`. Git auto-merged `groups.ts`. No conflict. Both source branches are still at those commits. Nothing was pushed. K4 was not started.

Relied on `rebuild/KANBAN_PLAN.md` §3.1 and the K1 and K3 rows in §8, plus the trial-merge note in `rebuild/NOTES_KANBAN-K3-REVIEW.md`. No network. No Obsidian code or assets. The Views page cited by the plan names no YAML keys, so `groupBy.order` and `groupBy.hidden` stay Grove's guess.

## What changed

The merge brought K1's `parseGroupBy` onto K3. That function noticed every key other than `property` and `direction`, so a Manual `.base` would show `Unsupported groupBy settings: order, hidden`. K3 already reads those two keys in `parseManual`.

| File | Lines | What |
|---|---|---|
| `rebuild/app/src/bases/groups.ts` | +1 / −1 | `parseGroupBy` skips `order` and `hidden` when it builds the extra-key notice. |
| `rebuild/app/src/bases/groups.test.ts` | +13 / −3 | Manual keys alone produce no settings notice. An unknown key beside them is the only one named. The stored YAML still has `order`, `hidden`, and the original direction. |

`parseManual` is unchanged, including its own notices (`groupBy.order must be a list`, an unreadable entry, and the 1,000 cap). An unknown direction is still `Unsupported group direction: …` and still falls back to `ASC`. Any other extra key is still one notice, in key order. `parseGroupBy` does not delete keys and does not write the file.

## Speed

`node scripts/bench-bases-search.mjs` once, under the shared lock. Work is the median. Frames are the four keys that change the rows. Compared with `NOTES_KANBAN-K3-REVIEW.md` on the same script. The filter runs once when the model is parsed, not on the search loop. The bench's grouped view has only `property` and `direction`.

| Rows / view | K3 review | This run |
|---|---|---|
| 5,000 table | 6.2 ms (max 11.8), frames 1, 1, 1, 1 | 6.4 ms (max 11.4), frames 1, 1, 1, 1 |
| 5,000 grouped | 13.1 ms (max 14.9), frames 2, 1, 2, 2 | 9.9 ms (max 11.7), frames 2, 1, 2, 2 |
| 5,000 cards | 1.4 ms (max 2.7), frames 1, 1, 1, 1 | 1.7 ms (max 2.7), frames 1, 1, 1, 1 |
| 50,000 table | 8.3 ms (max 21.4), frames 2, 1, 1, 1 | 8.1 ms (max 8.6), frames 1, 1, 1, 1 |
| 50,000 grouped | 55.8 ms (max 58.9), frames 5, 2, 5, 4 | 58.7 ms (max 64.7), frames 5, 2, 5, 5 |
| 50,000 cards | 19.4 ms (max 19.8), frames 3, 1, 3, 1 | 5.7 ms (max 17.3), frames 1, 1, 3, 1 |

No long task. Every max frame is 16.8 ms. The 50,000 grouped work sits inside K3's after band (47.8–68.1 ms). The 50,000 card sample is faster than that review and matches the earlier B6 band (about 6 ms). No measurable change from the key filter.

The same `npm test` also kept the open numbers in the K3 review band: warm 1,000-note open 9.2 ms, 5,000-note cold 41.5 ms, embed cold 22.8 ms. `test-bases-group-order.mjs` passed. P9 table median 2.9 ms and cards 3.4 ms, all one frame. P8 opened on frame 1, 20 DOM rows, drag p95 16.8 ms.

## Checks

First run, no flake, no retry.

From `rebuild/app`:

- `npm run build` passed. The existing Vite warning about a chunk over 1,000 kB remains.
- `npm run audit:offline` passed: 176 source files.
- `flock /tmp/grove-npm-test.lock npm test` passed (`NPM_EXIT:0`). Vitest: 68 files, 1,116 tests. Browser scripts and `posttest` passed, including geometry, the K1 model tests, and `test-bases-group-order.mjs`.

From `rebuild/app/src-tauri`, both with `--offline`:

- `cargo build --offline`: dev profile, cache hit, 0.15 s.
- `cargo test --offline`: 58 passed, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`). Rust was not changed.

Screenshot dirs under `rebuild/round*-shots` were restored before each commit and were not committed.
