# WK1 review (grok-c)

Branch `rebuild/wk1-review-grok-c`, same tree as `rebuild/wk1-gemini` `57181f0`. That branch starts at `rebuild/integration` `b5d0a34`, merges `rebuild/webkit-hz-claude` `9710815` as `f0e862e`, then adds the two drafts. Current `rebuild/integration` is `c9f88ec` (X1, after `b5d0a34`). Nothing was pushed. No GUI window was opened. No bug was filed. No Obsidian code, assets, or docs were used. No new crate or npm package.

## Scope

The WK1 row in `rebuild/CINDER_GAP_PLAN.md` at `b5d0a34` is: merge `rebuild/webkit-hz-claude` (notes and repro files only), and draft the two upstream reports as `rebuild/WEBKIT_UPSTREAM_REPORTS.md` for Chris to file. Choice 5A is the same split: an agent drafts, Chris files. This branch does that and nothing else.

`57181f0` adds only `rebuild/NOTES_WK1-gemini.md` and `rebuild/WEBKIT_UPSTREAM_REPORTS.md`. `f0e862e` against its first parent (`b5d0a34`) adds only the four files from `9710815`:

- `rebuild/WEBKIT_HZ_NOTES.md`
- `rebuild/webkit-hz/probe.c`
- `rebuild/webkit-hz/raf.html`
- `rebuild/webkit-hz/vblankshim.c`

Those four files match `9710815` (`git diff 9710815 f0e862e` on those paths is empty). No file under `rebuild/app/`, `src/`, or `ui/` differs from `b5d0a34`.

`git diff rebuild/integration...rebuild/wk1-gemini` is those four files plus the two drafts (6 files, 732 insertions), not only the two drafts. `9710815` is not on `rebuild/integration` (`c9f88ec` has no `WEBKIT_HZ_NOTES.md` and no `rebuild/webkit-hz/`). The plan at `b5d0a34` says the Hz notes are not merged yet, and WK1 is the merge. The extra four files are that merge. `git merge-tree --write-tree rebuild/integration HEAD` exits 0, so the later X1 commits do not overlap these paths.

## Reports against `WEBKIT_HZ_NOTES.md`

Both reports are local drafts. The notes file says nothing was filed. The commit does not add a filing step.

The two reports match the notes on the two limits:

1. NVIDIA `nvidia_drm` `vblank=0` makes `drmWaitVBlank` return `EOPNOTSUPP` (errno 95, "Operation not supported"). WebKit logs `strerror(-ret)`, which is `EPERM` ("Operation not permitted"), then falls back to a timer built with `mov $0x3c, %esi` (60). `WEBKIT_FORCE_VBLANK_TIMER` is that same timer. `PreferPageRenderingUpdatesNear60FPS` does not change it. `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` only divides the rate down.
2. On the GTK 3 Wayland DMA-BUF GL path, presented frames do not request `wl_surface.frame` or `wp_presentation` after startup (17–20 frame requests, all at startup; 1,766 in SHM mode). `gdk_frame_clock_get_refresh_info` keeps `mov $0x411b, %r13d` (16,667 µs). Drawn frames stay at 60 on NVIDIA and on Mesa. SHM plus the vblank shim reaches about 190–196 fps. Chromium 155 on the same page runs at about 240.

The MiniBrowser table and the Chromium row copy the notes' numbers (idle 62 without the shim, 240 with it; drawn GPU frames 60–61; SHM 196/195, 192/192, 190/190; Chromium 240.1, 240.2/239.6, 240.0/240.0, 240.0/239.9). `probe.c` and `raf.html` are inlined unchanged. `vblankshim.c` is the same program; both pastes drop one comment sentence ("It stands in for what `nvidia_drm.vblank=1` would give…"). The build lines match the notes.

Versions in the reports match this machine: webkit2gtk-4.1 2.54.1 (`libwebkit2gtk-4.1.so.0.24.4`), gtk3 3.24.52 (`libgdk-3.so.0.2420.32`), Hyprland 0.56.2, nvidia-open 615.78.08, egl-wayland 1.1.24, Mesa 26.2.5, Chromium 155.0.8059.84. `/sys/module/nvidia_drm/parameters/vblank` is `N`, and `modinfo -p nvidia_drm` still describes `vblank` as default 0. `01:00.0` is the RTX 5070 Ti (`card1`, `renderD128`). `0f:00.0` is the Radeon 610M (`card0`, `renderD129`). That matches `WEBKIT_PERF_NOTES.md`.

