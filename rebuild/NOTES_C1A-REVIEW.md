# R1 part A: review of C1-A (Rust search evaluation)

Reviewed `rebuild/c1a-search-codex` at `4d02300` (`e9044b9` implementation, `4d02300` notes) against `rebuild/STEP4_SEARCH_PLAN.md`, using `git diff aa6b958..4d02300`. This branch (`rebuild/c1a-review-claude`) starts at `4d02300` and adds only this file. No source file was edited.

**In short:** the evaluator is a careful, line-for-line port. The commands are wired correctly, the tests cover what the plan asked for, and the release timings meet §7. One thing must change before C1-B. For `file:` and `path:` terms, the shared corpus, and so the Rust port, show **every line** of the note. Today's app shows **none**. Left as is, C1-B would change what Search in folder shows. The fix is two small code changes plus eight `expected` values. They are given exactly below, and I tested them on a scratch copy.

## 1. Required fix: `file:`/`path:` terms show lines the app never shows

**What the app does today.** `shownLines` asks `facts.lines(textOf(l) ?? "")` for every positive term leaf (`searchQuery.ts`, `shownLines`). For a `file:` or `path:` term, `textOf` is null, so it asks for the term `""`. In the app, `facts.lines` only knows the terms in `termsOf(q)`, which never includes `""`:

- `searchFacts.ts:92`: `lines: (term) => byTerm.get(term)`;
- `searchFacts.ts:87`: with no terms at all, `facts()` returns null, and the view uses `{ lines: () => undefined }` (`searchView.ts:142`).

So `file:roadmap` and `path:"Projects" ` (Search in folder, `pathQuery`) list each note with **no lines**. `path:"Projects" alpha` shows only the `alpha` line.

**What the corpus says.** K1's reference `searchVault` computes `lines(term)` on demand for any term. `termLines(lines, "")` has no words and no phrase, so it passes **every** line. The K1 corpus recorded that, and C1-A ported it on purpose (`search.rs:230-236`, "preserve that quirk"; NOTES_C1A "Preserved TS quirks"). It is not a quirk of the app. It is a gap between the reference and the app. I missed it in the K1 review: my before/after check used the same reference on both sides.

**How I found it.** In a scratch copy, I ran every `search.json` case through `searchVault` with `lines()` limited to `termsOf(q)`, as `searchFacts` does. 8 of the 82 cases differ, all in shown lines:

| Case | Corpus now | The app |
|---|---|---|
| `file:roadmap` | lines `[1,2,3,4]` | `[]` |
| `file:2026` | `[1]` | `[]` |
| `path:proj` | `[1,2,3,4]` | `[]` |
| `path:"Projects" alpha` | `[1,2,3,4]` | `[4]` |
| `path:"Projects" ` (Search in folder) | `[1,2,3,4]` | `[]` |
| `file:md` (every note) | every line | `[]` |
| `path:/` | `[1]` | `[]` |
| `file:md` (vault `names`) | `[1]` | `[]` |

Counts agree in these eight cases. They can differ in other mixes, though, for example `file:x [status:draft]` when the body also says "draft": the extra lines get counted.

**The fix.** In TS, the reference stops answering `""`. In Rust, file/path leaves get no term. Then the eight `expected` values change.

