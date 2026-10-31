# K6 — Kanban own-write reconcile

Branch `rebuild/kanban-k6-grok`, from integration `ba9e4ac` (K1–K5, K7, CZ1 and CZ-H).
Piece K6 of `rebuild/KANBAN_PLAN.md` §8 and §4.5 step 5. Nothing was pushed; git ran with hooks off.

Code commits:

- `3003ed6`: skip the full rebuild after this board's own property write.
- `e56950a`: browser coverage for that skip, and the 10,000-note typing budget.
- `2b707fd`: own-write reconcile bench at 1,000, 10,000 and 50,000 notes.

## Behaviour and decisions

The design is the approved plan. No new Obsidian help lookup was needed, and no Obsidian code or assets were used.

`createBase`'s update still selects and regroups for every change that is not this board's own write. After a successful move, undo or redo (`done` or `unchanged`, and only while the same model is current), the board remembers that path and the props it just painted. The mark is per board, so another open base, and a table cell edit, still rebuild. `cells.ts` stays as it is; the optional move of those writes onto `set_property` is outside K6.

On the next update the view skips the select when all of these hold: the view is Kanban, nothing asked for a reload, the notice is exactly one note, that note is the marked path (or the one-shot echo below), the source does not read `this`, the source does not read `file.backlinks`, `file.links`, `file.embeds` or `.hasLink(`, and the property index's re-read list equals the painted list. Equality covers key, type, value, line and count. A mismatch, including a Rust writer whose line numbers differ from the editor parse, falls through to the normal sliced rebuild. The mock writer uses the same editor parse, so the benches compare equal lists.

A matching property list alone is not a skip. A body-only edit can change `file.tags` or links while the frontmatter stays equal, and `writeProperty` has no board identity. Only the mark this board stored after its own write distinguishes that case.

The open-note path emits a doc change immediately and `vault.written` about 300 ms later, when the editor saves. The doc update is the own-write skip. For 500 ms afterwards, one later modify that is not a doc edit can skip as the echo of that save. A new doc edit in that window is a real edit and rebuilds. The echo is cleared whenever the decision is a rebuild. A links-only skip leaves it. If the index read overlaps a newer notice (`gone`, `dirty` or `reload`), the mark stays and the loop retries.

`vault.written` always schedules `refreshLinks` one second later. A links-only notice on a Kanban that does not read other files' link data skips as well, so that refresh does not remount the columns the own write just kept. A links notice that arrives with a path, or with a file-list change, still rebuilds. An empty notice with no links also rebuilds, which keeps focus-out cell catch-up and settings edits on the full path. Listeners record a path or a reason only when the event actually schedules an update, so an edit outside the watched folder cannot poison the next one.

Two different notes changed before one update take the full path. The same note moved twice is one path and the final painted props. Reordering headers writes the `.base` and reloads. Adding a card creates a note and is a file-list change. Both rebuild.

The skip still calls `propertyIndex.notes()`, which copies the map and re-reads a stale note. At 50,000 notes that copy is 11.5 ms, inside the 50 ms budget, so the index API is unchanged. `lastMs` on the view element is that update work. It does not include the 20 ms scheduling delay. Wall time from `setProperty`'s return does. A full iteration is counted only after `model.select`. The Kanban, cards and table dispatch lines are unchanged; the skip returns before that body.

`patch` already focuses the replacement card, so undo keeps keyboard focus inside the board without `restoreFocus` and without unmounting columns. The move script's undo wait now requires the reverted file, a still-connected column, focus on the card and a skip, then checks that a second Ctrl+Z reaches the board.

A `file.mtime` label can stay stale until some later rebuild. `touch` updates the file entry, and the skip does not repaint the card.

## Files

Implementation, excluding this notes file: **6 files, +376/−9**.

- `view.ts` +124/−2: own-write and links-only decisions, property compare, echo, and the full/skip counters on `.bases-view`.
- `kanban.ts` +14/−1: remember the path after a successful write, expose the painted props, and drop the mark when a real `update` proceeds.
- `view.test.ts` +44/−1: `readsOtherFiles`, `sameProperties` and the skip matrix.
- `test-bases-kanban-move.mjs` +84/−5: own skip, links-only skip, another file, diverging props, a `file.backlinks` formula, undo focus, and the 10k drop/undo/redo counters.
- `test-bases-b0.mjs` +26: P10, typing in a note while a 10,000-note board is open in another pane.
- New `bench-bases-kanban.mjs` +84: sizes 1,000, 10,000 and 50,000. It is not part of `npm test`.

No Rust, `cells.ts`, canvas, `package.json`, stylesheet or dependency change. No vertical margins were added to `.cm-content` children. No menu or popup animation was added.

## Measurements

All times below are ms. Headless Chromium, scratch vaults under `/tmp`. The fast path was already on disk when these benches ran, so there is no separate pre-edit browser capture of the old `update()`. The full arm is the same machine running the old path: the formula reads `file.backlinks.length`, the skip refuses, and the board selects and remounts. K5's published 10k figure is the before number for a normal own-write reconcile: pointer-up to column remount **63.2** (paint 6.9, save 8.8).

`node scripts/bench-bases-kanban.mjs`, one clean run, exit 0. `lastMs` is update work. `reconcileMs` is the wall from `setProperty`'s return. `long` lists long-task durations.

