VERDICT: OK

Reviewed Grok's Kanban K6 on `rebuild/k6-review-grok`, taken from `rebuild/kanban-k6-grok` at `8929d7d`. That branch is still at `8929d7d`. Its parent is `ba9e4ac`. At review time `rebuild/integration` was `565d826` and `rebuild/kanban-k8-grok` was `d4ed57c`. Nothing was pushed.

Relied on `rebuild/NOTES_KANBAN-K6.md`, `rebuild/NOTES_KANBAN-K5-REVIEW.md`, and `rebuild/KANBAN_PLAN.md` (§4.5 step 5 and the K6 row in §8). No Obsidian code, CSS, or assets were used.

## Scope

Grok's `ba9e4ac..8929d7d` stays on the update path: `view.ts` (own-write and links-only decisions, property compare, echo, counters), `kanban.ts` (the per-board mark), `view.test.ts`, `test-bases-kanban-move.mjs`, `test-bases-b0.mjs` (P10), and `scripts/bench-bases-kanban.mjs`. `cells.ts` is untouched. No Rust, dependency, stylesheet, or `package.json` change. NOTES_KANBAN-K6 counts that work as 6 files, +376/−9, excluding its notes file.

The skip still requires a Kanban view, no reload, no other-change flag, exactly one path, a mark or a live echo, and a source that does not read `this` or `file.backlinks` / `file.links` / `file.embeds` / `.hasLink(`. The property re-read must equal the painted list (key, type, value, line, count). Anything else selects and regroups. `patch` still moves the card, updates column counts and the toolbar count, and drops a card the filter no longer matches.

This review adds one fix, +80 / −11:

| File | +/− | Why |
|---|---|---|
| `src/bases/kanban.ts` | +8 / −4 | The mark stores the loaded note's editor text at the write. A closed note stores null. |
| `src/bases/view.ts` | +15 / −7 | The 500 ms echo is armed only for a loaded note, and only with the text the skip already saw. A property-type change sets `changeOther` before the 20 ms schedule. |
| `scripts/test-bases-kanban-move.mjs` | +57 | The five cases below. |

## What the echo was hiding

The open-note path emits `doc` immediately and `vault.written` about 300 ms later, when the editor saves. That second notice is a real echo, and it still skips when the text is the text the skip already accepted. A closed note has no second save: `setProperty` notifies the writing window itself, Rust does not emit `vault-changed` back to that window, and the watcher suppression covers the rest. Arming a 500 ms echo for a closed note hid a later edit of that same path whenever the frontmatter still matched.

The mark now remembers the editor text. `trySkip` refuses the own skip when the live document differs, which is the body typed into an open note during the 300 ms doc-quiet window. A closed note has no document, so the compare is skipped and the 50k closed-note bench stays a property compare. A mismatch falls through; `board.update` clears the mark once the rebuild proceeds, so the later save is not treated as another own write.

`settings` `types.json` used to call `schedule()` without a reason. A type change that landed in the same 20 ms bucket as an own write could look like a pure own write. The listener now sets `changeOther` first. `skipsFullRebuild` still requires `kanban()`, so a list or a table does not take the skip.

Browser checks on the move script, all passing:

- Closed-note body edit inside the old echo window rebuilds, and the card stays in the column the move painted.
- The same note's property edited from outside the board rebuilds, and the card follows the new value.
- A rename rebuilds and the old path is gone.
- Typing into the open note 40 ms after the move rebuilds, and the editor keeps the typed body.
- Two visible boards of the same base: the writer stays at `full` 5 and the other board goes 1 → 2.
- The existing filter-drop undo, the second Ctrl+Z, and P10 (typing beside a 10,000-note board with no prior drag) still rebuild.

## Performance

Headless Chromium, scratch vaults under `/tmp`. Skip budget: no remount, no long task, `lastMs` under 50. Frame budget: p95 and max at 16.7–16.8. The 50k full arm is the existing select (B7); the bench records its long task and does not treat it as a skip failure.

`node scripts/bench-bases-kanban.mjs`, one clean run, exit 0. Times are ms.

| Notes | Arm | NOTES_KANBAN-K6 reconcile / lastMs | This run reconcile / lastMs | long |
| --- | --- | ---: | ---: | --- |
| 1,000 | skip | 22.6 / 0.4 | 26.9 / 0.3 | none |
| 1,000 | full | 30.5 / 8.2 | 30.1 / 8.0 | none |
| 10,000 | skip | 27.8 / 2.8 | 30.4 / 3.0 | none |
| 10,000 | full | 45.3 / 23.2 | 48.5 / 26.4 | none |
| 50,000 | skip | 32.3 / 11.5 | 32.0 / 11.3 | none |
| 50,000 | full | 137.6 / 117.4 | 143.3 / 123.3 | 61 (NOTES had 64) |