```diff
--- a/rebuild/app/src/shell/searchVault.ts
+++ b/rebuild/app/src/shell/searchVault.ts
@@ -58,6 +58,8 @@
 
   const byTerm = new Map<string, Map<string, Line[]>>();
   const lines = (term: string) => {
+    // file: and path: leaves ask for "" (shownLines). The app never fetches lines for them, so they show none.
+    if (!term) return undefined;
     let found = byTerm.get(term);
     if (!found) {
       found = new Map();
--- a/rebuild/app/src-tauri/src/index/search.rs
+++ b/rebuild/app/src-tauri/src/index/search.rs
@@ -227,13 +227,8 @@
         let mut all = Vec::new();
         leaves(q, false, &mut all);
         for (query, negated) in all {
-            // shownLines asks facts.lines("") for file/path leaves. searchVault
-            // returns every line for it: preserve that quirk, even with count 0.
-            let term = if matches!(query, Query::Term { .. }) {
-                Some(plan.add(&text_of(query).unwrap_or(Cow::Borrowed(""))))
-            } else {
-                None
-            };
+            // file: and path: leaves have no text to look for, so they show no lines.
+            let term = text_of(query).map(|text| plan.add(&text));
             plan.leaves.push(Leaf {
                 query,
                 negated,
@@ -433,8 +428,10 @@
                     }
                 }
                 _ => {
-                    for &i in self.term_lines(leaf.term.expect("term leaf")) {
-                        out[i] = Some(note.lines[i].text.as_str());
+                    if let Some(id) = leaf.term {
+                        for &i in self.term_lines(id) {
+                            out[i] = Some(note.lines[i].text.as_str());
+                        }
                     }
                 }
             }
```

In `rebuild/app/fixtures/parity/search.json`, set the `expected` of these eight cases, and nothing else. The file is `JSON.stringify(…, null, 2)` plus a newline, so regenerating it with the patched `searchVault` changes only these cases:

| Case name | New `expected` |
|---|---|
| `file:` | `{"Projects/Roadmap.md":{"count":0,"lines":[]}}` |
| `file: against a dated name` | `{"Daily/2026-10-21.md":{"count":0,"lines":[]}}` |
| `path:` | `{"Projects/Roadmap.md":{"count":0,"lines":[]}}` |
| `path and a word` | `{"Projects/Roadmap.md":{"count":1,"lines":[4]}}` |
| `Search in folder` | `{"Projects/Roadmap.md":{"count":0,"lines":[]}}` |
| `file:md matches every note` | every one of its seven notes with `{"count":0,"lines":[]}` |
| `path:/ matches every file` | `{"Board.canvas":{},"Note.md":{"count":0,"lines":[]},"Upper.MD":{"count":0,"lines":[]},"photo.png":{}}` |
| `file:md includes Upper.MD` | `{"Note.md":{"count":0,"lines":[]},"Upper.MD":{"count":0,"lines":[]}}` |

Also correct NOTES_C1A's "Preserved TS quirks" line, which says `file:`/`path:` shown lines include every content line.

**Tested** on a scratch copy of `4d02300` with all three changes:

- `vitest run src/parity.test.ts src/shell/searchQuery.test.ts`: 347 passed.
- `flock … cargo test --offline --lib`: 52 passed, 2 ignored, no warnings (`Cow` is still used elsewhere).
- Every other corpus case is unchanged.
- The case-level `"rust"` markers stay absent, because TS and Rust agree again.

**Owner:** Codex, as C1-A's owner editing both sides (the plan's rule). It should be one commit before C1-B starts.

## 2. Evaluator against the TS reference (everything else checks out)

### Parsing and plan

- **Parse:** Q1's `parse_query` is used directly (`search.rs:14`, `:47`, `:86`). `None` gives `[]`, an empty map, or `[]` per query. Nothing returns an error. The 65-level and 100,000-`(` cases are covered (`tests.rs:467`).
- **`text_of`, `terms_of` and `highlights_of`** (`search.rs:113-179`) match `textOf`, `termsOf` and `highlightsOf`:
  - tags become `#text`; `file:`/`path:` give none;
  - `termsOf` keeps negated terms and recurses into `line:`, but not into property values;
  - highlights skip negated leaves, recurse into `line:` parts and property values, and are sorted by UTF-16 length, longest first, with a stable sort (`:244-245`).
- **Word split** (`Needle`, `:186-201`): words are split with `is_js_space` and lower-cased with Rust `to_lowercase`. The whole phrase is checked when the term has a space or Match case is on. This is `termLines`.

### Matching (`passes`, `:360-409`)

