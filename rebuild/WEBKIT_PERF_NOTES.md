# WebKitGTK performance: why the real app is slow

Branch `rebuild/webkit-perf-claude`, from `rebuild/integration` 93dbb79.

## Short answer

There are two separate causes, plus one smaller thing that the fix brings out.

1. **WebKit paints everything on the CPU.**
   - Grove forced `WEBKIT_DISABLE_DMABUF_RENDERER=1`. With that set, WebKitGTK 2.54 draws each frame on the CPU and hands GTK a shared-memory buffer (`wl_shm`) for the whole window.
   - Zooming or panning a canvas with **one card** took **92–100 % of a CPU core** in the web process. The canvas then fell to about **45–52 frames a second**.
   - Most of that cost is repainting the canvas dot grid across the whole canvas on every frame.
   - Turning the GPU (DMA-BUF) renderer back on brings the same gestures to **10–13 % CPU at 60 fps**.

2. **WebKitGTK is capped at 60 fps on this machine.** It applies in every configuration I tried, and Grove can't change it.
   - Chris's monitor runs at 240 Hz. WebKit couldn't open its DRM vblank monitor on the NVIDIA card, so it fell back to a fixed 60 Hz timer. It logs:
     ```
     Could not create a vblank monitor for display 1: drmWaitVBlank failed: Operation not permitted
     Failed to create DRM vblank monitor, falling back to timer
     ```
   - Everything in the app therefore runs at 60 fps at most, next to apps running at 240. That probably explains much of "a steady low frame rate everywhere", and nothing inside Grove can lift it (see "The 60 Hz cap").

3. **Smaller: the editor caret repaints every frame with the GPU renderer on.**
   - CodeMirror runs an endless blink animation on its cursor layer whenever the editor has focus. In Grove that layer is normally empty, because the browser draws the caret.
   - In the GPU path WebKit then redrew and presented the window **60 times a second while idle**. That cost about 4 % CPU in the app process, plus compositor work.

**The "Error 71" crash still happens, and its cause is now known.**
- With the DMA-BUF renderer on (WebKitGTK 2.54.1, NVIDIA 615.78.08 open, egl-wayland 1.1.24, Hyprland 0.56.2), the app still exits at once with `Error 71 (Protocol error) dispatching to Wayland display`.
- The protocol log shows NVIDIA's EGL attaching `wp_linux_drm_syncobj_surface_v1` (explicit sync) to the window's surface. GTK 3 then commits a plain buffer on that surface without an acquire point, and Hyprland rejects it:
  ```
  wl_display#1.error(wp_linux_drm_syncobj_surface_v1#54, 4, "Missing acquire timeline")
  ```
- With `__NV_DISABLE_EXPLICIT_SYNC=1`, which only NVIDIA's driver reads, the DMA-BUF renderer runs without a crash and draws correctly. I checked the canvas and editor screenshots during the runs.

**Implemented on this branch (small and reversible):**
- On Wayland, Grove no longer turns the GPU renderer off; it sets `__NV_DISABLE_EXPLICIT_SYNC=1` instead.
- On X11 it keeps the old setting.
- The editor's cursor layer doesn't animate while it is empty.

## Setup

**Machine:**
- Hyprland 0.56.2 on Wayland. One monitor: DP-2, 2560×1440 at **239.97 Hz**, scale 1. It is connected to the NVIDIA card (`card1`).
- GPUs:
  - NVIDIA RTX 5070 Ti, nvidia-open 615.78.08 (`renderD128`);
  - AMD Radeon 610M iGPU, Mesa 26.2.5 (`renderD129`, no display attached).
- webkit2gtk-4.1 2.54.1, GTK 3.24.52, egl-wayland 1.1.24.
- In every NVIDIA run, the web process and the app process opened only `renderD128`, the NVIDIA GPU.

**Build and isolation:**
- Release build: `npm run build`, then `cargo build --release --features custom-protocol`, as `tauri build` does.
- Scratch vault in `/tmp/webkit-perf-vault`:
  - `One.canvas`: one text card;
  - `Long.md`: 2,400 lines of mixed Markdown;
  - `Welcome.md`.
- `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME` pointed to `/tmp/webkit-perf-home`, so no real config, vault or WebKit data was touched.

**Window:**
- Launched through Hyprland's `hl.dsp.exec_cmd` with rules `float, size 2536 1390, move 12 38`. That is the size of a full tile on this monitor, about 3.5 megapixels.
- Each run was one window of about 30–40 seconds, closed by PID afterwards.

