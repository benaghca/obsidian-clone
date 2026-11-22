//! In-memory file list, wikilink graph, tags, and search.
//!
//! Wikilinks resolve by note name, case-insensitively. A name that occurs in more than one
//! folder prefers a markdown file, then the same folder as the source, then the shorter path.
//! `[[path/note]]` and `[[../note]]` resolve as vault paths. Frontmatter `alias` / `aliases`
//! are used only when no note has that name. Links inside fenced or inline code are skipped.

mod file_map;
mod parse;
pub(crate) mod props;
pub use props::NoteProperties;
mod query;
mod search;
mod tags;
mod backlinks;
mod link_sources;
mod link_jobs;
mod link_replies;
mod link_table;
mod name_maps;
mod rescan;
pub(crate) use rescan::RescanDiff;
#[cfg(test)]
pub(crate) use rescan::check_rescans;
#[cfg(test)]
mod bench;
#[cfg(test)]
mod link_table_tests;
#[cfg(test)]
mod name_maps_tests;
#[cfg(test)]
mod parity;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod search_props_edge;

use crate::fsutil::{self, is_ignored_rel};
use crate::model::{FileEntry, LinkEntry, SearchHit};
#[cfg(test)]
use crate::model::{LinkChanges, LinkIndex};
pub(crate) use link_jobs::LinkSlice;
pub(crate) use link_replies::{BacklinkReply, LinkReply, ReplyStep};
use link_table::{LinkTable, Replaced, Resolved};
use name_maps::{Lookups, NameMaps, Src};
use parse::{clean_target, parse_note, Note, RawLink};
#[cfg(test)]
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::Path;
use std::sync::Arc;

// Real name-map rebuilds, and file nodes visited by `Index::list`.
// `take_*` resets the counter. A deferred rebuild counts when the maps are
// built, not once per file that asked. `entry` does not visit the list.
// Walking the file list itself is counted in `file_map` (`take_file_visits`).
#[cfg(test)]
thread_local! {
    static REBUILD_MAPS_CALLS: Cell<usize> = const { Cell::new(0) };
    static LIST_WALKS: Cell<usize> = const { Cell::new(0) };
    static MAP_UPDATES: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
pub(crate) use file_map::take_file_visits;
#[cfg(test)]
pub(crate) use search::set_search_note_hook;

#[cfg(test)]
pub(crate) fn take_rebuild_maps_calls() -> usize {
    REBUILD_MAPS_CALLS.with(|cell| cell.replace(0))
}

#[cfg(test)]
pub(crate) fn take_list_walks() -> usize {
    LIST_WALKS.with(|cell| cell.replace(0))
}

/// Per-path name-map updates (one per node added to or removed from the maps).
#[cfg(test)]
pub(crate) fn take_map_updates() -> usize {
    MAP_UPDATES.with(|cell| cell.replace(0))
}

#[cfg(test)]
fn count_map_update() {
    MAP_UPDATES.with(|cell| cell.set(cell.get() + 1));
}

#[cfg(test)]
fn count_rebuild_maps() {
    REBUILD_MAPS_CALLS.with(|cell| cell.set(cell.get() + 1));
}

#[cfg(test)]
fn count_list_walk(nodes: usize) {
    LIST_WALKS.with(|cell| cell.set(cell.get() + nodes));
}

const MAX_INDEX_BYTES: u64 = 8 * 1024 * 1024;

/// Above this many paths, a tree delete rebuilds the maps once instead of updating them
/// path by path, and so does a `MapBatch` after this many per-path updates in total (a
/// watcher batch of many separate file events). Per path costs microseconds, but each
/// update shifts its sorted lists, so many same-named files (`README.md` in every folder)
/// would make a large delete quadratic. Below it, even a list as long as the vault costs
/// about one full rebuild.
pub(crate) const BULK_PATHS: usize = 256;

/// A file's modified and created times (ms since the epoch, 0 when unknown) and size.
#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Stamp {
    pub mtime_ms: u64,
    pub ctime_ms: u64,
    pub size: u64,
}

impl Stamp {
    pub fn of(md: &fs::Metadata) -> Self {
        Stamp {
            mtime_ms: fsutil::mtime_ms(md),
            ctime_ms: fsutil::ctime_ms(md),
            size: md.len(),
        }
    }

    #[cfg(test)]
    fn sized(size: usize) -> Self {
        Stamp {
            size: size as u64,
            ..Stamp::default()
        }
    }
}

#[derive(Clone, Default)]
struct Node {
    is_dir: bool,
    stamp: Stamp,
    note: Note,
}

