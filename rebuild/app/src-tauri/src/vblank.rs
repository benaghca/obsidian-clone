//! Fix A2 (piece HZ): vblank timing for WebKit when the display driver refuses DRM vblank.
//!
//! WebKitGTK paces `requestAnimationFrame` and page updates from `drmWaitVBlank` on the CRTC
//! that drives the window's monitor. NVIDIA ships `nvidia_drm vblank=0`, so that call fails with
//! `EOPNOTSUPP` and WebKit falls back to a timer fixed at 60 Hz that sleeps a whole 16 ms
//! (62.5 Hz). That timer and GTK's own 60 Hz clock drift apart, so about one frame a second is
//! made and never shown (rebuild/HZ_FABLE_DIAGNOSIS.md, cause 2).
//!
//! The `grove` executable exports its own `drmWaitVBlank` (see `main.rs` and `build.rs`).
//! `libwebkit2gtk-4.1` imports the symbol as an ordinary undefined reference and is not linked
//! `-Bsymbolic`, so the executable's definition wins. WebKit's vblank monitor runs in the UI
//! process, which is `grove` itself; the web process is a separate executable and is untouched.
//!
//! Every call goes to libdrm's real `drmWaitVBlank` first. Only when it fails with
//! `EOPNOTSUPP`, for a plain blocking wait (no event, signal or flip), does Grove wait for the
//! next multiple of the CRTC's real refresh period instead and report success. The period comes
//! from the CRTC's current mode, read through libdrm, and is re-read once a second so a mode
//! change is followed. When the mode cannot be read, the original error is returned, which is
//! exactly today's behaviour (WebKit's timer). `GROVE_VBLANK_FALLBACK=off` turns this off.
//!
//! Idle cost: WebKit only waits for vblank while its display link has observers (something is
//! animating or a page update is pending). With nothing on screen changing, no call arrives.

use std::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_void, CStr};
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Set to `off` (or `0`, `no`, `false`) to leave WebKit's own fallback timer in place.
pub const ENV: &str = "GROVE_VBLANK_FALLBACK";

// xf86drm.h
pub const DRM_VBLANK_RELATIVE: c_uint = 0x1;
pub const DRM_VBLANK_HIGH_CRTC_MASK: c_uint = 0x0000_003e;
pub const DRM_VBLANK_HIGH_CRTC_SHIFT: c_uint = 1;
pub const DRM_VBLANK_EVENT: c_uint = 0x0400_0000;
pub const DRM_VBLANK_FLIP: c_uint = 0x0800_0000;
pub const DRM_VBLANK_NEXTONMISS: c_uint = 0x1000_0000;
pub const DRM_VBLANK_SECONDARY: c_uint = 0x2000_0000;
pub const DRM_VBLANK_SIGNAL: c_uint = 0x4000_0000;

const EOPNOTSUPP: c_int = 95;
const ENOSYS: c_int = 38;
const EINTR: c_int = 4;
const CLOCK_MONOTONIC: c_int = 1;
const TIMER_ABSTIME: c_int = 1;
/// libdrm's real call is looked up past the executable.
const RTLD_NEXT: *mut c_void = -1isize as *mut c_void;
/// Anything already loaded (libdrm, which WebKit links).
const RTLD_DEFAULT: *mut c_void = std::ptr::null_mut();

/// Refresh rates outside this range are treated as an unreadable mode.
const MIN_HZ: u64 = 20;
const MAX_HZ: u64 = 1000;
/// An emulated wait never goes further ahead than this, whatever the request asks.
const MAX_WAIT: Duration = Duration::from_secs(1);
/// How long a CRTC's period is trusted before the mode is read again.
const PERIOD_TTL: Duration = Duration::from_secs(1);

/// `drmVBlankReq` from xf86drm.h. `kind` is the `drmVBlankSeqType` enum (an `int`-sized value).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct VBlankRequest {
    pub kind: c_uint,
    pub sequence: c_uint,
    pub signal: c_ulong,
}

