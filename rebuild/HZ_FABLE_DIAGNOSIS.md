# Grove on the 240 Hz monitor: why it feels laggy, and what to do

Read-only investigation, 2026-11-11, on Cloud. Checkout `grove-240hz` at `af0fcc3`. Nothing was edited, launched or signalled.

## Summary in plain English

- **Grove draws at most 60 frames a second on Cloud, on a screen that shows 240.** The mouse cursor, Hyprland's animations and every Chromium app (Obsidian included) update four times as often, so Grove looks and feels behind them. On Remi the screen itself is slower, so 60 looks normal there.
- **Nothing in Grove's own code causes this.** Two separate 60 Hz limits sit below it: one in WebKitGTK (triggered by the NVIDIA driver's default settings) and one in GTK 3. This repo already documents both (`rebuild/WEBKIT_HZ_NOTES.md`); I re-checked the causes today and they still hold.
- **There is probably a real hitch on top of the cap.** WebKit's fallback timer and GTK's timer run at slightly different speeds, so about one frame a second is dropped during a scroll or pan. This part is my inference from the earlier numbers, not a new measurement.
- **I disagree with the earlier conclusion that Grove can do nothing.** Both limits can be worked around from inside Grove's Rust side, without `LD_PRELOAD`. One workaround is small and low-risk; the other needs a prototype and measurement.
- **Recommended order:**
  1. Run two five-minute experiments to confirm by feel (section 3).
  2. Lift the WebKit limit, which gives a steadier 60 with less delay.
  3. Prototype lifting the GTK limit, which gives up to 240.
  4. File the two upstream reports that are already drafted.

**What I could not do:** the rules forbid launching Grove or opening windows, so every frame-rate figure below comes from `WEBKIT_HZ_NOTES.md` and `WEBKIT_PERF_NOTES.md`. Chris's Grove was not running (PID 3041945 no longer exists), so I read the binary and the session environment instead of `/proc/<pid>`.

---

## 1. Root causes, ranked

### Cause 1 (main): content is capped at 60 fps on a 240 Hz screen

Two limits stack. Either one alone holds Grove at 60.

**Limit A: WebKit's frame timer falls back to about 60 Hz because NVIDIA's DRM vblank is off.**

| Check (run today) | Result |
|---|---|
| `hyprctl monitors` | `2560x1440@239.97000`, `vrr: false`, on the NVIDIA card (`card1-DP-2: connected enabled`) |
| `cat /sys/module/nvidia_drm/parameters/vblank` | `N` |
| `modinfo -p nvidia_drm` | `vblank: Enable drm vblank notification support (1 = enable, 0 = disable (default))` |
| `/etc/modprobe.d/nvidia.conf` | `options nvidia_drm modeset=1` only |
| `DRM_IOCTL_WAIT_VBLANK` on `/dev/dri/card1` (Python `ioctl`, no file written) | `errno 95 ENOTSUP Operation not supported`, for CRTC index 0 and 1 |
| Same on `/dev/dri/card0` (AMD, no display) | `errno 22 EINVAL` |

- WebKit's source (`Source/WebKit/UIProcess/glib/DisplayVBlankMonitor.cpp`, read on `main`) falls back to `DisplayVBlankMonitorTimer` when `DisplayVBlankMonitorDRM::create` fails.
- The timer is built with the constant `WebCore::FullSpeedFramesPerSecond` and takes no monitor argument. The earlier notes found the literal 60 in the 2.54.1 binary.
- Its wait is `sleep_for(milliseconds(1000 / m_refreshRate))`. That is integer division, so it sleeps 16 ms, which is 62.5 Hz. This matches the 62.3 idle `requestAnimationFrame` rate the earlier notes measured.
- No environment variable raises it. `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` only divides the rate down, and `WEBKIT_FORCE_VBLANK_TIMER` selects the same timer.
- **This code runs in the UI process, which is the `grove` process itself.** That is what makes an in-app workaround possible (Fix A2).

**Limit B: GTK 3 paints a GL window on a fixed 16.667 ms clock.**

