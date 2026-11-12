//! Fix B (piece HZ, prototype, off by default): pace GTK's GL paints from the compositor.
//!
//! With WebKit's GPU renderer, GTK 3 presents each window through EGL. On that path it never
//! asks the compositor for a frame callback, so its frame clock keeps its built-in 16.667 ms
//! interval and paints at most 60 times a second; WebKit's web process cannot outrun that
//! (rebuild/HZ_FABLE_DIAGNOSIS.md, limit B). GTK's own shared-memory path does what this module
//! adds to the GL path:
//!
//! 1. while the toplevel is drawn, ask for a `wl_surface.frame` callback (the request rides on
//!    the commit that `eglSwapBuffers` makes at the end of the same paint);
//! 2. after the paint, freeze the toplevel's frame clock;
//! 3. when the compositor's callback arrives, thaw it. A clock frozen during `after-paint` has
//!    no 16.667 ms wait pending, so a queued redraw paints at once: the compositor's rate.
//!
//! Unmap, unrealize and teardown drop the callback and thaw. A watchdog thaws after 50 ms if a
//! callback never comes (a hidden window, or a paint that did not commit), so the window can
//! never stay frozen. Idle stays idle: the callback is only asked for when something drew, and
//! a thaw with nothing queued paints nothing.
//!
//! On only with `GROVE_FRAME_PACING=compositor`, on Wayland. Anything else, or any symbol that
//! cannot be found, leaves GTK exactly as it is.

use std::ffi::{c_char, c_void, CStr};

/// `compositor` turns this prototype on. Unset, empty, `gtk` or `default` leave GTK alone.
pub const ENV: &str = "GROVE_FRAME_PACING";

/// How long a frozen clock waits for the compositor before painting anyway.
pub const WATCHDOG_MS: u64 = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pacing {
    /// GTK's own clock (today's behaviour).
    Gtk,
    /// Paint when the compositor says the last frame was shown.
    Compositor,
}

/// The pacing asked for, and whether the value was recognised (an unknown one means GTK).
pub fn parse_pacing(value: Option<&str>) -> (Pacing, bool) {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("" | "gtk" | "default" | "off") => (Pacing::Gtk, true),
        Some("compositor") => (Pacing::Compositor, true),
        Some(_) => (Pacing::Gtk, false),
    }
}

/// The per-window bookkeeping, apart from the GTK and Wayland calls it leads to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Pace {
    /// A frame callback is outstanding.
    pending: bool,
    /// The toplevel drew in the current frame-clock cycle.
    painted: bool,
    /// The frame clock is frozen by us.
    frozen: bool,
}

/// What a reset must undo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reset {
    pub drop_callback: bool,
    pub thaw: bool,
}

impl Pace {
    /// The toplevel is being drawn. True: ask for a frame callback now.
    pub fn draw(&mut self) -> bool {
        self.painted = true;
        !std::mem::replace(&mut self.pending, true)
    }

    /// The callback request could not be made; behave as GTK does today for this frame.
    pub fn request_failed(&mut self) {
        self.pending = false;
    }

    /// The frame clock finished a cycle. True: freeze it until the callback.
    pub fn after_paint(&mut self) -> bool {
        let painted = std::mem::take(&mut self.painted);
        if painted && self.pending && !self.frozen {
            self.frozen = true;
            return true;
        }
        false
    }

    /// The callback fired, or the watchdog gave up on it. True: thaw.
    pub fn done(&mut self) -> bool {
        self.pending = false;
        std::mem::take(&mut self.frozen)
    }

    /// Unmap, unrealize or teardown: forget the callback and undo a freeze.
    pub fn reset(&mut self) -> Reset {
        let reset = Reset { drop_callback: self.pending, thaw: self.frozen };
        *self = Pace::default();
        reset
    }

    pub fn frozen(&self) -> bool {
        self.frozen
    }
}

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

/// `wl_surface.frame` is request 3 of `wl_surface` (wayland.xml).
const WL_SURFACE_FRAME: u32 = 3;

