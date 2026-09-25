//! Default mode: a real desktop window (WebView2 on Windows, WebKitGTK on Linux).
//!
//! The UI is served through a private `folio://` protocol handled in-process,
//! so nothing listens on a network port, and the webview's own browser
//! shortcuts (Ctrl+N, Ctrl+W, Ctrl+P, F5, ...) are switched off so every key
//! reaches Cinder.

use crate::api::{self, Ctx};
use serde_json::json;
use std::borrow::Cow;
use std::sync::Arc;
use std::time::Duration;
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, ResizeDirection, Theme, WindowBuilder};
use wry::http::{Request, Response};
use wry::{NewWindowResponse, WebContext, WebViewBuilder};

/// The page's private scheme. It keeps the app's old name: the webview files its local storage
/// (every saved UI setting) under this origin, so renaming it would reset them all.
const PROTOCOL: &str = "folio";

#[derive(Debug)]
enum UserEvent {
    Title(String),
    CloseAck,
    CloseOk,
    CloseCancel,
    AckTimeout,
    /// Hide the window while a screenshot is taken (true), then bring it back (false).
    Hide(bool),
    /// The page's own close button (same as the window manager's).
    CloseRequest,
    /// Window commands from the page's own title bar: drag, min, max, resize:<dir>,
    /// frame:native|custom, theme:dark|light.
    Win(String),
}

/// Whether Cinder draws its own title bar (the default, except on macOS) or uses the system's.
pub fn custom_frame() -> bool {
    match crate::config::load()["window"]["frame"].as_str() {
        Some("native") => false,
        Some("custom") => true,
        _ => !cfg!(target_os = "macos"),
    }
}

