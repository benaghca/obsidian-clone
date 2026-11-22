//! Keeps the webview on Grove's own pages, except embedded frames.
//!
//! Windows are built here rather than from `tauri.conf.json` so they can carry two guards the
//! config cannot express:
//!
//! - every navigation (a link, a dropped URL, script setting `location`, a frame load) is checked.
//!   The app's own origin is always allowed: `tauri://localhost`, or `http(s)://tauri.localhost` on
//!   Windows and Android, in release builds, plus the dev server origin in dev builds. A *child* frame may also
//!   load an `http(s)` origin the page registered with `allow_frame_origin`. It may also load a
//!   `blob:` URL the page registered with `allow_pdf_blob` (a sniffed PDF), or WebKit's built-in
//!   PDF viewer (`webkit-pdfjs-viewer://pdfjs/web/viewer.html`) when every `file` parameter is one
//!   of those blobs. That PDF exception stays off until this window's Linux response-policy hook
//!   is connected; that hook ignores those URLs as a main-frame document. The main frame may not
//!   load them. Vault bytes are not page script.
//! - every new-window request (`window.open`, `target=_blank`) is denied, registered origin or not.
//!
//! External links never load inside the app: the front end hands them to the system opener
//! (`tauri-plugin-opener`, scoped to http, https and mailto in `capabilities/default.json`).
//!
//! wry 0.57's `on_navigation` is `Fn(&Url) -> bool`. On WebKitGTK it is wired to `decide-policy`
//! for `WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION`, which the headers describe as a navigation
//! "in either the main frame or a subframe", so a frame load is visible. The callback is not told
//! which frame it is. `webkit_navigation_action_get_frame_name` is the link's `target` attribute
//! (`_blank`), and is NULL otherwise. `webkit_response_policy_decision_is_main_frame_main_resource`
//! (WebKit 2.40) can tell, and wry does not pass response decisions to `on_navigation`. On Linux
//! the window therefore also handles response policy, and ignores a main-frame document that is
//! not the app. That is what refuses a main-frame navigation to a registered origin.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub const MAIN_WINDOW: &str = "main";
/// A note's own window ("Open in new window") is `note-<n>`; the capability names them by it.
const NOTE_WINDOW: &str = "note-";

/// wry's navigation callback receives a URL and nothing else, on every platform.
/// The runtime always passes `NavFrame::Unknown`; tests read this.
#[allow(dead_code)]
pub const WRY_ON_NAVIGATION_TELLS_FRAME: bool = false;

/// True where the webview can tell a main-frame document from a subframe load.
/// Linux uses WebKit's response policy (`is_main_frame_main_resource`).
#[allow(dead_code)]
pub const fn main_frame_document_is_distinguishable() -> bool {
    cfg!(target_os = "linux")
}

/// Which frame a navigation is for. `Unknown` is all wry's `on_navigation` can report.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NavFrame {
    /// Top-level document. Refused unless it is the app. Constructed by the guard table.
    #[allow(dead_code)]
    Main,
    /// Embedded frame. Allowed when the origin was registered. Constructed by the guard table.
    #[allow(dead_code)]
    Child,
    Unknown,
}

/// Origins an embedded frame may navigate to. Shared by every window. Not an IPC allowlist.
#[derive(Clone, Default)]
pub struct FrameOrigins(Arc<Mutex<HashSet<String>>>);

impl FrameOrigins {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record `raw` if it is an http(s) origin. The stored form is the URL origin
    /// serialization: lowercase host, default port omitted.
    pub fn allow(&self, raw: &str) -> Result<(), String> {
        let origin = parse_frame_origin(raw)?;
        let mut set = self.0.lock().unwrap_or_else(|err| err.into_inner());
        set.insert(origin);
        Ok(())
    }

    fn contains(&self, origin: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .contains(origin)
    }
}

/// Blob URLs the page minted for a sniffed PDF. Each registration belongs to the
/// window that created it. Closing that window drops its registrations, including
/// one whose `allow` races the close. Another window's registrations stay.
#[derive(Clone, Default)]
pub struct PdfBlobs {
    state: Arc<Mutex<PdfBlobState>>,
}

#[derive(Default)]
struct PdfBlobState {
    /// Windows that may still hold registrations. `close_window` removes the label.
    live: HashSet<String>,
    /// Parsed blob URL, then owning window, then how many holders that window has.
    urls: HashMap<String, HashMap<String, usize>>,
}

impl PdfBlobs {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, PdfBlobState> {
        self.state.lock().unwrap_or_else(|err| err.into_inner())
    }

    /// This window may register blobs until [`Self::close_window`].
    pub fn open_window(&self, window: &str) {
        self.lock().live.insert(window.to_string());
    }

    /// Drop every registration `window` holds. A later `allow` for it does not stick.
    pub fn close_window(&self, window: &str) {
        let mut state = self.lock();
        state.live.remove(window);
        state.urls.retain(|_, holders| {
            holders.remove(window);
            !holders.is_empty()
        });
    }