- **Name test:** `any` tests the stem: the basename without `.md`, any case, via `is_note_path`. `content` skips the name. That is `noteName` after Step 3.
- **`file:`** tests the basename, extension included. **`path:`** tests the folded path.
- **Tags:** equal, or under the term via a `/`. That is `isUnder`, including `tag:#` matching nothing.
- **Properties** are found by lower-cased key. `holds` runs on each value, folded unless Match case is on. A checkbox is `"true"`/`"false"`, as `String(p.value)` gives, and an empty list still passes a bare `[key]`.
- **`line:`** (`line_hits`, `:326-359`): the union of each term's lines, then `holds` on the folded line. `line:(-a)` has no candidates, as in TS. `holds` (`:498-506`) is false for nested `line:`/property operators, as in TS.

### Shown lines and counts

- **Shown lines** (`:410-446`) skip negated leaves. A matched property adds `fm.lines[p.line]` at note line `p.line + 2` (array slot `p.line + 1`), as `propertyLine` does. Step 3's `line` is the index among the frontmatter body lines, so the two agree, and a BOM and CRLF are covered (`tests.rs:498`). A later leaf replaces an earlier one's text, but the order stays by line, as TS's `Map` keeps it.
- **Counts** (`match_count`, `:447-494`): each word's occurrences are non-overlapping, then sorted by start; overlapping spans count once and adjacent ones twice. That is `spansOf` + `matchCount`. Byte offsets are fine, because only order and overlap matter. It reuses `Line.lower`, which is identical to JS `toLowerCase` (checked for every code point in STEP4 §9).

### Which files each command covers

- **`search_notes`** (`:13-38`): notes only (`is_note_path`, so `.MD` counts), in `BTreeMap` path order. Nothing is sorted in Rust.
- **`search_match`** (`:82-101`): every file except folders, so attachments too.
- **`search_lines`** (`:40-80`): re-parses the query; skips duplicates, missing paths, folders, non-notes, paths that don't pass and paths with no lines; cuts each note at `limit`, and `limit = 0` gives `{}`.
- **Notes over 8 MB** have `Note::default()`, so they match by name or path only. The test proves the body is never read (`tests.rs:467`).
- **One small risk:** `self.plan.ids[text]` (`:405`) would panic for a content term the plan never prepared. Every term `passes` can reach is prepared (`prepare` recurses through and/or/not/`line:`, and property values go through `holds`, not `passes`), so this can't happen today. If F1's fuzz ever panics there, that is the cause.

## 3. Commands, permissions, tests

- **Commands:** `search_notes`, `search_lines` and `search_match` (`lib.rs:330`, `:340`, `:354`) are `#[tauri::command(async)]` and go through `with_vault` (`lib.rs:129`), like the other reads.
- **Permissions:** they are in `build.rs`, `capabilities/default.json` and `permissions/autogenerated/search_{notes,lines,match}.toml`. G0's command test passes.
- **The old `search`** (`lib.rs:282`) is kept for unlinked mentions and the rename fallback.
- **`model.rs`:** `SearchNote { path, count: u32 }` and `SearchLine { line, text }`.
- **`tests.rs`:**
  - `:382` covers `upsert_note`, folder and file `relocate`, `remove_tree`, and `.MD` notes;
  - `:418` covers path order (`a/A.md` before `z.MD`), filtering, de-duplication and the limit in `search_lines`, and attachments versus folders in `search_match`;
  - `:467` covers empty and deep queries and huge notes;
  - `:498` covers overlaps, adjacency, emoji, `İ`, and BOM/CRLF property lines.

  That is everything the plan's test list asked for.
- **Parity runner:** `search` builds each vault with `Index::from_notes` and calls the command core, `passes` included for attachments (`parity.rs`). It is a real end-to-end check of the commands.

## 4. The §7 numbers

