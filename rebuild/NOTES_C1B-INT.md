# C1-B integration catch-up

Branch `rebuild/c1b-search-codex`, starting at `3cd98aa`. No rebase or push.

## Merges

- `31418b4`: `git merge --no-ff --no-edit rebuild/c1b-review-grok` (`0ac11c4`). Clean merge; adds the 78-line `NOTES_C1B-REVIEW.md` with VERDICT OK.
- `452802a`: `git merge --no-ff --no-edit rebuild/f1-fuzz-grok` (`0372988`), followed by the resolutions below and a regression test. F1 already contains integration `2f82a1f`.

## Conflicts and resolutions

Exactly two files conflicted:

- `rebuild/app/src/shell/searchVault.ts`: kept C1-B's `NoteFacts` / `createSearchVault` per-content cache and its cached `content` function. Kept F1's `isNoteFile` import and used it for both the note list and note-versus-attachment output. Removed the `.md` suffix regex constant. The file/path empty-term guard stays intact.
- `rebuild/app/src/mock/backend.ts`: retained both `isNoteFile` and `createSearchVault` imports. Took `isNoteFile` for the conflicting tags line, and changed the three non-conflicting C1-B filters in `searchFiles`, `searchNotes`, and `searchLines` to that same predicate. Kept F1's other classifications and C1-B's search command/cache bodies.

The other requested resolutions were already clean in F1's integration catch-up:

- `paths.ts` and `paths.test.ts` are byte-identical to F1's versions. One `isNoteFile` requires a basename longer than three characters and a case-insensitive `.md` suffix. Nameless `.md` / `.MD` are attachments; `Upper.MD`, `a.md`, and `..md` remain notes. `noteName` preserves a nameless file's full label.
- `graph/source.ts` is unchanged from C1-B: it keeps `graphFileLists` and all of the batched `facts` / `searchMatch` implementation. The deleted `searchFacts` path was not restored.
- `graph/data.ts` retains `graphFileLists` and imports both `isNoteFile` and `noteName`; node labels use `noteName`. Bases retains integration's `baseNoteFiles` helper, which uses the same predicate.
- Other incoming F1 changes were preserved without additional manual edits. `scripts/bench-frontend.mjs` is unchanged; Gemini's benchmark-script follow-up remains separate.

Added one 22-line mock regression test covering both nameless suffix spellings alongside `Upper.MD`. It checks note counts, paged lines, tag/property omission, and graph matching: nameless files never enter note results or content facts, but can still match by filename/path as attachments. The existing normal `.MD` behavior remains.

## Validation

All heavy checks ran under `/tmp/grove-npm-test.lock`; Cargo used `--offline`. No new dependencies, external network, GUI windows, real vaults, or Obsidian code/assets were used. The predicate follows Chris's explicit decision; the merge resolution follows `NOTES_C1B-REVIEW.md`'s F1 section.

- `npm run build`: passed; existing large-chunk advisory only.
- `npm run audit:offline`: passed, 166 source files plus dist/CSP/capabilities/dependencies checked.
- `cargo build --offline`: passed.
- `cargo test --offline`: 58 passed, 0 failed, 2 ignored benchmark tests; main/doc tests have no cases. Shared corpus: 337 cases, including 85 search cases; the F1 dot-name cases have no Rust todo markers.
- Full `flock /tmp/grove-npm-test.lock npm test`: exit 0. Four browser-discovery tests; 58 Vitest files / 679 tests; all 53 main browser-script stages, including C1-B's ten search/graph checks; Bases configuration posttest passed. No failures or retries. The 300-card/400-edge explorer drag check passed with max 16.8 ms.
- Conflict-marker and diff checks passed. Generated `rebuild/round*-shots` files were restored with `git checkout` before each commit. Prompt files and logs remain uncommitted.

No benchmark rerun was needed for this classification/merge task. The Rust evaluator and C1-B cache design are unchanged. No C1B-INT implementation work or decision remains open.

## Files and line totals

Review merge: one notes file, +78/−0. F1 merge plus regression, relative to its first parent `31418b4`: 17 files, +309/−41. Together, relative to starting `3cd98aa`: 18 files, +387/−41, before this notes file.

- `rebuild/NOTES_F1.md`: +164/−0.
- `rebuild/app/fixtures/parity/README.md`: +1/−1.
- `rebuild/app/fixtures/parity/search.json`: +45/−0.
- `rebuild/app/src/canvas/controls.ts`: +2/−1.
- `rebuild/app/src/canvas/editing.ts`: +2/−1.
- `rebuild/app/src/canvas/view.ts`: +2/−2.
- `rebuild/app/src/editor/livePreview.ts`: +2/−1.
- `rebuild/app/src/editorHost.ts`: +3/−2.
- `rebuild/app/src/graph/data.ts`: +2/−2.
- `rebuild/app/src/links/internal.ts`: +3/−3.
- `rebuild/app/src/mock/backend.test.ts`: +22/−0.
- `rebuild/app/src/mock/backend.ts`: +18/−14.
- `rebuild/app/src/paths.test.ts`: +13/−0.
- `rebuild/app/src/paths.ts`: +18/−6.
- `rebuild/app/src/shell/hoverPreview.ts`: +2/−1.
- `rebuild/app/src/shell/searchVault.ts`: +6/−6.
- `rebuild/app/src/workspace.ts`: +4/−1.

This notes file adds 61 lines.
