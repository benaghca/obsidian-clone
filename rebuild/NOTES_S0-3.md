# S0-3: shared parity corpus (plan step 0.3)

Branch `rebuild/n-claude-a`, 2026-10-27. App behaviour is unchanged: tests, fixtures and docs only.

## What changed

One shared set of test cases for rules that TypeScript and Rust both implement. Both sides run every case, so the two copies can't drift unnoticed. TS is the spec, so `expected` is what TS returns today. Cases Rust fails today carry `"rust": "todo"`, and that marker is checked strictly: if Rust starts passing, the test fails until the marker is removed. Cases where Obsidian probably differs from today's TS carry an `obsidian` value and a `note`. Those are decisions for Chris (below).

| File | Lines | What |
|---|---|---|
| `app/fixtures/parity/README.md` | +55 | The format, the todo/obsidian rules, and how to add a file or a case. Room is left for `properties.json` (step 3) and `query.json` (step 4). |
| `app/fixtures/parity/tags.json` | +104 | 46 cases for `tagsInText`. The file is marked `"rust": "todo"`: Rust has no tag code yet (step 1 adds it). |
| `app/fixtures/parity/links.json` | +114 | 27 cases: `wikilinkTargets` against `parse_note`'s non-markdown links. 10 are `rust: todo`. |
| `app/src/parity.test.ts` | +66 | vitest runner (`import.meta.glob` over the folder). It checks the format and runs each case. Every corpus file needs a TS runner. |
| `app/src-tauri/src/index/parity.rs` | +151 | cargo runner (reads the folder at test time, `serde_json`). It does the same checks and has a self-test for the todo/typo/mismatch handling. |
| `app/src-tauri/src/index.rs` | +2 | `#[cfg(test)] mod parity;` |

The total is 492 lines added and 0 removed. There are no new dependencies. The fixtures sit outside `src/` and the offline audit doesn't scan test files, so the example URL in one case is not shipped.

I checked that both runners can fail. Changing one `expected` makes vitest fail. Removing a todo the case still needs, or leaving one on a case that now passes, makes cargo fail with a message saying which.

## Test results

- `npx vitest run src/parity.test.ts`: 76 passed. That is 46 + 27 cases, 2 format checks and the files ↔ runners check.
- `cargo build`: ok. `cargo test`: 39 passed, including `index::parity::corpus` and `index::parity::todo_markers_are_checked`.
- `npm run build`: ok. The >1000 kB chunk warning was already there.
- `npm test` (full: vitest plus every browser, geometry, mouse and round script, then `posttest`): exit 0, vitest 54 files and 376 tests passed, no script failures, no reruns needed.
- `npm run audit:offline`: passed (164 source files, dist/, CSP, capabilities and dependencies).

## The divergences from plan §1, as the corpus records them

It turned out there are **three** fence rules in the code, not two:

- **A**: `tagsInText`'s `Fences` class (`src/shell/linksTags.ts`). Opens on `^ {0,3}` plus 3 or more of the same marker, with no backtick in a backtick fence's info string. Closes on the same marker, at least as long, indented at most 3 spaces, with nothing after it. This is CommonMark's rule.
- **B**: Rust's `fence_open` / `fence_close` (`index/parse.rs`). Like A, except that it opens after up to 3 characters of *any* whitespace (tabs too) and closes at *any* indent.
- **C**: `wikilinkTargets`' `FENCE = /^[ \t]*(```|~~~)/` (also `linksTags.ts`, used by the Outgoing links view). It toggles on any line that starts with ``` or ~~~ after any indent, whatever the marker, length or trailing text.

The browser mock's `linkIndex` (`src/mock/backend.ts`) is a fourth link reader. It skips neither fences nor inline code. It isn't a pure function, so the corpus doesn't cover it.

