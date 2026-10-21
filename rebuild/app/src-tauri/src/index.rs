//! In-memory file list, wikilink graph, and search.
//!
//! Wikilinks resolve by note name, case-insensitively. A name that occurs in more than one
//! folder prefers a markdown file, then the same folder as the source, then the shorter path.
//! `[[path/note]]` and `[[../note]]` resolve as vault paths. Frontmatter `alias` / `aliases`
//! are used only when no note has that name. Links inside fenced or inline code are skipped.

mod parse;
#[cfg(test)]
mod tests;

use crate::fsutil::{self, is_ignored_rel};
use crate::model::{Backlink, FileEntry, LinkIndex, SearchHit};
use parse::{clean_target, parse_note, Line, RawLink};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

const MAX_INDEX_BYTES: u64 = 8 * 1024 * 1024;

struct Node {
    is_dir: bool,
    mtime_ms: u64,
    size: u64,
    links: Vec<RawLink>,
    aliases: Vec<String>,
    lines: Vec<Line>,
}

#[derive(Default)]
pub struct Index {
    files: BTreeMap<String, Node>,
    by_name: HashMap<String, Vec<String>>,
    by_alias: HashMap<String, String>,
    by_path_lower: HashMap<String, String>,
}

impl Index {
    pub fn scan(root: &Path) -> Result<Self, String> {
        let mut idx = Index::default();
        let rd = fs::read_dir(root).map_err(|e| format!("can't read {}: {e}", root.display()))?;
        idx.walk(root, rd);
        idx.rebuild_maps();
        Ok(idx)
    }

    pub fn list(&self) -> Vec<FileEntry> {
        self.files
            .iter()
            .map(|(path, node)| FileEntry {
                path: path.clone(),
                name: display_name(path, node.is_dir),
                is_dir: node.is_dir,
                mtime_ms: node.mtime_ms,
                size: node.size,
            })
            .collect()
    }

    pub fn contains(&self, rel: &str) -> bool {
        self.files.contains_key(rel)
    }

    pub fn is_dir(&self, rel: &str) -> bool {
        self.files.get(rel).is_some_and(|n| n.is_dir)
    }

    /// `(mtime_ms, size)` for files. Directories report size 0.
    pub fn stamp(&self, rel: &str) -> Option<(u64, u64)> {
        self.files.get(rel).map(|n| (n.mtime_ms, n.size))
    }

    pub fn paths(&self) -> impl Iterator<Item = &String> {
        self.files.keys()
    }

    pub fn resolve(&self, from: &str, target: &str) -> Option<String> {
        // Heading, block, and alias suffixes are not part of the note name.
        let target = clean_target(target)?;
        let raw = target.replace('\\', "/");
        let raw = raw.trim().trim_start_matches('/');
        if raw.is_empty() {
            return None;
        }
        if raw.contains('/') {
            return self.resolve_path(from, raw);
        }
        let mut key = raw.to_lowercase();
        if let Some(stripped) = key.strip_suffix(".md") {
            key = stripped.to_string();
        }
        if let Some(cands) = self.by_name.get(&key) {
            return Some(pick(cands, from).to_string());
        }
        self.by_alias.get(&raw.to_lowercase()).cloned()
    }

    pub fn link_index(&self) -> LinkIndex {
        let mut outgoing = BTreeMap::new();
        let mut backlinks: BTreeMap<String, Vec<Backlink>> = BTreeMap::new();
        let mut markdown = BTreeMap::new();
        let mut unresolved = BTreeMap::new();
        for (path, node) in &self.files {
            if node.is_dir || !is_note_path(path) {
                continue;
            }
            let mut outs = Vec::new();
            let mut md_outs = Vec::new();
            let mut missing: Vec<String> = Vec::new();
            for link in &node.links {
                let Some(dest) = self.resolve(path, &link.target) else {
                    let name = if link.markdown {
                        strip_md(&link.target)
                    } else {
                        link.target.as_str()
                    };
                    if !missing.iter().any(|m| m.eq_ignore_ascii_case(name)) {
                        missing.push(name.to_string());
                    }
                    continue;
                };
                if link.markdown {
                    if !md_outs.contains(&dest) {
                        md_outs.push(dest);
                    }
                    continue;
                }
                if !outs.contains(&dest) {
                    outs.push(dest.clone());
                }
                backlinks.entry(dest).or_default().push(Backlink {
                    from: path.clone(),
                    line: link.line,
                    text: link.text.clone(),
                });
            }
            if !outs.is_empty() {
                outgoing.insert(path.clone(), outs);
            }
            if !md_outs.is_empty() {
                markdown.insert(path.clone(), md_outs);
            }
            if !missing.is_empty() {
                unresolved.insert(path.clone(), missing);
            }
        }
        LinkIndex {
            outgoing,
            backlinks,
            markdown,
            unresolved,
        }
    }

