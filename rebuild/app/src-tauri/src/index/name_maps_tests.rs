//! Per-path name maps against the full rebuild (P2a).
//!
//! Two oracles: `NameMaps::build` over the whole file list (the new full rebuild), and
//! `legacy_winners`, the map-building loop `rebuild_maps` ran before P2a, kept verbatim.
//! Random edit, rename, and delete sequences must leave the per-path maps equal to both.

use super::name_maps::{NameMaps, Winners};
use super::*;
use crate::fsutil::tmp_dir;
use std::collections::HashMap;
use std::time::Instant;

/// The pre-P2a `rebuild_maps` body, unchanged except that it returns the maps.
fn legacy_winners(files: &file_map::Files) -> Winners {
    fn remember_suffix(map: &mut HashMap<String, String>, key: &str, path: &str) {
        let keep = match map.get(key) {
            Some(old) => old.len() < path.len() || (old.len() == path.len() && old.as_str() <= path),
            None => false,
        };
        if !keep {
            map.insert(key.to_string(), path.to_string());
        }
    }
    let mut by_alias: HashMap<String, String> = HashMap::new();
    let mut by_path_lower: HashMap<String, String> = HashMap::new();
    let mut suffixes: HashMap<String, String> = HashMap::new();
    let mut names: HashMap<String, Vec<String>> = HashMap::new();
    for (path, node) in files {
        if node.is_dir {
            continue;
        }
        let lower = path.to_lowercase();
        if !nameless_md(path) {
            for (i, _) in lower.match_indices('/') {
                remember_suffix(&mut suffixes, &lower[i..], path);
            }
        }
        by_path_lower.insert(lower, path.clone());
        let key = display_name(path, false).to_lowercase();
        if !key.is_empty() {
            names.entry(key).or_default().push(path.clone());
        }
        if is_note_path(path) {
            for alias in &node.note.aliases {
                by_alias.entry(alias.clone()).or_insert_with(|| path.clone());
            }
        }
    }
    for list in names.values_mut() {
        list.sort();
    }
    Winners {
        by_name: names,
        by_alias,
        by_path_lower,
        by_suffix: suffixes,
    }
}

impl Index {
    /// Panics unless the live maps equal a full rebuild and the pre-P2a winners.
    pub(crate) fn assert_maps_match_rebuild(&self) {
        assert!(!self.maps_dirty, "maps left stale outside a batch");
        assert_eq!(self.maps, NameMaps::build(&self.files), "per-path maps vs a full rebuild");
        assert_eq!(
            self.maps.winners(),
            legacy_winners(&self.files),
            "winners vs the pre-P2a rebuild"
        );
    }

    /// The same nodes with maps from one full rebuild.
    fn rebuilt_copy(&self) -> Index {
        let mut copy = Index::stale();
        for (path, node) in &self.files {
            copy.files.insert(path.clone(), node.clone());
        }
        copy.rebuild_maps();
        copy
    }
}

/// xorshift64*: deterministic, no crates.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn pick<'a>(&mut self, items: &'a [&'a str]) -> &'a str {
        items[self.below(items.len())]
    }
}

const FOLDERS: [&str; 7] = ["", "a", "A", "a/b", "b", "deep/er/x", "é"];
const NAMES: [&str; 9] = ["note", "Note", "NOTE", "a", "b", "x y", ".md", "é", "İ"];
const EXTS: [&str; 5] = [".md", ".MD", ".png", "", ".md.md"];
const ALIASES: [&str; 5] = ["alpha", "Alpha", "beta", "note", "x y"];
const LINKS: [&str; 8] = [
    "[[note]]",
    "[[a/note]]",
    "[[alpha]]",
    "[x](b.md)",
    "[[../note]]",
    "[[er/x/b]]",
    "[[x y]]",
    "[[İ]]",
];
const PROBES: [&str; 14] = [
    "note", "Note.md", "a/note", "b/note", "alpha", "beta", "x y", "../note", "a/b/note",
    "er/x/b", ".md", "é", "i̇", "A/NOTE.MD",
];

