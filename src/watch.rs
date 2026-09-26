//! Tells the page when files in the vault change, so it doesn't have to keep asking. A watcher
//! on the vault folder (inotify, ReadDirectoryChangesW or FSEvents, through the `notify` crate)
//! bumps a counter; `/api/changes?since=N` waits until the counter passes N, or 25 seconds.
//! The watcher starts on the first request and follows the vault when it's switched. If it
//! can't start, requests answer at once with `watching: false` and the page polls instead.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

struct State {
    version: u64,
    vault: Option<PathBuf>,
    watcher: Option<RecommendedWatcher>,
}

fn shared() -> &'static (Mutex<State>, Condvar) {
    static S: OnceLock<(Mutex<State>, Condvar)> = OnceLock::new();
    S.get_or_init(|| (Mutex::new(State { version: 1, vault: None, watcher: None }), Condvar::new()))
}

/// Changes Cinder's own writes make in passing, and folders it doesn't show, aren't news.
fn interesting(ev: &Event, vault: &Path) -> bool {
    if matches!(ev.kind, EventKind::Access(_)) {
        return false;
    }
    ev.paths.iter().any(|p| {
        let rel = p.strip_prefix(vault).unwrap_or(p);
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        !name.ends_with(".cinder-tmp")
            && !rel.components().next().map(|c| {
                let c = c.as_os_str().to_string_lossy();
                c == ".trash" || c == ".git"
            }).unwrap_or(false)
            && !(rel.starts_with(".obsidian") && name.starts_with("workspace"))
    })
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
                m.lock().unwrap().version += 1;
                cv.notify_all();
            }
        }
    });
    if let Ok(mut w) = made {
        if w.watch(vault, RecursiveMode::Recursive).is_ok() {
            st.watcher = Some(w);
        }
    }
    // Whatever changed while nothing was watching: let waiting pages look again.
    st.version += 1;
    cv.notify_all();
    st.watcher.is_some()
}

/// Wait (up to `timeout`) for a change after `since`. Returns (version, watching).
pub fn wait(vault: &Path, since: u64, timeout: Duration) -> (u64, bool) {
    let watching = ensure(vault);
    let (m, cv) = shared();
    let mut st = m.lock().unwrap();
    if !watching {
        return (st.version, false);
    }
    let end = Instant::now() + timeout;
    while st.version <= since {
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        st = cv.wait_timeout(st, left).unwrap().0;
    }
    (st.version, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wakes_on_a_change() {
        let d = std::env::temp_dir().join(format!("cinder-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (v0, watching) = wait(&d, 0, Duration::from_millis(10));
        assert!(watching);
        let (v1, _) = wait(&d, v0, Duration::from_millis(50));
        assert_eq!(v1, v0, "nothing changed");
        let p = d.join("a.md");
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            std::fs::write(p, "x").unwrap();
        });
        let t = Instant::now();
        let (v2, _) = wait(&d, v0, Duration::from_secs(5));
        assert!(v2 > v0 && t.elapsed() < Duration::from_secs(3), "a write wakes the waiter");
        let _ = std::fs::remove_dir_all(&d);
    }
}
