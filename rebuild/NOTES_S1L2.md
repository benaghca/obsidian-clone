# NOTES_S1L2 — BOM Frontmatter Tag Parity & Remaining `links.json` Todos (Gemini)

Branch: `rebuild/s1l2-gemini` (from `763edea`)

## 1. What Changed

| File | Diff (`+`/`-`) | Summary |
|---|---|---|
| `rebuild/app/src/shell/linksTags.ts` | `+4 / -3` | Strip a leading UTF-8 BOM (`\uFEFF`) in `frontmatterTags(text)` before checking `startsWith("---")`; update `WIKILINK` and `wikilinkTargets` to allow `[` and `^` (without `#`) inside targets and normalize `\|` to `|` before splitting alias and heading/block subpath. |
| `rebuild/app/src/shell/linksTags.test.ts` | `+18 / -0` | Add unit tests for BOM before frontmatter (`frontmatterTags` and `tagsInText` with BOM + frontmatter, BOM + no frontmatter, and non-leading BOM) and the 6 resolved wikilink target cases. |
| `rebuild/app/src-tauri/src/index/parse.rs` | `+1 / -1` | In `wiki_targets(line: &str)`, change `!inner.contains('[') && !inner.contains(']')` to `!inner.contains(']')` so `[` is allowed inside a `[[...]]` target (`[[a[b]]`, `[[[Note]]]`, `[[a\[b]]`). |
| `rebuild/app/src-tauri/src/index/tests.rs` | `+5 / -4` | Update `wikilink_target_parsing` to assert `[[e[f]]`, `[[C^abc]]`, `[[[Note]]]`, and `[[a\[b]]` produce targets and `[[a]b]]` is skipped; update `markdown_links_and_unresolved_targets_for_the_graph` to use `[[weird]x]]` as its rejected-bracket fixture. |
| `rebuild/app/fixtures/parity/tags.json` | `+2 / -4` | Set `"BOM before frontmatter"` `expected` to `["a", "b"]`, remove `"rust": "todo"` and `"obsidian": ["a", "b"]`, and update `note`. |
| `rebuild/app/fixtures/parity/links.json` | `+8 / -12` | Set decided `expected` values on the 6 remaining `"rust": "todo"` cases, remove all 6 `"rust": "todo"` markers and matching `"obsidian"` fields, and record the basis in `note`. |

Total: 6 files changed, 38 insertions(+), 24 deletions(-). Both `tags.json` and `links.json` now have **0 `"rust": "todo"` entries**.

---

## 2. Part (a) — BOM Before Frontmatter in TypeScript Tag Reading

- **Fix in `src/shell/linksTags.ts`**:
  - `frontmatterTags(text)` now strips a single leading `\uFEFF` (`const s = text.startsWith("\uFEFF") ? text.slice(1) : text;`) before checking `s.startsWith("---")` and calling `splitFrontmatter(s)`.
  - Because `\uFEFF` is on line 1 (index `0` of `text.split("\n")`), `fm.close + 1` still equals the exact line index in `text.split("\n")` where the body begins, so `tagsInText(text)` skips the frontmatter lines without shifting body line numbers.
- **Audit of other `startsWith("---")` / frontmatter checks in TS (`rg 'startsWith\("---"\)|splitFrontmatter'`):**
  - `src/editor/frontmatter.ts` (`splitFrontmatter`): already uses `lines[0].trim() !== "---"`, and JavaScript `String.prototype.trim()` strips `\uFEFF` (BOM / ZWNBSP).
  - `src/editor/frontmatter.ts` (`readFrontmatter`): checks `doc.line(1).text.startsWith("---")` on the live CodeMirror `Text` document. Left untouched as instructed (`frontmatter.ts` is off-limits, and `readFrontmatter` operates on the in-editor CodeMirror document after load rather than raw saved file text).
  - `src/shell/unlinked.ts`: delegates directly to `splitFrontmatter(lines)`, which trims `\uFEFF`.
  - `src/mock/backend.ts`: `frontmatter` command checks `lines[0].trim() === "---"`, which trims `\uFEFF`.
  - No other TypeScript files check `startsWith("---")` on saved note text.

---

## 3. Part (b) — The 6 Resolved `links.json` Cases

| Case | Input | Old TS | Old Rust | New Answer | Basis (Obsidian Help / Inference) |
|---|---|---|---|---|---|
| `^ without #` | `[[C^abc]]` | `["C"]` | `["C^abc"]` | `["C^abc"]` | **Obsidian Help ("Internal links" / "Link to blocks")**: block references are always written with `#^` (`[[Note#^dcf64c]]`). Without `#`, `^` is not a subpath delimiter and remains part of the target name (inference). Also matches `src/links/internal.ts`, `src/mock/backend.ts`, and `src/editor/syntax.ts`, none of which split at `^` without `#`. |
| `a [ inside the target` | `[[a[b]]` | `["a[b"]` | `[]` | `["a[b"]` | **Inference** (consistent with TS and `triple brackets`): an unclosed `[` inside `[[...]]` does not abort the wikilink; only `]` before `]]` breaks the inner match. |
| `escaped pipe in a table cell` | `\| [[Note\|alias]] \| x \|` | `["Note\\"]` | `["Note"]` | `["Note"]` | **Obsidian Help ("Tables" / "Internal links")**: inside a table, a pipe in `[[Note\|alias]]` is escaped with a backslash so it does not split the table cell, and resolves to target `Note` with display text `alias`. |
| `triple brackets` | `[[[Note]]]` | `["[Note"]` | `[]` | `["[Note"]` | **Inference** (consistent with TS and prior `links.json` note): the outer `[[` closes at the first `]]` and keeps the extra `[` in the target (`[Note`). |
| `an escaped bracket inside the target` | `[[a\[b]]` | `["a\\[b"]` | `[]` | `["a\\[b"]` | **Inference** (consistent with TS and `a [ inside the target`): `[` is allowed inside a target and `\` before `[` is preserved in the raw target string (unlike `\|`). |
| `an escaped pipe outside a table` | `[[Note\|alias]]` | `["Note\\"]` | `["Note"]` | `["Note"]` | **Inference** from Obsidian Help's `\|` alias rule: `\|` is normalized to `|` before splitting the target and display text regardless of whether the line is inside a Markdown table. |

---

## 4. Test Results

- `cd rebuild/app/src-tauri && cargo test`: **44 passed, 0 failed, 1 ignored** (including `index::parity::corpus` with 0 todos in `tags.json` and `links.json`).
- `cd rebuild/app/src-tauri && cargo build`: **Passed** (`0` warnings/errors).
- `cd rebuild/app && npm run build`: **Passed** (`tsc --noEmit && vite build`).
- `cd rebuild/app && npm run audit:offline`: **Passed** (`165 source files, dist/, CSP, capabilities and dependencies checked`).
- `cd rebuild/app && flock /tmp/grove-npm-test.lock npm test`: **Passed** (`vitest`: 58 test files, 530 passed; all browser verification scripts and `posttest` passed on the first run).

---

## 5. Follow-up Note for Chris

- `src/mock/backend.ts` (line 9, `WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g`) and `src/links/internal.ts` (`rewriteLinks`, line 141) already allow `[` and `^` (without `#`) in targets, matching the decided rules above, though neither currently normalizes `\|` to `|` before splitting on `|` when rewriting links on rename (`backend.ts` was off-limits in this step because Codex is editing it in Step 3). If link-rename rewriting should also preserve `[[Old\|alias]]` -> `[[New\|alias]]`, we can align `rewriteLinks` and `mock/backend.ts` after Step 3 merges.
