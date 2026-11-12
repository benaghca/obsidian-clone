#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    grove_lib::run();
}

/// Fix A2 (piece HZ): libwebkit2gtk binds its `drmWaitVBlank` import to this definition, which
/// `build.rs` exports from the executable. It calls libdrm's real one and steps in only when the
/// driver refuses vblank. See `grove_lib::vblank`.
#[cfg(target_os = "linux")]
#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "C" fn drmWaitVBlank(fd: std::ffi::c_int, vbl: *mut grove_lib::vblank::DrmVBlank) -> std::ffi::c_int {
    grove_lib::vblank::drm_wait_vblank(fd, vbl)
}
