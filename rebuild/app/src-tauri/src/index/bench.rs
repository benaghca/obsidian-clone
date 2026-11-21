//! Ignored timings for a vault from `scripts/gen-vault.mjs` (step 0.2).
//!
//! The vault is not in the repo. Build it under the temp directory first:
//!
//! ```text
//! node scripts/gen-vault.mjs /tmp/grove-bench-5000 5000
//! ```
//!
//! Then, from `src-tauri`, time a release build and a debug build:
//!
//! ```text
//! GROVE_BENCH_VAULT=/tmp/grove-bench-5000 cargo test --release -- --ignored --nocapture bench_vault
//! GROVE_BENCH_VAULT=/tmp/grove-bench-5000 cargo test -- --ignored --nocapture bench_vault
//! ```
//!
//! `GROVE_BENCH_VAULT` defaults to `/tmp/grove-bench-5000`. `GROVE_BENCH_TERM`
//! defaults to `meeting`, the word the generator puts on prose lines.
//! Each figure is three runs after one warmup scan. The milliseconds include
//! the JSON serialization the command would send, except `scan`, which only
//! reads the vault. `vault_tags` is the five searches the Tags view made
//! before step 1; `tags` is the one command it makes now.

use super::{display_name, is_note_path, parents, Index, Stamp};
use std::path::Path;
use std::time::Instant;

const RUNS: usize = 3;
const TAG_QUERIES: [&str; 5] = ["#", "```", "~~~", "tags:", "tag:"];
const TAG_LIMIT: u32 = 100_000;

