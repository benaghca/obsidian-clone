# WEBKIT_HZ: can Grove draw faster than 60 fps on a 240 Hz screen?

Branch `rebuild/webkit-hz-claude`, from `rebuild/integration` 278f8ba (this includes the GPU-renderer fix, 2e65ab8).

## Short answer

**Not with WebKitGTK 4.1, which is the WebKit that Tauri 2 uses.** Two separate 60 Hz limits sit inside WebKitGTK and GTK 3. Grove can't change either one from its own code.

1. **WebKit's frame timer runs at a fixed 60 Hz on this machine.**
   - WebKit ties `requestAnimationFrame` and page updates to the display's vblank, which it reads through `drmWaitVBlank`.
   - The NVIDIA driver ships with DRM vblank turned off (`nvidia_drm` parameter `vblank`, "default 0"; it reads `N` here). The kernel therefore answers `EOPNOTSUPP`.
   - WebKit then falls back to a timer whose rate is **hard-coded to 60** in the 2.54.1 binary. No environment variable changes that rate.
2. **GTK 3 paints the GPU-rendered window at most 60 times a second.**
   - With WebKit's GPU (DMA-BUF) renderer, GTK 3 draws the window through EGL. On that path it never asks the compositor for frame callbacks or presentation timing.
   - Without that timing, its frame clock uses its built-in default of 16,667 µs (60 Hz).
   - This happens on NVIDIA and on Mesa (AMD) alike, and in WebKit's own MiniBrowser too, so it isn't Grove's code.

**Proof that both limits are real.**
- I used a test-only `LD_PRELOAD` shim that makes `drmWaitVBlank` behave as if vblank worked, at 239.97 Hz. That stands in for limit 1 being lifted.
- With the shim, an idle `requestAnimationFrame` loop runs at **240 fps**. Any frame that draws something still drops back to **60**, the GTK 3 limit.
- With the shim plus a present path where GTK does get frame callbacks (SHM present, or DMA-BUF off), Grove reaches **190–240 fps**. But it then burns **83–105 % of a CPU core** in the web process.

**Reference:** Chromium 155 on the same screen and page runs at **240 rAF / 240 commits a second** in every phase.

**Recommendation: no Grove code change.**
- The current GPU path (60 fps at 5–9 % CPU) is the best that WebKitGTK 4.1 offers here.
- What would lift the limits is two upstream reports to WebKitGTK, and in the long run a Tauri/wry that can use WebKitGTK 6.0 (GTK 4).
- Changing the NVIDIA module option alone would show no visible gain (see "Options").

## Machine

- **Display:** Hyprland 0.56.2, Wayland. DP-2 at 2560×1440, 239.97 Hz, VRR off, scale 1. It's on the NVIDIA card (`card1`).
- **GPUs:**
  - NVIDIA RTX 5070 Ti, nvidia-open 615.78.08, egl-wayland 1.1.24;
  - AMD 610M (Mesa 26.2.5), with no display attached.
- **Libraries:** webkit2gtk-4.1 2.54.1, gtk3 3.24.52, Chromium 155.0.8059.84.
- **Grove's stack:** Tauri 2.12.4, wry 0.57.0, `webkit2gtk` crate 2.0.2. In `~/.cargo/registry` there is no wry or WebKit crate for GTK 4 / webkitgtk-6.0, and webkitgtk-6.0 isn't installed.

## How I measured

**Grove:**
- A release build (`npm run build`, then `cargo build --release --features custom-protocol`) with a **temporary** harness. It's the same one as in `WEBKIT_PERF_NOTES.md`: `src/perfHarness.ts` plus one line in `main.ts`, and it runs only when the vault has `perf/run.md`.
- A temporary, env-gated FFI call in `lockdown.rs` could turn off WebKit's `PreferPageRenderingUpdatesNear60FPS` feature.
- Both were removed before committing, and the release binary was rebuilt clean.
- Each phase drives the app from `requestAnimationFrame` for 3 s:
  - idle;
  - moving a 10 px box;
  - Ctrl+wheel zoom and wheel pan on a one-card canvas, with the dot grid and without it;
  - editor scroll.

