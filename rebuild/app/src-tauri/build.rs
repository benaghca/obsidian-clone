fn main() {
    // Register each command so the capability can allow it. The dev server is a
    // remote origin (http://localhost:1420), and Tauri blocks those commands
    // unless the app manifest lists them.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_vault",
            "last_vault",
            "list_files",
            "read_note",
            "write_note",
            "create_note",
            "rename_path",
            "delete_path",
            "search",
            "link_index",
        ]),
    ))
    .expect("failed to run tauri-build");
}