    /// Case-insensitive substring search. Whitespace-separated terms must all occur on the same
    /// line. File-name matches (`line == 0`) come first. Line hits are then taken round-robin
    /// across files, so one note cannot use up `limit` and hide the rest of the vault.
    pub fn search(&self, query: &str, limit: u32) -> Vec<SearchHit> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        if terms.is_empty() || limit == 0 {
            return Vec::new();
        }
        let limit = limit as usize;
        let mut name_hits = Vec::new();
        let mut line_hits = Vec::new();
        for (path, node) in &self.files {
            let name = display_name(path, node.is_dir);
            if terms.iter().all(|t| name.to_lowercase().contains(t)) {
                name_hits.push(SearchHit {
                    path: path.clone(),
                    line: 0,
                    text: name,
                });
            }
            if node.is_dir || !is_note_path(path) {
                continue;
            }
            let mut bucket = Vec::new();
            for (i, line) in node.lines.iter().enumerate() {
                if terms.iter().all(|t| line.lower.contains(t)) {
                    bucket.push(SearchHit {
                        path: path.clone(),
                        line: (i as u32) + 1,
                        text: line.text.clone(),
                    });
                }
            }
            if !bucket.is_empty() {
                line_hits.push(bucket);
            }
        }
        name_hits.truncate(limit);
        // Round-robin so one note cannot fill `limit` and hide every other file.
        let mut round = 0;
        while name_hits.len() < limit {
            let mut added = false;
            for bucket in &line_hits {
                if let Some(hit) = bucket.get(round) {
                    name_hits.push(hit.clone());
                    added = true;
                    if name_hits.len() == limit {
                        break;
                    }
                }
            }
            if !added {
                break;
            }
            round += 1;
        }
        name_hits
    }

    pub fn remove_tree(&mut self, rel: &str) {
        let prefix = format!("{rel}/");
        self.files
            .retain(|k, _| k != rel && !k.starts_with(&prefix));
        self.rebuild_maps();
    }

    /// Move `from` and everything under it to `to`. No-op when `from` is not indexed.
    pub fn relocate(&mut self, from: &str, to: &str) {
        if from == to || (!self.files.contains_key(from) && !self.has_child(from)) {
            return;
        }
        let prefix = format!("{from}/");
        let keys: Vec<String> = self
            .files
            .keys()
            .filter(|k| *k == from || k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(mut node) = self.files.remove(&key) {
                let new_key = if key == from {
                    to.to_string()
                } else {
                    format!("{to}{}", &key[from.len()..])
                };
                if !node.is_dir && !is_note_path(&new_key) {
                    node.links.clear();
                    node.aliases.clear();
                    node.lines.clear();
                }
                self.files.insert(new_key, node);
            }
        }
        // A move into a new folder should keep that folder in the file list.
        self.ensure_parent_nodes(to);
        self.rebuild_maps();
    }

    /// Reload one path from disk. A new directory also picks up children the index doesn't have.
    pub fn refresh_path(&mut self, root: &Path, rel: &str) {
        if is_ignored_rel(rel) {
            return;
        }
        let full = root.join(rel);
        match fs::symlink_metadata(&full) {
            Ok(md) if md.file_type().is_symlink() => self.remove_tree(rel),
            Ok(md) if md.is_dir() => {
                self.ensure_dirs(root, rel);
                self.insert_dir(rel, fsutil::mtime_ms(&md));
                self.adopt_children(root, rel);
                self.rebuild_maps();
            }
            Ok(md) if md.is_file() => {
                self.ensure_dirs(root, rel);
                self.read_file_node(root, rel, &md);
                self.rebuild_maps();
            }
            _ => self.remove_tree(rel),
        }
    }

    pub fn upsert_note(&mut self, root: &Path, rel: &str, content: &str, mtime_ms: u64, size: u64) {
        self.ensure_dirs(root, rel);
        let (links, aliases, lines) = if is_note_path(rel) && size <= MAX_INDEX_BYTES {
            parse_note(content)
        } else {
            (Vec::new(), Vec::new(), Vec::new())
        };
        self.files.insert(
            rel.to_string(),
            Node {
                is_dir: false,
                mtime_ms,
                size,
                links,
                aliases,
                lines,
            },
        );
        self.rebuild_maps();
    }

    fn resolve_path(&self, from: &str, raw: &str) -> Option<String> {
        let dir = parent_path(from);
        let mut cands = vec![raw.to_string(), format!("{raw}.md")];
        if !dir.is_empty() {
            cands.push(format!("{dir}/{raw}"));
            cands.push(format!("{dir}/{raw}.md"));
        }
        for cand in cands {
            let Some(norm) = norm_logical(&cand) else {
                continue;
            };
            if let Some(found) = self.by_path_lower.get(&norm.to_lowercase()) {
                return Some(found.clone());
            }
        }
        let low = raw.trim_start_matches('/').to_lowercase();
        let suf = format!("/{low}");
        let suf_md = format!("/{low}.md");
        let mut best: Option<&String> = None;
        for path in self.files.keys() {
            if self.files.get(path).is_some_and(|n| n.is_dir) {
                continue;
            }
            let pl = path.to_lowercase();
            if pl.ends_with(&suf) || pl.ends_with(&suf_md) {
                best = Some(match best {
                    None => path,
                    Some(cur) => {
                        if path.len() < cur.len()
                            || (path.len() == cur.len() && path.as_str() < cur.as_str())
                        {
                            path
                        } else {
                            cur
                        }
                    }
                });
            }
        }
        best.cloned()
    }

    fn has_child(&self, rel: &str) -> bool {
        let prefix = format!("{rel}/");
        self.files.keys().any(|k| k.starts_with(&prefix))
    }

    fn walk(&mut self, root: &Path, rd: fs::ReadDir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_ignored_rel(&name) || ignored_name(&name) {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            let path = entry.path();
            let Some(rel) = fsutil::rel_of(root, &path) else {
                continue;
            };
            if ft.is_dir() {
                let mtime = entry.metadata().map(|m| fsutil::mtime_ms(&m)).unwrap_or(0);
                self.insert_dir(&rel, mtime);
                if let Ok(child) = fs::read_dir(&path) {
                    self.walk(root, child);
                }
            } else if ft.is_file() {
                if let Ok(md) = entry.metadata() {
                    self.read_file_node(root, &rel, &md);
                }
            }
        }
    }

    fn adopt_children(&mut self, root: &Path, rel: &str) {
        let full = root.join(rel);
        let Ok(rd) = fs::read_dir(&full) else {
            return;
        };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if ignored_name(&name) {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            let child_rel = format!("{rel}/{name}");
            if self.files.contains_key(&child_rel) {
                if ft.is_dir() {
                    self.adopt_children(root, &child_rel);
                }
                continue;
            }
            if ft.is_dir() {
                let mtime = entry.metadata().map(|m| fsutil::mtime_ms(&m)).unwrap_or(0);
                self.insert_dir(&child_rel, mtime);
                self.adopt_children(root, &child_rel);
            } else if ft.is_file() {
                if let Ok(md) = entry.metadata() {
                    self.read_file_node(root, &child_rel, &md);
                }
            }
        }
    }

    fn ensure_parent_nodes(&mut self, rel: &str) {
        let mut acc = String::new();
        let parts: Vec<&str> = rel.split('/').collect();
        if parts.len() < 2 {
            return;
        }
        for part in &parts[..parts.len() - 1] {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(part);
            if !self.files.contains_key(&acc) {
                self.insert_dir(&acc, 0);
            }
        }
    }

    fn ensure_dirs(&mut self, root: &Path, rel: &str) {
        let mut acc = String::new();
        let parts: Vec<&str> = rel.split('/').collect();
        if parts.len() < 2 {
            return;
        }
        for part in &parts[..parts.len() - 1] {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(part);
            let mtime = fs::metadata(root.join(&acc))
                .map(|m| fsutil::mtime_ms(&m))
                .unwrap_or(0);
            self.insert_dir(&acc, mtime);
        }
    }

    fn insert_dir(&mut self, rel: &str, mtime_ms: u64) {
        self.files.insert(
            rel.to_string(),
            Node {
                is_dir: true,
                mtime_ms,
                size: 0,
                links: Vec::new(),
                aliases: Vec::new(),
                lines: Vec::new(),
            },
        );
    }

    fn read_file_node(&mut self, root: &Path, rel: &str, md: &fs::Metadata) {
        let size = md.len();
        let mtime_ms = fsutil::mtime_ms(md);
        let (links, aliases, lines) = if is_note_path(rel) && size <= MAX_INDEX_BYTES {
            let bytes = fs::read(root.join(rel)).unwrap_or_default();
            let text = String::from_utf8_lossy(&bytes);
            parse_note(&text)
        } else {
            (Vec::new(), Vec::new(), Vec::new())
        };
        self.files.insert(
            rel.to_string(),
            Node {
                is_dir: false,
                mtime_ms,
                size,
                links,
                aliases,
                lines,
            },
        );
    }

    fn rebuild_maps(&mut self) {
        self.by_name.clear();
        self.by_alias.clear();
        self.by_path_lower.clear();
        let mut names: HashMap<String, Vec<String>> = HashMap::new();
        for (path, node) in &self.files {
            if node.is_dir {
                continue;
            }
            self.by_path_lower.insert(path.to_lowercase(), path.clone());
            let key = display_name(path, false).to_lowercase();
            if !key.is_empty() {
                names.entry(key).or_default().push(path.clone());
            }
            if is_note_path(path) {
                for alias in &node.aliases {
                    self.by_alias
                        .entry(alias.clone())
                        .or_insert_with(|| path.clone());
                }
            }
        }
        for list in names.values_mut() {
            list.sort();
        }
        self.by_name = names;
    }

    #[cfg(test)]
    fn from_notes(notes: &[(&str, &str)]) -> Self {
        let mut idx = Index::default();
        for (path, content) in notes {
            // Parent folders exist in a real scan, so a directory rename has a node to move.
            let mut acc = String::new();
            let parts: Vec<&str> = path.split('/').collect();
            if parts.len() >= 2 {
                for part in &parts[..parts.len() - 1] {
                    if !acc.is_empty() {
                        acc.push('/');
                    }
                    acc.push_str(part);
                    if !idx.files.contains_key(&acc) {
                        idx.insert_dir(&acc, 0);
                    }
                }
            }
            let (links, aliases, lines) = parse_note(content);
            idx.files.insert(
                (*path).to_string(),
                Node {
                    is_dir: false,
                    mtime_ms: 0,
                    size: content.len() as u64,
                    links,
                    aliases,
                    lines,
                },
            );
        }
        idx.rebuild_maps();
        idx
    }
}

