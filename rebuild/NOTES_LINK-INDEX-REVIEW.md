VERDICT: OK

Review of Grok b's link index on `rebuild/link-index-review-grok`. The branch was created from `rebuild/link-index-grok` (`90f5c94`, still there). `rebuild/integration` `918b75d` (B5 Group by and Summaries) merged cleanly as `c6fc2b4`. No conflicts. `links/internal.ts` and `mock/backend.ts` are unchanged by that merge and by this review. Nothing was pushed.

Grok b's fix (`f4ba467`, from `78d3bb3`) keeps one path-and-name index per notes array. `linkData` builds one notes array and one `linkResolver` for every link in that snapshot. The diff against `78d3bb3` remains 4 files, +93 / −8 (`internal.ts` +47/−4, `internal.test.ts` +22/−1, `backend.ts` +4/−3, `backend.test.ts` +20/−0).

## Resolution

The same target still finds the same file. The index keeps the old Map rule (lowercase path, later entry wins when two paths differ only by case) and the old name groups in appearance order. Partial paths still take the first hit in array order. A shared name still prefers the note beside the linking note, then the shallowest, and the depth sort copies the group first. Extensionless names, percent-encoding, and `Upper.MD` are covered by `internal.test.ts`. A non-note such as `pic.png` still resolves by its full name. `linkResolver` and `resolveLink` agree on the same snapshot, including after a push.

Aliases were never part of this map. `resolveLink` still does not read frontmatter aliases. Those stay in `linkSpellings` and in the Rust index. That is the same behaviour as before `f4ba467`.

A file named `.md` or `.MD` is not a note. `isNoteFile` requires a name longer than three characters that ends in `.md` in any case, matching Rust `is_note_path`. `linkData` still drops those paths (`isNoteFile(path) || !/\.md$/i`). The existing backend test already treats a nameless `.md` as an attachment for search, tags, and properties. The index does not special-case it.

## Freshness

Create, rename, and delete are seen on the next resolve. The mock builds a new notes array inside every `linkData` call, from the current files map. `vault.refreshFiles` replaces `vault.files` and `vault.notes`. The embed host drops its cached file list when `vault.files` changes identity. A push or pop on a reused array rebuilds the index because the length no longer matches; the new unit test pins the miss-then-push case. An in-place edit of `path` or `name` on an array whose length stays the same would stay cached until the array is replaced. No production caller does that. `fileOps` tests assign or push `vault.notes`; they do not rewrite an entry in place.

## Speed

Re-measured on this machine. The 5,000-note embed fixture was generated under `/tmp` and not committed. It is the embed browser test with 5,000 `EmbedBig` notes instead of 1,000, plus the sample vault and the host notes (5,013 notes). Cold is the first open of `Host.md` after `Elsewhere.md`.

| 5k embed open | B4 review (before) | Grok b (after) | This review |
|---|---|---|---|
| Cold | 463.5, 445.2, 447.0 ms | 41.9, 41.4, 40.4 ms | 39.9, 46.1, 40.5 ms |
| Warm | about 12–14 ms | 12.0–18.3 ms | 11.5–19.6 ms |

Cold median is 40.5 ms, against Grok b's 41.4 ms. The 46.1 ms sample is the high one and is still about a tenth of the old stall. Warm median of the nine samples is 16.4 ms, against Grok b's 17.1 ms. One warm sample was 19.6 ms. That is a couple of milliseconds past Grok b's after range and inside the warm samples Codex already recorded on the 5k table (up to 22.4 ms). It is not a return of the per-link map.

The suite's 1,000-note embed, which used to report cold around 84–92 ms:

| Run | Cold | Warm |
|---|---|---|
| Grok b | 22.2 ms | 6.8 / 6.4 / 6.4 ms |
| This review, before the new check | 22.3 ms | 7.3 / 6.5 / 6.6 ms |
| This review, after the new check | 22.8 ms | 7.1 / 6.7 / 6.9 ms |
| Full suite | 22.5 ms | 6.8 / 6.6 / 7.4 ms |

`node scripts/bench-frontend.mjs 5000` (`?synthetic=5000`, 5,007 notes, 5,017 files). `refreshLinks` was 52.5, 38.8, 36.7 ms (median 38.8), `639,766` bytes, 3,946 outgoing notes. Grok b recorded 55.4, 40.6, 36.3 ms (median 40.6) with the same bytes and count. Published `RUST_BENCH.md` was 7.8 s. Search was not part of the change and stayed in band: `garden` 25.0, 12.0, 13.0 ms (median 13.0; Grok b 25.5, 12.7, 12.3; published 22.7, 13.4, 12.7), 1,900 notes, total 2,950, `91,971` + `4,162` bytes. The 5,000-row page sort was 5.5, 5.4, 4.4 ms (median 5.4; published 4.5). Tags were 16.1, 10.9, 10.2 ms (median 10.9; published 19.4, 10.9, 10.0), 5,007 notes, 10,996 uses.

