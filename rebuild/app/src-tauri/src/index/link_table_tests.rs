//! The link table and its deltas against a full walk (R2 P2b).
//!
//! The oracle is the `link_index` and `backlinks` bodies from before P2b, kept verbatim:
//! they resolve every link of every note on each call. After every step the tests check:
//!
//! - the table equals every note resolved from scratch (targets, entries, and the keys read);
//! - both reverse maps equal ones rebuilt from the table;
//! - `link_index` and `backlinks` (for every path) equal the walk;
//! - pages that patch their copy from `link_changes` (one refreshing after every step, one
//!   lagging behind, one starting empty) hold exactly the walk's index.
//!
//! `assert_links_match_walk` also runs from `assert_maps_match_rebuild`, so every P2a name-map
//! test and every S4 / P2a vault batch test checks the link table too.

use super::name_maps_tests::{random_path, some_path, Rng};
use super::*;
use crate::fsutil::tmp_dir;
use crate::model::Backlink;
use std::collections::BTreeSet;
use std::time::Instant;

/// The pre-P2b `Index::link_index` body.
pub(super) fn walked_link_index(idx: &Index) -> LinkIndex {
    let mut outgoing = BTreeMap::new();
    let mut markdown = BTreeMap::new();
    let mut unresolved = BTreeMap::new();
    for (path, node) in &idx.files {
        if node.is_dir || !is_note_path(path) {
            continue;
        }
        let mut outs = Vec::new();
        let mut md_outs = Vec::new();
        let mut missing: Vec<String> = Vec::new();
        for link in &node.note.links {
            let Some(dest) = idx.resolve(path, &link.target) else {
                let name = if link.markdown {
                    strip_md(&link.target)
                } else {
                    link.target.as_str()
                };
                if !missing.iter().any(|m| m.eq_ignore_ascii_case(name)) {
                    missing.push(name.to_string());
                }
                continue;
            };
            if link.markdown {
                if !md_outs.contains(&dest) {
                    md_outs.push(dest.clone());
                }
            } else if !outs.contains(&dest) {
                outs.push(dest.clone());
            }
        }
        if !outs.is_empty() {
            outgoing.insert(path.clone(), outs);
        }
        if !md_outs.is_empty() {
            markdown.insert(path.clone(), md_outs);
        }
        if !missing.is_empty() {
            unresolved.insert(path.clone(), missing);
        }
    }
    LinkIndex {
        outgoing,
        markdown,
        unresolved,
    }
}

/// The pre-P2b `Index::backlinks` body.
pub(super) fn walked_backlinks(idx: &Index, paths: &[String]) -> BTreeMap<String, Vec<Backlink>> {
    let wanted: BTreeSet<&String> = paths.iter().collect();
    let mut found: BTreeMap<String, Vec<Backlink>> = BTreeMap::new();
    if wanted.is_empty() {
        return found;
    }
    for (from, node) in &idx.files {
        if node.is_dir || !is_note_path(from) {
            continue;
        }
        for link in &node.note.links {
            let Some(target) = idx.resolve(from, &link.target) else {
                continue;
            };
            if wanted.contains(&target) {
                found.entry(target).or_default().push(Backlink {
                    from: from.clone(),
                    line: link.line,
                    text: link.text.clone(),
                });
            }
        }
    }
    found
}

