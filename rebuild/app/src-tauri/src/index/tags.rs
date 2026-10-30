//! A note's tags: a port of `tagsInText` (`src/shell/linksTags.ts`), which stays the spec.
//! `fixtures/parity/tags.json` checks both against the same cases.
//!
//! The rules are TypeScript's, not parse.rs's: fenced code uses CommonMark's rule (at most 3
//! spaces before the fence, closed only by the same marker, at least as long, with nothing after
//! it), and inline code is a pair of single backticks. `\s` and `trim()` are JavaScript's
//! whitespace (`is_js_space`), and JavaScript's `.` stops at `\r`, U+2028 and U+2029, so a line
//! that holds one of those mid-line does not match where TypeScript's pattern would not.

use regex::Regex;
use std::sync::OnceLock;

/// Frontmatter longer than this many lines is left alone, as in `editor/frontmatter.ts`.
const MAX_FRONTMATTER_LINES: usize = 2000;

/// The characters JavaScript's `.` does not match (besides `\n`, which splits lines).
const LINE_BREAKS: [char; 3] = ['\r', '\u{2028}', '\u{2029}'];

/// Every tag in a note's text, without the `#`, in order: its frontmatter `tags:` / `tag:`
/// values, then the `#tags` in its body outside fenced and inline code. Repeats are kept.
pub(super) fn note_tags(text: &str) -> Vec<String> {
    let no_body_tags = !text.contains('#');
    let lines: Vec<&str> = text
        .split('\n')
        .take(if no_body_tags { MAX_FRONTMATTER_LINES + 1 } else { usize::MAX })
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    let mut out = Vec::new();
    let mut body = 0;
    // `startsWith`, then a trimmed first line: a BOM or a space before the `---` means none.
    let close = if text.starts_with("---") {
        frontmatter_close(&lines)
    } else {
        None
    };
    if let Some(close) = close {
        frontmatter_tags(&lines[1..close], &mut out);
        body = close + 1;
    }
    if no_body_tags { return out; }
    let mut fence = None;
    for line in &lines[body..] {
        if step_fence(&mut fence, line) || !line.contains('#') {
            continue;
        }
        line_tags(line, &mut out);
    }
    out
}

/// Whether `c` can be part of a tag. This is TypeScript's `[\p{L}\p{N}_/-]`: a letter or digit
/// of any script, `_`, `-` or `/`. So a combining mark (a decomposed `é`, a Devanagari vowel
/// sign), an emoji or `。` ends a tag.
///
/// Kept to this one function on purpose. Obsidian is believed to use a denylist instead (any
/// character but whitespace, ASCII punctuation other than `_ - /`, and U+2000–206F /
/// U+2E00–2E7F), which keeps marks, emoji and `。`. If a check in Obsidian confirms that, change
/// it here, in `TAG` / `TAG_VALUE` in linksTags.ts, and in the tags.json cases that carry an
/// `obsidian` value.
fn is_tag_char(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '/');
    }
    // std has no general-category test (`char::is_alphabetic` also takes marks), so this asks
    // `regex`, which Tauri already compiles in.
    static LETTER_OR_DIGIT: OnceLock<Regex> = OnceLock::new();
    LETTER_OR_DIGIT
        .get_or_init(|| Regex::new(r"^[\p{L}\p{N}]$").expect("valid pattern"))
        .is_match(c.encode_utf8(&mut [0; 4]))
}

