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

Required: `name`, `input` and `expected`. Optional: `rust`, `ts`, `obsidian` and `note`. Both runners reject any other key, so a typo fails loudly.

- `input`: a string, or an array of lines that is joined with `"\n"`. Use a plain string when line ends matter (`\r\n`) or when there is no trailing newline to worry about.
- `"rust": "todo"` on a case: Rust does not give `expected` today. The runner checks that it **still** differs. When a Rust change makes the case pass, the test fails until the marker is removed, so a marker can't go stale.
- `"rust": "todo"` at the top of a file: Rust has no implementation of this rule yet. The Rust runner only checks that the file is well-formed. Whoever adds the Rust function registers it in `parity.rs`, replaces the top-level `"rust"` with its name, and marks the cases it fails with a case-level `"rust": "todo"`.
- `"ts": "todo"`: the same for TypeScript. Use it only after Chris has decided to change the TS behaviour, with `expected` set to the new behaviour.
- `obsidian`: no runner reads it. It records that Obsidian probably behaves differently from today's TS, and `note` says how sure that is. **A case with an `obsidian` value is a pending decision for Chris.** Do not "fix" Rust towards `expected` when Rust already gives the `obsidian` value. Ask first.

## Files

| File | TypeScript | Rust |
|---|---|---|
| `tags.json` | `tagsInText` (`src/shell/linksTags.ts`) | none yet (plan step 1 adds `index/tags.rs`) |
| `links.json` | `wikilinkTargets` (`src/shell/linksTags.ts`) | `parse_note` (`index/parse.rs`), its non-markdown links |

Planned (see `rebuild/RUST_MIGRATION_PLAN.md`):

- `properties.json` (step 3): `input` a note's text, `expected` its properties as `[{ "key", "type", "value" }]` from `readProperties` (`src/editor/frontmatter.ts`).
- `query.json` (step 4): `input` a query string, `expected` its parse tree from `parseQuery` (`src/shell/searchQuery.ts`). Matching against a vault may need extra case keys. If so, add them to `KEYS` in both runners and document them here.

## Adding cases

1. Add the case with `expected` set to what the TS function returns. Run `npx vitest run src/parity.test.ts`: a wrong `expected` fails there.
2. Run `cargo test parity` in `src-tauri`. If the case fails there, add `"rust": "todo"`.
3. If you believe Obsidian does something else, add `obsidian` and a `note` that says how you know, or that it is unverified.
