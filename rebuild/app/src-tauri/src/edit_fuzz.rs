//! K7: differential fuzz, crash injection, and an external writer racing `set_property`.
//! Crash and race tests use `src-tauri/target/k7-scratch` (gitignored), which is on the
//! real disk. `/tmp` is tmpfs here, so fsync would be free and would hide ordering.

use crate::edit::{edit_property, EditResult, PropertyEdit, Target, Typed};
use crate::fsutil::{self, CrashPoint};
use crate::index::props::{PropertyType, PropertyValue};
use crate::vault::Vault;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

fn text_edit(expect: &str, value: &str) -> PropertyEdit {
    PropertyEdit {
        key: "status".into(),
        expect: Some(expect.into()),
        to: Some(Target::Typed(Typed {
            kind: PropertyType::Text,
            value: PropertyValue::Text(value.into()),
        })),
    }
}

fn status_of(result: &EditResult) -> &'static str {
    match result {
        EditResult::Done { .. } => "done",
        EditResult::Unchanged { .. } => "unchanged",
        EditResult::Conflict { .. } => "conflict",
        EditResult::Refused { .. } => "refused",
    }
}

fn unescape_mount(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 3 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&text[i + 1..i + 4], 8) {
                out.push(value as char);
                i += 4;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn filesystem_type(path: &Path) -> String {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let text = fs::read_to_string("/proc/mounts").unwrap_or_default();
    let mut best_len = 0usize;
    let mut best = String::from("unknown");
    for line in text.lines() {
        let mut parts = line.split(' ');
        let _device = parts.next();
        let (Some(mount), Some(kind)) = (parts.next(), parts.next()) else {
            continue;
        };
        let mount = unescape_mount(mount);
        if path.starts_with(&mount) && mount.len() >= best_len {
            best_len = mount.len();
            best = kind.to_string();
        }
    }
    best
}

struct Scratch {
    path: PathBuf,
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn scratch(label: &str) -> Scratch {
    static N: AtomicU64 = AtomicU64::new(0);
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/k7-scratch");
    fs::create_dir_all(&root).unwrap();
    let kind = filesystem_type(&root);
    assert!(
        !matches!(kind.as_str(), "tmpfs" | "ramfs" | "devtmpfs"),
        "crash and race tests need a real disk, found {kind} at {}",
        root.display()
    );
    eprintln!("K7_DISK {kind} {}", root.display());
    let n = N.fetch_add(1, Ordering::Relaxed);
    let path = root.join(format!("{label}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    Scratch { path }
}

fn temps(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                stack.push(entry.path());
            } else if entry
                .file_name()
                .to_string_lossy()
                .contains(fsutil::TEMP_MARK)
            {
                found.push(entry.path());
            }
        }
    }
    found
}

fn dead_temp_name(name: &str) -> String {
    let rest = name.strip_suffix(fsutil::TEMP_MARK).expect("temp mark");
    let (rest, nanos) = rest.rsplit_once('.').unwrap();
    let (rest, _pid) = rest.rsplit_once('.').unwrap();
    format!("{rest}.{}.{nanos}{}", u32::MAX, fsutil::TEMP_MARK)
}

struct Disarm;
impl Drop for Disarm {
    fn drop(&mut self) {
        fsutil::crash_at(None);
    }
}

const OLD: &str = "---\nstatus: todo\nkeep: same\n---\nK7BODY-crash\n";

fn open_note(dir: &Path, text: &str) -> Vault {
    fs::write(dir.join("Note.md"), text).unwrap();
    Vault::open(dir.to_path_buf()).unwrap()
}

#[test]
fn crash_before_rename_keeps_the_old_note_and_the_sweep_removes_the_temp() {
    let _disarm = Disarm;
    let dir = scratch("rename");
    let mut vault = open_note(&dir.path, OLD);
    let edit = text_edit("status: todo", "doing");
    let new_text = edit_property(OLD, &edit)
        .text
        .expect("the edit itself is valid");
    assert_ne!(new_text, OLD);
    fsutil::crash_at(Some(CrashPoint::BeforeRename));
    let err = vault.set_property("Note.md", &edit, false).unwrap_err();
    assert!(err.contains("injected crash before rename"), "{err}");
    assert_eq!(fs::read_to_string(dir.path.join("Note.md")).unwrap(), OLD);
    let left = temps(&dir.path);
    assert_eq!(
        left.len(),
        1,
        "the killed write leaves its own temp: {left:?}"
    );
    assert_eq!(
        fs::read_to_string(&left[0]).unwrap(),
        new_text,
        "the temp is the whole new note, not a prefix"
    );
    assert_eq!(
        fsutil::sweep_temps(&dir.path).unwrap(),
        0,
        "a live process still owns this temp"
    );
    assert!(left[0].exists());
    let dead = left[0].with_file_name(dead_temp_name(
        &left[0].file_name().unwrap().to_string_lossy(),
    ));
    fs::rename(&left[0], &dead).unwrap();
    assert_eq!(fsutil::sweep_temps(&dir.path).unwrap(), 1);
    assert!(!dead.exists());
    assert_eq!(fs::read_to_string(dir.path.join("Note.md")).unwrap(), OLD);
    assert!(temps(&dir.path).is_empty());
    assert_eq!(
        status_of(&vault.set_property("Note.md", &edit, false).unwrap()),
        "done"
    );
    assert_eq!(
        fs::read_to_string(dir.path.join("Note.md")).unwrap(),
        new_text
    );
    assert!(temps(&dir.path).is_empty());
}

#[test]
fn crash_before_directory_sync_keeps_the_new_note_and_leaves_no_temp() {
    let _disarm = Disarm;
    let dir = scratch("dirsync");
    let mut vault = open_note(&dir.path, OLD);
    let edit = text_edit("status: todo", "doing");
    let new_text = edit_property(OLD, &edit)
        .text
        .expect("the edit itself is valid");
    fsutil::crash_at(Some(CrashPoint::BeforeDirSync));
    let err = vault.set_property("Note.md", &edit, false).unwrap_err();
    assert!(
        err.contains("injected crash before directory sync"),
        "{err}"
    );
    assert_eq!(
        fs::read_to_string(dir.path.join("Note.md")).unwrap(),
        new_text
    );
    assert!(
        temps(&dir.path).is_empty(),
        "the rename already consumed the temp"
    );
    assert_eq!(fsutil::sweep_temps(&dir.path).unwrap(), 0);
    assert_eq!(
        fs::read_to_string(dir.path.join("Note.md")).unwrap(),
        new_text
    );
}

// Only the parent below invokes this test, in a new process with its own scratch path.
#[test]
#[ignore]
fn crash_child() {
    let Some(path) = std::env::var_os("K7_CRASH_CHILD") else {
        return;
    };
    let path = PathBuf::from(path);
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/k7-scratch")
        .canonicalize()
        .unwrap();
    assert!(path.canonicalize().unwrap().starts_with(root));
    let mut vault = Vault::open(path).unwrap();
    let point = match std::env::var("K7_CRASH_POINT").unwrap().as_str() {
        "rename" => CrashPoint::BeforeRename,
        "dirsync" => CrashPoint::BeforeDirSync,
        _ => panic!("invalid child crash point"),
    };
    fsutil::crash_process_at(point);
    let _ = vault.set_property("Note.md", &text_edit("status: todo", "doing"), false);
    panic!("child did not exit at its armed crash point");
}

#[test]
fn killed_writer_is_old_or_new_and_reopen_sweeps_only_its_dead_temp() {
    for point in ["rename", "dirsync"] {
        let dir = scratch(point);
        fs::write(dir.path.join("Note.md"), OLD).unwrap();
        let lookalikes = ["notes.grove-tmp", ".x.grove-tmp", ".a.1.x.grove-tmp"];
        let live = format!(".live.md.{}.1.grove-tmp", std::process::id());
        for name in lookalikes.iter().copied().chain([live.as_str()]) {
            fs::write(dir.path.join(name), b"keep these exact bytes").unwrap();
        }
        let exit = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "edit_fuzz::crash_child", "--ignored"])
            .env("K7_CRASH_CHILD", &dir.path)
            .env("K7_CRASH_POINT", point)
            .output()
            .unwrap();
        assert_eq!(
            exit.status.code(),
            Some(86),
            "child: {}",
            String::from_utf8_lossy(&exit.stderr)
        );
        let new = edit_property(OLD, &text_edit("status: todo", "doing"))
            .text
            .unwrap();
        let expected = if point == "rename" { OLD } else { &new };
        assert_eq!(
            fs::read(dir.path.join("Note.md")).unwrap(),
            expected.as_bytes()
        );
        let dead: Vec<_> = temps(&dir.path)
            .into_iter()
            .filter(|p| !lookalikes.iter().any(|n| p.ends_with(n)) && !p.ends_with(&live))
            .collect();
        assert_eq!(dead.len(), usize::from(point == "rename"));
        for temp in &dead {
            assert_eq!(fs::read(temp).unwrap(), new.as_bytes());
        }
        // Unlike the in-process error simulation, this uses the real child's dead PID.
        let _reopened = Vault::open(dir.path.clone()).unwrap();
        assert!(dead.iter().all(|p| !p.exists()));
        assert_eq!(
            fs::read(dir.path.join("Note.md")).unwrap(),
            expected.as_bytes()
        );
        for name in lookalikes.iter().copied().chain([live.as_str()]) {
            assert_eq!(
                fs::read(dir.path.join(name)).unwrap(),
                b"keep these exact bytes"
            );
        }
    }
}

