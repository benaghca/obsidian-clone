# K5 — Kanban moves and history

Branch `rebuild/kanban-k5-codex`, from integration `298c169` (K1–K4 and K7).
Implements KANBAN_PLAN §8 K5, §4.5–4.6 and §5.2. No push.

Code commits:

- `22aebc8`: moves, CAS history, header drag, column seed and initial regressions.
- `0f738ec`: extended regressions, tag facts, filtered Undo and 10k budgets.
- `bbf8456`: lazy desktop API import, preserving the pure seed/helper path.
- `a141dcc`: synchronous history preview, overlay notice and gesture teardown.
- `89e0edf`: cancel keyboard pickup on focus departure and release refresh waiters.

## Behaviour and decisions

Cards now move through pointer drag, Space/arrows/Space, Alt+Left/Right, or
the context menu's Move to submenu. Escape, pointercancel and window blur
cancel without writing. Keyboard pickup also cancels on Tab, focus departure,
any new pointer interaction and window blur; Undo cancels an active pickup first.
The idle waiter rechecks state after waking. Formula, file-fact, this and ungrouped boards show a
lock/reason. Unsafe notes have no grab cursor and a disabled Move to item.
The metadata's unknown properties are checked immediately; ambiguous absent
metadata is checked asynchronously with dry_run before enabling the card.
This distinguishes a safe missing frontmatter from duplicates/unplaceable YAML.
The real writer still validates the fresh note at drop time.

Pointer movement uses a 4 px threshold, one detached ghost, one landing line
and a highlighted target. Three rectangles are sampled at the threshold;
the move/frame paths then use cached sizes, scroll offsets and arithmetic.
The ghost clone is prepared on pointerdown to keep threshold work below 1 ms.
Horizontal and per-column vertical auto-scroll run in the same rAF loop.
The source stays dimmed. Notices overlay the board without moving the track;
their horizontal position follows the cached scroll offset. The line follows the view sort, not a manual card
position. Covers and card dimensions carry into the ghost. Headers can be
dragged into Manual order, retaining hidden/added groups; one Undo restores
the prior automatic order, including when the history is used after a rebuild.
All menus use the existing instant menu component; no animation was added.

A drop immediately changes one row's props/context, splices the source/target
arrays using a binary insertion search with the view's existing comparator,
updates their counts, and paints their visible windows. The moved row is
brought into view. Filters/search can remove it, with an explanatory Undo
notice. A bounded row snapshot lets Undo preview a row even after a normal
rebuild has removed it from the selection. Other rows are not evaluated again
for the optimistic patch. Refresh waits for a gesture or active write instead
of cancelling the gesture or replacing the optimistic row with an old snapshot.
Afterwards the normal full refresh still runs: K6's skip-rebuild fast path is
not implemented here.

The queue serialises writes for a base in its tab, including rapid moves of
the same row using the preceding optimistic raw lines. Closed notes call
api.setProperty, then vault.written; no stale whole-note text is written from
JS. Loaded notes use editProperty on the live editor document and apply one
`input.property` transaction without calling the native writer. Normal save
owns disk writes for those notes, including cached loaded documents. Unsaved
body text survives. A conflict/refusal/error rolls the card back and reports
the reason; a conflict refreshes the actual external value without retrying
the move. Body and sibling changes made externally are preserved by K2 CAS.

History lives in a WeakMap of tabs, scoped by base path (or embed host), with
100 records per base and redo cleared by a new move. Property operations keep
exact raw before/after lines. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work in the board,
excluding fields and open menus. The note's own Undo followed by board Undo
is unchanged rather than a second revert. A stale Undo keeps its entry and
writes nothing. A confirmed history record is previewed synchronously from
the current local metadata/editor and stored row/tag snapshot, before fresh
I/O validation. A 140 ms delayed preflight test verifies immediate painting
while the saved note is unchanged. Conflict rolls the preview back. A busy
queue previews when its operation reaches the front. Batch replay still
validates every operation before writing; later
failure compensates completed writes in reverse with CAS. A transport/fsync
error may arrive after rename, so that uncertain operation is also checked
by CAS compensation. The notice names any operation that could not be restored.
There is no multi-select/batch UI; the replay machinery supports the planned
multi-operation record. Header history uses a fresh groupBy check and the
existing YAML writer, and cannot overwrite a group order changed meanwhile.

D4/D10/D15 are retained: No value writes an empty scalar or list, missing
empty targets are unchanged, lists move as whole values, quotes/key spelling/
list style survive, commented/unsupported values are refused, and only closed
notes use Rust. Date inference and user-chosen types use the existing formatter.
The model now resolves a preserved key's case consistently with CAS, so moving
`Status: "todo"` through a `status` grouping renders in the correct column.