fn ignored_name(name: &str) -> bool {
    matches!(name, ".obsidian" | ".git" | ".trash") || name.contains(fsutil::TEMP_MARK)
}

pub fn is_note_path(path: &str) -> bool {
    let base = basename(path);
    base.len() > 3 && base[base.len() - 3..].eq_ignore_ascii_case(".md")
}

fn display_name(path: &str, is_dir: bool) -> String {
    let base = basename(path);
    if !is_dir && is_note_path(base) {
        base[..base.len() - 3].to_string()
    } else {
        base.to_string()
    }
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn parent_path(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    }
}

fn pick<'a>(cands: &'a [String], from: &str) -> &'a str {
    let dir = parent_path(from);
    cands
        .iter()
        .min_by(|a, b| {
            rank(a, dir)
                .cmp(&rank(b, dir))
                .then(a.len().cmp(&b.len()))
                .then(a.as_str().cmp(b.as_str()))
        })
        .map(|s| s.as_str())
        .unwrap_or("")
}

fn rank(path: &str, dir: &str) -> (u8, u8) {
    let md = if is_note_path(path) { 0 } else { 1 };
    let same = if parent_path(path) == dir { 0 } else { 1 };
    (md, same)
}

fn norm_logical(path: &str) -> Option<String> {
    let mut out = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if out.pop().is_none() {
                return None;
            }
        } else {
            out.push(part);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out.join("/"))
    }
}

/// A markdown link's target without its `.md`, as the graph names a note that doesn't exist.
fn strip_md(target: &str) -> &str {
    if is_note_path(target) {
        &target[..target.len() - 3]
    } else {
        target
    }
}