impl Index {
    /// Panics unless the link table, `link_index`, and `backlinks` equal a full walk.
    pub(crate) fn assert_links_match_walk(&self) {
        assert!(!self.links.has_pending(), "link table left unsettled");
        let fresh: BTreeMap<Arc<str>, Resolved> = self
            .files
            .iter()
            .filter(|(path, node)| has_links(path, node))
            .map(|(path, node)| (Arc::from(path.as_str()), resolve_note(&self.maps, path, &node.note.links)))
            .collect();
        if self.links.notes() != &fresh {
            for (path, r) in self.links.notes() {
                if fresh.get(path) != Some(r) {
                    panic!("link table vs every note resolved again: {path}\n table {r:?}\n fresh {:?}", fresh.get(path));
                }
            }
            for path in fresh.keys() {
                assert!(self.links.notes().contains_key(path), "link table lacks {path}");
            }
        }
        assert!(self.links.reverse_maps_match(), "reverse maps vs the table");
        assert_eq!(self.link_index(), walked_link_index(self), "link_index vs a full walk");
        let mut paths: Vec<String> = self.files.keys().cloned().collect();
        paths.push("missing.md".into());
        assert_eq!(self.backlinks(&paths), walked_backlinks(self, &paths), "backlinks vs a full walk");
        // One path at a time too: a walk each, so not on a large index (the P2a fixtures with
        // thousands of same-named notes make each walk cost seconds in a debug build).
        let singles = if self.files.len() > 2_000 { 0 } else { 64 };
        for path in paths.iter().take(singles) {
            let one = std::slice::from_ref(path);
            assert_eq!(self.backlinks(one), walked_backlinks(self, one), "backlinks of {path}");
        }
    }
}

/// A page's copy of the link index, patched from `link_changes` the way `api.linkIndex` does.
#[derive(Default)]
struct Page {
    since: Option<(u64, u64)>,
    links: Option<LinkIndex>,
    fulls: usize,
    deltas: usize,
    /// Paths in the last delta.
    last: Vec<String>,
}

fn set(map: &mut BTreeMap<String, Vec<String>>, path: &str, list: Vec<String>) {
    if list.is_empty() {
        map.remove(path);
    } else {
        map.insert(path.to_string(), list);
    }
}

impl Page {
    fn refresh(&mut self, idx: &Index) {
        let reply = idx.link_changes(self.since);
        // The page gets JSON: empty lists are left out, and a missing list means empty.
        let json = serde_json::to_value(&reply).unwrap();
        for entry in json["changed"].as_object().unwrap().values() {
            for (_, list) in entry.as_object().unwrap() {
                assert!(!list.as_array().unwrap().is_empty(), "an empty list was sent");
            }
        }
        if let Some(full) = reply.full {
            assert!(reply.since.is_none() && reply.changed.is_empty());
            self.links = Some(full);
            self.fulls += 1;
            self.last.clear();
        } else {
            assert_eq!(reply.since, self.since.map(|(_, v)| v), "a delta is relative to the page's version");
            let links = self.links.as_mut().expect("a delta for a page holding nothing");
            self.last = reply.changed.keys().cloned().collect();
            for (path, entry) in reply.changed {
                set(&mut links.outgoing, &path, entry.outgoing);
                set(&mut links.markdown, &path, entry.markdown);
                set(&mut links.unresolved, &path, entry.unresolved);
            }
            self.deltas += 1;
        }
        self.since = Some((reply.id, reply.version));
    }

    fn holds(&self, idx: &Index, ctx: &str) {
        assert_eq!(self.links.as_ref(), Some(&walked_link_index(idx)), "{ctx}: page vs a full walk");
    }
}

/// Three pages: one refreshed after every step, one every third step, and one new each time.
struct Pages {
    eager: Page,
    lagging: Page,
    step: usize,
}

impl Pages {
    fn new(idx: &Index) -> Self {
        let mut pages = Pages {
            eager: Page::default(),
            lagging: Page::default(),
            step: 0,
        };
        pages.eager.refresh(idx);
        pages.lagging.refresh(idx);
        pages
    }

    fn check(&mut self, idx: &Index, ctx: &str) {
        idx.assert_links_match_walk();
        self.eager.refresh(idx);
        self.eager.holds(idx, ctx);
        self.step += 1;
        if self.step.is_multiple_of(3) {
            self.lagging.refresh(idx);
            self.lagging.holds(idx, ctx);
        }
        let mut new = Page::default();
        new.refresh(idx);
        assert_eq!(new.fulls, 1);
        new.holds(idx, ctx);
    }
}

fn save(idx: &mut Index, root: &Path, path: &str, body: &str) {
    idx.upsert_note(root, path, body, Stamp::sized(body.len()));
}

fn changed(page: &Page) -> Vec<&str> {
    page.last.iter().map(String::as_str).collect()
}

