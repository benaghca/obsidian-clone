//! `link_index`, `link_changes`, and `backlinks` replies built in bounded steps (review 3).
//!
//! A reply for 50,000 notes used to be cloned whole under the read lock, which a save then
//! waited for. Here each `step` runs under the read lock and copies at most `CHUNK` shared
//! entries (pointers); the JSON-shaped reply is built from them off the lock (`finish`).
//!
//! Between steps the table may change. A link reply records the version it started from and,
//! once the table is settled, patches every path logged since (`LinkTable::logged`), again in
//! steps, until a settled check finds no newer version: the reply then equals `changes` at that
//! version. A `backlinks` reply depends on note text too, so it starts over when the table's
//! version moves or a note it copied is edited (after a few tries it takes the rest in one
//! step).

use super::link_jobs::{budget, BacklinkSource};
use super::link_table::Resolved;
use super::{Edit, EditMark, Index};
use crate::model::{Backlink, LinkChanges, LinkEntry, LinkIndex};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Entries, log paths, or backlink sources copied per step.
pub(crate) const CHUNK: usize = 2_048;

/// What a reply step needs next.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReplyStep {
    /// Another step.
    More,
    /// A settled table (`link_reads` settles, then steps again).
    Settle,
    /// Ready for `finish`.
    Done,
}

/// A `link_index` or `link_changes` reply.
pub(crate) struct LinkReply {
    /// The page's `(id, version)`; `None` asks for the whole index.
    asked: Option<(u64, u64)>,
    /// Set by the first step: the history read, and the page's version when it can be a delta.
    id: u64,
    since: Option<u64>,
    /// Every entry copied is at this version or later, and every change after it is still to
    /// patch.
    base: u64,
    phase: Phase,
    /// Path → its entry (`None`: no entry any more).
    out: BTreeMap<Arc<str>, Option<Arc<Resolved>>>,
    /// What the last step copied, merged into `out` (or the log's paths) by `absorb`, off the
    /// lock.
    copied: Vec<(Arc<str>, Option<Arc<Resolved>>)>,
    logged: Vec<Arc<str>>,
    /// A copy dropped by a restart, freed off the lock too.
    trash: BTreeMap<Arc<str>, Option<Arc<Resolved>>>,
}

enum Phase {
    Start,
    /// Every note after `after`.
    Scan { after: Option<Arc<str>> },
    /// Paths logged in `(since, until]`, `skip` of them taken; `end` once all are.
    Log { since: u64, until: u64, skip: usize, paths: BTreeSet<Arc<str>>, end: bool },
    /// Their entries, from `at`.
    Fetch { paths: Vec<Arc<str>>, at: usize },
    /// Settled and nothing newer: done. Otherwise patch from `base`.
    Check,
}

impl LinkReply {
    /// The reply `link_changes(asked)` gives (`None`: the whole index, as `link_index`).
    pub(crate) fn new(asked: Option<(u64, u64)>) -> Self {
        LinkReply {
            asked,
            id: 0,
            since: None,
            base: 0,
            phase: Phase::Start,
            out: BTreeMap::new(),
            copied: Vec::new(),
            logged: Vec::new(),
            trash: BTreeMap::new(),
        }
    }

    /// Merge what the last step copied (off the lock; `step` does it too if it was not done).
    pub(crate) fn absorb(&mut self) {
        self.trash = BTreeMap::new();
        self.out.extend(self.copied.drain(..));
        if let Phase::Log { paths, end, .. } = &mut self.phase {
            paths.extend(self.logged.drain(..));
            if *end {
                let paths = std::mem::take(paths).into_iter().collect();
                self.phase = Phase::Fetch { paths, at: 0 };
            }
        }
    }

    /// One bounded step, under the read lock.
    pub(crate) fn step(&mut self, index: &Index) -> ReplyStep {
        self.absorb();
        let (id, version, floor) = index.links.stamp();
        let needed = match &self.phase {
            Phase::Start => None,
            Phase::Log { since, .. } => Some(*since),
            _ => Some(self.base),
        };
        // Another history (a reopened vault), or a log that no longer reaches back: start over.
        if needed.is_some_and(|v| id != self.id || v < floor) {
            self.phase = Phase::Start;
            self.trash = std::mem::take(&mut self.out);
        }
        match &mut self.phase {
            Phase::Start => {
                self.id = id;
                self.base = version;
                self.since = self.asked.and_then(|(pid, pv)| (pid == id && pv >= floor && pv <= version).then_some(pv));
                self.phase = match self.since {
                    Some(pv) => Phase::Log { since: pv, until: version, skip: 0, paths: BTreeSet::new(), end: false },
                    None => Phase::Scan { after: None },
                };
                ReplyStep::More
            }
            Phase::Scan { after } => {
                let chunk = index.links.chunk(after.as_deref(), budget(CHUNK));
                let end = chunk.len() < budget(CHUNK);
                *after = chunk.last().map(|(p, _)| Arc::clone(p));
                self.copied.extend(chunk.into_iter().map(|(p, r)| (p, Some(r))));
                if end {
                    self.phase = Phase::Check;
                }
                ReplyStep::More
            }
            Phase::Log { since, until, skip, end, .. } => {
                let (got, last) = index.links.logged(*since, *until, *skip, budget(CHUNK));
                *skip += got.len();
                *end = last;
                self.logged = got;
                ReplyStep::More
            }
            Phase::Fetch { paths, at } => {
                let upto = (*at + budget(CHUNK)).min(paths.len());
                for path in &paths[*at..upto] {
                    self.copied.push((Arc::clone(path), index.links.shared(path).cloned()));
                }
                *at = upto;
                if upto == paths.len() {
                    self.phase = Phase::Check;
                }
                ReplyStep::More
            }
            Phase::Check => {
                if index.links_pending() {
                    return ReplyStep::Settle;
                }
                if version == self.base {
                    return ReplyStep::Done;
                }
                self.phase = Phase::Log { since: self.base, until: version, skip: 0, paths: BTreeSet::new(), end: false };
                self.base = version;
                ReplyStep::More
            }
        }
    }

