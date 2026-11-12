//! One open vault: filesystem operations plus the in-memory index.
//!
//! `write_note` records the stamp of the file it finished, taken before that file is
//! published, so the watcher can drop the echo of those bytes. A later edit with any other
//! mtime, size, or file identity is a normal external change. The index is updated before
//! the call returns, so the next `list_files`, `search`, or `link_index` already sees the change.

use crate::fsutil::{self, atomic_write};
use crate::index::{Index, Stamp};
use crate::model::{push_change, ChangeKind, FileEntry, VaultChanged};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

/// Largest image `read_file_bytes` hands to an embed.
pub const IMAGE_MAX_BYTES: u64 = 20 * 1024 * 1024;
/// The files `read_file_bytes` reads: images an embed can show.
const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

#[derive(Clone, Copy, Default)]
struct NoteFormat {
    bom: bool,
    crlf: bool,
}

impl NoteFormat {
    fn apply(self, content: &str) -> std::borrow::Cow<'_, str> {
        if !self.bom && !self.crlf {
            return content.into();
        }
        let body = content.strip_prefix('\u{feff}').unwrap_or(content);
        let body = if self.crlf { body.replace("\r\n", "\n").replace('\n', "\r\n") } else { body.to_string() };
        (if self.bom { format!("\u{feff}{body}") } else { body }).into()
    }
}

/// Stamp of a file Grove itself wrote. The watcher ignores an event for this
/// path only while the file on disk is still that write.
#[derive(Clone, Copy)]
struct OwnWrite {
    mtime_ms: u64,
    size: u64,
    /// Device and inode. A same-size replace in one mtime tick is a different file.
    id: Option<(u64, u64)>,
}

pub struct Vault {
    pub root: PathBuf,
    pub index: Index,
    own_writes: HashMap<String, OwnWrite>,
    formats: Mutex<HashMap<String, NoteFormat>>,
    /// Device and inode last seen for a path. A same-size replace in one
    /// clock tick can share a [`Stamp`]; the id tells that apart from the file
    /// that was indexed.
    ids: HashMap<String, (u64, u64)>,
    rescan: Option<Arc<()>>,
}

