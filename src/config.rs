//! Small per-user settings file: last vault and window size.
//! Windows: %LOCALAPPDATA%\Folio\config.json   Linux: ~/.local/share/folio/config.json

use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

pub fn data_dir() -> PathBuf {
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from).map(|p| p.join("Folio"))
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/Folio"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
            .map(|p| p.join("folio"))
    };
    let dir = base.unwrap_or_else(|| std::env::temp_dir().join("folio"));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn load() -> Value {
    fs::read(path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({}))
}

pub fn save(v: &Value) {
    let p = path();
    let tmp = p.with_extension("json.tmp");
    if fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).is_ok() {
        let _ = fs::rename(tmp, p);
    }
}

pub fn remember_vault(vault: &Path) {
    let mut c = load();
    c["vault"] = json!(vault.display().to_string());
    save(&c);
}

pub fn last_vault() -> Option<PathBuf> {
    load().get("vault").and_then(|v| v.as_str()).map(PathBuf::from).filter(|p| p.is_dir())
}

/// Where a new user's notes go if they never picked a folder.
pub fn default_vault() -> PathBuf {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    match home {
        Some(h) if h.join("Documents").is_dir() => h.join("Documents").join("Folio"),
        Some(h) => h.join("Folio"),
        None => PathBuf::from("vault"),
    }
}