#[test]
fn deltas_match_a_full_rebuild_after_renames_moves_deletes_aliases_and_embeds() {
    let tmp = tmp_dir("link-deltas");
    let root = tmp.path.as_path();
    let mut idx = Index::from_notes(&[
        ("Target.md", "---\naliases: [goal]\n---\nbody\n"),
        ("dir/Other.md", "# Head\n[[Hub]]\n"),
        (
            "Hub.md",
            "[[Target]] ![[Target]] [[goal]] [[dir/Other]] [t](Target.md)\n![img](pic.png) [[Missing]] [[Other#Head|shown]]\n",
        ),
        ("pic.png", ""),
        ("dir/Rel.md", "[[../Target]] [[Other]] [[Target#^block]]\n"),
        ("Embedder.md", "![[Hub]] ![[pic.png]]\n"),
        ("Plain.md", "no links here\n"),
    ]);
    let mut pages = Pages::new(&idx);
    pages.check(&idx, "start");
    let start = idx.links.version();

    // A typing save that changes no link: no new version, an empty delta.
    save(&mut idx, root, "Hub.md", "[[Target]] ![[Target]] [[goal]] [[dir/Other]] [t](Target.md)\n![img](pic.png) [[Missing]] [[Other#Head|shown]] more words\n");
    pages.check(&idx, "typing save");
    assert_eq!(idx.links.version(), start, "a save that changes no link keeps the version");
    assert!(changed(&pages.eager).is_empty());

    // Rename the target: links by name go unresolved, the alias still follows it.
    idx.relocate("Target.md", "Goal Note.md");
    pages.check(&idx, "rename");
    assert_eq!(changed(&pages.eager), ["Hub.md", "dir/Rel.md"]);
    assert!(idx.link_index().unresolved["Hub.md"].contains(&"Target".to_string()));
    assert_eq!(idx.resolve("Hub.md", "goal").as_deref(), Some("Goal Note.md"));

    // Move it into a folder: the relative link and the alias follow the new path.
    idx.relocate("Goal Note.md", "dir/Goal Note.md");
    pages.check(&idx, "move into a folder");
    assert_eq!(changed(&pages.eager), ["Hub.md"]);

    // Move the whole folder (one full rebuild): the delta still lists only notes that changed.
    let _ = take_rebuild_maps_calls();
    idx.relocate("dir", "moved");
    assert_eq!(take_rebuild_maps_calls(), 1);
    pages.check(&idx, "folder move");
    assert_eq!(changed(&pages.eager), ["Hub.md", "dir/Other.md", "dir/Rel.md", "moved/Other.md", "moved/Rel.md"]);

    // Delete a target: its linkers list it as unresolved.
    idx.remove_tree("moved/Other.md");
    pages.check(&idx, "delete");
    assert_eq!(changed(&pages.eager), ["Hub.md", "moved/Other.md", "moved/Rel.md"]);
    assert!(idx.backlinks(&["moved/Other.md".into()]).is_empty());

    // Alias edits: adding `target` brings `[[Target]]` back; dropping `goal` loses `[[goal]]`.
    save(&mut idx, root, "moved/Goal Note.md", "---\naliases: [target]\n---\nbody\n");
    pages.check(&idx, "alias edit");
    assert_eq!(idx.resolve("Hub.md", "Target").as_deref(), Some("moved/Goal Note.md"));
    assert!(idx.resolve("Hub.md", "goal").is_none());
    assert_eq!(changed(&pages.eager), ["Hub.md", "moved/Rel.md"]);
    save(&mut idx, root, "moved/Goal Note.md", "body only\n");
    pages.check(&idx, "alias removed");

    // Embed edits: add an embed of a note and of a picture, then drop the old embeds.
    save(&mut idx, root, "Embedder.md", "![[Hub]] ![[pic.png]] ![[Goal Note]] ![[Plain#Part]]\n");
    pages.check(&idx, "embeds added");
    assert_eq!(changed(&pages.eager), ["Embedder.md"]);
    assert_eq!(idx.backlinks(&["Plain.md".into()])["Plain.md"].len(), 1);
    save(&mut idx, root, "Embedder.md", "![[Goal Note]]\n");
    pages.check(&idx, "embeds removed");
    assert!(idx.backlinks(&["Hub.md".into()]).is_empty());
    save(&mut idx, root, "Embedder.md", "no embeds\n");
    pages.check(&idx, "last embed removed");
    assert!(!idx.link_index().outgoing.contains_key("Embedder.md"));

    // A new note takes the name back: a name beats an alias, and the old alias owner loses it.
    save(&mut idx, root, "moved/Goal Note.md", "---\naliases: [target]\n---\n");
    save(&mut idx, root, "Target.md", "new\n");
    pages.check(&idx, "a new note takes the name");
    assert_eq!(idx.resolve("Hub.md", "Target").as_deref(), Some("Target.md"));

    // A case clash on a path link: the last path in path order wins, and loses on delete.
    save(&mut idx, root, "Paths.md", "[[./case]]\n");
    save(&mut idx, root, "CASE.md", "");
    save(&mut idx, root, "case.md", "");
    pages.check(&idx, "case clash");
    assert_eq!(idx.resolve("Paths.md", "./case").as_deref(), Some("case.md"));
    idx.remove_tree("case.md");
    pages.check(&idx, "case clash delete");
    assert_eq!(changed(&pages.eager), ["Paths.md"]);

    // A link rewritten to reach the same note through other keys (an alias, then a path):
    // the entry is the same, but later changes must wake it through the keys it reads now.
    save(&mut idx, root, "keys/note.md", "---\naliases: [alpha]\n---\n");
    save(&mut idx, root, "keys/x.md", "[[alpha]]\n");
    pages.check(&idx, "alias link");
    save(&mut idx, root, "keys/x.md", "[[keys/note]]\n");
    pages.check(&idx, "same target through a path");
    assert!(changed(&pages.eager).is_empty(), "same entry, nothing to send");
    save(&mut idx, root, "keys/note", "");
    pages.check(&idx, "a file now owns the path key");
    assert_eq!(idx.resolve("keys/x.md", "keys/note").as_deref(), Some("keys/note"));
    assert_eq!(changed(&pages.eager), ["keys/x.md"]);

    // A note renamed to a picture drops its links and aliases.
    idx.relocate("Hub.md", "Hub.png");
    pages.check(&idx, "note to picture");
    assert!(!idx.link_index().outgoing.contains_key("Hub.md"));

    // A delete of more than `BULK_PATHS` notes rebuilds once; its linkers still change.
    for i in 0..BULK_PATHS + 4 {
        save(&mut idx, root, &format!("bulk/n{i:03}.md"), "[[Target]] [[n000]]\n");
    }
    pages.check(&idx, "bulk created");
    save(&mut idx, root, "Watcher.md", "[[bulk/n001]] [[n002]]\n");
    let _ = take_rebuild_maps_calls();
    idx.remove_tree("bulk");
    assert_eq!(take_rebuild_maps_calls(), 1);
    pages.check(&idx, "bulk delete");
    assert!(changed(&pages.eager).contains(&"Watcher.md"));

    // A watcher-shaped batch: a rename, a create, a delete, and a save, settled once.
    {
        let mut batch = idx.map_batch();
        batch.relocate("Target.md", "Renamed.md");
        batch.remove_tree("Plain.md");
        batch.index.upsert_note(root, "Renamed.md", "[[Embedder]]\n", Stamp::sized(13));
        batch.index.upsert_note(root, "Plain.md", "back [[Renamed]]\n", Stamp::sized(17));
        assert!(batch.index.links.has_pending(), "a batch settles on drop, not per step");
    }
    pages.check(&idx, "batch");

    assert!(pages.eager.deltas >= 17 && pages.eager.fulls == 1, "the eager page patched every step");
    assert!(pages.lagging.fulls == 1, "the lagging page patched too");
}

