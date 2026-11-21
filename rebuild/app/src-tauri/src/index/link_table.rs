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
//! that changed (`Moves`, from each entry's sorted targets); its unchanged targets and keys
//! stay where they are. Review 4: a long note's changes go in a bounded number at a time. Its
//! new memberships go in before its entry does (a job's publish, `add_moves`, `install`), and
//! old ones are cleared after it (`clean`), so between steps the maps can hold a stale note,
//! never miss one.
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

type ReaderPart = HashMap<KeyHash, PathSet, BuildHasherDefault<Identity>>;

/// The readers of each map key, in `READER_PARTS` maps by key hash (review 5): growing one
/// rehashes a part of the keys, so a note bringing tens of thousands of new keys never doubles
/// the whole map in one hold. A part is picked by bits the maps themselves leave alone (their
/// buckets take the low bits, their tags the top seven).
#[derive(Clone, Debug)]
struct Readers(Vec<ReaderPart>);

const READER_PARTS: usize = 64;

impl Default for Readers {
    fn default() -> Self {
        Readers((0..READER_PARTS).map(|_| ReaderPart::default()).collect())
    }
}

impl Readers {
    fn part(key: KeyHash) -> usize {
        (key >> 32) as usize % READER_PARTS
    }
    fn contains_key(&self, key: &KeyHash) -> bool {
        self.0[Self::part(*key)].contains_key(key)
    }
    fn get(&self, key: &KeyHash) -> Option<&PathSet> {
        self.0[Self::part(*key)].get(key)
    }
    fn get_mut(&mut self, key: &KeyHash) -> Option<&mut PathSet> {
        self.0[Self::part(*key)].get_mut(key)
    }
    fn entry(&mut self, key: KeyHash) -> std::collections::hash_map::Entry<'_, KeyHash, PathSet> {
        self.0[Self::part(key)].entry(key)
    }
    fn remove(&mut self, key: &KeyHash) -> Option<PathSet> {
        self.0[Self::part(*key)].remove(key)
    }
    fn values_mut(&mut self) -> impl Iterator<Item = &mut PathSet> {
        self.0.iter_mut().flat_map(HashMap::values_mut)
    }
    #[cfg(test)]
    fn values(&self) -> impl Iterator<Item = &PathSet> {
        self.0.iter().flat_map(HashMap::values)
    }
    #[cfg(test)]
    fn iter(&self) -> impl Iterator<Item = (&KeyHash, &PathSet)> {
        self.0.iter().flat_map(HashMap::iter)
    }
}
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
    /// Each target once, in byte order, as places in `outgoing` then `markdown` (one list):
    /// the note's `by_target` memberships, sorted when it is resolved (review 4: worked out
    /// off the lock for a job, so the write lock never sorts or scans a long note's targets).
    members: Vec<u32>,
}

impl Resolved {
    pub(super) fn new(slots: Vec<Option<u32>>, reads: Vec<KeyHash>, entry: LinkEntry) -> Self {
        let mut r = Resolved { slots, reads, entry, members: Vec::new() };
        let mut members: Vec<u32> = (0..(r.entry.outgoing.len() + r.entry.markdown.len()) as u32).collect();
        members.sort_by(|a, b| r.member(*a).cmp(r.member(*b)));
        members.dedup_by(|a, b| r.member(*a) == r.member(*b));
        r.members = members;
        r
    }

    /// Where link `i` (a markdown link or not) points.
    pub(super) fn target(&self, i: usize, markdown: bool) -> Option<&String> {
        let list = if markdown {
            &self.entry.markdown
        } else {
            &self.entry.outgoing
        };
        self.slots.get(i).copied().flatten().and_then(|at| list.get(at as usize))
    }

    /// Place `k` of `outgoing` then `markdown`.
    fn member(&self, k: u32) -> &str {
        let k = k as usize;
        let out = &self.entry.outgoing;
        if k < out.len() {
            &out[k]
        } else {
            &self.entry.markdown[k - out.len()]
        }
    }

    /// Each target once, in byte order.
    pub(super) fn targets(&self) -> impl Iterator<Item = &str> {
        self.members.iter().map(|k| self.member(*k))
    }

