# S0-5

More tag and link cases in the step 0.3 parity corpus. Branch `rebuild/s0-5-parity-grok`, 2026-10-28. App behaviour is unchanged. `expected` is still what TypeScript returns today. Where that differs from Obsidian, the case has an `obsidian` value. Where Rust differs from `expected`, the case has `"rust": "todo"`. No new keys.

## What was added

| File | Was | Now | Diff |
|---|---:|---:|---|
| `app/fixtures/parity/tags.json` | 46 | 72 | +27 / −1 |
| `app/fixtures/parity/links.json` | 27 | 44 | +18 / −1 |

43 new cases. Tags cover nested paths, numeric edges (`#2024/02` is a tag, `#12.34` is not), trailing punctuation, Unicode, headings, URLs, comments, and frontmatter in string, list, quoted, and legacy `tag:` forms, plus `aliases` left out. Links cover aliases, headings, block refs, embeds (including a width), `.md` in the raw target, spaces and case, percent-encoding, escaped brackets, code, and comments.

`tags.json` is still `"rust": "todo"` at the top. Rust has no tag function, so cargo checks that the file is well-formed and does not run the new tag cases. The 10 link cases that already had `"rust": "todo"` are unchanged. Four new link cases needed the marker.

## Disagreements in the new cases

`expected` is TypeScript. "Wrong" means it disagrees with Obsidian. Rust is wrong only when it disagrees with both TypeScript and Obsidian, or with Obsidian where TypeScript already matches Obsidian.

Tags. Rust is absent for all of these.

| Case | TypeScript | Obsidian | Who is wrong |
|---|---|---|---|
| a tag inside an HTML comment | `secret`, `open` | `open` | TypeScript. It has no comment rule. |
| a tag inside a `%%` comment | `hidden`, `shown` | `shown` | TypeScript. Obsidian does not index tags inside `%%`. |
| frontmatter emoji tag | `ok` | `🙂`, `ok` | TypeScript. The docs allow emoji. A frontmatter value has to match the whole token, and the allowlist drops `🙂`. Same gap as the existing body "emoji" case. |
| frontmatter combining accent | nothing | `café` (decomposed) | TypeScript, on the same belief as the existing body case. A body tag keeps the letters before the mark. Frontmatter drops the whole value. Verify in Obsidian. |

Links.

| Case | TypeScript | Rust | Obsidian | Who is wrong |
|---|---|---|---|---|
| a backslash before the opening brackets | `Note`, `Real` | `Note`, `Real` | `Real` | Both. `\[[` is an escape. |
| triple brackets | `[Note` | nothing (`rust: todo`) | `[Note` | Rust. It skips any target that contains a bracket. Obsidian keeps the extra `[`. |
| an escaped bracket inside the target | `a\[b` | nothing (`rust: todo`) | unverified | TypeScript and Rust disagree. No `obsidian` value. |
| a link in an indented code block | `Inside`, `Outside` | `Inside`, `Outside` | `Outside` | Both. Four spaces after a blank line is a code block, and Obsidian's index skips the link. |
| a link inside an HTML comment | `Secret`, `Open` | `Secret`, `Open` | `Open` | Both. The graph and the backlinks omit the commented link. |
| an escaped pipe outside a table | `Note\` | `Note` (`rust: todo`) | `Note` | TypeScript. Same reading as the existing table case. Do not change Rust to match `expected`. |
| an embed inside inline code | `no.png`, `yes.png` | `yes.png` (`rust: todo`) | `yes.png` | TypeScript. Same gap as the existing inline-code case. |

Two cases record a difference that is not a wrong return from this function:

- Three casings (`#Tag`, `#tag`, `#TAG`) stay three strings. Obsidian's tag index folds them and shows the first casing. Each occurrence is still a tag.
- `[[#Heading]]` and `[[#^block-id]]` are links in Obsidian, to the current note. The file target is empty, and this list leaves empty targets out. Both runners agree.

Not given an `obsidian` value, because this file only lists wikilinks: `[text](My%20Note.md)` and `[text](Note.md#Heading)`. Obsidian's markdown-link index does include those targets, percent-decoded and without the heading. There is still no corpus file for markdown-link targets.

`#a//b` and `#/leading` are unverified in Obsidian. TypeScript keeps both.

The disagreements already written up in `NOTES_S0-3.md` are unchanged.

## Tests

- `npx vitest run src/parity.test.ts`: 119 passed (72 tag cases, 44 link cases, 2 format checks, the files-to-runners check).
- `cargo test --offline` in `rebuild/app/src-tauri`: 42 passed, 0 failed, 1 ignored (`index::bench::bench_vault`). `index::parity::corpus` passed. Doc-tests 0.
- `npm run build`: passed. The existing chunk-size warning is unchanged.
- `npm test`: vitest 55 files / 432 tests passed, then the browser scripts. `scripts/test-r27l.mjs` failed once on "the backlink row did not open", which is a click timing check and does not read these fixtures. The rerun passed. The rest of the chain, including `posttest`, passed.
- `npm run audit:offline`: passed (164 source files, dist, CSP, capabilities, dependencies).

`npm test` rewrote files under `rebuild/round23-shots` through `rebuild/round32b-shots`. Those captures were restored with `git checkout` and were not committed.

## Decisions for Chris

Nothing here has to be decided before the next step. The new `obsidian` values are pending in the same way as the step 0.3 ones. The ones that would change TypeScript, if you agree with Obsidian, are comments (tags and links), frontmatter emoji and the combining accent, a backslash before `[[`, indented code, and the embed in inline code. The escaped pipe and the inline-code link are the same decisions as in `NOTES_S0-3.md`: Rust already matches Obsidian, so it should not be "fixed" toward `expected`. Triple brackets are the other way: TypeScript matches Obsidian, and Rust drops the link.
