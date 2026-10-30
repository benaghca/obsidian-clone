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

## Step 4 (Rust search commands)

Measured 2026-10-29 on the same `/tmp/grove-bench-5000` vault (`sha256` `5b03c1be…`, 5,000 notes, 13.60 MB) with `index::bench::bench_vault`. Each figure includes compact `serde_json` serialization and is the median of three runs after the warmup scan.

### Before vs after (per-term `search` vs `search_notes` + `search_lines`)

| Work | Before, release | After, release | Before, debug | After, debug | Before payload | After payload |
|---|---|---|---|---|---|---|
| Single-word query `meeting` | 26.3 ms (`search`, capped at 20,500 hits) | **19.8 ms** (`search_notes`) + **0.08 ms** (`search_lines`, 50 paths) | 121.0 ms | **84.3 ms** + **1.05 ms** | **3.01 MB** (20,500 hits, capped) | **0.29 MB** (`292,520 B` notes + `26,385 B` first 50 rows; exact total `131,948`) |
| Two-word query `garden river` | two `search` calls (~50 ms, ~6.4 MB across two 20,500-hit replies) | **27.2 ms** (one `search_notes` call) | ~240 ms | **146.2 ms** | ~6.4 MB | **0.29 MB** (`292,525 B`, 5,000 notes, exact total `268,814`) |

### `search_notes`, `search_lines` and `search_match` (§7 query set)

| Command & query | `match_case` | Notes / paths | Total count / lines | Release median (`ms`) | Debug median (`ms`) | Debug / release | Payload (`json_bytes`) |
|---|---|---|---|---|---|---|---|
| `search_notes("meeting")` | `false` | 5,000 | 131,948 | **19.8** (`19.8,19.4,20.0`) | **84.3** (`86.0,84.2,84.3`) | 4.3× | 292,520 (0.29 MB) |
| `search_notes("alpha")` | `false` | 2,376 | 3,233 | **9.6** (`9.6,9.4,9.6`) | **45.7** (`46.7,45.7,45.1`) | 4.8× | 136,624 (0.14 MB) |
| `search_notes("zzz")` | `false` | 0 | 0 | **15.9** (`15.6,15.9,15.9`) | **36.6** (`36.9,36.6,36.1`) | 2.3× | 2 |
| `search_notes("garden river")` | `false` | 5,000 | 268,814 | **27.2** (`27.2,27.0,27.3`) | **146.2** (`145.5,146.5,146.2`) | 5.4× | 292,525 (0.29 MB) |
| `search_notes("\"garden path\"")` | `false` | 5,000 | 128,948 | **24.2** (`24.8,24.2,24.1`) | **120.9** (`122.6,120.6,120.9`) | 5.0× | 292,500 (0.29 MB) |
| `search_notes("meeting -garden (river OR stone)")` | `false` | 0 | 0 | **13.0** (`13.2,13.0,13.0`) | **68.2** (`69.1,68.2,67.9`) | 5.2× | 2 |
| `search_notes("tag:project")` | `false` | 4,789 | 5,067 | **9.5** (`9.7,9.5,9.4`) | **46.9** (`47.0,46.9,46.3`) | 4.9× | 275,396 (0.28 MB) |
| `search_notes("[tags:meeting]")` | `false` | 3,000 | 0 | **1.9** (`2.4,1.9,1.7`) | **9.6** (`9.9,9.6,9.4`) | 5.1× | 172,519 (0.17 MB) |
| `search_notes("line:(garden river)")` | `false` | 5,000 | 257,896 | **28.8** (`28.6,28.8,28.9`) | **176.5** (`177.4,176.5,176.4`) | 6.1× | 292,525 (0.29 MB) |
| `search_notes("Meeting")` | `true` | 0 | 0 | **9.8** (`9.9,9.8,9.8`) | **50.1** (`50.4,50.1,49.7`) | 5.1× | 2 |
| `search_lines("meeting", first 50 paths, limit 5)` | `false` | 50 | 250 lines | **0.08** (`0.2,0.1,0.1`) | **1.05** (`1.2,1.0,1.0`) | 13.1× | 26,385 (26.4 KB) |
| `search_match(["meeting", "tag:project/alpha", "path:\"Folder 01\""])` | `false` | `5000,346,200` | — | **12.7** (`13.5,12.7,12.5`) | **50.4** (`50.9,50.4,49.6`) | 4.0× | 213,470 (0.21 MB) |

### Against `STEP4_SEARCH_PLAN.md` §7 targets and D5

- **Backend `search_notes` ≤ 30 ms (release):** **Met** for all 10 queries (1.9–28.8 ms; `meeting` is 19.8 ms).
- **`search_lines` (50 paths, limit 5) ≤ 5 ms / ≤ 40 KB:** **Met** (0.08 ms release / 1.05 ms debug, 26.4 KB).
- **`search_match` (3 queries) ≤ 50 ms / ≤ 0.6 MB:** **Met** (12.7 ms release / 50.4 ms debug, 0.21 MB).
- **Exact counts:** **Met** (`meeting` returns exact `131,948` occurrences across 5,000 notes instead of stopping at the old 20,500-line cap).
- **Payload size (`SearchNote { path, count }`):** With the vault's 35-character path strings (`Folder XX/Sub Y/Note ZZZZ - topic.md`), each `{"path":"...","count":NN}` entry averages **58.5 B/note** (`292,520 B` / 0.29 MB for all 5,000 notes; `136,624 B` / 0.14 MB for `alpha`'s 2,376 notes), slightly above the §7 estimate of ~45 B/note (≤ 0.25 MB at 5,000 notes) and ~9.4× smaller than the old single-term 3.01 MB payload.
- **Debug vs release (D5):** Most full-scan queries sit around **4.0–5.4×** release (within or just above D5's 3–5× range, and `line:(garden river)` is 6.1× at 176.5 ms) because Grove's own crate compiles at `opt-level = 0` in debug while dependencies compile at `opt-level = 2`.

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
