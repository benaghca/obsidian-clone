# S3: saved properties parsed and cached in Rust

Implemented 2026-10-29 on `rebuild/s3-properties-codex`, based on `763edea`. Implementation commits: `be10d72` (Rust/TypeScript owner, corpus and contract) and `824a0a5` (benchmarks). Local commits only; nothing pushed.

## Behavior and ownership

This step owns both sides, as the prompt authorizes; the contract-updating commit says so. `index/props.rs` ports the saved-note path `splitFrontmatter` + `readProperties`. `parse_note` gains exactly two lines: an optional cached properties field and its initializer. Parsing happens once on indexing/save/rescan. `Index::properties(paths)` clones cached typed entries; future `index/query.rs` can use the per-note entries and typed `PropertyType`/`PropertyValue` directly.

The new `#[tauri::command(async)] properties(paths?)` is registered, has generated `allow-properties` permission, and is granted only through the existing main/note-window capability. The response is `{ path: { props, lines } }`. Every property includes `key`, `type`, `value`, zero-based `line`, and `count`. Source-only/unreadable/no-frontmatter notes are omitted; an empty readable block is included with `props: []`. Optional paths, empty selections, missing paths, directories and non-notes behave like the other index reads.

`api.properties` and the browser mock implement that shape. The mock calls the unchanged TS reference, rather than copying Rust logic. `propertyIndex` removes only its saved-note `splitFrontmatter`/`readProperties` path. Its mtime cache, single in-flight read, omitted-entry caching, exclusions and open-editor `readFrontmatter` override remain. The shared `NoteProperties` interface now lives at the API boundary and is re-exported from propertyIndex for existing callers. The editor parser, property editing/writing and chosen property types remain in TypeScript.

The decided uppercase-extension rule also needed the vault note-list filter to accept `.MD`, otherwise those entries could not reach propertyIndex even though the backend returned them. Changed that filter and note-name extension stripping to case-insensitive matching; a frontend regression checks both. Other extension-specific features were not broadened in this step.

`rg` found no remaining production `api.frontmatter` callers after this conversion. Kept the API method, Rust command and mock method as explicitly requested. Embeds, unlinked mentions, Bases and the editor still use the local TS frontmatter helpers where appropriate; those helpers stay.

## Parse rules preserved

The authority was `src/editor/frontmatter.ts`, the 87 property corpus cases, and `NOTES_S3C.md`. No Obsidian application code/assets or GUI were opened, and no network/public-doc lookup was needed to make a new Obsidian behavior decision. All pending `obsidian` values and case `expected` values remain untouched.

- Split on LF; remove exactly one terminal CR from each frontmatter line. Keep the normalized body lines for property/search locations. BOM and surrounding JS whitespace on the first fence are accepted; a leading space before `---` remains accepted in this saved-note path.
- The opening line counts toward the 2,000-line scan cap: 1,999 body lines may still be followed by a closer; 2,000 body lines fail. `...` is not a closer. No note body parsing after the closing fence.
- A line that cannot be placed as a property, or case-insensitively duplicated keys, makes the whole block source-only. Top-level blank/comment lines belong to no property. Continuations and intervening blanks retain the TS source extents; trailing blanks are not swallowed.
- Scalars and flow/block lists follow the TS subset, including exact list indentation, null-item removal, simple quote toggling in flow lists and its escaped-quote limitation. Comments, nested structures, anchors and multi-line values become unknown rather than being flattened or rewritten.
- Only `tags`, `aliases`, and `cssclasses` have fixed types. Legacy singular names stay as the corpus specifies. Plain tag values split on commas/JS whitespace; hashes in quoted values and flow-list item contents are kept.
- Numbers remain their original strings, including `1.00` and `-0`. NUMBERISH stays unknown. Only true/false are checkboxes; dates/times use the TS patterns without calendar validation, timezone/fraction support or YAML 1.1 coercions.
- Regexes use ASCII digits, JS whitespace (BOM included, NEL excluded), JS dot line-terminator behavior and strict non-multiline end anchors. Reused the existing regex crate; no Cargo/package dependency changes. Whitespace logic is local to this module to avoid disturbing the parallel tag/link work.

