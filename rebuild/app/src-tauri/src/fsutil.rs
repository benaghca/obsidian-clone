//! Path checks and atomic file writes. User paths stay inside the vault.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Marker on temp files created by [`atomic_write`]. The watcher ignores these.
pub const TEMP_MARK: &str = ".grove-tmp";

/// The vault's own settings folder (Grove's `.obsidian/`). Hidden like the others: never
/// listed, searched, indexed or reported by the watcher; only the config commands touch it.
pub const CONFIG_DIR: &str = ".grove";

const SKIP_DIRS: &[&str] = &[".obsidian", ".git", ".trash", CONFIG_DIR];

pub fn mtime_ms(md: &fs::Metadata) -> u64 {
    epoch_ms(md.modified())
}

/// When the file was created (its modified time where the file system doesn't keep that).
pub fn ctime_ms(md: &fs::Metadata) -> u64 {
    epoch_ms(md.created().or_else(|_| md.modified()))
}

fn epoch_ms(time: io::Result<SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

pub fn is_ignored_rel(rel: &str) -> bool {
    rel.split('/').any(ignored_component)
}

fn ignored_component(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || name.contains(TEMP_MARK)
}

/// Vault-relative path using `/`, rejecting escapes and hidden vault folders.
pub fn normalize_rel(rel: &str) -> Result<String, String> {
    if rel.is_empty()
        || rel.starts_with('/')
        || rel.contains('\\')
        || rel.contains('\0')
        || rel.contains(':')
        || rel
            .split('/')
            .any(|c| c.is_empty() || c == "." || c == ".." || ignored_component(c))
    {
        return Err(format!("invalid path: {rel}"));
    }
    Ok(rel.to_string())
}

/// `(relative, absolute)` for a user path, after symlink checks.
pub fn resolve_in_vault(root: &Path, rel: &str) -> Result<(String, PathBuf), String> {
    let rel = normalize_rel(rel)?;
    let full = root.join(&rel);
    ensure_inside(root, &full)?;
    Ok((rel, full))
}

/// Vault-relative form of an absolute path, or `None` when it is outside or ignored.
pub fn rel_of(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None;
    }
    let s = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    (!s.is_empty() && !is_ignored_rel(&s)).then_some(s)
}

fn ensure_inside(root: &Path, full: &Path) -> Result<(), String> {
    let mut probe = full.to_path_buf();
    loop {
        if probe.exists() {
            let real = probe.canonicalize().map_err(|e| e.to_string())?;
            if !real.starts_with(root) {
                return Err(format!("invalid path: {}", full.display()));
            }
            return Ok(());
        }
        if !probe.pop() {
            return Err(format!("invalid path: {}", full.display()));
        }
    }
}

/// Largest settings file the config commands read or write.
pub const CONFIG_MAX_BYTES: usize = 1 << 20;

/// Absolute path of a settings file in the vault's config folder. `name` must be a plain
/// lower-case file name ending in `.json` (`app.json`, `core-plugins.json`): no folders, no
/// dots before the extension, so nothing outside `.grove/` can be named. The folder itself
/// must not lead outside the vault (a symlinked `.grove` is refused).
pub fn config_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    let stem = name
        .strip_suffix(".json")
        .ok_or_else(|| format!("invalid config name: {name}"))?;
    let valid = !stem.is_empty()
        && stem.len() <= 64
        && stem
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !valid {
        return Err(format!("invalid config name: {name}"));
    }
    let full = root.join(CONFIG_DIR).join(name);
    ensure_inside(root, &full)?;
    Ok(full)
}

/// Write `bytes` via a temp file in the same directory, then rename over `path`, keeping the
/// old file's permissions. The file is synced before the rename.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    replace(path, bytes, false)
}

/// [`atomic_write`], then the folder is synced as well, so the rename itself survives a power
/// loss (KANBAN_PLAN §4.3). That doubles a write's cost on a real disk (about 4 → 9 ms on
/// btrfs), so only `set_property`, which runs off the GTK thread, uses it; note and settings
/// saves run on the main thread and keep the plain write.
pub fn atomic_write_durable(path: &Path, bytes: &[u8]) -> io::Result<()> {
    replace(path, bytes, true)
}

fn replace(path: &Path, bytes: &[u8], sync_dir: bool) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    // Opened before the rename: a folder that can't be opened must fail before the note changes.
    #[cfg(unix)]
    let directory = if sync_dir {
        Some(fs::File::open(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )?)
    } else {
        None
    };
    #[cfg(not(unix))]
    let _ = sync_dir;
    let tmp = temp_path_for(path);
    let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    #[cfg(test)]
    let mut leave_temp = false;
    let write_res = (|| -> io::Result<()> {
        let permissions = match fs::metadata(path) {
            Ok(old) => Some(old.permissions()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(e) => return Err(e),
        };
        file.write_all(bytes)?;
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        sync_file(&file)?;
        // A killed process stops here or after the rename. The hook exists only in test
        // builds: release `replace` does not read it and does not branch on it.
        #[cfg(test)]
        if take_crash(CrashPoint::BeforeRename) {
            leave_temp = true;
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "injected crash before rename",
            ));
        }
        fs::rename(&tmp, path)?;
        #[cfg(test)]
        if take_crash(CrashPoint::BeforeDirSync) {
            leave_temp = true;
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "injected crash before directory sync",
            ));
        }
        #[cfg(unix)]
        if let Some(directory) = &directory {
            sync_file(directory)?;
        }
        Ok(())
    })();
    drop(file);
    if write_res.is_err() {
        // An injected crash leaves the temp for the open-time sweep, as a dead process would.
        #[cfg(test)]
        if leave_temp {
            return write_res;
        }
        let _ = fs::remove_file(&tmp);
    }
    write_res
}