/// JavaScript's `\s` (and what its `trim()` removes).
pub(super) fn is_js_space(c: char) -> bool {
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

pub(super) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// Only ASCII digits: `#123` is not a tag.
fn all_digits(tag: &str) -> bool {
    tag.bytes().all(|b| b.is_ascii_digit())
}

/// The index of the `---` that closes a frontmatter starting on the first line
/// (`splitFrontmatter`).
fn frontmatter_close(lines: &[&str]) -> Option<usize> {
    if js_trim(lines[0]) != "---" {
        return None;
    }
    let mut after = lines.iter().take(MAX_FRONTMATTER_LINES + 1).skip(1);
    after.position(|l| js_trim(l) == "---").map(|i| i + 1)
}

/// The values of each `tags:` (or legacy `tag:`) key, in any case: a YAML list (`- a`), an
/// inline list (`[a, "#b"]`) or a plain value (`a, b` or `a b`), with or without the `#`.
fn frontmatter_tags(lines: &[&str], out: &mut Vec<String>) {
    for (i, line) in lines.iter().enumerate() {
        let Some(rest) = tags_key(line) else {
            continue;
        };
        let value = js_trim(without_comment(rest));
        let items: Vec<&str> = if let Some(list) = value.strip_prefix('[') {
            list.strip_suffix(']').unwrap_or(list).split(',').collect()
        } else if !value.is_empty() {
            value.split(|c| c == ',' || is_js_space(c)).collect()
        } else {
            let mut items = Vec::new();
            for next in &lines[i + 1..] {
                if let Some(item) = list_item(next) {
                    items.push(item);
                } else if !js_trim(next).is_empty() && !next.starts_with(is_js_space) {
                    break;
                }
            }
            items
        };
        out.extend(items.into_iter().filter_map(tag_value));
    }
}

/// What follows `tags:` or `tag:` (`/^(tags?)\s*:(.*)$/i`).
fn tags_key(line: &str) -> Option<&str> {
    let rest = line.get(..3).filter(|k| k.eq_ignore_ascii_case("tag"))?;
    let rest = &line[rest.len()..];
    let rest = rest.strip_prefix(['s', 'S']).unwrap_or(rest);
    let rest = rest.trim_start_matches(is_js_space).strip_prefix(':')?;
    (!rest.contains(LINE_BREAKS)).then_some(rest)
}

/// A value without a YAML comment after it: from the first whitespace run followed by `#`.
fn without_comment(value: &str) -> &str {
    let mut space = None;
    for (i, c) in value.char_indices() {
        if is_js_space(c) {
            space.get_or_insert(i);
        } else if let (Some(start), '#') = (space, c) {
            return &value[..start];
        } else {
            space = None;
        }
    }
    value
}

/// The value of a YAML list item (`/^\s*-\s*(.*)$/`).
fn list_item(line: &str) -> Option<&str> {
    let rest = line.trim_start_matches(is_js_space).strip_prefix('-')?;
    let rest = rest.trim_start_matches(is_js_space);
    (!rest.contains(LINE_BREAKS)).then_some(rest)
}

/// A frontmatter tag value without its quotes, a leading `#` and trailing `/`s, if it is a
/// valid tag as a whole.
fn tag_value(raw: &str) -> Option<String> {
    let mut tag = js_trim(raw);
    if let Some(quote) = tag.chars().next().filter(|q| matches!(q, '"' | '\'')) {
        if tag.len() >= 2 && tag.ends_with(quote) {
            tag = js_trim(&tag[1..tag.len() - 1]);
        }
    }
    let tag = tag.strip_prefix('#').unwrap_or(tag).trim_end_matches('/');
    let valid = !tag.is_empty() && tag.chars().all(is_tag_char) && !all_digits(tag);
    valid.then(|| tag.to_string())
}

/// Step over one line of the body (`Fences.step`). `open` is the open fence's marker and length.
/// True when the line opens, closes or sits inside a fenced block: no tags on it.
fn step_fence(open: &mut Option<(char, usize)>, line: &str) -> bool {
    let fence = fence_line(line);
    if let Some((marker, len)) = *open {
        if fence.is_some_and(|(m, n, rest)| m == marker && n >= len && js_trim(rest).is_empty()) {
            *open = None;
        }
        return true;
    }
    match fence {
        Some((m, n, rest)) if !(m == '`' && rest.contains('`')) => {
            *open = Some((m, n));
            true
        }
        _ => false,
    }
}

/// A line that could open or close a fence (`/^ {0,3}(`{3,}|~{3,})(.*)$/`): its marker, the
/// marker's length and the rest of the line.
fn fence_line(line: &str) -> Option<(char, usize, &str)> {
    let body = line.trim_start_matches(' ');
    if line.len() - body.len() > 3 {
        return None;
    }
    let marker = body.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let rest = body.trim_start_matches(marker);
    let len = body.len() - rest.len();
    (len >= 3 && !rest.contains(LINE_BREAKS)).then_some((marker, len, rest))
}

/// The `#tags` on one line of the body (`tagsInLine`): a `#` at the line start or after
/// whitespace, then tag characters. Inline code is skipped.
fn line_tags(line: &str, out: &mut Vec<String>) {
    let text = without_inline_code(line);
    let mut prev = None;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '#' && prev.map_or(true, is_js_space) {
            let start = i + 1;
            let mut end = start;
            while let Some(&(j, t)) = chars.peek().filter(|(_, t)| is_tag_char(*t)) {
                end = j + t.len_utf8();
                chars.next();
            }
            let tag = text[start..end].trim_end_matches('/');
            if !tag.is_empty() && !all_digits(tag) {
                out.push(tag.to_string());
            }
            prev = text[..end].chars().next_back();
            continue;
        }
        prev = Some(c);
    }
}

/// Each `` `code` `` span (single backticks) replaced by a space (`` /`[^`]*`/g ``).
fn without_inline_code(line: &str) -> std::borrow::Cow<'_, str> {
    if !line.contains('`') {
        return line.into();
    }
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(open) = rest.find('`') {
        let Some(close) = rest[open + 1..].find('`') else {
            break;
        };
        out.push_str(&rest[..open]);
        out.push(' ');
        rest = &rest[open + 1 + close + 1..];
    }
    out.push_str(rest);
    out.into()
}
