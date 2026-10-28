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
fn runner(file: &str) -> Option<fn(&str) -> Value> {
    match file {
        "links" => Some(wikilink_targets),
        "tags" => None,
        _ => panic!("{file}.json: no runner; add one to parity.rs"),
    }
}

fn wikilink_targets(input: &str) -> Value {
    parse_note(input)
        .links
        .into_iter()
        .filter(|l| !l.markdown)
        .map(|l| Value::String(l.target))
        .collect()
}

const KEYS: [&str; 7] = ["name", "input", "expected", "rust", "ts", "obsidian", "note"];
const FILE_KEYS: [&str; 4] = ["about", "typescript", "rust", "cases"];

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

/// Every problem with one corpus file (empty when it passes).
fn check(file: &str, corpus: &Value) -> Vec<String> {
    let mut problems = Vec::new();
    let Some(corpus) = corpus.as_object() else {
        return vec![format!("{file}.json: not an object")];
    };
    for key in unknown_keys(corpus, &FILE_KEYS) {
        problems.push(format!("{file}.json: unknown key {key:?}"));
    }
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
        let name = case.get("name").and_then(Value::as_str).unwrap_or("(no name)");
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
        let (Some(input), Some(expected)) = (input_of(case), case.get("expected")) else {
            problems.push(format!("{at}: needs a string or string-array \"input\" and an \"expected\""));
            continue;
        };
        let Some(run) = run else { continue };
        let actual = run(&input);
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
