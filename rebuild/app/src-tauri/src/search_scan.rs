//! Search-view scans. The page assigns each query a request id before the scan
//! starts. A newer id in the same window supersedes a scan that is already
//! walking notes. An older id that arrives late is ignored and does not move
//! that window's id. The walk keeps a shared snapshot, so it does not hold the
//! vault lock and a save can proceed.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::model::SearchNote;

#[cfg(test)]
use std::cell::RefCell;

#[cfg(test)]
thread_local! {
    static BEFORE_CLAIM: RefCell<Option<Box<dyn FnMut()>>> = const { RefCell::new(None) };
}

/// Test hook that runs on the scan thread before this request claims its window id.
#[cfg(test)]
fn set_before_claim_hook(hook: Option<Box<dyn FnMut()>>) {
    BEFORE_CLAIM.with(|cell| *cell.borrow_mut() = hook);
}

fn before_claim() {
    #[cfg(test)]
    BEFORE_CLAIM.with(|cell| {
        if let Some(hook) = cell.borrow_mut().as_mut() {
            hook();
        }
    });
}

/// One request id per window label. The page chooses the id. This only stores a newer one.
#[derive(Default)]
pub(crate) struct SearchSlots {
    windows: Mutex<HashMap<String, Arc<AtomicU64>>>,
}

impl SearchSlots {
    /// `true` when `request` is strictly newer than this window's current id.
    /// An older or repeated id is refused and leaves the atomic unchanged.
    pub(crate) fn claim(&self, window: &str, request: u64) -> (Arc<AtomicU64>, bool) {
        let slot = {
            let mut windows = self.windows.lock().unwrap_or_else(|err| err.into_inner());
            windows
                .entry(window.to_string())
                .or_insert_with(|| Arc::new(AtomicU64::new(0)))
                .clone()
        };
        let mut seen = slot.load(Ordering::Acquire);
        loop {
            if request <= seen {
                return (slot, false);
            }
            match slot.compare_exchange_weak(seen, request, Ordering::AcqRel, Ordering::Acquire) {
                Ok(_) => return (slot, true),
                Err(actual) => seen = actual,
            }
        }
    }
}