- With WebKit's GPU renderer, GTK 3 presents the window through EGL.
- In GTK 3.24's `gdk/wayland/gdkwindow-wayland.c`, `on_frame_clock_after_paint` returns early unless `impl->pending_commit` is set. Only the shared-memory path sets it. The GL branch of `gdk_window_impl_wayland_end_paint` clears it, with the comment "it'll be done implicitly by eglSwapBuffers()".
- `gdk_wayland_gl_context_end_frame` only swaps buffers. It requests no frame callback and does not freeze the clock.
- The real refresh interval is written only inside `frame_callback` (`timings->refresh_interval = …`). With no callback, the clock keeps `FRAME_INTERVAL 16667`.
- WebKit sends `frameDone` to the web process at the end of that GTK paint (`AcceleratedBackingStore::paint`), so the web process cannot produce frames faster than GTK paints.
- This matches the earlier protocol log: 17–20 `wl_surface.frame` requests in a whole GPU run, against 1,766 in SHM mode.
- Caveat: the fetch returned only the first 40,000 characters of `gdkwindow-wayland.c`. The functions quoted above were in that part.

**Measured effect** (from `WEBKIT_HZ_NOTES.md`, same machine, 2536×1390 window):

| Case | rAF fps | Frames reaching Hyprland per second |
|---|---:|---:|
| Grove, GPU path, editor scroll | 60.5 | 59.8 |
| Grove, GPU path, canvas pan | 60.5 | 59.3 |
| Chromium 155, same screen, grid pan | 240.0 | 240.0 |

**Why Remi feels fine (assumptions, since I have no data on Remi):**
- I assume an Intel or AMD laptop GPU on Mesa and a 60 Hz panel.
- At 60 Hz, Grove's 60 fps matches the cursor and everything else on screen, so nothing looks behind.
- If Remi's panel is 120 Hz, Limit B still holds Grove at 60 there, and the gap would be half as noticeable.
- To confirm, on Remi: `hyprctl monitors | grep -A1 '^Monitor'` and `lspci -k | grep -A3 -E 'VGA|3D'`.

### Cause 2 (likely, inferred): two unsynchronised timers drop about one frame a second

- WebKit's timer runs at 60.5–62.5 Hz and GTK's clock at 60.0 Hz. Neither follows the screen.
- In the earlier tables, rAF is 60.5–61.5 fps while only 56.2–59.8 frames a second are committed. So roughly one to five frames a second are made and never shown.
- With the vblank shim (WebKit side at 240 Hz), the same phases commit **60, 60, 60, 60**. The dropped frames disappear even though the rate stays 60.
- A dropped frame shows as a small jump during a steady scroll or pan. That fits "stutters" better than a plain 60 fps cap does.
- The same two timers also add delay: a change can wait up to 16 ms for WebKit's tick, then up to 16.7 ms for GTK's.
- Not verified: nobody has recorded a histogram of gaps between commits. Section 4 says how.

### Cause 3 (ruled out for Chris's build): painting on the CPU

- Before commit `2e65ab8`, Grove forced `WEBKIT_DISABLE_DMABUF_RENDERER=1` and fell to 45–52 fps at a full CPU core.
- Chris's build has the fix:
  - `~/workspaces/remote/obsidian-clone-app` is on `rebuild/integration` at `9203860`, and `git merge-base --is-ancestor 2e65ab8 HEAD` succeeds.
  - The release binary (built 2026-11-11 13:09) contains the string `__NV_DISABLE_EXPLICIT_SYNC`.
  - The session has `GDK_BACKEND=wayland,x11,*` and `WAYLAND_DISPLAY=wayland-1`, so `graphics_env()` takes the Wayland branch (`rebuild/app/src-tauri/src/lib.rs:136-154`).
- The CPU path would return only if something sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `GDK_BACKEND=x11` when Grove starts.

### Cause 4 (ruled out): Grove's own per-frame code

I found nothing that scales badly with refresh rate.

- **Wheel and scroll are coalesced to one draw per frame.**
  - Canvas: `rebuild/app/src/canvas/navigation.ts:123` (`schedule`) and `:164` (wheel handler).
  - Bases, kanban and the group menu use passive scroll listeners and `requestAnimationFrame`: `src/bases/view.ts:406`, `src/bases/kanban.ts:383`, `:415`, `src/bases/groupMenu.ts:139`.
