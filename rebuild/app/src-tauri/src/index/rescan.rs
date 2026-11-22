//! Review 8: a rescan's comparison with the live index, made a step at a time.
//!
//! The watcher scans the vault without the state lock, then swaps the fresh index in. Before
//! this, the finish replayed the paths the app had changed meanwhile, compared both indexes
//! whole, and continued the link history, all under the write lock. Now (see `watch.rs`):
//!
//! 1. Catch-up rounds replay those paths into the fresh index without the lock. The fresh
//!    index is the watcher's own, and every app change is still recorded meanwhile.
//! 2. `RescanDiff` compares the two indexes' files and link entries in path order,
//!    `n` at a time, each step under the read lock.
//! 3. The final write hold replays what the app changed during the comparison and compares
//!    those paths again: their trees and the folders above them, plus the notes whose link
//!    entries were logged in either table since the comparison began. Then it swaps.
//!
//! The app records every path it changes (`changed_during_rescan`) whatever step the
//! comparison is at, and the link table logs every entry change (`record`). So the final hold
//! sees each change the steps could have missed, and the result is the whole comparison made
//! at the swap (tests check exactly that on every rescan).

use super::link_table::LinkTable;
use super::{Index, Node};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;

#[cfg(test)]
thread_local! {
    static CHECK: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

/// Tests: whether each rescan finish on this thread also makes the whole comparison at the
/// swap and checks the stepped one against it (on by default; a latency test turns it off, so
/// its holds are what the app's are).
#[cfg(test)]
pub(crate) fn check_rescans(on: bool) {
    CHECK.with(|c| c.set(on));
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FileDelta {
    Removed,
    Created,
    Modified,
}

/// What a rescan's comparison has found so far, and where it is.
pub(crate) struct RescanDiff {
    files: BTreeMap<String, FileDelta>,
    links: BTreeSet<Arc<str>>,
    files_after: Option<String>,
    files_done: bool,
    links_after: Option<Arc<str>>,
    links_done: bool,
    /// The link tables' versions when it began: entries logged after them are compared again.
    live_version: u64,
    fresh_version: u64,
}

/// As `Index::file_diff` judges one path.
fn file_delta(old: Option<&Node>, new: Option<&Node>) -> Option<FileDelta> {
    match (old, new) {
        (None, None) => None,
        (Some(_), None) => Some(FileDelta::Removed),
        (None, Some(_)) => Some(FileDelta::Created),
        (Some(a), Some(b)) => (!b.is_dir && a.stamp != b.stamp).then_some(FileDelta::Modified),
    }
}

fn set_delta(files: &mut BTreeMap<String, FileDelta>, path: &str, delta: Option<FileDelta>) {
    match delta {
        Some(delta) => {
            files.insert(path.to_string(), delta);
        }
        None => {
            files.remove(path);
        }
    }
}

/// One step of a merge walk over two sorted runs, each taken `n` long (fewer: the run ended).
/// Visits every key up to the last both runs are known to reach, and returns it (the next
/// step starts after it), or `None` when both runs ended.
pub(super) fn merge_step<'k, A: Copy, B: Copy>(a: &[(&'k str, A)], b: &[(&'k str, B)], n: usize, mut each: impl FnMut(&'k str, Option<A>, Option<B>)) -> Option<&'k str> {
    assert!(n > 0);
    let limit = match (a.len() == n, b.len() == n) {
        (true, true) => Some(a[n - 1].0.min(b[n - 1].0)),
        (true, false) => Some(a[n - 1].0),
        (false, true) => Some(b[n - 1].0),
        (false, false) => None,
    };
    let within = |key: &str| limit.is_none_or(|last| key <= last);
    let (mut i, mut j) = (0, 0);
    loop {
        let x = a.get(i).copied().filter(|(key, _)| within(key));
        let y = b.get(j).copied().filter(|(key, _)| within(key));
        match (x, y) {
            (None, None) => break,
            (Some((key, va)), None) => {
                each(key, Some(va), None);
                i += 1;
            }
            (None, Some((key, vb))) => {
                each(key, None, Some(vb));
                j += 1;
            }
            (Some((ka, va)), Some((kb, vb))) => match ka.cmp(kb) {
                std::cmp::Ordering::Less => {
                    each(ka, Some(va), None);
                    i += 1;
                }
                std::cmp::Ordering::Greater => {
                    each(kb, None, Some(vb));
                    j += 1;
                }
                std::cmp::Ordering::Equal => {
                    each(ka, Some(va), Some(vb));
                    i += 1;
                    j += 1;
                }
            },
        }
    }
    limit
}

impl Index {
    /// The paths changed since the rescan began, leaving it recording (a catch-up round).
    pub(crate) fn drain_rescan_changes(&mut self) -> BTreeSet<String> {
        self.rescan_changes.as_mut().map(std::mem::take).unwrap_or_default()
    }

    /// Read `paths` again from disk (a rescan's fresh index catching up with the app).
    pub(crate) fn replay(&mut self, root: &Path, paths: &BTreeSet<String>) {
        for path in paths {
            self.remove_tree(path);
            self.refresh_path(root, path);
        }
    }

    /// Start comparing this (live) index with a rescan's `fresh` one.
    pub(crate) fn rescan_diff(&self, fresh: &Index) -> RescanDiff {
        RescanDiff {
            files: BTreeMap::new(),
            links: BTreeSet::new(),
            files_after: None,
            files_done: false,
            links_after: None,
            links_done: false,
            live_version: self.links.history_version(),
            fresh_version: fresh.links.history_version(),
        }
    }

