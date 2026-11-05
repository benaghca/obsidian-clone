# T1 review (Codex)

Reviewed `872bee5` on `rebuild/t1-review-codex` against the T1 row in `CINDER_GAP_PLAN.md` and `NOTES_T1-claude.md`. The review covers the pure merge, the existing property parser/editor it uses, the Insert template command, unit tests, and the native-key headless browser check.

## Result and fixes

The implementation meets T1: existing note keys win (including case variants and empty values), lists union in note-first order, new properties are copied, the body replaces the selection at the cursor, and a note without frontmatter receives the template block on top. BOM and CRLF handling are covered. Property and body changes share one CodeMirror transaction; the browser test verifies undo and redo in Source and Live Preview, separation from prior typing, and saving. No large issues remain.

Two small issues were fixed on this review branch:

- An empty body kept the selected text but the command always supplied a single cursor, collapsing the selection. The merge now reports whether it inserted a body. For a properties-only or empty insert the command lets CodeMirror map the existing selection through the property changes. The browser test checks an empty template and a properties-only template with a reversed selection, including its offsets and direction after the block is inserted.
- When `editProperty` refused a list union (for example, its existing 16 MB note limit), the merge silently continued and could copy other keys without reporting the missing list items. A refused union now rejects the property merge as a whole, preserves the note's original properties, inserts the body, and sets `skipped` so the existing notice is shown. A regression test exercises this limit without changing it.

Added explicit tests for an already oversized frontmatter block and for a merge that would exceed the line limit. Both keep the note properties untouched and report `skipped`.

## Choices checked

- List versus scalar: retaining the note's value is consistent with the plan's existing-key precedence. Union applies when both parsed values are lists. This includes the parser's fixed list types such as tags and aliases.
- Unsafe frontmatter: preserving the original properties and showing a notice is an appropriate conservative fallback. Duplicate keys, unreadable blocks, line-limit overflow, and refused property edits are covered. An unsafe template block is copied verbatim only when the note has no frontmatter, as documented by the author.
- Empty template body: preserving selected text is appropriate for properties-only templates; the review fix also preserves the editor selection itself.
- The changes remain within core templates and the existing `fillTemplate` variables. No Templater interpreter, `<% %>` expansion, folder-template automation, or weekly/monthly features were introduced.

## Validation

- `npm run build`: passed after the fixes.
- Focused Vitest: 21 tests passed, including both added refusal/line-limit cases.
- `flock /tmp/grove-npm-test.lock npm test`: passed, exit 0, including posttest. All 81 Vitest files and 1,303 tests passed; the template browser flow and new selection checks passed. The first sandboxed attempt failed at the browser-discovery process; the required rerun uses local headless-browser/server access. The shared lock is retained for the entire rerun.
- `npm run audit:offline`: passed after the fixes; 192 source files, distribution, CSP, capabilities, and dependencies checked.
- `cargo test --offline` in `rebuild/app/src-tauri`: 84 passed, 4 ignored, no failures.
- `git diff --check`: passed.

All browser tests use the existing headless mock-vault harness; no GUI windows or real vaults were opened. No packages, crates, network access, or Obsidian/Excalidraw code or assets were added. Scratch benchmark sources and logs are under `/tmp`. No push was performed.

## Performance

The 5,000-note frontend benchmark produced medians of 10.9 ms for vault tags, 13.9 ms for search, 4.7 ms for search page 5k, and 45.1 ms for link refresh. These are within the original implementation's recorded run-to-run range (11.1 / 13.2–15.6 / 5.2–5.3 / 41.3–47.2 ms, with the page operation slightly faster). The review changes do not affect these paths.

An alternating paired microbenchmark compared the original `872bee5` merge with the review version in the same Vite SSR process, 10 warmup and 50 measured calls per version per size, each with 40 existing properties and a mid-body cursor. Initial before/after medians were 0.168/0.168 ms at 4.3 KB, 0.224/0.225 ms at 320 KB, and 7.46/7.85 ms at 6.4 MB while the browser suite ran. The small-note results are unchanged; the large-note measurement includes allocation/GC and concurrent test load. Final quiet-run measurements are recorded below.

The final paired run after the suite completed measured before/after medians of 0.272/0.274 ms at 4.3 KB, 0.208/0.205 ms at 320 KB, and 6.43/6.16 ms at 6.4 MB. There is no meaningful regression. The existing large-note unit-test budget and the full suite's rendering/scale checks also passed.

Generated tracked files under `rebuild/round*-shots/` were restored after the suite. Only the review fixes, tests, and these notes are included in the local review commit. Existing untracked files were left alone.

T1 meets the plan and Chris's core-template scope after the two small fixes, with the required checks passing and no significant performance regression.

VERDICT: OK
