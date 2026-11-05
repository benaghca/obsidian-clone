//! Tauri commands for the notes vault.
//!
//! The front end calls these with `invoke`. Paths are vault-relative and use `/`.
//! `write_note` does not emit `vault-changed` to the window that saved (the save is its own write,
//! ignored for 500ms), only to other windows (a note's own window, or the main one). `create_note`, `rename_path`, and `delete_path` update the index before they
//! return, and the watcher also emits `vault-changed` about 100ms later. Treat that event as
//! idempotent and call `list_files` / `link_index` for the authoritative state.
//!
//! `vault-changed` is `{ kind: "create"|"modify"|"remove"|"rename", paths: string[] }`.
//! A rename's `paths` are `[from, to]`. A renamed directory covers every file under that prefix.
//!
//! Search hits use 1-based `line`. A file-name match uses `line: 0` and `text` equal to the
//! display name. Several words must all occur on the same line. Link paths keep the file's real
//! casing. Notes with no resolved links are omitted from `outgoing` and `backlinks`.
//! `last_vault` does not open the folder; call `open_vault` with its path.
//! `create_vault` makes one new empty folder (the parent must already exist; an
//! existing path is refused) and then opens it the same way as `open_vault`.

mod clipboard;
mod config;
mod edit;
#[cfg(test)]
mod edit_fuzz;
mod fsutil;
mod index;
mod lockdown;
mod model;
mod vault;
mod watch;

use crate::index::NoteProperties;
use crate::model::{Backlink, FileEntry, LinkIndex, SearchHit, SearchNote, SearchLine, VaultInfo};
use crate::watch::WatchMsg;
use std::collections::BTreeMap;
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub(crate) inner: Mutex<Inner>,
    pub(crate) watch_tx: mpsc::Sender<WatchMsg>,
}

pub struct Inner {
    pub(crate) config_dir: std::path::PathBuf,
    pub(crate) vault: Option<vault::Vault>,
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

pub fn run() {
    #[cfg(target_os = "linux")]
    graphics_env();
    tauri::Builder::default()
        // Only the front end's own trusted-click handler may open links. The
        // plugin's injected page script would also send any <a target=_blank>
        // click (even a scripted one) to the system browser, so it is off.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let (tx, rx) = mpsc::channel();
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| fallback_config_dir());
            let _ = std::fs::create_dir_all(&config_dir);
            app.manage(AppState {
                inner: Mutex::new(Inner {
                    config_dir,
                    vault: None,
                }),
                watch_tx: tx.clone(),
            });
            app.manage(lockdown::FrameOrigins::new());
            let handle: AppHandle = app.handle().clone();
            std::thread::Builder::new()
                .name("vault-watch".into())
                .spawn(move || watch::run(handle, tx, rx))
                .map_err(|err| -> Box<dyn std::error::Error> { Box::new(err) })?;
            // Last, so the state its commands use is in place before the page loads.
            lockdown::create_main_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            create_vault,
            last_vault,
            list_files,
            read_note,
            read_file_bytes,
            read_clipboard_image,
            set_property,
            write_note,
            write_file_bytes,
            create_note,
            create_folder,
            rename_path,
            delete_path,
            search,
            search_notes,
            search_lines,
            search_match,
            link_index,
            backlinks,
            link_sources,
            frontmatter,
            properties,
            tags,
            read_config,
            write_config,
            read_foreign_config,
            open_note_window,
            allow_frame_origin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running grove");
}

