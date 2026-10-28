# Moving Grove's pure logic into Rust: plan

Written 2026-10-27 on `rebuild/n-claude-a` (planning only: no app code changed).

## In plain words

- **What is slow today is mostly not the work itself but where it runs and how much gets shipped.** Every Rust command Grove has (except "open in new window") runs on the app's main thread, the same thread that handles typing and mouse input. A big search or tag refresh freezes input for as long as it takes.
- **The tag list really is the worst spot.** After every save (and every change on disk), the Tags view, tag search, the graph's tags and Bases' `file.tags` re-read every tag in the vault. They do it by running five full-text searches and sending about **4.3 MB** of search results from Rust to the page, for a 5,000-note vault. Then the page re-works out the tags from those results.
- **A second, similar hot spot was missed before.** The link index (who links to whom) is re-sent in full one second after every save: **3.8 MB** for 5,000 notes, of which 80% is backlink text that only the open note needs.
- **The fix is small, careful steps, not a rewrite.** Step 0 moves the commands off the main thread and fixes slow debug builds, which is almost free. Step 1 lets Rust keep its own tag list, so one small answer replaces five huge ones. Step 2 stops re-sending all backlinks. After that, properties and then full search evaluation move to Rust.
- **Some things should stay in TypeScript.** The editor, menus, panes, the graph's animation, the quick switcher's fuzzy match, how link renames rewrite text, and anything that must see unsaved typing. Moving them would add delay or risk with nothing gained.
- **Keeping behaviour the same is the main risk.** We already have two copies of some rules (the browser mock and the Rust index), and they already differ in small ways. Step 0 adds one shared set of test cases that both the TypeScript and the Rust code must pass, so the two copies cannot drift apart unnoticed.
- **Recommended order:** 0 (groundwork, three to four tasks at once) → 1 tags, 2 backlinks and 3 properties side by side → 4 search, then 5 renames → stop and measure before doing anything with Bases.

---

## 1. Checking the assessment against the code

### Corrections

| Claim | What the code says |
|---|---|
| "~15–20% of TS (~4–5k lines) is movable pure logic" | Too high. There are 24,434 non-test TS lines in `rebuild/app/src`. The candidate modules come to **2,800 lines (~11%)**: search query, links/tags, vault tags, property index, search facts, `links/internal`, `links/update`, `fileOps`, `editor/frontmatter`, graph data, Bases yaml/expression/filters/write/model/results/columns/config, canvas document/model, mentions and unlinked. Much of that has to stay in TS anyway (see §5). Only **~600–900 lines** are worth moving: tag reading, search evaluation, the search-facts plumbing and property typing. |
| "tags.ts does 5 api.search calls with up to 100k hits each" | Confirmed, in `src/shell/vaultTags.ts:27-33`: `"#"`, ```` "```" ````, `"~~~"`, `"tags:"` and `"tag:"`, `LIMIT = 100_000`. A sixth call follows: `api.frontmatter(paths)` for the notes that have a `tags:` key. |
| "after every vault change" | Close. The cache is dropped on the workspace's `"files"` or `"links"` change. `"links"` fires 1 s after **every save of our own** (`Vault.written` → `refreshLinks`) and after every `vault-changed`. The re-read happens only when something asks: the Tags view if it is shown (`tagsView.ts:100`), a search or graph using `tag:` or showing tags, or a Base that uses `file.tags`/`hasTag`. With the Tags view open, that means once per save. |
| "JSON over IPC, on UI thread" | Confirmed on both sides. Rust runs it on the **main (GTK) thread** (below). The page parses it and runs `tagsByNote` on the page's JS thread. |
| Ranking (1) tags (2) search (3) rename (4) frontmatter (5) Bases/canvas | Mostly right, with three changes. **Add the link index re-send** as a new number 2. **Move frontmatter/properties up**, because full search evaluation needs it first. **Drop canvas** entirely (59 lines, one file at a time, nothing to gain). Rename stays low: it is rare, and the risky part (rewriting text) should not move at all. Only the "which notes might link here" lookup should move. |
| "`src/mock/backend.ts` re-implements the Rust index" | Confirmed (346 lines: search, link index with its own `WIKILINK`/`MDLINK` regexes, frontmatter). Every browser test (`scripts/*.mjs`, run by `npm test`) goes through it. Any new command must be added there too. |
| "unverified whether sync commands run on the main thread" | **Now verified: they do.** See below. |

