//! The parity corpus (`fixtures/parity/*.json`, see its README): rules that TypeScript and Rust
//! both implement, checked against the same cases. This runs the Rust side;
//! `src/parity.test.ts` runs the TypeScript one.

use super::parse::parse_note;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

/// The Rust function each corpus file checks, by file name. `None`: no Rust implementation yet,
/// and the file must say `"rust": "todo"`. A new file needs an entry here (and in parity.test.ts).
fn runner(file: &str) -> Option<fn(&str, &Map<String, Value>) -> Value> {
    match file {
        "links" => Some(wikilink_targets),
        "tags" => Some(note_tags),
        "properties" => Some(properties),
        "query" => Some(parse_query),
        // No Rust search evaluator yet (plan step 4). The file must say `"rust": "todo"`.
        "search" => None,
        _ => panic!("{file}.json: no runner; add one to parity.rs"),
    }
}

fn parse_query(input: &str, case: &Map<String, Value>) -> Value {
    let match_case = case.get("matchCase").and_then(Value::as_bool) == Some(true);
    serde_json::to_value(super::query::parse_query(input, match_case)).unwrap()
}

fn properties(input: &str, _: &Map<String, Value>) -> Value {
    let Some(note) = super::props::note_properties(input) else { return Value::Null };
    note.props.into_iter().map(|p| serde_json::json!({ "key": p.key, "type": p.kind, "value": p.value })).collect()
}

fn note_tags(input: &str, _: &Map<String, Value>) -> Value {
    parse_note(input)
        .tags
        .into_iter()
        .map(Value::String)
        .collect()
}

fn wikilink_targets(input: &str, _: &Map<String, Value>) -> Value {
    parse_note(input)
        .links
        .into_iter()
        .filter(|l| !l.markdown)
        .map(|l| Value::String(l.target))
        .collect()
}

const KEYS: [&str; 9] = [
    "name",
    "input",
    "expected",
    "rust",
    "ts",
    "obsidian",
    "note",
    "vault",
    "matchCase",
];
const FILE_KEYS: [&str; 5] = ["about", "typescript", "rust", "cases", "vaults"];

fn unknown_keys(obj: &Map<String, Value>, allowed: &[&str]) -> Vec<String> {
    obj.keys()
        .filter(|k| !allowed.contains(&k.as_str()))
        .cloned()
        .collect()
}

/// A case's input: a string, or lines joined with `\n`.
fn input_of(case: &Map<String, Value>) -> Option<String> {
    match case.get("input")? {
        Value::String(s) => Some(s.clone()),
        Value::Array(lines) => lines
            .iter()
            .map(|l| l.as_str())
            .collect::<Option<Vec<_>>>()
            .map(|l| l.join("\n")),
        _ => None,
    }
}

/// `vaults` is `{ name: { path: text | [lines] } }`. Lines are joined with `\n` by the TS runner.
fn check_vaults(file: &str, corpus: &Map<String, Value>, problems: &mut Vec<String>) {
    let Some(vaults) = corpus.get("vaults") else {
        return;
    };
    let Some(vaults) = vaults.as_object() else {
        problems.push(format!("{file}.json: \"vaults\" must be an object"));
        return;
    };
    for (name, spec) in vaults {
        let Some(spec) = spec.as_object() else {
            problems.push(format!(
                "{file}.json: vault {name:?} must be an object of paths"
            ));
            continue;
        };
        for (path, text) in spec {
            let ok = match text {
                Value::String(_) => true,
                Value::Array(lines) => lines.iter().all(Value::is_string),
                _ => false,
            };
            if !ok {
                problems.push(format!(
                    "{file}.json: vault {name:?} path {path:?} must be a string or an array of strings"
                ));
            }
        }
    }
}

fn vault_names_one(corpus: &Map<String, Value>, case: &Map<String, Value>) -> bool {
    let Some(name) = case.get("vault").and_then(Value::as_str) else {
        return false;
    };
    corpus
        .get("vaults")
        .and_then(Value::as_object)
        .is_some_and(|vaults| vaults.contains_key(name))
}

