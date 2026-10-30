# K1 review: search parity corpus (Grok)

VERDICT: OK. Nothing blocks the merge. Two small fixes are recommended (one before merge, one during the rebase), and two notes are for later tasks.

Reviewed `rebuild/k1-search-grok` (`ab19829`, `fa16171`, `d11803d` on `ca2cac0`) against `rebuild/STEP4_SEARCH_PLAN.md` §2, §6 and the K1 outline in §8. Read-only: the branch was not edited or pushed. The tests below ran on copies made with `git archive` in my session scratchpad, using this worktree's `node_modules`.

## What I checked, and how

| Check | Result |
|---|---|
| The corpus passes on the branch | `vitest run src/parity.test.ts src/shell/searchQuery.test.ts`: 347 passed. |
| `expected` is today's TypeScript, apart from the three changes the plan asks for | I ran the branch's corpus with the **pre-K1** `searchQuery.ts` (from `ca2cac0`). It used the same `searchVault` reference, with the BOM skip removed, and the old `searchFacts.ts:47` phrase filter dropped in as `termLines`. Exactly five cases fail, and they are the intended ones: `65 levels of (`, `65 levels of -`, `65 levels of [a:`, `MD does not match the extension of Upper.MD` and `BOM before frontmatter`. All other 336 cases give the same result before and after K1. |
| The moved unit tests lost no coverage | A script compared each removed assertion with its corpus case. All 26 `search(...)` assertions, including `pathQuery`, are in `search.json` on vault `obsidian-1.14.4`, with the same set of matching notes. The 5 `counts(...)` cases on vault `match-case` have the same per-note counts. Both `shownLines` cases have the same line numbers: `[2, 4]` for `alpha -beta [status]` and `[7]` for `line:(alpha beta)`. All 6 removed `parseQuery` trees are in `query.json`. The old tests' hand-written `TAGS`/`PROPS` maps now come from the text through `tagsInText` and `readProperties`, and give the same results. The tests that stay (`explainQuery`, `termsOf`, `highlightsOf`, `matchingNotes`, `propertyLine`, `spansOf`, overlap `matchCount`) are unchanged. |
| The plan's seed cases | Every parse seed in §6 is present: quotes, stray and unclosed brackets, every `OR`/`-` form, `File:`, unknown operators, `task:`, `/abc/`, `file:(a OR -b)`, `line:(file:x)`, `tag:#`, `tag:#A/B`, `path:/…/`, `path:/`, every property form including `[a:[b:c] d]` and `[ :x]`, NUL, tab, U+3000, U+FEFF, the Match case forms, depth 64/65 for `(`, `-` and `[a:`, and 10,000 words. Every match seed is present too: name versus content, `file:md`, `.MD`, the tag hierarchy, `tag:Idea` with Match case, the `line:` quirks, phrases with a tab and with two spaces, final sigma, `İ`, `ẞ`, the Kelvin sign, accents, CJK, emoji, overlapping counts, the property kinds, a duplicate key, CRLF, BOM, a trailing CR, a fence, attachments, `.canvas` and the empty colour group. 49 parse cases and 82 match cases over 7 vaults. |
| The TS reference changes | Correct, and no wider than the plan asks. Details below. |
| `parity.rs` and `parity.test.ts` | Sound. Details below. |
| Merging with `rebuild/integration` `2bb6aeb` | `git merge-tree` shows exactly the two expected conflicts. With the resolutions below, the merged tree passes `cargo test --lib` (48 passed, 1 ignored) and the same vitest files (347 passed). |

### Depth limit 64 (`searchQuery.ts`, `parseQuery`)

- **What counts as a level:** `(`, a negating `-`, a property `[` and an operator's `(`. The top-level group doesn't count, and `[[` isn't a property.
- **How a refusal works:** the token is consumed first, then `enter()` refuses it. It returns `null` at the current depth, so a run of 100,000 `(` or `-` is walked in a loop, not by recursion. That is the property the Rust port needs.
- **The `[` case is handled:** it is the one branch that refuses before consuming its token, so it does `at++` itself (otherwise the group loop would see the same `[` again).
- **The result:** `tooDeep` makes the whole query `null`, as plan D4 says.
- **Nothing else recurses:** the tree depth is bounded, so `scoped`, `leaves` and `matches` are bounded too.

### `.MD` in the name test (`searchQuery.ts`, `matches`, field `any`)

`fileName(folded).replace(/\.md$/i, "")` is right for the decided rule. It changes only the Match-case-on spelling `X.MD`. With Match case off, the path is already lower case, so the old lower-case strip already removed `.md`.

### BOM skip (`searchVault.ts`)

