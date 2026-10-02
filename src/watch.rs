//! Tells the page when files in the vault change, so it doesn't have to keep asking. A watcher
//! on the vault folder (inotify, ReadDirectoryChangesW or FSEvents, through the `notify` crate)
//! bumps a counter; `/api/changes?since=N` waits until the counter passes N, or 25 seconds.
//! The watcher starts on the first request and follows the vault when it's switched. If it
//! can't start, requests answer at once with `watching: false` and the page polls instead.
//! It also keeps the paths that changed lately, so the page can look at just those files rather
//! than list the whole vault, which takes a while in a big one.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How many changed paths are remembered. A page further behind than that lists the vault.
const LOG_MAX: usize = 4096;

struct State {
    version: u64,
    vault: Option<PathBuf>,
    watcher: Option<RecommendedWatcher>,
    /// The paths that changed, with the version each change made.
    log: VecDeque<(u64, PathBuf)>,
    /// The log has every change after this version (not those before the watcher started, nor
    /// those it has dropped to stay under LOG_MAX).
    floor: u64,
}

fn shared() -> &'static (Mutex<State>, Condvar) {
    static S: OnceLock<(Mutex<State>, Condvar)> = OnceLock::new();
    S.get_or_init(|| (Mutex::new(State { version: 1, vault: None, watcher: None, log: VecDeque::new(), floor: 1 }), Condvar::new()))
}

/// Changes Cinder's own writes make in passing, and folders it doesn't show, aren't news.
fn wanted(p: &Path, vault: &Path) -> bool {
    let rel = p.strip_prefix(vault).unwrap_or(p);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    !name.ends_with(".cinder-tmp")
        && !rel.components().next().map(|c| {
            let c = c.as_os_str().to_string_lossy();
            c == ".trash" || c == ".git"
        }).unwrap_or(false)
        && !(rel.starts_with(".obsidian") && name.starts_with("workspace"))
}

fn interesting(ev: &Event, vault: &Path) -> bool {
    !matches!(ev.kind, EventKind::Access(_)) && ev.paths.iter().any(|p| wanted(p, vault))
}

/// What a wait saw: the version now, whether the vault is watched, and the paths that changed
/// since the version asked about, if the log reaches back that far.
pub struct Waited {
    pub version: u64,
    pub watching: bool,
    pub paths: Option<Vec<PathBuf>>,
}

/// Make sure the vault is being watched. Returns whether it is.
fn ensure(vault: &Path) -> bool {
    let (m, cv) = shared();
    let mut st = m.lock().unwrap();
    if st.vault.as_deref() == Some(vault) {
        return st.watcher.is_some();
    }
    st.watcher = None;
    st.vault = Some(vault.to_path_buf());
    let root = vault.to_path_buf();
    let made = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(ev) = res {
            if interesting(&ev, &root) {
                let (m, cv) = shared();
                let mut st = m.lock().unwrap();
                st.version += 1;
                let v = st.version;
                for p in ev.paths.iter().filter(|p| wanted(p, &root)) {
                    st.log.push_back((v, p.clone()));
                }
                while st.log.len() > LOG_MAX {
                    if let Some((v, _)) = st.log.pop_front() {
                        st.floor = v;
                    }
                }
                cv.notify_all();
            }
        }
    });
    if let Ok(mut w) = made {
        if w.watch(vault, RecursiveMode::Recursive).is_ok() {
            st.watcher = Some(w);
        }
    }
    // Whatever changed while nothing was watching: let waiting pages look again (at everything,
    // since the log can't say what).
    st.version += 1;
    st.log.clear();
    st.floor = st.version;
    cv.notify_all();
    st.watcher.is_some()
}

/// Wait (up to `timeout`) for a change after `since`. Once something changes, it waits until
/// the vault has been quiet for a moment (up to a second), so a burst of changes (a sync, a git
/// checkout) comes as one answer.
pub fn wait(vault: &Path, since: u64, timeout: Duration) -> Waited {
    let watching = ensure(vault);
    let (m, cv) = shared();
    let mut st = m.lock().unwrap();
    if !watching {
        return Waited { version: st.version, watching: false, paths: None };
    }
    let end = Instant::now() + timeout;
    while st.version <= since {
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        st = cv.wait_timeout(st, left).unwrap().0;
    }
    if st.version > since {
        let settle = Instant::now() + Duration::from_secs(1);
        loop {
            let seen = st.version;
            st = cv.wait_timeout(st, Duration::from_millis(100)).unwrap().0;
            if st.version == seen || Instant::now() >= settle {
                break;
            }
        }
    }
    let paths = (since >= st.floor).then(|| {
        let mut ps: Vec<PathBuf> = st.log.iter().filter(|(v, _)| *v > since).map(|(_, p)| p.clone()).collect();
        ps.sort();
        ps.dedup();
        ps
    });
    Waited { version: st.version, watching: true, paths }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wakes_on_a_change() {
        let d = std::env::temp_dir().join(format!("cinder-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let w0 = wait(&d, 0, Duration::from_millis(10));
        assert!(w0.watching);
        assert!(w0.paths.is_none(), "a page that's just started lists the vault");
        let v0 = w0.version;
        let w1 = wait(&d, v0, Duration::from_millis(50));
        assert_eq!(w1.version, v0, "nothing changed");
        assert_eq!(w1.paths, Some(vec![]));
        let p = d.join("a.md");
        let q = p.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            std::fs::write(q, "x").unwrap();
        });
        let t = Instant::now();
        let w2 = wait(&d, v0, Duration::from_secs(5));
        assert!(w2.version > v0 && t.elapsed() < Duration::from_secs(3), "a write wakes the waiter");
        assert_eq!(w2.paths, Some(vec![p]), "and says which file changed");
        let _ = std::fs::remove_dir_all(&d);
    }
}