/// Where a test build aborts [`atomic_write`] / [`atomic_write_durable`]. Release builds have
/// neither the flag nor the checks.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CrashPoint {
    /// Temp file is complete and synced. The note is still the old bytes.
    BeforeRename,
    /// The note is already the new bytes. The folder has not been synced.
    BeforeDirSync,
}

#[cfg(test)]
thread_local! {
    static CRASH_AT: std::cell::Cell<Option<CrashPoint>> = const { std::cell::Cell::new(None) };
    static EXIT_ON_CRASH: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Arm the next write on this thread. `None` disarms it. The point fires once.
#[cfg(test)]
pub fn crash_at(point: Option<CrashPoint>) {
    CRASH_AT.with(|slot| slot.set(point));
    EXIT_ON_CRASH.with(|slot| slot.set(false));
}

/// Child-process tests stop without unwinding, cleanup, or returning to the writer.
#[cfg(test)]
pub fn crash_process_at(point: CrashPoint) {
    crash_at(Some(point));
    EXIT_ON_CRASH.with(|slot| slot.set(true));
}

#[cfg(test)]
fn take_crash(point: CrashPoint) -> bool {
    CRASH_AT.with(|slot| {
        if slot.get() == Some(point) {
            slot.set(None);
            if EXIT_ON_CRASH.with(|slot| slot.replace(false)) {
                std::process::exit(86);
            }
            true
        } else {
            false
        }
    })
}

#[cfg(test)]
thread_local! { static SYNC_TIME: std::cell::Cell<std::time::Duration> = const { std::cell::Cell::new(std::time::Duration::ZERO) }; }
#[cfg(test)]
pub fn sync_time() -> std::time::Duration {
    SYNC_TIME.with(|v| v.get())
}
fn sync_file(file: &fs::File) -> io::Result<()> {
    #[cfg(test)]
    let start = std::time::Instant::now();
    let result = file.sync_all();
    #[cfg(test)]
    SYNC_TIME.with(|v| v.set(v.get() + start.elapsed()));
    result
}
/// Unix exposes directory fsync; std has no equivalent on other targets.
fn sync_parent(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        sync_file(&fs::File::open(parent)?)?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Remove abandoned write temps without following links or deleting active writes.
/// Each live process owns temps bearing its PID; startup never steals those files.
pub fn sweep_temps(root: &Path) -> io::Result<usize> {
    let mut removed = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if kind.is_dir() {
            if ![".obsidian", ".git", ".trash"].contains(&name.as_ref()) {
                removed += sweep_temps(&entry.path())?;
            }
        } else if let Some(pid) = kind.is_file().then(|| temp_owner(&name)).flatten() {
            let live = pid == std::process::id()
                || cfg!(target_os = "linux") && Path::new("/proc").join(pid.to_string()).exists();
            if !live {
                fs::remove_file(entry.path())?;
                removed += 1;
            }
        }
    }
    if removed > 0 {
        sync_parent(&root.join("cleanup"))?;
    }
    Ok(removed)
}

/// The process that made a temp, when `name` is exactly [`temp_path_for`]'s
/// `.{name}.{pid}.{nanos}.grove-tmp`. Any other file is not Grove's and is never swept.
fn temp_owner(name: &str) -> Option<u32> {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let (rest, nanos) = name.strip_suffix(TEMP_MARK)?.rsplit_once('.')?;
    let (rest, pid) = rest.rsplit_once('.')?;
    (rest.len() > 1 && rest.starts_with('.') && digits(nanos) && digits(pid))
        .then(|| pid.parse().ok())
        .flatten()
}

fn temp_path_for(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!(".{name}.{}.{nanos}{TEMP_MARK}", std::process::id()))
}

/// Create one new empty vault folder. The parent must already be a directory.
/// An empty path, a missing parent, and a path that already exists are refused,
/// so nothing is overwritten and no missing parents are created.
pub fn create_vault_dir(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    let raw = expand_user(trimmed);
    if raw.as_os_str().is_empty() {
        return Err("empty path".into());
    }
    match raw.parent() {
        Some(parent) if !parent.as_os_str().is_empty() && parent.is_dir() => {}
        _ => return Err(format!("parent is not a folder: {}", raw.display())),
    }
    if raw.exists() {
        return Err(format!("already exists: {}", raw.display()));
    }
    fs::create_dir(&raw).map_err(|err| err.to_string())?;
    Ok(raw)
}

