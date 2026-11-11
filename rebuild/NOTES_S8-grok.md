# S8: Grove's tests in CI, and a headless backend smoke

GitHub Actions used to run only the Cinder checks at the repo root. A push or pull request now also runs Grove, in its own job, so a Grove failure and a Cinder failure stay separate.

The Grove job installs the same WebKitGTK 4.1 packages the Cinder job already installs (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`, `libxdo-dev`), sets up stable Rust and Node 22, and in `rebuild/app` runs `npm ci`, `npx tsc --noEmit`, `npm test`, `cargo fetch`, and `cargo test --offline`. `npm test` runs `posttest` on its own when the test script exits 0. Rust and npm caches follow the existing workflow. On GitHub, apt, the setup actions, `npm ci`, and `cargo fetch` all use the network. The local smoke uses `cargo test --offline` and does not fetch anything.

There is no separate typecheck script. `npm run build` is `tsc --noEmit && vite build`, so the job runs the type check on its own and does not build a production bundle. The feel tests launch Chromium headless. The job sets `GROVE_BROWSER` to Google Chrome or Chromium already on the runner image and stops if neither is on `PATH`. It does not install a browser, and it does not start Grove or a window.

## Headless smoke

`smoke::save_rename_and_flush_round_trip_through_ipc` calls the real `open_vault`, `write_note`, and `rename_path` commands through Tauri's test IPC, on `MockRuntime`. That runtime keeps window labels and does not open GTK or WebKit. The vault uses the crate's temp-directory helper and is removed when the test drops it. The test checks that the directory stays under the system temp directory.

It opens a vault, writes `Note.md`, checks that the other window hears one `vault-changed` modify for that path and that the saving window does not, renames the note to `Renamed.md`, reads the folder back from disk, then writes `external.md` from outside the app and flushes that notify event the way the watcher flushes a batch. The open index lists the new file.

`npm run test:smoke` runs that one test. It is not appended to the `npm test` chain. CI runs it as part of `cargo test --offline`.

The smoke builds `AppState` the way the app does after S5: `Arc<RwLock<Inner>>`, a `WriteQueue`, and the watch channel. `smoke_commands` registers `open_vault`, `write_note`, and `rename_path` with the same `wrap_handler` production uses, so each save is reserved at IPC ingress before the async body runs. It does not hand out test tickets itself.

`write_note` stays S5's async command: it takes a `WriteTicket`, runs on the `"vault-write"` worker, and emits through `emit_other_windows`. The window type is `Window<R: tauri::Runtime>` so `MockRuntime` and Wry both compile. `emit_other_windows`, `set_property`, and `write_file_bytes` take that same runtime. `write_dispatch` is generic over the runtime for the same reason. The source check `write_10mb_stays_off_the_calling_thread` still requires `#[tauri::command(async)]` and accepts `fn write_note<` as well as `fn write_note(`. `flush_changes` stays `pub(crate)` and takes S5's `RwLock`, so one batch can be flushed without starting the watcher thread. `flush` still calls it. The commands the app registers are unchanged. The `tauri` `test` feature is an empty feature of the crate already in the build, and it is a dev-dependency only, so a normal `cargo build` does not enable it. `Cargo.lock` did not change. No npm package was added.

Two extra IPC checks use that wrapper. `malformed_write_does_not_stall_the_next_ipc_save` sends `write_note` without `content`, expects an error within 2 seconds, then a later save still lands. `in_flight_write_then_rename_keeps_ipc_submission_order` accepts a write and a rename before either reply is read, and the renamed file has the queued bytes.

Nothing the user sees changes. Layout, shortcuts, theme, and editor behavior were not touched.

## How it was run

Commands below started in `rebuild/app` except the Rust suite, which started in `rebuild/app/src-tauri`.

- `python3` parsed `.github/workflows/ci.yml` and `package.json`.
- `npm run audit:offline` (`tsc --noEmit`, `vite build`, then `scripts/audit-offline.mjs`) passed: 220 source files, dist, CSP, capabilities, and dependencies.
- `cargo test --offline` from `rebuild/app/src-tauri`, after merging `rebuild/integration` (`1ef3ffa`), passed: 129 tests, 0 failed, 4 ignored. That includes the three smoke tests, the S5 queue tests, and `write_10mb_stays_off_the_calling_thread`.
- On the first S8 commit the smoke was broken on purpose by making `write_note` return an error before it wrote. It panicked at `src/smoke.rs:36` with `write_note failed: "smoke hook broken on purpose"`. Cargo exited 101. The function body was restored. That line number was from before this merge. The same test passed again after the restore.
- After that cargo run, Hyprland still had two clients (Spotify and Grok Bot). No smoke vault directory was left under `/tmp`.

`npm test` under `flock /tmp/grove-npm-test.lock` was run twice before the install below. Both stopped in `scripts/test-canvas-notes.mjs` at `geometry()`, on `Failed to resolve module specifier "@codemirror/state"`. That script imports `/node_modules/@codemirror/view/dist/index.js`. This worktree's `node_modules` was a symlink to another checkout, outside Vite's root, so Vite served that file with the bare import left as-is. `grove-l1` has the same symlink and the same failure. With the package inside the project, Vite rewrites the import: a direct request no longer contains `from '@codemirror/state'`. `npm ci --offline` replaced the symlink with a real install in this worktree (69 packages). The lockfile did not change. CI runs its own `npm ci` into the workspace, so it does not have this symlink. After that install, `flock /tmp/grove-npm-test.lock npm test` exited 0 and `posttest` ran. The canvas-note geometry checks passed for live, source, and reading. The suite rewrote screenshots under `rebuild/round23-shots` through `rebuild/round33-shots`; those files were restored and are not in this commit. After this merge the same locked `npm test` exited 0 again, including `posttest`, and the rewritten screenshots were restored the same way.

## Not covered

A real WebKitGTK document does not receive the event. The page itself is not driven. Opening a real webview would open a window, or need a virtual framebuffer, and that was not done. Also not covered: the live inotify thread, and main-thread blocking on a real GTK loop. The other window's Rust listener receives the same `vault-changed` event the page listens for, and `flush_changes` returns the payload `flush` would emit.

Close, quit, and a pending save during shutdown are not covered. The smoke drops two window handles after the commands have already finished. That is not a close, a destroy, or a worker drain. It does not show that the S1 or S5 close findings are fixed. A bounded close/worker-drain test can follow separately.

## Size

No new dependency.

Counts are against `rebuild/integration` at `1ef3ffa`, which already contains S5 and S7.

| Language | File | Lines | Change |
| --- | --- | --- | --- |
| YAML | `.github/workflows/ci.yml` | 72 | +47 / −2 |
| JSON | `rebuild/app/package.json` | 47 | +2 / −1 |
| TOML | `rebuild/app/src-tauri/Cargo.toml` | 48 | +6 / −0 |
| Rust | `rebuild/app/src-tauri/src/lib.rs` | 701 | +19 / −7 |
| Rust | `rebuild/app/src-tauri/src/watch.rs` | 543 | +2 / −1 |
| Rust | `rebuild/app/src-tauri/src/smoke.rs` | 290 | +290 / −0, new |
| Rust | `rebuild/app/src-tauri/src/write_dispatch.rs` | 118 | +36 / −37 |
| Shell | `rebuild/app/scripts/smoke-backend.sh` | 7 | +7 / −0, new |
| Markdown | `rebuild/NOTES_S8-grok.md` | 61 | +61 / −0, new |

Net, including this notes file: +470 / −48. Without the notes file: +409 / −48. Rust alone: +347 / −45.