Rust search and backlinks, debug, `GROVE_BENCH_VAULT=/tmp/grove-bench-5000`, `cargo test --offline -- --ignored --nocapture bench_vault`. Rust was not edited. Payloads match Grok b and the published bench byte for byte.

| Figure | This review | Grok b | Published |
|---|---|---|---|
| `search_notes("meeting")` | median 82.9 ms (85.4, 82.9, 82.4), 292,520 bytes, total 131,948 | 85.0 ms | 84.3 ms |
| `garden river` | median 142.2 ms, 292,525 bytes, total 268,814 | 144.9 ms | 146.2 ms |
| `search_lines` | median 1.02 ms, 26,385 bytes, 50 notes, 250 lines | 1.03 ms | 1.05 ms |
| backlinks, one note | median 16.4 ms (15.7, 16.4, 16.7), 524 bytes | 15.8 ms | |
| backlinks, every note | median 65.1 ms, 1,589,340 bytes | 66.4 ms | |
| `link_index` | median 36.9 ms, 768,905 bytes | 38.5 ms | |

Vault counts: 5,000 notes, 5,125 files, 200,009 lines, 13,600,158 text bytes, 14,001 indexed links. Release was not rebuilt. `cargo build --offline` finished from the cache in 0.12 s. No regression.

## Open items

The embed script asserted only the warm open. That is fixed here in `610b0db` (`scripts/test-bases-embed.mjs`, +2 / −1). Cold and warm are separate checks, both at 100 ms. The warm cap is unchanged. The 1,000-note cold open was already under 100 ms before the index (about 85–92 ms in the B4 review), so this assertion does not by itself prove the 5,000-note stall is gone. The 5k rerun above is that proof. The 5k fixture stays under `/tmp`.

Hover preview (`shell/hoverPreview.ts`), canvas link resolution (`canvas/view.ts`), and the workspace's second lookup (`vault.files` filtered to non-directories, used when the note list misses) still allocate a new array per call, so each call builds one index. That is the cost of a single lookup. Grok b's microbench put one fresh array at about 1–3 ms, and 5,000 names on one array at about 4–8 ms after the fix against about 2.5 s before. Sharing those arrays would mean editing files this fix correctly left alone. No follow-up, and no owner.

The same-length in-place hole above is not a follow-up either. `refreshFiles` and `linkData` replace the array.

The two B4 findings Grok b left in `src/bases` and `editor/embeds.ts` (host path after a rename, and a failed nested read leaving a live base) are already fixed on `rebuild/b4-fix-grok` (`f80f3a8`, notes `8f39c76`). They are not in integration `918b75d` and they are not part of the link index. Whoever merges that branch owns them. This review did not edit `bases/view.ts` or `bases/model.ts`.

## Checks

No Obsidian page was fetched. The resolution rules are the ones already in `resolveLink`, pinned by `internal.test.ts`, `linkAt.test.ts`, `backend.test.ts`, and the parity corpus. No Obsidian code or assets were used. Decided path rules stand: a UTF-8 BOM before frontmatter is skipped, CRLF is unchanged, and uppercase `.MD` files count as notes.

Full checks, first run, no retry:

- `npm run build`: passed. The existing Vite large-chunk warning remains.
- `npm run audit:offline`: passed, 174 source files (B5 added `groups.ts` and `summaries.ts`; Grok b's branch reported 172), dist, CSP, capabilities, dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest 66 files / 1,102 tests. Geometry, browser, and posttest (config, cards, embed) passed, including the new cold check and the B5 grouped embed. 300-card drag max 16.7 ms. 1,000-row Bases scroll max 16.8 ms. Embed typing max 16.8 ms, 0 rebuilds during the burst and 1 after quiet, scroll max 16.8 ms, box 400 px and 30 rows. No assertion was weakened.
- `cargo build --offline` and `cargo test --offline` from `src-tauri`: 58 passed, 0 failed, 2 ignored. Registry not contacted.

`rebuild/link-index-grok` is still `90f5c94`. `rebuild/integration` is still `918b75d`.
