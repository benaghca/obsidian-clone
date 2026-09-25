//! Small per-user settings file: last vault and window size.
//! Windows: %LOCALAPPDATA%\Cinder\config.json   Linux: ~/.local/share/cinder/config.json
//! (moved over from the Folio folder of the same name, the app's old name, on first run)

use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

pub fn data_dir() -> PathBuf {
    // (name, old name): the app was called Folio before, and its folder moves over once.
    let (parent, name, old) = if cfg!(windows) {
        (std::env::var_os("LOCALAPPDATA").map(PathBuf::from), "Cinder", "Folio")
    } else if cfg!(target_os = "macos") {
        (std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support")), "Cinder", "Folio")
    } else {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
        (base, "cinder", "folio")
    };
    let dir = match parent {
        Some(p) => {
            let (dir, old) = (p.join(name), p.join(old));
            if !dir.exists() && old.is_dir() {
                let _ = fs::rename(&old, &dir); // settings, window size and web view data
            }
            dir
        }
        None => std::env::temp_dir().join("cinder"),
    };
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

/// The vault in use now, first in the recent list (at most 16, newest first).
pub fn remember_vault(vault: &Path) {
    let mut c = load();
    let p = vault.display().to_string();
    let mut recent: Vec<String> = recent_list(&c).into_iter().filter(|x| x != &p).collect();
    recent.insert(0, p.clone());
    recent.truncate(16);
    c["vault"] = json!(p);
    c["vaults"] = json!(recent);
    save(&c);
}

fn recent_list(c: &Value) -> Vec<String> {
    let mut v: Vec<String> = c["vaults"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    if let Some(last) = c["vault"].as_str()
        && !v.iter().any(|x| x == last)
    {
        v.insert(0, last.to_string()); // (configs from before the list existed)
    }
    v
}

pub fn recent_vaults() -> Vec<String> {
    recent_list(&load())
}

pub fn forget_vault(path: &str) {
    let mut c = load();
    let recent: Vec<String> = recent_list(&c).into_iter().filter(|x| x != path).collect();
    c["vaults"] = json!(recent);
    save(&c);
}

pub fn last_vault() -> Option<PathBuf> {
    load().get("vault").and_then(|v| v.as_str()).map(PathBuf::from).filter(|p| p.is_dir())
}

/// Where a new user's notes go if they never picked a folder.
pub fn default_vault() -> PathBuf {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    match home {
        Some(h) if h.join("Documents").is_dir() => h.join("Documents").join("Cinder"),
        Some(h) => h.join("Cinder"),
        None => PathBuf::from("vault"),
    }
}