fn json_len(value: &impl serde::Serialize) -> usize {
    serde_json::to_vec(value).expect("serialize").len()
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn median(samples: &[f64]) -> f64 {
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    sorted[sorted.len() / 2]
}

fn ms_list(samples: &[f64]) -> String {
    samples
        .iter()
        .map(|ms| format!("{ms:.1}"))
        .collect::<Vec<_>>()
        .join(",")
}

#[test]
#[ignore]
fn bench_vault() {
    let root =
        std::env::var("GROVE_BENCH_VAULT").unwrap_or_else(|_| "/tmp/grove-bench-5000".to_string());
    let term = std::env::var("GROVE_BENCH_TERM").unwrap_or_else(|_| "meeting".to_string());
    let root = Path::new(&root);
    assert!(
        root.is_dir(),
        "bench vault missing at {} (run scripts/gen-vault.mjs)",
        root.display()
    );

    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    println!("GROVE_BENCH profile={profile}");
    println!("GROVE_BENCH vault={}", root.display());

    let warmup = Instant::now();
    let idx = Index::scan(root).expect("scan");
    println!("GROVE_BENCH warmup_scan_ms={:.1}", elapsed_ms(warmup));

    let mut notes = 0usize;
    let mut lines = 0usize;
    let mut text_bytes = 0u64;
    let mut indexed_links = 0usize;
    for (path, node) in &idx.files {
        if node.is_dir {
            continue;
        }
        text_bytes += node.stamp.size;
        if is_note_path(path) {
            notes += 1;
            lines += node.note.lines.len();
            indexed_links += node.note.links.len();
        }
    }
    let files = idx.list().len();
    println!("GROVE_BENCH notes={notes} files={files} lines={lines} text_bytes={text_bytes} indexed_links={indexed_links}");

    let mut scan_ms = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let started = Instant::now();
        let again = Index::scan(root).expect("scan");
        scan_ms.push(elapsed_ms(started));
        assert_eq!(again.list().len(), files);
    }
    println!(
        "GROVE_BENCH scan_ms={} median={:.1}",
        ms_list(&scan_ms),
        median(&scan_ms)
    );

    let mut tag_ms = Vec::with_capacity(RUNS);
    let mut tag_bytes = 0usize;
    let mut hash_bytes = 0usize;
    let mut tag_hits = Vec::new();
    for _ in 0..RUNS {
        let started = Instant::now();
        let mut bytes = 0usize;
        let mut hits = Vec::new();
        let mut hash = 0usize;
        for (i, query) in TAG_QUERIES.iter().enumerate() {
            let found = idx.search(query, TAG_LIMIT);
            let size = json_len(&found);
            if i == 0 {
                hash = size;
            }
            hits.push(found.len());
            bytes += size;
        }
        tag_ms.push(elapsed_ms(started));
        tag_bytes = bytes;
        hash_bytes = hash;
        tag_hits = hits;
    }
    let hit_list = TAG_QUERIES
        .iter()
        .zip(&tag_hits)
        .map(|(query, hits)| format!("{query}:{hits}"))
        .collect::<Vec<_>>()
        .join(",");
    println!(
        "GROVE_BENCH vault_tags_ms={} median={:.1} json_bytes={tag_bytes} hash_json_bytes={hash_bytes} hits={hit_list}",
        ms_list(&tag_ms),
        median(&tag_ms)
    );

    // What the Tags view reads since step 1: one `tags` command instead of the five searches.
    let mut tags_ms = Vec::with_capacity(RUNS);
    let mut tags_bytes = 0usize;
    let mut tag_notes = 0usize;
    let mut tag_uses = 0usize;
    for _ in 0..RUNS {
        let started = Instant::now();
        let tags = idx.tags(None);
        let size = json_len(&tags);
        tags_ms.push(elapsed_ms(started));
        tags_bytes = size;
        tag_notes = tags.len();
        tag_uses = tags.values().map(Vec::len).sum();
    }
    println!(
        "GROVE_BENCH tags_ms={} median={:.1} json_bytes={tags_bytes} notes={tag_notes} uses={tag_uses}",
        ms_list(&tags_ms),
        median(&tags_ms)
    );

    let mut link_ms = Vec::with_capacity(RUNS);
    let mut link_bytes = 0usize;
    let mut out_bytes = 0usize;
    let mut md_bytes = 0usize;
    let mut missing_bytes = 0usize;
    for _ in 0..RUNS {
        let started = Instant::now();
        let links = idx.link_index();
        let size = json_len(&links);
        link_ms.push(elapsed_ms(started));
        out_bytes = json_len(&links.outgoing);
        md_bytes = json_len(&links.markdown);
        missing_bytes = json_len(&links.unresolved);
        link_bytes = size;
    }
    println!(
        "GROVE_BENCH link_index_ms={} median={:.1} json_bytes={link_bytes} outgoing_bytes={out_bytes} markdown_bytes={md_bytes} unresolved_bytes={missing_bytes}",
        ms_list(&link_ms),
        median(&link_ms)
    );

    // One displayed target (the first note with an outgoing edge), plus the
    // full command for callers explicitly asking about every note, e.g. a move.
    let targets: Vec<String> = idx.paths().filter(|p| is_note_path(p)).cloned().collect();
    let target = idx
        .link_index()
        .outgoing
        .values()
        .flatten()
        .next()
        .cloned()
        .expect("linked target");
    for (label, paths) in [("one", vec![target]), ("all", targets)] {
        let mut samples = Vec::with_capacity(RUNS);
        let mut bytes = 0;
        for _ in 0..RUNS {
            let started = Instant::now();
            bytes = json_len(&idx.backlinks(&paths));
            samples.push(elapsed_ms(started));
        }
        println!(
            "GROVE_BENCH backlinks_{label}_ms={} median={:.1} json_bytes={bytes}",
            ms_list(&samples),
            median(&samples)
        );
    }

    let mut fm_ms = Vec::with_capacity(RUNS);
    let mut fm_bytes = 0usize;
    let mut fm_blocks = 0usize;
    for _ in 0..RUNS {
        let started = Instant::now();
        let blocks = idx.frontmatter(None);
        let size = json_len(&blocks);
        fm_ms.push(elapsed_ms(started));
        fm_blocks = blocks.len();
        fm_bytes = size;
    }
    println!(
        "GROVE_BENCH frontmatter_ms={} median={:.1} json_bytes={fm_bytes} blocks={fm_blocks}",
        ms_list(&fm_ms),
        median(&fm_ms)
    );

    let mut props_ms = Vec::with_capacity(RUNS);
    let mut props_bytes = 0;
    let mut props_notes = 0;
    for _ in 0..RUNS {
        let started = Instant::now();
        let properties = idx.properties(None);
        props_bytes = json_len(&properties);
        props_ms.push(elapsed_ms(started));
        props_notes = properties.len();
    }
    println!(
        "GROVE_BENCH properties_ms={} median={:.1} json_bytes={props_bytes} notes={props_notes}",
        ms_list(&props_ms),
        median(&props_ms)
    );
    // Optional actual IPC bodies for the Node page-side comparison. Bench-only,
    // explicitly selected scratch output; ordinary tests/app commands never write these.
    if let Ok(raw) = std::env::var("GROVE_BENCH_JSON_DIR") {
        let dir = std::path::PathBuf::from(raw);
        let temp = std::env::temp_dir();
        assert!(
            dir.starts_with(&temp) && dir != temp,
            "bench JSON must be under a temp subdirectory"
        );
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("frontmatter.json"),
            serde_json::to_vec(&idx.frontmatter(None)).unwrap(),
        )
        .unwrap();
        std::fs::write(
            dir.join("properties.json"),
            serde_json::to_vec(&idx.properties(None)).unwrap(),
        )
        .unwrap();
    }

    let limit = u32::try_from(files.saturating_mul(4).max(2000)).unwrap_or(u32::MAX);
    let mut search_ms = Vec::with_capacity(RUNS);
    let mut search_bytes = 0usize;
    let mut search_hits = 0usize;
    for _ in 0..RUNS {
        let started = Instant::now();
        let found = idx.search(&term, limit);
        let size = json_len(&found);
        search_ms.push(elapsed_ms(started));
        search_hits = found.len();
        search_bytes = size;
    }
    assert!(
        search_hits > 0,
        "search term {term:?} matched nothing; set GROVE_BENCH_TERM"
    );
    println!(
        "GROVE_BENCH search_term={term} limit={limit} ms={} median={:.1} hits={search_hits} json_bytes={search_bytes}",
        ms_list(&search_ms),
        median(&search_ms)
    );

    for (query, match_case) in [
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
        let mut samples = Vec::with_capacity(RUNS);
        let mut bytes = 0usize;
        let mut matched_notes = 0usize;
        let mut total = 0u64;
        for _ in 0..RUNS {
            let started = Instant::now();
            let found = idx.search_notes(query, match_case);
            bytes = json_len(&found);
            samples.push(elapsed_ms(started));
            matched_notes = found.len();
            total = found.iter().map(|n| u64::from(n.count)).sum();
        }
        println!(
            "GROVE_BENCH search_notes_ms query={query:?} match_case={match_case} ms={} median={:.1} json_bytes={bytes} notes={matched_notes} total={total}",
            ms_list(&samples),
            median(&samples)
        );
    }

    let first_50: Vec<String> = idx
        .search_notes("meeting", false)
        .into_iter()
        .take(50)
        .map(|n| n.path)
        .collect();
    let mut lines_ms = Vec::with_capacity(RUNS);
    let mut lines_bytes = 0usize;
    let mut lines_notes = 0usize;
    let mut lines_count = 0usize;
    for _ in 0..RUNS {
        let started = Instant::now();
        let found = idx.search_lines("meeting", false, &first_50, 5);
        lines_bytes = json_len(&found);
        lines_ms.push(elapsed_ms(started));
        lines_notes = found.len();
        lines_count = found.values().map(Vec::len).sum();
    }
    println!(
        "GROVE_BENCH search_lines_ms={} median={:.2} json_bytes={lines_bytes} notes={lines_notes} lines={lines_count}",
        ms_list(&lines_ms),
        median(&lines_ms)
    );

    let match_queries = ["meeting", "tag:project/alpha", "path:\"Folder 01\""].map(String::from);
    let mut match_ms = Vec::with_capacity(RUNS);
    let mut match_bytes = 0usize;
    let mut match_counts = Vec::new();
    for _ in 0..RUNS {
        let started = Instant::now();
        let found = idx.search_match(&match_queries);
        match_bytes = json_len(&found);
        match_ms.push(elapsed_ms(started));
        match_counts = found.iter().map(Vec::len).collect();
    }
    let match_notes = match_counts
        .iter()
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(",");
    println!(
        "GROVE_BENCH search_match_ms={} median={:.1} json_bytes={match_bytes} notes={match_notes}",
        ms_list(&match_ms),
        median(&match_ms)
    );

    // Serialize alone, search not included. Step 0.4 compares this debug
    // figure with a dev profile that optimizes serde_json.
    let hash_hits = idx.search("#", TAG_LIMIT);
    let mut hash_ser_ms = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let started = Instant::now();
        assert_eq!(json_len(&hash_hits), hash_bytes);
        hash_ser_ms.push(elapsed_ms(started));
    }
    println!(
        "GROVE_BENCH hash_serialize_only_ms={} median={:.1}",
        ms_list(&hash_ser_ms),
        median(&hash_ser_ms)
    );
}

