//! Headless smoke of the real vault commands.
//!
//! `MockRuntime` builds no GTK or WebKit window. The commands, the vault, and the
//! watcher flush are the ones the app uses. The temp vault stays under the system
//! temp directory and is removed when the test drops it.

use super::{smoke_commands, AppState, Inner};
use crate::fsutil::tmp_dir;
use crate::model::ChangeKind;
use notify::event::{DataChange, ModifyKind};
use notify::{Event, EventKind};
use std::fs;
use std::sync::mpsc;
use std::time::Duration;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::{Listener, Manager};

fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) {
    let result = get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    );
    if let Err(err) = result {
        panic!("{cmd} failed: {err}");
    }
}

/// Save, rename, and a watcher flush, through the real commands, with no window.
#[test]
fn save_rename_and_flush_round_trip_through_ipc() {
    let dir = tmp_dir("s8-smoke");
    let temp = std::env::temp_dir();
    assert!(
        dir.path.starts_with(&temp),
        "smoke vault must stay under the temp dir, got {}",
        dir.path.display()
    );

    // The watcher thread is not started. `open_vault` only queues a Watch message.
    let (watch_tx, _watch_rx) = mpsc::channel();
    let app = smoke_commands(mock_builder())
        .manage(AppState {
            inner: std::sync::Mutex::new(Inner {
                config_dir: dir.path.join("cfg"),
                vault: None,
            }),
            watch_tx,
        })
        .build(mock_context(noop_assets()))
        .expect("mock app");

    let saver = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("saver window");
    let other = tauri::WebviewWindowBuilder::new(&app, "note-other", Default::default())
        .build()
        .expect("other window");

    let (saver_tx, saver_rx) = mpsc::channel();
    saver.listen("vault-changed", move |event| {
        let _ = saver_tx.send(event.payload().to_string());
    });
    let (other_tx, other_rx) = mpsc::channel();
    other.listen("vault-changed", move |event| {
        let _ = other_tx.send(event.payload().to_string());
    });

    invoke(
        &saver,
        "open_vault",
        serde_json::json!({ "path": dir.path.display().to_string() }),
    );
    assert!(
        dir.path.join("cfg").join("config.json").is_file(),
        "open remembers the vault under the temp config dir"
    );

    let body = "hello from the real backend\n";
    invoke(
        &saver,
        "write_note",
        serde_json::json!({ "path": "Note.md", "content": body }),
    );
    assert_eq!(fs::read_to_string(dir.path.join("Note.md")).unwrap(), body);
    assert!(
        saver_rx.try_recv().is_err(),
        "the window that saved must not hear its own write"
    );
    let heard: serde_json::Value = serde_json::from_str(
        &other_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("the other window should hear vault-changed"),
    )
    .unwrap();
    assert_eq!(heard["kind"], "modify");
    assert_eq!(heard["paths"], serde_json::json!(["Note.md"]));
    assert!(other_rx.try_recv().is_err(), "one save is one event");

    invoke(
        &saver,
        "rename_path",
        serde_json::json!({ "from": "Note.md", "to": "Renamed.md" }),
    );
    assert!(!dir.path.join("Note.md").exists());
    assert_eq!(
        fs::read_to_string(dir.path.join("Renamed.md")).unwrap(),
        body
    );
    assert!(saver_rx.try_recv().is_err());
    assert!(other_rx.try_recv().is_err(), "rename_path does not emit");

    // Close the windows. The bytes have to already be on disk: a new open reads them back.
    drop(saver);
    drop(other);
    let root = {
        let state = app.state::<AppState>();
        let guard = crate::lock(&state.inner);
        guard.vault.as_ref().expect("vault still open").root.clone()
    };
    assert!(root.starts_with(&temp), "{}", root.display());
    let reopened = crate::vault::Vault::open(root.clone()).unwrap();
    assert_eq!(reopened.read_note("Renamed.md").unwrap(), body);
    assert!(reopened.read_note("Note.md").is_err());

    // An edit that did not come from the app, flushed the way the watcher flushes a batch.
    let external = "from outside the app\n";
    fs::write(root.join("external.md"), external).unwrap();
    let event = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Any)))
        .add_path(root.join("external.md"));
    let state = app.state::<AppState>();
    let changes = crate::watch::flush_changes(&state.inner, &[event], crate::index::Index::scan);
    assert!(
        changes
            .iter()
            .any(|change| { change.kind == ChangeKind::Modify && change.paths == ["external.md"] }),
        "flush should report the external edit, got {changes:?}"
    );
    let guard = crate::lock(&state.inner);
    let vault = guard.vault.as_ref().unwrap();
    assert!(
        vault
            .list_files()
            .iter()
            .any(|entry| entry.path == "external.md"),
        "the open index should see the flushed file"
    );
    assert_eq!(vault.read_note("external.md").unwrap(), external);
    assert_eq!(vault.read_note("Renamed.md").unwrap(), body);
}
