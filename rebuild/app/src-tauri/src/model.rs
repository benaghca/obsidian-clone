//! JSON shapes the front end receives. Field names match the contract.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
}

impl VaultInfo {
    pub fn from_path(path: &Path) -> Self {
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| path.display().to_string());
        Self {
            path: path.display().to_string(),
            name,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct FileEntry {
    /// Vault-relative, forward slashes, no leading slash.
    pub path: String,
    /// File name with a trailing `.md` removed. Directories and other files keep their name.
    pub name: String,
    pub is_dir: bool,
    pub mtime_ms: u64,
    /// When it was created (its modified time where the file system doesn't keep that; 0 for folders).
    pub ctime_ms: u64,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchHit {
    pub path: String,
    /// 1-based line in the note. `0` is a file-name match; `text` is then the display name.
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Backlink {
    pub from: String,
    /// 1-based line of the wikilink in `from`.
    pub line: u32,
    /// The full line, without its trailing newline.
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkIndex {
    /// Resolved target paths, first-seen order, duplicates removed. Notes with none are omitted.
    pub outgoing: BTreeMap<String, Vec<String>>,
    /// Notes nothing links to are omitted.
    pub backlinks: BTreeMap<String, Vec<Backlink>>,
    /// Resolved targets of `[text](path)` links (not counted in `outgoing` or `backlinks`),
    /// first-seen order, duplicates removed. Notes with none are omitted.
    pub markdown: BTreeMap<String, Vec<String>>,
    /// Link targets (wikilinks and markdown links) that match no file, as written without
    /// heading, alias or a markdown link's `.md`; deduplicated case-insensitively. Notes with
    /// none are omitted.
    pub unresolved: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Create,
    Modify,
    Remove,
    Rename,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultChanged {
    pub kind: ChangeKind,
    /// For `rename`, exactly `[from, to]`. A renamed directory covers everything under it.
    pub paths: Vec<String>,
}

/// Add a change to `out`, unless it has no paths.
pub fn push_change(out: &mut Vec<VaultChanged>, kind: ChangeKind, paths: Vec<String>) {
    if !paths.is_empty() {
        out.push(VaultChanged { kind, paths });
    }
}