**Measurement:**
- A temporary harness in the release build (`src/perfHarness.ts` plus one line in `main.ts`). It was removed and is not committed.
- It ran only when the vault held `perf/run.md`, and wrote its results to `perf/out-<label>.md`.
- Each phase calls `requestAnimationFrame` every frame for 3 s and drives the app through it:

| Phase | What happens every frame |
|---|---|
| `idle` | Nothing |
| `tinyMove` | Moves a 10 px fixed box (the bare pipeline cost) |
| `canvasZoom1` | One Ctrl+wheel step (±6) at the canvas centre |
| `canvasPan1` | One plain wheel step (±8) |
| `zoomNoGrid` / `panNoGrid` | The same, with the canvas dot grid hidden |
| `editorScroll` | Scrolls `.view-content` 20 px |

- Three quiet windows of 2 s each, with no `requestAnimationFrame`: start-up, the canvas open with nothing focused, and the editor focused and then blurred.

**Three ways of counting:**
- **rAF fps:** `requestAnimationFrame` callbacks per second. WebKit rounds the timestamps to 1 ms.
- **Commits per second:** frames actually sent to Hyprland. These are `wl_surface.commit` calls on the window's surface in a `WAYLAND_DEBUG=1` log, bucketed by each phase's wall-clock window. This counts what reached the screen, not just what the page asked for.
- **CPU %:** `utime + stime` from `/proc/<pid>/stat`, sampled every 250 ms, for the app process (`grove`) and the web process (`WebKitWebProcess`).

**Measurement problems (my own):**
- **Stray instances.** One early batch of five runs used a relative script path. Hyprland launched those windows, but my script never learned their PIDs. Five Grove instances (with the isolated `/tmp` config) stayed open for about 20 minutes until I found and closed them.
  - They ran the benchmark at the same time as the first matrix rows (the first four of the table below), so treat those rows as rough.
  - After that they sat idle, at about 1 % CPU each.
  - The before/after table below was re-measured afterwards with only one instance running: two CPU runs per side, plus one `WAYLAND_DEBUG` run.
- **Two temporary diagnostics.** The harness above, and a temporary FFI call to WebKit's feature API, used to test the 60 fps preference. Neither is committed.

## Before and after (clean runs, 2536×1390, NVIDIA, Wayland)

"Before" means the app as shipped (`WEBKIT_DISABLE_DMABUF_RENDERER=1`). "After" is this branch with no extra variables.

| Phase | Before: rAF fps | Before: commits/s | Before: web CPU | After: rAF fps | After: commits/s | After: web CPU |
|---|---:|---:|---:|---:|---:|---:|
| `canvasZoom1` (one card) | 50.3–51.4 | 44.7 | 92.6 % | 61.5 | 56.2 | 10.1–12.2 % |
| `canvasPan1` (one card) | 52.0–52.2 | 51.3 | 98.5–99.7 % | 60.7 | 59.7 | 10.8–12.8 % |
| `zoomNoGrid` | 62.3 | 53.9 | 36.4–36.8 % | 61.2–61.5 | 41.4 | 7.7–8.4 % |
| `panNoGrid` | 62.3 | 61.8 | 49.8–50.4 % | 60.7 | 59.7 | 10.8–12.2 % |
| `editorScroll` | 62.3 | 61.9 | 25.8–26.5 % | 60.5 | 59.5 | 8.7–9.4 % |
| `tinyMove` | 62.4 | 62.4 | 3.5 % | 60.5 | 59.6 | 2.4–3.1 % |
| Idle, editor focused | – | 1.5 | ~0 % | – | 1.5 | ~0–2 % |

**Notes on the table:**
- "Web CPU" is the web process as a percentage of one core. The app process (`grove`) was 8–11 % during gestures before and 6–9 % after.
- **Before the caret fix,** DMA-BUF mode presented **60.0 frames a second** while idle with the editor focused, and the app process used 4.1–4.5 % CPU. With the editor blurred it dropped to 1.5 a second, and with the canvas open to 0.
- **Zooming without the grid commits only about 41 frames a second after the fix,** while rAF stays at 61.5. Before it was about 54. I didn't look into this. One guess is that the zoom reaches its limit partway through the phase, so some frames change nothing. With the grid shown, a zoom commits 56 frames a second.
- **The canvas grid** (`radial-gradient` with `background-size` and `background-position` written every frame) is about 60 % of the CPU-path zoom cost and about 45 % of the pan cost. In the GPU path it costs a few percent.

## Configuration matrix (one run each; rAF fps for canvas zoom / pan, one card)

