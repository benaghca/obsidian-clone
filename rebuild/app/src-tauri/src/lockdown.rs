//! Keeps the webview on Grove's own pages.
//!
//! Windows are built here rather than from `tauri.conf.json` so they can carry two guards the
//! config cannot express:
//!
//! - every navigation (a link, a dropped URL, script setting `location`) is checked, and only the
//!   app's own origin is allowed: `tauri://localhost` (or `http(s)://tauri.localhost` on Windows)
//!   in release builds, plus the dev server origin in dev builds;
//! - every new-window request (`window.open`, `target=_blank`) is denied.
//!
//! External links never load inside the app: the front end hands them to the system opener
//! (`tauri-plugin-opener`, scoped to http, https and mailto in `capabilities/default.json`).

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Url, WebviewUrl, WebviewWindowBuilder};

pub const MAIN_WINDOW: &str = "main";
/// A note's own window ("Open in new window") is `note-<n>`; the capability names them by it.
const NOTE_WINDOW: &str = "note-";

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
    !note.is_empty() && note.bytes().all(|b| b.is_ascii_alphanumeric() || b"%-._~".contains(&b))
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
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| {
            let allowed = is_app_url(url, dev_url.as_ref());
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
    enable_spellchecker(&window);
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn release_builds_allow_only_the_app_origin() {
        assert!(is_app_url(&url("tauri://localhost/"), None));
        assert!(is_app_url(&url("tauri://localhost/index.html#x"), None));
        assert!(is_app_url(&url("http://tauri.localhost/"), None));
        assert!(is_app_url(&url("https://tauri.localhost/assets/a.js"), None));
        assert!(is_app_url(&url("about:blank"), None));

        assert!(!is_app_url(&url("http://localhost:1420/"), None));
        assert!(!is_app_url(&url("https://example.com/"), None));
        assert!(!is_app_url(&url("http://tauri.localhost.example.com/"), None));
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
        assert!(is_app_url(&url("http://localhost:1420/src/main.ts"), Some(&dev)));
        assert!(!is_app_url(&url("http://localhost:1421/"), Some(&dev)));
        assert!(!is_app_url(&url("http://127.0.0.1:1420/"), Some(&dev)));
        assert!(!is_app_url(&url("https://localhost:1420/"), Some(&dev)));
        assert!(!is_app_url(&url("https://example.com/"), Some(&dev)));
    }
}
