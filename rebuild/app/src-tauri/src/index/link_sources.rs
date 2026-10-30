//! Notes that might contain a link to one of the given paths, for a rename.
//!
//! A source is a note whose indexed links resolve to one of those paths, or
//! whose text contains one of their names in a spelling Grove already searches
//! for when it rewrites links: the bare name, spaces written as `%20`,
//! `encodeDest` (percent-encoded spaces and parentheses), and parentheses
//! escaped with a backslash. There is no note cap and no hit cap. The match is
//! the spelling itself, in any case, not a search for each word on its own.
use super::{display_name, is_note_path, Index};
use regex::Regex;
use std::collections::BTreeSet;

impl Index {
    /// Vault paths of notes to consider when rewriting links to `paths`.
    /// Empty when `paths` is empty. Sorted, with duplicates removed.
    pub fn link_sources(&self, paths: &[String]) -> Vec<String> {
        let wanted: BTreeSet<&str> = paths.iter().map(String::as_str).collect();
        if wanted.is_empty() {
            return Vec::new();
        }
        let mentions = Mentions::new(mention_needles(&wanted));
        let mut sources = BTreeSet::new();
        for (from, node) in &self.files {
            if node.is_dir || !is_note_path(from) {
                continue;
            }
            let linked = node.note.links.iter().any(|link| {
                self.resolve(from, &link.target)
                    .is_some_and(|target| wanted.contains(target.as_str()))
            });
            if linked || mentions.in_lines(&node.note.lines) {
                sources.insert(from.clone());
            }
        }
        sources.into_iter().collect()
    }
}

/// Lower-cased spellings of each requested note's name. A path that is not a
/// note adds none. The same spelling from two notes is kept once.
fn mention_needles(paths: &BTreeSet<&str>) -> Vec<String> {
    let mut out = BTreeSet::new();
    for path in paths {
        let Some(name) = note_name(path) else {
            continue;
        };
        for spelling in spellings(&name) {
            let low = spelling.to_lowercase();
            if !low.is_empty() {
                out.insert(low);
            }
        }
    }
    out.into_iter().collect()
}

fn note_name(path: &str) -> Option<String> {
    if !is_note_path(path) {
        return None;
    }
    let name = display_name(path, false);
    (!name.is_empty()).then_some(name)
}

/// The five queries `links/update.ts` used to send to search, without the
/// 20-note or 500-hit caps. `encodeDest` matches `links/internal.ts`.
fn spellings(name: &str) -> [String; 5] {
    [
        name.to_string(),
        name.replace(' ', "%20"),
        escape_parens(name),
        encode_dest(name, false),
        encode_dest(name, true),
    ]
}

fn escape_parens(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c == '(' || c == ')' {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// `encodeDest`: `%` then space then parentheses. Escaped parentheses stay
/// backslash escapes instead of `%28` / `%29`.
fn encode_dest(path: &str, escaped: bool) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        match c {
            '%' => out.push_str("%25"),
            ' ' => out.push_str("%20"),
            '(' => out.push_str(if escaped { "\\(" } else { "%28" }),
            ')' => out.push_str(if escaped { "\\)" } else { "%29" }),
            _ => out.push(c),
        }
    }
    out
}

/// Whether any line holds one of the spellings. One regex of the escaped
/// spellings scans each line once (a 500-note folder is 1,000 spellings);
/// a plain loop is the fallback if that regex would be too large to build.
enum Mentions {
    None,
    Any(Regex),
    Each(Vec<String>),
}

impl Mentions {
    fn new(needles: Vec<String>) -> Self {
        if needles.is_empty() {
            return Mentions::None;
        }
        let pattern: Vec<String> = needles.iter().map(|n| regex::escape(n)).collect();
        match Regex::new(&pattern.join("|")) {
            Ok(re) => Mentions::Any(re),
            Err(_) => Mentions::Each(needles),
        }
    }