impl Vault {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        if !root.is_dir() {
            return Err(format!("not a folder: {}", root.display()));
        }
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if let Err(error) = fsutil::sweep_temps(&root) {
            eprintln!("Could not clean abandoned Grove temp files: {error}");
        }
        let index = Index::scan(&root)?;
        Ok(Self {
            root,
            index,
            own_writes: HashMap::new(),
            formats: Mutex::new(HashMap::new()),
            ids: HashMap::new(),
            rescan: None,
        })
    }

    pub fn list_files(&self) -> Vec<FileEntry> {
        self.index.list()
    }

    pub fn read_note(&self, path: &str) -> Result<String, String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if !full.is_file() {
            return Err(format!("no such file: {path}"));
        }
        let bytes = fs::read(&full).map_err(|e| e.to_string())?;
        if let Ok(text) = std::str::from_utf8(&bytes) {
            self.observe_format(&rel, Some(text));
        }
        let text = String::from_utf8_lossy(&bytes);
        Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
    }

    /// An image's bytes, for an `![[embed]]`: the same path checks as `read_note` (inside the
    /// vault, no `..`, no symlink out, nothing in hidden folders), image extensions only, and at
    /// most [`IMAGE_MAX_BYTES`].
    pub fn read_file_bytes(&self, path: &str) -> Result<Vec<u8>, String> {
        let ext = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
        if !ext.is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.as_str())) {
            return Err(format!("not an image: {path}"));
        }
        let (_rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        let file = fs::File::open(&full).map_err(|_| format!("no such file: {path}"))?;
        let md = file.metadata().map_err(|e| e.to_string())?;
        if !md.is_file() {
            return Err(format!("no such file: {path}"));
        }
        if md.len() > IMAGE_MAX_BYTES {
            return Err(format!("too large to show: {path}"));
        }
        let mut bytes = Vec::with_capacity(md.len() as usize);
        // A file that grew since: still no more than the cap.
        file.take(IMAGE_MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > IMAGE_MAX_BYTES {
            return Err(format!("too large to show: {path}"));
        }
        Ok(bytes)
    }

    pub fn write_note(&mut self, path: &str, content: &str) -> Result<(), String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if full.is_dir() {
            return Err(format!("not a file: {path}"));
        }
        let existing = match fs::read(&full) {
            Ok(bytes) => Some(String::from_utf8(bytes).map_err(|_| "Note is not UTF-8".to_string())?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        let written = self.observe_format(&rel, existing.as_deref()).apply(content);
        let receipt = atomic_write(&full, written.as_bytes()).map_err(|e| e.to_string())?;
        let md = receipt.metadata();
        self.index.upsert_note(&self.root, &rel, &written, Stamp::of(md));
        self.record_own(&rel, md);
        Ok(())
    }

    fn observe_format(&self, rel: &str, existing: Option<&str>) -> NoteFormat {
        let mut formats = self.formats.lock().unwrap_or_else(|e| e.into_inner());
        let prev = formats.get(rel).copied().unwrap_or_default();
        let fmt = existing.map_or_else(NoteFormat::default, |s| NoteFormat {
            bom: if s.is_empty() { prev.bom } else { s.starts_with('\u{feff}') },
            crlf: if s.contains("\r\n") { true } else if s.contains('\n') { false } else { prev.crlf },
        });
        if fmt.bom || fmt.crlf {
            formats.insert(rel.to_string(), fmt);
        } else {
            formats.remove(rel);
        }
        fmt
    }

    fn relocate_formats(&self, from: &str, to: &str) {
        let mut formats = self.formats.lock().unwrap_or_else(|e| e.into_inner());
        // The destination was not on disk, so any cache there is stale. Drop it
        // even when the source has no format. A watcher echo is not this path.
        evict_format_tree(&mut formats, to);
        relocate_format_map(&mut formats, from, to, &mut HashSet::new(), &mut HashSet::new());
    }

    fn remove_formats(&self, rel: &str) {
        let mut formats = self.formats.lock().unwrap_or_else(|e| e.into_inner());
        evict_format_tree(&mut formats, rel);
    }

    /// A new attachment's bytes. The same path checks as `write_note` (inside the vault, no `..`,
    /// no symlink out, nothing in a hidden folder). Fails if anything is already at `path` or the
    /// bytes are over [`IMAGE_MAX_BYTES`]. Any extension is allowed, including none; empty is fine.
    /// Parents are created. The watcher echo is suppressed, as for `write_note`.
    pub fn write_file_bytes(&mut self, path: &str, bytes: &[u8]) -> Result<FileEntry, String> {
        self.put_file_bytes(path, bytes, false).map(|(entry, _)| entry)
    }

    /// `write_file_bytes` that may also replace a file already at `path` (a drawing exported
    /// again, after the page asked). A folder there is still refused. Also says whether a
    /// file was replaced.
    pub fn replace_file_bytes(
        &mut self,
        path: &str,
        bytes: &[u8],
    ) -> Result<(FileEntry, bool), String> {
        self.put_file_bytes(path, bytes, true)
    }

    fn put_file_bytes(
        &mut self,
        path: &str,
        bytes: &[u8],
        replace: bool,
    ) -> Result<(FileEntry, bool), String> {
        if bytes.len() as u64 > IMAGE_MAX_BYTES {
            return Err(format!("too large to save: {path}"));
        }
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        let existed = full.exists();
        if existed && !replace {
            return Err(format!("already exists: {rel}"));
        }
        if full.is_dir() {
            return Err(format!("not a file: {rel}"));
        }
        let receipt = atomic_write(&full, bytes).map_err(|e| e.to_string())?;
        self.index.refresh_path(&self.root, &rel);
        self.record_own(&rel, receipt.metadata());
        Ok((self.entry_for(&rel), existed))
    }

    pub fn create_note(&mut self, path: &str, content: &str) -> Result<FileEntry, String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if full.exists() {
            return Err(format!("already exists: {rel}"));
        }
        let receipt = atomic_write(&full, content.as_bytes()).map_err(|e| e.to_string())?;
        self.remove_formats(&rel);
        self.observe_format(&rel, Some(content));
        let md = receipt.metadata();
        self.index.upsert_note(&self.root, &rel, content, Stamp::of(md));
        self.record_own(&rel, md);
        Ok(self.entry_for(&rel))
    }

    /// Create an empty folder (the file explorer's "New folder"). Missing parents are created and
    /// indexed too. Fails if anything is already there.
    pub fn create_folder(&mut self, path: &str) -> Result<FileEntry, String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if full.exists() {
            return Err(format!("already exists: {rel}"));
        }
        fs::create_dir_all(&full).map_err(|e| e.to_string())?;
        self.index.refresh_path(&self.root, &rel);
        self.remember_id(&rel);
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
        self.relocate_formats(&from_rel, &to_rel);
        // One map rebuild for the move and the reload of the destination.
        {
            let root = &self.root;
            let mut batch = self.index.map_batch();
            batch.relocate(&from_rel, &to_rel);
            batch.refresh_path(root, &to_rel);
        }
        self.relocate_ids(&from_rel, &to_rel);
        self.relocate_own(&from_rel, &to_rel);
        self.remember_id(&to_rel);
        Ok(())
    }

    /// Move a file or folder into `.trash/` inside the vault, or, when `permanent` is set (the
    /// "Deleted files: Permanently delete" setting), remove it for good.
    pub fn delete_path(&mut self, path: &str, permanent: bool) -> Result<(), String> {
        let (rel, full) = fsutil::resolve_in_vault(&self.root, path)?;
        if !full.exists() {
            return Err(format!("no such file: {path}"));
        }
        if permanent {
            // symlink_metadata: a symlink is removed itself, never followed.
            let md = fs::symlink_metadata(&full).map_err(|e| e.to_string())?;
            if md.is_dir() {
                fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&full).map_err(|e| e.to_string())?;
            }
        } else {
            let dest = trash_dest(&self.root, &rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::rename(&full, &dest).map_err(|e| e.to_string())?;
        }
        self.remove_formats(&rel);
        self.forget_id_tree(&rel);
        self.forget_own_tree(&rel);
        self.index.remove_tree(&rel);
        Ok(())
    }

    /// A settings file from the vault's `.grove/` folder; `None` if there is none yet.
    pub fn read_config(&self, name: &str) -> Result<Option<String>, String> {
        let full = fsutil::config_file(&self.root, name)?;
        read_settings_text(&full, name)
    }

    /// One allowlisted file from Cinder or Obsidian, or `None` if it is missing.
    /// Never writes. The same size cap and symlink rule as [`Self::read_config`].
    pub fn read_foreign_config(&self, source: &str, name: &str) -> Result<Option<String>, String> {
        let full = fsutil::foreign_config_file(&self.root, source, name)?;
        read_settings_text(&full, &format!("{source}/{name}"))
    }

    /// Write a settings file into `.grove/` (created if missing), atomically. The content must
    /// be JSON, so the folder only ever holds readable settings.
    pub fn write_config(&self, name: &str, content: &str) -> Result<(), String> {
        let full = fsutil::config_file(&self.root, name)?;
        if content.len() > fsutil::CONFIG_MAX_BYTES {
            return Err(format!("settings file too large: {name}"));
        }
        serde_json::from_str::<serde_json::Value>(content)
            .map_err(|e| format!("not JSON: {e}"))?;
        atomic_write(&full, content.as_bytes())
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// True when `rel` is still the file Grove wrote. A missing file, or any
    /// other mtime, size, or identity, is someone else's change.
    pub fn is_own_write(&self, rel: &str) -> bool {
        let Some(own) = self.own_writes.get(rel) else {
            return false;
        };
        let Ok(md) = fs::symlink_metadata(self.root.join(rel)) else {
            return false;
        };
        if md.file_type().is_symlink() || !md.is_file() {
            return false;
        }
        if fsutil::mtime_ms(&md) != own.mtime_ms || md.len() != own.size {
            return false;
        }
        match (own.id, file_id(&md)) {
            (Some(known), Some(now)) => known == now,
            _ => true,
        }
    }

    /// Turn a create of a path we already know about into a modify (an editor's atomic save).
    pub fn normalize(&self, changes: Vec<VaultChanged>) -> Vec<VaultChanged> {
        let mut out = Vec::new();
        for change in changes {
            if change.kind != ChangeKind::Create {
                out.push(change);
                continue;
            }
            let (modified, created) = change
                .paths
                .into_iter()
                .partition(|path| self.index.contains(path));
            push_change(&mut out, ChangeKind::Create, created);
            push_change(&mut out, ChangeKind::Modify, modified);
        }
        out
    }

    /// Apply a watcher batch. Name maps rebuild once, after every path is updated.
    pub fn apply(&mut self, changes: &[VaultChanged]) {
        // One departed identity for each indexed rename source that is no
        // longer the file on disk. Captured before `map_batch`. A path that
        // still matches the index is a later file, or the same file back from
        // a round trip, and is not a move. Landing replaces the identity
        // already at the destination instead of leaving it to be spent again.
        let mut at: HashMap<String, u64> = HashMap::new();
        let mut stayed: HashSet<String> = HashSet::new();
        let mut next_id = 1u64;
        for change in changes {
            if change.kind != ChangeKind::Rename || change.paths.len() != 2 {
                continue;
            }
            for path in [&change.paths[0], &change.paths[1]] {
                if stayed.contains(path) || at.contains_key(path) {
                    continue;
                }
                if self.index.contains(path) && indexed_path_remains(&self.root, &self.index, path, self.ids.get(path).copied()) {
                    stayed.insert(path.clone());
                }
            }
            let from = &change.paths[0];
            if !at.contains_key(from) && self.index.contains(from) && !stayed.contains(from) {
                at.insert(from.clone(), next_id);
                next_id += 1;
            }
        }
        {
            let root = &self.root;
            let mut batch = self.index.map_batch();
            for change in changes {
                match change.kind {
                    ChangeKind::Remove => {
                        for path in &change.paths {
                            batch.remove_tree(path);
                        }
                    }
                    ChangeKind::Rename => {
                        if change.paths.len() == 2 {
                            batch.relocate(&change.paths[0], &change.paths[1]);
                            batch.refresh_path(root, &change.paths[1]);
                        }
                    }
                    ChangeKind::Create | ChangeKind::Modify => {
                        for path in &change.paths {
                            batch.refresh_path(root, path);
                        }
                    }
                }
            }
        }
        self.track_ids(changes);
        self.track_own(changes, at.clone(), &stayed);
        // The batch above relocates every rename, including an echo of a move
        // the app already applied. Put a source that is still on disk back.
        // A different file at that path is an outside replacement, not a move.
        let replaced = self.restore_echo_sources(&stayed, changes);
        let mut formats = self.formats.lock().unwrap_or_else(|e| e.into_inner());
        if formats.is_empty() {
            return;
        }
        let mut evict = HashSet::new();
        // Notes whose format this batch just moved. A create of their new parent
        // folder is also in `evict` and must not drop that relocated identity.
        let mut kept = HashSet::new();
        for change in changes {
            match change.kind {
                ChangeKind::Remove | ChangeKind::Create => {
                    evict.extend(change.paths.iter().map(String::as_str));
                }
                ChangeKind::Rename if change.paths.len() == 2 => {
                    let from = &change.paths[0];
                    let to = &change.paths[1];
                    if from == to {
                        continue;
                    }
                    // No departed identity: the app already moved this path, or
                    // this hop was already consumed. Leave both caches where
                    // they are. Relocating here would copy a reused source's
                    // format onto the destination.
                    let Some(id) = at.remove(from) else {
                        continue;
                    };
                    // The indexed file is still at `to`, so this move did not
                    // replace it (a round trip that ended back on that path).
                    if stayed.contains(to) {
                        continue;
                    }
                    at.remove(to);
                    evict_format_tree(&mut formats, to);
                    at.insert(to.clone(), id);
                    relocate_format_map(&mut formats, from, to, &mut evict, &mut kept);
                }
                _ => {}
            }
        }
        formats.retain(|k, _| {
            self.index.contains(k) && !self.index.is_dir(k) && (kept.contains(k) || !has_prefix_in(k, &evict))
        });
        // The file now at a replaced source is not the one whose format we cached.
        for path in &replaced {
            evict_format_tree(&mut formats, path);
        }
    }

    /// Start recording index mutations before releasing the state lock to scan.
    /// The token also rejects a scan if the vault was reopened (even at the same root).
    pub fn begin_rescan(&mut self) -> Arc<()> {
        let token = Arc::new(());
        self.rescan = Some(token.clone());
        self.index.begin_rescan();
        token
    }

    /// Reconcile only paths changed by the app during the scan, then diff and swap.
    /// Both replay and swap hold the state lock: a completed write can never be lost.
    pub fn finish_rescan(&mut self, token: &Arc<()>, fresh: Result<Index, String>) -> Vec<VaultChanged> {
        if !self.rescan.as_ref().is_some_and(|current| Arc::ptr_eq(current, token)) {
            return Vec::new();
        }
        self.rescan = None;
        let paths = self.index.take_rescan_changes();
        let Ok(mut fresh) = fresh else {
            return Vec::new();
        };
        for path in paths {
            fresh.remove_tree(&path);
            fresh.refresh_path(&self.root, &path);
        }
        let mut removed = Vec::new();
        let mut created = Vec::new();
        let mut modified = Vec::new();
        for path in self.index.paths() {
            if !fresh.contains(path) {
                removed.push(path.clone());
            } else if !fresh.is_dir(path) && self.index.stamp(path) != fresh.stamp(path) {
                modified.push(path.clone());
            }
        }
        for path in fresh.paths() {
            if !self.index.contains(path) {
                created.push(path.clone());
            }
        }
        self.index = fresh;
        let created_set: HashSet<&str> = created.iter().map(String::as_str).collect();
        self.formats
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|k, _| self.index.contains(k) && !self.index.is_dir(k) && !has_prefix_in(k, &created_set));
        let mut out = Vec::new();
        push_change(&mut out, ChangeKind::Remove, removed);
        push_change(&mut out, ChangeKind::Create, created);
        push_change(&mut out, ChangeKind::Modify, modified);
        out
    }

    /// Remember a successful atomic write. `md` is the receipt from before
    /// publication. The same identity goes into the rename preflight, so a
    /// later echo does not treat this file as one that has already left.
    pub(crate) fn record_own(&mut self, rel: &str, md: &fs::Metadata) {
        let id = file_id(md);
        if let Some(id) = id {
            self.ids.insert(rel.to_string(), id);
        }
        self.own_writes.insert(
            rel.to_string(),
            OwnWrite {
                mtime_ms: fsutil::mtime_ms(md),
                size: md.len(),
                id,
            },
        );
    }

    fn forget_own_tree(&mut self, rel: &str) {
        let prefix = format!("{rel}/");
        self.own_writes.retain(|k, _| k != rel && !k.starts_with(&prefix));
    }

    fn relocate_own(&mut self, from: &str, to: &str) {
        if from == to || self.own_writes.is_empty() {
            return;
        }
        let prefix = format!("{from}/");
        let keys: Vec<String> = self
            .own_writes
            .keys()
            .filter(|k| *k == from || k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(own) = self.own_writes.remove(&key) {
                let dest = if key == from { to.to_string() } else { format!("{to}{}", &key[from.len()..]) };
                self.own_writes.insert(dest, own);
            }
        }
    }

    /// The index batch already ran. Move an own-write record only for an
    /// identity that left its path. An app-rename echo has no departed id, so
    /// a recreated source keeps the stamp of the bytes now on it. Do not
    /// refresh a record from whatever bytes are at the destination.
    fn track_own(
        &mut self,
        changes: &[VaultChanged],
        mut moved: HashMap<String, u64>,
        stayed: &HashSet<String>,
    ) {
        for change in changes {
            match change.kind {
                ChangeKind::Remove => {
                    for path in &change.paths {
                        self.forget_own_tree(path);
                    }
                }
                ChangeKind::Rename if change.paths.len() == 2 => {
                    let from = &change.paths[0];
                    let to = &change.paths[1];
                    if from == to {
                        continue;
                    }
                    let Some(id) = moved.remove(from) else {
                        continue;
                    };
                    if stayed.contains(to) {
                        continue;
                    }
                    moved.remove(to);
                    moved.insert(to.clone(), id);
                    self.relocate_own(from, to);
                }
                _ => {}
            }
        }
    }

    fn remember_id(&mut self, rel: &str) {
        let Ok(md) = fs::symlink_metadata(self.root.join(rel)) else {
            self.ids.remove(rel);
            return;
        };
        if let Some(id) = file_id(&md) {
            self.ids.insert(rel.to_string(), id);
        }
    }

    fn forget_id_tree(&mut self, rel: &str) {
        let prefix = format!("{rel}/");
        self.ids.retain(|k, _| k != rel && !k.starts_with(&prefix));
    }

    fn relocate_ids(&mut self, from: &str, to: &str) {
        if from == to || self.ids.is_empty() {
            return;
        }
        let prefix = format!("{from}/");
        let keys: Vec<String> = self
            .ids
            .keys()
            .filter(|k| *k == from || k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(id) = self.ids.remove(&key) {
                let dest = if key == from { to.to_string() } else { format!("{to}{}", &key[from.len()..]) };
                self.ids.insert(dest, id);
            }
        }
    }

    /// The index batch already ran. Point stored ids at the files now on disk.
    fn track_ids(&mut self, changes: &[VaultChanged]) {
        for change in changes {
            match change.kind {
                ChangeKind::Remove => {
                    for path in &change.paths {
                        self.forget_id_tree(path);
                    }
                }
                ChangeKind::Rename if change.paths.len() == 2 => {
                    self.relocate_ids(&change.paths[0], &change.paths[1]);
                    self.remember_id(&change.paths[1]);
                    self.remember_id(&change.paths[0]);
                }
                ChangeKind::Create | ChangeKind::Modify => {
                    for path in &change.paths {
                        self.remember_id(path);
                    }
                }
                _ => {}
            }
        }
    }

    /// `map_batch` already ran and relocated every rename source. Index a source
    /// that is still on disk: the same file after an app echo, or a different
    /// file an outside replace left behind. A path that is gone stayed moved.
    /// The receipt stays the own-write record, so a replacement is not ours.
    /// `track_ids` has already pointed the identity cache at the file on disk.
    /// Returned paths are replacements whose cached format belonged to the
    /// file that left.
    fn restore_echo_sources(&mut self, stayed: &HashSet<String>, changes: &[VaultChanged]) -> Vec<String> {
        let mut refresh: Vec<&str> = Vec::new();
        let mut replaced: Vec<String> = Vec::new();
        for change in changes {
            if change.kind != ChangeKind::Rename || change.paths.len() != 2 {
                continue;
            }
            let from = change.paths[0].as_str();
            if from == change.paths[1].as_str() || self.index.contains(from) {
                continue;
            }
            if fs::symlink_metadata(self.root.join(from)).is_err() {
                continue;
            }
            if !refresh.contains(&from) {
                refresh.push(from);
            }
            if !stayed.contains(from) {
                replaced.push(from.to_string());
            }
        }
        if refresh.is_empty() {
            return replaced;
        }
        let root = &self.root;
        let mut batch = self.index.map_batch();
        for path in refresh {
            batch.refresh_path(root, path);
        }
        replaced
    }

    fn entry_for(&self, rel: &str) -> FileEntry {
        self.index.entry(rel).unwrap_or_else(|| FileEntry {
            path: rel.to_string(),
            name: rel.to_string(),
            ..FileEntry::default()
        })
    }
}

