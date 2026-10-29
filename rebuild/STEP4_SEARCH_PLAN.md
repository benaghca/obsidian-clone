# Step 4: search evaluation in Rust — build plan

Written 2026-10-29 on `rebuild/s4-plan-claude` (based on `rebuild/integration` at `763edea`). Planning only: no app code changed. Every claim below cites the code at that commit. Step 3 (properties in Rust) is assumed to land as `RUST_MIGRATION_PLAN.md` §3 describes.

## In plain words

- **Today, each letter typed in the search box asks Rust for every line that contains the word so far.** For a common word on the 5,000-note bench vault, that is 20,500 lines and 3 MB per keystroke. The page then works out which notes match.
- **After this step, Rust answers the whole question.** It returns which notes match and how many matches each has. A second, small call fetches the lines for the rows on screen.
- **The page keeps the order of results.** File-name order uses the browser's language-aware sorting (`Intl.Collator`), which Rust cannot copy exactly. So Rust sends every matching note (about 45 bytes each) and the page sorts them. A query that matches all 5,000 notes sends about 0.22 MB instead of 3 MB, not the 0.1 MB the plan hoped for.
- **Result counts become correct.** Today the "N results" number silently stops at the 20,500-line cap: "meeting" on the bench vault shows about 20,500 when there are 131,948. Rust counts every match.
- **The typing-speed budget holds.** A full scan of the 5,000-note vault took 6–18 ms in a release build in a throwaway test, against a 30 ms target.
- **Two existing problems must be fixed first, and are part of this plan.** (1) The Step 1 `tags` command was never given permission in Tauri's access list, so the real app refuses it (the browser mock does not check). From the code, the Tags view, `tag:` search, graph tags and Bases' `file.tags` get nothing in the built app today. This was not seen in a running app, because GUI windows were off-limits for this task. (2) A query with a few thousand `(` or `-` in a row overflows the parser's stack. In TypeScript it only throws. In Rust it would crash the whole app, so both parsers get a nesting limit.
- **TypeScript keeps the query parser** for highlighting and "Explain search terms", and keeps its matcher as the reference the mock and the tests use. `searchFacts.ts` and its per-prefix fetches are deleted.
- **One behaviour question for Chris:** what search sees of a note with unsaved edits. Recommended: save pending edits first (they are at most 300 ms old), then ask Rust. Search then sees exactly what was typed.
- **Who does what:** Gemini fixes the permission bug now and ports the parser. Grok writes the shared test cases, the reference implementation and the fuzz. Codex builds the evaluator, the commands and the switch-over once Step 3 lands. Claude reviews.

## Decisions for Chris before the build starts

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| D1 | **Unsaved edits.** Today `[prop]` terms read open editors' unsaved text; text and `tag:` terms already read only saved text. What should Rust search see? | **Save pending edits first, then search** (option B in §5). About 3 lines of TS. | Search sees every edit exactly, for every kind of term. That is better than today, where text terms already lag behind. |
| D2 | **Payload target.** The plan's ≤ 100 KB per keystroke cannot hold for a query that matches most of the vault, because the page sorts. | **Accept about 45 bytes per matching note** (≤ 100 KB up to about 2,000 matching notes, 0.22 MB at 5,000), with ≤ 30 ms backend time. | Meeting 100 KB always would mean sorting in Rust with an approximation of the system's collation, and results would sometimes come back in a different order. |
| D3 | **Exact counts.** "N results" and the per-note counts become correct for common words (they are capped today). Notes also always get their first 5 lines, where today most get 4 for common words. | **Approve.** It is a visible change, and it moves closer to Obsidian. | Someone comparing before and after will see larger numbers. |
| D4 | **Nesting limit.** A query nested deeper than 64 levels (brackets, `(`, `-`) counts as "nothing to search for", in both parsers. | **Approve 64.** | Without a limit the Rust parser can crash the app. TS today throws a `RangeError` somewhere between 4,096 and 8,192 levels (measured in Node). |
| D5 | **Debug build speed.** The plan says debug ≤ 3× release. Scan loops in Grove's own crate measured 3–5× slower in debug. | **Accept 3–5×**, or set `[profile.dev.package.grove] opt-level = 1` (slower `tauri dev` rebuilds). Same question as in NOTES_S1. | Only matters for `tauri dev`. Release is the target. |
| D6 | **Quirks kept on purpose.** The port copies today's TS exactly, including a few odd rules found while reading (§7, "Tricky seed cases"). Examples: `file:md` matches every note; `line:(-a)` never matches; a colour group with an empty query colours every node. | **Port as-is.** Record each one in the corpus with a note (and an `obsidian` value where Obsidian is believed to differ), and decide later. | Fixing them during the port would mix two changes and make the parity check meaningless. |

Not a decision, but it has to happen first: **G0, the `tags` permission fix (§8)**. It is a live bug in the integration branch.

---

## 1. What the code says (corrections to the plan's Step 4)

