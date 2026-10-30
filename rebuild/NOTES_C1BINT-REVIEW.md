VERDICT: OK

Reviewed `rebuild/c1b-search-codex` at `456d748` (F1 merge `452802a`, notes `456d748`) against integration `542d984` and the F1 section of `NOTES_C1B-REVIEW.md`. This branch is `rebuild/c1bint-review-grok`. Codex's branch was not moved. Nothing was pushed. No product file was edited.

## What the catch-up changed

`452802a` merges F1 `0372988` into C1-B after the review merge `31418b4`. Relative to current integration, `542d984..456d748` is 21 files, +709 / −339. That diff is the C1-B search switch, its notes, and the absence of `NOTES_F1INT-REVIEW.md`.

`paths.ts`, `paths.test.ts`, `graph/data.ts`, `bases/view.ts`, the canvas and editor call sites, `links/internal.ts`, `workspace.ts`, `hoverPreview.ts`, the parity README, and `search.json` match integration. Those F1 files were not rewritten by the catch-up.

`git diff 3cd98aa HEAD` (original C1-B notes to this tip) is 19 files, +448 / −41. `searchRead.ts`, `searchView.ts`, `sideView.ts`, `menu.ts`, `api.ts`, `graph/view.ts`, and `graph/source.ts` are unchanged from that C1-B commit. The search switch was not edited again while F1 landed.

## Conflict resolutions

The merge conflicted in two files, and both follow the F1 section of `NOTES_C1B-REVIEW.md`.

- `searchVault.ts` keeps C1-B's `createSearchVault` cache and filters notes with `isNoteFile`. The `NOTE` regex is gone. The empty-term guard remains, so `file:` and `path:` still contribute no shown lines.
- `mock/backend.ts` imports both `isNoteFile` and `createSearchVault`. Tags use `isNoteFile`. `searchFiles`, `searchNotes`, and `searchLines` use `isNoteFile` too, which is the change the review asked for on the three filters that would otherwise have auto-merged as `/\.md$/i`.

The other requested files were already settled on the F1 tip, and they stayed that way:

- `isNoteFile` is a basename longer than 3 characters and a case-insensitive `.md` suffix, the same rule as Rust `is_note_path`. `Upper.MD` is a note. `.md` and `.MD` are not. `noteName` strips `.md` only for a real note.
- `graph/source.ts` is C1-B's batched `searchMatch` path and still calls `graphFileLists`. `searchFacts` is not restored.
- `graph/data.ts` imports `isNoteFile` and `noteName`. Bases still uses `baseNoteFiles`.

`linkSources` still requires `isNoteFile` for its needles, its scan, and its returned paths. The new mock test creates `C1B-INT/.md`, `C1B-INT/.MD`, and `C1B-INT/Upper.MD`. Content search and shown lines return only `Upper.MD`. Tags and properties omit the nameless files. `search_match` for `path:C1B-INT file:md` returns all three, with the nameless files as attachments.

## C1-B behavior

D1 is intact. `searchReader` still flushes before `search_notes`, and the graph still flushes before `search_match`. One `search_notes` stays in flight, and the view sequence still drops a stale reply. D2 is intact: `search_notes` returns `{ path, count }`, and the contract still describes that payload. File-only and path-only graph queries stay in TypeScript. A `doc` change still clears the graph cache without drawing, and `files` / `links` still clear it and rebuild.

## Nothing dropped

Every product hunk in `542d984..456d748` is the search switch: the three commands, the view, the graph batch, the deleted `searchFacts.ts`, and the mock cache. F1's note rule is the same bytes as integration on the shared files.

This tip does not contain `NOTES_F1INT-REVIEW.md`, because it merged F1 at `0372988`, before review commit `a6f26a2`. `git merge-tree --write-tree rebuild/integration 456d748` is clean (exit 0). The merged tree still contains `NOTES_F1INT-REVIEW.md` alongside the three C1-B notes files. A later merge into integration keeps that review.

## Dot-name cases

`search.json` has no `"rust": "todo"`. The three `dot-name` cases are the shared result: `secretprobe` matches only `Real.md`; `file:md` records `.MD` as `{}` and `Real.md` as a note with no lines; `file:MD` with match case records only `.MD` as `{}`. `parity.test.ts` (343) and `index::parity::corpus` both passed.

## Dead code

`searchFacts.ts` and `matchingNotes` are gone from the app. `scripts/bench-frontend.mjs` still imports both. That file is unchanged, and Gemini still owns it.

## Tests

From `rebuild/app`: `npm run build` passed (`tsc --noEmit` and Vite). `npm run audit:offline` passed: 166 source files, dist, CSP, capabilities, and dependencies. The existing chunk-size warning is still printed.

From `rebuild/app/src-tauri`, offline: `cargo build` finished the dev profile in 0.18s. `cargo test` passed, 58 tests, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`).

`flock /tmp/grove-npm-test.lock npm test` exited 0. Vitest: 58 files, 679 tests, 706 ms, including `parity.test.ts` (343) and `readOrdering.test.ts` (16). The browser chain passed on the first run, including the ten search/graph checks. The 300-card drag check was max 16.8 ms. The 1000-row Bases scroll was max 16.8 ms. `posttest` passed. No stage was rerun. Screenshot fixtures under `rebuild/round*-shots/` were restored and are not in this commit.

## Left open

`scripts/bench-frontend.mjs` still calls the deleted search helpers. No decision is waiting on Chris.