**Isolation:**
- The vault was `/tmp/webkit-perf-vault`.
- `XDG_CONFIG/DATA/CACHE/STATE_HOME` pointed under `/tmp/webkit-perf-home` for Grove and `/tmp/webkit-hz-home` for MiniBrowser.
- Chromium used `--user-data-dir=/tmp/webkit-hz-chromium`, inside `unshare -U -n --map-current-user`, so it had no network at all.

**Windows:**
- Each one was floating at 2536×1390 (one full tile) and launched through `hyprctl dispatch hl.dsp.exec_cmd`.
- Each was open for about 15–40 s and closed by its own PID.
- Every PID went into `/tmp/webkit-hz-pids.txt`, with an absolute path and child PIDs included. All of them had exited at the end. Chris's own Grove wasn't running during the session, and I signalled no process I hadn't started.

**Three counters:**
- **rAF fps:** `requestAnimationFrame` callbacks per second, timed in the page.
- **Commits/s (presented):** `wl_surface.commit` calls on the window's surface per second, taken from a `WAYLAND_DEBUG=1` log over each phase's wall-clock window. This counts frames that actually reach Hyprland.
- **CPU:** `utime + stime` from `/proc/<pid>/stat`, sampled every 250 ms, as a percentage of one core.

**Grove-free repro:**
- `rebuild/webkit-hz/raf.html`: a local page that logs rAF fps for idle, a tiny box, and a full-window dot-grid pan and zoom.
- The same page ran in WebKit's `MiniBrowser` (`/usr/lib/webkit2gtk-4.1/MiniBrowser --enable-write-console-messages-to-stdout=true`) and in Chromium (`--ozone-platform=wayland --enable-logging=stderr`).

## Results

### Grove as it is on this branch (GPU renderer, NVIDIA, Wayland)

| Phase | rAF fps | Commits/s | Web CPU | App CPU |
|---|---:|---:|---:|---:|
| Idle (rAF loop, no drawing) | 62.3 | 1.5 | 1.2 % | 0.6 % |
| Tiny box | 60.5 | 59.6 | 2.5 % | 6.7 % |
| Canvas zoom, one card | 61.5 | 56.2 | 5.8 % | 4.7 % |
| Canvas pan, one card | 60.5 | 59.3 | 6.3 % | 6.3 % |
| Zoom, grid hidden | 61.4 | 41.4 | 5.8 % | 5.1 % |
| Pan, grid hidden | 60.5 | 59.3 | 6.0 % | 5.3 % |
| Editor scroll | 60.5 | 59.8 | 8.8 % | 4.9 % |

- **Pacing is even:** p50 gap 16 ms, p95 17–18 ms, max 19 ms.
- **`WEBKIT_SHOW_FPS=1`** prints the compositor's rate to the console (`CONSOLE RENDERING INFO FPS: 60.0…`). It agrees.
- **A startup blip in the first run only.** The first baseline run counted 133 app rAF callbacks and 29 commits a second in its first quiet window after start-up. The repeat run and all six other Grove runs showed 0, so I treat it as a one-off from the first start after a rebuild.

### The two limits, isolated (Grove, same window)

| Configuration | Idle rAF | Tiny box | Canvas zoom | Canvas pan | Zoom, no grid | Editor scroll | Web CPU in gestures |
|---|---:|---:|---:|---:|---:|---:|---:|
| As shipped | 62 | 60 / 60 | 61 / 56 | 60 / 59 | 61 / 41 | 60 / 60 | 3–9 % |
| + vblank shim | 240 | 60 / 60 | 65 / 60 | 61 / 60 | 76 / 56 | 60 / 60 | 4–9 % |
| + shim, 60 fps preference off | 240 | 61 / 60 | 65 / 60 | 61 / 60 | 76 / 55 | 61 / 60 | 4–9 % |
| + shim, `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` | 240 | 190 / 189 | 189 / 184 | 189 / 188 | 190 / 171 | 172 / 172 | 83–98 % (app 25 %) |
| + shim, `WEBKIT_DISABLE_DMABUF_RENDERER=1` (CPU paint) | 240 | 239 / 238 | 58 / 52 | 50 / 50 | 136 / 120 | 179 / 179 | 93–105 % (app 7–35 %) |

