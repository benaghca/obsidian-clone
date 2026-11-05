# NOTES_WK1-gemini: Merge WebKit Hz Notes & Draft Upstream Bug Reports

Branch: `rebuild/wk1-gemini` (from `rebuild/integration` `b5d0a34`)

## What Was Done

1. **Merged `rebuild/webkit-hz-claude` (`9710815`) into `rebuild/wk1-gemini`** (`f0e862e`):
   - Brought in `rebuild/WEBKIT_HZ_NOTES.md` and the three local repro files under `rebuild/webkit-hz/` (`raf.html`, `probe.c`, `vblankshim.c`).
   - Confirmed no application code (`rebuild/app/`) was modified by the merge.

2. **Drafted `rebuild/WEBKIT_UPSTREAM_REPORTS.md`**:
   - Prepared two self-contained, ready-to-paste upstream WebKit Bugzilla reports based on `rebuild/WEBKIT_HZ_NOTES.md` and `rebuild/WEBKIT_PERF_NOTES.md`:
     1. **Report 1 (`DisplayVBlankMonitor` timer fallback & error logging):** Documents that `DisplayVBlankMonitorTimer` is hard-coded to 60 Hz (`mov $0x3c, %esi` in `libwebkit2gtk-4.1.so.0` 2.54.1) instead of using the monitor's refresh rate from GDK (`gdk_monitor_get_refresh_rate` reports 239.97 Hz), and that `DisplayVBlankMonitorDRM` logs `strerror(-ret)` (`EPERM`, "Operation not permitted") instead of `strerror(errno)` (`EOPNOTSUPP`, "Operation not supported" when `nvidia_drm` has `vblank=0`). Includes `probe.c`, `raf.html`, and `vblankshim.c` plus exact `MiniBrowser` repro steps.
     2. **Report 2 (GTK 3 Wayland DMA-BUF GL/EGL present path 60 Hz frame-clock cap):** Documents that on the GTK 3 Wayland DMA-BUF GL/EGL present path, EGL commits directly to the `wl_surface` without requesting `wl_surface.frame` callbacks or `wp_presentation` feedback after startup (only 17–20 `wl_surface.frame` requests vs 1,766 with `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`), leaving `gdk_frame_clock_get_refresh_info` at its 16,667 µs (60 Hz) default (`mov $0x411b, %r13d` in `libgdk-3.so.0`) and throttling drawn frames to 60 fps on both NVIDIA and AMD Mesa even when `DisplayVBlankMonitorDRM` runs at 240 Hz. Includes the `MiniBrowser` comparison table across NVIDIA, AMD Mesa, SHM, and Chromium 155, plus `raf.html` and `vblankshim.c`.
   - Nothing was filed, posted, or opened online.

## Checks Run and Results

All checks run in `rebuild/app`:

- `npm run build`: **passed** (`tsc --noEmit && vite build`, 2,137 modules transformed).
- `npm run audit:offline`: **passed** (191 source files, `dist/`, CSP, capabilities, and dependencies checked).
- `cargo test --manifest-path src-tauri/Cargo.toml --offline`: **passed** (`84 passed; 0 failed; 4 ignored`).
