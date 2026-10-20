//! One open vault: filesystem operations plus the in-memory index.
//!
//! `write_note` records the path for [`OWN_WRITE`] so the watcher can drop the echo of that
//! save. The index is updated before the call returns, so the next `list_files`, `search`, or
//! `link_index` already sees the change.

use crate::fsutil::{self, atomic_write};
use crate::index::Index;
use crate::model::{ChangeKind, FileEntry, LinkIndex, SearchHit, VaultChanged};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

/// How long a `write_note` suppresses watcher events for that path.
pub const OWN_WRITE: Duration = Duration::from_millis(500);

pub struct Vault {
    pub root: PathBuf,
    pub index: Index,
    own_writes: HashMap<String, Instant>,
}

impl Vault {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        if !root.is_dir() {
            return Err(format!("not a folder: {}", root.display()));
        }
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let index = Index::scan(&root)?;
        Ok(Self {
            root,
            index,
            own_writes: HashMap::new(),
        })
    }

    pub fn list_files(&self) -> Vec<FileEntry> {
        self.index.list()
    }

    pub fn read_note(&self, path: &str) -> Result<String, String> {
        let (_rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if !full.is_file() {
            return Err(format!("no such file: {path}"));
        }
        let bytes = fs::read(&full).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes);
        Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
    }

    pub fn write_note(&mut self, path: &str, content: &str) -> Result<(), String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if full.is_dir() {
            return Err(format!("not a file: {path}"));
        }
        self.mark_own(&rel);
        if let Err(e) = atomic_write(&full, content.as_bytes()) {
            self.own_writes.remove(&rel);
            return Err(e.to_string());
        }
        let md = fs::metadata(&full).map_err(|e| e.to_string())?;
        self.index
            .upsert_note(&self.root, &rel, content, fsutil::mtime_ms(&md), md.len());
        Ok(())
    }

    pub fn create_note(&mut self, path: &str, content: &str) -> Result<FileEntry, String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if full.exists() {
            return Err(format!("already exists: {rel}"));
        }
        atomic_write(&full, content.as_bytes()).map_err(|e| e.to_string())?;
        let md = fs::metadata(&full).map_err(|e| e.to_string())?;
        let mtime_ms = fsutil::mtime_ms(&md);
        let size = md.len();
        self.index
            .upsert_note(&self.root, &rel, content, mtime_ms, size);
        Ok(self.entry_for(&rel))
    }

    /// Create an empty folder (the file explorer's "New folder"). Fails if anything is already there.
    pub fn create_folder(&mut self, path: &str) -> Result<FileEntry, String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if full.exists() {
            return Err(format!("already exists: {rel}"));
        }
        fs::create_dir_all(&full).map_err(|e| e.to_string())?;
        self.index.refresh_path(&self.root, &rel);
        Ok(self.entry_for(&rel))
    }

    pub fn rename_path(&mut self, from: &str, to: &str) -> Result<(), String> {
        let (from_rel, from_full) = fsutil::resolve_in_vault(&self.root, from)?;
        let (to_rel, to_full) = fsutil::resolve_in_vault(&self.root, to)?;
        if !from_full.exists() {
            return Err(format!("no such file: {from}"));
        }
        if to_rel == from_rel {
            return Ok(());
        }
        if to_rel.starts_with(&format!("{from_rel}/")) {
            return Err("can't move a folder into itself".into());
        }
        if to_full.exists() {
            return Err(format!("already exists: {to_rel}"));
        }
        if let Some(parent) = to_full.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&from_full, &to_full).map_err(|e| e.to_string())?;
        self.index.relocate(&from_rel, &to_rel);
        self.index.refresh_path(&self.root, &to_rel);
        Ok(())
    }

    /// Move a file or folder into `.trash/` inside the vault. Never deletes bytes.
    pub fn delete_path(&mut self, path: &str) -> Result<(), String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if !full.exists() {
            return Err(format!("no such file: {path}"));
        }
        let dest = trash_dest(&self.root, &rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&full, &dest).map_err(|e| e.to_string())?;
        self.index.remove_tree(&rel);
        Ok(())
    }

    pub fn search(&self, query: &str, limit: u32) -> Vec<SearchHit> {
        self.index.search(query, limit)
    }

    pub fn link_index(&self) -> LinkIndex {
        self.index.link_index()
    }

    pub fn is_own_write(&self, rel: &str, now: Instant) -> bool {
        self.own_writes.get(rel).is_some_and(|until| now < *until)
    }

    pub fn gc_own_writes(&mut self, now: Instant) {
        self.own_writes.retain(|_, until| *until > now);
    }

    /// Turn a create of a path we already know about into a modify (an editor's atomic save).
    pub fn normalize(&self, changes: Vec<VaultChanged>) -> Vec<VaultChanged> {
        let mut out = Vec::new();
        for change in changes {
            if change.kind != ChangeKind::Create {
                out.push(change);
                continue;
            }
            let mut created = Vec::new();
            let mut modified = Vec::new();
            for path in change.paths {
                if self.index.contains(&path) {
                    modified.push(path);
                } else {
                    created.push(path);
                }
            }
            if !created.is_empty() {
                out.push(VaultChanged {
                    kind: ChangeKind::Create,
                    paths: created,
                });
            }
            if !modified.is_empty() {
                out.push(VaultChanged {
                    kind: ChangeKind::Modify,
                    paths: modified,
                });
            }
        }
        out
    }

    pub fn apply(&mut self, changes: &[VaultChanged]) {
        for change in changes {
            match change.kind {
                ChangeKind::Remove => {
                    for path in &change.paths {
                        self.index.remove_tree(path);
                    }
                }
                ChangeKind::Rename => {
                    if change.paths.len() == 2 {
                        self.index.relocate(&change.paths[0], &change.paths[1]);
                        self.index.refresh_path(&self.root, &change.paths[1]);
                    }
                }
                ChangeKind::Create | ChangeKind::Modify => {
                    for path in &change.paths {
                        self.index.refresh_path(&self.root, path);
                    }
                }
            }
        }
    }

    /// Diff a fresh scan. Used when the watcher asks for a rescan.
    pub fn rescan(&mut self) -> Vec<VaultChanged> {
        let Ok(fresh) = Index::scan(&self.root) else {
            return Vec::new();
        };
        let old: Vec<String> = self.index.paths().cloned().collect();
        let new: Vec<String> = fresh.paths().cloned().collect();
        let mut removed = Vec::new();
        let mut created = Vec::new();
        let mut modified = Vec::new();
        for path in &old {
            if !fresh.contains(path) {
                removed.push(path.clone());
            } else if !fresh.is_dir(path) && self.index.stamp(path) != fresh.stamp(path) {
                modified.push(path.clone());
            }
        }
        for path in &new {
            if !self.index.contains(path) {
                created.push(path.clone());
            }
        }
        self.index = fresh;
        let mut out = Vec::new();
        if !removed.is_empty() {
            out.push(VaultChanged {
                kind: ChangeKind::Remove,
                paths: removed,
            });
        }
        if !created.is_empty() {
            out.push(VaultChanged {
                kind: ChangeKind::Create,
                paths: created,
            });
        }
        if !modified.is_empty() {
            out.push(VaultChanged {
                kind: ChangeKind::Modify,
                paths: modified,
            });
        }
        out
    }

    fn mark_own(&mut self, rel: &str) {
        let now = Instant::now();
        self.gc_own_writes(now);
        self.own_writes.insert(rel.to_string(), now + OWN_WRITE);
    }

    fn entry_for(&self, rel: &str) -> FileEntry {
        self.index
            .list()
            .into_iter()
            .find(|e| e.path == rel)
            .unwrap_or(FileEntry {
                path: rel.to_string(),
                name: rel.to_string(),
                is_dir: false,
                mtime_ms: 0,
                size: 0,
            })
    }
}