    /// Compare about `n` more paths (files first, then link entries). True when done.
    pub(crate) fn rescan_diff_step(&self, fresh: &Index, diff: &mut RescanDiff, n: usize) -> bool {
        if !diff.files_done {
            let after = diff.files_after.as_deref();
            let a: Vec<(&str, &Node)> = self.files.after(after).take(n).map(|(k, v)| (k.as_str(), v)).collect();
            let b: Vec<(&str, &Node)> = fresh.files.after(after).take(n).map(|(k, v)| (k.as_str(), v)).collect();
            let files = &mut diff.files;
            let next = merge_step(&a, &b, n, |path, old, new| {
                if let Some(delta) = file_delta(old, new) {
                    files.insert(path.to_string(), delta);
                }
            });
            match next {
                Some(last) => diff.files_after = Some(last.to_string()),
                None => diff.files_done = true,
            }
            return false;
        }
        if !diff.links_done {
            match self.links.differing_step(&fresh.links, diff.links_after.as_deref(), n, &mut diff.links) {
                Some(last) => diff.links_after = Some(last),
                None => diff.links_done = true,
            }
        }
        diff.links_done
    }

    /// Finish the comparison under the write lock, once `fresh` has replayed `changed` (the
    /// paths the app changed since the last catch-up), and continue the link history into
    /// `fresh`. Returns the removed, created and modified paths, as `file_diff` would now.
    pub(crate) fn finish_rescan_diff(&mut self, fresh: &mut Index, mut diff: RescanDiff, changed: &BTreeSet<String>) -> (Vec<String>, Vec<String>, Vec<String>) {
        while !self.rescan_diff_step(fresh, &mut diff, usize::MAX) {}
        let RescanDiff { mut files, mut links, live_version, fresh_version, .. } = diff;
        for path in changed {
            // The folders above it (an app write can add them) ...
            let mut at = path.as_str();
            while let Some(cut) = at.rfind('/') {
                at = &at[..cut];
                set_delta(&mut files, at, file_delta(self.files.get(at), fresh.files.get(at)));
            }
            // ... and its whole tree.
            files.remove(path.as_str());
            let below: Vec<String> = files.range(format!("{path}/")..format!("{path}0")).map(|(k, _)| k.clone()).collect();
            for key in below {
                files.remove(&key);
            }
            let a: Vec<(&str, &Node)> = self.files.tree_nodes(path).into_iter().map(|(k, v)| (k.as_str(), v)).collect();
            let b: Vec<(&str, &Node)> = fresh.files.tree_nodes(path).into_iter().map(|(k, v)| (k.as_str(), v)).collect();
            merge_step(&a, &b, usize::MAX, |key, old, new| set_delta(&mut files, key, file_delta(old, new)));
        }
        match (self.links.logged_since(live_version), fresh.links.logged_since(fresh_version)) {
            (Some(live), Some(new)) => {
                for path in live.into_iter().chain(new) {
                    if self.links.differs_at(&fresh.links, &path) {
                        links.insert(path);
                    } else {
                        links.remove(&path);
                    }
                }
            }
            // More changes than either log keeps: compare every entry (rare; correct).
            _ => links = self.links.differing(&fresh.links).into_iter().collect(),
        }
        #[cfg(test)]
        if CHECK.with(std::cell::Cell::get) {
            let whole = self.file_diff(fresh);
            let stepped = split(&files);
            assert_eq!(stepped, whole, "a stepped rescan comparison equals one made at the swap");
            let all: Vec<Arc<str>> = self.links.differing(&fresh.links);
            assert_eq!(links.iter().cloned().collect::<Vec<_>>(), all, "stepped link comparison");
        }
        fresh.links.continue_with(&mut self.links, links.into_iter().collect());
        fresh.defer_links = self.defer_links;
        split(&files)
    }
}

fn split(files: &BTreeMap<String, FileDelta>) -> (Vec<String>, Vec<String>, Vec<String>) {
    let (mut removed, mut created, mut modified) = (Vec::new(), Vec::new(), Vec::new());
    for (path, delta) in files {
        match delta {
            FileDelta::Removed => removed.push(path.clone()),
            FileDelta::Created => created.push(path.clone()),
            FileDelta::Modified => modified.push(path.clone()),
        }
    }
    (removed, created, modified)
}

/// One note's resolution, shared, as `LinkTable::chunk` lists it.
type Entry = (Arc<str>, Arc<super::link_table::Resolved>);

impl LinkTable {
    /// Compare about `n` notes of each table after `after` with `other`'s, adding to `out`
    /// those whose entries differ or that only one has. The next cursor, or `None` when done.
    pub(super) fn differing_step(&self, other: &LinkTable, after: Option<&str>, n: usize, out: &mut BTreeSet<Arc<str>>) -> Option<Arc<str>> {
        let a = self.chunk(after, n);
        let b = other.chunk(after, n);
        let a: Vec<(&str, &Entry)> = a.iter().map(|item| (&*item.0, item)).collect();
        let b: Vec<(&str, &Entry)> = b.iter().map(|item| (&*item.0, item)).collect();
        let next = merge_step(&a, &b, n, |_, old, new| match (old, new) {
            (Some((path, ra)), Some((_, rb))) => {
                if ra.entry != rb.entry {
                    out.insert(Arc::clone(path));
                }
            }
            (Some((path, _)), None) | (None, Some((path, _))) => {
                out.insert(Arc::clone(path));
            }
            (None, None) => {}
        });
        next.map(Arc::from)
    }

    /// Whether `path`'s entry differs between the tables (or only one has it).
    pub(super) fn differs_at(&self, other: &LinkTable, path: &str) -> bool {
        match (self.shared(path), other.shared(path)) {
            (None, None) => false,
            (Some(a), Some(b)) => a.entry != b.entry,
            _ => true,
        }
    }
}