    /// Whether a link here resolves to `target` (a binary search).
    pub(super) fn has_target(&self, target: &str) -> bool {
        self.members.binary_search_by(|k| self.member(*k).cmp(target)).is_ok()
    }

    fn has_read(&self, key: KeyHash) -> bool {
        self.reads.binary_search(&key).is_ok()
    }

    /// Reverse-map memberships: targets, then keys read.
    fn size(&self) -> usize {
        self.members.len() + self.reads.len()
    }
}

/// What a replacement changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Replaced {
    /// Nothing.
    Same,
    /// Where links point (a backlink can move), not the entry pages hold.
    Slots,
    /// The entry too.
    Entry,
}

impl Replaced {
    pub(super) fn between(old: Option<&Resolved>, new: Option<&Resolved>) -> Replaced {
        if old == new {
            Replaced::Same
        } else if old.map(|r| &r.entry) == new.map(|r| &r.entry) {
            Replaced::Slots
        } else {
            Replaced::Entry
        }
    }
}

/// A note's reverse-map memberships that changed between two resolutions, worked out off the
/// lock (`moves`) and applied under it in bounded steps (`LinkTable::add_moves`, `install`).
#[derive(Debug, Default)]
pub(super) struct Moves {
    /// Targets (as places in the new entry's `members`) and keys only the new one has.
    add_targets: Vec<u32>,
    add_reads: Vec<KeyHash>,
    /// Targets (places in the old entry's `members`) and keys only the old one has.
    drop_targets: Vec<u32>,
    drop_reads: Vec<KeyHash>,
}

impl Moves {
    /// Both sorted, so one merge of each pair of lists.
    pub(super) fn between(old: Option<&Resolved>, new: Option<&Resolved>) -> Moves {
        let mut m = Moves::default();
        let none = Resolved::new(Vec::new(), Vec::new(), LinkEntry::default());
        let (o, n) = (old.unwrap_or(&none), new.unwrap_or(&none));
        let (mut a, mut b) = (0, 0);
        while a < o.members.len() || b < n.members.len() {
            let order = match (o.members.get(a), n.members.get(b)) {
                (Some(x), Some(y)) => o.member(*x).cmp(n.member(*y)),
                (Some(_), None) => std::cmp::Ordering::Less,
                _ => std::cmp::Ordering::Greater,
            };
            match order {
                std::cmp::Ordering::Less => {
                    m.drop_targets.push(o.members[a]);
                    a += 1;
                }
                std::cmp::Ordering::Greater => {
                    m.add_targets.push(n.members[b]);
                    b += 1;
                }
                std::cmp::Ordering::Equal => {
                    a += 1;
                    b += 1;
                }
            }
        }
        for (key, added) in sorted_diff(&o.reads, &n.reads) {
            if added {
                m.add_reads.push(*key);
            } else {
                m.drop_reads.push(*key);
            }
        }
        m
    }

    pub(super) fn adds(&self) -> usize {
        self.add_targets.len() + self.add_reads.len()
    }

    fn drops(&self) -> usize {
        self.drop_targets.len() + self.drop_reads.len()
    }
}

/// An old resolution whose memberships may still be in the reverse maps: each is removed
/// unless the note's entry now has it (`LinkTable::clean`).
#[derive(Debug)]
struct Stale {
    path: Arc<str>,
    old: Arc<Resolved>,
    /// Memberships checked so far: targets, then keys.
    at: usize,
}