/// Keeps WebKitGTK's GPU (DMA-BUF) renderer on where it works. Without it WebKit paints every
/// frame on the CPU: zooming a one-card canvas took a whole core and fell below 60 fps
/// (rebuild/WEBKIT_PERF_NOTES.md).
///
/// On Wayland, NVIDIA's EGL turns on explicit sync for the window's surface. GTK 3 then commits
/// a plain buffer there with no sync point, and Hyprland closes the connection ("Error 71
/// (Protocol error)": "Missing acquire timeline"). So explicit sync is turned off instead; only
/// NVIDIA's driver reads that variable. Under X11 the renderer could not make its buffers on
/// NVIDIA, so it stays off there. A variable the user has already set wins.
#[cfg(target_os = "linux")]
fn graphics_env() {
    let default = |name: &str, value: &str| {
        if std::env::var_os(name).is_none() {
            std::env::set_var(name, value);
        }
    };
    let display = std::env::var_os("WAYLAND_DISPLAY").unwrap_or_default();
    if gdk_uses_wayland(!display.is_empty(), &std::env::var("GDK_BACKEND").unwrap_or_default()) {
        default("__NV_DISABLE_EXPLICIT_SYNC", "1");
    } else {
        default("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// GDK tries the backends in `GDK_BACKEND` order (`*` or unset: Wayland first).
#[cfg(target_os = "linux")]
fn gdk_uses_wayland(has_display: bool, backend: &str) -> bool {
    has_display && matches!(backend.split(',').next().unwrap_or("").trim(), "" | "*" | "wayland")
}

#[cfg(all(test, target_os = "linux"))]
#[test]
fn gdk_backend_choice() {
    assert!(gdk_uses_wayland(true, ""));
    assert!(gdk_uses_wayland(true, "wayland,x11,*"));
    assert!(gdk_uses_wayland(true, "*"));
    assert!(!gdk_uses_wayland(true, "x11"));
    assert!(!gdk_uses_wayland(true, "x11,wayland"));
    assert!(!gdk_uses_wayland(false, "wayland"));
}

fn fallback_config_dir() -> std::path::PathBuf {
    if let Some(config) = std::env::var_os("XDG_CONFIG_HOME") {
        return std::path::PathBuf::from(config).join("com.benaghca.grove");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return std::path::PathBuf::from(home)
            .join(".config")
            .join("com.benaghca.grove");
    }
    std::env::temp_dir().join("grove")
}

/// Run `f` on the open vault, or fail when none is open.
fn with_vault<T>(
    state: &AppState,
    f: impl FnOnce(&mut vault::Vault) -> Result<T, String>,
) -> Result<T, String> {
    let mut inner = lock(&state.inner);
    f(inner.vault.as_mut().ok_or("no vault open")?)
}

/// Remember `raw`, watch it, and hand back its name. Shared by open and create.
fn install_vault(state: &AppState, raw: std::path::PathBuf) -> Result<VaultInfo, String> {
    let opened = vault::Vault::open(raw)?;
    let info = VaultInfo::from_path(&opened.root);
    let root = opened.root.clone();
    {
        let mut inner = lock(&state.inner);
        config::remember(&inner.config_dir, &root)?;
        inner.vault = Some(opened);
    }
    let _ = state.watch_tx.send(WatchMsg::Watch(root));
    Ok(info)
}

#[tauri::command]
fn open_vault(state: State<'_, AppState>, path: String) -> Result<VaultInfo, String> {
    let raw = fsutil::expand_user(path.trim());
    if !raw.is_dir() {
        return Err(format!("not a folder: {}", raw.display()));
    }
    install_vault(&state, raw)
}

/// A new empty vault folder, then the same remember-and-watch path as `open_vault`.
#[tauri::command]
fn create_vault(state: State<'_, AppState>, path: String) -> Result<VaultInfo, String> {
    let raw = fsutil::create_vault_dir(&path)?;
    install_vault(&state, raw)
}

#[tauri::command(async)]
fn last_vault(state: State<'_, AppState>) -> Result<Option<VaultInfo>, String> {
    let inner = lock(&state.inner);
    Ok(config::last_vault(&inner.config_dir).map(|path| VaultInfo::from_path(&path)))
}

#[tauri::command(async)]
fn list_files(state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    with_vault(&state, |v| Ok(v.list_files()))
}

#[tauri::command(async)]
fn read_note(state: State<'_, AppState>, path: String) -> Result<String, String> {
    with_vault(&state, |v| v.read_note(&path))
}

/// Sent as raw bytes (an ArrayBuffer in the page), not as a JSON array of numbers.
#[tauri::command(async)]
fn read_file_bytes(
    state: State<'_, AppState>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    with_vault(&state, |v| v.read_file_bytes(&path)).map(tauri::ipc::Response::new)
}

/// The clipboard's image, off the GTK thread. `null` when there is no image.
/// A missing `wl-paste` or `xclip` is an error. See `clipboard`.
#[tauri::command(async)]
fn read_clipboard_image() -> Result<clipboard::ClipboardBody, String> {
    clipboard::command_body()
}

/// Header for the vault-relative path on a raw `write_file_bytes` body.
const WRITE_PATH_HEADER: &str = "x-grove-path";

/// Percent-encode a vault path for [`WRITE_PATH_HEADER`].
///
/// `/` and `A-Za-z0-9-._~` stay as themselves. Every other byte is `%HH` with
/// uppercase hex. A space is `%20`, not `+`. The desktop app encodes in
/// `src/api.ts`; this copy is what the round-trip test checks.
#[cfg(test)]
fn encode_grove_path(path: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(path.len());
    for &byte in path.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                out.push(byte as char);
            }
            _ => {
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0xf) as usize] as char);
            }
        }
    }
    out
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Decode [`WRITE_PATH_HEADER`]. Raw bytes are ASCII; anything else is refused.
fn decode_grove_path(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("invalid x-grove-path".into());
            }
            let hi = hex_val(bytes[i + 1]).ok_or("invalid x-grove-path")?;
            let lo = hex_val(bytes[i + 2]).ok_or("invalid x-grove-path")?;
            out.push((hi << 4) | lo);
            i += 3;
        } else if bytes[i].is_ascii() {
            out.push(bytes[i]);
            i += 1;
        } else {
            return Err("invalid x-grove-path".into());
        }
    }
    String::from_utf8(out).map_err(|_| "invalid x-grove-path".into())
}