- **No endless animations.** There is no `infinite` animation in Grove's CSS or TypeScript. CodeMirror's blinking cursor layer is switched off while empty (`src/editor/editor.ts:34-37`).
- **Animations are time-based, not frame-counted.** CSS durations come from tokens (`src/motion.ts`). The graph camera eases by elapsed time (`src/graph/camera.ts:58`, `src/graph/view.ts:267`).
- **The hitch meter is dev-only** (`src/shell/hitchMeter.ts:9`).
- **One thing to tidy if the cap is lifted:** a middle-button canvas drag calls `draw()` directly on every pointer move instead of `schedule()` (`src/canvas/navigation.ts`, the `dragPointer` callback after line 220). GTK delivers moves at its clock rate, so this is at most 60 a second today and up to 240 after Fix B.

### Cause 5 (ruled out): Hyprland settings

- `misc:vrr = 0`, `render:direct_scanout = 0`, `general:allow_tearing = false`, `debug:damage_tracking = 2`, `render:new_render_scheduling = false`. These are ordinary values.
- `hardwareCursorsInUse: false` (`cursor:no_hardware_cursors = 2`, automatic on NVIDIA). Hyprland redraws on every cursor move. That is cheap on an RTX 5070 Ti, and it is why the cursor is a true 240 Hz reference next to Grove.
- VRR would not help. It only matters for a fullscreen window, and it would lower the whole screen, cursor included, to Grove's rate.
- Chromium reaches 240 on this same compositor, so Hyprland is not the limit.

---

## 2. Recommended fixes, ranked

| # | Fix | Result expected | Visible change beyond smoothness | Risk |
|---|---|---|---|---|
| A1 | Turn on `nvidia_drm vblank=1` on Cloud | Steady 60, less delay | None in Grove. It is a system change with a reboot. | Low to medium, untested |
| A2 | Grove supplies vblank timing itself when the driver refuses | Same as A1, on any NVIDIA machine | None | Low, small code |
| B | Grove paces GTK's GL paints by compositor frame callbacks | Up to 240 with A1 or A2 | None intended; more GPU and CPU while something moves | Medium, needs a prototype |
| C | File the two drafted upstream reports | A proper fix in a later WebKitGTK | None | None (posts publicly) |
| D | Move to a Chromium or GTK 4 webview later | 240 without workarounds | Possibly many | High, not now |

### Fix A: lift the WebKit limit (do first)

It keeps 60 fps but removes the dropped frames and up to about 12 ms of delay. It is also required before Fix B can pass 60. Pick A1 or A2 after experiment 3.3.

**A1. System setting, no Grove code.**
- Change `/etc/modprobe.d/nvidia.conf` to `options nvidia_drm modeset=1 vblank=1`, rebuild the initramfs, and reboot.
- The parameter is read-only at runtime (`-r--r--r--`), so it cannot be flipped without a reload.
- `/etc/modprobe.d/supergfxd.conf` also sets `options nvidia-drm modeset=1`. Check that the two files do not conflict.
- Helps every WebKitGTK app on Cloud. Does nothing for other NVIDIA users of Grove.
- Never tested for real on this machine. NVIDIA ships it off and I found no stated reason.
- **Approval:** a system change, so it is Chris's call.

**A2. In-app fallback, about 60 lines of Rust.**
- The `grove` binary exports its own `drmWaitVBlank`. It calls the real one through `dlsym(RTLD_NEXT, …)`. Only when that fails with `EOPNOTSUPP` does it sleep until the next multiple of the monitor's refresh period and report success.
- Why it works without `LD_PRELOAD`:
  - `libwebkit2gtk-4.1.so.0` imports `drmWaitVBlank` as an ordinary undefined symbol and is not linked `-Bsymbolic` (`readelf -d` shows `BIND_NOW` only).
  - The executable is searched first, so its definition wins.
  - The vblank monitor lives in the UI process, so only `grove` needs it.
- The binary exports no dynamic symbols today (`nm -D --defined-only` prints 0). `build.rs` would add `cargo:rustc-link-arg-bins=-Wl,--export-dynamic-symbol=drmWaitVBlank`.
- WebKit calls it on its own thread. Read the refresh rate from GDK on the main thread, store it in an atomic, and update it when the window changes monitor.
- This is `rebuild/webkit-hz/vblankshim.c` made conditional and built in. On drivers where the real call works it changes nothing.
- The earlier notes rejected shipping the shim because it "fakes vblank timing for one driver". My view: WebKit's own fallback already invents a timer. This one uses the right rate and applies only on the exact error.
- Put it behind an environment switch (for example `GROVE_VBLANK=off`) and remove it when WebKit fixes the fallback.
- Check that it binds: `LD_DEBUG=bindings ./grove 2>&1 | grep drmWaitVBlank` should show libwebkit binding to `grove`.
- **Approval:** no visible change, so none needed beyond normal review.

