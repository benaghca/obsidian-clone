//! The vault file list. A walk yields every node and, in tests, counts that yield.
//! `get`, `insert`, `remove`, and `contains_key` are point lookups and do not count.
//! Partial-path resolution reads the suffix map, so it must not walk this list.

use std::collections::btree_map::{self, BTreeMap};

use super::Node;

#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! {
    static FILE_VISITS: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
fn count_visit() {
    FILE_VISITS.with(|cell| cell.set(cell.get() + 1));
}

/// Nodes yielded by walking the file list since the last call. A point lookup adds nothing.
#[cfg(test)]
pub(crate) fn take_file_visits() -> usize {
    FILE_VISITS.with(|cell| cell.replace(0))
}

#[derive(Default)]
pub(super) struct Files {
    map: BTreeMap<String, Node>,
}

pub(super) struct Walk<'a> {
    inner: btree_map::Iter<'a, String, Node>,
}

impl<'a> Iterator for Walk<'a> {
    type Item = (&'a String, &'a Node);
    fn next(&mut self) -> Option<Self::Item> {
        let item = self.inner.next()?;
        #[cfg(test)]
        count_visit();
        Some(item)
    }
}

pub(super) struct KeyWalk<'a> {
    inner: btree_map::Keys<'a, String, Node>,
}

pub(super) struct ValueWalk<'a> {
    inner: btree_map::Values<'a, String, Node>,
}

impl<'a> Iterator for KeyWalk<'a> {
    type Item = &'a String;
    fn next(&mut self) -> Option<Self::Item> {
        let item = self.inner.next()?;
        #[cfg(test)]
        count_visit();
        Some(item)
    }
}

impl<'a> Iterator for ValueWalk<'a> {
    type Item = &'a Node;
    fn next(&mut self) -> Option<Self::Item> {
        let item = self.inner.next()?;
        #[cfg(test)]
        count_visit();
        Some(item)
    }
}

impl Files {
    pub(super) fn len(&self) -> usize {
        self.map.len()
    }

    pub(super) fn get(&self, key: &str) -> Option<&Node> {
        self.map.get(key)
    }

    pub(super) fn contains_key(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }

    pub(super) fn insert(&mut self, key: String, node: Node) -> Option<Node> {
        self.map.insert(key, node)
    }

    pub(super) fn remove(&mut self, key: &str) -> Option<Node> {
        self.map.remove(key)
    }

    /// Every node, in path order. Each yield counts as a file-list visit.
    pub(super) fn iter(&self) -> Walk<'_> {
        Walk { inner: self.map.iter() }
    }

    /// Every path. Each yield counts as a file-list visit.
    pub(super) fn keys(&self) -> KeyWalk<'_> {
        KeyWalk { inner: self.map.keys() }
    }

    /// Every node, without its path. Each yield counts as a file-list visit.
    pub(super) fn values(&self) -> ValueWalk<'_> {
        ValueWalk { inner: self.map.values() }
    }

    /// Visit every node. Each visit counts, then `keep` decides whether it stays.
    pub(super) fn retain(&mut self, mut keep: impl FnMut(&String, &mut Node) -> bool) {
        self.map.retain(|key, node| {
            #[cfg(test)]
            count_visit();
            keep(key, node)
        });
    }
}

impl<'a> IntoIterator for &'a Files {
    type Item = (&'a String, &'a Node);
    type IntoIter = Walk<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