fn has_prefix_in(path: &str, set: &HashSet<&str>) -> bool {
    !set.is_empty() && (set.contains(path) || path.match_indices('/').any(|(i, _)| set.contains(&path[..i])))
}

/// Whether `rel` still has the node the index recorded. False after a real
/// rename (the path is gone or a different file is there). `known` is the
/// device and inode from the last vault write; a same-size replace can share
/// a stamp. Directories without an id are compared by modified time only.
fn indexed_path_remains(root: &Path, index: &Index, rel: &str, known: Option<(u64, u64)>) -> bool {
    let Some(stamp) = index.stamp(rel) else {
        return false;
    };
    let Ok(md) = fs::symlink_metadata(root.join(rel)) else {
        return false;
    };
    if md.is_dir() != index.is_dir(rel) {
        return false;
    }
    if let (Some(known), Some(now)) = (known, file_id(&md)) {
        return known == now;
    }
    if md.is_dir() {
        return fsutil::mtime_ms(&md) == stamp.mtime_ms;
    }
    Stamp::of(&md) == stamp
}

/// Device and inode, so two files written in one clock tick stay distinct.
fn file_id(md: &fs::Metadata) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some((md.dev(), md.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = md;
        None
    }
}

fn evict_format_tree(formats: &mut HashMap<String, NoteFormat>, rel: &str) {
    let prefix = format!("{rel}/");
    formats.retain(|k, _| k != rel && !k.starts_with(&prefix));
}

fn relocate_format_map(
    formats: &mut HashMap<String, NoteFormat>,
    from: &str,
    to: &str,
    evict: &mut HashSet<&str>,
    kept: &mut HashSet<String>,
) {
    if from == to || formats.is_empty() {
        return;
    }
    let prefix = format!("{from}/");
    let keys: Vec<String> = formats
        .keys()
        .filter(|k| (*k == from || k.starts_with(&prefix)) && !has_prefix_in(k, evict))
        .cloned()
        .collect();
    for key in keys {
        if let Some(fmt) = formats.remove(&key) {
            let dest = if key == from { to.to_string() } else { format!("{to}{}", &key[from.len()..]) };
            evict.remove(dest.as_str());
            kept.insert(dest.clone());
            formats.insert(dest, fmt);
        }
    }
}

