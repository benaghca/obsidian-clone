//! Disk events to the page's link copy, end to end (R2 P2b review 1).
//!
//! A vault under the temp directory takes outside changes through the watcher's own
//! `flush_changes` (rename, replacement, frontmatter alias edit, embed edit, delete, and a
//! rescan while the page holds an older version) and app saves through `write_note`. After
//! each settled step the page asks `link_changes` the way `api.linkIndex` does, through the
//! real page code (`src/links/linkDelta.ts`, run by node via `scripts/link-page.mjs`), with
//! the reply serialized as Tauri serializes it. Each step checks:
//!
//! - the page's three maps equal a fresh scan's `link_index`, key order included;
//! - the notes the page reports changed (`linkChanges`) are exactly those whose entries
//!   differ between this scan and the last one;
//! - every step after the first read was a delta, not the whole index;
//! - `backlinks` for every path equals a fresh scan's (order and excerpts);
//! - the name maps and link table equal a rebuild (`assert_maps_match_rebuild`).

use crate::fsutil::tmp_dir;
use crate::index::Index;
use crate::model::LinkIndex;
use crate::watch::flush_changes;
use crate::{lock, Inner};
use notify::event::{CreateKind, DataChange, ModifyKind, RemoveKind, RenameMode};
use notify::{Event, EventKind};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::RwLock;

struct Page {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    fulls: usize,
    deltas: usize,
}

impl Page {
    fn start() -> Page {
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/link-page.mjs");
        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("node runs the page's link reader (it is needed for the npm build anyway)");
        let stdin = child.stdin.take();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Page { child, stdin, stdout, fulls: 0, deltas: 0 }
    }

    fn send(&mut self, value: &Value) {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{value}").unwrap();
        stdin.flush().unwrap();
    }

    fn receive(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap_or_else(|e| panic!("page said {line:?}: {e}"))
    }

    /// One `api.linkIndex()`: answer the page's request from the vault, as the command does.
    fn read(&mut self, inner: &RwLock<Inner>) -> Value {
        self.send(&json!({ "read": true }));
        loop {
            let msg = self.receive();
            let Some(ask) = msg.get("ask") else { return msg };
            let since = ask[0].as_u64().zip(ask[1].as_u64());
            let reply = {
                let guard = lock(inner);
                guard.vault.as_ref().unwrap().index.link_changes(since)
            };
            if reply.full.is_some() {
                self.fulls += 1;
            } else {
                self.deltas += 1;
            }
            self.send(&serde_json::to_value(&reply).unwrap());
        }
    }
}

impl Drop for Page {
    fn drop(&mut self) {
        // "done", then end of input: either way the driver exits, even mid-read after a panic.
        if let Some(mut stdin) = self.stdin.take() {
            let _ = writeln!(stdin, "{}", json!({ "done": true }));
        }
        let _ = self.child.wait();
    }
}

fn event(kind: EventKind, paths: &[PathBuf]) -> Event {
    paths.iter().fold(Event::new(kind), |e, p| e.add_path(p.clone()))
}

/// Paths whose entries differ between two indexes.
fn differ(a: &LinkIndex, b: &LinkIndex) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for (x, y) in [(&a.outgoing, &b.outgoing), (&a.markdown, &b.markdown), (&a.unresolved, &b.unresolved)] {
        for path in x.keys().chain(y.keys()) {
            if x.get(path) != y.get(path) {
                out.insert(path.clone());
            }
        }
    }
    out
}