/// `~` and `~/...` expand from `HOME`. Anything else is used as given.
pub fn expand_user(path: &str) -> PathBuf {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            let mut p = PathBuf::from(home);
            if path.len() > 2 {
                p.push(&path[2..]);
            }
            return p;
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
pub struct Tmp {
    pub path: PathBuf,
}

#[cfg(test)]
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
pub fn tmp_dir(label: &str) -> Tmp {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("grove-{label}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    Tmp { path }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_vault_dir_makes_a_new_folder_and_refuses_to_clobber() {
        let parent = tmp_dir("vault-parent");
        let path = parent.path.join("Fresh Vault");
        let made = create_vault_dir(&path.to_string_lossy()).unwrap();
        assert!(made.is_dir());
        assert_eq!(made, path);
        let err = create_vault_dir(&path.to_string_lossy()).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        let names: Vec<_> = fs::read_dir(&parent.path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("Fresh Vault")]);
    }

    #[test]
    fn create_vault_dir_refuses_a_missing_parent_and_an_empty_path() {
        let parent = tmp_dir("vault-missing");
        let missing = parent.path.join("nope").join("Fresh");
        let err = create_vault_dir(&missing.to_string_lossy()).unwrap_err();
        assert!(err.contains("parent is not a folder"), "{err}");
        assert!(!parent.path.join("nope").exists());
        let empty = create_vault_dir("  ").unwrap_err();
        assert!(empty.contains("empty"), "{empty}");
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let dir = tmp_dir("atomic");
        let path = dir.path.join("nested").join("note.md");
        atomic_write(&path, "one".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "one");
        atomic_write(&path, "héllo 🌟".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "héllo 🌟");

        let names: Vec<_> = walk_names(&dir.path);
        assert!(
            names.iter().all(|n| !n.contains(TEMP_MARK)),
            "temp files left behind: {names:?}"
        );
        assert_eq!(names, vec!["nested".to_string(), "note.md".to_string()]);
    }

    #[test]
    fn failed_atomic_replace_cleans_its_temp_and_preserves_the_destination() {
        let dir = tmp_dir("atomic-failure");
        let destination = dir.path.join("folder.md");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("kept"), "unchanged").unwrap();
        assert!(atomic_write(&destination, b"new").is_err());
        assert_eq!(
            fs::read_to_string(destination.join("kept")).unwrap(),
            "unchanged"
        );
        assert!(walk_names(&dir.path)
            .iter()
            .all(|name| !name.contains(TEMP_MARK)));
    }

    #[cfg(unix)]
    #[test]
    fn plain_and_durable_writes_keep_the_old_files_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp_dir("atomic-mode");
        let path = dir.path.join("note.md");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        atomic_write(&path, b"one").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        atomic_write_durable(&path, b"two").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert!(walk_names(&dir.path)
            .iter()
            .all(|name| !name.contains(TEMP_MARK)));
    }

    #[test]
    fn normalize_rejects_escapes_and_hidden_roots() {
        assert_eq!(normalize_rel("a/b.md").unwrap(), "a/b.md");
        assert_eq!(normalize_rel(".hidden.md").unwrap(), ".hidden.md");
        for bad in [
            "",
            "/etc/passwd",
            "../x.md",
            "a/../../x",
            "a/../x.md",
            ".trash/x.md",
            "a/.git/config",
            ".obsidian/app.json",
            ".grove/app.json",
            r"a\b",
            "C:/x",
            "a//b",
            "foo/.grove-tmp",
        ] {
            assert!(normalize_rel(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn config_file_names_stay_in_the_config_folder() {
        let dir = tmp_dir("config-name");
        let root = dir.path.canonicalize().unwrap();
        assert_eq!(
            config_file(&root, "app.json").unwrap(),
            root.join(".grove").join("app.json")
        );
        assert!(config_file(&root, "core-plugins.json").is_ok());
        for bad in [
            "",
            ".json",
            "app",
            "app.txt",
            "App.json",
            "a.b.json",
            "../app.json",
            "x/app.json",
            "/etc/passwd.json",
            "app.json/",
            r"a\b.json",
            "app .json",
        ] {
            assert!(config_file(&root, bad).is_err(), "{bad} should be rejected");
        }
    }

    #[cfg(unix)]
    #[test]
    fn config_folder_symlinked_outside_is_refused() {
        let dir = tmp_dir("config-link");
        let outside = tmp_dir("config-outside");
        let root = dir.path.canonicalize().unwrap();
        std::os::unix::fs::symlink(&outside.path, root.join(CONFIG_DIR)).unwrap();
        assert!(config_file(&root, "app.json").is_err());
    }

    fn walk_names(root: &Path) -> Vec<String> {
        let mut out = Vec::new();
        visit(root, &mut out);
        out.sort();
        out
    }

    fn visit(dir: &Path, out: &mut Vec<String>) {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            out.push(entry.file_name().to_string_lossy().into_owned());
            if entry.file_type().unwrap().is_dir() {
                visit(&entry.path(), out);
            }
        }
    }
}
