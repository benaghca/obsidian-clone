# S1: tag index in Rust (plan step 1)

Branch `rebuild/s1-tags-claude`, 2026-10-28. Commits `ae3cbe3` (Rust side, corpus, contract) and `b8c6a75` (front end), then this file.

## In plain words

- **The Tags view now asks Rust for the tags directly.** Before, it ran five vault-wide searches (about 4 MB for 5,000 notes) and worked the tags out on the page. Now Rust works out each note's tags once, when it indexes the note, and one `tags` call returns them (0.48 MB).
- **Same tags as before.** On a generated 5,000-note vault and on the mock sample vault, the old and new paths gave exactly the same tags for every note. In 80,000 random test strings, the Rust code and the TypeScript code it copies never disagreed.
- **Faster:** the backend's tag work drops from 66 ms to 2.4 ms (release) and from 278 ms to 18 ms (debug). The page's share drops from 51 ms to 3 ms. Opening or rescanning a vault gets about 10% slower, because tags are now read while indexing.
- **One existing crate is now named directly:** `regex`, for the "is this a letter or digit in any script" test. It was already compiled into the app at the same version.

## What changed

| File | +/− | What |
|---|---|---|
| `src-tauri/src/index/tags.rs` | +249 (new) | `note_tags(text)`, a port of `tagsInText`: frontmatter `tags:`/`tag:` (YAML list, inline list, plain value, comment, quotes, `#`), body `#tags`, the TS fence rule (rule A in `NOTES_S0-3.md`) and single-backtick inline code. The tag-character test is the one function `is_tag_char` (see decision 1). JavaScript's whitespace (`\s`, `trim()`) and its `.` (which stops at `\r`, U+2028, U+2029) are copied, so odd characters give the same answer as in TS. |
| `src-tauri/src/index/parse.rs` | +3 | `Note` gains `tags`, filled by `parse_note`. `fence_open`/`fence_close` and link parsing are untouched (Gemini's branch changes them). |
| `src-tauri/src/index.rs` | +18 −1 | `mod tags;` and `Index::tags(paths)`: notes (`is_note_path`, not folders) with at least one tag, in path order. |
| `src-tauri/src/lib.rs` | +11 | `#[tauri::command(async)] fn tags(paths?)`, registered. |
| `src-tauri/src/index/parity.rs` | +9 −1 | The `tags` runner (`parse_note(input).tags`). |
| `src-tauri/src/index/tests.rs` | +53 | `tags_follow_saves_renames_and_deletes`: `Index::tags` after `upsert_note` (changed, emptied, new note), `relocate` (a folder, and a note renamed away from `.md`), `tags(Some(paths))` and `remove_tree`. |
| `src-tauri/src/index/bench.rs` | +22 −1 | A `tags_ms` line next to the old five-search figure. |
| `src-tauri/Cargo.toml`, `Cargo.lock` | +3, +1 | `regex = "1"` (see below). The lock only adds `regex` to Grove's own dependency list. |
| `scripts/audit-offline.mjs` | +3 −1 | `regex` on the crate allowlist, with a comment. |
| `fixtures/parity/tags.json` | +4 −2 | The file now has a Rust runner. New case "fence with CRLF line ends". The BOM case is `rust: todo` (below). |
| `fixtures/parity/README.md` | +1 −1 | Its table names the Rust function. |
| `src/shell/vaultTags.ts` | +5 −28 | `readTags()` is one `api.tags()` call. |
| `src/shell/linksTags.ts` | +10 −61 | `tagsByNote`, `NoteLine` and the `Fences.inside` getter only it used are deleted. `tagsInText` drops each line's `\r` (below). `tagsInText`, `tagsInLine`, `frontmatterTags` and `tagTree` stay: the Tags view and Bases use them for unsaved open notes. |
| `src/shell/linksTags.test.ts` | +1 −25 | The two `tagsByNote` tests. Their cases are in the corpus ("the other marker does not close a fence", "inline code skipped", "a # inside frontmatter is not a body tag"). The `.png` case is in the Rust unit test. |
| `src/api.ts` | +2 | `tags(paths?)`. |
| `src/mock/backend.ts` | +10 | `tags`: `tagsInText` of each `.md` file. |
| `src/readOrdering.test.ts` | +4 −5 | The stale-tags test mocks `api.tags` (2 calls) instead of `api.search` (10). |
| `src/shell/tagsView.ts` | +2 −2 | Comment: the tags come from the backend's index, not its search. |
| `rebuild/CONTRACT.md` | +1 | The `tags` command. |

In total, 412 lines were added and 128 removed (Rust 369/3, TS 34/121), plus this file. Without tests, bench and docs, the Rust code is about 280 lines, close to the plan's ~250. TS removes about 90 lines, not the ~110 in the plan, because `Fences` stays: `tagsInText` still uses it.

### `regex`, the one dependency change

`\p{L}` (letters) is narrower than Rust's `char::is_alphabetic`, which also accepts combining marks such as Devanagari vowel signs. The corpus requires `#हिंदी` → `ह` to match TS today. std has no general-category test, and a hand-written Unicode table would be large and go out of date. `regex 1.13.1` was already in `Cargo.lock` and compiled into the app through `tauri-utils`, with its Unicode classes on, so naming it adds no code to the binary. ASCII characters never reach it: only non-ASCII characters after a `#` or in a frontmatter value do. `npm run audit:offline` passes with `regex` on the allowlist.

## Shadow check (old path against `api.tags()`)

Method: a temporary ignored Rust test (not committed) scanned each vault with the real `Index`. It dumped what the old path asked for: the five `search` calls with limit 100,000, and `frontmatter`. It also dumped `tags(None)`. A temporary vitest file ran the **old** `vaultTags.ts` + `tagsByNote` (copied from `f8e6cab`) against those dumps through a mocked `api`. It then compared the result with `tags(None)` note by note, tag list against tag list, order included. For the mock sample vault, it also ran the old path through the real mock backend (`createMockBackend`) and compared that with `tagsInText` and with Rust. The temporary files were deleted. Copies are in the session scratchpad.

| Vault | Notes with tags | Tag uses | Differences |
|---|---|---|---|
| `gen-vault.mjs /tmp/grove-s1-claude-5000 5000` (sha256 `5b03c1be…`, as in `RUST_BENCH.md`) | 5,000 / 5,000 | 22,351 / 22,351 | **none** |
| Mock sample vault (`sampleVault()` written to `/tmp/grove-s1-claude-sample`), Rust old vs new | 7 / 7 | 996 / 996 | **none** |
| Mock sample vault, old path through the mock backend vs `tagsInText` | 7 / 7 | 996 / 996 | **none** |
| Mock sample vault, `tagsInText` vs Rust `tags()` | 7 / 7 | 996 / 996 | **none** |

Neither vault contains the cases where the two paths can differ. To show that the comparison does catch differences, a small edge vault (`/tmp/grove-s1-claude-edge`, 7 notes) was run the same way. It found exactly the four expected differences. In each one, the new path is the correct one:

| Note | Old path | New path | Why |
|---|---|---|---|
| `fm-hash.md`: frontmatter `status: #draft`, no `tags:` key | `draft`, `body` | `body` | The old path skipped `#` lines in frontmatter only for notes whose frontmatter had a `tags:` key. `tagsInText` always skips frontmatter (corpus "a # inside frontmatter is not a body tag"). |
| `fence-in-fm.md`: a ```` ``` ```` line inside the frontmatter | `a` | `a`, `b` | The old path walked fence lines from line 1, frontmatter included, so the fence stayed open over the body. |
| `big.md`: 100,050 lines of `#t` | 99,992 uses | 100,050 | The old path's 100,000-hit search limit (plan §1, point 3). |
| `Upper.MD` | no tags | `x` | The old path kept lowercase `.md` paths only. Rust uses `is_note_path` (any case), the same as `frontmatter`, `search` and `link_index`. |

These agree in both paths: a BOM before the frontmatter (both read the frontmatter tags, because the old path's lines also came from Rust) and CRLF fences (both see the fence, for the same reason).

**Not done: the real vault.** The plan's shadow check was on Chris's real vault (Grok's job). The prompt said never to touch real vaults, so it ran only on the generated and sample vaults. To repeat it on a real vault, rerun the two temporary files above with the vault path. Copies are in the session scratchpad: `zz_shadow.rs`, `zzShadow.test.ts`.

## Differential fuzz (TS against Rust)

80,000 random notes went through both `tagsInText` and `note_tags`. They were built from the awkward pieces: fences of every kind and indent, tabs, `\r`, `\r\n`, U+2028, NBSP, NEL, BOM, quotes, `tags:` forms, list items, decomposed `é`, Devanagari, emoji, `。`, and double-backtick code. In 30,000 of them nearly anything goes. The other 50,000 are weighted towards tags and frontmatter, and 32,440 of those have tags. **0 mismatches.**

## Bench (step 0.2 bench, same machine, same 5,000-note vault)

Rust: `GROVE_BENCH_VAULT=/tmp/grove-s1-claude-5000 cargo test [--release] -- --ignored --nocapture bench_vault`. Median of three after a warmup scan. "Before" is `f8e6cab` (which already has step 0.4's `opt-level = 2` for dependencies, so its debug figures differ a little from `RUST_BENCH.md`).

| Work | Before, release | After, release | Before, debug | After, debug |
|---|---|---|---|---|
| **Tag refresh** (before: five searches + serialize; after: `tags(None)` + serialize) | **68.7 ms** | **2.4 ms** | **275 ms** | **18.2 ms** |
| Data sent for a tag refresh | 3.98 MB of search hits + 0.27 MB of frontmatter | **0.48 MB** (5,000 notes, 22,351 uses) | same | same |
| `Index::scan` | 100.7 ms | 111.2 ms (+10%) | 504 ms | 566 ms (+12%) |
| `link_index`, `frontmatter`, search `meeting` | 9.1 / 1.5 / 26.0 ms | 8.6 / 1.3 / 25.7 ms | 83.8 / 15.1 / 118.9 ms | 87.2 / 13.5 / 118.4 ms |

Page side, in Node, on the same dumps (median of five). Before: `JSON.parse` of the five search replies and the frontmatter reply, plus `tagsByNote`, took **51.2 ms**. After: `JSON.parse` of the `tags` reply plus building the `Map` takes **3.3 ms**. WebKitGTK's IPC transfer is not included (it needs the running app). It scales with the bytes sent, so it shrinks about 9×.

Front-end bench (`node scripts/bench-frontend.mjs 5000`, the dev page's mock): `vaultTags.read()` went from 33.2 ms to 9.9 ms. Search (5.2 → 7.2 ms; the runs varied 5.1–10.8) and link refresh (8.1 s, the mock's own cost) didn't change.

Against the plan's success criteria: tag refresh ≤ 10 ms / ≤ 0.6 MB (+ ≤ 10 ms JS) is **met** (2.4 ms / 0.48 MB + 3.3 ms). Debug ≤ 3× release is **not met** for tags (18.2 vs 2.4 ms, 7.6×), but it is 15× better than before. Most of the debug time is Grove's own code at `opt-level = 0`: the `BTreeMap` clone and the serializer code generated inside Grove's crate, which step 0.4's dependency setting doesn't cover. The same is true of `hash_serialize_only` (85 ms debug vs 2.3 ms release).

The scan costs about 10 ms more in release, because each note's text gets one more pass. That happens only on open and on a rescan. A save re-reads one note.

## Test results

All from `rebuild/app` (cargo from `src-tauri`), on `b8c6a75`:

- `npm run build`: ok. The >1000 kB chunk warning was there before.
- `npm run audit:offline`: passed (164 source files, dist/, CSP, capabilities and dependencies, `regex` on the allowlist).
- `cargo build`: ok, no warnings. `cargo test`: 43 passed, 1 ignored (the bench). That includes `index::parity::corpus` (tags.json and links.json), `todo_markers_are_checked` and the new `tags_follow_saves_renames_and_deletes`.
- `flock /tmp/grove-npm-test.lock npm test`: vitest **55 files, 431 tests passed** in both full runs. Two browser checks failed once and passed on their single rerun. Neither touches tags:
  - Run 1: `test-geometry.mjs` "Geometry.md live Ctrl+o", a frame-timing limit: one frame took 20.5 ms against the 20 ms limit, and the switcher was visible on the first frame. Rerun of `npm run test:geometry`: every check passed, with 16.8 ms frames.
  - Run 2: everything up to and including `test-r27k` passed. `test-r27l.mjs` then failed with "the backlink row did not open" (a 2 s wait after a click). Rerun of that script: passed.
  - `npm test` stops at the first failure, so the scripts after `test-r27l` (`test-r27m` through `test-r27t`) were then run in the same order under the flock, with `posttest` (`test-bases-config.mjs`). All passed, exit 0.
  - So every script in `npm test` passed at least once on this commit: 1,654 + 294 PASS lines across the last two runs. The tag checks in `test-bases.mjs`, `test-r27p.mjs` and `test-r27q.mjs` passed (Tags view sort, the "unsaved tag" checks, Bases `file.tags`).
- The test scripts rewrite tracked screenshots under `rebuild/round*-shots/`. They were put back with `git checkout`.

## Decisions for Chris

1. **Unicode tag characters (as asked: TS's rule, ported exactly).** Rust's `is_tag_char` in `index/tags.rs` is the only place in Rust to change. In TS it is the `TAG` and `TAG_VALUE` patterns in `linksTags.ts`. The corpus cases that would flip already carry `obsidian` values: combining accent, Devanagari, emoji, CJK full stop, frontmatter emoji, frontmatter combining accent. Waiting on the check in Obsidian. If Obsidian's rule is the denylist, `regex` is no longer needed (a denylist needs only std), so it could be removed from `Cargo.toml` and the allowlist again.
2. **BOM before frontmatter.** This is the one `rust: todo` left in `tags.json`. Rust reads a note's tags after `parse_note` strips the BOM, so it gives `[a, b]`. That is the `obsidian` value, and the app gave the same before step 1, because its lines came from Rust. `tagsInText` gives `[b]`. Following the README, Rust was not "fixed" towards `expected`. Recommendation: let TS's `frontmatterTags` skip a leading BOM too, then flip the case's `expected` to `[a, b]` and drop the todo. In the app, this only changes the open note's unsaved tags and the browser mock.
3. **TS change I made (small; revert if you disagree):** `tagsInText` now drops a trailing `\r` from each line before the fence test. Its fence regex `(.*)$` can't match `"```\r"`, so in a CRLF note it read code blocks as text. The app never showed this: tag lines came from Rust's index, which already dropped the `\r`, and the editor never holds `\r`. Only the mock and the new port would have seen it. The corpus case "fence with CRLF line ends" covers it.
4. **`.MD` (upper-case extension) notes now have tags.** Before, `tagsByNote` kept only paths ending in lowercase `.md`. Rust's other note commands use `is_note_path`, which accepts any case. I kept that for consistency. The front end's `noteName` also only strips a lowercase `.md`, so such files are an edge case everywhere. Say if you want lowercase only.

## Left for later, and uncertain

- The shadow check on a real vault (above).
- `RUST_BENCH.md` is unchanged. The before and after figures are here, and `bench_vault` now prints `tags_ms`.
- Unicode version: `regex-syntax 0.8.11` and the webview's JavaScript engine may use different Unicode versions. Only letters added in the newer version could differ. Not tested.
- `tagsInText` and the Rust port both keep the TS rules recorded in `NOTES_S0-3.md`: no indented-code rule, `%%` and `<!-- -->` comments not skipped, and single-backtick inline code only. Those are unchanged and still carry their `obsidian` values.
- Step 3 (properties) also adds a field to `Note` in `parse.rs`. Expect a one-line merge conflict next to `tags`.