### Main thread: verified

- `tauri-macros-2.7.3/src/lib.rs:48-58` (the docs for `#[tauri::command(async)]`) says the option "Runs the command on the async runtime instead of blocking the main thread … only needed for synchronous functions that should not run on the main thread".
- In `command/wrapper.rs`, a plain `fn` command uses `ExecutionContext::Blocking` (`body_blocking`). It calls the function inline inside `webview.on_message`. That is reached from the `ipc://` custom-protocol handler (`tauri-2.12.4/src/ipc/protocol.rs:75`). On Linux, WebKitGTK calls that handler on the GTK main loop.
- In `src-tauri/src/lib.rs`, every command except `open_note_window` (which is `async fn`) is a plain `fn`. That means `search`, `link_index`, `frontmatter`, `list_files`, `read_note`, `write_note` and all the others **run on the main thread**, including the `serde_json` serialization of their results.
- Made worse by the lock: `watch.rs:99-118` (`flush`) holds `AppState.inner` for the whole `vault.rescan()`, which re-reads every note from disk. Any command that arrives during a rescan blocks the main thread on the mutex until the rescan ends: about 125 ms release and 540 ms debug for 5k notes on a warm cache, longer on a cold disk.

### Measured: the hot spots

How it was measured: the real `index.rs`, `index/parse.rs`, `fsutil.rs` and `model.rs` were copied unchanged into a throwaway crate in the session scratchpad (not in the repo). A deterministic 5,000-note vault was generated (25 folders × 4 subfolders, 20–60 lines per note; 60% with a `tags:` list; about 8% of lines with inline `#tags`; about 7% with wikilinks; about 3% fenced code blocks; 13.6 MB of text). The TS side ran under vitest/Node, using the real `linksTags.ts` and `editor/frontmatter.ts`. WebKitGTK's own IPC transfer and JSON.parse were **not** measured (they need the running app). Expect them to add to the JS numbers, not take away.

| Work (5k notes) | Rust release | Rust debug (`tauri dev`) | Data sent | Page JS (Node) |
|---|---|---|---|---|
| `Index::scan` (open / rescan) | 124 ms | 538 ms | – | – |
| **vaultTags: 5 searches + serialize** | **80 ms** | **335 ms** | **4.34 MB** (56k hits; `"#"` alone is 41k hits / 3.4 MB, mostly headings) | JSON.parse 10 ms + `tagsByNote` 42 ms |
| What a Rust `tags()` would send (estimate) | – | – | **~0.56 MB** | ~5 ms parse |
| **`link_index` + serialize** (every save, +1 s) | **18 ms** | **145 ms** | **3.85 MB** (backlinks 3.09 MB, outgoing 0.97 MB) | JSON.parse 9 ms |
| `frontmatter(None)` + serialize | 2 ms | 18 ms | 0.38 MB | `readProperties` for all 3,015 blocks: 17 ms |
| One search-view term, `limit = files*4` (≈20.5k) | 17–36 ms | 98–124 ms | 1.9–2.9 MB | (not measured) |

What this means:

1. **Debug builds are 40–50× slower at serializing** (84 ms vs 1.8 ms for the `"#"` hits), because `serde_json` is compiled without optimization. If Chris runs `tauri dev` day to day, most of what he feels is this. Turning on optimization for dependencies in dev builds (step 0.4) is a one-line fix.
2. **Search while typing** sends up to 2.9 MB for each new prefix typed (`searchFacts.ts` caches by term, so "meeting" asks for "m", "me", "mee", …). Each request ties up the main thread for 20–120 ms.
3. **Tags truncate silently on big vaults**: once the vault has more than 100k lines containing `#` (headings count), `search("#", 100000)` cuts off and some tags vanish from the Tags view. A Rust tag index fixes that too.
4. Properties are not a speed problem (17 ms once, then only changed notes are re-read). Moving them is only worth it as groundwork for search and Bases.

### Rules that already differ (parity debt found while reading)

