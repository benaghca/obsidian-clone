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
        let fresh: BTreeMap<Arc<str>, Arc<Resolved>> = self
            .files
            .iter()
            .filter(|(path, node)| has_links(path, node))
            .map(|(path, node)| (Arc::from(path.as_str()), Arc::new(resolve_note(&self.maps, path, &node.note.links))))
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

/// One random change: a save, a text-only save, a rename or move, a delete, or a batch of them.
fn random_change(rng: &mut Rng, idx: &mut Index, root: &Path) {
    match rng.below(16) {
        0..=6 => {
            let path = random_path(rng);
            let body = random_content(rng);
            save(idx, root, &path, &body);
        }
        7 => {
            // Same links, new text: only line text changes.
            let path = some_path(rng, idx);
            if idx.contains(&path) && !idx.is_dir(&path) {
                let body = idx.files.get(&path).unwrap().note.lines.iter().map(|l| format!("{} more\n", l.text)).collect::<String>();
                save(idx, root, &path, &body);
            }
        }
        8..=10 => {
            let from = some_path(rng, idx);
            let to = if rng.below(2) == 0 { random_path(rng) } else { some_path(rng, idx) };
            idx.relocate(&from, &to);
        }
        11..=12 => {
            let path = some_path(rng, idx);
            idx.remove_tree(&path);
        }
        _ => {
            let mut batch = idx.map_batch();
            for _ in 0..1 + rng.below(4) {
                let from = some_path(rng, batch.index);
                match rng.below(3) {
                    0 => batch.relocate(&from, &random_path(rng)),
                    1 => batch.remove_tree(&from),
                    _ => {
                        let body = random_content(rng);
                        let path = random_path(rng);
                        batch.index.upsert_note(root, &path, &body, Stamp::sized(body.len()));
                    }
                }
            }
        }
    }
}

/// One off-lock job (`link_jobs`) taken through its steps at once. Stale when a change
/// landed between its start and its publish.
fn run_job(mut job: link_jobs::LinkJob, idx: &mut Index) -> LinkSlice {
    job.ask();
    loop {
        match idx.answer(&mut job) {
            LinkSlice::More => {}
            LinkSlice::Done => break,
            LinkSlice::Stale => return LinkSlice::Stale,
        }
    }
    job.finish();
    loop {
        match idx.publish(&mut job) {
            LinkSlice::More => {}
            got => return got,
        }
    }
}

/// Settle the way the app does: off-lock jobs until none is left.
fn settle_by_jobs(idx: &mut Index) {
    while let Some(job) = idx.link_job() {
        assert_eq!(run_job(job, idx), LinkSlice::Done, "nothing changed meanwhile");
    }
}

/// `deferred`: every link update stays queued (as the app's large ones do) and is settled only
/// now and then, sometimes one partial step at a time, so queued work from several changes
/// coalesces and later changes land on a half-settled table. Review 3: settling is also done
/// by off-lock jobs in small steps, and some jobs are started before a change and published
/// after it (they must come back stale, leaving their notes queued).
/// Returns how many notes publishes left queued (they had changed meanwhile).
fn random_links_sequence(seed: u64, steps: usize, deferred: bool) -> usize {
    let tmp = tmp_dir("link-deltas-seq");
    let root = tmp.path.as_path();
    let mut rng = Rng(seed);
    let mut idx = Index::default();
    link_jobs::small_steps(deferred);
    link_jobs::take_skipped();
    if deferred {
        idx.defer_links_over(0);
    }
    for _ in 0..16 {
        let path = random_path(&mut rng);
        let body = random_content(&mut rng);
        save(&mut idx, root, &path, &body);
    }
    idx.settle_links_now();
    let mut pages = Pages::new(&idx);
    let mut stale = 0;
    for step in 0..steps {
        let ctx = format!("seed {seed} step {step}{}", if deferred { " (deferred)" } else { "" });
        // A job started before this change, published after it.
        let early = if deferred && rng.below(3) == 0 { idx.link_job() } else { None };
        let mark = idx.edit_mark();
        random_change(&mut rng, &mut idx, root);
        if let Some(job) = early {
            let moved = idx.edit_mark() != mark;
            let got = run_job(job, &mut idx);
            assert!(got == LinkSlice::Done || moved, "{ctx}: a job goes stale only after a change");
            stale += usize::from(got == LinkSlice::Stale);
        }
        if deferred {
            match rng.below(6) {
                0 => {
                    // One step of queued work, then more changes on top.
                    idx.settle_links_until(Instant::now());
                    continue;
                }
                1 => {
                    if let Some(job) = idx.link_job() {
                        run_job(job, &mut idx);
                    }
                    continue;
                }
                2 => continue,
                3 | 4 => settle_by_jobs(&mut idx),
                _ => idx.settle_links_now(),
            }
        }
        assert!(!idx.links_pending(), "{ctx}: settled");
        pages.check(&idx, &ctx);
    }
    idx.settle_links_now();
    pages.check(&idx, &format!("seed {seed}: the end"));
    link_jobs::small_steps(false);
    assert_eq!(pages.eager.fulls, 1, "seed {seed}: the eager page never needed a full reply");
    let skipped = link_jobs::take_skipped();
    if deferred {
        println!("seed {seed}: {stale} jobs stale (a rebuild between), {skipped} notes left queued by a publish");
    }
    skipped
}

