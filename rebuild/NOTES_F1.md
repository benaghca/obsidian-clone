# F1 — parity review of C1-A

2026-10-29. Branch `rebuild/f1-fuzz-grok`, starting at `4d02300` (C1-A). No merge and no rebase. Rust and TypeScript sources are unchanged. The harness stays in `/tmp/grove-f1-fuzz` and is not committed.

## What changed

- `rebuild/app/fixtures/parity/search.json`: +66 lines. New vault `dot-name` (`.MD` containing `secretprobe`, `Real.md` containing `secretprobe also`) and three cases. Expected values are `searchVault`. Each case has `"rust": "todo"`.
- This notes file.

Search cases go from 82 to 85. The corpus goes from 334 cases to 337. The three new cases are the only `rust: todo` markers on `search.json`.

## Differential fuzz

50,012 queries: 50,000 random queries over 200 vaults, plus 12 probes. Each vault plants the §6 shapes (upper-case `.MD` with a real basename, fences, BOM, CRLF, a trailing CR, final sigma, `İ`, `ẞ`, Kelvin sign, decomposed accent, CJK, emoji) and 8–25 more files. Queries mix terms, phrases, OR, negation, `line:`, `file:`, `path:`, `tag:`, `content:`, properties, and match case. The alphabet includes those characters. Parse trees and search results are both compared. The Rust side is `parse_query`, `search_notes`, `search_lines`, and `search_match` over a real `Index::scan` of each vault.

| Check | Count |
|---|---|
| Parse mismatches | 0 |
| Search mismatches | 10 |
| Throws | 0 |
| Panics | 0 |
| Empty-query failures | 0 |
| Path-order failures | 0 |

The 50,000 random queries matched on parse and search. Progress at 50,000 was `parse_bad=0` and `search_bad=0`. The 10 search mismatches are the probes below. Path order means `search_notes` and `search_match` already returned paths in byte order (`index/search.rs` walks the `BTreeMap` at lines 18–20 and 90–96). An empty parse returns an empty list from all three (`search.rs:14–16`, `47–48`, `86–88`). The commands stay `Ok` for that: `lib.rs:329–358` wraps the core in `Ok`, and `with_vault` (`lib.rs:129–135`) returns an error only for `"no vault open"`.

### Probe vault 900: a file whose whole name is `.MD`

`is_note_path` (`index.rs:532–536`) requires the basename to be longer than 3 characters. `.MD` fails that test. `searchVault` uses `/\.md$/i` (`searchVault.ts:16`), so the same file is a note. `file:md` with match case agrees, because `.MD` does not contain the lowercase letters `md`.

| Query | Match case | Reference | Rust |
|---|---|---|---|
| `secretprobe` | off and on | `.MD` and `Real.md`, count 1, line 1 | `Real.md` only |
| `file:md`, `file:MD` | off | both files as notes, count 0, line 1 | `.MD` is `{}`, `Real.md` is a note |
| `file:MD` | on | `.MD` as a note, count 0, line 1 | no hit (`search_notes` drops `.MD`; `Real.md` does not contain `MD`) |
| `path:.MD` | off | both files as notes, count 0, line 1 | `.MD` is `{}`, `Real.md` is a note |
| `path:.MD` | on | `.MD` as a note, count 0, line 1 | no hit, same reason as `file:MD` |

The parity runner (`parity.rs:102–105`) records a non-note that still passes as `{}`. For `file:MD` and `path:.MD` with match case, cargo therefore sees `{".MD": {}}` where the reference sees a note. The three corpus cases cover the content split, the any-case note-versus-attachment split, and the match-case split. The `path:.MD` rows are the same two shapes; their notes say so.

`Upper.MD` in the existing `names` vault has a basename longer than `.MD` and already matches. The random vaults used the same kind of name. This edge is only the three-character name.

### Probe vault 901: the 8 MB ceiling

`MAX_INDEX_BYTES` is 8 MiB (`index.rs:29`). `insert_file` (`index.rs:467–470`) stores an empty note when the file is larger, so the name still matches and the body does not. `searchVault` reads the whole text. The plan already says notes over 8 MB match by name only (§9). The body was not added to `search.json`.

`HugeName.md` is `UNIQUEBODYWORD` plus 8 MiB of `x` on a second line. `Small.md` is `UNIQUEBODYWORD`.

- `hugename` matches `HugeName.md` on both sides by name, with no body lines.
- `UNIQUEBODYWORD` and `content:UNIQUEBODYWORD` match both files in the reference (count 1, line 1) and only `Small.md` in Rust.
- `file:md` includes both files on both sides, count 0. The reference shows lines `[1, 2]` for `HugeName.md`. Rust shows `[]`, because the indexed note has no lines.