The shared test cases in step 0.3 must decide each of these. Today TS (`linksTags.ts`) and Rust (`index/parse.rs`) handle them differently:

- **Opening a fence**: Rust allows at most 3 characters of any whitespace (tabs too: `trim_start`). TS allows only 0–3 spaces (`^ {0,3}`).
- **Closing a fence**: Rust accepts the marker after any amount of indentation (`trim()`). TS accepts at most 3 spaces.
- **Inline code**: Rust blanks backtick runs of any length (CommonMark: ``` `` a`b `` ```). TS tag reading only blanks single-backtick pairs (`` `[^`]*` ``).
- **Unicode in tags**: TS uses `[\p{L}\p{N}_/-]`. A straight Rust port with `char::is_alphanumeric()` would also accept `Other_Alphabetic` marks (Devanagari vowel signs, for example), which `\p{L}` rejects. A hand-written port has to choose on purpose (and match Obsidian). Adding a Unicode-category crate is a new dependency; `regex` is already in `Cargo.lock` through Tauri but is not a direct dependency of `grove`.
- Link parsing already exists twice: `mock/backend.ts` `WIKILINK`/`MDLINK` against `parse.rs`, and `links/internal.ts` `resolveLink` against `Index::resolve`.

## 2. Ground rules for every step

- **TS stays the spec.** Each rule ported to Rust matches today's TS behaviour, which has been tuned to Obsidian over 30+ rounds, unless Chris decides otherwise for a listed case. The TS function is kept: the browser mock uses it, the editor uses it for unsaved text, and it serves as the reference for parity tests.
- **One shared set of test cases** (`rebuild/app/fixtures/parity/*.json`). vitest runs it against the TS functions, and `cargo test` runs it against the Rust ones (`include_str!` + `serde_json`, which is already a dependency). A rule changes in both places in the same commit, or the tests fail.
- **The mock calls the TS reference**, for example `tags` in the mock returns `tagsInText()` of each file. Browser tests keep working and the mock can't drift.
- **New Rust logic goes in its own module** (`index/tags.rs`, `index/props.rs`, `index/query.rs`). Shared files (`lib.rs`, `model.rs`, `api.ts`, `mock/backend.ts`, `CONTRACT.md`) only gain a few lines each, so parallel branches rarely conflict.
- **New read-only commands are `#[tauri::command(async)]`.**
- **Contract and ownership**: `CONTRACT.md` says Grok owns `src-tauri/`, Claude owns `src/`, and "neither side edits the other's files". These steps cross that line. Proposal: for this migration, **each step's owner edits both sides** and updates `CONTRACT.md` in the same commit (the contract already allows that, if the commit message says so). The alternative is to split every step into a Rust half and a TS half, which doubles the hand-offs. Chris should pick one before Step 1.
- **No new crates and no network** (offline audit), unless Chris approves one for a specific step.
- **Every step passes, before merge**: `cargo test`, `npm test` (vitest plus every browser, geometry and mouse script, then `posttest`), `npm run build` (tsc) and `npm run audit:offline`.

## 3. The steps

Size: S < 150 changed lines, M 150–500, L > 500.

### Step 0: groundwork (four independent tasks, all in parallel)

**0.1 Take reads off the main thread; no rescan under the lock**
- Scope: mark the read-only commands `#[tauri::command(async)]`: `list_files`, `read_note`, `read_file_bytes`, `search`, `link_index`, `frontmatter`, `read_config` and `last_vault`. Leave the writes (`write_note`, `create_*`, `rename_path`, `delete_path`, `write_*`) as they are for now. The main thread finishes each one before it handles the next IPC message, so a read sent after a write still sees that write. Make `watch.rs` `flush` build the rescanned `Index` **outside** the lock and swap it in. Paths written while the scan ran must be re-applied, for example by re-refreshing the vault's own-write list after the swap. Optional: change `Mutex` to `RwLock` so reads don't wait on each other.
- Files: `src-tauri/src/lib.rs`, `watch.rs`, `vault.rs`.
- API/contract: no shape changes. Add one line to CONTRACT.md: "read commands run off the main thread; replies to separate calls may arrive in any order".
- Front end: check that nothing depends on reads returning in the order they were sent. `searchFacts`, `vaultTags` and `propertyIndex` all key their caches by request, so that looks fine, but needs checking.
- Tests: Rust test that a rescan loses no note written during it (with a hook that injects the write mid-scan); existing `cargo test`; manual check with a 5k vault that typing does not stall while the search view is open.
- Risk: low–medium (concurrency). Size: S.
- **Agent: Claude** (the ordering and lock reasoning). Grok reviews.

**0.2 Benchmark vault and timings**
- Scope: `scripts/gen-vault.mjs <dir> <n>` builds a deterministic vault shaped like the one in §1, with tags, frontmatter, fences, links, some Unicode tags and some `~~~` fences. Add a Rust timing test `src-tauri/src/index/bench.rs` (`#[test] #[ignore]`, run with `cargo test --release -- --ignored --nocapture bench`) that prints time and JSON size for each command, in release and debug. Add a front-end timing script (mock `?synthetic=5000` already exists in `mock/sampleVault.ts`) for `vaultTags.read()`, one search-view query and one link refresh. Commit the baseline numbers to `rebuild/RUST_BENCH.md`.
- Files: new files only, plus one `mod bench;` line in `index.rs`.
- API: none. Tests: they are the measurement. Risk: none. Size: S–M.
- **Agent: Grok** (or Gemini for `gen-vault.mjs` alone).

**0.3 Shared test cases (parity corpus)**
- Scope: a JSON format `{ "name", "input", "expected" }` per file: `tags.json` (note text → tag list), `links.json` (note text → raw link targets), and later `properties.json` and `query.json`. Add a vitest runner `src/parity.test.ts` and a Rust runner `src-tauri/src/index/parity.rs`. Seed each file with cases from today's TS behaviour, including every divergence listed in §1 (tab-indented fences, a 4-space-indented closing fence, double-backtick inline code), plus: Unicode (CJK, Devanagari with vowel signs, accents written with combining marks, emoji), digit-only `#123`, a trailing slash `#a/`, `#` in a URL fragment, `# Heading`, `#tag` inside frontmatter, the `tags:` forms (list, `[a, "#b"]`, `a, b`, a YAML comment after the value), and `tag:` on its own. A case Rust fails today is marked `"rust": "todo"`, so the corpus lands green.
- Files: new `fixtures/parity/`, new test files, one `mod` line.
- Risk: none (tests only). Size: M.
- **Agent: Claude** designs the format and seeds the tricky cases. Grok adds more cases and checks the questionable ones against real Obsidian (Grok's strength is checking bugs and parity).

**0.4 Fast debug builds**
- Scope: in `src-tauri/Cargo.toml`, add `[profile.dev.package."*"] opt-level = 2` (or only `serde_json` / `serde`). It optimizes dependencies in `tauri dev` and leaves Grove's own crate fast to compile. No code change. The first dev build after it takes longer, later ones don't.
- Tests: re-run the 0.2 bench in debug. The `"#"` serialize should drop from about 84 ms to a few ms.
- Risk: very low. Size: S (2 lines).
- **Agent: Gemini (agy)**. Small and safe, a good first task to see how it does.

### Step 1: tag index in Rust (the hot spot)

- Scope: `index/tags.rs`: `fn note_tags(content: &str) -> Vec<String>`, a straight port of `tagsInText`. That covers the frontmatter `tags:`/`tag:` forms (`parseTags`/`tagValue`) and body `#tags` with the TS fence and inline-code rules, not `parse.rs`'s rules, unless the corpus decides otherwise. Work the tags out in `parse_note` and keep them on `Note`, so each note is done once per change. Add `Index::tags(paths: Option<&[String]>) -> BTreeMap<String, Vec<String>>` (notes without tags left out, `.md` only, the same as today).
- Command: `tags(paths?: string[]) -> { [path]: string[] }`, async.
- `api.ts`: `tags: (paths?: string[]) => call<Record<string, string[]>>("tags", { paths: paths ?? null })`.
- `mock/backend.ts`: `tags` = `tagsInText(content)` for each `.md` file (imported from `shell/linksTags`).
- TS: `vaultTags.ts` `readTags()` becomes a single `api.tags()`. Delete `tagsByNote`, the hit-walking `Fences` and their tests (move those cases into the corpus first). Keep `tagsInText`, `tagsInLine`, `frontmatterTags` and `tagTree`: the Tags view and Bases use them for unsaved open notes.
- Tests: `tags.json` corpus green in both. Rust unit tests for `Index::tags` after `upsert_note`, `relocate` and `remove_tree`. Vitest for `vaultTags` over the mock. Existing browser tests covering the Tags view, `tag:` search, graph tags and Bases `file.tags`. **Shadow check** (one-off, Grok): on Chris's real vault, compare the old path (5 searches + `tagsByNote`) with `api.tags()` and list every difference before the old code is deleted.
- Expected result (release, 5k): 80 ms and 4.3 MB, plus about 55 ms of JS, down to under 10 ms and about 0.56 MB, plus about 5 ms. It also fixes the 100k-hit cut-off.
- Risk: medium (tag rules users can see). Size: M (~250 Rust, ~40 TS added, ~110 TS removed).
- **Agent: Claude** (exact rule port, corpus decisions). **Grok** runs the shadow check and the Obsidian comparison.

### Step 2: stop re-sending all backlinks (new finding)

- Scope: `link_index` stops sending `backlinks`. Its result goes from 3.85 MB to about 0.97 MB. A new command `backlinks(paths: string[]) -> { [path]: Backlink[] }` (async) answers only for the notes that are asked about.
- Callers (only three, `grep links.backlinks`): `main.ts:250` (status-bar backlink count), `shell/backlinksView.ts:200` and `links/update.ts:34`.
- **Trap**: `fileOps.relocate` calls `api.renamePath` **before** `updateLinks` runs. `updateLinks` relies on `ws.vault.links` still holding the backlinks from before the rename. Once backlinks are fetched on demand, the backend index has already moved, so they must be fetched **before** `renamePath` (in `relocate`) and passed in. If that is missed, renaming silently stops updating links.
- `api.ts`: `LinkIndex.backlinks` removed (or made optional for one release); `backlinks()` added. `mock/backend.ts`: split its `linkIndex()` the same way.
- Tests: vitest for `updateLinks` with the before-rename snapshot. Browser tests for the backlinks pane, the status-bar count, and rename → links updated (the scripts that rename today: `test-explorer-drag.mjs`, `test-r22-bugs.mjs`, `test-r27f.mjs`, `test-bases.mjs`). Rust test for `backlinks()` after `relocate`.
- Expected result: each save's link refresh goes from 3.85 MB to under 1 MB.
- Optional later step (2b): send only the changed notes' `outgoing` (a version number plus a diff). Only worth it if the bench still shows the refresh above 10 ms.
- Risk: medium (rename ordering). Size: M.
- **Agent: Codex** builds it, with the trap spelled out in its task. **Claude** reviews the rename path.

### Step 3: properties in Rust (groundwork for steps 4 and 6)

- Scope: `index/props.rs`, a port of `readProperties` and type inference from `editor/frontmatter.ts` (text, list, number, checkbox, date, datetime, tags, aliases, unknown for nested YAML; `fixedType` keys). Command `properties(paths?) -> { [path]: { props: Property[], lines: string[] } }`, async.
- TS: `shell/propertyIndex.ts` calls `api.properties` instead of `api.frontmatter` + `splitFrontmatter`/`readProperties`. The mtime cache and the open-editor override stay the same. `editor/frontmatter.ts` stays as it is: the editor's Properties block parses the live document as you type.
- Mock: `properties` = `readProperties` over the mock's frontmatter. Keep `frontmatter` as long as anything uses it.
- Tests: new `properties.json` corpus covering every type, quoting, empty values, lists, dates with times, nested maps, more than 2,000 lines, and CRLF. Existing `frontmatter.test.ts` and `propertyIndex.test.ts`. The All properties view and the Properties block browser tests.
- Expected result: speed about the same (17 ms becomes a few ms). The real gain is that Rust understands properties.
- Risk: medium (a YAML subset has many edge cases). Size: M–L (~350 Rust).
- **Agent: Codex** (large, self-contained port against fixtures). **Grok** checks parity.

### Step 4: search evaluation in Rust (needs steps 1 and 3)

- Scope: `index/query.rs`: parser for Obsidian's syntax (a port of `parseQuery` from `shell/searchQuery.ts`: words, phrases, `-`, `OR`, `( )`, `file:`, `path:`, `tag:`, `line:`, `content:`, `[prop]`, `[prop:value]`, and Match case). The evaluator works over the index's lines, Step 1 tags and Step 3 properties. File-name matches come first, as today.
- Commands (async):
  - `search_notes(query, match_case, limit_notes, lines_per_note) -> { total, notes: [{ path, count, lines: [{ line, text }] }] }` for the search view.
  - `search_match(queries: string[]) -> string[][]`: paths matching each query, for the graph's filter and colour groups.
- TS: `searchView.ts` and `graph/source.ts` call these. `searchFacts.ts` mostly goes away, and so do the per-prefix 20k-hit fetches. `searchQuery.ts` keeps `parseQuery`, `highlightsOf`, `spansOf` and `explainQuery` (UI highlighting and explanations), and `matches` (the mock's reference).
- One behaviour change to approve: today `[prop]` terms see **unsaved** properties of open notes, and Rust sees only saved text. Saves are debounced about 300 ms, so the difference only shows while a note is being typed in. Alternative: the TS side folds in open, unsaved notes itself.
- Tests: `query.json` corpus, with each query string → its parse tree (both parsers must agree, because TS still parses for highlighting), and each query × a small fixture vault → the matching paths in order. Every case in `searchQuery.test.ts` moves into it. Browser tests for search, the graph filter and colour groups.
- Expected result: per keystroke, up to 2.9 MB / 20–120 ms on the main thread becomes about 10–50 KB, and the work happens off the main thread.
- Risk: medium–high (syntax users can see). Size: L (~600 Rust).
- **Agent: Codex** builds. **Claude** writes the command contract and reviews the semantics first. **Grok** checks parity against Obsidian.

### Step 5: "which notes might link here", in Rust, for renames (needs step 2)

- Scope: `link_sources(paths: string[]) -> string[]`: every note whose links resolve to one of `paths`, plus every note whose text mentions one of their names in any link style (bare, `%20`, `encodeDest`, escaped). It replaces the backlinks lookup plus the search loop in `links/update.ts`. That loop searches only the **first 20 notes** of a moved folder, at most **500 hits** each, so large folder moves can miss links. It must be called before `rename_path` (see the Step 2 trap).
- **The text rewriting (`rewriteLinks`) stays in TS.** It works on unsaved editor buffers and writes through `updateNoteText`, so open editors follow.
- Tests: vitest `updateLinks` with a 50-note folder move. Browser rename tests.
- Expected result: a correctness gain (no cap), not a speed one. Risk: medium (it decides which user files get edited, but doesn't edit them). Size: S.
- **Agent: Grok** (small port). **Claude** reviews.

### Step 6 (optional, measure first): Bases rows in Rust

- Only if the 0.2 bench, after steps 1 and 3, shows a 5k-row Base taking more than 50 ms per update. That would mean porting `bases/expression.ts`, `filters.ts` and the row/sort part of `model.ts` (~300 lines) into a `base_rows(base_source, view)` command. `bases/yaml.ts` and `bases/write.ts` stay in TS: they work on one `.base` file at a time and write user files.
- **Agent: Codex**, if it is done at all.

## 4. Order, parallel work and success criteria

### Order and what can run at once

| Wave | Steps | In parallel? | Shared files to merge with care |
|---|---|---|---|
| A | 0.1 (Claude), 0.2 (Grok), 0.3 (Claude + Grok), 0.4 (Gemini) | Yes, all four | `index.rs` gets one `mod` line each from 0.2 and 0.3; `Cargo.toml` (0.4 only) |
| B | 1 tags (Claude), 2 backlinks (Codex), 3 properties (Codex, or a second Codex session) | Yes, all three | `index/parse.rs` (`Note` gains fields in steps 1 and 3), `lib.rs`, `model.rs`, `api.ts`, `mock/backend.ts`, `CONTRACT.md`. Merge in the order **1 → 3 → 2**, rebasing each in turn |
| C | 4 search (Codex, after 1 + 3), 5 link sources (Grok, after 2) | Yes, both | `lib.rs`, `api.ts`, the mock |
| D | Bench again; decide on step 6 | – | – |

Strictly in sequence: 0.3 before 1, 3 and 4 (they need the corpus); 1 and 3 before 4; 2 before 5. 0.1 is independent but should land first, because it is the cheapest way to make input feel smoother.

### Which agent for what (summary)

| Step | Builder | Reviewer / parity check | Why |
|---|---|---|---|
| 0.1 async + rescan | Claude | Grok | Concurrency and ordering reasoning |
| 0.2 bench | Grok | – | Self-contained, measurable |
| 0.3 corpus | Claude | Grok (against Obsidian) | Sets the rules every later step follows |
| 0.4 dev opt-level | Gemini | – | Two lines, no risk: a trial of agy |
| 1 tags | Claude | Grok (shadow diff) | Exact rules that users see |
| 2 backlinks | Codex | Claude | Medium build with one known trap |
| 3 properties | Codex | Grok | Large port against fixtures |
| 4 search | Codex | Claude (contract), Grok (parity) | Largest port, self-contained |
| 5 link sources | Grok | Claude | Small port that touches user files |
| 6 Bases (maybe) | Codex | Grok | Only if measured |

### Success criteria

Speed: release build, a 5k vault from `gen-vault.mjs`, numbers from the 0.2 bench, checked once more by hand in the running app.

| Measure | Today | Target |
|---|---|---|
| Tag refresh (backend time / data sent) | 80 ms / 4.34 MB (+ ~55 ms JS) | ≤ 10 ms / ≤ 0.6 MB (+ ≤ 10 ms JS) |
| Link refresh after a save | 18 ms / 3.85 MB | ≤ 10 ms / ≤ 1 MB |
| One search-view keystroke | 17–36 ms / up to 2.9 MB | ≤ 30 ms / ≤ 100 KB |
| Same three in a debug build (`tauri dev`) | 335 / 145 / ~120 ms | ≤ 3× the release figure |
| Commands that run on the main thread | all but one | only the writes (code review: every read is `async`) |
| CONTRACT.md bar (every command < 50 ms on 1k notes, search < 150 ms) | met | still met |

Behaviour:
- Every parity corpus case passes in both vitest and `cargo test`, with no `"rust": "todo"` left by the end of the step that needs it.
- The step 1 shadow diff on Chris's real vault shows no differences, or each one has been reviewed and accepted.
- `npm test` passes in full (geometry, mouse, drag and every round script), as do `posttest`, `cargo test`, `npm run build` and `npm run audit:offline`.
- The browser mock still runs the whole app with `npm run dev`.

## 5. What should NOT move

- **The editor and everything CodeMirror touches**: live preview, decorations, tables, formatting, folding, wikilink completion, `editor/frontmatter.ts` for the Properties block. These are synchronous and run on every keystroke against the live document. An IPC round trip per keystroke would be slower, not faster.
- **UI shell**: menus, panes, tabs, layout, settings, drag and drop, the command palette, the quick switcher's fuzzy match (`shell/fuzzy.ts` works on a list the page already has; IPC would add latency on every keystroke).
- **Graph physics and drawing** (`graph/sim.ts`, `draw.ts`). If they get slow, a Web Worker is the right tool, not Rust. **Graph data** (`graph/data.ts`) is built from data the page already has.
- **Link text rewriting on rename** (`links/internal.ts` `rewriteLinks`, `fileOps.ts`). It has to see unsaved buffers and keep open editors in sync. It is rare, and a wrong rewrite damages user files. Only the lookup moves (step 5).
- **`resolveLink` / `linkExists` in TS**: the editor uses them synchronously to style links as resolved or not resolved.
- **Canvas** (`canvas/document.ts`, `model.ts`) and **Bases file read/write** (`bases/yaml.ts`, `write.ts`): one file at a time, small, already fast, tied to the UI.
- **Unlinked mentions** (`shell/unlinked.ts`): already chunked as a generator over one note, for one open note.
- **Full Rust UI**: already ruled out.
