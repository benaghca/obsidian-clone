//! Reading a note for the index: its lines (for search), its links (`[[wikilinks]]`,
//! `![[embeds]]` and `[text](path)` markdown links, outside fenced and inline code) and its
//! frontmatter aliases.

pub(super) struct Line {
    pub(super) text: String,
    pub(super) lower: String,
}

pub(super) struct RawLink {
    pub(super) line: u32,
    pub(super) text: String,
    pub(super) target: String,
    /// A `[text](path)` link rather than a `[[wikilink]]`.
    pub(super) markdown: bool,
}

/// What the index keeps of a note (nothing, for other files and notes too large to index).
#[derive(Default)]
pub(super) struct Note {
    pub(super) links: Vec<RawLink>,
    /// Frontmatter aliases, lower case.
    pub(super) aliases: Vec<String>,
    pub(super) lines: Vec<Line>,
}

/// Frontmatter longer than this many lines is left alone, as the front end does.
const MAX_FRONTMATTER_LINES: usize = 2000;

impl Note {
    /// The note's frontmatter block, its `---` lines included, if the note starts with one.
    pub(super) fn frontmatter(&self) -> Option<String> {
        let texts = self.lines.iter().map(|l| l.text.as_str());
        let close = frontmatter_close(texts.clone(), MAX_FRONTMATTER_LINES)?;
        Some(texts.take(close + 1).collect::<Vec<_>>().join("\n"))
    }
}

/// The index of the `---` that closes a frontmatter starting on the first line, looking at most
/// `limit` lines past it.
fn frontmatter_close<'a>(mut lines: impl Iterator<Item = &'a str>, limit: usize) -> Option<usize> {
    if lines.next()?.trim() != "---" {
        return None;
    }
    Some(1 + lines.take(limit).position(|l| l.trim() == "---")?)
}

pub(super) fn parse_note(content: &str) -> Note {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut links = Vec::new();
    let mut lines = Vec::new();
    // The open code fence's marker and length, while inside one.
    let mut fence: Option<(u8, usize)> = None;
    for (idx, line) in content.lines().enumerate() {
        lines.push(Line {
            lower: line.to_lowercase(),
            text: line.to_string(),
        });
        if let Some((marker, len)) = fence {
            if fence_close(line, marker, len) {
                fence = None;
            }
            continue;
        }
        fence = fence_open(line);
        if fence.is_some() {
            continue;
        }
        let blanked = blank_inline_code(line);
        let wiki = wiki_targets(&blanked).into_iter().map(|t| (t, false));
        let markdown = markdown_targets(&blanked).into_iter().map(|t| (t, true));
        for (target, markdown) in wiki.chain(markdown) {
            links.push(RawLink {
                line: (idx as u32) + 1,
                text: line.to_string(),
                target,
                markdown,
            });
        }
    }
    Note {
        links,
        aliases: parse_aliases(content),
        lines,
    }
}

fn fence_open(line: &str) -> Option<(u8, usize)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let bytes = trimmed.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let marker = bytes[0];
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let mut n = 0;
    while n < bytes.len() && bytes[n] == marker {
        n += 1;
    }
    if n < 3 {
        return None;
    }
    if marker == b'`' && trimmed[n..].contains('`') {
        return None;
    }
    Some((marker, n))
}

fn fence_close(line: &str, marker: u8, len: usize) -> bool {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return false;
    }
    let bytes = trimmed.trim_end().as_bytes();
    bytes.len() >= len && bytes.iter().all(|b| *b == marker)
}

fn blank_inline_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = chars.clone();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '`' {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && chars[i] == '`' {
            i += 1;
        }
        let n = i - start;
        let mut j = i;
        let mut end = None;
        while j < chars.len() {
            if chars[j] != '`' {
                j += 1;
                continue;
            }
            let run = j;
            while j < chars.len() && chars[j] == '`' {
                j += 1;
            }
            if j - run == n {
                end = Some(j);
                break;
            }
        }
        if let Some(end) = end {
            for slot in &mut out[start..end] {
                *slot = ' ';
            }
            i = end;
        }
    }
    out.into_iter().collect()
}

pub(super) fn wiki_targets(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(open) = rest.find("[[") {
        let after = &rest[open + 2..];
        let Some(close) = after.find("]]") else {
            break;
        };
        let inner = &after[..close];
        if !inner.contains('[') && !inner.contains(']') {
            out.extend(clean_target(inner));
        }
        rest = &after[close + 2..];
    }
    out
}

