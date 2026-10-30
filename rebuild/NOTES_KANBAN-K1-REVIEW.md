VERDICT: OK

Reviewed Grok b's Kanban K1 on `rebuild/k1-review-grok`, taken from `rebuild/kanban-k1-grok` at `d84ea04`. That branch is still at `d84ea04`. Parent is `eb02c47` (integration `f112151` plus `rebuild/KANBAN_PLAN.md`). Integration was still `f112151` at this commit and was not merged again. Nothing was pushed. No product code changed in this review.

Relied on `rebuild/KANBAN_PLAN.md` only for Obsidian's behaviour. Section 1 quotes the public Views page (`https://help.obsidian.md/bases/views`, which 301s to `https://obsidian.md/help/bases/views`), read by the plan on 2026-10-30. No network, and no Obsidian code or assets.

## What K1 changed

Product commit `d7ec637` is +38 / −7, and only the files K1 owns:

| File | Lines | What |
|---|---|---|
| `rebuild/app/src/bases/groups.ts` | +7 / −3 | `parseGroupBy` only. |
| `rebuild/app/src/bases/model.ts` | +2 / −2 | The view-type line adds a notice instead of throwing, and passes `notices` into `parseGroupBy`. |
| `rebuild/app/src/bases/groups.test.ts` | +13 / −1 | Unknown direction, extra keys, sibling view. A missing property still throws. |
| `rebuild/app/src/bases/model.test.ts` | +15 / −1 | `type: map` and `type: kanban` open as a table. The other view's notices stay empty. `views: table` still throws. |
| `rebuild/KANBAN_PLAN.md` | +1 | §3.1 records that no key was renamed. |

`writeViewSetting`, arrange, collapse, `menus.ts`, `view.ts`, and the `GroupBy` type are unchanged. `order` and `hidden` are not parsed.

`d7b882e` and `d84ea04` replace `rebuild/NOTES_K1.md` with the format notes and keep the old search-parity text in `rebuild/NOTES_K1-SEARCH.md`. `git show d11803d:rebuild/NOTES_K1.md` and `rebuild/NOTES_K1-SEARCH.md` are the same 98 lines (`cmp` identical). The move lost no text.

## Checks against the plan

K1 matches the §8 row, §3.1, D2, and R1.

- A bad direction does not throw. `backward` and `desc` become `ASC` with `Unsupported group direction: …`. Omitted direction and YAML `null` stay `ASC` with no notice. The returned group is usable.
- Extra keys do not throw. They are one notice, in key order (`Unsupported groupBy settings: order, hidden`), and they are not copied into the in-memory `GroupBy`. The source string is unchanged: after `baseModel`, `direction: backward`, `order`, and `hidden` are still in the text, and `view.groupBy` still holds them. Nothing in this diff writes the file. `parseGroupBy`'s only caller is `baseModel`. `writeViewSetting` still runs only from the Group menu, and that writer was not part of K1. Plan §3.4 already says a later menu write replaces the whole `groupBy` block; K3 owns keeping `order` and `hidden` across that write.
- An unknown view type (`map`, `kanban`, anything other than `table` or `cards`) adds exactly `This layout isn't supported yet` on that view. `baseModel` keeps `type` as `"table"` (`model.ts` assigns `"cards"` only when the type is cards), so `view.ts` paints the table and puts the notice on the existing `.bases-notice` line. The sibling view's notice set stays empty. `type: table` and `type: cards` add no notice. `views: table` (not a list) still throws.
- A missing or blank property, or a groupBy that is not a mapping, still throws `groupBy requires a property and ASC or DESC direction`. The §8 row asks for a notice on an unknown direction and on extra keys, not on a missing property. Keeping the throw means a broken groupBy does not become a silent "no grouping".
- No Obsidian-saved `.base` was in the tree, and the Views page names no YAML keys. K1 did not invent aliases. The new §3.1 sentence says nothing was renamed. `type: kanban`, `groupBy.order`, and `groupBy.hidden` stay Grove's guess until a real file exists.

## Performance

The changed work is one parse per `baseModel`, not select, group, or search. Same method as `NOTES_K1.md`: Vite `ssrLoadModule` from `/tmp` (not committed), 200 warm-up calls, then the median of 7 runs of 4,000 calls. Before is `eb02c47`'s `model.ts` and `groups.ts`. The slowest column is the slowest of 50 single calls after the change. This is the second quiet run. A first run matched these `baseModel` totals within about 1 ms; its `parseGroupBy`-only "after" figures were higher because that loop cleared the notice set on every call, so they are not the ones below.

