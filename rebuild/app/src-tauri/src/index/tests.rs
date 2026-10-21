use super::parse::{markdown_targets, percent_decode};
use super::*;
use crate::fsutil::tmp_dir;
use serde_json::json;
use std::fs;
use std::time::Instant;

fn sample() -> Index {
    Index::from_notes(&[
        ("Hello.md", "See [[World]] and [[missing]]\n"),
        ("world.md", "back\n"),
        ("sub/Deep.md", "[[Hello#Heading|alias]] and ![[world]]\n"),
        ("a/Note.md", "local\n"),
        ("b/Note.md", "other\n"),
        ("a/Source.md", "[[Note]]\n"),
        ("b/Source.md", "[[Note]]\n"),
        ("Root.md", "[[Note]]\n"),
        ("pic.png", ""),
        (
            "Nick.md",
            "---\naliases:\n  - Nickname\n  - \"Second Name\"\nalias: Also\n---\nbody [[Hello]]\n",
        ),
        (
            "Code.md",
            "before [[World]]\n```\n[[notcode]]\n```\n`[[nope]]` [[World]]\n",
        ),
    ])
}

#[test]
fn resolves_names_paths_aliases_and_skips_code() {
    let idx = sample();
    assert_eq!(
        idx.resolve("Hello.md", "world").as_deref(),
        Some("world.md")
    );
    assert_eq!(
        idx.resolve("Hello.md", "WORLD").as_deref(),
        Some("world.md")
    );
    assert_eq!(
        idx.resolve("sub/Deep.md", "Hello#Heading").as_deref(),
        Some("Hello.md")
    );
    assert_eq!(
        idx.resolve("a/Source.md", "Note").as_deref(),
        Some("a/Note.md")
    );
    assert_eq!(
        idx.resolve("b/Source.md", "Note").as_deref(),
        Some("b/Note.md")
    );
    assert_eq!(idx.resolve("Root.md", "Note").as_deref(), Some("a/Note.md"));
    assert_eq!(
        idx.resolve("Root.md", "b/Note").as_deref(),
        Some("b/Note.md")
    );
    assert_eq!(
        idx.resolve("Root.md", "b/Note.md").as_deref(),
        Some("b/Note.md")
    );
    assert_eq!(
        idx.resolve("sub/Deep.md", "../world").as_deref(),
        Some("world.md")
    );
    assert_eq!(
        idx.resolve("Root.md", "pic.png").as_deref(),
        Some("pic.png")
    );
    assert_eq!(
        idx.resolve("Root.md", "Nickname").as_deref(),
        Some("Nick.md")
    );
    assert_eq!(
        idx.resolve("Root.md", "second name").as_deref(),
        Some("Nick.md")
    );
    // A real note name wins over an alias.
    assert_eq!(idx.resolve("Root.md", "Hello").as_deref(), Some("Hello.md"));
    assert!(idx.resolve("Root.md", "missing").is_none());
    assert!(idx.resolve("Root.md", "#Heading").is_none());

    let links = idx.link_index();
    let value = serde_json::to_value(&links).unwrap();
    assert_eq!(value["outgoing"]["Hello.md"], json!(["world.md"]));
    assert_eq!(
        value["outgoing"]["sub/Deep.md"],
        json!(["Hello.md", "world.md"])
    );
    assert_eq!(value["outgoing"]["Code.md"], json!(["world.md"]));
    assert!(
        value["outgoing"]
            .get("Code.md")
            .unwrap()
            .as_array()
            .unwrap()
            .len()
            == 1
    );
    let backs = value["backlinks"]["world.md"].as_array().unwrap();
    assert!(backs.iter().any(|b| b["from"] == "Hello.md"
        && b["line"] == 1
        && b["text"] == "See [[World]] and [[missing]]"));
    assert!(backs
        .iter()
        .all(|b| b["from"] != "nope" && !b["text"].as_str().unwrap().contains("notcode")));
    // Two mentions in Code.md, both to world, one line each that survived the fence.
    let from_code: Vec<_> = backs.iter().filter(|b| b["from"] == "Code.md").collect();
    assert_eq!(from_code.len(), 2);
}

