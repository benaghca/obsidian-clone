//! The clipboard's image, for pasting.
//!
//! WebKitGTK gives the page an empty paste event when the clipboard holds an image, so the
//! page asks here. The read waits on whichever app owns the clipboard, so the command runs
//! off the GTK thread. Wayland uses `wl-paste`, X11 uses `xclip`, both through `std::process`
//! only. The mime and the arguments come from a fixed list.

use crate::vault::IMAGE_MAX_BYTES;
use std::io::Read;
use std::process::{Command, Stdio};

/// Largest accepted type list. An image uses [`IMAGE_MAX_BYTES`].
const LIST_CAP: u64 = 64 * 1024;

const IMAGE_TYPES: [&str; 5] = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/bmp",
];

/// One image from the clipboard.
#[derive(Debug)]
pub struct Image {
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

/// What `read_clipboard_image` sends.
///
/// No image is JSON `null`. An image is raw bytes: the mime, a newline, then the image.
/// The newline split is only the first byte `0x0A`; image bytes may contain newlines.
pub struct ClipboardBody {
    packed: Option<Vec<u8>>,
}

impl ClipboardBody {
    fn none() -> Self {
        Self { packed: None }
    }

    fn from_image(image: Image) -> Self {
        Self {
            packed: Some(pack_image(image.mime, &image.bytes)),
        }
    }
}

impl tauri::ipc::IpcResponse for ClipboardBody {
    fn body(self) -> tauri::Result<tauri::ipc::InvokeResponseBody> {
        Ok(match self.packed {
            Some(bytes) => tauri::ipc::InvokeResponseBody::Raw(bytes),
            None => tauri::ipc::InvokeResponseBody::Json("null".into()),
        })
    }
}

/// `mime\n` plus the image bytes.
pub fn pack_image(mime: &str, bytes: &[u8]) -> Vec<u8> {
    let mut packed = Vec::with_capacity(mime.len() + 1 + bytes.len());
    packed.extend_from_slice(mime.as_bytes());
    packed.push(b'\n');
    packed.extend_from_slice(bytes);
    packed
}

/// The mime and the image bytes from a packed body.
pub fn split_packed(packed: &[u8]) -> Option<(&str, &[u8])> {
    let nl = packed.iter().position(|b| *b == b'\n')?;
    let mime = std::str::from_utf8(&packed[..nl]).ok()?;
    Some((mime, &packed[nl + 1..]))
}

struct Tool {
    prog: &'static str,
    list: &'static [&'static str],
    read: &'static [&'static str],
    missing: &'static str,
}

fn tool(wayland: bool) -> Tool {
    if wayland {
        Tool {
            prog: "wl-paste",
            list: &["--list-types"],
            read: &["--no-newline", "--type"],
            missing: "install wl-clipboard to paste images",
        }
    } else {
        Tool {
            prog: "xclip",
            list: &["-selection", "clipboard", "-t", "TARGETS", "-o"],
            read: &["-selection", "clipboard", "-o", "-t"],
            missing: "install xclip to paste images",
        }
    }
}

enum ToolOut {
    Bytes(Vec<u8>),
    /// The tool ran and failed, or the clipboard had nothing we can use.
    Empty,
    Missing,
    Failed(String),
    TooBig,
}

/// PNG if the clipboard offers it, otherwise the first known image type.
fn pick_type(offered: &str) -> Option<&'static str> {
    IMAGE_TYPES
        .into_iter()
        .find(|mime| offered.lines().any(|line| line.trim() == *mime))
}

