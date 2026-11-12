fn main() {
    // Piece HZ, fix A2: put the executable's `drmWaitVBlank` (main.rs) in the dynamic symbol
    // table, so libwebkit2gtk's import of it binds to Grove's before libdrm's. Nothing else is
    // exported. Linux only; `-bins` keeps it off the test and library links.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-arg-bins=-Wl,--export-dynamic-symbol=drmWaitVBlank");
    }
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
            "read_clipboard_image",
            "write_clipboard_image",
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
            "read_foreign_config",
            "open_note_window",
            "allow_frame_origin",
        ]),
    ))
    .expect("failed to run tauri-build");
}
