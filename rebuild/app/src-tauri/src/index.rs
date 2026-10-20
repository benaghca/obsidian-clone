//! In-memory file list, wikilink graph, and search.
//!
//! Wikilinks resolve by note name, case-insensitively. A name that occurs in more than one
//! folder prefers a markdown file, then the same folder as the source, then the shorter path.
//! `[[path/note]]` and `[[../note]]` resolve as vault paths. Frontmatter `alias` / `aliases`
//! are used only when no note has that name. Links inside fenced or inline code are skipped.

use crate::fsutil::{self, is_ignored_rel};
use crate::model::{Backlink, FileEntry, LinkIndex, SearchHit};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

const MAX_INDEX_BYTES: u64 = 8 * 1024 * 1024;

struct Line {
    text: String,
    lower: String,
}

struct RawLink {
    line: u32,
    text: String,
    target: String,
}

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
        for (path, node) in &self.files {
            if node.is_dir || !is_note_path(path) {
                continue;
            }
            let mut outs = Vec::new();
            for link in &node.links {
                let Some(dest) = self.resolve(path, &link.target) else {
                    continue;
                };
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
        }
        LinkIndex {
            outgoing,
            backlinks,
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

fn parse_note(content: &str) -> (Vec<RawLink>, Vec<String>, Vec<Line>) {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let aliases = parse_aliases(content);
    let mut links = Vec::new();
    let mut lines = Vec::new();
    let mut in_fence = false;
    let mut fence_marker = 0u8;
    let mut fence_len = 0usize;
    for (idx, line) in content.lines().enumerate() {
        let line_no = (idx as u32) + 1;
        if in_fence {
            if fence_close(line, fence_marker, fence_len) {
                in_fence = false;
            }
            lines.push(Line {
                lower: line.to_lowercase(),
                text: line.to_string(),
            });
            continue;
        }
        if let Some((marker, len)) = fence_open(line) {
            in_fence = true;
            fence_marker = marker;
            fence_len = len;
            lines.push(Line {
                lower: line.to_lowercase(),
                text: line.to_string(),
            });
            continue;
        }
        let blanked = blank_inline_code(line);
        for target in wiki_targets(&blanked) {
            links.push(RawLink {
                line: line_no,
                text: line.to_string(),
                target,
            });
        }
        lines.push(Line {
            lower: line.to_lowercase(),
            text: line.to_string(),
        });
    }
    (links, aliases, lines)
}

fn fence_open(line: &str) -> Option<(u8, usize)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let bytes = trimmed.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let marker = bytes[0];
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let mut n = 0;
    while n < bytes.len() && bytes[n] == marker {
        n += 1;
    }
    if n < 3 {
        return None;
    }
    if marker == b'`' && trimmed[n..].contains('`') {
        return None;
    }
    Some((marker, n))
}

fn fence_close(line: &str, marker: u8, len: usize) -> bool {
    let trimmed = line.trim();
    let bytes = trimmed.as_bytes();
    bytes.len() >= len && bytes.iter().all(|b| *b == marker)
}

fn blank_inline_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = chars.clone();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '`' {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && chars[i] == '`' {
            i += 1;
        }
        let n = i - start;
        let mut j = i;
        let mut end = None;
        while j < chars.len() {
            if chars[j] != '`' {
                j += 1;
                continue;
            }
            let run = j;
            while j < chars.len() && chars[j] == '`' {
                j += 1;
            }
            if j - run == n {
                end = Some(j);
                break;
            }
        }
        if let Some(end) = end {
            for slot in &mut out[start..end] {
                *slot = ' ';
            }
            i = end;
        }
    }
    out.into_iter().collect()
}

