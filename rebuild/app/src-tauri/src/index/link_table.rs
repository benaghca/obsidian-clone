//! Every note's links, resolved, kept up to date one note at a time (piece R2 P2b).
//!
//! For each note with links the table keeps where each link points, its `LinkEntry` (the
//! note's part of `link_index`), and every name-map key its resolution read. Two reverse
//! maps sit beside it:
//!
//! - `by_target`: target path → notes linking to it (in path order), for `backlinks`;
//! - `readers`: map key (as a `KeyHash`) → notes whose resolution read it. When a key's
//!   owners change (a file added, removed, renamed, or its aliases edited), only those notes
//!   can resolve differently, so only they are resolved again.
//!
//! Both hold their notes in a `PathSet`: a short sorted list, or a B-tree once it is long, so
//! adding or removing one note stays cheap when thousands link to one target or read one key
//! (review 1: an alias with 20,000 linkers). Re-resolving a note moves only the memberships
//! that changed (`relink`); its unchanged targets and keys stay where they are.
//!
//! A note is resolved again when its own node changes, or when a key it read changes. The
//! index queues those paths (`touch`) and keys (`wake`) and resolves them once, when the change
//! is done (`Index::settle_links`), or later, off the lock (`link_jobs`). A woken key is queued
//! as the key alone: its readers are queued from it in bounded steps (`expand`, review 3), so a
//! save that changes a key ten thousand notes read does not copy them. A full name-map rebuild
//! resolves every note instead (`refill`).
//!
//! Entries are shared (`Arc`), so a reply copies pointers under the lock and builds its JSON
//! off it (`link_reads`).
//!
//! Each change that alters an entry bumps `version` and logs the paths, so `changes` can
//! answer "what changed since version N" with only those notes. A page that is too far behind
//! (the log keeps the last `LOG_PATHS` paths), or holds another table's `id`, gets the whole index.
//! Tests check the table, `link_index`, `backlinks`, and a page applying every delta against a
//! full walk after each step.

use super::name_maps::{key_hash, Kind, KeyHash};
use crate::model::LinkEntry;
#[cfg(test)]
use crate::model::{LinkChanges, LinkIndex};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::hash::{BuildHasherDefault, Hasher};
use std::ops::Bound;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// `readers` is keyed by a hash already; hashing it again would only cost time.
#[derive(Default)]
struct Identity(u64);

impl Hasher for Identity {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 << 8) | u64::from(b);
        }
    }
    fn write_u64(&mut self, n: u64) {
        self.0 = n;
    }
}

type Readers = HashMap<KeyHash, PathSet, BuildHasherDefault<Identity>>;
/// Woken keys, each with the last reader queued from it so far (`None`: none yet).
type Woken = HashMap<KeyHash, Option<Arc<str>>, BuildHasherDefault<Identity>>;
/// Linking notes per target.
type ByTarget = HashMap<Arc<str>, PathSet>;

/// Up to this many paths a `PathSet` is a sorted `Vec`: one small allocation, and an insert or
/// removal shifts at most this many pointers. Past it, a `BTreeSet`.
const FEW: usize = 32;

/// Notes in path order. Most targets have a few linkers and most keys a few readers, so the
/// common case stays a short `Vec`; a popular one becomes a `BTreeSet`, so a removal from it
/// is a logarithmic step instead of a shift of every later path.
#[derive(Clone, Debug)]
pub(super) enum PathSet {
    Few(Vec<Arc<str>>),
    Many(BTreeSet<Arc<str>>),
}

impl Default for PathSet {
    fn default() -> Self {
        PathSet::Few(Vec::new())
    }
}

impl PartialEq for PathSet {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().eq(other.iter())
    }
}

impl PathSet {
    pub(super) fn iter(&self) -> impl Iterator<Item = &Arc<str>> {
        let (few, many) = match self {
            PathSet::Few(list) => (Some(list.iter()), None),
            PathSet::Many(set) => (None, Some(set.iter())),
        };
        few.into_iter().flatten().chain(many.into_iter().flatten())
    }