/// A page further behind than the log, or holding another table's id, gets the whole index.
#[test]
fn pages_too_far_behind_or_from_another_index_get_the_whole_index() {
    let tmp = tmp_dir("link-deltas-far");
    let root = tmp.path.as_path();
    // The real cap (`LOG_PATHS`) is 65,536 paths; the same rules on a smaller log.
    const LOG_PATHS: usize = 64;
    let n = LOG_PATHS + 10;
    let mut notes: Vec<(String, String)> = (0..n).map(|i| (format!("f/n{i:05}.md"), "[[t]]\n".to_string())).collect();
    notes.push(("Near.md".into(), "[[Near target]]\n".into()));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut idx = Index::from_notes(&refs);
    idx.links.set_log_paths(LOG_PATHS);
    let mut behind = Page::default();
    behind.refresh(&idx);
    let mut near = Page::default();

    // A small change is a delta.
    save(&mut idx, root, "Near target.md", "");
    near.refresh(&idx);
    behind.refresh(&idx);
    assert_eq!((behind.fulls, behind.deltas), (1, 1));
    assert_eq!(changed(&behind), ["Near.md"]);

    // More changed notes than the log holds: anyone at an older version starts over.
    save(&mut idx, root, "t.md", "");
    idx.assert_links_match_walk();
    behind.refresh(&idx);
    assert_eq!((behind.fulls, behind.deltas), (2, 1), "a change larger than the log sends the whole index");
    behind.holds(&idx, "after the large change");

    // From there, deltas again, also for a few changes after a full reply.
    idx.remove_tree("Near target.md");
    behind.refresh(&idx);
    assert_eq!((behind.fulls, behind.deltas), (2, 2));
    behind.holds(&idx, "after a delete");

    // Small changes that push older paths out of the log: a page behind them starts over.
    let mut stale = Page::default();
    stale.refresh(&idx);
    for i in 0..LOG_PATHS / 2 - 1 {
        save(&mut idx, root, &format!("f/n{i:05}.md"), "[[u]]\n");
    }
    for i in 0..LOG_PATHS / 2 - 1 {
        save(&mut idx, root, &format!("f/n{i:05}.md"), "[[v]]\n");
    }
    behind.refresh(&idx);
    behind.holds(&idx, "behind, within the log");
    assert_eq!(behind.fulls, 2, "within the log is still a delta");
    for i in 0..LOG_PATHS + 1 {
        save(&mut idx, root, &format!("f/n{i:05}.md"), "[[w]]\n");
    }
    stale.refresh(&idx);
    assert_eq!(stale.fulls, 2, "past the log's oldest path is a full reply");
    stale.holds(&idx, "stale page");

    // Another index (a reopen) has another id, even for the same notes.
    let mut other = Index::from_notes(&refs);
    other.links.set_log_paths(LOG_PATHS);
    let mut page = Page::default();
    page.refresh(&idx);
    page.refresh(&other);
    assert_eq!(page.fulls, 2, "another index's id is never continued");
    page.holds(&other, "other index");
    // An unknown version of this id (never sent) is a full reply too.
    let (id, version) = idx.links.version();
    assert!(idx.link_changes(Some((id, version + 1))).full.is_some());
    assert!(idx.link_changes(Some((id, version))).full.is_none());
}