For tag moves, the final filter decision uses fresh full tags from the saved
index or the live editor, not subtraction of frontmatter tags from a combined
set: a removed frontmatter tag may still exist in the body. The existing tag
cache is invalidated before reconciliation. Other property moves add no tag
query. Column + keeps ordinary filter defaults, then explicitly seeds the
writable grouped property, including lists and No value. It reuses the same
property formatter instead of treating the column as a scalar-only filter.

## Files and ownership

Implementation, excluding this notes file: **14 files, +789/-18**.

- New move.ts +154: typed target, editor/native routing, gesture and keyboard.
- New history.ts +63: queue, bounded history, batch preflight/compensation.
- kanban.ts +253/-12: hooks, optimistic windows, checks, notices and headers.
- newRow.ts +10: explicit column seed using the property edit reference.
- Tests: history.test.ts +39, move.test.ts +30, model.test.ts +5 and the new
  browser script +212. The latter runs permanently in posttest.
- Necessary small exceptions: model.ts +4/-2 exports its existing context
  builder and aligns key lookup with case-preserving CAS; view.ts +3/-2 passes
  scope/count/search hooks and the already-read properties map, and waits for
  gesture/write completion before refreshing; GroupMenuHost's save return type
  +1/-1 and menus.ts +1 expose its existing write promise so header history can
  wait for completion; package.json +1/-1 adds posttest; the new move stylesheet
  +13 supplies ghost/line/notice/lock styles. No vertical margins were added to
  cm-content children and no existing geometry assertion was weakened.

No Rust, backend, API schema, dependencies, table cell writer, Kanban layout
maths or native permissions changed. K6 reconciliation and K8 list layout are
left to their assigned pieces.

## Measurements

All times below are ms. Headless Chromium, real CDP pointer/keys, scratch mock
fixtures. Existing K4 wheel method is retained: 5,000 px steps avoid headless
Chromium's roughly 30 fps small-wheel animation. Before = 298c169 for the
archived shared benches; K4 before was measured before source edits here.
One paired comparison is not a causal claim for small differences under load.

Final complete npm run, 10,000 balanced notes, 120 moves at 8 ms across
three columns with both auto-scroll axes:

- P4: p95/max frame **16.7/16.8**, maximum handler **0.40**, aggregate script
  per input **0.091**. **11 layouts / 119 frames**, **3 initial rectangle reads**,
  **120 next-frame ghost checks, 0 late**, horizontal/vertical scroll **212/462 px**,
  no long task. The track top is asserted unchanged while dragging. Asserted handler and aggregate script ≤1 ms; frame slack is
  the plan's standing test allowance. An earlier threshold event took 1.4 ms;
  moving the clone preparation off that event reduced it to 0.5–0.6 ms.
- P5: pointer-up to optimistic paint **6.9**, mock CAS return **8.8**, normal
  property re-read/reconciliation painted **63.2**. No long task. The 180 ms
  delayed-writer behaviour case separately proves paint precedes completion.
- P7: from the native key event, Undo paint **10.1**, save **3.5**, reconcile
  **46.6**; Redo paint **14.9**, save **2.4**, reconcile **51.4**. Both painted
  on **frame 1**. Paint ≤20 ms and completion/reconcile ≤100 ms are asserted.
  These are mock UI figures, not real-disk fsync timings. K2's native write is
  unchanged; its documented disk cost remains off the GTK thread.

K4 before → final implementation, same checked-in script:

- P1 warm median **21.4 → 17.7**, no warm long task. The intermediate second
  metadata read cost 27.9 ms; reusing the view's map removed that duplicate work.
- P1 cold **61.1 → 68.2**, recorded long task **59 → 67**. This raw increase
  is reported. Cold property-read/select already crosses 50 ms for both tables
  and boards (K4/B7 notes); K5 does not fix that inherited cold-start work.
- P2 p95/max **16.7/16.8 → 16.8/16.8**, **15 cards** in the tall column.
- P3 p95/max **16.7/16.8 → 16.7/16.8**, **7 columns** for 5 visible.
- P11 first embedded board **15.4 → 15.5**, height 400, following line stable.
  The interactive K5 embed remains 400 px inside a 455 px widget with a 24 px
  following gap. Focus caused a **0.875 px** screen/preceding-content shift;
  widget height and following gap did not change. The test checks those exact
  widget invariants and the standing ≤1 px screen tolerance.

P12, all three existing scripts before/after (six runs passed):

- Frontend 5k tags/search/link-refresh medians **11.9/19.5/50.6 →
  11.4/12.4/40.4**. Payload parse **0.5 → 0.6** (+0.1), page **5.3 → 5.0**;
  counts and payload sizes unchanged. Setup **107.2 → 74.3**.
