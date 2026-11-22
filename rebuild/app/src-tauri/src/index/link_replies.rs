//! `link_index`, `link_changes`, and `backlinks` replies built in bounded steps (review 3).
//!
//! A reply for 50,000 notes used to be cloned whole under the read lock, which a save then
//! waited for. Here each `step` runs under the read lock and copies at most `CHUNK` shared
//! entries (pointers); the JSON-shaped reply is built from them off the lock (`finish`).
//!
//! Between steps the table may change. A link reply records the version it started from and,
//! once the table is settled, patches every path logged since (`LinkTable::logged`), again in
//! steps, until a settled check finds no newer version: the reply then equals `changes` at that
//! version. A `backlinks` reply depends on note text and on where each link points, which
//! can change with the entry the same (review 4: an alias moving between two targets a note
//! links to anyway). So it patches from the index's edits instead: once settled, every note
//! whose node or resolved links changed since the reply began is copied again, in steps, until
//! a settled check finds no newer edit. It starts over only when the edits are not known any
//! more (a full rebuild, a rescan's new index, or more edits than the log keeps), still in
//! bounded steps.

use super::link_jobs::{budget, BacklinkSource};
use super::link_table::Resolved;
use super::{EditMark, Index};
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

/// A `backlinks` reply.
pub(crate) struct BacklinkReply {
    targets: Vec<String>,
    phase: Back,
    /// Every edit after this is still to patch (set when copying starts).
    mark: Option<EditMark>,
    /// Per target: its sources, by path.
    got: Vec<BTreeMap<Arc<str>, BacklinkSource>>,
    /// What the last step copied, merged into `got` by `absorb`, off the lock: sources of one
    /// target, or notes edited since the mark (`None`: no note with links there now).
    copied: Vec<(usize, Vec<BacklinkSource>)>,
    fetched: Vec<(Arc<str>, Option<BacklinkSource>)>,
    logged: Vec<Arc<str>>,
    /// Sources dropped by a restart, freed off the lock too.
    trash: Vec<BTreeMap<Arc<str>, BacklinkSource>>,
}

enum Back {
    Start,
    /// Sources of `targets[at]` after `after`.
    Copy { at: usize, after: Option<Arc<str>> },
    /// Paths edited after `since` up to `until`, `skip` edits read; `end` once all are.
    Log { since: EditMark, until: EditMark, skip: usize, paths: BTreeSet<Arc<str>>, end: bool },
    /// Those notes, from `at`.
    Fetch { paths: Vec<Arc<str>>, at: usize },
    /// Settled and no edit since the mark: done. Otherwise patch from it.
    Check,
}

impl BacklinkReply {
    pub(crate) fn new(paths: &[String]) -> Self {
        let targets: Vec<String> = paths.iter().cloned().collect::<BTreeSet<_>>().into_iter().collect();
        let got = targets.iter().map(|_| BTreeMap::new()).collect();
        BacklinkReply {
            targets,
            phase: Back::Start,
            mark: None,
            got,
            copied: Vec::new(),
            fetched: Vec::new(),
            logged: Vec::new(),
            trash: Vec::new(),
        }
    }

    /// Merge what the last step copied (off the lock; `step` does it too if it was not done).
    pub(crate) fn absorb(&mut self) {
        self.trash = Vec::new();
        for (at, sources) in self.copied.drain(..) {
            let target = &self.targets[at];
            for source in sources.into_iter().filter(|s| s.links_to(target)) {
                self.got[at].insert(Arc::clone(source.path()), source);
            }
        }
        for (path, source) in self.fetched.drain(..) {
            for (target, got) in self.targets.iter().zip(&mut self.got) {
                got.remove(&path);
                if let Some(source) = source.as_ref().filter(|s| s.links_to(target)) {
                    got.insert(Arc::clone(&path), source.clone());
                }
            }
        }
        if let Back::Log { paths, end, .. } = &mut self.phase {
            paths.extend(self.logged.drain(..));
            if *end {
                let paths = std::mem::take(paths).into_iter().collect();
                self.phase = Back::Fetch { paths, at: 0 };
            }
        }
    }

    fn restart(&mut self) {
        let empty = self.targets.iter().map(|_| BTreeMap::new()).collect();
        self.trash = std::mem::replace(&mut self.got, empty);
        self.phase = Back::Start;
        self.mark = None;
    }

    /// One bounded step, under the read lock.
    pub(crate) fn step(&mut self, index: &Index) -> ReplyStep {
        self.absorb();
        // The edits since the mark are what the patch needs: when they are not known any more,
        // start over.
        if self.mark.is_some_and(|mark| index.edits_since(mark).is_none()) {
            self.restart();
        }
        match &mut self.phase {
            Back::Start => {
                if index.links_pending() {
                    return ReplyStep::Settle;
                }
                self.mark = Some(index.edit_mark());
                self.phase = Back::Copy { at: 0, after: None };
                ReplyStep::More
            }
            Back::Copy { at, after } => {
                let mut left = budget(CHUNK);
                while let Some(target) = self.targets.get(*at) {
                    let (sources, read, last) = index.backlink_sources(target, after.as_deref(), left);
                    let end = read < left;
                    left = left.saturating_sub(read.max(1));
                    if last.is_some() {
                        *after = last;
                    }
                    self.copied.push((*at, sources));
                    if !end {
                        return ReplyStep::More;
                    }
                    *at += 1;
                    *after = None;
                    if left == 0 {
                        return ReplyStep::More;
                    }
                }
                self.phase = Back::Check;
                ReplyStep::More
            }
            Back::Log { since, until, skip, end, .. } => {
                let Some((paths, read, last)) = index.edited_paths(*since, *until, *skip, budget(CHUNK)) else {
                    self.restart();
                    return ReplyStep::More;
                };
                *skip += read;
                *end = last;
                self.logged = paths;
                ReplyStep::More
            }
            Back::Fetch { paths, at } => {
                let upto = (*at + budget(CHUNK)).min(paths.len());
                for path in &paths[*at..upto] {
                    self.fetched.push((Arc::clone(path), index.backlink_source(path)));
                }
                *at = upto;
                if upto == paths.len() {
                    self.phase = Back::Check;
                }
                ReplyStep::More
            }
            Back::Check => {
                if index.links_pending() {
                    return ReplyStep::Settle;
                }
                let since = self.mark.expect("a mark is set before copying");
                let now = index.edit_mark();
                if now == since {
                    return ReplyStep::Done;
                }
                self.phase = Back::Log { since, until: now, skip: 0, paths: BTreeSet::new(), end: false };
                self.mark = Some(now);
                ReplyStep::More
            }
        }
    }

    /// The reply, built off the lock.
    pub(crate) fn finish(mut self) -> BTreeMap<String, Vec<Backlink>> {
        self.absorb();
        let mut found = BTreeMap::new();
        for (target, sources) in self.targets.into_iter().zip(self.got) {
            let mut hits = Vec::new();
            for source in sources.values() {
                source.hits(&target, &mut hits);
            }
            if !hits.is_empty() {
                found.insert(target, hits);
            }
        }
        found
    }
}
