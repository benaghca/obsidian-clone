# Piece HZ: smoother frames on the 240 Hz screen (Claude)

Branch `rebuild/hz-claude`, from `8720db6`. Built from `HZ_TASK.md` and Fable's diagnosis (`HZ_FABLE_DIAGNOSIS.md`). First commit `8210f65`. Round 1 fixes for Codex's review (`NOTES_HZ-REVIEW1-codex.md`, PASS-WITH-FIXES) come in the next commit; see "Round 1 fixes".

## Summary

- **Fix A2 is built and on by default.** When the NVIDIA driver refuses DRM vblank, Grove now supplies WebKit's vblank timing itself, at the monitor's real rate.
  - The aim is a steady 60 with no dropped frames and less delay.
  - Off switch: `GROVE_VBLANK_FALLBACK=off`.
  - On a driver where vblank works, nothing changes: the real answer is passed straight back.
- **Fix B is built as a prototype and off by default.** `GROVE_FRAME_PACING=compositor` makes GTK paint when Hyprland's frame callback says the last frame was shown, instead of on its fixed 16.667 ms clock. The aim is up to 240.
  - With the flag unset, the code returns at its first line, so behaviour is exactly A2.
- **No visible change by design.** No layout, theme, shortcut or front-end code was touched.
- **No new crates.** `gtk` is now named in `Cargo.toml`, but it was already in the build through tauri and tao at the same version. The only `Cargo.lock` change is one line adding `"gtk"` to grove's own dependency list. No npm changes.
- **Verified without a window:**
  - libwebkit binds to Grove's `drmWaitVBlank`.
  - On the real NVIDIA card, the emulation paces at 239.97 Hz for about 0.1 % of a core.
- **Not verified, because it needs a window:** how either fix looks and feels, and whether Fix B actually reaches 240. The steps are in "How Chris tries it".

## What was built

### Fix A2: Grove answers WebKit's vblank wait when the driver can't (`src/vblank.rs`, `src/main.rs`, `build.rs`)

**How it hooks in.**
- `main.rs` defines an exported `drmWaitVBlank`.
- `build.rs` adds `-Wl,--export-dynamic-symbol=drmWaitVBlank`, for the binary only (`rustc-link-arg-bins`) and only when the target is Linux.
- libwebkit2gtk-4.1 imports that symbol as an ordinary undefined reference. It is linked `BIND_NOW` and not `-Bsymbolic`, so the executable's definition wins over libdrm's.
- No `LD_PRELOAD` is involved.
- The web process is a separate executable, so it is not affected.

**What a call does.**
1. Look up libdrm's real `drmWaitVBlank` with `dlsym(RTLD_NEXT)` and call it first, every time.
2. If it succeeds, or fails with anything except `EOPNOTSUPP`, return its result and `errno` unchanged.
3. Event, signal and flip requests are never faked; only a plain blocking wait is. WebKit's monitor only sends plain waits.
4. Otherwise, read the refresh period of the CRTC named in the request.
   - It uses libdrm's `drmModeGetResources` and `drmModeGetCrtc`, found with `dlsym`.
   - It computes `htotal × vtotal / pixel clock`, so 239.97 Hz stays 239.97 rather than 240.
   - The period is cached for one second per monitor, so a mode change, such as switching to 60 Hz, is picked up within a second.
   - A monitor is the device behind the fd (its `/proc/self/fd` link) plus the CRTC index. A new fd on the same device inherits the last good period; an fd number reused for another device starts over.
   - **Round 1:** a monitor whose mode was readable once keeps its last good period when a later read fails. It stays paced while the read is retried once a second.
5. Sleep with `clock_nanosleep` until the next multiple of that period on `CLOCK_MONOTONIC`, fill in the reply (sequence and timestamp) and return 0. If the sleep fails (anything but `EINTR`, which resumes), the original error goes back rather than a claimed wait (round 1).
   - Relative and absolute requests follow the kernel's rules, including 32-bit wraparound and `NEXTONMISS`.
   - No wait goes more than one second ahead.

