//! Debounced vault watcher.
//!
//! Notify events sit for ~100ms of quiet (and at most ~400ms) so a burst becomes a few
//! `vault-changed` events. Temp files and `.obsidian` / `.git` / `.trash` / `.grove` / `.cinder` are dropped.
//! An event is dropped only when the file is still Grove's own last write (same mtime,
//! size, and file identity). Any other change is reported. Rename events carry `[from, to]`;
//! a move into `.trash` is reported as `remove`.

use crate::model::{push_change, ChangeKind, VaultChanged};
use crate::{lock, AppState, Inner};
use crate::index::Index;
use notify::event::{AccessKind, AccessMode, EventKind, ModifyKind, RenameMode};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const QUIET: Duration = Duration::from_millis(100);
const MAX_WAIT: Duration = Duration::from_millis(400);

pub enum WatchMsg {
    Watch(std::path::PathBuf),
    Event(Event),
}

pub fn run(
    app: AppHandle,
    tx: std::sync::mpsc::Sender<WatchMsg>,
    rx: std::sync::mpsc::Receiver<WatchMsg>,
) {
    let mut watcher: Option<RecommendedWatcher> = None;
    let mut batch: Vec<Event> = Vec::new();
    let mut started: Option<Instant> = None;
    loop {
        let msg = if batch.is_empty() {
            match rx.recv() {
                Ok(msg) => msg,
                Err(_) => return,
            }
        } else {
            // Flush after QUIET without events, or once the batch is MAX_WAIT old.
            let left = MAX_WAIT.saturating_sub(started.unwrap_or_else(Instant::now).elapsed());
            let next = if left.is_zero() {
                Err(RecvTimeoutError::Timeout)
            } else {
                rx.recv_timeout(QUIET.min(left))
            };
            match next {
                Ok(msg) => msg,
                Err(RecvTimeoutError::Timeout) => {
                    flush(&app, &batch);
                    batch.clear();
                    started = None;
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        };
        match msg {
            WatchMsg::Watch(path) => {
                batch.clear();
                started = None;
                match start_watcher(&path, tx.clone()) {
                    Ok(next) => watcher = Some(next),
                    Err(err) => {
                        watcher = None;
                        eprintln!("grove: file watch failed: {err}");
                    }
                }
            }
            WatchMsg::Event(event) => {
                if batch.is_empty() {
                    started = Some(Instant::now());
                }
                batch.push(event);
            }
        }
        // Dropping `watcher` unregisters the inotify watch, so it has to stay in scope.
        let _keep_watching = watcher.is_some();
    }
}

fn start_watcher(
    path: &Path,
    tx: std::sync::mpsc::Sender<WatchMsg>,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = tx.send(WatchMsg::Event(event));
            }
        },
        Config::default().with_follow_symlinks(false),
    )?;
    watcher.watch(path, RecursiveMode::Recursive)?;
    Ok(watcher)
}

fn flush(app: &AppHandle, events: &[Event]) {
    let state = app.state::<AppState>();
    let changes = flush_changes(&state.inner, events, Index::scan);
    for change in changes {
        if change.paths.is_empty() {
            continue;
        }
        let _ = app.emit("vault-changed", &change);
    }
}

/// `scan` is injectable so tests can write while the state lock is released.
/// Crate-visible so the headless smoke can run one flush without a watcher thread.
pub(crate) fn flush_changes(
    inner: &std::sync::RwLock<Inner>,
    events: &[Event],
    scan: impl FnOnce(&Path) -> Result<Index, String>,
) -> Vec<VaultChanged> {
    let (root, token) = {
        let mut inner = lock(inner);
        let Some(vault) = inner.vault.as_mut() else {
            return Vec::new();
        };
        if !events.iter().any(|event| event.need_rescan()) {
            let raw = coalesce(&vault.root, events, |path| vault.is_own_write(path));
            let changes = vault.normalize(raw);
            vault.apply(&changes);
            return changes;
        }
        (vault.root.clone(), vault.begin_rescan())
    };
    // The expensive full-vault disk read must not hold AppState.inner.
    let fresh = scan(&root);
    let mut inner = lock(inner);
    let Some(vault) = inner.vault.as_mut() else {
        return Vec::new();
    };
    let changes = vault.finish_rescan(&token, fresh);
    changes
}

