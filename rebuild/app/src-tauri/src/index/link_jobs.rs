//! Link work done off the vault lock (review 3).
//!
//! A large link update (an alias ten thousand notes read, a `README` among thousands, a note
//! with thousands of links) is left queued by the write that caused it (`Index::settle_links`).
//! `link_reads` resolves it in jobs, each in five steps, and only two of them hold the lock:
//!
//! 1. `Index::link_job` (write lock, bounded): clear a step of stale reverse-map memberships,
//!    queue a step of woken keys' readers, and take up to `JOB_NOTES` queued notes or
//!    `JOB_LINKS` links, as shared nodes with their current entries, and an `EditMark`;
//! 2. `LinkJob::ask` (no lock): resolve each note against nothing, which lists every map key
//!    its resolution could read;
//! 3. `Index::answer` (read lock, `ANSWER_STEP` keys a time): look those keys up;
//! 4. `LinkJob::finish` (no lock): resolve each note from the answers, and work out how its
//!    reverse-map memberships move from the entry taken in step 1 (`Moves`, review 4);
//! 5. `Index::publish` (write lock, `MEMBER_STEP` membership changes a hold): store each note's
//!    result unless, since the mark, its node changed, a key it asked about gained or lost an
//!    owner, or its entry is not the one taken. Review 5: the edits since the mark are read
//!    `EDIT_STEP` a hold (`Index::edits_after`) and looked up in the job's own maps from key
//!    and path to note, built in step 2, so a hold's checks never scale with a note's keys. Such a note stays
//!    queued for the next job. A note with more changes than one hold allows is put in over
//!    several holds: its new memberships first, then its entry, then the old memberships are
//!    cleared (`LinkTable::install`, `clean`). After a full map rebuild the job is dropped.
//!
//! A key's answer depends only on that key's owners (and the asking note's folder), so a note
//! stored at publish equals the note resolved against the maps then: what an inline settle
//! would have stored. Saves that touch neither (typing in another note) leave a job valid, so
//! jobs finish while saves keep coming.
//!
//! Replies are built the same way: `link_reads` copies shared entries out in chunks under the
//! read lock and patches them from the change log (`LinkTable::logged`) or the edits
//! (`Index::edited_paths`).

use super::link_table::{Moves, Replaced, Resolved, MEMBER_STEP};
use super::name_maps::{key_hash, Answers, KeyHash, Query, Src};
use super::{has_links, resolve_note, resolve_through, Edit, EditMark, Index, Node};
use crate::model::Backlink;
use std::collections::HashMap;
use std::sync::Arc;

/// Notes, and links, one job takes: its publish (under the write lock) re-links at most these.
/// A note with more links than this is a job of its own.
const JOB_NOTES: usize = 128;
const JOB_LINKS: usize = 1_024;
/// Readers of woken keys queued per job.
const EXPAND_STEP: usize = 4_096;
/// Map keys looked up per read-lock hold.
const ANSWER_STEP: usize = 2_048;
/// Stale memberships checked per job (review 5: as many as a publish changes per hold).
const CLEAN_STEP: usize = MEMBER_STEP;
/// Edits a publish reads per write-lock hold.
const EDIT_STEP: usize = 4_096;

