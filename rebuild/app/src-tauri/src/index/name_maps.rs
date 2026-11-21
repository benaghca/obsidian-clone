//! Name, alias, and path lookups for link resolution, kept up to date one path at a time.
//!
//! Each key keeps every file that claims it, not just the winner, so removing the winner
//! can promote the next one without walking the vault. Lists are kept in winner order:
//!
//! - names: path order (`pick` ranks them at lookup time);
//! - aliases: path order, the first wins (the full walk used to keep the first path);
//! - lower-case paths: path order, the last wins (the full walk used to overwrite);
//! - suffixes: shortest path first, then path order, the first wins.
//!
//! `build` (a full walk) and `add` / `remove` (one path) share `keys_of`, which says what a
//! node contributes. Tests check that any sequence of `add` / `remove` equals `build`.
//!
//! A name with many files (`README` in every folder) also keeps a `NamePicks`, updated with its
//! list, so `pick` among thousands of candidates is a few lookups (review 3: it used to be a
//! scan, or an index built inside the vault lock by each batch that asked).

use super::{display_name, is_note_path, nameless_md, parent_path, Node};
use std::cmp::Ordering;
use std::cell::Cell;
use std::collections::hash_map::{Entry, HashMap};
use std::collections::BTreeSet;

type Map = HashMap<String, Owners>;

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub(super) struct NameMaps {
    by_name: Map,
    by_alias: Map,
    by_path_lower: Map,
    // A key is a slash-aligned tail (`/note.md`), not the whole path.
    by_suffix: Map,
    // For each name with `PICK_MIN` files or more: its `pick`, kept up to date.
    picks: HashMap<String, NamePicks>,
}

/// A name with this many files or more keeps a `NamePicks`.
pub(super) const PICK_MIN: usize = 16;

/// `pick` for one name with many files. `pick` ranks by (is a note, is in the source's
/// folder), then length, then path, so the answer is the best note in the source's folder,
/// else the best note, else the best other file in the folder, else the best other file.
/// Files named exactly `.md` are never picked, so they are left out.
#[derive(Default, Clone, Debug, PartialEq, Eq)]
struct NamePicks {
    /// (length, path) of the notes, and of the other files: the first of each is the best.
    ranked: [BTreeSet<(usize, String)>; 2],
    /// Folder → its files with this name, in path order (a folder holds a few at most).
    by_dir: HashMap<String, Vec<String>>,
}

fn pick_kind(path: &str) -> usize {
    usize::from(!is_note_path(path))
}

impl NamePicks {
    fn of(list: &[String]) -> Self {
        let mut picks = NamePicks::default();
        for path in list {
            picks.add(path);
        }
        picks
    }

    fn add(&mut self, path: &str) {
        if nameless_md(path) {
            return;
        }
        self.ranked[pick_kind(path)].insert((path.len(), path.to_string()));
        let here = self.by_dir.entry(parent_path(path).to_string()).or_default();
        if let Err(at) = here.binary_search_by(|p| p.as_str().cmp(path)) {
            here.insert(at, path.to_string());
        }
    }

    fn remove(&mut self, path: &str) {
        if nameless_md(path) {
            return;
        }
        self.ranked[pick_kind(path)].remove(&(path.len(), path.to_string()));
        let dir = parent_path(path);
        if let Some(here) = self.by_dir.get_mut(dir) {
            if let Ok(at) = here.binary_search_by(|p| p.as_str().cmp(path)) {
                here.remove(at);
            }
            if here.is_empty() {
                self.by_dir.remove(dir);
            }
        }
    }

    fn pick(&self, from: &str) -> Option<&str> {
        let near = self.by_dir.get(parent_path(from));
        let near_best = |kind: usize| {
            near.and_then(|here| {
                here.iter()
                    .filter(|p| pick_kind(p) == kind)
                    .min_by(|a, b| (a.len(), a.as_str()).cmp(&(b.len(), b.as_str())))
            })
        };
        let best = |kind: usize| self.ranked[kind].first().map(|(_, p)| p);
        near_best(0).or_else(|| best(0)).or_else(|| near_best(1)).or_else(|| best(1)).map(String::as_str)
    }
}

/// The files claiming one key, in winner order. Nearly every key has one file, kept inline
/// so a key costs no extra allocation; `Many` always holds two or more.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Owners {
    One(String),
    Many(Vec<String>),
}

impl Owners {
    fn len(&self) -> usize {
        self.as_slice().len()
    }