/// The targets of `[text](path)` and `![alt](path)` links on a line: files in the vault, so
/// not URLs (anything with a scheme, like `https:` or `mailto:`) and not `#heading` anchors in
/// the same note. A target is percent-decoded (`My%20Note.md`), without its `#fragment` or
/// title, and may be written in `<angle brackets>`.
pub(super) fn markdown_targets(line: &str) -> Vec<String> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(off) = line[from..].find("](") {
        let close = from + off;
        from = close + 2;
        // The `[` that opens this link text (brackets inside it must balance); `[[...]]` is a wikilink.
        let mut depth = 0i32;
        let mut open = None;
        for j in (0..close).rev() {
            match bytes[j] {
                b']' => depth += 1,
                b'[' if depth == 0 => {
                    open = Some(j);
                    break;
                }
                b'[' => depth -= 1,
                _ => {}
            }
        }
        let Some(open) = open else { continue };
        if (open > 0 && bytes[open - 1] == b'[') || bytes.get(open + 1) == Some(&b'[') {
            continue;
        }
        let rest = &line[from..];
        let raw = if let Some(inner) = rest.strip_prefix('<') {
            match inner.find('>') {
                Some(end) => &inner[..end],
                None => continue,
            }
        } else {
            // Up to the `)` that closes the link (parentheses inside may nest), then the
            // destination ends at the first space (a title may follow).
            let mut depth = 0i32;
            let mut end = None;
            let mut escaped = false;
            for (k, c) in rest.char_indices() {
                if escaped {
                    escaped = false;
                    continue;
                }
                match c {
                    '\\' => escaped = true,
                    '(' => depth += 1,
                    ')' if depth == 0 => {
                        end = Some(k);
                        break;
                    }
                    ')' => depth -= 1,
                    _ => {}
                }
            }
            let Some(end) = end else { continue };
            rest[..end].trim().split_whitespace().next().unwrap_or("")
        };
        let raw = raw.split('#').next().unwrap_or("").trim();
        if raw.is_empty() || has_scheme(raw) {
            continue;
        }
        let mut chars = raw.strip_prefix("./").unwrap_or(raw).chars().peekable();
        let mut target = String::new();
        while let Some(c) = chars.next() {
            if c == '\\' && matches!(chars.peek(), Some('\\' | '(' | ')')) {
                target.push(chars.next().unwrap());
            } else {
                target.push(c);
            }
        }
        let target = percent_decode(&target);
        if !target.trim().is_empty() {
            out.push(target);
        }
    }
    out
}

/// Whether a link destination starts with a URL scheme (`https:`, `mailto:`, `file:`).
fn has_scheme(s: &str) -> bool {
    match s.find(':') {
        Some(i) if i > 0 => {
            let scheme = &s[..i];
            scheme
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic())
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        }
        _ => false,
    }
}

/// `%XX` escapes decoded as UTF-8 (invalid sequences are replaced, a stray `%` is kept).
pub(super) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(b) = hex {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub(super) fn clean_target(inner: &str) -> Option<String> {
    let inner = inner.trim();
    if inner.is_empty() {
        return None;
    }
    // `\|` is how a table cell writes a literal pipe inside `[[Note|alias]]`.
    let normalized = inner.replace("\\|", "|");
    let target = normalized.split('|').next().unwrap_or_default();
    let name = target.split('#').next().unwrap_or_default().trim();
    (!name.is_empty()).then(|| name.to_string())
}

fn parse_aliases(content: &str) -> Vec<String> {
    let Some(close) = frontmatter_close(content.lines(), usize::MAX) else {
        return Vec::new();
    };
    let lines: Vec<&str> = content.lines().take(close).skip(1).collect();
    let mut aliases = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        let rest = key_rest(trimmed, "aliases").or_else(|| key_rest(trimmed, "alias"));
        let Some(rest) = rest else {
            i += 1;
            continue;
        };
        let rest = rest.trim();
        if rest.is_empty() {
            i += 1;
            while i < lines.len() {
                let raw = lines[i];
                if !(raw.starts_with(' ') || raw.starts_with('\t')) {
                    break;
                }
                let item = raw.trim();
                let Some(item) = item.strip_prefix('-') else {
                    break;
                };
                if let Some(value) = yaml_scalar(item) {
                    aliases.push(value.to_lowercase());
                }
                i += 1;
            }
            continue;
        }
        if let Some(inner) = rest.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            for value in split_csv(inner) {
                aliases.push(value.to_lowercase());
            }
        } else if let Some(value) = yaml_scalar(rest) {
            aliases.push(value.to_lowercase());
        }
        i += 1;
    }
    aliases
}

fn key_rest<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.strip_prefix(key)?.strip_prefix(':')
}

fn split_csv(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in s.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => quote = Some(c),
            None if c == ',' => {
                if let Some(value) = yaml_scalar(&cur) {
                    out.push(value);
                }
                cur.clear();
            }
            None => cur.push(c),
        }
    }
    if let Some(value) = yaml_scalar(&cur) {
        out.push(value);
    }
    out
}

fn yaml_scalar(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s == "~" || s.eq_ignore_ascii_case("null") {
        return None;
    }
    let s = if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')))
    {
        &s[1..s.len() - 1]
    } else {
        s
    };
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}