fn path_from_headers(headers: &tauri::http::HeaderMap) -> Result<String, String> {
    let value = headers
        .get(WRITE_PATH_HEADER)
        .ok_or("missing x-grove-path")?
        .to_str()
        .map_err(|_| "invalid x-grove-path")?;
    decode_grove_path(value)
}

fn bytes_from_body(body: &tauri::ipc::InvokeBody) -> Result<&[u8], String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        tauri::ipc::InvokeBody::Json(_) => {
            Err("write_file_bytes expects a raw body, not JSON".into())
        }
    }
}

#[tauri::command]
fn write_note(
    window: tauri::Window,
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    with_vault(&state, |v| v.write_note(&path, &content))?;
    let change = model::VaultChanged {
        kind: model::ChangeKind::Modify,
        paths: vec![path],
    };
    let me = window.label().to_owned();
    let _ = window.emit_filter("vault-changed", change, |target| match target {
        tauri::EventTarget::WebviewWindow { label } | tauri::EventTarget::Window { label } => *label != me,
        _ => false,
    });
    Ok(())
}

/// Fresh-file property CAS, off the GTK thread; only real writes notify other windows.
#[tauri::command(async)]
fn set_property(
    window: tauri::Window,
    state: State<'_, AppState>,
    path: String,
    edit: edit::PropertyEdit,
    dry_run: Option<bool>,
) -> Result<edit::EditResult, String> {
    let dry_run = dry_run.unwrap_or(false);
    let result = with_vault(&state, |v| v.set_property(&path, &edit, dry_run))?;
    if !dry_run && result.done() {
        let change = model::VaultChanged {
            kind: model::ChangeKind::Modify,
            paths: vec![path],
        };
        let me = window.label().to_owned();
        let _ = window.emit_filter("vault-changed", change, |target| match target {
            tauri::EventTarget::WebviewWindow { label } | tauri::EventTarget::Window { label } => {
                *label != me
            }
            _ => false,
        });
    }
    Ok(result)
}