#[test]
fn outside_changes_reach_the_page_as_deltas_equal_to_a_fresh_scan() {
    let dir = tmp_dir("link-page");
    let root = dir.path.clone();
    let at = |rel: &str| root.join(rel);
    fs::create_dir_all(at("dir")).unwrap();
    fs::write(at("hub.md"), "---\naliases: [Alpha]\n---\n# Part\nhub body\n").unwrap();
    fs::write(at("a.md"), "see [[Alpha]] and [[hub#Part]]\n![[pic.png]]\n").unwrap();
    fs::write(at("b.md"), "[[a]] [md](hub.md) [[Nowhere]]\nalso [[Alpha|the hub]]\n").unwrap();
    fs::write(at("dir/c.md"), "[[a]] ![[hub]]\n[[../b]]\n").unwrap();
    fs::write(at("old.md"), "[[b]] [[Zed]]\n").unwrap();
    fs::write(at("pic.png"), [0x89, b'P', b'N', b'G']).unwrap();
    let inner = RwLock::new(Inner {
        config_dir: root.join(".grove"),
        vault: Some(crate::vault::Vault::open(root.clone()).unwrap()),
    });
    let mut page = Page::start();
    let mut last: Option<LinkIndex> = None;

    let mut settled = |page: &mut Page, what: &str| {
        let got = page.read(&inner);
        let fresh = Index::scan(&root).unwrap();
        let want = fresh.link_index();
        for (field, map) in [("outgoing", &want.outgoing), ("markdown", &want.markdown), ("unresolved", &want.unresolved)] {
            assert_eq!(got["fields"][field].as_str().unwrap(), serde_json::to_string(map).unwrap(), "{what}: page {field} vs a fresh scan");
        }
        match &last {
            None => assert!(got["touched"].is_null(), "{what}: the first read changes everything"),
            Some(before) => {
                let touched: BTreeSet<String> =
                    got["touched"].as_array().unwrap_or_else(|| panic!("{what}: touched unknown")).iter().map(|v| v.as_str().unwrap().to_string()).collect();
                assert_eq!(touched, differ(before, &want), "{what}: the notes the page reports changed");
            }
        }
        let guard = lock(&inner);
        let vault = guard.vault.as_ref().unwrap();
        vault.index.assert_maps_match_rebuild();
        let paths: Vec<String> = vault.list_files().into_iter().map(|e| e.path).chain(["Alpha".into(), "gone.md".into()]).collect();
        assert_eq!(vault.index.backlinks(&paths), fresh.backlinks(&paths), "{what}: backlinks (order and excerpts)");
        assert_eq!((page.fulls, page.deltas), (1, page.deltas), "{what}: only the first read is whole");
        last = Some(want);
    };
    let flush = |events: Vec<Event>| {
        flush_changes(&inner, &events, Index::scan);
    };

    settled(&mut page, "open");

    // An app save (the write command), then outside edits through the watcher.
    lock(&inner).vault.as_mut().unwrap().write_note("a.md", "see [[Alpha]] and [[hub#Part]]\n![[pic.png]] [[old]]\n").unwrap();
    settled(&mut page, "app save adds a link");

    fs::write(at("hub.md"), "---\naliases: [Beta]\n---\n# Part\nhub body, renamed alias\n").unwrap();
    flush(vec![event(EventKind::Modify(ModifyKind::Data(DataChange::Any)), &[at("hub.md")])]);
    settled(&mut page, "outside alias change");

    fs::write(at("a.md"), "see [[Beta]] and [[hub#Part]]\n![[hub#Part]] ![[dir/c]] [[old]]\n").unwrap();
    flush(vec![event(EventKind::Modify(ModifyKind::Data(DataChange::Any)), &[at("a.md")])]);
    settled(&mut page, "outside embed edit");

    fs::write(at("b.md"), "[[a]] [md](hub.md) [[Nowhere]]\nalso [[Alpha|the hub]] still prose\n").unwrap();
    flush(vec![event(EventKind::Modify(ModifyKind::Data(DataChange::Any)), &[at("b.md")])]);
    settled(&mut page, "outside prose edit");

    fs::create_dir_all(at("moved")).unwrap();
    fs::rename(at("dir/c.md"), at("moved/c2.md")).unwrap();
    flush(vec![
        event(EventKind::Create(CreateKind::Folder), &[at("moved")]),
        event(EventKind::Modify(ModifyKind::Name(RenameMode::Both)), &[at("dir/c.md"), at("moved/c2.md")]),
    ]);
    settled(&mut page, "outside rename into a new folder");

    fs::write(at("new.md"), "replaced: [[hub]] [[Beta]] [[moved/c2]]\n").unwrap();
    fs::rename(at("new.md"), at("old.md")).unwrap();
    flush(vec![
        event(EventKind::Create(CreateKind::File), &[at("new.md")]),
        event(EventKind::Modify(ModifyKind::Name(RenameMode::Both)), &[at("new.md"), at("old.md")]),
    ]);
    settled(&mut page, "outside replacement");

    fs::remove_file(at("b.md")).unwrap();
    flush(vec![event(EventKind::Remove(RemoveKind::File), &[at("b.md")])]);
    settled(&mut page, "outside delete");

    // A rescan while the page holds the previous version: new notes sort in by byte order.
    fs::create_dir_all(at("é")).unwrap();
    fs::write(at("é/日記.md"), "[[Beta]] [[a]] [[Zed]]\n").unwrap();
    fs::write(at("Zed.md"), "---\naliases: [Gamma]\n---\n[[é/日記]]\n").unwrap();
    flush(vec![Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)]);
    settled(&mut page, "rescan");
    assert_eq!(page.deltas, 8, "every read after the first was a delta");
}