## Shadow check

Old path: `Index::search` per term from `termsOf`, capped, then `matches`, `shownLines`, and `matchCount`. Name hits (`line <= 0`) are dropped after the cap, as `searchFacts.ts:42–47` does. New path: `search_notes` plus `search_lines`. The query set is §7 plus every `search.json` input.

First run, 86 queries, before the new cases existed: sample vault 77 same, 3 cap, 6 other; 5,000-note vault 74 same, 9 cap, 3 other. Throws, panics, and empty results were 0 on both. A second run after the corpus edit had 88 queries. `secretprobe` and `file:MD` with match case were the two additions, and both agreed on both vaults. The cap and other counts stayed the same.

Sample vault: `sampleVault()`, 12 indexed entries, 7 notes, cap `max(2000, 12 * 4) = 2000`, under `/tmp/grove-f1-fuzz/sample-vault`. Bench vault: the existing `/tmp/grove-bench-5000` (5,000 notes, 5,125 entries, cap `max(2000, 5125 * 4) = 20500`). It was read and not regenerated. Its SHA-256 is the one in `NOTES_C1A.md`.

A row is cap when the same old path with `limit = u32::MAX` equals the new result. `Index::search` (`index.rs:225–237`) spends the budget on name hits before line hits, and the old path then discards `line <= 0`, so the line budget is smaller than the number passed in.

Sample cap queries: `e`, `line:(a OR b)`, `K`. Bench cap queries: `meeting`, `garden river`, `"garden path"`, `line:(garden river)`, `e`, `line:(a OR b)`, `"a b"`, `"a\tb"`, `K`. These are the rows the old 2,000 / 20,500 cap cuts short. The new evaluator has no such cap.

The other rows keep the same notes and a count of 0. The old shown lines are `[]`. The new shown lines are every content line.

Sample: `file:roadmap`, `file:2026`, `path:proj`, `path:"Projects" ` (trailing space, as `pathQuery` writes it), `file:md`, `path:/`. Bench: `file:2026`, `file:md`, `path:/`. On `file:md` and `path:/` the note counts are 7 and 7 on the sample vault, and 5,000 and 5,000 on the bench. No note was added or removed.

`textOf` returns null for `file:` and `path:` (`searchQuery.ts:186`), so `termsOf` (`searchQuery.ts:189–194`) never asks the old search for those words. `shownLines` (`searchQuery.ts:300–307`) then asks `facts.lines("")`. `termLines` of the empty string keeps every line, which is what `searchVault` shows. The old path has no hit list for `""`, so it shows nothing. `Plan::new` (`search.rs:230–233`) keeps that empty-term quirk, and the fuzz matched `searchVault` on `file:` and `path:` queries. The corpus already expects the full line list (`file:md matches every note`, `file:md includes Upper.MD`). These rows are the old path's gap. They are not cases against the evaluator.

Section 7 content, tag, and property queries were same or cap. None of them landed in the other list.

## C1-A against the plan

Reading and the fuzz agree with the plan on these points.

- Path order is `BTreeMap` order. `search_notes` iterates `self.files` (`search.rs:18–20`). `search_lines` returns a `BTreeMap` (`search.rs:50`). `search_match` iterates `self.files` (`search.rs:90–96`). The harness found 0 ordering failures. Rust does not sort for display.
- Nothing to search returns `[]` from the core and `Ok` from the commands (`search.rs:14–16`, `47–48`, `86–88`; `lib.rs:329–358`). The only command error is `"no vault open"` (`lib.rs:129–135`).
- A normal upper-case `.MD` note is indexed. `is_note_path` (`index.rs:532–536`) accepts `Upper.MD`, and `search_notes` filters with it (`search.rs:20`). The whole-name `.MD` edge above is the exception.
- Notes over 8 MB are name-only (`index.rs:29`, `index.rs:467–470`), which is what the plan describes.
- A property's shown line is the frontmatter line. `shown_lines` writes `out[p.line + 1]` (`search.rs:425–433`), so the displayed number is `p.line + 2`, the same as `propertyLine` (`searchQuery.ts:327–329`). The fuzz did not disagree on property lines, checkbox text, or highlight counts.
- The three commands are async (`lib.rs:329`, `339`, `353`). `build.rs:20–22` registers them. `capabilities/default.json:24–27` allows them. The generated files are `permissions/autogenerated/search_notes.toml`, `search_lines.toml`, and `search_match.toml`.

Payload size and debug/release ratios are already in `NOTES_C1A.md` (release `meeting` is 292,520 bytes; the line-group debug/release ratio is 6.12×). This review did not bench again.

