//! Keeps the webview on Grove's own pages, except embedded frames.
//!
//! Windows are built here rather than from `tauri.conf.json` so they can carry two guards the
//! config cannot express:
//!
//! - every navigation (a link, a dropped URL, script setting `location`, a frame load) is checked.
//!   The app's own origin is always allowed: `tauri://localhost` (or `http(s)://tauri.localhost` on
//!   Windows) in release builds, plus the dev server origin in dev builds. A *child* frame may also
//!   load an `http(s)` origin the page registered with `allow_frame_origin`. The main frame may not;
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

use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
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
    let guard_dev = dev_url.clone();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| {
            // Unknown: this callback cannot tell the main frame from a subframe. The response
            // policy hook below refuses a main-frame document that is not the app.
            let allowed = navigation_allowed(url, dev_url.as_ref(), &frames, NavFrame::Unknown);
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
    install_main_frame_guard(&window, guard_dev);
    enable_spellchecker(&window);
    Ok(())
}

/// Ignore a main-frame document that is not Grove. Subframe documents and subresources are left
/// to the navigation callback, which allows only registered http(s) origins.
#[cfg(target_os = "linux")]
fn install_main_frame_guard(window: &tauri::WebviewWindow, dev_url: Option<Url>) {
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
    });
}

#[cfg(not(target_os = "linux"))]
fn install_main_frame_guard(_window: &tauri::WebviewWindow, _dev_url: Option<Url>) {}

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
pub fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
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

/// Whether a navigation may proceed.
///
/// The main frame stays on the app. A child frame, and a navigation whose frame wry cannot name,
/// may also go to a registered http(s) origin. `file:`, `javascript:`, and anything unregistered
/// are refused in every frame. New windows are not decided here; the builder denies all of them.
pub fn navigation_allowed(
    url: &Url,
    dev_url: Option<&Url>,
    frames: &FrameOrigins,
    place: NavFrame,
) -> bool {
    if is_app_url(url, dev_url) {
        return true;
    }
    match place {
        NavFrame::Main => false,
        NavFrame::Child | NavFrame::Unknown => {
            http_origin(url).is_some_and(|origin| frames.contains(&origin))
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
        assert!(is_app_url(&url("http://tauri.localhost/"), None));
        assert!(is_app_url(
            &url("https://tauri.localhost/assets/a.js"),
            None
        ));
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
            assert!(navigation_allowed(&app, None, &frames, place), "{place:?}");
            assert!(
                navigation_allowed(&url("about:blank"), None, &frames, place),
                "{place:?}"
            );
            assert!(
                navigation_allowed(
                    &url("http://localhost:1420/src/main.ts"),
                    Some(&dev),
                    &frames,
                    place
                ),
                "{place:?}"
            );
        }

        assert!(navigation_allowed(
            &registered_page,
            None,
            &frames,
            NavFrame::Child
        ));
        assert!(!navigation_allowed(&other, None, &frames, NavFrame::Child));
        assert!(!navigation_allowed(&file, None, &frames, NavFrame::Child));
        assert!(!navigation_allowed(&script, None, &frames, NavFrame::Child));
        assert!(!navigation_allowed(
            &url("https://www.example.com/"),
            None,
            &frames,
            NavFrame::Child
        ));
        assert!(!navigation_allowed(
            &url("http://example.com/"),
            None,
            &frames,
            NavFrame::Child
        ));
        assert!(!navigation_allowed(
            &url("https://example.com:8443/"),
            None,
            &frames,
            NavFrame::Child
        ));

        // The caller knows this is the main frame, so a registered origin is refused.
        assert!(!navigation_allowed(
            &registered_page,
            None,
            &frames,
            NavFrame::Main
        ));
        assert!(!main_frame_document_allowed(&registered_page, None));
        assert!(main_frame_document_allowed(&app, None));

        // wry cannot tell. Unknown is what on_navigation passes, so the frame load is allowed
        // and the Linux response-policy hook is what refuses the main-frame document.
        assert!(!WRY_ON_NAVIGATION_TELLS_FRAME);
        assert!(navigation_allowed(
            &registered_page,
            None,
            &frames,
            NavFrame::Unknown
        ));
        if main_frame_document_is_distinguishable() {
            assert!(!main_frame_document_allowed(&registered_page, None));
            assert!(!main_frame_document_allowed(&file, None));
            assert!(!main_frame_document_allowed(&script, None));
        }

        let bare = FrameOrigins::new();
        assert!(!navigation_allowed(
            &registered_page,
            None,
            &bare,
            NavFrame::Child
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