#[derive(Default)]
pub struct Index {
    files: file_map::Files,
    // Present only while the watcher scans without the state lock. Unlike echo
    // suppression, this journal cannot expire before the replacement is installed.
    rescan_changes: Option<BTreeSet<String>>,
    // Note names, aliases, lower-case paths, and partial paths, for `resolve`.
    // `put_node` / `take_node` update them for the one path they touch.
    maps: NameMaps,
    // While > 0, `rebuild_maps` only marks the maps stale. The outermost
    // `MapBatch` rebuilds once. `apply` and `rename_path` hold that guard
    // until every path in the batch is in its final place.
    defer_depth: u32,
    // The maps do not match `files`. `put_node` / `take_node` leave them alone
    // until the full rebuild that is pending (on the outermost `MapBatch` drop,
    // or at the end of the `scan` / `refresh_path` that marked them).
    maps_dirty: bool,
    // Per-path map updates since the outermost `MapBatch` opened. Past `BULK_PATHS`
    // the maps go stale and that batch rebuilds once on drop.
    batch_updates: usize,
    // Every note's resolved links, kept in step with `files` and `maps` (see `link_table`).
    // `put_node` / `take_node` queue the notes to resolve again; `settle_links` resolves
    // them when the change is done. A full map rebuild resolves every note (with `defer_links`
    // on, review 6: queues every note, for `link_jobs` to resolve off the lock).
    links: LinkTable,
    // Review 2: a change that wakes more than `INLINE_LINKS` notes (or more than
    // `INLINE_LINK_WORK` links) leaves them queued instead of resolving them before the write
    // returns. The app reads links through `link_reads`, which resolves the queue off the lock
    // (`link_jobs`). Off by default (tests and tools see every change settled when it returns).
    // `Some(n)`: defer past n notes.
    defer_links: Option<usize>,
    // Every node and map-key change, for work done off the lock (`link_jobs`, `link_replies`):
    // it stores what it gathered only if nothing it read changed meanwhile.
    edits: Edits,
}

/// One file or map change, as work off the lock checks for it.
#[derive(Debug)]
pub(crate) enum Edit {
    /// A map key gained or lost an owner.
    Key(name_maps::KeyHash),
    /// A path's node was replaced, added, or removed.
    Node(Arc<str>),
    /// A note's resolved links changed (review 4: a link can move between targets with the
    /// note's entry unchanged, so `backlinks` replies patch from these too).
    Entry(Arc<str>),
}

/// The last `EDIT_LOG` edits. A full map rebuild starts a new `epoch` (from one counter for
/// every index, so a fresh index never repeats one): work begun before it is dropped.
#[derive(Debug, Default)]
struct Edits {
    epoch: u64,
    seq: u64,
    /// The log holds every edit after `floor`.
    floor: u64,
    log: std::collections::VecDeque<(u64, Edit)>,
}

/// Where the edits stood when work began.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EditMark {
    epoch: u64,
    seq: u64,
}

const EDIT_LOG: usize = 65_536;

impl Edits {
    fn note(&mut self, edit: Edit) {
        self.seq += 1;
        self.log.push_back((self.seq, edit));
        if self.log.len() > EDIT_LOG {
            let (gone, _) = self.log.pop_front().expect("log is not empty");
            self.floor = gone;
        }
    }

    fn restart(&mut self) {
        self.epoch = NEXT_EPOCH.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.log.clear();
        self.floor = self.seq;
    }
}

/// Notes a change may re-resolve before it returns when `defer_links` is on. A save, a rename,
/// or an alias edit with this many linkers or fewer settles at once, as before.
pub(crate) const INLINE_LINKS: usize = 256;

/// Links those notes may hold in all (review 3: one note with thousands of links waits too).
pub(crate) const INLINE_LINK_WORK: usize = 2_048;

static NEXT_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Holds name-map rebuilds, then rebuilds once on drop if anything asked.
/// Nested guards rebuild on the outermost drop.
#[must_use = "hold the guard until the batch's last file change"]
pub(crate) struct MapBatch<'a> {
    index: &'a mut Index,
}

impl Drop for MapBatch<'_> {
    fn drop(&mut self) {
        self.index.defer_depth -= 1;
        if self.index.defer_depth == 0 {
            self.index.batch_updates = 0;
            if self.index.maps_dirty {
                self.index.maps_dirty = false;
                self.index.rebuild_maps();
            }
            self.index.settle_links();
        }
    }
}

impl MapBatch<'_> {
    pub(crate) fn remove_tree(&mut self, rel: &str) {
        self.index.remove_tree(rel);
    }

    pub(crate) fn relocate(&mut self, from: &str, to: &str) {
        self.index.relocate(from, to);
    }

    pub(crate) fn refresh_path(&mut self, root: &Path, rel: &str) {
        self.index.refresh_path(root, rel);
    }
}

impl Index {
    pub fn scan(root: &Path) -> Result<Self, String> {
        let rd = fs::read_dir(root).map_err(|e| format!("can't read {}: {e}", root.display()))?;
        // One full build at the end beats one sorted insert per file.
        let mut idx = Index::stale();
        idx.add_children(root, "", rd);
        idx.rebuild_maps();
        Ok(idx)
    }

