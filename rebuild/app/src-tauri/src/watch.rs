//! Debounced vault watcher.
//!
//! Notify events sit for ~100ms of quiet (and at most ~400ms) so a burst becomes a few
//! `vault-changed` events. Temp files and `.obsidian` / `.git` / `.trash` are dropped.
//! A path written by `write_note` in the last 500ms is dropped too. Rename events carry
//! `[from, to]`; a move into `.trash` is reported as `remove`.

use crate::model::{ChangeKind, VaultChanged};
use crate::{lock, AppState};
use notify::event::{AccessKind, AccessMode, EventKind, ModifyKind, RenameMode};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
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
            let elapsed = started.unwrap_or_else(Instant::now).elapsed();
            if elapsed >= MAX_WAIT {
                flush(&app, &batch);
                batch.clear();
                started = None;
                continue;
            }
            let timeout = QUIET.min(MAX_WAIT - elapsed);
            match rx.recv_timeout(timeout) {
                Ok(msg) => msg,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    flush(&app, &batch);
                    batch.clear();
                    started = None;
                    continue;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
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
    let changes = {
        let mut inner = lock(&state.inner);
        let Some(vault) = inner.vault.as_mut() else {
            return;
        };
        let now = Instant::now();
        let changes = if events.iter().any(|event| event.need_rescan()) {
            vault.rescan()
        } else {
            let root = vault.root.clone();
            let raw = coalesce(&root, events, |path| vault.is_own_write(path, now));
            let changes = vault.normalize(raw);
            vault.apply(&changes);
            changes
        };
        vault.gc_own_writes(now);
        changes
    };
    for change in changes {
        if change.paths.is_empty() {
            continue;
        }
        let _ = app.emit("vault-changed", &change);
    }
}

struct RenamePart {
    from: Option<String>,
    to: Option<String>,
    both_from: Option<String>,
    both_to: Option<String>,
    saw_both: bool,
}

/// Group a burst of notify events into contract events.
///
/// `suppress` drops creates, modifies, and removes of a path (our own `write_note`).
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
                for path in visible_files(root, event) {
                    modifies.insert(path);
                }
            }
            EventKind::Access(_) | EventKind::Any | EventKind::Other => {}
            EventKind::Create(_) => {
                for path in visible(root, event) {
                    creates.insert(path);
                }
            }
            EventKind::Remove(_) => {
                for path in visible(root, event) {
                    removes.insert(path);
                }
            }
            EventKind::Modify(ModifyKind::Name(mode)) => match mode {
                RenameMode::Both => {
                    let (from, to) = rename_ends(root, event);
                    if let Some(tracker) = event.attrs.tracker() {
                        note_tracker(&mut order, &mut parts, tracker);
                        let part = parts.get_mut(&tracker).unwrap();
                        part.saw_both = true;
                        part.both_from = from;
                        part.both_to = to;
                    } else {
                        bare.push((from, to));
                    }
                }
                RenameMode::From => {
                    if let Some(tracker) = event.attrs.tracker() {
                        note_tracker(&mut order, &mut parts, tracker);
                        if let Some(path) = visible(root, event).into_iter().next() {
                            parts.get_mut(&tracker).unwrap().from = Some(path);
                        }
                    } else if let Some(path) = visible(root, event).into_iter().next() {
                        removes.insert(path);
                    }
                }
                RenameMode::To => {
                    if let Some(tracker) = event.attrs.tracker() {
                        note_tracker(&mut order, &mut parts, tracker);
                        if let Some(path) = visible(root, event).into_iter().next() {
                            parts.get_mut(&tracker).unwrap().to = Some(path);
                        }
                    } else if let Some(path) = visible(root, event).into_iter().next() {
                        creates.insert(path);
                    }
                }
                RenameMode::Any | RenameMode::Other => {
                    let paths = visible(root, event);
                    if paths.len() >= 2 {
                        bare.push((Some(paths[0].clone()), Some(paths[1].clone())));
                    } else {
                        for path in paths {
                            modifies.insert(path);
                        }
                    }
                }
            },
            EventKind::Modify(ModifyKind::Metadata(_)) => {}
            EventKind::Modify(_) => {
                for path in visible_files(root, event) {
                    modifies.insert(path);
                }
            }
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
        if part.saw_both {
            push_rename(
                &mut renames,
                &mut creates,
                &mut removes,
                part.both_from,
                part.both_to,
            );
        } else {
            push_rename(&mut renames, &mut creates, &mut removes, part.from, part.to);
        }
    }

    for (from, to) in &renames {
        creates.remove(from);
        creates.remove(to);
        removes.remove(from);
        removes.remove(to);
        modifies.remove(from);
        modifies.remove(to);
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
    push_kind(&mut out, ChangeKind::Remove, removes.into_iter().collect());
    for (from, to) in renames {
        out.push(VaultChanged {
            kind: ChangeKind::Rename,
            paths: vec![from, to],
        });
    }
    push_kind(&mut out, ChangeKind::Create, creates.into_iter().collect());
    push_kind(&mut out, ChangeKind::Modify, modifies.into_iter().collect());
    out
}

