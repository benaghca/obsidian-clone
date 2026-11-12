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
#[cfg(test)]
mod smoke;
mod fsutil;
/// Fix B (piece HZ, prototype): `GROVE_FRAME_PACING=compositor`.
#[cfg(target_os = "linux")]
mod frame_pacing;
mod index;
mod lockdown;
mod model;
mod queue;
mod search_scan;
mod vault;
/// Fix A2 (piece HZ): exported through `main.rs`. Public only for that.
#[cfg(target_os = "linux")]
#[doc(hidden)]
pub mod vblank;
mod watch;
mod write_dispatch;

use crate::index::NoteProperties;
use crate::model::{Backlink, FileEntry, LinkIndex, SearchHit, SearchNote, SearchLine, VaultInfo};
use crate::queue::{invoke_key, Reply, WriteQueue, WriteTicket};
use crate::watch::WatchMsg;
use std::collections::BTreeMap;
use std::future::Future;
use std::sync::{mpsc, Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub(crate) inner: Arc<RwLock<Inner>>,
    pub(crate) write_queue: WriteQueue,
    pub(crate) watch_tx: mpsc::Sender<WatchMsg>,
    /// One search generation per window, so a newer query stops the older scan.
    pub(crate) search_gen: search_scan::SearchSlots,
}

pub struct Inner {
    pub(crate) config_dir: std::path::PathBuf,
    pub(crate) vault: Option<vault::Vault>,
}

pub(crate) fn read<T>(rw: &RwLock<T>) -> RwLockReadGuard<'_, T> { rw.read().unwrap_or_else(|e| e.into_inner()) }
pub(crate) fn lock<T>(rw: &RwLock<T>) -> RwLockWriteGuard<'_, T> { rw.write().unwrap_or_else(|e| e.into_inner()) }

fn wrap_handler<R: tauri::Runtime>(handler: impl Fn(tauri::ipc::Invoke<R>) -> bool) -> impl Fn(tauri::ipc::Invoke<R>) -> bool {
    move |invoke| {
        let is_write = WriteQueue::is_write_command(invoke.message.command());
        let key = invoke_key(&invoke.message);
        let shared = Arc::clone(&invoke.message.webview_ref().state::<AppState>().write_queue.shared);
        if !is_write {
            return handler(invoke);
        }
        // The lease is moved into the spawned future, so dropping that task before
        // `take_ingress` skips the save. A live lease or ticket withholds exit.
        let Some(lease) = WriteQueue::arm_accepted(&shared, key) else {
            return handler(invoke);
        };
        let message = invoke.message;
        let resolver = invoke.resolver;
        let acl = invoke.acl;
        resolver.respond_async_serialized(async move { write_dispatch::run(lease, message, acl, key).await });
        true
    }
}

pub fn run() {
    #[cfg(target_os = "linux")]
    graphics_env();
    tauri::Builder::default()
        // Only the front end's own trusted-click handler may open links. The
        // plugin's injected page script would also send any <a target=_blank>
        // click (even a scripted one) to the system browser, so it is off.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .setup(|app| {
            let (tx, rx) = mpsc::channel();
            let config_dir = app.path().app_config_dir().unwrap_or_else(|_| fallback_config_dir());
            let _ = std::fs::create_dir_all(&config_dir);
            app.manage(AppState {
                inner: Arc::new(RwLock::new(Inner { config_dir, vault: None })),
                write_queue: WriteQueue::default(),
                watch_tx: tx.clone(),
                search_gen: search_scan::SearchSlots::default(),
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
        .invoke_handler(wrap_handler(tauri::generate_handler![
            open_vault, create_vault, last_vault, list_files, read_note, read_file_bytes,
            read_clipboard_image, write_clipboard_image, set_property, write_note, write_file_bytes,
            create_note, create_folder, rename_path, delete_path, search, search_notes,
            search_lines, search_match, link_index, backlinks, link_sources, frontmatter,
            properties, tags, read_config, write_config, read_foreign_config,
            open_note_window, allow_frame_origin,
        ]))
        .build(tauri::generate_context!())
        .expect("error while building grove")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { code, api, .. } => {
                let handle = app.clone();
                app.state::<AppState>().write_queue.on_exit_requested(code, || api.prevent_exit(), move |c| handle.exit(c));
            }
            tauri::RunEvent::Exit => app.state::<AppState>().write_queue.shutdown(),
            _ => {}
        });
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
        return std::path::PathBuf::from(home).join(".config").join("com.benaghca.grove");
    }
    std::env::temp_dir().join("grove")
}