/// What the events of one rename (one tracker) said: its two halves, or both ends at once.
#[derive(Default)]
struct RenamePart {
    from: Option<String>,
    to: Option<String>,
    both: Option<(Option<String>, Option<String>)>,
}

/// Group a burst of notify events into contract events.
///
/// `suppress` drops creates, modifies, and removes of a path that is still our own write.
/// A two-sided rename is kept: that is a real move, not the temp-file rename a save uses.
pub fn coalesce(
    root: &Path,
    events: &[Event],
    mut suppress: impl FnMut(&str) -> bool,
) -> Vec<VaultChanged> {
    let mut creates = BTreeSet::new();
    let mut modifies = BTreeSet::new();
    let mut removes = BTreeSet::new();
    let mut parts: HashMap<usize, RenamePart> = HashMap::new();
    let mut order: Vec<usize> = Vec::new();
    let mut bare: Vec<(Option<String>, Option<String>)> = Vec::new();

    for event in events {
        match event.kind {
            EventKind::Access(AccessKind::Close(AccessMode::Write)) => {
                modifies.extend(visible(root, event, true));
            }
            EventKind::Access(_) | EventKind::Any | EventKind::Other => {}
            EventKind::Create(_) => creates.extend(visible(root, event, false)),
            EventKind::Remove(_) => removes.extend(visible(root, event, false)),
            EventKind::Modify(ModifyKind::Name(mode)) => match mode {
                RenameMode::Both => {
                    let ends = rename_ends(root, event);
                    match event.attrs.tracker() {
                        Some(tracker) => part_of(&mut order, &mut parts, tracker).both = Some(ends),
                        None => bare.push(ends),
                    }
                }
                RenameMode::From | RenameMode::To => {
                    let path = visible(root, event, false).into_iter().next();
                    let is_from = mode == RenameMode::From;
                    if let Some(tracker) = event.attrs.tracker() {
                        let part = part_of(&mut order, &mut parts, tracker);
                        let end = if is_from { &mut part.from } else { &mut part.to };
                        if path.is_some() {
                            *end = path;
                        }
                    } else if let Some(path) = path {
                        let into = if is_from { &mut removes } else { &mut creates };
                        into.insert(path);
                    }
                }
                RenameMode::Any | RenameMode::Other => {
                    let paths = visible(root, event, false);
                    if paths.len() >= 2 {
                        bare.push((Some(paths[0].clone()), Some(paths[1].clone())));
                    } else {
                        modifies.extend(paths);
                    }
                }
            },
            EventKind::Modify(ModifyKind::Metadata(_)) => {}
            EventKind::Modify(_) => modifies.extend(visible(root, event, true)),
        }
    }

    let mut renames: Vec<(String, String)> = Vec::new();
    for (from, to) in bare {
        push_rename(&mut renames, &mut creates, &mut removes, from, to);
    }
    for tracker in order {
        let Some(part) = parts.remove(&tracker) else {
            continue;
        };
        let (from, to) = part.both.unwrap_or((part.from, part.to));
        push_rename(&mut renames, &mut creates, &mut removes, from, to);
    }

    for path in renames.iter().flat_map(|(from, to)| [from, to]) {
        creates.remove(path);
        removes.remove(path);
        modifies.remove(path);
    }
    let overlap: Vec<String> = creates.intersection(&removes).cloned().collect();
    for path in overlap {
        creates.remove(&path);
        removes.remove(&path);
        modifies.insert(path);
    }
    for path in creates.iter().chain(removes.iter()) {
        modifies.remove(path);
    }

    creates.retain(|path| !suppress(path));
    modifies.retain(|path| !suppress(path));
    removes.retain(|path| !suppress(path));

    let mut out = Vec::new();
    push_change(&mut out, ChangeKind::Remove, removes.into_iter().collect());
    for (from, to) in renames {
        out.push(VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec![from, to],
        });
    }
    push_change(&mut out, ChangeKind::Create, creates.into_iter().collect());
    push_change(&mut out, ChangeKind::Modify, modifies.into_iter().collect());
    out
}