- **Release time: acceptable.** All ten `search_notes` medians are ≤ 30 ms; the slowest is `line:(garden river)` at 28.9 ms. `search_lines` takes 0.07 ms for 26 KB, and `search_match` 12.4 ms for 213 KB. All meet the targets.
- **Payload: acceptable, but the plan's figure needs correcting, not the code.** All-match `meeting` is 292,520 bytes, about 58.5 B per note. That is above D2's 0.25 MB. The fault is in my plan: its 217,520-byte figure came from measuring `[path, count]` arrays (`path_count` in my sizing script), not the `{ path, count }` objects that §3 specifies. Codex's arithmetic is right. Keep the object shape and restate D2 as about 60 B per matching note (≈ 120 KB at 2,000 notes, ≈ 0.3 MB at 5,000). That is still about 10× smaller than today's 3 MB, and its `JSON.parse` takes a few milliseconds. Arrays of `[path, count]` would save about 25%, but only Chris should change the shape, and only before C1-B starts. Not a fix.
- **Debug: acceptable, under D5.** The ratios run from 2.3× to 6.1×; the worst absolute figure is 176 ms (`line:(garden river)`), and typical single words take 35–85 ms. That is above "3–5×" for `line:` groups and two-word queries. It only affects `tauri dev`, and C1-B's one-search-in-flight rule keeps the queue from building. If Chris wants it faster, the D5 option (`[profile.dev.package.grove] opt-level = 1`) still applies. Not a fix.
- **Lock time:** each call holds the state lock for its whole run, up to about 29 ms release and about 176 ms debug. `write_note` waits for it on the main thread. That is why C1-B must keep at most one `search_notes` in flight (STEP4 §3).

## 5. For C1-B

- **Required fix 1 lands first.** Then the mock's `searchVault` and the Rust commands agree with today's app for `file:`/`path:`.
- **Order and paging:**
  - sort in TS (`compareNames` / `compareFiles`) and keep only paths that `ws.vault.files` has and that aren't excluded;
  - the total is the sum of `count`;
  - fetch `search_lines` for each batch of rows;
  - a path missing from `search_lines` (it stopped matching after a save) draws as a row with no lines.
- **Fast typing:** one `search_notes` in flight, with the newest input sent next, plus the existing `seq` guards. This matters more in debug (§4).
- **Unsaved edits:** flush pending saves before searching, if Chris picked D1-B.
- **The graph:** keep the synchronous TS path for queries that need nothing from the backend (`file:`/`path:` only). Send the rest through `search_match` in one call. A null query means "everything", and is not sent.
- **Contract:** CONTRACT.md should describe the shown-line rule as fixed above, and give about 60 B per note in its payload note, if it gives one.

## 6. For F1 (Grok b)

- **Compare against the app, not only against `searchVault`.** The shadow check should run the **old app path** (Rust `search` per term, `searchFacts`'s `termLines`, then `matches` / `shownLines` / `matchCount` with `lines` limited to `termsOf`) against `search_notes` + `search_lines`. The fuzz alone compares Rust with the reference, and the bug in section 1 was a reference-versus-app gap that no Rust-versus-reference fuzz can see. Before fix 1 lands, expect `file:`/`path:` shown-line differences. After it, the only expected differences are counts that the old 20,500-line cap cut short.
- **Two known, accepted whitespace differences.** Don't chase them:
  - In a quoted phrase containing U+0085 (NEL), the old path's Rust `split_whitespace` splits on it and JS `\s` doesn't.
  - For U+FEFF it is the other way round.

  The new rule is JS whitespace on both sides (K1 review).
- **A panic** in `passes` at `search.rs:405` would mean a term reached evaluation without being prepared (section 2).

## VERDICT: NEEDS FIX

1. **Apply section 1:** the `searchVault.ts` guard (`if (!term) return undefined;`), the two `search.rs` changes (no term for file/path leaves; skip leaves without a term in `shown_lines`), and the eight `search.json` `expected` values listed. Correct NOTES_C1A's "Preserved TS quirks" line. Rerun the parity tests in vitest and cargo, and the full suite under the lock. One commit by Codex, before C1-B starts.

Nothing else blocks C1-B. The payload restatement (§4, D2) and the debug ratios (D5) are plan and decision updates, not code fixes.