    fn as_slice(&self) -> &[String] {
        match self {
            Owners::One(path) => std::slice::from_ref(path),
            Owners::Many(list) => list,
        }
    }

    fn push(&mut self, path: String) {
        match self {
            Owners::One(first) => *self = Owners::Many(vec![std::mem::take(first), path]),
            Owners::Many(list) => list.push(path),
        }
    }

    fn insert(&mut self, kind: Kind, path: &str) {
        let at = match self.as_slice().binary_search_by(|p| kind.order(p, path)) {
            Ok(_) => return,
            Err(at) => at,
        };
        self.push(path.to_string());
        let Owners::Many(list) = self else {
            unreachable!("push leaves two or more")
        };
        // `push` appended it; move it to its sorted place.
        list[at..].rotate_right(1);
    }

    /// Drop `path`. False when no file claims the key any more.
    fn remove(&mut self, kind: Kind, path: &str) -> bool {
        match self {
            Owners::One(only) => only != path,
            Owners::Many(list) => {
                if let Ok(at) = list.binary_search_by(|p| kind.order(p, path)) {
                    list.remove(at);
                }
                if list.len() == 1 {
                    *self = Owners::One(list.pop().expect("one left"));
                }
                true
            }
        }
    }

    /// Sort (suffixes) and drop adjacent copies (one note listing an alias twice).
    fn tidy(&mut self, kind: Kind) {
        if let Owners::Many(list) = self {
            list.sort_by(|a, b| kind.order(a, b));
            list.dedup();
            if list.len() == 1 {
                *self = Owners::One(list.pop().expect("one left"));
            }
        }
    }
}

const KINDS: [Kind; 4] = [Kind::Name, Kind::Alias, Kind::Path, Kind::Suffix];

/// Which map a key lives in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(super) enum Kind {
    Name,
    Alias,
    Path,
    Suffix,
}

impl Kind {
    fn order(self, a: &str, b: &str) -> Ordering {
        match self {
            Kind::Suffix => a.len().cmp(&b.len()).then_with(|| a.cmp(b)),
            Kind::Name | Kind::Alias | Kind::Path => a.cmp(b),
        }
    }
}

