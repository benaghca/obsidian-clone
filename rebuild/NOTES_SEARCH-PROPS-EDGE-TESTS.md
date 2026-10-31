# SEARCH-PROPS-EDGE-TESTS

Branch `rebuild/search-props-edge-tests-grok` from `b5cffcb` (`Merge branch 'rebuild/kanban-edge-review-grok' into rebuild/integration`).

Product code is unchanged. `rebuild/app/package.json` is unchanged. The only edit under `src-tauri/src` is a `#[cfg(test)]` module line in `index.rs`. No new crate, npm package, or dependency. No Obsidian app, code, or assets were used, and no Obsidian help page was fetched. The checks follow rules Grove already decided: search saves pending edits before it reads, a file whose whole name is `.md` is not a note (`is_note_path` / `isNoteFile` require a longer base name), and an uppercase `.MD` file keeps its tags. The parity corpus (`fixtures/parity/README.md`, `search.json`, `properties.json`, `tags.json`) already pins the single-feature cases these tests do not repeat. A `file:` hit on `.MD` as an attachment `{}` is that existing parity result, not a new bug. The search view drops it because `searchNotes` keeps `isNoteFile` paths only.

## What changed

| File | Role |
|---|---|
| `rebuild/app/src-tauri/src/index.rs` | `#[cfg(test)] mod search_props_edge;` |
| `rebuild/app/src-tauri/src/index/search_props_edge.rs` | Rust index cases, including the 10k timing |
| `rebuild/app/src/searchPropsEdge.test.ts` | The same cases against `searchVault`, `readProperties`, `tagsInText`, `resolveLink`, `headingPos` |
| `rebuild/app/scripts/test-search-props-edge.mjs` | Headless Chromium. No `shot()`, so `rebuild/round*-shots/` is untouched |

`38dabe9` is those files, 607 insertions. `src/searchPropsEdge.test.ts` is picked up by the existing `vitest run`. The Rust module runs under `cargo test`. Neither needs a `package.json` edit.

## What the Rust tests cover

`search_props_edge.rs` uses private `Index` items, so it is a `#[cfg(test)]` child of `index` rather than a `tests/` integration crate.

- `$5.00`, `a+b`, `.*`, `c++`, and `.` are literal text. `(usd)` is a group, so it matches both notes that contain `usd`. `"hello"` matches the phrase. An opening quote with no close runs to the end of the query. A family emoji (ZWJ sequence) and 😀 match the note that contains them. `"[draft]"` is text. `[draft]` is a property-exists query and does not match the same characters in a paragraph. `""`, whitespace, `OR`, `OR OR`, and `()` search nothing, including `search_lines`.
- A 20,000-character needle matches only the note that contains it. One extra character misses. `hit OR` plus `miss` repeated 2,000 times matches both notes.
- A real scan of a `/tmp` vault with `.md`, `.MD`, `dir/.md`, and `Real.md`. The three dot files are listed and are not notes. Their bodies are absent from `search_notes`, tags, and properties. `file:.md` returns only `Real.md` (the basename contains `.md`). `resolve` of `.md` and `.MD` is `None`. `search("only-in-dot")` is empty.
- One BOM + CRLF note: empty value, list `one`/`two`, nested map (unknown), date `2026-10-31`, quoted `"42"` stored as text, bare `7` stored as a number. `[due:2026-10-31]`, `[count:42]`, `[rank:7]`, and `[empty]` hit that note. Duplicate `status` / `Status` makes the whole block unreadable, so `[status:onlyprop]` misses.
- `Notes/CASE.MD` keeps frontmatter tags `café` and `a/b_c-d` and body tags `タグ`, `end`, `123-ok`. The emoji in `#end🙂more` ends the tag, so `tag:more` misses.
- `[[Target#Missing Heading|shown]]`, `[[Target#^nope|block name]]`, and `[[Target\|kept|alias]]` resolve to `Target.MD`. `[[Ghost#Gone|no note]]` is unresolved as `Ghost`. A link target `.md` does not resolve. Outgoing is `Target.MD` and the backlink is from `Source.md`.
- Rename `Old.MD` to `Folder/New.md`: `path:Old.MD` is empty, `path:Folder/New.md` hits the new path, and `lifeword`, `[status:draft]`, and the tag follow. `[[Other#Missing]]` still resolves. `remove_tree` drops the search hit, the tag, and the properties. (`path:Old` is the wrong probe: `folder` contains `old`.)
- 10,000 notes `n0.md`–`n9999.md` plus `Other.md` under `/tmp` (`tmp_dir("edge-10k")`). After the scan and one warmup, the median of three `search_notes("needle-4242")` calls, three `search_lines` calls, and three note-switches (`fs::read_to_string` of `n4242.md` plus `resolve` of `[[Other]]`) each stay ≤ 50 ms. The scan is not in that budget. The ceiling was not raised.

## What the vitest file covers

The same literal, empty, long-query, property, tag, and link expectations on the TypeScript reference. `file:.md` note rows include `Real.md` and exclude `.md`, `.MD`, and `dir/.md`; those three are attachment hits `{}`. `resolveLink(".md")` against a note list that does not contain that file is null. A leading BOM still parses in `splitFrontmatter` (trim) while `Text` line 1 does not start with `---`, which is the editor-versus-index difference the parity README already records. `headingPos` is null for a missing heading and a missing `^block`, and is set for `Real` and `^known`.