/// Reverse-map membership changes per write-lock hold: a replacement with more is staged
/// (`Moves`, `Stale`).
pub(super) const MEMBER_STEP: usize = 2_048;

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
    /// Old resolutions to clear out of the reverse maps, a step at a time (review 4). Until
    /// then the maps hold too many notes for some targets and keys, never too few: a reader
    /// of a key resolves again for nothing, and a backlink source with no link to the target
    /// has no lines.
    stale: VecDeque<Stale>,
    /// The note a job is adding memberships for, before its entry goes in: `clean` leaves its
    /// memberships alone meanwhile.
    staging: Option<Arc<str>>,
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
            stale: VecDeque::new(),
            staging: None,
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
    pub(super) fn replace(&mut self, path: Arc<str>, new: Option<Resolved>) -> Replaced {
        let old = self.notes.get(&path).cloned();
        let changed = Replaced::between(old.as_deref(), new.as_ref());
        if changed == Replaced::Same {
            return changed;
        }
        let new = new.map(Arc::new);
        match &new {
            Some(new) => self.notes.insert(Arc::clone(&path), Arc::clone(new)),
            None => self.notes.remove(&path),
        };
        let (by_target, readers) = (&mut self.by_target, &mut self.readers);
        match old {
            // A long old entry: its memberships are cleared later, in steps. Only the new
            // entry's own go in now (an inline settle's new entries are short).
            Some(old) if old.size() > super::link_jobs::budget(MEMBER_STEP) => {
                if let Some(new) = &new {
                    for target in new.targets().filter(|t| !old.has_target(t)) {
                        add_target(by_target, target, &path);
                    }
                    for key in new.reads.iter().filter(|k| !old.has_read(**k)) {
                        readers.entry(*key).or_default().insert(&path);
                    }
                }
                self.stale.push_back(Stale { path, old, at: 0 });
            }
            old => {
                let moves = Moves::between(old.as_deref(), new.as_deref());
                apply_adds(by_target, readers, &path, new.as_deref(), &moves, 0, usize::MAX);
                apply_drops(by_target, readers, &path, old.as_deref(), &moves);
            }
        }
        changed
    }

    /// Add up to `n` of `moves`' new memberships for `path`, from the `from`-th (a job's
    /// staged publish: its new entry goes in once all are in).
    pub(super) fn add_moves(&mut self, path: &Arc<str>, new: &Resolved, moves: &Moves, from: usize, n: usize) {
        self.staging = Some(Arc::clone(path));
        apply_adds(&mut self.by_target, &mut self.readers, path, Some(new), moves, from, n);
    }

    /// Put a job's entry in once its new memberships are (`add_moves`): the old ones go now
    /// if there are at most `room` of them, or are cleared later. Returns the changes made.
    pub(super) fn install(&mut self, path: Arc<str>, new: Option<Arc<Resolved>>, old: Option<Arc<Resolved>>, moves: &Moves, room: usize) -> usize {
        self.staging = None;
        match &new {
            Some(new) => self.notes.insert(Arc::clone(&path), Arc::clone(new)),
            None => self.notes.remove(&path),
        };
        match old {
            Some(old) if moves.drops() > room => {
                self.stale.push_back(Stale { path, old, at: 0 });
                1
            }
            old => {
                apply_drops(&mut self.by_target, &mut self.readers, &path, old.as_deref(), moves);
                moves.drops()
            }
        }
    }

    /// A staged publish given up: what it added is cleared later, unless the entry has it.
    pub(super) fn forget(&mut self, path: &Arc<str>, partial: Arc<Resolved>) {
        self.staging = None;
        self.stale.push_back(Stale { path: Arc::clone(path), old: partial, at: 0 });
    }

    pub(super) fn has_cleanup(&self) -> bool {
        !self.stale.is_empty()
    }

    /// Check up to `budget` stale memberships, removing each the note's entry lacks. The old
    /// entries done with come back, for the caller to drop off the lock (review 5: a long
    /// note's entry is tens of thousands of strings).
    pub(super) fn clean(&mut self, budget: usize) -> Vec<Arc<Resolved>> {
        let mut done = Vec::new();
        clean(&self.notes, &mut self.by_target, &mut self.readers, &mut self.stale, self.staging.as_deref(), budget, &mut done);
        done
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
        self.stale.clear();
        self.staging = None;
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

    /// The two reverse maps, rebuilt from `notes`, against the live ones once their stale
    /// memberships are cleared (on a copy).
    #[cfg(test)]
    pub(super) fn reverse_maps_match(&self) -> bool {
        let (mut live_targets, mut live_readers) = (self.by_target.clone(), self.readers.clone());
        let mut stale: VecDeque<Stale> = self.stale.iter().map(|s| Stale { path: Arc::clone(&s.path), old: Arc::clone(&s.old), at: s.at }).collect();
        clean(&self.notes, &mut live_targets, &mut live_readers, &mut stale, None, usize::MAX, &mut Vec::new());
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
        let in_order = live_targets.values().chain(live_readers.values()).all(|set| {
            let paths: Vec<_> = set.iter().collect();
            !paths.is_empty() && paths.windows(2).all(|w| w[0] < w[1])
        });
        in_order && by_target == live_targets && plain(&readers) == plain(&live_readers)
    }
}

