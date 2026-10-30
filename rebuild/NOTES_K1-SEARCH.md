# K1: search parity corpus

On `rebuild/k1-search-grok`, 2026-10-29. Local commits only. Nothing pushed.

## What changed

Two commits on top of `ca2cac0`.

- `ab19829` Add the search parity corpus and the vault reference. 9 files, +53010 / −116.
- `fa16171` Limit query depth, strip .MD from names, and skip a leading BOM. 4 files, +59 / −21.

Net against the parent of `ab19829`:

| File | Added | Removed |
| --- | ---: | ---: |
| `rebuild/app/fixtures/parity/README.md` | 14 | 3 |
| `rebuild/app/fixtures/parity/query.json` | 51056 | 0 |
| `rebuild/app/fixtures/parity/search.json` | 1631 | 0 |
| `rebuild/app/src-tauri/src/index/parity.rs` | 128 | 4 |
| `rebuild/app/src/parity.test.ts` | 38 | 7 |
| `rebuild/app/src/shell/searchFacts.ts` | 9 | 4 |
| `rebuild/app/src/shell/searchQuery.test.ts` | 10 | 98 |
| `rebuild/app/src/shell/searchQuery.ts` | 63 | 6 |
| `rebuild/app/src/shell/searchVault.ts` | 105 | 0 |

`query.json` is about 1.1 MB because one case is a 10,000-word and-tree. It has 49 parse cases. `search.json` has 82 cases over 7 vaults: `obsidian-1.14.4`, `match-case`, `names`, `tags`, `props`, `text`, `unicode`.

## Corpus

Both new files have top-level `"rust": "todo"`. The Rust runner checks that the JSON is well-formed and that each search `vault` names a vault. It does not parse queries or evaluate search. The `query` and `search` runners in `parity.rs` stay `None`.

Both runners and `fixtures/parity/README.md` accept three new keys: file-level `vaults`, case `vault` (required on a search case), and `matchCase` (boolean, default false). Unknown keys still fail the runners.

`expected` is today's TypeScript. There are no `obsidian` result objects. The note on `task:x` cites `help.obsidian.md/plugins/search` from prior knowledge for operators Grove does not implement (`task:`, `block:`, `section:`). That page was not fetched, and no Obsidian result was invented. `/abc/` is recorded as the word `/abc/`.

The cases that used to live in `searchQuery.test.ts` (the 25 `search()` assertions, path query, shown lines, parse trees, and the eight `counts()` cases) are in the corpus. The unit file keeps `explainQuery`, `termsOf`, `highlightsOf`, `matchingNotes`, `propertyLine`, `spansOf`, and the overlap `matchCount` check.

## Reference

`searchVault` searches `{ path: text }`. A note is a path matching `/\.md$/i`, so `Upper.MD` is a note. A non-note that passes is an attachment and maps to `{}`: no lines, tags, or properties. A query that parses to nothing returns null. `matches` treats a null query as every file; the search view must show nothing, so `searchVault` returns null first.

Lines follow Rust `str::lines`. Split on `\n`, drop a final empty piece, and drop a `\r` only when it was the character before `\n`. A trailing `\r` with no `\n` stays. That split was checked with `rustc` against `str::lines` for `""`, `"\n"`, `"a\n"`, `"a\n\n"`, `"\r"`, `"hello\r"`, `"a\r\n"`, and `"a\r\nb\r"`. A query cannot contain `\r` or U+FEFF, because both are JavaScript `\s` and `trim` removes them. The corpus sees the kept CR by matching `hello` in `Bare.md`, whose text is `hello` plus `\r`.

Properties come from `splitFrontmatter` on those lines plus `readProperties`. Values are stringified; an array value is mapped per item. Tags come from `tagsInText` on the same source text. `propertyLine` adds 2 to the frontmatter body line index. Paths are sorted with the default JavaScript sort. Content lines and per-term hits are cached.

`termLines` in `searchQuery.ts` is the phrase filter that used to sit in `searchFacts.ts`. Each word must occur, compared in lower case. The whole phrase is required when Match case is on or the term contains a space. A tab is whitespace for the word split and is not a space, so a tab-separated term skips the phrase check unless Match case is on. `"a  b"` still requires the contiguous phrase. `searchFacts` still drops hits at line 0 or below, groups by path, calls `termLines`, and drops a path whose lines come back empty. The old unit tests handed `facts.lines` a word list and did not require the contiguous phrase. The corpus uses the real rule: `"star wars"` matches `A.md` line 8 and misses `wars star reversed`.

`photo` matches `photo.png` because the name test only strips `.md`. The mock searches canvas JSON as text. This reference does not. That is a note on the case, not an `obsidian` value.

While the fixtures were generated, the old name-sets (`alpha` → A, B, C, Props, Roadmap, and the rest of the moved assertions) were checked against `tagsInText`. The generator was deleted before `ab19829`.

## The three TypeScript changes

The first commit stored these as `"ts": "todo"`, with `expected` set to the new behavior, so the runner asserted that today's result still differed. The second commit implements them and removes the five markers.