/// Saves to `other.md` on another thread for as long as `work` runs (at least one), each timed
/// from asking for the lock to its return: how long a save queued behind `work` waits.
fn saves_during<T: Send>(inner: &RwLock<Inner>, work: impl FnOnce() -> T + Send) -> (std::time::Duration, Vec<std::time::Duration>, T) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    let busy = AtomicBool::new(true);
    std::thread::scope(|s| {
        let worker = s.spawn(|| {
            let started = Instant::now();
            let out = work();
            busy.store(false, Ordering::SeqCst);
            (started.elapsed(), out)
        });
        let saver = s.spawn(|| {
            let mut waits = Vec::new();
            let mut i = 0;
            while busy.load(Ordering::SeqCst) || waits.is_empty() {
                let started = Instant::now();
                crate::write_lock(inner).vault.as_mut().unwrap().write_note("other.md", &format!("typing here {i}\n")).unwrap();
                waits.push(started.elapsed());
                i += 1;
                std::thread::sleep(Duration::from_millis(1));
            }
            waits
        });
        let (took, out) = worker.join().unwrap();
        (took, saver.join().unwrap(), out)
    })
}

/// A vault under the temp directory with `files`, opened with the app's link deferral.
fn open_deferred(name: &str, files: impl IntoIterator<Item = (String, String)>) -> (crate::fsutil::Tmp, RwLock<Inner>) {
    let dir = tmp_dir(name);
    let root = dir.path.clone();
    for (path, body) in files {
        let at = root.join(&path);
        fs::create_dir_all(at.parent().unwrap()).unwrap();
        fs::write(at, body).unwrap();
    }
    fs::write(root.join("other.md"), "typing here\n").unwrap();
    let mut vault = crate::vault::Vault::open(root.clone()).unwrap();
    vault.index.set_defer_links(true);
    (dir, RwLock::new(Inner { config_dir: root.join(".grove"), vault: Some(vault) }))
}

/// A write that queues a large link update, then a link read (which settles it) while saves
/// keep coming. The write returns with the work queued; no save waits for more than a small
/// part of it; the read equals a fresh scan, and nothing is left queued.
fn queued_saves_stay_quick(what: &str, inner: &RwLock<Inner>, write: impl FnOnce(&mut crate::vault::Vault)) {
    use std::time::Instant;
    let started = Instant::now();
    write(crate::write_lock(inner).vault.as_mut().unwrap());
    let edit = started.elapsed();
    assert!(lock(inner).vault.as_ref().unwrap().index.links_pending(), "{what}: the work is queued");
    let (settle, saves, reply) = saves_during(inner, || crate::link_reads::link_changes(inner, None).unwrap());
    let worst = *saves.iter().max().unwrap();
    println!("{what} (debug): the write {edit:?}, read incl. settling {settle:?}, {} saves meanwhile, worst {worst:?}", saves.len());
    assert!(edit * 4 < settle, "{what}: the write ({edit:?}) left the work ({settle:?}) to the read");
    assert!(saves.len() >= 3, "{what}: saves ran while the read settled");
    assert!(worst * 4 < settle, "{what}: a save waited {worst:?} while the queue took {settle:?}");
    let guard = lock(inner);
    let vault = guard.vault.as_ref().unwrap();
    assert_eq!(reply.full.unwrap(), Index::scan(&vault.root).unwrap().link_index(), "{what}: the read saw a settled table");
    assert!(!vault.index.links_pending());
    vault.index.assert_maps_match_rebuild();
}