/// The rename a tracker belongs to, noted in the order trackers were first seen.
fn part_of<'a>(order: &mut Vec<usize>, parts: &'a mut HashMap<usize, RenamePart>, tracker: usize) -> &'a mut RenamePart {
    parts.entry(tracker).or_insert_with(|| {
        order.push(tracker);
        RenamePart::default()
    })
}

fn push_rename(
    renames: &mut Vec<(String, String)>,
    creates: &mut BTreeSet<String>,
    removes: &mut BTreeSet<String>,
    from: Option<String>,
    to: Option<String>,
) {
    match (from, to) {
        (Some(from), Some(to)) if from != to => renames.push((from, to)),
        (Some(from), None) => {
            removes.insert(from);
        }
        (None, Some(to)) => {
            creates.insert(to);
        }
        _ => {}
    }
}

/// The event's paths in the vault, hidden ones left out. Content changes on a directory are the
/// parent folder's mtime moving (the child event is enough), so `files` leaves directories out.
fn visible(root: &Path, event: &Event, files: bool) -> Vec<String> {
    event
        .paths
        .iter()
        .filter(|path| !files || !path.is_dir())
        .filter_map(|path| crate::fsutil::rel_of(root, path))
        .collect()
}

fn rename_ends(root: &Path, event: &Event) -> (Option<String>, Option<String>) {
    let end = |i: usize| event.paths.get(i).and_then(|path| crate::fsutil::rel_of(root, path));
    (end(0), end(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fsutil::{tmp_dir, TEMP_MARK};
    use notify::event::{CreateKind, DataChange, RemoveKind};
    use std::fs;
    use std::path::PathBuf;

    fn at(root: &Path, rel: &str) -> PathBuf {
        root.join(rel)
    }

    fn kind(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        let mut event = Event::new(kind);
        for path in paths {
            event = event.add_path(path);
        }
        event
    }

    /// One contract event.
    fn one(kind: ChangeKind, paths: &[&str]) -> Vec<VaultChanged> {
        let paths = paths.iter().map(|p| p.to_string()).collect();
        vec![VaultChanged { kind, paths }]
    }

    fn rescanning() -> Vec<Event> {
        vec![Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)]
    }

    fn state(root: &Path) -> std::sync::RwLock<Inner> {
        std::sync::RwLock::new(Inner {
            config_dir: root.join(".grove"),
            vault: Some(crate::vault::Vault::open(root.to_path_buf()).unwrap()),
        })
    }

    #[test]
    fn rescan_keeps_app_mutations_even_after_own_write_suppression_expires() {
        let dir = tmp_dir("rescan-writes");
        for path in ["saved.md", "moved.md", "removed.md"] {
            fs::write(dir.path.join(path), "old").unwrap();
        }
        let inner = state(&dir.path);
        // This hook runs with a stale scan in hand, at the worst point for a write.
        // Acquiring the mutex here also proves that the full scan isn't under it.
        let changes = flush_changes(&inner, &rescanning(), |root| {
            let fresh = Index::scan(root)?;
            let mut guard = inner.try_write().expect("scan must not hold the state lock");
            let vault = guard.vault.as_mut().unwrap();
            vault.write_note("saved.md", "---\nstatus: new\n---\n[[created]]\nlatest").unwrap();
            vault.write_note("new-parent/own.md", "latest").unwrap();
            vault.create_note("created.md", "latest").unwrap();
            vault.create_folder("empty").unwrap();
            vault.write_file_bytes("image.png", b"png").unwrap();
            vault.rename_path("moved.md", "folder/moved.md").unwrap();
            vault.delete_path("removed.md", true).unwrap();
            // Suppression follows the bytes we wrote, not a timer, so it is still
            // ours after a long scan. The journal does not depend on it.
            assert!(vault.is_own_write("saved.md"));
            // An unrelated external change still generates an event after the swap.
            fs::write(root.join("external.md"), "external").unwrap();
            let mut fresh = fresh;
            fresh.refresh_path(root, "external.md");
            Ok(fresh)
        });
        assert_eq!(changes, one(ChangeKind::Create, &["external.md"]));
        let guard = lock(&inner);
        let vault = guard.vault.as_ref().unwrap();
        for path in ["saved.md", "new-parent/own.md", "created.md", "empty", "image.png", "folder/moved.md"] {
            assert!(vault.index.contains(path), "lost {path}");
        }
        for path in ["moved.md", "removed.md"] {
            assert!(!vault.index.contains(path), "resurrected {path}");
        }
        assert_eq!(vault.index.search("latest", 10).len(), 3);
        assert!(vault.index.frontmatter(None)["saved.md"].contains("status: new"));
        assert_eq!(vault.index.link_index().outgoing["saved.md"], vec!["created.md"]);
    }

    #[test]
    fn rescan_does_not_replace_a_reopened_vault_even_at_the_same_root() {
        let dir = tmp_dir("rescan-reopen");
        fs::write(dir.path.join("saved.md"), "old").unwrap();
        let inner = state(&dir.path);
        let changes = flush_changes(&inner, &rescanning(), |root| {
            let fresh = Index::scan(root)?;
            fs::write(root.join("saved.md"), "new").unwrap();
            lock(&inner).vault = Some(crate::vault::Vault::open(root.to_path_buf())?);
            Ok(fresh)
        });
        assert!(changes.is_empty());
        assert_eq!(lock(&inner).vault.as_ref().unwrap().index.search("new", 10).len(), 1);
    }

    #[test]
    fn failed_rescan_keeps_the_live_index_and_allows_the_next_rescan() {
        let dir = tmp_dir("rescan-failed");
        let inner = state(&dir.path);
        assert!(flush_changes(&inner, &rescanning(), |_| {
            lock(&inner).vault.as_mut().unwrap().write_note("saved.md", "latest")?;
            Err("injected scan failure".into())
        }).is_empty());
        assert_eq!(lock(&inner).vault.as_ref().unwrap().index.search("latest", 10).len(), 1);
        assert!(flush_changes(&inner, &rescanning(), Index::scan).is_empty());
    }

    #[test]
    fn groups_and_suppresses_our_own_writes() {
        let root = Path::new("/vault");
        let modify = kind(
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            vec![at(root, "a.md")],
        );
        let out = coalesce(root, &[modify.clone()], |_| false);
        assert_eq!(out, one(ChangeKind::Modify, &["a.md"]));
        assert!(coalesce(root, &[modify], |path| path == "a.md").is_empty());

        let temp = kind(
            EventKind::Create(CreateKind::File),
            vec![at(root, &format!(".a.md.1{TEMP_MARK}"))],
        );
        let hidden = kind(
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            vec![
                at(root, ".git/config"),
                at(root, ".obsidian/app.json"),
                at(root, ".trash/old.md"),
                at(root, ".grove/app.json"),
                at(root, ".cinder/settings.json"),
                at(root, ".cinder/README.md"),
            ],
        );
        assert!(coalesce(root, &[temp, hidden], |_| false).is_empty());

        let open = kind(
            EventKind::Access(AccessKind::Open(AccessMode::Read)),
            vec![at(root, "a.md")],
        );
        assert!(coalesce(root, &[open], |_| false).is_empty());
    }

    #[test]
    fn rename_pairs_once_and_trash_is_a_remove() {
        let root = Path::new("/vault");
        let mut from = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::From)),
            vec![at(root, "a.md")],
        );
        from = from.set_tracker(7);
        let mut to = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            vec![at(root, "b.md")],
        );
        to = to.set_tracker(7);
        let mut both = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            vec![at(root, "a.md"), at(root, "b.md")],
        );
        both = both.set_tracker(7);
        // Saving the source must not swallow a later real rename.
        let out = coalesce(root, &[from, to, both], |path| path == "a.md");
        assert_eq!(out, one(ChangeKind::Rename, &["a.md", "b.md"]));

        let trash = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            vec![at(root, "note.md"), at(root, ".trash/note.md")],
        );
        let out = coalesce(root, &[trash], |_| false);
        assert_eq!(out, one(ChangeKind::Remove, &["note.md"]));
    }

    #[test]
    fn atomic_save_rename_is_suppressed_for_the_destination() {
        let root = Path::new("/vault");
        let save = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            vec![
                at(root, &format!(".note.md.9{TEMP_MARK}")),
                at(root, "note.md"),
            ],
        )
        .set_tracker(3);
        assert!(coalesce(root, &[save.clone()], |path| path == "note.md").is_empty());
        let out = coalesce(root, &[save], |_| false);
        assert_eq!(out, one(ChangeKind::Create, &["note.md"]));
    }

    #[test]
    fn create_plus_modify_is_one_create_and_dirs_are_quiet() {
        let root = Path::new("/vault");
        let create = kind(EventKind::Create(CreateKind::File), vec![at(root, "a.md")]);
        let modify = kind(
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            vec![at(root, "a.md")],
        );
        let out = coalesce(root, &[create, modify], |_| false);
        assert_eq!(out, one(ChangeKind::Create, &["a.md"]));

        let removed = kind(EventKind::Remove(RemoveKind::File), vec![at(root, "a.md")]);
        let created = kind(EventKind::Create(CreateKind::File), vec![at(root, "a.md")]);
        let out = coalesce(root, &[removed, created], |_| false);
        assert_eq!(out, one(ChangeKind::Modify, &["a.md"]));

        let dir = tmp_dir("watchdir");
        let sub = dir.path.join("sub");
        fs::create_dir(&sub).unwrap();
        let noise = kind(
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            vec![sub],
        );
        assert!(coalesce(&dir.path, &[noise], |_| false).is_empty());
    }

    #[test]
    fn watcher_reports_an_external_create() {
        let dir = tmp_dir("watchlive");
        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = start_watcher(&dir.path, tx).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        while rx.try_recv().is_ok() {}
        fs::write(dir.path.join("n.md"), "hi").unwrap();
        let start = Instant::now();
        let mut events = Vec::new();
        while start.elapsed() < Duration::from_secs(3) {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(WatchMsg::Event(event)) => events.push(event),
                Ok(WatchMsg::Watch(_)) => {}
                Err(_) => {}
            }
            if events
                .iter()
                .any(|event| event.paths.iter().any(|p| p.ends_with("n.md")))
            {
                break;
            }
        }
        let out = coalesce(&dir.path, &events, |_| false);
        assert!(
            out.iter()
                .any(|change| change.paths.iter().any(|p| p == "n.md")),
            "expected n.md in {out:?} from {events:?}"
        );
    }

    fn modify_of(root: &Path, rel: &str) -> Event {
        kind(
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            vec![root.join(rel)],
        )
    }

    /// An editor, git, or sync tool that lands inside the old 500 ms window is
    /// a normal external change. The timer used to drop it.
    #[test]
    fn outside_edit_just_after_a_save_is_reported() {
        let dir = tmp_dir("stamp-outside");
        let inner = state(&dir.path);
        {
            let mut guard = lock(&inner);
            guard
                .vault
                .as_mut()
                .unwrap()
                .write_note("Note.md", "grove-marker")
                .unwrap();
        }
        fs::write(dir.path.join("Note.md"), "external-marker").unwrap();
        let changes = flush_changes(&inner, &[modify_of(&dir.path, "Note.md")], Index::scan);
        assert_eq!(changes, one(ChangeKind::Modify, &["Note.md"]));
        let guard = lock(&inner);
        let vault = guard.vault.as_ref().unwrap();
        assert!(!vault.is_own_write("Note.md"));
        assert_eq!(vault.index.search("external-marker", 10).len(), 1);
        assert!(vault.index.search("grove-marker", 10).is_empty());
    }

    /// The modify from our own save, and the temp-file rename that save uses,
    /// must not become `vault-changed`.
    #[test]
    fn own_write_echo_produces_no_vault_changed() {
        let dir = tmp_dir("stamp-echo");
        let inner = state(&dir.path);
        {
            let mut guard = lock(&inner);
            guard
                .vault
                .as_mut()
                .unwrap()
                .write_note("Note.md", "grove-marker")
                .unwrap();
        }
        assert!(flush_changes(&inner, &[modify_of(&dir.path, "Note.md")], Index::scan).is_empty());
        let save = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            vec![
                dir.path.join(format!(".Note.md.9{TEMP_MARK}")),
                dir.path.join("Note.md"),
            ],
        )
        .set_tracker(3);
        assert!(flush_changes(&inner, &[save], Index::scan).is_empty());
        let guard = lock(&inner);
        let vault = guard.vault.as_ref().unwrap();
        assert!(vault.is_own_write("Note.md"));
        assert_eq!(vault.index.search("grove-marker", 10).len(), 1);
        assert_eq!(fs::read_to_string(dir.path.join("Note.md")).unwrap(), "grove-marker");
    }

    /// Same length and the original mtime, but a new inode: a replace in one
    /// clock tick. That is not our file, so the modify is reported.
    #[test]
    fn same_size_new_inode_replace_is_reported() {
        let dir = tmp_dir("stamp-inode");
        let inner = state(&dir.path);
        {
            let mut guard = lock(&inner);
            guard.vault.as_mut().unwrap().write_note("Note.md", "aaaa").unwrap();
        }
        let note = dir.path.join("Note.md");
        let before = fs::metadata(&note).unwrap();
        let mtime = before.modified().unwrap();
        let before_ms = crate::fsutil::mtime_ms(&before);
        #[cfg(unix)]
        let before_ino = {
            use std::os::unix::fs::MetadataExt;
            before.ino()
        };
        let tmp = dir.path.join("swap.md");
        fs::write(&tmp, "bbbb").unwrap();
        fs::rename(&tmp, &note).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&note)
            .unwrap()
            .set_modified(mtime)
            .unwrap();
        let after = fs::metadata(&note).unwrap();
        assert_eq!(crate::fsutil::mtime_ms(&after), before_ms);
        assert_eq!(after.len(), 4);
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            assert_ne!(after.ino(), before_ino);
        }
        {
            let guard = lock(&inner);
            assert!(!guard.vault.as_ref().unwrap().is_own_write("Note.md"));
        }
        let changes = flush_changes(&inner, &[modify_of(&dir.path, "Note.md")], Index::scan);
        assert_eq!(changes, one(ChangeKind::Modify, &["Note.md"]));
        let guard = lock(&inner);
        assert_eq!(guard.vault.as_ref().unwrap().index.search("bbbb", 10).len(), 1);
    }

    /// Dropping our echo must not drop a different file's remove in the same batch.
    #[test]
    fn own_echo_does_not_hide_another_files_remove() {
        let dir = tmp_dir("stamp-batch");
        fs::write(dir.path.join("Note.md"), "old").unwrap();
        fs::write(dir.path.join("Other.md"), "other").unwrap();
        let inner = state(&dir.path);
        {
            let mut guard = lock(&inner);
            guard
                .vault
                .as_mut()
                .unwrap()
                .write_note("Note.md", "grove-marker")
                .unwrap();
        }
        fs::remove_file(dir.path.join("Other.md")).unwrap();
        let remove = kind(EventKind::Remove(RemoveKind::File), vec![dir.path.join("Other.md")]);
        let changes = flush_changes(
            &inner,
            &[modify_of(&dir.path, "Note.md"), remove],
            Index::scan,
        );
        assert_eq!(changes, one(ChangeKind::Remove, &["Other.md"]));
        let guard = lock(&inner);
        let vault = guard.vault.as_ref().unwrap();
        assert!(vault.is_own_write("Note.md"));
        assert!(vault.index.contains("Note.md"));
        assert!(!vault.index.contains("Other.md"));
        assert_eq!(vault.index.search("grove-marker", 10).len(), 1);
    }

    /// A real rename is still reported. The stamp moves with the file, so a
    /// later modify of those same bytes is quiet.
    #[test]
    fn external_rename_is_reported_and_keeps_the_stamp() {
        let dir = tmp_dir("stamp-rename");
        let inner = state(&dir.path);
        {
            let mut guard = lock(&inner);
            guard.vault.as_mut().unwrap().write_note("A.md", "grove-marker").unwrap();
        }
        fs::rename(dir.path.join("A.md"), dir.path.join("B.md")).unwrap();
        let rename = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            vec![dir.path.join("A.md"), dir.path.join("B.md")],
        );
        let changes = flush_changes(&inner, &[rename], Index::scan);
        assert_eq!(changes, one(ChangeKind::Rename, &["A.md", "B.md"]));
        {
            let guard = lock(&inner);
            let vault = guard.vault.as_ref().unwrap();
            assert!(!vault.is_own_write("A.md"));
            assert!(vault.is_own_write("B.md"));
            assert!(!vault.index.contains("A.md"));
            assert!(vault.index.contains("B.md"));
        }
        assert!(flush_changes(&inner, &[modify_of(&dir.path, "B.md")], Index::scan).is_empty());
        let guard = lock(&inner);
        let vault = guard.vault.as_ref().unwrap();
        assert!(vault.is_own_write("B.md"));
        assert_eq!(vault.index.search("grove-marker", 10).len(), 1);
    }

    /// App rename, then the source is written again, then the delayed rename
    /// echo arrives. Both files keep the stamp of the bytes now on them, so
    /// their own modifies stay quiet. An outside edit after that is reported.
    #[test]
    fn app_rename_echo_does_not_steal_a_recreated_sources_stamp() {
        let dir = tmp_dir("stamp-echo-rename");
        let inner = state(&dir.path);
        {
            let mut guard = lock(&inner);
            let vault = guard.vault.as_mut().unwrap();
            vault.write_note("A.md", "alpha-source").unwrap();
            vault.rename_path("A.md", "B.md").unwrap();
            vault.write_note("A.md", "alpha-recreated").unwrap();
            assert!(vault.is_own_write("A.md"));
            assert!(vault.is_own_write("B.md"));
        }
        let rename = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            vec![dir.path.join("A.md"), dir.path.join("B.md")],
        );
        assert_eq!(
            flush_changes(&inner, &[rename], Index::scan),
            one(ChangeKind::Rename, &["A.md", "B.md"])
        );
        assert!(flush_changes(&inner, &[modify_of(&dir.path, "A.md")], Index::scan).is_empty());
        assert!(flush_changes(&inner, &[modify_of(&dir.path, "B.md")], Index::scan).is_empty());
        {
            let guard = lock(&inner);
            let vault = guard.vault.as_ref().unwrap();
            assert!(vault.is_own_write("A.md"));
            assert!(vault.is_own_write("B.md"));
            assert_eq!(vault.index.search("alpha-recreated", 10).len(), 1);
            assert_eq!(vault.index.search("alpha-source", 10).len(), 1);
        }
        fs::write(dir.path.join("B.md"), "alpha-outside").unwrap();
        let changes = flush_changes(&inner, &[modify_of(&dir.path, "B.md")], Index::scan);
        assert_eq!(changes, one(ChangeKind::Modify, &["B.md"]));
        let guard = lock(&inner);
        let vault = guard.vault.as_ref().unwrap();
        assert!(!vault.is_own_write("B.md"));
        assert!(vault.is_own_write("A.md"));
        assert_eq!(vault.index.search("alpha-outside", 10).len(), 1);
        assert!(vault.index.search("alpha-source", 10).is_empty());
    }

    /// After the rename publishes, swap in a different file before the caller
    /// records a stamp. The hook runs once. Drop clears it if the write never
    /// publishes.
    fn arm_publish_replace(outside: &'static [u8]) -> PublishGuard {
        crate::fsutil::after_publish(Some(Box::new(move |path| {
            let incoming = path.with_extension("incoming");
            fs::write(&incoming, outside).expect("incoming");
            fs::rename(&incoming, path).expect("replace published file");
        })));
        PublishGuard
    }

    struct PublishGuard;
    impl Drop for PublishGuard {
        fn drop(&mut self) {
            crate::fsutil::after_publish(None);
        }
    }

    fn property_status(expect: &str, value: &str) -> crate::edit::PropertyEdit {
        use crate::edit::{PropertyEdit, Target, Typed};
        use crate::index::props::{PropertyType, PropertyValue};
        PropertyEdit {
            key: "status".into(),
            expect: Some(format!("status: {expect}")),
            to: Some(Target::Typed(Typed {
                kind: PropertyType::Text,
                value: PropertyValue::Text(value.into()),
            })),
        }
    }

    /// The bytes Grove submitted stay in the index until the flush reloads the
    /// file the hook put at the path. That reload must be reported.
    fn assert_published_note_reloads(
        inner: &std::sync::RwLock<Inner>,
        dir: &Path,
        rel: &str,
        grove: &str,
        outside: &str,
    ) {
        {
            let guard = lock(inner);
            let vault = guard.vault.as_ref().unwrap();
            assert!(!vault.is_own_write(rel), "{rel} adopted the outside file");
            assert_eq!(vault.index.search(grove, 10).len(), 1, "{rel} indexed text");
            assert!(vault.index.search(outside, 10).is_empty(), "{rel} outside text");
        }
        assert_eq!(fs::read(dir.join(rel)).unwrap(), outside.as_bytes());
        let changes = flush_changes(inner, &[modify_of(dir, rel)], Index::scan);
        assert_eq!(changes, one(ChangeKind::Modify, &[rel]));
        let guard = lock(inner);
        let vault = guard.vault.as_ref().unwrap();
        assert!(!vault.is_own_write(rel));
        assert_eq!(vault.index.search(outside, 10).len(), 1);
        assert!(vault.index.search(grove, 10).is_empty());
    }

    #[test]
    fn outside_replace_during_publish_of_write_note_is_reported() {
        let dir = tmp_dir("stamp-publish-note");
        let inner = state(&dir.path);
        let _guard = arm_publish_replace(b"outside-note-bytes");
        {
            let mut guard = lock(&inner);
            guard
                .vault
                .as_mut()
                .unwrap()
                .write_note("Note.md", "grove-note-word")
                .unwrap();
        }
        drop(_guard);
        assert_published_note_reloads(
            &inner,
            &dir.path,
            "Note.md",
            "grove-note-word",
            "outside-note-bytes",
        );
    }

    #[test]
    fn outside_replace_during_publish_of_create_note_is_reported() {
        let dir = tmp_dir("stamp-publish-create");
        let inner = state(&dir.path);
        let _guard = arm_publish_replace(b"outside-create-bytes");
        {
            let mut guard = lock(&inner);
            guard
                .vault
                .as_mut()
                .unwrap()
                .create_note("New.md", "grove-create-word")
                .unwrap();
        }
        drop(_guard);
        assert_published_note_reloads(
            &inner,
            &dir.path,
            "New.md",
            "grove-create-word",
            "outside-create-bytes",
        );
    }

    #[test]
    fn outside_replace_during_publish_of_write_file_bytes_is_reported() {
        let dir = tmp_dir("stamp-publish-bytes");
        let inner = state(&dir.path);
        let outside = b"outside-png-bytes-xx";
        let _guard = arm_publish_replace(outside);
        {
            let mut guard = lock(&inner);
            guard
                .vault
                .as_mut()
                .unwrap()
                .write_file_bytes("pic.png", b"grove-png")
                .unwrap();
            assert!(!guard.vault.as_ref().unwrap().is_own_write("pic.png"));
        }
        drop(_guard);
        assert_eq!(fs::read(dir.path.join("pic.png")).unwrap(), outside);
        let changes = flush_changes(&inner, &[modify_of(&dir.path, "pic.png")], Index::scan);
        assert_eq!(changes, one(ChangeKind::Modify, &["pic.png"]));
        assert!(!lock(&inner).vault.as_ref().unwrap().is_own_write("pic.png"));
    }

    #[test]
    fn outside_replace_during_publish_of_set_property_is_reported() {
        let dir = tmp_dir("stamp-publish-prop");
        let inner = state(&dir.path);
        {
            let mut guard = lock(&inner);
            guard
                .vault
                .as_mut()
                .unwrap()
                .create_note("Prop.md", "---\nstatus: todo\n---\nbody-grove-word\n")
                .unwrap();
        }
        let _guard = arm_publish_replace(b"outside-property-marker");
        {
            let mut guard = lock(&inner);
            let result = guard
                .vault
                .as_mut()
                .unwrap()
                .set_property("Prop.md", &property_status("todo", "doing"), false)
                .unwrap();
            assert!(
                matches!(result, crate::edit::EditResult::Done { .. }),
                "{result:?}"
            );
        }
        drop(_guard);
        assert_published_note_reloads(
            &inner,
            &dir.path,
            "Prop.md",
            "body-grove-word",
            "outside-property-marker",
        );
    }
}
