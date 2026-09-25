//! Screen capture for "Insert screenshot": runs the platform's own region-capture tool and
//! returns the PNG. The call blocks until the user finishes selecting, so the transports run
//! it off their main thread (see `api::is_slow`).
//!
//! FOLIO_SCREENSHOT_CMD overrides the tool: a shell command that prints a PNG to stdout
//! (exit non-zero or print nothing to mean "cancelled").

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub enum Shot {
    Png(Vec<u8>),
    Cancelled,
    /// No capture tool on this system (the page falls back to the browser's screen capture).
    NoTool(String),
}

pub fn capture() -> Shot {
    if let Ok(cmd) = std::env::var("FOLIO_SCREENSHOT_CMD")
        && !cmd.trim().is_empty()
    {
        return from_stdout(shell(&cmd));
    }
    platform_capture()
}

#[cfg(unix)]
fn shell(cmd: &str) -> Command {
    let mut c = Command::new("sh");
    c.args(["-c", cmd]);
    c
}
#[cfg(windows)]
fn shell(cmd: &str) -> Command {
    let mut c = Command::new("cmd");
    c.args(["/C", cmd]);
    c
}

/// Run a tool that prints the PNG to stdout.
fn from_stdout(mut c: Command) -> Shot {
    match c.stdin(Stdio::null()).stderr(Stdio::null()).output() {
        Ok(o) if o.status.success() && is_png(&o.stdout) => Shot::Png(o.stdout),
        Ok(_) => Shot::Cancelled,
        Err(e) => Shot::NoTool(format!("couldn't run the screenshot command: {e}")),
    }
}

fn is_png(b: &[u8]) -> bool {
    b.starts_with(b"\x89PNG\r\n\x1a\n")
}

#[cfg_attr(windows, allow(dead_code))]
fn temp_png() -> PathBuf {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("folio-shot-{}-{n}.png", std::process::id()))
}

/// Run a tool that writes the PNG to `file`. None if the tool isn't installed.
#[cfg_attr(windows, allow(dead_code))]
fn to_file(prog: &str, args: &[&str], file: &Path) -> Option<Shot> {
    let status = Command::new(prog)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => Some(Shot::NoTool(format!("{prog}: {e}"))),
        Ok(_) => {
            let png = std::fs::read(file).ok().filter(|b| is_png(b));
            let _ = std::fs::remove_file(file);
            Some(png.map(Shot::Png).unwrap_or(Shot::Cancelled))
        }
    }
}

#[cfg(target_os = "macos")]
fn platform_capture() -> Shot {
    let f = temp_png();
    let fs = f.to_string_lossy().to_string();
    // -i: drag a region (Space switches to a window); -x: no shutter sound.
    to_file("screencapture", &["-i", "-x", &fs], &f)
        .unwrap_or_else(|| Shot::NoTool("screencapture not found".into()))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_capture() -> Shot {
    let f = temp_png();
    let fs = f.to_string_lossy().to_string();
    // Wayland: slurp picks the region, grim captures it.
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        match Command::new("slurp")
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        {
            Ok(o) if o.status.success() => {
                let geom = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if let Some(s) = to_file("grim", &["-g", &geom, &fs], &f) {
                    return s;
                }
            }
            Ok(_) => return Shot::Cancelled,
            Err(_) => {}
        }
    }
    // Desktop tools, then X11 ones. Each lets the user drag a region.
    let tools: [(&str, &[&str]); 6] = [
        ("gnome-screenshot", &["-a", "-f", &fs]),
        ("spectacle", &["-b", "-n", "-r", "-o", &fs]),
        ("xfce4-screenshooter", &["-r", "-s", &fs]),
        ("maim", &["-s", &fs]),
        ("scrot", &["-s", "-o", &fs]),
        ("import", &[&fs]),
    ];
    for (prog, args) in tools {
        if let Some(s) = to_file(prog, args, &f) {
            return s;
        }
    }
    let mut flameshot = Command::new("flameshot");
    flameshot.args(["gui", "--raw"]);
    match from_stdout(flameshot) {
        Shot::NoTool(_) => Shot::NoTool(
            "no screenshot tool found; install grim and slurp (Wayland), gnome-screenshot, spectacle, flameshot or maim".into(),
        ),
        s => s,
    }
}

#[cfg(windows)]
fn platform_capture() -> Shot {
    // No command-line region picker ships with Windows; the page uses the WebView's screen capture.
    Shot::NoTool("no screenshot tool on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn custom_command_output() {
        let png = |cmd: &str| match from_stdout(shell(cmd)) {
            Shot::Png(b) => Some(b.len()),
            Shot::Cancelled => None,
            Shot::NoTool(e) => panic!("{e}"),
        };
        assert_eq!(png(r"printf '\211PNG\r\n\032\nxyz'"), Some(11));
        assert_eq!(png("printf 'not a png'"), None);
        assert_eq!(png("exit 1"), None);
    }
}