/// Resident and peak memory of this process, in MB (Linux `/proc/self/status`).
fn rss_mb() -> (f64, f64) {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    let field = |name: &str| {
        status
            .lines()
            .find(|l| l.starts_with(name))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|kb| kb.parse::<f64>().ok())
            .map_or(0.0, |kb| kb / 1024.0)
    };
    (field("VmRSS:"), field("VmHWM:"))
}

/// R2 P2b: what a save and the link refresh after it cost, with the link table, against
/// the pre-P2b full walk. Same vault as `bench_vault`:
///
/// ```text
/// GROVE_BENCH_VAULT=/tmp/grove-bench-20000 cargo test --release --offline --lib -- --ignored --nocapture bench_link_deltas
/// ```
///
/// `GROVE_BENCH_JSON_DIR` (a temp subdirectory) also writes the full and delta replies for
/// a page-side comparison (`JSON.parse` of the full reply against `patchLinks`).
#[test]
#[ignore]
fn bench_link_deltas() {
    use super::link_table_tests::{walked_backlinks, walked_link_index};
    let root =
        std::env::var("GROVE_BENCH_VAULT").unwrap_or_else(|_| "/tmp/grove-bench-5000".to_string());
    let root = Path::new(&root);
    assert!(root.is_dir(), "bench vault missing at {}", root.display());
    let mut idx = Index::scan(root).expect("scan");
    let (rss, peak) = rss_mb();
    let mut scans = Vec::new();
    for _ in 0..3 {
        let started = Instant::now();
        drop(Index::scan(root).expect("scan"));
        scans.push(elapsed_ms(started));
    }
    println!("GROVE_BENCH vault={} scan_ms={} median={:.1} rss_after_first_scan_mb={rss:.0} peak_mb={peak:.0}", root.display(), ms_list(&scans), median(&scans));
    let mut maps_ms = Vec::new();
    let mut links_ms = Vec::new();
    for _ in 0..3 {
        let started = Instant::now();
        idx.maps.refill(&idx.files);
        maps_ms.push(elapsed_ms(started));
        let started = Instant::now();
        idx.rebuild_links();
        links_ms.push(elapsed_ms(started));
    }
    println!("GROVE_BENCH full rebuild: maps_ms={:.1} links_ms={:.1} (links is new in P2b; it replaces the walk each refresh did)", median(&maps_ms), median(&links_ms));

    let runs = 5;
    let timed = |f: &mut dyn FnMut() -> usize| {
        let mut samples = Vec::new();
        let mut bytes = 0;
        for _ in 0..runs {
            let started = Instant::now();
            bytes = f();
            samples.push(elapsed_ms(started));
        }
        (median(&samples), bytes)
    };
    let (walk_ms, walk_bytes) = timed(&mut || json_len(&walked_link_index(&idx)));
    let (full_ms, full_bytes) = timed(&mut || json_len(&idx.link_changes(None)));
    println!("GROVE_BENCH link_index_walk_ms={walk_ms:.1} json_bytes={walk_bytes} (pre-P2b, every refresh)");
    println!("GROVE_BENCH link_changes_full_ms={full_ms:.1} json_bytes={full_bytes} (first read)");

    // The most linked note, and one note that links to it.
    let mut counts: std::collections::HashMap<&String, usize> = std::collections::HashMap::new();
    let links = idx.link_index();
    for list in links.outgoing.values() {
        for t in list {
            *counts.entry(t).or_default() += 1;
        }
    }
    let (hub, hub_links) = counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(a.0))).map(|(p, n)| (p.clone(), n)).unwrap();
    let source = links.outgoing.iter().find(|(_, t)| t.contains(&hub)).map(|(p, _)| p.clone()).unwrap();
    let text: String = idx.files.get(&source).unwrap().note.lines.iter().map(|l| format!("{}\n", l.text)).collect();
    let target_name = display_name(&hub, false);
    let hub_text: String = idx.files.get(&hub).unwrap().note.lines.iter().map(|l| format!("{}\n", l.text)).collect();

    let one = vec![hub.clone()];
    let (bl_walk, _) = timed(&mut || json_len(&walked_backlinks(&idx, &one)));
    let (bl_table, bl_bytes) = timed(&mut || json_len(&idx.backlinks(&one)));
    println!("GROVE_BENCH backlinks_one walk_ms={bl_walk:.2} table_ms={bl_table:.3} json_bytes={bl_bytes} linkers={hub_links}");

    let json_dir = std::env::var("GROVE_BENCH_JSON_DIR").ok().map(std::path::PathBuf::from);
    if let Some(dir) = &json_dir {
        let temp = std::env::temp_dir();
        assert!(dir.starts_with(&temp) && dir != &temp, "bench JSON must be under a temp subdirectory");
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("links-full.json"), serde_json::to_vec(&idx.link_changes(None)).unwrap()).unwrap();
    }
    fn idx_since(idx: &Index) -> (u64, u64) {
        idx.links.version()
    }

    // Each case: the save (Rust, under the write lock) and the reply the page reads next.
    let cases: Vec<(&str, String, String)> = vec![
        ("typing save, same links", source.clone(), format!("{text}more words\n")),
        ("save adds a link", source.clone(), format!("{text}[[{target_name}]] [[Nowhere new]]\n")),
        ("save adds an alias", source.clone(), format!("---\naliases: [bench alias]\n---\n{text}")),
        ("hub save, same links", hub.clone(), format!("{hub_text}edit\n")),
    ];
    for (label, path, body) in cases {
        let original: String = idx.files.get(&path).unwrap().note.lines.iter().map(|l| format!("{}\n", l.text)).collect();
        let mut save_ms = Vec::new();
        let mut reply_ms = Vec::new();
        let mut reply_bytes = 0;
        let mut changed = 0;
        for _ in 0..runs {
            let base = idx_since(&idx);
            let started = Instant::now();
            idx.upsert_note(root, &path, &body, Stamp::sized(body.len()));
            save_ms.push(elapsed_ms(started));
            let started = Instant::now();
            let reply = idx.link_changes(Some(base));
            reply_bytes = json_len(&reply);
            reply_ms.push(elapsed_ms(started));
            changed = reply.changed.len();
            if let Some(dir) = &json_dir {
                let name = label.replace([' ', ','], "-");
                std::fs::write(dir.join(format!("links-delta-{name}.json")), serde_json::to_vec(&reply).unwrap()).unwrap();
            }
            idx.upsert_note(root, &path, &original, Stamp::sized(original.len()));
        }
        println!(
            "GROVE_BENCH {label}: save_ms={:.3} link_changes_ms={:.3} json_bytes={reply_bytes} changed_notes={changed}",
            median(&save_ms),
            median(&reply_ms)
        );
    }

    // Renaming the most linked note: every linker resolves again.
    let renamed = format!("{hub}-renamed.md");
    let mut ms = Vec::new();
    let mut bytes = 0;
    let mut changed = 0;
    for _ in 0..runs {
        let base = idx_since(&idx);
        let started = Instant::now();
        idx.relocate(&hub, &renamed);
        let reply = idx.link_changes(Some(base));
        bytes = json_len(&reply);
        ms.push(elapsed_ms(started));
        changed = reply.changed.len();
        idx.relocate(&renamed, &hub);
    }
    println!("GROVE_BENCH rename hub: relocate_plus_changes_ms={:.3} json_bytes={bytes} changed_notes={changed}", median(&ms));

    // A folder rename: one full map and link rebuild, then a delta of the notes that differ.
    let folder = parents(&hub).next().unwrap().to_string();
    let mut ms = Vec::new();
    for _ in 0..runs {
        let base = idx_since(&idx);
        let started = Instant::now();
        idx.relocate(&folder, "Bench moved");
        let reply = idx.link_changes(Some(base));
        bytes = json_len(&reply);
        ms.push(elapsed_ms(started));
        changed = reply.changed.len();
        idx.relocate("Bench moved", &folder);
    }
    println!("GROVE_BENCH folder rename ({folder}): relocate_plus_changes_ms={:.1} json_bytes={bytes} changed_notes={changed}", median(&ms));

    // Review 1: one alias read by as many notes as the vault has. Removing it re-resolves
    // every linker; before the fix each one shifted and scanned lists as long as the vault.
    let n = idx.files.len();
    let mut notes: Vec<(String, String)> = (0..n).map(|i| (format!("l/{i:06}.md"), format!("see [[alpha]] here {i}\n"))).collect();
    let aliased = "---\naliases: [alpha]\n---\nhub\n";
    notes.push(("hub.md".into(), aliased.into()));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut fan = Index::from_notes(&refs);
    let (rebuild_ms, _) = timed(&mut || {
        fan.rebuild_links();
        0
    });
    let mut remove_ms = Vec::new();
    let mut add_ms = Vec::new();
    for _ in 0..runs {
        let base = idx_since(&fan);
        let started = Instant::now();
        fan.upsert_note(root, "hub.md", "hub\n", Stamp::sized(4));
        remove_ms.push(elapsed_ms(started));
        changed = fan.link_changes(Some(base)).changed.len();
        let started = Instant::now();
        fan.upsert_note(root, "hub.md", aliased, Stamp::sized(aliased.len()));
        add_ms.push(elapsed_ms(started));
    }
    println!(
        "GROVE_BENCH shared alias, {n} linkers, settled inline: remove_ms={:.1} add_back_ms={:.1} full_link_rebuild_ms={rebuild_ms:.1} changed_notes={changed}",
        median(&remove_ms),
        median(&add_ms)
    );
    // Review 3, as the app runs it: the save queues the key; off-lock jobs resolve the linkers
    // (`link_reads::settle`), and a reply is copied in steps. `hold` is the longest step that
    // holds the lock (a save queued behind them waits for at most that).
    fan.set_defer_links(true);
    let (mut save_ms, mut settle_ms, mut hold) = (Vec::new(), Vec::new(), 0f64);
    for body in ["hub\n", aliased].iter().cycle().take(2 * runs) {
        let started = Instant::now();
        fan.upsert_note(root, "hub.md", body, Stamp::sized(body.len()));
        save_ms.push(elapsed_ms(started));
        let started = Instant::now();
        hold = hold.max(settle_by_jobs(&mut fan));
        settle_ms.push(elapsed_ms(started));
    }
    println!(
        "GROVE_BENCH shared alias, {n} linkers, off-lock jobs: save_ms={:.3} settle_ms={:.1} longest_hold_ms={hold:.2}",
        median(&save_ms),
        median(&settle_ms)
    );
    let (reply_ms, reply_hold) = reply_by_steps(&fan);
    println!("GROVE_BENCH whole link_index of {n} notes in steps: total_ms={reply_ms:.1} longest_hold_ms={reply_hold:.3}");

    // Review 3: a name with many owners, and link-heavy notes.
    let m = n / 2;
    let mut notes: Vec<(String, String)> = Vec::new();
    for i in 0..m {
        notes.push((format!("r{i:06}/README.md"), "readme\n".into()));
        notes.push((format!("r{i:06}/n.md"), "see [[README]]\n".into()));
    }
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut owners = Index::from_notes(&refs);
    owners.set_defer_links(true);
    let started = Instant::now();
    owners.upsert_note(root, "README.md", "top\n", Stamp::sized(4));
    let save = elapsed_ms(started);
    let started = Instant::now();
    let hold = settle_by_jobs(&mut owners);
    println!("GROVE_BENCH a new README among {m} with {m} readers: save_ms={save:.3} settle_ms={:.1} longest_hold_ms={hold:.2}", elapsed_ms(started));
    let heavy: String = (0..5_000).map(|j| format!("[[alpha]] [[t{j}]] [x](m{j}.md)\n")).collect();
    let mut notes: Vec<(String, String)> = (0..100).map(|i| (format!("h/{i:03}.md"), heavy.clone())).collect();
    notes.push(("hub.md".into(), aliased.into()));
    let refs: Vec<(&str, &str)> = notes.iter().map(|(p, c)| (p.as_str(), c.as_str())).collect();
    let mut heavy = Index::from_notes(&refs);
    heavy.set_defer_links(true);
    let started = Instant::now();
    heavy.upsert_note(root, "hub.md", "hub\n", Stamp::sized(4));
    let save = elapsed_ms(started);
    let started = Instant::now();
    let hold = settle_by_jobs(&mut heavy);
    println!("GROVE_BENCH 100 notes of 5,000 links reading an alias: save_ms={save:.3} settle_ms={:.1} longest_hold_ms={hold:.2}", elapsed_ms(started));
}