/// `drmVBlankReply` from xf86drm.h.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct VBlankReply {
    pub kind: c_uint,
    pub sequence: c_uint,
    pub tval_sec: c_long,
    pub tval_usec: c_long,
}

/// `drmVBlank`: the request goes in, the reply comes back in the same memory.
#[repr(C)]
pub union DrmVBlank {
    pub request: VBlankRequest,
    pub reply: VBlankReply,
}

#[repr(C)]
struct Timespec {
    tv_sec: c_long,
    tv_nsec: c_long,
}

#[repr(C)]
struct ModeInfo {
    clock: u32,
    hdisplay: u16,
    hsync_start: u16,
    hsync_end: u16,
    htotal: u16,
    hskew: u16,
    vdisplay: u16,
    vsync_start: u16,
    vsync_end: u16,
    vtotal: u16,
    vscan: u16,
    vrefresh: u32,
    flags: u32,
    kind: u32,
    name: [c_char; 32],
}

#[repr(C)]
struct ModeRes {
    count_fbs: c_int,
    fbs: *mut u32,
    count_crtcs: c_int,
    crtcs: *mut u32,
    count_connectors: c_int,
    connectors: *mut u32,
    count_encoders: c_int,
    encoders: *mut u32,
    min_width: u32,
    max_width: u32,
    min_height: u32,
    max_height: u32,
}

#[repr(C)]
struct ModeCrtc {
    crtc_id: u32,
    buffer_id: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    mode_valid: c_int,
    mode: ModeInfo,
    gamma_size: c_int,
}

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn clock_gettime(clock: c_int, tp: *mut Timespec) -> c_int;
    fn clock_nanosleep(clock: c_int, flags: c_int, request: *const Timespec, remain: *mut Timespec) -> c_int;
    fn __errno_location() -> *mut c_int;
}

type WaitFn = unsafe extern "C" fn(c_int, *mut DrmVBlank) -> c_int;
type GetResourcesFn = unsafe extern "C" fn(c_int) -> *mut ModeRes;
type FreeResourcesFn = unsafe extern "C" fn(*mut ModeRes);
type GetCrtcFn = unsafe extern "C" fn(c_int, u32) -> *mut ModeCrtc;
type FreeCrtcFn = unsafe extern "C" fn(*mut ModeCrtc);

/// What the environment switch asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Switch {
    On,
    Off,
    /// An unrecognised value: keep the default (on) and say so once.
    Unknown,
}

/// `GROVE_VBLANK_FALLBACK`: unset, empty, `on`, `1`, `yes`, `true` or `auto` keep it on.
pub fn parse_switch(value: Option<&str>) -> Switch {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("" | "on" | "1" | "yes" | "true" | "auto") => Switch::On,
        Some("off" | "0" | "no" | "false") => Switch::Off,
        Some(_) => Switch::Unknown,
    }
}

fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| {
        let raw = std::env::var(ENV).ok();
        match parse_switch(raw.as_deref()) {
            Switch::On => true,
            Switch::Off => false,
            Switch::Unknown => {
                eprintln!("grove: {ENV}={:?} is not on or off; leaving the vblank fallback on", raw.unwrap_or_default());
                true
            }
        }
    })
}

/// Whether a failed call is one Grove answers itself: the driver has no vblank support and
/// the caller wants a plain blocking wait (WebKit's monitor never asks for anything else).
pub fn should_emulate(ret: c_int, errno: Option<c_int>, kind: c_uint) -> bool {
    ret != 0
        && errno == Some(EOPNOTSUPP)
        && kind & (DRM_VBLANK_EVENT | DRM_VBLANK_SIGNAL | DRM_VBLANK_FLIP) == 0
}

/// The CRTC index a request names: `DRM_VBLANK_SECONDARY` is 1, the high-CRTC bits carry 2+.
pub fn crtc_index(kind: c_uint) -> usize {
    let high = (kind & DRM_VBLANK_HIGH_CRTC_MASK) >> DRM_VBLANK_HIGH_CRTC_SHIFT;
    if high != 0 {
        high as usize
    } else if kind & DRM_VBLANK_SECONDARY != 0 {
        1
    } else {
        0
    }
}