type MarshalFlagsFn = unsafe extern "C" fn(*mut c_void, u32, *const c_void, u32, u32, ...) -> *mut c_void;
type AddListenerFn = unsafe extern "C" fn(*mut c_void, *const c_void, *mut c_void) -> i32;
type ProxyFn = unsafe extern "C" fn(*mut c_void);
type GetVersionFn = unsafe extern "C" fn(*mut c_void) -> u32;
type GetSurfaceFn = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
type WindowFn = unsafe extern "C" fn(*mut c_void);

/// libwayland-client and libgdk-3 entry points, found at run time so a GTK or Wayland build
/// without them only turns this prototype off. Both libraries are already loaded by GTK.
struct Api {
    marshal_flags: MarshalFlagsFn,
    add_listener: AddListenerFn,
    destroy: ProxyFn,
    get_version: GetVersionFn,
    callback_interface: *const c_void,
    get_wl_surface: GetSurfaceFn,
    freeze: WindowFn,
    thaw: WindowFn,
}

// SAFETY: function pointers and the address of a static interface description.
unsafe impl Send for Api {}
unsafe impl Sync for Api {}

fn api() -> Result<&'static Api, String> {
    static API: std::sync::OnceLock<Result<Api, String>> = std::sync::OnceLock::new();
    API.get_or_init(|| {
        let find = |name: &CStr| {
            // SAFETY: dlsym on the global scope with a NUL-terminated name.
            let ptr = unsafe { dlsym(std::ptr::null_mut(), name.as_ptr()) };
            if ptr.is_null() { Err(format!("{} not found", name.to_string_lossy())) } else { Ok(ptr) }
        };
        // SAFETY: each symbol is the library's function (or, for the interface, data) with the
        // declared signature.
        unsafe {
            Ok(Api {
                marshal_flags: std::mem::transmute::<*mut c_void, MarshalFlagsFn>(find(c"wl_proxy_marshal_flags")?),
                add_listener: std::mem::transmute::<*mut c_void, AddListenerFn>(find(c"wl_proxy_add_listener")?),
                destroy: std::mem::transmute::<*mut c_void, ProxyFn>(find(c"wl_proxy_destroy")?),
                get_version: std::mem::transmute::<*mut c_void, GetVersionFn>(find(c"wl_proxy_get_version")?),
                callback_interface: find(c"wl_callback_interface")?,
                get_wl_surface: std::mem::transmute::<*mut c_void, GetSurfaceFn>(find(c"gdk_wayland_window_get_wl_surface")?),
                freeze: std::mem::transmute::<*mut c_void, WindowFn>(find(c"gdk_window_freeze_toplevel_updates_libgtk_only")?),
                thaw: std::mem::transmute::<*mut c_void, WindowFn>(find(c"gdk_window_thaw_toplevel_updates_libgtk_only")?),
            })
        }
    })
    .as_ref()
    .map_err(Clone::clone)
}

pub use runtime::install;

mod runtime {
    use super::{api, parse_pacing, Api, Pace, Pacing, ENV, WATCHDOG_MS, WL_SURFACE_FRAME};
    use gtk::gdk;
    use gtk::glib::{self, translate::ToGlibPtr, SignalHandlerId, SourceId};
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::rc::{Rc, Weak};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    fn note_once(flag: &AtomicBool, message: impl FnOnce() -> String) {
        if !flag.swap(true, Ordering::Relaxed) {
            eprintln!("{}", message());
        }
    }

    fn pacing() -> Pacing {
        static PACING: std::sync::OnceLock<Pacing> = std::sync::OnceLock::new();
        *PACING.get_or_init(|| {
            let raw = std::env::var(ENV).ok();
            let (pacing, known) = parse_pacing(raw.as_deref());
            if !known {
                eprintln!("grove: {ENV}={:?} is not `compositor` or `gtk`; GTK keeps its own frame clock", raw.unwrap_or_default());
            }
            pacing
        })
    }

    #[repr(C)]
    struct CallbackListener {
        done: unsafe extern "C" fn(*mut c_void, *mut c_void, u32),
    }