1. Depth 64. `parseQuery` counts `(`, a negating `-`, a property `[`, and the `(` after an operator such as `file:(...)`. The top-level group is not counted. `[[wikilink]]` is not a property. Deeper than 64 is nothing to search for, which keeps a Rust port off a stack overflow. The opening token is consumed before a failed enter returns, so the group loop cannot see that token again. 64 parentheses unwrap to the term `a`. 64 negations and 64 nested `[a:` properties still parse. 65 of each is null.

2. The name test for field `any` is `fileName(folded).replace(/\.md$/i, "")`. It lives in `matches` only. `paths.ts` `noteName` still strips a lowercase `.md`. `is_note_path` already accepts `.md` in any case and was not edited. With Match case off, the path is folded, so `.MD` was already removed by the lowercase strip, and `upper` still matches `Upper.MD`. With Match case on, `MD` does not match `Upper.MD` (the body has no `MD`). `Upper` still matches the stem. `file:md` still matches every note, including `Upper.MD`, because `file:` uses the file name.

3. `searchVault` drops one leading U+FEFF before it splits lines, reads tags, or reads properties. `linksTags.ts` and `frontmatter.ts` are unchanged. `splitFrontmatter` already trims U+FEFF, so `[status:bomdraft]` matched before this skip. `tagsInText` requires the text to start with `---`, so `tag:bomtag` matches only after the skip. The shown term is `#bomtag`, which the note does not contain, so the match is count 0 and lines `[]`. `bombody` stays line 5, because the BOM is a prefix of line 1.

## Parser facts recorded from today's TypeScript

These were measured by running `parseQuery` and `searchVault`, then locked in by the parity tests.

- A NUL stops the top-level group, whose stop character is `\u0000`. `a \u0000 b` is the term `a`.
- `tag:#` is an empty tag term. The empty check runs before `#` is stripped. It matches no stored tag.
- `path:/` is an empty path term after the slashes are stripped. Every path contains the empty string, so every file matches. `path:""` is null, because the text is empty before `term()`.
- `tag:a/` does not match a tag stored as `a`. The stored tag drops a trailing slash; the query term keeps it. `tag:a` matches Slash.md.
- `[a:[b:c] d]` keeps the word `d]`. The inner property clears the in-property flag on the way out, so `]` does not end that word.
- `[[wikilink]]` is one word. `]` ends a word only inside a property. A stray `)` outside a property is skipped.
- `--a` is not(not(a)). `- a` and a lone `-` are the word `-`.
- `OR a` drops the leading OR. `a OR` drops the trailing OR. `a OR OR b` is or(a, b). `-OR` is null. `ORANGE OR` is the word `orange`.
- `"İstanbul".toLowerCase()` is `i` plus U+0307. `"Σ".toLowerCase()` is `σ`, and `"ΑΣ".toLowerCase()` is `ας`, so a match-case term `Σ` matches a line that is `Σ` and misses a line that is `ΑΣ`. `"ẞ".toLowerCase()` is `ß`. Kelvin `K` lowercases to `k`. `é` (U+00E9) is a different string from `e` plus U+0301.
- A repeated property key makes `readProperties` return null, so `[status]` misses Dup.md. An empty `status:` is the value `""`, and `[status]` matches it.

## Left open

- Rust still has no query parser and no search evaluation. Both files stay `"rust": "todo"`. Q1, C1, B1, and F1 are later jobs. No bench, and no differential fuzz.
- `noteName` in `paths.ts` still strips only a lowercase `.md`. Search is the only caller that strips `.MD`. A global change was out of scope. Worth a decision if other surfaces should treat `Upper.MD` the same way.
- `tagsInText` still requires its input to start with `---`. Search skips one leading BOM before calling it. The tag index does not. `linksTags.ts` was left alone.
- No Obsidian result was verified in this session. An `obsidian` value needs a recorded run.

## Tests

From `rebuild/app`, after the behavior change and with the five `"ts": "todo"` markers removed:

- `npx tsc --noEmit`: exit 0.
- `npx vitest run src/parity.test.ts src/shell/searchQuery.test.ts src/readOrdering.test.ts`: 3 files, 360 tests passed (parity 341, searchQuery 6, readOrdering 13).

After `fa16171`:

- `npm run build`: passed.
- `npm test` under `flock /tmp/grove-npm-test.lock`: exit 0. Browser discovery 4 passed, 0 failed. Vitest 58 files, 660 tests passed. The canvas timing check passed on the first run: `300-card drag frames under 20ms (max 16.8ms, 48 intervals)`. No rerun. Posttest `test-bases-config.mjs` passed (`Configure view: frame 1, max 16.8ms`).
- `npm run audit:offline`: passed, 166 source files.
- From `rebuild/app/src-tauri`, `cargo build --offline` and `cargo test --offline`: both passed. `grove_lib` 45 passed, 1 ignored (`index::bench::bench_vault`), the binary 0, doc-tests 0. The registry was not contacted. The same offline cache served `cargo test --offline --lib index::parity` before the first commit: 3 passed (corpus, todo markers, vault names).

Screenshot fixtures the suite rewrote under `rebuild/round*-shots` were restored with `git checkout` and are not in these commits. No bench numbers. B1 is a later job.