All **87 property cases pass Rust with zero case-level todos**. Only the file's top-level Rust runner description changed. The README and Rust parity runner were updated; the TS corpus runner, `editor/frontmatter.ts`, `linksTags.ts`, tag/link fixtures and link parser rules were not edited.

A temporary deterministic differential harness compared **50,000 generated notes**, including full `line`/`count` and `lines`, with **zero differences**. It mixed quoted/unquoted keys, lists, comments, numbers/NUMBERISH, dates, Unicode, BOM, CRLF, standalone CR, JS line separators and unusual whitespace. The temporary harness and dumps were removed. Rust tests additionally pin CRLF/BOM source lines, metadata extents, ASCII-number behavior, strict line-end handling and properties after upsert, folder/file relocate, changing away from `.md`, clearing frontmatter and removing a tree.

Known representation edge outside the corpus/fuzz: JSON-quoted text is decoded with serde_json. Lone UTF-16 surrogate escapes cannot be represented in Rust strings and are conservatively rejected (unknown value, or source-only for a key), whereas JavaScript JSON.parse can retain a lone UTF-16 code unit. Paired escapes and ordinary Unicode are supported. No corpus todo was necessary; this remains an edge to consider if exact handling of malformed Unicode escapes is required.

## Benchmarks

Generated `/tmp/grove-s3-codex-bench-5000` with `node scripts/gen-vault.mjs /tmp/grove-s3-codex-bench-5000 5000`. The SHA256 is the required `5b03c1bee51dfe6e284f30d1e2452f9f5bd62c66a5018e8127d8593b0de5d8e7`: 5,000 notes, 13,600,158 bytes, 3,000 readable frontmatter blocks.

Used the step-0.2 `bench_vault` in release/debug, three samples after warmup, with existing Cargo profiles. This is a shared machine: CPU load was not pinned or sampled at each measurement, and other builders may have been active. Our own full browser suite began after the native benchmark runs. Treat timings as approximate; bytes and corpus comparisons are deterministic.

- Before `frontmatter(None)` + serialize: **1.0 ms release / 12.5 ms debug**, **272,523 bytes**. Release samples 1.8/1.0/0.8; debug 14.3/12.5/12.3.
- After `properties(None)` + serialize: **1.4 ms release / 18.7 ms debug**, **586,127 bytes**. Release samples 2.5/1.4/1.3; debug 19.6/18.7/18.2. This includes the complete metadata and original frontmatter body lines.
- Retained `frontmatter(None)` after the port: **0.9 ms release / 12.6 ms debug**, still 272,523 bytes.
- `Index::scan`: **110.6 → 120.6 ms release** (+10.0 ms, about 9%); **551.2 → 606.2 ms debug** (+55.0 ms, about 10%). Before release 133.4/109.5/110.6, after 143.3/118.2/120.6; before debug 574.6/550.8/551.2, after 623.0/590.9/606.2.

Added `properties_ms`/bytes/count to the Rust bench next to frontmatter, plus optional scratch JSON output. Reproduce the after measurements/dumps with:

```text
cd rebuild/app/src-tauri
GROVE_BENCH_VAULT=/tmp/grove-s3-codex-bench-5000 GROVE_BENCH_JSON_DIR=/tmp/grove-s3-codex-bench-json cargo test --offline --release -- --ignored --nocapture bench_vault
GROVE_BENCH_VAULT=/tmp/grove-s3-codex-bench-5000 cargo test --offline -- --ignored --nocapture bench_vault
```

`node scripts/bench-properties.mjs /tmp/grove-s3-codex-bench-json` (from `rebuild/app`) loads the unchanged TS parser and the actual Rust JSON bodies. It first deep-compares Rust's complete typed result with TS for every generated block, including metadata/lines: **all 3,000 entries match**. It then measures both old and new page algorithms on those same dumps (three samples after warmup):