#[test]
fn non_utf8_is_refused_and_the_bytes_stay() {
    let dir = scratch("utf8");
    let bytes = b"\xFF\xFEnot utf-8\n";
    fs::write(dir.path.join("Note.md"), bytes).unwrap();
    let mut vault = Vault::open(dir.path.clone()).unwrap();
    let result = vault
        .set_property("Note.md", &text_edit("status: todo", "doing"), false)
        .unwrap();
    match result {
        EditResult::Refused { reason } => assert_eq!(reason, "Note is not UTF-8"),
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert_eq!(fs::read(dir.path.join("Note.md")).unwrap(), bytes);
    assert!(temps(&dir.path).is_empty());
}

#[test]
fn a_racing_writer_never_leaves_a_torn_note() {
    let dir = scratch("race");
    let path = dir.path.join("Note.md");
    let old = "---\nstatus: todo\nkeep: same\n---\nK7BODY-A\n";
    let other = "---\nstatus: other\nkeep: same\n---\nK7BODY-B\n";
    let edit = text_edit("status: todo", "doing");
    let edited = edit_property(old, &edit)
        .text
        .expect("edit of the original");
    fs::write(&path, old).unwrap();
    let mut vault = Vault::open(dir.path.clone()).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let generations = Arc::new(AtomicU64::new(0));
    let tick = Arc::clone(&generations);
    let raced = path.clone();
    let writer = thread::spawn(move || {
        let mut wrote = 0u64;
        let mut n = 0u64;
        while !flag.load(Ordering::Relaxed) {
            let bytes = if n % 2 == 0 {
                old.as_bytes()
            } else {
                other.as_bytes()
            };
            if fsutil::atomic_write(&raced, bytes).is_ok() {
                wrote += 1;
                tick.fetch_add(1, Ordering::Relaxed);
            }
            n += 1;
            thread::yield_now();
        }
        wrote
    });
    // Each edit waits until the racer has replaced the file again. A lost update in the
    // stat-to-rename window is still one of the complete documents checked below.
    let started = std::time::Instant::now();
    let mut seen = 0u64;
    let mut edits = 0u64;
    let allowed = [old.as_bytes(), other.as_bytes(), edited.as_bytes()];
    let mut torn = None;
    let mut reads = 0;
    while edits < 20 && started.elapsed() < std::time::Duration::from_secs(20) {
        // Sample while the writer is active, not just after it stops: a later good
        // replacement must not conceal a torn intermediate note.
        let got = fs::read(&path).unwrap();
        reads += 1;
        if !allowed.contains(&got.as_slice()) {
            torn = Some(got);
            break;
        }
        let now = generations.load(Ordering::Relaxed);
        if now == seen {
            thread::yield_now();
            continue;
        }
        seen = now;
        let _ = vault.set_property("Note.md", &edit, false);
        edits += 1;
    }
    stop.store(true, Ordering::Relaxed);
    let wrote = writer.join().unwrap();
    assert!(torn.is_none(), "torn intermediate note: {torn:?}");
    assert!(
        edits >= 20 && wrote >= 20,
        "the race did not overlap: {edits} edits, {wrote} racer writes"
    );
    let got = fs::read(&path).unwrap();
    assert!(
        allowed.iter().any(|candidate| *candidate == got.as_slice()),
        "torn or mixed note ({} bytes): {:?}",
        got.len(),
        String::from_utf8_lossy(&got)
    );
    assert!(temps(&dir.path).is_empty());
    eprintln!("K7_RACE racer_writes={wrote} reads={reads}");
}

#[derive(Deserialize)]
struct FuzzFile {
    cases: Vec<FuzzCase>,
}

#[derive(Deserialize)]
struct FuzzCase {
    name: String,
    input: String,
    edit: PropertyEdit,
    status: String,
    before: Option<String>,
    after: Option<String>,
    current: Option<String>,
    reason: Option<String>,
    text: String,
}

fn opt_pair(label: &str, name: &str, ts: &Option<String>, rust: &Option<String>) {
    assert_eq!(ts, rust, "{name} {label}\n ts={ts:?}\n rust={rust:?}");
}

#[test]
fn differential_fuzz_matches_the_typescript_reference() {
    let app = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut cmd = Command::new("node");
    cmd.arg("--experimental-strip-types")
        .arg("scripts/fuzz-property-edit.mjs")
        .arg("--json")
        .current_dir(&app);
    if let Ok(value) = std::env::var("K7_FUZZ_CASES") {
        cmd.env("K7_FUZZ_CASES", value);
    }
    if let Ok(value) = std::env::var("K7_FUZZ_HUGE_BYTES") {
        cmd.env("K7_FUZZ_HUGE_BYTES", value);
    }
    let out = cmd.output().expect("node runs the fuzz script");
    assert!(
        out.status.success(),
        "fuzz script failed\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let file: FuzzFile = serde_json::from_slice(&out.stdout).expect("fuzz JSON");
    assert!(file.cases.len() >= 26, "the fixed corpus is missing cases");
    let names: Vec<_> = file.cases.iter().map(|c| c.name.as_str()).collect();
    for required in [
        "bom",
        "crlf",
        "flow-list",
        "comment-in-value",
        "duplicate-keys",
        "huge",
    ] {
        assert!(names.contains(&required), "missing {required}");
    }
    for case in &file.cases {
        let prepared = edit_property(&case.input, &case.edit);
        assert_eq!(status_of(&prepared.result), case.status, "{}", case.name);
        let rust_text = prepared.text.unwrap_or_else(|| case.input.clone());
        if rust_text != case.text {
            let at = rust_text
                .chars()
                .zip(case.text.chars())
                .position(|(a, b)| a != b)
                .unwrap_or(rust_text.len().min(case.text.len()));
            panic!(
                "{} text differs at {at} (rust {}, ts {})",
                case.name,
                rust_text.len(),
                case.text.len()
            );
        }
        match &prepared.result {
            EditResult::Done { before, after, .. }
            | EditResult::Unchanged { before, after, .. } => {
                opt_pair("before", &case.name, &case.before, before);
                opt_pair("after", &case.name, &case.after, after);
            }
            EditResult::Conflict { current } => {
                opt_pair("current", &case.name, &case.current, current)
            }
            EditResult::Refused { reason } => assert_eq!(
                case.reason.as_deref(),
                Some(reason.as_str()),
                "{}",
                case.name
            ),
        }
        if let Some(marker) = case
            .input
            .split_whitespace()
            .find(|w| w.starts_with("K7BODY-"))
        {
            assert_eq!(rust_text.matches(marker).count(), 1, "{} body", case.name);
        }
    }
}