    pub fn list(&self) -> Vec<FileEntry> {
        #[cfg(test)]
        count_list_walk(self.files.len());
        self.files
            .iter()
            .map(|(path, node)| file_entry(path, node))
            .collect()
    }

    /// One file-list row, read from that path's node.
    pub(crate) fn entry(&self, rel: &str) -> Option<FileEntry> {
        self.files.get(rel).map(|node| file_entry(rel, node))
    }

    pub fn contains(&self, rel: &str) -> bool {
        self.files.contains_key(rel)
    }

    pub fn is_dir(&self, rel: &str) -> bool {
        self.files.get(rel).is_some_and(|n| n.is_dir)
    }

    /// Its times and size. Directories report size 0.
    pub fn stamp(&self, rel: &str) -> Option<Stamp> {
        self.files.get(rel).map(|n| n.stamp)
    }

    #[cfg(test)]
    pub fn paths(&self) -> impl Iterator<Item = &String> {
        self.files.keys()
    }

    pub fn resolve(&self, from: &str, target: &str) -> Option<String> {
        resolve_in(&mut Lookups::new(&self.maps), from, target)
    }

    /// Every note's resolved links, read from the link table (no resolving here). The app reads
    /// through `link_reads` instead, which settles first and copies in steps.
    #[cfg(test)]
    pub fn link_index(&self) -> LinkIndex {
        debug_assert!(!self.links.has_pending(), "link table read before it settled");
        self.links.link_index()
    }

    /// What changed in `link_index` since `since` (an id and version an earlier reply gave),
    /// or the whole index when the page holds none, another id, or is too far behind.
    #[cfg(test)]
    pub fn link_changes(&self, since: Option<(u64, u64)>) -> LinkChanges {
        debug_assert!(!self.links.has_pending(), "link table read before it settled");
        self.links.changes(since)
    }

    /// Leave large link updates queued for `link_reads` (the app; see `defer_links`).
    pub(crate) fn set_defer_links(&mut self, on: bool) {
        self.defer_links = on.then_some(INLINE_LINKS);
    }

    /// Another index's deferral (a rescan's fresh index takes the live one's before replaying).
    pub(crate) fn defer_links_like(&mut self, other: &Index) {
        self.defer_links = other.defer_links;
    }

    /// Where the edits stand now.
    pub(crate) fn edit_mark(&self) -> EditMark {
        EditMark { epoch: self.edits.epoch, seq: self.edits.seq }
    }

    /// The edits since `mark`, or `None` when they are not known (a full rebuild since, or
    /// more edits than the log keeps): treat everything as changed.
    pub(crate) fn edits_since(&self, mark: EditMark) -> Option<impl Iterator<Item = &Edit>> {
        let e = &self.edits;
        if e.epoch != mark.epoch || mark.seq < e.floor {
            return None;
        }
        let from = e.log.partition_point(|(seq, _)| *seq <= mark.seq);
        Some(e.log.range(from..).map(|(_, edit)| edit))
    }

    /// At most `n` of the edits after `mark`, the mark after them, and whether they were the
    /// last (review 5: a publish reads the log in bounded steps). `None` as for `edits_since`.
    pub(crate) fn edits_after(&self, mark: EditMark, n: usize) -> Option<(impl Iterator<Item = &Edit>, EditMark, bool)> {
        let e = &self.edits;
        if e.epoch != mark.epoch || mark.seq < e.floor {
            return None;
        }
        let from = e.log.partition_point(|(seq, _)| *seq <= mark.seq);
        let end = from.saturating_add(n).min(e.log.len());
        let seq = if end > from { e.log[end - 1].0 } else { mark.seq };
        Some((e.log.range(from..end).map(|(_, edit)| edit), EditMark { epoch: mark.epoch, seq }, end == e.log.len()))
    }

    /// The paths of node and entry edits after `since` up to `until`, skipping the first `skip`
    /// edits there and reading at most `n`: (paths, edits read, whether that was the last).
    /// `None` when they are not known any more.
    pub(crate) fn edited_paths(&self, since: EditMark, until: EditMark, skip: usize, n: usize) -> Option<(Vec<Arc<str>>, usize, bool)> {
        let e = &self.edits;
        if e.epoch != since.epoch || since.seq < e.floor {
            return None;
        }
        let from = (e.log.partition_point(|(seq, _)| *seq <= since.seq) + skip).min(e.log.len());
        let (mut paths, mut read) = (Vec::new(), 0);
        for (seq, edit) in e.log.range(from..) {
            if *seq > until.seq {
                return Some((paths, read, true));
            }
            if read == n {
                return Some((paths, read, false));
            }
            read += 1;
            if let Edit::Node(path) | Edit::Entry(path) = edit {
                paths.push(Arc::clone(path));
            }
        }
        Some((paths, read, true))
    }