    fn len(&self) -> usize {
        match self {
            PathSet::Few(list) => list.len(),
            PathSet::Many(set) => set.len(),
        }
    }

    /// The paths after `after` (all of them for `None`), in order.
    fn after<'s>(&'s self, after: Option<&str>) -> Box<dyn Iterator<Item = &'s Arc<str>> + 's> {
        match (self, after) {
            (PathSet::Few(list), None) => Box::new(list.iter()),
            (PathSet::Few(list), Some(cut)) => {
                let from = list.partition_point(|p| **p <= *cut);
                Box::new(list[from..].iter())
            }
            (PathSet::Many(set), None) => Box::new(set.iter()),
            (PathSet::Many(set), Some(cut)) => Box::new(set.range::<str, _>((Bound::Excluded(cut), Bound::Unbounded))),
        }
    }

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn contains(&self, path: &str) -> bool {
        match self {
            PathSet::Few(list) => list.binary_search_by(|p| (**p).cmp(path)).is_ok(),
            PathSet::Many(set) => set.contains(path),
        }
    }

    fn insert(&mut self, path: &Arc<str>) {
        self.add(path);
        self.seal();
    }

    /// `insert`, but a list stays a list however long it gets (a refill pushes in path order,
    /// so a list is cheaper to grow than a tree). `seal` afterwards.
    fn add(&mut self, path: &Arc<str>) {
        match self {
            PathSet::Few(list) => match list.last() {
                Some(last) if **last >= **path => {
                    if let Err(at) = list.binary_search_by(|p| (**p).cmp(&**path)) {
                        list.insert(at, Arc::clone(path));
                    }
                }
                _ => list.push(Arc::clone(path)),
            },
            PathSet::Many(set) => {
                set.insert(Arc::clone(path));
            }
        }
    }

    /// A list longer than `FEW` becomes a tree (built in one pass from the sorted list).
    fn seal(&mut self) {
        if let PathSet::Few(list) = self {
            if list.len() > FEW {
                *self = PathSet::Many(std::mem::take(list).into_iter().collect());
            }
        }
    }

    fn remove(&mut self, path: &str) {
        match self {
            PathSet::Few(list) => {
                if let Ok(at) = list.binary_search_by(|p| (**p).cmp(path)) {
                    list.remove(at);
                }
            }
            PathSet::Many(set) => {
                set.remove(path);
            }
        }
    }
}

/// Paths kept in the change log (about 24 bytes each, plus the path of a deleted note). A
/// page further behind than this gets the whole index. A folder rename changes about twice
/// as many entries as the folder has linking notes, so this keeps one of 30,000 a delta.
pub(crate) const LOG_PATHS: usize = 65_536;

/// Ids for tables, unique in this process. A reopened vault starts a new history.
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// One note's resolved links.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Resolved {
    /// Per raw link, in note order: its target's place in `entry.markdown` (markdown links) or
    /// `entry.outgoing` (wikilinks). `None` when it resolves to nothing.
    pub(super) slots: Vec<Option<u32>>,
    /// Every key the resolution read, sorted, without repeats.
    pub(super) reads: Vec<KeyHash>,
    pub(super) entry: LinkEntry,
}

impl Resolved {
    /// Where link `i` (a markdown link or not) points.
    pub(super) fn target(&self, i: usize, markdown: bool) -> Option<&String> {
        let list = if markdown {
            &self.entry.markdown
        } else {
            &self.entry.outgoing
        };
        self.slots.get(i).copied().flatten().map(|at| &list[at as usize])
    }

    /// Each target once (a path can be in both `outgoing` and `markdown`).
    fn targets(&self) -> impl Iterator<Item = &String> {
        let out = &self.entry.outgoing;
        out.iter()
            .chain(self.entry.markdown.iter().filter(move |t| !out.contains(t)))
    }
}

#[derive(Clone, Debug)]
struct History {
    id: u64,
    version: u64,
    /// The oldest version `changes` can answer from. Older pages get the whole index.
    floor: u64,
    /// `(version, path)` for every entry change after `floor`, oldest first.
    log: VecDeque<(u64, Arc<str>)>,
}

