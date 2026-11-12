//! The vault file list. A walk yields every node and, in tests, counts that yield.
//! `get`, `insert`, `remove`, and `contains_key` are point lookups and do not count.
//! Partial-path resolution reads the suffix map, so it must not walk this list.

use std::collections::btree_map::{self, BTreeMap};
use std::sync::{Arc, Mutex};

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
    map: BTreeMap<String, Arc<Node>>,
    /// Shared note list for a search that has dropped the vault lock.
    /// Cleared on every map change. The next search builds it once.
    snap: Mutex<Option<Arc<Vec<(Arc<str>, Arc<Node>)>>>>,
}

pub(super) struct Walk<'a> {
    inner: btree_map::Iter<'a, String, Arc<Node>>,
}

impl<'a> Iterator for Walk<'a> {
    type Item = (&'a String, &'a Node);
    fn next(&mut self) -> Option<Self::Item> {
        let (path, node) = self.inner.next()?;
        #[cfg(test)]
        count_visit();
        Some((path, node.as_ref()))
    }
}

pub(super) struct KeyWalk<'a> {
    inner: btree_map::Keys<'a, String, Arc<Node>>,
}

pub(super) struct ValueWalk<'a> {
    inner: btree_map::Values<'a, String, Arc<Node>>,
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
        let node = self.inner.next()?;
        #[cfg(test)]
        count_visit();
        Some(node.as_ref())
    }
}

impl Files {
    pub(super) fn len(&self) -> usize {
        self.map.len()
    }

    pub(super) fn get(&self, key: &str) -> Option<&Node> {
        self.map.get(key).map(Arc::as_ref)
    }

    pub(super) fn contains_key(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }

    pub(super) fn insert(&mut self, key: String, node: Node) -> Option<Node> {
        self.clear_snap();
        self.map.insert(key, Arc::new(node)).map(unique_node)
    }

    pub(super) fn remove(&mut self, key: &str) -> Option<Node> {
        self.clear_snap();
        self.map.remove(key).map(unique_node)
    }

    /// Notes, in path order, shared with any scan already holding the previous list.
    pub(super) fn cached_search_notes(&self) -> Arc<Vec<(Arc<str>, Arc<Node>)>> {
        let mut guard = self.snap.lock().unwrap_or_else(|err| err.into_inner());
        if let Some(hit) = guard.as_ref() {
            return Arc::clone(hit);
        }
        let built = Arc::new(search_note_arcs(&self.map));
        *guard = Some(Arc::clone(&built));
        built
    }

    fn clear_snap(&mut self) {
        *self.snap.get_mut().unwrap_or_else(|err| err.into_inner()) = None;
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
    pub(super) fn retain(&mut self, mut keep: impl FnMut(&String, &Node) -> bool) {
        self.clear_snap();
        self.map.retain(|key, node| {
            #[cfg(test)]
            count_visit();
            keep(key, node.as_ref())
        });
    }
}

fn unique_node(arc: Arc<Node>) -> Node {
    Arc::try_unwrap(arc).unwrap_or_else(|arc| (*arc).clone())
}

fn search_note_arcs(map: &BTreeMap<String, Arc<Node>>) -> Vec<(Arc<str>, Arc<Node>)> {
    map.iter()
        .filter(|(path, node)| !node.is_dir && super::is_note_path(path))
        .map(|(path, node)| (Arc::<str>::from(path.as_str()), Arc::clone(node)))
        .collect()
}

impl<'a> IntoIterator for &'a Files {
    type Item = (&'a String, &'a Node);
    type IntoIter = Walk<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
