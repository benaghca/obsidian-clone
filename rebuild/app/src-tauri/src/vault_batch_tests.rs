//! Rebuild counts for watcher batches, renames, and single-entry lookups.
//! These fail on the old per-file `rebuild_maps` / full-list `entry_for`.
//! Since P2a a file change updates the name maps for its own path (no full rebuild);
//! a folder refresh still rebuilds, once per batch.

use super::Vault;
use crate::fsutil::tmp_dir;
use crate::index::{self, Index};
use crate::model::{ChangeKind, FileEntry, VaultChanged};
use std::fs;

fn listed(vault: &Vault, path: &str) -> FileEntry {
    vault
        .list_files()
        .into_iter()
        .find(|entry| entry.path == path)
        .unwrap_or_else(|| panic!("missing {path}"))
}

fn matches_disk(vault: &Vault) {
    vault.index.assert_maps_match_rebuild();
    let scanned = Index::scan(&vault.root).expect("rescan");
    assert_eq!(vault.list_files(), scanned.list(), "file list");
    assert_eq!(
        vault.index.link_index(),
        scanned.link_index(),
        "resolved links"
    );
}

fn write_linked(dir: &std::path::Path, n: usize) {
    for i in 0..n {
        let next = (i + 1) % n;
        fs::write(
            dir.join(format!("n{i}.md")),
            format!("---\naliases: [alias{i}]\n---\nsee [[n{next}]]\n"),
        )
        .unwrap();
    }
}

/// N separate watcher records, and one record that carries N paths.
/// Both used to rebuild once per path. New files now update their own paths (no rebuild);
/// new folders must still rebuild once per batch, whatever its size.
#[test]
fn s4_apply_batch_rebuilds_maps_once() {
    let mut separate = Vec::new();
    let mut grouped = Vec::new();
    let mut folders = Vec::new();
    for n in [3usize, 6, 8] {
        separate.push(apply_creates(n, true, false));
        grouped.push(apply_creates(n, false, false));
        folders.push(apply_creates(n, true, true));
    }
    assert_eq!(
        (separate, grouped, folders),
        (vec![0, 0, 0], vec![0, 0, 0], vec![1, 1, 1]),
        "rebuilds for batch sizes 3, 6, 8 (separate file records, one record, folder records)"
    );
}

fn apply_creates(n: usize, separate_records: bool, in_folders: bool) -> usize {
    let dir = tmp_dir("apply-batch");
    write_linked(&dir.path, n);
    let mut vault = Vault::open(dir.path.clone()).unwrap();
    let mut changes: Vec<VaultChanged> = if separate_records {
        (0..n)
            .map(|i| VaultChanged {
                kind: ChangeKind::Create,
                paths: vec![format!("n{i}.md")],
            })
            .collect()
    } else {
        vec![VaultChanged {
            kind: ChangeKind::Create,
            paths: (0..n).map(|i| format!("n{i}.md")).collect(),
        }]
    };
    if in_folders {
        // Each record also brings a new folder holding a note the index has not seen.
        for i in 0..n {
            fs::create_dir(dir.path.join(format!("box{i}"))).unwrap();
            fs::write(dir.path.join(format!("box{i}/inner{i}.md")), "[[n0]]\n").unwrap();
            changes.push(VaultChanged {
                kind: ChangeKind::Create,
                paths: vec![format!("box{i}")],
            });
        }
    }
    let _ = index::take_rebuild_maps_calls();
    vault.apply(&changes);
    let rebuilds = index::take_rebuild_maps_calls();
    matches_disk(&vault);
    assert_eq!(vault.index.resolve("n0.md", "n1").as_deref(), Some("n1.md"));
    assert_eq!(
        vault.index.resolve("n0.md", "alias1").as_deref(),
        Some("n1.md")
    );
    assert!(vault
        .index
        .search("see", 20)
        .iter()
        .any(|hit| hit.path == "n0.md"));
    if in_folders {
        assert_eq!(
            vault.index.resolve("n0.md", "inner1").as_deref(),
            Some("box1/inner1.md")
        );
    }
    rebuilds
}