pub fn run(ctx: Ctx) -> ! {
    let ctx = Arc::new(ctx);
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let p_hide = std::sync::Mutex::new(proxy.clone());
    let _ = ctx.hide_window.set(Box::new(move |hide| {
        if let Ok(p) = p_hide.lock() {
            let _ = p.send_event(UserEvent::Hide(hide));
        }
    }));

    // Restore the last window size and position.
    let cfg = crate::config::load();
    let win = &cfg["window"];
    let w = win["w"].as_f64().unwrap_or(1280.0).clamp(480.0, 8000.0);
    let h = win["h"].as_f64().unwrap_or(840.0).clamp(360.0, 8000.0);
    let mut wb = WindowBuilder::new()
        .with_title(title_for(&ctx))
        .with_inner_size(LogicalSize::new(w, h))
        .with_min_inner_size(LogicalSize::new(480.0, 360.0))
        .with_maximized(win["maximized"].as_bool().unwrap_or(false))
        .with_decorations(!custom_frame())
        .with_window_icon(Some(icon()));
    if let (Some(x), Some(y)) = (win["x"].as_i64(), win["y"].as_i64()) {
        wb = wb.with_position(PhysicalPosition::new(x as i32, y as i32));
    }
    let window = wb.build(&event_loop).unwrap_or_else(|e| crate::die(&format!("couldn't create a window: {e}")));

    let mut web_context = WebContext::new(Some(crate::config::data_dir().join("webview")));
    let handler_ctx = ctx.clone();
    let p_ipc = proxy.clone();
    let frames = Arc::new(std::sync::Mutex::new(std::collections::HashSet::<String>::new()));
    let (ipc_frames, nav_frames) = (frames.clone(), frames);
    let p_title = proxy.clone();
    let builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_asynchronous_custom_protocol(PROTOCOL.into(), move |_id, req, responder| {
            // Slow requests (a screenshot waits on the user) mustn't freeze the window.
            if api::is_slow(req.uri().path()) {
                let ctx = handler_ctx.clone();
                std::thread::spawn(move || responder.respond(handle(&ctx, req)));
            } else {
                responder.respond(handle(&handler_ctx, req));
            }
        })
        .with_url(&format!("{PROTOCOL}://localhost/"))
        .with_ipc_handler(move |req: Request<String>| {
            let body = req.body().as_str();
            if let Some(url) = body.strip_prefix("frame:") {
                if let (Some(o), Ok(mut set)) = (origin_of(url), ipc_frames.lock()) {
                    set.insert(o);
                }
                return;
            }
            let ev = match body {
                "close-ack" => UserEvent::CloseAck,
                "close-ok" => UserEvent::CloseOk,
                "close-cancel" => UserEvent::CloseCancel,
                "win:close" => UserEvent::CloseRequest,
                _ if body.starts_with("win:") && body.len() < 40 => UserEvent::Win(body[4..].to_string()),
                _ => return,
            };
            let _ = p_ipc.send_event(ev);
        })
        .with_document_title_changed_handler(move |t| {
            let _ = p_title.send_event(UserEvent::Title(t));
        })
        // External links open in the user's normal browser, never inside Cinder.
        .with_new_window_req_handler(|url, _features| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .with_navigation_handler(move |url| {
            // Web pages embedded in notes load in sandboxed frames; the page registers each one's
            // origin first. Anything else leaves for the user's browser.
            if is_app_url(&url) || origin_of(&url).is_some_and(|o| nav_frames.lock().is_ok_and(|s| s.contains(&o))) {
                true
            } else {
                open_external(&url);
                false
            }
        })
        .with_background_color((23, 17, 15, 255))
        // No browser form suggestions over Cinder's own fields.
        .with_general_autofill_enabled(false);

    #[cfg(windows)]
    let builder = {
        use wry::WebViewBuilderExtWindows;
        builder.with_browser_accelerator_keys(false)
    };

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let webview = builder.build(&window);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(window.default_vbox().expect("gtk vbox"))
    };
    let webview = webview.unwrap_or_else(|e| {
        crate::die(&format!(
            "couldn't start the web view: {e}\n\nOn Windows this needs the Microsoft Edge WebView2 Runtime, \
             which ships with Windows 10/11. Run `cinder --browser` to use a browser tab instead."
        ))
    });

    let mut closing = false;
    let mut acked = false;
    let debug = std::env::var_os("CINDER_DEBUG").is_some();
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if debug {
            match &event {
                Event::UserEvent(_) | Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => eprintln!("event: {event:?}"),
                _ => {}
            }
        }
        let _keep = &web_context;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } | Event::UserEvent(UserEvent::CloseRequest) => {
                if closing {
                    return;
                }
                closing = true;
                acked = false;
                // Ask the page to flush unsaved edits; it answers over IPC.
                let _ = webview.evaluate_script(
                    "window.__cinderClose ? window.__cinderClose() : window.ipc.postMessage('close-ok')",
                );
                let p = proxy.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    let _ = p.send_event(UserEvent::AckTimeout);
                });
            }
            Event::UserEvent(UserEvent::Title(t)) => window.set_title(&t),
            Event::UserEvent(UserEvent::Win(cmd)) => {
                match cmd.as_str() {
                    "drag" => drop(window.drag_window()),
                    "min" => window.set_minimized(true),
                    "max" => window.set_maximized(!window.is_maximized()),
                    "frame:native" | "frame:custom" => {
                        let native = cmd == "frame:native";
                        window.set_decorations(native);
                        let mut c = crate::config::load();
                        c["window"]["frame"] = json!(if native { "native" } else { "custom" });
                        crate::config::save(&c);
                    }
                    "fullscreen:on" => window.set_fullscreen(Some(tao::window::Fullscreen::Borderless(None))),
                    "fullscreen:off" => window.set_fullscreen(None),
                    "theme:dark" => window.set_theme(Some(Theme::Dark)),
                    "theme:light" => window.set_theme(Some(Theme::Light)),
                    c => {
                        let dir = match c.strip_prefix("resize:") {
                            Some("n") => Some(ResizeDirection::North),
                            Some("s") => Some(ResizeDirection::South),
                            Some("e") => Some(ResizeDirection::East),
                            Some("w") => Some(ResizeDirection::West),
                            Some("ne") => Some(ResizeDirection::NorthEast),
                            Some("nw") => Some(ResizeDirection::NorthWest),
                            Some("se") => Some(ResizeDirection::SouthEast),
                            Some("sw") => Some(ResizeDirection::SouthWest),
                            _ => None,
                        };
                        if let Some(d) = dir {
                            let _ = window.drag_resize_window(d);
                        }
                    }
                }
                tell_maximized(&webview, &window);
            }
            Event::WindowEvent { event: WindowEvent::Resized(_), .. } => tell_maximized(&webview, &window),
            Event::UserEvent(UserEvent::CloseAck) => acked = true,
            Event::UserEvent(UserEvent::Hide(hide)) => {
                window.set_visible(!hide);
                if !hide {
                    window.set_focus();
                }
            }
            Event::UserEvent(UserEvent::CloseCancel) => closing = false,
            Event::UserEvent(UserEvent::AckTimeout) => {
                // Page never answered (hung or crashed): close anyway.
                if closing && !acked {
                    save_window_state(&window);
                    *control_flow = ControlFlow::Exit;
                }
            }
            Event::UserEvent(UserEvent::CloseOk) => {
                save_window_state(&window);
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    })
}