/// Run a read-only `f` on the open vault, or fail when none is open.
fn read_vault<T>(state: &AppState, f: impl FnOnce(&vault::Vault) -> Result<T, String>) -> Result<T, String> {
    f(read(&state.inner).vault.as_ref().ok_or("no vault open")?)
}

/// Run a mutating `f` on the open vault on the dedicated writer in FIFO ingress order.
fn write_vault<T: Send + 'static>(state: &AppState, ticket: WriteTicket, f: impl FnOnce(&mut vault::Vault) -> Result<T, String> + Send + 'static) -> Reply<Result<T, String>> {
    let inner = Arc::clone(&state.inner);
    ticket.submit(move || f(lock(&inner).vault.as_mut().ok_or("no vault open")?))
}

/// Remember `raw`, watch it, and hand back its name. Shared by open and create.
fn install_vault(state: &AppState, ticket: WriteTicket, prepare: impl FnOnce() -> Result<std::path::PathBuf, String> + Send + 'static) -> Reply<Result<VaultInfo, String>> {
    let (inner, watch_tx) = (Arc::clone(&state.inner), state.watch_tx.clone());
    ticket.submit(move || {
        let opened = vault::Vault::open(prepare()?)?;
        let (info, root) = (VaultInfo::from_path(&opened.root), opened.root.clone());
        let config_dir = read(&inner).config_dir.clone();
        config::remember(&config_dir, &root)?;
        lock(&inner).vault = Some(opened);
        let _ = watch_tx.send(WatchMsg::Watch(root));
        Ok(info)
    })
}

fn emit_other_windows<R: tauri::Runtime>(window: &tauri::Window<R>, kind: model::ChangeKind, path: String) {
    let change = model::VaultChanged { kind, paths: vec![path] };
    let me = window.label().to_owned();
    let _ = window.emit_filter("vault-changed", change, |target| match target {
        tauri::EventTarget::WebviewWindow { label } | tauri::EventTarget::Window { label } => *label != me,
        _ => false,
    });
}

#[tauri::command(async)]
fn open_vault(ticket: WriteTicket, state: State<'_, AppState>, path: String) -> Reply<Result<VaultInfo, String>> {
    install_vault(&state, ticket, move || {
        let raw = fsutil::expand_user(path.trim());
        if !raw.is_dir() { return Err(format!("not a folder: {}", raw.display())); }
        Ok(raw)
    })
}

/// A new empty vault folder, then the same remember-and-watch path as `open_vault`.
#[tauri::command(async)]
fn create_vault(ticket: WriteTicket, state: State<'_, AppState>, path: String) -> Reply<Result<VaultInfo, String>> {
    install_vault(&state, ticket, move || fsutil::create_vault_dir(&path))
}

#[tauri::command(async)]
fn last_vault(state: State<'_, AppState>) -> Result<Option<VaultInfo>, String> {
    let inner = read(&state.inner);
    Ok(config::last_vault(&inner.config_dir).map(|path| VaultInfo::from_path(&path)))
}

#[tauri::command(async)]
fn list_files(state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    read_vault(&state, |v| Ok(v.list_files()))
}

#[tauri::command(async)]
fn read_note(state: State<'_, AppState>, path: String) -> Result<String, String> {
    read_vault(&state, |v| v.read_note(&path))
}

/// Sent as raw bytes (an ArrayBuffer in the page), not as a JSON array of numbers.
#[tauri::command(async)]
fn read_file_bytes(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    read_vault(&state, |v| v.read_file_bytes(&path)).map(tauri::ipc::Response::new)
}

/// Put a PNG (the raw body) on the system clipboard, off the GTK thread: a drawing's
/// "Copy as PNG". A missing `wl-copy` or `xclip` is an error. See `clipboard`.
#[tauri::command(async)]
fn write_clipboard_image(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => clipboard::write_clipboard_png(bytes),
        tauri::ipc::InvokeBody::Json(_) => Err("write_clipboard_image expects a raw body, not JSON".into()),
    }
}