    /// Hold one reference for `window` when `raw` is a `blob:` URL and that window
    /// is still open. The check and the insert share one lock with [`Self::close_window`].
    pub fn allow(&self, window: &str, raw: &str) -> Result<(), String> {
        let key = blob_key(raw)?;
        let mut state = self.lock();
        if !state.live.contains(window) {
            return Err(PDF_VIEWER_UNAVAILABLE.into());
        }
        *state
            .urls
            .entry(key)
            .or_default()
            .entry(window.to_string())
            .or_insert(0) += 1;
        Ok(())
    }

    /// Drop one of `window`'s references. An unknown URL or window is ignored.
    pub fn release(&self, window: &str, raw: &str) {
        let Ok(key) = blob_key(raw) else {
            return;
        };
        let mut state = self.lock();
        let Some(holders) = state.urls.get_mut(&key) else {
            return;
        };
        let Some(count) = holders.get_mut(window) else {
            return;
        };
        if *count <= 1 {
            holders.remove(window);
            if holders.is_empty() {
                state.urls.remove(&key);
            }
        } else {
            *count -= 1;
        }
    }

    /// Whether `window` still holds `url`.
    pub fn holds(&self, window: &str, url: &Url) -> bool {
        if url.scheme() != "blob" {
            return false;
        }
        self.lock()
            .urls
            .get(url.as_str())
            .and_then(|holders| holders.get(window))
            .is_some_and(|count| *count > 0)
    }
}

fn blob_key(raw: &str) -> Result<String, String> {
    const ERR: &str = "pdf resource must be a blob: URL";
    if raw.is_empty() || raw.chars().any(char::is_whitespace) {
        return Err(ERR.into());
    }
    let url = Url::parse(raw).map_err(|_| ERR.to_string())?;
    if url.scheme() != "blob" {
        return Err(ERR.into());
    }
    Ok(url.as_str().to_string())
}

/// Shown when this window cannot navigate a PDF frame. The page uses it instead of a blank iframe.
pub const PDF_VIEWER_UNAVAILABLE: &str = "PDF viewer is not available in this window";

/// One flag per window. It starts false and becomes true only after that window's Linux
/// response-policy hook is connected. A missing window is not ready.
#[derive(Clone, Default)]
pub struct PdfFrameFlags {
    flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl PdfFrameFlags {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, label: &str, flag: Arc<AtomicBool>) {
        self.flags
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .insert(label.to_string(), flag);
    }

    pub fn remove(&self, label: &str) {
        self.flags
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .remove(label);
    }

    pub fn enabled(&self, label: &str) -> bool {
        self.flags
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .get(label)
            .is_some_and(|flag| flag.load(Ordering::Acquire))
    }

    /// Register `url` only when this window's viewer hook is connected. Otherwise the blob
    /// is not recorded, and the caller shows a fallback instead of navigating.
    pub fn allow_blob(&self, label: &str, pdf: &PdfBlobs, url: &str) -> Result<(), String> {
        if !self.enabled(label) {
            return Err(PDF_VIEWER_UNAVAILABLE.into());
        }
        pdf.allow(label, url)
    }
}

/// `http://host[:port]` or `https://host[:port]`. No user, path, query, or fragment.
pub fn parse_frame_origin(raw: &str) -> Result<String, String> {
    const ERR: &str = "origin must be http://host[:port] or https://host[:port]";
    if raw.is_empty() || raw.chars().any(char::is_whitespace) {
        return Err(ERR.into());
    }
    let Some((scheme, rest)) = raw.split_once("://") else {
        return Err(ERR.into());
    };
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return Err(ERR.into());
    }
    if rest.is_empty() || rest.contains(['/', '?', '#', '@', '\\']) {
        return Err(ERR.into());
    }
    let url = Url::parse(raw).map_err(|_| ERR.to_string())?;
    if (url.scheme() != "http" && url.scheme() != "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ERR.into());
    }
    let origin = url.origin().ascii_serialization();
    if origin == "null" || !(origin.starts_with("http://") || origin.starts_with("https://")) {
        return Err(ERR.into());
    }
    Ok(origin)
}

/// The http(s) origin of `url`, in the same form `parse_frame_origin` stores.
fn http_origin(url: &Url) -> Option<String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let origin = url.origin().ascii_serialization();
    if origin == "null" || !(origin.starts_with("http://") || origin.starts_with("https://")) {
        None
    } else {
        Some(origin)
    }
}

/// Build the main window from its config entry (marked `"create": false`) with the guards.
pub fn create_main_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    build_window(app, MAIN_WINDOW, None)
}

