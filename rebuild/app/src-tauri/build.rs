fn main() {
    // Register each command in the app manifest, so each one needs an explicit
    // `allow-<command>` permission in a capability instead of being open to
    // every window by default.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_vault",
            "create_vault",
            "last_vault",
            "list_files",
            "read_note",
            "read_file_bytes",
            "write_note",
            "set_property",
            "write_file_bytes",
            "create_note",
            "create_folder",
            "rename_path",
            "delete_path",
            "search",
            "search_notes",
            "search_lines",
            "search_match",
            "link_index",
            "backlinks",
            "link_sources",
            "frontmatter",
            "tags",
            "properties",
            "read_config",
            "write_config",
            "open_note_window",
        ]),
    ))
    .expect("failed to run tauri-build");
}
