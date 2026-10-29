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
    let mut back_bytes = 0usize;
    let mut out_bytes = 0usize;
    let mut md_bytes = 0usize;
    let mut missing_bytes = 0usize;
    for _ in 0..RUNS {
        let started = Instant::now();
        let links = idx.link_index();
        let size = json_len(&links);
        link_ms.push(elapsed_ms(started));
        back_bytes = json_len(&links.backlinks);
        out_bytes = json_len(&links.outgoing);
        md_bytes = json_len(&links.markdown);
        missing_bytes = json_len(&links.unresolved);
        link_bytes = size;
    }
    println!(
        "GROVE_BENCH link_index_ms={} median={:.1} json_bytes={link_bytes} backlinks_bytes={back_bytes} outgoing_bytes={out_bytes} markdown_bytes={md_bytes} unresolved_bytes={missing_bytes}",
        ms_list(&link_ms),
        median(&link_ms)
    );

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
