//! Cinder — a local, plugin-free, Obsidian-compatible notes app.
//!
//! By default it opens its own desktop window (WebView2 on Windows) and serves
//! the embedded UI to it through an in-process `folio://` protocol, so nothing
//! listens on the network. `--browser` serves the same UI on 127.0.0.1 instead.
//! No plugins, no outbound network access, no telemetry, no auto-update.

// Release builds on Windows are GUI apps: no console window.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod api;
mod config;
mod history;
mod watch;
mod native;
mod pickfolder;
mod screenshot;
mod server;

use std::path::PathBuf;
use std::sync::RwLock;

const HELP: &str = "cinder [VAULT_DIR] [--browser [--port N] [--no-open] [--app]]

VAULT_DIR   folder of .md notes. Default: the last vault you opened,
            or Documents\\Cinder (created if missing).
--browser   serve the UI to a browser tab on 127.0.0.1 instead of
            opening Cinder's own window
  --port N    port for --browser (default 43117)
  --no-open   don't open a browser automatically
  --app       open a chromeless Edge/Chrome window";

fn main() {
    attach_console();
    let mut vault_arg: Option<PathBuf> = None;
    let mut browser = false;
    let mut port = 43117u16;
    let mut open = true;
    let mut app_window = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--browser" => browser = true,
            "--port" | "-p" => {
                browser = true;
                port = args.next().and_then(|p| p.parse().ok()).unwrap_or_else(|| die("--port needs a number"));
            }
            "--no-open" => open = false,
            "--app" => app_window = true,
            "-h" | "--help" => {
                println!("{HELP}");
                return;
            }
            s if s.starts_with('-') => die(&format!("unknown option {s}\n\n{HELP}")),
            s => vault_arg = Some(PathBuf::from(s)),
        }
    }

    let vault = vault_arg.or_else(config::last_vault).unwrap_or_else(config::default_vault);
    if !vault.exists() {
        std::fs::create_dir_all(&vault).unwrap_or_else(|e| die(&format!("can't create vault folder {}: {e}", vault.display())));
    }
    let vault = api::canonical(&vault).unwrap_or_else(|e| die(&format!("bad vault path {}: {e}", vault.display())));
    if !vault.is_dir() {
        die(&format!("{} is not a folder", vault.display()));
    }
    config::remember_vault(&vault);

    let ctx = api::Ctx { vault: RwLock::new(vault), token: random_token(), native: !browser, hide_window: Default::default() };
    if browser {
        server::run(ctx, port, open, app_window)
    } else {
        native::run(ctx)
    }
}

pub fn die(msg: &str) -> ! {
    eprintln!("cinder: {msg}");
    #[cfg(windows)]
    message_box(msg);
    std::process::exit(1);
}

#[cfg(windows)]
fn message_box(msg: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (text, title) = (wide(msg), wide("Cinder"));
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

/// A GUI-subsystem exe has no console; if started from a terminal, print there.
fn attach_console() {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

/// The per-launch secret the page must send with every call: 32 bytes from the operating
/// system's secure random generator, as 64 hex digits. No token, no app: if the generator
/// can't be read, Cinder stops rather than fall back to something guessable.
fn random_token() -> String {
    let mut b = [0u8; 32];
    os_random(&mut b).unwrap_or_else(|e| die(&format!("can't read the system's secure random number generator: {e}")));
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[cfg(unix)]
fn os_random(buf: &mut [u8]) -> std::io::Result<()> {
    use std::io::Read;
    std::fs::File::open("/dev/urandom")?.read_exact(buf)
}

#[cfg(windows)]
fn os_random(buf: &mut [u8]) -> std::io::Result<()> {
    use windows_sys::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};
    let len = u32::try_from(buf.len()).map_err(std::io::Error::other)?;
    // SAFETY: buf is valid and writable for len bytes; no algorithm handle is needed with
    // BCRYPT_USE_SYSTEM_PREFERRED_RNG.
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), buf.as_mut_ptr(), len, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status == 0 { Ok(()) } else { Err(std::io::Error::other(format!("BCryptGenRandom returned {status:#x}"))) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn token_is_256_random_bits() {
        let (a, b) = (super::random_token(), super::random_token());
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