### Fix B: lift the GTK limit (prototype behind a flag)

Make the GL path behave as GTK's own shared-memory path does: request a frame callback, hold the frame clock until the compositor answers, then paint again at once.

- **Where:** `rebuild/app/src-tauri/src/lockdown.rs`, after `.build()` in `build_window` (line 181). Linux and Wayland only.
- **Steps per frame:**
  1. In the toplevel's `draw` handler: note that this cycle painted. If no callback is outstanding, request `wl_surface.frame` on the surface from `gdk_wayland_window_get_wl_surface`. The request is sent before `eglSwapBuffers` commits, so it rides on that commit.
  2. In the frame clock's `after-paint` handler: if this cycle painted, call `gdk_window_freeze_toplevel_updates_libgtk_only`.
  3. When the callback fires: destroy it and call `gdk_window_thaw_toplevel_updates_libgtk_only`.
  4. On unmap or unrealize: drop the callback and thaw if frozen. GTK does the same for its own path.
- **Why the thaw paints immediately:** `gdk_frame_clock_paint_idle` zeroes `min_next_frame_time` at its start and only sets the 16.667 ms wait when the clock is not frozen. A clock frozen during `after-paint` therefore has no wait pending.
- **Availability:**
  - Both `_libgtk_only` functions are exported by `libgdk-3.so.0` (checked with `nm -D`).
  - `gdkwayland-sys 0.18.2` is already in `Cargo.lock`.
  - `wl_surface_frame` is a header inline, so it needs three hand-declared `libwayland-client` functions (`wl_proxy_marshal_flags`, `wl_proxy_add_listener`, `wl_proxy_destroy`) and `wl_callback_interface`. No new crate.
- **Risks:**
  - It relies on two functions GTK marks "libgtk only". GTK 3.24 is in maintenance, so they are unlikely to change, but this is not a public contract.
  - `libgdk-3` is linked `-Bsymbolic`, so its internals cannot be replaced. There is no supported way to hand the clock a refresh interval.
  - GTK's smoothed frame time still assumes 16.667 ms. That affects only GTK-side tick animations, and Grove's window holds nothing but the webview.
  - A hidden window gets no callbacks, so it stops painting until shown. GTK's SHM path already behaves this way.
  - NVIDIA's EGL may add its own throttling; the earlier log showed `wp_fifo_v1.set_barrier` on each frame.
  - Tried on no compositor yet. Keep it off by default (for example `GROVE_FRAME_PACING=compositor`) until the test plan passes on Hyprland, and decide on GNOME and KDE separately.
- **Cost:** up to four times the frames while something moves. On the GPU path that is roughly 5–9 % of a core rising to 20–35 %. Idle stays near zero, because the display link stops when nothing animates.
- Grove's per-frame work has to fit in 4.2 ms to reach 240. Heavy boards may land at 120, which is still better than 60.
- Frame-time limits in `npm test` (the 20 ms popup check, the 16.8 ms pan checks) may need new numbers. That is test-only.
- **Approval:** nothing looks different by design. Chris should approve turning it on by default, since it adds power use during motion.

### Fix C: file the upstream reports

- `rebuild/WEBKIT_UPSTREAM_REPORTS.md` holds two ready-to-paste reports. `NOTES_WK1-gemini.md` says nothing has been filed.
- A search found WebKit bug 199376 ("View is locked to 60 FPS", 2019) and bug 266629 (timer fallback when `drmWaitVBlank` fails, 2023). I did not find one that names the NVIDIA default or asks for the timer to use the monitor's rate.
- **Approval:** posting publicly needs Chris's go-ahead.

### Fix D: a different webview (watch only)

- Tauri has a `v3.0.0-alpha` line with a CEF (Chromium) runtime that uses GTK 4. A search shows `tauri-cef-v3.0.0-alpha.19` and no stable release. I did not confirm dates.
- Chromium already reaches 240 on this machine.
- `lockdown.rs` depends on WebKit-specific policy hooks and the spellchecker, and the app bundle would grow a lot.