- Group-model 5k tag/formula sort **9.623/10.695 → 9.440/10.498**;
  50k **110.774/198.224 → 98.735/156.755**. Warm aggregate CPU medians
  5k **13.434 → 10.168**, 50k **124.428 → 103.706**. Max final slices ~5.1 ms.
- 50k folder browser CPU/wall **135.7/440.1 → 122.7/379.7**; distinct
  **226.1/728.6 → 183.5/582.1**. DOM rows stayed 27/8; max frames 16.8.
- Search Table/Grouped/Cards work medians: 5k **6.6/9.8/1.7 →
  6.1/10.9/1.6**; 50k **8.7/67.9/17.8 → 8.8/55.4/18.4**. Raw increases:
  5k grouped +1.1, 50k table +0.1, 50k cards +0.6. At 50k upper key-to-paint
  medians **17.5/88.7/33.9 → 25.7/70.6/35.7** (table +8.2, cards +1.8).
  Table work/one-frame paint was effectively unchanged; upper bounds include
  the driver/frame phase. Narrowed rows stayed 199/2,475, max frames 16.8,
  no search long tasks. Grouped totals span scheduled slices, not one task.

The shared-bench pair preceded the final API lazy-import, history-preview and
keyboard-cancellation refinements; those do not alter the benchmarked selection,
search or grouping paths. All K4/K5
permanent budgets passed again in the full suite on the final source.

## Verification

- Build and offline audit passed on final source: **183 source files**, dist,
  CSP/capabilities/dependencies; existing large-chunk warning remains.
- Full Vitest passed: **72 files, 1,235 tests**. Focused history/move/model:
  20 tests. Existing results.test also checks pure seed import without window.
- Cargo build/test --offline passed: **73 passed, 0 failed, 4 ignored**, with
  bin/doc tests passed. No native source changed.
- Dedicated K4/K5 browser scripts passed, including native pointer,
  keyboard, delayed write, rapid moves, conflict/refusal rollback, stale Undo,
  editor Undo/no-op board Undo, unsaved editor text, filters, case/quotes,
  list moves/seeds, body tags, header Undo, native Move to in an embed,
  embed geometry and leaving an auto-scroll drag without a write. Native Tab,
  programmatic focus departure, a pointer interaction and window blur all cancel
  keyboard pickup, write nothing and allow a newly created note to refresh. Pending fills
  of an unmounted column are ignored. A note loaded during API resolution is
  rerouted to its live editor before dispatching any native write.
- Complete `flock /tmp/grove-npm-test.lock npm test`: **PASS**, exit 0,
  **635 s** including the shared lock, with the entire posttest chain.
  K7 fuzz: **48 cases**, seed **27447**, max input **1 MiB**; 39 done,
  4 refused, 1 conflict, 4 unchanged. The permanent geometry/real-mouse
  checks and the new keyboard cancellation regression passed.

The first complete run stopped before browser tests because newRow's new
helper imported the desktop API eagerly into a pure Node test. Fixed by
loading that API only for an actual closed-note write; no existing test was
mocked or relaxed to hide it. Other focused failures exposed and fixed refresh
interruption of drag/optimism and next-click suppression. Fixture mistakes
(automatic order after header Undo, off-screen virtual targets, expecting only
flow style for a newly seeded list) were corrected to check the actual contract.
The next full run reached K5 posttest but failed P7 paint timing. One unchanged
app-code retry reproduced it: 29.4 ms, frame 2 (save 13.9, reconcile 55.7).
That was a real sequencing defect: the preview waited for async preflight.
It now paints locally before validation; writes remain gated by all preflights.
No timing assertion was relaxed. A subsequent complete run passed, including
K4/K5 budgets and the K7 short fuzz (48 cases, seed 27447, 1 MiB input).
A final focused probe then found Tab after keyboard pickup could leave refresh
waiting forever. The cancellation paths above fix the reproduced defect; the
permanent browser regression and the complete full run after that fix both pass.

## Hand-off and scope

K6 can use board.idle and the metadata-map argument to update, but must keep
gesture/write serialization and raw CAS history. Its own-write skip path is
still outstanding. K7's property fuzz/crash tests remain unchanged. R4/R5
(other-window unsaved saves and the external final-stat/rename window) retain
their approved limits. Plan R2's real WebKitGTK drag/scroll check remains for
Chris after K5; this task forbade GUI windows.

No product question is pending. Behaviour comes from the approved Kanban
plan, K2/K3/K4 and their review notes; no fresh help lookup, Obsidian code or
assets. No network, new packages/crates, GUI windows, real vaults, other
worktrees or Herdr panes were used. Test vaults were under /tmp; browser
profiles used the existing ignored scratch harness. Git hooks were disabled.
Prompts, logs, benchmark scratch and regenerated screenshots are not committed.
Screenshots are restored before every commit. Never pushed.
