# NOTES_LINK-INDEX: one link index per file snapshot

Branch `rebuild/link-index-grok`, from `rebuild/integration` `78d3bb3`. The cold-open stall in Codex's second B4 review is fixed in the TypeScript resolver. Nothing was pushed.

## What changed

`resolveLink` built a new path `Map` of every note on every call. The mock's `linkData` walks every wikilink and markdown link in the vault and passes the same `notes` array each time, so a 5,000-note vault paid that map once per link. The sample vault's `Big note.md` is full of `[[Welcome]]`, which is why a vault of mostly empty generated notes still stalled.

One index is now kept per notes array (`WeakMap` in `links/internal.ts`). It holds the same path map as before (lowercase path to the original path, later entry wins when two paths differ only by case) and the same-name notes in the order they appear, keyed by `note.name`. A push or pop rebuilds it, because the length no longer matches. Replacing the array always builds a new one. `linkData` takes one `linkResolver` for that snapshot and uses it for every link.

Partial paths still scan in array order and keep the first hit. Nearest-folder and shallowest-name clashes use the same steps as before, including the copy before the depth sort. Alias spellings are unchanged: this map never consulted frontmatter aliases, and it still does not. Those stay in `linkSpellings` and in the Rust index.

Diff against `78d3bb3`: **4 files, +93 / −8**.

| File | Added | Removed |
|---|---|---|
| `app/src/links/internal.ts` | 47 | 4 |
| `app/src/links/internal.test.ts` | 22 | 1 |
| `app/src/mock/backend.ts` | 4 | 3 |
| `app/src/mock/backend.test.ts` | 20 | 0 |

The real TypeScript path calls the same `resolveLink`. Callers that reuse one array now share the index: the embed host's `files.out`, `vault.notes`, `rewriteLinks` (`before` / `after`), and `linkTargets`. Hover preview, canvas cards, and the workspace's second lookup (`vault.files.filter` of non-directories, used when the note list misses) still allocate a new array per call, so each of those calls builds one index. That is the old cost of a single lookup, not the per-link rebuild. Those files were left alone.

Rust already indexes once (`index.rs`). Moving the mock onto it would not fix the in-page stall the review measured, and it would be a larger change. No Rust files were edited.

No Obsidian page was fetched. The resolution rules are the ones already in `resolveLink` and pinned by `internal.test.ts`, `linkAt.test.ts`, and the parity corpus. No Obsidian code or assets were used.

## Benchmarks

Same machine as `RUST_BENCH.md`. The 5,000-note embed fixture was generated under `/tmp` and not committed. It is the embed browser test's fixture with 5,000 `EmbedBig` notes instead of 1,000, plus the sample vault and the host notes (5,013 notes). Cold is the first open of `Host.md` after `Elsewhere.md`, the same timer as `scripts/test-bases-embed.mjs`.

| 5k embed open | Before | After |
|---|---|---|
| Cold | 447.5, 445.1, 446.0 ms | 41.9, 41.4, 40.4 ms |
| Warm, three opens each round | 11.8–14.3 ms | 12.0–18.3 ms |

The review's cold samples were 463.5, 445.2, and 447.0 ms. With `api.backlinks` stubbed to `{}` that review saw 31.5 ms cold. The index lands about 10 ms above that stub. The unmodified suite's 1,000-note embed, which used to report cold around 84–92 ms, reported cold **22.2 ms** and warm **6.8 / 6.4 / 6.4 ms** in this run.

Link-resolution microbench, 5,003 notes, in-process `resolveLink` (not committed):

| | Before | After |
|---|---|---|
| One lookup, fresh array, five runs | 1.73, 0.95, 1.15, 0.60, 0.87 ms | 2.80, 1.83, 1.29, 1.59, 1.85 ms |
| 5,000 names, one array | 2562.68 ms, then 2579.99 ms | 8.51 ms, then 4.43 ms |
| 200 names, fresh array | 102.33 ms | 1.51 ms |

