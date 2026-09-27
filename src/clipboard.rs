//! The clipboard's image, for pasting. WebKitGTK (the Linux window) gives the page an empty paste
//! event when the clipboard holds an image, so the page asks here instead. Reading waits on
//! whichever app owns the clipboard — possibly this one's own window — so the transports run it
//! off their main thread (see `api::is_slow`).

pub enum Clip {
    /// Content type and bytes.
    Image(&'static str, Vec<u8>),
    None,
    /// No clipboard tool on this system.
    NoTool(String),
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn image() -> Clip {
    use std::process::{Command, Stdio};
    let run = |prog: &str, args: &[&str]| match Command::new(prog).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output() {
        Ok(o) if o.status.success() => Ok(Some(o.stdout)),
        Ok(_) => Ok(None),
        Err(e) => Err(e),
    };
    // wl-paste on Wayland, xclip on X11: each lists what the clipboard offers, then reads one type.
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let (prog, list, read): (&str, &[&str], &[&str]) = if wayland {
        ("wl-paste", &["--list-types"], &["--no-newline", "--type"])
    } else {
        ("xclip", &["-selection", "clipboard", "-t", "TARGETS", "-o"], &["-selection", "clipboard", "-o", "-t"])
    };
    let types = match run(prog, list) {
        Ok(Some(out)) => String::from_utf8_lossy(&out).into_owned(),
        Ok(None) => return Clip::None,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Clip::NoTool(format!("install {} to paste images", if wayland { "wl-clipboard" } else { "xclip" }));
        }
        Err(e) => return Clip::NoTool(format!("{prog}: {e}")),
    };
    let Some(ty) = pick_type(&types) else { return Clip::None };
    match run(prog, &[read, &[ty]].concat()) {
        Ok(Some(bytes)) if !bytes.is_empty() => Clip::Image(ty, bytes),
        _ => Clip::None,
    }
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
pub fn image() -> Clip {
    // WebView2 and WKWebView hand pasted images to the page themselves.
    Clip::None
}

/// The image type to read from what the clipboard offers: PNG if it can.
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn pick_type(offered: &str) -> Option<&'static str> {
    const TYPES: [&str; 5] = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
    TYPES.into_iter().find(|t| offered.lines().any(|o| o.trim() == *t))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_png() {
        assert_eq!(pick_type("text/plain\nimage/jpeg\nimage/png\n"), Some("image/png"));
        assert_eq!(pick_type("TARGETS\nimage/bmp\nimage/jpeg"), Some("image/jpeg"));
        assert_eq!(pick_type("text/plain\nUTF8_STRING\nimage/x-exotic"), None);
        assert_eq!(pick_type(""), None);
    }
}
