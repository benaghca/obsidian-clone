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

use super::{display_name, is_note_path, nameless_md, Node};
use std::cmp::Ordering;
use std::collections::hash_map::{Entry, HashMap};

type Map = HashMap<String, Owners>;

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub(super) struct NameMaps {
    by_name: Map,
    by_alias: Map,
    by_path_lower: Map,
    // A key is a slash-aligned tail (`/note.md`), not the whole path.
    by_suffix: Map,
}

/// The files claiming one key, in winner order. Nearly every key has one file, kept inline
/// so a key costs no extra allocation; `Many` always holds two or more.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Owners {
    One(String),
    Many(Vec<String>),
}

impl Owners {
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
    }

    /// Record what `node` at `path` contributes. `path` must not be recorded already.
    pub(super) fn add(&mut self, path: &str, node: &Node) {
        keys_of(path, node, |kind, key| match self.map_mut(kind).entry(key) {
            Entry::Occupied(mut owners) => owners.get_mut().insert(kind, path),
            Entry::Vacant(slot) => {
                slot.insert(Owners::One(path.to_string()));
            }
        });
    }

    /// Forget what `node` at `path` contributed, promoting the next file for each key.
    pub(super) fn remove(&mut self, path: &str, node: &Node) {
        keys_of(path, node, |kind, key| {
            let map = self.map_mut(kind);
            if map.get_mut(&key).is_some_and(|owners| !owners.remove(kind, path)) {
                map.remove(&key);
            }
        });
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

/// The lookups `resolve` makes. `watching` also notes every key read, hit or miss: a
/// resolution can change only when one of those keys changes owners.
pub(super) struct Lookups<'m, 'r> {
    maps: &'m NameMaps,
    reads: Option<&'r mut Vec<KeyHash>>,
}

impl<'m, 'r> Lookups<'m, 'r> {
    pub(super) fn new(maps: &'m NameMaps) -> Self {
        Lookups { maps, reads: None }
    }

    pub(super) fn watching(maps: &'m NameMaps, reads: &'r mut Vec<KeyHash>) -> Self {
        Lookups {
            maps,
            reads: Some(reads),
        }
    }

    fn note(&mut self, kind: Kind, key: &str) {
        if let Some(reads) = &mut self.reads {
            reads.push(key_hash(kind, key));
        }
    }

    pub(super) fn names(&mut self, key: &str) -> Option<&'m [String]> {
        self.note(Kind::Name, key);
        self.maps.names(key)
    }

    pub(super) fn alias(&mut self, key: &str) -> Option<&'m String> {
        self.note(Kind::Alias, key);
        self.maps.alias(key)
    }

    pub(super) fn path_lower(&mut self, key: &str) -> Option<&'m String> {
        self.note(Kind::Path, key);
        self.maps.path_lower(key)
    }

    pub(super) fn suffix(&mut self, key: &str) -> Option<&'m String> {
        self.note(Kind::Suffix, key);
        self.maps.suffix(key)
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