| Notes | Arm | reconcileMs | lastMs | Remount | full | skip | long |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- |
| 1,000 | skip | 22.6 | 0.4 | no | 0 | 1 | none |
| 1,000 | full | 30.5 | 8.2 | yes | 1 | 0 | none |
| 10,000 | skip | 27.8 | 2.8 | no | 0 | 1 | none |
| 10,000 | full | 45.3 | 23.2 | yes | 1 | 0 | none |
| 50,000 | skip | 32.3 | 11.5 | no | 0 | 1 | none |
| 50,000 | full | 137.6 | 117.4 | yes | 1 | 0 | 64 |

The 50k full-arm long task is the existing select (B7). The bench reports it and does not treat it as a skip failure. Skip asserts no remount, no long task and `lastMs` under 50.

Final `flock /tmp/grove-npm-test.lock npm test` on this source, 10,000-note move block. Reconcile here is "the card is already in its column", which is why it is faster than K5's remount:

- P4: p95/max frame **16.8/16.8**, handler **0.60**, script per move **0.087**, **11 layouts / 119 frames**, **3 rectangle reads**, **120 ghost checks, 0 late**, scroll **212/462 px**, no long task.
- P5: paint **6.8**, save **8.4**, reconcile **40.1**. `full` did not increase across the drop. No long task.
- P7: Undo paint **13.4**, save **2.8**, reconcile **29.6**, frame **1**. Redo paint **4.6**, save **2.5**, reconcile **37.6**, frame **1**. `full` stayed at the pre-drop value through undo and redo.
- 1,000-row Bases scroll max frame **16.8**.
- P10: typing frames beside the 10,000-note board **16.8**, then the quiet period remounted the columns. B0 typing frame on its own retained view was also **16.8**.

K4 budgets in that same run: P1 cold **63.7** with long task **62**, warm samples about **23.1 / 24.5 / 21.6** and no warm long task; P2 and P3 p95/max **16.7/16.8**. Canvas drag and zoom max frames were **16.8**. No timing flake needed a second run in the full suite.

P12, current source. K6 does not edit `model.ts`, search or the frontend vault helpers, so these pairs are a level check. The groups script's before column is `git show 08641e4` of `model.ts`.

- Frontend 5,000: tags/search/link-refresh medians **11.1 / 14.2 / 45.0**. K4's after-band was about **10.6 / 13.7 / 40.7**.
- Search work medians, Table/Grouped/Cards: 5,000 **6.5 / 10.3 / 1.6** (max **12.9 / 12.7 / 2.7**); 50,000 **8.9 / 58.7 / 19.2** (max **24.3 / 65.9 / 19.6**). Max frame **16.8** and no long task at either size. Narrowed rows **199 / 2,475**. The 50k grouped upper median **74.6** is sliced work, and the frame cap still held.
- Groups, passing rerun: 5,000 tag sort **8.23 → 9.44**, formula sort **9.29 → 9.06**. 50,000 tag sort **103.78 → 101.03**, formula sort **169.63 → 171.26**. Warm aggregate slices stayed about **5.0**. Browser 50k folders max frame **16.7** (select **108.1**, wall **387.4**, cpu **124.3**, 27 DOM rows). Distinct max frame **16.8** (select **105.9**, wall **580.6**, cpu **180.1**, 8 DOM rows).

The first groups browser run recorded folders max frame **33.3** and failed the existing assert at `bench-bases-groups.mjs`. The rerun above passed. That browser calls `createGroupedView` directly, so it never enters this fast path. The assert was left unchanged. The scratch `src/bases/.b5-model-before.ts` the script writes was removed by the script.

## Verification

- `npm run build` passed on the final source (tsc and Vite, 2,130 modules). The existing large-chunk warning remains.
- `npm run audit:offline` passed: **183 source files**, dist, CSP, capabilities and dependencies. No new dependency.
- Full Vitest: **72 files, 1,243 tests**, including 14 in `view.test.ts`.
- `cargo build --offline` and `cargo test --offline`: **73 passed, 0 failed, 4 ignored**. No Rust change.
- Complete `flock /tmp/grove-npm-test.lock npm test`: exit 0, about **623 s**, including posttest. K7 fuzz: **48 cases**, seed **27447**. The permanent geometry and real-mouse checks passed.
- The Kanban bench and the P12 scripts above passed on the final source. The groups frame miss was rerun once under the lock and then passed.

The first Kanban move run failed its undo assertion because a skip leaves the column mounted, so a wait for `isConnected === false` never completed. The wait now follows the file text, focus and the skip counter. The first full-size bench run failed a full-arm "no long task" assert at 50k (64 ms). That assert was removed; the skip arm still requires an empty long-task list and `lastMs` under 50. No budget in the plan was relaxed.

## Left open

- A `file.mtime` label can stay stale until the next full rebuild.
- A Rust `set_property` whose returned line or count disagrees with the re-read list takes the full rebuild. That is the safe fall-through.
- Body text typed into the same note during the 300 ms doc-quiet window after an open-note move can be skipped once, so a body tag waits for the next rebuild. A closed-note move does not have that window.
- An external body-only edit of that same path within 500 ms of a skip, with identical frontmatter, can be skipped once.
- A 50,000-note board that reads `file.backlinks` still pays the full select: **117.4** ms of work and one **64** ms long task.
- The groups bench's first browser sample missed its frame once. The rerun passed. It is recorded here and was not treated as a K6 regression.

No product question is pending. The plan already chose this fast path. No network, new packages or crates, GUI windows, real vaults, other worktrees or Herdr panes were used. Test vaults were under `/tmp`. Prompts, logs and regenerated screenshots are not committed. Screenshots are restored before every commit. Never pushed.
