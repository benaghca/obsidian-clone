# NOTES_B1 — Step 4 Rust Search Benchmarks (Gemini)

Branch: `rebuild/b1-bench-gemini` (based on `rebuild/c1a-search-codex` `4d02300`)

## 1. What Changed

| File | Diff (`+`/`-`) | Summary |
|---|---|---|
| `rebuild/app/src-tauri/src/index/bench.rs` | `+77 / -0` | Add `search_notes_ms` (10 queries from `STEP4_SEARCH_PLAN.md` §7), `search_lines_ms` (first 50 paths of `meeting`, limit 5), and `search_match_ms` (`["meeting", "tag:project/alpha", "path:\"Folder 01\""]`) to `bench_vault`. |
| `rebuild/RUST_BENCH.md` | `+37 / -0` | Add a `## Step 4 (Rust search commands)` section with before-vs-after comparisons, the §7 query table (release and debug medians + compact JSON payload bytes), and target assessments against §7, D2, and D5. |

Total: 2 files changed, 114 insertions(+), 0 deletions(-). `gen-vault.mjs` and `scripts/bench-frontend.mjs` were not touched.

---

## 2. Benchmark Results (`/tmp/grove-bench-5000`, `sha256` `5b03c1be…`)

All runs were executed under `flock /tmp/grove-npm-test.lock` with `GROVE_BENCH_VAULT=/tmp/grove-bench-5000 cargo test --offline [--release] -- --ignored --nocapture bench_vault` (3 runs after 1 warmup scan, compact `serde_json` serialization included):

### Before vs After

| Work | Before, release | After, release | Before, debug | After, debug | Before payload | After payload |
|---|---|---|---|---|---|---|
| Single-word query `meeting` | 26.3 ms (`search`, capped at 20,500 hits) | **19.8 ms** (`search_notes`) + **0.08 ms** (`search_lines`, 50 paths) | 121.0 ms | **84.3 ms** + **1.05 ms** | **3.01 MB** (`3,009,644 B`, 20,500 hits, capped) | **0.29 MB** (`292,520 B` notes + `26,385 B` first 50 rows; exact total `131,948`) |
| Two-word query `garden river` | two `search` calls (~50 ms, ~6.4 MB) | **27.2 ms** (one `search_notes` call) | ~240 ms | **146.2 ms** | ~6.4 MB | **0.29 MB** (`292,525 B`, 5,000 notes, exact total `268,814`) |

### Full §7 Query Set (`bench_vault` output)

| Command & query | `match_case` | Notes / paths | Total / lines | Release (`ms` / median) | Debug (`ms` / median) | Debug / release | `json_bytes` |
|---|---|---|---|---|---|---|---|
| `search_notes("meeting")` | `false` | 5,000 | 131,948 | `19.8,19.4,20.0` (**19.8**) | `86.0,84.2,84.3` (**84.3**) | 4.3× | 292,520 |
| `search_notes("alpha")` | `false` | 2,376 | 3,233 | `9.6,9.4,9.6` (**9.6**) | `46.7,45.7,45.1` (**45.7**) | 4.8× | 136,624 |
| `search_notes("zzz")` | `false` | 0 | 0 | `15.6,15.9,15.9` (**15.9**) | `36.9,36.6,36.1` (**36.6**) | 2.3× | 2 |
| `search_notes("garden river")` | `false` | 5,000 | 268,814 | `27.2,27.0,27.3` (**27.2**) | `145.5,146.5,146.2` (**146.2**) | 5.4× | 292,525 |
| `search_notes("\"garden path\"")` | `false` | 5,000 | 128,948 | `24.8,24.2,24.1` (**24.2**) | `122.6,120.6,120.9` (**120.9**) | 5.0× | 292,500 |
| `search_notes("meeting -garden (river OR stone)")` | `false` | 0 | 0 | `13.2,13.0,13.0` (**13.0**) | `69.1,68.2,67.9` (**68.2**) | 5.2× | 2 |
| `search_notes("tag:project")` | `false` | 4,789 | 5,067 | `9.7,9.5,9.4` (**9.5**) | `47.0,46.9,46.3` (**46.9**) | 4.9× | 275,396 |
| `search_notes("[tags:meeting]")` | `false` | 3,000 | 0 | `2.4,1.9,1.7` (**1.9**) | `9.9,9.6,9.4` (**9.6**) | 5.1× | 172,519 |
| `search_notes("line:(garden river)")` | `false` | 5,000 | 257,896 | `28.6,28.8,28.9` (**28.8**) | `177.4,176.5,176.4` (**176.5**) | 6.1× | 292,525 |
| `search_notes("Meeting")` | `true` | 0 | 0 | `9.9,9.8,9.8` (**9.8**) | `50.4,50.1,49.7` (**50.1**) | 5.1× | 2 |
| `search_lines("meeting", 50 paths, limit 5)` | `false` | 50 | 250 lines | `0.2,0.1,0.1` (**0.08**) | `1.2,1.0,1.0` (**1.05**) | 13.1× | 26,385 |
| `search_match(["meeting", "tag:project/alpha", "path:\"Folder 01\""])` | `false` | `5000,346,200` | — | `13.5,12.7,12.5` (**12.7**) | `50.9,50.4,49.6` (**50.4**) | 4.0× | 213,470 |

### Assessment Against §7 Targets, D2, and D5

- **`search_notes` ≤ 30 ms (release):** **Met** for all 10 queries (1.9–28.8 ms).
- **`search_lines` (50 paths, limit 5) ≤ 5 ms / ≤ 40 KB:** **Met** (0.08 ms release / 1.05 ms debug, 26,385 B).
- **`search_match` (3 queries) ≤ 50 ms / ≤ 0.6 MB:** **Met** (12.7 ms release / 50.4 ms debug, 213,470 B).
- **Exact counts (D3):** **Met** (`meeting` returns `131,948` total occurrences across 5,000 notes instead of the old 20,500-hit cap).
- **Payload size (D2):** On `/tmp/grove-bench-5000`, `{"path":"Folder XX/Sub Y/Note ZZZZ - topic.md","count":NN}` averages **58.5 B/note** (`292,520 B` for 5,000 notes; `136,624 B` for `alpha`'s 2,376 notes), slightly above the §7 estimate of ~45 B/note (≤ 0.25 MB at 5,000 notes) and ~9.4× smaller than the old 3.01 MB single-term payload.
- **Debug vs release (D5):** Most full-scan queries sit at **4.0–5.4×** release (with `line:(garden river)` at 6.1× / 176.5 ms) because Grove's crate is compiled at `opt-level = 0` in debug.

---

## 3. Verification

All checks ran under `flock /tmp/grove-npm-test.lock`:
- `cargo build --offline`: **Passed**.
- `cargo test --offline`: **52 passed, 0 failed, 2 ignored** (both `bench_vault` and `bench_search_commands` also passed when run with `--ignored`).
- `npm run build`: **Passed**.
- `npm run audit:offline`: **Passed** (`166 source files, dist/, CSP, capabilities and dependencies checked`).
- `npm test` (including all browser scripts and `posttest`): **Passed on the first run** (`vitest`: 58 files, 665 passed).

---

## 4. Left Open

- The `scripts/bench-frontend.mjs` half of B1 waits for C1-B (frontend switch-over to `api.searchNotes` / `api.searchLines`).