fn random_path(rng: &mut Rng) -> String {
    let folder = rng.pick(&FOLDERS);
    let file = format!("{}{}", rng.pick(&NAMES), rng.pick(&EXTS));
    if folder.is_empty() {
        file
    } else {
        format!("{folder}/{file}")
    }
}

fn random_content(rng: &mut Rng) -> String {
    let mut text = String::new();
    let aliases: Vec<&str> = (0..rng.below(3)).map(|_| rng.pick(&ALIASES)).collect();
    if !aliases.is_empty() {
        text.push_str(&format!("---\naliases: [{}]\n---\n", aliases.join(", ")));
    }
    for _ in 0..rng.below(4) {
        text.push_str(rng.pick(&LINKS));
        text.push('\n');
    }
    text
}

/// An indexed path (file or folder) most of the time, otherwise a fresh one.
fn some_path(rng: &mut Rng, idx: &Index) -> String {
    let known: Vec<&String> = idx.files.keys().collect();
    if !known.is_empty() && rng.below(4) != 0 {
        known[rng.below(known.len())].clone()
    } else if rng.below(2) == 0 {
        rng.pick(&FOLDERS).to_string()
    } else {
        random_path(rng)
    }
}

fn same_answers(idx: &Index, ctx: &str) {
    idx.assert_maps_match_rebuild();
    let oracle = idx.rebuilt_copy();
    assert_eq!(idx.link_index(), oracle.link_index(), "{ctx}: link index");
    let notes: Vec<String> = idx.files.keys().cloned().collect();
    assert_eq!(idx.backlinks(&notes), oracle.backlinks(&notes), "{ctx}: backlinks");
    for from in ["x.md", "a/x.md", "a/b/x.md", "deep/er/x/y.md"] {
        for probe in PROBES {
            assert_eq!(
                idx.resolve(from, probe),
                oracle.resolve(from, probe),
                "{ctx}: resolve {probe:?} from {from:?}"
            );
        }
    }
}

fn run_sequence(seed: u64, steps: usize) {
    let tmp = tmp_dir("name-maps-seq");
    let root = tmp.path.as_path();
    let mut rng = Rng(seed);
    let mut idx = Index::default();
    for _ in 0..12 {
        let path = random_path(&mut rng);
        let body = random_content(&mut rng);
        idx.upsert_note(root, &path, &body, Stamp::sized(body.len()));
    }
    let _ = take_rebuild_maps_calls();
    for step in 0..steps {
        let ctx = format!("seed {seed} step {step}");
        let op = rng.below(20);
        match op {
            0..=7 => {
                let path = random_path(&mut rng);
                let body = random_content(&mut rng);
                idx.upsert_note(root, &path, &body, Stamp::sized(body.len()));
            }
            8 => {
                // A save that changes nothing the maps hold.
                let path = some_path(&mut rng, &idx);
                if idx.contains(&path) && !idx.is_dir(&path) {
                    let aliases = idx.files.get(&path).unwrap().note.aliases.clone();
                    let body = if aliases.is_empty() {
                        "plain\n".to_string()
                    } else {
                        format!("---\naliases: [{}]\n---\nedited\n", aliases.join(", "))
                    };
                    idx.upsert_note(root, &path, &body, Stamp::sized(body.len()));
                }
            }
            9..=12 => {
                let from = some_path(&mut rng, &idx);
                let to = if rng.below(3) == 0 {
                    some_path(&mut rng, &idx)
                } else if rng.below(2) == 0 {
                    rng.pick(&FOLDERS).to_string() + "/moved"
                } else {
                    random_path(&mut rng)
                };
                idx.relocate(&from, &to);
            }
            13..=15 => {
                let path = some_path(&mut rng, &idx);
                idx.remove_tree(&path);
            }
            16..=17 => {
                // A watcher-shaped batch of renames and removals only: no full rebuild.
                let mut batch = idx.map_batch();
                for _ in 0..1 + rng.below(3) {
                    let from = some_path(&mut rng, batch.index);
                    if rng.below(2) == 0 {
                        let to = random_path(&mut rng);
                        batch.relocate(&from, &to);
                    } else {
                        batch.remove_tree(&from);
                    }
                }
                drop(batch);
            }
            _ => {
                // A batch whose refresh reads a real file: the maps go stale until the drop.
                let path = random_path(&mut rng);
                let full = root.join(&path);
                if !idx.is_dir(&path) && fs::create_dir_all(full.parent().unwrap()).is_ok()
                    && !full.is_dir()
                {
                    fs::write(&full, random_content(&mut rng)).unwrap();
                }
                let mut batch = idx.map_batch();
                let other = some_path(&mut rng, batch.index);
                batch.remove_tree(&other);
                batch.refresh_path(root, &path);
                let to = random_path(&mut rng);
                batch.relocate(&path, &to);
                drop(batch);
                let _ = take_rebuild_maps_calls();
            }
        }
        let rebuilds = take_rebuild_maps_calls();
        assert_eq!(rebuilds, 0, "{ctx}: op {op} ran {rebuilds} full rebuilds");
        same_answers(&idx, &ctx);
        // The oracle copy's own rebuild is not the op's.
        let _ = take_rebuild_maps_calls();
    }
}