/// Review 3: replies built in steps (`link_replies`) with changes and settling between the
/// steps equal the replies made at once, at the moment they finish.
fn random_reply_sequence(seed: u64, steps: usize) {
    let tmp = tmp_dir("link-replies-seq");
    let root = tmp.path.as_path();
    let mut rng = Rng(seed);
    let mut idx = Index::default();
    link_jobs::small_steps(true);
    idx.defer_links_over(0);
    idx.links.set_log_paths(96);
    for _ in 0..24 {
        let path = random_path(&mut rng);
        let body = random_content(&mut rng);
        save(&mut idx, root, &path, &body);
    }
    settle_by_jobs(&mut idx);
    let mut held: Vec<(u64, u64)> = Vec::new();
    let mut snapshots: BTreeMap<(u64, u64), LinkIndex> = BTreeMap::new();
    let mut links: Vec<(LinkReply, Option<(u64, u64)>)> = Vec::new();
    let mut backs: Vec<(BacklinkReply, Vec<String>)> = Vec::new();
    let (mut done_links, mut done_backs, mut deltas) = (0, 0, 0);
    for step in 0..steps {
        let ctx = format!("seed {seed} step {step}");
        match rng.below(5) {
            0 => random_change(&mut rng, &mut idx, root),
            1 | 2 => {
                if let Some(job) = idx.link_job() {
                    run_job(job, &mut idx);
                }
            }
            _ => {}
        }
        // Start replies: for the whole index, from a version a page holds, or for some targets.
        if rng.below(3) == 0 {
            let asked = match rng.below(4) {
                0 => None,
                1 => Some((999, 1)),
                _ => held.iter().rev().nth(rng.below(3)).copied(),
            };
            links.push((LinkReply::new(asked), asked));
        }
        if rng.below(4) == 0 {
            let mut targets: Vec<String> = (0..1 + rng.below(3)).map(|_| some_path(&mut rng, &idx)).collect();
            targets.push("missing.md".into());
            backs.push((BacklinkReply::new(&targets), targets));
        }
        // Step each reply once; settle when one asks.
        let mut i = 0;
        while i < links.len() {
            match links[i].0.step(&idx) {
                ReplyStep::More => i += 1,
                ReplyStep::Settle => {
                    settle_by_jobs(&mut idx);
                    i += 1;
                }
                ReplyStep::Done => {
                    let (reply, asked) = links.remove(i);
                    let got = reply.into_changes();
                    let now = idx.links.changes(asked);
                    let fresh = idx.link_index();
                    match (&got.full, &now.full) {
                        // A reply that began while the log still reached the page's version
                        // stays a delta after the log moves on: it already holds those paths.
                        (None, Some(_)) => {
                            let mut page = snapshots[&asked.unwrap()].clone();
                            for (path, entry) in &got.changed {
                                set(&mut page.outgoing, path, entry.outgoing.clone());
                                set(&mut page.markdown, path, entry.markdown.clone());
                                set(&mut page.unresolved, path, entry.unresolved.clone());
                            }
                            assert_eq!((got.id, got.version), (now.id, now.version), "{ctx}");
                            assert_eq!(page, fresh, "{ctx}: a stepped delta from {asked:?} patches to the table");
                        }
                        _ => assert_eq!(got, now, "{ctx}: a stepped reply from {asked:?}"),
                    }
                    deltas += usize::from(got.since.is_some());
                    held.push((got.id, got.version));
                    snapshots.insert((got.id, got.version), fresh);
                    done_links += 1;
                }
            }
        }
        let mut i = 0;
        while i < backs.len() {
            match backs[i].0.step(&idx) {
                ReplyStep::More => i += 1,
                ReplyStep::Settle => {
                    settle_by_jobs(&mut idx);
                    i += 1;
                }
                ReplyStep::Done => {
                    let (reply, targets) = backs.remove(i);
                    assert_eq!(reply.finish(), walked_backlinks(&idx, &targets), "{ctx}: stepped backlinks of {targets:?}");
                    done_backs += 1;
                }
            }
        }
    }
    link_jobs::small_steps(false);
    println!("seed {seed}: {done_links} link replies ({deltas} deltas), {done_backs} backlink replies");
    assert!(done_links > 20 && deltas > 10 && done_backs > 10, "seed {seed}: replies finished");
}

