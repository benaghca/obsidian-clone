# P1: Faster renames, folder moves, and link lookups

Approved by Chris on 9 Nov 2026, 8:50 PM PT. Build this on `rebuild/g1-claude` from the brief commit on `rebuild/integration`. Claude builds; Codex reviews independently, read-only. Commit locally. Never push.

Chris's standing priority for this work: core features and look/feel come before new features. The app must stay responsive, fast, functional, and seamless. Small annoyances during a rename or move will drive people away. Judge that friction as well as correctness. Do not widen this task into new features.

## In plain words

When Grove looks up a `[[link]]`, or rewrites links after a rename or folder move, it still does more repeated work than it should. A single note rename is already noticeable in a large vault. Moving a folder of hundreds of notes was measured as taking minutes to hours of JavaScript, so the app would look frozen.

Some of the lookup caching is already in place (`rebuild/NOTES_LINK-INDEX.md`): one index can be reused for many lookups on the same notes array. Hover previews, canvas cards, and one workspace fallback still build a fresh index on every call. Folder moves still rewrite links once per moved note, instead of in one pass. That remaining work is this task.

## The problem

From `rebuild/RUST_PERF_PLAN.md` §4.1 (finding 1). This is a TypeScript change only.

- `resolveLink(target, from, notes)` used to build `new Map(notes…)` on every call. A rename calls it for every link on every linking line. A folder move calls `rewriteLinks` once per moved note for every linking note: `pairs × sources × links`, each lookup historically O(N).
- Part of the cache already landed: `linkResolver` is cached per notes array in a `WeakMap` in `links/internal.ts`, and callers that already reuse one array share it. Still left open, and in scope here: hover preview, canvas, and the workspace's second lookup (`vault.files.filter` of non-directories) allocate a new array per call, so each of those still pays for a new index. An in-place change to a note's `path` or `name` on an array whose length stays the same is not seen until the array is replaced.
- `updateLinks` still needs to pass every moved pair through **one** rewrite pass per linking note (a map from old path to new path), not one pass per pair.

Plan baseline (Node, `scripts/bench-feel.mjs`, before later link-index work; re-measure on this tree before changing code):

| Work | 5k | 20k | 50k |
|---|---:|---:|---:|
| `resolveLink` once | 1.2 ms | 3.4 ms | 15.0 ms |
| `ws.resolve` of a missing note | 1.4 ms | 6.5 ms | 22.3 ms |
| Rename one note (4 linking notes) | 10 ms | 33 ms | 169 ms |
| Move folder `Folder 00/Sub 0` | 50 notes, 121 sources: **11 s** (est.) | 200 notes, 509 sources: **13 min** (est.) | 500 notes, 1,313 sources: **4.5 h** (est.) |

## Requirements

Follow the plan's TypeScript fix, reusing the cache that already exists:

1. `linkResolver(notes)` builds the name, alias, and path maps once and is cached per notes array, the same way `linkTargets` already is. Keep alias invalidation correct: the cached resolver must be invalidated on every file-list or alias change (aliases come from properties).
2. `resolveLink` keeps its exact current rules and becomes a thin call into that resolver. The parity corpus (`fixtures/parity/links.json`) and `internal.test.ts` must pass unchanged. Do not rewrite the resolution grammar.
3. `updateLinks` / `rewriteLinks` pass every moved pair to **one** rewrite pass per linking note (old path → new path), not one pass per pair.
4. Move these callers onto the cached resolver, including the ones the earlier link-index work left alone: `ws.resolve` / `linkTo` in `workspace.ts` (those functions only), `editorHost.ts` (`resolve` only), `shell/hoverPreview.ts`, `canvas/view.ts` (the one lookup line), and the mock link index in `mock/backend.ts`.
5. A folder-move test with 50+ notes must compare against today's output on a small vault before and after, so rewritten text stays identical.
6. The mock must get fast enough that P0's hitch tests can be run above the current 5k synthetic vault (the plan's next step is 20k).

Do not invent a new public API unless the existing functions cannot be extended. Prefer extending `linkResolver` / `rewriteLinks` in place.

## Performance targets (measure before and after)

Budgets from `RUST_PERF_PLAN.md` §1 and §4.1. Record before/after in the notes file.

- **Folder move:** a 500-note folder move at 50k finishes in **≤ 2 s**, and the app stays responsive throughout. JavaScript rewrite time should be well under a second (plan estimate: about 1,313 single-pass rewrites at under 50 µs each, plus reading and writing those notes).
- **Lookups:** each hover, embed, backlinks row, and Bases link cell goes from ~15 ms to **microseconds** at 50k when the resolver is already warm.
- **Background work:** no main-thread block over 50 ms during rename or move (page or Rust main thread). Existing P0 feel budgets other than the known held graph gap stay enforced.
- **P0 hitch tests:** `scripts/test-feel.mjs` is already in `npm test` at 5k. It must still pass (the graph frame budget stays a reported known gap unless `GROVE_FEEL_STRICT_GRAPH=1`). After the mock is faster, run it at 20k as well and record before/after. Do not weaken assertions.

How to measure (scratch vaults under `/tmp` only):