Each cell is rAF fps / commits a second.

**What the table shows:**
- **The 60 fps preference makes no difference.** Turning `PreferPageRenderingUpdatesNear60FPS` off changed nothing, and the SHM row reached 190 with it still on. It doesn't throttle the GTK port.
- **The shim lifts only frames that don't draw.**
  - With the shim, rAF goes above 60 only while nothing on screen changes: idle, and the stretches of the no-grid zoom where the zoom is at its limit.
  - As soon as a frame draws, WebKit waits for the UI process to present it, and that happens at GTK's pace.
  - This also explains the "41 commits a second" puzzle in `WEBKIT_PERF_NOTES.md`: frames that change nothing aren't committed.
- **Above 60 is possible, but only on present paths that go through the CPU.**
  - Those paths do reach 190–240, but the copy or the painting costs a whole CPU core at this window size.
  - With CPU painting, the canvas grid can't even hold 60.

### WebKit's MiniBrowser with the same page (viewport 2536×1352)

| Configuration | Idle | Tiny box | Grid pan | Grid zoom |
|---|---:|---:|---:|---:|
| NVIDIA GPU (`__NV_DISABLE_EXPLICIT_SYNC=1`) | 62 | 61 / 59 | 60 / 60 | 60 / 60 |
| NVIDIA GPU + shim | 240 | 61 / 60 | 60 / 60 | 60 / 60 |
| AMD Mesa GPU + shim | 240 | 61 / 60 | 60 / 60 | 60 / 60 |
| NVIDIA, SHM present + shim | 240 | 196 / 195 | 192 / 192 | 190 / 190 |

Each cell is rAF fps / commits a second. The idle column has no commits, since nothing draws.

**Frame-callback requests (`wl_surface.frame`) over a whole run:**
- GPU modes: 17–20, all of them at start-up, before the window switches to EGL.
- SHM mode: 1,766.

### Chromium 155 with the same page (Wayland, 2536×1303)

| Idle | Tiny box | Grid pan | Grid zoom |
|---:|---:|---:|---:|
| 240.1 (0.3 commits/s) | 240.2 / 239.6 | 240.0 / 240.0 | 240.0 / 239.9 |

## Why: the evidence for each limit

### Limit 1: WebKit's DisplayLink timer fallback is fixed at 60 Hz

- **What WebKit logs at start:**
  ```
  Could not create a vblank monitor for display 1: drmWaitVBlank failed: Operation not permitted
  Failed to create DRM vblank monitor, falling back to timer
  ```
- **The real error is `EOPNOTSUPP`, not a permissions problem.**
  - `rebuild/webkit-hz/probe.c` does what `DisplayVBlankMonitorDRM::create` does: it finds the CRTC driving DP-2 on `/dev/dri/card1` (CRTC 205, index 0, 2560×1440 at 240) and calls `drmWaitVBlank`.
  - It gets `ret=-1, errno=95 (Operation not supported)`.
  - `strerror(-ret)` with `ret = -1` is "Operation not permitted", so WebKit's message prints the return value, not `errno`.
- **Why the kernel says that:** `modinfo -p nvidia_drm` shows `vblank: Enable drm vblank notification support (1 = enable, 0 = disable (default))`, and `/sys/module/nvidia_drm/parameters/vblank` is `N`.
  - Only `modeset=1` is set (in `/etc/modprobe.d/nvidia.conf` and `supergfxd.conf`).
  - Hyprland itself doesn't need DRM vblank, since it uses page-flip events.