/// Every problem with one corpus file (empty when it passes).
fn check(file: &str, corpus: &Value) -> Vec<String> {
    let mut problems = Vec::new();
    let Some(corpus) = corpus.as_object() else {
        return vec![format!("{file}.json: not an object")];
    };
    for key in unknown_keys(corpus, &FILE_KEYS) {
        problems.push(format!("{file}.json: unknown key {key:?}"));
    }
    check_vaults(file, corpus, &mut problems);
    let todo_file = corpus.get("rust").and_then(Value::as_str) == Some("todo");
    let run = runner(file);
    match (todo_file, run.is_some()) {
        (true, true) => problems.push(format!(
            "{file}.json: parity.rs has a runner now; replace its top-level \"rust\": \"todo\""
        )),
        (false, false) => problems.push(format!(
            "{file}.json: no Rust runner; register one in parity.rs or set \"rust\": \"todo\""
        )),
        _ => {}
    }
    let Some(cases) = corpus.get("cases").and_then(Value::as_array) else {
        problems.push(format!("{file}.json: no \"cases\" array"));
        return problems;
    };
    let mut names = HashSet::new();
    for case in cases {
        let Some(case) = case.as_object() else {
            problems.push(format!("{file}.json: a case is not an object"));
            continue;
        };
        let name = case
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("(no name)");
        let at = format!("{file}.json {name:?}");
        if !names.insert(name.to_string()) {
            problems.push(format!("{at}: duplicate name"));
        }
        for key in unknown_keys(case, &KEYS) {
            problems.push(format!("{at}: unknown key {key:?}"));
        }
        for marker in ["rust", "ts"] {
            if case.get(marker).is_some_and(|v| v != "todo") {
                problems.push(format!("{at}: {marker:?} must be \"todo\""));
            }
        }
        if let Some(flag) = case.get("matchCase") {
            if !flag.is_boolean() {
                problems.push(format!("{at}: \"matchCase\" must be true or false"));
            }
        }
        if (file == "search" || case.contains_key("vault")) && !vault_names_one(corpus, case) {
            problems.push(format!("{at}: \"vault\" must name a vault in \"vaults\""));
        }
        let (Some(input), Some(expected)) = (input_of(case), case.get("expected")) else {
            problems.push(format!(
                "{at}: needs a string or string-array \"input\" and an \"expected\""
            ));
            continue;
        };
        let Some(run) = run else { continue };
        let actual = run(&input, case);
        let todo = case.get("rust").is_some();
        if todo && actual == *expected {
            problems.push(format!("{at}: now matches; remove its \"rust\": \"todo\""));
        } else if !todo && actual != *expected {
            problems.push(format!("{at}: expected {expected}, got {actual}"));
        }
    }
    problems
}

#[test]
fn corpus() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/parity");
    let mut paths: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("can't read {}: {e}", dir.display()))
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no corpus files in {}", dir.display());
    let mut problems = Vec::new();
    for path in &paths {
        let file = path.file_stem().unwrap().to_string_lossy();
        let text = fs::read_to_string(path).unwrap();
        match serde_json::from_str::<Value>(&text) {
            Ok(corpus) => problems.extend(check(&file, &corpus)),
            Err(e) => problems.push(format!("{file}.json: {e}")),
        }
    }
    assert!(problems.is_empty(), "\n{}", problems.join("\n"));
}

#[test]
fn todo_markers_are_checked() {
    let corpus = serde_json::json!({
        "about": "", "typescript": "", "rust": "",
        "cases": [
            { "name": "passes", "input": "[[A]]", "expected": ["A"] },
            { "name": "stale todo", "input": "[[A]]", "expected": ["A"], "rust": "todo" },
            { "name": "wrong", "input": ["[[A]]", "[[B]]"], "expected": ["A"] },
            { "name": "typo", "input": "", "expected": [], "rusts": "todo" }
        ]
    });
    let problems = check("links", &corpus);
    assert_eq!(problems.len(), 3, "{problems:#?}");
    assert!(problems[0].contains("stale todo") && problems[0].contains("remove"));
    assert!(problems[1].contains("\"wrong\"") && problems[1].contains("got [\"A\",\"B\"]"));
    assert!(problems[2].contains("unknown key \"rusts\""));
}

#[test]
fn search_vault_names_are_checked_without_a_runner() {
    let bad_text = serde_json::json!({
        "about": "", "typescript": "", "rust": "todo",
        "vaults": { "one": { "A.md": ["alpha"], "N.md": 1 } },
        "cases": [{ "name": "shape", "vault": "one", "input": "a", "expected": {} }]
    });
    let shape = check("search", &bad_text);
    assert!(
        shape
            .iter()
            .any(|p| p.contains("N.md") && p.contains("string")),
        "{shape:#?}"
    );

    let corpus = serde_json::json!({
        "about": "", "typescript": "", "rust": "todo",
        "vaults": { "one": { "A.md": ["alpha", "beta"], "B.md": "one line" } },
        "cases": [
            { "name": "bad", "vault": "missing", "input": "a", "expected": null },
            { "name": "ok", "vault": "one", "matchCase": true, "input": "a", "expected": {} },
            { "name": "flag", "vault": "one", "matchCase": "yes", "input": "a", "expected": {} },
            { "name": "none", "input": "a", "expected": null }
        ]
    });
    let problems = check("search", &corpus);
    assert!(
        problems
            .iter()
            .any(|p| p.contains("bad") && p.contains("vault")),
        "{problems:#?}"
    );
    assert!(
        problems
            .iter()
            .any(|p| p.contains("flag") && p.contains("matchCase")),
        "{problems:#?}"
    );
    assert!(
        problems
            .iter()
            .any(|p| p.contains("none") && p.contains("vault")),
        "{problems:#?}"
    );
    assert!(
        !problems.iter().any(|p| p.contains("\"ok\"")),
        "{problems:#?}"
    );

    let query = serde_json::json!({
        "about": "", "typescript": "", "rust": "",
        "cases": [{ "name": "cased", "matchCase": true, "input": "A", "expected": { "op": "term", "text": "A", "field": "any" } }]
    });
    let query_problems = check("query", &query);
    assert!(query_problems.is_empty(), "{query_problems:#?}");
}