/// The page's title bar shows maximize or restore.
fn tell_maximized(webview: &wry::WebView, window: &tao::window::Window) {
    let _ = webview.evaluate_script(&format!("window.__cinderWinState && window.__cinderWinState({})", window.is_maximized()));
}

fn title_for(ctx: &Ctx) -> String {
    let v = ctx.vault();
    let name = v.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    format!("{name} — Cinder")
}

/// "https://host[:port]" of an http(s) URL.
fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let host = rest.split(['/', '?', '#']).next()?;
    if host.is_empty() || host.contains('@') {
        return None;
    }
    Some(format!("{scheme}://{}", host.to_ascii_lowercase()))
}

fn is_app_url(url: &str) -> bool {
    url.starts_with(&format!("{PROTOCOL}://")) || url.starts_with(&format!("http://{PROTOCOL}.localhost")) || url.starts_with(&format!("https://{PROTOCOL}.localhost")) || url == "about:blank"
}

/// Serve a request from the page (the whole app runs through this).
fn handle(ctx: &Ctx, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();
    let headers = req.headers().clone();
    let lookup = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).map(String::from);
    let o = api::dispatch(ctx, &method, &path, &query, &lookup, req.into_body());
    let mut b = Response::builder()
        .status(o.status)
        .header("Content-Type", o.ctype)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if o.csp {
        b = b.header("Content-Security-Policy", api::CSP);
    }
    b.body(Cow::Owned(o.body)).unwrap_or_else(|_| Response::new(Cow::Borrowed(&b""[..])))
}

pub fn open_external(url: &str) {
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
        return;
    }
    use std::process::Command;
    // rundll32 hands the URL straight to the default browser without going through cmd's parser.
    #[cfg(windows)]
    let _ = Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

fn save_window_state(window: &tao::window::Window) {
    let mut c = crate::config::load();
    let maximized = window.is_maximized();
    let mut state = c.get("window").cloned().unwrap_or(json!({}));
    state["maximized"] = json!(maximized);
    if !maximized && !window.is_minimized() {
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        state["w"] = json!(size.width.round());
        state["h"] = json!(size.height.round());
        if let Ok(pos) = window.outer_position() {
            state["x"] = json!(pos.x);
            state["y"] = json!(pos.y);
        }
    }
    c["window"] = state;
    crate::config::save(&c);
}

/// The volcano app icon: ui/logo.svg rendered at 64×64 as straight RGBA.
fn icon() -> Icon {
    const RGBA: &[u8] = include_bytes!("icon-64.rgba");
    Icon::from_rgba(RGBA.to_vec(), 64, 64).expect("icon")
}

#[cfg(test)]
mod tests {
    use super::origin_of;

    #[test]
    fn origins() {
        assert_eq!(origin_of("https://Example.com/a?b#c").as_deref(), Some("https://example.com"));
        assert_eq!(origin_of("http://localhost:8080/x").as_deref(), Some("http://localhost:8080"));
        assert_eq!(origin_of("https://user@evil.com/").as_deref(), None);
        assert_eq!(origin_of("folio://localhost/").as_deref(), None);
        assert_eq!(origin_of("javascript:alert(1)").as_deref(), None);
    }
}
