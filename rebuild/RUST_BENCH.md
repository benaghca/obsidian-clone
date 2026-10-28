# Rust migration baseline (step 0.2)

Measured 2026-10-27 on this machine: AMD Ryzen 9 7900X (12 cores / 24 threads), 30 GiB RAM, Linux, rustc 1.99.1. The plan's section 1 numbers are in the comparison columns. Times are the median of three runs after one warmup scan. Release is `cargo test --release`. Debug is a normal `cargo test` (`opt-level = 0` for Grove and its dependencies, which is what `tauri dev` compiles).

Bytes below are the compact JSON `serde_json` would send. "MB" is bytes / 1,000,000.

## The vault

`node scripts/gen-vault.mjs /tmp/grove-bench-5000 5000` from `rebuild/app`. The vault is not in the repo. Same arguments always write the same bytes (sha256 `5b03c1bee51dfe6e284f30d1e2452f9f5bd62c66a5018e8127d8593b0de5d8e7`).

| | This vault | Section 1 |
|---|---|---|
| Notes | 5,000 | 5,000 |
| Layout | 25 folders × 4 subfolders | 25 × 4 |
| Lines (frontmatter included) | 200,009, each note 20–60 | 20–60 lines per note |
| Text | 13.60 MB | 13.6 MB |
| Notes with a `tags:` list | 3,000 (60%) | about 60% (3,015 frontmatter blocks) |
| Inline `#tag` lines | 16,001 (8.0% of lines) | about 8% of lines |
| Link lines | 14,001 (7.0%): 13,301 wikilinks, 700 markdown | about 7% wikilinks |
| Fenced notes | 152 (3.0%): 76 ` ``` `, 76 `~~~` | about 3% fenced blocks |
| Unicode tags | 801 inline, plus some frontmatter (`café`, `日本語`, `проект`, a combining accent) | some |

Two choices that the plan left open, made so the `#` search would land near section 1:

- About 10% of lines are extra headings, on top of each note's title. Headings are most of the `#` hits in section 1.
- A wikilink inside each fence, which the index correctly drops. Indexed links are 14,001, the same as the link lines outside fences.

`#` does not match `tags:` (the `s` sits between `tag` and `:`). The `tag:` search hits only the 250 notes that also have a legacy `tag:` key. Section 1's 56k hits across the five searches included a lot more fence and `tag:` lines than this vault has.

## Rust commands

`GROVE_BENCH_VAULT=/tmp/grove-bench-5000`, test `index::bench::bench_vault`. The tag figure is the five searches `vaultTags.ts` makes (`#`, ` ``` `, `~~~`, `tags:`, `tag:`, limit 100,000) plus serializing each result. The search figure is one term, `meeting`, with `limit = files × 4` (5,125 files including the 125 folders, so 20,500), which is what the search view asks for. Scan does not serialize.

| Work | Release median | Debug median | Section 1 release | Section 1 debug |
|---|---|---|---|---|
| `Index::scan` | 99 ms (first run 124; warmup 126) | 523 ms (first run 548; warmup 548) | 124 ms | 538 ms |
| Five tag searches + serialize | 65 ms | 275 ms | 80 ms | 335 ms |
| Serialize the `#` hits only | 2.3 ms | 92 ms | about 1.8 ms | about 84 ms |
| `link_index` + serialize | 8.7 ms | 88 ms | 18 ms | 145 ms |
| `frontmatter(None)` + serialize | 0.9 ms | 14 ms | 2 ms | 18 ms |
| Search `meeting`, limit 20,500 | 24 ms | 124 ms | 17–36 ms | 98–124 ms |

The `#` serialize on its own is 40× slower in debug (92 ms vs 2.3 ms). Section 1 called that gap 40–50× (about 84 ms vs 1.8 ms). Step 0.4 is aimed at this line.

| Payload | This vault | Section 1 |
|---|---|---|
| Five tag searches | 3.98 MB (44,708 hits) | 4.34 MB (56k hits) |
| `#` alone | 3.72 MB (41,154 hits) | 3.4 MB (41k hits) |
| `link_index` | 2.36 MB | 3.85 MB |
| backlinks / outgoing | 1.59 MB / 0.71 MB | 3.09 MB / 0.97 MB |
| markdown links / unresolved | 0.06 MB / none (every link resolves) | (not split out) |
| `frontmatter(None)` | 0.27 MB, 3,000 blocks | 0.38 MB, 3,015 blocks |
| Search `meeting` | 3.01 MB, 20,500 hits (the limit) | 1.9–2.9 MB |

Release search time sits inside section 1's range. Debug search sits on the top of its range. Scan, tag refresh and the link index are faster than section 1 once the files are cached; the first scan matches section 1 (126 ms release, 548 ms debug). The payloads differ where the vault's text differs: `#` hits match, but our paths and heading lines are a bit longer (3.72 MB vs 3.4 MB), our link lines are short (`Related: [[name]].`) so backlinks are about half, and our fences are 3% of notes rather than a large share of lines, so the five searches together are 45k hits rather than 56k.

## Front end (the mock, in Node)

`node scripts/bench-frontend.mjs 5000` from `rebuild/app`. This loads the real `vaultTags.read`, the search view's query path (`searchFacts` + `matchingNotes`, term `garden`), and `Vault.refreshLinks` through Vite, with `location.search` set to `?synthetic=5000`. That is the dev-page mock: `syntheticVault(5000)` plus the small sample vault (5,007 notes, 5,017 files). No webview, no IPC, no `JSON.parse`. Three runs, caches dropped between them. Median:

| Work | Median | Runs | What came back |
|---|---|---|---|
| Setup (`refreshFiles`, includes building the synthetic vault) | 66 ms | once | 5,007 notes |
| `vaultTags.read()` | 25 ms | 42, 25, 23 ms | 5,007 notes, 10,996 tag uses |
| Search view query `garden` | 5.7 ms | 6.5, 5.3, 5.7 ms | 1,900 notes |
| `refreshLinks()` | 7.9 s | 8.3, 7.9, 7.7 s | 2.25 MB stringified; 3,946 notes with outgoing links, 4,108 with backlinks |

Section 1's page times (JSON.parse 10 ms + `tagsByNote` 42 ms, link JSON.parse 9 ms) were the cost of receiving Rust's JSON. These are a different measurement: the mock does the searching and the link index in JavaScript. Tag read and the search query are cheap on this vault because the synthetic notes are a few lines each. The link refresh is not. The mock resolves every link by building a map of all notes (`links/internal.ts` `resolveLink`), so 5,000 notes costs seconds. The Rust command for a vault this size is 8.7 ms release. The dev page with `?synthetic=5000` pays the mock's cost, on the page's thread.

## Run again

From `rebuild/app`:

```text
node scripts/gen-vault.mjs /tmp/grove-bench-5000 5000
node scripts/bench-frontend.mjs 5000
```

From `rebuild/app/src-tauri`, after that vault exists:

```text
GROVE_BENCH_VAULT=/tmp/grove-bench-5000 cargo test --release -- --ignored --nocapture bench_vault
GROVE_BENCH_VAULT=/tmp/grove-bench-5000 cargo test -- --ignored --nocapture bench_vault
```

`GROVE_BENCH_VAULT` defaults to `/tmp/grove-bench-5000`. `GROVE_BENCH_TERM` defaults to `meeting`. The Rust test is `#[ignore]`, so a normal `cargo test` skips it.