    /// Defer every link update past `n` queued notes (tests: 0 defers them all).
    #[cfg(test)]
    pub(crate) fn defer_links_over(&mut self, n: usize) {
        self.defer_links = Some(n);
    }

    /// Notes queued to resolve again. Link reads (`link_index`, `link_changes`, `backlinks`)
    /// need none queued.
    pub(crate) fn links_pending(&self) -> bool {
        self.links.has_pending()
    }

    /// Resolve queued notes until none remain or `deadline` passes (checked every few notes).
    /// True when none remain. Each call logs its changes as one version.
    pub(crate) fn settle_links_until(&mut self, deadline: std::time::Instant) -> bool {
        if self.defer_depth > 0 || self.maps_dirty {
            return !self.links.has_pending();
        }
        let mut changed = Vec::new();
        while self.links.has_pending() {
            self.links.sweep(SETTLE_STEP, &self.files);
            self.links.expand(SETTLE_STEP);
            for path in self.links.take_some(SETTLE_STEP) {
                let resolved = self
                    .files
                    .get(&path)
                    .filter(|node| has_links(&path, node))
                    .map(|node| resolve_note(&self.maps, &path, &node.note.links));
                let replaced = self.links.replace(Arc::clone(&path), resolved);
                if replaced != Replaced::Same {
                    self.edits.note(Edit::Entry(Arc::clone(&path)));
                }
                if replaced == Replaced::Entry {
                    changed.push(path);
                }
            }
            if std::time::Instant::now() >= deadline {
                break;
            }
        }
        self.links.record(changed);
        !self.links.has_pending()
    }

    /// Tests: notes a bulk change's link walk looked at on this thread, in all and in its
    /// largest step (resets; see `LinkTable::sweep`).
    #[cfg(test)]
    pub(crate) fn take_swept() -> (usize, usize) {
        link_table::take_swept()
    }