#[test]
fn random_edits_renames_and_deletes_match_a_full_rebuild() {
    for seed in [0x9E37_79B9_7F4A_7C15, 7, 0xDEAD_BEEF, 42, 0x5EED_6A0E] {
        run_sequence(seed, 300);
    }
}

#[test]
fn every_winner_change_matches_the_rebuild() {
    let tmp = tmp_dir("name-maps-winners");
    let root = tmp.path.as_path();
    let mut idx = Index::from_notes(&[
        ("z/Note.md", "---\naliases: [shared]\n---\n"),
        ("Note.png", ""),
        ("x/y/z/Note.md", ""),
        ("q/z/Note.md", ""),
        ("a/Note.md", "---\naliases: [shared, Shared]\n---\n"),
        ("CASE.md", ""),
        ("case.md", ""),
        ("link.md", "[[Note]] [[shared]] [[z/note]] [[case]] [[y/z/note]]\n"),
    ]);
    idx.assert_maps_match_rebuild();
    // Alias winner is the first path: removing it promotes the next owner.
    assert_eq!(idx.resolve("link.md", "shared").as_deref(), Some("a/Note.md"));
    idx.remove_tree("a/Note.md");
    idx.assert_maps_match_rebuild();
    assert_eq!(idx.resolve("link.md", "shared").as_deref(), Some("z/Note.md"));
    // Dropping the alias in a save forgets it; adding it back restores it.
    idx.upsert_note(root, "z/Note.md", "no aliases\n", Stamp::sized(11));
    idx.assert_maps_match_rebuild();
    assert!(idx.resolve("link.md", "shared").is_none());
    idx.upsert_note(root, "z/Note.md", "---\nalias: shared\n---\n", Stamp::sized(20));
    idx.assert_maps_match_rebuild();
    assert_eq!(idx.resolve("link.md", "shared").as_deref(), Some("z/Note.md"));
    // Lower-case path collisions keep the last path; removing it falls back to the other.
    assert_eq!(idx.resolve("link.md", "./CASE").as_deref(), Some("case.md"));
    idx.remove_tree("case.md");
    idx.assert_maps_match_rebuild();
    assert_eq!(idx.resolve("link.md", "./case").as_deref(), Some("CASE.md"));
    // A partial path takes the shortest file; removing it promotes the longer one.
    assert_eq!(idx.resolve("link.md", "z/note").as_deref(), Some("z/Note.md"));
    idx.relocate("z", "w");
    idx.assert_maps_match_rebuild();
    assert_eq!(idx.resolve("link.md", "z/note").as_deref(), Some("q/z/Note.md"));
    idx.remove_tree("q");
    idx.assert_maps_match_rebuild();
    assert_eq!(idx.resolve("link.md", "z/note").as_deref(), Some("x/y/z/Note.md"));
    // A note renamed to a picture leaves the name to the other files and drops its aliases.
    idx.relocate("w/Note.md", "w/Note.png");
    idx.assert_maps_match_rebuild();
    assert!(idx.resolve("link.md", "shared").is_none());
    // A file replaced by a folder of the same path leaves every map.
    idx.upsert_note(root, "CASE.md/inner.md", "", Stamp::sized(0));
    idx.assert_maps_match_rebuild();
    assert!(idx.is_dir("CASE.md"));
    assert!(idx.resolve("link.md", "case").is_none());
    // A rename onto an existing file replaces it in the maps too.
    idx.relocate("x/y/z/Note.md", "link.md");
    idx.assert_maps_match_rebuild();
    assert!(idx.resolve("link.md", "y/z/note").is_none());
}