/// The frame period of a mode, in nanoseconds: `htotal × vtotal / pixel clock`, which keeps
/// fractional rates such as 239.97 Hz. Falls back to the rounded `vrefresh`. `None` when the
/// mode is not set or the rate is outside 20–1000 Hz.
pub fn mode_period_ns(clock_khz: u32, htotal: u16, vtotal: u16, vrefresh: u32) -> Option<u64> {
    let exact = (clock_khz != 0 && htotal != 0 && vtotal != 0)
        .then(|| u64::from(htotal) * u64::from(vtotal) * 1_000_000 / u64::from(clock_khz));
    let period = exact.or_else(|| (vrefresh != 0).then(|| 1_000_000_000 / u64::from(vrefresh)))?;
    (1_000_000_000 / MAX_HZ..=1_000_000_000 / MIN_HZ)
        .contains(&period)
        .then_some(period)
}

/// When an emulated wait ends and which sequence it reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    /// The vblank count reported back (vblanks of `period_ns` since the clock's zero).
    pub sequence: u64,
    /// The time of that vblank on the same clock. At or before `now` means "don't sleep".
    pub at_ns: u64,
}

/// Free-running vblanks at multiples of `period_ns` on the monotonic clock. A relative request
/// waits `want` vblanks past the current one (0 returns at once, 1 is the next vblank). An
/// absolute request waits for sequence `want`, compared with wraparound as the kernel does; a
/// missed one returns at once, or waits for the next with `NEXTONMISS`. No wait goes further
/// than `max_ahead` vblanks.
pub fn target(now_ns: u64, period_ns: u64, kind: c_uint, want: c_uint, max_ahead: u64) -> Target {
    let period = period_ns.max(1);
    let current = now_ns / period;
    let ahead = if kind & DRM_VBLANK_RELATIVE != 0 {
        u64::from(want)
    } else {
        let diff = want.wrapping_sub(current as u32) as i32;
        if diff > 0 {
            diff as u64
        } else if diff < 0 && kind & DRM_VBLANK_NEXTONMISS != 0 {
            1
        } else {
            0
        }
    };
    let sequence = current + ahead.min(max_ahead);
    Target { sequence, at_ns: sequence * period }
}

fn now_ns() -> Option<u64> {
    let mut ts = Timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid out-pointer for the call.
    if unsafe { clock_gettime(CLOCK_MONOTONIC, &mut ts) } != 0 {
        return None;
    }
    Some(ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64)
}

fn sleep_until(at_ns: u64) {
    let ts = Timespec { tv_sec: (at_ns / 1_000_000_000) as c_long, tv_nsec: (at_ns % 1_000_000_000) as c_long };
    // An absolute deadline, so an interrupted sleep just resumes towards the same instant.
    // SAFETY: `ts` is valid; a null remainder is allowed with TIMER_ABSTIME.
    while unsafe { clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, std::ptr::null_mut()) } == EINTR {}
}

unsafe fn lookup(handle: *mut c_void, name: &CStr) -> *mut c_void {
    dlsym(handle, name.as_ptr())
}

fn real_wait() -> Option<WaitFn> {
    static REAL: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
    let mut ptr = REAL.load(Ordering::Acquire);
    if ptr.is_null() {
        // SAFETY: dlsym with a NUL-terminated name.
        ptr = unsafe { lookup(RTLD_NEXT, c"drmWaitVBlank") };
        REAL.store(ptr, Ordering::Release);
    }
    // SAFETY: libdrm's drmWaitVBlank has exactly this signature.
    (!ptr.is_null()).then(|| unsafe { std::mem::transmute::<*mut c_void, WaitFn>(ptr) })
}

struct ModeApi {
    get_resources: GetResourcesFn,
    free_resources: FreeResourcesFn,
    get_crtc: GetCrtcFn,
    free_crtc: FreeCrtcFn,
}