| Plan says | The code says |
|---|---|
| "File-name matches come first, as today" | Only the old `search` command puts name hits first (`index.rs:180-221`). The search view drops them (`searchFacts.ts:47`, `hit.line <= 0`) and sorts the matching notes by name with `compareNames` (`searchQuery.ts:266-268`). That is `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })` (`paths.ts:25`), which uses the system locale. It can also sort by modified or created time (`searchView.ts:145-149`, `paths.ts:40-47`). The graph has no order. **The order stays in TS. Rust returns path order.** |
| `search_notes(query, match_case, limit_notes, lines_per_note) -> { total, notes: [{ path, count, lines }] }` | `limit_notes` cannot be applied in Rust, because Rust does not know the order (above). Excluded files are a TS setting too (`searchView.ts:144`, `ws.vault.isExcluded`). Replaced by `search_notes` (every match, with its count) plus `search_lines` (lines for the rows being drawn). See §3. |
| "Today `[prop]` terms see unsaved properties … Rust sees only saved text" | Right for `[prop]` (`propertyIndex.ts:66` reads loaded editors). But **text terms and `tag:` already see only saved text today**: their lines come from the Rust `search` command (`searchFacts.ts:43`) and tags from `api.tags` (`vaultTags.ts:5,13`). Only `[prop]` changes. |
| Per keystroke "about 10–50 KB" | Measured on the bench vault: a query that matches all 5,000 notes is **192 KB as bare paths** and 218 KB with counts. 10–50 KB holds only for queries that match up to about 1,000 notes. See D2. |
| Query features: "regex if supported", `block:`/`section:`/`task:` "if TS supports them" | **TS supports none of them.** The operators are `file`, `path`, `tag`, `line` and `content` (`searchQuery.ts:35`). `/abc/` is a plain word; `task:x` is the plain word `task:x` (`searchQuery.ts:89-97`). Match case is the view's toggle, not a `match-case:` operator. All are out of scope, so there is no JS-versus-Rust regex risk in this step. |
| "`searchFacts.ts` mostly goes away" | **All of it goes** (91 lines). Its only other job is handing tags to the graph (`graph/source.ts:37`), which can call `vaultTags` directly. |
| (not in the plan) | **Counts are capped today.** `linesOf` asks for `max(2000, files × 4)` hits (`searchFacts.ts:42`). The Rust search cuts at that limit, round-robin (`index.rs:221-239`). Counts and the total come from those lines (`searchView.ts:160,209`). On the bench vault, "meeting" has 131,948 matching lines, but 20,500 are sent. |
| (not in the plan) | **`tags` is refused in the built app.** `build.rs` lists the app's commands, which turns on Tauri's access list for app commands. `tags` is not in that list, has no `permissions/autogenerated/tags.toml`, and has no `allow-tags` in `capabilities/default.json`. Tauri rejects any app command without an access entry once an app manifest exists (`tauri-2.12.4/src/webview/mod.rs:2080`, `has_app_acl_manifest`). Step 2 did all three for `backlinks` (NOTES_S2). Step 1 did none. |
| (not in the plan) | **The graph does not search on every keystroke.** Its filter and colour-group fields are debounced by 250 ms (`graph/panel.ts:125,159`). A query with only `file:`/`path:` terms is evaluated synchronously, with no backend call (`graph/view.ts:157-167`, `searchFacts.ts:82`). Keep that. |

## 2. Exact scope

### Query features (all of today's TS; nothing new)

From `parseQuery` (`searchQuery.ts:38-115`) and `matches` (`searchQuery.ts:209-237`):

| Feature | Rule (as TS does it today) |
|---|---|
| Words | Each bare word must occur somewhere in the note: in a line, or in its name (file name without `.md`). Substring, no word boundaries. Case-insensitive (JS `toLowerCase`) unless Match case is on. |
| Phrases `"a b"` | A substring of one line. An unclosed quote runs to the end. Found as "every word on one line" and then the whole phrase, but only if the phrase contains a space or Match case is on (`searchFacts.ts:47`). |
| `-x` | Not. Applies to any term or group. A `-` before a space, or at the end, is the word `-`. |
| `OR`, `( )` | `OR` only as a separate upper-case word. AND binds tighter than OR. A stray `)` is skipped. An unclosed `(` closes at the end. |
| `file:` | The file name (with its extension) contains it. |
| `path:` | The path contains it. Leading and trailing `/` are trimmed off the term. |
| `tag:` | A tag equals it or sits under it (`isUnder`). The term is always lower case and loses one `#`. Tags come from the tag index (Step 1). |
| `line:` | Every term of the group on the same line. |
| `content:` | Lines only, not the name. |
| `op:(…)` | The operator applies to every term inside (`scoped`, `searchQuery.ts:125-137`). |
| `[prop]` | The note has the property (key compared in lower case). |
| `[prop:value]` | One of its values contains the value query (`and`/`or`/`not`/terms only, as text). Values: list items; a checkbox as `"true"`/`"false"`; anything else its text (`searchFacts.ts:64`). |
| Match case | Terms and texts are compared as typed. Tag terms and property names never are. |
| Nothing to search for | `parseQuery` returns null. The search view shows nothing (`searchView.ts:136-141`); the graph includes everything (`source.ts:55`). |

### Results, order and limits

- **Which files.** The search view: notes only. After this step that means every `.md` in any case (decided rule; `is_note_path`, `index.rs:528`), so TS lists keep only paths that `ws.vault.files` has (today `ws.vault.notes`, which is lower-case `.md` only, `vault.ts:64-66`). The graph: every file except folders, so notes and attachments (`source.ts:50-54`).
- **Per-note count.** Obsidian's count: occurrences of the highlight words in the note's shown lines, with overlapping matches counted once (`matchCount`, `searchQuery.ts:285-295`, over `shownLines` and `highlightsOf`).
- **Shown lines.** In line order, no repeats: lines with the terms the query looks for (not those under `-`), lines where a `line:` group holds, and the line of each matched property (`shownLines`, `searchQuery.ts:244-252`; `propertyLine`, `:271-274`). The view shows the first 5 (`searchView.ts:26`).
- **Order.** By name (`compareNames`) or by time with ties by name (`compareFiles`), in TS. Ties keep input order (`Array.prototype.sort` is stable). Today's input order is `list_files` order, which is Rust's `BTreeMap` byte order of paths. Rust's results come in the same order, so ties come out the same as today.
- **Limits.** None on matching notes, because the vault size bounds them. `search_lines` takes a lines-per-note limit and a list of paths. Notes over 8 MB have no indexed lines (`index.rs:25,463`), so they can match only by name, as today.

### What stays in TS

| Function (`searchQuery.ts`) | Why it stays |
|---|---|
| `parseQuery` | Highlighting, "Explain search terms", the graph's backend-free shortcut, the mock and the reference. |
| `highlightsOf`, `spansOf` | Highlight spans in UTF-16 columns for the DOM (`searchView.ts:157,162`). Rust's byte offsets would need converting, which isn't worth it. |
| `explainQuery`, `pathQuery` | UI text. |
| `matches`, `shownLines`, `matchCount`, `termsOf`, `needs`, `propertyLine`, `Facts` | The **reference**: the mock and the parity runner use them. `termsOf`/`needs` also decide whether the graph needs the backend. |

### What goes away