**Fallbacks.** Each case below behaves exactly as Grove does today:

| Case | What happens |
|---|---|
| Mode has never been readable for this monitor, or is outside 20–1000 Hz | The original error goes back to WebKit, which keeps its own timer. One log line. |
| Mode was readable, then a read fails | The last good period is kept and the read retried once a second; waits stay paced (round 1). One log line. |
| `clock_nanosleep` fails | The original error goes back (round 1). One log line. |
| libdrm's real function not found | `-1` with `ENOSYS`. This can't happen in practice, because WebKit only calls the function when libdrm is loaded. |
| A panic inside the emulation | Caught; the original error goes back. |
| `GROVE_VBLANK_FALLBACK=off` | The real result is always returned. |

**Log lines (once each).**
- Started: `grove: DRM vblank is not supported by the display driver; timing WebKit's frames at 239.97 Hz from the display mode (GROVE_VBLANK_FALLBACK=off turns this off)`.
- Mode never readable: a line saying WebKit keeps its own timer.
- Mode lost after working: `grove: the display mode of CRTC 0 could not be read; keeping the last good 239.97 Hz while retrying`.
- Once A2 is active, WebKit's own `Failed to create DRM vblank monitor, falling back to timer` line should no longer appear.

### Fix B: GTK paints on the compositor's frame callback (`src/frame_pacing.rs`, one call in `lockdown.rs`)

**What it does.** This is the plan from Fable's diagnosis, done per window, including note windows. `build_window` calls `frame_pacing::install` after the window is built.

1. **Draw.** When the toplevel's `draw` signal fires, Grove asks for `wl_surface.frame` on the window's surface, if no callback is already outstanding.
   - The request is sent before `eglSwapBuffers` commits, so it rides on that commit.
2. **After paint.** In the frame clock's `after-paint`, if this cycle drew and a callback is outstanding, Grove calls `gdk_window_freeze_toplevel_updates_libgtk_only`.
3. **Callback.** When the compositor's callback arrives, Grove destroys it and calls `gdk_window_thaw_toplevel_updates_libgtk_only`.
   - A clock frozen during `after-paint` has no 16.667 ms wait pending, so a queued redraw paints at once.

**Safety nets.**
- **Hidden or minimised windows.** Unmap and unrealize drop the callback and thaw.
- **Window teardown.** Teardown does the same, and skips the thaw when the GdkWindow is already destroyed, since thawing then would crash in GDK.
- **Watchdog.** A 50 ms timer thaws if a callback never arrives, so a window can never stay frozen. That covers a hidden window, a paint that didn't commit, and a compositor that drops callbacks.
  - The first time it fires, it logs one line.
- **Fallback to GTK (round 1).** After three watchdog expiries in a row with no callback between them, compositor pacing turns off for that window. Turning it off destroys the outstanding request, balances the freeze and cancels the watchdog. The window then paints on GTK's own clock, as today, and one line is logged:
  `grove: 3 compositor frame callbacks in a row missed the 50 ms watchdog; this window goes back to GTK's frame clock`.
  - A broken present path therefore costs three 50 ms stalls once, not one per frame.
  - A callback resets the count, so a one-off miss only costs that frame. Unmap and unrealize also reset it, keeping hidden-window cleanup separate from failures.
  - A window that had received callbacks before it was turned off tries again on its next focus-in. Its misses most likely came from animating on a hidden workspace, where Hyprland sends no callbacks. A window that never received one stays on GTK's clock until it is reopened.

**When it switches itself off.** Each case logs one line and leaves GTK as it is today:
- `GROVE_FRAME_PACING` set to anything other than `compositor`;
- not running on Wayland;
- any of the eight libwayland-client or libgdk-3 symbols missing. They are looked up with `dlsym` at run time, not linked.

**Code layout.** The bookkeeping is a small pure state machine (`Pace`), with unit tests. The GTK and Wayland calls sit around it, and every freeze or thaw runs outside any `RefCell` borrow.

