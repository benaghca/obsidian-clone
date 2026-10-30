# NOTES_BASES-B4-REVIEW: review of Bases embedding (Grok)

Branch `rebuild/b4-review-grok`, from `rebuild/bases-b4-claude` `dd91068` (itself from `rebuild/integration` `08641e4`). This review did not change code.

VERDICT: OK

Ready to merge. Embedding matches the plan and the public docs this review relied on. The tab path keeps B0's schedule, and the card, table, CSV and geometry suites still pass. The timings below do not show a regression, including the 13.8 ms warm-open outlier from `NOTES_BASES-B4.md`. The extra rebuild after a save is cheap enough to leave.

## 1. Embedding

Checked against `BASES_PLAN.md` §3 item 5 and §4, and against Obsidian's public help pages "Embed a base" and "Bases syntax" (`this`), from prior knowledge. No page was fetched. No Obsidian code or assets were used.

From those pages: a base is embedded as a ` ```base ` block whose body is the YAML, or as `![[File.base]]` / `![[File.base#View]]`. `this` is the note the base is drawn in. In the base's own tab, `this` is the base file.

What the branch does:

- `editor/blocks.ts` turns a CommonMark `base` fence (backtick or tilde, three or more, at most three spaces of indent, closing fence at least as long) into `BaseWidget`. The caret in the block shows the source, as it does for a callout. "Edit this block" puts the caret in the YAML.
- `editor/livePreview.ts` draws `![[X.base]]` and `![[X.base#View]]` where a note embed is drawn, including while the caret is on the line. Any case of `.base` counts. Another extension stays a link. A missing file is the grey "could not be found" box.
- `#View` selects that view by name once (`view.ts`, the `viewName` pass). The view menu can switch afterwards without writing. An unknown name keeps the first view. That last choice is Grove's, and the notes already say so.
- `this` is the innermost note in `embedChain`, otherwise the note on screen. The host row is a copy, so its own context has no `this`. One host context is shared for the selection (`model.ts`). The host row is built only when the YAML contains the word `this`, so a base that does not read `this` does the same work as before. In a tab, the host path is the `.base` file.
- Height is capped at 400 px (`.bases-scroll` inside `.bases-embed`) and scrolls inside the embed. Above 200 rows the table and cards virtualise as in the tab. The block widget is a direct child of `.cm-content` with padding and no vertical margin. The geometry check in `test-bases-embed.mjs` passed in Live Preview and Reading view.
- The embedded toolbar keeps the view name and the result count. Sort, Filter, Properties and New show icons only. Their aria-labels stay.
- Viewing writes nothing, including a view-menu switch. A cell edit writes the row's note. A toolbar edit writes the `.base` file, or the block's YAML through the note's editor. A block drawn inside another embed cannot write, and the notice says "Open the note this base is in to change it."

Grove's own choices, not taken from a fetched page: the 400 px cap, the icon-only actions, the message when a nested block cannot write, and an unknown `#View` showing the first view. Worth a look in Chris's Obsidian later. They do not block this merge.

## 2. The view split

`createBaseView` is the tab wrapper: remembered view index, `this` as the `.base` path, and `shown` while that tab is active. `pane.ts` still calls it. `baseChange` is unchanged. The one new input is `readsChanged`: a base whose YAML reads `this` rebuilds when its host note changes, even if that note is outside the folder or tag pre-filter. Without that, `this.status` would go stale. A tab's host is the `.base` file, which is not in the doc-change list, so tab filtering is the same as on integration.

Cards are drawn inside `createBase` with the same row build as the table. The old `attachCardsToBaseView` / `enableBaseCards` path built the rows a second time, 16 ms after every `files` / `doc` / `links` event, and ignored B0's quiet period. That code is deleted, along with its call in `main.ts`. `createCardGrid` is unchanged. A cards view no longer paints a hidden table.

The full suite on this branch passed the table tests, `test-bases-results.mjs` (CSV and the results menu), `test-bases-cards.mjs`, and `test-bases-embed.mjs`. No behaviour change showed up in those.

## 3. Performance

Three rounds, interleaved in one session under `/tmp/grove-npm-test.lock`: integration `08641e4`, then this branch `dd91068`, repeated. Same scripts as `NOTES_BASES-B4.md`. The browser mock has no IPC.

| Measure | Integration, rounds 1 / 2 / 3 | This branch, rounds 1 / 2 / 3 |
|---|---|---|
| Warm 1,000-note table open | 8.9 / 9.3 / 8.4 ms | 9.5 / 8.4 / 8.9 ms |
| 1,000-row table scroll, max frame | 16.8 / 16.8 / 16.7 ms | 16.7 / 16.7 / 16.8 ms |
| 5,000-row cold open | 42.7 / 44.2 / 44.8 ms | 41.1 / 42.1 / 41.3 ms |
| 5,000-row warm opens (3 per round) | 15.7, 13.4, 19.1, 14.8, 19.5, 14.6, 15.6, 22.6, 13.5 | 15.0, 19.3, 17.3, 14.9, 20.5, 14.1, 17.7, 12.0, 22.6 |
| Typing beside a 5,000-row base: max frame; rebuilds during / after | 16.8 / 16.8 / 16.7 ms; 0 / 1 | 16.8 / 16.8 / 16.8 ms; 0 / 1 |
| 1,000-card grid scroll, max frame | 19.1 / 18.9 / 18.8 ms | 17.2 / 16.9 / 16.7 ms |

The nine warm 5,000-row opens have median 15.6 ms on integration (13.4–22.6) and 17.3 ms here (12.0–22.6). The ranges overlap, both ends included, and both sit under the 150 ms cap. That is not a regression.

The 13.8 ms warm 1,000-note open did not recur. This branch's three opens were 9.5, 8.4 and 8.9 ms, against 8.9, 9.3 and 8.4 on integration. The full `npm test` later in the same session opened the same table in 9.4 ms.

Card scroll is faster on every round and further from the 20 ms line, which matches one row build instead of two.

Embeds (`test-bases-embed.mjs`, three standalone rounds, then the full suite):

| Measure | Rounds 1 / 2 / 3 | Full `npm test` |
|---|---|---|
| Cold open, both embeds | 84.5 / 86.2 / 83.5 ms | 84.3 ms |
| Warm opens | 7.3, 6.5, 6.1 / 7.3, 6.5, 5.7 / 7.0, 6.7, 6.2 ms | 7.0, 6.0, 5.7 ms |
| Typing: max frame; rebuilds during / after | 16.7–16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| 1,000-row embed page, max frame | 16.7 ms, box 400 px, 30 rows | 16.8 ms |

Warm embed opens are under the 100 ms assertion. Cold opens are under 100 ms as well. Typing does not rebuild during the burst, and one rebuild follows the quiet period, from the block that reads `this`. Both embeds keep their DOM.

## 4. The extra rebuild on save

`DOC_QUIET_MS` and the editor's `SAVE_DELAY` are both 300 ms. After the last keystroke they fire together. The quiet timer runs one rebuild from the open editor. The save then calls `onModified`, and a note inside the filter is not skipped, so `schedule()` queues another rebuild 20 ms later. If the first `update()` is still in its `await`, the second call only sets `dirty` and the loop continues. If the first has finished, the second is one more warm evaluation.

That second pass is what picks up `file.mtime`, size and the link index after the write. Dropping it would leave those stale. A 5,000-row warm evaluation in this session was 12–23 ms, once, after typing had stopped. The B0 checks still see one rebuild after the quiet period while saves are held, and an outside-folder save still does not rebuild (`outsideSave: 0` on both sides). Not worth a change in `view.ts`, which B5 is editing.

## 5. Files outside the B4 list

`git diff --name-only 08641e4..dd91068` is the 18 files in `NOTES_BASES-B4.md` and nothing else. The ones outside `bases/embed.ts`, `bases/view.ts` and `editor/embeds.ts`:

| File | +/− | Why |
|---|---:|---|
| `bases/model.ts` | +5 / −2 | `Row.host` and one shared host context |
| `bases/menus.ts` | +5 / −4 | `save` takes a `BaseFile` instead of a path |
| `bases/cards.ts` | +2 / −233 | dead attach path removed |
| `editor/blocks.ts` | +6 / −2 | the fence hook |
| `editor/livePreview.ts` | +6 / −4 | the `![[X.base]]` hook |
| `editor/host.ts` | +16 | `BaseEmbed` and the optional `base` hook |
| `editorHost.ts` | +2 | wires the hook |
| `main.ts` | −3 | the removed `enableBaseCards` call |
| `styles/bases.css` | +16 | the embed box |

`model.ts` and `menus.ts` are small and sit away from `select()` and the header-menu items. If B5 lands first, re-apply `Row.host` plus the host context, and `BaseFile` in `save`.

## Checks

No product code changed, so these are the branch as Claude left it.

- Interleaved benches above: every script exited 0. No flake retry.
- `npm run audit:offline`: passed. TypeScript and Vite, built in 219 ms. The existing chunk-size warning remains. 172 source files, dist, CSP, capabilities and dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first full run. Vitest 64 files / 1,056 tests, then the browser, geometry and real-pointer scripts, then `posttest` (`test-bases-config.mjs`, `test-bases-cards.mjs`, `test-bases-embed.mjs`). The 300-card canvas drag stayed under 20 ms (max 16.8 ms). The embed geometry checks passed in Live Preview and Reading view. No retry.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: passed. 58 tests passed, 0 failed, 2 ignored. The registry was not contacted.

Screenshot fixtures were restored with `git checkout -- rebuild/round*-shots` before this commit. Prompts and logs are not committed. No GUI window, network, real vault, other worktree or Herdr pane was used. Nothing was pushed.

## Left open

1. The 400 px cap, the icon-only embedded actions, and whether an embedded block's toolbar writes back into the block, against Chris's Obsidian.
2. A hover preview (and a canvas card, which also renders note text in a read-only view) will mount a live base, and its cells can still write. Reading view of the note itself must keep the base, and that editor is read-only too, so a blanket read-only check is wrong. A placeholder in previews is the one-line follow-up the B4 notes already describe. Not required to merge.
3. B1's visible `#ERROR!` cells are still unwired. B4 only did `this`.
