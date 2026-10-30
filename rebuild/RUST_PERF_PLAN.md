# Grove at 50,000 notes: a plan for feeling instant

Written 2026-10-29 on `rebuild/perf-plan-claude` (fast-forwarded to `rebuild/integration` `4fddf48`). Plan only: no app code changed. Two measuring scripts were added (`scripts/bench-feel.mjs`, `scripts/bench-feel-browser.mjs`); they are not part of `npm test`.

Chris's goals: "The more stuff we can build in rust and get performance to blow obsidian out of the water the better." Then: "The app just has to feel seamless and fast so nobody is distracted by performance." This plan is framed around the second goal. It counts **visible hitches** (dropped frames, main-thread blocks over 50 ms, waits a user notices) and treats each one as a bug. Rust is used wherever it removes one, not for its own sake.

## In plain words

- **At 5,000 notes Grove already feels smooth almost everywhere.** In headless Chromium, typing, the quick switcher, switching notes and expanding a folder stay inside a frame, with no long tasks. The exceptions are the graph (18% of frames late) and renames.
- **At 20,000 and 50,000 notes it doesn't.** Ten things grow with the vault and block the page or the window's main thread. The worst, in the order a user would hit them:
  1. **Moving a folder hangs the app.** Measured with the real `rewriteLinks`: moving a 50-note folder costs about 11 s at 5k notes, a 200-note folder about 13 minutes at 20k, and a 500-note folder an estimated 4.5 hours at 50k. Renaming one note costs 170 ms at 50k. The cause is in TypeScript: every link lookup rebuilds a map of the whole vault (15 ms per lookup at 50k), and a folder move runs once per moved note. The same 15 ms lookup runs when hovering a link, drawing an embed, in the backlinks and outgoing views, and in Bases link cells.
  2. **Every save is followed by a hitch, about a second after you stop typing.** At 50k the save itself holds the window's main thread for 26 ms (the index rebuilds every name map). Then the page re-reads the whole link index (7.9 MB at 50k) and the whole tag list (4.8 MB). Then each open view rebuilds from scratch: the graph (112 ms at 50k), an open base (163 ms), the Tags view. Creating, deleting or renaming any file also re-sends the whole file list (7.7 MB) and rebuilds the whole file tree (90 ms of sorting alone at 50k).
  3. **Opening a 50k vault freezes the window for about 1.4 s.** `open_vault` still runs on the main thread, and the scan uses one CPU core. The index also takes **1.15 GB** of memory for 136 MB of notes, because every line is its own string.
  4. **The graph stutters**, already at 5k (18% of frames late). At 20k it runs at 19 fps with 62 long tasks in 4 s. At 50k one simulation step alone takes 92 ms.
  5. **Search falls behind typing at 50k**: 194 ms in Rust for a common word, then a 3 MB reply that the page parses and sorts in full.
  6. **Smaller ones**: expanding a 6,700-note folder is a 72 ms freeze (the tree isn't virtualised); backlinks for one note take 50 ms in Rust at 50k; a quick-switcher keystroke costs 11–20 ms of JS at 50k.
- **Where Rust helps:** opening (async, parallel scan, compact memory), the save path (incremental indexes and sending only what changed), search (parallel and cancellable), backlinks (a reverse index), Bases filtering (the pre-filter Chris asked for), and batched writes for renames.
- **Where Rust can't help, and what does:** the rename hang is fixed in TypeScript with a cached link resolver and a single rewrite pass. That's a small change, and it makes every hover and embed faster too. The graph needs a Web Worker and cheaper drawing; per-frame IPC to Rust would be slower. The file tree needs virtualising. The quick switcher needs a cached list. Those are all DOM or per-keystroke work, where an IPC round trip only adds delay.
- **Recommended order, by what users feel first:** P0 hitch tests → P1 renames and lookups → P2 quiet saves → P3 instant open → P4 smooth graph → P5 search → P6 file tree → P7 Bases in Rust (after Bases B5) → P8 switcher. P0, P1, P4 and P5 can start now, alongside Bases wave 1, without touching the same files (§7).

---

## 1. Budgets: the moments users notice

A budget is a promise about one moment, measured at the worst case, not the average. "Hitch" means any frame later than 20 ms during an animation or typing, or any main-thread block over 50 ms.

| Moment | Budget | How it is checked |
|---|---|---|
| **Keystroke to paint** while typing (any vault size, any panes open) | ≤ 16 ms, **0 frames over 20 ms** across 40 keystrokes, including the save and refresh that follow | Event Timing + rAF gaps (`bench-feel-browser.mjs`, then P0's test) |
| **Drag, scroll, zoom** (canvas, graph, file tree, Bases table, editor) | steady 60 fps: p95 frame ≤ 17 ms, max ≤ 33 ms, no long tasks | rAF gaps |
| **Note switch** (click in tree, link, back/forward) | ≤ 50 ms to the note painted; backlinks count ≤ 100 ms | `ws.open` → two frames |
| **Quick switcher** open and each keystroke | ≤ 50 ms to results; ≤ 16 ms of JS per keystroke | Event Timing |
| **Search as you type** | ≤ 100 ms from the last keystroke to the results painted; a stale query never delays a newer one | backend ms + page ms |
| **Background work**: link/tag refresh, file events, rename, indexing, watcher rescans | **no main-thread block over 50 ms**, in the page or in Rust's main thread | long tasks; Rust commands' time on the main thread |
| **Rename or move** | the app stays responsive throughout; a 500-note folder move at 50k finishes in ≤ 2 s | `bench-feel.mjs` + browser test |
| **Cold start** (app launch to the tree shown and typing possible) | ≤ 1 s at 50k; the window never stops painting | stopwatch in the app + Rust scan time |
| **Warm start** (vault in the disk cache) | ≤ 500 ms at 50k | same |
| **Memory** | ≤ 2.5× the vault's text, plus the webview | peak RSS of the index |

These numbers are what makes an app *feel* instant: one frame for direct input, about 50 ms for something a user asks for, and about 100 ms for results that update while typing. They're stricter than what Grove promises now (CONTRACT.md: every command under 50 ms at 1k notes, search under 150 ms).

## 2. How this was measured

**Vaults.** `scripts/gen-vault.mjs` (step 0.2) built three vaults under `/tmp`, each deterministic:

| Vault | Notes | Lines | Text | Links | sha256 |
|---|---:|---:|---:|---:|---|
| `/tmp/grove-bench-5000` | 5,000 | 200,009 | 13.6 MB | 14,000 | `5b03c1be…` (as in RUST_BENCH.md) |
| `/tmp/grove-bench-20000` | 20,000 | 799,993 | 54.5 MB | 56,000 | `1e7c07c8…` |
| `/tmp/grove-bench-50000` | 50,000 | 1,999,993 | 136.2 MB | 140,000 | `d5723282…` |

**Three tools, all headless:**

1. **Rust:** the existing `index::bench::bench_vault` (release, median of three runs after a warm-up scan, JSON serialization included), on each vault. Peak memory is the test process's `VmHWM`, polled from `/proc`. It includes the bench's own temporary JSON buffers (the largest is the 29.6 MB `search` reply), so the index alone is a little smaller. Per-save index cost (`upsert_note`, `rebuild_maps`, `list_files`) came from a temporary ignored test in `bench.rs`, which was **reverted, not committed**.
2. **Page TypeScript in Node:** new `scripts/bench-feel.mjs <vault>`. It loads the real modules through Vite (`paths`, `links/internal`, `switcherItems`, `graph/data`, `graph/sim`, `bases/model`, `editor/frontmatter`, `linksTags`) and runs them on the real vault's file list and text: one quick-switcher keystroke, one `resolveLink`, the tree's sort, building the graph and one simulation step, one Bases re-evaluation, a one-note rename and a folder move, and `JSON.parse` of the replies the page receives. Node's V8 is close to Chromium's, and WebKitGTK's JavaScriptCore is usually slower, so these are a floor.
3. **Felt behaviour in headless Chromium:** new `scripts/bench-feel-browser.mjs <n>`. It runs the real app on the mock's `?synthetic=n` vault (at most 20,000 notes) with real key and mouse input. It records Event Timing entries over 16 ms, long tasks over 50 ms and every rAF gap while typing 40 characters, typing in the quick switcher, expanding the biggest folder and opening the graph, and times six note switches. The mock builds its link index by resolving every link against every note, the same O(N) lookup as finding 1. At 20k that blocks the page for 4.6 minutes after load, and every backlinks call costs seconds. So once loaded, the script answers `linkIndex` and `backlinks` from the index already built, still paying `JSON.parse` of the full reply. That's a stand-in for IPC.

`bench-feel.mjs` was run twice per vault. Most figures agree within about 10%, and a few vary up to ~30% (at 50k: `resolveLink` 15.0 then 10.5 ms, Bases 163 then 150 ms). The tables show the first run.

Run again (from `rebuild/app`; vaults first with `node scripts/gen-vault.mjs /tmp/grove-bench-N N`):

```text
node scripts/bench-feel.mjs /tmp/grove-bench-50000
flock /tmp/grove-npm-test.lock node scripts/bench-feel-browser.mjs 20000
cd src-tauri && GROVE_BENCH_VAULT=/tmp/grove-bench-50000 flock /tmp/grove-npm-test.lock cargo test --release -- --ignored --nocapture bench_vault
```

**Not measured here:** WebKitGTK itself (no app windows allowed), IPC transfer time inside Tauri, a cold disk, and Obsidian. Where those matter, the figures below say "estimate".

## 3. Inventory: what grows with the vault, measured

### 3.1 Rust commands (release, ms, and bytes sent)

| Work | 5k | 20k | 50k | When it runs | Thread |
|---|---:|---:|---:|---|---|
| `Index::scan` (open, rescan), first run | 142 | 564 | **1,416** | `open_vault`, watcher rescan | **main** for `open_vault` (it is a plain `fn`); a worker for rescans |
| `Index::scan`, warm median | 115 | 462 | 1,145 | | |
| Peak memory (bench process) | 124 MB | 463 MB | **1.15 GB** | always | – |
| `upsert_note` per save (whole `rebuild_maps` each time) | 1.2 | 6.1 | **25.9** | every autosave (~300 ms after typing stops) | **main** (`write_note` is a plain `fn`), holding the lock |
| `list_files` + serialize | 1.0 / 0.77 MB | 3.4 / 3.1 MB | 14.6 / 7.7 MB | every create, delete, rename, outside change | worker |
| `link_index` + serialize | 4.0 / 0.77 MB | 25.7 / 3.1 MB | **74 / 7.9 MB** | 1 s after every save, and every outside change | worker, holding the lock |
| `tags()` + serialize | 2.8 / 0.48 MB | 12.3 / 1.9 MB | 33 / 4.8 MB | after every `links`/`files` change, if the Tags view, tag search, graph tags or a Base needs tags | worker |
| `properties()` (all) + serialize | 1.4 / 0.59 MB | 11.8 / 2.4 MB | 34 / 5.9 MB | first Bases/All properties use, then only changed notes | worker |
| `backlinks([one note])` | 2.0 | 15.5 | **50** | every note switch (status bar count, Backlinks pane) and after each save's link refresh | worker, holding the lock |
| `search_notes("meeting")` (all notes match) | 19.4 / 0.29 MB | 77 / 1.2 MB | **194 / 3.0 MB** | each search-view keystroke (coalesced) | worker |
| `search_notes("alpha")` (half match) | 9.6 | – | 93 / 1.4 MB | | |
| `search_match` (graph filter, 3 queries) | 12.0 | 56.8 | 146 / 2.2 MB | graph rebuild with a filter or colour groups | worker |

"Holding the lock" matters: `AppState.inner` is one `Mutex`. While `link_index` or `backlinks` runs for 50–74 ms at 50k, a `read_note` for the note being opened waits behind it. Async commands keep the main thread free, but they still queue on each other.

### 3.2 Page TypeScript (Node, ms, median)

| Work | 5k | 20k | 50k | When it runs |
|---|---:|---:|---:|---|
| `resolveLink` once (rebuilds a name/path map of every note per call) | 1.2 | 3.4 | **15.0** | `ws.resolve`: hover preview, following a link, each embed drawn, the backlinks view (once per linking note), the outgoing view (per target), Bases link cells, canvas cards |
| `ws.resolve` of a missing note (two maps, plus `files.filter`) | 1.4 | 6.5 | **22.3** | same, for unresolved links |
| Rename one note (4 linking notes) | 10 | 33 | **169** | rename |
| Move a folder (`Folder 00/Sub 0`) | 50 notes, 121 sources: **11 s** (est.) | 200 notes, 509 sources: **13 min** (est.) | 500 notes, 1,313 sources: **4.5 h** (est.) | move or rename a folder. Measured per linking note on 3 of them, times the count |
| `JSON.parse` of `list_files` | 1.4 | 4.7 | 16.0 | every create/delete/rename |
| `JSON.parse` of `link_index` (outgoing) | 0.9 | 4.0 | 13.6 | 1 s after every save |
| Derive `vault.notes` from the file list | 1.0 | 2.4 | 9.2 | every file-list refresh |
| `linkTargets` build (link styling) | 3.9 | 13.2 | 39.9 | first styled link after each file-list change |
| File tree sort (`buildTree`'s two sorts, `Intl.Collator`) | 8.2 | 32.9 | **89.9** | every `files` change, before any DOM |
| Search view: parse + filter + sort an all-notes reply | 6.4 | 30.9 | **92.2** | each search-view result |
| Quick switcher keystroke (`r`, `ri`, `riv`, `river s`) | 1.0–2.0 | 3.5–7.5 | **10.5–20.0** | each keystroke |
| Graph: `buildGraph` | 7.9 | 41.6 | **112** | opening the graph, and every `links`/`files` change while it is open |
| Graph: one simulation step at full heat | 6.2 | 30.9 | **91.8** | **every frame** for about 5 s after opening or any change |
| Bases: re-evaluate a `file.hasTag` table sorted by name | 12.6 (3,000 rows) | 58.4 (12,000) | **163** (30,000) | 20 ms after every `files`/`doc`/`links` change while a base is open |

### 3.3 Felt, in headless Chromium (mock vault, real input)

| Moment | 5k | 20k | Budget |
|---|---|---|---|
| Typing 40 characters | 0 frames over 20 ms, no long tasks, no event over 16 ms | same | met |
| Quick switcher, 7 keystrokes | 0 frames over 20 ms, no long tasks | same | met |
| Note switch (to painted) | 32 ms (two frames) | 25–32 ms | met |
| Expand the biggest folder | 1,674 rows: one 24 ms event, no long task | 6,674 rows: **one 72 ms long task**, 88 ms event | **missed at 20k** |
| Graph, first 4 s | 37 of 206 frames over 20 ms, max 33 ms, a 64 ms event on open | **19 fps**: 60 of 76 frames over 20 ms, **62 long tasks**, max 97 ms, a 160 ms event on open | **missed at 5k** |

The mock's typing test can't show the Rust side of a save. In the app, each autosave runs `write_note` on the main thread (§3.1), and a second later the link refresh lands: at 50k, 7.9 MB through IPC plus 13.6 ms to parse, plus the rebuild of each open view (graph 112 ms, a base 163 ms). **That is the hitch a 50k user would feel while writing: about a second after every pause, if the graph, a base or the Tags view is open.** It's an estimate built from the measured parts, because the mock can't reproduce it.

## 4. Each item: Rust or not, gain, cost and risks

"Felt gain" is the change in the moment users notice. Sizes: S < 150 lines, M 150–500, L > 500.

### 4.1 Link lookups and renames (finding 1) — TypeScript, not Rust

- **Cause.** `resolveLink(target, from, notes)` builds `new Map(notes…)` on every call. A rename calls it for every link on every linking line. A folder move calls `rewriteLinks` once per moved note for every linking note: `pairs × sources × links`, each lookup O(N).
- **Fix (TS):** `linkResolver(notes)` builds the name, alias and path maps once and is cached per notes array, the same way `linkTargets` already is. `resolveLink` keeps its exact rules and becomes a thin call into it. `updateLinks` passes every moved pair to **one** rewrite pass per linking note (a map from old path to new path) instead of one pass per pair. `ws.resolve`, `editorHost.resolve`, hover preview, canvas and the mock use the cached resolver.
- **Rust's part:** a `write_notes([{path, content}])` command, so a move writes 1,313 notes in one call with one index update (needs P2's incremental maps). The rewriting itself stays in TS: it must see unsaved buffers and keep open editors in sync (RUST_MIGRATION_PLAN §5). Moving it would add a second link grammar and risk to user files for no felt gain, once the lookups are cheap.
- **Felt gain:** folder move from 11 s / 13 min / hours to well under a second of JS (estimate: about 1,313 single-pass rewrites at under 50 µs each, plus reading and writing those notes). Each hover, embed, backlinks row and Bases link cell goes from 15 ms to microseconds at 50k. **It also makes the mock fast**, so P0's tests can run at 50k.
- **Risks:** the cached resolver must be invalidated on every file-list or alias change (aliases come from properties). The parity corpus (`links.json`) and `internal.test.ts` must pass unchanged. A folder-move test with 50+ notes should compare against today's output on a small vault before and after.
- **Cost:** M (~200 TS).

### 4.2 The save path and file events (finding 2) — Rust plus TS

- **Cause.** `upsert_note` rebuilds every name map per save, on the main thread. One second later, `link_index` re-sends everything (Step 2b of the migration plan was deferred "until the bench shows the refresh above 10 ms": at 20k it is 25.7 ms, at 50k 74 ms). `tags()` re-sends everything. File events re-send `list_files` in full. On the page, each `links`/`files` event makes the graph, Bases, the Tags view, the tree and `linkTargets` rebuild from scratch.
- **Fix (Rust):**
  - incremental name/alias/path maps in `upsert_note`/`relocate`/`remove_tree` (only the changed path);
  - a **version number** on the index, with one `changes_since(version)` command returning only the changed notes' `outgoing`, `markdown`, `unresolved`, tags and file entries, plus removed paths (falling back to a full reply if the page is too far behind);
  - the `vault-changed` payload carries the changed `FileEntry`s, so the page needs no `list_files`;
  - `Mutex` → `RwLock`, so reads stop queueing behind each other;
  - a reverse link index kept up to date by the same code (see 4.6).
- **Fix (TS):** `Vault` applies the deltas to `files`, `notes` and `links` in place and emits which paths changed. Consumers update only those paths: the tree inserts or removes rows (P6), the Tags view adjusts counts, the graph adds or removes nodes and links without a rebuild, and Bases re-evaluates changed rows only (after Bases wave 3; B0 already limits how often it runs).
- **Felt gain:** at 50k, each save goes from 26 ms on the main thread plus a 7.9 MB refresh and 100–300 ms of view rebuilds, to well under 1 ms in Rust and a few KB to the page. File create, delete and rename go from 7.7 MB plus a 90 ms tree sort to an in-place update. **This is what keeps typing hitch-free at 20k+.**
- **Risks:**
  - ordering: a delta must never be applied twice or out of order (the version number makes it checkable);
  - the open-editor overlay (unsaved tags and links) keeps working as today, because the page still overlays loaded notes;
  - `relocate`'s rename trap (RUST_MIGRATION_PLAN Step 2) must stay covered;
  - IPC payloads shrink.
  - Every consumer needs a test that a delta equals a full re-read (shadow mode for one release: apply the delta, then compare it with a full read in tests).
- **Cost:** L (~350 Rust, ~300 TS).

### 4.3 Open and memory (finding 3) — Rust

- **Cause.** `open_vault`/`create_vault` are plain `fn`s, so the scan runs on the GTK main thread, single-threaded. `Note.lines: Vec<Line>` keeps one heap `String` per line (2M lines at 50k) beside its parsed links, tags and properties.
- **Fix (Rust, std only, no crates):**
  - `open_vault` becomes `async`;
  - the scan walks the tree first, then reads and parses files on `std::thread::scope` workers (one per core, chunked by folder) and merges into the `BTreeMap`;
  - each note keeps its text as **one `String` plus `u32` line offsets**; search and backlinks read slices;
  - optional and progressive: return the file list as soon as the walk finishes, and emit `index-ready` when parsing is done. Search, backlinks and tags wait on it, and the tree and editor are usable right away.
- **Felt gain (estimate):**
  - a 50k cold open from a 1.4 s frozen window to about 0.2–0.3 s (12 cores, warm disk), and the window keeps painting;
  - memory from 1.15 GB to about 0.3–0.4 GB at 50k (text 136 MB plus offsets plus parsed data);
  - rescans after a burst of outside changes get faster too.
  - On a cold disk, reading 136 MB dominates, and only progressive loading helps.
- **Risks:**
  - thread-merge order must not change results (the `BTreeMap` sorts; duplicate names resolve with `pick` as today);
  - the parity corpus and every `index/tests.rs` test must pass unchanged;
  - `MAX_INDEX_BYTES` and the BOM/CRLF rules stay where they are.
  - A persistent on-disk cache was considered and **not** recommended: the index needs the text anyway (search), so a cache would hold about the same bytes as the notes, plus an invalidation problem.
- **Cost:** L (~400 Rust).

### 4.4 Graph (finding 4) — a Web Worker, not Rust

- **Cause.** One Barnes-Hut step per frame on the page thread (92 ms at 50k, 31 at 20k, 6 at 5k), then Canvas 2D draws every link. `buildGraph` (112 ms at 50k) runs again on every `links`/`files` change.
- **Fix (TS):**
  - run `Simulation` in a module Worker (it's already DOM-free) and post positions back as a transferred `Float64Array` once per frame, so the page only draws;
  - the page draws at 60 fps from the latest positions, whatever the simulation's rate;
  - level of detail when zoomed out: skip arrows and labels, draw links in one path, and cull nodes off screen;
  - with P2's deltas, an update patches the graph instead of rebuilding it.
- **Why not Rust:** positions change every frame. At 50k nodes that's 800 KB per frame through IPC, and an IPC round trip per frame in WebKitGTK would add latency, not remove it. A Rust layout thread would only help a precomputed "open already settled" layout. That's an optional later step (P4b) if 50k still settles too slowly in the Worker: measure first.
- **Felt gain:** pan, zoom, drag and hover at 60 fps at any size while the layout settles in the background. At 50k the layout itself still takes about 92 ms per step, so it settles in about 30 s instead of 5 s, but nothing stutters.
- **Risks:**
  - the existing graph tests read positions synchronously, so they need a hook;
  - the Worker must load from the bundle with no network (Vite worker import, checked by `audit:offline` and the CSP `worker-src`);
  - WebKitGTK supports module Workers, but this needs checking in the app build.
- **Cost:** M (~300 TS).

### 4.5 Search as you type (finding 5) — Rust plus a little TS

- **Cause.** `search_notes` scans every line on one thread (194 ms at 50k for a word in every note). The page then parses the 3 MB reply and sorts every result with `Intl.Collator` (92 ms at 50k). `searchReader` already coalesces, but a stale scan still runs to the end before the newest starts.
- **Fix (Rust):** evaluate notes in parallel chunks (`std::thread::scope`). Add a cancel flag: each new `search_notes` bumps an `AtomicU64` generation, and older scans stop at the next note boundary and return `cancelled`.
- **Fix (TS):** a per-file-list sort rank (`Map<path, number>` built once with `compareFiles`), so the result sort compares integers. Render the first 50 notes at once and the rest lazily (already the case for lines via `search_lines`).
- **Felt gain (estimate):** 194 ms → about 25–35 ms in Rust at 50k (12 cores), and page work from 92 ms to a few ms. A burst of keystrokes costs one scan, not two.
- **Risks:**
  - result order must equal today's (the ranks come from the same comparator);
  - parallel counts must equal serial counts (the `search.json` corpus covers it);
  - the D2 payload stays the same shape.
- **Cost:** S–M (~120 Rust, ~40 TS).

### 4.6 Backlinks — Rust

- **Cause.** `backlinks([path])` walks every note's links (50 ms at 50k) on every note switch and after each save's refresh, holding the lock.
- **Fix (Rust):** a reverse index (target → set of linking notes) maintained in `upsert`/`relocate`/`remove_tree`, which also speeds up `link_sources` for renames. It comes with P2, which touches the same code.
- **Felt gain:** the backlinks count and pane are ready within a frame of a note switch, and `read_note` never waits behind them.
- **Risks:** stays exact under relocations (the existing `index/tests.rs` relocate cases plus new ones). **Cost:** S (~100 Rust).

### 4.7 File tree — TypeScript

- **Cause.** Each `files` change sorts the whole vault twice (90 ms at 50k) and rebuilds every visible row. An expanded folder renders every row (6,674 rows = a 72 ms long task).
- **Fix (TS):**
  - keep the sorted tree between changes and apply P2's file deltas by inserting or removing rows;
  - virtualise the visible row list (a flat array of open rows, with only the rows on screen in the DOM, at a fixed row height, as the Bases table does above 200 rows);
  - collation keys computed once per name.
- **Why not Rust:** sorting with `Intl.Collator` (numeric, base sensitivity) would need ICU or a hand-written copy in Rust, which risks a different order. Most of the cost is DOM, which Rust can't touch.
- **Felt gain:** expanding any folder, and any file event, stays inside a frame at 50k.
- **Risks:**
  - drag and drop, keyboard navigation, multi-select, inline rename and auto-reveal all assume rows exist;
  - the geometry, real-mouse and explorer-drag tests must stay green;
  - no open animation, as today.
- **Cost:** M–L (~400 TS).

### 4.8 Bases filtering — Rust (Chris's decision)

- **Change.** BASES_PLAN D5 becomes "plan the Rust pre-filter B7 as a real task, after B5", no longer "only if measured". The measurements support it: re-evaluation takes 58 ms at 20k and 163 ms at 50k, against the 30 ms budget.
- **Fix (Rust):** `base_candidates(filters)` evaluates the index-friendly leaves (`file.inFolder`, `file.hasTag`, a property's existence, a literal equality, `file.ext`), plus `and`/`or`/`not` over them, against the Rust index (with P2, from incremental per-property and per-tag postings). It returns candidate paths, and TS evaluates the full expression only on those. Unsaved open notes are added to the candidates by the page, so their edits still show (BASES_PLAN §5).
- **Felt gain (estimate):** a base over one folder or tag at 50k evaluates the candidates only, from 163 ms to tens of ms. With P2's deltas, a save re-evaluates only the changed rows.
- **Risks:**
  - leaves must agree exactly with the TS evaluator (`fixtures/parity/bases-leaves.json`, and Grok's fuzz from B3 extended to compare candidate sets);
  - a leaf Rust can't decide must widen to "all rows", never narrow.
- **Cost:** M (~300 Rust, ~60 TS).

### 4.9 Quick switcher — TypeScript

- **Cause.** Each keystroke rebuilds the candidate list (a `Set` of every note plus a filter of every file) and fuzzy-ranks every name: 11–20 ms at 50k.
- **Fix (TS):** cache the candidate list per file list. When the query extends the previous one, rank only the previous matches. Precompute each lower-cased name.
- **Why not Rust:** a keystroke IPC round trip would cost more than the work. **Felt gain:** under 3 ms per keystroke at 50k (estimate). **Risks:** result order unchanged (`switcherItems.test.ts`). **Cost:** S (~60 TS).

### 4.10 What doesn't grow with the vault (no work planned)

- **Editor, Live Preview, Reading view, outline:** CodeMirror decorates only the visible ranges (`livePreview.ts:517`), and the outline works on one note. They scale with the note's length, not the vault's. The permanent geometry and frame tests already guard them. A very long note (10k+ lines) is a separate question for later. Rust can't help: this is synchronous work on the live document.
- **Canvas:** one file at a time. Part 1 of the canvas-lag work removed the per-drag stylesheet writes, and the 300-card tests pass.
- **Properties block, menus, settings, tabs:** per note or per window.
- **Unlinked mentions:** one `search(title, 500)` per open note, capped. It's fine, and it gets faster with P3's compact text.
- **Tags view rendering:** proportional to distinct tags, not notes. Its 4.8 MB re-read is fixed by P2.

## 5. Beating Obsidian: targets

**What this relies on.** There was no network in this session, so no page was fetched and **no Obsidian number below is from a source**. Obsidian doesn't publish performance figures in its help pages, as far as I know. What is public, and used here only as context: Obsidian is an Electron app (Chromium plus Node) that keeps a metadata cache of the vault, which it builds when a vault is first opened. Every Obsidian figure below is an **estimate, clearly labelled**, from general knowledge of Electron apps. **Chris, or Grok by observation on these `/tmp` vaults with Obsidian 1.14.4, should replace them with stopwatch measurements before the targets are used.** Never use a real vault for that.

| Moment, 50k notes | Obsidian (estimate, unverified) | Grove today | Grove target |
|---|---|---|---|
| Cold open, first time (no cache) | tens of seconds while the metadata cache indexes (estimate) | ~1.4 s frozen scan, plus page load | **≤ 1 s, never frozen** (P3) |
| Warm open (cache present) | several seconds, Electron start included (estimate) | ~1.1 s scan on the main thread, plus page load | **≤ 500 ms** (P3) |
| Quick switcher keystroke | feels instant (estimate: under 50 ms) | 11–20 ms JS | **≤ 5 ms JS, ≤ 1 frame** (P8) |
| Search, common word | hundreds of ms (estimate) | 194 ms + 3 MB + page sort | **≤ 100 ms to painted** (P5) |
| Graph, open and interact | WebGL drawing (believed, unverified); slows at this size (estimate) | 10 fps, long tasks | **60 fps interaction**, layout settling in the background (P4) |
| Rename a 500-note folder | seconds (estimate) | hours (estimate from measured parts) | **≤ 2 s, responsive throughout** (P1) |
| Memory, idle with vault open | several hundred MB to over 1 GB (estimate; Electron plus cache) | 1.15 GB index peak, plus the webview | **≤ 400 MB index** (P3), plus the webview |

Grove's structural advantages: the index is native, the reads run off the main thread, there's no Node runtime, and WebKitGTK uses a system webview, so there's no bundled Chromium. Its disadvantage: WebKitGTK's JavaScript is generally slower than Chromium's V8 (estimate), which is why the plan moves bulk work out of JS and shrinks what crosses IPC.

## 6. Risks that apply to every task

- **Unsaved-editor state.** Anything Rust computes sees only saved text. Every consumer keeps today's page-side overlay for loaded notes (tags, properties, links), and searches flush first (as `searchReader` does). No task may drop that.
- **IPC payloads.** Every new command or event names its bytes at 50k in the task's notes, with a budget: ≤ 100 KB for anything that runs on a save or a keystroke.
- **Parity.** Each Rust rule keeps its corpus (`fixtures/parity/*.json`) green in vitest and `cargo test`. Delta paths ship with a test that a delta equals a full read.
- **Concurrency.** `RwLock`, parallel scans and cancellation need tests that inject work mid-scan (as step 0.1 did for rescans).
- **WebKitGTK differences.** Headless Chromium is the test bed, but WebKit has no Long Tasks API, its JS is slower, and it handles IPC differently. P0 adds an in-app hitch meter (rAF gaps only), so Chris can check the real app.

## 7. Ranked build list

Ranked by what a user would feel first: how often the moment happens times how bad the hitch is, across vault sizes. Sizes as in BASES_PLAN §8: big (Claude or Codex, ~500+ lines), medium (Gemini, 150–400), small (Grok, < 150, plus review and fuzz). Each task owns its files, and no two tasks running at once own the same file.

| Rank | Task | Who | Needs | Owns | Size | Felt gain |
|---|---|---|---|---|---|---|
| **P0** | **Hitch tests.** A permanent `test-feel.mjs` in `npm test` with §1's budgets (typing, switcher, note switch, folder expand, graph frames, long tasks), at 5k now and 20k after P1 makes the mock fast. Plus an in-app hitch meter (dev setting: logs rAF gaps over 50 ms with the last command or event), for checking WebKitGTK by hand | Grok | – | new `scripts/test-feel.mjs` (from `bench-feel-browser.mjs`), `package.json` (one line), new `shell/hitchMeter.ts` + one line in `main.ts` | Small | Makes every hitch a failing test |
| **P1** | **Renames and lookups.** The cached `linkResolver`, a single-pass multi-pair `rewriteLinks`, callers moved to the cache, and the mock using it | Claude | – | `links/internal.ts`, `links/update.ts`, `workspace.ts` (`resolve`/`linkTo` only), `editorHost.ts` (`resolve`), `shell/hoverPreview.ts`, `canvas/view.ts` (one line), `mock/backend.ts` (link index), their tests | Big | Folder move: hours → under a second; 15 ms per hover/embed/backlink → µs |
| **P2** | **Quiet saves.** Incremental maps, the index version + `changes_since`, file entries in `vault-changed`, `RwLock`, reverse link index (4.6), `write_notes` batch; `Vault` applies deltas; Tags view and graph consume them | Codex | P1 merged (shares `mock/backend.ts`) | `src-tauri/src/index.rs`, `index/backlinks.rs`, `index/link_sources.rs`, `vault.rs`, `watch.rs`, `lib.rs`, `model.rs`, `api.ts`, `vault.ts`, `shell/vaultTags.ts`, `shell/tagsView.ts`, `mock/backend.ts`, `CONTRACT.md` | Big | No hitch after saves or file events at 20k–50k |
| **P3** | **Instant open, light memory.** Async `open_vault`, parallel scan, one-string notes with line offsets, optional progressive `index-ready` | Codex (or a second Codex session after P2) | P2 merged (both own `index.rs`) | `index.rs` (scan), `index/parse.rs` (`Note` storage), `index/search.rs`, `index/query.rs` (slices), `lib.rs` (`open_vault`, `create_vault`), `vault.rs` (`open`) | Big | 50k open: 1.4 s frozen → ~0.3 s; 1.15 GB → ~0.4 GB |
| **P4** | **Smooth graph.** Simulation in a Worker, drawing from the latest positions, level of detail | Gemini | – | `graph/sim.ts`, new `graph/simWorker.ts`, `graph/view.ts`, `graph/draw.ts`, graph tests | Medium | 60 fps graph at every size |
| **P5** | **Search keeps up.** Parallel `search_notes`/`search_match`, cancel by generation, page sort ranks | Grok | – | `index/search.rs`, `index/query.rs` (evaluation loop only), `shell/searchRead.ts`, `shell/searchView.ts` (sort) | Small–Medium | 50k search: 194 ms → ~30 ms; no stale scans |
| **P6** | **File tree.** Virtualised rows, incremental updates from P2's deltas, cached collation keys | Claude | P2 merged (deltas); P1 done (same owner, sequential) | `shell/sidebar.ts` (explorer), `shell/treeDrag.ts`, `shell/treeSelect.ts`, `styles/` tree rules, explorer tests | Big | Folder expand and file events inside a frame at 50k |
| **P7** | **Bases pre-filter in Rust** (= BASES_PLAN B7, now a real task) | Codex | Bases B5 merged; P2 merged (postings) | new `index/bases.rs`, one command in `lib.rs`/`api.ts`, `fixtures/parity/bases-leaves.json`, `bases/view.ts` (candidate call only) | Medium | 50k base: 163 ms → tens of ms |
| **P8** | **Quick switcher cache** | Grok | – | `shell/quickSwitcher.ts`, `shell/switcherItems.ts`, `shell/fuzzy.ts` | Small | ≤ 5 ms per keystroke at 50k |
| P4b | (Optional, measure first) A Rust layout thread for an already-settled 50k graph | Codex | P4 + a re-measure | new `index/layout.rs`, one command | Medium | Settles in seconds at 50k |
| **Reviews** | Grok reviews P1, P4 and P6; Claude reviews P2, P3 and P7 (concurrency and ordering); Codex reviews P5. Grok fuzzes P2's deltas (random edit, rename and delete sequences: delta == full read) and P7's candidates (⊇ the TS filter's rows) | | | | | |

**Order, alongside the Bases waves (BASES_PLAN §8):**

```text
Bases wave 1: B0 (Grok) · B1 (Codex) · B2 (Gemini) · B3 (Grok)
  perf, same time: P0 (Grok) · P1 (Claude) · P4 (Gemini, after B2 or in a second session) · P5 (Grok)
Bases wave 2: B4 (Claude) · B5 (Codex)
  perf, same time: P2 (Codex, a second session, after P1) · P8 (Grok)
Bases wave 3: B6 (Gemini) · B7 = P7 (Codex, after B5 and P2)
  perf, same time: P3 (Codex, after P2) · P6 (Claude, after P2 and B4)
```

**Shared-file conflicts, checked against the Bases tasks:**
- **No perf task in waves 1–2 owns a `bases/*` file, `editor/embeds.ts` or `styles/bases*.css`.** P1 doesn't touch `editor/embeds.ts` (B4's): embeds resolve through `editorHost.ts`.
- `bases/view.ts` is touched only by P7 (one candidate call), after B6 lands. P2's delta consumption for Bases is left to P7, so nothing in P2 touches Bases.
- `mock/backend.ts` is owned by P1 then P2, in sequence. B-tasks don't touch it.
- `index.rs` and `lib.rs`: P2 → P3 → P7 in sequence. P5 owns `index/search.rs`/`query.rs` in wave 1, and P3 takes them after P5 merges.
- `api.ts`, `CONTRACT.md`: P2 adds the delta command, and P7 adds one line later.
- `main.ts`: P0 adds one line.
- Claude's load: P1 (wave 1) → B4 (wave 2) → P6 (wave 3), all sequential. Codex runs B1/B5/B7 for Bases and P2/P3 for perf, so it needs a second session in waves 2–3, or P3 slips to after wave 3. Chris can swap P3 to Claude after P6 if Codex is the bottleneck.

**Merge order:** P0 → P1 → P5 → P4 → P8 → P2 → P3 → P6 → P7, each merged with `--no-ff` into `rebuild/integration`, re-running `bench-feel.mjs` and the Rust bench at 50k after each, and the numbers recorded in RUST_BENCH.md.

## 8. Success criteria

- Every §1 budget is met in `test-feel.mjs` at 20k (the mock), with the Node and Rust figures at 50k (`bench-feel.mjs`, `bench_vault`) inside budget.
- No Rust command spends more than 5 ms on the main thread at 50k (code review: only short writes stay sync).
- Payloads on a save or keystroke are ≤ 100 KB at 50k.
- Every parity corpus is green in both languages, and every delta passes its shadow test and Grok's fuzz.
- `npm test` (geometry, real mouse, every round script, `posttest`), `cargo test`, `npm run build` and `npm run audit:offline` all pass after every merge.
- Chris checks the release app on a 50k `/tmp` vault with the hitch meter on: typing with the graph and a base open shows no gap over 50 ms.

## 9. Decisions for Chris

| # | Decision | Recommendation |
|---|---|---|
| E1 | Accept §1's budgets as the bar ("any visible hitch is a bug") and make P0's test permanent | Yes |
| E2 | Graph: a Worker first and Rust layout only if needed (P4 before P4b) | Yes. Per-frame IPC can't beat a Worker |
| E3 | Renames: keep the text rewrite in TS (cached resolver) rather than moving it to Rust | Yes. It's the cheapest fix and keeps unsaved buffers safe |
| E4 | No persistent on-disk index cache (§4.3) | Yes, for now. Revisit only if cold-disk opens miss 1 s |
| E5 | Who measures Obsidian on the `/tmp` vaults (§5), for real comparison numbers | Chris, with a stopwatch, or Grok by observation |
| E6 | Bases D5 → B7 as a real task after B5 (Chris's preference, folded in here and in BASES_PLAN.md) | Done in this branch |