## What the browser script covers

One headless page, mock vault, no screenshots. It creates `.md`, `.MD`, `dir/.md`, and the edge notes beside the sample vault.

- Those three paths are absent from `ws.vault.notes`. `Edge/CASE.MD` is a note named `CASE`.
- A CodeMirror `userEvent: "input"` insert of `PENDTOKEN` is still unsaved when search opens. The wrapped `api.writeNote` for `Edge/Pending.md` that contains the token runs before `api.searchNotes("PENDTOKEN")`. The result name is `Pending` and `readNote` contains the token.
- `a+b` is exactly `Literal`. `.*` includes `Literal` and excludes `Plain` (the sample vault's `.**` also contains the two characters, so the result is not only `Literal`). `"hello"`, 😀, an empty query, whitespace, a lone `"`, and 4,000 `n`s behave as the parser says.
- `only-in-dot` is "No matches found." `only-in-real` finds `Real`. `tag:café` finds `CASE`. `tag:more` does not. `[due:2026-10-31]` finds `Props`. `[status:onlyprop]` does not. `[status:bomdraft]` finds `Bom`.
- `Props.md` (CRLF, no BOM, so the widget shows) has rows `empty`, `items`, `nested`, `due`, `count`, `rank`. The quoted number's value is `42`, the number input is `7`, the date input is `2026-10-31`, and the empty value is empty. `Dup.md` has no property rows and both keys stay in the source.
- Search finds `Life`, then `renameFile` to `After`, then `deleteFile`. The hit follows the rename and disappears after the delete.
- In Live Preview the caret is moved off the line so the alias renders. The visible text is `shown` and `data-href` is `Target#Missing Heading`. A real click opens `Edge/Target.MD` on `intro line`. `openLink("Target#Real")` lands on `# Real`. `openLink("Target#^nope")` leaves the caret and the path where they were.

## Bugs

Two. Product code was not changed. Nothing else failed.

### 1. `Index::search("md")` lists a file named `.md`

`display_name` of a non-note is the full file name. `Index::search` treats that name as a hit, and `".md"` contains `"md"`. The ignored test `legacy_name_search_must_not_list_a_file_named_dot_md` asserts the file must not appear. Running it fails:

```
cd rebuild/app/src-tauri && cargo test --offline legacy_name_search_must_not_list_a_file_named_dot_md -- --ignored --nocapture
```

```
a file named .md must not appear in search, got [".MD", ".md", "dir/.md"]
```

`search_notes` does not return those paths, and the body text `only-in-dot` is not a hit. The search sidebar uses `search_notes`. Unlinked mentions call the older `search` command but skip `line == 0` and any path that fails `isNoteFile`, so that pane does not show the file either. The Tauri `search` command still returns it. Severity: low. A caller of that command that does not filter notes will list a non-note when the query is a substring of `.md`.

### 2. `openLink(".md")` opens the non-note

`Workspace.resolve` tries `vault.notes`, then every non-directory file. `resolveLink(".md")` finds the file by its full name (the path map key is lowercased, so `.md` and `.MD` share one slot and the later entry wins). `open` then loads it in the markdown editor, because only images, canvases, and bases go to the attachment view. The create-if-missing branch already returns when the file name is `.md`. The file stays out of `vault.notes`.

The browser script logs this and does not fail the run. All three stability runs, and the run before them, printed:

```
EXPECTED FAIL opening a link to .md moved the active path from Edge/Target.MD to .MD
```

Severity: low. Following that link shows a file the note list and `search_notes` ignore. The vault in the test contains both `.md` and `.MD`.

## package.json line to add later

`package.json` was not edited. In the `"test"` script, after `node scripts/test-search-commands.mjs`, add:

```
 && node scripts/test-search-props-edge.mjs
```

The script currently ends with `node scripts/test-search-commands.mjs`. No `posttest` change. `vitest run` already loads `src/searchPropsEdge.test.ts`. `cargo test` already builds `index::search_props_edge`.

## Commands and results

From `rebuild/app/src-tauri`, `cargo test --offline`: 81 passed, 0 failed, 5 ignored (the new ignore plus the four that were already ignored). `cargo test --offline search_props_edge -- --include-ignored` failed only the ignored test above. The 10k test printed, on that debug run, `search_ms=5.553 lines_ms=0.005 switch_ms=0.005`. An earlier debug run printed `search_ms=5.618` with the same line and switch times. All three are under 50 ms.

From `rebuild/app`, three times each, under `flock /tmp/grove-npm-test.lock`, all exited 0:

```
npx vitest run src/searchPropsEdge.test.ts
node scripts/test-search-props-edge.mjs
```

Vitest: 5 passed each run. The browser script printed the same passes and the same EXPECTED FAIL line each run.

`npm run build` (`tsc --noEmit && vite build`) exited 0. The existing chunk-size warning is still there. `npm test` and `npm run audit:offline` were not required; product code is unchanged.