- **The fallback rate is a constant.**
  - In the 2.54.1 `libwebkit2gtk-4.1.so.0`, the code next to the `WEBKIT_FORCE_VBLANK_TIMER` lookup allocates the timer monitor and calls its constructor with `mov $0x3c,%esi`, which is 60.
  - The only related variables are `WEBKIT_FORCE_VBLANK_TIMER` (the same timer) and `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` (which can only divide the rate down).
  - I checked every `WEBKIT_*` string in the library; there is no refresh-rate override.

### Limit 2: GTK 3's frame clock runs at its 60 Hz default on the GPU present path

- **What the Wayland log shows.** With the DMA-BUF renderer, every frame on the window's surface is:
  - `damage`, `attach`, `wp_fifo_v1.set_barrier`, `commit` and `wl_display.sync`, all from NVIDIA's EGL;
  - **no `wl_surface.frame` and no `wp_presentation` feedback**;
  - then nothing until GTK's next paint, 16.6 ms later.
- **The cause.** GTK 3 learns the refresh interval only from frame callbacks and presentation feedback. Without them, `gdk_frame_clock_get_refresh_info` returns its default:
  - in `libgdk-3.so.0`, that exported function loads `mov $0x411b,%r13d`, which is 16,667 µs;
  - GTK then schedules paints no closer together than that.
- **The cross-check.** In SHM mode GTK attaches the buffer itself, requests frame callbacks (1,766 per run) and runs at 190+.
- **Ruled out:** Mesa shows the same 60 cap, so it isn't NVIDIA's EGL. MiniBrowser shows it too, so it isn't Grove.
- GTK 3 has no public API through which an app could give the frame clock the real refresh interval. `GDK_DEBUG=frames` prints nothing in this release build of GTK.

## Options

| Option | What it takes | Result here | Verdict |
|---|---|---|---|
| A. Keep the current GPU path | Nothing | 60 fps, evenly paced, 5–9 % CPU, about zero when idle | **Recommended for now** |
| B. `nvidia_drm.vblank=1` alone | `options nvidia_drm modeset=1 vblank=1` in `/etc/modprobe.d/nvidia.conf`, initramfs rebuild, reboot | Same as the shim rows: idle rAF at 240, drawn frames still 60 | No visible gain. Not tested for real (it needs a reboot). |
| C. B plus `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` | The system change plus one environment variable in `graphics_env()` | 170–190 fps, but 83–98 % web CPU and 25 % app CPU at 2536×1390 | Not worth it: a whole core while scrolling, and worse on bigger windows or slower CPUs |
| D. Fix upstream in WebKitGTK and GTK | Bug reports or patches (below) | Would give the display rate on the GPU path at GPU cost | **Recommended** to file |
| E. WebKitGTK 6.0 (GTK 4) | A Tauri/wry release that supports it; none exists in wry 0.57 | GTK 4 paints from presentation timing, so limit 2 should go away. Limit 1 still needs B or a WebKit fix. Not testable here: webkitgtk-6.0 isn't installed. | Watch for it |
| F. Ship the shim | `LD_PRELOAD` in the shipped app | Not acceptable: it fakes vblank timing for one driver | No |

**What upstream would need:**
1. **WebKitGTK, `DisplayVBlankMonitor`:** when the DRM monitor can't be created, the timer should run at the monitor's refresh rate, not a constant 60.
   - GDK already reports 239.97 Hz through `gdk_monitor_get_refresh_rate`.
   - A second, smaller point: the log should print `errno` rather than `strerror(-ret)`.
   - The NVIDIA case could also say that `nvidia_drm.vblank=1` enables the DRM monitor.
2. **WebKitGTK GTK 3 DMA-BUF GL path (or GTK 3 itself):** GTK's frame clock gets no frame callbacks or presentation feedback, so it stays at 16.667 ms. GTK 3 is in maintenance, so a fix on the WebKit side seems more likely.
   - **Repro for both:** MiniBrowser, `raf.html` and `vblankshim.c` from `rebuild/webkit-hz/`, as in the MiniBrowser table.

## Risks of going above 60 (if limits 1 and 2 were lifted)