impl History {
    fn fresh() -> Self {
        History {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            version: 0,
            floor: 0,
            log: VecDeque::new(),
        }
    }
}

#[derive(Debug)]
pub(super) struct LinkTable {
    notes: BTreeMap<Arc<str>, Arc<Resolved>>,
    by_target: ByTarget,
    readers: Readers,
    /// Notes to resolve again when the current change is done.
    pending: HashSet<Arc<str>>,
    /// Keys whose owners changed: their readers are still to be queued in `pending`.
    woken: Woken,
    history: History,
    /// `LOG_PATHS`; tests set a smaller cap.
    log_paths: usize,
}

impl Default for LinkTable {
    fn default() -> Self {
        LinkTable {
            notes: BTreeMap::new(),
            by_target: ByTarget::default(),
            readers: Readers::default(),
            pending: HashSet::new(),
            woken: Woken::default(),
            history: History::fresh(),
            log_paths: LOG_PATHS,
        }
    }
}

impl LinkTable {
    /// The shared entry, for a reply built off the lock.
    pub(super) fn shared(&self, path: &str) -> Option<&Arc<Resolved>> {
        self.notes.get(path)
    }

    pub(super) fn contains(&self, path: &str) -> bool {
        self.notes.contains_key(path)
    }

    /// Whether `path` has a link resolving to `target`.
    pub(super) fn is_source(&self, target: &str, path: &str) -> bool {
        self.by_target.get(target).is_some_and(|set| set.contains(path))
    }