fn wiki_targets(line: &str) -> Vec<String> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if let Some(close) = find_bytes(bytes, i + 2, b']', b']') {
                let inner = &line[i + 2..close];
                if !inner.contains('[') && !inner.contains(']') {
                    if let Some(target) = clean_target(inner) {
                        out.push(target);
                    }
                }
                i = close + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn find_bytes(bytes: &[u8], from: usize, a: u8, b: u8) -> Option<usize> {
    let mut i = from;
    while i + 1 < bytes.len() {
        if bytes[i] == a && bytes[i + 1] == b {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn clean_target(inner: &str) -> Option<String> {
    let inner = inner.trim();
    if inner.is_empty() {
        return None;
    }
    // `\|` is how a table cell writes a literal pipe inside `[[Note|alias]]`.
    let normalized = inner.replace("\\|", "|");
    let tgt = match normalized.split_once('|') {
        Some((head, _)) => head,
        None => normalized.as_str(),
    };
    let name = match tgt.split_once('#') {
        Some((head, _)) => head,
        None => tgt,
    };
    let name = name.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn parse_aliases(content: &str) -> Vec<String> {
    let Some(lines) = frontmatter_lines(content) else {
        return Vec::new();
    };
    let mut aliases = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        let rest = key_rest(trimmed, "aliases").or_else(|| key_rest(trimmed, "alias"));
        let Some(rest) = rest else {
            i += 1;
            continue;
        };
        let rest = rest.trim();
        if rest.is_empty() {
            i += 1;
            while i < lines.len() {
                let raw = lines[i];
                if !(raw.starts_with(' ') || raw.starts_with('\t')) {
                    break;
                }
                let item = raw.trim();
                let Some(item) = item.strip_prefix('-') else {
                    break;
                };
                if let Some(value) = yaml_scalar(item) {
                    aliases.push(value.to_lowercase());
                }
                i += 1;
            }
            continue;
        }
        if let Some(inner) = rest.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            for value in split_csv(inner) {
                aliases.push(value.to_lowercase());
            }
        } else if let Some(value) = yaml_scalar(rest) {
            aliases.push(value.to_lowercase());
        }
        i += 1;
    }
    aliases
}

fn frontmatter_lines(content: &str) -> Option<Vec<&str>> {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return None;
    }
    let mut out = Vec::new();
    for line in lines {
        if line.trim() == "---" {
            return Some(out);
        }
        out.push(line);
    }
    None
}

fn key_rest<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.strip_prefix(key)?.strip_prefix(':')
}

fn split_csv(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in s.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => quote = Some(c),
            None if c == ',' => {
                if let Some(value) = yaml_scalar(&cur) {
                    out.push(value);
                }
                cur.clear();
            }
            None => cur.push(c),
        }
    }
    if let Some(value) = yaml_scalar(&cur) {
        out.push(value);
    }
    out
}