impl NameMaps {
    /// Every map from scratch. `files` must come in path order, as `Files` walks.
    #[cfg(test)]
    pub(super) fn build<'a>(files: impl IntoIterator<Item = (&'a String, &'a Node)>) -> Self {
        let mut maps = NameMaps::default();
        maps.refill(files);
        maps
    }

    /// Every map from scratch, reusing the maps' capacity. `files` must come in path order.
    pub(super) fn refill<'a>(&mut self, files: impl IntoIterator<Item = (&'a String, &'a Node)>) {
        for kind in KINDS {
            self.map_mut(kind).clear();
        }
        self.picks.clear();
        #[cfg(debug_assertions)]
        let mut last: Option<&String> = None;
        for (path, node) in files {
            #[cfg(debug_assertions)]
            {
                debug_assert!(last.is_none_or(|prev| prev < path), "files out of path order");
                last = Some(path);
            }
            keys_of(path, node, |kind, key| {
                match self.map_mut(kind).entry(key) {
                    Entry::Occupied(mut owners) => owners.get_mut().push(path.clone()),
                    Entry::Vacant(slot) => {
                        slot.insert(Owners::One(path.clone()));
                    }
                }
            });
        }
        // Pushed in path order, so names and paths are sorted already. One note may list
        // the same alias twice (adjacent copies), and suffixes rank shortest first.
        for kind in [Kind::Alias, Kind::Suffix] {
            for owners in self.map_mut(kind).values_mut() {
                owners.tidy(kind);
            }
        }
        self.picks = self
            .by_name
            .iter()
            .filter(|(_, owners)| owners.len() >= PICK_MIN)
            .map(|(key, owners)| (key.clone(), NamePicks::of(owners.as_slice())))
            .collect();
    }

    /// Record what `node` at `path` contributes. `path` must not be recorded already.
    pub(super) fn add(&mut self, path: &str, node: &Node) {
        keys_of(path, node, |kind, key| {
            if kind == Kind::Name {
                return self.add_name(key, path);
            }
            match self.map_mut(kind).entry(key) {
                Entry::Occupied(mut owners) => owners.get_mut().insert(kind, path),
                Entry::Vacant(slot) => {
                    slot.insert(Owners::One(path.to_string()));
                }
            }
        });
    }

    /// Forget what `node` at `path` contributed, promoting the next file for each key.
    pub(super) fn remove(&mut self, path: &str, node: &Node) {
        keys_of(path, node, |kind, key| {
            if kind == Kind::Name {
                return self.remove_name(&key, path);
            }
            let map = self.map_mut(kind);
            if map.get_mut(&key).is_some_and(|owners| !owners.remove(kind, path)) {
                map.remove(&key);
            }
        });
    }

    fn add_name(&mut self, key: String, path: &str) {
        let Some(owners) = self.by_name.get_mut(&key) else {
            self.by_name.insert(key, Owners::One(path.to_string()));
            return;
        };
        let before = owners.len();
        owners.insert(Kind::Name, path);
        match owners.len() {
            n if n == before => {}
            PICK_MIN => {
                self.picks.insert(key, NamePicks::of(owners.as_slice()));
            }
            n if n > PICK_MIN => self.picks.get_mut(&key).expect("a long name keeps its picks").add(path),
            _ => {}
        }
    }

    fn remove_name(&mut self, key: &str, path: &str) {
        let Some(owners) = self.by_name.get_mut(key) else {
            return;
        };
        let before = owners.len();
        if !owners.remove(Kind::Name, path) {
            self.by_name.remove(key);
            return;
        }
        match owners.len() {
            n if n == before => {}
            n if n < PICK_MIN => {
                self.picks.remove(key);
            }
            _ => self.picks.get_mut(key).expect("a long name keeps its picks").remove(path),
        }
    }

    /// The file `[[key]]` from `from` resolves to among the files named `key` (see `pick`).
    pub(super) fn name_pick(&self, key: &str, from: &str) -> Option<&str> {
        match self.picks.get(key) {
            Some(picks) => picks.pick(from),
            None => self.names(key).and_then(|cands| super::pick(cands, from)),
        }
    }

    /// Every file whose lower-case note name is `key`, in path order.
    pub(super) fn names(&self, key: &str) -> Option<&[String]> {
        self.by_name.get(key).map(Owners::as_slice)
    }

    pub(super) fn alias(&self, key: &str) -> Option<&String> {
        self.by_alias.get(key).and_then(|owners| owners.as_slice().first())
    }

    pub(super) fn path_lower(&self, key: &str) -> Option<&String> {
        self.by_path_lower.get(key).and_then(|owners| owners.as_slice().last())
    }

    pub(super) fn suffix(&self, key: &str) -> Option<&String> {
        self.by_suffix.get(key).and_then(|owners| owners.as_slice().first())
    }

    fn map_mut(&mut self, kind: Kind) -> &mut Map {
        match kind {
            Kind::Name => &mut self.by_name,
            Kind::Alias => &mut self.by_alias,
            Kind::Path => &mut self.by_path_lower,
            Kind::Suffix => &mut self.by_suffix,
        }
    }

    /// The winner of every key, read through the lookups `resolve` uses, shaped like the
    /// maps the full rebuild used to keep.
    #[cfg(test)]
    pub(super) fn winners(&self) -> Winners {
        fn read<'m>(
            map: &'m Map,
            get: impl Fn(&str) -> Option<&'m String>,
        ) -> HashMap<String, String> {
            map.keys()
                .map(|k| (k.clone(), get(k).expect("a key with no files").clone()))
                .collect()
        }
        Winners {
            by_name: self
                .by_name
                .keys()
                .map(|k| (k.clone(), self.names(k).expect("a key with no files").to_vec()))
                .collect(),
            by_alias: read(&self.by_alias, |k| self.alias(k)),
            by_path_lower: read(&self.by_path_lower, |k| self.path_lower(k)),
            by_suffix: read(&self.by_suffix, |k| self.suffix(k)),
        }
    }
}

#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Winners {
    pub(super) by_name: HashMap<String, Vec<String>>,
    pub(super) by_alias: HashMap<String, String>,
    pub(super) by_path_lower: HashMap<String, String>,
    pub(super) by_suffix: HashMap<String, String>,
}

/// One key of one map, as the link table remembers a read of it: a 64-bit FNV-1a hash of the
/// map and the key. Two keys with the same hash only make a change to one wake the readers of
/// both, which resolve again to the same answer. A read is never missed.
pub(super) type KeyHash = u64;

