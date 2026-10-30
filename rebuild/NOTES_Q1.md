# NOTES_Q1 — Rust Search Query Parser (`index/query.rs`) (Gemini)

Branch: `rebuild/q1-query-gemini`

## 1. What Changed

1. **Merged `rebuild/k1-search-grok` (`d11803d`)** into `rebuild/q1-query-gemini` (`ac47873`), resolving conflicts in `rebuild/app/fixtures/parity/README.md` and `rebuild/app/src-tauri/src/index/parity.rs` by keeping both Step 3 (`properties`) and K1 (`query` / `search`).
2. **Ported the search query parser to Rust (`6ba62bf`)**:

| File | Diff (`+`/`-`) | Summary |
|---|---|---|
| `rebuild/app/src-tauri/src/index/query.rs` (new) | `+350 / -0` | Line-by-line port of `parseQuery`, `all`, `term`, and `scoped` (`src/shell/searchQuery.ts`), with `Field` and `Query` serialized to the identical JSON tree and the 64-level depth limit (`QUERY_DEPTH = 64`). |
| `rebuild/app/src-tauri/src/index/tags.rs` | `+2 / -2` | Make `is_js_space` and `js_trim` `pub(super)` so `query.rs` uses JavaScript's exact `\s` and `trim()`. |
| `rebuild/app/src-tauri/src/index.rs` | `+1 / -0` | Add `mod query;`. |
| `rebuild/app/src-tauri/src/index/parity.rs` | `+15 / -9` | Pass the case object to runners (for `matchCase`), register `"query" => Some(parse_query)`, and update `search_vault_names_are_checked_without_a_runner` for `"query"`. |
| `rebuild/app/fixtures/parity/query.json` | `+1 / -1` | Replace top-level `"rust": "todo"` with `"parse_query in src-tauri/src/index/query.rs"`. All 49 cases pass with 0 `"rust": "todo"` markers. |
| `rebuild/app/fixtures/parity/README.md` | `+1 / -1` | Document `parse_query` (`index/query.rs`) in the corpus files table. |

Total for Q1 commit: 6 files changed, 370 insertions(+), 13 deletions(-).

---

## 2. Implementation Notes & Decisions

- **Exact tree serialization**: `Query` uses `#[serde(tag = "op", rename_all = "lowercase")]` and `Field` uses `#[serde(rename_all = "lowercase")]`, producing `{ "op": "and"|"or", "parts": [...] }`, `{ "op": "not", "part": {...} }`, `{ "op": "term", "text": "...", "field": "..." }`, `{ "op": "line", "part": {...} }`, and `{ "op": "prop", "key": "...", "value": {...}|null }`, or `null` when `parse_query` returns `None`.
- **Line-by-line fidelity with `searchQuery.ts`**:
  - Top-level `group('\0', Field::Any)` uses `'\0'` as its stop character rather than pre-truncating `input`, matching TS when `\u0000` appears after whitespace vs inside a word or quote.
  - `in_property` is a single boolean flag on `Parser` (cleared when an inner `[b:c]` finishes its `:value` group), matching TS on `[a:[b:c] d]`.
  - Operator detection (`operator`) checks `/^([a-z]+):/i` (1+ ASCII letters followed by `:`) against `file`, `path`, `tag`, `content`, and `line`.
  - Depth counter (`QUERY_DEPTH = 64`) increments on `(`, negating `-`, `[` (when not `[[`), and operator `(`, setting `too_deep = true` and returning `None` past 64 levels.
  - `#![allow(dead_code)]` is set at the top of `index/query.rs` because `index/search.rs` (task C1-A) has not landed yet, so `parse_query` is currently called only from `#[cfg(test)]` (`parity.rs`).

---

## 3. Differential Fuzz (`60,000` Random Queries + `100,000`-Paren Stress Case)

The differential fuzz harness is kept in `/tmp/grove-q1-fuzz/`:
- `/tmp/grove-q1-fuzz/fuzz.mjs`: deterministic (`xorshift32`) generator producing 60,000 `(input, matchCase)` cases across three modes:
  1. Recursive grammar expressions (words, phrases, unclosed quotes, negations, parens, operator groups, nested properties, Unicode case-folding edge cases `İstanbul`, `İ`, `Σ`, `ΑΣ`, `ẞ`, `K`, `é`/`e\u0301`, CJK, Arabic, emoji, and all JS `\s` code points).
  2. Random token soup (arbitrary combinations of brackets, operators, colons, quotes, dashes, `OR`, `\u0000`, and words).
  3. Deeply nested queries (depths 58..71 around the 64-level limit mixing `(`, `-`, `[a:`, `file:(`, and `line:(`).
- `/tmp/grove-q1-fuzz/src/main.rs`: standalone Rust binary mounting `index/tags.rs` and `index/query.rs`, comparing `serde_json::to_value(parse_query(&input, match_case))` against TS `parseQuery(input, matchCase)` for all 60,000 cases, plus asserting `parse_query(&("(".repeat(100_000) + "a" + &")".repeat(100_000)), false).is_none()`.
- **Result**: **60,000 / 60,000 random queries and the 100,000-`(` stress test passed with 0 mismatches.**

### Note on a Pre-existing Edge Case in TS `scoped()` (`src/shell/searchQuery.ts:163-175`)
While running the token-soup generator without restrictions, the fuzzer found an edge case in TS's `scoped()` when an outer field operator (`file:(...)`, `path:(...)`, `tag:(...)`, `content:(...)`) wraps an inner `tag:#` or `path:/`:
- `tag:#` and `path:/` produce `{ op: "term", text: "", field: "tag" | "path" }` (because `#` and `/` are stripped after the non-empty check in `term()`).
- If that term is then re-scoped by an outer `file:(...)`, `scoped()` calls `term("", "file")`, which sees `"".trim() === ""` and returns `null`.
- In TS (`searchQuery.ts:168`):
  - `file:(-tag:#)` executes `case "not": return { op: "not", part: scoped(q.part, field)! }`, returning `{"op":"not","part":null}` (violating the `part: Query` type and causing `holds()` and `explainQuery()` to throw `TypeError: Cannot read properties of null (reading 'op')`).
  - `file:(path:(-tag:#))` throws `TypeError: Cannot read properties of null (reading 'op')` inside `parseQuery` itself when the outer `scoped` visits `{ op: "not", part: null }`.
- In Rust `query.rs`, `Not { part: Box<Query> }` cannot hold `null`, so `scoped` uses `scoped(*part, field)?` and cleanly returns `None` instead of constructing an invalid `Not` node or panicking. (Per Q1 instructions, `searchQuery.ts` was not modified.)

---

## 4. Test Results

- `cd rebuild/app/src-tauri && cargo test`: **48 passed, 0 failed, 1 ignored** (including `index::parity::corpus` covering all 49 `query.json` cases).
- `cd rebuild/app/src-tauri && cargo build`: **Passed** (`0` warnings/errors).
- `cd rebuild/app && npm run build`: **Passed** (`tsc --noEmit && vite build`).
- `cd rebuild/app && npm run audit:offline`: **Passed** (`166 source files, dist/, CSP, capabilities and dependencies checked`).
- `cd rebuild/app && flock /tmp/grove-npm-test.lock npm test`: **Passed** (`vitest`: 58 test files, 665 passed; all browser verification scripts and `posttest` passed on the first run).