| Configuration | Zoom | Pan | Notes |
|---|---:|---:|---|
| As shipped: DMA-BUF off | 47 | 46 | Overlapped stray runs; clean runs gave 50–51 / 52 |
| `WEBKIT_DISABLE_DMABUF_RENDERER=0` | – | – | Exits at start: Error 71, "Missing acquire timeline" |
| DMA-BUF on + `__NV_DISABLE_EXPLICIT_SYNC=1` | 61.4 | 60.3 | No crash; renders correctly; web CPU about 10 % |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 43.7 | 45.8 | Overlapped stray runs; worse |
| `GDK_BACKEND=x11`, DMA-BUF off | 52.6 | 55.8 | Overlapped stray runs; same CPU path through XWayland |
| `GDK_BACKEND=x11` + DMA-BUF on | – | – | No output: `Failed to create GBM buffer of size 1280x800: Invalid argument` (twice), and the harness never finished |
| AMD iGPU, DMA-BUF off | 46 | 60.1 | Same CPU path |
| AMD iGPU, DMA-BUF on | 61.5 | 60.7 | No crash: Mesa doesn't attach explicit sync to the surface |
| DMA-BUF off + `__NV_DISABLE_EXPLICIT_SYNC=1` | 50.5 | 53.9 | Explicit sync isn't what slows the CPU path |
| DMA-BUF off + `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` | 51.9 | 55.5 | Web CPU 92.6 / 99.4 %, the same as default |
| DMA-BUF on + `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` | 62.3 | 62.3 | No crash, but editor scroll took 87.6 % web CPU |
| `WEBKIT_FORCE_VBLANK_TIMER=1` | 61.5 | 60.7 | Still 60 |
| `PreferPageRenderingUpdatesNear60FPS` feature off | 61.5–62.3 | 60.6–62.3 | Still 60 |

**How the variants were set up:**
- **AMD iGPU:** `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json`, `__GLX_VENDOR_LIBRARY_NAME=mesa`, `DRI_PRIME=1` and `WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD129`. The web process then opened only `renderD129`.
- **The `PreferPageRenderingUpdatesNear60FPS` row:** that WebKit feature is on by default. Turning it off took a temporary FFI call to `webkit_settings_set_feature_enabled`, which the `webkit2gtk` crate doesn't bind.

**What the matrix shows:**
- **CPU path.** `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` gives the same numbers as the default. So with DMA-BUF off, WebKit 2.54 is in effect painting on the CPU.
- **Explicit sync.** It's what crashes the GPU path, and it isn't what makes the CPU path slow.
- **X11.** The X11 GPU path doesn't work on this machine.
- **The AMD iGPU.** Its GPU path works without the variable. It's no faster than NVIDIA with the variable, and the display is on the NVIDIA card anyway.

## The 60 Hz cap

**Every run on this machine sat at 62 rAF callbacks a second,** with 16–17 ms gaps, including idle. Every gesture that kept up committed about 60 frames a second, never 240.

**The cause is in WebKit:**
- WebKitGTK's display link uses `DisplayVBlankMonitorDRM` and falls back to a fixed 60 Hz timer when that fails. It fails here with the "Operation not permitted" message quoted above.
- A direct `drmWaitVBlank` probe on `/dev/dri/card1`, as a client that isn't DRM master, returned "Operation not supported" for CRTCs 0–3. So nvidia-drm doesn't give non-master clients vblank waits.

**Ruled out:**
- `WEBKIT_FORCE_VBLANK_TIMER=1`: the same 60 Hz timer.
- WebKit's "prefer 60 fps" feature: off made no difference.
- `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS`: can only lower the rate.

**What could lift it:** a WebKitGTK change. For example, the timer fallback could use the monitor's refresh rate; GDK reports 239.97 Hz here. That would mean a bug report or patch upstream, or a different webview engine. Grove itself can't. Chromium-based apps such as Obsidian run at 240 Hz on the same screen, so Grove will look less fluid next to them even when it hits 60.

## App-side causes checked (step 3)

**`requestAnimationFrame` loops while idle: none.** A wrapper around `requestAnimationFrame` counted the app's own callbacks during a 2 s idle window: **0** in every run. I also read through the loops:
- graph `step` stops once settled;
- Bases and kanban only on scroll or drag;
- `treeDrag` only while dragging;
- canvas `schedule` per input.

**CSS animations:**
- No `backdrop-filter`, blur filter or infinite animation in Grove's stylesheets.
- The one endless animation came from CodeMirror's base theme: `.cm-cursorLayer { animation: steps(1) cm-blink 1.2s infinite }` while focused.
- Grove's cursor layer only holds the extra cursors of a multiple selection. For a plain caret it's empty, but it still animated, and the GPU path then presented every frame. Fixed (see below).