Inside `npm test`, the 10,000-note move block:

| Check | NOTES_KANBAN-K6 | This `npm test` |
|---|---|---|
| P4 p95 / max | 16.8 / 16.8 | 16.8 / 16.8 |
| P4 handler / script per move | 0.60 / 0.087 | 0.50 / 0.111 |
| P4 layouts / frames / rects / ghost / scroll | 11 / 119 / 3 / 120 late 0 / 212×462 | same, no long task |
| P5 paint / save / reconcile | 6.8 / 8.4 / 40.1 | 6.9 / 8.5 / 40.1, `full` stayed put |
| P7 undo paint / save / reconcile, frames | 13.4 / 2.8 / 29.6, frame 1 | 13.2 / 2.9 / 29.5, frame 1 |
| P7 redo paint / save / reconcile, frames | 4.6 / 2.5 / 37.6, frame 1 | 4.5 / 2.4 / 37.5, frame 1 |
| P10 typing frame | 16.8, then the quiet period remounted | 16.8, and the quiet period rebuilt |

K4 in that same run: P1 cold 63.6 with long task 62, warm 21.9 / 24.0 / 20.7 and no warm long task. P2 p95/max 16.7/16.8, 15 cards. P3 p95/max 16.8/16.8, 7 columns, 5 visible. Canvas 300-card drag max 16.8. Canvas pan and zoom max 16.8. 1,000-row Bases scroll max 16.8. No timing flake needed a second run.

## Scratch merge

Throwaway worktree `/tmp/k6-int`, detached from `rebuild/integration` `565d826`, then `rebuild/kanban-k8-grok` `d4ed57c`, then this review at `149d103`. Removed afterwards. `rebuild/integration`, `rebuild/kanban-k8-grok`, and `rebuild/kanban-k6-grok` were not moved.

Two conflicts, both resolved only in that worktree:

- `rebuild/app/package.json`. Integration had added `test-canvas-zoom-trace.mjs` and `test-canvas-board-menu.mjs` to `test`. K8 had added `test-bases-list.mjs` to `posttest`. The resolution keeps the integration `test` script and inserts the list script before the property-edit fuzz.
- `rebuild/app/src/bases/view.ts`, one hunk at the resize observer. K8's observer keeps `!isList()`. K6's `trySkip` block follows it. `skipsFullRebuild` is still called with `kanban: kanban()`, so a list layout does not skip. The list pane, its update, and `listPane.dispose()` stayed on the merged path. `changeOther` on `types.json` stayed too.

`tsc --noEmit` in that tree exited 0. Vitest `view.test.ts`, `list.test.ts`, and `model.test.ts`: 29 passed. `test-bases-list.mjs` passed (10,000-note scroll max 16.8, no long task). `test-bases-kanban-move.mjs` passed, including the new cases and a 10k drag at p95 16.7 / max 16.8.

## Checks

From `rebuild/app`: `npm run build` exit 0 (the existing chunk-size warning on the main bundle remains, built in 216 ms), `npm run audit:offline` passed (183 source files), `flock /tmp/grove-npm-test.lock npm test` exit 0 (vitest 72 files, 1243 tests, then the browser scripts and posttest). From `rebuild/app/src-tauri`: `cargo test --offline` 73 passed, 4 ignored; `cargo build --offline` exit 0. No Rust file changed. Screenshots under `rebuild/round*-shots/` were restored and are not in the commits.

The UI was exercised in headless Chromium only. The task forbids opening a Grove window.

## Left open

- A `file.mtime` or `file.size` label can stay stale until the next full rebuild. The skip compares properties, and mtime is not one of them. Reading every note body on the hot path would miss the 50k budget (skip `lastMs` is 11.3 there).
- A Rust writer whose line or count differs from the editor parse takes the full rebuild. That is the safe direction.
- A closed-note body-only edit that arrives in the 20 ms bucket before the first `trySkip` is still coalesced with the own write. The index has no body, the closed note has no editor snapshot, and equal frontmatter skips once. An edit that arrives after that skip rebuilds.
- A links-only skip does not clear the mark. A later frontmatter change fails `sameProperties`. A body-only change of that same path, after the modify was swallowed into the links notice, is the same narrow window as the 20 ms case.
- `trySkip` takes the notice before `await index.notes()`. A newer event during the read sets `dirty` or `reload`, the mark stays, and the loop retries. A shared stale `notes()` read compares old props with the new painted props and rebuilds.
- The 50,000-note `file.backlinks` arm still pays the full select (this run `lastMs` 123.3, one 61 ms long task).