#[test]
fn markdown_links_and_unresolved_targets_for_the_graph() {
    let idx = Index::from_notes(&[
        (
            "a.md",
            "[Design](Design.md) and [again](<design.md>) [web](https://example.com/x.md) [mail](mailto:x@y.z)\n",
        ),
        ("b/c.md", "[up](../a.md#Top \"title\") [x](My%20Note.md) [pic](img.png) ![alt](img.png)\n"),
        ("Design.md", "[[Nowhere]] [[nowhere#h|alias]] [gone](Gone.md) [[a]] `[code](a.md)` [[x]](a.md)\n"),
        ("My Note.md", "[[[weird]]] [self](#heading) [](a.md)\n"),
        ("img.png", ""),
    ]);
    let links = idx.link_index();
    assert_eq!(
        links.markdown.get("a.md").unwrap(),
        &vec!["Design.md".to_string()]
    );
    assert_eq!(
        links.markdown.get("b/c.md").unwrap(),
        &vec![
            "a.md".to_string(),
            "My Note.md".to_string(),
            "img.png".to_string()
        ]
    );
    assert_eq!(
        links.markdown.get("My Note.md").unwrap(),
        &vec!["a.md".to_string()]
    );
    // Markdown links stay out of the wikilink maps the Backlinks and Outgoing views use.
    assert!(links.outgoing.get("a.md").is_none());
    assert!(links.backlinks.get("Design.md").is_none());
    assert_eq!(
        links.outgoing.get("Design.md").unwrap(),
        &vec!["a.md".to_string()]
    );
    // Inline code and `[[x]](a.md)` are not markdown links.
    assert!(links.markdown.get("Design.md").is_none());
    assert_eq!(
        links.unresolved.get("Design.md").unwrap(),
        // Per line: wikilinks first, then markdown links.
        &vec!["Nowhere".to_string(), "x".to_string(), "Gone".to_string()]
    );
    assert!(links.unresolved.get("a.md").is_none());
}

#[test]
fn markdown_target_parsing() {
    assert_eq!(
        markdown_targets("[a](b.md) [c](<d e.md>) [f](g%C3%A9.md#x)"),
        vec!["b.md", "d e.md", "gé.md"]
    );
    assert_eq!(markdown_targets("[a](./b/c.md 'title')"), vec!["b/c.md"]);
    assert_eq!(
        markdown_targets("[a [nested]](n.md) [p](x_(1).md)"),
        vec!["n.md", "x_(1).md"]
    );
    assert!(markdown_targets(
        "[a](http://x) [b](obsidian://open) [c](#h) [d]( ) ](x) [e](unclosed"
    )
    .is_empty());
    assert_eq!(percent_decode("a%2"), "a%2");
    assert_eq!(percent_decode("100%"), "100%");
}

#[test]
fn duplicate_links_on_one_line_dedupe_outgoing() {
    let idx = Index::from_notes(&[("a.md", "[[Hello]] and [[hello]]\n"), ("Hello.md", "x\n")]);
    let links = idx.link_index();
    assert_eq!(
        links.outgoing.get("a.md").unwrap(),
        &vec!["Hello.md".to_string()]
    );
    assert_eq!(links.backlinks.get("Hello.md").unwrap().len(), 2);
}

#[test]
fn scan_skips_hidden_dirs_and_names_notes() {
    let dir = tmp_dir("scan");
    fs::create_dir_all(dir.path.join(".obsidian")).unwrap();
    fs::create_dir_all(dir.path.join(".git")).unwrap();
    fs::create_dir_all(dir.path.join(".trash")).unwrap();
    fs::create_dir_all(dir.path.join("sub")).unwrap();
    fs::write(dir.path.join(".obsidian").join("app.json"), "{}").unwrap();
    fs::write(dir.path.join(".git").join("config"), "").unwrap();
    fs::write(dir.path.join(".trash").join("old.md"), "[[Hello]]").unwrap();
    fs::write(dir.path.join("Hello.md"), "[[sub/Deep]]\n").unwrap();
    fs::write(dir.path.join("sub").join("Deep.md"), "hi\n").unwrap();
    fs::write(dir.path.join("pic.png"), "x").unwrap();
    fs::write(dir.path.join(format!("skip{}", fsutil::TEMP_MARK)), "nope").unwrap();

    let idx = Index::scan(&dir.path).unwrap();
    let list = idx.list();
    let paths: Vec<_> = list.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(paths, vec!["Hello.md", "pic.png", "sub", "sub/Deep.md"]);
    let hello = list.iter().find(|e| e.path == "Hello.md").unwrap();
    assert_eq!(hello.name, "Hello");
    assert!(!hello.is_dir);
    assert_eq!(
        hello.size,
        fs::metadata(dir.path.join("Hello.md")).unwrap().len()
    );
    assert!(hello.mtime_ms > 0);
    let sub = list.iter().find(|e| e.path == "sub").unwrap();
    assert!(sub.is_dir);
    assert_eq!(sub.name, "sub");
    assert_eq!(sub.size, 0);
    assert_eq!(
        idx.resolve("Hello.md", "Deep").as_deref(),
        Some("sub/Deep.md")
    );
    assert!(idx.link_index().backlinks.get("Hello.md").is_none());
}

