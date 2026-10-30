//! Search evaluation over indexed text/tags/properties. The TS searchVault reference is the spec.
//! Results retain BTreeMap path order; locale sorting/exclusions belong to the frontend.
use super::parse::Note;
use super::props::PropertyValue;
use super::query::{parse_query, Field, Query};
use super::tags::is_js_space;
use super::{basename, is_note_path, Index};
use crate::model::{SearchLine, SearchNote};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap, HashSet};

impl Index {
    pub fn search_notes(&self, query: &str, match_case: bool) -> Vec<SearchNote> {
        let Some(q) = parse_query(query, match_case) else {
            return Vec::new();
        };
        let plan = Plan::new(&q, match_case);
        self.files
            .iter()
            .filter(|(path, node)| !node.is_dir && is_note_path(path))
            .filter_map(|(path, node)| {
                let mut eval = Evaluation::new(&plan, path, &node.note);
                if !eval.passes(&q) {
                    return None;
                }
                let count = if plan.highlights.is_empty() {
                    0
                } else {
                    let shown = eval.shown_lines();
                    eval.match_count(&shown)
                };
                Some(SearchNote {
                    path: path.clone(),
                    count,
                })
            })
            .collect()
    }

    pub fn search_lines(
        &self,
        query: &str,
        match_case: bool,
        paths: &[String],
        limit: u32,
    ) -> BTreeMap<String, Vec<SearchLine>> {
        let Some(q) = parse_query(query, match_case) else {
            return BTreeMap::new();
        };
        let mut found = BTreeMap::new();
        if limit == 0 {
            return found;
        }
        let plan = Plan::new(&q, match_case);
        for path in paths {
            if found.contains_key(path) || !is_note_path(path) {
                continue;
            }
            let Some(node) = self.files.get(path).filter(|n| !n.is_dir) else {
                continue;
            };
            let mut eval = Evaluation::new(&plan, path, &node.note);
            if !eval.passes(&q) {
                continue;
            }
            let lines: Vec<_> = eval
                .shown_lines()
                .into_iter()
                .take(limit as usize)
                .map(|(line, text)| SearchLine {
                    line,
                    text: text.to_string(),
                })
                .collect();
            if !lines.is_empty() {
                found.insert(path.clone(), lines);
            }
        }
        found
    }

    pub fn search_match(&self, queries: &[String]) -> Vec<Vec<String>> {
        queries
            .iter()
            .map(|query| {
                let Some(q) = parse_query(query, false) else {
                    return Vec::new();
                };
                let plan = Plan::new(&q, false);
                self.files
                    .iter()
                    .filter(|(_, n)| !n.is_dir)
                    .filter_map(|(path, node)| {
                        Evaluation::new(&plan, path, &node.note)
                            .passes(&q)
                            .then(|| path.clone())
                    })
                    .collect()
            })
            .collect()
    }

    /// Also used by the parity runner for attachments with Match case on.
    #[cfg(test)]
    pub(super) fn passes(&self, path: &str, q: &Query, match_case: bool) -> bool {
        let plan = Plan::new(q, match_case);
        self.files
            .get(path)
            .is_some_and(|node| !node.is_dir && Evaluation::new(&plan, path, &node.note).passes(q))
    }
}

fn text_of(q: &Query) -> Option<Cow<'_, str>> {
    match q {
        Query::Term {
            text,
            field: Field::Any | Field::Content,
        } => Some(Cow::Borrowed(text)),
        Query::Term {
            text,
            field: Field::Tag,
        } => Some(Cow::Owned(format!("#{text}"))),
        _ => None,
    }
}

fn leaves<'a>(q: &'a Query, negated: bool, out: &mut Vec<(&'a Query, bool)>) {
    match q {
        Query::And { parts } | Query::Or { parts } => {
            for p in parts {
                leaves(p, negated, out);
            }
        }
        Query::Not { part } => leaves(part, !negated, out),
        _ => out.push((q, negated)),
    }
}

/// termsOf includes negated terms and nested line groups, but not property-value terms.
fn terms_of(q: &Query, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    match q {
        Query::And { parts } | Query::Or { parts } => {
            for p in parts {
                terms_of(p, out, seen);
            }
        }
        Query::Not { part } | Query::Line { part } => terms_of(part, out, seen),
        _ => {
            if let Some(text) = text_of(q).filter(|s| !s.is_empty()) {
                if seen.insert(text.to_string()) {
                    out.push(text.into_owned());
                }
            }
        }
    }
}