Checked without a window:

- `probe.c` on `/dev/dri/card1` printed `ret=-1 errno=95 (Operation not supported); strerror(-ret)=Operation not permitted`, CRTC 205, index 0, 2560×1440, vrefresh 240. The draft's sample says connector 121. This run printed connector 1225. Connector ids are assigned by the kernel. The errno line is the claim that matters, and it reproduced.
- In `libgdk-3.so.0.2420.32`, `gdk_frame_clock_get_refresh_info` contains `mov $0x411b, %r13d` at `0x30c58`.
- In `libwebkit2gtk-4.1.so.0.24.4`, the `WEBKIT_FORCE_VBLANK_TIMER` lookup is a `lea` at `0x1449dd3`, and the fallback path does `mov $0x3c, %esi` at `0x1449b45`.
- The log strings ("Could not create a vblank monitor", "drmWaitVBlank failed", "Failed to create DRM vblank monitor") are in that WebKit library.

Frame rates were not remeasured. MiniBrowser and Grove were not launched.

Nits in the paste text, none of which change the repro or the tables:

- Report 2's opening Chromium sentence says every phase commits at 240/s. The notes, and the table later in the same report, give idle as 240.1 rAF/s and 0.3 commits/s. Drawn phases are about 240 commits/s.
- That table is headed with the MiniBrowser viewport 2536×1352. The notes measure Chromium at 2536×1303.
- "15-second run (~900 presented frames)" is not in the notes. The 17–20 and 1,766 frame-callback counts are.
- The SHM step says `p50: 5.00` ms. The notes give 190–196 fps for that row and no percentile.
- The AMD step says to omit `__NV_DISABLE_EXPLICIT_SYNC=1` and use the Mesa render node. `WEBKIT_PERF_NOTES.md` names the variables that forced Mesa on this machine: `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json`, `__GLX_VENDOR_LIBRARY_NAME=mesa`, `DRI_PRIME=1`, `WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD129`. The NVIDIA steps stand on their own.
- Report 1 says `gdk_monitor_get_refresh_rate` returns `239970` mHz. The notes say GDK reports 239.97 Hz. That integer is 239.97 Hz in GDK's millihertz unit. This review did not call the function.

No real vault name or home path is in either draft. The display, GPU, and driver lines are the ones the notes already use for the repro. `/tmp` paths stay in `WEBKIT_HZ_NOTES.md`, which this branch only carries over from `9710815`.

`NOTES_WK1-gemini.md` matches the branch: merge `f0e862e`, no app code, two unfiled reports. Its check lines match this review's build, audit, and cargo results. It does not mention `npm test`. The WK1 row asks for `npm run build` and `cargo test`. The plan's usual list also includes `npm test` and `audit:offline`. This review ran all four.

## Checks

No app code changed, so there is no new bench. The numbers below are the same band as the integration reviews (300-card frames about 16.7–16.8 ms, 10k scroll p95 16.8 ms).

- `npm run build` in `rebuild/app`: passed. `tsc --noEmit` and Vite, 2137 modules.
- `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app`: exit 0 on the first run. Vitest 80 files, 1282 tests. 2830 `PASS` lines, including posttest. Geometry `Ctrl+o` frames were 16.7–16.8 ms. 300-card pan p95/max 16.8/16.8 ms, zoom 16.7/16.8 ms. K8 10k scroll p95 16.8, max 16.8, top 279218. Bases edge 10k scroll p95 16.8, max 16.8, 46 rows, top 160000. No timing flake, so no rerun.
- `npm run audit:offline` in `rebuild/app`: passed. 191 source files, `dist/`, CSP, capabilities, and dependencies. The script rebuilds; that build was again 2137 modules.
- `cargo test --offline` in `rebuild/app/src-tauri`: 84 passed, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`). `main.rs` and the doc tests ran 0 tests.

## Verdict

VERDICT: OK
