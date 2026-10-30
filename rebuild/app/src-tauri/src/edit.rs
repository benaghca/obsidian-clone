//! K2: fresh-file, property-scoped CAS. TypeScript's propertyEdit.ts is the reference.
use crate::index::props::{
    self, Frontmatter, NoteProperties, Property, PropertyType as Kind, PropertyValue as Value,
};
use serde::{Deserialize, Serialize};

pub const MAX_BYTES: usize = 16 * 1024 * 1024;
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertyEdit {
    pub key: String,
    #[serde(deserialize_with = "required_option")]
    pub expect: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub to: Option<Target>,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Target {
    Typed(Typed),
    Lines(Lines),
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Typed {
    #[serde(rename = "type")]
    pub kind: Kind,
    pub value: Value,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lines {
    pub lines: String,
}
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum EditResult {
    Done {
        before: Option<String>,
        after: Option<String>,
        props: NoteProperties,
        mtime_ms: u64,
    },
    Unchanged {
        before: Option<String>,
        after: Option<String>,
        props: NoteProperties,
        mtime_ms: u64,
    },
    Conflict {
        current: Option<String>,
    },
    Refused {
        reason: String,
    },
}
impl EditResult {
    pub fn refused(reason: impl Into<String>) -> Self {
        Self::Refused {
            reason: reason.into(),
        }
    }
    pub fn done(&self) -> bool {
        matches!(self, Self::Done { .. })
    }
    pub fn stamp(&mut self, ms: u64) {
        if let Self::Done { mtime_ms, .. } | Self::Unchanged { mtime_ms, .. } = self {
            *mtime_ms = ms;
        }
    }
}
pub struct Prepared {
    pub result: EditResult,
    pub text: Option<String>,
}
fn result(result: EditResult) -> Prepared {
    Prepared { result, text: None }
}
fn same_key(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}
fn empty_info() -> NoteProperties {
    NoteProperties {
        props: Vec::new(),
        lines: Vec::new(),
    }
}
fn source(fm: &Frontmatter<'_>, p: &Property) -> String {
    fm.properties.lines[p.line..p.line + p.count].join("\n")
}
fn one(lines: &str, key: &str) -> Option<Property> {
    if lines.contains('\r') {
        return None;
    }
    let raw: Vec<_> = lines.split('\n').map(str::to_string).collect();
    let mut parsed = props::read_properties(&raw)?;
    if parsed.len() != 1 {
        return None;
    }
    let p = parsed.pop()?;
    (p.line == 0 && p.count == raw.len() && same_key(&p.key, key) && p.kind != Kind::Unknown)
        .then_some(p)
}
fn yaml_key(key: &str) -> String {
    let candidate = format!("{key}: x");
    if props::trim(key) == key
        && !key.contains(':')
        && one(&candidate, key).is_some_and(|p| p.key == key)
    {
        key.to_string()
    } else {
        serde_json::to_string(key).unwrap()
    }
}
fn yaml_string(value: &str) -> String {
    let reserved = value.starts_with([
        '-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@',
        '`',
    ]);
    if !value.is_empty()
        && props::trim(value) == value
        && !value.contains(['\n', '\r', '\t'])
        && !reserved
        && one(&format!("k: {value}"), "k")
            .is_some_and(|p| p.kind == Kind::Text && p.value == Value::Text(value.into()))
    {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap()
    }
}
fn fits(p: &Property, kind: &Kind) -> bool {
    if &p.kind == kind || (p.kind == Kind::Text && p.value == Value::Text(String::new())) {
        return true;
    }
    let text = matches!(p.kind, Kind::Text | Kind::Date | Kind::Datetime);
    if *kind == Kind::Text {
        return text;
    }
    if matches!(kind, Kind::Date | Kind::Datetime) && text {
        if let Value::Text(v) = &p.value {
            return one(&format!("k: {v}"), "k")
                .is_some_and(|q| matches!(q.kind, Kind::Date | Kind::Datetime));
        }
    }
    *kind == Kind::List && (text || matches!(p.kind, Kind::Tags | Kind::Aliases))
}
fn format_target(
    edit: &PropertyEdit,
    fm: Option<&Frontmatter<'_>>,
    p: Option<&Property>,
) -> Option<(Option<String>, Option<Property>)> {
    let Some(target) = &edit.to else {
        return Some((None, None));
    };
    let Target::Typed(typed) = target else {
        let Target::Lines(raw) = target else {
            unreachable!()
        };
        if raw.lines.len() > MAX_BYTES {
            return None;
        }
        return Some((Some(raw.lines.clone()), Some(one(&raw.lines, &edit.key)?)));
    };
    if typed.kind == Kind::Unknown {
        return None;
    }
    let mut value = typed.value.clone();
    if matches!(&value, Value::Text(v) if v.len() > MAX_BYTES)
        || matches!(&value, Value::List(v) if v.iter().map(String::len).sum::<usize>() > MAX_BYTES)
    {
        return None;
    }
    let list = matches!(typed.kind, Kind::List | Kind::Tags | Kind::Aliases);
    if list {
        value = match value {
            Value::List(v) => Value::List(v),
            Value::Text(v) => Value::List(if v.is_empty() { vec![] } else { vec![v] }),
            _ => return None,
        };
    } else if matches!(value, Value::List(_))
        || if typed.kind == Kind::Checkbox {
            !matches!(value, Value::Checkbox(_)) && value != Value::Text(String::new())
        } else {
            !matches!(value, Value::Text(_))
        }
    {
        return None;
    }
    let written = fm.zip(p).map(|(fm, p)| source(fm, p));
    let key = match written.as_deref() {
        Some(old) => props::key_prefix(old.lines().next()?)?.to_string(),
        None => yaml_key(&edit.key),
    };
    let inline = written
        .as_deref()
        .map(|s| props::trim(&s[props::key_prefix(s.lines().next().unwrap()).unwrap().len() + 1..]))
        .unwrap_or("");
    let mut lines = match &value {
        Value::List(values) if values.is_empty() => format!("{key}: []"),
        Value::List(values) => {
            if inline.starts_with('[') {
                format!(
                    "{key}: [{}]",
                    values
                        .iter()
                        .map(|v| if v.contains([',', '[', ']']) {
                            serde_json::to_string(v).unwrap()
                        } else {
                            yaml_string(v)
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            } else {
                let indent = written
                    .as_deref()
                    .and_then(|s| s.split('\n').skip(1).find(|l| !props::trim(l).is_empty()))
                    .and_then(|l| l.find('-').map(|i| &l[..i]))
                    .filter(|s| s.chars().all(|c| c == ' ' || c == '\t'))
                    .unwrap_or("  ");
                format!(
                    "{key}:\n{}",
                    values
                        .iter()
                        .map(|v| format!("{indent}- {}", yaml_string(v)))
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            }
        }
        Value::Checkbox(v) => format!("{key}: {v}"),
        Value::Text(v) if v.is_empty() => format!("{key}:"),
        Value::Text(v) => format!(
            "{key}: {}",
            if matches!(typed.kind, Kind::Number | Kind::Date | Kind::Datetime) {
                v.clone()
            } else {
                yaml_string(v)
            }
        ),
    };
    if let Value::Text(v) = &value {
        if !v.is_empty() && matches!(typed.kind, Kind::Text | Kind::Date | Kind::Datetime) {
            let styled = if inline.starts_with('\'') && !v.contains(['\r', '\n']) {
                Some(format!("'{}'", v.replace('\'', "''")))
            } else if inline.starts_with('"') {
                Some(serde_json::to_string(v).unwrap())
            } else {
                None
            };
            if let Some(styled) = styled {
                let candidate = format!("{key}: {styled}");
                if one(&candidate, &edit.key).is_some() {
                    lines = candidate;
                }
            }
        }
    }
    let intended = one(&lines, &edit.key)?;
    if !fits(&intended, &typed.kind) || intended.value != value {
        return None;
    }
    Some((Some(lines), Some(intended)))
}
fn other(fm: Option<&Frontmatter<'_>>, key: &str) -> Vec<(String, String)> {
    fm.map(|fm| {
        fm.properties
            .props
            .iter()
            .filter(|p| !same_key(&p.key, key))
            .map(|p| (p.key.clone(), source(fm, p)))
            .collect()
    })
    .unwrap_or_default()
}
fn body<'a>(text: &'a str, fm: Option<&Frontmatter<'_>>) -> &'a str {
    &text[fm
        .map(|fm| fm.close.end)
        .unwrap_or(if text.starts_with('\u{feff}') { 3 } else { 0 })..]
}

/// Pure steps 3–8. Byte offsets never cross an unchanged prefix or suffix.
pub fn edit_property(text: &str, edit: &PropertyEdit) -> Prepared {
    if text.len() > MAX_BYTES {
        return result(EditResult::refused("Note exceeds 16 MB"));
    }
    if edit.key.is_empty()
        || edit.key.contains(['\r', '\n', '\0'])
        || edit.key.encode_utf16().count() > 1024
    {
        return result(EditResult::refused("Invalid property edit"));
    }
    let fm = match props::frontmatter(text) {
        Ok(fm) => fm,
        Err(reason) => return result(EditResult::refused(reason)),
    };
    let p = fm.as_ref().and_then(|fm| {
        fm.properties
            .props
            .iter()
            .find(|p| same_key(&p.key, &edit.key))
    });
    if p.is_some_and(|p| p.kind == Kind::Unknown) {
        return result(EditResult::refused("Property is not safely editable"));
    }
    let Some((mut after, intended)) = format_target(edit, fm.as_ref(), p) else {
        return result(EditResult::refused("Invalid target property"));
    };
    let before = fm.as_ref().zip(p).map(|(fm, p)| source(fm, p));
    if p.is_none()
        && matches!(edit.to, Some(Target::Typed(_)))
        && intended.as_ref().is_some_and(|p| {
            matches!(&p.value, Value::Text(v) if v.is_empty())
                || matches!(&p.value, Value::List(v) if v.is_empty())
        })
    {
        after = None;
    }
    if before == after {
        return result(EditResult::Unchanged {
            before,
            after,
            props: fm.map(|fm| fm.properties).unwrap_or_else(empty_info),
            mtime_ms: 0,
        });
    }
    if before != edit.expect {
        return result(EditResult::Conflict { current: before });
    }
    let eol = fm
        .as_ref()
        .map(|fm| fm.open.eol)
        .filter(|e| !e.is_empty())
        .unwrap_or(if text.contains("\r\n") { "\r\n" } else { "\n" });
    let mut formatted = String::new();
    for (i, line) in after.as_deref().unwrap_or("").split('\n').enumerate() {
        if i > 0 {
            let ending = fm
                .as_ref()
                .zip(p)
                .filter(|(_, p)| i - 1 < p.count - 1)
                .map(|(fm, p)| fm.lines[p.line + i - 1].eol)
                .unwrap_or(eol);
            formatted.push_str(ending);
        }
        formatted.push_str(line);
    }
    let (from, to, insert) = if let Some(fm) = &fm {
        if let Some(p) = p {
            let first = &fm.lines[p.line];
            let last = &fm.lines[p.line + p.count - 1];
            if after.is_none() {
                (first.start, last.end, String::new())
            } else {
                (first.start, last.end - last.eol.len(), formatted)
            }
        } else {
            (fm.close.start, fm.close.start, format!("{formatted}{eol}"))
        }
    } else {
        let at = if text.starts_with('\u{feff}') { 3 } else { 0 };
        (at, at, format!("---{eol}{formatted}{eol}---{eol}"))
    };
    let mut updated = String::with_capacity(text.len() - (to - from) + insert.len());
    updated.push_str(&text[..from]);
    updated.push_str(&insert);
    updated.push_str(&text[to..]);
    let parsed = match props::frontmatter(&updated) {
        Ok(parsed) => parsed,
        Err(_) => return result(EditResult::refused("Edit validation failed")),
    };
    let actual = parsed.as_ref().and_then(|fm| {
        fm.properties
            .props
            .iter()
            .find(|p| same_key(&p.key, &edit.key))
    });
    let actual_lines = parsed.as_ref().zip(actual).map(|(fm, p)| source(fm, p));
    if updated.len() > MAX_BYTES
        || actual_lines != after
        || other(fm.as_ref(), &edit.key) != other(parsed.as_ref(), &edit.key)
        || body(text, fm.as_ref()) != body(&updated, parsed.as_ref())
        || actual
            .zip(intended.as_ref())
            .is_some_and(|(a, i)| a.kind != i.kind || a.value != i.value)
    {
        return result(EditResult::refused("Edit validation failed"));
    }
    let properties = parsed.map(|fm| fm.properties).unwrap_or_else(empty_info);
    Prepared {
        result: EditResult::Done {
            before,
            after,
            props: properties,
            mtime_ms: 0,
        },
        text: Some(updated),
    }
}

/// The command calls this while holding AppState.inner, including reads and index updates.
impl crate::vault::Vault {
    pub fn set_property(
        &mut self,
        path: &str,
        edit: &PropertyEdit,
        dry_run: bool,
    ) -> Result<EditResult, String> {
        use crate::{
            fsutil,
            index::{is_note_path, Stamp},
        };
        use std::{fs, io::Read};
        if !is_note_path(path) {
            return Ok(EditResult::refused("Not a note"));
        }
        for _ in 0..3 {
            let (rel, full) = match fsutil::resolve_in_vault(&self.root, path) {
                Ok(p) => p,
                Err(e) => return Ok(EditResult::refused(e)),
            };
            // Atomic rename must not replace a symlink itself with a different file.
            let md = match fs::symlink_metadata(&full) {
                Ok(md) if md.is_file() => md,
                Ok(_) => return Ok(EditResult::refused("Not a regular note file")),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(EditResult::refused("Note not found"))
                }
                Err(e) => return Ok(EditResult::refused(e.to_string())),
            };
            if full
                .canonicalize()
                .ok()
                .and_then(|p| fsutil::rel_of(&self.root, &p))
                .is_none()
            {
                return Ok(EditResult::refused("Invalid note path"));
            }
            if md.len() > MAX_BYTES as u64 {
                return Ok(EditResult::refused("Note exceeds 16 MB"));
            }
            let file = match fs::File::open(&full) {
                Ok(file) => file,
                Err(e) => return Ok(EditResult::refused(e.to_string())),
            };
            let mut bytes = Vec::with_capacity(md.len() as usize);
            if let Err(e) = file.take(MAX_BYTES as u64 + 1).read_to_end(&mut bytes) {
                return Ok(EditResult::refused(e.to_string()));
            }
            if bytes.len() > MAX_BYTES {
                return Ok(EditResult::refused("Note exceeds 16 MB"));
            }
            let text = match String::from_utf8(bytes) {
                Ok(text) => text,
                Err(_) => return Ok(EditResult::refused("Note is not UTF-8")),
            };
            // Compare the post-read identity with the pre-read one too: a read spanning
            // an external truncate/replace is not a trustworthy snapshot.
            let read_stamp = match fs::metadata(&full) {
                Ok(md) => md,
                Err(_) => continue,
            };
            if !same_file(&md, &read_stamp) {
                continue;
            }
            let mut prepared = edit_property(&text, edit);
            if matches!(&prepared.result, EditResult::Refused { reason } if reason == "Edit validation failed")
            {
                eprintln!(
                    "Property edit validation failed for key {:?}; nothing written",
                    edit.key
                );
            }
            #[cfg(test)]
            BEFORE_STAT.with(|hook| {
                if let Some(f) = hook.borrow_mut().as_mut() {
                    f(&full);
                }
            });
            let final_stamp = match fs::metadata(&full) {
                Ok(md) => md,
                Err(_) => continue,
            };
            if !same_file(&read_stamp, &final_stamp) {
                continue;
            }
            prepared.result.stamp(fsutil::mtime_ms(&final_stamp));
            if dry_run || !prepared.result.done() {
                return Ok(prepared.result);
            }
            let updated = prepared.text.as_ref().expect("done edit has text");
            if let Err(error) = fsutil::atomic_write(&full, updated.as_bytes()) {
                // A directory-fsync error can occur after rename. Reconcile whichever
                // bytes are now present; leave watcher echo unsuppressed on errors.
                self.index.refresh_path(&self.root, &rel);
                return Err(error.to_string());
            }
            self.mark_own(&rel);
            let md = fs::metadata(&full).map_err(|e| e.to_string())?;
            self.index
                .upsert_note(&self.root, &rel, updated, Stamp::of(&md));
            prepared.result.stamp(fsutil::mtime_ms(&md));
            return Ok(prepared.result);
        }
        // A last fresh read reports the current property where it is readable.
        let current = self.read_note(path).ok().and_then(|text| {
            props::frontmatter(&text).ok().flatten().and_then(|fm| {
                fm.properties
                    .props
                    .iter()
                    .find(|p| same_key(&p.key, &edit.key))
                    .map(|p| source(&fm, p))
            })
        });
        Ok(EditResult::Conflict { current })
    }
}
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    if a.len() != b.len() || a.modified().ok() != b.modified().ok() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if (a.dev(), a.ino(), a.ctime(), a.ctime_nsec())
            != (b.dev(), b.ino(), b.ctime(), b.ctime_nsec())
        {
            return false;
        }
    }
    true
}

#[cfg(test)]
thread_local! { static BEFORE_STAT: std::cell::RefCell<Option<Box<dyn FnMut(&std::path::Path)>>> = const { std::cell::RefCell::new(None) }; }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        fsutil::{self, tmp_dir},
        vault::Vault,
    };
    use std::{
        fs,
        time::{Duration, Instant},
    };
    fn edit(expect: &str, value: &str) -> PropertyEdit {
        PropertyEdit {
            key: "status".into(),
            expect: Some(expect.into()),
            to: Some(Target::Typed(Typed {
                kind: Kind::Text,
                value: Value::Text(value.into()),
            })),
        }
    }
    fn status(result: &EditResult) -> &str {
        match result {
            EditResult::Done { .. } => "done",
            EditResult::Unchanged { .. } => "unchanged",
            EditResult::Conflict { .. } => "conflict",
            EditResult::Refused { .. } => "refused",
        }
    }
    fn no_temps(root: &std::path::Path) {
        for entry in fs::read_dir(root).unwrap().flatten() {
            let name = entry.file_name();
            assert!(
                !name.to_string_lossy().contains(fsutil::TEMP_MARK),
                "leftover: {name:?}"
            );
            if entry.file_type().unwrap().is_dir() {
                no_temps(&entry.path());
            }
        }
    }

    #[test]
    fn omitted_cas_or_target_cannot_default_to_a_property_removal() {
        assert!(serde_json::from_value::<PropertyEdit>(serde_json::json!({"key":"status","expect":"status: todo"})).is_err());
        assert!(serde_json::from_value::<PropertyEdit>(serde_json::json!({"key":"status","to":null})).is_err());
        assert!(serde_json::from_value::<PropertyEdit>(serde_json::json!({"key":"status","expect":null,"to":null})).is_ok());
    }

    #[test]
    fn fresh_cas_dry_run_index_and_retry() {
        let dir = tmp_dir("k2-cas");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        let path = "Note.MD";
        vault
            .create_note(path, "\u{feff}---\r\nstatus: todo\r\n---\r\nbody")
            .unwrap();
        let full = dir.path.join(path);
        let bytes = fs::read(&full).unwrap();
        let md = fs::metadata(&full).unwrap();
        let index = serde_json::to_value(vault.index.properties(None)).unwrap();
        assert_eq!(
            status(
                &vault
                    .set_property(path, &edit("status: todo", "doing"), true)
                    .unwrap()
            ),
            "done"
        );
        assert_eq!(fs::read(&full).unwrap(), bytes);
        assert!(same_file(&md, &fs::metadata(&full).unwrap()));
        assert_eq!(
            serde_json::to_value(vault.index.properties(None)).unwrap(),
            index
        );
        assert!(!vault.is_own_write(path, Instant::now()));
        fs::write(
            &full,
            "\u{feff}---\r\nstatus: todo\r\n---\r\nchanged body #new [[Target]]",
        )
        .unwrap();
        vault.create_note("Target.md", "target").unwrap();
        let result = vault
            .set_property(path, &edit("status: todo", "doing"), false)
            .unwrap();
        assert_eq!(status(&result), "done");
        assert_eq!(
            fs::read_to_string(&full).unwrap(),
            "\u{feff}---\r\nstatus: doing\r\n---\r\nchanged body #new [[Target]]"
        );
        assert!(vault.is_own_write(path, Instant::now()));
        assert_eq!(
            vault.index.properties(None)[path].props[0].value,
            Value::Text("doing".into())
        );
        assert_eq!(vault.index.tags(None)[path], vec!["new"]);
        assert_eq!(vault.index.link_index().outgoing[path], vec!["Target.md"]);
        assert_eq!(
            status(
                &vault
                    .set_property(path, &edit("status: todo", "doing"), false)
                    .unwrap()
            ),
            "unchanged"
        );
        assert_eq!(
            status(
                &vault
                    .set_property(path, &edit("status: todo", "review"), false)
                    .unwrap()
            ),
            "conflict"
        );
        no_temps(&dir.path);
    }
    #[test]
    fn detects_an_external_write_during_read_and_retries_fresh_body() {
        let dir = tmp_dir("k2-retry");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault
            .create_note("A.md", "---\nstatus: todo\n---\nold")
            .unwrap();
        let mut once = true;
        BEFORE_STAT.with(|h| {
            *h.borrow_mut() = Some(Box::new(move |path| {
                if once {
                    once = false;
                    fs::write(path, "---\nstatus: todo\n---\nfresh").unwrap();
                }
            }))
        });
        let result = vault
            .set_property("A.md", &edit("status: todo", "doing"), false)
            .unwrap();
        BEFORE_STAT.with(|h| *h.borrow_mut() = None);
        assert_eq!(status(&result), "done");
        assert_eq!(
            fs::read_to_string(dir.path.join("A.md")).unwrap(),
            "---\nstatus: doing\n---\nfresh"
        );
        let mut n = 0;
        BEFORE_STAT.with(|h| {
            *h.borrow_mut() = Some(Box::new(move |path| {
                n += 1;
                fs::write(path, format!("---\nstatus: external{n}\n---\nfresh")).unwrap();
            }))
        });
        let result = vault
            .set_property("A.md", &edit("status: doing", "done"), false)
            .unwrap();
        BEFORE_STAT.with(|h| *h.borrow_mut() = None);
        assert!(
            matches!(result,EditResult::Conflict{current:Some(ref v)} if v=="status: external3")
        );
        assert!(fs::read_to_string(dir.path.join("A.md"))
            .unwrap()
            .contains("external3"));
        no_temps(&dir.path);
    }
    #[test]
    fn rejects_invalid_paths_bytes_and_large_notes_without_writing() {
        let dir = tmp_dir("k2-refuse");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        fs::write(dir.path.join("Invalid.md"), [0xff, 0xfe]).unwrap();
        fs::write(dir.path.join("Large.md"), vec![b'x'; MAX_BYTES + 1]).unwrap();
        fs::create_dir(dir.path.join("Folder.md")).unwrap();
        for path in [
            "../escape.md",
            ".grove/config.md",
            "No.txt",
            "Missing.md",
            "Invalid.md",
            "Large.md",
            "Folder.md",
        ] {
            assert_eq!(
                status(
                    &vault
                        .set_property(path, &edit("status: todo", "doing"), false)
                        .unwrap()
                ),
                "refused",
                "{path}"
            );
        }
        assert_eq!(fs::read(dir.path.join("Invalid.md")).unwrap(), [0xff, 0xfe]);
        no_temps(&dir.path);
    }
    #[cfg(unix)]
    #[test]
    fn preserves_mode_and_refuses_symlinks_and_hidden_aliases() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tmp_dir("k2-mode");
        let outside = tmp_dir("k2-outside");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault
            .create_note("A.md", "---\nstatus: todo\n---\nbody")
            .unwrap();
        fs::set_permissions(dir.path.join("A.md"), fs::Permissions::from_mode(0o640)).unwrap();
        assert_eq!(
            status(
                &vault
                    .set_property("A.md", &edit("status: todo", "doing"), false)
                    .unwrap()
            ),
            "done"
        );
        assert_eq!(
            fs::metadata(dir.path.join("A.md"))
                .unwrap()
                .permissions()
                .mode()
                & 0o7777,
            0o640
        );
        fs::write(outside.path.join("out.md"), "outside").unwrap();
        symlink(outside.path.join("out.md"), dir.path.join("Out.md")).unwrap();
        symlink(dir.path.join("A.md"), dir.path.join("Alias.md")).unwrap();
        fs::create_dir(dir.path.join(".grove")).unwrap();
        fs::write(dir.path.join(".grove/X.md"), "hidden").unwrap();
        symlink(dir.path.join(".grove"), dir.path.join("AliasFolder")).unwrap();
        for path in ["Out.md", "Alias.md", "AliasFolder/X.md"] {
            assert_eq!(
                status(
                    &vault
                        .set_property(path, &edit("status: doing", "done"), false)
                        .unwrap()
                ),
                "refused"
            );
        }
        assert_eq!(
            fs::read_to_string(outside.path.join("out.md")).unwrap(),
            "outside"
        );
    }
    #[test]
    fn one_thousand_durable_edits_leave_no_temp_files() {
        let dir = tmp_dir("k2-thousand");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        vault
            .create_note("A.md", "---\nstatus: a\n---\nbody")
            .unwrap();
        for n in 0..1000 {
            let (a, b) = if n % 2 == 0 { ("a", "b") } else { ("b", "a") };
            assert_eq!(
                status(
                    &vault
                        .set_property("A.md", &edit(&format!("status: {a}"), b), false)
                        .unwrap()
                ),
                "done"
            );
        }
        no_temps(&dir.path);
    }
    #[test]
    fn sweep_on_open_removes_abandoned_temps_but_not_live_or_unrelated_files() {
        let dir = tmp_dir("k2-sweep");
        fs::create_dir_all(dir.path.join("nested/.grove")).unwrap();
        fs::write(dir.path.join("nested/.grove/old.grove-tmp"), "old").unwrap();
        let live = format!(".note.md.{}.123{}", std::process::id(), fsutil::TEMP_MARK);
        fs::write(dir.path.join(&live), "active").unwrap();
        fs::write(dir.path.join("keep.grove-tmp.md"), "keep").unwrap();
        let _vault = Vault::open(dir.path.clone()).unwrap();
        assert!(!dir.path.join("nested/.grove/old.grove-tmp").exists());
        assert!(dir.path.join(&live).exists());
        assert!(dir.path.join("keep.grove-tmp.md").exists());
    }
    #[test]
    #[ignore]
    fn set_property_bench() {
        let dir = tmp_dir("k2-bench");
        let mut vault = Vault::open(dir.path.clone()).unwrap();
        for size in [10_000usize, 1_000_000] {
            let text = format!(
                "---\nstatus: a\n---\n{}",
                "plain body content\n".repeat(size / 19)
            );
            vault.write_note("A.md", &text).unwrap();
            let mut cpu = Vec::new();
            let mut wall = Vec::new();
            for n in 0..110 {
                let (a, b) = if n % 2 == 0 { ("a", "b") } else { ("b", "a") };
                let sync = fsutil::sync_time();
                let start = Instant::now();
                let result = vault
                    .set_property("A.md", &edit(&format!("status: {a}"), b), false)
                    .unwrap();
                let elapsed = start.elapsed();
                let excluded = fsutil::sync_time() - sync;
                assert_eq!(status(&result), "done");
                if n >= 10 {
                    cpu.push(elapsed.saturating_sub(excluded));
                    wall.push(elapsed);
                }
            }
            cpu.sort();
            wall.sort();
            let ms = |d: Duration| d.as_secs_f64() * 1000.0;
            println!("K2_P6 bytes={} median_excluding_fsync_ms={:.4} max_excluding_fsync_ms={:.4} median_wall_ms={:.4}",text.len(),ms(cpu[50]),ms(*cpu.last().unwrap()),ms(wall[50]));
            assert!(ms(cpu[50]) <= if size == 10_000 { 2.0 } else { 5.0 }, "P6 median budget exceeded");
        }
        no_temps(&dir.path);
    }
}