fn mode_api() -> Option<&'static ModeApi> {
    static API: OnceLock<Option<ModeApi>> = OnceLock::new();
    API.get_or_init(|| unsafe {
        // SAFETY: each symbol, when present, is libdrm's function with the declared signature.
        let get_resources = lookup(RTLD_DEFAULT, c"drmModeGetResources");
        let free_resources = lookup(RTLD_DEFAULT, c"drmModeFreeResources");
        let get_crtc = lookup(RTLD_DEFAULT, c"drmModeGetCrtc");
        let free_crtc = lookup(RTLD_DEFAULT, c"drmModeFreeCrtc");
        if [get_resources, free_resources, get_crtc, free_crtc].iter().any(|p| p.is_null()) {
            return None;
        }
        Some(ModeApi {
            get_resources: std::mem::transmute::<*mut c_void, GetResourcesFn>(get_resources),
            free_resources: std::mem::transmute::<*mut c_void, FreeResourcesFn>(free_resources),
            get_crtc: std::mem::transmute::<*mut c_void, GetCrtcFn>(get_crtc),
            free_crtc: std::mem::transmute::<*mut c_void, FreeCrtcFn>(free_crtc),
        })
    })
    .as_ref()
}

/// The current mode's period on CRTC number `index` of the device open on `fd`.
fn read_period(fd: c_int, index: usize) -> Option<u64> {
    let api = mode_api()?;
    // SAFETY: libdrm returns owned structs (or null) that we free with its own functions,
    // and `crtcs` holds `count_crtcs` entries.
    unsafe {
        let res = (api.get_resources)(fd);
        if res.is_null() {
            return None;
        }
        let count = usize::try_from((*res).count_crtcs).unwrap_or(0);
        let id = (index < count && !(*res).crtcs.is_null()).then(|| *(*res).crtcs.add(index));
        (api.free_resources)(res);
        let crtc = (api.get_crtc)(fd, id?);
        if crtc.is_null() {
            return None;
        }
        let mode = &(*crtc).mode;
        let period = ((*crtc).mode_valid != 0)
            .then(|| mode_period_ns(mode.clock, mode.htotal, mode.vtotal, mode.vrefresh))
            .flatten();
        (api.free_crtc)(crtc);
        period
    }
}

struct Known {
    fd: c_int,
    index: usize,
    period_ns: Option<u64>,
    read_at: Instant,
}

/// The period for one CRTC, cached for a second per (fd, CRTC). WebKit has one monitor thread
/// per display, so this is touched by a handful of threads at most.
fn period_for(fd: c_int, index: usize) -> Option<u64> {
    static KNOWN: Mutex<Vec<Known>> = Mutex::new(Vec::new());
    let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    if let Some(entry) = known.iter_mut().find(|k| k.fd == fd && k.index == index) {
        if now.duration_since(entry.read_at) < PERIOD_TTL {
            return entry.period_ns;
        }
        entry.period_ns = read_period(fd, index);
        entry.read_at = now;
        return entry.period_ns;
    }
    let period_ns = read_period(fd, index);
    known.retain(|k| now.duration_since(k.read_at) < PERIOD_TTL * 10);
    known.push(Known { fd, index, period_ns, read_at: now });
    period_ns
}

fn note_once(flag: &AtomicBool, message: impl FnOnce() -> String) {
    if !flag.swap(true, Ordering::Relaxed) {
        eprintln!("{}", message());
    }
}