#[test]
fn rename_moves_children_and_resolution_follows() {
    let mut idx = Index::from_notes(&[
        ("dir/a.md", "see [[b]]\n"),
        ("dir/b.md", "target\n"),
        ("other.md", "[[b]]\n"),
    ]);
    assert_eq!(idx.resolve("dir/a.md", "b").as_deref(), Some("dir/b.md"));
    idx.relocate("dir", "dir2");
    assert!(!idx.contains("dir"));
    assert!(!idx.contains("dir/a.md"));
    assert!(idx.contains("dir2"));
    assert!(idx.contains("dir2/a.md"));
    assert!(idx.contains("dir2/b.md"));
    assert_eq!(idx.resolve("dir2/a.md", "b").as_deref(), Some("dir2/b.md"));
    assert_eq!(idx.resolve("other.md", "b").as_deref(), Some("dir2/b.md"));
    idx.relocate("dir2/b.md", "Renamed.md");
    // The file moved, but the link text is still `[[b]]`. The front end rewrites links.
    assert_eq!(
        idx.resolve("dir2/a.md", "Renamed").as_deref(),
        Some("Renamed.md")
    );
    assert!(idx.resolve("dir2/a.md", "b").is_none());
    let links = idx.link_index();
    assert!(links.outgoing.get("dir2/a.md").is_none());
    assert!(links.backlinks.get("Renamed.md").is_none());
}

#[test]
fn frontmatter_returns_only_the_block() {
    let idx = Index::from_notes(&[
        ("Props.md", "---\ntitle: Hi\ntags: [a]\n---\nbody\n---\n"),
        ("Dots.md", "---\ntitle: Dots\n...\nbody\n"),
        ("Plain.md", "no frontmatter\n---\n"),
        ("CRLF.md", "---\r\na: 1\r\n---\r\n"),
    ]);
    let all = idx.frontmatter(None);
    assert_eq!(all.len(), 2);
    assert_eq!(all["Props.md"], "---\ntitle: Hi\ntags: [a]\n---");
    assert_eq!(all["CRLF.md"], "---\na: 1\n---");
    let some = idx.frontmatter(Some(&[
        "Props.md".to_string(),
        "Plain.md".to_string(),
        "Nope.md".to_string(),
    ]));
    assert_eq!(some.keys().collect::<Vec<_>>(), ["Props.md"]);
}

#[test]
fn search_is_case_insensitive_and_ranks_names_first() {
    let idx = Index::from_notes(&[
        ("Garden.md", "flowers\n"),
        (
            "notes/Log.md",
            "planted a garden today\nsecond line alpha beta\n",
        ),
        ("Skip.md", "alpha\nbeta\n"),
    ]);
    let hits = idx.search("GARD", 10);
    assert_eq!(hits[0].path, "Garden.md");
    assert_eq!(hits[0].line, 0);
    assert_eq!(hits[0].text, "Garden");
    assert!(hits
        .iter()
        .any(|h| h.path == "notes/Log.md" && h.line == 1 && h.text.contains("garden")));
    let both = idx.search("alpha beta", 10);
    assert!(both.iter().any(|h| h.path == "notes/Log.md" && h.line == 2));
    assert!(!both.iter().any(|h| h.path == "Skip.md" && h.line > 0));
    assert!(idx.search("   ", 10).is_empty());
    assert!(idx.search("garden", 0).is_empty());
    let limited = idx.search("garden", 1);
    assert_eq!(limited.len(), 1);
    assert_eq!(limited[0].line, 0);
}

#[test]
fn search_of_a_thousand_notes_stays_well_under_the_budget() {
    let mut idx = Index::default();
    for n in 0..1000 {
        let path = format!("n{n}.md");
        let body = format!("note {n}\nline with token-{n} inside a garden of words\n");
        idx.insert_file(&path, 0, body.len() as u64, || body.clone());
    }
    idx.rebuild_maps();
    let started = Instant::now();
    let hits = idx.search("token-42", 20);
    assert!(
        started.elapsed().as_millis() < 1000,
        "search took {:?}",
        started.elapsed()
    );
    assert!(hits.iter().any(|h| h.path == "n42.md" && h.line == 2));
}

#[test]
fn a_new_folder_is_indexed_like_a_scan() {
    let dir = tmp_dir("adopt");
    fs::write(dir.path.join("Top.md"), "top\n").unwrap();
    let mut idx = Index::scan(&dir.path).unwrap();
    fs::create_dir_all(dir.path.join("new/inner")).unwrap();
    fs::create_dir_all(dir.path.join("new/.grove")).unwrap();
    fs::write(dir.path.join("new/inner/Deep.md"), "[[Top]]\n").unwrap();
    fs::write(dir.path.join("new/.grove/app.json"), "{}").unwrap();
    fs::write(dir.path.join(format!("new/x.md{}", fsutil::TEMP_MARK)), "").unwrap();
    idx.refresh_path(&dir.path, "new");
    let paths: Vec<_> = idx.list().into_iter().map(|e| e.path).collect();
    assert_eq!(
        paths,
        vec!["Top.md", "new", "new/inner", "new/inner/Deep.md"]
    );
    assert_eq!(
        idx.resolve("new/inner/Deep.md", "Top").as_deref(),
        Some("Top.md")
    );
    let rescan: Vec<_> = Index::scan(&dir.path)
        .unwrap()
        .list()
        .into_iter()
        .map(|e| e.path)
        .collect();
    assert_eq!(paths, rescan);
}
