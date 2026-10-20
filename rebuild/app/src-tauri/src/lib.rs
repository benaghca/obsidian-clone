//! Tauri shell for the notes vault.

#[allow(dead_code)]
mod fsutil;
#[allow(dead_code)]
mod model;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running cinder");
}