    /// Resolve every queued note now.
    #[cfg(test)]
    pub(crate) fn settle_links_now(&mut self) {
        let far = std::time::Instant::now() + std::time::Duration::from_secs(3600);
        while !self.settle_links_until(far) {}
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
            // A file named ".md" is not a note. Its display name is the whole
            // filename, so a search for "md" would otherwise hit it.
            if nameless_md(path) {
                continue;
            }
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
            for (i, line) in node.note.lines.iter().enumerate() {
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

    /// Each note's frontmatter (see `Note::frontmatter`), for `paths` or every note. Notes
    /// without one, and paths that aren't notes, are left out.
    pub fn frontmatter(&self, paths: Option<&[String]>) -> BTreeMap<String, String> {
        let block = |path: &String| {
            let node = self
                .files
                .get(path)
                .filter(|n| !n.is_dir && is_note_path(path))?;
            node.note.frontmatter().map(|text| (path.clone(), text))
        };
        match paths {
            Some(paths) => paths.iter().filter_map(block).collect(),
            None => self.files.keys().filter_map(block).collect(),
        }
    }

    /// Each note's tags (see `tags::note_tags`), for `paths` or every note. Notes without tags,
    /// and paths that aren't notes, are left out.
    pub fn tags(&self, paths: Option<&[String]>) -> BTreeMap<String, Vec<String>> {
        let tags = |path: &String| {
            let node = self
                .files
                .get(path)
                .filter(|n| !n.is_dir && is_note_path(path) && !n.note.tags.is_empty())?;
            Some((path.clone(), node.note.tags.clone()))
        };
        match paths {
            Some(paths) => paths.iter().filter_map(tags).collect(),
            None => self.files.keys().filter_map(tags).collect(),
        }
    }

    /// Paths `fresh` lacks, paths only `fresh` has, and files whose stamp differs, each in
    /// path order: one walk of both sorted lists. Review 8: tests only, the whole comparison a
    /// rescan's stepped one (`index::rescan`) must equal.
    #[cfg(test)]
    pub(crate) fn file_diff(&self, fresh: &Index) -> (Vec<String>, Vec<String>, Vec<String>) {
        let (mut removed, mut created, mut modified) = (Vec::new(), Vec::new(), Vec::new());
        let mut old = self.files.iter().peekable();
        let mut new = fresh.files.iter().peekable();
        loop {
            match (old.peek(), new.peek()) {
                (None, None) => break,
                (Some((path, _)), None) => {
                    removed.push((*path).clone());
                    old.next();
                }
                (None, Some((path, _))) => {
                    created.push((*path).clone());
                    new.next();
                }
                (Some((a, an)), Some((b, bn))) => match a.cmp(b) {
                    std::cmp::Ordering::Less => {
                        removed.push((*a).clone());
                        old.next();
                    }
                    std::cmp::Ordering::Greater => {
                        created.push((*b).clone());
                        new.next();
                    }
                    std::cmp::Ordering::Equal => {
                        if !bn.is_dir && an.stamp != bn.stamp {
                            modified.push((*a).clone());
                        }
                        old.next();
                        new.next();
                    }
                },
            }
        }
        (removed, created, modified)
    }

    pub fn begin_rescan(&mut self) {
        self.rescan_changes = Some(BTreeSet::new());
    }

    pub fn take_rescan_changes(&mut self) -> BTreeSet<String> {
        self.rescan_changes.take().unwrap_or_default()
    }

    fn changed_during_rescan(&mut self, rel: &str) {
        if let Some(paths) = &mut self.rescan_changes {
            paths.insert(rel.to_string());
        }
    }

    /// Rebuild name maps once when the guard drops, not once per file in the batch.
    pub(crate) fn map_batch(&mut self) -> MapBatch<'_> {
        if self.defer_depth == 0 {
            self.batch_updates = 0;
        }
        self.defer_depth += 1;
        MapBatch { index: self }
    }

    /// Drop `rel` and everything under it. Only those paths are visited. A tree of more
    /// than `BULK_PATHS` paths rebuilds the maps once instead (deferred in a `MapBatch`).
    pub fn remove_tree(&mut self, rel: &str) {
        self.changed_during_rescan(rel);
        let keys = self.files.tree_keys(rel);
        let bulk = keys.len() > BULK_PATHS;
        if bulk {
            self.maps_dirty = true;
        }
        for key in keys {
            self.take_node(&key);
        }
        if bulk {
            self.rebuild_maps();
        }
        self.settle_links();
    }

    /// Move `from` and everything under it to `to`. No-op when `from` is not indexed.
    pub fn relocate(&mut self, from: &str, to: &str) {
        if from == to || (!self.files.contains_key(from) && !self.files.has_below(from)) {
            return;
        }
        self.changed_during_rescan(from);
        self.changed_during_rescan(to);
        let keys = self.files.tree_keys(from);
        // Both callers (`rename_path` and the watcher's `apply`) refresh the destination
        // next, and a folder refresh rebuilds the maps anyway. Moving a folder entry by
        // entry first would be wasted work, and quadratic for many same-named files.
        let folder = keys.len() > 1 || self.is_dir(from);
        if folder {
            self.maps_dirty = true;
        }
        for key in keys {
            if let Some(node) = self.take_node(&key) {
                let new_key = if key == from {
                    to.to_string()
                } else {
                    format!("{to}{}", &key[from.len()..])
                };
                let node = if !node.is_dir && !is_note_path(&new_key) {
                    // Not a note any more: keep only its kind and times.
                    Arc::new(Node {
                        is_dir: false,
                        stamp: node.stamp,
                        note: Note::default(),
                    })
                } else {
                    node
                };
                self.put_node(new_key, node);
            }
        }
        // A move into a new folder should keep that folder in the file list.
        self.ensure_parent_nodes(to);
        if folder {
            self.rebuild_maps();
        }
        self.settle_links();
    }

    /// Reload one path from disk. A new directory also picks up children the index doesn't have.
    pub fn refresh_path(&mut self, root: &Path, rel: &str) {
        if is_ignored_rel(rel) {
            return;
        }
        self.changed_during_rescan(rel);
        let full = root.join(rel);
        match fs::symlink_metadata(&full) {
            Ok(md) if md.file_type().is_symlink() => self.remove_tree(rel),
            Ok(md) if md.is_dir() => {
                // A new folder can bring many files: rebuild once instead (see `MapBatch`).
                self.maps_dirty = true;
                self.ensure_dirs(root, rel);
                self.insert_dir(rel, fsutil::mtime_ms(&md));
                if let Ok(rd) = fs::read_dir(&full) {
                    self.add_children(root, rel, rd);
                }
                self.rebuild_maps();
            }
            // One file updates the maps for its own path, like `upsert_note`.
            Ok(md) if md.is_file() => {
                self.ensure_dirs(root, rel);
                self.read_file_node(root, rel, &md);
            }
            _ => self.remove_tree(rel),
        }
        self.settle_links();
    }

    pub fn upsert_note(&mut self, root: &Path, rel: &str, content: &str, stamp: Stamp) {
        self.changed_during_rescan(rel);
        self.ensure_dirs(root, rel);
        self.insert_file(rel, stamp, || content.to_string());
        self.settle_links();
    }

    /// Store `node` at `key`, replacing what was there, and update the maps for that path.
    /// The old node is only read (never cloned), even while a search shares it.
    fn put_node(&mut self, key: String, node: Arc<Node>) {
        if self.maps_dirty {
            // A full rebuild is pending; it resolves every note's links too.
            self.files.insert(key, node);
            return;
        }
        let old = self.files.insert(key.clone(), Arc::clone(&node));
        self.edits.note(Edit::Node(Arc::from(key.as_str())));
        if has_links(&key, &node) || self.links.contains(&key) {
            self.links.touch(&key);
        }
        if old.as_ref().is_some_and(|old| name_maps::same_keys(old, &node)) || !self.spend_update() {
            return;
        }
        if let Some(old) = &old {
            self.wake_readers(&key, old);
            self.maps.remove(&key, old);
        }
        self.wake_readers(&key, &node);
        self.maps.add(&key, &node);
    }

    /// Remove `key` and forget what it contributed to the maps. The node is shared, not
    /// copied, with any search still holding it.
    fn take_node(&mut self, key: &str) -> Option<Arc<Node>> {
        let old = self.files.remove(key)?;
        if self.maps_dirty {
            return Some(old);
        }
        self.edits.note(Edit::Node(Arc::from(key)));
        if self.links.contains(key) {
            self.links.touch(key);
        }
        if self.spend_update() {
            self.wake_readers(key, &old);
            self.maps.remove(key, &old);
        }
        Some(old)
    }

    /// `node` at `path` is joining or leaving the maps: every note whose links read one of
    /// its keys resolves again.
    fn wake_readers(&mut self, path: &str, node: &Node) {
        let (links, edits) = (&mut self.links, &mut self.edits);
        name_maps::keys_of(path, node, |kind, key| {
            edits.note(Edit::Key(name_maps::key_hash(kind, &key)));
            links.wake(kind, key);
        });
    }

    /// Resolve again the notes queued since the last settle, and log the entries that changed.
    /// Waits while a batch is open or a full rebuild is pending (that resolves every note).
    fn settle_links(&mut self) {
        if self.defer_depth > 0 || self.maps_dirty || !self.links.has_pending() {
            return;
        }
        if let Some(n) = self.defer_links {
            if self.links.queued_over(n) {
                return;
            }
            self.links.expand(usize::MAX);
            let links: usize = self.links.pending().filter_map(|p| self.files.get(p)).map(|node| node.note.links.len()).sum();
            if links > INLINE_LINK_WORK {
                return;
            }
        }
        let far = std::time::Instant::now() + std::time::Duration::from_secs(3600);
        self.settle_links_until(far);
    }

    /// Every note's links from scratch, after a full map rebuild.
    fn rebuild_links(&mut self) {
        let maps = &self.maps;
        let fresh = self
            .files
            .iter()
            .filter(|(path, node)| has_links(path, node))
            .map(|(path, node)| (Arc::<str>::from(path.as_str()), resolve_note(maps, path, &node.note.links)));
        self.links.refill(fresh);
    }

    /// Whether one more per-path map update may run. Inside a `MapBatch`, the batch's
    /// `BULK_PATHS` budget is shared by all its steps; once it is spent the maps go stale
    /// and the batch rebuilds once on drop. The node change itself always lands.
    fn spend_update(&mut self) -> bool {
        if self.defer_depth > 0 {
            self.batch_updates += 1;
            if self.batch_updates > BULK_PATHS {
                self.maps_dirty = true;
                return false;
            }
        }
        #[cfg(test)]
        count_map_update();
        true
    }

    /// Index the entries of the folder `rel` ("" for the vault) and everything below them,
    /// keeping what is indexed already. Hidden folders, temp files and symlinks are skipped.
    fn add_children(&mut self, root: &Path, rel: &str, rd: fs::ReadDir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if is_ignored_rel(&name) || ft.is_symlink() {
                continue;
            }
            let child = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            let known = self.files.contains_key(&child);
            if ft.is_dir() {
                if !known {
                    let mtime = entry.metadata().map(|m| fsutil::mtime_ms(&m)).unwrap_or(0);
                    self.insert_dir(&child, mtime);
                }
                if let Ok(rd) = fs::read_dir(entry.path()) {
                    self.add_children(root, &child, rd);
                }
            } else if ft.is_file() && !known {
                if let Ok(md) = entry.metadata() {
                    self.read_file_node(root, &child, &md);
                }
            }
        }
    }