fn read_with(
    wayland: bool,
    mut run: impl FnMut(&str, &[&str], u64) -> ToolOut,
) -> Result<Option<Image>, String> {
    let tool = tool(wayland);
    let offered = match run(tool.prog, tool.list, LIST_CAP) {
        ToolOut::Bytes(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        ToolOut::Empty => return Ok(None),
        ToolOut::Missing => return Err(tool.missing.into()),
        ToolOut::Failed(msg) => return Err(format!("{}: {msg}", tool.prog)),
        ToolOut::TooBig => return Err("clipboard type list is too large".into()),
    };
    let Some(mime) = pick_type(&offered) else {
        return Ok(None);
    };
    let mut args = tool.read.to_vec();
    args.push(mime);
    match run(tool.prog, &args, IMAGE_MAX_BYTES) {
        ToolOut::Bytes(bytes) if bytes.len() as u64 > IMAGE_MAX_BYTES => {
            Err("too large to paste".into())
        }
        ToolOut::Bytes(bytes) if !bytes.is_empty() => Ok(Some(Image { mime, bytes })),
        ToolOut::TooBig => Err("too large to paste".into()),
        ToolOut::Missing => Err(tool.missing.into()),
        ToolOut::Failed(msg) => Err(format!("{}: {msg}", tool.prog)),
        ToolOut::Bytes(_) | ToolOut::Empty => Ok(None),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_tool(prog: &str, args: &[&str], cap: u64) -> ToolOut {
    match spawn_capture(prog, args, cap) {
        Ok(Capture::Bytes(bytes)) => ToolOut::Bytes(bytes),
        Ok(Capture::Empty) => ToolOut::Empty,
        Ok(Capture::TooBig) => ToolOut::TooBig,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ToolOut::Missing,
        Err(err) => ToolOut::Failed(err.to_string()),
    }
}

#[derive(Debug)]
enum Capture {
    Bytes(Vec<u8>),
    Empty,
    TooBig,
}

/// Read at most `cap` bytes of stdout. A longer stream is killed and reported as too big.
#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_capture(prog: &str, args: &[&str], cap: u64) -> std::io::Result<Capture> {
    let mut child = Command::new(prog)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()?;
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "clipboard tool has no stdout",
        ));
    };
    let mut buf = Vec::new();
    let read = Read::take(&mut stdout, cap.saturating_add(1)).read_to_end(&mut buf);
    drop(stdout);
    if buf.len() as u64 > cap {
        let _ = child.kill();
        let _ = child.wait();
        let _ = read;
        return Ok(Capture::TooBig);
    }
    let status = child.wait()?;
    read?;
    if status.success() {
        Ok(Capture::Bytes(buf))
    } else {
        Ok(Capture::Empty)
    }
}

/// The clipboard image, or `Ok(None)` when there is none.
///
/// A missing tool is an error (`install wl-clipboard to paste images` or
/// `install xclip to paste images`). On macOS and Windows the webview hands the
/// image to the page, so this returns `Ok(None)`.
pub fn read_clipboard_image() -> Result<Option<Image>, String> {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        read_with(wayland, run_tool)
    }
    #[cfg(not(all(unix, not(target_os = "macos"))))]
    {
        Ok(None)
    }
}