/// Every link the parser keeps, in every way resolution can change under it.
const LINKS: [&str; 14] = [
    "[[note]]",
    "[[a/note]]",
    "[[alpha]]",
    "[x](b.md)",
    "[[../note]]",
    "[[er/x/b]]",
    "![[x y]]",
    "[[İ]]",
    "![[note#Head]]",
    "[[Note.md|shown]]",
    "![img](a/note.png)",
    "[t](../b/note.md)",
    "[[./NOTE]]",
    "[[b]]",
];
const ALIASES: [&str; 5] = ["alpha", "Alpha", "beta", "note", "x y"];

fn random_content(rng: &mut Rng) -> String {
    let mut text = String::new();
    let aliases: Vec<&str> = (0..rng.below(3)).map(|_| rng.pick(&ALIASES)).collect();
    if !aliases.is_empty() {
        text.push_str(&format!("---\naliases: [{}]\n---\n", aliases.join(", ")));
    }
    for _ in 0..rng.below(5) {
        for _ in 0..1 + rng.below(2) {
            text.push_str(rng.pick(&LINKS));
            text.push(' ');
        }
        text.push('\n');
    }
    text
}

fn random_links_sequence(seed: u64, steps: usize) {
    let tmp = tmp_dir("link-deltas-seq");
    let root = tmp.path.as_path();
    let mut rng = Rng(seed);
    let mut idx = Index::default();
    for _ in 0..16 {
        let path = random_path(&mut rng);
        let body = random_content(&mut rng);
        save(&mut idx, root, &path, &body);
    }
    let mut pages = Pages::new(&idx);
    for step in 0..steps {
        let ctx = format!("seed {seed} step {step}");
        match rng.below(16) {
            0..=6 => {
                let path = random_path(&mut rng);
                let body = random_content(&mut rng);
                save(&mut idx, root, &path, &body);
            }
            7 => {
                // Same links, new text: only line text changes.
                let path = some_path(&mut rng, &idx);
                if idx.contains(&path) && !idx.is_dir(&path) {
                    let body = idx.files.get(&path).unwrap().note.lines.iter().map(|l| format!("{} more\n", l.text)).collect::<String>();
                    save(&mut idx, root, &path, &body);
                }
            }
            8..=10 => {
                let from = some_path(&mut rng, &idx);
                let to = if rng.below(2) == 0 { random_path(&mut rng) } else { some_path(&mut rng, &idx) };
                idx.relocate(&from, &to);
            }
            11..=12 => {
                let path = some_path(&mut rng, &idx);
                idx.remove_tree(&path);
            }
            _ => {
                let mut batch = idx.map_batch();
                for _ in 0..1 + rng.below(4) {
                    let from = some_path(&mut rng, batch.index);
                    match rng.below(3) {
                        0 => batch.relocate(&from, &random_path(&mut rng)),
                        1 => batch.remove_tree(&from),
                        _ => {
                            let body = random_content(&mut rng);
                            let path = random_path(&mut rng);
                            batch.index.upsert_note(root, &path, &body, Stamp::sized(body.len()));
                        }
                    }
                }
            }
        }
        pages.check(&idx, &ctx);
    }
    assert_eq!(pages.eager.fulls, 1, "seed {seed}: the eager page never needed a full reply");
}

