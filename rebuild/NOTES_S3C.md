# S3C

A properties parity corpus for step 3. Branch `rebuild/s3-corpus-grok`, 2026-10-28. App behaviour is unchanged. `expected` is what TypeScript returns today from `splitFrontmatter` then `readProperties`. `line` and `count` are left out. Where that differs from Obsidian, the case has an `obsidian` value. Rust has no property parser, so `properties.json` is `"rust": "todo"` at the top, the same way `tags.json` is. No new keys.

## What was added

`rebuild/app/fixtures/parity/properties.json`: 87 cases. The runner is `propertiesOf` in `src/parity.test.ts`. It joins a line array with `\n`, calls `splitFrontmatter`, then `readProperties`, and keeps `key`, `type`, and `value`. Null means there is no frontmatter, or the block is shown as source. `src-tauri/src/index/parity.rs` maps `properties` to `None`, so cargo only checks that the file is well-formed.

`git diff --numstat` for the corpus change:

| File | Added | Removed |
|---|---:|---:|
| `app/fixtures/parity/properties.json` | 2020 | 0 |
| `app/fixtures/parity/README.md` | 5 | 1 |
| `app/src/parity.test.ts` | 14 | 0 |
| `app/src-tauri/src/index/parity.rs` | 2 | 1 |

`editor/frontmatter.ts` is untouched. The editor's `readFrontmatter` still requires the first line to start with `---`. This runner does not. Saved notes go through `splitFrontmatter` in the properties index, and that is the path step 3 ports.

The two long cases are blank lines on purpose. `MAX_LINES` is 2000. The opening fence counts as line 1 and is not stored. After 1999 body lines the count is 2000 and the next line can still close, so the result is `[]`. A 2000th body line pushes the count to 2001 and the closer is never seen, so the result is null. A reader that ignored the cap would return `[]` for the second case. A reader that rejected 1999 lines would fail the first.

## Disagreements

`expected` is TypeScript. "Wrong" means it disagrees with Obsidian, on the belief in the case note. None of these were checked against a live Obsidian. Rust is absent for all of them. Step 3 should match `expected`. These are pending decisions about TypeScript, in the same way as the step 0.3 and S0-5 cases. Do not change TypeScript in the port.

| Case | TypeScript | Obsidian (belief) | Who is wrong |
|---|---|---|---|
| yes, no, on, off, y | text | checkboxes | TypeScript, if Obsidian still uses YAML 1.1 booleans. Grove only treats `true` and `false` as checkboxes, so the line is never rewritten. |
| datetimes with `Z`, an offset, or a fraction | text | datetime, same text | TypeScript. The pattern is `YYYY-MM-DDTHH:MM` with optional seconds. |
| legacy `tag: solo, pair` | text `solo, pair` | tags `solo`, `pair` | TypeScript. `fixedType` is only `tags`, `aliases`, and `cssclasses`. |
| legacy `tag:` as a list | list | tags | TypeScript. Same key. |
| `tags: "#project"` | tags `#project` | tags `project` | TypeScript. `readProperties` keeps the hash. The tag index strips it. |
| `tags: ["#a", b]` | tags `#a`, `b` | tags `a`, `b` | TypeScript. Same hash rule. |
| `tags: [#a, #b]` | unknown | tags `a`, `b` | TypeScript. A scalar may not start with `#`, so the flow list fails. |
| legacy `alias: Road` | text | aliases `Road` | TypeScript. |
| legacy `cssclass: wide` | text | list `wide` | TypeScript. |
| an indented `#` comment under `a: 1` | `a` unknown, `b` number | both numbers | TypeScript. An indented line continues the property above it. |
| duplicate `name` / `Name`, plus `count` | null | `count` kept, last value `second` | TypeScript. The block stays source so nothing is rewritten. The spelling `Name` and its position at the end are a guess. |
| a space before the opening `---` | the property | null | TypeScript's `splitFrontmatter`, which trims. `readFrontmatter` and `tagsInText` already return no frontmatter. Obsidian requires the fence at the start of the file. |
| every key indented | null | the two properties | TypeScript. A key has to start at column 0. |
| a double-quoted value split across lines | null | text `foo bar` | TypeScript. The next line is not a continuation, so the block is source. YAML folds the break into a space. The space is the uncertain part. |
| `1e3`, `.5`, `+5`, `+0` | unknown, text kept | numbers `1000`, `0.5`, `5`, `0` | TypeScript, on purpose: NUMBERISH is never rewritten. The type is the confident part. The canonical text is a guess. |

A space instead of `T`, and a one-digit hour, are text here. Obsidian may accept the space. No `obsidian` value, because that is less sure than the ISO forms above.

`012`, `0x1F`, `0b10`, `0o10`, `1_000`, `.inf`, `.nan`, `10:30`, `007`, and `12.` are unknown for the same NUMBERISH reason. A YAML 1.1 reader may type them as numbers, but the values are not agreed (octal against decimal, sexagesimal `10:30`, underscores, infinity). No `obsidian` value.

Not given an `obsidian` value, because the code already treats them as Obsidian's reading: a nested map, a `|` or `>` block, a comment on a value, and a `...` line (the note has no frontmatter). A comment in a value is unknown here so the comment is not lost. `tagsInText` still extracts a tag from `tags: a # comment`. That is a different function. See `tags.json`.

A BOM is not a disagreement in this file. `splitFrontmatter` trims U+FEFF, so the fence matches and the properties are returned. `readFrontmatter` and `tagsInText` require the text to start with `---`, which is why the BOM case in `tags.json` drops the frontmatter tags. Rust's `parse_note` strips a BOM. Obsidian reads the frontmatter. This runner follows `splitFrontmatter`.

## Tests

- `npx vitest run src/parity.test.ts`: 207 passed (72 tag cases, 44 link cases, 87 property cases, 3 well-formed checks, the files-to-runners check).
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: build passed. 42 passed, 0 failed, 1 ignored (`index::bench::bench_vault`). `index::parity::corpus` passed. Doc-tests 0.
- `npm run build`: passed. The existing chunk-size warning is unchanged.
- `npm test`: vitest 55 files / 520 tests passed, then the browser scripts, then `posttest`. No flake this run.
- `npm run audit:offline`: passed (164 source files, dist, CSP, capabilities, dependencies).

`npm test` rewrote files under `rebuild/round23-shots` through `rebuild/round32b-shots`. Those captures were restored with `git checkout` and were not committed.

## Decisions for Chris

Nothing here has to be decided before step 3. The port should match `expected`. The `obsidian` rows above are pending in the same way as S0-5. The ones that would change TypeScript, if you agree with Obsidian, are YAML 1.1 booleans, zoned datetimes, the legacy `tag` / `alias` / `cssclass` keys, a leading `#` on a tag, an indented comment, duplicate keys, an indented mapping, and a double-quoted value split across lines. NUMBERISH staying unknown is already a written choice in `frontmatter.ts` (shown, never rewritten). The leading space on `---` is the other way around: `splitFrontmatter` accepts it and the editor does not. Step 3 replaces the index path, so it should keep accepting it until you say otherwise.
