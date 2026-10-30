use super::parse::{markdown_targets, percent_decode, wiki_targets};
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
    // (linking note, link target, the note it resolves to)
    for (from, target, want) in [
        ("Hello.md", "world", Some("world.md")),
        ("Hello.md", "WORLD", Some("world.md")),
        ("sub/Deep.md", "Hello#Heading", Some("Hello.md")),
        ("a/Source.md", "Note", Some("a/Note.md")),
        ("b/Source.md", "Note", Some("b/Note.md")),
        ("Root.md", "Note", Some("a/Note.md")),
        ("Root.md", "b/Note", Some("b/Note.md")),
        ("Root.md", "b/Note.md", Some("b/Note.md")),
        ("sub/Deep.md", "../world", Some("world.md")),
        ("Root.md", "pic.png", Some("pic.png")),
        ("Root.md", "Nickname", Some("Nick.md")),
        ("Root.md", "second name", Some("Nick.md")),
        // A real note name wins over an alias.
        ("Root.md", "Hello", Some("Hello.md")),
        ("Root.md", "missing", None),
        ("Root.md", "#Heading", None),
    ] {
        assert_eq!(idx.resolve(from, target).as_deref(), want, "{target} from {from}");
    }

    let links = idx.link_index();
    let value = serde_json::to_value(&links).unwrap();
    assert_eq!(value["outgoing"]["Hello.md"], json!(["world.md"]));
    assert_eq!(
        value["outgoing"]["sub/Deep.md"],
        json!(["Hello.md", "world.md"])
    );
    assert_eq!(value["outgoing"]["Code.md"], json!(["world.md"]));
    assert!(value.get("backlinks").is_none());
    let backlinks = serde_json::to_value(idx.backlinks(&["world.md".into()])).unwrap();
    let backs = backlinks["world.md"].as_array().unwrap();
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
        ("My Note.md", "[[weird]x]] [self](#heading) [](a.md)\n"),
        ("img.png", ""),
    ]);
    let links = idx.link_index();
    assert_eq!(links.markdown["a.md"], ["Design.md"]);
    assert_eq!(links.markdown["b/c.md"], ["a.md", "My Note.md", "img.png"]);
    assert_eq!(links.markdown["My Note.md"], ["a.md"]);
    // Outgoing keeps its wikilink map; backlinks include Markdown mentions too.
    assert!(links.outgoing.get("a.md").is_none());
    assert_eq!(idx.backlinks(&["Design.md".into()])["Design.md"].len(), 2);
    assert_eq!(links.outgoing["Design.md"], ["a.md"]);
    // Inline code and `[[x]](a.md)` are not markdown links.
    assert!(links.markdown.get("Design.md").is_none());
    // Per line: wikilinks first, then markdown links.
    assert_eq!(links.unresolved["Design.md"], ["Nowhere", "x", "Gone"]);
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
fn escaped_markdown_parentheses_are_syntax_and_index_as_backlinks() {
    assert_eq!(
        markdown_targets(r"[x](Projects/a\(b\).md) [one](a\).md) [two](é\(x(y)\).md#Top)"),
        vec!["Projects/a(b).md", "a).md", "é(x(y)).md"]
    );
    let idx = Index::from_notes(&[
        ("Source.md", "---\ntags: [r22]\n---\n[x](Projects/a\\(b\\).md)\n"),
        ("Projects/a(b).md", "target"),
    ]);
    let links = idx.link_index();
    assert_eq!(links.markdown["Source.md"], ["Projects/a(b).md"]);
    assert_eq!(idx.backlinks(&["Projects/a(b).md".into()])["Projects/a(b).md"][0].from, "Source.md");
    assert_eq!(idx.backlinks(&["Projects/a(b).md".into()])["Projects/a(b).md"][0].line, 4);
    assert!(links.unresolved.get("Source.md").is_none());
}

#[test]
fn wikilink_target_parsing() {
    assert_eq!(
        wiki_targets("[[a#h|x]] ![[b]] [[c\\|d]] [[ ]] [[e[f]] [[C^abc]] [[g]] [[h"),
        vec!["a", "b", "c", "e[f", "C^abc", "g"]
    );
    assert_eq!(wiki_targets("[[[Note]]] [[a\\[b]]"), vec!["[Note", "a\\[b"]);
    assert!(wiki_targets("[[a]b]] [[|x]] [[#h]]").is_empty());
}

