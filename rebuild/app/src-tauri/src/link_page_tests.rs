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