/// The rename trap (RUST_MIGRATION_PLAN step 2): links read before `relocate` see the old
/// paths, and reads after it match a full rebuild.
#[test]
fn rename_trap_reads_before_relocate_see_old_paths_and_after_match_a_rebuild() {
    let mut idx = Index::from_notes(&[
        ("dir/Target.md", "---\naliases: [goal]\n---\n"),
        ("dir/Source.md", "[[Target]] [[goal]] [md](Target.md)\n"),
        ("Outside.md", "[[dir/Target]] [[goal]]\n"),
        ("Plain.md", "mentions Target in text\n"),
    ]);
    let old = vec!["dir/Target.md".to_string()];
    let sources = idx.link_sources(&old);
    let before = idx.backlinks(&old);
    // A plain-text mention of the name counts too.
    assert_eq!(sources, ["Outside.md", "Plain.md", "dir/Source.md"]);
    assert_eq!(before["dir/Target.md"].len(), 5);

    idx.relocate("dir", "moved");
    same_answers(&idx, "after folder move");
    let new = vec!["moved/Target.md".to_string()];
    assert!(idx.backlinks(&old).is_empty());
    // `[[dir/Target]]` no longer resolves; the name, alias, and markdown links follow.
    let after = idx.backlinks(&new);
    assert_eq!(after["moved/Target.md"].len(), 4);
    assert_eq!(idx.resolve("Outside.md", "goal").as_deref(), Some("moved/Target.md"));

    idx.relocate("moved/Target.md", "Renamed.md");
    same_answers(&idx, "after file rename");
    let renamed = vec!["Renamed.md".to_string()];
    // Only the alias still points at the note; the page rewrites the rest.
    assert_eq!(idx.backlinks(&renamed)["Renamed.md"].len(), 2);
    assert!(idx.resolve("moved/Source.md", "Target").is_none());
}

fn big_index(n: usize) -> Index {
    let mut idx = Index::stale();
    for i in 0..n {
        let path = format!("f{}/g{}/n{i}.md", i % 100, i % 7);
        idx.ensure_parent_nodes(&path);
        let body = format!("---\naliases: [a{i}]\n---\nlinks [[n{}]] and [[a{}]]\n", (i + 1) % n, (i + 2) % n);
        idx.insert_file(&path, Stamp::sized(body.len()), || body.clone());
    }
    idx.rebuild_maps();
    idx
}

