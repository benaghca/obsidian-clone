//! Link work done off the vault lock (review 3).
//!
//! A large link update (an alias ten thousand notes read, a `README` among thousands, a note
//! with thousands of links) is left queued by the write that caused it (`Index::settle_links`).
//! `link_reads` resolves it in jobs, each in five steps, and only two of them hold the lock:
//!
//! 1. `Index::link_job` (write lock, bounded): queue a step of woken keys' readers and take up
//!    to `JOB_NOTES` queued notes or `JOB_LINKS` links, as shared nodes, with an `EditMark`;
//! 2. `LinkJob::ask` (no lock): resolve each note against nothing, which lists every map key
//!    its resolution could read;
//! 3. `Index::answer` (read lock, `ANSWER_STEP` keys a time): look those keys up;
//! 4. `LinkJob::finish` (no lock): resolve each note from the answers;
//! 5. `Index::publish` (write lock): store each note's result unless, since the mark, its node
//!    changed or a key it asked about gained or lost an owner (`Index::edits_since`). Such a
//!    note stays queued for the next job. After a full map rebuild the whole job is dropped.
//!
//! A key's answer depends only on that key's owners (and the asking note's folder), so a note
//! stored at publish equals the note resolved against the maps then: what an inline settle
//! would have stored. Saves that touch neither (typing in another note) leave a job valid, so
//! jobs finish while saves keep coming.
//!
//! Replies are built the same way: `link_reads` copies shared entries out in chunks under the
//! read lock and patches them from the change log (`LinkTable::logged`).

use super::link_table::Resolved;
use super::name_maps::{key_hash, Answers, KeyHash, Query, Src};
use super::{has_links, resolve_note, resolve_through, Edit, EditMark, Index, Node};
use crate::model::Backlink;
use std::collections::HashSet;
use std::sync::Arc;

/// Notes, and links, one job takes: its publish (under the write lock) re-links at most these.
/// A note with more links than this is a job of its own.
const JOB_NOTES: usize = 128;
const JOB_LINKS: usize = 1_024;
/// Readers of woken keys queued per job.
const EXPAND_STEP: usize = 4_096;
/// Map keys looked up per read-lock hold.
const ANSWER_STEP: usize = 2_048;

#[cfg(test)]
thread_local! {
    static SMALL: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static SKIPPED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Tests: notes `publish` left queued because something they read changed (resets).
#[cfg(test)]
pub(crate) fn take_skipped() -> usize {
    SKIPPED.with(|n| n.replace(0))
}

/// Tests: every budget here and in `link_replies` becomes 2, so a small vault takes many steps.
#[cfg(test)]
pub(crate) fn small_steps(on: bool) {
    SMALL.with(|small| small.set(on));
}

pub(super) fn budget(n: usize) -> usize {
    #[cfg(test)]
    if SMALL.with(std::cell::Cell::get) {
        return 2;
    }
    n
}

/// One batch of queued notes being resolved off the lock.
pub(crate) struct LinkJob {
    mark: EditMark,
    notes: Vec<NoteJob>,
    /// Where `answer` goes on: (note, question).
    at: (usize, usize),
}

struct NoteJob {
    path: Arc<str>,
    /// `None`: no note with links there any more (its entry goes away).
    node: Option<Arc<Node>>,
    asked: Vec<Query>,
    /// The asked keys, as edits name them.
    keys: Vec<KeyHash>,
    answers: Vec<Option<String>>,
    resolved: Option<Resolved>,
}

/// What one step of a job found.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LinkSlice {
    /// This step's work is done.
    Done,
    /// More of it remains.
    More,
    /// The maps were rebuilt since the job started (or too much changed to tell): drop it.
    Stale,
}

impl Index {
    /// Start a job (step 1), or `None` when nothing is queued.
    pub(crate) fn link_job(&mut self) -> Option<LinkJob> {
        if !self.links.has_pending() {
            return None;
        }
        debug_assert!(self.defer_depth == 0 && !self.maps_dirty, "a link job inside a change");
        self.links.expand(budget(EXPAND_STEP));
        let mut notes = Vec::new();
        let mut links = 0;
        for path in self.links.pending() {
            if notes.len() == budget(JOB_NOTES) || (links >= budget(JOB_LINKS) && !notes.is_empty()) {
                break;
            }
            let node = self.files.get_shared(path).filter(|node| has_links(path, node)).cloned();
            links += node.as_ref().map_or(0, |node| node.note.links.len());
            notes.push(NoteJob {
                path: Arc::clone(path),
                node,
                asked: Vec::new(),
                keys: Vec::new(),
                answers: Vec::new(),
                resolved: None,
            });
        }
        Some(LinkJob { mark: self.edit_mark(), notes, at: (0, 0) })
    }