    /// The notes linking to `target`, after `after`, in path order.
    pub(super) fn sources_after<'s>(&'s self, target: &str, after: Option<&'s str>) -> impl Iterator<Item = &'s Arc<str>> + 's {
        self.by_target.get(target).into_iter().flat_map(move |set| set.after(after))
    }

    /// Resolve `path` again once the change is done (its node changed or went away).
    pub(super) fn touch(&mut self, path: &str) {
        let key = self
            .notes
            .get_key_value(path)
            .map(|(k, _)| Arc::clone(k))
            .unwrap_or_else(|| Arc::from(path));
        self.pending.insert(key);
    }

    /// The owners of one key changed: every note that read it resolves again. Only the key is
    /// queued here; `expand` queues its readers. Waking it again starts them over, since a
    /// reader queued and resolved already may have read the old owners.
    pub(super) fn wake(&mut self, kind: Kind, key: String) {
        let hash = key_hash(kind, &key);
        if self.readers.contains_key(&hash) {
            self.woken.insert(hash, None);
        }
    }

    /// Queue up to `budget` readers of woken keys. Readers are taken in path order from where
    /// the last step stopped. One that stops reading the key meanwhile was resolved against
    /// the new owners; one that starts reading it was too; so a moving set misses nobody.
    pub(super) fn expand(&mut self, mut budget: usize) {
        while budget > 0 {
            let Some((&key, last)) = self.woken.iter().next() else {
                return;
            };
            let last = last.clone();
            let mut queued = 0;
            let mut stop = None;
            if let Some(set) = self.readers.get(&key) {
                for path in set.after(last.as_deref()) {
                    if queued == budget {
                        break;
                    }
                    self.pending.insert(Arc::clone(path));
                    stop = Some(Arc::clone(path));
                    queued += 1;
                }
                let more = set.after(stop.as_deref()).next().is_some();
                if queued == budget && more {
                    self.woken.insert(key, stop);
                    return;
                }
            }
            self.woken.remove(&key);
            budget -= queued;
        }
    }

    pub(super) fn has_pending(&self) -> bool {
        !self.pending.is_empty() || !self.woken.is_empty()
    }

    /// Notes queued, counting every reader of a woken key (a bound: some are queued already).
    pub(super) fn queued_work(&self) -> usize {
        let woken: usize = self.woken.keys().map(|k| self.readers.get(k).map_or(0, PathSet::len)).sum();
        self.pending.len() + woken
    }

    /// The queued notes (after `expand`).
    pub(super) fn pending(&self) -> impl Iterator<Item = &Arc<str>> {
        self.pending.iter()
    }

    pub(super) fn unqueue(&mut self, path: &str) {
        self.pending.remove(path);
    }

    /// Up to `n` queued notes, taken off the queue.
    pub(super) fn take_some(&mut self, n: usize) -> Vec<Arc<str>> {
        let some: Vec<Arc<str>> = self.pending.iter().take(n).cloned().collect();
        for path in &some {
            self.pending.remove(path);
        }
        some
    }

    /// Put `new` (or nothing, for a path that is no note with links any more) at `path`.
    /// True when its entry changed.
    pub(super) fn replace(&mut self, path: Arc<str>, new: Option<Resolved>) -> bool {
        let old = match new {
            Some(new) => {
                if self.notes.get(&path).is_some_and(|old| **old == new) {
                    return false;
                }
                self.notes.insert(Arc::clone(&path), Arc::new(new))
            }
            None => self.notes.remove(&path),
        };
        let new = self.notes.get(&path).map(|r| &**r);
        relink(&mut self.by_target, &mut self.readers, &path, old.as_deref(), new);
        old.as_ref().map(|r| &r.entry) != new.map(|r| &r.entry)
    }

    /// Replace every note at once (a full name-map rebuild). `fresh` must come in path order.
    /// Only notes whose entries differ are logged.
    pub(super) fn refill(&mut self, fresh: impl IntoIterator<Item = (Arc<str>, Resolved)>) {
        let notes: BTreeMap<Arc<str>, Arc<Resolved>> = fresh.into_iter().map(|(p, r)| (p, Arc::new(r))).collect();
        let mut by_target = ByTarget::default();
        let mut readers = Readers::default();
        // In path order, so each list is pushed sorted.
        for (path, resolved) in &notes {
            link(&mut by_target, &mut readers, path, resolved);
        }
        seal_all(&mut by_target, &mut readers);
        // A new table's first build: no page holds a version of it, so there is nothing to log.
        let changed = if self.history.version == 0 {
            Vec::new()
        } else {
            diff(&self.notes, &notes)
        };
        if self.history.version == 0 {
            self.history.version = 1;
            self.history.floor = 1;
        }
        self.notes = notes;
        self.by_target = by_target;
        self.readers = readers;
        self.pending.clear();
        self.woken.clear();
        self.record(changed);
    }

    /// Log one change: these paths' entries are new.
    pub(super) fn record(&mut self, changed: Vec<Arc<str>>) {
        if changed.is_empty() {
            return;
        }
        let cap = self.log_paths;
        let h = &mut self.history;
        h.version += 1;
        if changed.len() > cap {
            h.log.clear();
            h.floor = h.version;
            return;
        }
        let version = h.version;
        h.log.extend(changed.into_iter().map(|path| (version, path)));
        while h.log.len() > cap {
            let (gone, _) = h.log.pop_front().expect("log is not empty");
            h.floor = gone;
        }
    }

    /// Continue `older`'s history (a rescan replaced the index): same id, and only notes whose
    /// entries differ from `older` are logged.
    pub(super) fn continue_from(&mut self, older: &LinkTable) {
        self.history = older.history.clone();
        let changed = diff(&older.notes, &self.notes);
        self.record(changed);
    }

    /// `(id, version, floor)`: `changes` answers versions from `floor` to `version`.
    pub(super) fn stamp(&self) -> (u64, u64, u64) {
        (self.history.id, self.history.version, self.history.floor)
    }

    /// Up to `n` notes after `after`, in path order, shared.
    pub(super) fn chunk(&self, after: Option<&str>, n: usize) -> Vec<(Arc<str>, Arc<Resolved>)> {
        let range = match after {
            Some(cut) => self.notes.range::<str, _>((Bound::Excluded(cut), Bound::Unbounded)),
            None => self.notes.range::<str, _>(..),
        };
        range.take(n).map(|(p, r)| (Arc::clone(p), Arc::clone(r))).collect()
    }

    /// Paths logged after version `since` and up to `until`, skipping the first `skip` of them,
    /// at most `n`. Needs `since >= floor`: the log then holds every change after `since`, in
    /// version order, so a reader can walk it in steps. True when none remain after these.
    pub(super) fn logged(&self, since: u64, until: u64, skip: usize, n: usize) -> (Vec<Arc<str>>, bool) {
        debug_assert!(since >= self.history.floor);
        let log = &self.history.log;
        let from = log.partition_point(|(v, _)| *v <= since) + skip;
        let mut out = Vec::new();
        for (v, path) in log.range(from.min(log.len())..) {
            if *v > until {
                return (out, true);
            }
            if out.len() == n {
                return (out, false);
            }
            out.push(Arc::clone(path));
        }
        (out, true)
    }

    /// Every note's entry, as `link_index` sends it.
    #[cfg(test)]
    pub(super) fn link_index(&self) -> LinkIndex {
        let mut out = LinkIndex {
            outgoing: BTreeMap::new(),
            markdown: BTreeMap::new(),
            unresolved: BTreeMap::new(),
        };
        for (path, resolved) in &self.notes {
            let entry = &resolved.entry;
            for (list, map) in [
                (&entry.outgoing, &mut out.outgoing),
                (&entry.markdown, &mut out.markdown),
                (&entry.unresolved, &mut out.unresolved),
            ] {
                if !list.is_empty() {
                    map.insert(path.to_string(), list.clone());
                }
            }
        }
        out
    }

    /// The entries changed since `since` (an id and a version this table sent), or the whole
    /// index when that is not something this table can answer. `link_replies` builds the same
    /// reply in steps.
    #[cfg(test)]
    pub(super) fn changes(&self, since: Option<(u64, u64)>) -> LinkChanges {
        let h = &self.history;
        let from = since.and_then(|(id, version)| {
            (id == h.id && version >= h.floor && version <= h.version).then_some(version)
        });
        let Some(from) = from else {
            return LinkChanges {
                id: h.id,
                version: h.version,
                since: None,
                full: Some(self.link_index()),
                changed: BTreeMap::new(),
            };
        };
        let paths: BTreeSet<&Arc<str>> = h
            .log
            .iter()
            .rev()
            .take_while(|(version, _)| *version > from)
            .map(|(_, path)| path)
            .collect();
        let changed = paths
            .into_iter()
            .map(|path| {
                let entry = self.notes.get(path).map(|r| r.entry.clone()).unwrap_or_default();
                (path.to_string(), entry)
            })
            .collect();
        LinkChanges {
            id: h.id,
            version: h.version,
            since: Some(from),
            full: None,
            changed,
        }
    }

    #[cfg(test)]
    pub(super) fn set_log_paths(&mut self, cap: usize) {
        self.log_paths = cap;
    }

    #[cfg(test)]
    pub(super) fn version(&self) -> (u64, u64) {
        (self.history.id, self.history.version)
    }

    #[cfg(test)]
    pub(super) fn notes(&self) -> &BTreeMap<Arc<str>, Arc<Resolved>> {
        &self.notes
    }

    /// The two reverse maps, rebuilt from `notes`, against the live ones.
    #[cfg(test)]
    pub(super) fn reverse_maps_match(&self) -> bool {
        let mut by_target = ByTarget::default();
        let mut readers = Readers::default();
        for (path, resolved) in &self.notes {
            link(&mut by_target, &mut readers, path, resolved);
        }
        seal_all(&mut by_target, &mut readers);
        // A set's form (list or tree) depends on its history; compare the paths.
        let plain = |map: &Readers| -> HashMap<KeyHash, Vec<Arc<str>>> {
            map.iter().map(|(k, v)| (*k, v.iter().cloned().collect())).collect()
        };
        let in_order = self.by_target.values().chain(self.readers.values()).all(|set| {
            let paths: Vec<_> = set.iter().collect();
            !paths.is_empty() && paths.windows(2).all(|w| w[0] < w[1])
        });
        in_order && by_target == self.by_target && plain(&readers) == plain(&self.readers)
    }
}

