//! Search query parser: a line-by-line port of `parseQuery`, `term` and `scoped`
//! (`src/shell/searchQuery.ts`), which stays the spec. `fixtures/parity/query.json` checks both
//! against the same cases.
//!
//! `\s` and `trim()` use JavaScript's whitespace (`tags::is_js_space`, `tags::js_trim`), operator
//! names are ASCII letters only (`/^([a-z]+):/i`), and nesting deeper than 64 levels of `(`,
//! negating `-`, or `[property]` returns `None`.

#![allow(dead_code)]

use super::tags::{is_js_space, js_trim};
use serde::Serialize;

/// Deeper than this many `(`, negating `-`, or `[property]` is nothing to search for.
const QUERY_DEPTH: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Field {
    Any,
    Content,
    File,
    Path,
    Tag,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub(super) enum Query {
    And {
        parts: Vec<Query>,
    },
    Or {
        parts: Vec<Query>,
    },
    Not {
        part: Box<Query>,
    },
    /// A word or phrase, lower case (as typed with Match case), looked for in `field`.
    Term {
        text: String,
        field: Field,
    },
    /// Every term of `part` on one line.
    Line {
        part: Box<Query>,
    },
    /// A property by name; `value`, if given, must match one of its values.
    Prop {
        key: String,
        value: Option<Box<Query>>,
    },
}

enum Unary {
    Or,
    Query(Query),
    None,
}

enum Op {
    Line,
    Field(Field),
}

/// The query, or `None` when there is nothing to search for.
pub(super) fn parse_query(input: &str, match_case: bool) -> Option<Query> {
    let mut parser = Parser {
        input,
        match_case,
        at: 0,
        depth: 0,
        too_deep: false,
        in_property: false,
    };
    let parsed = parser.group('\0', Field::Any);
    if parser.too_deep {
        None
    } else {
        parsed
    }
}

struct Parser<'a> {
    input: &'a str,
    match_case: bool,
    at: usize,
    depth: usize,
    too_deep: bool,
    /// Inside `[property:...]`, where `]` ends a word.
    in_property: bool,
}

impl<'a> Parser<'a> {
    fn fold(&self, text: &str) -> String {
        if self.match_case {
            text.to_owned()
        } else {
            text.to_lowercase()
        }
    }

    fn enter(&mut self) -> bool {
        if self.depth >= QUERY_DEPTH {
            self.too_deep = true;
            return false;
        }
        self.depth += 1;
        true
    }

    fn leave(&mut self) {
        self.depth -= 1;
    }

    fn peek(&self) -> Option<char> {
        self.input[self.at..].chars().next()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += c.len_utf8();
        Some(c)
    }

    fn space(&mut self) {
        while self.peek().is_some_and(is_js_space) {
            self.bump();
        }
    }