    /// Answer up to `ANSWER_STEP` of a job's questions (step 3, under the read lock).
    pub(crate) fn answer(&self, job: &mut LinkJob) -> LinkSlice {
        // Answers to keys that change meanwhile are dropped at `publish`; a rebuild drops all.
        if self.edits_since(job.mark).is_none() {
            return LinkSlice::Stale;
        }
        let mut left = budget(ANSWER_STEP);
        while let Some(note) = job.notes.get_mut(job.at.0) {
            while job.at.1 < note.asked.len() {
                if left == 0 {
                    return LinkSlice::More;
                }
                let (kind, key) = &note.asked[job.at.1];
                note.answers.push(self.maps.answer(*kind, key, &note.path).map(str::to_string));
                job.at.1 += 1;
                left -= 1;
            }
            job.at = (job.at.0 + 1, 0);
        }
        LinkSlice::Done
    }

    /// Store a finished job (step 5): each note that nothing it read has changed under.
    pub(crate) fn publish(&mut self, job: LinkJob) -> LinkSlice {
        let Some(edits) = self.edits_since(job.mark) else {
            return LinkSlice::Stale;
        };
        let mut nodes: HashSet<Arc<str>> = HashSet::new();
        let mut keys: HashSet<KeyHash> = HashSet::new();
        for edit in edits {
            match edit {
                Edit::Node(path) => nodes.insert(Arc::clone(path)),
                Edit::Key(key) => keys.insert(*key),
            };
        }
        let mut changed = Vec::new();
        for note in job.notes {
            if nodes.contains(&note.path) || note.keys.iter().any(|k| keys.contains(k)) {
                // Read something that changed: it stays queued for another job.
                #[cfg(test)]
                SKIPPED.with(|n| n.set(n.get() + 1));
                continue;
            }
            // A question nobody listed (never expected): resolve this one against the maps.
            let resolved = match (&note.node, note.resolved) {
                (None, _) => None,
                (Some(_), Some(resolved)) => Some(resolved),
                (Some(node), None) => Some(resolve_note(&self.maps, &note.path, &node.note.links)),
            };
            self.links.unqueue(&note.path);
            if self.links.replace(Arc::clone(&note.path), resolved) {
                changed.push(note.path);
            }
        }
        self.links.record(changed);
        LinkSlice::Done
    }
}

impl LinkJob {
    /// List every map key each note's resolution could read (step 2, no lock).
    pub(crate) fn ask(&mut self) {
        for note in &mut self.notes {
            let Some(node) = &note.node else {
                continue;
            };
            let (_, src) = resolve_through(Src::Ask(Vec::new()), &note.path, &node.note.links);
            let Src::Ask(mut asked) = src else {
                unreachable!("handed back as given")
            };
            asked.sort_unstable();
            asked.dedup();
            note.keys = asked.iter().map(|(kind, key)| key_hash(*kind, key)).collect();
            note.asked = asked;
        }
    }

    /// Resolve each note from its answers (step 4, no lock).
    pub(crate) fn finish(&mut self) {
        for note in &mut self.notes {
            let Some(node) = &note.node else {
                continue;
            };
            let answers = Answers {
                map: std::mem::take(&mut note.asked).into_iter().zip(std::mem::take(&mut note.answers)).collect(),
                missing: Default::default(),
            };
            let (resolved, _) = resolve_through(Src::Answers(&answers), &note.path, &node.note.links);
            if !answers.missing.get() {
                note.resolved = Some(resolved);
            }
        }
    }
}

/// A note linking to a target, shared out of the index for a `backlinks` reply built off the
/// lock.
pub(crate) struct BacklinkSource {
    from: Arc<str>,
    node: Arc<Node>,
    resolved: Arc<Resolved>,
}

impl Index {
    /// Up to `n` notes linking to `target` after `after`, in path order, and whether that was
    /// the last of them.
    pub(crate) fn backlink_sources(&self, target: &str, after: Option<&str>, n: usize) -> (Vec<BacklinkSource>, bool) {
        debug_assert!(!self.links.has_pending(), "link table read before it settled");
        let paths: Vec<&Arc<str>> = self.links.sources_after(target, after).take(n).collect();
        let end = paths.len() < n;
        let sources = paths
            .into_iter()
            .filter_map(|from| {
                Some(BacklinkSource {
                    from: Arc::clone(from),
                    node: Arc::clone(self.files.get_shared(from)?),
                    resolved: Arc::clone(self.links.shared(from)?),
                })
            })
            .collect();
        (sources, end)
    }
}

impl BacklinkSource {
    pub(crate) fn path(&self) -> &Arc<str> {
        &self.from
    }

    /// This note's links to `target`, in note order.
    pub(crate) fn hits(&self, target: &str, out: &mut Vec<Backlink>) {
        for (i, link) in self.node.note.links.iter().enumerate() {
            if self.resolved.target(i, link.markdown).is_some_and(|t| t == target) {
                out.push(Backlink {
                    from: self.from.to_string(),
                    line: link.line,
                    text: link.text.clone(),
                });
            }
        }
    }
}