fn highlights_of(q: &Query, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    let mut all = Vec::new();
    leaves(q, false, &mut all);
    for (leaf, negated) in all {
        if negated {
            continue;
        }
        match leaf {
            Query::Line { part } => highlights_of(part, out, seen),
            Query::Prop {
                value: Some(value), ..
            } => highlights_of(value, out, seen),
            _ => {
                if let Some(text) = text_of(leaf).filter(|s| !s.is_empty()) {
                    if seen.insert(text.to_string()) {
                        out.push(text.into_owned());
                    }
                }
            }
        }
    }
}

struct Needle {
    words: Vec<String>,
    whole: Option<String>,
}
impl Needle {
    fn new(text: &str, match_case: bool) -> Self {
        Self {
            words: text
                .split(is_js_space)
                .filter(|s| !s.is_empty())
                .map(str::to_lowercase)
                .collect(),
            whole: (match_case || text.contains(' ')).then(|| {
                if match_case {
                    text.to_string()
                } else {
                    text.to_lowercase()
                }
            }),
        }
    }
}
struct Leaf<'q> {
    query: &'q Query,
    negated: bool,
    term: Option<usize>,
}
struct Plan<'q> {
    match_case: bool,
    needles: Vec<Needle>,
    ids: HashMap<String, usize>,
    leaves: Vec<Leaf<'q>>,
    line_groups: Vec<(&'q Query, Vec<usize>)>,
    highlights: Vec<String>,
}
impl<'q> Plan<'q> {
    fn new(q: &'q Query, match_case: bool) -> Self {
        let mut plan = Self {
            match_case,
            needles: Vec::new(),
            ids: HashMap::new(),
            leaves: Vec::new(),
            line_groups: Vec::new(),
            highlights: Vec::new(),
        };
        plan.prepare(q);
        let mut all = Vec::new();
        leaves(q, false, &mut all);
        for (query, negated) in all {
            // shownLines asks facts.lines("") for file/path leaves. searchVault
            // returns every line for it: preserve that quirk, even with count 0.
            let term = if matches!(query, Query::Term { .. }) {
                Some(plan.add(&text_of(query).unwrap_or(Cow::Borrowed(""))))
            } else {
                None
            };
            plan.leaves.push(Leaf {
                query,
                negated,
                term,
            });
        }
        highlights_of(q, &mut plan.highlights, &mut HashSet::new());
        plan.highlights
            .sort_by_key(|s| std::cmp::Reverse(s.encode_utf16().count()));
        plan
    }
    fn add(&mut self, text: &str) -> usize {
        if let Some(&id) = self.ids.get(text) {
            return id;
        }
        let id = self.needles.len();
        self.needles.push(Needle::new(text, self.match_case));
        self.ids.insert(text.to_string(), id);
        id
    }
    fn prepare(&mut self, q: &'q Query) {
        match q {
            Query::And { parts } | Query::Or { parts } => {
                for p in parts {
                    self.prepare(p);
                }
            }
            Query::Not { part } => self.prepare(part),
            Query::Line { part } => {
                let mut terms = Vec::new();
                terms_of(part, &mut terms, &mut HashSet::new());
                let ids = terms.iter().map(|t| self.add(t)).collect();
                self.line_groups.push((part, ids));
                self.prepare(part);
            }
            Query::Term { .. } => {
                if let Some(text) = text_of(q) {
                    self.add(&text);
                }
            }
            Query::Prop { .. } => {}
        }
    }
}