    static LISTENER: CallbackListener = CallbackListener { done: on_done };

    /// One toplevel's state. Owned by the window's signal handlers; the callback and the watchdog
    /// find it through `WINDOWS` by id, so neither keeps it alive.
    struct Paced {
        id: usize,
        pace: Pace,
        /// The outstanding `wl_callback`, owned here until it fires or is dropped.
        callback: *mut c_void,
        /// The GdkWindow whose clock we froze, so the thaw goes to the same one.
        frozen_on: Option<gdk::Window>,
        watchdog: Option<SourceId>,
        clock: Option<(gdk::FrameClock, SignalHandlerId)>,
    }

    type Shared = Rc<RefCell<Paced>>;

    thread_local! {
        static WINDOWS: RefCell<HashMap<usize, Weak<RefCell<Paced>>>> = RefCell::new(HashMap::new());
    }

    fn find(id: usize) -> Option<Shared> {
        WINDOWS.try_with(|w| w.borrow().get(&id).and_then(Weak::upgrade)).ok().flatten()
    }

    fn safe_window(window: &gdk::Window) -> bool {
        !window.is_destroyed() && window.frame_clock().is_some()
    }

    fn raw(window: &gdk::Window) -> *mut c_void {
        let ptr: *mut gdk::ffi::GdkWindow = window.to_glib_none().0;
        ptr.cast()
    }

    /// Ask for a frame callback on the toplevel's surface. False: nothing was asked.
    fn request(api: &Api, paced: &mut Paced, window: &gdk::Window) -> bool {
        // SAFETY: `window` is a live Wayland GdkWindow; the proxy calls follow the inline
        // `wl_surface_frame` and `wl_callback_add_listener` from wayland-client-protocol.h.
        unsafe {
            let surface = (api.get_wl_surface)(raw(window));
            if surface.is_null() {
                return false;
            }
            let version = (api.get_version)(surface);
            let callback = (api.marshal_flags)(surface, WL_SURFACE_FRAME, api.callback_interface, version, 0, std::ptr::null_mut::<c_void>());
            if callback.is_null() {
                return false;
            }
            let listener = (&LISTENER as *const CallbackListener).cast();
            if (api.add_listener)(callback, listener, paced.id as *mut c_void) != 0 {
                (api.destroy)(callback);
                return false;
            }
            paced.callback = callback;
        }
        true
    }

    /// Clear the callback (destroying it unless it already fired) and hand back what to thaw.
    fn finish(api: &Api, paced: &mut Paced, fired: bool) -> (Option<gdk::Window>, Option<SourceId>) {
        if !paced.callback.is_null() {
            // SAFETY: we own this proxy; destroying it inside its own `done` is the usual pattern.
            unsafe { (api.destroy)(paced.callback) };
            paced.callback = std::ptr::null_mut();
        }
        let thaw = if fired { paced.pace.done() } else { paced.pace.reset().thaw };
        (if thaw { paced.frozen_on.take() } else { None }, paced.watchdog.take())
    }

    /// Run outside any borrow: thawing can schedule GTK work.
    fn thaw(api: &Api, after: (Option<gdk::Window>, Option<SourceId>)) {
        if let Some(source) = after.1 {
            source.remove();
        }
        if let Some(window) = after.0 {
            if safe_window(&window) {
                // SAFETY: balanced with the freeze in `after_paint`, on the same live toplevel.
                unsafe { (api.thaw)(raw(&window)) };
            }
        }
    }

    unsafe extern "C" fn on_done(data: *mut c_void, callback: *mut c_void, _time: u32) {
        let _ = std::panic::catch_unwind(|| {
            let (Ok(api), Some(shared)) = (api(), find(data as usize)) else { return };
            let after = {
                let mut paced = shared.borrow_mut();
                if paced.callback != callback {
                    return;
                }
                finish(api, &mut paced, true)
            };
            thaw(api, after);
        });
    }