/// A new file's raw bytes (a pasted image or a dropped file), at most 20 MB.
/// The path is the `x-grove-path` header, not a JSON field. Runs off the GTK thread.
/// Other windows get a `vault-changed` `create`; the window that saved does not (it refreshes itself).
#[tauri::command(async)]
fn write_file_bytes(
    window: tauri::Window,
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<FileEntry, String> {
    let path = path_from_headers(request.headers())?;
    let bytes = bytes_from_body(request.body())?;
    let entry = with_vault(&state, |v| v.write_file_bytes(&path, bytes))?;
    let change = model::VaultChanged {
        kind: model::ChangeKind::Create,
        paths: vec![entry.path.clone()],
    };
    let me = window.label().to_owned();
    let _ = window.emit_filter("vault-changed", change, |target| match target {
        tauri::EventTarget::WebviewWindow { label } | tauri::EventTarget::Window { label } => *label != me,
        _ => false,
    });
    Ok(entry)
}

/// "Open in new window": the note (a percent-encoded vault path) in a window of its own.
#[tauri::command]
async fn open_note_window(app: AppHandle, note: String) -> Result<(), String> {
    lockdown::create_note_window(&app, &note)
}

/// Register one http(s) origin so an embedded frame may load it. The main frame may not.
#[tauri::command(async)]
fn allow_frame_origin(
    origins: State<'_, lockdown::FrameOrigins>,
    origin: String,
) -> Result<(), String> {
    origins.allow(&origin)
}

#[tauri::command]
fn create_note(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<FileEntry, String> {
    with_vault(&state, |v| v.create_note(&path, &content))
}

#[tauri::command]
fn create_folder(state: State<'_, AppState>, path: String) -> Result<FileEntry, String> {
    with_vault(&state, |v| v.create_folder(&path))
}

#[tauri::command]
fn rename_path(state: State<'_, AppState>, from: String, to: String) -> Result<(), String> {
    with_vault(&state, |v| v.rename_path(&from, &to))
}

/// `permanent` (optional, default false) removes the file instead of moving it to `.trash/`.
#[tauri::command]
fn delete_path(
    state: State<'_, AppState>,
    path: String,
    permanent: Option<bool>,
) -> Result<(), String> {
    with_vault(&state, |v| v.delete_path(&path, permanent.unwrap_or(false)))
}

/// A settings file from the vault's `.grove/` folder (`None` if missing).
#[tauri::command(async)]
fn read_config(state: State<'_, AppState>, name: String) -> Result<Option<String>, String> {
    with_vault(&state, |v| v.read_config(&name))
}

/// Write a settings file (JSON) into the vault's `.grove/` folder, atomically.
#[tauri::command]
fn write_config(state: State<'_, AppState>, name: String, content: String) -> Result<(), String> {
    with_vault(&state, |v| v.write_config(&name, &content))
}

/// One allowlisted Cinder or Obsidian settings file (`None` if missing). Never writes.
#[tauri::command(async)]
fn read_foreign_config(
    state: State<'_, AppState>,
    source: String,
    name: String,
) -> Result<Option<String>, String> {
    with_vault(&state, |v| v.read_foreign_config(&source, &name))
}

#[tauri::command(async)]
fn search(state: State<'_, AppState>, query: String, limit: u32) -> Result<Vec<SearchHit>, String> {
    with_vault(&state, |v| Ok(v.index.search(&query, limit)))
}

#[tauri::command(async)]
fn link_index(state: State<'_, AppState>) -> Result<LinkIndex, String> {
    with_vault(&state, |v| Ok(v.index.link_index()))
}

/// Linked mentions for the requested target paths only; empty targets are omitted.
#[tauri::command(async)]
fn backlinks(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<BTreeMap<String, Vec<Backlink>>, String> {
    with_vault(&state, |v| Ok(v.index.backlinks(&paths)))
}

/// Notes that might link to `paths`, for a rename. Fetched before `rename_path`.
#[tauri::command(async)]
fn link_sources(state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<String>, String> {
    with_vault(&state, |v| Ok(v.index.link_sources(&paths)))
}

/// Each note's frontmatter block (only `paths`' when given), for the properties index.
#[tauri::command(async)]
fn frontmatter(
    state: State<'_, AppState>,
    paths: Option<Vec<String>>,
) -> Result<BTreeMap<String, String>, String> {
    with_vault(&state, |v| Ok(v.index.frontmatter(paths.as_deref())))
}

/// Each note's tags (only `paths`' when given), for the Tags view, `tag:` search, the graph and
/// Bases. Notes without tags are left out.
#[tauri::command(async)]
fn tags(
    state: State<'_, AppState>,
    paths: Option<Vec<String>>,
) -> Result<BTreeMap<String, Vec<String>>, String> {
    with_vault(&state, |v| Ok(v.index.tags(paths.as_deref())))
}

/// Saved properties parsed once while indexing; source-only/no-frontmatter notes are omitted.
#[tauri::command(async)]
fn properties(
    state: State<'_, AppState>,
    paths: Option<Vec<String>>,
) -> Result<BTreeMap<String, NoteProperties>, String> {
    with_vault(&state, |v| Ok(v.index.properties(paths.as_deref())))
}

/// Matching notes and exact occurrence counts, in vault path order.
#[tauri::command(async)]
fn search_notes(
    state: State<'_, AppState>,
    query: String,
    match_case: bool,
) -> Result<Vec<SearchNote>, String> {
    with_vault(&state, |v| Ok(v.index.search_notes(&query, match_case)))
}

/// A separately evaluated page of shown lines; paths no longer matching are omitted.
#[tauri::command(async)]
fn search_lines(
    state: State<'_, AppState>,
    query: String,
    match_case: bool,
    paths: Vec<String>,
    limit: u32,
) -> Result<BTreeMap<String, Vec<SearchLine>>, String> {
    with_vault(&state, |v| {
        Ok(v.index.search_lines(&query, match_case, &paths, limit))
    })
}

/// Graph filter/colour-group matches, including attachments but never folders.
#[tauri::command(async)]
fn search_match(
    state: State<'_, AppState>,
    queries: Vec<String>,
) -> Result<Vec<Vec<String>>, String> {
    with_vault(&state, |v| Ok(v.index.search_match(&queries)))
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_command_is_in_build_manifest_and_default_capability() {
        let lib = include_str!("lib.rs");
        let build = include_str!("../build.rs");
        let cap = include_str!("../capabilities/default.json");

        let (_, rest) = lib.split_once("tauri::generate_handler![").unwrap();
        let (handler, _) = rest.split_once(']').unwrap();
        let names: Vec<&str> = handler
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        assert!(!names.is_empty());

        for name in names {
            let quoted = format!("\"{name}\"");
            assert!(
                build.contains(&quoted),
                "command `{name}` in generate_handler! is missing from build.rs"
            );
            let perm = format!("\"allow-{}\"", name.replace('_', "-"));
            assert!(
                cap.contains(&perm),
                "command `{name}` in generate_handler! is missing {perm} in capabilities/default.json"
            );
        }
    }

    #[test]
    fn grove_path_header_round_trips() {
        for path in [
            "pics/shot.png",
            "Pasted image 20261023201500.png",
            "café.png",
            "100%.png",
            "a/b",
        ] {
            let encoded = super::encode_grove_path(path);
            assert!(
                encoded.is_ascii() && !encoded.contains(' '),
                "{path} -> {encoded}"
            );
            assert_eq!(super::decode_grove_path(&encoded).unwrap(), path);
        }
        assert_eq!(super::encode_grove_path("pics/shot.png"), "pics/shot.png");
        assert_eq!(
            super::encode_grove_path("Pasted image 20261023201500.png"),
            "Pasted%20image%2020261023201500.png"
        );
        // A plus is not a space.
        assert_eq!(super::decode_grove_path("a+b").unwrap(), "a+b");
        assert_eq!(super::decode_grove_path("%2f").unwrap(), "/");
        assert!(super::decode_grove_path("%").is_err());
        assert!(super::decode_grove_path("%2").is_err());
        assert!(super::decode_grove_path("%GG").is_err());
        assert!(super::decode_grove_path("%C3").is_err());
    }

    #[test]
    fn write_file_bytes_reads_a_raw_body_and_refuses_json() {
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(
            tauri::http::HeaderName::from_static("x-grove-path"),
            tauri::http::HeaderValue::from_str(&super::encode_grove_path(
                "Pasted image 20261023201500.png",
            ))
            .unwrap(),
        );
        assert_eq!(
            super::path_from_headers(&headers).unwrap(),
            "Pasted image 20261023201500.png"
        );
        let raw = tauri::ipc::InvokeBody::Raw(vec![1, 2, 3]);
        assert_eq!(super::bytes_from_body(&raw).unwrap(), &[1, 2, 3]);
        let json =
            tauri::ipc::InvokeBody::Json(serde_json::json!({ "path": "a.png", "bytes": [1] }));
        let err = super::bytes_from_body(&json).unwrap_err();
        assert_eq!(err, "write_file_bytes expects a raw body, not JSON");
        assert_eq!(
            super::path_from_headers(&tauri::http::HeaderMap::new()).unwrap_err(),
            "missing x-grove-path"
        );
    }

    /// `#[tauri::command(async)]` runs the body inside `async_runtime::spawn`, which is
    /// off the thread that received the IPC (the GTK thread in the app).
    #[test]
    fn write_10mb_stays_off_the_calling_thread() {
        let src = include_str!("lib.rs");
        for name in ["write_file_bytes", "read_clipboard_image"] {
            let needle = format!("\nfn {name}(");
            let idx = src
                .find(&needle)
                .unwrap_or_else(|| panic!("missing {name}"));
            let before = &src[..idx];
            let start = before.rfind("\n#[").map(|i| i + 1).unwrap();
            let attr = before[start..].trim();
            assert!(
                attr.contains("tauri::command(async)"),
                "{name} must be an async command so it stays off the GTK thread: {attr}"
            );
        }

        let dir = crate::fsutil::tmp_dir("write-10mb");
        let root = dir.path.clone();
        let caller = std::thread::current().id();
        let (tx, rx) = std::sync::mpsc::channel();
        tauri::async_runtime::spawn(async move {
            let writer = std::thread::current().id();
            let started = std::time::Instant::now();
            let mut vault = crate::vault::Vault::open(root).expect("vault");
            let bytes = vec![b'a'; 10 * 1024 * 1024];
            vault.write_file_bytes("ten.bin", &bytes).expect("write");
            tx.send((writer, started.elapsed())).expect("send");
        });
        let (writer, elapsed) = rx
            .recv_timeout(std::time::Duration::from_secs(60))
            .expect("10 MB write did not finish");
        assert_ne!(writer, caller, "10 MB write ran on the calling thread");
        assert_eq!(
            std::fs::metadata(dir.path.join("ten.bin")).unwrap().len(),
            10 * 1024 * 1024
        );
        eprintln!("write_10mb_ms={:.1}", elapsed.as_secs_f64() * 1000.0);
    }
}