    /// Folder nodes for the folders above `rel` that have none (with no modified time).
    fn ensure_parent_nodes(&mut self, rel: &str) {
        for dir in parents(rel) {
            if !self.files.contains_key(dir) {
                self.insert_dir(dir, 0);
            }
        }
    }

    /// Folder nodes for the folders above `rel`, with their modified times from disk.
    fn ensure_dirs(&mut self, root: &Path, rel: &str) {
        for dir in parents(rel) {
            let mtime = fs::metadata(root.join(dir))
                .map(|m| fsutil::mtime_ms(&m))
                .unwrap_or(0);
            self.insert_dir(dir, mtime);
        }
    }

    fn insert_dir(&mut self, rel: &str, mtime_ms: u64) {
        let node = Node {
            is_dir: true,
            stamp: Stamp {
                mtime_ms,
                ..Stamp::default()
            },
            ..Node::default()
        };
        self.put_node(rel.to_string(), Arc::new(node));
    }

    /// A file's node. A note's text (from `read`) is parsed, unless it is too large to index.
    fn insert_file(&mut self, rel: &str, stamp: Stamp, read: impl FnOnce() -> String) {
        let note = if is_note_path(rel) && stamp.size <= MAX_INDEX_BYTES {
            parse_note(&read())
        } else {
            Note::default()
        };
        let node = Node {
            is_dir: false,
            stamp,
            note,
        };
        self.put_node(rel.to_string(), Arc::new(node));
    }

