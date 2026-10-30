# S5 review: `link_sources` (Grok)

VERDICT: OK. The rename lookup is correct, and the rename flow still rewrites every link it should. The one required fix was small: the Rust name scan held the index lock far too long on a folder move. It is now applied in `059fcc8` (see "Fix applied"), using the `regex` crate Grove already depends on. Nothing large is needed.

Reviewed `rebuild/s5-linksources-grok` (`afd2d0c`, `6686339` on `2bb6aeb`) against Step 5 of `RUST_MIGRATION_PLAN.md` and `NOTES_S5.md`. Read-only: the branch was not edited, committed to or pushed. My tests ran on `git archive` copies in my session scratchpad.

## Fix applied

The required fix below is now in `059fcc8` on `rebuild/s5-review-claude`, branched from `rebuild/s5-linksources-grok` `6686339`, which is unchanged. It is the patch in this file, unchanged: one change to `app/src-tauri/src/index/link_sources.rs`, +41 / −16. It adds no crate.

Checks on `rebuild/s5-review-claude`, all passed:

- **`cargo build --offline`:** no warnings.
- **`cargo test --offline`:** 53 passed, 1 ignored (`bench_vault`). That includes all six `link_sources` tests and G0's command check.
- **`npm run build`:** passed, with the existing chunk-size warning only.
- **`npm run audit:offline`:** passed (165 source files).
- **`flock /tmp/grove-npm-test.lock npm test`:** passed in one run (exit 0), with no reruns. Browser discovery 4 passed; vitest 58 files, 535 tests; every browser script, including `test-r22-bugs.mjs` with "link sources finds a note containing only an escaped destination" and the percent-encoded case; and `posttest`. `rebuild/round*-shots/` was restored afterwards.

To merge S5, take `rebuild/s5-review-claude`, which has Grok's two commits plus the fix and this review.

## What I checked

### It finds what the old TypeScript rename path found

The old path was `links/update.ts` at `2bb6aeb`. Its sources were:

- the Step 2 backlink snapshot: links that resolve to a moved note, with fenced and inline code skipped;
- plus `api.search` for five spellings of each name. That ran *after* `rename_path` and mapped hits back with `movedPath`, but only for the first 20 moved notes, and at most 500 hits per spelling.

The new path covers both parts:

- **Resolved links:** `Index::link_sources` keeps every note with a link that `Index::resolve` sends to a requested path (`link_sources.rs:26-29`). That is the same resolver and the same parsed links as the snapshot.
- **Spellings:** the five spellings are the same five strings: bare, `%20`, `\(`/`\)`, and both `encodeDest` forms (`link_sources.rs:66-101`, mirrored in TS by `linkSpellings`, `internal.ts`). They are matched lower-cased against `Line.lower`, which is `to_lowercase`, the same folding the old Rust search used.
- **No caps:** there is no 20-note cap and no 500-hit cap. A 50-note move is covered in Rust (`a_folder_of_fifty_notes_is_not_capped`), in the mock test and in `update.test.ts`.
- **Escaped and percent-encoded links:** covered by `each_link_spelling_matches_on_its_own` (Rust) and the mock test. `test-r22-bugs.mjs` now drives a real rename through `link_sources`, with no index help for `SearchOnly.md` and `PercentOnly.md`. Before this branch it had to patch `api.backlinks` to reach the search fallback.
- **Upper-case `.MD`:** `note_name` uses `is_note_path` and `display_name`, so `Foo.MD` gives the needle `foo`. Sources are any-case notes too.
- **BOM and CRLF:** needles are matched against `Note.lines`. These come from `parse_note` after the BOM is stripped, with `\r` dropped by `str::lines`, so neither can hide a spelling. A name can't contain `\r`, `\n` or U+FEFF. The mock matches the whole lower-cased text; since a needle never contains `\n`, that is the same as per line.

**The one intended difference: spellings now match as one contiguous piece, not word by word.** The old `search("My Note")` also returned a line like "my favorite note". That only matters if `rewriteLinks` would rewrite a link on such a line, and a real link to `My Note` always contains one of the five spellings in one piece, in any case (`[[My Note]]`, `[[Sub/My Note#H]]`, `[t](My%20Note.md)`, `<My Note.md>`). A link that needs the name split apart, such as `[[My  Note]]` with two spaces, doesn't resolve in Rust or TS, so `rewriteLinks` wouldn't change it either. So nothing that used to be rewritten is lost. **I agree with Grok's choice**; it needs no decision from Chris.

