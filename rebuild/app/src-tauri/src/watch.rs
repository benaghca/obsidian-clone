//! The debounced watcher is added in the next change. This stub keeps the
//! command wiring able to build.

use std::sync::mpsc;

pub enum WatchMsg {
    Watch(std::path::PathBuf),
}

pub fn run(_app: tauri::AppHandle, _tx: mpsc::Sender<WatchMsg>, rx: mpsc::Receiver<WatchMsg>) {
    while rx.recv().is_ok() {}
}
