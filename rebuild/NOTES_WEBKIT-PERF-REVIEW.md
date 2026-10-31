# WEBKIT-PERF-REVIEW

Branch `rebuild/webkit-perf-review-grok` from `984447b` (`rebuild/webkit-perf-claude`: `7802d84` plus `rebuild/WEBKIT_PERF_NOTES.md`), based on `rebuild/integration` `93dbb79`. Current `rebuild/integration` `1db658a` is merged in `5e46391`. The merge had no conflicts. Nothing was pushed. No GUI window was opened. No Obsidian code, assets, or docs were used. No new crate or npm package.

## What was reviewed

`7802d84` is the only product change. Against `rebuild/integration` it is 46 insertions and 4 deletions:

| File | Added | Removed |
| --- | ---: | ---: |
| `rebuild/app/src-tauri/src/lib.rs` | 42 | 4 |
| `rebuild/app/src/editor/editor.ts` | 4 | 0 |

`run()` on Linux calls `graphics_env()` (`lib.rs` 52–54, 127–157) instead of always setting `WEBKIT_DISABLE_DMABUF_RENDERER=1`. The editor theme stops the blink animation on an empty CodeMirror cursor layer (`editor.ts` 34–37). This review did not change that code.

## Env vars

`graphics_env()` runs at the start of `run()`, before Tauri builds the window, and only fills a variable that is unset.

On the Wayland choice it sets `__NV_DISABLE_EXPLICIT_SYNC=1`. Otherwise it sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, which is the old CPU path. The Wayland choice is `WAYLAND_DISPLAY` non-empty and the first `GDK_BACKEND` token empty, `*`, or `wayland` (`gdk_uses_wayland`, with `gdk_backend_choice`).

That matches GTK 3.24.52 on this machine (`libgdk-3.so.0.2420.32`, `gdk_display_manager_open_display`):

- With no allowed-backend list, GDK uses `*`.
- `GDK_BACKEND` is split on commas and tried in order. A `*` token tries the compiled backends.
- This build's table is `wayland`, then `x11`, then `broadway`.
- This session is `GDK_BACKEND=wayland,x11,*` with `WAYLAND_DISPLAY=wayland-1`, so both GDK and Grove pick Wayland.

Checked against the libraries, without launching Grove:

- `libnvidia-egl-wayland.so.1.1.24` (`wlEglInitializeHook`) turns explicit sync off only when `__NV_DISABLE_EXPLICIT_SYNC` is exactly `1`. The code sets `1`. The same string is in `libnvidia-egl-wayland2`, `libnvidia-eglcore`, `libnvidia-glcore`, and `libnvidia-vksc-core`. It is not in the Mesa libraries, so a non-NVIDIA Wayland session ignores it and keeps WebKit's normal DMA-BUF renderer.
- WebKitGTK 2.54.1 reads `WEBKIT_DISABLE_DMABUF_RENDERER` and disables the DMA-BUF renderer unless the variable is unset or `0`. Setting `1` is the CPU path. A user value of `0` leaves the GPU path on, which is why the notes' `=0` row still hit the protocol error.
- X11 NVIDIA uses different variables (`__NV_X11_DISABLE_EXPLICIT_SYNC`). Grove does not set those. On X11 it keeps the CPU path, which is the path the notes measured after the GBM buffer failure.

**X11.** Same as integration when the variable is unset: CPU renderer. A pure X11 session has no `WAYLAND_DISPLAY`, so the CPU path is chosen even if `GDK_BACKEND` is empty. `GDK_BACKEND=x11` or `x11,wayland` also takes the CPU path, including XWayland.

**Wayland, NVIDIA.** GPU renderer stays available, and explicit sync is forced off so GTK 3 can commit a plain buffer on the surface NVIDIA would otherwise mark with `wp_linux_drm_syncobj_surface_v1`. That is the crash in the notes (`Error 71`, errno `EPROTO`, "Missing acquire timeline").

**Wayland, Mesa.** The NVIDIA variable is unread. DMA-BUF stays at WebKit's default. The notes' AMD iGPU row is the measurement for that; this review did not repeat it.

**Fallback when the GPU path fails.** Two fallbacks stay in place. On X11, Grove still forces the CPU renderer. On Wayland, a variable set before launch wins, so `WEBKIT_DISABLE_DMABUF_RENDERER=1` still selects the CPU path with no rebuild. WebKit has no recovery once the compositor has closed the connection, and Grove does not add one. A blank window from an older NVIDIA GBM driver is the same escape hatch; the notes already say Grove cannot detect it.

One hole: the choice is made from the environment, before GDK opens a display. If `WAYLAND_DISPLAY` is set and the Wayland backend then fails, GDK's `*` list continues to X11 while Grove has already left DMA-BUF on. That needs a dead Wayland socket with `WAYLAND_DISPLAY` still set. A normal session opens Wayland and stops. Fixing it would mean reading the live display after GTK init and before EGL init. `gdk` is not a direct dependency, and this review does not add one.

## Notes against the code