fn yaml_scalar(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s == "~" || s.eq_ignore_ascii_case("null") {
        return None;
    }
    let s = if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')))
    {
        &s[1..s.len() - 1]
    } else {
        s
    };
    let s = s.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fsutil::tmp_dir;
    use serde_json::json;
    use std::fs;
    use std::time::Instant;

    fn sample() -> Index {
        Index::from_notes(&[
            ("Hello.md", "See [[World]] and [[missing]]\n"),
            ("world.md", "back\n"),
            ("sub/Deep.md", "[[Hello#Heading|alias]] and ![[world]]\n"),
            ("a/Note.md", "local\n"),
            ("b/Note.md", "other\n"),
            ("a/Source.md", "[[Note]]\n"),
            ("b/Source.md", "[[Note]]\n"),
            ("Root.md", "[[Note]]\n"),
            ("pic.png", ""),
            (
                "Nick.md",
                "---\naliases:\n  - Nickname\n  - \"Second Name\"\nalias: Also\n---\nbody [[Hello]]\n",
            ),
            ("Code.md", "before [[World]]\n```\n[[notcode]]\n```\n`[[nope]]` [[World]]\n"),
        ])
    }

    #[test]
    fn resolves_names_paths_aliases_and_skips_code() {
        let idx = sample();
        assert_eq!(
            idx.resolve("Hello.md", "world").as_deref(),
            Some("world.md")
        );
        assert_eq!(
            idx.resolve("Hello.md", "WORLD").as_deref(),
            Some("world.md")
        );
        assert_eq!(
            idx.resolve("sub/Deep.md", "Hello#Heading").as_deref(),
            Some("Hello.md")
        );
        assert_eq!(
            idx.resolve("a/Source.md", "Note").as_deref(),
            Some("a/Note.md")
        );
        assert_eq!(
            idx.resolve("b/Source.md", "Note").as_deref(),
            Some("b/Note.md")
        );
        assert_eq!(idx.resolve("Root.md", "Note").as_deref(), Some("a/Note.md"));
        assert_eq!(
            idx.resolve("Root.md", "b/Note").as_deref(),
            Some("b/Note.md")
        );
        assert_eq!(
            idx.resolve("Root.md", "b/Note.md").as_deref(),
            Some("b/Note.md")
        );
        assert_eq!(
            idx.resolve("sub/Deep.md", "../world").as_deref(),
            Some("world.md")
        );
        assert_eq!(
            idx.resolve("Root.md", "pic.png").as_deref(),
            Some("pic.png")
        );
        assert_eq!(
            idx.resolve("Root.md", "Nickname").as_deref(),
            Some("Nick.md")
        );
        assert_eq!(
            idx.resolve("Root.md", "second name").as_deref(),
            Some("Nick.md")
        );
        // A real note name wins over an alias.
        assert_eq!(idx.resolve("Root.md", "Hello").as_deref(), Some("Hello.md"));
        assert!(idx.resolve("Root.md", "missing").is_none());
        assert!(idx.resolve("Root.md", "#Heading").is_none());

        let links = idx.link_index();
        let value = serde_json::to_value(&links).unwrap();
        assert_eq!(value["outgoing"]["Hello.md"], json!(["world.md"]));
        assert_eq!(
            value["outgoing"]["sub/Deep.md"],
            json!(["Hello.md", "world.md"])
        );
        assert_eq!(value["outgoing"]["Code.md"], json!(["world.md"]));
        assert!(
            value["outgoing"]
                .get("Code.md")
                .unwrap()
                .as_array()
                .unwrap()
                .len()
                == 1
        );
        let backs = value["backlinks"]["world.md"].as_array().unwrap();
        assert!(backs.iter().any(|b| b["from"] == "Hello.md"
            && b["line"] == 1
            && b["text"] == "See [[World]] and [[missing]]"));
        assert!(backs
            .iter()
            .all(|b| b["from"] != "nope" && !b["text"].as_str().unwrap().contains("notcode")));
        // Two mentions in Code.md, both to world, one line each that survived the fence.
        let from_code: Vec<_> = backs.iter().filter(|b| b["from"] == "Code.md").collect();
        assert_eq!(from_code.len(), 2);
    }

    #[test]
    fn duplicate_links_on_one_line_dedupe_outgoing() {
        let idx = Index::from_notes(&[("a.md", "[[Hello]] and [[hello]]\n"), ("Hello.md", "x\n")]);
        let links = idx.link_index();
        assert_eq!(
            links.outgoing.get("a.md").unwrap(),
            &vec!["Hello.md".to_string()]
        );
        assert_eq!(links.backlinks.get("Hello.md").unwrap().len(), 2);
    }

    #[test]
    fn scan_skips_hidden_dirs_and_names_notes() {
        let dir = tmp_dir("scan");
        fs::create_dir_all(dir.path.join(".obsidian")).unwrap();
        fs::create_dir_all(dir.path.join(".git")).unwrap();
        fs::create_dir_all(dir.path.join(".trash")).unwrap();
        fs::create_dir_all(dir.path.join("sub")).unwrap();
        fs::write(dir.path.join(".obsidian").join("app.json"), "{}").unwrap();
        fs::write(dir.path.join(".git").join("config"), "").unwrap();
        fs::write(dir.path.join(".trash").join("old.md"), "[[Hello]]").unwrap();
        fs::write(dir.path.join("Hello.md"), "[[sub/Deep]]\n").unwrap();
        fs::write(dir.path.join("sub").join("Deep.md"), "hi\n").unwrap();
        fs::write(dir.path.join("pic.png"), "x").unwrap();
        fs::write(dir.path.join(format!("skip{}", fsutil::TEMP_MARK)), "nope").unwrap();

        let idx = Index::scan(&dir.path).unwrap();
        let list = idx.list();
        let paths: Vec<_> = list.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["Hello.md", "pic.png", "sub", "sub/Deep.md"]);
        let hello = list.iter().find(|e| e.path == "Hello.md").unwrap();
        assert_eq!(hello.name, "Hello");
        assert!(!hello.is_dir);
        assert_eq!(
            hello.size,
            fs::metadata(dir.path.join("Hello.md")).unwrap().len()
        );
        assert!(hello.mtime_ms > 0);
        let sub = list.iter().find(|e| e.path == "sub").unwrap();
        assert!(sub.is_dir);
        assert_eq!(sub.name, "sub");
        assert_eq!(sub.size, 0);
        assert_eq!(
            idx.resolve("Hello.md", "Deep").as_deref(),
            Some("sub/Deep.md")
        );
        assert!(idx.link_index().backlinks.get("Hello.md").is_none());
    }

    #[test]
    fn rename_moves_children_and_resolution_follows() {
        let mut idx = Index::from_notes(&[
            ("dir/a.md", "see [[b]]\n"),
            ("dir/b.md", "target\n"),
            ("other.md", "[[b]]\n"),
        ]);
        assert_eq!(idx.resolve("dir/a.md", "b").as_deref(), Some("dir/b.md"));
        idx.relocate("dir", "dir2");
        assert!(!idx.contains("dir"));
        assert!(!idx.contains("dir/a.md"));
        assert!(idx.contains("dir2"));
        assert!(idx.contains("dir2/a.md"));
        assert!(idx.contains("dir2/b.md"));
        assert_eq!(idx.resolve("dir2/a.md", "b").as_deref(), Some("dir2/b.md"));
        assert_eq!(idx.resolve("other.md", "b").as_deref(), Some("dir2/b.md"));
        idx.relocate("dir2/b.md", "Renamed.md");
        // The file moved, but the link text is still `[[b]]`. The front end rewrites links.
        assert_eq!(
            idx.resolve("dir2/a.md", "Renamed").as_deref(),
            Some("Renamed.md")
        );
        assert!(idx.resolve("dir2/a.md", "b").is_none());
        let links = idx.link_index();
        assert!(links.outgoing.get("dir2/a.md").is_none());
        assert!(links.backlinks.get("Renamed.md").is_none());
    }

    #[test]
    fn search_is_case_insensitive_and_ranks_names_first() {
        let idx = Index::from_notes(&[
            ("Garden.md", "flowers\n"),
            (
                "notes/Log.md",
                "planted a garden today\nsecond line alpha beta\n",
            ),
            ("Skip.md", "alpha\nbeta\n"),
        ]);
        let hits = idx.search("GARD", 10);
        assert_eq!(hits[0].path, "Garden.md");
        assert_eq!(hits[0].line, 0);
        assert_eq!(hits[0].text, "Garden");
        assert!(hits
            .iter()
            .any(|h| h.path == "notes/Log.md" && h.line == 1 && h.text.contains("garden")));
        let both = idx.search("alpha beta", 10);
        assert!(both.iter().any(|h| h.path == "notes/Log.md" && h.line == 2));
        assert!(!both.iter().any(|h| h.path == "Skip.md" && h.line > 0));
        assert!(idx.search("   ", 10).is_empty());
        assert!(idx.search("garden", 0).is_empty());
        let limited = idx.search("garden", 1);
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].line, 0);
    }

    #[test]
    fn search_of_a_thousand_notes_stays_well_under_the_budget() {
        let mut idx = Index::default();
        for n in 0..1000 {
            let path = format!("n{n}.md");
            let body = format!("note {n}\nline with token-{n} inside a garden of words\n");
            let (links, aliases, lines) = parse_note(&body);
            idx.files.insert(
                path,
                Node {
                    is_dir: false,
                    mtime_ms: 0,
                    size: body.len() as u64,
                    links,
                    aliases,
                    lines,
                },
            );
        }
        idx.rebuild_maps();
        let started = Instant::now();
        let hits = idx.search("token-42", 20);
        assert!(
            started.elapsed().as_millis() < 1000,
            "search took {:?}",
            started.elapsed()
        );
        assert!(hits.iter().any(|h| h.path == "n42.md" && h.line == 2));
    }
}