- `shell/searchFacts.ts`: all of it (91 lines). That covers the per-term cache, the per-prefix `api.search(term, files × 4)` fetches, the phrase filter and the properties map.
- `matchingNotes` (`searchQuery.ts:265-268`): the view sorts by itself.
- The graph's `VaultFacts` plumbing (`graph/source.ts:20-37`).
- The `api.search` command **stays**: unlinked mentions use it (`backlinksView.ts:244`), and so does the rename fallback until Step 5 (`links/update.ts:38`).

## 3. Commands and contract

All three are read commands, `#[tauri::command(async)]`, and take the state lock like the others (`lib.rs:124-131`). JS argument keys are camelCase (`matchCase`). Tauri maps them to the snake_case Rust parameters.

### `search_notes(query: String, match_case: bool) -> Vec<SearchNote { path, count }>`

- Every note that passes `query`, in path order, with its count.
- `[]` when the query has nothing to search for (empty, only spaces, only stray brackets, or deeper than 64 levels).
- Never an error for a bad query: every string parses. The only error is `"no vault open"`.
- Payload: about 45 bytes per matching note (measured: 217,520 bytes for 5,000 notes).

### `search_lines(query: String, match_case: bool, paths: Vec<String>, limit: u32) -> BTreeMap<String, Vec<SearchLine { line, text }>>`

- For each of `paths` that passes `query`: its shown lines, in line order, at most `limit`.
- Paths that don't pass, have no lines, or aren't notes are left out.
- The view calls it for the rows it is about to draw (50, then each "Show more"), with `limit = 5`. Measured: 27,784 bytes for 50 notes of "meeting".
- It re-parses the query. It does not depend on a previous `search_notes` call. If a save lands between the two calls, a row may come back without lines; that is harmless.

### `search_match(queries: Vec<String>) -> Vec<Vec<String>>`

- For each query (Match case off): every file that passes it (notes and attachments, not folders), in path order.
- `[]` for a query with nothing to search for. The front end treats such a query as "everything", as today, and never sends it.
- For the graph's filter and colour groups, one call per rebuild.

`model.rs` gains `SearchNote { path: String, count: u32 }` and `SearchLine { line: u32, text: String }`.

### Stale replies and typing fast

- Async commands run on Tokio worker threads, and replies may arrive out of order (CONTRACT.md:13). Each one holds `AppState.inner` while it evaluates (about 10–20 ms). `write_note` runs on the main thread (`lib.rs:187`) and waits for that lock. A queue of eight searches from fast typing could therefore stall a save for over 100 ms.
- **So the search view keeps at most one `search_notes` in flight.** Input that arrives meanwhile is remembered, and when the reply lands only the newest input is sent. The existing `seq` guard (`searchView.ts:132,143,155,208`) still drops any reply that is no longer current.
- `search_lines` for a page goes out after `search_notes` and under the same `seq` guard.
- The graph is already debounced (250 ms) and has its own `seq` guard (`graph/view.ts:163-169`). Its source keeps the last `search_match` answer, keyed by the query list, until the next `"files"`/`"links"` change. A rebuild for another reason (the "show tags" toggle, for example) then doesn't ask again.
- No server-side cancellation in this step. If the bench shows evaluations piling up, add a request number with an atomic "newest" counter that an evaluation checks between notes and abandons early.

### CONTRACT.md entries (to add under `search`)

```text
- `search_notes(query: String, match_case: bool) -> SearchNote[] { path, count }` — the notes (any `.md`,
  any case) that pass `query` in Obsidian's search syntax, in path order (the front end sorts them).
  `count` is the number of matches in the note's shown lines, overlapping ones once (the number beside
  the note in the search view). The rules are `matches` / `shownLines` / `matchCount`
  (`src/shell/searchQuery.ts`), ported in `index/query.rs` and `index/search.rs`; `fixtures/parity/query.json`
  and `search.json` hold both to the same cases. A query with nothing to search for (or nested deeper than
  64 levels) returns `[]`; no query is an error. Saved text only. Added in plan step 4.
- `search_lines(query: String, match_case: bool, paths: string[], limit: u32) -> { [path]: { line, text }[] }`
  — the shown lines of each of `paths` that passes `query`, in line order, at most `limit` each: lines with
  the terms it looks for (not under `-`), lines where a `line:` group holds, and each matched property's
  line. Others are left out. For the rows the search view draws. Added in plan step 4.
- `search_match(queries: string[]) -> string[][]` — for each query (Match case off), every file (notes and
  attachments, not folders) that passes it, in path order; `[]` for a query with nothing to search for.
  For the graph's filter and colour groups. Added in plan step 4.
```

Permissions: add all three to `build.rs`, let the build generate `permissions/autogenerated/*.toml`, and add `allow-search-notes`, `allow-search-lines` and `allow-search-match` to `capabilities/default.json`. The test from G0 (§8) fails if one is missed.

## 4. Files, and roughly how many lines

### Rust (`src-tauri/src`)

| File | Change | Lines |
|---|---|---|
| `index/query.rs` (new) | `Query` enum and `parse_query(input, match_case)`, a line-by-line port of `parseQuery`, `term` and `scoped`, with a depth counter (64). `Serialize` to the same JSON tree as TS (`{ op, parts }`, `{ op: "not", part }`, `{ op: "term", text, field }`, `{ op: "line", part }`, `{ op: "prop", key, value }`), so the corpus compares trees. Also `terms_of` and `highlights_of`. | ~250 |
| `index/search.rs` (new) | The evaluator: `passes(path, &Query, match_case)`, `term_lines`, `line_hits`, `shown_lines`, `match_count`, plus `Index::search_notes`, `Index::search_lines` and `Index::search_match`. Reads `Line.lower`/`Line.text` (`parse.rs:5-8`), `Note.tags` (Step 1) and the Step 3 properties. | ~300 |
| `index/tags.rs` | `is_js_space` and `js_trim` become `pub(super)`. The parser needs JS's `\s` and `trim()`. | 2 |
| `index.rs` | `mod query; mod search;`. | 2 |
| `lib.rs` | Three commands and their `generate_handler!` entries. | ~30 |
| `model.rs` | `SearchNote`, `SearchLine`. | ~12 |
| `build.rs`, `capabilities/default.json`, `permissions/autogenerated/` | Three commands, three permissions (generated). | ~6 + generated |
| `index/parity.rs` | The `query` and `search` runners, the new keys (§6) and building a case vault with `Index::from_notes` (`index.rs:511`). | ~70 |
| `index/tests.rs` | Search after `upsert_note`, `relocate` and `remove_tree`; `.MD` notes; a too-deep query; `search_lines` leaving out paths that don't pass. | ~60 |
| `index/bench.rs` | §7. | ~50 |