#[cfg(test)]
thread_local! {
    static SMALL: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static SKIPPED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static MOST_EDITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Tests: the most edits one `publish` call read (resets).
#[cfg(test)]
pub(crate) fn take_most_edits() -> usize {
    MOST_EDITS.with(|n| n.replace(0))
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
    /// `publish`: the edits read so far (up to `seen`), and the next note to store.
    seen: EditMark,
    next: usize,
    /// The notes that asked about each key (built by `ask`, off the lock), and each note's
    /// place. An edit marks the notes it names (`changed`) and leaves the maps: once is enough.
    by_key: HashMap<KeyHash, Vec<u32>>,
    by_path: HashMap<Arc<str>, u32>,
    /// Old entries the cleanup is done with: dropped with the job, off the lock.
    _trash: Vec<Arc<Resolved>>,
}

struct NoteJob {
    path: Arc<str>,
    /// `None`: no note with links there any more (its entry goes away).
    node: Option<Arc<Node>>,
    /// Its entry when the job was taken: what `moves` start from.
    before: Option<Arc<Resolved>>,
    asked: Vec<Query>,
    answers: Vec<Option<String>>,
    /// Since the mark, its node changed or a key it asked about did (`publish`).
    changed: bool,
    /// Set by `finish` (unless an answer was missing: then `publish` resolves it).
    done: Option<Finished>,
    /// New memberships put in so far by a staged publish.
    added: usize,
}

struct Finished {
    new: Option<Arc<Resolved>>,
    change: Replaced,
    moves: Moves,
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
    /// Start a job (step 1), or `None` when nothing is queued or left to clear.
    pub(crate) fn link_job(&mut self) -> Option<LinkJob> {
        if !self.links.has_pending() && !self.links.has_cleanup() {
            return None;
        }
        debug_assert!(self.defer_depth == 0 && !self.maps_dirty, "a link job inside a change");
        let trash = self.links.clean(budget(CLEAN_STEP));
        self.links.sweep(budget(EXPAND_STEP), &self.files);
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
                before: self.links.shared(path).cloned(),
                asked: Vec::new(),
                answers: Vec::new(),
                changed: false,
                done: None,
                added: 0,
            });
        }
        let mark = self.edit_mark();
        let by_path = notes.iter().enumerate().map(|(i, note)| (Arc::clone(&note.path), u32::try_from(i).expect("a job holds few notes"))).collect();
        Some(LinkJob { mark, notes, at: (0, 0), seen: mark, next: 0, by_key: HashMap::new(), by_path, _trash: trash })
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

    /// Store a finished job (step 5): each note that nothing it read has changed under, at
    /// most `MEMBER_STEP` membership changes per call. `More`: call again (after letting
    /// writers in).
    pub(crate) fn publish(&mut self, job: &mut LinkJob) -> LinkSlice {
        let Some((edits, reached, all)) = self.edits_after(job.seen, budget(EDIT_STEP)) else {
            // A rebuild (the reverse maps start over) or more edits than the log keeps.
            if let Some(note) = job.notes.get(job.next) {
                if let (true, Some(Finished { new: Some(new), .. })) = (note.added > 0, &note.done) {
                    // Review 6: a deferred rebuild keeps the reverse maps, and what it added.
                    if self.links.is_staging(&note.path) {
                        self.links.forget(&note.path, Arc::clone(new));
                    }
                }
            }
            return LinkSlice::Stale;
        };
        #[cfg(test)]
        let mut read = 0;
        for edit in edits {
            #[cfg(test)]
            {
                read += 1;
            }
            let hit = match edit {
                Edit::Node(path) => job.by_path.remove(path).map(|i| vec![i]),
                Edit::Key(key) => job.by_key.remove(key),
                Edit::Entry(_) => None,
            };
            for i in hit.into_iter().flatten() {
                job.notes[i as usize].changed = true;
            }
        }
        #[cfg(test)]
        MOST_EDITS.with(|n| n.set(n.get().max(read)));
        job.seen = reached;
        if !all {
            // More edits to read first: the next hold goes on with them.
            return LinkSlice::More;
        }
        let mut left = budget(MEMBER_STEP);
        let mut changed = Vec::new();
        let mut out = LinkSlice::Done;
        while let Some(note) = job.notes.get_mut(job.next) {
            let moved = !same(self.links.shared(&note.path), note.before.as_ref());
            if note.changed || moved {
                // Read something that changed: it stays queued for another job.
                if let (true, Some(Finished { new: Some(new), .. })) = (note.added > 0, &note.done) {
                    self.links.forget(&note.path, Arc::clone(new));
                }
                #[cfg(test)]
                SKIPPED.with(|n| n.set(n.get() + 1));
                job.next += 1;
                continue;
            }
            let Some(done) = &note.done else {
                // An answer nobody listed (never expected): resolve this one against the maps.
                let resolved = note.node.as_ref().map(|node| resolve_note(&self.maps, &note.path, &node.note.links));
                self.links.unqueue(&note.path);
                let replaced = self.links.replace(Arc::clone(&note.path), resolved);
                self.entry_changed(&note.path, replaced, &mut changed);
                job.next += 1;
                continue;
            };
            if done.change != Replaced::Same {
                let adds = done.moves.adds();
                let take = (adds - note.added).min(left);
                if let Some(new) = &done.new {
                    self.links.add_moves(&note.path, new, &done.moves, note.added, take);
                }
                note.added += take;
                left -= take;
                if note.added < adds {
                    out = LinkSlice::More;
                    break;
                }
                let used = self.links.install(Arc::clone(&note.path), done.new.clone(), note.before.clone(), &done.moves, left);
                left = left.saturating_sub(used);
            }
            self.links.unqueue(&note.path);
            let (path, change) = (Arc::clone(&note.path), done.change);
            self.entry_changed(&path, change, &mut changed);
            job.next += 1;
            if left == 0 && job.next < job.notes.len() {
                out = LinkSlice::More;
                break;
            }
        }
        self.links.record(changed);
        out
    }

    /// Note an entry change for edits (backlinks) and the history (pages).
    fn entry_changed(&mut self, path: &Arc<str>, replaced: Replaced, changed: &mut Vec<Arc<str>>) {
        if replaced != Replaced::Same {
            self.edits.note(Edit::Entry(Arc::clone(path)));
        }
        if replaced == Replaced::Entry {
            changed.push(Arc::clone(path));
        }
    }
}

