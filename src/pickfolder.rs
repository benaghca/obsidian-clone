//! "Open folder…" for the vault switcher: the system's own folder picker, run as a helper
//! program (PowerShell's folder dialog on Windows, `choose folder` on macOS, zenity or kdialog
//! on Linux). It waits for the user, so the transports run it off their main thread.
//!
//! CINDER_FOLDER_PICKER overrides it: "none" for no picker (the page's own browser), or a shell
//! command that prints the chosen folder (exit non-zero or print nothing to cancel).

use std::process::{Command, Stdio};

pub enum Picked {
    Path(String),
    Cancelled,
    /// No picker on this system; the page shows its own folder browser instead.
    NoTool,
}

/// The picker, unless CINDER_FOLDER_PICKER says otherwise.
pub fn pick(start: &str) -> Picked {
    match std::env::var("CINDER_FOLDER_PICKER") {
        Ok(v) if v.trim() == "none" => Picked::NoTool,
        Ok(cmd) if !cmd.trim().is_empty() => {
            let mut c = Command::new(if cfg!(windows) { "cmd" } else { "sh" });
            c.args([if cfg!(windows) { "/C" } else { "-c" }, &cmd]).env("CINDER_START", start);
            run(c).unwrap_or(Picked::NoTool)
        }
        _ => system_pick(start),
    }
}

fn run(mut c: Command) -> Option<Picked> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    }
    match c.stdin(Stdio::null()).stderr(Stdio::null()).output() {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => Some(Picked::NoTool),
        Ok(o) => {
            let raw = String::from_utf8_lossy(&o.stdout).trim().to_string();
            // no trailing separator, except for a root like "/" or "C:\"
            let p = if raw.len() > 3 { raw.trim_end_matches(['/', '\\']).to_string() } else { raw };
            Some(if o.status.success() && !p.is_empty() { Picked::Path(p) } else { Picked::Cancelled })
        }
    }
}

#[cfg(windows)]
fn system_pick(start: &str) -> Picked {
    // The start folder goes in through an environment variable, never into the script's text:
    // PowerShell treats curly quotes as string delimiters too, so a folder named "Bob’s notes"
    // would otherwise end the string early, and a crafted name could run commands.
    // A top-most owner keeps the dialog in front of Cinder's window.
    let script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; \
         $o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; \
         $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder for your vault'; \
         $d.ShowNewFolderButton = $true; $d.SelectedPath = $env:CINDER_START; \
         if ($d.ShowDialog($o) -eq 'OK') { $d.SelectedPath } else { exit 1 }";
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script]).env("CINDER_START", start);
    run(c).unwrap_or(Picked::NoTool)
}

#[cfg(target_os = "macos")]
fn system_pick(_start: &str) -> Picked {
    let mut c = Command::new("osascript");
    c.args(["-e", "POSIX path of (choose folder with prompt \"Choose a folder for your vault\")"]);
    run(c).unwrap_or(Picked::NoTool)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn system_pick(start: &str) -> Picked {
    let start_slash = format!("{}/", start.trim_end_matches('/'));
    let mut z = Command::new("zenity");
    z.args(["--file-selection", "--directory", "--title=Choose a folder for your vault", &format!("--filename={start_slash}")]);
    if let Some(p) = run(z) {
        return p;
    }
    let mut k = Command::new("kdialog");
    k.args(["--getexistingdirectory", start, "--title", "Choose a folder for your vault"]);
    if let Some(p) = run(k) {
        return p;
    }
    let mut y = Command::new("yad");
    y.args(["--file", "--directory", "--title=Choose a folder for your vault", &format!("--filename={start_slash}")]);
    run(y).unwrap_or(Picked::NoTool)
}