Q1's known TypeScript throws stayed out of the corpus. `scoped` (`searchQuery.ts:163–175`) can build `{op:"not", part:null}` for `file:(-tag:#)`, and `file:(path:(-tag:#))` throws inside `parseQuery`. Rust returns `None`. This fuzz threw 0 times. `searchQuery.ts` was not edited, and those strings were not added as cases that would crash the TypeScript runner.

## Checks

All of these held `/tmp/grove-npm-test.lock`. Cargo used `--offline`. The registry was not contacted.

- `cargo build --offline`: passed.
- `cargo test --offline`: 52 passed, 0 failed, 2 ignored (vault bench and search-command bench). The corpus test passed, so the three `rust: todo` markers still differ from Rust and are not stale.
- `npm run build`: passed. The existing large-chunk notice is still there.
- `npm test`: vitest 58 files, 668 tests, all passed, including `parity.test.ts` (343 tests). Browser discovery, geometry, and the browser scripts through `test-canvas-editing.mjs` passed on the first run except the known 300-card drag frame check. That check reported max 33.3 ms against the 20 ms limit. One rerun of `scripts/test-canvas-editing.mjs` under the lock passed, max 16.8 ms. The assertion was left as it is. The scripts after that point, plus `posttest` (`test-bases-config.mjs`), passed on the continuation. The 1000-row Bases scroll did not fail.
- `npm run audit:offline`: passed, 166 source files plus dist, CSP, capabilities, and dependencies.

## Open

Chris decides whether a file whose entire name is `.md` or `.MD` is a note. The reference says yes. `is_note_path` says no. The three `dot-name` cases stay `"rust": "todo"` until that matches. Removing the marker while Rust still differs fails `cargo test`, and making Rust match without removing the marker fails it too.

The 8 MB name-only result stays a reference gap: `searchVault` has no ceiling, and the plan already calls the ceiling current behavior. The `file:` / `path:` shown-line gap belongs to the old `termsOf` path. The evaluator already matches `searchVault` there.

## Follow-up after the C1-A fix

Merged `rebuild/c1a-search-codex` (`bcb430d`, parent review `80a9a40`) with `git merge --no-ff`. No rebase. `search.json` merged cleanly: Codex's eight `file:` / `path:` expected values and the three `dot-name` cases are both present. Merge commit `98d40c9`.

The fix makes `searchVault` return no lines for an empty term (`searchVault.ts`, the `lines` lookup), and `Plan::new` no longer asks for `""` (`index/search.rs`). `file:` and `path:` matches stay, with `lines: []` and count 0.

Regenerated the three `dot-name` expected values with that `searchVault`. `secretprobe` is unchanged: both notes still show line 1. `file:md` and `file:MD` with match case now have `lines: []`. Their notes say that, instead of saying a content line is shown. `"rust": "todo"` stays on all three. Whether a file named exactly `.md` / `.MD` is a note is still open. No other case was edited.

Checks, each under `flock /tmp/grove-npm-test.lock`. Cargo used `--offline`. The registry was not contacted. The full `npm test` was skipped; it runs at merge time.

- `npm run build`: passed. The existing large-chunk notice is still there.
- `npx vitest run`: 58 files, 668 tests, all passed, including `parity.test.ts` (343 tests).
- `cargo test --offline`: 52 passed, 0 failed, 2 ignored. The corpus test passed, so the three `rust: todo` markers still differ from Rust.

## A file named .md is not a note

Chris decided this on 2026-10-29 at 8:15 PM PT. A file whose whole name is `.md` or `.MD` is not a note. The name has to have characters before the extension. Rust already used that rule. TypeScript now uses it too. The "Open" section above is the question as it stood; this section is the decision.

`isNoteFile` (`paths.ts:12–15`) matches `is_note_path` (`index.rs:532–536`). The basename is longer than 3 characters, and the last three characters are `.md` in any ASCII case. `.md` and `.MD` fail that test. `Upper.MD`, `a.md`, and `..md` pass. `noteName` (`paths.ts:18–21`) drops those three characters only when `isNoteFile` says the path is a note, the same way `strip_md` does (`index.rs:592–598`). A file named `.MD` keeps the label `.MD`.

`searchVault` takes its note list from `isNoteFile`. A nameless `.md` file that still passes `file:` or `path:` is an attachment, recorded as `{}`. The same helper is what the file list, graph, bases rows, tags, backlinks, menus, the sidebar extension badge, hover preview, canvas file cards, live-preview embeds, and the mock backend use. A link whose target is exactly `.md` does not create a note (`workspace.ts` `openLink`, `editorHost.ts` `linkCandidates`), and a target that already ends in `.md` is not given a second `.md`.

