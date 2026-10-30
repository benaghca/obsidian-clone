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

use super::{is_note_path, Index};
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
