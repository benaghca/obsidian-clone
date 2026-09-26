//! Version history: snapshots of text files as they're saved, kept outside the vault in
//! `<data dir>/history/<vault id>/<path in the vault>/<id>.snap`, where the id is the time
//! (ms) the version began. Saving starts a new version at most every five minutes; saves in
//! between update the newest one, so a long editing session leaves one version per five
//! minutes. Before a file's first recorded save, its text as it was is kept too. Versions
//! older than KEEP_DAYS go, except the newest one.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const KEEP_DAYS: u64 = 30;
/// How long one version gathers saves (CINDER_HISTORY_SESSION_MS overrides it, for tests).
fn session_ms() -> u64 {
    std::env::var("CINDER_HISTORY_SESSION_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(5 * 60 * 1000)
}
const MAX_BYTES: usize = 4 * 1024 * 1024;
const TEXT_EXT: &[&str] = &["md", "canvas", "base", "excalidraw", "css", "txt", "json"];

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn mtime_ms(p: &Path) -> Option<u64> {
    let t = fs::metadata(p).ok()?.modified().ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// Is `rel` a file whose versions are kept?
pub fn eligible(rel: &str) -> bool {
    let ext = rel.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    TEXT_EXT.contains(&ext.as_str()) && !rel.starts_with(".trash/") && !rel.starts_with(".obsidian/")
}

/// A stable folder name for a vault: a hash of its path, plus its name to help a person find it.
fn vault_id(vault: &Path) -> String {
    let s = vault.to_string_lossy();
    let key = if cfg!(windows) { s.to_lowercase() } else { s.to_string() };
    let mut h: u64 = 0xcbf29ce484222325;
    for b in key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    let name: String = vault.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
        .chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(40).collect();
    format!("{name}-{h:016x}")
}

pub fn root(vault: &Path) -> PathBuf {
    crate::config::data_dir().join("history").join(vault_id(vault))
}

/// The folder holding one file's versions. `rel` has already been checked by `api::resolve`.
fn dir_for(root: &Path, rel: &str) -> PathBuf {
    let mut d = root.to_path_buf();
    for part in rel.split('/').filter(|p| !p.is_empty() && *p != "." && *p != "..") {
        d.push(part);
    }
    d
}

/// A file's version ids, oldest first.
fn ids(dir: &Path) -> Vec<u64> {
    let mut v: Vec<u64> = fs::read_dir(dir)
        .map(|rd| rd.flatten().filter_map(|e| e.file_name().to_str()?.strip_suffix(".snap")?.parse().ok()).collect())
        .unwrap_or_default();
    v.sort_unstable();
    v
}

fn snap(dir: &Path, id: u64) -> PathBuf {
    dir.join(format!("{id}.snap"))
}

/// Record `new` as the text of `rel` (whose file on disk is `full`, still holding the old text).
pub fn record(root: &Path, rel: &str, full: &Path, new: &[u8]) {
    if !eligible(rel) || new.len() > MAX_BYTES {
        return;
    }
    let dir = dir_for(root, rel);
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let now = now_ms();
    let mut have = ids(&dir);
    let mut fresh = false;
    // The first time: keep the file as it was before this save.
    if have.is_empty() {
        if let (Ok(old), Some(t)) = (fs::read(full), mtime_ms(full)) {
            if old != new && old.len() <= MAX_BYTES && fs::write(snap(&dir, t.min(now.saturating_sub(1))), &old).is_ok() {
                have.push(t.min(now.saturating_sub(1)));
                fresh = true;
            }
        }
    }
    match have.last() {
        Some(&last) if fs::read(snap(&dir, last)).map(|b| b == new).unwrap_or(false) => {}
        Some(&last) if !fresh && now.saturating_sub(last) < session_ms() => {
            let _ = fs::write(snap(&dir, last), new);
        }
        _ => {
            let _ = fs::write(snap(&dir, now), new);
            have.push(now);
        }
    }
    prune(&dir, &have, now);
}

fn prune(dir: &Path, have: &[u64], now: u64) {
    let cutoff = now.saturating_sub(KEEP_DAYS * 24 * 3600 * 1000);
    let newest = have.iter().max().copied();
    for &id in have {
        if id < cutoff && Some(id) != newest {
            let _ = fs::remove_file(snap(dir, id));
        }
    }
}

/// A file's versions, newest first: (id, last saved, size in bytes).
pub fn list(root: &Path, rel: &str) -> Vec<(u64, u64, u64)> {
    let dir = dir_for(root, rel);
    let mut out: Vec<(u64, u64, u64)> = ids(&dir)
        .into_iter()
        .map(|id| {
            let p = snap(&dir, id);
            (id, mtime_ms(&p).unwrap_or(id).max(id), fs::metadata(&p).map(|m| m.len()).unwrap_or(0))
        })
        .collect();
    out.reverse();
    out
}

pub fn read(root: &Path, rel: &str, id: u64) -> Option<Vec<u8>> {
    fs::read(snap(&dir_for(root, rel), id)).ok()
}

/// Versions follow a file (or a folder of files) when it's renamed or moved.
pub fn rename(root: &Path, from: &str, to: &str) {
    let (a, b) = (dir_for(root, from), dir_for(root, to));
    if !a.exists() || a == b {
        return;
    }
    if let Some(parent) = b.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if b.exists() {
        // Something was already recorded under the new name: move the versions in beside it.
        merge(&a, &b);
    } else {
        let _ = fs::rename(&a, &b);
    }
}

fn merge(a: &Path, b: &Path) {
    let Ok(rd) = fs::read_dir(a) else { return };
    for e in rd.flatten() {
        let (src, dst) = (e.path(), b.join(e.file_name()));
        if src.is_dir() {
            let _ = fs::create_dir_all(&dst);
            merge(&src, &dst);
        } else if !dst.exists() {
            let _ = fs::rename(&src, &dst);
        }
    }
    let _ = fs::remove_dir_all(a);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cinder-hist-{name}-{}", now_ms()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn keeps_the_original_then_one_version_per_session() {
        let (vault, root) = (tmp("v"), tmp("h"));
        let f = vault.join("A.md");
        fs::write(&f, "original").unwrap();
        record(&root, "A.md", &f, b"first edit");
        fs::write(&f, "first edit").unwrap();
        let v = list(&root, "A.md");
        assert_eq!(v.len(), 2, "the original and the edit");
        assert_eq!(read(&root, "A.md", v[1].0).unwrap(), b"original");
        record(&root, "A.md", &f, b"second edit");
        let v = list(&root, "A.md");
        assert_eq!(v.len(), 2, "a save within five minutes updates the newest version");
        assert_eq!(read(&root, "A.md", v[0].0).unwrap(), b"second edit");
        record(&root, "A.md", &f, b"second edit");
        assert_eq!(list(&root, "A.md").len(), 2, "the same text again adds nothing");
    }

    #[test]
    fn follows_renames_and_skips_binary_files() {
        let (vault, root) = (tmp("v2"), tmp("h2"));
        let f = vault.join("A.md");
        fs::write(&f, "x").unwrap();
        record(&root, "Dir/A.md", &f, b"y");
        rename(&root, "Dir", "Other");
        assert_eq!(list(&root, "Other/A.md").len(), 2);
        assert!(list(&root, "Dir/A.md").is_empty());
        record(&root, "pic.png", &f, b"z");
        assert!(list(&root, "pic.png").is_empty());
        assert!(!eligible(".obsidian/app.json") && eligible("Notes/x.canvas"));
    }
}
