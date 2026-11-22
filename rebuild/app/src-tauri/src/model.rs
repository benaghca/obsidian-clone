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
    /// Resolved targets of `[text](path)` links (not counted in `outgoing`),
    /// first-seen order, duplicates removed. Notes with none are omitted.
    pub markdown: BTreeMap<String, Vec<String>>,
    /// Link targets (wikilinks and markdown links) that match no file, as written without
    /// heading, alias or a markdown link's `.md`; deduplicated case-insensitively. Notes with
    /// none are omitted.
    pub unresolved: BTreeMap<String, Vec<String>>,
}

/// One note's part of the link index. An empty list is left out of the JSON, and a note with
/// all three empty has no links (it is left out of every `LinkIndex` map).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct LinkEntry {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub outgoing: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub markdown: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unresolved: Vec<String>,
}

/// The link index since a version the page already holds (`link_changes`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkChanges {
    /// This index's history. A page holding another id (another vault, or a reopen) gets `full`.
    pub id: u64,
    /// The version this reply brings the page to.
    pub version: u64,
    /// The version the page asked from; `changed` is relative to it. Absent with `full`.
    pub since: Option<u64>,
    /// The whole index, when the page held none, held another id, or is too far behind.
    pub full: Option<LinkIndex>,
    /// Every note whose entry changed since `since`, with its whole new entry. Empty when `full`.
    pub changed: BTreeMap<String, LinkEntry>,
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

/// One search-view result; the frontend owns sorting and exclusions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchNote {
    pub path: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchLine {
    pub line: u32,
    pub text: String,
}