### The rename flow

`fileOps.ts` `relocate`, in order:

1. flush editors under the moved path;
2. keep `before`;
3. `await api.linkSources(targets)`, which aborts the move if it fails (tested);
4. `renamePath`;
5. move editors;
6. `followMove`;
7. `fileSettings.renamed(..., sources)`.

`updateLinks` de-duplicates the sources, maps each one forward once with `movedPath`, and reads live editor text, as before. The order and the abort are tested in `fileOps.test.ts`. The forward mapping and live text are tested in `update.test.ts`, as are the 50-note rewrite and the declined confirmation. Removing the search loop also removes the old after-rename `movedPath(h.path, to, from)` back-mapping, which is right: the sources are now taken before the rename.

### Wiring and tests

- **Command:** `link_sources` is `#[tauri::command(async)]` (`lib.rs`). It is in `build.rs` and in the capability, and `permissions/autogenerated/link_sources.toml` is committed. G0's command test passes.
- **CONTRACT.md:** the new entry matches the code. The `backlinks` entry correctly drops the "fetch before rename" instruction.
- **Mock:** it uses the TS resolver and `linkSpellings`.
- **Test runs:** on a copy of the branch, `cargo test --offline --lib` gives 53 passed, 1 ignored. Grok's full `npm test` run is in NOTES_S5.

## Required fix (small): one pass per line instead of one per spelling

`mentions` (`link_sources.rs:103-112`) checks every line against every spelling, one at a time. A folder move asks for about two spellings per note, and the whole scan runs inside `with_vault`, so it holds `AppState.inner` throughout. `write_note` runs on the main thread and waits for that lock, so typing and saving stall for the whole time.

I measured it on the 5,000-note bench vault (`/tmp/grove-bench-5000`, 200k lines), with a scratch crate using the same loop:

| Notes moved | Spellings | This loop, release | This loop, debug | One `regex` of the spellings, release / debug |
|---:|---:|---:|---:|---:|
| 1 | 2 | 5 ms | 38 ms | 7 / 15 ms |
| 50 | 100 | 124 ms | 1,640 ms | 13 / 23 ms |
| 500 | 1,000 | 955 ms | 12,779 ms | 20 / 27 ms |
| 5,000 (whole vault) | 10,000 | 233 ms | – | 27 ms (regex built in 25 ms) |

The regex found the same sources as the loop in every row. The old path cost about the same in total, but it was 100 separate searches that each released the lock in between. Two smaller things go with the fix:

- `mention_needles` de-duplicates with `out.iter().any(...)`, which is quadratic: about 50 million string comparisons for a whole-vault move.
- `regex` is already a direct dependency (Step 1), so this adds no crate.

The patch below fixes the scan and the de-duplication. If the alternation were ever too large to compile, it falls back to the old loop. It also widens the upper-case test to a `.MD` *source* with a BOM and CRLF line ends. I applied it to a copy of the branch: `cargo test --offline --lib` gives 53 passed, including all six `link_sources` tests.