fn trash_dest(root: &Path, rel: &str) -> PathBuf {
    let dest = root.join(".trash").join(rel);
    if !dest.exists() {
        return dest;
    }
    let name = dest
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let parent = dest.parent().unwrap_or(root).to_path_buf();
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    for n in 0..1000 {
        let candidate = parent.join(format!("{stamp}-{n} {name}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stamp} {name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fsutil::tmp_dir;
    use std::fs;

    #[test]
    fn write_create_rename_and_trash_round_trip() {
        let dir = tmp_dir("vault");
        fs::write(dir.path.join("Old.md"), "see [[Target]]\n").unwrap();
        fs::create_dir(dir.path.join("sub")).unwrap();
        fs::write(dir.path.join("sub").join("Target.md"), "hello\n").unwrap();

        let mut vault = Vault::open(dir.path.clone()).unwrap();
        assert_eq!(
            vault.index.resolve("Old.md", "Target").as_deref(),
            Some("sub/Target.md")
        );

        vault
            .write_note("Old.md", "see [[Target]]\nrevised\n")
            .unwrap();
        assert_eq!(
            vault.read_note("Old.md").unwrap(),
            "see [[Target]]\nrevised\n"
        );
        assert!(vault.is_own_write("Old.md", Instant::now()));
        let names: Vec<_> = fs::read_dir(&dir.path)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.contains(fsutil::TEMP_MARK)));

        let created = vault.create_note("sub/New.md", "[[old]]\n").unwrap();
        assert_eq!(created.path, "sub/New.md");
        assert_eq!(created.name, "New");
        assert!(!created.is_dir);
        assert!(vault.create_note("sub/New.md", "x").is_err());
        assert_eq!(
            vault.index.resolve("sub/New.md", "old").as_deref(),
            Some("Old.md")
        );

        vault.rename_path("sub/Target.md", "Renamed.md").unwrap();
        assert!(!dir.path.join("sub").join("Target.md").exists());
        assert_eq!(
            fs::read_to_string(dir.path.join("Renamed.md")).unwrap(),
            "hello\n"
        );
        assert_eq!(
            vault.index.resolve("Old.md", "Renamed").as_deref(),
            Some("Renamed.md")
        );
        assert!(vault.index.resolve("Old.md", "Target").is_none());
        assert!(vault
            .list_files()
            .iter()
            .any(|e| e.path == "Renamed.md" && e.name == "Renamed"));
        vault.rename_path("Renamed.md", "fresh/Moved.md").unwrap();
        assert!(dir.path.join("fresh").join("Moved.md").is_file());
        assert!(vault
            .list_files()
            .iter()
            .any(|e| e.path == "fresh" && e.is_dir && e.size == 0));
        assert!(vault
            .list_files()
            .iter()
            .any(|e| e.path == "fresh/Moved.md" && e.name == "Moved"));
        assert!(vault.rename_path("nope.md", "x.md").is_err());
        assert!(vault.rename_path("../outside.md", "x.md").is_err());

        fs::create_dir(dir.path.join("box")).unwrap();
        fs::write(dir.path.join("box").join("a.md"), "in\n").unwrap();
        vault.index.refresh_path(&vault.root, "box");
        vault.rename_path("box", "carton").unwrap();
        assert!(dir.path.join("carton").join("a.md").is_file());
        assert!(vault
            .list_files()
            .iter()
            .any(|e| e.path == "carton" && e.is_dir));
        assert!(vault.list_files().iter().any(|e| e.path == "carton/a.md"));
        assert!(vault.rename_path("carton", "carton/inner").is_err());

        vault.delete_path("fresh/Moved.md").unwrap();
        assert!(!dir.path.join("fresh").join("Moved.md").exists());
        assert!(dir
            .path
            .join(".trash")
            .join("fresh")
            .join("Moved.md")
            .is_file());
        assert!(!vault
            .list_files()
            .iter()
            .any(|e| e.path == "fresh/Moved.md"));
        assert!(vault.index.resolve("Old.md", "Renamed").is_none());
        assert!(vault.index.resolve("Old.md", "Moved").is_none());
    }

    #[test]
    fn create_folder_makes_an_empty_listed_folder_once() {
        let dir = tmp_dir("folder");
        fs::create_dir(dir.path.join("sub")).unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let made = vault.create_folder("sub/Untitled").unwrap();
        assert_eq!(made.path, "sub/Untitled");
        assert!(made.is_dir);
        assert!(dir.path.join("sub").join("Untitled").is_dir());
        assert!(vault
            .list_files()
            .iter()
            .any(|e| e.path == "sub/Untitled" && e.is_dir));
        assert!(vault.create_folder("sub/Untitled").is_err());
        assert!(vault.create_folder("../outside").is_err());
        assert!(vault.create_folder(".obsidian/x").is_err());
    }

    #[test]
    fn create_of_a_known_path_is_a_modify() {
        let dir = tmp_dir("norm");
        fs::write(dir.path.join("a.md"), "x").unwrap();
        let vault = Vault::open(dir.path.clone()).unwrap();
        let changes = vec![VaultChanged {
            kind: ChangeKind::Create,
            paths: vec!["a.md".into(), "b.md".into()],
        }];
        let out = vault.normalize(changes);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].kind, ChangeKind::Create);
        assert_eq!(out[0].paths, vec!["b.md".to_string()]);
        assert_eq!(out[1].kind, ChangeKind::Modify);
        assert_eq!(out[1].paths, vec!["a.md".to_string()]);
    }
}