/// A sync-shaped mix: modify, remove, create, and two renames, one of a folder.
#[test]
fn s4_apply_mixed_batch_rebuilds_once_and_matches_a_rescan() {
    let dir = tmp_dir("apply-mixed");
    fs::create_dir(dir.path.join("box")).unwrap();
    fs::write(dir.path.join("a.md"), "old [[keep]]\n").unwrap();
    fs::write(dir.path.join("b.md"), "gone [[keep]]\n").unwrap();
    fs::write(dir.path.join("c.md"), "---\naliases: [cee]\n---\nmoved\n").unwrap();
    fs::write(dir.path.join("keep.md"), "stay\n").unwrap();
    fs::write(dir.path.join("box/a.md"), "[[keep]]\n").unwrap();
    let mut vault = Vault::open(dir.path.clone()).unwrap();

    fs::write(dir.path.join("a.md"), "new [[keep]]\n").unwrap();
    fs::remove_file(dir.path.join("b.md")).unwrap();
    fs::create_dir(dir.path.join("sub")).unwrap();
    fs::write(dir.path.join("sub/d.md"), "fresh [[keep]]\n").unwrap();
    fs::rename(dir.path.join("c.md"), dir.path.join("e.md")).unwrap();
    fs::rename(dir.path.join("box"), dir.path.join("carton")).unwrap();

    let changes = vec![
        VaultChanged {
            kind: ChangeKind::Modify,
            paths: vec!["a.md".into()],
        },
        VaultChanged {
            kind: ChangeKind::Remove,
            paths: vec!["b.md".into()],
        },
        VaultChanged {
            kind: ChangeKind::Create,
            paths: vec!["sub".into(), "sub/d.md".into()],
        },
        VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["c.md".into(), "e.md".into()],
        },
        VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["box".into(), "carton".into()],
        },
    ];
    let _ = index::take_rebuild_maps_calls();
    vault.apply(&changes);
    let rebuilds = index::take_rebuild_maps_calls();

    matches_disk(&vault);
    assert_eq!(
        vault.index.resolve("a.md", "keep").as_deref(),
        Some("keep.md")
    );
    assert_eq!(
        vault.index.resolve("keep.md", "cee").as_deref(),
        Some("e.md")
    );
    assert_eq!(vault.index.resolve("keep.md", "e").as_deref(), Some("e.md"));
    assert!(vault.index.resolve("keep.md", "b").is_none());
    assert!(!vault.index.contains("b.md"));
    assert!(!vault.index.contains("c.md"));
    assert!(!vault.index.contains("box"));
    assert!(vault.index.contains("carton/a.md"));
    assert_eq!(
        vault.index.resolve("carton/a.md", "keep").as_deref(),
        Some("keep.md")
    );
    assert!(vault
        .index
        .search("new", 10)
        .iter()
        .any(|hit| hit.path == "a.md"));
    assert!(vault.index.search("old", 10).is_empty());
    // The new folder `sub` rebuilds once; the file changes update their own paths.
    assert_eq!(rebuilds, 1, "mixed batch rebuilt {rebuilds} times");
}

#[test]
fn s4_empty_apply_does_not_rebuild_maps() {
    let dir = tmp_dir("apply-empty");
    fs::write(dir.path.join("a.md"), "a\n").unwrap();
    let mut vault = Vault::open(dir.path.clone()).unwrap();
    let _ = index::take_rebuild_maps_calls();
    vault.apply(&[]);
    let empty = index::take_rebuild_maps_calls();
    vault.apply(&[VaultChanged {
        kind: ChangeKind::Modify,
        paths: vec![".git/config".into(), ".grove/app.json".into()],
    }]);
    let ignored = index::take_rebuild_maps_calls();
    assert_eq!((empty, ignored), (0, 0));
    assert!(vault.index.contains("a.md"));
}