### Not done: the canvas middle-drag tidy

- I left `navigation.ts` as it is.
- GDK 3 merges queued pointer motion (event compression is on by default), and WebKit merges mouse moves while the web process is busy. So the `draw()` per pointer move should stay at about one per frame, at 60 today and at 240 with Fix B. I reasoned this from how GDK and WebKit work; I did not measure it.
- `draw()` also skips repeated viewports and only writes styles; the page renders once per frame either way.
- Switching to `schedule()` would delay the state update to the next animation frame, which some synchronous tests may rely on. It would buy nothing measurable.

## Environment variables

| Variable | Default | Values | Effect |
|---|---|---|---|
| `GROVE_VBLANK_FALLBACK` | on | `off` / `0` / `no` / `false` turn it off. Unset / `on` / `1` / `yes` / `true` / `auto` keep it on. Anything else logs once and stays on. | Fix A2 |
| `GROVE_FRAME_PACING` | GTK's clock | `compositor` turns on Fix B. Unset / `gtk` / `default` / `off` keep GTK's clock. Anything else logs once and keeps GTK's clock. | Fix B |

Both are read once per process.

## How Chris tries it

Use a release build from this branch: `npm run build`, then `cargo build --release --features custom-protocol` in `rebuild/app/src-tauri`, then `G=$PWD/target/release/grove`. To keep your vault out of it, prefix each run with `XDG_CONFIG_HOME=/tmp/hz/config XDG_DATA_HOME=/tmp/hz/data XDG_CACHE_HOME=/tmp/hz/cache` and open a scratch folder.

1. **Default: steady 60 (A2).**
   - Run `$G 2>&1 | grep -E 'grove:|vblank'`.
   - Expect the line `grove: DRM vblank is not supported … timing WebKit's frames at 239.97 Hz`, and no WebKit `falling back to timer` line.
   - Scroll a long note and pan a canvas. Look for no small jumps, and less trailing behind the cursor when dragging.
2. **Compare with today.**
   - Run `GROVE_VBLANK_FALLBACK=off $G`. This is exactly the old behaviour, and the WebKit fallback line comes back.
3. **The 240 prototype (A2 + B).**
   - Run `GROVE_FRAME_PACING=compositor $G 2>&1 | grep grove:`.
   - Expect `painting on the compositor's frame callbacks (prototype)`.
   - Then do the same gestures. Watch `grove` and `WebKitWebProcess` in `btop`: Fable estimated 20–35 % of a core during motion and near zero at idle.