Rust total: about 780 lines added. Size L.

### TypeScript (`src`)

| File | Change | Lines |
|---|---|---|
| `shell/searchVault.ts` (new) | The reference for the three commands over `{ [path]: text }`. Lines are split on `\n` with a trailing `\r` dropped, a leading BOM skipped and no final empty line, as Rust's `str::lines` after the BOM strip (`parse.rs:51,56`). Tags come from `tagsInText`, properties from `splitFrontmatter` + `readProperties`, notes are `/\.md$/i`. It applies `matches`, `shownLines` and `matchCount`. The mock and the parity runner use it. | ~70 |
| `shell/searchQuery.ts` | The phrase filter moves here from `searchFacts.ts:47`, as a pure `termLines(lines, term, matchCase)`. Add a depth limit (64) to `parseQuery`. `matches` strips `.md` in any case for the name test (decided `.MD` rule; today `noteName` strips only lower case, `paths.ts:7`). Delete `matchingNotes`. | +15 / −5 |
| `shell/searchView.ts` | `run()`: flush pending saves (D1), `api.searchNotes` with one in flight, keep paths that `ws.vault.files` has and aren't excluded, sort as today, total = sum of counts (no `afterPaint` pass), fetch lines for each batch of rows before drawing it. Note text for "Show more context" is read only for drawn rows, not for every match as today (`searchView.ts:151-155`). "Copy search results" starts fetching when the menu opens and writes when the item is clicked (§9). | +45 / −30 |
| `shell/sideView.ts` | `pagedRows` (`:118-131`) gains an optional async `before(items)` that runs ahead of each batch. | +6 |
| `graph/source.ts` | Tags from `vaultTags` (when `showTags` or a `tag:` term needs them). Text, `tag:` and `[prop]` queries go through `api.searchMatch`. `file:`/`path:`-only queries still use TS `matches` synchronously. The last answer is kept until a vault change. | +25 / −20 |
| `graph/view.ts` | The facts type changes name. | ~3 |
| `api.ts` | `SearchNote`, `SearchLine`, `searchNotes`, `searchLines`, `searchMatch`. | +10 |
| `mock/backend.ts` | Three commands that call `searchVault` over the mock's text files, with facts cached per file content so typing on the 5k synthetic vault stays quick. | +15 |
| `shell/searchFacts.ts` | Deleted. | −91 |
| `shell/searchQuery.test.ts` | The `search(...)`, `counts(...)` and `shownLines` cases move to the corpus. The `explainQuery`, `spansOf`, `highlightsOf`, `termsOf`, `pathQuery` and `propertyLine` tests stay. | −60 |
| `readOrdering.test.ts` | The `searchFacts` case (`:89-104`) becomes a search-view case: a stale reply is dropped and only one search is in flight. | ±15 |
| `parity.test.ts` | The `query` and `search` runners and the new keys. | +40 |
| `scripts/bench-frontend.mjs` | §7. | ±20 |
| `CONTRACT.md` | §3. | +3 |
| `fixtures/parity/query.json`, `search.json`, `README.md` | §6. | data |

TS total: about +250 / −210 (plus the corpus).

## 5. Unsaved text: options

Today: text and `tag:` terms see saved text only. `[prop]` sees loaded editors' text, saved or not (`propertyIndex.ts:66-68`). Saves are debounced about 300 ms (CONTRACT.md:20). The search view never re-runs on its own when a note changes; it re-runs only when the query or an option changes (`searchView.ts:218`). So the gap shows only if Chris edits a property in an open note and, within about 300 ms, types in the search box or the graph filter (which waits a further 250 ms).

| Option | What it does | Cost | Exactness |
|---|---|---|---|
| A. Saved only | Nothing. | 0 lines | `[prop]` lags behind unsaved edits by up to 300 ms (forever if a save fails). |
| **B. Flush, then search (recommended)** | The search view and a graph rebuild `await ws.editors.flush()` (`noteEditors.ts:484-491`, already used before renames, `fileOps.ts:125`) before asking Rust. `write_note` re-indexes the note before it returns (`vault.rs:101`). | ~3 lines | Exact for every term kind, so better than today for text terms. A pending save simply happens up to 300 ms early: the same bytes, with the timer cleared. When nothing is pending, the cost is one resolved promise. |
| C. TS overlay | TS re-evaluates open, unsaved notes with `matches` over the editor text and patches Rust's answer. | ~40 lines, plus two evaluators in production | Exact, but it keeps two live matchers whose results are merged. Parity risk. |
| D. Send unsaved text | `search_notes(..., overlay: { path: text })`, which Rust parses as temporary notes. | ~30 Rust + ~10 TS | Exact. The overlay is resent every keystroke (a 5,000-line note is about 200 KB each time). |

**Recommendation: B.** It is the smallest option and the only one that is exact for every term kind. The Properties block's own suggestions (`propertyIndex.host`) are unaffected: Step 3 keeps the editor override there.

## 6. The Rust/TS split and the parity corpus

### What runs where

- **Rust:** parse, evaluate, shown lines, counts.
- **TS:** parse (for highlights and explaining), sort, exclusion, paging, highlight spans, the mock (through `searchVault`).
- The two parsers must agree exactly, because TS highlights what Rust matched.

### Corpus format

There are two new files, so each file name still picks one runner per side (README). Additions to the format, accepted by both runners and documented in the README:

- **Top-level `vaults`** (`search.json` only): `{ "<name>": { "<path>": "text" | ["lines"] } }`.
- **Case key `matchCase`** (`true` or `false`, default `false`): both files.
- **Case key `vault`** (`search.json`, required there): names one of the file's `vaults`.
- Both runners add these to `KEYS` / `FILE_KEYS` (`parity.rs:40-41`, `parity.test.ts:45-46`). `vault` must name an existing vault, or the case fails.

**`query.json`**: `input` is a query string; `expected` is `parseQuery(input, matchCase)` as JSON, or `null`. The Rust runner serializes `parse_query`.

