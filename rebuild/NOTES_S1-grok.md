# S1 notes (grok)

Invisible data-loss fixes only. Nothing on screen changed: no "couldn't save" notice, status mark, toast, prompt, or dialog. A save that finishes still waits the same 300 ms after the last keystroke (500 ms for settings). A close can pause for the write itself, and gives up after 2 seconds if a write hangs.

## In plain words

Grove was dropping text you had just typed.

- Closing with Alt+F4 or the compositor (not only Grove's own X) started the save and tore the page down without waiting. The same hole covered a pending canvas, drawing, or settings write.
- A keystroke during a rename stayed on a timer for the old path. When that timer fired, the note had already moved, and the write was thrown away. A save already in flight had the same hole: the bytes went to the old path and the new path never got them.
- A failed save was only logged. The app forgot the note was unsaved, so a reload or a quit could replace the text you still had. Merging two notes deleted the source even when the combined text never reached disk.

Those paths are closed. A failed save stays dirty and is tried again (half a second, then 1, 2, 4, and at most 8 seconds). A later success clears it. Merge leaves the source on disk when the target save fails. The merged text stays in the target and is retried. No dialog.

## What changed

- `src/quitFlush.ts` listens for Tauri's close request, calls `preventDefault` before the first await, flushes notes, canvases, drawings, and settings, and then destroys the window. A flush that returns false is retried with the usual backoff until the saves are clean or 2 seconds from the start of the close (`QUIT_FLUSH_MS`). A second close request joins the same wait. Grove's X only calls `close()`, so that handler owns the deadline. A hung write cannot keep the button from starting it. `beforeunload` starts the same flush but cannot wait. `core:window:allow-destroy` was added next to `allow-close` in `src-tauri/capabilities/default.json`. `src-tauri/src/lib.rs` was not touched.
- `src/noteEditors.ts` keeps a dirty set apart from the timers. `move()` re-keys the save timer, the retry timer, the dirty set, and the in-flight slot, and the timer reads the path when it fires. If the write already started at the old path, a follow-up write uses the new path. `flush` / `saveNow` resolve `false` when the write failed. A keystroke that lands during the write is included before `flush` resolves. `reload` will not replace text that is still dirty or in flight.
- `src/fileOps.ts` `mergeNote` returns before `deleteFile` when `saveNow` is not successful. `src/workspace.ts` `saveNow` returns that boolean.
- Canvas and drawing saves share `src/fileSave.ts` (debounce, dirty, backoff, flush). The two loops were the same shape; the note loop stays in `noteEditors.ts` because a rename has to retarget the path. This is not a new pending-saves service. Open canvases are tracked in `src/canvas/pending.ts`, the same way drawings already were. A write that has started is remembered with its path, so closing the tab does not drop it, and a rename of one file does not wait on an unrelated write.
- `src/settings/store.ts` `flush` returns a promise that settles when the write settles. A failed settings write is retried on the same backoff and is included the next time `flush` runs.
- `src/readOrdering.test.ts` gives the reload stub the new maps (`dirty`, `retryTimers`, `slots`). `reload` reads those fields directly so that stub, which is not a `NoteEditors` instance, still runs the real body. No assertion there was weakened.

A canvas or drawing is owned by its path (`src/ownedSave.ts`). Rename retargets that writer. Delete discards it so a retry cannot recreate the file. Closing the tab keeps a failed save, and opening the file again uses the same writer. An external change still wins over a canvas or drawing edit that has not been saved.

Out of scope, left as they were: a visible failure notice, conflict detection, CRLF/BOM, index batching, and moving Rust commands off the GTK thread. Direct process exit is S5's worker shutdown. This slice does not add a Rust `ExitRequested` hook, and destroying the page on the 2 second timeout does not cancel a write the worker has already accepted.

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

## Review fixes

Codex failed `89bd364`. A pending or retrying save must not outlive the vault or the path it belongs to. Still nothing on screen: no notice, toast, status mark, or dialog.

- **Vault switch.** `useVault` opened the new vault and then reloaded, so the old page's `beforeunload` could write vault A's text onto the same name in vault B. `commitVaultSwitch` flushes notes, canvases, drawings, and settings while the root is still the old vault. If anything is still dirty, the switch stops and the retries stay armed. There is no notice. Pop-out windows share the backend root, so each window flushes on its own page and answers before this page seals. This page seals only after they agree, and it seals before `openVault` / `createVault`, so a timer here cannot write after the root changes. The seal stays up across the reload. A write that never settles is awaited. The switch does not time out and then open. An edit that arrives after the seal, including one typed while the new vault is opening, puts the old root back and is written there. The page stays sealed only when that root cannot be restored. `core:window:allow-get-all-windows` lists the other windows. If that list fails, the switch stops and nothing is sealed.
- **Rename and delete.** Notes, canvases, and drawings are held before `renamePath` or `deletePath`. The hold's flush writes the current text first. A delete then trashes those bytes. A flush that returns false does not delete, and the retry stays. A write already sent finishes on the old path. A keystroke or a retry during the IPC does not send another write until the rename has retargeted the path, or until a failed rename releases the old path. `save` does not wait on the rename, or the flush inside the rename would deadlock. After a successful delete, the owned canvas and drawing retry is dropped so it cannot recreate the file. A failed delete releases the hold and leaves the retry. Rename still continues when its flush returns false, because the dirty text moves with the file.
- **Close.** All four save kinds report clean or dirty. A dirty result is retried until clean or the same 2 second deadline, counted from the start of the close. Grove's X calls `requestClose`, which is only `win.close()`.
- **Canvas and drawing tabs.** The path owns the dirty text. Disposing the tab does not forget a failed save, and a second view of the file adopts it. Quit flushes that writer along with any tab that is still open.
- **Settings.** Each real change bumps a generation. `flush` writes the newest snapshot. An older write finishing does not clear a newer one.
- **Debounce.** A follow-up that a timer started waits out the rest of the 300 ms. `flush` still writes immediately. Settings stay at 500 ms.

Red proof for this pass: the new tests were run with the old order put back inside the fixed files (open the vault before any flush, no hold across rename, close destroys when the flush returns false and does not retry, settings `flush` only joins the write already in flight, closing a canvas drops its writer, delete does not discard the retry, the X button flushes and then calls `close()`, and a follow-up save ignores a debounce that has not elapsed). `npx vitest run src/saveLoss.test.ts`: 16 failed, 10 passed. The new vault, rename-while-in-flight, canvas rename, delete, closed-tab, close-retry, settings-generation, X-button, and debounce tests failed. One older settings test also failed under that mutation, because `flush` no longer started a write. The failed-rename test still passed: the rename threw before the path moved, so the timer still wrote the old path. Restored the fix and ran `saveLoss.test.ts`, `fileOps.test.ts`, `links/updateRace.test.ts`, and `readOrdering.test.ts`: 4 files, 55 tests passed.

Browser verification was skipped. Nothing visible changes, and the brief forbids opening Grove, Tauri, or a visible browser. No window was opened for this pass. The locked `npm test` still launches its own headless Chromium.

## Commands

The first commit (`89bd364`), from `rebuild/app` on `rebuild/s1-grok`:

- `flock /tmp/grove-npm-test.lock npm test` exited 0, including posttest. Vitest: 100 files, 1556 tests passed. The known graph feel gap is still there (p95 33.4 ms) and the suite still passed with `GROVE_FEEL_STRICT_GRAPH` unset.
- `npm run build` exited 0 (`tsc --noEmit` and `vite build`). The existing chunk-size warning remains.
- `npm run audit:offline` exited 0: 223 source files, dist, CSP, capabilities, and dependencies checked.

The suite rewrote screenshots under `rebuild/round*-shots`. Those were put back with `git restore` and are not in this commit.

`scripts/test-canvas-notes.mjs` was not changed. On this worktree `node_modules` had been a symlink into another worktree, so Vite served `@codemirror/view` without rewriting its imports and that script failed here and on unmodified `46b072f`. A local copy of `node_modules` (gitignored, not part of this commit) made the script pass. No Grove window was opened. The suite's own headless Chromium is the browser run.

This review pass, still from `rebuild/app` on `rebuild/s1-grok`, one `flock /tmp/grove-npm-test.lock` for all three:

- `npm test` exited 0, including posttest. Vitest: 100 files, 1571 tests passed. The known graph feel gap is still there (p95 33.4 ms) and the suite still passed with `GROVE_FEEL_STRICT_GRAPH` unset.
- `npm run build` exited 0 (`tsc --noEmit` and `vite build`). The existing chunk-size warning remains (index about 1306 kB).
- `npm run audit:offline` exited 0: 226 source files, dist, CSP, capabilities, and dependencies checked.

Screenshots under `rebuild/round23-shots` through `rebuild/round33-shots` were rewritten and put back with `git restore`. They are not in this commit. Rust was not changed, so `cargo test` was not run. No file is over 800 lines. `src/saveLoss.test.ts` is 691. New files: `src/saveSeal.ts`, `src/ownedSave.ts`, `src/vaultSwitch.ts`.

## Review 2

Codex failed `e63e2c7`. Five blockers, plus every path where a pending save can outlive the note. Nothing on screen changes. No new package. Regressions live in `src/saveBarrier.test.ts`. The failed-delete case in `src/saveLoss.test.ts` now expects a failed flush to refuse the delete.

- **Vault barrier.** Editors stay editable while `open` runs. A direct writer (an unloaded note, a property write, an attachment, a settings file, a base file, a drawing export) has no dirty set, so `writeVaultNote`, `writeVaultConfig`, and `runOnVault` queue while saves are sealed and do not call the backend. Note editors stay dirty and reschedule, because the document still holds the text. After the other windows agree, this page seals, opens, then asks again. If anything is dirty, or a peer says so, it opens the old root and only then unseals and flushes, including the queue. If the old root cannot be restored, the page stays sealed and reloads. A dry-run property read is not queued. The vault switch does not wait on `runOnVault` inside `open`.
- **Peer cancel.** The thaw carries the transaction id. A peer whose flush finishes after the 2 second wait sees that id and does not seal, so its next edit still saves. Two windows that start a switch together: the smaller id is the one that opens. The other becomes a peer of that id. Its later unseal does not lift the winner's seal. The regression builds two coordinators, so they do not share one module's cancelled set. Both may end sealed. The test checks that exactly one `open` ran and that the opener stays sealed.
- **Reload notice.** If the reload event fails after the new vault has opened, the commit still returns true, this page reloads, and the seal stays up. A later edit does not call `writeNote`.
- **Delete.** The hold blocks timers. The explicit flush still writes. The trash receives the edit that was waiting out the 300 ms debounce. A flush that returns false does not call `deletePath`. A sealed page does not start a rename or a delete.
- **Drawing prepare.** The view that last edited owns the snapshot a flush writes. A sibling opened later does not replace it, and it does not drop a newer generation while that write is telling the vault. An explicit flush bypasses a hold. A timer does not. `changed()` does not serialize the scene an extra time.
- **Other windows.** `installPathBarrier` listens even when this is the only window, so a pop-out that opens later can hold this page before a rename or delete. Peers flush and stay held until it finishes. A failed peer flush aborts with no dialog. If the window list fails, the rename or delete does not start.

`isTauri` is false when there is no `window`, so a node test that reaches the real `api` module can load. In the browser the check is the same.

Red proof, then the production files were restored:

- Old behavior put back together (no rollback, thaw without an id, unseal when the reload notice throws, a hold blocks the eager flush, prepare uses the later view, rename runs before the peer answers, a window that is alone does not listen): `src/saveBarrier.test.ts` had 9 failed and 1 passed. The slow-peer test still passed in that combined run, because it returned before the late flush decided.
- Thaw with no id, on its own: the slow peer sealed after its flush (`expected false, received true`).
- No smaller-id surrender, on its own: both windows opened (`['/vault-a', '/vault-b']`, length 2).
- A window that started alone did not listen, on its own: the later rename never ran (`renamed` was -1).
- Restored. `saveBarrier.test.ts`, `saveLoss.test.ts`, `fileOps.test.ts`, `links/updateRace.test.ts`, `readOrdering.test.ts`, and `bases/move.test.ts`: 6 files, 68 tests passed. `bases/results.test.ts` passed after the `isTauri` guard (4 tests).

Browser verification was skipped. Nothing visible changes, and this pass does not open Grove, Tauri, or a visible browser. No window was opened. The locked `npm test` still launches its own headless Chromium.

No file is over 800 lines. The longest touched file is `src/workspace.ts` at 708. `src/saveLoss.test.ts` is 699. `src/noteEditors.ts` is 682. New files: `src/vaultWrite.ts` (113), `src/pathBarrier.ts` (164), `src/saveBarrier.test.ts` (351). `src/vaultSwitch.ts` is 374. Rust was not edited.

Commands for this pass, from `rebuild/app` on `rebuild/s1-grok` unless noted. One `flock /tmp/grove-npm-test.lock` covered the three npm commands:

- `npm test` exited 0, including posttest. Vitest: 101 files, 1581 tests passed. The known graph feel gap is still there (p95 33.4 ms) and the suite still passed with `GROVE_FEEL_STRICT_GRAPH` unset. An earlier locked run, while other worktrees were also testing, missed the drawing parse budget by 0.012 ms (20.012 ms). Three quiet reruns of that one test were 11.4, 11.6, and 11.9 ms. The passing locked run is the one recorded here.
- `npm run build` exited 0 (`tsc --noEmit` and `vite build`). The existing chunk-size warning remains (index about 1312 kB).
- `npm run audit:offline` exited 0: 228 source files, dist, CSP, capabilities, and dependencies checked.
- `cargo test --offline` from `rebuild/app/src-tauri` exited 0. `grove_lib`: 110 passed, 0 failed, 4 ignored. The binary and doc-test targets ran 0 tests. Rust was not edited.

Screenshots under `rebuild/round23-shots` through `rebuild/round33-shots`, including `grove-note-editor.png` and `grove-note-readonly.png`, were rewritten and put back with `git restore`. They are not in this commit.