A few call sites used to require a case-sensitive `.md`. They now treat `Upper.MD` as a note: graph membership (`graph/source.ts`), bases rows (`bases/view.ts`), tags in the open note (`tagsView.ts`), the file menu (`menus.ts`), unlinked mentions (`backlinksView.ts`), and the mock `frontmatter` and `tags` commands. The sidebar badge no longer labels `Upper.MD` with an extension. A nameless `.md` file does get that badge. `settings/sections.ts` still strips a case-sensitive `.md` from paths that are already in `vault.notes`. That list already contained `Upper.MD`, and the extension was already left on there. Rust is unchanged. `searchQuery.ts` is unchanged.

The three `dot-name` cases in `search.json` no longer carry `"rust": "todo"`. Their expected values are the shared result:

- `secretprobe`, match case off or on: only `Real.md`, count 1, line 1.
- `file:md` with match case off: `.MD` is `{}`, and `Real.md` is a note with `lines: []`. `file:MD` and `path:.MD` without match case have that shape.
- `file:MD` with match case on: only `.MD`, as `{}`. `path:.MD` with match case is the same. `file:md` with match case matches only `Real.md`.

`fixtures/parity/README.md` now says a note's file name has characters before `.md`. `paths.test.ts` checks `isNoteFile` and `noteName` for `Upper.MD` and `.MD`.

Checks, each under `flock /tmp/grove-npm-test.lock`. Cargo used `--offline`. The registry was not contacted. Both builds kept the existing large-chunk notice.

- `npm run build`: passed.
- `npm test`: vitest 58 files, 669 tests, all passed, including `parity.test.ts` (343 tests) and the new `isNoteFile` test. Browser discovery, geometry, and the browser scripts passed on the first run. The 300-card drag check was max 16.8 ms. The 1000-row Bases scroll was max 16.8 ms. `posttest` (`test-bases-config.mjs`) passed.
- `npm run audit:offline`: passed, 166 source files plus dist, CSP, capabilities, and dependencies.
- `cargo build --offline`: passed (`Finished dev profile` in 1.76s, no fetch).
- `cargo test --offline`: 52 passed, 0 failed, 2 ignored. `index::parity::corpus` passed with the three markers removed.

## Catch-up merge

Merged `rebuild/integration` (`2f82a1f`) with `git merge --no-edit`. No rebase. Merge commit `360665b`. Integration brings K1, Q1, Step 5, the upper-case `.MD` cleanup, C1-A, and B1. The nameless-file rule stays: one `isNoteFile`, and every caller uses it.

Five conflicts:

- `paths.ts`. Both sides defined the helper. The result is the Rust rule: the basename is longer than 3 characters and ends in `.md` in any case. `noteName` strips those three characters only when `isNoteFile` says the path is a note, so a file named `.MD` keeps that label. Integration's `path.toLowerCase().endsWith(".md")` would have counted `.md` as a note.
- `paths.test.ts`. Kept integration's any-case checks (`Upper.MD`, `a.Md`, `Board.canvas`, `readme.markdown`) and the nameless `.md` / `.MD` checks, including `noteName(".MD")` staying `.MD`.
- `graph/source.ts`. Took integration's `graphFileLists` instead of the inline loop. That helper calls `isNoteFile`, so a nameless file is an attachment.
- `graph/data.ts`. Kept `graphFileLists` and `noteName` for node labels.
- `bases/view.ts`. Took integration's `baseNoteFiles`. It filters with `isNoteFile`. The inline filter was dropped.

`searchVault.ts` and `search.json` did not conflict. Search still classifies notes with `isNoteFile`, and the three `dot-name` cases are unchanged. `mock/backend.ts` merged cleanly. Its new `linkSources` used `/\.md$/i`, which counts a nameless file as a note. Those three filters now call `isNoteFile`, matching Rust `link_sources` (`index/link_sources.rs`), which uses `is_note_path`. Integration's settings path list uses `noteName`, so `Upper.MD` is suggested as `Upper`.

Checks, each under `flock /tmp/grove-npm-test.lock`. Cargo used `--offline`. The registry was not contacted. Both builds kept the existing large-chunk notice.

- `npm run build`: passed.
- `npm test`: vitest 58 files, 673 tests, all passed, including `parity.test.ts` (343). Browser scripts passed on the first run. The 300-card drag check was max 16.8 ms. The 1000-row Bases scroll was max 16.7 ms. `posttest` (`test-bases-config.mjs`) passed.
- `npm run audit:offline`: passed, 166 source files plus dist, CSP, capabilities, and dependencies.
- `cargo build --offline`: passed (`Finished dev profile` in 6.69s, no fetch).
- `cargo test --offline`: 58 passed, 0 failed, 2 ignored. `index::parity::corpus` passed.