/// Read a settings file the caller has already confined to the vault.
/// Missing is `None`. A directory, or anything over [`fsutil::CONFIG_MAX_BYTES`], is an error.
fn read_settings_text(full: &Path, label: &str) -> Result<Option<String>, String> {
    let md = match fs::metadata(full) {
        Ok(md) => md,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !md.is_file() || md.len() > fsutil::CONFIG_MAX_BYTES as u64 {
        return Err(format!("not a settings file: {label}"));
    }
    fs::read_to_string(full).map(Some).map_err(|e| e.to_string())
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
    use std::time::{Duration, Instant};

    fn listed(vault: &Vault, path: &str) -> FileEntry {
        vault.list_files().into_iter().find(|e| e.path == path).unwrap()
    }

    fn rename_both(root: &Path, from: &str, to: &str, tracker: usize) -> notify::Event {
        notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Name(
            notify::event::RenameMode::Both,
        )))
        .add_path(root.join(from))
        .add_path(root.join(to))
        .set_tracker(tracker)
    }

    #[test]
    fn canvas_is_listed_and_read_without_rewriting_unknown_fields() {
        let dir = tmp_dir("canvas");
        let source = "{\"future\":42,\"nodes\":[],\"edges\":[] }\n";
        fs::write(dir.path.join("Board.canvas"), source).unwrap();
        let vault = Vault::open(dir.path.clone()).unwrap();
        assert!(vault.list_files().iter().any(|f| f.path == "Board.canvas"));
        assert_eq!(vault.read_note("Board.canvas").unwrap(), source);
        assert_eq!(fs::read_to_string(dir.path.join("Board.canvas")).unwrap(), source);
    }

    #[test]
    fn crlf_and_lf_notes_keep_their_line_endings_on_save() {
        let dir = tmp_dir("eol-crlf");
        fs::write(dir.path.join("Crlf.md"), "first\r\nsecond\r\n").unwrap();
        fs::write(dir.path.join("Lf.md"), "first\nsecond\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("Crlf.md", "first\nrevised\n").unwrap();
        vault.write_note("Lf.md", "first\nrevised\n").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("Crlf.md")).unwrap(), "first\r\nrevised\r\n");
        assert_eq!(fs::read_to_string(dir.path.join("Lf.md")).unwrap(), "first\nrevised\n");
    }

    #[test]
    fn utf8_bom_is_preserved_and_bomless_notes_do_not_gain_one() {
        let dir = tmp_dir("eol-bom");
        fs::write(dir.path.join("Bom.md"), "\u{feff}first\nsecond\n").unwrap();
        fs::write(dir.path.join("Plain.md"), "first\nsecond\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let text = vault.read_note("Bom.md").unwrap();
        assert_eq!(text, "first\nsecond\n");
        vault.write_note("Bom.md", &text.replace("second", "revised")).unwrap();
        vault.write_note("Plain.md", "first\nrevised\n").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("Bom.md")).unwrap(), "\u{feff}first\nrevised\n");
        assert_eq!(fs::read_to_string(dir.path.join("Plain.md")).unwrap(), "first\nrevised\n");
    }

    #[test]
    fn bom_and_crlf_round_trip_while_new_notes_stay_lf_without_bom() {
        let dir = tmp_dir("eol-both");
        fs::write(dir.path.join("Win.md"), "\u{feff}---\r\nstatus: todo\r\n---\r\nbody\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let editor_doc = vault.read_note("Win.md").unwrap().replace("\r\n", "\n");
        vault.write_note("Win.md", &editor_doc.replace("todo", "done")).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path.join("Win.md")).unwrap(),
            "\u{feff}---\r\nstatus: done\r\n---\r\nbody\r\n"
        );
        vault.write_note("New.md", "fresh\nnote\n").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("New.md")).unwrap(), "fresh\nnote\n");
        vault.create_note("Created.md", "").unwrap();
        vault.write_note("Created.md", "fresh\nnote\n").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("Created.md")).unwrap(), "fresh\nnote\n");
    }

    #[test]
    fn write_note_does_not_overwrite_non_utf8_bytes_with_replacement_chars() {
        let dir = tmp_dir("eol-utf8");
        fs::write(dir.path.join("Latin1.md"), b"caf\xe9\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let lossy = vault.read_note("Latin1.md").unwrap();
        assert_eq!(lossy, "caf\u{fffd}\r\n");
        assert!(vault.write_note("Latin1.md", &lossy.replace("\r\n", "\n")).is_err());
        assert_eq!(fs::read(dir.path.join("Latin1.md")).unwrap(), b"caf\xe9\r\n");
    }

    #[test]
    fn crlf_and_bom_survive_single_line_or_empty_saves_and_renames() {
        let dir = tmp_dir("eol-single");
        fs::write(dir.path.join("Crlf.md"), "a\r\nb\r\n").unwrap();
        fs::write(dir.path.join("Empty.md"), "\u{feff}a\r\nb\r\n").unwrap();
        fs::create_dir(dir.path.join("sub")).unwrap();
        fs::write(dir.path.join("sub/Move.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();

        vault.write_note("Crlf.md", "single").unwrap();
        vault.write_note("Crlf.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("Crlf.md")).unwrap(), "single\r\nnext");

        vault.write_note("Empty.md", "").unwrap();
        vault.write_note("Empty.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("Empty.md")).unwrap(), "\u{feff}single\r\nnext");

        vault.write_note("sub/Move.md", "single").unwrap();
        vault.rename_path("sub/Move.md", "sub/Renamed.md").unwrap();
        vault.rename_path("sub", "moved").unwrap();
        vault.write_note("moved/Renamed.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("moved/Renamed.md")).unwrap(), "single\r\nnext");
    }

    #[test]
    fn failed_rename_keeps_original_format_and_leaves_destination_uncached() {
        let dir = tmp_dir("eol-fail-rename");
        fs::write(dir.path.join("Orig.md"), "a\r\nb\r\n").unwrap();
        fs::write(dir.path.join("blocker"), "x").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();

        vault.write_note("Orig.md", "single").unwrap();
        assert!(vault.rename_path("Orig.md", "blocker/Dest.md").is_err());
        vault.write_note("Orig.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("Orig.md")).unwrap(), "single\r\nnext");
        assert!(!vault.formats.lock().unwrap().contains_key("blocker/Dest.md"));
    }

    #[test]
    fn watcher_apply_and_rescan_maintain_and_prune_format_cache() {
        let dir = tmp_dir("eol-watch-rescan");
        fs::create_dir(dir.path.join("sub")).unwrap();
        fs::write(dir.path.join("sub/Note.md"), "a\r\nb\r\n").unwrap();
        fs::write(dir.path.join("Gone.md"), "\u{feff}a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();

        vault.write_note("sub/Note.md", "single").unwrap();
        fs::rename(dir.path.join("sub/Note.md"), dir.path.join("sub/Renamed.md")).unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["sub/Note.md".into(), "sub/Renamed.md".into()],
        }]);
        fs::rename(dir.path.join("sub"), dir.path.join("moved")).unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["sub".into(), "moved".into()],
        }]);
        let atomic = vault.normalize(vec![VaultChanged {
            kind: ChangeKind::Create,
            paths: vec!["moved/Renamed.md".into()],
        }]);
        vault.apply(&atomic);
        vault.write_note("moved/Renamed.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("moved/Renamed.md")).unwrap(), "single\r\nnext");

        vault.write_note("Gone.md", "single").unwrap();
        fs::remove_file(dir.path.join("Gone.md")).unwrap();
        vault.apply(&[VaultChanged { kind: ChangeKind::Remove, paths: vec!["Gone.md".into()] }]);
        fs::write(dir.path.join("Gone.md"), "fresh").unwrap();
        vault.apply(&[VaultChanged { kind: ChangeKind::Create, paths: vec!["Gone.md".into()] }]);
        vault.write_note("Gone.md", "fresh\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("Gone.md")).unwrap(), "fresh\nnext");

        for i in 0..5 {
            let p = format!("churn-{i}.md");
            fs::write(dir.path.join(&p), "a\r\nb\r\n").unwrap();
            vault.read_note(&p).unwrap();
            fs::remove_file(dir.path.join(&p)).unwrap();
        }
        assert_eq!(vault.formats.lock().unwrap().len(), 6);
        let token = vault.begin_rescan();
        let fresh = Index::scan(&vault.root);
        vault.finish_rescan(&token, fresh);
        let formats = vault.formats.lock().unwrap();
        assert_eq!(formats.len(), 1);
        assert!(formats.contains_key("moved/Renamed.md"));
    }

    #[test]
    fn app_rename_watcher_echo_preserves_cached_format() {
        let dir = tmp_dir("eol-rename-echo");
        fs::create_dir(dir.path.join("sub")).unwrap();
        fs::write(dir.path.join("sub/Note.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();

        vault.write_note("sub/Note.md", "single").unwrap();
        vault.rename_path("sub/Note.md", "sub/Renamed.md").unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["sub/Note.md".into(), "sub/Renamed.md".into()],
        }]);
        vault.rename_path("sub", "moved").unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["sub".into(), "moved".into()],
        }]);
        vault.write_note("moved/Renamed.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("moved/Renamed.md")).unwrap(), "single\r\nnext");
    }

    #[test]
    fn chained_watcher_renames_and_batched_eviction_keep_and_prune_formats() {
        let dir = tmp_dir("eol-chain-rename");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        fs::create_dir(dir.path.join("dir1")).unwrap();
        fs::write(dir.path.join("dir1/Note.md"), "\u{feff}a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();

        vault.write_note("A.md", "single").unwrap();
        vault.write_note("dir1/Note.md", "single").unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("C.md")).unwrap();
        fs::rename(dir.path.join("dir1"), dir.path.join("dir3")).unwrap();
        vault.apply(&[
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["B.md".into(), "C.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["dir1".into(), "dir2".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["dir2".into(), "dir3".into()] },
        ]);
        vault.write_note("C.md", "single\nnext").unwrap();
        vault.write_note("dir3/Note.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("C.md")).unwrap(), "single\r\nnext");
        assert_eq!(fs::read_to_string(dir.path.join("dir3/Note.md")).unwrap(), "\u{feff}single\r\nnext");

        let removed: Vec<String> = (0..200)
            .map(|i| {
                let p = format!("bulk/item-{i}.md");
                vault.observe_format(&p, Some("a\r\nb\r\n"));
                p
            })
            .collect();
        let start = Instant::now();
        vault.apply(&[VaultChanged { kind: ChangeKind::Remove, paths: removed }]);
        assert!(start.elapsed() < Duration::from_millis(50));
        assert_eq!(vault.formats.lock().unwrap().len(), 2);
    }

    /// Create of the destination folder must not drop a format just moved into it.
    #[test]
    fn destination_dir_create_keeps_relocated_crlf_format() {
        let dir = tmp_dir("eol-dest-dir");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        fs::create_dir(dir.path.join("New")).unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("New/A.md")).unwrap();
        let create = notify::Event::new(notify::EventKind::Create(notify::event::CreateKind::Folder))
            .add_path(dir.path.join("New"));
        let rename = notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Name(
            notify::event::RenameMode::Both,
        )))
        .add_path(dir.path.join("A.md"))
        .add_path(dir.path.join("New/A.md"))
        .set_tracker(1);
        let changes = vault.normalize(crate::watch::coalesce(&dir.path, &[create, rename], |_| false));
        assert_eq!(
            changes,
            vec![
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "New/A.md".into()] },
                VaultChanged { kind: ChangeKind::Create, paths: vec!["New".into()] },
            ]
        );
        vault.apply(&changes);
        vault.write_note("New/A.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("New/A.md")).unwrap(), "single\r\nnext");
    }

    /// An app rename onto an externally deleted path must not inherit that path's old format.
    #[test]
    fn external_delete_then_app_rename_drops_stale_destination_format() {
        let dir = tmp_dir("eol-stale-dest");
        fs::write(dir.path.join("A.md"), "plain\n").unwrap();
        fs::write(dir.path.join("B.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.write_note("B.md", "single").unwrap();
        fs::remove_file(dir.path.join("B.md")).unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        // The watcher echo of that rename must not put the stale format back.
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["A.md".into(), "B.md".into()],
        }]);
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("B.md")).unwrap(), "single\nnext");
    }

    /// External delete of B then rename of A onto B, coalesced to one Rename.
    /// A plain LF source must not inherit B's cached CRLF or BOM.
    #[test]
    fn external_delete_and_rename_does_not_inherit_destination_format() {
        fn case(label: &str, source_save: &str, dest_seed: &str, dest_save: &str) -> String {
            let dir = tmp_dir(label);
            fs::write(dir.path.join("A.md"), "plain\n").unwrap();
            fs::write(dir.path.join("B.md"), dest_seed).unwrap();
            let mut vault = Vault::open(dir.path.clone()).unwrap();
            vault.write_note("A.md", source_save).unwrap();
            vault.write_note("B.md", dest_save).unwrap();
            fs::remove_file(dir.path.join("B.md")).unwrap();
            fs::rename(dir.path.join("A.md"), dir.path.join("B.md")).unwrap();
            let remove = notify::Event::new(notify::EventKind::Remove(notify::event::RemoveKind::File))
                .add_path(dir.path.join("B.md"));
            let rename = notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Name(
                notify::event::RenameMode::Both,
            )))
            .add_path(dir.path.join("A.md"))
            .add_path(dir.path.join("B.md"))
            .set_tracker(1);
            let changes = vault.normalize(crate::watch::coalesce(&dir.path, &[remove, rename], |_| false));
            assert_eq!(
                changes,
                vec![VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] }]
            );
            vault.apply(&changes);
            vault.write_note("B.md", "single\nnext").unwrap();
            fs::read_to_string(dir.path.join("B.md")).unwrap()
        }
        let lf = case("eol-ext-rename-lf", "single", "a\r\nb\r\n", "single");
        let bom = case("eol-ext-rename-bom", "", "\u{feff}a\r\nb\r\n", "");
        assert_eq!((lf.as_str(), bom.as_str()), ("single\nnext", "single\nnext"));
    }

    /// Two coalesced `Rename(A, B)` records (distinct trackers). The second must
    /// not wipe the format the first one just moved.
    #[test]
    fn replay_duplicate_coalesced_file_rename_keeps_crlf() {
        let dir = tmp_dir("eol-replay-file");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("B.md")).unwrap();
        let changes = vault.normalize(crate::watch::coalesce(
            &dir.path,
            &[
                rename_both(&dir.path, "A.md", "B.md", 1),
                rename_both(&dir.path, "A.md", "B.md", 2),
            ],
            |_| false,
        ));
        assert_eq!(
            changes,
            vec![
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
            ]
        );
        vault.apply(&changes);
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("B.md")).unwrap(), "single\r\nnext");
    }

    /// Same replay for a folder: the note moved with the folder keeps CRLF.
    #[test]
    fn replay_duplicate_coalesced_folder_rename_keeps_crlf() {
        let dir = tmp_dir("eol-replay-folder");
        fs::create_dir(dir.path.join("dir1")).unwrap();
        fs::write(dir.path.join("dir1/Note.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("dir1/Note.md", "single").unwrap();
        fs::rename(dir.path.join("dir1"), dir.path.join("dir2")).unwrap();
        let changes = vault.normalize(crate::watch::coalesce(
            &dir.path,
            &[
                rename_both(&dir.path, "dir1", "dir2", 1),
                rename_both(&dir.path, "dir1", "dir2", 2),
            ],
            |_| false,
        ));
        assert_eq!(
            changes,
            vec![
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["dir1".into(), "dir2".into()] },
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["dir1".into(), "dir2".into()] },
            ]
        );
        vault.apply(&changes);
        vault.write_note("dir2/Note.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("dir2/Note.md")).unwrap(), "single\r\nnext");
    }

    /// A later hop repeated in the same batch must not drop the format the first
    /// hop already carried forward.
    #[test]
    fn replay_repeated_chain_hop_keeps_crlf() {
        let dir = tmp_dir("eol-replay-hop");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        fs::create_dir(dir.path.join("dir1")).unwrap();
        fs::write(dir.path.join("dir1/Note.md"), "\u{feff}a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.write_note("dir1/Note.md", "single").unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("C.md")).unwrap();
        fs::rename(dir.path.join("dir1"), dir.path.join("dir3")).unwrap();
        vault.apply(&[
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["B.md".into(), "C.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["B.md".into(), "C.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["dir1".into(), "dir2".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["dir2".into(), "dir3".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["dir2".into(), "dir3".into()] },
        ]);
        vault.write_note("C.md", "single\nnext").unwrap();
        vault.write_note("dir3/Note.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("C.md")).unwrap(), "single\r\nnext");
        assert_eq!(fs::read_to_string(dir.path.join("dir3/Note.md")).unwrap(), "\u{feff}single\r\nnext");
    }

    /// App rename, then a new plain file at the old path, then the watcher echo.
    /// The echo is the old move, not a move of the new file.
    #[test]
    fn replay_app_rename_reused_source_echo_keeps_crlf() {
        let dir = tmp_dir("eol-echo-reused");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "plain\n").unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["A.md".into(), "B.md".into()],
        }]);
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("B.md")).unwrap(), "single\r\nnext");
    }

    /// The new file at the old path really is renamed onto the destination.
    /// That replacement still drops the format the app move left behind.
    #[test]
    fn replay_reused_source_external_rename_drops_stale_format() {
        let dir = tmp_dir("eol-reused-real");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "plain\n").unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("B.md")).unwrap();
        let changes = vault.normalize(crate::watch::coalesce(
            &dir.path,
            &[rename_both(&dir.path, "A.md", "B.md", 1)],
            |_| false,
        ));
        assert_eq!(
            changes,
            vec![VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] }]
        );
        vault.apply(&changes);
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("B.md")).unwrap(), "single\nnext");
    }

    /// A → B → A → B in one batch is a second real move, not a duplicate pair.
    /// The format has to finish on B.
    #[test]
    fn replay_round_trip_keeps_crlf_on_the_final_hop() {
        let dir = tmp_dir("eol-round-trip");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("B.md")).unwrap();
        vault.apply(&[
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["B.md".into(), "A.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
        ]);
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("B.md")).unwrap(), "single\r\nnext");
    }

    /// App rename of a plain single-line note, then a new CRLF file at the old
    /// path, then the delayed echo. The echo must not give B the new file's
    /// endings, and the new file keeps its own.
    #[test]
    fn replay_app_echo_keeps_reused_crlf_source_and_lf_dest() {
        let dir = tmp_dir("eol-echo-crlf-src");
        fs::write(dir.path.join("A.md"), "plain\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "a\r\nb\r\n").unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["A.md".into(), "B.md".into()],
        }]);
        vault.write_note("B.md", "single\nnext").unwrap();
        vault.write_note("A.md", "a\nnext\n").unwrap();
        assert_eq!(
            (
                fs::read_to_string(dir.path.join("B.md")).unwrap(),
                fs::read_to_string(dir.path.join("A.md")).unwrap(),
            ),
            ("single\nnext".to_string(), "a\r\nnext\r\n".to_string())
        );
    }

    /// The echo also must not replace a destination that already remembers CRLF
    /// with the new file's format.
    #[test]
    fn replay_app_echo_keeps_dest_crlf_when_reused_source_has_bom() {
        let dir = tmp_dir("eol-echo-bom-src");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "\u{feff}only\n").unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["A.md".into(), "B.md".into()],
        }]);
        vault.write_note("B.md", "single\nnext").unwrap();
        vault.write_note("A.md", "only\nnext").unwrap();
        assert_eq!(
            (
                fs::read_to_string(dir.path.join("B.md")).unwrap(),
                fs::read_to_string(dir.path.join("A.md")).unwrap(),
            ),
            ("single\r\nnext".to_string(), "\u{feff}only\nnext".to_string())
        );
    }

    /// B was indexed, then deleted, and A moved A → B → C. A second B → C must
    /// not clear C. Coalesce drops the delete because B is a rename endpoint.
    #[test]
    fn replay_preindexed_intermediate_hop_keeps_crlf() {
        let dir = tmp_dir("eol-indexed-hop");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        fs::write(dir.path.join("B.md"), "other\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        fs::remove_file(dir.path.join("B.md")).unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("B.md")).unwrap();
        fs::rename(dir.path.join("B.md"), dir.path.join("C.md")).unwrap();
        let remove = notify::Event::new(notify::EventKind::Remove(notify::event::RemoveKind::File))
            .add_path(dir.path.join("B.md"));
        let changes = vault.normalize(crate::watch::coalesce(
            &dir.path,
            &[
                remove,
                rename_both(&dir.path, "A.md", "B.md", 1),
                rename_both(&dir.path, "B.md", "C.md", 2),
                rename_both(&dir.path, "B.md", "C.md", 3),
            ],
            |_| false,
        ));
        assert_eq!(
            changes,
            vec![
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["B.md".into(), "C.md".into()] },
                VaultChanged { kind: ChangeKind::Rename, paths: vec!["B.md".into(), "C.md".into()] },
            ]
        );
        vault.apply(&changes);
        vault.write_note("C.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("C.md")).unwrap(), "single\r\nnext");
    }

    /// External A → B → A finishes with the original file back at A. B was
    /// indexed and is gone. That must not clear A's remembered CRLF.
    #[test]
    fn replay_round_trip_back_to_resident_source_keeps_crlf() {
        let dir = tmp_dir("eol-round-trip-home");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        fs::write(dir.path.join("B.md"), "other\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        fs::remove_file(dir.path.join("B.md")).unwrap();
        fs::rename(dir.path.join("A.md"), dir.path.join("B.md")).unwrap();
        fs::rename(dir.path.join("B.md"), dir.path.join("A.md")).unwrap();
        vault.apply(&[
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] },
            VaultChanged { kind: ChangeKind::Rename, paths: vec!["B.md".into(), "A.md".into()] },
        ]);
        vault.write_note("A.md", "single\nnext").unwrap();
        assert_eq!(fs::read_to_string(dir.path.join("A.md")).unwrap(), "single\r\nnext");
    }

    /// Single-line save before the echo. CRLF is only in the cache, so pruning
    /// the recreated source cannot be repaired from the bytes on disk.
    #[test]
    fn replay_echo_single_line_keeps_reused_crlf_source() {
        let dir = tmp_dir("eol-echo-single-crlf");
        fs::write(dir.path.join("A.md"), "plain\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "a\r\nb\r\n").unwrap();
        vault.write_note("A.md", "only").unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["A.md".into(), "B.md".into()],
        }]);
        assert!(vault.index.contains("A.md"), "recreated source dropped out of the index");
        assert!(vault.index.contains("B.md"), "destination dropped out of the index");
        vault.write_note("A.md", "only\nnext").unwrap();
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(
            (
                fs::read_to_string(dir.path.join("A.md")).unwrap(),
                fs::read_to_string(dir.path.join("B.md")).unwrap(),
            ),
            ("only\r\nnext".to_string(), "single\nnext".to_string())
        );
    }

    /// Same echo, with the new source remembering a BOM and the destination
    /// remembering CRLF. Both files stay indexed and keep their own bytes.
    #[test]
    fn replay_echo_single_line_keeps_reused_bom_source() {
        let dir = tmp_dir("eol-echo-single-bom");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "\u{feff}only\n").unwrap();
        vault.write_note("A.md", "only").unwrap();
        vault.apply(&[VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["A.md".into(), "B.md".into()],
        }]);
        assert!(vault.index.contains("A.md"), "recreated source dropped out of the index");
        assert!(vault.index.contains("B.md"), "destination dropped out of the index");
        vault.write_note("A.md", "only\nnext").unwrap();
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(
            (
                fs::read_to_string(dir.path.join("A.md")).unwrap(),
                fs::read_to_string(dir.path.join("B.md")).unwrap(),
            ),
            ("\u{feff}only\nnext".to_string(), "single\r\nnext".to_string())
        );
    }

    /// Coalesce drops creates and modifies on a rename endpoint, so the echo
    /// batch has no later refresh of the recreated source.
    #[test]
    fn replay_echo_single_line_coalesce_keeps_reused_crlf_source() {
        let dir = tmp_dir("eol-echo-single-crlf-coalesce");
        fs::write(dir.path.join("A.md"), "plain\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "a\r\nb\r\n").unwrap();
        vault.write_note("A.md", "only").unwrap();
        let create = notify::Event::new(notify::EventKind::Create(notify::event::CreateKind::File))
            .add_path(dir.path.join("A.md"));
        let modify = notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Data(
            notify::event::DataChange::Any,
        )))
        .add_path(dir.path.join("A.md"));
        let changes = vault.normalize(crate::watch::coalesce(
            &dir.path,
            &[create, rename_both(&dir.path, "A.md", "B.md", 1), modify],
            |_| false,
        ));
        assert_eq!(
            changes,
            vec![VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] }]
        );
        vault.apply(&changes);
        assert!(vault.index.contains("A.md"), "recreated source dropped out of the index");
        assert!(vault.index.contains("B.md"), "destination dropped out of the index");
        vault.write_note("A.md", "only\nnext").unwrap();
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(
            (
                fs::read_to_string(dir.path.join("A.md")).unwrap(),
                fs::read_to_string(dir.path.join("B.md")).unwrap(),
            ),
            ("only\r\nnext".to_string(), "single\nnext".to_string())
        );
    }

    /// The coalesced echo also keeps a BOM-only cache on the recreated source
    /// and the CRLF cache on the destination.
    #[test]
    fn replay_echo_single_line_coalesce_keeps_reused_bom_source() {
        let dir = tmp_dir("eol-echo-single-bom-coalesce");
        fs::write(dir.path.join("A.md"), "a\r\nb\r\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_note("A.md", "single").unwrap();
        vault.rename_path("A.md", "B.md").unwrap();
        vault.create_note("A.md", "\u{feff}only\n").unwrap();
        vault.write_note("A.md", "only").unwrap();
        let create = notify::Event::new(notify::EventKind::Create(notify::event::CreateKind::File))
            .add_path(dir.path.join("A.md"));
        let modify = notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Data(
            notify::event::DataChange::Any,
        )))
        .add_path(dir.path.join("A.md"));
        let changes = vault.normalize(crate::watch::coalesce(
            &dir.path,
            &[create, rename_both(&dir.path, "A.md", "B.md", 1), modify],
            |_| false,
        ));
        assert_eq!(
            changes,
            vec![VaultChanged { kind: ChangeKind::Rename, paths: vec!["A.md".into(), "B.md".into()] }]
        );
        vault.apply(&changes);
        assert!(vault.index.contains("A.md"), "recreated source dropped out of the index");
        assert!(vault.index.contains("B.md"), "destination dropped out of the index");
        vault.write_note("A.md", "only\nnext").unwrap();
        vault.write_note("B.md", "single\nnext").unwrap();
        assert_eq!(
            (
                fs::read_to_string(dir.path.join("A.md")).unwrap(),
                fs::read_to_string(dir.path.join("B.md")).unwrap(),
            ),
            ("\u{feff}only\nnext".to_string(), "single\r\nnext".to_string())
        );
    }

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
        assert!(vault.is_own_write("Old.md"));
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
        assert_eq!(listed(&vault, "Renamed.md").name, "Renamed");
        vault.rename_path("Renamed.md", "fresh/Moved.md").unwrap();
        assert!(dir.path.join("fresh").join("Moved.md").is_file());
        let parent = listed(&vault, "fresh");
        assert!(parent.is_dir);
        assert_eq!(parent.size, 0);
        assert_eq!(listed(&vault, "fresh/Moved.md").name, "Moved");
        assert!(vault.rename_path("nope.md", "x.md").is_err());
        assert!(vault.rename_path("../outside.md", "x.md").is_err());

        fs::create_dir(dir.path.join("box")).unwrap();
        fs::write(dir.path.join("box").join("a.md"), "in\n").unwrap();
        vault.index.refresh_path(&vault.root, "box");
        vault.rename_path("box", "carton").unwrap();
        assert!(dir.path.join("carton").join("a.md").is_file());
        assert!(listed(&vault, "carton").is_dir);
        assert_eq!(listed(&vault, "carton/a.md").path, "carton/a.md");
        assert!(vault.rename_path("carton", "carton/inner").is_err());

        vault.delete_path("fresh/Moved.md", false).unwrap();
        assert!(!dir.path.join("fresh").join("Moved.md").exists());
        assert!(dir.path.join(".trash/fresh/Moved.md").is_file());
        assert!(!vault
            .list_files()
            .iter()
            .any(|e| e.path == "fresh/Moved.md"));
        assert!(vault.index.resolve("Old.md", "Renamed").is_none());
        assert!(vault.index.resolve("Old.md", "Moved").is_none());
    }

    #[test]
    fn permanent_delete_removes_files_and_folders_without_trash() {
        let dir = tmp_dir("delete-permanent");
        fs::write(dir.path.join("Gone.md"), "bye\n").unwrap();
        fs::create_dir(dir.path.join("box")).unwrap();
        fs::write(dir.path.join("box").join("a.md"), "in\n").unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.delete_path("Gone.md", true).unwrap();
        vault.delete_path("box", true).unwrap();
        assert!(!dir.path.join("Gone.md").exists());
        assert!(!dir.path.join("box").exists());
        assert!(!dir.path.join(".trash").exists());
        assert!(vault.list_files().is_empty());
        assert!(vault.delete_path("Gone.md", true).is_err());
        assert!(vault.delete_path("../outside", true).is_err());
    }

    #[test]
    fn config_files_round_trip_and_stay_hidden() {
        let dir = tmp_dir("config");
        fs::write(dir.path.join("Note.md"), "app.json mention\n").unwrap();
        let vault = Vault::open(dir.path.clone()).unwrap();
        assert_eq!(vault.read_config("app.json").unwrap(), None);
        vault
            .write_config("app.json", "{\n  \"useWikilinks\": false\n}")
            .unwrap();
        let back = vault.read_config("app.json").unwrap().unwrap();
        assert!(back.contains("useWikilinks"));
        assert!(dir.path.join(".grove").join("app.json").is_file());
        // Not JSON, or a name outside the folder: refused, nothing written.
        assert!(vault.write_config("app.json", "{oops").is_err());
        assert!(vault.write_config("../x.json", "{}").is_err());
        assert!(vault.read_config("../Note.md").is_err());
        assert_eq!(
            vault.read_config("app.json").unwrap().unwrap(),
            back,
            "a refused write leaves the file as it was"
        );
        // The folder is never listed, indexed or searched.
        let reopened = Vault::open(dir.path.clone()).unwrap();
        assert!(reopened
            .list_files()
            .iter()
            .all(|e| !e.path.starts_with(".grove")));
        assert!(reopened
            .index.search("useWikilinks", 10)
            .iter()
            .all(|h| !h.path.starts_with(".grove")));
        // No temp files left behind.
        let names: Vec<_> = fs::read_dir(dir.path.join(".grove"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["app.json".to_string()]);
    }

    #[test]
    fn cinder_stays_hidden_and_foreign_config_reads_the_allowlist() {
        let dir = tmp_dir("foreign");
        fs::create_dir_all(dir.path.join(".cinder")).unwrap();
        fs::create_dir_all(dir.path.join("notes/.cinder")).unwrap();
        fs::create_dir_all(dir.path.join(".obsidian")).unwrap();
        let cinder = "{\"dailyFolder\":\"Daily\"}\n";
        let daily = "{\"folder\":\"Daily\"}\n";
        let templates = "{\"folder\":\"Templates\"}\n";
        let app = "{\"attachmentFolderPath\":\"Attachments\"}\n";
        fs::write(dir.path.join(".cinder/settings.json"), cinder).unwrap();
        fs::write(dir.path.join(".cinder/settings.md"), "cinder-only-token\n").unwrap();
        fs::write(dir.path.join(".cinder/README.md"), "see [[Visible]]\n").unwrap();
        fs::write(dir.path.join("notes/.cinder/hidden.md"), "nested-cinder-token\n").unwrap();
        fs::write(dir.path.join(".obsidian/daily-notes.json"), daily).unwrap();
        fs::write(dir.path.join(".obsidian/templates.json"), templates).unwrap();
        fs::write(dir.path.join(".obsidian/app.json"), app).unwrap();
        fs::write(dir.path.join(".obsidian/appearance.json"), "{\"theme\":\"moonstone\"}\n").unwrap();
        fs::write(dir.path.join("Visible.md"), "visible-token\n").unwrap();

        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let paths: Vec<_> = vault.list_files().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec!["Visible.md".to_string(), "notes".to_string()]);
        assert!(vault.index.search("cinder-only-token", 10).is_empty());
        assert!(vault.index.search("nested-cinder-token", 10).is_empty());
        assert!(vault
            .index
            .search("visible-token", 10)
            .iter()
            .any(|hit| hit.path == "Visible.md"));
        assert!(vault.index.backlinks(&["Visible.md".into()]).is_empty());
        for path in [
            ".cinder/settings.md",
            ".cinder/README.md",
            ".cinder/settings.json",
            "notes/.cinder/hidden.md",
        ] {
            assert!(vault.read_note(path).is_err(), "{path} should be refused");
            assert!(vault.write_note(path, "nope").is_err(), "{path}");
        }
        assert!(vault.create_note(".cinder/New.md", "nope").is_err());
        assert!(vault.create_folder(".cinder/folder").is_err());
        assert!(!dir.path.join(".cinder/New.md").exists());

        assert_eq!(
            vault.read_foreign_config("cinder", "settings.json").unwrap().as_deref(),
            Some(cinder)
        );
        assert_eq!(
            vault.read_foreign_config("obsidian", "daily-notes.json").unwrap().as_deref(),
            Some(daily)
        );
        assert_eq!(
            vault.read_foreign_config("obsidian", "templates.json").unwrap().as_deref(),
            Some(templates)
        );
        assert_eq!(
            vault.read_foreign_config("obsidian", "app.json").unwrap().as_deref(),
            Some(app)
        );
        // Missing is none, and a read does not create the folder or the file.
        assert_eq!(
            vault.read_foreign_config("cinder", "settings.json").unwrap().as_deref(),
            Some(cinder)
        );
        let empty = tmp_dir("foreign-missing");
        let empty_vault = Vault::open(empty.path.clone()).unwrap();
        assert_eq!(empty_vault.read_foreign_config("cinder", "settings.json").unwrap(), None);
        assert_eq!(empty_vault.read_foreign_config("obsidian", "app.json").unwrap(), None);
        assert!(!empty.path.join(".cinder").exists());
        assert!(!empty.path.join(".obsidian").exists());

        for (source, name) in [
            ("cinder", "settings.md"),
            ("cinder", "README.md"),
            ("cinder", "app.json"),
            ("obsidian", "settings.json"),
            ("obsidian", "appearance.json"),
            ("obsidian", "community-plugins.json"),
            ("notion", "settings.json"),
            ("cinder", "../Visible.md"),
            ("", ""),
        ] {
            assert!(
                vault.read_foreign_config(source, name).is_err(),
                "{source}/{name} should be refused"
            );
        }
        assert_eq!(fs::read_to_string(dir.path.join(".cinder/settings.json")).unwrap(), cinder);
        assert_eq!(fs::read_to_string(dir.path.join(".cinder/README.md")).unwrap(), "see [[Visible]]\n");
        assert_eq!(
            fs::read_to_string(dir.path.join(".obsidian/appearance.json")).unwrap(),
            "{\"theme\":\"moonstone\"}\n"
        );

        fs::remove_file(dir.path.join(".cinder/settings.json")).unwrap();
        fs::create_dir(dir.path.join(".cinder/settings.json")).unwrap();
        assert!(vault.read_foreign_config("cinder", "settings.json").is_err());
        let huge = dir.path.join(".obsidian/templates.json");
        fs::File::create(&huge)
            .unwrap()
            .set_len(crate::fsutil::CONFIG_MAX_BYTES as u64 + 1)
            .unwrap();
        assert!(vault.read_foreign_config("obsidian", "templates.json").is_err());
        assert_eq!(
            fs::metadata(&huge).unwrap().len(),
            crate::fsutil::CONFIG_MAX_BYTES as u64 + 1
        );
    }

    #[cfg(unix)]
    #[test]
    fn foreign_config_refuses_a_symlink_out_of_the_vault() {
        let dir = tmp_dir("foreign-vault-link");
        let outside = tmp_dir("foreign-vault-out");
        let secret = "{\"token\":\"outside-secret\"}\n";
        fs::write(outside.path.join("settings.json"), secret).unwrap();
        fs::write(outside.path.join("app.json"), secret).unwrap();
        std::os::unix::fs::symlink(&outside.path, dir.path.join(".cinder")).unwrap();
        fs::create_dir(dir.path.join(".obsidian")).unwrap();
        std::os::unix::fs::symlink(
            outside.path.join("app.json"),
            dir.path.join(".obsidian/app.json"),
        )
        .unwrap();
        fs::write(dir.path.join(".obsidian/daily-notes.json"), "{\"folder\":\"In\"}\n").unwrap();
        let vault = Vault::open(dir.path.clone()).unwrap();
        assert!(vault.read_foreign_config("cinder", "settings.json").is_err());
        assert!(vault.read_foreign_config("obsidian", "app.json").is_err());
        assert_eq!(
            vault.read_foreign_config("obsidian", "daily-notes.json").unwrap().as_deref(),
            Some("{\"folder\":\"In\"}\n")
        );
        assert_eq!(fs::read_to_string(outside.path.join("settings.json")).unwrap(), secret);
        assert_eq!(fs::read_to_string(outside.path.join("app.json")).unwrap(), secret);
        assert!(vault.list_files().is_empty());
    }

    #[test]
    fn read_file_bytes_reads_vault_images_only() {
        let dir = tmp_dir("bytes");
        fs::create_dir(dir.path.join("pics")).unwrap();
        fs::write(dir.path.join("pics").join("a.PNG"), [137, 80, 78, 71]).unwrap();
        fs::write(dir.path.join("Note.md"), "text").unwrap();
        fs::create_dir(dir.path.join(".grove")).unwrap();
        fs::write(dir.path.join(".grove").join("x.png"), [1]).unwrap();
        let outside = tmp_dir("bytes-outside");
        fs::write(outside.path.join("secret.png"), [2]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path.join("secret.png"), dir.path.join("link.png"))
            .unwrap();
        // Bigger than the cap, without writing 20 MB.
        fs::File::create(dir.path.join("huge.png"))
            .unwrap()
            .set_len(IMAGE_MAX_BYTES + 1)
            .unwrap();
        let vault = Vault::open(dir.path.clone()).unwrap();
        assert_eq!(
            vault.read_file_bytes("pics/a.PNG").unwrap(),
            vec![137, 80, 78, 71]
        );
        assert!(vault.read_file_bytes("Note.md").is_err(), "not an image");
        assert!(vault.read_file_bytes("pics/../../x.png").is_err());
        assert!(vault.read_file_bytes("/etc/x.png").is_err());
        assert!(vault.read_file_bytes(".grove/x.png").is_err());
        assert!(vault.read_file_bytes("missing.png").is_err());
        assert!(vault.read_file_bytes("pics").is_err());
        assert!(vault.read_file_bytes("huge.png").is_err());
        #[cfg(unix)]
        assert!(
            vault.read_file_bytes("link.png").is_err(),
            "a symlink out of the vault"
        );
    }

    #[test]
    fn write_file_bytes_stays_inside_the_vault() {
        let dir = tmp_dir("attach");
        let outside = tmp_dir("attach-out");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside.path, dir.path.join("out")).unwrap();
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let png = vec![137, 80, 78, 71];
        let made = vault
            .write_file_bytes("Pasted image 20261023201500.png", &png)
            .unwrap();
        assert_eq!(made.path, "Pasted image 20261023201500.png");
        assert!(!made.is_dir);
        assert_eq!(
            fs::read(dir.path.join("Pasted image 20261023201500.png")).unwrap(),
            png
        );
        assert_eq!(
            vault.read_file_bytes("Pasted image 20261023201500.png").unwrap(),
            png
        );
        assert!(listed(&vault, "Pasted image 20261023201500.png").size >= 4);
        // Does not overwrite.
        assert!(vault
            .write_file_bytes("Pasted image 20261023201500.png", &[1])
            .is_err());
        assert_eq!(
            fs::read(dir.path.join("Pasted image 20261023201500.png")).unwrap(),
            png
        );
        // Parents are created and listed. Empty bytes and a non-image are allowed.
        let nested = vault.write_file_bytes("pics/shot.png", &[]).unwrap();
        assert_eq!(nested.path, "pics/shot.png");
        assert!(dir.path.join("pics").join("shot.png").is_file());
        assert!(listed(&vault, "pics").is_dir);
        assert_eq!(vault.read_file_bytes("pics/shot.png").unwrap(), Vec::<u8>::new());
        vault.write_file_bytes("notes/file.pdf", b"%PDF").unwrap();
        assert!(dir.path.join("notes").join("file.pdf").is_file());
        assert!(vault.read_file_bytes("notes/file.pdf").is_err(), "not an image");
        assert!(vault.write_file_bytes("../x.png", &[1]).is_err());
        assert!(vault.write_file_bytes("/etc/x.png", &[1]).is_err());
        assert!(vault.write_file_bytes(".grove/x.png", &[1]).is_err());
        assert!(vault.write_file_bytes(".obsidian/x.png", &[1]).is_err());
        assert!(vault.write_file_bytes(".git/x.png", &[1]).is_err());
        assert!(vault.write_file_bytes(".trash/x.png", &[1]).is_err());
        assert!(vault
            .write_file_bytes("huge.png", &vec![0; IMAGE_MAX_BYTES as usize + 1])
            .is_err());
        assert!(!dir.path.join("huge.png").exists());
        #[cfg(unix)]
        assert!(
            vault.write_file_bytes("out/secret.png", &[1]).is_err(),
            "a symlink out of the vault"
        );
        #[cfg(unix)]
        assert!(!outside.path.join("secret.png").exists());
    }

    #[test]
    fn replace_file_bytes_overwrites_a_file_but_not_a_folder() {
        let dir = tmp_dir("replace");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault.write_file_bytes("Sketch.png", &[1, 2]).unwrap();
        let (again, replaced) = vault
            .replace_file_bytes("Sketch.png", &[137, 80, 78, 71])
            .unwrap();
        assert_eq!(again.path, "Sketch.png");
        assert!(replaced);
        assert_eq!(fs::read(dir.path.join("Sketch.png")).unwrap(), [137, 80, 78, 71]);
        assert!(listed(&vault, "Sketch.png").size >= 4);
        // A new path works as well, and the same checks as write_file_bytes apply.
        assert!(!vault.replace_file_bytes("out/New.png", &[1]).unwrap().1);
        assert!(dir.path.join("out").join("New.png").is_file());
        fs::create_dir(dir.path.join("Folder.png")).unwrap();
        assert!(vault.replace_file_bytes("Folder.png", &[1]).is_err());
        assert!(vault.replace_file_bytes("../x.png", &[1]).is_err());
        assert!(vault.replace_file_bytes(".grove/x.png", &[1]).is_err());
        assert!(vault
            .replace_file_bytes("Sketch.png", &vec![0; IMAGE_MAX_BYTES as usize + 1])
            .is_err());
        assert_eq!(fs::read(dir.path.join("Sketch.png")).unwrap(), [137, 80, 78, 71]);
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
        assert!(listed(&vault, "sub/Untitled").is_dir);
        assert!(vault.create_folder("sub/Untitled").is_err());
        assert!(vault.create_folder("../outside").is_err());
        assert!(vault.create_folder(".obsidian/x").is_err());
    }

    #[test]
    fn create_folder_indexes_missing_parents() {
        let dir = tmp_dir("folder-parents");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let made = vault.create_folder("new/deeper/leaf").unwrap();
        assert_eq!(made.path, "new/deeper/leaf");
        let files = vault.list_files();
        for path in ["new", "new/deeper", "new/deeper/leaf"] {
            assert!(
                files.iter().any(|e| e.path == path && e.is_dir),
                "{path} should be listed as a folder"
            );
        }
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

#[cfg(test)]
#[path = "vault_batch_tests.rs"]
mod batch_tests;