    fn in_lines(&self, lines: &[super::parse::Line]) -> bool {
        match self {
            Mentions::None => false,
            Mentions::Any(re) => lines.iter().any(|line| re.is_match(&line.lower)),
            Mentions::Each(needles) => lines
                .iter()
                .any(|line| needles.iter().any(|n| line.lower.contains(n.as_str()))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(pairs: &[(&str, &str)]) -> Index {
        Index::from_notes(pairs)
    }

    #[test]
    fn empty_and_duplicate_requests_add_nothing() {
        let idx = notes(&[("Target.md", "x"), ("Source.md", "[[Target]]")]);
        assert!(idx.link_sources(&[]).is_empty());
        let paths = vec!["Target.md".into(), "Target.md".into(), "missing.md".into()];
        assert_eq!(idx.link_sources(&paths), vec!["Source.md".to_string()]);
    }

    #[test]
    fn resolved_wikilinks_markdown_links_and_embeds_count() {
        let idx = notes(&[
            ("Dir/Target.md", "x"),
            ("Dir/Source.md", "[[Target]] [md](Target.md) ![[Target]]"),
            ("Outside.md", "[[Dir/Target#Head|alias]]"),
            ("Plain.md", "no link here"),
        ]);
        assert_eq!(
            idx.link_sources(&["Dir/Target.md".into()]),
            vec!["Dir/Source.md".to_string(), "Outside.md".to_string()]
        );
    }

    #[test]
    fn each_link_spelling_matches_on_its_own() {
        let idx = notes(&[
            ("My Note.md", "the note"),
            ("A(b).md", "parens"),
            ("Bare.md", "see [[My Note]] later"),
            ("Encoded space.md", "a [[My%20Note]] wikilink"),
            ("Words apart.md", "my favorite note"),
            ("Percent.md", "token A%28b%29 token"),
            ("Escaped.md", "token A\\(b\\) token"),
            ("File (1).md", "numbered"),
            ("Bare paren.md", "prefix File (1) suffix"),
            ("Space encoded.md", "prefix File%20(1) suffix"),
            ("Fully encoded.md", "prefix File%20%281%29 suffix"),
            ("Slash escaped.md", "prefix File%20\\(1\\) suffix"),
        ]);
        assert_eq!(
            idx.link_sources(&["My Note.md".into()]),
            vec!["Bare.md".to_string(), "Encoded space.md".to_string()]
        );
        assert_eq!(
            idx.link_sources(&["A(b).md".into()]),
            vec!["Escaped.md".to_string(), "Percent.md".to_string()]
        );
        assert_eq!(
            idx.link_sources(&["File (1).md".into()]),
            vec![
                "Bare paren.md".to_string(),
                "Fully encoded.md".to_string(),
                "Slash escaped.md".to_string(),
                "Space encoded.md".to_string(),
            ]
        );
    }

    #[test]
    fn fenced_text_still_counts_as_a_mention_and_non_notes_do_not() {
        let idx = notes(&[
            ("Target.md", "x"),
            ("Code.md", "```\n[[Target]]\n```"),
            ("pic.png", "not a note"),
            ("Embed.md", "![[pic.png]]"),
        ]);
        assert_eq!(
            idx.link_sources(&["Target.md".into()]),
            vec!["Code.md".to_string()]
        );
        assert_eq!(
            idx.link_sources(&["pic.png".into()]),
            vec!["Embed.md".to_string()]
        );
    }

    #[test]
    fn a_folder_of_fifty_notes_is_not_capped() {
        let mut owned = Vec::new();
        for i in 0..50 {
            owned.push((format!("Old/Note{i}.md"), "body".to_string()));
            owned.push((format!("Link{i}.md"), format!("[[Old/Note{i}]]")));
        }
        let refs: Vec<(&str, &str)> = owned.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
        let idx = notes(&refs);
        let paths: Vec<String> = (0..50).map(|i| format!("Old/Note{i}.md")).collect();
        let found = idx.link_sources(&paths);
        let mut expected: Vec<String> = (0..50).map(|i| format!("Link{i}.md")).collect();
        expected.sort();
        assert_eq!(found, expected);
    }

    #[test]
    fn an_upper_case_extension_uses_the_note_name() {
        let idx = notes(&[
            ("Other.md", "see FOO in the text"),
            ("Src.MD", "\u{feff}first\r\n[[Foo]]\r\n"),
        ]);
        assert_eq!(
            idx.link_sources(&["Foo.MD".into()]),
            vec!["Other.md".to_string(), "Src.MD".to_string()]
        );
    }
}