    /// A quoted phrase or a bare word (which ends at a space or a closing bracket).
    fn word(&mut self) -> &'a str {
        if self.peek() == Some('"') {
            let start = self.at + 1;
            if let Some(rel) = self.input[start..].find('"') {
                let end = start + rel;
                self.at = end + 1;
                &self.input[start..end]
            } else {
                self.at = self.input.len();
                &self.input[start..]
            }
        } else {
            let start = self.at;
            while let Some(c) = self.peek() {
                if is_js_space(c) || c == '(' || c == ')' || (self.in_property && c == ']') {
                    break;
                }
                self.bump();
            }
            &self.input[start..self.at]
        }
    }

    fn group(&mut self, stop: char, field: Field) -> Option<Query> {
        let mut parts: Vec<Vec<Query>> = vec![Vec::new()];
        self.space();
        while self.at < self.input.len() && self.peek() != Some(stop) {
            match self.unary(field) {
                Unary::Or => parts.push(Vec::new()),
                Unary::Query(q) => parts.last_mut().unwrap().push(q),
                Unary::None => {}
            }
            self.space();
        }
        if self.peek() == Some(stop) {
            self.bump();
        }
        let mut ors: Vec<Query> = parts.into_iter().filter_map(all).collect();
        if ors.len() > 1 {
            Some(Query::Or { parts: ors })
        } else {
            ors.pop()
        }
    }

    fn unary(&mut self, field: Field) -> Unary {
        if self.peek() == Some(')') || (self.in_property && self.peek() == Some(']')) {
            self.bump(); // a stray closing bracket
            return Unary::None;
        }
        if self.input[self.at..].starts_with("OR")
            && self.input[self.at + 2..]
                .chars()
                .next()
                .is_none_or(|c| c == ')' || is_js_space(c))
        {
            self.at += 2;
            return Unary::Or;
        }
        if self.peek() == Some('-')
            && self.input[self.at + 1..]
                .chars()
                .next()
                .is_some_and(|c| !is_js_space(c))
        {
            self.at += 1;
            if !self.enter() {
                return Unary::None;
            }
            let q = self.unary(field);
            self.leave();
            return match q {
                Unary::Query(part) => Unary::Query(Query::Not {
                    part: Box::new(part),
                }),
                Unary::Or | Unary::None => Unary::None,
            };
        }
        if self.peek() == Some('(') {
            self.at += 1;
            if !self.enter() {
                return Unary::None;
            }
            let q = self.group(')', field);
            self.leave();
            return q.map_or(Unary::None, Unary::Query);
        }
        if self.peek() == Some('[') && self.input.as_bytes().get(self.at + 1) != Some(&b'[') {
            if !self.enter() {
                self.at += 1; // the '[', or the group loop would see it again
                return Unary::None;
            }
            let q = self.property();
            self.leave();
            return q.map_or(Unary::None, Unary::Query);
        }
        if let Some((op, len)) = operator(&self.input[self.at..]) {
            self.at += len;
            let inner = if self.peek() == Some('(') {
                self.at += 1;
                if !self.enter() {
                    None
                } else {
                    let q = self.group(')', Field::Any);
                    self.leave();
                    q
                }
            } else {
                let w = self.word();
                term(&self.fold(w), Field::Any)
            };
            let Some(inner) = inner else {
                return Unary::None;
            };
            let res = match op {
                Op::Line => Some(Query::Line {
                    part: Box::new(inner),
                }),
                Op::Field(f) => scoped(inner, f),
            };
            return res.map_or(Unary::None, Unary::Query);
        }
        let w = self.word();
        term(&self.fold(w), field).map_or(Unary::None, Unary::Query)
    }

    fn property(&mut self) -> Option<Query> {
        self.at += 1; // [
        let raw_key = if self.peek() == Some('"') {
            self.word()
        } else {
            let start = self.at;
            while let Some(c) = self.peek() {
                if c == ':' || c == ']' {
                    break;
                }
                self.bump();
            }
            &self.input[start..self.at]
        };
        let mut value = None;
        if self.peek() == Some(':') {
            self.at += 1;
            self.in_property = true;
            value = self.group(']', Field::Any).map(Box::new);
            self.in_property = false;
        } else if self.peek() == Some(']') {
            self.at += 1;
        }
        let key = js_trim(raw_key);
        if key.is_empty() {
            None
        } else {
            Some(Query::Prop {
                key: key.to_lowercase(),
                value,
            })
        }
    }
}

/// `/^([a-z]+):/i` where the name is in `FIELDS`.
fn operator(s: &str) -> Option<(Op, usize)> {
    let colon = s.bytes().position(|b| !b.is_ascii_alphabetic())?;
    if colon == 0 || s.as_bytes().get(colon) != Some(&b':') {
        return None;
    }
    let op = match s[..colon].to_ascii_lowercase().as_str() {
        "file" => Op::Field(Field::File),
        "path" => Op::Field(Field::Path),
        "tag" => Op::Field(Field::Tag),
        "content" => Op::Field(Field::Content),
        "line" => Op::Line,
        _ => return None,
    };
    Some((op, colon + 1))
}

fn all(mut parts: Vec<Query>) -> Option<Query> {
    if parts.len() > 1 {
        Some(Query::And { parts })
    } else {
        parts.pop()
    }
}

fn term(text: &str, field: Field) -> Option<Query> {
    let t = js_trim(text);
    if t.is_empty() {
        return None;
    }
    let text = match field {
        Field::Tag => {
            let lower = t.to_lowercase();
            lower.strip_prefix('#').unwrap_or(&lower).to_owned()
        }
        Field::Path => t.trim_matches('/').to_owned(),
        Field::Any | Field::Content | Field::File => t.to_owned(),
    };
    Some(Query::Term { text, field })
}

/// `file:(a OR b)`: the operator's field given to every term inside.
fn scoped(q: Query, field: Field) -> Option<Query> {
    match q {
        Query::Term { text, .. } => term(&text, field),
        Query::Not { part } => Some(Query::Not {
            part: Box::new(scoped(*part, field)?),
        }),
        Query::And { parts } => Some(Query::And {
            parts: parts.into_iter().filter_map(|p| scoped(p, field)).collect(),
        }),
        Query::Or { parts } => Some(Query::Or {
            parts: parts.into_iter().filter_map(|p| scoped(p, field)).collect(),
        }),
        Query::Line { .. } | Query::Prop { .. } => Some(q),
    }
}