`rebuild/WEBKIT_PERF_NOTES.md` matches the code on the branch choice, the user override, the cursor-layer rule, and the two env vars. The frame rates, CPU percentages, and the crash log are that branch's measurements. This review did not open a Grove window, so those numbers were not re-taken. The WebKit strings for the vblank failure and the GBM buffer failure are in `libwebkit2gtk-4.1.so.0.24.4`. The log line they quote (`drmWaitVBlank failed: %s`) and the probe line ("Operation not supported") can both be true; they are different calls.

Two claims to correct:

- The notes say the commit adds 50 lines and removes 4. `git show --stat 7802d84` is 46 insertions and 4 deletions.
- "Only NVIDIA's driver reads `__NV_DISABLE_EXPLICIT_SYNC`" is true on this machine (the five `libnvidia-*` libraries above). A value other than exactly `1` does not disable explicit sync, and Grove will not replace a value the user already set. `true` or `yes` would leave the crash in place.

The cursor rule matches Grove's editor. The drawn `cm-cursorLayer` is empty for a plain caret because the main empty range produces no marker (`editor.ts` 57); the browser draws that caret. CodeMirror's base theme still animates `.cm-focused > .cm-scroller > .cm-cursorLayer`. The new `:empty` rule turns that animation off and leaves it on when a multi-cursor marker is present. CodeMirror also sets `display: none` on an empty layer under WebKit (`LayerView.draw` in `@codemirror/view`). The CSS is the extra stop if that hide does not cancel the animation clock. Idle present counts were not remeasured.

The 60 Hz cap is unchanged, and this commit does not try to lift it. `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` can be rejected when it is not a factor of the refresh rate. It is not a way to reach 240 Hz. That part of the notes stands.

## Checks

All from `rebuild/app`. `cargo` from `rebuild/app/src-tauri`, with `--offline`. `npm test` and the cargo run used `flock /tmp/grove-npm-test.lock`. Screenshot trees under `rebuild/round*-shots/` were restored with `git checkout` and are not in the commit.

- `npm run build`: passed (`tsc`, Vite, 2132 modules).
- `flock … npm test`: exit 0. Vitest 75 files, 1260 tests. The known `EXPECTED FAIL` for `openLink(".md")` moving to `.MD` still prints; that bug is unchanged and the script still passes.
- `npm run audit:offline`: passed, 186 source files.
- `cargo build --offline`: passed, dev profile, 4.86 s.
- `cargo test --offline`: 82 passed, 0 failed, 5 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`, `legacy_name_search_must_not_list_a_file_named_dot_md`). `gdk_backend_choice` passed. Integration's last review count on this test set was 81 passed and the same 5 ignored; the extra pass is the new GDK test.

Headless benches against the integration reviews (`NOTES_SEARCH-PROPS-EDGE-TESTS-REVIEW.md`, `NOTES_LINKS-EMBEDS-EDGE-TESTS-REVIEW.md`). Nothing moved off those numbers.

| Check | Integration | This run |
| --- | --- | --- |
| 300-card pan / zoom, p95 and max | 16.8 ms | pan 16.7 / 16.8, zoom 16.7 / 16.8 |
| 300-card drag, max | 16.8 ms | 16.8 ms |
| Links type / switch, max and p95 | 16.8 / 16.7 and 16.7–16.8 | 16.8 / 16.7 and 16.7 / 16.7 |
| K8 10k scroll | p95 16.7, max 16.8, top 279218 | p95 16.8, max 16.8, top 279218 |
| Bases edge 10k scroll | p95 16.7, max 16.8, 46 rows, top 160000 | p95 16.7, max 16.8, 46 rows, top 160000 |
| Bases edge sort | 19.0 ms and 23.4 ms | 22.4 ms |
| 10k search / lines / switch | 5.552–5.866 / 0.005 / 0.004–0.005 | 5.552 / 0.005 / 0.005 |
| 1,000-card grid scroll | historical band 16.7–19.1 ms, cap 20 ms | 18.1 ms |

`LEDGE_BENCH` `link_targets` 1.85 ms and `tag_tree` 3.09 ms. The links notes' source medians were 1.70 and 2.87, and that review's runs sat in the same range. Both are far under the 50 ms ceiling. Property fuzz stayed at `cases=48`. No timing flake needed a rerun.

## Left open

The three decisions in `WEBKIT_PERF_NOTES.md` are still open: whether to set the NVIDIA variable only after seeing vendor `0x10de`, whether to report the 60 Hz vblank fallback upstream, and whether the canvas grid is worth a CPU-path change for X11 and for people who set `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Setting the variable on every Wayland session is safe here, because Mesa does not read it.

The Wayland-then-X11 miss above is the only behaviour I would change later, and only if a session with a dead `WAYLAND_DISPLAY` shows up. I would not block this branch on it.

VERDICT: OK. The Wayland and X11 split matches this GTK and the NVIDIA explicit-sync check, Mesa ignores the NVIDIA variable, the CPU path remains on X11 and when `WEBKIT_DISABLE_DMABUF_RENDERER` is set, and the headless benches match integration.
