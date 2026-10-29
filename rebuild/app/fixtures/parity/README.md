# Parity corpus

Rules that Grove implements twice, once in TypeScript and once in Rust, checked against the same cases. TypeScript is the spec: `expected` is what the TypeScript function returns today. Rust has to match it.

- TypeScript runner: `src/parity.test.ts` (part of `npm test` through vitest).
- Rust runner: `src-tauri/src/index/parity.rs` (part of `cargo test`).

Both runners read every `*.json` file in this folder. Each file name picks a function in each runner (`tags.json` → `tags`), so a new file needs an entry in both runners.

## Format

```json
{
  "about": "What the cases check, in one or two sentences.",
  "typescript": "the TS function checked, and its file",
  "rust": "the Rust function checked, and its file; or \"todo\" when Rust has none yet",
  "cases": [
    {
      "name": "unique within the file",
      "input": "note text, or an array of lines (joined with \\n)",
      "expected": ["what the TypeScript function returns"],
      "rust": "todo",
      "ts": "todo",
      "obsidian": ["what Obsidian is believed to return, where it differs"],
      "note": "why the case is here, and anything unverified"
    }
  ]
}
```

Required: `name`, `input` and `expected`. Optional: `rust`, `ts`, `obsidian`, `note`, `vault` and `matchCase`. A file may also have `vaults`. Both runners reject any other key, so a typo fails loudly.

- `input`: a string, or an array of lines that is joined with `"\n"`. Use a plain string when line ends matter (`\r\n`) or when there is no trailing newline to worry about.
- `"rust": "todo"` on a case: Rust does not give `expected` today. The runner checks that it **still** differs. When a Rust change makes the case pass, the test fails until the marker is removed, so a marker can't go stale.
- `"rust": "todo"` at the top of a file: Rust has no implementation of this rule yet. The Rust runner only checks that the file is well-formed. Whoever adds the Rust function registers it in `parity.rs`, replaces the top-level `"rust"` with its name, and marks the cases it fails with a case-level `"rust": "todo"`.
- `"ts": "todo"`: the same for TypeScript. Use it only after Chris has decided to change the TS behaviour, with `expected` set to the new behaviour.
- `obsidian`: no runner reads it. It records that Obsidian probably behaves differently from today's TS, and `note` says how sure that is. **A case with an `obsidian` value is a pending decision for Chris.** Do not "fix" Rust towards `expected` when Rust already gives the `obsidian` value. Ask first.
- `matchCase`: `true` or `false`. Omitted means `false`. `query.json` passes it to `parseQuery`. `search.json` passes it to `searchVault`.
- `vaults` (top level, `search.json`): `{ "<name>": { "<path>": "text" | ["lines"] } }`. An array of lines is joined with `"\n"` and does not gain a trailing newline. Use a string when line ends matter (`\r\n`, a trailing `\r`, a leading BOM).
- `vault` (case, required on every `search.json` case): names one of that file's `vaults`. A missing or unknown name fails the case. On any other file, a `vault` key must still name one of that file's `vaults`.

## Files

| File | TypeScript | Rust |
|---|---|---|
| `tags.json` | `tagsInText` (`src/shell/linksTags.ts`) | `parse_note` (`index/parse.rs`), its tags from `note_tags` (`index/tags.rs`) |
| `links.json` | `wikilinkTargets` (`src/shell/linksTags.ts`) | `parse_note` (`index/parse.rs`), its non-markdown links |
| `properties.json` | `splitFrontmatter` + `readProperties` (`src/editor/frontmatter.ts`); the runner drops `line` and `count` | none yet (plan step 3 adds `index/props.rs`) |
| `query.json` | `parseQuery` (`src/shell/searchQuery.ts`) | none yet (plan step 4). Top-level `"rust": "todo"` |
| `search.json` | `searchVault` (`src/shell/searchVault.ts`) | none yet (plan step 4). Top-level `"rust": "todo"` |

`properties.json`: `input` is a note's text. The runner joins a line array with `\n`, then calls `splitFrontmatter`. No frontmatter, or one longer than 2,000 lines, is `null`. Otherwise it calls `readProperties` on the lines between the fences and keeps `key`, `type`, and `value`. `null` from `readProperties` (the block is shown as source) is `null` too. An empty `---\n---\n` is `[]`. `line` and `count` are where the property sits in the editor, so they are not in `expected`.

The editor's `readFrontmatter` also requires the first line to start with `---` before it will call `splitFrontmatter`. This runner does not. Saved notes go through `splitFrontmatter` in the properties index, which is the path step 3 ports. A leading BOM or a leading space is the difference: see those cases.

`query.json`: `input` is a query string. `expected` is `parseQuery(input, matchCase)` — a tree of `{op, parts}`, `{op:"not", part}`, `{op:"term", text, field}`, `{op:"line", part}` and `{op:"prop", key, value}` — or `null` when there is nothing to search for. `matchCase` defaults to false.

`search.json`: `input` is a query string, run by `searchVault` against `vaults[vault]`. `expected` is an object keyed by each file that passes:

- a note (path ending in `.md`, any case) maps to `{ "count": n, "lines": [shown line numbers, all of them] }`;
- an attachment maps to `{}` (no lines, tags or properties);
- `null` means the query has nothing to search for. The search view shows nothing for that. The graph treats it as every file, and does not call `searchVault`.

Keys are compared as a map. Order is not part of the result. Line numbers are enough: the text is the vault's line. Notes get content lines; a word in an attachment's bytes does not match, but a word in its file name can, because the name test only strips `.md`.

## Adding cases

1. Add the case with `expected` set to what the TS function returns. Run `npx vitest run src/parity.test.ts`: a wrong `expected` fails there.
2. Run `cargo test parity` in `src-tauri`. If the case fails there, add `"rust": "todo"`.
3. If you believe Obsidian does something else, add `obsidian` and a `note` that says how you know, or that it is unverified.