/// Add every membership of a note that had none (a refill: no diff to take). `seal_all` after
/// the last note.
fn link(by_target: &mut ByTarget, readers: &mut Readers, path: &Arc<str>, resolved: &Resolved) {
    for target in resolved.targets() {
        match by_target.get_mut(target) {
            Some(set) => set.add(path),
            None => by_target.entry(Arc::from(target)).or_default().add(path),
        }
    }
    for key in &resolved.reads {
        readers.entry(*key).or_default().add(path);
    }
}

fn seal_all(by_target: &mut ByTarget, readers: &mut Readers) {
    by_target.values_mut().chain(readers.values_mut()).for_each(PathSet::seal);
}

fn add_target(by_target: &mut ByTarget, target: &str, path: &Arc<str>) {
    match by_target.get_mut(target) {
        Some(set) => set.insert(path),
        None => by_target.entry(Arc::from(target)).or_default().insert(path),
    }
}

fn drop_target(by_target: &mut ByTarget, target: &str, path: &str) {
    if let Some(set) = by_target.get_mut(target) {
        set.remove(path);
        if set.is_empty() {
            by_target.remove(target);
        }
    }
}

fn drop_read(readers: &mut Readers, key: KeyHash, path: &str) {
    if let Some(set) = readers.get_mut(&key) {
        set.remove(path);
        if set.is_empty() {
            readers.remove(&key);
        }
    }
}

/// `moves`' additions `from..from + n` (targets, then keys) for `path`.
fn apply_adds(by_target: &mut ByTarget, readers: &mut Readers, path: &Arc<str>, new: Option<&Resolved>, moves: &Moves, from: usize, n: usize) {
    let t = moves.add_targets.len();
    let end = from.saturating_add(n).min(moves.adds());
    for i in from..end {
        if i < t {
            let new = new.expect("added targets come from a new entry");
            add_target(by_target, new.member(moves.add_targets[i]), path);
        } else {
            readers.entry(moves.add_reads[i - t]).or_default().insert(path);
        }
    }
}

fn apply_drops(by_target: &mut ByTarget, readers: &mut Readers, path: &str, old: Option<&Resolved>, moves: &Moves) {
    if let Some(old) = old {
        for k in &moves.drop_targets {
            drop_target(by_target, old.member(*k), path);
        }
    }
    for key in &moves.drop_reads {
        drop_read(readers, *key, path);
    }
}

/// Up to `budget` checks of stale memberships (front first): each is removed unless the
/// note's entry has it. A note being staged waits.
fn clean(notes: &BTreeMap<Arc<str>, Arc<Resolved>>, by_target: &mut ByTarget, readers: &mut Readers, stale: &mut VecDeque<Stale>, staging: Option<&str>, mut budget: usize, done: &mut Vec<Arc<Resolved>>) {
    while budget > 0 {
        let Some(s) = stale.front_mut() else {
            return;
        };
        if staging == Some(&*s.path) {
            return;
        }
        let now = notes.get(&s.path);
        let targets = s.old.members.len();
        while s.at < s.old.size() && budget > 0 {
            if s.at < targets {
                let target = s.old.member(s.old.members[s.at]);
                if !now.is_some_and(|r| r.has_target(target)) {
                    drop_target(by_target, target, &s.path);
                }
            } else {
                let key = s.old.reads[s.at - targets];
                if !now.is_some_and(|r| r.has_read(key)) {
                    drop_read(readers, key, &s.path);
                }
            }
            s.at += 1;
            budget -= 1;
        }
        if s.at == s.old.size() {
            done.extend(stale.pop_front().map(|s| s.old));
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