/// The clipboard's image, off the GTK thread. `null` when there is no image.
/// A missing `wl-paste` or `xclip` is an error. See `clipboard`.
#[tauri::command(async)]
fn read_clipboard_image() -> Result<clipboard::ClipboardBody, String> {
    clipboard::command_body()
}

/// Header for the vault-relative path on a raw `write_file_bytes` body.
const WRITE_PATH_HEADER: &str = "x-grove-path";
/// `write_file_bytes` replaces a file already at the path only when this header is `1`.
const REPLACE_HEADER: &str = "x-grove-replace";

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
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => out.push(byte as char),
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
            if i + 2 >= bytes.len() { return Err("invalid x-grove-path".into()); }
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
    let value = headers.get(WRITE_PATH_HEADER).ok_or("missing x-grove-path")?.to_str().map_err(|_| "invalid x-grove-path")?;
    decode_grove_path(value)
}

/// Whether `x-grove-replace` is `1`. Anything else, or no header, keeps the file that is there.
fn replace_from_headers(headers: &tauri::http::HeaderMap) -> bool {
    headers.get(REPLACE_HEADER).is_some_and(|value| value.as_bytes() == b"1")
}

fn bytes_from_body(body: &tauri::ipc::InvokeBody) -> Result<&[u8], String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        tauri::ipc::InvokeBody::Json(_) => Err("write_file_bytes expects a raw body, not JSON".into()),
    }
}

#[tauri::command(async)]
fn write_note<R: tauri::Runtime>(ticket: WriteTicket, window: tauri::Window<R>, state: State<'_, AppState>, path: String, content: String) -> impl Future<Output = Result<(), String>> {
    let fut = write_vault(&state, ticket, move |v| v.write_note(&path, &content).map(|()| path));
    async move { emit_other_windows(&window, model::ChangeKind::Modify, fut.await?); Ok(()) }
}

/// Fresh-file property CAS, off the GTK thread; only real writes notify other windows.
#[tauri::command(async)]
fn set_property<R: tauri::Runtime>(ticket: WriteTicket, window: tauri::Window<R>, state: State<'_, AppState>, path: String, edit: edit::PropertyEdit, dry_run: Option<bool>) -> impl Future<Output = Result<edit::EditResult, String>> {
    let dry_run = dry_run.unwrap_or(false);
    let fut = write_vault(&state, ticket, move |v| v.set_property(&path, &edit, dry_run).map(|r| (r, path)));
    async move {
        let (result, path) = fut.await?;
        if !dry_run && result.done() { emit_other_windows(&window, model::ChangeKind::Modify, path); }
        Ok(result)
    }
}

fn enqueue_write_file_bytes(state: &AppState, ticket: WriteTicket, headers: &tauri::http::HeaderMap, body: &tauri::ipc::InvokeBody) -> Reply<Result<(FileEntry, bool), String>> {
    match path_from_headers(headers).and_then(|path| Ok((path, bytes_from_body(body)?.to_vec(), replace_from_headers(headers)))) {
        Ok((path, bytes, replace)) => write_vault(state, ticket, move |v| if replace { v.replace_file_bytes(&path, &bytes) } else { v.write_file_bytes(&path, &bytes).map(|entry| (entry, false)) }),
        Err(err) => Reply::ready(Err(err)),
    }
}