#[test]
fn random_link_edits_match_a_full_walk_and_pages_patch_to_it() {
    for seed in [0x9E37_79B9_7F4A_7C15, 3, 0xC0FF_EE11, 99, 0x00DD_BA11] {
        random_links_sequence(seed, 250);
    }
}

/// A rescan replaces the index; the page keeps patching, with only the notes that differ.
#[test]
fn a_rescan_swap_continues_the_link_history() {
    use crate::vault::Vault;
    let dir = tmp_dir("link-deltas-rescan");
    fs::write(dir.path.join("a.md"), "[[b]] [[c]]\n").unwrap();
    fs::write(dir.path.join("b.md"), "[[a]]\n").unwrap();
    fs::write(dir.path.join("quiet.md"), "[[a]] [[b]]\n").unwrap();
    let mut vault = Vault::open(dir.path.clone()).unwrap();
    let mut page = Page::default();
    page.refresh(&vault.index);

    let token = vault.begin_rescan();
    fs::write(dir.path.join("c.md"), "[[gone]]\n").unwrap();
    let fresh = Index::scan(&vault.root);
    vault.write_note("b.md", "[[c]]\n").unwrap();
    let _ = vault.finish_rescan(&token, fresh);
    vault.index.assert_maps_match_rebuild();
    page.refresh(&vault.index);
    assert_eq!((page.fulls, page.deltas), (1, 1), "a rescan swap is still a delta");
    assert_eq!(changed(&page), ["a.md", "b.md", "c.md"]);
    page.holds(&vault.index, "after the swap");
    let scanned = Index::scan(&vault.root).unwrap();
    assert_eq!(vault.index.link_index(), scanned.link_index());
}