#[test]
fn stepped_replies_equal_replies_made_at_once() {
    for seed in [5, 0xBEEF, 0x1234_5678, 77] {
        random_reply_sequence(seed, 400);
    }
}

#[test]
fn random_link_edits_match_a_full_walk_and_pages_patch_to_it() {
    for seed in [0x9E37_79B9_7F4A_7C15, 3, 0xC0FF_EE11, 99, 0x00DD_BA11] {
        random_links_sequence(seed, 250, false);
    }
}

/// Review 2: the same edits with every link update queued and settled later, in pieces.
#[test]
fn deferred_link_updates_settle_to_a_full_walk() {
    // Which notes a job takes follows hash order, so how often one changed under its publish
    // varies from run to run (one seed sees 0 or 1); across the seeds it is several.
    let skipped: usize = [7, 0xFEED, 0x5EED_1234, 42].into_iter().map(|seed| random_links_sequence(seed, 250, true)).sum();
    assert!(skipped >= 4, "some published jobs held notes that changed meanwhile ({skipped})");
}

/// Review 3: a name with many files keeps its `pick` up to date (`NamePicks`). After every
/// add or remove it equals the plain scan from any folder, and the maps equal a rebuild.
#[test]
fn kept_name_picks_equal_the_scan() {
    let tmp = tmp_dir("name-picks");
    let root = tmp.path.as_path();
    let mut rng = Rng(0xA11CE);
    let dirs = ["", "a", "a/b", "b", "c/d", "e", "f", "g"];
    let names = ["README.md", "README.png", "readme.md", ".md", "README.MD", "x/README.md", "readme"];
    let mut idx = Index::default();
    let mut live: Vec<String> = Vec::new();
    for round in 0..600 {
        let dir = rng.pick(&dirs);
        let name = rng.pick(&names);
        let path = if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") };
        // Mostly adds until the name is long, then a mix, so the picks are made, kept, and dropped.
        if live.contains(&path) && (live.len() > 24 || rng.below(3) == 0) {
            idx.remove_tree(&path);
            live.retain(|p| *p != path);
        } else {
            save(&mut idx, root, &path, "text\n");
            live.push(path);
        }
        for from_dir in dirs.iter().chain(["z", "a/b/c"].iter()) {
            let from = if from_dir.is_empty() { "src.md".to_string() } else { format!("{from_dir}/src.md") };
            for key in ["readme", ".md"] {
                let scan = idx.maps.names(key).and_then(|cands| super::pick(cands, &from));
                assert_eq!(idx.maps.name_pick(key, &from), scan, "round {round} key {key} from {from}");
            }
        }
        assert_eq!(idx.maps, super::name_maps::NameMaps::build(&idx.files), "round {round}: maps vs a rebuild");
    }
}