pub(crate) fn run(
    state: &crate::AppState,
    window: &str,
    request: u64,
    query: &str,
    match_case: bool,
) -> Result<Vec<SearchNote>, String> {
    // The page id is already ordered. Claim it before the snapshot so a request
    // that was dispatched late cannot take the generation from a newer one.
    before_claim();
    let (slot, owned) = state.search_gen.claim(window, request);
    if !owned {
        return Err("cancelled".to_string());
    }
    let snap = {
        let guard = crate::read(&state.inner);
        let vault = guard
            .vault
            .as_ref()
            .ok_or_else(|| "no vault open".to_string())?;
        vault.index.search_snap()
    };
    snap.search_notes(query, match_case, || slot.load(Ordering::Acquire) == request)
        .map_err(|()| "cancelled".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::set_search_note_hook;
    use crate::tests::{sync_write, test_state};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

    #[test]
    fn one_window_does_not_supersede_another() {
        let slots = SearchSlots::default();
        let (main_slot, main_owned) = slots.claim("main", 1);
        assert!(main_owned);
        let (other_slot, other_owned) = slots.claim("note", 1);
        assert!(other_owned);
        assert_eq!(main_slot.load(Ordering::Acquire), 1);
        assert_eq!(other_slot.load(Ordering::Acquire), 1);
        assert!(slots.claim("note", 4).1);
        assert_eq!(
            main_slot.load(Ordering::Acquire),
            1,
            "another window's search bumped this one"
        );
        assert!(!slots.claim("main", 1).1, "an older id advanced the generation");
        assert_eq!(main_slot.load(Ordering::Acquire), 1);
        assert!(slots.claim("main", 2).1);
        assert_eq!(main_slot.load(Ordering::Acquire), 2);
        assert_eq!(other_slot.load(Ordering::Acquire), 4);
    }

    #[test]
    fn superseded_search_stops_early_and_a_save_is_not_blocked() {
        let dir = crate::fsutil::tmp_dir("search-cancel");
        for i in 0..80 {
            std::fs::write(dir.path.join(format!("n{i}.md")), format!("alpha {i}\n")).unwrap();
        }
        std::fs::write(dir.path.join("zebra.md"), "zebra-marker\n").unwrap();
        let state = Arc::new(test_state(&dir.path));
        let visits = Arc::new(AtomicUsize::new(0));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let (result_tx, result_rx) = mpsc::channel();
        thread::scope(|scope| {
            let _unblock = Release(release_tx.clone());
            let state_scan = Arc::clone(&state);
            let visits_hook = Arc::clone(&visits);
            scope.spawn(move || {
                set_search_note_hook(Some(Box::new(move |index| {
                    visits_hook.fetch_add(1, Ordering::SeqCst);
                    if index == 0 {
                        entered_tx.send(()).ok();
                        let _ = release_rx.lock().unwrap().recv();
                    }
                })));
                let result = run(&state_scan, "main", 1, "alpha", false);
                set_search_note_hook(None);
                result_tx.send(result).ok();
            });
            entered_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("scan did not reach the first note");
            assert_eq!(visits.load(Ordering::SeqCst), 1);

            let (other_tx, other_rx) = mpsc::channel();
            let state_other = Arc::clone(&state);
            scope.spawn(move || {
                other_tx
                    .send(run(&state_other, "note", 1, "zebra-marker", false))
                    .ok();
            });
            let other = other_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("other window's search waited on the first scan")
                .expect("other window search");
            assert_eq!(
                other,
                vec![crate::model::SearchNote {
                    path: "zebra.md".into(),
                    count: 1
                }]
            );
            assert_eq!(
                visits.load(Ordering::SeqCst),
                1,
                "the other window's search advanced the paused scan"
            );

            let (save_tx, save_rx) = mpsc::channel();
            let state_save = Arc::clone(&state);
            scope.spawn(move || {
                let started = Instant::now();
                let result = sync_write(&state_save, |vault| {
                    vault.write_note("n0.md", "saved-while-scanning alpha")
                });
                save_tx.send((started.elapsed(), result)).ok();
            });
            let (save_elapsed, save_result) = save_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap_or_else(|_| {
                    let _ = release_tx.send(());
                    panic!("save blocked while a search was between notes");
                });
            save_result.expect("save");
            assert!(
                save_elapsed < Duration::from_millis(1500),
                "save took {save_elapsed:?} during a paused scan"
            );
            assert_eq!(
                visits.load(Ordering::SeqCst),
                1,
                "the save waited for the scan to keep walking"
            );

            let newest = run(&state, "main", 2, "saved-while-scanning", false).expect("newest search");
            let direct = crate::read_vault(&state, |vault| {
                Ok(vault.index.search_notes("saved-while-scanning", false))
            })
            .unwrap();
            assert_eq!(newest, direct);
            assert_eq!(
                newest,
                vec![crate::model::SearchNote {
                    path: "n0.md".into(),
                    count: 1
                }]
            );
            let alpha = run(&state, "main", 3, "alpha", false).expect("complete alpha search");
            let alpha_direct =
                crate::read_vault(&state, |vault| Ok(vault.index.search_notes("alpha", false)))
                    .unwrap();
            assert_eq!(alpha, alpha_direct);
            assert_eq!(alpha.len(), 80);

            let _ = release_tx.send(());
            let old = result_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("old scan did not finish");
            assert_eq!(old.expect_err("old scan returned results"), "cancelled");
            assert_eq!(
                visits.load(Ordering::SeqCst),
                1,
                "old scan kept walking after a newer search started"
            );
        });
    }

    /// The older request pauses before it claims an id. The newer id must still
    /// return every row. The page shows an error only when the current request
    /// rejects, so this `Ok` is the result the search view draws.
    #[test]
    fn a_late_older_request_does_not_cancel_the_newer_one() {
        let dir = crate::fsutil::tmp_dir("search-order");
        for i in 0..4 {
            std::fs::write(dir.path.join(format!("n{i}.md")), format!("alpha {i}\n")).unwrap();
        }
        let state = Arc::new(test_state(&dir.path));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let (old_tx, old_rx) = mpsc::channel();
        let (new_tx, new_rx) = mpsc::channel();
        thread::scope(|scope| {
            let _unblock = Release(release_tx.clone());
            let state_old = Arc::clone(&state);
            scope.spawn(move || {
                set_before_claim_hook(Some(Box::new(move || {
                    entered_tx.send(()).ok();
                    let _ = release_rx.lock().unwrap().recv();
                })));
                let result = run(&state_old, "main", 1, "alpha", false);
                set_before_claim_hook(None);
                old_tx.send(result).ok();
            });
            entered_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("older request did not pause before registration");

            let state_new = Arc::clone(&state);
            scope.spawn(move || {
                new_tx.send(run(&state_new, "main", 2, "alpha", false)).ok();
            });
            let newest = new_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("newer search waited on the older request")
                .expect("newer search was cancelled");
            let direct = crate::read_vault(&state, |vault| {
                Ok(vault.index.search_notes("alpha", false))
            })
            .unwrap();
            assert_eq!(newest, direct);
            assert_eq!(newest.len(), 4);

            let (slot, again) = state.search_gen.claim("main", 2);
            assert!(!again, "repeating the current id advanced the generation");
            assert_eq!(slot.load(Ordering::Acquire), 2);

            let _ = release_tx.send(());
            let old = old_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("older request did not finish");
            assert_eq!(old.expect_err("older request returned results"), "cancelled");
            assert_eq!(
                slot.load(Ordering::Acquire),
                2,
                "the late older request advanced the generation"
            );
        });
    }

    /// The window already has a request id from the previous document. That
    /// document's last search is still paused before it claims. The reloaded
    /// page's first id is the next one, not a counter that started over.
    #[test]
    fn a_reloaded_page_search_returns_every_row_while_an_old_request_is_delayed() {
        let dir = crate::fsutil::tmp_dir("search-reload");
        for i in 0..4 {
            std::fs::write(dir.path.join(format!("n{i}.md")), format!("alpha {i}\n")).unwrap();
        }
        let state = Arc::new(test_state(&dir.path));
        let warmed = run(&state, "main", 4, "alpha", false).expect("previous document's search");
        assert_eq!(warmed.len(), 4);

        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let (old_tx, old_rx) = mpsc::channel();
        thread::scope(|scope| {
            let _unblock = Release(release_tx.clone());
            let state_old = Arc::clone(&state);
            scope.spawn(move || {
                set_before_claim_hook(Some(Box::new(move || {
                    entered_tx.send(()).ok();
                    let _ = release_rx.lock().unwrap().recv();
                })));
                let result = run(&state_old, "main", 5, "alpha", false);
                set_before_claim_hook(None);
                old_tx.send(result).ok();
            });
            entered_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("old document's request did not pause before registration");

            let restarted = run(&state, "main", 1, "alpha", false);
            assert_eq!(
                restarted.expect_err("a restarted request id returned rows"),
                "cancelled"
            );
            let newest = run(&state, "main", 6, "alpha", false).expect("reloaded search was cancelled");
            let direct = crate::read_vault(&state, |vault| {
                Ok(vault.index.search_notes("alpha", false))
            })
            .unwrap();
            assert_eq!(newest, direct);
            assert_eq!(newest.len(), 4);

            let _ = release_tx.send(());
            let old = old_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("old document's request did not finish");
            assert_eq!(old.expect_err("old document's request returned rows"), "cancelled");
            assert_eq!(state.search_gen.claim("main", 6).1, false);
            assert_eq!(
                state.search_gen.claim("main", 6).0.load(Ordering::Acquire),
                6,
                "the delayed request from the previous document advanced the id"
            );
        });
    }

    /// Sends on drop so a failed assertion cannot leave the paused scan blocked.
    struct Release(mpsc::Sender<()>);
    impl Drop for Release {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }
}