#[test]
fn s4_rename_path_rebuilds_maps_at_most_once() {
    let dir = tmp_dir("rename-once");
    fs::write(dir.path.join("Other.md"), "other\n").unwrap();
    fs::write(
        dir.path.join("Old.md"),
        "---\naliases: [Former]\n---\nsee [[Other]]\n",
    )
    .unwrap();
    fs::create_dir(dir.path.join("box")).unwrap();
    fs::write(dir.path.join("box/a.md"), "[[Old]]\n").unwrap();
    let mut vault = Vault::open(dir.path.clone()).unwrap();

    let _ = index::take_rebuild_maps_calls();
    vault.rename_path("Old.md", "New.md").unwrap();
    let file_rebuilds = index::take_rebuild_maps_calls();
    assert_eq!(
        vault.index.resolve("New.md", "Other").as_deref(),
        Some("Other.md")
    );
    assert_eq!(
        vault.index.resolve("box/a.md", "New").as_deref(),
        Some("New.md")
    );
    assert_eq!(
        vault.index.resolve("box/a.md", "Former").as_deref(),
        Some("New.md")
    );
    assert!(vault.index.resolve("box/a.md", "Old").is_none());
    assert!(!vault.index.contains("Old.md"));
    assert_eq!(listed(&vault, "New.md").name, "New");

    let _ = index::take_rebuild_maps_calls();
    vault.rename_path("box", "carton").unwrap();
    let folder_rebuilds = index::take_rebuild_maps_calls();
    assert!(vault.index.contains("carton/a.md"));
    assert!(!vault.index.contains("box/a.md"));

    let _ = index::take_rebuild_maps_calls();
    vault.rename_path("New.md", "fresh/Moved.md").unwrap();
    let nested_rebuilds = index::take_rebuild_maps_calls();
    assert_eq!(listed(&vault, "fresh").is_dir, true);
    assert_eq!(listed(&vault, "fresh/Moved.md").name, "Moved");
    assert_eq!(
        vault.index.resolve("fresh/Moved.md", "Other").as_deref(),
        Some("Other.md")
    );
    assert_eq!(
        vault.index.resolve("carton/a.md", "Former").as_deref(),
        Some("fresh/Moved.md")
    );
    assert_eq!(
        vault.index.resolve("carton/a.md", "Moved").as_deref(),
        Some("fresh/Moved.md")
    );
    matches_disk(&vault);
    assert_eq!(
        (file_rebuilds, folder_rebuilds, nested_rebuilds),
        (0, 1, 0),
        "file, folder, and into-folder renames rebuilt {file_rebuilds}, {folder_rebuilds}, {nested_rebuilds} times"
    );
}

#[test]
fn s4_entry_for_does_not_walk_every_file() {
    let dir = tmp_dir("entry-for");
    for i in 0..6 {
        fs::write(dir.path.join(format!("n{i}.md")), format!("body {i}\n")).unwrap();
    }
    let mut vault = Vault::open(dir.path.clone()).unwrap();
    let indexed = vault.list_files().len();
    assert!(indexed >= 6, "indexed {indexed}");
    let _ = index::take_list_walks();

    // Counts are taken before any `list_files` check. `listed` walks the whole map.
    let missing = vault.entry_for("missing.md");
    let missing_walks = index::take_list_walks();
    let made = vault.create_note("sub/Extra.md", "hello [[n0]]\n").unwrap();
    let create_walks = index::take_list_walks();
    let folder = vault.create_folder("sub/Empty").unwrap();
    let folder_walks = index::take_list_walks();
    let bytes = vault.write_file_bytes("pics/a.PNG", &[1, 2, 3, 4]).unwrap();
    let bytes_walks = index::take_list_walks();

    assert_eq!(missing.path, "missing.md");
    assert_eq!(missing.name, "missing.md");
    assert!(!missing.is_dir);
    assert_eq!(missing.size, 0);
    assert_eq!(made.path, "sub/Extra.md");
    assert_eq!(made.name, "Extra");
    assert!(!made.is_dir);
    assert_eq!(made, listed(&vault, "sub/Extra.md"));
    assert_eq!(
        vault.index.resolve("sub/Extra.md", "n0").as_deref(),
        Some("n0.md")
    );
    assert_eq!(folder.path, "sub/Empty");
    assert_eq!(folder.name, "Empty");
    assert!(folder.is_dir);
    assert_eq!(folder.size, 0);
    assert_eq!(folder, listed(&vault, "sub/Empty"));
    assert_eq!(bytes.path, "pics/a.PNG");
    assert_eq!(bytes.name, "a.PNG");
    assert!(!bytes.is_dir);
    assert!(bytes.size >= 4);
    assert_eq!(bytes, listed(&vault, "pics/a.PNG"));

    assert_eq!(
        (missing_walks, create_walks, folder_walks, bytes_walks),
        (0, 0, 0, 0),
        "entry_for walked list nodes; {indexed} files were indexed before the creates"
    );
}