- **Crashes on Hyprland:**
  - None of the runs in this session crashed, including SHM and CPU paint with the shim.
  - The GPU path still needs `__NV_DISABLE_EXPLICIT_SYNC=1` on NVIDIA, which Grove already sets (see `WEBKIT_PERF_NOTES.md`).
  - I never ran `nvidia_drm.vblank=1` for real. NVIDIA ships it off, and nothing on this machine says why.
- **Power:**
  - Idle doesn't change: the display link stops when nothing animates. Idle commits stayed at 0–2 a second in every configuration.
  - During gestures, 240 Hz is up to four times the per-second rendering work.
  - On the GPU path that is still small (5–9 % CPU at 60 now). On the SHM or CPU paths it costs a whole core.
- **Other GPUs:**
  - AMD and Intel kernel drivers normally provide DRM vblank, so limit 1 shouldn't apply there. I couldn't confirm that: no display is attached to the AMD card, so WebKit can't find a CRTC on it.
  - Limit 2 applies there too: Mesa plus the shim stayed at 60.
- **X11:**
  - Grove keeps the CPU path on X11. That path follows the display rate when painting is cheap, but the canvas grid can't hold 60 on it.
  - The X11 GPU path fails on this machine under XWayland (`WEBKIT_PERF_NOTES.md`). I couldn't test a pure X11 session.
- **60 Hz monitors:** no change. Everything already runs at the display rate.

## What changed on this branch

**Added, no app code:**
- `rebuild/WEBKIT_HZ_NOTES.md`: this file.
- `rebuild/webkit-hz/raf.html` (30 lines): the local rAF test page.
- `rebuild/webkit-hz/probe.c` (34 lines): the `drmWaitVBlank` probe.
  - Build: `gcc -o probe probe.c $(pkg-config --cflags --libs libdrm)`.
- `rebuild/webkit-hz/vblankshim.c` (35 lines): the test-only `LD_PRELOAD` shim.
  - Build: `gcc -O2 -shared -fPIC -o vblankshim.so vblankshim.c $(pkg-config --cflags libdrm) -ldl`.
  - Run: `LD_PRELOAD=$PWD/vblankshim.so` (optional `SHIM_HZ`, default 239.97).
  - Never ship it.

**Temporary and removed before committing:** the perf harness (`src/perfHarness.ts` and its line in `main.ts`) and the `PreferPageRenderingUpdatesNear60FPS` FFI in `lockdown.rs`. `git status` is clean apart from untracked files.

## Checks

Run on the committed tree (notes and repro files only, so no app code changed):
- `npm run build`: passed.
- `npm run audit:offline`: passed (191 source files).
- `cargo build`: passed. `cargo test`: 82 passed, 5 ignored.
- `flock /tmp/grove-npm-test.lock npm test`:
  - **First run: exit 1, a timing flake.** Vitest passed: 80 files, 1,275 tests. Then the geometry script stopped at `GeometryFM.md reading Ctrl+o: {"visibleFrame":1,"maxFrame":24}`: the popup appeared on frame 1, but one frame took 24 ms, over the 20 ms limit. The other 17 popup checks in that run came in at 16.7–18.3 ms.
  - **Rerun once under the lock: exit 0.** 1,275 Vitest tests and 2,816 PASS lines. That same check took 16.9 ms, and the 300-card pan and zoom frame checks and the 10,000-row Bases scroll passed.

Obsidian: no Obsidian code, assets or docs were used. Chromium served only as a frame-rate reference, on a local page of my own.

## For Chris to decide

1. **File the two WebKitGTK reports above?** The repro needs only MiniBrowser and the three files in `rebuild/webkit-hz/`.
2. **Set `nvidia_drm.vblank=1` on this machine?** Only worthwhile once limit 2 is fixed upstream or Grove moves to GTK 4. On its own it changes nothing you can see in Grove.
3. **Keep 60 fps for now (option A),** rather than trading a full CPU core for 190 fps (option C)? I recommend A.