#[test]
fn duplicate_links_on_one_line_dedupe_outgoing() {
    let idx = Index::from_notes(&[("a.md", "[[Hello]] and [[hello]]\n"), ("Hello.md", "x\n")]);
    let links = idx.link_index();
    assert_eq!(links.outgoing["a.md"], ["Hello.md"]);
    assert_eq!(idx.backlinks(&["Hello.md".into()])["Hello.md"].len(), 2);
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
    assert!(hello.mtime_ms > 0 && hello.ctime_ms > 0);
    let sub = list.iter().find(|e| e.path == "sub").unwrap();
    assert!(sub.is_dir);
    assert_eq!(sub.name, "sub");
    assert_eq!(sub.size, 0);
    assert_eq!(
        idx.resolve("Hello.md", "Deep").as_deref(),
        Some("sub/Deep.md")
    );
    assert!(idx.backlinks(&["Hello.md".into()]).get("Hello.md").is_none());
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
    assert!(idx.backlinks(&["Renamed.md".into()]).get("Renamed.md").is_none());
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
fn tags_follow_saves_renames_and_deletes() {
    let tmp = tmp_dir("tags");
    let mut idx = Index::from_notes(&[
        (
            "dir/a.md",
            "---\ntags: [front]\n---\n#a and #a\n```\n#code\n```\n",
        ),
        ("dir/plain.md", "no tags here\n"),
        ("other.md", "#other\n"),
        ("pic.png", "#notatag"),
    ]);
    let tags = |idx: &Index| serde_json::to_value(idx.tags(None)).unwrap();
    assert_eq!(
        tags(&idx),
        json!({ "dir/a.md": ["front", "a", "a"], "other.md": ["other"] })
    );

    // A save replaces the note's tags. A note that loses its last tag is left out.
    idx.upsert_note(
        &tmp.path,
        "other.md",
        "now #changed/nested\n",
        Stamp::sized(20),
    );
    idx.upsert_note(&tmp.path, "dir/a.md", "no more tags\n", Stamp::sized(13));
    idx.upsert_note(&tmp.path, "new.md", "#fresh", Stamp::sized(6));
    assert_eq!(
        tags(&idx),
        json!({ "new.md": ["fresh"], "other.md": ["changed/nested"] })
    );

    // A rename carries the tags along, a folder's notes included. Away from `.md`, they go.
    idx.upsert_note(&tmp.path, "dir/b.md", "#b", Stamp::sized(2));
    idx.relocate("dir", "moved");
    idx.relocate("new.md", "new.txt");
    assert_eq!(
        tags(&idx),
        json!({ "moved/b.md": ["b"], "other.md": ["changed/nested"] })
    );

    // Only the paths asked for. Folders and unknown paths are left out.
    let some = idx.tags(Some(&[
        "moved/b.md".into(),
        "moved".into(),
        "nope.md".into(),
    ]));
    assert_eq!(some.keys().collect::<Vec<_>>(), ["moved/b.md"]);

    idx.remove_tree("moved");
    assert_eq!(tags(&idx), json!({ "other.md": ["changed/nested"] }));
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
        idx.insert_file(&path, Stamp::sized(body.len()), || body.clone());
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

#[test]
fn names_ending_in_multibyte_characters_are_not_notes() {
    assert!(!is_note_path("a😀"));
    assert!(!is_note_path("dir/aé€"));
    assert!(is_note_path("Ünïcode 😀.MD"));
    let idx = Index::from_notes(&[("a😀", ""), ("b😀.md", "[[a😀]]\n")]);
    assert_eq!(idx.resolve("b😀.md", "a😀").as_deref(), Some("a😀"));
}

#[test]
fn query_search_tracks_mutations_and_uppercase_notes() {
    let dir = tmp_dir("search-mutations");
    let mut idx = Index::from_notes(&[(
        "old/A.MD",
        "---\nstatus: draft\n---\n#Project/Alpha garden\n",
    )]);
    assert_eq!(
        idx.search_notes("tag:project [status:draft]", false)[0].path,
        "old/A.MD"
    );
    let body = "---\nstatus: done\n---\n#Other river river\n";
    idx.upsert_note(&dir.path, "old/A.MD", body, Stamp::sized(body.len()));
    assert!(idx
        .search_notes("garden OR tag:project OR [status:draft]", false)
        .is_empty());
    assert_eq!(idx.search_notes("river", false)[0].count, 2);
    idx.relocate("old", "new");
    assert!(idx.search_notes("path:old", false).is_empty());
    assert_eq!(
        idx.search_notes("path:new [status:done]", false)[0].path,
        "new/A.MD"
    );
    idx.relocate("new/A.MD", "new/picture.png");
    assert!(idx.search_notes("river", false).is_empty());
    assert_eq!(
        idx.search_match(&["file:png".into(), "river".into()]),
        vec![vec!["new/picture.png"], vec![]]
    );
    idx.remove_tree("new");
    assert_eq!(
        idx.search_match(&["-garden".into()]),
        vec![Vec::<String>::new()]
    );
}

#[test]
fn query_search_orders_paths_and_limits_only_passing_note_lines() {
    let idx = Index::from_notes(&[
        ("z.MD", "garden\ngarden garden\ngarden\n"),
        ("a/A.md", "Garden\n"),
        ("B.md", "else\n"),
        ("garden.png", "garden\n"),
        ("garden.canvas", "garden\n"),
    ]);
    assert_eq!(
        idx.search_notes("garden", false)
            .iter()
            .map(|n| (n.path.as_str(), n.count))
            .collect::<Vec<_>>(),
        [("a/A.md", 1), ("z.MD", 4)]
    );
    let paths = [
        "z.MD",
        "missing.md",
        "a",
        "B.md",
        "garden.png",
        "a/A.md",
        "z.MD",
    ]
    .map(String::from);
    let lines = idx.search_lines("garden", false, &paths, 2);
    assert_eq!(
        serde_json::to_value(&lines).unwrap(),
        json!({
            "a/A.md": [{"line":1,"text":"Garden"}],
            "z.MD": [{"line":1,"text":"garden"},{"line":2,"text":"garden garden"}]
        })
    );
    assert!(idx.search_lines("garden", false, &paths, 0).is_empty());
    assert!(idx
        .search_lines("Garden", true, &paths, 5)
        .get("z.MD")
        .is_none());
    assert_eq!(
        idx.search_match(&["garden".into(), "".into(), "file:png".into()]),
        vec![
            vec!["a/A.md", "garden.canvas", "garden.png", "z.MD"],
            vec![],
            vec!["garden.png"]
        ]
    );
}

#[test]
fn query_search_empty_deep_and_large_notes_are_safe() {
    let mut idx = Index::from_notes(&[("normal.md", "garden\n")]);
    idx.insert_file(
        "huge Garden.MD",
        Stamp::sized(MAX_INDEX_BYTES as usize + 1),
        || panic!("large note must not be read"),
    );
    for query in [
        String::new(),
        "   ".into(),
        format!("{}garden{}", "(".repeat(65), ")".repeat(65)),
        "(".repeat(100_000),
    ] {
        assert!(idx.search_notes(&query, false).is_empty());
        assert!(idx
            .search_lines(&query, false, &["normal.md".into()], 5)
            .is_empty());
        assert_eq!(idx.search_match(&[query]), vec![Vec::<String>::new()]);
    }
    let found = idx.search_notes("garden", false);
    assert_eq!(found.iter().map(|n| n.count).collect::<Vec<_>>(), [0, 1]);
    assert!(idx
        .search_notes("content:garden", false)
        .iter()
        .all(|n| n.path != "huge Garden.MD"));
    assert!(idx
        .search_lines("file:huge", false, &["huge Garden.MD".into()], 5)
        .is_empty());
}

#[test]
fn query_search_counts_overlaps_adjacencies_and_unicode() {
    let idx = Index::from_notes(&[("counts.md", "star warsstar 😀😀 İSTANBUL\n")]);
    for (query, count) in [
        ("star OR \"star wars\"", 2),
        ("😀", 2),
        ("😀 OR 😀😀", 1),
        ("i̇stanbul", 1),
    ] {
        assert_eq!(idx.search_notes(query, false)[0].count, count, "{query}");
    }
    let props = Index::from_notes(&[("props.md", "\u{feff}---\r\nstatus: draft\r\n---\r\nbody\r")]);
    assert_eq!(
        serde_json::to_value(props.search_lines("[status:draft]", false, &["props.md".into()], 5))
            .unwrap(),
        json!({"props.md":[{"line":2,"text":"status: draft"}]})
    );
}
