//! Last opened vault, stored in the app config directory.

use crate::fsutil;
use std::fs;
use std::path::{Path, PathBuf};

const FILE: &str = "config.json";

pub fn remember(dir: &Path, vault: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut body = serde_json::to_vec_pretty(&serde_json::json!({
        "vault": vault.to_string_lossy(),
    }))
    .map_err(|e| e.to_string())?;
    body.push(b'\n');
    fsutil::atomic_write(&dir.join(FILE), &body).map_err(|e| e.to_string())
}

/// The remembered folder, when it is still a directory.
pub fn last_vault(dir: &Path) -> Option<PathBuf> {
    let bytes = fs::read(dir.join(FILE)).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let path = PathBuf::from(value.get("vault")?.as_str()?);
    path.is_dir().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fsutil::tmp_dir;

    #[test]
    fn remembers_and_forgets_a_missing_folder() {
        let cfg = tmp_dir("cfg");
        let vault = tmp_dir("vault");
        assert!(last_vault(&cfg.path).is_none());
        remember(&cfg.path, &vault.path).unwrap();
        assert_eq!(last_vault(&cfg.path).as_deref(), Some(vault.path.as_path()));
        fs::remove_dir_all(&vault.path).unwrap();
        assert!(last_vault(&cfg.path).is_none());
    }
}