    fn read_file_node(&mut self, root: &Path, rel: &str, md: &fs::Metadata) {
        self.insert_file(rel, Stamp::of(md), || {
            String::from_utf8_lossy(&fs::read(root.join(rel)).unwrap_or_default()).into_owned()
        });
    }

    /// An empty index whose maps wait for one full rebuild once its files are in.
    fn stale() -> Self {
        Index {
            maps_dirty: true,
            ..Index::default()
        }
    }

    /// Every map from the whole file list, for scans and folder refreshes (once per
    /// outermost `MapBatch`). Saves, renames, deletes, and file refreshes update only their
    /// own paths instead; tests compare those updates with this full rebuild.
    fn rebuild_maps(&mut self) {
        if self.defer_depth > 0 {
            self.maps_dirty = true;
            return;
        }
        self.maps_dirty = false;
        self.edits.restart();
        #[cfg(test)]
        count_rebuild_maps();
        self.maps.refill(&self.files);
        if self.defer_links.is_some() && self.links.is_built() {
            // Review 6: a bulk change (a large folder deleted, moved or added) re-resolves no
            // note under the lock. Every note is queued instead, and jobs resolve them off it
            // against the maps as they then stand, checking the edits since (`link_jobs`).
            // Review 7: in steps, as jobs and settles go (`LinkTable::sweep`); here only its
            // start is marked.
            self.links.requeue();
        } else {
            self.rebuild_links();
        }
    }

    #[cfg(test)]
    fn from_notes(notes: &[(&str, &str)]) -> Self {
        let mut idx = Index::stale();
        for (path, content) in notes {
            // Parent folders exist in a real scan, so a directory rename has a node to move.
            idx.ensure_parent_nodes(path);
            idx.insert_file(path, Stamp::sized(content.len()), || content.to_string());
        }
        idx.rebuild_maps();
        idx
    }
}

/// A note whose links the link table keeps: a note file with at least one link.
fn has_links(path: &str, node: &Node) -> bool {
    !node.is_dir && !node.note.links.is_empty() && is_note_path(path)
}

/// Resolve `target` as a link from `from`. Every map read goes through `look`.
fn resolve_in(look: &mut Lookups, from: &str, target: &str) -> Option<String> {
    // Heading, block, and alias suffixes are not part of the note name.
    let target = clean_target(target)?;
    let raw = target.replace('\\', "/");
    let raw = raw.trim().trim_start_matches('/');
    if raw.is_empty() {
        return None;
    }
    if raw.contains('/') {
        return resolve_path_in(look, from, raw);
    }
    let mut key = raw.to_lowercase();
    if let Some(stripped) = key.strip_suffix(".md") {
        key = stripped.to_string();
    }
    if let Some(found) = look.name_pick(&key, from) {
        return Some(found.to_string());
    }
    look.alias(&raw.to_lowercase()).map(str::to_string)
}

fn resolve_path_in(look: &mut Lookups, from: &str, raw: &str) -> Option<String> {
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
        if let Some(found) = look.path_lower(&norm.to_lowercase()) {
            if nameless_md(found) {
                continue;
            }
            return Some(found.to_string());
        }
    }
    // A partial path: the shortest file path that ends with it, then the smaller original path.
    let low = raw.trim_start_matches('/').to_lowercase();
    let suf = format!("/{low}");
    let suf_md = format!("/{low}.md");
    let a = look.suffix(&suf);
    let b = look.suffix(&suf_md);
    better_suffix(a, b).map(str::to_string)
}

/// One note's links resolved against `maps`, with every key that took. The entry follows the
/// `link_index` rules: targets in first-seen order without repeats, wikilinks in `outgoing`,
/// markdown links in `markdown`, and the targets that match no file in `unresolved` (as
/// written, a markdown link without its `.md`, repeats dropped ignoring ASCII case).
fn resolve_note(maps: &NameMaps, path: &str, links: &[RawLink]) -> Resolved {
    resolve_through(Src::Maps(maps), path, links).0
}