/// P2a: a rescan swaps in a fresh index and replays the app's writes made during the scan;
/// later saves, renames, deletes, and watcher batches patch that index per path.
/// Lookups must match a full rebuild and a rescan at every stage.
#[test]
fn p2a_lookups_survive_a_rescan_swap_and_later_patches() {
    let dir = tmp_dir("p2a-rescan");
    fs::write(dir.path.join("a.md"), "[[b]] [[bee]]\n").unwrap();
    fs::write(dir.path.join("b.md"), "---\naliases: [bee]\n---\n").unwrap();
    fs::create_dir(dir.path.join("box")).unwrap();
    fs::write(dir.path.join("box/b.md"), "inner\n").unwrap();
    let mut vault = Vault::open(dir.path.clone()).unwrap();

    let token = vault.begin_rescan();
    // The scan runs before the writes below, so they reach the swap only by replay.
    let fresh = Index::scan(&vault.root);
    vault.write_note("b.md", "no alias now\n").unwrap();
    vault.rename_path("a.md", "sub/a.md").unwrap();
    vault.create_note("c.md", "---\naliases: [bee]\n---\n").unwrap();
    vault.delete_path("box", true).unwrap();
    let _ = vault.finish_rescan(&token, fresh);
    matches_disk(&vault);
    assert_eq!(vault.index.resolve("sub/a.md", "bee").as_deref(), Some("c.md"));
    assert_eq!(vault.index.resolve("sub/a.md", "b").as_deref(), Some("b.md"));
    assert!(vault.index.resolve("sub/a.md", "box/b").is_none());

    vault.write_note("c.md", "plain\n").unwrap();
    assert!(vault.index.resolve("sub/a.md", "bee").is_none());
    fs::write(dir.path.join("b.md"), "---\naliases: [bee]\n---\n").unwrap();
    fs::rename(dir.path.join("c.md"), dir.path.join("sub/c.md")).unwrap();
    vault.apply(&[
        VaultChanged {
            kind: ChangeKind::Modify,
            paths: vec!["b.md".into()],
        },
        VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec!["c.md".into(), "sub/c.md".into()],
        },
    ]);
    matches_disk(&vault);
    assert_eq!(vault.index.resolve("sub/a.md", "bee").as_deref(), Some("b.md"));
    assert_eq!(vault.index.resolve("b.md", "c").as_deref(), Some("sub/c.md"));
    assert_eq!(vault.index.resolve("b.md", "sub/c").as_deref(), Some("sub/c.md"));
}

/// P2a review 2: a sync that deletes `README.md` from thousands of folders arrives as
/// one watcher batch of single-file Remove records. The folders stay, so no tree is
/// large. The batch shares one per-path budget and rebuilds the maps once; creating
/// as many files back does the same.
#[test]
fn p2a_many_single_file_events_in_one_batch_rebuild_once() {
    let dir = tmp_dir("p2a-many-singles");
    let n = 1_200;
    for i in 0..n {
        let folder = dir.path.join(format!("p{i:04}"));
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("README.md"), "---\naliases: [readme]\n---\n[[README]]\n").unwrap();
        fs::write(folder.join("keep.md"), "[[README]] [[readme]]\n").unwrap();
    }
    let mut vault = Vault::open(dir.path.clone()).unwrap();
    for i in 0..n {
        fs::remove_file(dir.path.join(format!("p{i:04}/README.md"))).unwrap();
    }
    let removes: Vec<VaultChanged> = (0..n)
        .map(|i| VaultChanged {
            kind: ChangeKind::Remove,
            paths: vec![format!("p{i:04}/README.md")],
        })
        .collect();
    let _ = index::take_rebuild_maps_calls();
    let _ = index::take_map_updates();
    vault.apply(&removes);
    let removed = (index::take_rebuild_maps_calls(), index::take_map_updates());
    links_match_disk(&vault);
    assert!(vault.index.resolve("p0000/keep.md", "README").is_none());
    assert!(vault.index.contains("p1199/keep.md"));

    for i in 0..n {
        fs::write(dir.path.join(format!("p{i:04}/README.md")), "back\n").unwrap();
    }
    let creates: Vec<VaultChanged> = (0..n)
        .map(|i| VaultChanged {
            kind: ChangeKind::Create,
            paths: vec![format!("p{i:04}/README.md")],
        })
        .collect();
    let _ = index::take_rebuild_maps_calls();
    let _ = index::take_map_updates();
    vault.apply(&creates);
    let created = (index::take_rebuild_maps_calls(), index::take_map_updates());
    links_match_disk(&vault);
    assert_eq!(
        vault.index.resolve("p0005/keep.md", "README").as_deref(),
        Some("p0005/README.md")
    );
    assert_eq!(
        (removed, created),
        ((1, index::BULK_PATHS), (1, index::BULK_PATHS)),
        "(rebuilds, per-path updates) for {n} single removes, then {n} single creates"
    );
}

/// Maps, paths, and resolved links against a rescan. Folder rows are left out of the
/// comparison: a file Remove event does not re-read its parent folder's mtime (before
/// P2a too), and deleting a file on disk changes that mtime.
fn links_match_disk(vault: &Vault) {
    vault.index.assert_maps_match_rebuild();
    let scanned = Index::scan(&vault.root).expect("rescan");
    let paths = |index: &Index| index.paths().cloned().collect::<Vec<_>>();
    assert_eq!(paths(&vault.index), paths(&scanned), "indexed paths");
    assert_eq!(vault.index.link_index(), scanned.link_index(), "resolved links");
}