**`will-change: transform`:** it's on `.canvas-world` (moved every frame, which is the right use), edge labels, the selected card and the Bases drag ghost. With one card it isn't a measurable cost. On boards with many edge labels each label is its own layer, but that's a CZ3 question, not this one.

**The canvas dot grid:** the main cost in the CPU path, as above. In the GPU path it's cheap, so I left it alone. If the CPU path is kept anywhere (X11, or a user who sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`), the grid could be drawn so it doesn't repaint every frame. One way is a separate layer moved by `transform` modulo the grid step, redrawn only when a zoom settles.

## What changed

Two files: 50 lines added, 4 removed.

**`rebuild/app/src-tauri/src/lib.rs`:**
- `run()` calls a new `graphics_env()` (Linux only) instead of always setting `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- `graphics_env()` does one of two things:
  - **Wayland:** sets `__NV_DISABLE_EXPLICIT_SYNC=1`.
  - **X11:** sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, as before.
- "Wayland" means `WAYLAND_DISPLAY` is set and the first entry of `GDK_BACKEND` is empty, `*` or `wayland`. That's the order GDK tries backends in.
- In both cases a variable the user has already set wins.
- `gdk_uses_wayland()` holds that decision, with a unit test (`gdk_backend_choice`).

**`rebuild/app/src/editor/editor.ts`:**
- One theme rule: `&.cm-focused > .cm-scroller > .cm-cursorLayer:empty { animation: none }`.
- Extra cursors still blink, because the layer isn't empty then. The native caret's own blink is unchanged: about 1.5 commits a second in both modes.

**To undo it:** revert the code commit. To get the old behaviour without rebuilding, start Grove with `WEBKIT_DISABLE_DMABUF_RENDERER=1`; the app respects it.

## Trade-offs and risks of the fix

**NVIDIA with older drivers on Wayland.** Older drivers without working GBM can show a blank window with WebKit's DMA-BUF renderer. That blank window is the usual reason Tauri apps tell NVIDIA users to set `WEBKIT_DISABLE_DMABUF_RENDERER=1`. That variable still works here as an escape hatch, but Grove can't detect the problem by itself.

**Explicit sync off for NVIDIA:**
- `egl-wayland` falls back to implicit sync, which is how NVIDIA drivers before 555 always ran.
- I saw no flicker or stale frames: commit counts were steady, and screenshots taken mid-zoom and mid-scroll were clean.
- I only tried Hyprland. GNOME and KDE with NVIDIA are untested. They support the same sync protocol, and the error is required by the protocol, so they would probably have hit the same crash without the variable.
- It affects only Grove's processes. Mesa (AMD and Intel) ignores the variable, and those GPUs get WebKitGTK's default renderer, the one GNOME Web uses.

**X11:**
- Unchanged: still the CPU path, and still slow on canvases.
- Under XWayland on this machine the GPU path didn't work (GBM buffer errors). I couldn't test a pure X11 session.

**The 60 Hz cap is unchanged** (see above).

**Power and GPU use:**
- Rendering now happens on the NVIDIA GPU.
- Idle cost is about zero once the caret fix is in.
- Without the caret fix the GPU path would have presented 60 frames a second whenever an editor had focus. Keep the two changes together.

## Checks

- `npm run build`: passed.
- `npm run audit:offline`: passed (186 source files).
- `cargo build`: passed.
- `cargo test`: 74 passed, 4 ignored, including the new `gdk_backend_choice`.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0, first run. Vitest: 74 files, 1,255 tests passed; 2,608 PASS lines. The 300-card pan and zoom frame checks topped out at 16.8 ms.

Obsidian: nothing here depends on how Obsidian behaves. Its code and assets weren't used, and I relied on none of its docs.

## For Chris to decide

1. **Keep `__NV_DISABLE_EXPLICIT_SYNC=1` on every Wayland session, or only when an NVIDIA GPU is found?**
   - Detection is possible, for example `/sys/class/drm/renderD*/device/vendor == 0x10de`, but it adds code.
   - Setting it everywhere is harmless on Mesa.

2. **The 60 Hz cap.** Should someone file it with WebKitGTK? The issue: `DisplayVBlankMonitorDRM` fails on nvidia-drm, and the fallback timer ignores the monitor's refresh rate. Grove can't fix it.

3. **The canvas grid in the CPU path.** Is it worth optimising for X11 and opt-out users, or is the GPU path enough?
