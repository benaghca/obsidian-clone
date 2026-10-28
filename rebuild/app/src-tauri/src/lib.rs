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

mod config;
mod fsutil;
mod index;
mod lockdown;
mod model;
mod vault;
mod watch;

use crate::model::{FileEntry, LinkIndex, SearchHit, VaultInfo};
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
    // WebKitGTK's DMA-BUF renderer crashes on some Wayland compositors (Hyprland: "Error 71 (Protocol error)").
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
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
            write_note,
            write_file_bytes,
            create_note,
            create_folder,
            rename_path,
            delete_path,
            search,
            link_index,
            frontmatter,
            read_config,
            write_config,
            open_note_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running grove");
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

/// A new file's bytes (a pasted image or a dropped file). JSON array of numbers, at most 20 MB.
/// Other windows get a `vault-changed` `create`; the window that saved does not (it refreshes itself).
#[tauri::command]
fn write_file_bytes(
    window: tauri::Window,
    state: State<'_, AppState>,
    path: String,
    bytes: Vec<u8>,
) -> Result<FileEntry, String> {
    let entry = with_vault(&state, |v| v.write_file_bytes(&path, &bytes))?;
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

#[tauri::command(async)]
fn search(state: State<'_, AppState>, query: String, limit: u32) -> Result<Vec<SearchHit>, String> {
    with_vault(&state, |v| Ok(v.index.search(&query, limit)))
}

#[tauri::command(async)]
fn link_index(state: State<'_, AppState>) -> Result<LinkIndex, String> {
    with_vault(&state, |v| Ok(v.index.link_index()))
}

/// Each note's frontmatter block (only `paths`' when given), for the properties index.
#[tauri::command(async)]
fn frontmatter(
    state: State<'_, AppState>,
    paths: Option<Vec<String>>,
) -> Result<BTreeMap<String, String>, String> {
    with_vault(&state, |v| Ok(v.index.frontmatter(paths.as_deref())))
}