```text
# From rebuild/app. Generate only if the vault is missing:
# node scripts/gen-vault.mjs /tmp/grove-bench-5000 5000
# node scripts/gen-vault.mjs /tmp/grove-bench-20000 20000
# node scripts/gen-vault.mjs /tmp/grove-bench-50000 50000
node scripts/bench-feel.mjs /tmp/grove-bench-5000
node scripts/bench-feel.mjs /tmp/grove-bench-20000
node scripts/bench-feel.mjs /tmp/grove-bench-50000
flock /tmp/grove-npm-test.lock npm test
# After the mock is fast, also:
flock /tmp/grove-npm-test.lock node scripts/test-feel.mjs
# and a 20k run if the script accepts a size (use the same entry path P0 already uses; do not add a new test harness unless the current one cannot take 20k).
```

Measure first on this tree before changing product code, because some lookup caching has landed since the plan's table. If a 50k vault cannot be generated or the 50k folder-move bench cannot be run in a reasonable time, say so in the notes, publish the largest size you did run, and still keep the 50k / 2 s target as the bar.

`write_notes` (one batched write and one index update) is **P2**, not this task. P1 still saves through today's write path. The 2 s budget is for the whole move Chris would feel; say in the notes how much was JS rewrite vs writing files, so a write-bound result is not mistaken for a failed rewrite.

## User-facing friction (in scope, not a feature expansion)

Correct link text is not enough. This work is about a core action (rename and move, and the lookups that feed hover, embeds, and backlinks) feeling instant and seamless. When measuring and when reviewing, also check:

- **Lag and freezes:** the UI must not sit frozen during a rename or folder move. No long main-thread block over 50 ms. Typing and clicking should remain possible; if the existing UI already disables input for the duration of a move, do not add a new blocking mode, and keep that duration inside the budget.
- **Focus:** the open note, caret, and selected file must not jump or clear except where today's successful rename already does (for example the renamed file staying selected). Do not steal focus to a dialog, log, or another pane.
- **Flicker:** the open note, sidebars, and canvas must not flash, remount, or briefly show an empty state just because links were rewritten.
- **Extra steps:** do not add confirmations, prompts, settings, or new commands. The user still renames and moves the way they do today.
- **Stale link display:** after the move finishes, visible `[[links]]` in the open editor, backlinks, hover previews, canvas cards, and rewritten files must show the new path or name. They must not keep showing the old one until a later refresh or reload.

Fix only friction caused by this lookup and rewrite work, or that this work would newly introduce. Do not start a general polish pass.

## Hard rules

- Work only under `rebuild/app/` TypeScript, tests, and this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- Do not edit `rebuild/app/src-tauri/` (Rust is the other owner's). P1 is TypeScript, not Rust.
- Do not touch `src/bases/*` or `editor/embeds.ts`. Embeds must keep resolving through `editorHost.ts`.
- No new crates or npm packages. No new dependency without a written reason, and this task should not need one.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline`. Run `cargo test --offline` only if Rust changed, which it should not.
- Restore any screenshots before committing.
- Commit locally on `rebuild/g1-claude`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config.

## Size discipline

- Smallest change that delivers the fix. Reuse and extend `linkResolver`, `rewriteLinks`, and the existing WeakMap cache first.
- Delete code this change makes dead.
- Keep any file under ~800 lines; split by responsibility only if a touched file would go over.
- Do not drive this into P2 (batched `write_notes`, incremental Rust maps, deltas) or later P-tasks.

## Scope

**In scope:** the files the plan lists, and their tests: `links/internal.ts`, `links/update.ts`, `workspace.ts` (`resolve` / `linkTo` only), `editorHost.ts` (`resolve` only), `shell/hoverPreview.ts`, `canvas/view.ts` (one lookup line), `mock/backend.ts` (link index), and tests for those. Notes file as below.

**Out of scope:** `write_notes` and anything in §4.2–4.10 (P2–P8, B7, graph worker, file-tree virtualization). New drawing or template features. Changing feel-test budgets, including the held graph gap. Opening or measuring the real app window.

## Done when

- Requirements 1–6 are implemented, with the parity corpus and `internal.test.ts` unchanged and passing.
- Before/after numbers are in the notes for `bench-feel.mjs` (rename, folder move, `resolveLink` / missing-note resolve) and for P0 `test-feel.mjs` at 5k, plus 20k if you could run it.
- The 50k / 500-note folder move is ≤ 2 s, or the notes explain the largest size run and what still bounds it (rewrite vs writes).
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- User-facing friction checks above are recorded in the notes (even if some can only be reasoned from tests and code, because GUI windows are not allowed).
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_P1-claude.md` before you finish, and commit it with the code. Include:

- What changed, in plain words, and which existing cache you reused.
- Before/after measurements (tables), including JS rewrite time vs file-write time for folder moves.
- P0 `test-feel.mjs` before/after (and 20k if run).
- User-facing friction: what you checked, what you could not check without a window, and any lag, freeze, focus, flicker, extra-step, or stale-link issue you found or ruled out.
- Net line change by language and by file.
- Any new dependency (should be none) and any file that approached 800 lines.
- Anything left for P2 or a later pass, without doing that work now.
