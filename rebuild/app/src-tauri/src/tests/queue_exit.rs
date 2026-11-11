//! Shutdown ownership: a live pre-shutdown save blocks exit; a dropped lease does not.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::Duration;

use super::super::{enqueue_write_file_bytes, install_vault, read_vault, write_vault};
use super::{sync_write, test_state};
use crate::queue::IngressLease;

fn hold(state: &super::super::AppState, cmd: &str, key: usize) -> IngressLease {
    let got = state.write_queue.dispatch_ingress(cmd, key, || true);
    assert!(got.handled, "{cmd} was not accepted");
    got.lease.expect("accepted write")
}

#[test]
fn shutdown_drains_accepted_writes_cancels_unclaimed_tickets_and_coordinates_exit() {
    let dir = crate::fsutil::tmp_dir("shutdown-drain");
    let state = Arc::new(test_state(&dir.path));
    sync_write(&state, |v| v.create_note("Note.md", "initial")).unwrap();
    let ((started_tx, started_rx), (release_tx, release_rx)) = (mpsc::channel(), mpsc::channel());
    let lease10 = hold(&state, "open_vault", 10);
    let (st0, root) = (Arc::clone(&state), dir.path.clone());
    let slow = tauri::async_runtime::spawn(async move {
        let ticket = st0.write_queue.take_ingress(10);
        drop(lease10);
        install_vault(&st0, ticket, move || {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            Ok(root)
        })
        .await
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let lease11 = hold(&state, "write_note", 11);
    let st_delayed = Arc::clone(&state);
    let delayed_save = tauri::async_runtime::spawn(async move {
        std::thread::sleep(Duration::from_millis(30));
        let ticket = st_delayed.write_queue.take_ingress(11);
        drop(lease11);
        write_vault(&st_delayed, ticket, |v| {
            v.write_note("Note.md", "saved-before-quit")
        })
        .await
    });
    let lease12 = hold(&state, "rename_path", 12);
    let rename_reply = write_vault(&state, state.write_queue.take_ingress(12), |v| {
        v.rename_path("Note.md", "Sub/Moved.md")
    });
    drop(lease12);
    state.write_queue.reserve_ingress(13);
    drop(hold(&state, "write_note", 14));

    let (prevented, (exit_tx, exit_rx)) = (Arc::new(AtomicBool::new(false)), mpsc::channel());
    let prev_clone = Arc::clone(&prevented);
    assert!(!state.write_queue.on_exit_requested(
        Some(0),
        move || prev_clone.store(true, Ordering::SeqCst),
        move |code| {
            exit_tx.send(code).unwrap();
        }
    ));
    assert!(
        prevented.load(Ordering::SeqCst),
        "exit must be prevented while writes are draining"
    );
    assert!(
        exit_rx.recv_timeout(Duration::from_millis(15)).is_err(),
        "exit permitted before slow op and delayed save finished"
    );
    let orphaned_ran = Arc::new(AtomicBool::new(false));
    let late = state
        .write_queue
        .dispatch_ingress("write_note", 16, || true);
    assert!(
        late.handled && late.lease.is_none(),
        "post-shutdown ingress is not accepted"
    );
    for k in [13, 16] {
        let ran = Arc::clone(&orphaned_ran);
        let res = write_vault(&state, state.write_queue.take_ingress(k), move |v| {
            ran.store(true, Ordering::SeqCst);
            v.write_note("Sub/Moved.md", "clobbered")
        });
        assert_eq!(
            tauri::async_runtime::block_on(res).unwrap_err(),
            "vault write queue is closed"
        );
    }
    release_tx.send(()).unwrap();
    assert_eq!(
        exit_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("shutdown hung on abandoned ticket"),
        0
    );
    assert!(
        state.write_queue.is_terminated(),
        "worker JoinHandle must be joined before exit is permitted"
    );
    assert!(!dir.path.join("Note.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path.join("Sub/Moved.md")).unwrap(),
        "saved-before-quit"
    );
    tauri::async_runtime::block_on(slow).unwrap().unwrap();
    tauri::async_runtime::block_on(delayed_save)
        .unwrap()
        .expect("delayed pre-shutdown save was rejected");
    assert!(tauri::async_runtime::block_on(rename_reply).is_ok());
    let ran2 = Arc::clone(&orphaned_ran);
    let ab_res = write_vault(&state, state.write_queue.take_ingress(14), move |v| {
        ran2.store(true, Ordering::SeqCst);
        v.write_note("Sub/Moved.md", "clobbered")
    });
    assert_eq!(
        tauri::async_runtime::block_on(ab_res).unwrap_err(),
        "vault write queue is closed"
    );
    assert!(!orphaned_ran.load(Ordering::SeqCst));
    assert!(state.write_queue.on_exit_requested(
        Some(0),
        || panic!("should not prevent after drain"),
        |_| {}
    ));
}

/// Accepted, not yet claimed, and held past the old 120ms expiry. Exit waits, then the rename sees the save.
#[test]
fn slow_pending_save_blocks_exit_until_submit_then_rename_keeps_bytes() {
    let dir = crate::fsutil::tmp_dir("slow-pending-save");
    let state = Arc::new(test_state(&dir.path));
    sync_write(&state, |v| v.create_note("Note.md", "initial")).unwrap();
    let (go_tx, go_rx) = mpsc::channel();
    let lease = hold(&state, "write_note", 11);
    let st = Arc::clone(&state);
    let save = tauri::async_runtime::spawn(async move {
        go_rx.recv().expect("gate");
        let ticket = st.write_queue.take_ingress(11);
        drop(lease);
        write_vault(&st, ticket, |v| {
            v.write_note("Note.md", "saved-before-quit")
        })
        .await
    });
    let lease12 = hold(&state, "rename_path", 12);
    let rename = write_vault(&state, state.write_queue.take_ingress(12), |v| {
        v.rename_path("Note.md", "Sub/Moved.md")
    });
    drop(lease12);
    let (exit_tx, exit_rx) = mpsc::channel();
    let prevented = Arc::new(AtomicBool::new(false));
    let prev = Arc::clone(&prevented);
    assert!(!state.write_queue.on_exit_requested(
        Some(3),
        move || prev.store(true, Ordering::SeqCst),
        move |c| exit_tx.send(c).unwrap()
    ));
    assert!(prevented.load(Ordering::SeqCst));
    assert!(
        exit_rx.recv_timeout(Duration::from_millis(250)).is_err(),
        "exit proceeded while a pre-shutdown save was still unclaimed"
    );
    go_tx.send(()).unwrap();
    assert_eq!(
        exit_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("exit withheld after the pending save was submitted"),
        3
    );
    assert!(
        tauri::async_runtime::block_on(save).unwrap().is_ok(),
        "slow pre-take_ingress save was rejected"
    );
    assert!(tauri::async_runtime::block_on(rename).is_ok());
    assert!(!dir.path.join("Note.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path.join("Sub/Moved.md")).unwrap(),
        "saved-before-quit"
    );
}

/// Ticket claimed, then submit is gated past the old 120ms expiry.
#[test]
fn claimed_ticket_delayed_past_shutdown_still_writes_before_rename() {
    let dir = crate::fsutil::tmp_dir("slow-claimed-ticket");
    let state = Arc::new(test_state(&dir.path));
    sync_write(&state, |v| v.create_note("Note.md", "initial")).unwrap();
    let lease = hold(&state, "write_note", 11);
    let ticket = state.write_queue.take_ingress(11);
    drop(lease);
    let lease12 = hold(&state, "rename_path", 12);
    let rename = write_vault(&state, state.write_queue.take_ingress(12), |v| {
        v.rename_path("Note.md", "Sub/Moved.md")
    });
    drop(lease12);
    let (exit_tx, exit_rx) = mpsc::channel();
    let prevented = Arc::new(AtomicBool::new(false));
    let prev = Arc::clone(&prevented);
    assert!(!state.write_queue.on_exit_requested(
        Some(4),
        move || prev.store(true, Ordering::SeqCst),
        move |c| exit_tx.send(c).unwrap()
    ));
    assert!(prevented.load(Ordering::SeqCst));
    assert!(
        exit_rx.recv_timeout(Duration::from_millis(250)).is_err(),
        "exit proceeded while a claimed pre-shutdown save had not submitted"
    );
    let save = write_vault(&state, ticket, |v| {
        v.write_note("Note.md", "saved-before-quit")
    });
    assert_eq!(
        exit_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("exit withheld after the claimed save was submitted"),
        4
    );
    assert!(
        tauri::async_runtime::block_on(save).is_ok(),
        "save claimed before shutdown was rejected"
    );
    assert!(tauri::async_runtime::block_on(rename).is_ok());
    assert!(!dir.path.join("Note.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path.join("Sub/Moved.md")).unwrap(),
        "saved-before-quit"
    );
}

/// Dropping the lease is the handler going away. Exit must not sit on the old 120ms timer.
#[test]
fn abandoned_reservation_does_not_withhold_exit() {
    let dir = crate::fsutil::tmp_dir("abandoned-reservation");
    let state = test_state(&dir.path);
    sync_write(&state, |v| v.create_note("Note.md", "initial")).unwrap();
    drop(hold(&state, "write_note", 14));
    let (exit_tx, exit_rx) = mpsc::channel();
    let proceeded = state.write_queue.on_exit_requested(
        Some(5),
        || {},
        move |c| {
            exit_tx.send(c).unwrap();
        },
    );
    if !proceeded {
        assert_eq!(
            exit_rx
                .recv_timeout(Duration::from_millis(80))
                .expect("abandoned reservation withheld exit"),
            5
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.path.join("Note.md")).unwrap(),
        "initial"
    );
    assert!(state.write_queue.is_terminated());
}

#[test]
fn exit_drain_spawn_failure_falls_back_without_blocking_or_losing_exit() {
    let dir = crate::fsutil::tmp_dir("spawn-fail-fallback");
    let state = Arc::new(test_state(&dir.path));
    sync_write(&state, |v| v.create_note("Note.md", "initial")).unwrap();
    let ((started_tx, started_rx), (release_tx, release_rx)) = (mpsc::channel(), mpsc::channel());
    let lease20 = hold(&state, "open_vault", 20);
    let (st0, root) = (Arc::clone(&state), dir.path.clone());
    let slow = tauri::async_runtime::spawn(async move {
        let ticket = st0.write_queue.take_ingress(20);
        drop(lease20);
        install_vault(&st0, ticket, move || {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            Ok(root)
        })
        .await
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let lease21 = hold(&state, "write_note", 21);
    let save_reply = write_vault(&state, state.write_queue.take_ingress(21), |v| {
        v.write_note("Note.md", "saved-via-fallback")
    });
    drop(lease21);
    state
        .write_queue
        .shared
        .fail_drain_spawn
        .store(true, Ordering::SeqCst);
    let ((call_done_tx, call_done_rx), (exit_tx, exit_rx), prevented) = (
        mpsc::channel(),
        mpsc::channel(),
        Arc::new(AtomicBool::new(false)),
    );
    let (st_exit, prev_clone) = (Arc::clone(&state), Arc::clone(&prevented));
    std::thread::spawn(move || {
        let res = st_exit.write_queue.on_exit_requested(
            Some(7),
            move || prev_clone.store(true, Ordering::SeqCst),
            move |code| {
                exit_tx.send(code).unwrap();
            },
        );
        call_done_tx.send(res).unwrap();
    });
    assert!(!call_done_rx
        .recv_timeout(Duration::from_millis(50))
        .expect("on_exit_requested blocked the calling thread when drain spawn failed"));
    assert!(prevented.load(Ordering::SeqCst));
    assert!(exit_rx.recv_timeout(Duration::from_millis(20)).is_err());
    release_tx.send(()).unwrap();
    assert_eq!(
        exit_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("failed drain spawn lost the exit request"),
        7
    );
    assert_eq!(
        std::fs::read_to_string(dir.path.join("Note.md")).unwrap(),
        "saved-via-fallback"
    );
    tauri::async_runtime::block_on(slow).unwrap().unwrap();
    assert!(tauri::async_runtime::block_on(save_reply).is_ok());
    assert!(state.write_queue.on_exit_requested(
        Some(7),
        || panic!("should not prevent after drain"),
        |_| {}
    ));
    assert!(state.write_queue.is_terminated());
}

#[test]
fn ingress_handler_wiring_malformed_requests_and_errors_do_not_stall_queue() {
    let dir = crate::fsutil::tmp_dir("ingress-errors");
    let state = test_state(&dir.path);
    sync_write(&state, |v| v.create_note("Note.md", "start")).unwrap();
    let read = state.write_queue.dispatch_ingress("read_note", 1, || true);
    assert!(read.handled && read.lease.is_none());
    state.write_queue.reserve_ingress(2);
    let refused = state
        .write_queue
        .dispatch_ingress("write_note", 2, || false);
    assert!(!refused.handled && refused.lease.is_none());
    assert!(tauri::async_runtime::block_on(write_vault(
        &state,
        state.write_queue.take_ingress(999),
        |v| v.write_note("Note.md", "unreserved")
    ))
    .is_err());
    let lease3 = hold(&state, "write_note", 3);
    drop(state.write_queue.take_ingress(3));
    drop(lease3);
    let lease4 = hold(&state, "write_file_bytes", 4);
    let (empty_hdrs, raw_body) = (
        tauri::http::HeaderMap::new(),
        tauri::ipc::InvokeBody::Raw(vec![1, 2, 3]),
    );
    let missing = enqueue_write_file_bytes(
        &state,
        state.write_queue.take_ingress(4),
        &empty_hdrs,
        &raw_body,
    );
    drop(lease4);
    assert_eq!(
        tauri::async_runtime::block_on(missing).unwrap_err(),
        "missing x-grove-path"
    );
    let mut hdrs = tauri::http::HeaderMap::new();
    hdrs.insert(
        tauri::http::HeaderName::from_static("x-grove-path"),
        tauri::http::HeaderValue::from_static("pic.png"),
    );
    let json_body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let lease5 = hold(&state, "write_file_bytes", 5);
    let json_res =
        enqueue_write_file_bytes(&state, state.write_queue.take_ingress(5), &hdrs, &json_body);
    drop(lease5);
    assert_eq!(
        tauri::async_runtime::block_on(json_res).unwrap_err(),
        "write_file_bytes expects a raw body, not JSON"
    );
    let lease6 = hold(&state, "write_note", 6);
    let bad = write_vault(&state, state.write_queue.take_ingress(6), |v| {
        v.write_note("../escape.md", "bad")
    });
    drop(lease6);
    assert!(tauri::async_runtime::block_on(bad).is_err());
    let lease7 = hold(&state, "write_file_bytes", 7);
    let wrote =
        enqueue_write_file_bytes(&state, state.write_queue.take_ingress(7), &hdrs, &raw_body);
    drop(lease7);
    assert_eq!(
        tauri::async_runtime::block_on(wrote).unwrap().0.path,
        "pic.png"
    );
    let lease8 = hold(&state, "write_note", 8);
    let recovered = write_vault(&state, state.write_queue.take_ingress(8), |v| {
        v.write_note("Note.md", "recovered")
    });
    drop(lease8);
    tauri::async_runtime::block_on(recovered).unwrap();
    assert_eq!(
        read_vault(&state, |v| v.read_note("Note.md")).unwrap(),
        "recovered"
    );
}