struct Evaluation<'a, 'q> {
    plan: &'a Plan<'q>,
    path: Cow<'a, str>,
    note: &'a Note,
    hits: Vec<Option<Vec<usize>>>,
    line_hits: Vec<Option<Vec<usize>>>,
}
impl<'a, 'q> Evaluation<'a, 'q> {
    fn new(plan: &'a Plan<'q>, path: &'a str, note: &'a Note) -> Self {
        Self {
            plan,
            path: if plan.match_case {
                Cow::Borrowed(path)
            } else {
                Cow::Owned(path.to_lowercase())
            },
            note,
            hits: vec![None; plan.needles.len()],
            line_hits: vec![None; plan.line_groups.len()],
        }
    }
    /// termLines: case-insensitive per-word prefilter ALWAYS runs, including Match case.
    fn term_lines(&mut self, id: usize) -> &[usize] {
        self.hits[id].get_or_insert_with(|| {
            let needle = &self.plan.needles[id];
            self.note
                .lines
                .iter()
                .enumerate()
                .filter(|(_, line)| {
                    needle.words.iter().all(|w| line.lower.contains(w))
                        && needle.whole.as_ref().is_none_or(|text| {
                            (if self.plan.match_case {
                                &line.text
                            } else {
                                &line.lower
                            })
                            .contains(text)
                        })
                })
                .map(|(i, _)| i)
                .collect()
        })
    }
    fn line_hits(&mut self, q: &Query) -> &[usize] {
        let group = self
            .plan
            .line_groups
            .iter()
            .position(|(part, _)| std::ptr::eq(*part, q))
            .expect("prepared line group");
        if self.line_hits[group].is_none() {
            let note = self.note;
            let mut seen = vec![false; note.lines.len()];
            for &id in &self.plan.line_groups[group].1 {
                for &i in self.term_lines(id) {
                    seen[i] = true;
                }
            }
            self.line_hits[group] = Some(
                seen.into_iter()
                    .enumerate()
                    .filter(|(i, yes)| {
                        *yes && holds(
                            q,
                            if self.plan.match_case {
                                &note.lines[*i].text
                            } else {
                                &note.lines[*i].lower
                            },
                        )
                    })
                    .map(|(i, _)| i)
                    .collect(),
            );
        }
        self.line_hits[group].as_deref().unwrap()
    }
    fn passes(&mut self, q: &Query) -> bool {
        match q {
            Query::And { parts } => parts.iter().all(|p| self.passes(p)),
            Query::Or { parts } => parts.iter().any(|p| self.passes(p)),
            Query::Not { part } => !self.passes(part),
            Query::Line { part } => !self.line_hits(part).is_empty(),
            Query::Prop { key, value } => self.note.props.as_ref().is_some_and(|fm| {
                fm.props.iter().any(|p| {
                    p.key.to_lowercase() == *key
                        && value.as_ref().is_none_or(|q| {
                            let test = |text: &str| {
                                if self.plan.match_case {
                                    holds(q, text)
                                } else {
                                    holds(q, &text.to_lowercase())
                                }
                            };
                            match &p.value {
                                PropertyValue::Text(s) => test(s),
                                PropertyValue::Checkbox(b) => {
                                    test(if *b { "true" } else { "false" })
                                }
                                PropertyValue::List(items) => items.iter().any(|s| test(s)),
                            }
                        })
                })
            }),
            Query::Term { text, field } => match field {
                Field::File => basename(&self.path).contains(text),
                Field::Path => self.path.contains(text),
                Field::Tag => self.note.tags.iter().any(|tag| {
                    let lower = tag.to_lowercase();
                    lower == *text
                        || lower
                            .strip_prefix(text.as_str())
                            .is_some_and(|tail| tail.starts_with('/'))
                }),
                Field::Any | Field::Content => {
                    let name = basename(&self.path);
                    let stem = if is_note_path(name) {
                        &name[..name.len() - 3]
                    } else {
                        name
                    };
                    (*field == Field::Any && stem.contains(text))
                        || !self.term_lines(self.plan.ids[text]).is_empty()
                }
            },
        }
    }
    fn shown_lines(&mut self) -> Vec<(u32, &'a str)> {
        let note = self.note;
        // A slot per indexed line unions hits without per-hit tree allocation.
        // Later leaves overwrite earlier ones, including normalized property text.
        let mut out = vec![None; note.lines.len()];
        for leaf in &self.plan.leaves {
            if leaf.negated {
                continue;
            }
            match leaf.query {
                Query::Line { part } => {
                    for &i in self.line_hits(part) {
                        out[i] = Some(note.lines[i].text.as_str());
                    }
                }
                Query::Prop { key, .. } => {
                    if self.passes(leaf.query) {
                        if let Some(fm) = &note.props {
                            if let Some(p) = fm.props.iter().find(|p| p.key.to_lowercase() == *key)
                            {
                                out[p.line + 1] = Some(fm.lines[p.line].as_str());
                            }
                        }
                    }
                }
                _ => {
                    for &i in self.term_lines(leaf.term.expect("term leaf")) {
                        out[i] = Some(note.lines[i].text.as_str());
                    }
                }
            }
        }
        out.into_iter()
            .enumerate()
            .filter_map(|(i, text)| text.map(|text| (i as u32 + 1, text)))
            .collect()
    }
    fn match_count(&self, shown: &[(u32, &str)]) -> u32 {
        let words = &self.plan.highlights;
        if words.is_empty() {
            return 0;
        }
        let mut count = 0u32;
        let mut spans = Vec::new();
        for &(line, text) in shown {
            let folded = if self.plan.match_case {
                Cow::Borrowed(text)
            } else if let Some(indexed) = self
                .note
                .lines
                .get(line as usize - 1)
                .filter(|l| l.text == text)
            {
                Cow::Borrowed(indexed.lower.as_str())
            } else {
                Cow::Owned(text.to_lowercase())
            };
            if words.len() == 1 {
                count = count.saturating_add(
                    folded
                        .match_indices(words[0].as_str())
                        .count()
                        .min(u32::MAX as usize) as u32,
                );
                continue;
            }
            spans.clear();
            for word in words {
                spans.extend(
                    folded
                        .match_indices(word.as_str())
                        .map(|(start, _)| (start, start + word.len())),
                );
            }
            spans.sort_by_key(|s| s.0);
            let mut end = 0;
            for &(start, to) in &spans {
                if start >= end {
                    count = count.saturating_add(1);
                }
                end = end.max(to);
            }
        }
        count
    }
}