/// A save, a rename, and a delete visit only their own paths, never the whole list.
#[test]
fn per_path_updates_visit_only_the_changed_paths() {
    let tmp = tmp_dir("name-maps-visits");
    let root = tmp.path.as_path();
    let mut idx = big_index(2_000);
    let _ = take_file_visits();
    let _ = take_rebuild_maps_calls();

    idx.upsert_note(root, "f3/g3/n3.md", "---\naliases: [fresh]\n---\n", Stamp::sized(24));
    idx.upsert_note(root, "new/one.md", "[[n3]]\n", Stamp::sized(7));
    let upserts = take_file_visits();
    idx.relocate("f3/g3/n3.md", "elsewhere/n3.md");
    let file_move = take_file_visits();
    idx.relocate("f5", "f5-moved");
    let folder_move = take_file_visits();
    idx.remove_tree("new/one.md");
    let file_delete = take_file_visits();
    idx.remove_tree("f6");
    let folder_delete = take_file_visits();
    idx.relocate("missing", "also-missing");
    let missing = take_file_visits();
    let rebuilds = take_rebuild_maps_calls();

    // f5 and f6 each hold 20 notes in 7 subfolders, plus the folder itself.
    assert_eq!(
        (upserts, file_move, folder_move, file_delete, folder_delete, missing, rebuilds),
        (0, 1, 28, 1, 28, 0, 0),
        "visits: upserts, file move, folder move, file delete, folder delete, missing; rebuilds"
    );
    idx.assert_maps_match_rebuild();
    assert_eq!(idx.resolve("x.md", "fresh").as_deref(), Some("elsewhere/n3.md"));
    assert_eq!(idx.resolve("x.md", "a5").as_deref(), Some("f5-moved/g5/n5.md"));
    assert!(idx.resolve("x.md", "a6").is_none());
    assert!(idx.resolve("x.md", "one").is_none());
}

/// Cheap timing at 20k notes: a save costs far less than one full rebuild.
#[test]
fn saves_at_20k_notes_cost_far_less_than_a_full_rebuild() {
    let tmp = tmp_dir("name-maps-20k");
    let root = tmp.path.as_path();
    let mut idx = big_index(20_000);
    let started = Instant::now();
    for _ in 0..3 {
        idx.rebuild_maps();
    }
    let rebuild = started.elapsed() / 3;
    let saves = 60u32;
    let started = Instant::now();
    for i in 0..saves {
        let i = i as usize * 37;
        let path = format!("f{}/g{}/n{i}.md", i % 100, i % 7);
        let body = format!("---\naliases: [b{i}]\n---\nedited\n");
        idx.upsert_note(root, &path, &body, Stamp::sized(body.len()));
    }
    let save = started.elapsed() / saves;
    eprintln!("20k notes: full rebuild {rebuild:?}, save {save:?}");
    assert!(
        save * 20 < rebuild,
        "a save ({save:?}) should cost under 1/20 of a full rebuild ({rebuild:?})"
    );
    idx.assert_maps_match_rebuild();
}

/// Release timings for the notes:
/// `cargo test --release --offline -- --ignored --nocapture bench_name_maps`
#[test]
#[ignore]
fn bench_name_maps() {
    let tmp = tmp_dir("name-maps-bench");
    let root = tmp.path.as_path();
    for n in [20_000usize, 50_000] {
        let mut idx = big_index(n);
        let runs = 5u32;
        let started = Instant::now();
        for _ in 0..runs {
            std::hint::black_box(legacy_winners(&idx.files));
        }
        let legacy = started.elapsed() / runs;
        let started = Instant::now();
        for _ in 0..runs {
            idx.rebuild_maps();
        }
        let full = started.elapsed() / runs;
        let saves = 500u32;
        let started = Instant::now();
        for i in 0..saves {
            let i = i as usize * 37 % n;
            let path = format!("f{}/g{}/n{i}.md", i % 100, i % 7);
            let body = format!("---\naliases: [b{i}]\n---\nedited [[n1]]\n");
            idx.upsert_note(root, &path, &body, Stamp::sized(body.len()));
        }
        let save = started.elapsed() / saves;
        let started = Instant::now();
        for i in 0..saves {
            let i = i as usize * 41 % n;
            let from = format!("f{}/g{}/n{i}.md", i % 100, i % 7);
            idx.relocate(&from, &format!("moved/r{i}.md"));
        }
        let rename = started.elapsed() / saves;
        let started = Instant::now();
        idx.relocate("f7", "f7-moved");
        let folder = started.elapsed();
        eprintln!(
            "{n} notes: old full rebuild {legacy:?}, new full rebuild {full:?}, save {save:?}, \
             file rename {rename:?}, folder rename ({} notes) {folder:?}",
            n / 100
        );
        idx.assert_maps_match_rebuild();
    }
}