```json
{ "name": "a phrase and a negation", "input": "a \"b c\" -d",
  "expected": { "op": "and", "parts": [
    { "op": "term", "text": "a", "field": "any" },
    { "op": "term", "text": "b c", "field": "any" },
    { "op": "not", "part": { "op": "term", "text": "d", "field": "any" } } ] } }
```

**`search.json`**: `input` is a query string, evaluated against `vaults[vault]`. `expected` is an object keyed by each file that passes:

- a note maps to `{ "count": n, "lines": [shown line numbers, all of them] }`;
- an attachment maps to `{}`;
- `null` means the query has nothing to search for.

Line numbers are enough: the text is the vault's line. Keys are compared as a map, because the order belongs to TS. The TS runner uses `searchVault`. The Rust runner builds the vault with `Index::from_notes` and calls the same core functions the commands use.

```json
{ "name": "a word in the name counts", "vault": "obsidian-1.14.4", "input": "alpha OR gamma",
  "expected": { "A.md": { "count": 2, "lines": [6] }, "Gamma file.md": { "count": 0, "lines": [] } } }
```

(The values here only show the shape. The real counts are whatever TS returns when the case is written.)

### Moving the existing cases

| From `searchQuery.test.ts` | To |
|---|---|
| The 25 `search(...)` cases (`:45-69`) and `pathQuery` search (`:123`) | `search.json`, vault `obsidian-1.14.4` (`VAULT`, `:5-13`). Tags and properties come from the text, through `searchVault`. Today's hand-written `TAGS`/`PROPS` maps go away. |
| The 8 `counts(...)` cases (`:150-154`) | `search.json`, vault `match-case` (`:127-131`), with `matchCase` where the test sets it. |
| `shownLines` (`:97-101`) | `search.json`: `alpha -beta [status]` (prop line plus text line) and `line:(alpha beta)`. |
| The `parseQuery` trees (`:82-91`) | `query.json`. |

Two of the old cases must be redone when they move:

- The old tests checked lines with a hand-written `facts.lines`, which also splits a phrase into words (`:25`). The corpus uses the real phrase rule, so redo `"star wars"` with it.
- The old `TAGS` map has `A.md` with `inline-tag` from the body and `gamma` from frontmatter. `tagsInText` gives the same, but check it.

### Seed cases (beyond the moved ones)

Parse (`query.json`):

- Quotes: `"unclosed phrase`.
- Stray and unclosed brackets: `a ) b`, `(a OR b`, `)`, `]`.
- `OR`: `OR` at the start or end, `a OR OR b`, `ORANGE`, `-OR`.
- Dashes: `-` alone, `- a`, `--a`.
- Operator spelling: `File:x` (upper-case operator), `foo:bar` (unknown operator, so a word), `https://x.com`, `task:x`.
- Operator groups: `file:(a OR -b)`, `line:(file:x)`, `tag:#`, `tag:#A/B`, `path:/Projects/`, `path:/`.
- Properties: `[status]`, `["my key":x]`, `[a:(b OR c)]`, `[a:[b:c] d]` (today the inner `]` ends `inProperty`, so `d]` is a word), `[[wikilink]]`, `[ :x]`.
- Whitespace and control characters: `a \u0000 b` (NUL stops the query at a token start), a tab and U+3000 as separators, U+FEFF trimmed off a term.
- Match case: `matchCase` on `Alpha`, on `tag:Idea` (still lower case) and on `[Status:Draft]` (key lower case, value as typed).
- Depth: 64 and 65 levels of `(`, of `-`, and of `[a:`.
- Long input: 10,000 words (linear time).

Match (`search.json`):

