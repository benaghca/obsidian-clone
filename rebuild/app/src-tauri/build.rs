fn main() {
    // Register each command in the app manifest, so each one needs an explicit
    // `allow-<command>` permission in a capability instead of being open to
    // every window by default.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_vault",
            "last_vault",
            "list_files",
            "read_note",
            "write_note",
            "create_note",
            "create_folder",
            "rename_path",
            "delete_path",
            "search",
            "link_index",
            "read_config",
            "write_config",
        ]),
    ))
    .expect("failed to run tauri-build");
}