| Case | NOTES_K1 before → after | This run before → after | Slowest single call |
|---|---|---|---|
| `baseModel`, grouped `DESC` | 10.594 → 10.550 ms | 11.401 → 11.596 ms (2.85 → 2.90 µs) | 0.017 ms |
| `baseModel`, extra `order` / `hidden` | 14.204 → 14.890 ms | 15.028 → 16.198 ms (3.76 → 4.05 µs) | 0.008 ms |
| `parseGroupBy`, valid | 0.120 → 0.114 ms | 0.125 → 0.130 ms | 0.000 ms |
| `parseGroupBy`, extra keys | 0.113 → 0.144 ms | 0.138 → 0.564 ms | 0.000 ms |
| `parseGroupBy`, direction `backward` | 9.010 → 0.142 ms (throw → notice) | 8.872 → 0.389 ms | 0.000 ms |
| `baseModel`, `type: kanban` | 18.274 → 10.224 ms (throw → notice) | 19.541 → 11.405 ms | 0.003 ms |
| `baseModel`, `type: map` then the sibling | 17.432 → 17.260 ms | 18.479 → 19.605 ms | 0.006 ms |

No single call was near 50 ms. The valid grouped path is the same before and after (the 0.2 ms gap on 4,000 calls is noise; one before total in that case was 19 ms). Unknown direction and `type: kanban` got faster because they no longer throw. The map case is slightly slower after because both views are built; the throw used to skip the sibling. That is the behaviour K1 asked for, and it is about 5 µs for the pair.

The isolated extra-key `parseGroupBy` total (0.564 ms for 4,000) is higher than NOTES_K1's 0.144 ms. The `baseModel` case that actually runs on open, which includes that parse, moved by about 0.3 µs, in the same direction as NOTES_K1's 0.2 µs. One open does this once. It is not a visible hitch.

Bases open, from this machine's `npm test`, next to the B6 review measured on the same integration product (`f112151` merges that review, which did not change product code):

| | B6 review / `f112151` | K1's own `npm test` | This review |
|---|---|---|---|
| Warm 1,000-note open | 8.3 ms | not run | 8.1 ms |
| B0 5,000-note cold | 41.1 ms | not run | 41.9 ms |
| B0 warm samples | 19.2 / 11.8 / 14.2 ms | not run | 18.9 / 11.9 / 13.9 ms |
| Embed cold | 23.7 ms | 24.0 ms | 23.4 ms |
| Embed warm | 7.0 / 6.6 / 7.4 ms | not given | 6.9 / 7.0 / 6.6 ms |
| 1,000-row scroll | 16.8 ms | not run | 16.8 ms |
| 300-card drag | 16.8 ms | not run | 16.8 ms |

No open regression. `bench-bases-groups`, `bench-bases-search`, and `bench-frontend` were not run. They time select, grouping, search, and the frontend on a large vault. `parseGroupBy` is not on that loop, and the open numbers above already include one `baseModel` per open.

## Checks

From `rebuild/app`:

- `npm run build` passed. The existing Vite warning about a chunk over 1,000 kB is unchanged.
- `npm run audit:offline` passed: 175 source files.
- `flock /tmp/grove-npm-test.lock npm test` passed (`NPM_EXIT:0`). Vitest: 67 files, 1,110 tests. Browser scripts and `posttest` passed, including geometry, cards, embeds, and search. No timing flake, so nothing was rerun. `B6_SEARCH_TEST` max 16.5 ms.

From `rebuild/app/src-tauri`, both with `--offline`:

- `cargo build --offline`: dev profile, cache hit, 0.11 s.
- `cargo test --offline`: 58 passed, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`).

Screenshot dirs under `rebuild/round*-shots` were restored before this commit and were not committed.

## Open questions for Chris

- A `.base` saved by Obsidian 1.14, with a Kanban view and a Manual group order (one group hidden, one added), is still needed before K3 treats `type: kanban`, `groupBy.order`, and `groupBy.hidden` as confirmed names. Until then they stay Grove's guess, as §3.1 now says.
- K3 should stop listing `order` and `hidden` in the extra-keys notice once it parses them, and its writer should keep those keys when it rewrites `groupBy`. Today's Group menu still replaces the whole block. K1 does not call that writer.
- K4 should clear the layout notice for `kanban` when that layout exists, and leave it for `map` and any other type Grove still does not draw.