/// Add every membership of a note that had none (a refill: no diff to take). `seal_all` after
/// the last note.
fn link(by_target: &mut ByTarget, readers: &mut Readers, path: &Arc<str>, resolved: &Resolved) {
    for target in resolved.targets() {
        match by_target.get_mut(target.as_str()) {
            Some(set) => set.add(path),
            None => by_target.entry(Arc::from(target.as_str())).or_default().add(path),
        }
    }
    for key in &resolved.reads {
        readers.entry(*key).or_default().add(path);
    }
}

fn seal_all(by_target: &mut ByTarget, readers: &mut Readers) {
    by_target.values_mut().chain(readers.values_mut()).for_each(PathSet::seal);
}

/// Move `path`'s memberships from `old` to `new`: only targets and keys that are in one and
/// not the other are touched.
fn relink(by_target: &mut ByTarget, readers: &mut Readers, path: &Arc<str>, old: Option<&Resolved>, new: Option<&Resolved>) {
    fn targets(r: Option<&Resolved>) -> Vec<&str> {
        let mut out: Vec<&str> = r.into_iter().flat_map(Resolved::targets).map(String::as_str).collect();
        out.sort_unstable();
        out.dedup();
        out
    }
    fn reads(r: Option<&Resolved>) -> &[KeyHash] {
        r.map_or(&[], |r| r.reads.as_slice())
    }
    for (target, added) in sorted_diff(&targets(old), &targets(new)) {
        if added {
            match by_target.get_mut(*target) {
                Some(set) => set.insert(path),
                None => by_target.entry(Arc::from(*target)).or_default().insert(path),
            }
        } else if let Some(set) = by_target.get_mut(*target) {
            set.remove(path);
            if set.is_empty() {
                by_target.remove(*target);
            }
        }
    }
    for (key, added) in sorted_diff(reads(old), reads(new)) {
        if added {
            readers.entry(*key).or_default().insert(path);
        } else if let Some(set) = readers.get_mut(key) {
            set.remove(path);
            if set.is_empty() {
                readers.remove(key);
            }
        }
    }
}