/// holds ignores field semantics, and does not descend into line/property operators.
fn holds(q: &Query, text: &str) -> bool {
    match q {
        Query::And { parts } => parts.iter().all(|p| holds(p, text)),
        Query::Or { parts } => parts.iter().any(|p| holds(p, text)),
        Query::Not { part } => !holds(part, text),
        Query::Term { text: needle, .. } => text.contains(needle),
        _ => false,
    }
}

/// C1-A timings, kept separate from the B1-owned general benchmark harness.
/// Generate /tmp/grove-bench-5000 with scripts/gen-vault.mjs, then run
/// cargo test --offline [--release] bench_search_commands -- --ignored --nocapture
#[cfg(test)]
mod timings {
    use super::*;
    use std::path::Path;
    use std::time::Instant;

    fn measure<T: serde::Serialize>(mut run: impl FnMut() -> T) -> (T, Vec<f64>, usize) {
        let _ = serde_json::to_vec(&run()).unwrap(); // warm up the full command
        let mut samples = Vec::new();
        let mut last = None;
        let mut bytes = 0;
        for _ in 0..3 {
            let started = Instant::now();
            let value = run();
            bytes = serde_json::to_vec(&value).unwrap().len();
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
            last = Some(value);
        }
        (last.unwrap(), samples, bytes)
    }
    fn report(kind: &str, query: &str, samples: &[f64], bytes: usize, sizes: &str) {
        let mut sorted = samples.to_vec();
        sorted.sort_by(f64::total_cmp);
        println!(
            "C1A {kind} query={query:?} ms={samples:.3?} median={:.3} bytes={bytes} {sizes}",
            sorted[1]
        );
    }
    #[test]
    #[ignore]
    fn bench_search_commands() {
        let root =
            std::env::var("GROVE_BENCH_VAULT").unwrap_or_else(|_| "/tmp/grove-bench-5000".into());
        let index = Index::scan(Path::new(&root)).unwrap();
        let bytes: u64 = index
            .files
            .values()
            .filter(|n| !n.is_dir)
            .map(|n| n.stamp.size)
            .sum();
        println!(
            "C1A profile={} vault={root} bytes={bytes}",
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            }
        );
        for (query, case) in [
            ("meeting", false),
            ("alpha", false),
            ("zzz", false),
            ("garden river", false),
            ("\"garden path\"", false),
            ("meeting -garden (river OR stone)", false),
            ("tag:project", false),
            ("[tags:meeting]", false),
            ("line:(garden river)", false),
            ("Meeting", true),
        ] {
            let (notes, samples, bytes) = measure(|| index.search_notes(query, case));
            let total: u64 = notes.iter().map(|n| n.count as u64).sum();
            if query == "meeting" {
                assert_eq!(total, 131_948);
            }
            report(
                "search_notes",
                query,
                &samples,
                bytes,
                &format!("notes={} total={total}", notes.len()),
            );
        }
        let paths: Vec<_> = index
            .search_notes("meeting", false)
            .into_iter()
            .take(50)
            .map(|n| n.path)
            .collect();
        let (lines, samples, bytes) = measure(|| index.search_lines("meeting", false, &paths, 5));
        report(
            "search_lines",
            "meeting; first 50; limit 5",
            &samples,
            bytes,
            &format!(
                "notes={} lines={}",
                lines.len(),
                lines.values().map(Vec::len).sum::<usize>()
            ),
        );
        let queries = ["meeting", "tag:project/alpha", "path:\"Folder 01\""].map(String::from);
        let (matched, samples, bytes) = measure(|| index.search_match(&queries));
        report(
            "search_match",
            &format!("{queries:?}"),
            &samples,
            bytes,
            &format!(
                "paths={:?}",
                matched.iter().map(Vec::len).collect::<Vec<_>>()
            ),
        );
    }
}
