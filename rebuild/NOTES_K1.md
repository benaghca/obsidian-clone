# K1: Format check and hardening

Built on `rebuild/kanban-k1-grok`, from `eb02c47` (the Kanban plan on integration `f112151`). Nothing was pushed.

- `d7ec637` Accept unknown Bases layouts and group settings
- this notes file

## In short

- No Obsidian-saved `.base` was in the worktree, and the only help page cited in `KANBAN_PLAN.md` §1 names no YAML keys. Section 3.1 was not renamed. The names there stay Grove's guess, and the plan now says so.
- `parseGroupBy` no longer throws on an unknown `direction` or on extra keys. It adds a notice and still returns a usable group (`ASC` when the direction is not `ASC` or `DESC`). A groupBy that is not a mapping, or that has no property, still throws the old message.
- An unknown view `type` (including `kanban`, until K4) opens that view with the notice "This layout isn't supported yet". The view still uses the table renderer. Another view in the same file does not get the notice. `views` that is not a list still throws.

## What changed (+38 / −7)

| File | Lines | What |
|---|---|---|
| `rebuild/app/src/bases/groups.ts` | +7 / −3 | `parseGroupBy` only. Optional `notices` set. Unknown direction and extra keys become notices. |
| `rebuild/app/src/bases/model.ts` | +2 / −2 | The view-type check adds the layout notice instead of throwing, and passes `notices` into `parseGroupBy`. |
| `rebuild/app/src/bases/groups.test.ts` | +13 / −1 | Unknown direction, extra keys, and a sibling view. Malformed groupBy still throws. |
| `rebuild/app/src/bases/model.test.ts` | +15 / −1 | `type: map` and `type: kanban` open; the other view's notices stay empty. `views: table` still throws. |
| `rebuild/KANBAN_PLAN.md` | +1 | §3.1 records the key check. No key was renamed. |

Nothing else. `writeViewSetting`, arrange, collapse, `menus.ts`, `view.ts`, and the `GroupBy` type are unchanged. `order` and `hidden` are not parsed.

## Keys: confirmed vs Grove's guess

Relied on `KANBAN_PLAN.md` §1 only. That section quotes Obsidian's public Views page (`https://help.obsidian.md/bases/views`, which 301s to `https://obsidian.md/help/bases/views`), read by the plan on 2026-10-30. No network was used, and no Obsidian code or assets. The quoted page describes Kanban and Manual behaviour and names no YAML keys. No Obsidian-saved `.base` was available (D2).

**Confirmed by that page:** none of the key names.

**Grove's own format today** (this code and its tests, not checked against Obsidian):

- `type: table` and `type: cards`
- `groupBy.property` (a non-blank string)
- `groupBy.direction`: `ASC` or `DESC`. Omitted, or YAML `null`, stays `ASC` with no notice.

**Still Grove's guess** (left as drawn in §3.1):

- `type: kanban`
- `groupBy.order` (present means Manual)
- `groupBy.hidden`

## Decisions

- **Unknown direction is a notice, then `ASC`.** The old throw was `groupBy requires a property and ASC or DESC direction` for a bad direction as well as for a missing property. A file Obsidian saved with another direction word would not open. The property check still throws, so a broken groupBy does not become a silent "no grouping". `desc` is not `DESC`. The notice is `Unsupported group direction: …`.
- **Extra keys are one notice, in key order, and are not read.** `Unsupported groupBy settings: order, hidden` for the §3.1 shape. Grouping by `property` still works. K3 owns parsing `order` and `hidden`. Until that lands, a Manual block shows this notice. K3 should stop listing the keys it reads.
- **The second argument is optional.** Callers that do not pass a set still do not throw. `baseModel` passes the view's notice set, the same set `parseSummaryPlan` already uses.
- **Unknown layout uses one fixed sentence.** `This layout isn't supported yet`. It does not include the type name. The in-memory `type` stays `"table" | "cards"`, so a `kanban` view opens as a table with that notice. K4 owns adding `kanban` to the union and the renderer. `menus.ts` still greys any type other than table or cards; that menu was not part of K1.
- **One view at a time.** `baseModel(source, viewIndex)` builds notices for the selected view only. A map or kanban view does not mark its sibling table view.

## Before and after

The changed work is one parse per `baseModel`, not the select or group loop. Measured with a Vite `ssrLoadModule` script in `/tmp` (not committed): 200 warm-up calls, then 7 runs of 4,000 calls. The table is the median of those 7 totals, and the slowest of 50 single calls after the change.

| Case | Before (4,000 calls) | After (4,000 calls) | Slowest single call after |
|---|---|---|---|
| `baseModel`, grouped `DESC` | 10.594 ms (2.65 µs each) | 10.550 ms (2.64 µs) | 0.009 ms |
| `baseModel`, extra `order` / `hidden` | 14.204 ms (3.55 µs) | 14.890 ms (3.72 µs) | 0.018 ms |
| `parseGroupBy`, valid | 0.120 ms (0.030 µs) | 0.114 ms (0.028 µs) | 0.008 ms |
| `parseGroupBy`, extra keys | 0.113 ms (0.028 µs) | 0.144 ms (0.036 µs) | 0.007 ms |
| `parseGroupBy`, direction `backward` | 9.010 ms (2.25 µs, threw) | 0.142 ms (0.036 µs, notice) | 0.007 ms |
| `baseModel`, `type: kanban` | 18.274 ms (4.57 µs, threw) | 10.224 ms (2.56 µs, notice) | 0.004 ms |
| `baseModel`, `type: map` then the sibling | 17.432 ms (4.36 µs; the throw skipped the sibling) | 17.260 ms (4.32 µs; both views built) | 0.060 ms |

No single call was near the 50 ms main-thread budget. The valid grouped path is the same before and after. Unknown direction and `type: kanban` got faster because they no longer throw.

P12's existing benches (`bench-bases-groups`, `bench-bases-search`, `bench-frontend`) were not run. They time select, grouping, search, and the frontend on a 50,000-note vault, and the browser half needs the shared browser. This change does not sit on that path: `parseGroupBy` runs once when the model is built. The numbers above are the before/after for the lines K1 owns.

## Checks

From `rebuild/app`:

- `npm run build` passed. The existing Vite warning about a chunk over 1,000 kB is unchanged.
- `flock /tmp/grove-npm-test.lock npm test` passed (`EXIT:0`). Vitest: 67 files, 1,110 tests. Browser scripts and `posttest` passed, including geometry, cards, embeds, and search. No timing flake, so nothing was rerun. Embed cold open 24.0 ms.
- `npm run audit:offline` passed: 175 source files. No registry and no new package.

From `rebuild/app/src-tauri`, both with `--offline` (crates.io was not contacted):

- `cargo build --offline`: dev profile, cache hit, 0.14 s.
- `cargo test --offline`: 58 passed, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`).

Screenshot dirs under `rebuild/round*-shots` were restored before the commit and were not committed.

## Open questions for Chris

- A `.base` saved by Obsidian 1.14, with a Kanban view and a Manual group order (one group hidden, one added), is still the way to confirm or replace `type: kanban`, `groupBy.order`, and `groupBy.hidden`. Until that file exists, K3 should treat those names as Grove's guess.
- K4 should clear the layout notice for `kanban` when that layout exists, and leave it for types Grove still does not draw (`map`, and anything else).