    fn after_paint(api: &'static Api, weak: &Weak<RefCell<Paced>>, window: &glib::WeakRef<gtk::ApplicationWindow>) {
        let (Some(shared), Some(toplevel)) = (weak.upgrade(), window.upgrade()) else { return };
        let Some(gdk_window) = toplevel.window() else { return };
        if !shared.borrow_mut().pace.after_paint() {
            return;
        }
        if !safe_window(&gdk_window) {
            reset(api, &shared);
            return;
        }
        // SAFETY: a live toplevel GdkWindow; thawed by `on_done`, the watchdog or a reset.
        unsafe { (api.freeze)(raw(&gdk_window)) };
        let id = shared.borrow().id;
        let source = glib::timeout_add_local_once(Duration::from_millis(WATCHDOG_MS), move || {
            static LATE: AtomicBool = AtomicBool::new(false);
            let Some(shared) = find(id) else { return };
            let after = {
                let mut paced = shared.borrow_mut();
                paced.watchdog = None; // this source is finishing on its own
                if !paced.pace.frozen() {
                    return;
                }
                finish(api, &mut paced, true)
            };
            note_once(&LATE, || {
                format!("grove: no compositor frame callback within {WATCHDOG_MS} ms (normal while a window is hidden); painting anyway")
            });
            thaw(api, after);
        });
        let mut paced = shared.borrow_mut();
        paced.frozen_on = Some(gdk_window);
        paced.watchdog = Some(source);
    }

    fn attach_clock(api: &'static Api, shared: &Shared, window: &gtk::ApplicationWindow) {
        detach_clock(api, shared);
        let Some(clock) = window.frame_clock() else { return };
        let weak = Rc::downgrade(shared);
        let toplevel = window.downgrade();
        let handler = clock.connect_after_paint(move |_| after_paint(api, &weak, &toplevel));
        shared.borrow_mut().clock = Some((clock, handler));
    }

    fn reset(api: &Api, shared: &Shared) {
        let after = finish(api, &mut shared.borrow_mut(), false);
        thaw(api, after);
    }

    fn detach_clock(api: &Api, shared: &Shared) {
        reset(api, shared);
        if let Some((clock, handler)) = shared.borrow_mut().clock.take() {
            clock.disconnect(handler);
        }
    }

    impl Drop for Paced {
        fn drop(&mut self) {
            let _ = WINDOWS.try_with(|w| w.borrow_mut().remove(&self.id));
            if let Ok(api) = api() {
                let after = finish(api, self, false);
                thaw(api, after);
            }
            if let Some((clock, handler)) = self.clock.take() {
                clock.disconnect(handler);
            }
        }
    }