| Divergence | TS today | Rust today | Obsidian, most likely | Cases |
|---|---|---|---|---|
| Fence opened after a tab | Tags (A): not a fence. Links (C): a fence. | A fence (a tab counts as 1 of the 3 allowed characters) | Not a fence: CommonMark counts a tab as 4 columns, which makes the line indented code | tags "fence indented with a tab…", links "fence indented with a tab" |
| Fence opened after 4 spaces | A: not a fence. C: a fence. | Not a fence | Not a fence | tags "fence indented 4 spaces…", links "fence indented 4 spaces" (`rust: todo`) |
| Closing fence indented 4 spaces | A: does not close (the block runs to the end). C: closes. | Closes | Does not close | tags "closing fence indented 4 spaces…", links "closing fence indented 4 spaces" |
| Closing fence with text after it | A: does not close. C: closes. | Does not close | Does not close | tags + links "closing fence with text after it" (links `rust: todo`) |
| Fence closed by the other marker or a shorter fence | A: no. C: yes. | No | No | tags "the other marker…", "a shorter fence…"; links "(TS)" cases (`rust: todo`) |
| Backtick in a backtick fence's info string | A: not a fence. C: a fence. | Not a fence | Not a fence | tags + links "a backtick in a backtick fence's info string" |
| Inline code | Tags: blanks single-backtick pairs only (`` `[^`]*` ``), so ``` ``#a ` #b`` ``` gets split at the inner backtick. Links (C): **no inline-code skipping at all**. | CommonMark code spans of any backtick run length | CommonMark code spans | tags "double-backtick inline code"; links "inline code", "double-backtick inline code" (`rust: todo`) |
| Unicode in tags | `[\p{L}\p{N}_/-]`: stops at combining marks (decomposed `é`), Devanagari vowel signs (`#हिंदी` → `ह`), emoji and `。` | No tag code yet | Believed to be a denylist: anything except whitespace, ASCII punctuation (other than `_ - /`) and U+2000–206F / U+2E00–2E7F. That keeps marks, emoji and `。`. This is the pattern community plugins quote; **verify in Obsidian** | tags "combining accent…", "Devanagari…", "emoji", "CJK full stop" |
| Link parsing implemented twice | `wikilinkTargets`: cuts at `^` as well as `#`/`\|`; keeps `\` in a table's `[[Note\|alias]]`; allows `[` in a target | Cuts at `\|`/`#` only; reads `\|` as an escaped pipe; skips targets with brackets | `[[Note\|alias]]` in a table → `Note`; the `^` and `[` cases are unverified | links "^ without #", "escaped pipe in a table cell", "a [ inside the target" (`rust: todo`) |

Two more differences turned up while writing cases. Both are recorded with an `obsidian` value or a note:

- **BOM before frontmatter**: TS doesn't see the frontmatter, so it misses its tags. Rust's `parse_note` strips the BOM first. Obsidian most likely reads the frontmatter.
- **Indented code blocks**: TS has no rule for them, so `    #tag` after a blank line counts as a tag. Obsidian probably doesn't tag inside indented code. Unverified, so no `obsidian` value is given.

## Decisions for Chris

1. **Which fence rule is the spec?** In TS, tag reading (A) already matches CommonMark and very likely Obsidian. The Outgoing links view (C) is the outlier. Recommendation: make A the one rule. Fix C in TS, and later fix B's tab and close-indent cases in Rust. That means some TS behaviour changes, so it's yours to approve. Today the corpus encodes C as `expected` for links and marks Rust `todo` wherever Rust disagrees with C. In most of those cases Rust is the one closer to Obsidian. Nobody should "fix" Rust towards those `expected` values: the README says so, and every such case carries an `obsidian` value.
2. **Links in inline code**: `CONTRACT.md` says they are skipped, and Rust skips them, but `wikilinkTargets` doesn't. The recommendation is to fix TS.
3. **Unicode tag characters**: keep TS's letters-and-digits allowlist, or switch to Obsidian's denylist? Check a few cases in Obsidian first (decomposed `é`, `#हिंदी`, `#🙂`, `#tag。`). Step 1 (tags in Rust) has to know the answer, because a hand-written Rust port has to pick one.
4. **Smaller ones, all unverified in Obsidian**: trailing `/` dropped from tags; `Tags:` (capital T) read as tags; `(#e)` not a tag; `[[C^abc]]` cut at `^`.

## Left for later

- `properties.json` (step 3) and `query.json` (step 4). The planned shape is in the README.
- Markdown-link targets and link *resolution* (`resolveLink` against `Index::resolve`) have no corpus file yet. A `resolve.json` would need a small vault per case (an extra case key, documented in the README as the way to extend).
- Obsidian checks (the plan gives these to Grok): every `obsidian` value and every "unverified" note.
