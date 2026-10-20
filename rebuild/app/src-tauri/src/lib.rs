//! Tauri commands for the notes vault.
//!
//! The front end calls these with `invoke`. Paths are vault-relative and use `/`.
//! `write_note` does not emit `vault-changed` (the save is the front end's own write, ignored
//! for 500ms). `create_note`, `rename_path`, and `delete_path` update the index before they
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

mod config;
mod fsutil;
mod index;
mod lockdown;
mod model;
mod vault;
mod watch;

use crate::model::{FileEntry, LinkIndex, SearchHit, VaultInfo};
use crate::watch::WatchMsg;
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Manager, State};

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
        .plugin(tauri_plugin_opener::init())
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
            lockdown::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            last_vault,
            list_files,
            read_note,
            write_note,
            create_note,
            rename_path,
            delete_path,
            search,
            link_index,
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

fn vault_mut(state: &AppState) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
    let guard = lock(&state.inner);
    if guard.vault.is_none() {
        return Err("no vault open".into());
    }
    Ok(guard)
}

#[tauri::command]
fn open_vault(state: State<'_, AppState>, path: String) -> Result<VaultInfo, String> {
    let raw = fsutil::expand_user(path.trim());
    if !raw.is_dir() {
        return Err(format!("not a folder: {}", raw.display()));
    }
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
fn last_vault(state: State<'_, AppState>) -> Result<Option<VaultInfo>, String> {
    let inner = lock(&state.inner);
    Ok(config::last_vault(&inner.config_dir).map(|path| VaultInfo::from_path(&path)))
}

#[tauri::command]
fn list_files(state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let inner = vault_mut(&state)?;
    Ok(inner.vault.as_ref().unwrap().list_files())
}

#[tauri::command]
fn read_note(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let inner = vault_mut(&state)?;
    inner.vault.as_ref().unwrap().read_note(&path)
}

#[tauri::command]
fn write_note(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    let mut inner = vault_mut(&state)?;
    inner.vault.as_mut().unwrap().write_note(&path, &content)
}

#[tauri::command]
fn create_note(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<FileEntry, String> {
    let mut inner = vault_mut(&state)?;
    inner.vault.as_mut().unwrap().create_note(&path, &content)
}

#[tauri::command]
fn rename_path(state: State<'_, AppState>, from: String, to: String) -> Result<(), String> {
    let mut inner = vault_mut(&state)?;
    inner.vault.as_mut().unwrap().rename_path(&from, &to)
}

#[tauri::command]
fn delete_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let mut inner = vault_mut(&state)?;
    inner.vault.as_mut().unwrap().delete_path(&path)
}

#[tauri::command]
fn search(state: State<'_, AppState>, query: String, limit: u32) -> Result<Vec<SearchHit>, String> {
    let inner = vault_mut(&state)?;
    Ok(inner.vault.as_ref().unwrap().search(&query, limit))
}

#[tauri::command]
fn link_index(state: State<'_, AppState>) -> Result<LinkIndex, String> {
    let inner = vault_mut(&state)?;
    Ok(inner.vault.as_ref().unwrap().link_index())
}