/// Review 2: a save queued behind a high-fanout alias edit is not held up by its link work.
///
/// 10,000 notes read the alias `alpha` of `hub.md`. With the app's deferral on, the save that
/// removes the alias returns without re-resolving them (review 3: without copying them either;
/// only the key is queued). A link read then resolves them off the lock while another thread
/// keeps saving.
#[test]
fn a_save_behind_a_high_fanout_alias_edit_waits_one_slice_at_most() {
    let files = (0..10_000)
        .map(|i| (format!("l/{i:05}.md"), format!("see [[alpha]] and [[alpha#Part]] {i}\n")))
        .chain([("hub.md".to_string(), "---\naliases: [alpha]\n---\n# Part\n".to_string())]);
    let (_dir, inner) = open_deferred("link-fanout-latency", files);
    queued_saves_stay_quick("shared alias, 10,000 readers", &inner, |v| v.write_note("hub.md", "# Part\n").unwrap());
}

/// Review 3: a key with many owners. 6,000 folders each hold a `README.md` and a note linking
/// `[[README]]`; a new `README.md` at the top wakes every reader, each picking among 6,001
/// candidates. The name keeps its picks, so no lookup builds anything under the lock.
#[test]
fn a_save_behind_a_new_file_of_a_name_with_many_owners_stays_quick() {
    let files = (0..6_000).flat_map(|i| {
        [
            (format!("r{i:04}/README.md"), "readme\n".to_string()),
            (format!("r{i:04}/n.md"), "see [[README]] and [[README#Top]]\n".to_string()),
        ]
    });
    let (_dir, inner) = open_deferred("link-owners-latency", files);
    queued_saves_stay_quick("6,000 READMEs, 6,000 readers", &inner, |v| v.write_note("README.md", "top\n").unwrap());
}

/// Review 3: link-heavy notes. 40 notes with 3,000 links each read the alias `alpha`. That is
/// under `INLINE_LINKS` notes but far over `INLINE_LINK_WORK` links, so the alias edit queues
/// them; a job takes one such note at a time and resolves it off the lock.
#[test]
fn a_save_behind_link_heavy_notes_stays_quick() {
    let heavy = |i: usize| (0..3_000).map(|j| format!("[[alpha]] [[t{i}-{j}]] [x](m{j}.md)\n")).collect::<String>();
    let files = (0..40)
        .map(move |i| (format!("h/{i:02}.md"), heavy(i)))
        .chain([("hub.md".to_string(), "---\naliases: [alpha]\n---\nbody\n".to_string())]);
    let (_dir, inner) = open_deferred("link-heavy-latency", files);
    queued_saves_stay_quick("40 notes of 3,000 links", &inner, |v| v.write_note("hub.md", "body\n").unwrap());
}

/// Review 3: a large reply. 20,000 notes with links, nothing queued: the whole `link_index` and
/// a large `backlinks` reply are copied a chunk at a time under the read lock and built off it,
/// so saves queued behind them wait for one chunk, not the whole copy.
#[test]
fn a_save_behind_a_large_reply_stays_quick() {
    let files = (0..20_000).map(|i| (format!("n/{i:05}.md"), format!("[[n/{:05}]] [[hub]] [[gone {i}]] [md](hub.md)\nline {i}\n", (i + 1) % 20_000)));
    let files = files.chain([("hub.md".to_string(), "hub\n".to_string())]);
    let (_dir, inner) = open_deferred("link-reply-latency", files);
    for read in ["link_index", "backlinks"] {
        let (took, saves, size) = saves_during(&inner, || match read {
            "link_index" => crate::link_reads::link_index(&inner).unwrap().outgoing.len(),
            _ => crate::link_reads::backlinks(&inner, &["hub.md".into()]).unwrap()["hub.md"].len(),
        });
        let worst = *saves.iter().max().unwrap();
        println!("{read} of 20,000 notes (debug): {took:?} for {size}, {} saves meanwhile, worst {worst:?}", saves.len());
        assert!(size >= 20_000, "{read}: a large reply");
        assert!(saves.len() >= 3, "{read}: saves ran while the reply was built");
        assert!(worst * 4 < took, "{read}: a save waited {worst:?} while the reply took {took:?}");
    }
    let root = lock(&inner).vault.as_ref().unwrap().root.clone();
    let fresh = Index::scan(&root).unwrap();
    assert_eq!(crate::link_reads::link_index(&inner).unwrap(), fresh.link_index());
    let paths: Vec<String> = fresh.paths().cloned().collect();
    assert_eq!(crate::link_reads::backlinks(&inner, &paths).unwrap(), fresh.backlinks(&paths));
}

