# WebKitGTK Upstream Bug Reports (Ready to Paste)

Drafted from `rebuild/WEBKIT_HZ_NOTES.md` and `rebuild/WEBKIT_PERF_NOTES.md`.
The local reproduction files live in `rebuild/webkit-hz/` (`raf.html`, `probe.c`, `vblankshim.c`) and are also included inline in each report below so each report is self-contained when pasted into [WebKit Bugzilla](https://bugs.webkit.org/).

- **Bugzilla URL:** `https://bugs.webkit.org/enter_bug.cgi?product=WebKit`
- **Product:** `WebKit`
- **Component:** `WebKitGTK` (or `Platform` for Report 1 if preferred)
- **Version:** `WebKitGTK 2.54` (`webkit2gtk-4.1` 2.54.1)
- **Hardware / OS:** `PC` / `Linux`

---

## Report 1: `DisplayVBlankMonitor` timer fallback hard-coded to 60 Hz (and `drmWaitVBlank` error log uses `strerror(-ret)` instead of `errno`)

**Suggested Summary / Title:**
```text
[GTK] DisplayVBlankMonitor timer fallback is hard-coded to 60 Hz instead of using the monitor's refresh rate (and DRM failure logs strerror(-ret) instead of errno)
```

**Ready-to-paste Description:**

````markdown
### Summary

On high-refresh-rate monitors (tested on a 239.97 Hz Wayland display), when `DisplayVBlankMonitorDRM::create` fails to create a DRM vblank monitor, WebKitGTK falls back to `DisplayVBlankMonitorTimer` with a refresh rate hard-coded to **60 Hz**. As a result, `requestAnimationFrame` and page rendering updates are capped at 60 fps (~61–62 callbacks/s, 16–17 ms frame intervals) even though GDK knows the monitor's actual refresh rate (`gdk_monitor_get_refresh_rate` reports `239970` mHz).

This happens out of the box on NVIDIA GPUs because the `nvidia_drm` kernel module ships with DRM vblank disabled by default (`nvidia_drm` module parameter `vblank=0`), causing `drmWaitVBlank` to fail with `EOPNOTSUPP`. It also happens whenever `WEBKIT_FORCE_VBLANK_TIMER=1` is set or whenever `DisplayVBlankMonitorDRM` cannot use DRM vblank on the active CRTC.

In addition, the error message logged when `drmWaitVBlank` fails prints `strerror(-ret)` instead of `strerror(errno)`. Because `drmWaitVBlank` returns `-1` and sets `errno = EOPNOTSUPP` (95), `strerror(-(-1))` formats `EPERM` (1, `"Operation not permitted"`), which misleads users into thinking `/dev/dri/card*` has a file permissions problem rather than `EOPNOTSUPP` from `nvidia_drm.vblank=0`.

### Environment

- **WebKitGTK:** `webkit2gtk-4.1` 2.54.1 (`libwebkit2gtk-4.1.so.0.24.4`)
- **GTK:** `gtk3` 3.24.52
- **Compositor / Session:** Hyprland 0.56.2 (Wayland)
- **Display:** DP-2, 2560×1440 @ 239.97 Hz (`vrefresh 240`), VRR off, scale 1, driven by `/dev/dri/card1` (CRTC 205, index 0)
- **GPU / Driver:** NVIDIA RTX 5070 Ti, `nvidia-open` 615.78.08 (`egl-wayland` 1.1.24), `/sys/module/nvidia_drm/parameters/vblank` = `N` (default)

### Details & Root Cause

1. **Startup log and `errno` bug:**
   At startup, WebKit logs:
   ```
   Could not create a vblank monitor for display 1: drmWaitVBlank failed: Operation not permitted
   Failed to create DRM vblank monitor, falling back to timer
   ```
   Running the same `drmModeGetResources` / `drmWaitVBlank` sequence on `/dev/dri/card1` (see `probe.c` below) shows:
   ```
   connector 121 type 10-2 crtc 205 index 0 mode 2560x1440 vrefresh 240 ...
   drmWaitVBlank ret=-1 errno=95 (Operation not supported); strerror(-ret)=Operation not permitted
   ```
   `modinfo -p nvidia_drm` shows `vblank: Enable drm vblank notification support (1 = enable, 0 = disable (default))`, and `/sys/module/nvidia_drm/parameters/vblank` is `N`. Because `drmWaitVBlank` returns `-1` and sets `errno = 95` (`EOPNOTSUPP`), logging `strerror(-ret)` prints `strerror(1)` (`Operation not permitted`) instead of `strerror(errno)` (`Operation not supported`).

2. **Hard-coded 60 Hz timer fallback:**
   In `libwebkit2gtk-4.1.so.0` (2.54.1), the fallback path right next to the `WEBKIT_FORCE_VBLANK_TIMER` check allocates the timer monitor and calls its constructor with a constant `60` (`mov $0x3c, %esi`).
   - Setting `WEBKIT_FORCE_VBLANK_TIMER=1` hits the same 60 Hz timer.
   - Disabling the `PreferPageRenderingUpdatesNear60FPS` WebKit feature (`webkit_settings_set_feature_enabled(..., FALSE)`) has no effect.
   - `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` can only divide the refresh rate down.

3. **Verification with an `LD_PRELOAD` `drmWaitVBlank` shim:**
   When `drmWaitVBlank` is intercepted in `MiniBrowser` with a test shim (`vblankshim.c` below) that emulates a 239.97 Hz vblank whenever the kernel returns `EOPNOTSUPP`, `DisplayVBlankMonitorDRM` succeeds and an idle `requestAnimationFrame` loop in `MiniBrowser` immediately moves from **62 fps** to **240.0 fps** (and drawn frames in SHM mode move from 60 fps to **190–196 fps**; the separate GTK 3 EGL frame-clock cap on drawn DMA-BUF frames is reported separately).

### Steps to Reproduce

Save the three small files below (`probe.c`, `raf.html`, `vblankshim.c`).

1. **Verify `drmWaitVBlank` return value vs `errno`:**
   ```sh
   gcc -o probe probe.c $(pkg-config --cflags --libs libdrm)
   ./probe /dev/dri/card1
   ```
   Output on NVIDIA with default `nvidia_drm` (`vblank=0`):
   ```
   drmWaitVBlank ret=-1 errno=95 (Operation not supported); strerror(-ret)=Operation not permitted
   ```

2. **Run `raf.html` in `MiniBrowser` on a >60 Hz monitor (e.g. 240 Hz):**
   *(Note: on NVIDIA Wayland with GTK 3, `__NV_DISABLE_EXPLICIT_SYNC=1` is set to avoid a GTK 3 / explicit-sync protocol error.)*
   ```sh
   __NV_DISABLE_EXPLICIT_SYNC=1 /usr/lib/webkit2gtk-4.1/MiniBrowser \
     --enable-write-console-messages-to-stdout=true \
     "file://$PWD/raf.html"
   ```
   **Actual result:** WebKit logs `drmWaitVBlank failed: Operation not permitted`, falls back to the 60 Hz timer, and `raf.html` logs ~60–62 fps (`p50` ~16 ms) across all phases.

3. **Compare with emulated 239.97 Hz `drmWaitVBlank`:**
   ```sh
   gcc -O2 -shared -fPIC -o vblankshim.so vblankshim.c $(pkg-config --cflags libdrm) -ldl
   LD_PRELOAD=$PWD/vblankshim.so __NV_DISABLE_EXPLICIT_SYNC=1 \
     /usr/lib/webkit2gtk-4.1/MiniBrowser \
     --enable-write-console-messages-to-stdout=true \
     "file://$PWD/raf.html"
   ```
   **Result with shim:** The `idle` `requestAnimationFrame` phase runs at **240.0 fps** (`p50` ~4.17 ms).

### Expected Results / Suggested Fix

1. When `DisplayVBlankMonitorDRM::create` fails (or when `WEBKIT_FORCE_VBLANK_TIMER=1` is used), `DisplayVBlankMonitorTimer` should be initialized with the monitor's refresh rate reported by the platform/GDK (e.g. `gdk_monitor_get_refresh_rate(monitor) / 1000`, which reports 240 Hz here), falling back to 60 Hz only when the platform reports 0 / unknown.
2. In `DisplayVBlankMonitorDRM`, log `strerror(errno)` rather than `strerror(-ret)` when `drmWaitVBlank` fails (and optionally mention `nvidia_drm.vblank=1` when `errno == EOPNOTSUPP`).

### Reproduction Files

#### `probe.c`
```c
// Mirrors WebKit's DisplayVBlankMonitorDRM::create: find the CRTC driving a
// connector, then ask for the next vblank on it.
#include <xf86drm.h>
#include <xf86drmMode.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <time.h>
int main(int argc, char **argv) {
  const char *node = argc > 1 ? argv[1] : "/dev/dri/card1";
  int fd = open(node, O_RDWR | O_CLOEXEC);
  if (fd < 0) { perror("open"); return 1; }
  drmModeRes *res = drmModeGetResources(fd);
  if (!res) { perror("resources"); return 1; }
  for (int i = 0; i < res->count_connectors; i++) {
    drmModeConnector *c = drmModeGetConnector(fd, res->connectors[i]);
    if (!c || c->connection != DRM_MODE_CONNECTED || !c->encoder_id) continue;
    drmModeEncoder *e = drmModeGetEncoder(fd, c->encoder_id);
    int idx = -1;
    for (int j = 0; j < res->count_crtcs; j++) if (res->crtcs[j] == e->crtc_id) idx = j;
    drmModeCrtc *crtc = drmModeGetCrtc(fd, e->crtc_id);
    printf("connector %u type %u-%u crtc %u index %d mode %s vrefresh %u clock %u htotal %u vtotal %u\n",
      c->connector_id, c->connector_type, c->connector_type_id, e->crtc_id, idx,
      crtc->mode.name, crtc->mode.vrefresh, crtc->mode.clock, crtc->mode.htotal, crtc->mode.vtotal);
    drmVBlank vbl; memset(&vbl, 0, sizeof vbl);
    vbl.request.type = DRM_VBLANK_RELATIVE | ((idx << DRM_VBLANK_HIGH_CRTC_SHIFT) & DRM_VBLANK_HIGH_CRTC_MASK);
    vbl.request.sequence = 1;
    errno = 0;
    int ret = drmWaitVBlank(fd, &vbl);
    printf("drmWaitVBlank ret=%d errno=%d (%s); strerror(-ret)=%s\n", ret, errno, strerror(errno), strerror(-ret));
  }
  return 0;
}
```

#### `raf.html`
```html
<!doctype html><meta charset="utf-8"><title>rAF rate</title>
<style>html,body{margin:0;height:100%;background:#fff}
#grid{position:fixed;inset:0;background-image:radial-gradient(circle,#999 1px,transparent 1px);background-size:20px 20px}
#box{position:fixed;left:0;top:0;width:10px;height:10px;background:red}</style>
<div id="grid"></div><div id="box"></div>
<script>
// Each phase: rAF every frame for 3 s; log fps and gap percentiles to the console.
const grid = document.getElementById("grid"), box = document.getElementById("box");
const t0 = Date.now(), wall = () => Date.now();
function phase(name, perFrame) {
  return new Promise(done => {
    const gaps = []; let last = 0, start = 0, i = 0; const w0 = wall();
    const tick = now => {
      if (!start) start = now; if (last) gaps.push(now - last); last = now;
      perFrame && perFrame(i++);
      if (now - start < 3000) requestAnimationFrame(tick);
      else { gaps.sort((a, b) => a - b); const p = q => gaps[Math.floor((gaps.length - 1) * q)].toFixed(2);
        console.log("HZRESULT " + JSON.stringify({ name, fps: +(gaps.length / ((now - start) / 1000)).toFixed(1), p50: p(.5), p95: p(.95), wall: [w0, wall()], size: [innerWidth, innerHeight], ua: navigator.userAgent.slice(0, 60) })); done(); }
    };
    requestAnimationFrame(tick);
  });
}
setTimeout(async () => {
  await phase("idle");
  await phase("tinyMove", i => box.style.transform = `translateX(${i % 200}px)`);
  await phase("gridPan", i => grid.style.backgroundPosition = `${i % 40}px ${i % 40}px`);
  await phase("gridZoom", i => grid.style.backgroundSize = `${16 + (i % 64) / 8}px ${16 + (i % 64) / 8}px`);
  console.log("HZRESULT done");
}, 1500);
</script>
```

#### `vblankshim.c`
```c
// TEST ONLY. LD_PRELOAD shim: when the kernel refuses DRM_IOCTL_WAIT_VBLANK
// (nvidia_drm vblank=0), emulate a free-running vblank at SHIM_HZ so WebKit's
// DisplayVBlankMonitorDRM runs instead of its fixed 60 Hz timer.
#define _GNU_SOURCE
#include <xf86drm.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
static int (*real)(int, drmVBlankPtr);
int drmWaitVBlank(int fd, drmVBlankPtr vbl) {
  if (!real) real = dlsym(RTLD_NEXT, "drmWaitVBlank");
  unsigned type = vbl->request.type, want = vbl->request.sequence;
  int ret = real(fd, vbl);
  if (!(ret && errno == EOPNOTSUPP)) return ret;
  static double period; static int logged;
  if (!period) { const char *hz = getenv("SHIM_HZ"); period = 1.0 / (hz ? atof(hz) : 239.97); }
  if (!logged++) fprintf(stderr, "vblankshim: emulating %.2f Hz vblank\n", 1.0 / period);
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
  double now = ts.tv_sec + ts.tv_nsec / 1e9;
  unsigned long seq = (unsigned long)(now / period);
  if (type & DRM_VBLANK_RELATIVE) seq += want; else if (want > seq) seq = want;
  double at = seq * period;
  if (at > now) {
    struct timespec t = { (time_t)at, (long)((at - (time_t)at) * 1e9) };
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &t, NULL);
  }
  vbl->reply.sequence = (unsigned)seq;
  vbl->reply.tval_sec = (long)at;
  vbl->reply.tval_usec = (long)((at - (long)at) * 1e6);
  errno = 0;
  return 0;
}
```
````

---

## Report 2: GTK 3 Wayland DMA-BUF GL/EGL present path gets no frame callbacks or presentation feedback, capping `GdkFrameClock` and WebKit rendering at 60 Hz

**Suggested Summary / Title:**
```text
[GTK][GTK3][Wayland] DMA-BUF GL/EGL present path never updates GdkFrameClock with wl_surface.frame or presentation timings, capping drawn frames at 60 Hz on high-refresh displays
```

**Ready-to-paste Description:**

````markdown
### Summary

In WebKitGTK 4.1 (`webkit2gtk-4.1` 2.54.1, GTK 3.24.52) on Wayland using the default GPU (DMA-BUF) renderer, any animation that actually paints and presents frames is capped at **60 fps** (16.667 ms interval) on a 239.97 Hz monitor — even when `DisplayVBlankMonitorDRM` is ticking at 240 Hz.

- An idle `requestAnimationFrame` loop (which mutates no DOM/style and commits no surface damage) runs at **240 fps**.
- As soon as `requestAnimationFrame` mutates even a 10×10 px `transform: translateX(...)` box, both `requestAnimationFrame` and `wl_surface.commit` drop to **60 fps**.
- This reproduces in WebKitGTK's `MiniBrowser` on both **NVIDIA (`nvidia-open` 615.78.08)** and **AMD (`Mesa 26.2.5`)**.
- Switching the DMA-BUF renderer to its SHM present path (`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`) immediately lifts `MiniBrowser` on the same page to **190–196 fps** (190–195 `wl_surface.commit`/s).

### Environment

- **WebKitGTK:** `webkit2gtk-4.1` 2.54.1 (`libwebkit2gtk-4.1.so.0.24.4`)
- **GTK:** `gtk3` 3.24.52 (`libgdk-3.so.0.2420.32`)
- **Compositor / Session:** Hyprland 0.56.2 (Wayland)
- **Display:** DP-2, 2560×1440 @ 239.97 Hz, VRR off, scale 1
- **GPUs tested:**
  1. NVIDIA RTX 5070 Ti (`nvidia-open` 615.78.08, `egl-wayland` 1.1.24, `/dev/dri/renderD128`)
  2. AMD Radeon 610M (`Mesa` 26.2.5, `/dev/dri/renderD129`)
- **Reference browser on same setup:** Chromium 155.0.8059.84 (`--ozone-platform=wayland`) runs all phases of the same test page at **240.0 rAF/s** and **240.0 `wl_surface.commit`/s**.

### Root Cause Analysis

1. **Wayland protocol trace (`WAYLAND_DEBUG=1`):**
   - On the default **DMA-BUF GL/EGL present path**, every presented frame on the window's `wl_surface` consists of `damage`, `attach`, `wp_fifo_v1.set_barrier`, `commit`, and `wl_display.sync` issued by EGL.
   - Across an entire 15-second run of `MiniBrowser` (~900 presented frames), only **17–20 `wl_surface.frame` requests** are ever sent on the window's surface — all of them during initial window creation before the view switches to EGL presentation. Once EGL presentation starts, **no `wl_surface.frame` callbacks and no `wp_presentation` feedback** are requested or received by GTK for the window surface.
   - By contrast, with `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, GTK attaches the SHM buffer itself and requests `wl_surface.frame` on every frame (**1,766 `wl_surface.frame` requests** over the same run).

2. **GTK 3 `GdkFrameClock` 60 Hz default:**
   - In GTK 3 (`libgdk-3.so.0`), `gdk_frame_clock_get_refresh_info` learns the monitor's refresh interval from Wayland frame callbacks and presentation timings.
   - When neither arrives (because EGL is committing directly to the `wl_surface`), `gdk_frame_clock_get_refresh_info` falls back to its built-in constant default of **16,667 µs** (`mov $0x411b, %r13d`, i.e. 60 Hz), and `GdkFrameClockIdle` schedules paint ticks no closer together than 16.667 ms.
   - Because WebKit's UI process paces accelerated compositing presentation against the GTK widget draw cycle / frame clock, the web process blocks waiting for the UI process to present and is throttled to 60 fps whenever a frame draws.

### Measurements in `MiniBrowser` (viewport 2536×1352, 239.97 Hz monitor)

Each cell below is **`requestAnimationFrame` fps / `wl_surface.commit` per second** over a 3-second window per phase (`idle` has no commits because nothing draws):

| Configuration | `idle` (rAF only) | `tinyMove` (10 px box) | `gridPan` | `gridZoom` | Total `wl_surface.frame` requests |
|---|---:|---:|---:|---:|---:|
| NVIDIA GPU (`__NV_DISABLE_EXPLICIT_SYNC=1`) | 62 | 61 / 59 | 60 / 60 | 60 / 60 | 17–20 (startup only) |
| NVIDIA GPU + 240 Hz vblank (`vblankshim.so`) | **240** | **61 / 60** | **60 / 60** | **60 / 60** | 17–20 (startup only) |
| AMD Mesa GPU + 240 Hz vblank (`vblankshim.so`) | **240** | **61 / 60** | **60 / 60** | **60 / 60** | 17–20 (startup only) |
| NVIDIA + `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` + 240 Hz vblank | **240** | **196 / 195** | **192 / 192** | **190 / 190** | **1,766** |
| Chromium 155 (Wayland reference) | 240.1 | 240.2 / 239.6 | 240.0 / 240.0 | 240.0 / 239.9 | – |

Additional checks:
- `WEBKIT_SHOW_FPS=1` confirms the compositor rate (`CONSOLE RENDERING INFO FPS: 60.0...`).
- Disabling WebKit's `PreferPageRenderingUpdatesNear60FPS` setting via `webkit_settings_set_feature_enabled` makes no difference (and the SHM path reaches 190–196 fps with `PreferPageRenderingUpdatesNear60FPS` left enabled).

### Steps to Reproduce

1. Save `raf.html` and `vblankshim.c` (from below) and build the vblank shim (needed only if `drmWaitVBlank` is disabled by default on the driver, as on `nvidia_drm` with `vblank=0`):
   ```sh
   gcc -O2 -shared -fPIC -o vblankshim.so vblankshim.c $(pkg-config --cflags libdrm) -ldl
   ```

2. Run `MiniBrowser` on the default DMA-BUF GL/EGL path on a high-refresh-rate Wayland display:
   ```sh
   LD_PRELOAD=$PWD/vblankshim.so __NV_DISABLE_EXPLICIT_SYNC=1 \
     /usr/lib/webkit2gtk-4.1/MiniBrowser \
     --enable-write-console-messages-to-stdout=true \
     "file://$PWD/raf.html"
   ```
   *(For Mesa/AMD, omit `__NV_DISABLE_EXPLICIT_SYNC=1` and run on the Mesa render node.)*
   **Actual result:** `idle` logs `fps: 240`, while `tinyMove`, `gridPan`, and `gridZoom` all drop to `fps: 60` (`p50: 16.00`–`17.00` ms).

3. Run the exact same command with `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`:
   ```sh
   WEBKIT_DMABUF_RENDERER_FORCE_SHM=1 LD_PRELOAD=$PWD/vblankshim.so __NV_DISABLE_EXPLICIT_SYNC=1 \
     /usr/lib/webkit2gtk-4.1/MiniBrowser \
     --enable-write-console-messages-to-stdout=true \
     "file://$PWD/raf.html"
   ```
   **Result:** `tinyMove`, `gridPan`, and `gridZoom` jump to **190–196 fps** (`p50: 5.00` ms), at the cost of a full CPU core for SHM buffer copies.

### Expected Results

On the GTK 3 Wayland DMA-BUF GL/EGL path, presentation should either feed frame timing / `wl_surface.frame` callbacks back to GTK's `GdkFrameClock` (or pace swap/present directly from the display link / monitor refresh rate rather than blocking on an un-updated 16.667 ms `GdkFrameClock`), so GPU-rendered pages can animate at the monitor's refresh rate without falling back to CPU/SHM copies.

### Reproduction Files

#### `raf.html`
```html
<!doctype html><meta charset="utf-8"><title>rAF rate</title>
<style>html,body{margin:0;height:100%;background:#fff}
#grid{position:fixed;inset:0;background-image:radial-gradient(circle,#999 1px,transparent 1px);background-size:20px 20px}
#box{position:fixed;left:0;top:0;width:10px;height:10px;background:red}</style>
<div id="grid"></div><div id="box"></div>
<script>
// Each phase: rAF every frame for 3 s; log fps and gap percentiles to the console.
const grid = document.getElementById("grid"), box = document.getElementById("box");
const t0 = Date.now(), wall = () => Date.now();
function phase(name, perFrame) {
  return new Promise(done => {
    const gaps = []; let last = 0, start = 0, i = 0; const w0 = wall();
    const tick = now => {
      if (!start) start = now; if (last) gaps.push(now - last); last = now;
      perFrame && perFrame(i++);
      if (now - start < 3000) requestAnimationFrame(tick);
      else { gaps.sort((a, b) => a - b); const p = q => gaps[Math.floor((gaps.length - 1) * q)].toFixed(2);
        console.log("HZRESULT " + JSON.stringify({ name, fps: +(gaps.length / ((now - start) / 1000)).toFixed(1), p50: p(.5), p95: p(.95), wall: [w0, wall()], size: [innerWidth, innerHeight], ua: navigator.userAgent.slice(0, 60) })); done(); }
    };
    requestAnimationFrame(tick);
  });
}
setTimeout(async () => {
  await phase("idle");
  await phase("tinyMove", i => box.style.transform = `translateX(${i % 200}px)`);
  await phase("gridPan", i => grid.style.backgroundPosition = `${i % 40}px ${i % 40}px`);
  await phase("gridZoom", i => grid.style.backgroundSize = `${16 + (i % 64) / 8}px ${16 + (i % 64) / 8}px`);
  console.log("HZRESULT done");
}, 1500);
</script>
```

#### `vblankshim.c`
```c
// TEST ONLY. LD_PRELOAD shim: when the kernel refuses DRM_IOCTL_WAIT_VBLANK
// (nvidia_drm vblank=0), emulate a free-running vblank at SHIM_HZ so WebKit's
// DisplayVBlankMonitorDRM runs instead of its fixed 60 Hz timer.
#define _GNU_SOURCE
#include <xf86drm.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
static int (*real)(int, drmVBlankPtr);
int drmWaitVBlank(int fd, drmVBlankPtr vbl) {
  if (!real) real = dlsym(RTLD_NEXT, "drmWaitVBlank");
  unsigned type = vbl->request.type, want = vbl->request.sequence;
  int ret = real(fd, vbl);
  if (!(ret && errno == EOPNOTSUPP)) return ret;
  static double period; static int logged;
  if (!period) { const char *hz = getenv("SHIM_HZ"); period = 1.0 / (hz ? atof(hz) : 239.97); }
  if (!logged++) fprintf(stderr, "vblankshim: emulating %.2f Hz vblank\n", 1.0 / period);
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
  double now = ts.tv_sec + ts.tv_nsec / 1e9;
  unsigned long seq = (unsigned long)(now / period);
  if (type & DRM_VBLANK_RELATIVE) seq += want; else if (want > seq) seq = want;
  double at = seq * period;
  if (at > now) {
    struct timespec t = { (time_t)at, (long)((at - (time_t)at) * 1e9) };
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &t, NULL);
  }
  vbl->reply.sequence = (unsigned)seq;
  vbl->reply.tval_sec = (long)at;
  vbl->reply.tval_usec = (long)((at - (long)at) * 1e6);
  errno = 0;
  return 0;
}
```
````