- Before JSON.parse only: **0.648 ms**; readProperties/splitFrontmatter across already decoded blocks: **6.499 ms** (9.772/6.499/6.008).
- Before page total (JSON.parse + TS parsing + Map): **9.677 ms** (9.677/11.031/9.373).
- After JSON.parse only: **2.477 ms** (2.552/2.477/2.461).
- After page total (JSON.parse + Map): **2.316 ms** (2.357/2.316/2.301). These are separately warmed measurements; medians are not additive.

This removes page parsing work at the cost of a larger payload and modestly slower scans/native serialization. It supplies the cached typed data needed by Rust search. These figures exclude webview IPC and are not a native interactive measurement. `bench-frontend.mjs` does not cover properties (it measures tags/search/link refresh), so it was not rerun for this step; the dedicated script measures the relevant page work instead.

## Validation

- `npm run build`: passed.
- `flock /tmp/grove-npm-test.lock npm test`: **passed in one uninterrupted run**, including posttest. **531 Vitest/parity tests across 58 files**, four browser-discovery tests, and every headless browser script. No timing flakes or reruns. Permanent geometry/real-pointer/menu checks passed; large canvas drag measured 16.8 ms and Bases scroll 16.7 ms against 20 ms ceilings.
- Property block/All properties, Bases and saved-note subscriptions passed. The Bases regression now intercepts `api.properties` and still requires a changed note to request only its own path. New tests cover complete typed API entries and omitted-entry caching, open editors overriding an in-flight saved response, and the mock's BOM/CRLF/uppercase/source-only/empty selection behavior.
- `npm run audit:offline`: passed (165 production source files, dist, CSP, capabilities, dependencies).
- `cargo build --offline`: passed, no warnings.
- `cargo test --offline`: **46 passed**, one ignored benchmark, plus binary/doc-test targets. The ignored benchmark was run separately in both profiles.
- `git diff --check`: passed. Generated `rebuild/round*-shots` outputs were restored before each commit and after the full suite. Prompts/logs are not committed. No GUI, real vault or other worktree was opened.

## Files and line counts

Implementation diff from `763edea`: **696 added / 49 removed across 22 files**, excluding this notes file.

- `CONTRACT.md`: +1 / -0.
- `app/fixtures/parity/README.md`: +1 / -1; `properties.json`: +1 / -1 (runner metadata only).
- `app/src-tauri/src/index/props.rs`: +486 / -0 (types, parser, cached selection and Rust regressions).
- `app/src-tauri/src/index.rs`: +2 / -0; `index/parse.rs`: +2 / -0; `index/parity.rs`: +6 / -2.
- `app/src-tauri/src/lib.rs`: +11 / -0; `build.rs`: +1 / -0; `capabilities/default.json`: +1 / -0; `permissions/autogenerated/properties.toml`: +11 / -0.
- `app/src/api.ts`: +8 / -0; `src/shell/propertyIndex.ts`: +7 / -17; `src/mock/backend.ts`: +12 / -1.
- `app/src/shell/propertyIndex.test.ts`: +41 / -15; `src/readOrdering.test.ts`: +8 / -7; `src/mock/backend.test.ts`: +17 / -1.
- `app/src/vault.ts`: +1 / -1; `src/paths.ts`: +1 / -1.
- `app/src-tauri/src/index/bench.rs`: +37 / -0; `app/scripts/bench-properties.mjs`: +39 / -0; `app/scripts/test-bases.mjs`: +2 / -2.

## Review / remaining decisions

No required S3 work remains. Review the conservative unknown/source split, exact continuation extents, JS regex/whitespace differences and the cached clone boundary. The editor and all pending S3C Obsidian disagreements intentionally keep existing behavior. No decision blocks this port; handling lone surrogate escapes beyond the supported Unicode representation would be separate work. Eager parsing was chosen to match the tags pattern and make future Rust queries reuse typed properties without repeated parsing. Debug serialization still has the previously documented unoptimized Grove-crate overhead; no profile changes were made here.