/// A note's own window: the main window's settings and guards, on the app's own page with the
/// note in its query. `note` must already be percent-encoded, so it can't add to the URL.
pub fn create_note_window(app: &AppHandle, note: &str) -> Result<(), String> {
    if !is_encoded(note) {
        return Err("expected a percent-encoded note path".into());
    }
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = format!("{NOTE_WINDOW}{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let url = WebviewUrl::App(format!("index.html?note={note}").into());
    build_window(app, &label, Some(url)).map_err(|e| e.to_string())
}

/// Only what a fully percent-encoded string can hold: nothing that could add to a URL.
fn is_encoded(note: &str) -> bool {
    !note.is_empty()
        && note
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"%-._~".contains(&b))
}

fn build_window(
    app: &AppHandle,
    label: &str,
    url: Option<WebviewUrl>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW)
        .ok_or("tauri.conf.json has no main window")?
        .clone();
    config.label = label.into();
    if let Some(url) = url {
        config.url = url;
    }
    let dev_url = if tauri::is_dev() {
        app.config().build.dev_url.clone()
    } else {
        None
    };
    let frames = app.state::<FrameOrigins>().inner().clone();
    let pdf = app.state::<PdfBlobs>().inner().clone();
    let pdf_nav = pdf.clone();
    let nav_label = label.to_string();
    let guard_dev = dev_url.clone();
    // This window may allow a PDF frame only after its own main-frame hook is connected.
    let pdf_frames = Arc::new(AtomicBool::new(false));
    let pdf_frames_nav = Arc::clone(&pdf_frames);
    let frame_flags = app.state::<PdfFrameFlags>().inner().clone();
    frame_flags.insert(label, Arc::clone(&pdf_frames));
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| {
            // Unknown: this callback cannot tell the main frame from a subframe. The response
            // policy hook below refuses a main-frame document that is not the app. The PDF
            // exception stays off until that hook is connected on this window.
            let allowed = navigation_allowed(
                url,
                dev_url.as_ref(),
                &frames,
                &pdf_nav,
                pdf_frames_nav.load(Ordering::Acquire),
                NavFrame::Unknown,
                &nav_label,
            );
            if !allowed {
                eprintln!("grove: blocked navigation to {url}");
            }
            allowed
        })
        .on_new_window(|url, _features| {
            eprintln!("grove: blocked new window for {url}");
            NewWindowResponse::Deny
        })
        .build()?;
    pdf.open_window(label);
    let closed = frame_flags.clone();
    let closed_pdf = pdf.clone();
    let closed_label = label.to_string();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            closed.remove(&closed_label);
            closed_pdf.close_window(&closed_label);
        }
    });
    install_main_frame_guard(&window, guard_dev, pdf_frames);
    enable_spellchecker(&window);
    // Off unless GROVE_FRAME_PACING=compositor (piece HZ, fix B).
    #[cfg(target_os = "linux")]
    crate::frame_pacing::install(&window);
    Ok(())
}

/// Ignore a main-frame document that is not Grove. Subframe documents and subresources are left
/// to the navigation callback, which allows only registered http(s) origins.
#[cfg(target_os = "linux")]
fn install_main_frame_guard(
    window: &tauri::WebviewWindow,
    dev_url: Option<Url>,
    pdf_frames: Arc<AtomicBool>,
) {
    let _ = window.with_webview(move |webview| {
        use webkit2gtk::glib::prelude::Cast;
        use webkit2gtk::{
            PolicyDecisionExt, PolicyDecisionType, ResponsePolicyDecision,
            ResponsePolicyDecisionExt, URIRequestExt, WebViewExt,
        };
        webview
            .inner()
            .connect_decide_policy(move |_view, decision, policy_type| {
                if policy_type != PolicyDecisionType::Response {
                    return false;
                }
                let Some(response) = decision.dynamic_cast_ref::<ResponsePolicyDecision>() else {
                    return false;
                };
                if !response.is_main_frame_main_resource() {
                    return false;
                }
                let Some(uri) = response.request().and_then(|request| request.uri()) else {
                    return false;
                };
                let Ok(url) = Url::parse(uri.as_str()) else {
                    return false;
                };
                if main_frame_document_allowed(&url, dev_url.as_ref()) {
                    return false;
                }
                eprintln!("grove: blocked main-frame navigation to {url}");
                decision.ignore();
                true
            });
        // The handler is connected. Until this runs, blob and viewer navigations stay refused.
        pdf_frames.store(true, Ordering::Release);
    });
}

#[cfg(not(target_os = "linux"))]
fn install_main_frame_guard(
    _window: &tauri::WebviewWindow,
    _dev_url: Option<Url>,
    _pdf_frames: Arc<AtomicBool>,
) {
}