One leading U+FEFF is dropped before lines, tags and properties, as Rust's `parse_note` does (`parse.rs:51`). Only the reference changed. `linksTags.ts` and `frontmatter.ts` were left alone, as the outline says.

### `termLines` move (`searchQuery.ts`; used by `searchFacts.ts` and `searchVault.ts`)

In production, `searchFacts` gives the same lines as before for every input except one. The old filter checked only the phrase (`searchFacts.ts:47` at `ca2cac0`). The new one also re-checks each word, which the Rust backend had already done. The two agree, except that JS `\s` and Rust's `split_whitespace` differ on two characters:

- **U+FEFF:** JS splits on it, Rust doesn't. The result is the same.
- **U+0085 (NEL):** Rust splits on it, JS doesn't. A quoted phrase containing a NEL now needs the whole phrase, where before each piece was enough.

That only happens in a query someone pastes a NEL into, so no fix is needed. **For C1-A:** the Rust word split must use `is_js_space` (`tags.rs`), not `split_whitespace`, so that it matches the reference.

### `searchVault` details

- `rustLines` matches `str::lines`, including a bare trailing `\r`, which is kept.
- Properties go through `splitFrontmatter(lines)` + `readProperties`, as Step 3's `note_properties` does.
- Values are stringified as `searchFacts.ts:64` does. `propertyLine` adds 2.
- A null query gives `null`; an attachment gives `{}`.
- These all match §6.

### `parity.rs` / `parity.test.ts`

- **Keys:** `vaults` (file), and `vault` and `matchCase` (case), are accepted by both runners and documented in the README.
- **Validation:** `matchCase` must be a boolean. Every `search.json` case, and any case that has a `vault` key, must name an existing vault. Each vault path must be a string or an array of strings.
- **Runners:** the Rust runner maps `"query" | "search" => None`, with the files marked `"rust": "todo"` at the top, which is the right state until Q1 and C1-A. The new test `search_vault_names_are_checked_without_a_runner` covers each check.
- **Formatting:** the rest of the `parity.rs` diff is rustfmt reflowing existing lines.

## Fixes

### 1. Small, recommended before merge: take the 10,000-word case out of `query.json`

`query.json` is 1.1 MB and 51,056 lines. The `10,000 words` case alone is 410 KB even as compact JSON; every other case is under 2.5 KB. Its `expected` is a pretty-printed and-tree of 10,000 terms. Both runners load it on every run (vitest through an eager `import.meta.glob`, cargo through `read_to_string`), and it swamps every future diff of the file. My plan asked for the case, but what it needs to check is linear time, not a stored tree.

Delete the case object named `"10,000 words"` from `rebuild/app/fixtures/parity/query.json`. Then add the check as a unit test. Q1 should add the same test in Rust (`tests.rs`), with `parse_query`.

```diff
--- a/rebuild/app/src/shell/searchQuery.test.ts
+++ b/rebuild/app/src/shell/searchQuery.test.ts
@@ -38,4 +38,11 @@ describe("search query", () => {
   it("asks the backend for each term once", () => {
     expect([...termsOf(parseQuery('alpha -beta tag:#x line:(c "d e") file:f [p:q]'))]).toEqual(["alpha", "beta", "#x", "c", "d e"]);
   });
 
+  it("parses a 10,000-word query into one and of every word", () => {
+    const q = parseQuery(Array.from({ length: 10_000 }, (_, i) => `w${i}`).join(" "));
+    expect(q?.op).toBe("and");
+    expect(q && "parts" in q && q.parts.length).toBe(10_000);
+    expect(q && "parts" in q && q.parts[9_999]).toEqual({ op: "term", text: "w9999", field: "any" });
+  });
+
   it("highlights the words that were looked for, not the ones excluded", () => {
```

There is no time limit in the test, because a timing check would be flaky on this shared machine. A quadratic parser would still show up as a slow test.

### 2. Small, during the rebase onto `rebuild/integration`: let the name test use `noteName` again

Step 3 (now in integration at `2bb6aeb`) made `noteName` strip `.md` in any case (`paths.ts:7`). K1's local regex and its comment ("`noteName` only strips a lowercase `.md`") are now redundant and stale. NOTES_K1's "Left open" item about `noteName` is already done. After the rebase:

```diff
--- a/rebuild/app/src/shell/searchQuery.ts
+++ b/rebuild/app/src/shell/searchQuery.ts
@@ -20 +20 @@
-import { compareNames, fileName, isUnder } from "../paths";
+import { compareNames, fileName, isUnder, noteName } from "../paths";
@@ -289,3 +289,2 @@
     case "any":
-      // `.md` in any case is the extension, not part of the name. `noteName` only strips a lowercase `.md`.
-      if (fileName(folded).replace(/\.md$/i, "").includes(q.text)) return true;
+      if (noteName(folded).includes(q.text)) return true;
```