```diff
--- a/rebuild/app/src-tauri/src/index/link_sources.rs
+++ b/rebuild/app/src-tauri/src/index/link_sources.rs
@@ -7,6 +7,7 @@
 //! escaped with a backslash. There is no note cap and no hit cap. The match is
 //! the spelling itself, in any case, not a search for each word on its own.
 use super::{display_name, is_note_path, Index};
+use regex::Regex;
 use std::collections::BTreeSet;
 
 impl Index {
@@ -17,7 +18,7 @@
         if wanted.is_empty() {
             return Vec::new();
         }
-        let needles = mention_needles(&wanted);
+        let mentions = Mentions::new(mention_needles(&wanted));
         let mut sources = BTreeSet::new();
         for (from, node) in &self.files {
             if node.is_dir || !is_note_path(from) {
@@ -27,7 +28,7 @@
                 self.resolve(from, &link.target)
                     .is_some_and(|target| wanted.contains(target.as_str()))
             });
-            if linked || mentions(&node.note.lines, &needles) {
+            if linked || mentions.in_lines(&node.note.lines) {
                 sources.insert(from.clone());
             }
         }
@@ -38,19 +39,19 @@
 /// Lower-cased spellings of each requested note's name. A path that is not a
 /// note adds none. The same spelling from two notes is kept once.
 fn mention_needles(paths: &BTreeSet<&str>) -> Vec<String> {
-    let mut out = Vec::new();
+    let mut out = BTreeSet::new();
     for path in paths {
         let Some(name) = note_name(path) else {
             continue;
         };
         for spelling in spellings(&name) {
             let low = spelling.to_lowercase();
-            if !low.is_empty() && !out.iter().any(|have| have == &low) {
-                out.push(low);
+            if !low.is_empty() {
+                out.insert(low);
             }
         }
     }
-    out
+    out.into_iter().collect()
 }
 
 fn note_name(path: &str) -> Option<String> {
@@ -100,15 +101,36 @@
     out
 }
 
-fn mentions(lines: &[super::parse::Line], needles: &[String]) -> bool {
-    if needles.is_empty() {
-        return false;
-    }
-    lines.iter().any(|line| {
-        needles
-            .iter()
-            .any(|needle| line.lower.contains(needle.as_str()))
-    })
+/// Whether any line holds one of the spellings. One regex of the escaped
+/// spellings scans each line once (a 500-note folder is 1,000 spellings);
+/// a plain loop is the fallback if that regex would be too large to build.
+enum Mentions {
+    None,
+    Any(Regex),
+    Each(Vec<String>),
+}
+
+impl Mentions {
+    fn new(needles: Vec<String>) -> Self {
+        if needles.is_empty() {
+            return Mentions::None;
+        }
+        let pattern: Vec<String> = needles.iter().map(|n| regex::escape(n)).collect();
+        match Regex::new(&pattern.join("|")) {
+            Ok(re) => Mentions::Any(re),
+            Err(_) => Mentions::Each(needles),
+        }
+    }
+
+    fn in_lines(&self, lines: &[super::parse::Line]) -> bool {
+        match self {
+            Mentions::None => false,
+            Mentions::Any(re) => lines.iter().any(|line| re.is_match(&line.lower)),
+            Mentions::Each(needles) => lines
+                .iter()
+                .any(|line| needles.iter().any(|n| line.lower.contains(n.as_str()))),
+        }
+    }
 }
 
 #[cfg(test)]
@@ -212,10 +234,13 @@
 
     #[test]
     fn an_upper_case_extension_uses_the_note_name() {
-        let idx = notes(&[("Other.md", "see FOO in the text")]);
+        let idx = notes(&[
+            ("Other.md", "see FOO in the text"),
+            ("Src.MD", "\u{feff}first\r\n[[Foo]]\r\n"),
+        ]);
         assert_eq!(
             idx.link_sources(&["Foo.MD".into()]),
-            vec!["Other.md".to_string()]
+            vec!["Other.md".to_string(), "Src.MD".to_string()]
         );
     }
 }
```

The literal-alternation regex matches exactly what `str::contains` would: `regex::escape` turns each spelling into a literal, and the text is already lower-cased.

## Notes (no change needed)

- **Unsaved edits in other notes still aren't searched.** `relocate` flushes only the editors under the moved path, and both the old and the new lookup read the saved index. So a link typed into another open note in the last 300 ms, and not yet saved, is not found. This predates S5. Flushing all editors in `relocate` (`ws.editors.flush()` with no filter) would close the gap if Chris wants that.
- **Moving attachments.** `targets` is notes only, so moving an image doesn't rewrite `![[image.png]]` embeds. Also unchanged by S5 (see the S2 review).
- **Short names match widely.** A note named `A` is found in many notes, as before, and the rewrite then changes only real links. That costs time, not correctness.
- **`[[Note\|alias]]`.** This form is found (it resolves in Rust), but `rewriteLinks` still doesn't split on `\|`. As NOTES_S5 says, that predates S5.

## Conflicts with K1 and Q1

- **K1** (`rebuild/k1-search-grok` `cacf8d0`): `git merge-tree` merges it with S5 cleanly. No shared files.
- **Q1** (`rebuild/q1-query-gemini` `fe5d143`): `git merge-tree` merges it cleanly too. The only shared file is `index.rs`, where Q1 adds `mod query;` and S5 adds `mod link_sources;` in different places. The merged file keeps both lines.

Nothing to resolve by hand in either case.