/// Review 3: a save queued behind a rescan's finish, with a high-fanout alias edited during the
/// scan. The finish replays the edited note into the fresh index under the lock; with the live
/// index's deferral installed first, that queues the 10,000 readers instead of resolving them
/// (twice: once for the removal, once for the refresh). The queued work survives the swap and
/// the next read settles it, publishing the rest of the change to a page that holds the old
/// version as a delta.
#[test]
fn a_save_behind_a_rescan_finish_with_a_high_fanout_edit_stays_quick() {
    use std::time::{Duration, Instant};
    let files = (0..10_000)
        .map(|i| (format!("l/{i:05}.md"), format!("see [[alpha]] {i}\n")))
        .chain([("hub.md".to_string(), "---\naliases: [alpha]\n---\nhub\n".to_string())]);
    let (_dir, inner) = open_deferred("link-rescan-latency", files);
    let before = crate::link_reads::link_changes(&inner, None).unwrap();
    let finish = std::sync::Mutex::new(Duration::ZERO);
    let (flushed, saves, ()) = saves_during(&inner, || {
        let scanned = std::sync::Mutex::new(None);
        flush_changes(&inner, &[Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)], |root| {
            // An app save while the watcher scans without the lock, after the scan read the
            // hub: the alias goes, and the finish has to replay that into the fresh index.
            let fresh = Index::scan(root);
            crate::write_lock(&inner).vault.as_mut().unwrap().write_note("hub.md", "hub\n").unwrap();
            *scanned.lock().unwrap() = Some(Instant::now());
            fresh
        });
        *finish.lock().unwrap() = scanned.lock().unwrap().unwrap().elapsed();
    });
    let finish = *finish.lock().unwrap();
    assert!(lock(&inner).vault.as_ref().unwrap().index.links_pending(), "the replay queued the readers");
    let started = Instant::now();
    let after = crate::link_reads::link_changes(&inner, Some((before.id, before.version))).unwrap();
    let settle = started.elapsed();
    let worst = *saves.iter().max().unwrap();
    println!("rescan with a 10,000-reader alias edit (debug): flush {flushed:?}, finish {finish:?}, settle {settle:?}, {} saves meanwhile, worst {worst:?}", saves.len());
    assert!(finish * 4 < settle, "the finish ({finish:?}) left the re-resolve ({settle:?}) to the read");
    assert!(worst * 4 < settle, "a save waited {worst:?}; the re-resolve took {settle:?}");
    assert!(after.full.is_none(), "the page holding the old version gets a delta");
    assert_eq!(after.changed.len(), 10_000, "every reader's entry changed");
    let guard = lock(&inner);
    let vault = guard.vault.as_ref().unwrap();
    let fresh = Index::scan(&vault.root).unwrap();
    let mut page = before.full.unwrap();
    for (path, entry) in after.changed {
        for (list, map) in [(entry.outgoing, &mut page.outgoing), (entry.markdown, &mut page.markdown), (entry.unresolved, &mut page.unresolved)] {
            if list.is_empty() {
                map.remove(&path);
            } else {
                map.insert(path.clone(), list);
            }
        }
    }
    assert_eq!(page, fresh.link_index(), "the page patches to a fresh scan");
    assert!(!vault.index.links_pending());
    vault.index.assert_maps_match_rebuild();
}
