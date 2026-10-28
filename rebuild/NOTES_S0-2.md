# S0-2

Step 0.2 adds a deterministic bench vault, an ignored Rust timing test, a front-end timing script, and the baseline in `rebuild/RUST_BENCH.md`. No command or TypeScript API changed. `index.rs` gained one `mod bench;` line, compiled only for tests.

## Files

| File | Added | Removed |
|---|---:|---:|
| `rebuild/app/scripts/gen-vault.mjs` | 235 | 0 |
| `rebuild/app/src-tauri/src/index/bench.rs` | 219 | 0 |
| `rebuild/app/src-tauri/src/index.rs` | 2 | 0 |
| `rebuild/app/scripts/bench-frontend.mjs` | 146 | 0 |
| `rebuild/RUST_BENCH.md` | 86 | 0 |
| `rebuild/NOTES_S0-2.md` | 53 | 0 |

## What the new pieces do

`gen-vault.mjs` writes a vault under a directory inside the system temp dir and refuses anywhere else. The default is 5,000 notes: 25 folders by 4 subfolders, 20–60 lines each, 60% with a `tags:` list, about 8% of lines with an inline `#tag`, about 7% with a link, about 3% of notes fenced (both `` ``` `` and `~~~`), and some Unicode tags. The vault behind the numbers is `/tmp/grove-bench-5000`: 13,600,158 bytes, sha256 `5b03c1bee51dfe6e284f30d1e2452f9f5bd62c66a5018e8127d8593b0de5d8e7`. It is not in the repo.

`index/bench.rs` is `#[test] #[ignore]`. A normal `cargo test` skips it. It times `Index::scan`, the five `vaultTags` searches plus serialize, `link_index` plus serialize, `frontmatter(None)` plus serialize, and one search at `limit = files × 4`. A separate line times serializing the `#` hits alone, for step 0.4. The medians are in `RUST_BENCH.md`.

`bench-frontend.mjs` times the dev-page mock through Vite: `vaultTags.read()`, one search-view query (`garden`), and `Vault.refreshLinks()` at `?synthetic=5000`. There is no webview and no `JSON.parse`.

## Tests

Run on 2026-10-27 in this worktree, after these files existed.

- `npm run build` in `rebuild/app` passed (`tsc --noEmit` and `vite build`). The existing chunk-size warning is unchanged.
- `npm test` in `rebuild/app` passed. Browser discovery 4, vitest 53 files / 300 tests, then the geometry, drag, and round scripts through `test-r27t` and the posttest Bases config script. Exit 0. Build, the full test script, and the audit together took about 8.8 minutes.
- `npm run audit:offline` passed: 164 source files, dist, CSP, capabilities, and dependencies.
- `cargo build --offline` in `rebuild/app/src-tauri` passed (dev profile, 0.83s).
- `cargo test --offline` passed: 37 tests, 0 failed, 1 ignored (`index::bench::bench_vault`), 0.05s. Doc-tests 0.
- The ignored bench was run on `/tmp/grove-bench-5000` in release and debug. Those runs are the numbers in `RUST_BENCH.md`.

`npm test` rewrote 53 files under `rebuild/round23-shots` through `rebuild/round32b-shots` (PNG bytes, a canvas id, a view name, and one timing JSON). Those captures belong to earlier rounds. This step does not change the app, so the files were restored and left uncommitted.

## Where the baseline differs from section 1

The first scan matches the plan (126 ms release, 548 ms debug). Later scans are faster once the page cache is hot (median 99 ms release, 523 ms debug). Tag search plus serialize is faster and smaller (65 ms and 3.98 MB, against 80 ms and 4.34 MB) because this vault has fewer fence lines, and `tag:` does not match `tags:`. The `#` hit count matches (41,154 against about 41k) and the JSON is larger (3.72 MB against 3.4 MB) because paths and heading lines are longer. The link index is faster and smaller (8.7 ms and 2.36 MB, against 18 ms and 3.85 MB) because each link line is short. Frontmatter is 3,000 blocks against 3,015. Search for `meeting` is inside the plan's release range (24 ms) and at the top of the debug range (124 ms). That JSON is 3.01 MB, a little above the plan's 2.9 MB top.

The front-end script measures the mock in Node. Section 1's page column measured `JSON.parse` of Rust JSON. On the mock, tag read is 25 ms and the search query is 5.7 ms, on short synthetic notes. Link refresh is 7.9 s because the mock rebuilds a note map for every link. The Rust command on the generated vault is 8.7 ms release. The mock was left as it is.

## Left open

WebKitGTK IPC, and `JSON.parse` of the real command payloads, were not measured. Section 1 left those out too. The plan does not name its machine. The first scan matches this machine closely, so it may be the same one. Debug `serde_json` of the `#` hits is 92 ms against 2.3 ms release (40×). The plan's figure was about 84 ms against 1.8 ms. Extra headings are about 10% of lines, chosen so the `#` search lands near the plan. Fences are 3% of notes. Both are spelled out in `RUST_BENCH.md`.

## Decisions for Chris

Nothing here blocks the next step. Three choices are easy to change later:

1. Step 0.4 should use the serialize-only line (debug 92 ms, release 2.3 ms), which excludes the search.
2. `?synthetic=5000` on the dev page still spends about 8 s in `refreshLinks`. That cost is the mock.
3. The extra-heading share is one constant in `gen-vault.mjs` if a later bench wants fewer `#` hits.
