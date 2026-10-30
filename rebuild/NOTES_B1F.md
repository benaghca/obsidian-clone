# NOTES_B1F — Step 4 Front-End Search Benchmarks (Gemini)

Branch: `rebuild/b1f-bench-gemini` (based on `rebuild/c1b-search-codex` `3cd98aa`)

## 1. What Changed

| File | Diff (`+`/`-`) | Summary |
|---|---|---|
| `rebuild/app/scripts/bench-frontend.mjs` | `+39 / -11` | Replace the deleted `searchFacts` + `matchingNotes` benchmark block with the new search-view path through the mock (`api.searchNotes("garden", false)`, `searchResults` exclusion filter and `"alphabetical"` sort, and `api.searchLines("garden", false, first 50 paths, 5)`), plus timing `JSON.parse` and `searchResults` exclusion/sort on a 5,000-entry `[{ path, count }]` JSON string. |
| `rebuild/RUST_BENCH.md` | `+17 / -1` | Add the `node scripts/bench-frontend.mjs 5000` before-vs-after subsection and the `≤ 15 ms` page-work assessment (with D2 object-size evaluation) to the Step 4 section. |

Total: 2 files changed, 56 insertions(+), 11 deletions(-). `gen-vault.mjs`, search implementation code, commands, and other TypeScript/Rust files were not touched.

---

## 2. Benchmark Results (`node scripts/bench-frontend.mjs 5000`)

Measured under `flock /tmp/grove-npm-test.lock` against the 5,007-note (`5,017`-file) mock vault (`?synthetic=5000` plus sample files, 3 runs):

```json
{"synthetic":5000,"files":5017,"notes":5007,"setup_ms":71,"vault_tags_ms":"19.4,10.9,10.0","vault_tags_median_ms":10.9,"notes_with_tags":5007,"tag_uses":10996,"search_term":"garden","search_ms":"22.7,13.4,12.7","search_median_ms":13.4,"search_matches":1900,"search_total":2950,"search_notes_json_bytes":91971,"search_lines_json_bytes":4162,"search_parse_5k_ms":"0.4,0.4,0.4","search_parse_5k_median_ms":0.4,"search_page_5k_ms":"4.5,4.5,4.2","search_page_5k_median_ms":4.5,"search_parse_5k_bytes":248894,"search_page_5k_notes":5000,"link_refresh_ms":"8399.4,7789.3,7625.3","link_refresh_median_ms":7789.3,"link_json_bytes":639766,"outgoing_notes":3946}
```

### Before vs After Summary

| Work | Before (step 0.2) | After (Step 4, C1-B) | Runs (after) | Payload / notes |
|---|---|---|---|---|
| Search view query `garden` (mock) | 5.7 ms (`6.5, 5.3, 5.7 ms`; `searchFacts` + `matchingNotes`, no exact counts or 50-row line read) | **13.4 ms** (`api.searchNotes` + `searchResults` exclusion/sort + `api.searchLines` for 50 paths) | `22.7, 13.4, 12.7 ms` | 1,900 notes, exact total `2,950`; `91,971 B` notes (`48.4 B/note`) + `4,162 B` lines (50 paths) |
| `JSON.parse` of 5,000-entry `[{ path, count }]` | — | **0.4 ms** | `0.4, 0.4, 0.4 ms` | `248,894 B` (`49.8 B/note`, 5,000 synthetic notes) |
| Page work (`JSON.parse` + exclusion + sort, 5,000 notes) | 7.4 ms (`compareNames` sort alone, §7) | **4.5 ms** (synthetic 5k) / **6.5 ms** (`/tmp/grove-bench-5000` `meeting`, `NOTES_C1B.md`) | `4.5, 4.5, 4.2 ms` / `6.5, 6.5, 6.4 ms` | `248,894 B` (synthetic 5k) / `292,520 B` (`58.5 B/note`, `/tmp/grove-bench-5000` `meeting`, total `131,948`) |
| `vaultTags.read()` (Step 1 `api.tags`) | 25 ms (`42, 25, 23 ms`) | **10.9 ms** | `19.4, 10.9, 10.0 ms` | 5,007 notes, 10,996 tag uses |
| `refreshLinks()` (Step 2 `link_index`) | 7.9 s (`8.3, 7.9, 7.7 s`, 2.25 MB) | **7.8 s** | `8.4, 7.8, 7.6 s` | `639,766 B` (0.64 MB without backlinks); 3,946 notes with outgoing links |

### Assessment Against §7 Targets and D2

- **Page per keystroke (`JSON.parse` + exclusion + sort, 5,000 results) ≤ 15 ms:** **Met**.
  - On `bench-frontend.mjs 5000`'s 5,000-entry `[{ path, count }]` string (`248,894 B`, ~49.8 B/note), `JSON.parse` alone is **0.4 ms** (`0.4, 0.4, 0.4 ms`) and `JSON.parse` + `searchResults` (known-file check + exclusion filter + `compareFiles("alphabetical")` sort) is **4.5 ms** (`4.5, 4.5, 4.2 ms`).
  - On `/tmp/grove-bench-5000`'s `search_notes("meeting")` payload (`292,520 B`, 58.5 B/note, 5,000 notes, exact total `131,948`), `JSON.parse` + `searchResults` + total sum is **6.5 ms** (`6.5, 6.5, 6.4 ms`).
- **D2 (`{ path, count }` object array, ~50–60 B/note):** Although `{ path, count }` objects average `49.8 B/note` on the synthetic mock vault and `58.5 B/note` on `/tmp/grove-bench-5000` (above the §7 ~45 B/note estimate / 0.25 MB cap at 5,000 notes), the extra ~42 KB over 0.25 MB costs less than 0.1 ms in `JSON.parse` (`0.4 ms` total) and leaves the 5,000-note page work (`4.5–6.5 ms`) well under half of the 15 ms budget.
- **Mock search path (`13.4 ms` vs old `5.7 ms`):** In `bench-frontend.mjs`, `api.searchNotes` and `api.searchLines` execute the JS reference (`searchVault`) in the same Node process and compute exact occurrence counts across all 1,900 matching notes (`2,950` total) plus 50 note line groups (which the old `5.7 ms` `searchFacts` + `matchingNotes` baseline did not do). In the built Tauri app, `search_notes` (`19.8 ms` release on `/tmp/grove-bench-5000`) and `search_lines` (`0.08 ms` release) run in Rust off the main thread.

---

## 3. Verification

All checks ran under `flock /tmp/grove-npm-test.lock`:
- `cargo build --offline`: **Passed**.
- `cargo test --offline`: **58 passed, 0 failed, 2 ignored**.
- `npm run build`: **Passed**.
- `npm run audit:offline`: **Passed** (`166 source files, dist/, CSP, capabilities and dependencies checked`).
- `npm test` (including `test-browser-discovery.mjs`, `vitest run` with 58 test files, all 53 browser scripts including `test-search-commands.mjs`, and `posttest`): **Passed on the first run**.

---

## 4. Left Open

- Nothing left open for B1 / B1F.