    /// Pace `window` from the compositor when `GROVE_FRAME_PACING=compositor`. Otherwise, and
    /// whenever something it needs is missing, it does nothing.
    pub fn install(window: &tauri::WebviewWindow) {
        static ON: AtomicBool = AtomicBool::new(false);
        static UNAVAILABLE: AtomicBool = AtomicBool::new(false);
        if pacing() != Pacing::Compositor {
            return;
        }
        let Ok(toplevel) = window.gtk_window() else {
            note_once(&UNAVAILABLE, || format!("grove: {ENV}=compositor: no GTK window; GTK keeps its own frame clock"));
            return;
        };
        let wayland = glib::Type::from_name("GdkWaylandDisplay")
            .is_some_and(|wayland| WidgetExt::display(&toplevel).type_().is_a(wayland));
        if !wayland {
            note_once(&UNAVAILABLE, || format!("grove: {ENV}=compositor needs Wayland; GTK keeps its own frame clock"));
            return;
        }
        let api = match api() {
            Ok(api) => api,
            Err(why) => {
                note_once(&UNAVAILABLE, || format!("grove: {ENV}=compositor unavailable ({why}); GTK keeps its own frame clock"));
                return;
            }
        };
        note_once(&ON, || format!("grove: {ENV}=compositor: painting on the compositor's frame callbacks (prototype)"));
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let shared: Shared = Rc::new(RefCell::new(Paced {
            id,
            pace: Pace::default(),
            callback: std::ptr::null_mut(),
            frozen_on: None,
            watchdog: None,
            clock: None,
        }));
        WINDOWS.with(|w| w.borrow_mut().insert(id, Rc::downgrade(&shared)));

        let on_draw = shared.clone();
        toplevel.connect_draw(move |toplevel, _| {
            let Some(gdk_window) = toplevel.window() else { return glib::Propagation::Proceed };
            let mut paced = on_draw.borrow_mut();
            if paced.pace.draw() && !request(api, &mut paced, &gdk_window) {
                paced.pace.request_failed();
            }
            glib::Propagation::Proceed
        });
        let on_realize = shared.clone();
        toplevel.connect_realize(move |toplevel| attach_clock(api, &on_realize, toplevel));
        let on_unrealize = shared.clone();
        toplevel.connect_unrealize(move |_| detach_clock(api, &on_unrealize));
        let on_unmap = shared.clone();
        toplevel.connect_unmap(move |_| reset(api, &on_unmap));
        if toplevel.is_realized() {
            attach_clock(api, &shared, &toplevel);
        }
        // The handlers above hold `shared` for the window's lifetime; it is dropped with them.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pacing_values() {
        for gtk in [None, Some(""), Some("gtk"), Some("GTK"), Some("default"), Some("off")] {
            assert_eq!(parse_pacing(gtk), (Pacing::Gtk, true), "{gtk:?}");
        }
        assert_eq!(parse_pacing(Some("compositor")), (Pacing::Compositor, true));
        assert_eq!(parse_pacing(Some(" Compositor\n")), (Pacing::Compositor, true));
        assert_eq!(parse_pacing(Some("240")), (Pacing::Gtk, false));
        assert_eq!(parse_pacing(Some("on")), (Pacing::Gtk, false));
    }

    #[test]
    fn a_drawn_frame_waits_for_its_callback() {
        let mut pace = Pace::default();
        assert!(pace.draw(), "first draw asks for a callback");
        assert!(!pace.draw(), "a second draw in the same cycle does not ask again");
        assert!(pace.after_paint(), "freeze after the paint");
        assert!(pace.frozen());
        assert!(!pace.after_paint(), "never freeze twice");
        assert!(pace.done(), "the callback thaws");
        assert!(!pace.frozen());
        assert!(!pace.done(), "a second done does nothing");
    }

    #[test]
    fn idle_cycles_never_freeze_or_ask() {
        let mut pace = Pace::default();
        // A frame-clock cycle that drew nothing (layout only, or nothing queued).
        for _ in 0..10 {
            assert!(!pace.after_paint());
        }
        assert_eq!(pace, Pace::default());
    }

    #[test]
    fn a_failed_request_behaves_like_gtk() {
        let mut pace = Pace::default();
        assert!(pace.draw());
        pace.request_failed();
        assert!(!pace.after_paint(), "no callback, so no freeze");
        assert!(pace.draw(), "the next frame tries again");
    }

    #[test]
    fn callback_before_after_paint_does_not_strand_a_freeze() {
        let mut pace = Pace::default();
        assert!(pace.draw());
        assert!(!pace.done(), "fired early: nothing frozen yet");
        assert!(!pace.after_paint(), "and nothing pending, so no freeze to wait on");
    }

    #[test]
    fn reset_undoes_everything() {
        let mut pace = Pace::default();
        assert!(pace.draw());
        assert!(pace.after_paint());
        assert_eq!(pace.reset(), Reset { drop_callback: true, thaw: true });
        assert_eq!(pace, Pace::default());
        assert_eq!(pace.reset(), Reset { drop_callback: false, thaw: false });
        // Drawn but unmapped before after-paint: drop the request, nothing to thaw.
        assert!(pace.draw());
        assert_eq!(pace.reset(), Reset { drop_callback: true, thaw: false });
        assert!(!pace.after_paint());
    }

    #[test]
    fn steady_motion_alternates_paint_and_wait() {
        let mut pace = Pace::default();
        for _ in 0..240 {
            assert!(pace.draw());
            assert!(pace.after_paint());
            assert!(pace.done());
        }
        assert_eq!(pace, Pace::default());
    }
}