### Not recommended

- **`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` as a shipped setting.** It reaches 170–190 fps but uses 83–98 % of a core at this window size.
- **`WEBKIT_DISABLE_DMABUF_RENDERER=1` or `GDK_BACKEND=x11`.** Both return to CPU painting.
- **Shipping an `LD_PRELOAD` shim.** Fix A2 does the same job inside the binary.
- **Lowering the monitor to 60 Hz for good.** It hides the gap by slowing everything else.

---

## 3. Quick experiments for Chris

`GROVE=~/workspaces/remote/obsidian-clone-app/rebuild/app/src-tauri/target/release/grove`

Close any running Grove first. Each run opens your usual vault. To keep it out, prefix a run with `XDG_CONFIG_HOME=/tmp/hz/config XDG_DATA_HOME=/tmp/hz/data XDG_CACHE_HOME=/tmp/hz/cache` and open a scratch folder.

### 3.1 Is it the screen rate? (most decisive, two minutes)

Drop the monitor to 60 Hz, use Grove, then restore.

```sh
hyprctl eval 'hl.monitor({ output = "DP-2", mode = "2560x1440@59.95", position = "0x0", scale = 1 })'
# ...scroll a long note, pan a canvas, drag a pane edge...
hyprctl eval 'hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1 })'
```

- I did not run these, since the rules forbid it. The syntax comes from your `~/.config/hypr/monitors.lua`, and `hyprctl --help` lists `eval <code>`. If `eval` refuses, `hyprctl reload` restores the config.
- **If Grove now feels like it does on Remi:** the cause is the 60 fps cap against a 240 Hz screen (Cause 1).
- **If it still stutters at 60 Hz:** Cause 2 or something new. Go to section 4.
- Optional: repeat with `2560x1440@120.00`.

### 3.2 Confirm the fallback and the cap (one minute)

```sh
WEBKIT_SHOW_FPS=1 $GROVE 2>&1 | grep -E 'vblank|FPS'
```

- Expect `Failed to create DRM vblank monitor, falling back to timer` at start, and FPS lines near 60 while you scroll.

### 3.3 Does lifting only the WebKit limit feel better? (stand-in for Fix A)

```sh
gcc -O2 -shared -fPIC -o /tmp/vblankshim.so \
  ~/workspaces/remote/grove-240hz/rebuild/webkit-hz/vblankshim.c \
  $(pkg-config --cflags libdrm) -ldl
LD_PRELOAD=/tmp/vblankshim.so $GROVE
```

- Expect the line `vblankshim: emulating 239.97 Hz vblank`.
- Still 60 fps. Look for steadier scrolling with no small jumps, and less trailing behind the cursor when you drag.
- If you can feel it, Fix A is worth doing by itself.

### 3.4 What would more than 60 feel like? (stand-in for Fix A plus B)

```sh
LD_PRELOAD=/tmp/vblankshim.so WEBKIT_DMABUF_RENDERER_FORCE_SHM=1 $GROVE
```

- Expect about 170–190 fps and a full CPU core while scrolling (watch `WebKitWebProcess` in `btop`).
- This is a taste of the result, not a fix. If it feels right, Fix B is worth prototyping.

### 3.5 Reference outside Grove (optional)

```sh
P=file://$HOME/workspaces/remote/grove-240hz/rebuild/webkit-hz/raf.html
__NV_DISABLE_EXPLICIT_SYNC=1 /usr/lib/webkit2gtk-4.1/MiniBrowser \
  --enable-write-console-messages-to-stdout=true "$P" 2>&1 | grep HZRESULT
chromium --ozone-platform=wayland --user-data-dir=/tmp/hz-chromium \
  --enable-logging=stderr "$P" 2>&1 | grep HZRESULT
```

- Expect MiniBrowser near 60 in every phase and Chromium near 240.

### 3.6 The real system setting (Fix A1, needs a reboot)

```sh
sudoedit /etc/modprobe.d/nvidia.conf   # options nvidia_drm modeset=1 vblank=1
sudo limine-mkinitcpio                 # or your usual initramfs rebuild
# reboot
cat /sys/module/nvidia_drm/parameters/vblank   # expect Y
```