A single lookup still builds the index, so one fresh array is the same order of time as before. The stall was thousands of lookups on one snapshot.

Existing front-end bench, `node scripts/bench-frontend.mjs 5000` (`?synthetic=5000`, 5,007 notes, 5,017 files). Published `refreshLinks` in `RUST_BENCH.md` was **7.8 s** (`8.4, 7.8, 7.6`), `639,766` bytes, 3,946 notes with outgoing links. This run: **55.4, 40.6, 36.3 ms** (median 40.6), `639,766` bytes, 3,946 outgoing notes. Search was not part of the change. `garden` was 25.5, 12.7, 12.3 ms (published 22.7, 13.4, 12.7), 1,900 notes, total 2,950, `91,971` + `4,162` bytes. The 5,000-row page sort was 5.1, 4.5, 4.9 ms (published 4.5, 4.5, 4.2). Tags were 17.6, 11.0, 9.2 ms (published 19.4, 10.9, 10.0), 5,007 notes, 10,996 uses.

Rust search and backlinks, debug, `GROVE_BENCH_VAULT=/tmp/grove-bench-5000`, `cargo test --offline -- --ignored --nocapture bench_vault`. Rust was not edited. `search_notes("meeting")` median **85.0 ms** (`85.0, 94.0, 84.0`) against the published debug 84.3 ms, `292,520` bytes, total `131,948`. `garden river` median **144.9 ms** against 146.2, `292,525` bytes, total `268,814`. `search_lines` median **1.03 ms** against 1.05, `26,385` bytes, 50 notes, 250 lines. `backlinks` of one note median **15.8 ms** (`524` bytes); of every note median **66.4 ms** (`1,589,340` bytes). `link_index` median 38.5 ms. Release was not rebuilt: this worktree has no release profile yet, and no Rust source changed. The registry was not contacted (`--offline`; `cargo build --offline` finished from the cache in 0.10 s).

## Tests

`scripts/test-bases-embed.mjs` still only asserts the warm open. The check is `openMs <= 100`, and `openMs` is the max of the three warm opens. The message prints the cold time as well. A PASS there is not a cold-open guarantee. This run's full-suite line was cold 22.2 ms, warm max 6.8 ms, and it passed. The 5,000-note cold number above is from the separate `/tmp` fixture, not from that assertion.

Full checks, first run, no retry:

- `npm run build`: passed. The existing Vite large-chunk warning remains.
- `npm run audit:offline`: passed, 172 source files, dist, CSP, capabilities, dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest 64 files / 1,058 tests. Geometry, browser, and posttest (config, cards, embed) passed. Embed typing max 16.7 ms, 0 rebuilds during the burst and 1 after quiet, scroll max 16.8 ms, box 400 px and 30 rows. No assertion was weakened.
- `cargo build --offline` and `cargo test --offline` from `src-tauri`: 58 passed, 0 failed, 2 ignored. Registry not contacted.

Targeted `internal`, `linkAt`, `backend`, and parity tests passed before the full suite (358 tests), including the new clash, partial-path, case, and mock nearest-folder cases. The parity corpus was not edited.

## Left open

- The embed script's 100 ms check still asserts warm time only. The 5k cold open is about 41 ms, and the 1k cold open in the suite was 22.2 ms, so a cold bound can be added later without raising the warm cap.
- Hover preview, canvas, and the workspace's non-note fallback still build one index per call, because each call copies the file list. Sharing those would mean editing files this task left alone.
- An in-place change to a note's `path` or `name` on an array whose length stays the same is not seen until the array is replaced. `vault.refreshFiles` replaces `vault.notes`. The known push rebuilds because the length changes.
- The two remaining B4 review findings (host path after rename, and a failed nested-note reread leaving a live base) are in `src/bases` and `editor/embeds.ts`. They were not touched.