- Name versus content: `content:gamma` against the note named `Gamma file`.
- `file:md` (every note, because the extension counts). `path:""`.
- `.MD`: a note `Upper.MD`, matched by name with and without Match case (after the TS fix, both strip `.MD`).
- Tags: `tag:a` against `a/b` (yes), `ab` (no) and `A` (yes, lower-cased). `tag:a/`.
- `tag:Idea` with Match case: it matches, but no line is shown (the shown-line term `#idea` is case-sensitive, while tags are compared in lower case).
- `line:`: `line:(-a)` never matches. `line:(a OR b)`. `line:(tag:x)` (inside `line:`, the tag term is compared as the text `x`).
- Phrases: a phrase with a tab (`"a\tb"`: no space in it, so the whole phrase isn't checked); a phrase with Match case.
- Unicode: final sigma with Match case (term `Σ` against line `ΑΣ`, where the lower-case prefilter fails, as today); `İstanbul` against `i̇stanbul`; `ẞ`; the Kelvin sign `K`; `é` precomposed against `e` + U+0301; CJK; emoji in a term.
- Counts: overlapping counts (`star wars` + `star`).
- Properties:
  - `[status]` on an empty value;
  - `[done:true]` on a checkbox;
  - `[category:one]` on a list;
  - `[tags:#a]` (`readProperties` keeps the `#`);
  - `[n:1]` on a number;
  - a property in a block that `readProperties` refuses (a duplicate key), so no property is found.
- Line ends: CRLF lines (text has no `\r`); a BOM before frontmatter (line 1 is `---`); a bare `\r` at the end of the file.
- Fences: a phrase across a fenced block (text search does not skip code; only tags and links do).
- Attachments: `-alpha` against an image (it matches, as an attachment); `file:png`; a `.canvas` file (no lines; today's mock searches its JSON).
- A colour-group query that is empty (`null`).

Where Obsidian is believed to differ, the case gets an `obsidian` value and a `note`. No runner reads it, as today.

### Differential fuzz (like NOTES_S1)

- The TS side generates random vaults: 20–40 notes, lines drawn from a small alphabet with the tricky characters above, frontmatter with random properties and tags, an attachment or two.
- It generates random queries from a token grammar (words, quotes, `-`, `OR`, brackets, the five operators and some made-up ones, tabs, Unicode, `matchCase` on and off).
- It writes `fuzz-in.json` with `searchVault` results. An `#[ignore]` Rust test (kept in the scratchpad, as in S1) reads it, runs the Rust core and writes `fuzz-rust.json`.
- Compare both the parse tree and the match result.
- Target: **50,000 queries over 200 vaults with no mismatches**. Each mismatch becomes a corpus case before it is fixed.

## 7. Bench targets

Measured now (scratchpad throwaway crate and script, `/tmp/grove-bench-5000`, release / debug):

| Query | Notes matching | Matching lines | Full scan + count, release | Debug | `search_notes` payload | Today's payload |
|---|---|---|---|---|---|---|
| `meeting` | 5,000 | 131,948 | 14.0 ms | 46.3 ms | 217,520 B | 3.01 MB (20,500 hits, the cap) |
| `garden river` | 5,000 | – | 17.0 ms | 84.7 ms | ~218 KB | two terms, about 6.4 MB |
| `"garden path"` | 5,000 | 128,948 | 11.4 ms | 47.8 ms | ~218 KB | ~3 MB |
| `alpha` | 2,376 | 3,180 | 5.9 ms | 26.0 ms | 100,984 B | 0.29 MB |
| `e` | 5,000 | 189,470 | 18.0 ms | 81.4 ms | ~218 KB | 2.4 MB |
| `zzz` | 0 | 0 | 9.0 ms | 23.4 ms | 2 B | 2 B |

Lines for the first 50 notes of `meeting`: 27,784 bytes.

On the page: sorting 5,000 names with `compareNames` took 7.4 ms in Node. Today's `matchingNotes` sorts the same list, so that cost is unchanged.

### Targets (release, 5k `gen-vault.mjs` vault, step 0.2 harness)

| Measure | Today | Target |
|---|---|---|
| One search-view keystroke, backend | 17–36 ms / up to 3 MB on the main thread's lock | `search_notes` ≤ 30 ms. Payload ≤ 100 KB up to about 2,000 matching notes, ≤ 0.25 MB for an all-match query (D2). |
| Rows for one page | (inside the above) | `search_lines` for 50 paths ≤ 5 ms / ≤ 40 KB |
| Graph rebuild with a filter and two colour groups | `searchFacts` per term (as above, cached) | `search_match` with 3 queries ≤ 50 ms / ≤ 0.6 MB worst case |
| Debug, the same | 124 ms (`search` alone) | ≤ 3× release (D5: likely 3–5×) |
| Page per keystroke (JSON.parse + exclusion + sort, 5,000 results) | `matchingNotes` + sort | ≤ 15 ms |
| Counts | capped at the 20,500-line limit | exact (131,948 for `meeting`) |
| CONTRACT bar (1k notes, search < 150 ms) | met | still met |

### What to add

- **`bench.rs`**, after the existing `search` line (`bench.rs:228-248`):
  - a `search_notes_ms` line for each of `meeting`, `alpha`, `zzz`, `garden river`, `"garden path"`, `meeting -garden (river OR stone)`, `tag:project`, `[tags:meeting]`, `line:(garden river)`, and `Meeting` with Match case. Each prints `ms`, `median`, `json_bytes`, `notes` and `total`.
  - `search_lines_ms` for the first 50 paths of `meeting`.
  - `search_match_ms` for `["meeting", "tag:project/alpha", "path:\"Folder 01\""]`.
  - `gen-vault.mjs` is unchanged, so its sha256 in RUST_BENCH.md stays valid. Its only properties are `tags` and `tag`, which is enough.
- **`bench-frontend.mjs`**: replace the `searchFacts` + `matchingNotes` part (`:76-77, 109-114`) with the new view path through the mock: `api.searchNotes("garden")`, the exclusion filter, the sort, and `api.searchLines` for 50. Also time `JSON.parse` of a 5,000-entry `[{ path, count }]` string, to estimate what the webview pays.
- **`RUST_BENCH.md`**: a "Step 4" section with before and after.

## 8. Who builds what, in which order

Track records this is sized to: Codex built S0-1 and S2 (both sides, careful with the rename trap, thorough notes). Grok wrote S0-5 and S3C (careful corpus work with Obsidian beliefs), fixed T1 (patient root-causing) and wrote the S2 review (exact, line-cited). Gemini did S0-4 (two lines) and S1L (a clean, bounded port that left the out-of-scope todos alone). Codex is on Step 3 right now.

| Task | Who | Needs | Touches (shared files in bold) | Size |
|---|---|---|---|---|
| **G0** `tags` permission fix + command-list test | Gemini | – | **`build.rs`**, **`capabilities/default.json`**, `permissions/autogenerated/tags.toml` (generated), a `#[cfg(test)]` check in **`lib.rs`** | S |
| **K1** corpus + TS reference | Grok | – | new `fixtures/parity/query.json`, `search.json`, `README.md`, new `shell/searchVault.ts`, **`parity.test.ts`**, **`parity.rs`** (both files `"rust": "todo"`), `searchQuery.test.ts` (cases moved), `searchQuery.ts` (`termLines`, depth limit, `.MD` name: marked `ts: todo` first where TS changes) | M |
| **Q1** Rust parser | Gemini | K1's `query.json` merged (or its draft) | new `index/query.rs`, `index/tags.rs` (2 lines), **`index.rs`** (1 line), **`parity.rs`** (`query` runner) | M |
| **C1-A** Rust evaluator + commands | Codex | Step 3, K1, Q1 merged | new `index/search.rs`, **`lib.rs`**, **`model.rs`**, **`build.rs`**, **`capabilities`**, **`parity.rs`** (`search` runner), `tests.rs` | L |
| **B1** bench | Gemini | C1-A merged | `bench.rs`, `bench-frontend.mjs` (after C1-B), `RUST_BENCH.md` | S |
| **F1** fuzz + shadow check | Grok | C1-A merged | nothing committed but its NOTES file (scripts in its scratchpad) | S |
| **C1-B** front-end switch | Codex | C1-A, F1 clean | **`api.ts`**, **`mock/backend.ts`**, `searchView.ts`, `sideView.ts`, `graph/source.ts`, `graph/view.ts`, delete `searchFacts.ts`, `readOrdering.test.ts`, **`CONTRACT.md`** | M |
| **R1** review of C1-A + C1-B | Claude | C1-B | none (a review file) | – |

**Order and parallel work.**

```text
now:        G0 (Gemini) ── merge first
            K1 (Grok)   ── in parallel with Step 3 (Codex)
after K1:   Q1 (Gemini) ── still in parallel with Step 3
after S3:   C1-A (Codex)
after C1-A: F1 (Grok) and B1 (Gemini, Rust half) in parallel; Codex fixes what F1 finds
then:       C1-B (Codex) → R1 (Claude) → merge
```

**Merge order:** G0 → Step 3 → K1 → Q1 → C1-A → C1-B (B1 can merge any time after C1-A).

**Conflict analysis.**

- `parity.rs` and `parity.test.ts` are touched by Step 3, K1, Q1 and C1-A, each adding a runner line or keys. The merges are sequential and each conflict is a one-line rebase.
- `build.rs` and `capabilities/default.json` are touched by G0 and C1-A, sequentially.
- `index.rs` gets one `mod` line from each of Step 3, Q1 and C1-A.
- No Step 4 task touches `parse.rs`, so there is no `Note`-field conflict with Step 3.
- `lib.rs` is touched by G0 (a test at the end) and C1-A (commands), sequentially.
- Gemini's parallel BOM and link-todo work touches `linksTags.ts`, `tags.json`, `links.json` and maybe `parse.rs`. No overlap.

**Reviews.**

- Grok reviews Q1 (against the corpus and the fuzz) and the parity half of C1-A (F1).
- Claude reviews the contract semantics (stale replies, flush, paging, copy, `.MD`) in R1.
- Codex's own notes record the before and after bench.

**Rollback.** C1-B is one commit, and it contains the whole switch, including deleting `searchFacts.ts`. Reverting it puts the old path back, with `search` still there. The Rust commands from C1-A stay but go unused, so they are harmless.

### Ready-to-send task outlines

Every task also gets the standard rules block used for S1:

- Work only in this worktree and branch. Commit locally in small commits, and never push.
- Use test vaults under `/tmp` only; never real vaults. No network, no new crates or packages.
- Before you finish, run `npm run build`, `flock /tmp/grove-npm-test.lock npm test`, `npm run audit:offline`, `cargo build` and `cargo test`. Rerun a clearly flaky test once and note it. Restore `rebuild/round*-shots/`.
- Write `rebuild/NOTES_<ID>.md`, commit it, then stop.

**G0 (Gemini): let the real app call `tags`.**
> Step 1 added the `tags` command (`lib.rs:306`) but not its permission, so Tauri's access list refuses it in the built app (`tauri-2.12.4/src/webview/mod.rs:2080`). Add `"tags"` to `build.rs`'s command list, commit the `permissions/autogenerated/tags.toml` the build generates, and add `"allow-tags"` to `capabilities/default.json` next to `allow-frontmatter`. Then add a `#[cfg(test)]` test in `lib.rs` that reads `lib.rs`, `build.rs` and `capabilities/default.json` with `include_str!` and fails if any name in `generate_handler!` is missing from the other two (as `allow-<name-with-dashes>`). Prove the test fails without your fix. Nothing else.

**K1 (Grok): the search corpus and the TS reference.**
> Read `rebuild/STEP4_SEARCH_PLAN.md` §2 and §6.
> - Add `fixtures/parity/query.json` (parse trees) and `search.json` (query × vault → matching files with count and shown lines), in the format of §6, with the new keys `vaults`, `vault` and `matchCase` in both runners and the README. Both files are `"rust": "todo"` at the top.
> - Write `src/shell/searchVault.ts`, the reference over `{ [path]: text }`, using `matches` / `shownLines` / `matchCount`. Move the phrase filter from `searchFacts.ts:47` into a pure `termLines` in `searchQuery.ts`.
> - Move the cases listed in §6 out of `searchQuery.test.ts`. Seed every tricky case in §6.
> - `expected` is today's TS. The three TS changes (depth limit 64, `.MD` name strip, BOM skip in lines) go in as `"ts": "todo"` cases first, then as the change in a separate commit.
> - Add `obsidian` values only where you have a recorded reason.
> - Do not change `searchView.ts`, `searchFacts.ts`, the graph or any Rust outside `parity.rs`.

**Q1 (Gemini): port the query parser to Rust.**
> Port `parseQuery`, `term` and `scoped` (`src/shell/searchQuery.ts:35-137`) to a new `src-tauri/src/index/query.rs`, line by line: a `Query` enum serialized to the same JSON tree, with `match_case`.
> - Use `tags.rs`'s `is_js_space` / `js_trim` (make them `pub(super)`) wherever TS uses `\s` or `trim()`. Operator names are ASCII letters only (`/^([a-z]+):/i`). Add the 64-level depth limit from K1.
> - Register `"query"` in `parity.rs` and make `query.json` pass with no `"rust": "todo"` left.
> - Run a differential fuzz of random query strings (TS tree against Rust tree, at least 50,000, kept in your scratchpad as S1 did) and report it.
> - Touch nothing else: not the evaluator, not commands, not TS.

**C1 (Codex): search evaluation in Rust and the switch-over.**
> Read `rebuild/STEP4_SEARCH_PLAN.md` in full. In two commits:
> - **(A)** `index/search.rs`: the evaluator over `Line.lower`/`Line.text`, `Note.tags` and the Step 3 properties, plus `Index::search_notes`, `search_lines` and `search_match`. Add the three async commands (with `build.rs`, the capability and the generated permissions; G0's test must pass), the `model.rs` types, the `search` runner in `parity.rs` (make `search.json` green), and the `tests.rs` cases.
> - **(B)** One revertible commit: `api.ts`, the mock through `searchVault`, `searchView.ts` (flush first if Chris picked D1-B; one search in flight; sort and exclude in TS; lines per batch through `pagedRows`' new `before`; context text only for drawn rows; copy that fetches when the menu opens), `graph/source.ts` (`vaultTags` for tags, `searchMatch` for queries that need the backend, the sync path kept for `file:`/`path:`-only queries, the last answer cached until a vault change). Delete `searchFacts.ts`, update `readOrdering.test.ts` and `CONTRACT.md` (§3 text), and add a browser case for the graph filter plus a colour group with a text term (none exists today).
>
> Traps:
> - Property lines need each property's index among the frontmatter lines (`propertyLine` adds 2). If Step 3 dropped `line`, add it.
> - Keep `search`, which unlinked mentions use.
> - Results in path order. Never sort in Rust.
> - No query may return an error.
>
> Bench before and after with the step 0.2 harness, and report every target in §7.

**B1 (Gemini): bench the new commands.**
> Add §7's lines to `index/bench.rs` (after `search`, `bench.rs:228-248`) and §7's change to `scripts/bench-frontend.mjs`, run both in release and debug on `/tmp/grove-bench-5000`, and add a "Step 4" section to `rebuild/RUST_BENCH.md` with before and after. Do not change `gen-vault.mjs`.

**F1 (Grok): check C1-A against the reference.**
> On `rebuild/integration` after C1-A:
> - Run the differential fuzz of §6 (at least 50,000 queries over 200 random vaults; TS `searchVault` against the Rust core).
> - Run a shadow check on a 5,000-note `gen-vault.mjs` vault and on the mock sample vault, for about 40 queries (the §7 set plus the corpus queries). Compare the old path (Rust `search` per term, plus `matches` / `shownLines` / `matchCount` in TS) with `search_notes` + `search_lines`. List every difference. Expected differences are counts the old 20,500-line cap cut short; explain any other.
> - Turn every real mismatch into a corpus case.
> - Do not touch real vaults.
> - Write `NOTES_F1.md`.

**R1 (Claude): review C1.**
> Review C1-A and C1-B against this plan, as the S2 review did: one search in flight and the `seq` guards, flush before search, `search_lines` after a save mid-way, the copy menu's clipboard timing, `.MD` notes in the sorted list, excluded files, the graph's sync path and its cache invalidation, and every new command in the access list. Read-only, plus a review file.

## 9. Risks and how each is caught

| Risk | How it is caught or avoided |
|---|---|
| **Unicode case folding**: JS `toLowerCase` against Rust `to_lowercase`. | Measured today: identical for all 1,488 code points that change, and for the context cases (final sigma, `İ`, `ǅ`, `ẞ`). Node 26 (Unicode 17, ICU 78.3) against rustc 1.99.1; WebKitGTK 2.54.1 links the same system ICU 78.3. The risk is drift after an upgrade. Corpus cases cover the tricky characters, and the fuzz uses a Unicode alphabet. After this step TS folds only displayed lines for highlighting, so drift would show as a missing highlight, not a wrong result. |
| **Regex dialects** | Not in scope: TS has no regex search (§1). If one is added later, JS `RegExp` and Rust `regex` differ (no lookaround or backreferences in Rust). That needs its own decision. |
| **Phrase and word rules** | Substring only, no word boundaries. The quirks (a phrase with a tab, Match case and the lower-case prefilter, `line:` with field terms) are corpus cases. The port copies `searchFacts.ts:47` and `lineHits` (`searchQuery.ts:202-206`) exactly. |
| **Ranking stability** | Order stays in TS (same collator). Rust returns `BTreeMap` path order, today's `list_files` order, so stable-sort ties come out the same. `search_notes` is checked in path order in `tests.rs`. |
| **Parser stack overflow** | The depth limit of 64 in both parsers, plus corpus cases at 64 and 65 levels for `(`, `-` and `[a:`. A `tests.rs` case parses 100,000 `(` without crashing. |
| **Big vaults** | Linear scan: a 20k-note vault is about 4× slower (about 40–70 ms release). Coalescing keeps typing smooth. If that is not enough, there is an optional prefix cache: when a query only extends a positive term, re-check only the notes that matched the previous query. Notes over 8 MB match by name only, as today. |
| **Result size** | `search_notes` is bounded by the vault (about 45 B/note). `search_lines` is bounded by `limit × paths`. "Copy search results" fetches up to 5 lines for every match, only on request (about 3 MB for an all-match query). |
| **Stale replies and lock queueing** | One search in flight plus the `seq` guards (§3); the graph is debounced. `readOrdering.test.ts` covers a stale reply and the single in-flight request. |
| **Clipboard after an await** | `writeClipboard` calls `navigator.clipboard.writeText` (`editor/clipboard.ts:22`), which WebKit may refuse outside a user gesture. Fetching starts when the menu opens; the item click writes the ready text in the same task. A browser test copies results after opening the menu. |
| **A command missing from the access list** | G0's test. This is what broke `tags`: the mock and every browser test passed while the built app refused the command. |
| **Step 3 property lines** | The S3C runner leaves out `line` (`parity.test.ts:35`), so a Rust `line` could be wrong unnoticed. `search.json`'s property-line cases catch it. |
| **The mock drifting from Rust** | The mock calls `searchVault`, the same code the TS corpus runner checks. The mock's old `search` (one whole substring, `\r` kept, `.canvas` searched: `backend.ts:161-187`) stays only for unlinked mentions, as today. |
| **`.MD` notes** | Rust counts them (decided). TS's name test is fixed to match (K1). The search view keeps paths that `ws.vault.files` has, not `ws.vault.notes`, so `.MD` results are not dropped. Other TS lists that use `vault.notes` (lower-case `.md`, `vault.ts:64-66`) are out of scope; a follow-up task if Chris wants them to match. |
| **Behaviour users can see** | Browser tests: the search scripts (`test-round18`, `test-round22b`, `test-r27e`, `test-r27n` to `test-r27s`). Graph filter and colour groups are covered only by vitest (`graph/graph.test.ts:81-97`); no browser script drives them today (`test-r25-bugs`, `test-r27c` and `test-round22b` only open the graph). So C1-B adds one browser case: a graph filter plus a colour group with a text term. F1's shadow check lists every difference from the old path before C1-B merges. |

## 10. Done when

- `query.json` and `search.json` pass in vitest and `cargo test`, with no `"rust": "todo"` left. The F1 fuzz has no mismatches.
- The F1 shadow check shows no differences except the capped counts (D3), or each one is reviewed.
- `search_notes`, `search_lines` and `search_match` are async and in the access list (G0's test passes).
- `searchFacts.ts` is gone, and the search view and the graph use the new commands.
- The §7 targets are met in release, and the debug figures are reported against D5.
- `npm run build`, `flock /tmp/grove-npm-test.lock npm test` (with `posttest`), `npm run audit:offline`, `cargo build` and `cargo test` all pass.