/// Answer one refused wait from the CRTC's own refresh period. `None` leaves the error alone.
fn emulate(fd: c_int, vbl: *mut DrmVBlank, kind: c_uint, want: c_uint) -> Option<()> {
    static STARTED: AtomicBool = AtomicBool::new(false);
    static NO_MODE: AtomicBool = AtomicBool::new(false);
    let index = crtc_index(kind);
    let Some(period) = period_for(fd, index) else {
        note_once(&NO_MODE, || {
            format!("grove: DRM vblank is not supported and the display mode of CRTC {index} could not be read; WebKit keeps its own frame timer")
        });
        return None;
    };
    let now = now_ns()?;
    let max_ahead = (MAX_WAIT.as_nanos() as u64 / period).max(1);
    let goal = target(now, period, kind, want, max_ahead);
    note_once(&STARTED, || {
        format!(
            "grove: DRM vblank is not supported by the display driver; timing WebKit's frames at {:.2} Hz from the display mode ({ENV}=off turns this off)",
            1e9 / period as f64
        )
    });
    if goal.at_ns > now {
        sleep_until(goal.at_ns);
    }
    // SAFETY: the caller's `vbl` is valid for the whole call, as for the real function.
    unsafe {
        (*vbl).reply = VBlankReply {
            kind,
            sequence: goal.sequence as c_uint,
            tval_sec: (goal.at_ns / 1_000_000_000) as c_long,
            tval_usec: ((goal.at_ns % 1_000_000_000) / 1_000) as c_long,
        };
        *__errno_location() = 0;
    }
    Some(())
}