- Then repeat 3.2. The fallback line should be gone.
- Untested here. To undo, remove `vblank=1`, rebuild and reboot.

---

## 4. Test plan to confirm a fix

Measure the same four things before and after each fix. Use one floating window of a fixed size (the earlier runs used 2536×1390), a scratch vault, and the same gestures each time: editor scroll, canvas pan, canvas zoom, pane-edge drag.

**1. Frames that reach the compositor, and their spacing (the main number).**

```sh
WAYLAND_DEBUG=1 $GROVE 2> /tmp/grove-wl.log
# after a 10 s scroll, close Grove, then find the window's surface:
grep -oE 'wl_surface[#@][0-9]+\.commit' /tmp/grove-wl.log | sort | uniq -c | sort -nr | head -3
# gap histogram in ms (put the busiest surface name in s=):
awk -v s='wl_surface#34.commit' 'index($0,s){t=$0; sub(/^\[ */,"",t); sub(/\].*/,"",t);
  if(p){h[int(t-p+0.5)]++} p=t} END{for(g in h) print g" ms: "h[g]}' /tmp/grove-wl.log | sort -n
```

- The log holds window titles, so delete it afterwards.

| State | Expected gaps |
|---|---|
| Today | Cluster at 16–17 ms, with a 33 ms gap about once a second (this would confirm Cause 2) |
| After Fix A | 16–17 ms only, no 33 ms gaps |
| After Fix A plus B | Cluster at 4 ms; 8 ms where a frame's work runs long |

**2. Page-side rate.** `WEBKIT_SHOW_FPS=1`, or the temporary perf harness described in `WEBKIT_PERF_NOTES.md`, for rAF fps and the p50 and p95 gap.

**3. Cost.** CPU for `grove` and `WebKitWebProcess` during each gesture and at idle (`pidstat -p <pid> 1`, or `btop`).
- Pass for Fix B: gestures stay well under one core, and idle is unchanged with commits near zero.

**4. Delay you can see.** Film a canvas-card or pane-edge drag with a phone at 240 fps slow motion. Count the frames between the cursor moving and the content following.
- Rough expectation: 5–8 frames today, fewer after Fix A, 2–3 after Fix B.

**Regression checks for Fix B:**
- Move the window to another workspace and back; minimise and restore; resize; open and close a second note window.
- Leave it idle for a minute and confirm it wakes on the first key.
- Run once at 60 Hz (experiment 3.1) to confirm nothing changes there.
- Run `npm test` and `cargo test`.

**Sign-off:** Chris repeats the gestures from 3.1 at 240 Hz and says whether it now feels like the rest of the desktop.

---

## Sources and what was verified

- **Verified today on Cloud:** monitor mode, VRR off, `nvidia_drm` parameters, the `ENOTSUP` vblank probe, Hyprland options, session environment, Chris's build commit and binary strings, the exported GDK symbols, how libwebkit links `drmWaitVBlank`, and the app-code audit.
- **Read from upstream source through a fetch agent:**
  - WebKit `main` (not the exact 2.54.1 tag): `DisplayVBlankMonitor.cpp`, `DisplayVBlankMonitorTimer.cpp`, `DisplayVBlankMonitorDRM.cpp`, `DisplayLinkGLib.cpp`, `UIProcess/gtk/AcceleratedBackingStore.cpp`, from <https://github.com/WebKit/WebKit>.
  - GTK `gtk-3-24`: `gdkwindow-wayland.c` (partial), `gdkglcontext-wayland.c`, `gdkframeclockidle.c`, `gdkframeclock.c`, `gdkwindow.c`, from <https://gitlab.gnome.org/GNOME/gtk>.
- **Taken from earlier notes, not re-measured:** every fps, commit and CPU figure (`rebuild/WEBKIT_HZ_NOTES.md`, `rebuild/WEBKIT_PERF_NOTES.md`).
- **Inferred, not verified:** Cause 2's dropped-frame hitch; that Fix A2 binds as described; that Fix B reaches 240; Remi's hardware.
- **Web search:**
  - <https://bugs.webkit.org/show_bug.cgi?id=199376>
  - <https://lists.webkit.org/pipermail/webkit-unassigned/2023-December/1139006.html>
  - <https://newreleases.io/project/github/tauri-apps/tauri/release/tauri-v3.0.0-alpha.0>