/// Items in exactly one of two sorted, repeat-free lists: `(item, true)` when only in `new`.
fn sorted_diff<'a, T: Ord>(old: &'a [T], new: &'a [T]) -> Vec<(&'a T, bool)> {
    let mut out = Vec::new();
    let (mut a, mut b) = (old.iter().peekable(), new.iter().peekable());
    loop {
        match (a.peek(), b.peek()) {
            (None, None) => break,
            (Some(x), None) => {
                out.push((*x, false));
                a.next();
            }
            (None, Some(y)) => {
                out.push((*y, true));
                b.next();
            }
            (Some(x), Some(y)) => match x.cmp(y) {
                std::cmp::Ordering::Less => {
                    out.push((*x, false));
                    a.next();
                }
                std::cmp::Ordering::Greater => {
                    out.push((*y, true));
                    b.next();
                }
                std::cmp::Ordering::Equal => {
                    a.next();
                    b.next();
                }
            },
        }
    }
    out
}

/// Paths whose entries differ between `old` and `new` (added, removed, or changed).
fn diff(old: &BTreeMap<Arc<str>, Arc<Resolved>>, new: &BTreeMap<Arc<str>, Arc<Resolved>>) -> Vec<Arc<str>> {
    let mut out = Vec::new();
    let mut a = old.iter().peekable();
    let mut b = new.iter().peekable();
    loop {
        match (a.peek(), b.peek()) {
            (None, None) => break,
            (Some((path, _)), None) => {
                out.push(Arc::clone(path));
                a.next();
            }
            (None, Some((path, _))) => {
                out.push(Arc::clone(path));
                b.next();
            }
            (Some((pa, ra)), Some((pb, rb))) => match pa.cmp(pb) {
                std::cmp::Ordering::Less => {
                    out.push(Arc::clone(pa));
                    a.next();
                }
                std::cmp::Ordering::Greater => {
                    out.push(Arc::clone(pb));
                    b.next();
                }
                std::cmp::Ordering::Equal => {
                    if ra.entry != rb.entry {
                        out.push(Arc::clone(pb));
                    }
                    a.next();
                    b.next();
                }
            },
        }
    }
    out
}