pub(super) fn key_hash(kind: Kind, key: &str) -> KeyHash {
    const PRIME: u64 = 0x0000_0100_0000_01B3;
    let mut hash: u64 = 0xCBF2_9CE4_8422_2325;
    for byte in std::iter::once(kind as u8).chain(key.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// One question a resolution asks the maps: a key of one map. A name's question is answered
/// for the asking note (its folder ranks the candidates).
pub(super) type Query = (Kind, String);

/// Answers to one note's questions, gathered from the maps under the lock, so the note can be
/// resolved off it (review 3). `missing` notes a question nobody asked for in advance (the
/// note is then resolved again against the maps when it is published).
#[derive(Default)]
pub(super) struct Answers {
    pub(super) map: HashMap<Query, Option<String>>,
    pub(super) missing: Cell<bool>,
}

/// Where a resolution's lookups go.
pub(super) enum Src<'m> {
    /// The live maps.
    Maps(&'m NameMaps),
    /// Nowhere: every lookup misses and is noted. A resolution that misses everything takes
    /// every branch, so it asks every question the real one could.
    Ask(Vec<Query>),
    /// Gathered answers.
    Answers(&'m Answers),
}

/// The lookups `resolve` makes. `watching` also notes every key read, hit or miss: a
/// resolution can change only when one of those keys changes owners.
pub(super) struct Lookups<'m, 'r> {
    src: Src<'m>,
    reads: Option<&'r mut Vec<KeyHash>>,
}

impl<'m, 'r> Lookups<'m, 'r> {
    pub(super) fn new(maps: &'m NameMaps) -> Self {
        Lookups { src: Src::Maps(maps), reads: None }
    }

    pub(super) fn watching(src: Src<'m>, reads: &'r mut Vec<KeyHash>) -> Self {
        Lookups { src, reads: Some(reads) }
    }

    pub(super) fn into_src(self) -> Src<'m> {
        self.src
    }

    fn ask(&mut self, kind: Kind, key: &str, from: &str) -> Option<&'m str> {
        if let Some(reads) = &mut self.reads {
            reads.push(key_hash(kind, key));
        }
        match &mut self.src {
            Src::Maps(maps) => {
                let maps: &'m NameMaps = maps;
                maps.answer(kind, key, from)
            }
            Src::Ask(asked) => {
                asked.push((kind, key.to_string()));
                None
            }
            Src::Answers(answers) => {
                let answers: &'m Answers = answers;
                match answers.map.get(&(kind, key.to_string())) {
                    Some(found) => found.as_deref(),
                    None => {
                        answers.missing.set(true);
                        None
                    }
                }
            }
        }
    }

    /// The file `[[key]]` from `from` names (see `NameMaps::name_pick`).
    pub(super) fn name_pick(&mut self, key: &str, from: &str) -> Option<&'m str> {
        self.ask(Kind::Name, key, from)
    }

    pub(super) fn alias(&mut self, key: &str) -> Option<&'m str> {
        self.ask(Kind::Alias, key, "")
    }

    pub(super) fn path_lower(&mut self, key: &str) -> Option<&'m str> {
        self.ask(Kind::Path, key, "")
    }

    pub(super) fn suffix(&mut self, key: &str) -> Option<&'m str> {
        self.ask(Kind::Suffix, key, "")
    }
}

impl NameMaps {
    /// One question's answer, for a note at `from`.
    pub(super) fn answer(&self, kind: Kind, key: &str, from: &str) -> Option<&str> {
        match kind {
            Kind::Name => self.name_pick(key, from),
            Kind::Alias => self.alias(key).map(String::as_str),
            Kind::Path => self.path_lower(key).map(String::as_str),
            Kind::Suffix => self.suffix(key).map(String::as_str),
        }
    }
}

/// Whether two nodes at the same path contribute the same keys.
pub(super) fn same_keys(a: &Node, b: &Node) -> bool {
    a.is_dir == b.is_dir && a.note.aliases == b.note.aliases
}

/// The keys a node at `path` contributes. Folders contribute none.
pub(super) fn keys_of(path: &str, node: &Node, mut each: impl FnMut(Kind, String)) {
    if node.is_dir {
        return;
    }
    let lower = path.to_lowercase();
    if !nameless_md(path) {
        for (i, _) in lower.match_indices('/') {
            each(Kind::Suffix, lower[i..].to_string());
        }
    }
    let name = display_name(path, false).to_lowercase();
    if !name.is_empty() {
        each(Kind::Name, name);
    }
    if is_note_path(path) {
        for alias in &node.note.aliases {
            each(Kind::Alias, alias.clone());
        }
    }
    each(Kind::Path, lower);
}
