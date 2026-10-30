//! Saved-note properties: `splitFrontmatter` + `readProperties` in editor/frontmatter.ts.
//! This intentionally ports Grove's conservative YAML subset, not a general YAML reader.
use super::{is_note_path, Index};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PropertyType {
    Text,
    List,
    Number,
    Checkbox,
    Date,
    Datetime,
    Tags,
    Aliases,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PropertyValue {
    Text(String),
    Checkbox(bool),
    List(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Property {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: PropertyType,
    pub value: PropertyValue,
    /// Zero-based position among the frontmatter body lines, including comments/blanks.
    pub line: usize,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoteProperties {
    pub props: Vec<Property>,
    pub lines: Vec<String>,
}

impl Index {
    pub fn properties(&self, paths: Option<&[String]>) -> BTreeMap<String, NoteProperties> {
        let entry = |path: &String| {
            let node = self
                .files
                .get(path)
                .filter(|n| !n.is_dir && is_note_path(path))?;
            node.note.props.clone().map(|props| (path.clone(), props))
        };
        match paths {
            Some(paths) => paths.iter().filter_map(entry).collect(),
            None => self.files.keys().filter_map(entry).collect(),
        }
    }
}

// JS trim/\s differ from Rust's Unicode whitespace: JS includes BOM, excludes NEL.
fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}
pub(crate) fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}
const SPACE: &str = r"\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";

struct Patterns {
    key: Regex,
    item: Regex,
    number: Regex,
    numberish: Regex,
    date: Regex,
    datetime: Regex,
    quoted: Regex,
    double: Regex,
    single: Regex,
}
fn patterns() -> &'static Patterns {
    static PATTERNS: OnceLock<Patterns> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        // JS digits are ASCII; dot excludes all four JS line terminators.
        let re = |s: &str| Regex::new(&s.replace(r"\s", SPACE).replace(r"[\d", "[0-9").replace(r"\d", "[0-9]")).expect("property pattern");
        let double = r#""(?:[^"\\]|\\[^\r\n\u{2028}\u{2029}])*""#;
        let single = "'(?:[^']|'')*'";
        // Without the multiline flag, JS $ is strict end-of-input.
        let end = r"\z";
        Patterns {
            key: re(&format!(r#"^({double}|{single}|[^\s#\-?:,\[\]{{}}&*!|>'"%@`][^:]*?)[ \t]*:(?:[ \t]+([^\r\n\u{{2028}}\u{{2029}}]*?))?[ \t]*{end}"#)),
            item: re(&format!(r"^([ \t]*)-(?:[ \t]+([^\r\n\u{{2028}}\u{{2029}}]*?))?[ \t]*{end}")),
            number: re(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?\z"),
            numberish: re(r"(?i)^[-+]?(?:(?:\.\d+|\d[\d_]*(?:\.[\d_]*)?)(?:e[-+]?\d+)?|0[xob][\da-f_]+|\.(?:inf|nan)|\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?)\z"),
            date: re(r"^\d{4}-\d{2}-\d{2}\z"),
            datetime: re(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\z"),
            quoted: re(&format!("{double}|{single}")),
            double: re(&format!("^{double}\\z")),
            single: re(&format!("^{single}\\z")),
        }
    })
}

/// An absent/unclosed/overlong block or unplaceable YAML is None; an empty block is Some([]).
/// Split on LF and strip exactly one trailing CR, independently of parse.rs's search lines.
pub(super) fn note_properties(text: &str) -> Option<NoteProperties> {
    frontmatter(text).ok().flatten().map(|fm| fm.properties)
}

/// Byte offsets and the original per-line ending; no scanning/copying the body.
pub(crate) struct SourceLine<'a> {
    pub text: &'a str,
    pub start: usize,
    pub end: usize,
    pub eol: &'a str,
}
pub(crate) struct Frontmatter<'a> {
    pub open: SourceLine<'a>,
    pub close: SourceLine<'a>,
    pub lines: Vec<SourceLine<'a>>,
    pub properties: NoteProperties,
}
fn source_line(text: &str, start: usize) -> SourceLine<'_> {
    let tail = &text[start..];
    let lf = tail.find('\n').map(|n| start + n);
    let (content, end, eol) = match lf {
        Some(n) if text[..n].ends_with('\r') => (n - 1, n + 1, "\r\n"),
        Some(n) => (n, n + 1, "\n"),
        None => (text.len(), text.len(), ""),
    };
    SourceLine {
        text: &text[start..content],
        start,
        end,
        eol,
    }
}
/// None is ordinary body text; Err is present but unsafe/unclosed frontmatter.
pub(crate) fn frontmatter(text: &str) -> Result<Option<Frontmatter<'_>>, &'static str> {
    let open = source_line(text, if text.starts_with('\u{feff}') { 3 } else { 0 });
    if trim(open.text) != "---" {
        return Ok(None);
    }
    let mut at = open.end;
    let mut lines = Vec::new();
    for _ in 1..=2000 {
        if open.eol.is_empty() {
            break;
        }
        let line = source_line(text, at);
        if trim(line.text) == "---" {
            let raw: Vec<_> = lines
                .iter()
                .map(|l: &SourceLine<'_>| l.text.to_string())
                .collect();
            let props = read_properties(&raw).ok_or("Frontmatter is not safely editable")?;
            return Ok(Some(Frontmatter {
                open,
                close: line,
                lines,
                properties: NoteProperties { props, lines: raw },
            }));
        }
        at = line.end;
        let done = line.eol.is_empty();
        lines.push(line);
        if done {
            break;
        }
    }
    Err("Frontmatter is not safely editable")
}
pub(crate) fn key_prefix(line: &str) -> Option<&str> {
    let m = patterns().key.captures(line)?.get(1)?;
    let colon = m.end() + line[m.end()..].find(':')?;
    Some(&line[..colon])
}

#[derive(PartialEq)]
enum ScalarKind {
    String,
    Number,
    Bool,
    Null,
    Date,
    Datetime,
}
struct Scalar {
    kind: ScalarKind,
    text: String,
}
fn scalar(raw: &str) -> Option<Scalar> {
    let v = trim(raw);
    let p = patterns();
    let (kind, text) = if v.is_empty() || v == "~" || v.eq_ignore_ascii_case("null") {
        (ScalarKind::Null, String::new())
    } else if v.starts_with('"') {
        if !p.double.is_match(v) {
            return None;
        }
        (ScalarKind::String, serde_json::from_str::<String>(v).ok()?)
    } else if v.starts_with('\'') {
        if !p.single.is_match(v) {
            return None;
        }
        (ScalarKind::String, v[1..v.len() - 1].replace("''", "'"))
    } else {
        if v.starts_with([
            '[', ']', '{', '}', '&', '*', '!', '|', '>', '%', '@', '`', '#',
        ]) || v
            .char_indices()
            .any(|(i, c)| c == ':' && v[i + 1..].chars().next().is_none_or(is_space))
            || v.chars()
                .zip(v.chars().skip(1))
                .any(|(a, b)| is_space(a) && b == '#')
        {
            return None;
        }
        let kind = if v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("false") {
            ScalarKind::Bool
        } else if p.number.is_match(v) {
            ScalarKind::Number
        } else if p.date.is_match(v) {
            ScalarKind::Date
        } else if p.datetime.is_match(v) {
            ScalarKind::Datetime
        } else if p.numberish.is_match(v) {
            return None;
        } else {
            ScalarKind::String
        };
        let text = if kind == ScalarKind::Bool {
            v.to_ascii_lowercase()
        } else {
            v.to_string()
        };
        (kind, text)
    };
    Some(Scalar { kind, text })
}

fn flow_list(v: &str) -> Option<Vec<String>> {
    if !v.starts_with('[') || !v.ends_with(']') || v.contains(['\r', '\n', '\u{2028}', '\u{2029}'])
    {
        return None;
    }
    let body = &v[1..v.len() - 1];
    if trim(body).is_empty() {
        return Some(Vec::new());
    }
    // Deliberately the TS quote toggling, including its escaped-quote limitation.
    let mut quote = None;
    let mut start = 0;
    let mut parts = Vec::new();
    for (i, c) in body.char_indices() {
        if let Some(q) = quote {
            if q == c {
                quote = None;
            }
        } else if c == '"' || c == '\'' {
            quote = Some(c);
        } else if c == ',' {
            parts.push(&body[start..i]);
            start = i + 1;
        }
    }
    if quote.is_some() {
        return None;
    }
    parts.push(&body[start..]);
    let mut items = Vec::new();
    for part in parts {
        let s = scalar(part)?;
        if s.kind != ScalarKind::Null {
            items.push(s.text);
        }
    }
    Some(items)
}

fn fixed_type(key: &str) -> Option<PropertyType> {
    match key.to_lowercase().as_str() {
        "tags" => Some(PropertyType::Tags),
        "aliases" => Some(PropertyType::Aliases),
        "cssclasses" => Some(PropertyType::List),
        _ => None,
    }
}

fn unknown(key: String, inline: Option<&str>, rest: &[String], line: usize) -> Property {
    let mut value = inline.unwrap_or("").to_string();
    for s in rest {
        value.push('\n');
        value.push_str(s);
    }
    Property {
        key,
        kind: PropertyType::Unknown,
        value: PropertyValue::Text(trim(&value).to_string()),
        line,
        count: 1 + rest.len(),
    }
}
fn has_comment(line: &str) -> bool {
    let blanked = patterns().quoted.replace_all(line, "\"\"");
    let mut prev = None;
    for c in blanked.chars() {
        if c == '#' && prev.is_none_or(is_space) {
            return true;
        }
        prev = Some(c);
    }
    false
}

fn property(key: String, inline: Option<&str>, rest: &[String], line: usize) -> Property {
    let body: Vec<_> = rest.iter().filter(|l| !trim(l).is_empty()).collect();
    let mut items = None;
    let mut single = None;
    if let Some(v) = inline.filter(|v| !v.is_empty()) {
        if !body.is_empty() {
            return unknown(key, inline, rest, line);
        }
        items = flow_list(v);
        if items.is_none() {
            single = scalar(v);
            if single.is_none() {
                return unknown(key, inline, rest, line);
            }
        }
    } else if !body.is_empty() {
        let p = patterns();
        let Some(first) = p.item.captures(body[0]) else {
            return unknown(key, inline, rest, line);
        };
        let mut list = Vec::new();
        for l in body {
            let Some(m) = p.item.captures(l) else {
                return unknown(key, inline, rest, line);
            };
            if m[1] != first[1] {
                return unknown(key, inline, rest, line);
            }
            let Some(s) = scalar(m.get(2).map_or("", |v| v.as_str())) else {
                return unknown(key, inline, rest, line);
            };
            if s.kind != ScalarKind::Null {
                list.push(s.text);
            }
        }
        items = Some(list);
    } else {
        single = Some(Scalar {
            kind: ScalarKind::Null,
            text: String::new(),
        });
    }

    let (kind, value) = if let Some(kind) = fixed_type(&key) {
        let list = items.unwrap_or_else(|| {
            let text = single.unwrap().text;
            if text.is_empty() {
                Vec::new()
            } else if kind == PropertyType::Tags {
                text.split(|c| c == ',' || is_space(c))
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect()
            } else {
                vec![text]
            }
        });
        (kind, PropertyValue::List(list))
    } else if let Some(list) = items {
        (PropertyType::List, PropertyValue::List(list))
    } else {
        let s = single.unwrap();
        let kind = match s.kind {
            ScalarKind::Bool => PropertyType::Checkbox,
            ScalarKind::Number => PropertyType::Number,
            ScalarKind::Date => PropertyType::Date,
            ScalarKind::Datetime => PropertyType::Datetime,
            _ => PropertyType::Text,
        };
        let value = if s.kind == ScalarKind::Bool {
            PropertyValue::Checkbox(s.text == "true")
        } else {
            PropertyValue::Text(s.text)
        };
        (kind, value)
    };
    Property {
        key,
        kind,
        value,
        line,
        count: 1 + rest.len(),
    }
}

pub(crate) fn read_properties(lines: &[String]) -> Option<Vec<Property>> {
    let mut props = Vec::new();
    let mut keys = HashSet::new();
    let mut i = 0;
    while i < lines.len() {
        if trim(&lines[i]).is_empty() || lines[i].starts_with('#') {
            i += 1;
            continue;
        }
        let m = patterns().key.captures(&lines[i])?;
        let raw_key = &m[1];
        let key = if raw_key.starts_with('"') {
            serde_json::from_str::<String>(raw_key).ok()?
        } else if raw_key.starts_with('\'') {
            raw_key[1..raw_key.len() - 1].replace("''", "'")
        } else {
            trim(raw_key).to_string()
        };
        if !keys.insert(key.to_lowercase()) {
            return None;
        }
        let mut j = i + 1;
        for (k, l) in lines.iter().enumerate().skip(j) {
            if trim(l).is_empty() {
                continue;
            }
            if !(l.starts_with([' ', '\t'])
                || l.strip_prefix('-')
                    .is_some_and(|s| s.is_empty() || s.starts_with([' ', '\t'])))
            {
                break;
            }
            j = k + 1;
        }
        let inline = m.get(2).map(|v| v.as_str());
        let rest = &lines[i + 1..j];
        props.push(
            if inline.is_some_and(has_comment) || rest.iter().any(|l| has_comment(l)) {
                unknown(key, inline, rest, i)
            } else {
                property(key, inline, rest, i)
            },
        );
        i = j;
    }
    Some(props)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fsutil::tmp_dir;

    #[test]
    fn properties_follow_saves_renames_and_deletes() {
        let dir = tmp_dir("props-index");
        let mut idx = Index::default();
        let stamp = super::super::Stamp::default();
        idx.upsert_note(&dir.path, "Folder/A.MD", "\u{feff}---\r\n# header\r\n\r\nTitle: draft\r\nitems:\r\n  - one\r\n\r\n  - two\r\n\r\nflag: TRUE\r\n---\r\nbody", stamp);
        let found = idx.properties(None);
        let note = &found["Folder/A.MD"];
        assert_eq!(
            note.lines,
            [
                "# header",
                "",
                "Title: draft",
                "items:",
                "  - one",
                "",
                "  - two",
                "",
                "flag: TRUE"
            ]
        );
        assert_eq!(
            note.props
                .iter()
                .map(|p| (p.line, p.count))
                .collect::<Vec<_>>(),
            [(2, 1), (3, 4), (8, 1)]
        );
        assert_eq!(
            note.props[1].value,
            PropertyValue::List(vec!["one".into(), "two".into()])
        );
        assert_eq!(note.props[2].value, PropertyValue::Checkbox(true));
        assert!(idx.properties(Some(&[])).is_empty());
        assert!(idx
            .properties(Some(&["missing.md".into(), "Folder".into()]))
            .is_empty());
        idx.upsert_note(&dir.path, "image.png", "---\na: 1\n---", stamp);
        assert_eq!(idx.properties(None).len(), 1);
        idx.upsert_note(&dir.path, "Folder/A.MD", "---\nrank: 1.00\n---", stamp);
        assert_eq!(
            idx.properties(None)["Folder/A.MD"].props[0].value,
            PropertyValue::Text("1.00".into())
        );
        idx.relocate("Folder", "Moved");
        assert!(!idx.properties(None).contains_key("Folder/A.MD"));
        assert!(idx
            .properties(Some(&["Moved/A.MD".into()]))
            .contains_key("Moved/A.MD"));
        idx.relocate("Moved/A.MD", "Moved/A.png");
        assert!(idx.properties(None).is_empty());
        idx.upsert_note(&dir.path, "Moved/B.md", "---\n---", stamp);
        assert!(idx.properties(None)["Moved/B.md"].props.is_empty());
        idx.upsert_note(&dir.path, "Moved/B.md", "no frontmatter", stamp);
        assert!(idx.properties(None).is_empty());
        idx.upsert_note(&dir.path, "Moved/B.md", "---\na: 1\n---", stamp);
        idx.remove_tree("Moved");
        assert!(idx.properties(None).is_empty());
    }

    #[test]
    fn javascript_whitespace_and_ascii_numbers_are_preserved() {
        let note = note_properties("\u{feff} ---\nvalue: \u{a0}42\u{a0}\nother: ٤٢\n---").unwrap();
        assert_eq!(note.props[0].kind, PropertyType::Number);
        assert_eq!(note.props[1].kind, PropertyType::Text);
        assert!(note_properties("---\nkey: text\u{2028}\n---").is_none());
        assert!(note_properties("---\r\r\nkey: value\n---").is_some());
    }
}
