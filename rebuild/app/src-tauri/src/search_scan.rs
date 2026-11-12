//! Search-view scans. A newer query in the same window supersedes a scan that is
//! already walking notes. The walk keeps a shared snapshot, so it does not hold
//! the vault lock and a save can proceed.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::model::SearchNote;

/// One generation counter per window label.
#[derive(Default)]
pub(crate) struct SearchSlots {
    windows: Mutex<HashMap<String, Arc<AtomicU64>>>,
}

impl SearchSlots {
    /// The generation this call owns. An older scan of the same window sees a newer value and stops.
    pub(crate) fn begin(&self, window: &str) -> (Arc<AtomicU64>, u64) {
        let slot = {
            let mut windows = self.windows.lock().unwrap_or_else(|err| err.into_inner());
            windows
                .entry(window.to_string())
                .or_insert_with(|| Arc::new(AtomicU64::new(0)))
                .clone()
        };
        let gen = slot.fetch_add(1, Ordering::AcqRel) + 1;
        (slot, gen)
    }
}

pub(crate) fn run(
    state: &crate::AppState,
    window: &str,
    query: &str,
    match_case: bool,
) -> Result<Vec<SearchNote>, String> {
    // Bump before the snapshot so a scan that started earlier cannot keep the newer generation.
    let (slot, gen) = state.search_gen.begin(window);
    let snap = {
        let guard = crate::read(&state.inner);
        let vault = guard
            .vault
            .as_ref()
            .ok_or_else(|| "no vault open".to_string())?;
        vault.index.search_snap()
    };
    snap.search_notes(query, match_case, || slot.load(Ordering::Acquire) == gen)
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
        let (main_slot, main_gen) = slots.begin("main");
        let (other_slot, other_gen) = slots.begin("note");
        assert_eq!(main_slot.load(Ordering::Acquire), main_gen);
        assert_eq!(other_slot.load(Ordering::Acquire), other_gen);
        let _ = slots.begin("note");
        assert_eq!(
            main_slot.load(Ordering::Acquire),
            main_gen,
            "another window's search bumped this one"
        );
        let _ = slots.begin("main");
        assert_ne!(main_slot.load(Ordering::Acquire), main_gen);
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
                let result = run(&state_scan, "main", "alpha", false);
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
                    .send(run(&state_other, "note", "zebra-marker", false))
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

            let newest = run(&state, "main", "saved-while-scanning", false).expect("newest search");
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
            let alpha = run(&state, "main", "alpha", false).expect("complete alpha search");
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

    /// Sends on drop so a failed assertion cannot leave the paused scan blocked.
    struct Release(mpsc::Sender<()>);
    impl Drop for Release {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }
}