pub fn command_body() -> Result<ClipboardBody, String> {
    read_clipboard_image().map(|image| match image {
        Some(image) => ClipboardBody::from_image(image),
        None => ClipboardBody::none(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::IpcResponse;

    fn owned(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_string()).collect()
    }

    #[test]
    fn prefers_png_then_the_other_image_types() {
        assert_eq!(
            pick_type("text/plain\nimage/jpeg\nimage/png\n"),
            Some("image/png")
        );
        assert_eq!(
            pick_type("TARGETS\nimage/bmp\nimage/jpeg"),
            Some("image/jpeg")
        );
        assert_eq!(pick_type("image/gif"), Some("image/gif"));
        assert_eq!(pick_type("image/webp\nimage/bmp"), Some("image/webp"));
        assert_eq!(pick_type("text/plain\nUTF8_STRING\nimage/x-exotic"), None);
        assert_eq!(pick_type("image/png;charset=utf-8"), None);
        assert_eq!(pick_type("IMAGE/PNG"), None);
        assert_eq!(pick_type(""), None);
        assert_eq!(pick_type("  image/png  \r\ntext/plain"), Some("image/png"));
    }

    #[test]
    fn wayland_lists_types_then_reads_png() {
        let mut calls = Vec::new();
        let image = read_with(true, |prog, args, cap| {
            calls.push((prog.to_string(), owned(args), cap));
            if args == ["--list-types"] {
                ToolOut::Bytes(b"text/plain\nimage/jpeg\nimage/png\n".to_vec())
            } else {
                ToolOut::Bytes(b"PNGDATA".to_vec())
            }
        })
        .unwrap()
        .unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, "wl-paste");
        assert_eq!(calls[0].1, ["--list-types"]);
        assert_eq!(calls[0].2, LIST_CAP);
        assert_eq!(calls[1].1, ["--no-newline", "--type", "image/png"]);
        assert_eq!(calls[1].2, IMAGE_MAX_BYTES);
        assert_eq!(image.mime, "image/png");
        assert_eq!(image.bytes, b"PNGDATA");
    }

    #[test]
    fn x11_uses_xclip_and_skips_the_read_when_nothing_is_an_image() {
        let mut calls = Vec::new();
        let image = read_with(false, |prog, args, _cap| {
            calls.push((prog.to_string(), owned(args)));
            ToolOut::Bytes(b"TARGETS\nUTF8_STRING\ntext/plain\n".to_vec())
        })
        .unwrap();
        assert!(image.is_none());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "xclip");
        assert_eq!(
            calls[0].1,
            ["-selection", "clipboard", "-t", "TARGETS", "-o"]
        );
    }

    #[test]
    fn x11_reads_the_chosen_type() {
        let mut read_args = None;
        let image = read_with(false, |_prog, args, _cap| {
            if args.iter().any(|arg| *arg == "TARGETS") {
                ToolOut::Bytes(b"image/bmp\n".to_vec())
            } else {
                read_args = Some(owned(args));
                ToolOut::Bytes(b"BM".to_vec())
            }
        })
        .unwrap()
        .unwrap();
        assert_eq!(
            read_args.unwrap(),
            ["-selection", "clipboard", "-o", "-t", "image/bmp"]
        );
        assert_eq!(image.mime, "image/bmp");
        assert_eq!(image.bytes, b"BM");
    }

    #[test]
    fn a_missing_tool_is_a_clear_error() {
        let wayland = read_with(true, |_, _, _| ToolOut::Missing).unwrap_err();
        assert_eq!(wayland, "install wl-clipboard to paste images");
        let x11 = read_with(false, |_, _, _| ToolOut::Missing).unwrap_err();
        assert_eq!(x11, "install xclip to paste images");
        let failed =
            read_with(false, |_, _, _| ToolOut::Failed("permission denied".into())).unwrap_err();
        assert_eq!(failed, "xclip: permission denied");
    }

    #[test]
    fn an_empty_clipboard_is_not_an_error() {
        assert!(read_with(true, |_, _, _| ToolOut::Empty).unwrap().is_none());
        let image = read_with(true, |_, args, _| {
            if args == ["--list-types"] {
                ToolOut::Bytes(b"image/png\n".to_vec())
            } else {
                ToolOut::Bytes(Vec::new())
            }
        })
        .unwrap();
        assert!(image.is_none());
    }

    #[test]
    fn an_oversized_image_or_type_list_is_refused() {
        let image = read_with(true, |_, args, _| {
            if args == ["--list-types"] {
                ToolOut::Bytes(b"image/jpeg\n".to_vec())
            } else {
                ToolOut::TooBig
            }
        })
        .unwrap_err();
        assert_eq!(image, "too large to paste");
        let listed = read_with(false, |_, _, _| ToolOut::TooBig).unwrap_err();
        assert_eq!(listed, "clipboard type list is too large");
        let kept = read_with(true, |_, args, _| {
            if args == ["--list-types"] {
                ToolOut::Bytes(b"image/png\n".to_vec())
            } else {
                ToolOut::Bytes(vec![1, 2, 3, 4])
            }
        })
        .unwrap()
        .unwrap();
        assert_eq!(kept.bytes, vec![1, 2, 3, 4]);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn spawn_capture_stops_a_stream_past_the_cap() {
        // `dd` writes far more than the cap. The capture must stop, kill it, and
        // return no bytes.
        let got = spawn_capture("dd", &["if=/dev/zero", "bs=4096", "count=64"], 1024);
        match got {
            Ok(Capture::TooBig) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                panic!("dd is not installed; the size-cap test needs it");
            }
            other => panic!("expected the cap to stop the read, got {other:?}"),
        }
    }

    #[test]
    fn packed_body_is_a_mime_line_then_the_unchanged_bytes() {
        let packed = pack_image("image/png", &[0, 10, 255, b'\n', 1]);
        let (mime, bytes) = split_packed(&packed).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, &[0, 10, 255, b'\n', 1]);
        let body = ClipboardBody::from_image(Image {
            mime: "image/jpeg",
            bytes: b"abc".to_vec(),
        });
        match body.body().unwrap() {
            tauri::ipc::InvokeResponseBody::Raw(raw) => {
                assert_eq!(split_packed(&raw).unwrap(), ("image/jpeg", &b"abc"[..]));
            }
            other => panic!("expected raw bytes, got {other:?}"),
        }
        match ClipboardBody::none().body().unwrap() {
            tauri::ipc::InvokeResponseBody::Json(json) => assert_eq!(json, "null"),
            other => panic!("expected null, got {other:?}"),
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn a_program_that_is_not_installed_is_missing() {
        let prog = std::env::temp_dir().join(format!(
            "grove-i1-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        assert!(!prog.exists(), "refusing to run {}", prog.display());
        let out = run_tool(prog.to_str().unwrap(), &["--list-types"], 128);
        assert!(
            matches!(out, ToolOut::Missing),
            "a missing tool must not run"
        );
    }
}