/// The same shared entry (or none either way).
fn same(a: Option<&Arc<Resolved>>, b: Option<&Arc<Resolved>>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => Arc::ptr_eq(a, b),
        (None, None) => true,
        _ => false,
    }
}

impl LinkJob {
    /// List every map key each note's resolution could read (step 2, no lock).
    pub(crate) fn ask(&mut self) {
        for (i, note) in self.notes.iter_mut().enumerate() {
            let i = u32::try_from(i).expect("a job holds few notes");
            let Some(node) = &note.node else {
                continue;
            };
            let (_, src) = resolve_through(Src::Ask(Vec::new()), &note.path, &node.note.links);
            let Src::Ask(mut asked) = src else {
                unreachable!("handed back as given")
            };
            asked.sort_unstable();
            asked.dedup();
            for (kind, key) in &asked {
                let notes = self.by_key.entry(key_hash(*kind, key)).or_default();
                // Two keys of one note may share a hash: list the note once.
                if notes.last() != Some(&i) {
                    notes.push(i);
                }
            }
            note.asked = asked;
        }
    }

    /// Resolve each note from its answers, and how its memberships move (step 4, no lock).
    pub(crate) fn finish(&mut self) {
        for note in &mut self.notes {
            let new = match &note.node {
                None => None,
                Some(node) => {
                    let answers = Answers {
                        map: std::mem::take(&mut note.asked).into_iter().zip(std::mem::take(&mut note.answers)).collect(),
                        missing: Default::default(),
                    };
                    let (resolved, _) = resolve_through(Src::Answers(&answers), &note.path, &node.note.links);
                    if answers.missing.get() {
                        continue;
                    }
                    Some(resolved)
                }
            };
            let before = note.before.as_deref();
            let change = Replaced::between(before, new.as_ref());
            let moves = if change == Replaced::Same { Moves::default() } else { Moves::between(before, new.as_ref()) };
            note.done = Some(Finished { new: new.map(Arc::new), change, moves });
        }
    }
}

/// A note linking to a target, shared out of the index for a `backlinks` reply built off the
/// lock.
#[derive(Clone)]
pub(crate) struct BacklinkSource {
    from: Arc<str>,
    node: Arc<Node>,
    resolved: Arc<Resolved>,
}

impl Index {
    /// The notes linking to `target` after `after`, in path order, from the next `n` paths
    /// listed for it, and those paths: how many (fewer than `n` when they were the last) and
    /// the last (where the next call goes on). A path listed for a target it no longer links to
    /// (a stale membership, cleared later) is read but not returned.
    pub(crate) fn backlink_sources(&self, target: &str, after: Option<&str>, n: usize) -> (Vec<BacklinkSource>, usize, Option<Arc<str>>) {
        // Unsettled is fine: a reply patches every note edited since it began, once settled.
        let paths: Vec<&Arc<str>> = self.links.sources_after(target, after).take(n).collect();
        let (read, last) = (paths.len(), paths.last().map(|p| Arc::clone(p)));
        let sources = paths.into_iter().filter_map(|from| self.backlink_source(from)).filter(|s| s.links_to(target)).collect();
        (sources, read, last)
    }

    /// `path` as a backlink source now: its node and entry, if it is a note with links.
    pub(crate) fn backlink_source(&self, path: &Arc<str>) -> Option<BacklinkSource> {
        Some(BacklinkSource {
            from: Arc::clone(path),
            node: Arc::clone(self.files.get_shared(path)?),
            resolved: Arc::clone(self.links.shared(path)?),
        })
    }
}

impl BacklinkSource {
    pub(crate) fn path(&self) -> &Arc<str> {
        &self.from
    }

    /// Whether a link here resolves to `target`.
    pub(crate) fn links_to(&self, target: &str) -> bool {
        self.resolved.has_target(target)
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