/// A new file's raw bytes (a pasted image or a dropped file), at most 20 MB.
/// The path is the `x-grove-path` header, not a JSON field. Runs off the GTK thread.
/// With `x-grove-replace: 1` a file already at the path is replaced (a drawing's PNG
/// export, after the page asked); without it that is an error.
/// Other windows get a `vault-changed` `create` (`modify` for a replaced file); the window
/// that saved does not (it refreshes itself).
#[tauri::command(async)]
fn write_file_bytes<R: tauri::Runtime>(ticket: WriteTicket, window: tauri::Window<R>, state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> impl Future<Output = Result<FileEntry, String>> {
    let fut = enqueue_write_file_bytes(&state, ticket, request.headers(), request.body());
    async move {
        let (entry, existed) = fut.await?;
        emit_other_windows(&window, if existed { model::ChangeKind::Modify } else { model::ChangeKind::Create }, entry.path.clone());
        Ok(entry)
    }
}

/// "Open in new window": the note (a percent-encoded vault path) in a window of its own.
#[tauri::command]
async fn open_note_window(app: AppHandle, note: String) -> Result<(), String> {
    lockdown::create_note_window(&app, &note)
}

/// Register one http(s) origin so an embedded frame may load it. The main frame may not.
#[tauri::command(async)]
fn allow_frame_origin(origins: State<'_, lockdown::FrameOrigins>, origin: String) -> Result<(), String> {
    origins.allow(&origin)
}

#[tauri::command(async)]
fn create_note(ticket: WriteTicket, state: State<'_, AppState>, path: String, content: String) -> Reply<Result<FileEntry, String>> {
    write_vault(&state, ticket, move |v| v.create_note(&path, &content))
}

#[tauri::command(async)]
fn create_folder(ticket: WriteTicket, state: State<'_, AppState>, path: String) -> Reply<Result<FileEntry, String>> {
    write_vault(&state, ticket, move |v| v.create_folder(&path))
}

#[tauri::command(async)]
fn rename_path(ticket: WriteTicket, state: State<'_, AppState>, from: String, to: String) -> Reply<Result<(), String>> {
    write_vault(&state, ticket, move |v| v.rename_path(&from, &to))
}

/// `permanent` (optional, default false) removes the file instead of moving it to `.trash/`.
#[tauri::command(async)]
fn delete_path(ticket: WriteTicket, state: State<'_, AppState>, path: String, permanent: Option<bool>) -> Reply<Result<(), String>> {
    write_vault(&state, ticket, move |v| v.delete_path(&path, permanent.unwrap_or(false)))
}

/// A settings file from the vault's `.grove/` folder (`None` if missing).
#[tauri::command(async)]
fn read_config(state: State<'_, AppState>, name: String) -> Result<Option<String>, String> {
    read_vault(&state, |v| v.read_config(&name))
}

/// Write a settings file (JSON) into the vault's `.grove/` folder, atomically.
#[tauri::command(async)]
fn write_config(ticket: WriteTicket, state: State<'_, AppState>, name: String, content: String) -> Reply<Result<(), String>> {
    write_vault(&state, ticket, move |v| v.write_config(&name, &content))
}

/// One allowlisted Cinder or Obsidian settings file (`None` if missing). Never writes.
#[tauri::command(async)]
fn read_foreign_config(state: State<'_, AppState>, source: String, name: String) -> Result<Option<String>, String> {
    read_vault(&state, |v| v.read_foreign_config(&source, &name))
}

#[tauri::command(async)]
fn search(state: State<'_, AppState>, query: String, limit: u32) -> Result<Vec<SearchHit>, String> {
    read_vault(&state, |v| Ok(v.index.search(&query, limit)))
}

#[tauri::command(async)]
fn link_index(state: State<'_, AppState>) -> Result<LinkIndex, String> {
    read_vault(&state, |v| Ok(v.index.link_index()))
}

/// Linked mentions for the requested target paths only; empty targets are omitted.
#[tauri::command(async)]
fn backlinks(state: State<'_, AppState>, paths: Vec<String>) -> Result<BTreeMap<String, Vec<Backlink>>, String> {
    read_vault(&state, |v| Ok(v.index.backlinks(&paths)))
}

/// Notes that might link to `paths`, for a rename. Fetched before `rename_path`.
#[tauri::command(async)]
fn link_sources(state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<String>, String> {
    read_vault(&state, |v| Ok(v.index.link_sources(&paths)))
}

/// Each note's frontmatter block (only `paths`' when given), for the properties index.
#[tauri::command(async)]
fn frontmatter(state: State<'_, AppState>, paths: Option<Vec<String>>) -> Result<BTreeMap<String, String>, String> {
    read_vault(&state, |v| Ok(v.index.frontmatter(paths.as_deref())))
}

/// Each note's tags (only `paths`' when given), for the Tags view, `tag:` search, the graph and
/// Bases. Notes without tags are left out.
#[tauri::command(async)]
fn tags(state: State<'_, AppState>, paths: Option<Vec<String>>) -> Result<BTreeMap<String, Vec<String>>, String> {
    read_vault(&state, |v| Ok(v.index.tags(paths.as_deref())))
}

/// Saved properties parsed once while indexing; source-only/no-frontmatter notes are omitted.
#[tauri::command(async)]
fn properties(state: State<'_, AppState>, paths: Option<Vec<String>>) -> Result<BTreeMap<String, NoteProperties>, String> {
    read_vault(&state, |v| Ok(v.index.properties(paths.as_deref())))
}

/// Matching notes and exact occurrence counts, in vault path order.
/// `request` is the page's order for this window. A newer id stops an older scan
/// at the next note. An older id is `cancelled` and does not move that window's id.
#[tauri::command(async)]
fn search_notes<R: tauri::Runtime>(window: tauri::Window<R>, state: State<'_, AppState>, query: String, match_case: bool, request: u64) -> Result<Vec<SearchNote>, String> {
    search_scan::run(&state, window.label(), request, &query, match_case)
}

/// A separately evaluated page of shown lines; paths no longer matching are omitted.
#[tauri::command(async)]
fn search_lines(state: State<'_, AppState>, query: String, match_case: bool, paths: Vec<String>, limit: u32) -> Result<BTreeMap<String, Vec<SearchLine>>, String> {
    read_vault(&state, |v| Ok(v.index.search_lines(&query, match_case, &paths, limit)))
}

/// Graph filter/colour-group matches, including attachments but never folders.
#[tauri::command(async)]
fn search_match(state: State<'_, AppState>, queries: Vec<String>) -> Result<Vec<Vec<String>>, String> {
    read_vault(&state, |v| Ok(v.index.search_match(&queries)))
}

/// Registers the commands the headless smoke invokes. The command macros exist
/// only in this module, so the handler cannot be built from `smoke`.
#[cfg(test)]
fn smoke_commands(
    builder: tauri::Builder<tauri::test::MockRuntime>,
) -> tauri::Builder<tauri::test::MockRuntime> {
    builder.invoke_handler(wrap_handler(tauri::generate_handler![open_vault, write_note, rename_path]))
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
        let names: Vec<&str> = handler.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
        assert!(!names.is_empty());

        for name in names {
            let quoted = format!("\"{name}\"");
            assert!(build.contains(&quoted), "command `{name}` in generate_handler! is missing from build.rs");
            let perm = format!("\"allow-{}\"", name.replace('_', "-"));
            assert!(cap.contains(&perm), "command `{name}` in generate_handler! is missing {perm} in capabilities/default.json");
        }
    }

    #[test]
    fn presentation_may_fullscreen_the_window() {
        let cap = include_str!("../capabilities/default.json");
        assert!(cap.contains("\"core:window:allow-set-fullscreen\""), "presentation mode needs core:window:allow-set-fullscreen");
    }

    #[test]
    fn grove_path_header_round_trips() {
        for path in ["pics/shot.png", "Pasted image 20261023201500.png", "café.png", "100%.png", "a/b"] {
            let encoded = super::encode_grove_path(path);
            assert!(encoded.is_ascii() && !encoded.contains(' '), "{path} -> {encoded}");
            assert_eq!(super::decode_grove_path(&encoded).unwrap(), path);
        }
        assert_eq!(super::encode_grove_path("pics/shot.png"), "pics/shot.png");
        assert_eq!(super::encode_grove_path("Pasted image 20261023201500.png"), "Pasted%20image%2020261023201500.png");
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
            tauri::http::HeaderValue::from_str(&super::encode_grove_path("Pasted image 20261023201500.png")).unwrap(),
        );
        assert_eq!(super::path_from_headers(&headers).unwrap(), "Pasted image 20261023201500.png");
        let raw = tauri::ipc::InvokeBody::Raw(vec![1, 2, 3]);
        assert_eq!(super::bytes_from_body(&raw).unwrap(), &[1, 2, 3]);
        let json = tauri::ipc::InvokeBody::Json(serde_json::json!({ "path": "a.png", "bytes": [1] }));
        let err = super::bytes_from_body(&json).unwrap_err();
        assert_eq!(err, "write_file_bytes expects a raw body, not JSON");
        assert_eq!(super::path_from_headers(&tauri::http::HeaderMap::new()).unwrap_err(), "missing x-grove-path");
    }

    /// `#[tauri::command(async)]` runs the body inside `async_runtime::spawn`, which is
    /// off the thread that received the IPC (the GTK thread in the app).
    #[test]
    fn write_10mb_stays_off_the_calling_thread() {
        let src = include_str!("lib.rs");
        for name in [
            "open_vault", "create_vault", "write_note", "set_property", "write_file_bytes",
            "create_note", "create_folder", "rename_path", "delete_path", "write_config",
            "read_clipboard_image", "write_clipboard_image",
        ] {
            let plain = format!("\nfn {name}(");
            let generic = format!("\nfn {name}<");
            let idx = src.find(&plain).or_else(|| src.find(&generic)).unwrap_or_else(|| panic!("missing {name}"));
            let before = &src[..idx];
            let start = before.rfind("\n#[").map(|i| i + 1).unwrap();
            let attr = before[start..].trim();
            assert!(attr.contains("tauri::command(async)"), "{name} must be an async command so it stays off the GTK thread: {attr}");
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
        let (writer, elapsed) = rx.recv_timeout(std::time::Duration::from_secs(60)).expect("10 MB write did not finish");
        assert_ne!(writer, caller, "10 MB write ran on the calling thread");
        assert_eq!(std::fs::metadata(dir.path.join("ten.bin")).unwrap().len(), 10 * 1024 * 1024);
        eprintln!("write_10mb_ms={:.1}", elapsed.as_secs_f64() * 1000.0);
    }

    pub(crate) fn test_state(root: &std::path::Path) -> super::AppState {
        let (watch_tx, _rx) = std::sync::mpsc::channel();
        let inner = std::sync::Arc::new(std::sync::RwLock::new(super::Inner { config_dir: root.join(".cfg"), vault: None }));
        let state = super::AppState { inner, write_queue: super::WriteQueue::default(), watch_tx, search_gen: super::search_scan::SearchSlots::default() };
        let r = root.to_path_buf();
        tauri::async_runtime::block_on(super::install_vault(&state, state.write_queue.take_ingress(0), move || Ok(r))).unwrap();
        state
    }
    pub(crate) fn sync_write<T: Send + 'static>(state: &super::AppState, f: impl FnOnce(&mut crate::vault::Vault) -> Result<T, String> + Send + 'static) -> Result<T, String> {
        tauri::async_runtime::block_on(super::write_vault(state, state.write_queue.take_ingress(0), f))
    }

    #[test]
    fn reads_overlap_while_writes_stay_exclusive() {
        use std::{sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc}, time::Duration};
        let dir = crate::fsutil::tmp_dir("rwlock-overlap");
        let state = &test_state(&dir.path);
        sync_write(state, |v| v.create_note("Note.md", "initial")).unwrap();
        let ((r1_tx, r1_rx), (r2_tx, r2_rx), (rel_tx, rel_rx)) = (std::sync::mpsc::channel(), std::sync::mpsc::channel(), std::sync::mpsc::channel());
        let (write_entered, active_writers) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicUsize::new(0)));
        std::thread::scope(|s| {
            let r1 = s.spawn(move || super::read_vault(state, |v| {
                r1_tx.send(()).unwrap();
                r2_rx.recv_timeout(Duration::from_millis(200)).expect("second read was blocked by the first read");
                rel_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                v.read_note("Note.md")
            }));
            r1_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            let r2 = s.spawn(move || super::read_vault(state, |v| { r2_tx.send(()).unwrap(); assert_eq!(v.index.search("initial", 10).len(), 1); v.read_note("Note.md") }));
            assert_eq!(r2.join().unwrap().unwrap(), "initial");
            let we = Arc::clone(&write_entered);
            let w = s.spawn(move || sync_write(state, move |v| { we.store(true, Ordering::SeqCst); v.write_note("Note.md", "updated") }));
            std::thread::sleep(Duration::from_millis(20));
            assert!(!write_entered.load(Ordering::SeqCst));
            rel_tx.send(()).unwrap();
            assert_eq!(r1.join().unwrap().unwrap(), "initial");
            w.join().unwrap().unwrap();
            for i in 0..4 {
                let aw = Arc::clone(&active_writers);
                s.spawn(move || sync_write(state, move |v| { assert_eq!(aw.fetch_add(1, Ordering::SeqCst), 0); let res = v.write_note("Note.md", &format!("v{i}")); assert_eq!(aw.fetch_sub(1, Ordering::SeqCst), 1); res }).unwrap());
            }
        });
    }

    #[test]
    fn queued_writes_and_renames_stay_in_submission_order() {
        use std::{sync::Arc, time::Duration};
        let dir = crate::fsutil::tmp_dir("write-order");
        let (state, order, mut joins) = (Arc::new(test_state(&dir.path)), Arc::new(std::sync::Mutex::new(Vec::new())), Vec::new());
        sync_write(&state, |v| v.create_note("Note.md", "zero")).unwrap();
        for (key, delay_ms, label, op) in [
            (1usize, 40u64, "write-1", Box::new(|v: &mut crate::vault::Vault| v.write_note("Note.md", "first")) as Box<dyn FnOnce(&mut crate::vault::Vault) -> Result<(), String> + Send>),
            (2, 20, "write-2", Box::new(|v| v.write_note("Note.md", "second"))),
            (3, 0, "rename", Box::new(|v| v.rename_path("Note.md", "Sub/Moved.md"))),
            (4, 0, "write-moved", Box::new(|v| v.write_note("Sub/Moved.md", "final"))),
        ] {
            state.write_queue.reserve_ingress(key);
            let (st, ord) = (Arc::clone(&state), Arc::clone(&order));
            joins.push(tauri::async_runtime::spawn(async move {
                if delay_ms > 0 { std::thread::sleep(Duration::from_millis(delay_ms)); }
                super::write_vault(&st, st.write_queue.take_ingress(key), move |v| { ord.lock().unwrap().push(label); op(v) }).await
            }));
        }
        for j in joins { tauri::async_runtime::block_on(j).unwrap().unwrap(); }
        assert_eq!(*order.lock().unwrap(), vec!["write-1", "write-2", "rename", "write-moved"]);
        assert!(!dir.path.join("Note.md").exists());
        assert_eq!(super::read_vault(&state, |v| v.read_note("Sub/Moved.md")).unwrap(), "final");
    }

    #[test]
    fn queued_writes_do_not_starve_async_reads_and_ipc() {
        use std::{sync::{mpsc, Arc}, time::Duration};
        let dir = crate::fsutil::tmp_dir("async-responsive");
        let state = Arc::new(test_state(&dir.path));
        sync_write(&state, |v| v.create_note("Note.md", "hello")).unwrap();
        let ((started_tx, started_rx), (release_tx, release_rx)) = (mpsc::channel(), mpsc::channel());
        state.write_queue.reserve_ingress(100);
        let (st0, root) = (Arc::clone(&state), dir.path.clone());
        let slow = tauri::async_runtime::spawn(async move {
            super::install_vault(&st0, st0.write_queue.take_ingress(100), move || { started_tx.send(()).unwrap(); release_rx.recv_timeout(Duration::from_secs(2)).unwrap(); Ok(root) }).await
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8) * 2;
        let mut writes = Vec::new();
        for i in 0..workers {
            let (key, st) = (200 + i, Arc::clone(&state));
            state.write_queue.reserve_ingress(key);
            writes.push(tauri::async_runtime::spawn(async move { super::write_vault(&st, st.write_queue.take_ingress(key), move |v| v.write_note("Note.md", &format!("w{i}"))).await }));
        }
        std::thread::sleep(Duration::from_millis(30));
        let ((read_tx, read_rx), (ipc_tx, ipc_rx), st_read) = (mpsc::channel(), mpsc::channel(), Arc::clone(&state));
        tauri::async_runtime::spawn(async move { read_tx.send(super::read_vault(&st_read, |v| v.read_note("Note.md")).unwrap()).unwrap(); });
        tauri::async_runtime::spawn(async move { ipc_tx.send(crate::lockdown::FrameOrigins::new().allow("https://example.com")).unwrap(); });
        assert_eq!(read_rx.recv_timeout(Duration::from_millis(300)).expect("queued writes starved async read"), "hello");
        assert!(ipc_rx.recv_timeout(Duration::from_millis(300)).expect("queued writes starved unrelated async IPC").is_ok());
        release_tx.send(()).unwrap();
        tauri::async_runtime::block_on(slow).unwrap().unwrap();
        for w in writes { tauri::async_runtime::block_on(w).unwrap().unwrap(); }
        assert_eq!(super::read_vault(&state, |v| v.read_note("Note.md")).unwrap(), format!("w{}", workers - 1));
    }

    mod queue_exit;

}