    /// The whole index (the reply was asked with `None`, or became a full one).
    pub(crate) fn into_index(mut self) -> LinkIndex {
        self.absorb();
        full_index(&self.out)
    }

    /// The `link_changes` reply, built off the lock.
    pub(crate) fn into_changes(mut self) -> LinkChanges {
        self.absorb();
        match self.since {
            None => LinkChanges {
                id: self.id,
                version: self.base,
                since: None,
                full: Some(full_index(&self.out)),
                changed: BTreeMap::new(),
            },
            Some(since) => LinkChanges {
                id: self.id,
                version: self.base,
                since: Some(since),
                full: None,
                changed: self
                    .out
                    .iter()
                    .map(|(path, r)| (path.to_string(), r.as_ref().map(|r| r.entry.clone()).unwrap_or_default()))
                    .collect(),
            },
        }
    }
}

fn full_index(out: &BTreeMap<Arc<str>, Option<Arc<Resolved>>>) -> LinkIndex {
    let mut index = LinkIndex {
        outgoing: BTreeMap::new(),
        markdown: BTreeMap::new(),
        unresolved: BTreeMap::new(),
    };
    for (path, resolved) in out {
        let Some(resolved) = resolved else {
            continue;
        };
        let entry: &LinkEntry = &resolved.entry;
        for (list, map) in [
            (&entry.outgoing, &mut index.outgoing),
            (&entry.markdown, &mut index.markdown),
            (&entry.unresolved, &mut index.unresolved),
        ] {
            if !list.is_empty() {
                map.insert(path.to_string(), list.clone());
            }
        }
    }
    index
}

/// Tries before a `backlinks` reply takes what is left in one step.
const BACKLINK_TRIES: usize = 4;

/// A `backlinks` reply.
pub(crate) struct BacklinkReply {
    targets: Vec<String>,
    /// Which target, and the last source copied for it.
    at: usize,
    after: Option<Arc<str>>,
    /// The edits as of the last step, and the table's (id, version) since the first source
    /// was copied.
    stamp: Option<(EditMark, u64, u64)>,
    got: Vec<Vec<BacklinkSource>>,
    tries: usize,
    /// Sources dropped by a restart, freed off the lock (`absorb`).
    trash: Vec<Vec<BacklinkSource>>,
}

impl BacklinkReply {
    pub(crate) fn new(paths: &[String]) -> Self {
        let targets: Vec<String> = paths.iter().cloned().collect::<BTreeSet<_>>().into_iter().collect();
        let got = targets.iter().map(|_| Vec::new()).collect();
        BacklinkReply { targets, at: 0, after: None, stamp: None, got, tries: 0, trash: Vec::new() }
    }

    /// Free what a restart dropped (off the lock).
    pub(crate) fn absorb(&mut self) {
        self.trash = Vec::new();
    }

    /// One bounded step, under the read lock.
    pub(crate) fn step(&mut self, index: &Index) -> ReplyStep {
        if index.links_pending() {
            return ReplyStep::Settle;
        }
        let (id, version, _) = index.links.stamp();
        // Any entry change can move a source in or out. Otherwise only an edit to a note that
        // links to a target copied so far can change what was copied (its line text): such a
        // note is a source of that target now, or its entry changed.
        let done = &self.targets[..(self.at + 1).min(self.targets.len())];
        let moved = self.stamp.is_some_and(|(mark, then_id, then_version)| {
            (then_id, then_version) != (id, version)
                || index.edits_since(mark).is_none_or(|mut edits| {
                    edits.any(|edit| matches!(edit, Edit::Node(path) if done.iter().any(|t| index.links.is_source(t, path))))
                })
        });
        if moved {
            self.at = 0;
            self.after = None;
            let empty = self.targets.iter().map(|_| Vec::new()).collect();
            self.trash = std::mem::replace(&mut self.got, empty);
            self.tries += 1;
            self.stamp = None;
        }
        self.stamp = Some((index.edit_mark(), id, version));
        let mut left = if self.tries >= BACKLINK_TRIES { usize::MAX } else { budget(CHUNK) };
        while let Some(target) = self.targets.get(self.at) {
            let (sources, end) = index.backlink_sources(target, self.after.as_deref(), left);
            left = left.saturating_sub(sources.len().max(1));
            if let Some(last) = sources.last() {
                self.after = Some(Arc::clone(last.path()));
            }
            self.got[self.at].extend(sources);
            if !end {
                return ReplyStep::More;
            }
            self.at += 1;
            self.after = None;
        }
        ReplyStep::Done
    }

    /// The reply, built off the lock.
    pub(crate) fn finish(self) -> BTreeMap<String, Vec<Backlink>> {
        let mut found = BTreeMap::new();
        for (target, sources) in self.targets.into_iter().zip(self.got) {
            let mut hits = Vec::new();
            for source in &sources {
                source.hits(&target, &mut hits);
            }
            if !hits.is_empty() {
                found.insert(target, hits);
            }
        }
        found
    }
}
