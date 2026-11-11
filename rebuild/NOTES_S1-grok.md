# S1 notes (grok)

Invisible data-loss fixes only. Nothing on screen changed: no "couldn't save" notice, status mark, toast, prompt, or dialog. A save that finishes still waits the same 300 ms after the last keystroke (500 ms for settings). A close can pause for the write itself, and gives up after 2 seconds if a write hangs.

## In plain words

Grove was dropping text you had just typed.

- Closing with Alt+F4 or the compositor (not only Grove's own X) started the save and tore the page down without waiting. The same hole covered a pending canvas, drawing, or settings write.
- A keystroke during a rename stayed on a timer for the old path. When that timer fired, the note had already moved, and the write was thrown away. A save already in flight had the same hole: the bytes went to the old path and the new path never got them.
- A failed save was only logged. The app forgot the note was unsaved, so a reload or a quit could replace the text you still had. Merging two notes deleted the source even when the combined text never reached disk.

Those paths are closed. A failed save stays dirty and is tried again (half a second, then 1, 2, 4, and at most 8 seconds). A later success clears it. Merge leaves the source on disk when the target save fails. The merged text stays in the target and is retried. No dialog.

## What changed

- `src/quitFlush.ts` listens for Tauri's close request, calls `preventDefault` before the first await, flushes notes, canvases, drawings, and settings, and then destroys the window. The wait is raced with 2 seconds (`QUIT_FLUSH_MS`). A second close request joins the same wait. Grove's X still flushes and then calls `close()`, which runs this same handler. `beforeunload` starts the same flush but cannot wait. `core:window:allow-destroy` was added next to `allow-close` in `src-tauri/capabilities/default.json`. `src-tauri/src/lib.rs` was not touched.
- `src/noteEditors.ts` keeps a dirty set apart from the timers. `move()` re-keys the save timer, the retry timer, the dirty set, and the in-flight slot, and the timer reads the path when it fires. If the write already started at the old path, a follow-up write uses the new path. `flush` / `saveNow` resolve `false` when the write failed. A keystroke that lands during the write is included before `flush` resolves. `reload` will not replace text that is still dirty or in flight.
- `src/fileOps.ts` `mergeNote` returns before `deleteFile` when `saveNow` is not successful. `src/workspace.ts` `saveNow` returns that boolean.
- Canvas and drawing saves share `src/fileSave.ts` (debounce, dirty, backoff, flush). The two loops were the same shape; the note loop stays in `noteEditors.ts` because a rename has to retarget the path. This is not a new pending-saves service. Open canvases are tracked in `src/canvas/pending.ts`, the same way drawings already were. A write that has started is remembered with its path, so closing the tab does not drop it, and a rename of one file does not wait on an unrelated write.
- `src/settings/store.ts` `flush` returns a promise that settles when the write settles. A failed settings write is retried on the same backoff and is included the next time `flush` runs.
- `src/readOrdering.test.ts` gives the reload stub the new maps (`dirty`, `retryTimers`, `slots`). `reload` reads those fields directly so that stub, which is not a `NoteEditors` instance, still runs the real body. No assertion there was weakened.

Out of scope, left as they were: a visible failure notice, conflict detection, CRLF/BOM, index batching, moving Rust commands off the GTK thread, and re-keying a canvas or drawing path when its file is renamed. An external change still wins over a canvas or drawing edit that has not been saved.

## How the tests were proved

`src/saveLoss.test.ts` is part of `vitest run`. No new npm script. No window.

Checked out the pre-change copies of `noteEditors.ts`, `fileOps.ts`, `settings/store.ts`, `workspace.ts`, `main.ts`, `canvas/view.ts`, `drawing/view.ts`, `drawing/pending.ts`, `readOrdering.test.ts`, and `capabilities/default.json` from `46b072f`, left the new test file in place, and ran `npx vitest run src/saveLoss.test.ts`. 8 failed, 3 passed:

- A keystroke waiting out a rename: `writeNote` was called 0 times. Expected `("New.md", "typed")`.
- An in-flight save during rename: the only call was `("Old.md", "typed")`, not `New.md`.
- A flush while a second keystroke arrives: the only call was `("A.md", "one")`, not `"two"`.
- A failed write: `flush()` resolved `undefined`, not `false`.
- Reload after that failure: the doc became `"from-disk"`. Expected `"kept"`.
- `mergeNote` when the target save fails: `deletePath` was called once with `("From.md", false)`.
- Settings flush: the return value was `undefined`, not a `Promise`.
- The close test in that same run did not finish cleanly: the settings test above threw before putting `showLineNumber` back, so the later `set(true)` was a no-op and `writeConfig` was never called. That failure is not the close-path proof.

The merge-success test passed on that tree too, because the old `mergeNote` always deleted. It still passes.

The canvas/drawing retry and the close timeout passed in that run only because `fileSave.ts` and `quitFlush.ts` are new files and were still the fixed copies. They were proved by putting the old behaviour back inside those files:

- `fileSave` cleared dirty on a failed write and did not arm a retry. `a canvas or drawing write stays dirty and retries until it succeeds` failed at `expect(disk.dirty).toBe(true)` (received `false`).
- `bindCloseFlush` called `destroy()` without awaiting the flush. Both close tests failed at `expect(destroy).not.toHaveBeenCalled()`: destroy ran immediately.
- With only `settings/store.ts` restored to `46b072f` (flush starts `writeConfig` and returns nothing) and vitest `--no-cache`, the close test failed after the drawing write was released: `expect(destroy).not.toHaveBeenCalled()` at the settings gate. The window was destroyed before the settings write finished. One `Promise.resolve()` was not enough to see that, so the test drains 20 microtasks after each release.

Restored the fixed tree and ran `npx vitest run src/saveLoss.test.ts src/readOrdering.test.ts src/fileOps.test.ts --no-cache`: 3 files, 37 tests passed. `tsc --noEmit` passed.

## Close path without a real webview

No Grove window, no Tauri window, and no WebKitGTK or WebView2 process was opened. Browser verification was skipped because this brief forbids a GUI and requires that nothing visible change.

The wait is reasoned from Tauri 2.12.4 as shipped in this app:

- Rust `tauri::manager::window`: if the page has a JS listener for `tauri://close-requested`, the window `prevent_close()`s and then emits the event. That is Alt+F4 and the compositor, and also Grove's X, because `win.close()` emits the same event.
- `@tauri-apps/api` `onCloseRequested` awaits the handler, then calls `destroy()` unless `preventDefault()` was called. `destroy()` does not emit `close-requested` again.
- The handler calls `preventDefault()` synchronously, awaits the flush (or the 2 second timeout), then `destroy()`. `core:window:allow-destroy` is the permission that call needs. `allow-close` was already granted.

`beforeunload` cannot wait for an IPC write. It only starts one. The unit test drives `bindCloseFlush` with a fake window object, so the wait and the timeout are asserted without a webview. A hung IPC is not cancelled when the timeout wins; the page is destroyed and that write may still be in flight.

## Size

No new dependency. No new crate. `package.json` was not changed.

Net change is about +688 lines, almost all TypeScript, plus one JSON permission line. `git diff --numstat` on the tracked files is +291 / −101. New files add 498 lines.

| File | Net |
| --- | ---: |
| `src/noteEditors.ts` | +145 (637 lines) |
| `src/settings/store.ts` | +24 (214) |
| `src/main.ts` | +12 (553) |
| `src/drawing/pending.ts` | +13 (37) |
| `src/workspace.ts` | +4 (705) |
| `src/canvas/view.ts` | +3 (570) |
| `src/fileOps.ts` | +1 (263) |
| `src/drawing/view.ts` | −13 (397) |
| `src/readOrdering.test.ts` | 0 (one line edited) |
| `src-tauri/capabilities/default.json` | +1 |
| `src/fileSave.ts` | new, 119 |
| `src/quitFlush.ts` | new, 46 |
| `src/canvas/pending.ts` | new, 34 |
| `src/saveLoss.test.ts` | new, 299 |

No file is over 800 lines. The longest touched file is `src/workspace.ts` at 705, four lines above where it started. Rust was not changed, so `cargo test` was not run.

## Commands

From `rebuild/app` on `rebuild/s1-grok`:

- `flock /tmp/grove-npm-test.lock npm test` exited 0, including posttest. Vitest: 100 files, 1556 tests passed. The known graph feel gap is still there (p95 33.4 ms) and the suite still passed with `GROVE_FEEL_STRICT_GRAPH` unset.
- `npm run build` exited 0 (`tsc --noEmit` and `vite build`). The existing chunk-size warning remains.
- `npm run audit:offline` exited 0: 223 source files, dist, CSP, capabilities, and dependencies checked.

The suite rewrote screenshots under `rebuild/round*-shots`. Those were put back with `git restore` and are not in this commit.

`scripts/test-canvas-notes.mjs` was not changed. On this worktree `node_modules` had been a symlink into another worktree, so Vite served `@codemirror/view` without rewriting its imports and that script failed here and on unmodified `46b072f`. A local copy of `node_modules` (gitignored, not part of this commit) made the script pass. No Grove window was opened. The suite's own headless Chromium is the browser run.