/// Grove's `drmWaitVBlank`, exported from the executable by `main.rs`.
///
/// # Safety
/// Same contract as libdrm's: `vbl` points at a valid `drmVBlank`.
pub unsafe fn drm_wait_vblank(fd: c_int, vbl: *mut DrmVBlank) -> c_int {
    let Some(real) = real_wait() else {
        *__errno_location() = ENOSYS;
        return -1;
    };
    if vbl.is_null() {
        return real(fd, vbl);
    }
    let request = (*vbl).request;
    let ret = real(fd, vbl);
    let errno = std::io::Error::last_os_error().raw_os_error();
    if !should_emulate(ret, errno, request.kind) || !enabled() {
        return ret;
    }
    let answered = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| emulate(fd, vbl, request.kind, request.sequence))).ok().flatten();
    if answered.is_some() {
        return 0;
    }
    // Hand back the driver's answer untouched, as if Grove were not here.
    if let Some(code) = errno {
        *__errno_location() = code;
    }
    ret
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switch_values() {
        for on in [None, Some(""), Some("on"), Some("ON"), Some(" 1 "), Some("yes"), Some("true"), Some("auto")] {
            assert_eq!(parse_switch(on), Switch::On, "{on:?}");
        }
        for off in [Some("off"), Some("Off"), Some("0"), Some("no"), Some("false"), Some(" off\n")] {
            assert_eq!(parse_switch(off), Switch::Off, "{off:?}");
        }
        assert_eq!(parse_switch(Some("240")), Switch::Unknown);
        assert_eq!(parse_switch(Some("disable")), Switch::Unknown);
    }

    #[test]
    fn only_the_unsupported_error_on_a_blocking_wait_is_answered() {
        let relative = DRM_VBLANK_RELATIVE;
        assert!(should_emulate(-1, Some(EOPNOTSUPP), relative));
        assert!(should_emulate(-1, Some(EOPNOTSUPP), relative | (2 << DRM_VBLANK_HIGH_CRTC_SHIFT)));
        assert!(should_emulate(-1, Some(EOPNOTSUPP), 0));
        // A working driver, or any other error, is passed straight back.
        assert!(!should_emulate(0, Some(EOPNOTSUPP), relative));
        assert!(!should_emulate(0, None, relative));
        assert!(!should_emulate(-1, Some(22), relative)); // EINVAL
        assert!(!should_emulate(-1, Some(1), relative)); // EPERM
        assert!(!should_emulate(-1, Some(16), relative)); // EBUSY
        assert!(!should_emulate(-1, None, relative));
        // Event, signal and flip requests need the kernel; they are never faked.
        assert!(!should_emulate(-1, Some(EOPNOTSUPP), relative | DRM_VBLANK_EVENT));
        assert!(!should_emulate(-1, Some(EOPNOTSUPP), relative | DRM_VBLANK_SIGNAL));
        assert!(!should_emulate(-1, Some(EOPNOTSUPP), relative | DRM_VBLANK_FLIP));
    }

    #[test]
    fn crtc_index_from_request_bits() {
        assert_eq!(crtc_index(DRM_VBLANK_RELATIVE), 0);
        assert_eq!(crtc_index(DRM_VBLANK_RELATIVE | DRM_VBLANK_SECONDARY), 1);
        for index in 1..=31u32 {
            let kind = DRM_VBLANK_RELATIVE | ((index << DRM_VBLANK_HIGH_CRTC_SHIFT) & DRM_VBLANK_HIGH_CRTC_MASK);
            assert_eq!(crtc_index(kind), index as usize);
        }
    }

    #[test]
    fn mode_period_keeps_fractional_rates() {
        // 2560x1440 @ 239.97 Hz: 2720 × 1525 totals at 995,396 kHz.
        let period = mode_period_ns(995_396, 2720, 1525, 240).unwrap();
        let hz = 1e9 / period as f64;
        assert!((hz - 239.97).abs() < 0.01, "{hz}");
        // 1920x1080 @ 60: 2200 × 1125 at 148,500 kHz is exactly 60 Hz.
        assert_eq!(mode_period_ns(148_500, 2200, 1125, 60), Some(16_666_666));
        // No timings: the rounded rate.
        assert_eq!(mode_period_ns(0, 0, 0, 144), Some(1_000_000_000 / 144));
        // Unset or absurd modes are unreadable.
        assert_eq!(mode_period_ns(0, 0, 0, 0), None);
        assert_eq!(mode_period_ns(0, 0, 0, 5), None);
        assert_eq!(mode_period_ns(0, 0, 0, 5000), None);
    }

    #[test]
    fn relative_waits_land_on_the_next_boundaries() {
        let period = 4_167_000; // ~240 Hz
        let now = 1_000 * period + 1_234;
        // 0: report the current vblank, no sleep (WebKit's probe call).
        let t0 = target(now, period, DRM_VBLANK_RELATIVE, 0, 240);
        assert_eq!(t0, Target { sequence: 1_000, at_ns: 1_000 * period });
        assert!(t0.at_ns <= now);
        // 1: the next boundary, never in the past and never more than one period away.
        let t1 = target(now, period, DRM_VBLANK_RELATIVE, 1, 240);
        assert_eq!(t1.sequence, 1_001);
        assert!(t1.at_ns > now && t1.at_ns - now <= period);
        // Exactly on a boundary: the next one is a whole period later.
        let on = target(5 * period, period, DRM_VBLANK_RELATIVE, 1, 240);
        assert_eq!(on.at_ns, 6 * period);
        // A huge request is capped.
        assert_eq!(target(now, period, DRM_VBLANK_RELATIVE, 100_000, 240).sequence, 1_240);
    }

    #[test]
    fn steady_frames_have_no_drift() {
        // A caller that asks for the next vblank as soon as the last one returns (WebKit's monitor
        // loop) gets evenly spaced deadlines, unlike WebKit's own `sleep_for(1000 / 60 ms)`.
        let period = 16_666_666;
        let mut now = 123_456_789;
        let mut last = None;
        for _ in 0..600 {
            let t = target(now, period, DRM_VBLANK_RELATIVE, 1, 60);
            if let Some(prev) = last {
                assert_eq!(t.at_ns - prev, period);
            }
            last = Some(t.at_ns);
            now = t.at_ns + 250_000; // the work after each tick
        }
        // Integer-ms sleeping gives 62.5 Hz, not 60.
        assert_eq!(1000 / (1000 / 60), 62);
    }

    /// Manual: drives `drm_wait_vblank` against a real DRM device, the way WebKit's monitor
    /// loop does, and measures the spacing. No window. On a driver that refuses vblank it
    /// checks the emulated rate; on one that supports it, it only checks the pass-through.
    /// `cargo test --offline vblank::tests::live -- --ignored --nocapture`
    /// (`GROVE_TEST_DRM=/dev/dri/cardN` picks the device; default card1).
    #[test]
    #[ignore]
    fn live_device_pacing() {
        use std::os::fd::AsRawFd;
        extern "C" {
            fn dlopen(name: *const c_char, flags: c_int) -> *mut c_void;
        }
        // RTLD_NOW | RTLD_GLOBAL, so RTLD_NEXT / RTLD_DEFAULT find libdrm as they do in `grove`.
        assert!(!unsafe { dlopen(c"libdrm.so.2".as_ptr(), 0x2 | 0x100) }.is_null(), "libdrm.so.2");
        let node = std::env::var("GROVE_TEST_DRM").unwrap_or_else(|_| "/dev/dri/card1".into());
        let file = std::fs::OpenOptions::new().read(true).write(true).open(&node).expect("open DRM node");
        let fd = file.as_raw_fd();
        let Some((index, period)) = (0..8).find_map(|i| read_period(fd, i).map(|p| (i, p))) else {
            panic!("no CRTC with a mode on {node}");
        };
        let kind = DRM_VBLANK_RELATIVE | (((index as c_uint) << DRM_VBLANK_HIGH_CRTC_SHIFT) & DRM_VBLANK_HIGH_CRTC_MASK);
        let call = |sequence| {
            let mut vbl = DrmVBlank { request: VBlankRequest { kind, sequence, signal: 0 } };
            let ret = unsafe { drm_wait_vblank(fd, &mut vbl) };
            (ret, unsafe { vbl.reply })
        };
        let mut raw = DrmVBlank { request: VBlankRequest { kind, sequence: 0, signal: 0 } };
        let real = unsafe { real_wait().unwrap()(fd, &mut raw) };
        let errno = std::io::Error::last_os_error().raw_os_error();
        println!("{node} CRTC {index}: mode {:.3} Hz, real drmWaitVBlank ret={real} errno={errno:?}", 1e9 / period as f64);
        assert_eq!(call(0).0, 0, "probe call (WebKit's create) must succeed");
        let frames = 240;
        let mut gaps = Vec::with_capacity(frames);
        let mut last_seq = call(1).1.sequence;
        let cpu = || {
            let mut ts = Timespec { tv_sec: 0, tv_nsec: 0 };
            unsafe { clock_gettime(3, &mut ts) }; // CLOCK_THREAD_CPUTIME_ID
            ts.tv_sec as f64 * 1e3 + ts.tv_nsec as f64 / 1e6
        };
        let cpu_start = cpu();
        let start = Instant::now();
        let mut last = start;
        for _ in 0..frames {
            let (ret, reply) = call(1);
            assert_eq!(ret, 0);
            assert_eq!(reply.sequence, last_seq.wrapping_add(1), "one vblank per call");
            last_seq = reply.sequence;
            let now = Instant::now();
            gaps.push(now.duration_since(last).as_secs_f64() * 1e3);
            last = now;
        }
        let hz = frames as f64 / start.elapsed().as_secs_f64();
        let (min, max) = gaps.iter().fold((f64::MAX, 0f64), |(a, b), &g| (a.min(g), b.max(g)));
        let busy = (cpu() - cpu_start) / (start.elapsed().as_secs_f64() * 1e3) * 100.0;
        println!("{frames} waits: {hz:.2} Hz, gaps {min:.3}–{max:.3} ms, thread CPU {busy:.3} % of a core");
        if real != 0 {
            let want = 1e9 / period as f64;
            assert!((hz - want).abs() / want < 0.02, "{hz} Hz against a {want} Hz mode");
        }
    }

    #[test]
    fn absolute_waits_follow_kernel_rules() {
        let period = 10_000_000;
        let now = 50 * period + 1;
        assert_eq!(target(now, period, 0, 53, 100).sequence, 53);
        assert_eq!(target(now, period, 0, 50, 100).sequence, 50);
        // Missed: return the current one, or the next with NEXTONMISS.
        assert_eq!(target(now, period, 0, 40, 100).sequence, 50);
        assert_eq!(target(now, period, DRM_VBLANK_NEXTONMISS, 40, 100).sequence, 51);
        // Sequence numbers wrap at 32 bits.
        let big = (u32::MAX as u64 + 3) * period + 1; // current wraps to 2
        assert_eq!(target(big, period, 0, 4, 100).sequence as u32, 4);
        assert_eq!(target(big, period, 0, u32::MAX, 100).sequence as u32, 2);
    }
}