The behaviour is the same, so the corpus stays green, including `Upper.MD by name, match case`.

## Resolving the conflicts with `rebuild/integration` (`2bb6aeb`)

Both come from Step 3, which registered the `properties` runner.

**`rebuild/app/src-tauri/src/index/parity.rs`, in `runner()`:** keep integration's `properties` line and K1's two new lines, and drop the old step 3 comment and `None`:

```rust
        "properties" => Some(properties),
        // No Rust query parser or search evaluator yet (plan step 4). Both files must say `"rust": "todo"`.
        "query" | "search" => None,
```

**`rebuild/app/fixtures/parity/README.md`, the file table:** keep integration's `properties.json` row and add K1's two rows:

```text
| `properties.json` | `splitFrontmatter` + `readProperties` (`src/editor/frontmatter.ts`); the runner drops `line` and `count` | `note_properties` (`index/props.rs`); the runner drops `line` and `count` |
| `query.json` | `parseQuery` (`src/shell/searchQuery.ts`) | none yet (plan step 4). Top-level `"rust": "todo"` |
| `search.json` | `searchVault` (`src/shell/searchVault.ts`) | none yet (plan step 4). Top-level `"rust": "todo"` |
```

Everything else merges cleanly. I checked these exact resolutions on a scratch copy of the merged tree: `cargo test --offline --lib` passed (48 passed, 1 ignored), as did `vitest run src/parity.test.ts src/shell/searchQuery.test.ts` (347 passed). After the merge, `fileName` is still used in `searchQuery.ts` (`file:`), so the import change in fix 2 is all that's needed.

## Notes for later tasks (no change needed in K1)

- **Q1 and C1-A:** split words with `is_js_space`, and lower-case with Rust `to_lowercase`. Both were checked equal to JS for every code point (STEP4_SEARCH_PLAN §9).
- **Q1:** keep the token-consumed-then-refused shape of `enter()` exactly. A port that recurses before checking depth would bring back the stack overflow.
- **C1-B:** the mock should call `searchVault` (it isn't wired in yet; K1 left the mock alone, as the outline said).

## K1 fix check

VERDICT: OK. Both review items are fixed as proposed, and the merge with integration keeps both sides. Nothing more is needed before K1 merges.

Checked `rebuild/k1-search-grok` at `cacf8d0`: `e428c6f` (a `--no-ff` merge of `rebuild/integration` `2bb6aeb`, no rebase), `449a87d` (the fixes) and `cacf8d0` (`NOTES_K1F.md`). Read-only. The tests ran on a `git archive` copy of `cacf8d0` in my scratchpad.

- **`index/parity.rs`, merge resolution:** `runner()` has Step 3's `"properties" => Some(properties)` plus K1's comment and `"query" | "search" => None`. The old step 3 `None` and its comment are gone. Step 3's `properties` runner function and K1's `search_vault_names_are_checked_without_a_runner` test are both present. This is the resolution the review gave.
- **`fixtures/parity/README.md`, merge resolution:** the file table keeps integration's `properties.json` row (`note_properties` in `index/props.rs`) and adds K1's `query.json` and `search.json` rows. The rest of the README keeps K1's new key docs.
- **Fix 1:** the `"10,000 words"` case is gone (`449a87d`, −50,010 lines). `query.json` is now 48 cases and 52 KB, down from 1.1 MB. `searchQuery.test.ts` has the proposed unit test, character for character, with no time limit.
- **Fix 2:** `matches` uses `noteName(folded)` again, the stale comment is gone, and `noteName` is back in the `../paths` import, exactly as in the patch.
- **Tests on `cacf8d0`:**
  - `npx tsc --noEmit` exits 0;
  - `vitest run src/parity.test.ts src/shell/searchQuery.test.ts src/mock/backend.test.ts`: 349 passed, including `Upper.MD by name, match case` and the new 10,000-word test;
  - `cargo test --offline --lib`: 48 passed, 1 ignored.

  Grok's full `npm test`, build and audit runs are in `NOTES_K1F.md`.

**One thing to know when merging.** `33524d2` committed the first version of this review to the K1 branch as `rebuild/NOTES_K1-REVIEW.md`. It is identical to this file as it was before this section was added. Once K1 is in integration, this worktree's uncommitted copy (with this section) will collide with the committed one on the next pull. Keep this longer version: commit it on top, or append this section to the committed file.