/// `resolve_note` with its lookups going to `src`, which is handed back (see `Src`).
fn resolve_through<'m>(src: Src<'m>, path: &str, links: &[RawLink]) -> (Resolved, Src<'m>) {
    let mut reads = Vec::new();
    let mut look = Lookups::watching(src, &mut reads);
    let mut entry = LinkEntry::default();
    let mut slots = Vec::with_capacity(links.len());
    let (mut out_at, mut md_at, mut missing_at) = (Firsts::default(), Firsts::default(), Firsts::default());
    for link in links {
        let Some(dest) = resolve_in(&mut look, path, &link.target) else {
            let name = if link.markdown {
                strip_md(&link.target)
            } else {
                link.target.as_str()
            };
            missing_at.place(&mut entry.unresolved, name, true);
            slots.push(None);
            continue;
        };
        let at = if link.markdown {
            md_at.place(&mut entry.markdown, &dest, false)
        } else {
            out_at.place(&mut entry.outgoing, &dest, false)
        };
        slots.push(Some(at));
    }
    let src = look.into_src();
    reads.sort();
    reads.dedup();
    (Resolved::new(slots, reads, entry), src)
}

/// Where each item of a first-seen, repeat-free list sits: a scan while the list is short, a
/// map once it is long (review 3: a note with thousands of distinct links was quadratic).
#[derive(Default)]
struct Firsts {
    at: HashMap<String, u32>,
}

impl Firsts {
    const LONG: usize = 32;

    /// `item`'s place in `list`, pushing it when new. `fold`: repeats ignore ASCII case.
    fn place(&mut self, list: &mut Vec<String>, item: &str, fold: bool) -> u32 {
        let same = |a: &str| if fold { a.eq_ignore_ascii_case(item) } else { a == item };
        let key = |s: &str| if fold { s.to_ascii_lowercase() } else { s.to_string() };
        if list.len() < Self::LONG {
            if let Some(at) = list.iter().position(|d| same(d)) {
                return at as u32;
            }
            list.push(item.to_string());
            if list.len() == Self::LONG {
                self.at = list.iter().enumerate().map(|(i, d)| (key(d), i as u32)).collect();
            }
            return (list.len() - 1) as u32;
        }
        match self.at.entry(key(item)) {
            std::collections::hash_map::Entry::Occupied(found) => *found.get(),
            std::collections::hash_map::Entry::Vacant(slot) => {
                list.push(item.to_string());
                *slot.insert((list.len() - 1) as u32)
            }
        }
    }
}

/// The folders above a path ("a" and "a/b" for "a/b/c.md").
fn parents(rel: &str) -> impl Iterator<Item = &str> {
    rel.match_indices('/').map(move |(i, _)| &rel[..i])
}

pub fn is_note_path(path: &str) -> bool {
    let base = basename(path);
    // `get`, not slicing: a name ending in a multi-byte character has no char boundary there.
    base.len() > 3 && base.get(base.len() - 3..).is_some_and(|ext| ext.eq_ignore_ascii_case(".md"))
}

/// The whole file name is `.md` in any case. That is not a note.
fn nameless_md(path: &str) -> bool {
    basename(path).eq_ignore_ascii_case(".md")
}

fn file_entry(path: &str, node: &Node) -> FileEntry {
    FileEntry {
        path: path.to_string(),
        name: display_name(path, node.is_dir),
        is_dir: node.is_dir,
        mtime_ms: node.stamp.mtime_ms,
        ctime_ms: node.stamp.ctime_ms,
        size: node.stamp.size,
    }
}

fn display_name(path: &str, is_dir: bool) -> String {
    let base = basename(path);
    if is_dir { base } else { strip_md(base) }.to_string()
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

fn better_suffix<'a>(a: Option<&'a str>, b: Option<&'a str>) -> Option<&'a str> {
    match (a, b) {
        (Some(a), Some(b)) if a.len() < b.len() || (a.len() == b.len() && a <= b) => {
            Some(a)
        }
        (Some(_), Some(b)) => Some(b),
        (Some(a), None) => Some(a),
        (None, b) => b,
    }
}

/// Queued notes resolved between deadline checks in `settle_links_until`.
const SETTLE_STEP: usize = 32;

fn pick<'a>(cands: &'a [String], from: &str) -> Option<&'a str> {
    let dir = parent_path(from);
    cands
        .iter()
        .filter(|path| !nameless_md(path))
        .min_by(|a, b| {
            rank(a, dir)
                .cmp(&rank(b, dir))
                .then(a.len().cmp(&b.len()))
                .then(a.as_str().cmp(b.as_str()))
        })
        .map(|s| s.as_str())
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
    (!out.is_empty()).then(|| out.join("/"))
}

/// A markdown link's target without its `.md`, as the graph names a note that doesn't exist.
fn strip_md(target: &str) -> &str {
    if is_note_path(target) {
        &target[..target.len() - 3]
    } else {
        target
    }
}