fn note_tracker(order: &mut Vec<usize>, parts: &mut HashMap<usize, RenamePart>, tracker: usize) {
    if let std::collections::hash_map::Entry::Vacant(slot) = parts.entry(tracker) {
        order.push(tracker);
        slot.insert(RenamePart {
            from: None,
            to: None,
            both_from: None,
            both_to: None,
            saw_both: false,
        });
    }
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

fn push_kind(out: &mut Vec<VaultChanged>, kind: ChangeKind, paths: Vec<String>) {
    if !paths.is_empty() {
        out.push(VaultChanged { kind, paths });
    }
}

fn visible(root: &Path, event: &Event) -> Vec<String> {
    event
        .paths
        .iter()
        .filter_map(|path| crate::fsutil::rel_of(root, path))
        .collect()
}

/// Content changes on a directory are the parent folder's mtime moving. The child event is enough.
fn visible_files(root: &Path, event: &Event) -> Vec<String> {
    event
        .paths
        .iter()
        .filter(|path| !path.is_dir())
        .filter_map(|path| crate::fsutil::rel_of(root, path))
        .collect()
}

fn rename_ends(root: &Path, event: &Event) -> (Option<String>, Option<String>) {
    let from = event
        .paths
        .first()
        .and_then(|path| crate::fsutil::rel_of(root, path));
    let to = event
        .paths
        .get(1)
        .and_then(|path| crate::fsutil::rel_of(root, path));
    (from, to)
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

    #[test]
    fn groups_and_suppresses_our_own_writes() {
        let root = Path::new("/vault");
        let modify = kind(
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            vec![at(root, "a.md")],
        );
        let out = coalesce(root, &[modify.clone()], |_| false);
        assert_eq!(
            out,
            vec![VaultChanged {
                kind: ChangeKind::Modify,
                paths: vec!["a.md".into()],
            }]
        );
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
        assert_eq!(
            out,
            vec![VaultChanged {
                kind: ChangeKind::Rename,
                paths: vec!["a.md".into(), "b.md".into()],
            }]
        );

        let trash = kind(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            vec![at(root, "note.md"), at(root, ".trash/note.md")],
        );
        let out = coalesce(root, &[trash], |_| false);
        assert_eq!(
            out,
            vec![VaultChanged {
                kind: ChangeKind::Remove,
                paths: vec!["note.md".into()],
            }]
        );
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
        assert_eq!(
            out,
            vec![VaultChanged {
                kind: ChangeKind::Create,
                paths: vec!["note.md".into()],
            }]
        );
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
        assert_eq!(
            out,
            vec![VaultChanged {
                kind: ChangeKind::Create,
                paths: vec!["a.md".into()],
            }]
        );

        let removed = kind(EventKind::Remove(RemoveKind::File), vec![at(root, "a.md")]);
        let created = kind(EventKind::Create(CreateKind::File), vec![at(root, "a.md")]);
        let out = coalesce(root, &[removed, created], |_| false);
        assert_eq!(
            out,
            vec![VaultChanged {
                kind: ChangeKind::Modify,
                paths: vec!["a.md".into()],
            }]
        );

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
}