/// Cheap timing check at 20k notes: a save's link update costs far less than a full walk.
/// A ratio in the same run, so a loaded machine can't flake it.
#[test]
fn a_save_at_20k_notes_updates_links_far_faster_than_a_walk() {
    let tmp = tmp_dir("link-deltas-20k");
    let root = tmp.path.as_path();
    let notes = synthetic(20_000);
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut idx = Index::from_notes(&refs);
    let started = Instant::now();
    let walked = walked_link_index(&idx);
    let walk = started.elapsed();
    let mut page = Page::default();
    page.refresh(&idx);
    let saves = 50;
    let started = Instant::now();
    for (i, (path, _)) in notes.iter().enumerate().take(saves) {
        let body = format!("---\naliases: [alias{i}]\n---\n[[n{}]] [[f{}/n{}]] new\n", i + 7, i % 50, i + 9);
        save(&mut idx, root, path, &body);
        page.refresh(&idx);
    }
    let per_save = started.elapsed() / saves as u32;
    page.holds(&idx, "20k");
    assert_eq!(page.fulls, 1);
    assert_ne!(walked, idx.link_index());
    println!("link deltas at 20k (debug): walk {walk:?}, save plus delta {per_save:?}");
    assert!(per_save * 20 < walk, "a save plus its delta ({per_save:?}) vs a full walk ({walk:?})");
}

/// Notes at `f{0..49}/g{0..3}/n{i}.md`, each with one alias, two wikilinks, and a markdown link.
fn synthetic(n: usize) -> Vec<(String, String)> {
    (0..n)
        .map(|i| {
            (
                format!("f{}/g{}/n{i}.md", i % 50, i % 4),
                format!(
                    "---\naliases: [alias{i}]\n---\n[[n{}]] [[alias{}]] [md](../g{}/n{}.md)\n",
                    (i + 1) % n,
                    (i * 7) % n,
                    (i + 1) % 4,
                    (i + 4) % n
                ),
            )
        })
        .collect()
}

/// Review 1: many notes reading one key (`[[alpha]]`, an alias of one hub). Removing,
/// re-adding, or moving that alias re-resolves every linker. The work must stay linear in
/// their number: each linker's unchanged memberships stay put, and a changed one is a set
/// removal, not a scan or shift of a list as long as the vault. Checked as a ratio against a
/// full link rebuild of the same index in the same run, plus parity with a full walk.
#[test]
fn a_shared_alias_with_many_linkers_updates_in_linear_time() {
    let tmp = tmp_dir("link-deltas-fanout");
    let root = tmp.path.as_path();
    let n = 20_000;
    let mut notes: Vec<(String, String)> = (0..n)
        .map(|i| (format!("l/{i:05}.md"), format!("see [[alpha]] and [[alpha#Part]] here {i}\n")))
        .collect();
    notes.push(("hub.md".into(), "---\naliases: [alpha]\n---\n# Part\n".into()));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut idx = Index::from_notes(&refs);
    let started = Instant::now();
    idx.rebuild_links();
    let rebuild = started.elapsed();
    let mut page = Page::default();
    page.refresh(&idx);
    assert_eq!(idx.backlinks(&["hub.md".into()])["hub.md"].len(), 2 * n);

    type Step<'a> = (&'a str, Box<dyn Fn(&mut Index) + 'a>);
    let steps: [Step; 4] = [
        ("remove the alias", Box::new(|idx| save(idx, root, "hub.md", "# Part\n"))),
        ("add it back", Box::new(|idx| save(idx, root, "hub.md", "---\naliases: [alpha]\n---\n# Part\n"))),
        ("rename the hub", Box::new(|idx| idx.relocate("hub.md", "moved/hub2.md"))),
        ("delete the hub", Box::new(|idx| idx.remove_tree("moved/hub2.md"))),
    ];
    for (what, step) in steps {
        let started = Instant::now();
        step(&mut idx);
        let took = started.elapsed();
        println!("fanout {n}: {what} {took:?} (full link rebuild {rebuild:?})");
        assert!(took < rebuild * 3, "{what}: {took:?} vs a full link rebuild {rebuild:?}");
        page.refresh(&idx);
        assert_eq!(page.last.len(), n, "{what}: every linker's entry changed");
        page.holds(&idx, what);
        idx.assert_links_match_walk();
    }
    assert_eq!(page.fulls, 1, "every step was a delta");
}