/// Settle as `link_reads::settle` does; the longest step that holds the lock (ms).
fn settle_by_jobs(idx: &mut Index) -> f64 {
    use super::LinkSlice;
    let mut hold = 0f64;
    loop {
        let started = Instant::now();
        let job = idx.link_job();
        hold = hold.max(elapsed_ms(started));
        let Some(mut job) = job else {
            return hold;
        };
        job.ask();
        loop {
            let started = Instant::now();
            let got = idx.answer(&mut job);
            hold = hold.max(elapsed_ms(started));
            if got != LinkSlice::More {
                break;
            }
        }
        job.finish();
        let started = Instant::now();
        idx.publish(job);
        hold = hold.max(elapsed_ms(started));
    }
}

/// A whole `link_index` reply built as `link_reads` builds it: (total ms, longest step ms).
fn reply_by_steps(idx: &Index) -> (f64, f64) {
    use super::{LinkReply, ReplyStep};
    let all = Instant::now();
    let mut reply = LinkReply::new(None);
    let mut hold = 0f64;
    loop {
        let started = Instant::now();
        let step = reply.step(idx);
        hold = hold.max(elapsed_ms(started));
        reply.absorb();
        if step == ReplyStep::Done {
            break;
        }
    }
    let index = reply.into_index();
    assert!(!index.outgoing.is_empty());
    (elapsed_ms(all), hold)
}
