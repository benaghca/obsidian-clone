# T1: flaky backlink click in test-r27l

Fixed on `rebuild/t1-flaky-grok`, 2026-10-28. Local commits only; nothing pushed.

## Cause

This is a test race. The backlink row is clickable once the right dock has finished opening and the row is inside the visible dock. It is not clickable just because the name node exists.

`scripts/test-r27l.mjs` created `Linked.md`, opened Backlinks, slept 1500ms, then clicked the center of `.backlink-pane .search-result-file-name` as soon as that node existed. Two things make that point miss:

- The right dock starts collapsed and `backlink:open` animates its width over 130ms. The row is laid out at its final x (the contents stay 300px wide and are anchored to the right edge) while the dock is still narrow, so the name is clipped. `elementFromPoint` on the name center hits `.view-content`. A probe with the old 1500ms delay saw the name appear in about 150–190ms with a running width animation and a dock about 80px wide. After `scrollIntoView`, the point was still over the editor. `click()` then waits only 40ms before the press, which sometimes lands after the animation uncovers that x and sometimes does not.
- Welcome's backlinks include Big note, so Linked starts below the fold (y around 1580 in an 800px window). Before the scroll, `elementFromPoint` is nothing.

The old `sleep(1500)` only tried to outrun the 1000ms link-index timer. When the name appears after the dock is already 300px, the click is reliable once the row is scrolled into view. When the name appears during the width animation, the same click flakes. Fifteen unmodified runs under the shared test lock passed, including with two spin loops. The miss showed up in the probe's hit-test, not as a failed assertion on that idle machine. The row's click handler did not need a change.

## Change

`rebuild/app/scripts/test-r27l.mjs`: +29 / −11.

After `backlink:open`, the test polls for up to 8 seconds. It clicks only when the right dock has no running width animation, is at least 280px wide, the Linked name is scrolled into that box, and `elementFromPoint` is the `.search-result-file-title` that contains that name and is not the collapse icon. A link refresh can rebuild the list, so it tries again until `Welcome` is no longer the active note and `Linked.md` is, or the deadline passes. If the name never becomes hittable, the failure is "the new note did not show in backlinks". If a hittable click never opens the note, the failure is still "the backlink row did not open". The other assertions in the file are unchanged. No app, CSS, or Rust code changed.

## Same waiting pattern elsewhere

Left alone. Only this script takes a point from a backlink file name and clicks it.

- `scripts/test-r27n.mjs` waits until the dock is wider than 280px, then `sleep(200)`, then checks the drawn width is 300px. The width check can pass mid-animation. It does not click a below-fold backlink name.
- `scripts/test-round18.mjs` uses `sleep(250)` after `backlink:open`.
- `scripts/test-r27o.mjs` already waits until the dock is about 300px wide and mention rows exist before it measures.

## Tests

- Fixed `node scripts/test-r27l.mjs`, 30 times in a row under `flock /tmp/grove-npm-test.lock`: 30/30 passed. These 30 runs did not add extra spin loops. Two loops on this 24-core machine had not reproduced the assertion, and leaving them up would have slowed other agents waiting on the same lock. One orphaned `node -e 'while(true){}'` from that diagnosis was stopped before the finish suite ran.
- `npm run audit:offline`: passed, 164 source files. That script builds, so `npm run build` is covered.
- `cargo build --offline` and `cargo test --offline` from `rebuild/app/src-tauri`: build passed. `grove_lib` 42 passed, 1 ignored (`index::bench::bench_vault`), binary 0, doc-tests 0. Registry was not contacted.
- `npm test` under the lock: browser discovery 4 passed, 0 failed. Vitest 55 files, 389 tests passed. Browser scripts printed 804 PASS lines and then aborted in `scripts/test-canvas-editing.mjs` with `300-card drag frames under 20ms (max 33.4ms, 46 intervals)`. That is the known canvas timing flake. The assertion was not changed, and no canvas file was edited.
- One rerun of `scripts/test-canvas-editing.mjs`: passed, including `300-card drag frames under 20ms (max 16.8ms, 49 intervals)`.
- The scripts that did not run after that abort, from `test-canvas-cards.mjs` through `test-r27t.mjs` plus posttest `test-bases-config.mjs`, then ran under the lock and exited 0. The log has 1144 PASS lines from those scripts (1148 including four lines echoed from the rerun tail). `test-r27l.mjs` passed inside that chain.

Screenshot fixtures under `rebuild/round*-shots` were restored with `git checkout` and are not part of the commit.

## Left

Nothing in the app. No decision needed. The 300-card drag check is still a timing flake: it failed once at 33.4ms and passed once at 16.8ms on the rerun.
