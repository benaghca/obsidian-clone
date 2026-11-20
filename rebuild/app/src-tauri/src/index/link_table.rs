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
//! A note is resolved again when its own node changes, or when a key it read changes. The
//! index queues those paths (`touch`, `wake`) and resolves them once, when the change is done
//! (`Index::settle_links`). A full name-map rebuild resolves every note instead (`refill`).
//!
//! Each change that alters an entry bumps `version` and logs the paths, so `changes` can
//! answer "what changed since version N" with only those notes. A page that is too far behind
//! (the log keeps the last `LOG_PATHS` paths), or holds another table's `id`, gets the whole index.
//! Tests check the table, `link_index`, `backlinks`, and a page applying every delta against a
//! full walk after each step.

use super::name_maps::{key_hash, Kind, KeyHash};
use crate::model::{LinkChanges, LinkEntry, LinkIndex};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::hash::{BuildHasherDefault, Hasher};
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

type Readers = HashMap<KeyHash, Vec<Arc<str>>, BuildHasherDefault<Identity>>;
/// Linking notes per target, sorted by path.
type ByTarget = HashMap<Arc<str>, Vec<Arc<str>>>;

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
    notes: BTreeMap<Arc<str>, Resolved>,
    by_target: ByTarget,
    readers: Readers,
    /// Notes to resolve again when the current change is done.
    pending: HashSet<Arc<str>>,
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
            history: History::fresh(),
            log_paths: LOG_PATHS,
        }
    }
}

impl LinkTable {
    pub(super) fn get(&self, path: &str) -> Option<&Resolved> {
        self.notes.get(path)
    }

    pub(super) fn contains(&self, path: &str) -> bool {
        self.notes.contains_key(path)
    }

    /// Notes with a link resolving to `target`, in path order.
    pub(super) fn sources_of(&self, target: &str) -> &[Arc<str>] {
        self.by_target.get(target).map_or(&[], Vec::as_slice)
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

    /// The owners of one key changed: every note that read it resolves again.
    pub(super) fn wake(&mut self, kind: Kind, key: String) {
        if let Some(notes) = self.readers.get(&key_hash(kind, &key)) {
            self.pending.extend(notes.iter().cloned());
        }
    }

    pub(super) fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    pub(super) fn take_pending(&mut self) -> Vec<Arc<str>> {
        self.pending.drain().collect()
    }

    /// Put `new` (or nothing, for a path that is no note with links any more) at `path`.
    /// True when its entry changed.
    pub(super) fn replace(&mut self, path: Arc<str>, new: Option<Resolved>) -> bool {
        let old = match new {
            Some(new) => {
                if self.notes.get(&path) == Some(&new) {
                    return false;
                }
                self.notes.insert(Arc::clone(&path), new)
            }
            None => self.notes.remove(&path),
        };
        if let Some(old) = &old {
            unlink(&mut self.by_target, &mut self.readers, &path, old);
        }
        let new = self.notes.get(&path);
        if let Some(new) = new {
            link(&mut self.by_target, &mut self.readers, &path, new);
        }
        old.as_ref().map(|r| &r.entry) != new.map(|r| &r.entry)
    }

    /// Replace every note at once (a full name-map rebuild). `fresh` must come in path order.
    /// Only notes whose entries differ are logged.
    pub(super) fn refill(&mut self, fresh: impl IntoIterator<Item = (Arc<str>, Resolved)>) {
        let notes: BTreeMap<Arc<str>, Resolved> = fresh.into_iter().collect();
        let mut by_target = ByTarget::default();
        let mut readers = Readers::default();
        // In path order, so each list is pushed sorted.
        for (path, resolved) in &notes {
            link(&mut by_target, &mut readers, path, resolved);
        }
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

    /// Every note's entry, as `link_index` sends it.
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
    /// index when that is not something this table can answer.
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
    pub(super) fn notes(&self) -> &BTreeMap<Arc<str>, Resolved> {
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
        // Readers are kept in no particular order.
        let sorted = |map: &Readers| -> HashMap<KeyHash, Vec<Arc<str>>> {
            map.iter()
                .map(|(k, v)| {
                    let mut v = v.clone();
                    v.sort();
                    (*k, v)
                })
                .collect()
        };
        by_target == self.by_target && sorted(&readers) == sorted(&self.readers)
    }
}

fn link(by_target: &mut ByTarget, readers: &mut Readers, path: &Arc<str>, resolved: &Resolved) {
    for target in resolved.targets() {
        let list = match by_target.get_mut(target.as_str()) {
            Some(list) => list,
            None => by_target.entry(Arc::from(target.as_str())).or_default(),
        };
        // Pushed in path order during a refill; a single note finds its place.
        match list.last() {
            Some(last) if **last >= **path => {
                if let Err(at) = list.binary_search_by(|p| (**p).cmp(&**path)) {
                    list.insert(at, Arc::clone(path));
                }
            }
            _ => list.push(Arc::clone(path)),
        }
    }
    for key in &resolved.reads {
        readers.entry(*key).or_default().push(Arc::clone(path));
    }
}

fn unlink(by_target: &mut ByTarget, readers: &mut Readers, path: &Arc<str>, resolved: &Resolved) {
    for target in resolved.targets() {
        if let Some(list) = by_target.get_mut(target.as_str()) {
            if let Ok(at) = list.binary_search_by(|p| (**p).cmp(&**path)) {
                list.remove(at);
            }
            if list.is_empty() {
                by_target.remove(target.as_str());
            }
        }
    }
    for key in &resolved.reads {
        if let Some(list) = readers.get_mut(key) {
            if let Some(at) = list.iter().position(|p| Arc::ptr_eq(p, path) || **p == **path) {
                list.swap_remove(at);
            }
            if list.is_empty() {
                readers.remove(key);
            }
        }
    }
}

/// Paths whose entries differ between `old` and `new` (added, removed, or changed).
fn diff(old: &BTreeMap<Arc<str>, Resolved>, new: &BTreeMap<Arc<str>, Resolved>) -> Vec<Arc<str>> {
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