/// Review 2: many readers of a key with many owners (`[[README]]`). The name keeps its picks
/// (review 3), so a full rebuild is linear, far under the per-link scan.
#[test]
fn many_readers_of_an_ambiguous_name_resolve_without_a_scan_each() {
    let mut notes: Vec<(String, String)> = (0..1500).map(|i| (format!("r{i:04}/README.md"), "readme\n".to_string())).collect();
    notes.extend((0..3000).map(|i| (format!("s{:04}/note{i}.md", i % 1500), "see [[README]]\n".to_string())));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut idx = Index::from_notes(&refs);
    // What each link cost before: a scan of every README.
    let started = Instant::now();
    let cands = idx.maps.names("readme").unwrap();
    let scanned = notes.iter().filter(|(_, c)| c.contains("[[README]]")).filter(|(p, _)| super::pick(cands, p).is_some()).count();
    let walk = started.elapsed();
    assert_eq!(scanned, 3000);
    let walked = walked_link_index(&idx);
    let started = Instant::now();
    idx.rebuild_links();
    let rebuild = started.elapsed();
    assert_eq!(idx.link_index(), walked);
    println!("3000 [[README]] links over 1500 READMEs (debug): a scan per link {walk:?}, rebuild {rebuild:?}");
    assert!(rebuild * 5 < walk, "rebuild {rebuild:?} vs a scan per link {walk:?}");
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

/// Review 3: a note with many distinct links (past `Firsts::LONG`, where repeats are found
/// through a map instead of a scan) resolves as the walk does: first-seen order, no repeats,
/// and unresolved names folded by ASCII case only.
#[test]
fn a_note_with_many_distinct_links_resolves_like_a_walk() {
    let mut body = String::new();
    for i in 0..60 {
        body.push_str(&format!("[[t{i}]] [[Gone{i}]] [m](t{i}.md) [x](Lost{i}.md)\n"));
    }
    // Repeats after the lists are long: the same targets, and the missing names in other ASCII
    // cases (repeats), and in a non-ASCII case (not repeats).
    for i in (0..60).rev() {
        body.push_str(&format!("[[T{i}]] [[gone{i}]] [[GONE{i}]] [m](t{i}.md) [x](lost{i}.md) [[İ{i}]] [[i̇{i}]]\n"));
    }
    let mut notes: Vec<(String, String)> = (0..60).map(|i| (format!("t{i}.md"), "x\n".to_string())).collect();
    notes.push(("many.md".into(), body));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let idx = Index::from_notes(&refs);
    assert_eq!(idx.link_index(), walked_link_index(&idx));
    let entry = &idx.links.notes()["many.md"].entry;
    assert_eq!(entry.outgoing.len(), 60);
    assert_eq!(entry.markdown.len(), 60);
    // Gone0..59 and Lost0..59, then İ59..İ0 and i̇59..i̇0 (case folding is ASCII only).
    assert_eq!(entry.unresolved.len(), 60 + 60 + 60 + 60);
    assert_eq!(entry.unresolved[0], "Gone0");
    assert_eq!(entry.unresolved[1], "Lost0");
    idx.assert_maps_match_rebuild();
}

/// Drive a `backlinks` reply on `idx` to its end, settling by jobs when it asks.
fn finish_backlinks(mut reply: BacklinkReply, idx: &mut Index) -> BTreeMap<String, Vec<Backlink>> {
    loop {
        match reply.step(idx) {
            ReplyStep::More => {}
            ReplyStep::Settle => settle_by_jobs(idx),
            ReplyStep::Done => return reply.finish(),
        }
    }
}

/// Review 4: an alias moving between two targets a note links to anyway leaves the note's
/// entry (`[A, B]`) and the table's version alone, but moves one line from A to B. A reply
/// that copied the note for A before the move and for B after it lists that line once, under
/// B, as a full walk does. A note copied before it stopped linking is dropped.
#[test]
fn a_backlink_reply_across_an_alias_move_lists_each_line_once() {
    let tmp = tmp_dir("backlinks-alias-move");
    let root = tmp.path.as_path();
    link_jobs::small_steps(true);
    let mut idx = Index::from_notes(&[
        ("A.md", "---\naliases: [X]\n---\na\n"),
        ("B.md", "b\n"),
        ("P.md", "[[A]]\n"),
        ("S.md", "[[A]]\n[[B]]\n[[X]]\n"),
    ]);
    let targets: Vec<String> = vec!["A.md".into(), "B.md".into()];
    let before = idx.backlinks(&targets);
    let lines = |found: &BTreeMap<String, Vec<Backlink>>, t: &str| -> Vec<(String, u32)> {
        found.get(t).map(|hits| hits.iter().map(|b| (b.from.clone(), b.line)).collect()).unwrap_or_default()
    };
    assert_eq!(lines(&before, "A.md").len(), 3, "P, and S twice (its alias line too)");
    let mut reply = BacklinkReply::new(&targets);
    assert_eq!(reply.step(&idx), ReplyStep::More, "the start");
    assert_eq!(reply.step(&idx), ReplyStep::More, "P and S, for A");
    let version = idx.links.version();
    // B takes the alias too (X stays with A, or goes to B: S links to both either way), then A
    // gives it up.
    save(&mut idx, root, "B.md", "---\naliases: [X]\n---\nb\n");
    save(&mut idx, root, "A.md", "a\n");
    assert_eq!(idx.links.version(), version, "no entry changed: S still links to A and B");
    // And P, copied for A, stops linking anywhere.
    save(&mut idx, root, "P.md", "no links now\n");
    let got = finish_backlinks(reply, &mut idx);
    link_jobs::small_steps(false);
    assert_eq!(got, walked_backlinks(&idx, &targets));
    let s_lines = |t: &str| lines(&got, t).into_iter().filter(|(from, _)| from == "S.md").map(|(_, line)| line).collect::<Vec<_>>();
    let (a, b) = (s_lines("A.md"), s_lines("B.md"));
    assert_eq!(a.len() + b.len(), 3, "each of S's lines once: {a:?} {b:?}");
    assert_eq!((a.len(), b.len()), (1, 2), "the alias line moved to B");
    assert!(lines(&got, "A.md").iter().all(|(from, _)| from == "S.md"), "P is gone");
}

/// Review 4: a reply in steps across a rescan's swap (a fresh index, whose edits it cannot
/// read) starts over, in steps, and ends equal to the new index.
#[test]
fn a_backlink_reply_across_a_rescan_swap_starts_over() {
    link_jobs::small_steps(true);
    let old = Index::from_notes(&[("t.md", "t\n"), ("s.md", "[[t]]\n"), ("u.md", "[[t]]\n"), ("w.md", "[[t]]\n")]);
    let targets: Vec<String> = vec!["t.md".into()];
    let mut reply = BacklinkReply::new(&targets);
    assert_eq!(reply.step(&old), ReplyStep::More);
    assert_eq!(reply.step(&old), ReplyStep::More, "s and u copied");
    let mut fresh = Index::from_notes(&[("t.md", "t\n"), ("s.md", "moved down\n[[t]]\n"), ("v.md", "[[t]]\n")]);
    let got = finish_backlinks(reply, &mut fresh);
    link_jobs::small_steps(false);
    assert_eq!(got, walked_backlinks(&fresh, &targets));
    assert_eq!(got["t.md"].iter().map(|b| b.from.as_str()).collect::<Vec<_>>(), ["s.md", "v.md"]);
}

/// Review 4: a note with many links goes in over several write-lock holds (its new reverse-map
/// memberships first, then its entry), and its old memberships come out in steps after.
/// Saves elsewhere between holds leave the publish valid; an edit to the note itself drops
/// what it had added. After each stage the table equals a full walk.
/// Review 5: a long note's publish reads the edits made since its job began a few at a time
/// (small steps: two a hold) and looks each up in the job's own maps, so a hold never walks the
/// note's keys. Saves that touch nothing it read leave it valid however many there are; a key
/// it asked about gaining an owner midway, after its additions began, keeps it queued.
#[test]
fn a_long_note_reads_new_edits_in_steps_and_still_sees_a_key_it_asked_about() {
    let tmp = tmp_dir("link-long-note-edits");
    let root = tmp.path.as_path();
    let mut notes: Vec<(String, String)> = (0..240).map(|j| (format!("t/{j}.md"), "x\n".to_string())).collect();
    notes.push(("other.md".into(), "o\n".into()));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut idx = Index::from_notes(&refs);
    idx.defer_links_over(0);
    link_jobs::small_steps(true);
    let long: String = (0..120).map(|j| format!("[[t/{j}]] [m](t/{}.md) [[gone{j}]]\n", (j * 7) % 240)).collect();
    let publish = |idx: &mut Index, between: &mut dyn FnMut(&mut Index, usize)| -> (LinkSlice, usize) {
        let mut job = idx.link_job().expect("the note is queued");
        job.ask();
        while idx.answer(&mut job) == LinkSlice::More {}
        job.finish();
        let mut calls = 0;
        loop {
            calls += 1;
            match idx.publish(&mut job) {
                LinkSlice::More => between(idx, calls),
                got => return (got, calls),
            }
        }
    };

    // Ten unrelated saves between some holds (new notes too: key edits nobody here asked about).
    save(&mut idx, root, "long.md", &long);
    link_jobs::take_most_edits();
    let (got, _) = publish(&mut idx, &mut |idx, i| {
        if i % 10 == 0 && i <= 50 {
            for k in 0..10 {
                save(idx, root, &format!("new/{i}-{k}.md"), "n\n");
                save(idx, root, "other.md", &format!("o {i} {k}\n"));
            }
        }
    });
    assert_eq!(got, LinkSlice::Done);
    assert_eq!(link_jobs::take_skipped(), 0, "nothing the note read changed");
    assert_eq!(link_jobs::take_most_edits(), 2, "each hold read at most its two edits");
    assert!(!idx.links_pending());
    idx.assert_maps_match_rebuild();

    // Midway through its additions, `gone7` (a key it asked about) gains an owner, behind 300
    // other saves.
    let moved: String = long.replace("[[t/", "[[t/1");
    save(&mut idx, root, "long.md", &moved);
    let (got, _) = publish(&mut idx, &mut |idx, i| {
        if i == 40 {
            // More edits ahead of it than the rest of the publish has holds: it must read them
            // all (two a hold) before it puts the entry in.
            for k in 0..300 {
                save(idx, root, "other.md", &format!("before {k}\n"));
            }
            save(idx, root, "gone7.md", "now here\n");
            for k in 0..9 {
                save(idx, root, "other.md", &format!("after {k}\n"));
            }
        }
    });
    assert_eq!(got, LinkSlice::Done);
    assert_eq!(link_jobs::take_skipped(), 1, "the note read gone7");
    assert!(idx.links_pending(), "it stays queued");
    settle_by_jobs(&mut idx);
    link_jobs::small_steps(false);
    assert!(!idx.links.has_cleanup());
    idx.assert_maps_match_rebuild();
    assert!(idx.link_index().outgoing["long.md"].iter().any(|t| t == "gone7.md"));
}

#[test]
fn a_long_note_goes_in_over_several_holds_and_comes_out_in_steps() {
    let tmp = tmp_dir("link-long-note");
    let root = tmp.path.as_path();
    let mut notes: Vec<(String, String)> = (0..240).map(|j| (format!("t/{j}.md"), "x\n".to_string())).collect();
    notes.push(("hub.md".into(), "---\naliases: [alpha]\n---\n".into()));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut idx = Index::from_notes(&refs);
    idx.defer_links_over(0);
    link_jobs::small_steps(true);
    let long = |shift: usize| -> String { (0..120).map(|j| format!("[[t/{}]] [m](t/{}.md) [[alpha]] [[gone{}]]\n", j + shift, (j * 7 + shift) % 240, j + shift)).collect() };
    let publish = |idx: &mut Index, root: &Path, between: &mut dyn FnMut(&mut Index, &Path, usize)| -> (LinkSlice, usize) {
        let mut job = idx.link_job().expect("the note is queued");
        job.ask();
        while idx.answer(&mut job) == LinkSlice::More {}
        job.finish();
        let mut calls = 0;
        loop {
            calls += 1;
            match idx.publish(&mut job) {
                LinkSlice::More => between(idx, root, calls),
                got => return (got, calls),
            }
        }
    };

    // A new long note: many holds, with typing elsewhere between them.
    save(&mut idx, root, "long.md", &long(0));
    let (got, calls) = publish(&mut idx, root, &mut |idx, root, i| save(idx, root, "other.md", &format!("typing {i}\n")));
    assert_eq!(got, LinkSlice::Done);
    assert!(calls > 100, "{calls} holds");
    assert!(!idx.links_pending());
    idx.assert_maps_match_rebuild();

    // Half its targets change; an edit to the note midway drops the job's additions.
    save(&mut idx, root, "long.md", &long(60));
    let (got, _) = publish(&mut idx, root, &mut |idx, root, i| {
        if i == 3 {
            save(idx, root, "long.md", &long(30));
        }
    });
    assert_eq!(got, LinkSlice::Done);
    assert!(idx.links_pending(), "the edited note stays queued");
    assert!(idx.links.has_cleanup(), "what it added is left to clear");
    settle_by_jobs(&mut idx);
    assert!(!idx.links.has_cleanup());
    idx.assert_maps_match_rebuild();

    // Deleted while settling inline: its memberships are left to clear, in steps.
    idx.defer_links = None;
    idx.remove_tree("long.md");
    assert!(!idx.links_pending() && idx.links.has_cleanup(), "the entry is gone, its memberships queued");
    idx.assert_maps_match_rebuild();
    let mut jobs = 0;
    while let Some(job) = idx.link_job() {
        jobs += 1;
        assert_eq!(run_job(job, &mut idx), LinkSlice::Done);
    }
    link_jobs::small_steps(false);
    assert!(jobs > 100, "{jobs} cleanup steps");
    assert!(!idx.links.has_cleanup());
    idx.assert_maps_match_rebuild();
}

/// One job, with `between` run after each of its holds (answer and publish steps).
fn run_job_with(mut job: link_jobs::LinkJob, idx: &mut Index, between: &mut dyn FnMut(&mut Index)) -> LinkSlice {
    job.ask();
    loop {
        let got = idx.answer(&mut job);
        between(idx);
        match got {
            LinkSlice::More => {}
            LinkSlice::Done => break,
            LinkSlice::Stale => return LinkSlice::Stale,
        }
    }
    job.finish();
    loop {
        let got = idx.publish(&mut job);
        between(idx);
        if got != LinkSlice::More {
            return got;
        }
    }
}

/// Review 6: with link work deferred (as in the app), a bulk change (a folder of more than
/// `BULK_PATHS` paths moved or deleted) rebuilds the name maps but re-resolves no note under
/// the lock: every note is queued, and jobs settle the table to a full walk, with saves (one
/// giving a key many notes read a new owner) between their holds. A long note's staged publish
/// cut off by the rebuild takes back what it had added.
#[test]
fn a_bulk_change_queues_every_note_for_jobs_and_settles_to_a_full_walk() {
    let tmp = tmp_dir("link-bulk-deferred");
    let root = tmp.path.as_path();
    let mut notes: Vec<(String, String)> = (0..300).map(|j| (format!("f/n{j}.md"), format!("[[n{}]] [[f/n{}]]\n", (j + 1) % 300, (j + 7) % 300))).collect();
    notes.extend((0..200).map(|j| (format!("l/{j}.md"), format!("[[n{j}]] [p](f/n{j}.md) [[g/n{j}]] [[l/{}]]\n", (j + 1) % 200))));
    notes.push(("other.md".into(), "o\n".into()));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut idx = Index::from_notes(&refs);
    idx.defer_links_over(0);
    link_jobs::small_steps(true);

    // A long note's publish, staged: some of its new memberships are in when the rebuild comes.
    let long: String = (0..60).map(|j| format!("[[n{j}]] [[gone{j}]]\n")).collect();
    save(&mut idx, root, "long.md", &long);
    let mut job = idx.link_job().expect("the note is queued");
    job.ask();
    while idx.answer(&mut job) == LinkSlice::More {}
    job.finish();
    assert_eq!(idx.publish(&mut job), LinkSlice::More);
    assert!(idx.links.is_staging("long.md"), "the publish is staged");

    take_rebuild_maps_calls();
    let queued = idx.links.pending().count();
    link_table::take_swept();
    idx.relocate("f", "g");
    assert_eq!(take_rebuild_maps_calls(), 1, "a folder move rebuilds the maps");
    assert!(idx.links_pending(), "every note is queued");
    // Review 7: the write only marks the walk; no entry or file is looked at under it.
    assert_eq!(link_table::take_swept(), (0, 0), "the bulk write swept nothing");
    assert_eq!(idx.links.pending().count(), queued, "the bulk write queued no note itself");
    assert!(idx.links.shared("l/0.md").unwrap().has_target("f/n0.md"), "no note was resolved again under the lock");
    assert_eq!(idx.publish(&mut job), LinkSlice::Stale, "the rebuild drops the job");
    assert!(!idx.links.is_staging("long.md"), "what it had added is to be cleared");

    let (mut jobs, mut saves, mut peak) = (0, 0, 0);
    while let Some(job) = idx.link_job() {
        jobs += 1;
        peak = peak.max(idx.links.pending().count());
        assert!(link_table::take_swept().1 <= 2, "a step swept more than its budget");
        run_job_with(job, &mut idx, &mut |idx| {
            saves += 1;
            if saves % 7 == 0 {
                save(idx, root, "other.md", &format!("o {saves}\n"));
            }
            if saves == 300 {
                // A root note now owns `n3`, which three notes read, mid-settle.
                save(idx, root, "n3.md", "root\n");
            }
        });
        if jobs == 200 {
            // A second bulk change while the first is settling, once its walk has passed
            // notes in l/ that read g/ (review 7: the walk starts over, or they keep g/).
            assert!(!idx.links.shared("l/0.md").unwrap().has_target("f/n0.md"), "the walk passed l/0");
            assert!(idx.links.shared("l/0.md").unwrap().has_target("g/n0.md"));
            take_rebuild_maps_calls();
            idx.remove_tree("g");
            assert_eq!(take_rebuild_maps_calls(), 1, "a folder delete past `BULK_PATHS` rebuilds the maps");
        }
    }
    assert!(jobs > 200, "the settle took many jobs ({jobs})");
    // A job takes 2 here; the walk adds while fewer than 2 are queued (a woken key adds 2).
    assert!(peak <= 8, "the queue grew to {peak} notes");
    assert!(!idx.links_pending());
    idx.assert_maps_match_rebuild();
    assert!(!idx.links.has_cleanup());
    link_jobs::small_steps(false);
}

/// Review 6: a save behind many woken keys neither sums nor walks all of them. A frontmatter
/// edit wakes 6,000 aliases, one long note reading each. Each later save looks at no more of
/// them than twice the inline threshold. Then the note is deleted: one settle step resolves it
/// and the first job's cleanup clears some of its memberships, so that job's expansion meets
/// keys with no reader left; it still looks at no more keys than its budget.
#[test]
fn saves_and_jobs_behind_many_woken_keys_look_at_a_bounded_number_of_them() {
    let tmp = tmp_dir("link-many-woken");
    let root = tmp.path.as_path();
    let aliases: Vec<String> = (0..6_000).map(|j| format!("a{j}")).collect();
    let hub = format!("---\naliases: [{}]\n---\nhub\n", aliases.join(", "));
    let long: String = aliases.iter().map(|a| format!("[[{a}]]\n")).collect();
    let mut idx = Index::from_notes(&[("hub.md", hub.as_str()), ("long.md", long.as_str()), ("few.md", "[[a1]] [[a2]]\n"), ("other.md", "o\n")]);
    idx.set_defer_links(true);

    save(&mut idx, root, "hub.md", "hub\n");
    assert!(idx.links_pending(), "6,000 readers' worth of keys is left queued");
    // The estimate stops past the threshold; when it does not, the expansion it allows looks
    // at those keys once more.
    let bound = 2 * (INLINE_LINKS + 1);
    link_table::take_keys_seen();
    for i in 0..5 {
        save(&mut idx, root, "other.md", &format!("o {i}\n"));
        let seen = link_table::take_keys_seen();
        assert!(seen <= bound, "a save looked at {seen} woken keys");
    }

    idx.remove_tree("long.md");
    idx.settle_links_until(Instant::now());
    assert!(!idx.links.contains("long.md"), "one settle step resolved the deleted note");
    assert!(idx.links.has_cleanup(), "its memberships are cleared in steps");
    let (mut jobs, mut most) = (0, 0);
    loop {
        link_table::take_keys_seen();
        let Some(job) = idx.link_job() else { break };
        most = most.max(link_table::take_keys_seen());
        jobs += 1;
        run_job_with(job, &mut idx, &mut |_| {});
        save(&mut idx, root, "other.md", &format!("o j{jobs}\n"));
        let seen = link_table::take_keys_seen();
        assert!(seen <= bound, "a save between jobs looked at {seen} woken keys");
    }
    println!("{jobs} jobs; the most keys one expansion looked at: {most}");
    assert!(most <= 4_096, "a job's expansion (`EXPAND_STEP`) looked at {most} keys");
    assert!(!idx.links_pending());
    idx.assert_maps_match_rebuild();
}

/// Review 7: a queue drained from vault size down to a few notes costs a few notes to take
/// from. 200,000 notes are queued (as a round-6 bulk change did) and taken off but one; then
/// 2,000 single saves each queue a note and take the first two. A hash set kept its capacity,
/// and each take scanned the buckets the drain left empty (about 0.46 s here in debug); the
/// ordered set finds them at once.
#[test]
fn a_queue_drained_after_a_large_bulk_update_is_quick_to_take_from() {
    let mut table = LinkTable::default();
    let paths: Vec<String> = (0..200_000).map(|j| format!("l/{j:06}.md")).collect();
    for path in &paths {
        table.touch(path);
    }
    assert_eq!(table.take_some(paths.len() - 1).len(), paths.len() - 1);
    let started = Instant::now();
    for i in 0..2_000 {
        table.touch(&format!("s/{i}.md"));
        assert!(table.pending().next().is_some());
        assert!(!table.take_some(2).is_empty());
    }
    let took = started.elapsed();
    println!("2,000 takes from a drained queue (debug): {took:?}");
    assert!(took < std::time::Duration::from_millis(40), "2,000 takes from a drained queue took {took:?}");
}