4. **Measure it (Fable's test plan, section 4).**
   - Run `WAYLAND_DEBUG=1 $G 2> /tmp/grove-wl.log` with and without `GROVE_FRAME_PACING=compositor`, and build the commit-gap histogram from the diagnosis.
   - Expected gaps: 16–17 ms only with A2 (no 33 ms gaps), and around 4 ms with A2 + B.
   - Delete the log afterwards, because it contains window titles.
5. **Regression checks for B.**
   - Move the window to another workspace and back; minimise and restore; resize; open and close a note window.
   - Leave it idle for a minute, then press a key.
   - Run once at 60 Hz (`hyprctl eval …@59.95`, from the diagnosis).

## CPU and idle

**A2.**
- Each frame now costs one `clock_gettime` and one `clock_nanosleep`, in place of WebKit's own `sleep_for`. The display mode is read about once a second while animating.
- Measured with the live test below: 240 emulated vblanks a second took **0.08–0.15 % of one core**, on the waiting thread's own CPU clock.
- **Idle stays idle.** WebKit only waits for vblank while its display link has observers, meaning something animates or a rendering update is pending. With nothing changing on screen, the function is not called.
- WebKit's display link does tick at 240 rather than 62.5 while something animates. Drawn frames are still limited by GTK's 60 Hz paint, so per-frame work doesn't grow. The earlier shim runs (`WEBKIT_HZ_NOTES.md`, "+ vblank shim" row) showed the same 4–9 % web CPU as without the shim.

**B.**
- **Per frame:** one Wayland request plus one callback event, and a freeze and thaw.
- **Idle:**
  - A callback is only requested when the window drew, so an idle window requests none.
  - A thaw with nothing queued paints nothing.
  - The watchdog is only armed while frozen.
- **During motion:** up to four times as many frames as today, which is the real cost. Fable estimated 5–9 % of a core rising to 20–35 %. It is off by default for that reason; turning it on by default is Chris's call.
- **Hidden windows:** a hidden window that keeps animating paints at about 20 Hz for three frames, because the 50 ms watchdog thaws it. It then falls back to GTK's clock until it is focused again. GTK's own shared-memory path would stop such a window entirely instead.

## Checks

**Binding check on the real binary, without starting it.**
- Ran `LD_DEBUG=bindings ldd -r target/debug/grove`. It relocates everything and exits before `main`.
- It printed: `binding file /usr/lib/libwebkit2gtk-4.1.so.0 [0] to target/debug/grove [0]: normal symbol 'drmWaitVBlank'`.
- `nm -D --defined-only grove` lists only `drmWaitVBlank`.

**Live pacing test on Cloud.**
- The test is `vblank::tests::live_device_pacing`. It is ignored by default; run it with `cargo test --offline vblank::tests::live -- --ignored --nocapture`.
- It opens `/dev/dri/card1`, as WebKit does, and calls Grove's function the way WebKit's monitor loop does. No window, no Grove.
- Result: `CRTC 0: mode 239.970 Hz, real drmWaitVBlank ret=-1 errno=Some(95)`, then `240 waits: 239.97 Hz, gaps 4.111–4.229 ms, thread CPU 0.151 % of a core`. A second run gave 0.082 %.
- Each call reported exactly one more vblank than the last.

**Unit tests (no hardware).**
- Switch parsing for both variables.
- Which errors are emulated: only `EOPNOTSUPP` on a plain wait, never EINVAL, EPERM or EBUSY, a success, or event, signal or flip requests.
- CRTC index decoding from the request bits.
- Mode-period maths, including 239.97 Hz, exact 60 Hz, the `vrefresh` fallback and out-of-range modes.
- Relative and absolute targets, wraparound and `NEXTONMISS`.
- No drift over 600 frames.
- The `Pace` state machine: freeze/thaw pairing, idle never freezing, a failed request, a callback arriving early, reset, and steady motion.
- **Round 1, A2, with an injected clock, sleep, mode reader and device table (`Fake`):**
  - **valid → unreadable → recovered.** Covers WebKit's probe, 240 waits read from the mode, then 600 waits (2.5 s) with the mode unreadable. Every one of those waits still sleeps, exactly one 239.97 Hz period after the last, and the read is retried 2–4 times, not per frame. Then the mode returns at 60 Hz and is picked up within 1.5 s, with even 60 Hz spacing.
  - A monitor that never had a mode: `NoMode` every time, with no sleep.
  - Identity: a new fd on the same device inherits the period. The same CRTC index on another device does not, nor does a reused fd number, nor an fd whose device can't be named.
  - The table stays at 16 entries or fewer.
  - A failed sleep is reported as `SleepFailed`, not a wait; a probe still succeeds.
- **Round 1, B:**
  - Three timeouts turn pacing off: each still thaws, and afterwards there are no requests or freezes for 100 frames.
  - A reset doesn't turn it back on, and a window that was never paced doesn't resume on focus.
  - A callback between misses resets the count (50 cycles, never off).
  - Unmapping resets the count.
  - A window that had received callbacks resumes on focus and paces again.

**Suites.**
- `cargo test --offline` in `rebuild/app/src-tauri`, first commit: **170 passed, 0 failed, 5 ignored**. One of the ignored tests is the new live test.
- After the round 1 fixes: **179 passed, 0 failed, 5 ignored**. The live test was rerun after the refactor and still gives `240 waits: 239.97 Hz, gaps 4.121–4.219 ms, thread CPU 0.114 % of a core`.
- `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app`:
  - **First run: exit 1, a timing flake.** `test-friction.mjs` failed on `enter_list_item: 17 ms, 0 long tasks, slowest input 24 ms (budget 16)`. That check runs in a headless browser, and this piece changes no front-end code.
  - **Rerun once under the lock: exit 0.** Vitest passed 109 files and 1,648 tests, and the scripts printed 3,250 PASS lines.
  - **After the round 1 fixes, first run: exit 0.** Same totals: 109 files, 1,648 Vitest tests, 3,250 PASS lines.

## What I could not verify without a window

- **Feel and frame rate.** That A2 removes the roughly once-a-second dropped frame (Cause 2), and that A2 + B reaches 240 on Hyprland with NVIDIA's EGL. Both are still inference until someone runs the Wayland commit-gap histogram.
- **GTK details Fix B relies on.**
  - That the toplevel's `draw` signal fires for every GL paint of the window.
  - That a `wl_surface.frame` request made inside `draw` rides on NVIDIA EGL's commit.
  - That NVIDIA's `wp_fifo` barrier doesn't add its own throttle. Fable flagged this as a risk.
  - If the first of these is wrong, B simply never freezes, and behaviour stays at A2. If the second is wrong, the window now falls back to GTK's clock after three 50 ms stalls (round 1). Check for the `goes back to GTK's frame clock` line: on a visible window it means B can't work on this path.
- **Other compositors.** B on GNOME and KDE, and either fix on X11. A2 would still apply there if the driver refuses vblank. B turns itself off on X11.
- **Frame-time limits in `npm test`** (the 20 ms popup check, the 16.8 ms pan checks). They run in a browser, not in Grove's GTK window, so B can't affect them.

## Round 1 fixes (Codex review `NOTES_HZ-REVIEW1-codex.md`)

| Finding | Fix |
|---|---|
| **P2:** an established emulated monitor lost its pacing when its mode became unreadable | `Monitors` in `vblank.rs` keeps the last good period per monitor (device plus CRTC, not the fd number) and retries the read once a second. Only a monitor that never had a readable mode returns the original error. The clock, sleep, mode reader and device lookup sit behind a `Platform` trait, so tests drive the whole `answer` path. |
| **P2:** repeated watchdog expiries kept stalling a visible window | `Pace::timed_out` counts misses in a row. At three, pacing turns off for that window: the request is destroyed, the freeze balanced, the watchdog cancelled, and one line logged. GTK's own clock takes over. Resuming on focus is limited to windows that have had callbacks. |
| **P3:** sleep errors | Taken, since it was small: `sleep_until` returns the error, and `answer` reports `SleepFailed`, so the original error goes back. |
| **P3:** interlaced, doublescan and `vscan` modes | Not taken. The period maths is unchanged and still right for progressive modes, including 239.97 Hz. Codex marked this as later compatibility work. |

Unchanged: B is still opt-in, A2 still has its env switch, and there is no visible change, no new crate or package, and no system or driver change.

## Files

- `rebuild/app/src-tauri/src/vblank.rs`: new. Fix A2 plus its tests.
- `rebuild/app/src-tauri/src/frame_pacing.rs`: new. Fix B plus its tests.
- `rebuild/app/src-tauri/src/main.rs`: the exported `drmWaitVBlank`.
- `rebuild/app/src-tauri/build.rs`: the export flag, Linux binaries only.
- `rebuild/app/src-tauri/src/lib.rs`: the two module declarations.
- `rebuild/app/src-tauri/src/lockdown.rs`: one call to `frame_pacing::install`.
- `rebuild/app/src-tauri/Cargo.toml` and `Cargo.lock`: `gtk = "0.18"` named directly. It was already in the build.

Nothing in system config was touched: no modprobe or `nvidia_drm` change, no Hyprland change, no `LD_PRELOAD`. Grove was never launched, no GUI window was opened, and no upstream reports were filed.