/// WebKitGTK checks spelling with Enchant and the dictionaries installed on the machine; it never
/// sends text anywhere. wry leaves it off, so `spellcheck="true"` (Settings → Editor → Spellcheck)
/// would do nothing; this turns it on for the language of the user's locale.
#[cfg(target_os = "linux")]
fn enable_spellchecker(window: &tauri::WebviewWindow) {
    let language = std::env::var("LC_ALL")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var("LANG").ok())
        .and_then(|v| v.split('.').next().map(str::to_owned))
        .filter(|v| !v.is_empty() && v != "C" && v != "POSIX")
        .unwrap_or_else(|| "en_US".into());
    let _ = window.with_webview(move |webview| {
        use webkit2gtk::{WebContextExt, WebViewExt};
        if let Some(context) = webview.inner().context() {
            context.set_spell_checking_enabled(true);
            context.set_spell_checking_languages(&[language.as_str()]);
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn enable_spellchecker(_window: &tauri::WebviewWindow) {}

/// True for URLs that belong to the app itself.
///
/// Tauri 2.12.4 (`protocol::origin`) serves the custom protocol as
/// `tauri://localhost` except on Windows and Android, where wry 0.57's
/// workaround serves it as `http://tauri.localhost`, or `https://tauri.localhost`
/// when the webview sets `use_https_scheme`. Grove does not set that flag. On
/// every other target an `http(s)` host of that name is a real local server
/// (port 80 or 443) and must not pass either navigation guard.
pub fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            ((cfg!(windows) || cfg!(target_os = "android"))
                && url.host_str() == Some("tauri.localhost"))
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        // The blank page a webview starts on before it loads the app.
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// A main-frame document. Only the app origin. Registered frame origins are refused.
pub fn main_frame_document_allowed(url: &Url, dev_url: Option<&Url>) -> bool {
    is_app_url(url, dev_url)
}

/// WebKit's built-in PDF viewer, and only when every `file` is a blob the page registered.
fn is_pdf_viewer_url(url: &Url, pdf: &PdfBlobs, holder: &str) -> bool {
    if url.scheme() != "webkit-pdfjs-viewer"
        || url.host_str() != Some("pdfjs")
        || url.path() != "/web/viewer.html"
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    let mut saw_file = false;
    for (key, value) in url.query_pairs() {
        if key != "file" {
            continue;
        }
        saw_file = true;
        let Ok(file) = Url::parse(&value) else {
            return false;
        };
        if !pdf.holds(holder, &file) {
            return false;
        }
    }
    saw_file
}

/// A registered PDF blob, or the viewer opened on one. `pdf_frames_enabled` is this window's
/// main-frame hook, not a guess from the target OS.
fn pdf_frame_url(url: &Url, pdf: &PdfBlobs, pdf_frames_enabled: bool, holder: &str) -> bool {
    if !pdf_frames_enabled {
        return false;
    }
    if url.scheme() == "blob" {
        return pdf.holds(holder, url);
    }
    is_pdf_viewer_url(url, pdf, holder)
}

/// Whether a navigation may proceed.
///
/// The main frame stays on the app. A child frame, and a navigation whose frame wry cannot name,
/// may also go to a registered http(s) origin. A PDF blob the page registered, and WebKit's PDF
/// viewer opened on that blob, are allowed only when `pdf_frames_enabled` is set, which is after
/// this window's Linux response-policy hook is connected. `file:`, `javascript:`, `data:`, and
/// anything unregistered are refused in every frame. New windows are not decided here; the
/// builder denies all of them.
pub fn navigation_allowed(
    url: &Url,
    dev_url: Option<&Url>,
    frames: &FrameOrigins,
    pdf: &PdfBlobs,
    pdf_frames_enabled: bool,
    place: NavFrame,
    holder: &str,
) -> bool {
    if is_app_url(url, dev_url) {
        return true;
    }
    match place {
        NavFrame::Main => false,
        NavFrame::Child | NavFrame::Unknown => {
            pdf_frame_url(url, pdf, pdf_frames_enabled, holder)
                || http_origin(url).is_some_and(|origin| frames.contains(&origin))
        }
    }
}

/// Whether Tauri will run an IPC command from `url`.
///
/// Tauri's `is_local_url` is the app scheme (`tauri://localhost`, `http(s)://tauri.localhost`) or
/// the dev server origin. Anything else is a remote origin. A remote origin resolves an ACL entry
/// only when a capability lists it under `remote`. Grove's capabilities do not, so the invoke is
/// rejected (tauri 2.12.4, `webview/mod.rs`, the `!is_local` branch). `about:blank` is not an IPC
/// origin. Registering a frame origin does not change this.
#[allow(dead_code)]
pub fn ipc_origin_allowed(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => false,
    }
}

/// No capability grants a remote context, and no window label is a URL.
#[allow(dead_code)]
pub fn capabilities_grant_local_ipc_only() -> bool {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut saw = false;
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries {
        let Ok(entry) = entry else {
            return false;
        };
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            return false;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            return false;
        };
        saw = true;
        if value.get("remote").is_some() {
            return false;
        }
        if let Some(windows) = value.get("windows").and_then(|windows| windows.as_array()) {
            for window in windows {
                if window.as_str().is_none_or(|label| label.contains("://")) {
                    return false;
                }
            }
        }
    }
    saw
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// The calls below pass no PDF blobs and leave the main-frame hook off.
    fn nav(url: &Url, dev: Option<&Url>, frames: &FrameOrigins, place: NavFrame) -> bool {
        super::navigation_allowed(url, dev, frames, &PdfBlobs::new(), false, place, "")
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn registered(origin: &str) -> FrameOrigins {
        let frames = FrameOrigins::new();
        frames.allow(origin).unwrap();
        frames
    }

    #[test]
    fn release_builds_allow_only_the_app_origin() {
        assert!(is_app_url(&url("tauri://localhost/"), None));
        assert!(is_app_url(&url("tauri://localhost/index.html#x"), None));
        // `http(s)://tauri.localhost` is the app only on the targets where Tauri
        // serves the custom protocol that way. See `http_tauri_localhost_is_app_only_on_the_workaround_targets`.
        let workaround = cfg!(windows) || cfg!(target_os = "android");
        assert_eq!(
            is_app_url(&url("http://tauri.localhost/"), None),
            workaround
        );
        assert_eq!(
            is_app_url(&url("https://tauri.localhost/assets/a.js"), None),
            workaround
        );
        assert!(is_app_url(&url("about:blank"), None));

        assert!(!is_app_url(&url("http://localhost:1420/"), None));
        assert!(!is_app_url(&url("https://example.com/"), None));
        assert!(!is_app_url(
            &url("http://tauri.localhost.example.com/"),
            None
        ));
        assert!(!is_app_url(&url("tauri://evil/"), None));
        assert!(!is_app_url(&url("file:///etc/passwd"), None));
        assert!(!is_app_url(&url("mailto:a@b.c"), None));
        assert!(!is_app_url(&url("about:srcdoc"), None));
    }

    #[test]
    fn note_windows_take_only_percent_encoded_paths() {
        assert!(is_encoded("Projects%2FProject%20roadmap.md"));
        assert!(!is_encoded(""));
        assert!(!is_encoded("a.md?x=1"));
        assert!(!is_encoded("a.md#top"));
        assert!(!is_encoded("../a.md/"));
        assert!(!is_encoded("https://example.com"));
    }

    /// Tauri 2.12.4 `protocol::origin`: Windows and Android serve the app as
    /// `http(s)://tauri.localhost`. Everywhere else it is `tauri://localhost`, and
    /// that http(s) name is a local server (port 80 or 443). Both navigation
    /// guards must refuse it there, including when a dev server is configured.
    #[test]
    fn http_tauri_localhost_is_app_only_on_the_workaround_targets() {
        let local = url("http://tauri.localhost/");
        let secure = url("https://tauri.localhost/index.html");
        let dev = url("http://localhost:1420");
        let app_here = cfg!(windows) || cfg!(target_os = "android");
        assert_eq!(is_app_url(&local, None), app_here);
        assert_eq!(is_app_url(&secure, None), app_here);
        assert_eq!(is_app_url(&local, Some(&dev)), app_here);
        assert_eq!(main_frame_document_allowed(&local, None), app_here);
        assert_eq!(main_frame_document_allowed(&secure, Some(&dev)), app_here);
        let frames = FrameOrigins::new();
        for place in [NavFrame::Main, NavFrame::Child, NavFrame::Unknown] {
            assert_eq!(nav(&local, None, &frames, place), app_here, "{place:?}");
            assert_eq!(
                nav(&secure, Some(&dev), &frames, place),
                app_here,
                "{place:?}"
            );
        }
        // Port 80 under any other name, and a look-alike host, stay refused.
        assert!(!is_app_url(&url("http://127.0.0.1/"), None));
        assert!(!is_app_url(&url("http://localhost/"), None));
        assert!(!is_app_url(
            &url("https://tauri.localhost.example.com/"),
            None
        ));
    }

    /// The asset protocol is off (Grove does not enable tauri's `protocol-asset`
    /// feature), and nothing in the app loads `asset:` or `http://asset.localhost`.
    /// Images, drawings and attachments use `blob:` and `data:`.
    #[test]
    fn csp_does_not_allow_the_unused_asset_protocol() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let text = std::fs::read_to_string(&path).expect("read tauri.conf.json");
        let value: serde_json::Value = serde_json::from_str(&text).expect("parse tauri.conf.json");
        let security = &value["app"]["security"];
        for name in ["csp", "devCsp"] {
            let policy = &security[name];
            assert_eq!(
                policy["img-src"].as_str(),
                Some("'self' data: blob:"),
                "{name} img-src"
            );
            assert_eq!(
                policy["media-src"].as_str(),
                Some("'self' blob:"),
                "{name} media-src"
            );
            assert_eq!(
                policy["frame-src"].as_str(),
                Some("https: http: blob: webkit-pdfjs-viewer:"),
                "{name} frame-src"
            );
            assert_eq!(
                policy["object-src"].as_str(),
                Some("'none'"),
                "{name} object-src"
            );
            assert_eq!(
                policy["child-src"].as_str(),
                Some("'none'"),
                "{name} child-src"
            );
            assert_eq!(
                policy["script-src"].as_str(),
                Some("'self'"),
                "{name} script-src"
            );
            let flat = policy.to_string();
            assert!(
                !flat.contains("asset:") && !flat.contains("asset.localhost"),
                "{name} still names the asset protocol"
            );
        }
    }

    #[test]
    fn dev_builds_also_allow_the_dev_server_origin_only() {
        let dev = url("http://localhost:1420");
        assert!(is_app_url(&url("http://localhost:1420/"), Some(&dev)));
        assert!(is_app_url(
            &url("http://localhost:1420/src/main.ts"),
            Some(&dev)
        ));
        assert!(!is_app_url(&url("http://localhost:1421/"), Some(&dev)));
        assert!(!is_app_url(&url("http://127.0.0.1:1420/"), Some(&dev)));
        assert!(!is_app_url(&url("https://localhost:1420/"), Some(&dev)));
        assert!(!is_app_url(&url("https://example.com/"), Some(&dev)));
    }

    #[test]
    fn frame_origin_form_is_checked() {
        assert_eq!(
            parse_frame_origin("https://Example.COM:443").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            parse_frame_origin("http://example.com:80").unwrap(),
            "http://example.com"
        );
        assert_eq!(
            parse_frame_origin("https://example.com:444").unwrap(),
            "https://example.com:444"
        );
        assert_eq!(
            parse_frame_origin("http://[::1]:8080").unwrap(),
            "http://[::1]:8080"
        );
        for bad in [
            "",
            "https://example.com/watch",
            "https://example.com/",
            "https://example.com?q=1",
            "https://example.com#top",
            "https://user@example.com",
            "https://user:pw@example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "tauri://localhost",
            "about:blank",
            "https://",
            "//example.com",
            "https://example.com ",
            "http://example.com/../secret",
        ] {
            assert!(parse_frame_origin(bad).is_err(), "{bad} was accepted");
        }
    }

    #[test]
    fn guard_table() {
        let frames = registered("https://example.com");
        let dev = url("http://localhost:1420");
        let app = url("tauri://localhost/index.html");
        let registered_page = url("https://example.com/watch?v=1#t");
        let other = url("https://evil.test/a");
        let file = url("file:///etc/passwd");
        let script = url("javascript:alert(1)");

        for place in [NavFrame::Main, NavFrame::Child, NavFrame::Unknown] {
            assert!(nav(&app, None, &frames, place), "{place:?}");
            assert!(nav(&url("about:blank"), None, &frames, place), "{place:?}");
            assert!(
                nav(
                    &url("http://localhost:1420/src/main.ts"),
                    Some(&dev),
                    &frames,
                    place
                ),
                "{place:?}"
            );
        }

        assert!(nav(&registered_page, None, &frames, NavFrame::Child));
        assert!(!nav(&other, None, &frames, NavFrame::Child));
        assert!(!nav(&file, None, &frames, NavFrame::Child));
        assert!(!nav(&script, None, &frames, NavFrame::Child));
        assert!(!nav(
            &url("https://www.example.com/"),
            None,
            &frames,
            NavFrame::Child
        ));
        assert!(!nav(
            &url("http://example.com/"),
            None,
            &frames,
            NavFrame::Child
        ));
        assert!(!nav(
            &url("https://example.com:8443/"),
            None,
            &frames,
            NavFrame::Child
        ));

        // The caller knows this is the main frame, so a registered origin is refused.
        assert!(!nav(&registered_page, None, &frames, NavFrame::Main));
        assert!(!main_frame_document_allowed(&registered_page, None));
        assert!(main_frame_document_allowed(&app, None));

        // wry cannot tell. Unknown is what on_navigation passes, so the frame load is allowed
        // and the Linux response-policy hook is what refuses the main-frame document.
        assert!(!WRY_ON_NAVIGATION_TELLS_FRAME);
        assert!(nav(&registered_page, None, &frames, NavFrame::Unknown));
        if main_frame_document_is_distinguishable() {
            assert!(!main_frame_document_allowed(&registered_page, None));
            assert!(!main_frame_document_allowed(&file, None));
            assert!(!main_frame_document_allowed(&script, None));
        }

        let bare = FrameOrigins::new();
        assert!(!nav(&registered_page, None, &bare, NavFrame::Child));

        // An unregistered blob is not a PDF frame, and the hook is off in `nav`.
        // on_navigation passes Unknown, so that classification has to refuse it too.
        let blob = url("blob:https://example.com/550e8400-e29b-41d4-a716-446655440000");
        let viewer = url(
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=blob%3Ahttps%3A%2F%2Fexample.com%2F550e8400-e29b-41d4-a716-446655440000",
        );
        for place in [NavFrame::Child, NavFrame::Unknown, NavFrame::Main] {
            assert!(!nav(&blob, None, &bare, place), "{place:?}");
            assert!(!nav(&viewer, None, &bare, place), "{place:?}");
        }
        assert!(!main_frame_document_allowed(&blob, None));
        assert!(!main_frame_document_allowed(&viewer, None));
        for refused in [
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html",
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=https://evil.test/a.pdf",
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=javascript:alert(1)",
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=file:///etc/passwd",
            "webkit-pdfjs-viewer://pdfjs/extras/content-script.js?file=blob:https://example.com/x",
            "webkit-pdfjs-viewer://evil/web/viewer.html?file=blob:https://example.com/x",
            "webkit-pdfjs-viewer://user@pdfjs/web/viewer.html?file=blob:https://example.com/x",
            "data:application/pdf,JVBERi0=",
            "javascript:alert(1)",
        ] {
            assert!(
                !nav(&url(refused), None, &bare, NavFrame::Child),
                "{refused} was allowed"
            );
            assert!(
                !nav(&url(refused), None, &bare, NavFrame::Unknown),
                "{refused} was allowed"
            );
        }
    }

    #[test]
    fn pdf_frames_follow_registered_blobs_and_the_top_level_deny() {
        let raw = "blob:https://example.com/550e8400-e29b-41d4-a716-446655440000";
        assert_eq!(url(raw).as_str(), raw);
        for sample in [
            "blob:http://localhost:1420/8b0b0b0b-1111-2222-3333-444444444444",
            "blob:tauri://localhost/8b0b0b0b-1111-2222-3333-444444444444",
        ] {
            assert_eq!(url(sample).as_str(), sample, "{sample}");
            assert_eq!(url(sample).scheme(), "blob");
        }
        let blob = url(raw);
        let other = url("blob:https://example.com/not-a-pdf");
        let viewer = url(
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=blob%3Ahttps%3A%2F%2Fexample.com%2F550e8400-e29b-41d4-a716-446655440000",
        );
        let viewer_other = url(
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=blob%3Ahttps%3A%2F%2Fexample.com%2Fnot-a-pdf",
        );
        let frames = FrameOrigins::new();
        let pdf = PdfBlobs::new();
        pdf.open_window("main");
        pdf.allow("main", raw).unwrap();
        assert!(pdf.allow("main", "https://example.com/a.pdf").is_err());
        assert!(pdf.allow("main", "javascript:alert(1)").is_err());
        assert!(pdf.allow("main", "file:///etc/passwd").is_err());
        assert!(pdf.allow("main", "blob:https://example.com/x y").is_err());

        // The runtime passes Unknown. A unit test that names Main does not prove the hook.
        assert!(!WRY_ON_NAVIGATION_TELLS_FRAME);
        for place in [NavFrame::Child, NavFrame::Unknown, NavFrame::Main] {
            assert!(
                !navigation_allowed(&blob, None, &frames, &pdf, false, place, "main"),
                "{place:?} allowed a pdf blob before the top-level deny"
            );
            assert!(
                !navigation_allowed(&viewer, None, &frames, &pdf, false, place, "main"),
                "{place:?} allowed the viewer before the top-level deny"
            );
        }
        for place in [NavFrame::Child, NavFrame::Unknown] {
            assert!(
                navigation_allowed(&blob, None, &frames, &pdf, true, place, "main"),
                "{place:?}"
            );
            assert!(
                navigation_allowed(&viewer, None, &frames, &pdf, true, place, "main"),
                "{place:?}"
            );
            assert!(
                !navigation_allowed(&other, None, &frames, &pdf, true, place, "main"),
                "{place:?} allowed an unregistered blob"
            );
            assert!(
                !navigation_allowed(&viewer_other, None, &frames, &pdf, true, place, "main"),
                "{place:?} allowed a viewer for an unregistered blob"
            );
        }
        assert!(!navigation_allowed(
            &blob,
            None,
            &frames,
            &pdf,
            true,
            NavFrame::Main,
            "main"
        ));
        assert!(!navigation_allowed(
            &viewer,
            None,
            &frames,
            &pdf,
            true,
            NavFrame::Main,
            "main"
        ));
        assert!(!main_frame_document_allowed(&blob, None));
        assert!(!main_frame_document_allowed(&viewer, None));
        for refused in [
            "webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=javascript:alert(1)",
            "webkit-pdfjs-viewer://pdfjs/extras/content-script.js?file=blob:https://example.com/550e8400-e29b-41d4-a716-446655440000",
            "data:application/pdf,JVBERi0=",
        ] {
            assert!(
                !navigation_allowed(
                    &url(refused),
                    None,
                    &frames,
                    &pdf,
                    true,
                    NavFrame::Unknown,
                    "main"
                ),
                "{refused} was allowed"
            );
        }

        // A second holder on this window keeps the blob. The last release drops it.
        // Another window's release does not.
        pdf.open_window("note-1");
        pdf.allow("note-1", raw).unwrap();
        pdf.allow("main", raw).unwrap();
        pdf.release("note-1", raw);
        assert!(pdf.holds("main", &blob));
        assert!(!pdf.holds("note-1", &blob));
        pdf.release("main", raw);
        assert!(navigation_allowed(
            &blob,
            None,
            &frames,
            &pdf,
            true,
            NavFrame::Unknown,
            "main"
        ));
        pdf.release("main", raw);
        assert!(!navigation_allowed(
            &blob,
            None,
            &frames,
            &pdf,
            true,
            NavFrame::Unknown,
            "main"
        ));
        pdf.release("main", raw);

        let web = registered("https://example.com");
        let page = url("https://example.com/watch");
        assert!(navigation_allowed(
            &page,
            None,
            &web,
            &pdf,
            false,
            NavFrame::Unknown,
            "main"
        ));
        assert!(!navigation_allowed(
            &page,
            None,
            &web,
            &pdf,
            false,
            NavFrame::Main,
            "main"
        ));
    }

    #[test]
    fn a_window_without_the_viewer_hook_does_not_register_a_pdf_blob() {
        let raw = "blob:https://example.com/550e8400-e29b-41d4-a716-446655440000";
        let flags = PdfFrameFlags::new();
        let main = Arc::new(AtomicBool::new(false));
        let note = Arc::new(AtomicBool::new(false));
        flags.insert("main", Arc::clone(&main));
        flags.insert("note-1", Arc::clone(&note));
        assert!(!flags.enabled("main"));
        assert!(!flags.enabled("missing"));
        let pdf = PdfBlobs::new();
        pdf.open_window("main");
        pdf.open_window("note-1");
        let err = flags.allow_blob("main", &pdf, raw).unwrap_err();
        assert_eq!(err, PDF_VIEWER_UNAVAILABLE);
        assert!(!pdf.holds("main", &url(raw)));
        // Another window's hook does not make this one ready.
        note.store(true, Ordering::Release);
        assert!(flags.allow_blob("main", &pdf, raw).is_err());
        assert!(!pdf.holds("main", &url(raw)));
        main.store(true, Ordering::Release);
        flags.allow_blob("main", &pdf, raw).unwrap();
        assert!(pdf.holds("main", &url(raw)));
        assert!(flags.enabled("note-1"));
        // Destroy drops the flag and this window's registrations. The other window stays.
        flags.remove("main");
        pdf.close_window("main");
        assert!(!flags.enabled("main"));
        assert!(flags.enabled("note-1"));
        assert!(!pdf.holds("main", &url(raw)));
        assert!(flags.allow_blob("main", &pdf, raw).is_err());
        assert!(!pdf.holds("main", &url(raw)));
    }

    #[test]
    fn closing_a_window_drops_its_pdf_blobs_including_one_racing_the_close() {
        let raw = "blob:https://example.com/550e8400-e29b-41d4-a716-446655440000";
        let blob = url(raw);
        let pdf = PdfBlobs::new();
        pdf.open_window("main");
        pdf.open_window("note-1");
        pdf.allow("main", raw).unwrap();
        pdf.allow("note-1", raw).unwrap();
        let running = Arc::new(AtomicBool::new(true));
        let spin = Arc::clone(&running);
        let racing = pdf.clone();
        let worker = std::thread::spawn(move || {
            while spin.load(Ordering::Relaxed) {
                let _ = racing.allow("note-1", raw);
            }
            let _ = racing.allow("note-1", raw);
        });
        std::thread::yield_now();
        pdf.close_window("note-1");
        running.store(false, Ordering::Relaxed);
        worker.join().unwrap();
        assert!(!pdf.holds("note-1", &blob));
        assert!(pdf.holds("main", &blob));
        assert!(pdf.allow("note-1", raw).is_err());
        assert!(!pdf.holds("note-1", &blob));
        let frames = FrameOrigins::new();
        assert!(navigation_allowed(
            &blob,
            None,
            &frames,
            &pdf,
            true,
            NavFrame::Unknown,
            "main"
        ));
        assert!(!navigation_allowed(
            &blob,
            None,
            &frames,
            &pdf,
            true,
            NavFrame::Unknown,
            "note-1"
        ));
    }

    #[test]
    fn ipc_from_a_non_app_origin_is_refused() {
        assert!(capabilities_grant_local_ipc_only());
        let dev = url("http://localhost:1420");
        assert!(ipc_origin_allowed(&url("tauri://localhost/"), None));
        assert!(ipc_origin_allowed(&url("https://tauri.localhost/x"), None));
        assert!(ipc_origin_allowed(
            &url("http://localhost:1420/src/main.ts"),
            Some(&dev)
        ));

        let frames = registered("https://example.com");
        assert!(frames.contains("https://example.com"));
        for raw in [
            "https://example.com/watch",
            "https://example.com/",
            "http://evil.test/",
            "http://127.0.0.1:1420/",
            "http://tauri.localhost.example.com/",
            "file:///tmp/x",
            "javascript:alert(1)",
            "about:blank",
        ] {
            assert!(
                !ipc_origin_allowed(&url(raw), Some(&dev)),
                "{raw} was allowed to call IPC"
            );
        }
    }
}
