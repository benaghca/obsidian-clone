# NOTES_P1: faster renames, folder moves and link lookups

Branch `rebuild/g1-claude`, from the brief commit `9f78826` on `rebuild/integration`. TypeScript only. No Rust, `src/bases/*` or `editor/embeds.ts` file was touched. Nothing was pushed. No app window was opened. Every vault used was under `/tmp`.

## In plain words

- **Folder moves no longer freeze the page.** Before, the app rewrote every linking note once per moved file. Now it rewrites each linking note once, with every move in one map.
  - In the browser mock, moving a 3,333-note folder at 20k notes used to be one **241 s** freeze.
  - It is now **0.58 s** of link rewriting. With Tauri-like IPC boundaries, the whole move costs **577 ms** of page time.
- **The rewritten text is byte-for-byte what the old code wrote.** This was checked several ways:
  - against the literal pre-P1 code, on a 64-note test vault, in every link format;
  - by random fuzzes (scratch, not committed): 1,017 cases at first, then 4,053 and 8,091 cases after the review fixes, with note/image name clashes forced into the moved folder;
  - by a hash of the whole mock vault after each real browser move (5k and 20k).
- **Lookups are microseconds when warm.** Hover previews, canvas cards, `ws.resolve`'s fallback, `ws.linkTo` and the embed host now share one cached file array (`Vault.fileRefs()`). So they share one index.
  - A missing-note resolve at 50k went from 18.6 ms on every call to 18 ms once per file list, then 0 ms.
  - A one-note rename at 50k went from 7.0 ms to 0.08 ms. The shortest-link clash check was a scan of every note per rewritten link; it now uses the same index.
- **The move yields.** About every 8 ms the move lets the page paint, so a move never becomes one long task, even when reads settle without a task boundary (loaded notes, the mock). Sources are read 16 at a time. Writes stay one at a time on purpose: `write_note` runs on the GTK main thread.
- **The mock answers link commands from one walk per vault state.** `link_index`, `backlinks` and `link_sources` share it, and replies are copies, as IPC would hand back.
- **What still bounds a 50k / 500-note move is the writes, not the rewrite.** The JS rewrite is **19 ms**. Each `write_note` costs about 26 ms on the Rust main thread at 50k (RUST_PERF_PLAN §3.1). That makes the full move about **35 s**, by estimate. Batching writes is P2 (`write_notes`), so **the 2 s target is not met at 50k** and is left to P2.

## Fixes after the review

Codex reviewed `8b7371a` independently: **FAIL**, with three required fixes. All three are fixed here, each with a regression test. Each test fails on `8b7371a` and passes now (checked by running it against `8b7371a`'s `update.ts` / `internal.ts`).

1. **High: typing during a yield was lost.** `updateLinks` read each note, yielded, and later wrote the result computed from that earlier read. Now every note is checked just before its write:
   - **Loaded:** the editor's text right then. If it differs from what was read, the links are rewritten in the current text.
   - **Not loaded:** the job listens to `Vault.onModified` (our saves, and outside changes through `vault-changed`). A note modified since its read is read again and rewritten in the new text.

   Nothing waits between taking the text and handing the result to `updateNoteText`, so an editor can't change in between.

   Tests (`links/updateRace.test.ts`, real `updateNoteText` on CodeMirror states):
   - typing on a line, and typing a new line, into two loaded linking notes after the first write: both kept, and the link rewritten;
   - a note changed on disk mid-move: the change kept, and its new link rewritten too.
2. **High: a second move during the rewrite left obsolete paths.** Old → New, then New → Final mid-job: `8b7371a` recreated 20 notes under `New/` and left old links in the `Final/` copies. Two parts:
   - **`fileOps.ts` (coordination).** `relocate` now registers itself while it runs and first waits for note writes already sent through `updateNoteText`. `isMoving()` / `movesSettled()` let a link update hold its next read or write until no move is running. The check happens just before each request is sent.
   - **`links/update.ts` (rebase).** The job listens to `ws.onMove`, which now returns its unsubscribe (one line in `workspace.ts`). On each later move it carries everything along:
     - the moved files' new paths;
     - each linking note's current path;
     - the after-move snapshots (names follow a rename);
     - the modified-note marks.

     A read that failed because its note moved mid-read is tried again at the new path. Links still resolve against the snapshot from before the first move, from the note's original path, so a note's untouched old links still find their targets.

   The test runs the real `renameFile` twice (Old → New, then New → Final after the fifth write), on 20 notes linking each other and 40 linking from outside, one of them loaded. Afterwards: nothing under `Old/` or `New/`, all 20 under `Final/`, and no `[[Old/…` or `[[New/…` link anywhere, on disk or in the editor.
3. **Medium: grouping changed which file an embed targets.** `8b7371a` resolved the notes group first. The fix is described under "Pair order" below.
   - `update.test.ts` checks Codex's case (`Move/Img/photo.png`, `Move/Img/Source.md` with `![[photo.png|300]]`, `Move/Note/photo.png.md`) in both file orders, with absolute and with shortest links, against what `9f78826` wrote. In absolute: `![[New/Img/photo.png|300]]` when the image comes first, `![[New/Note/photo.png|300]]` when the note comes first. In shortest, with the note first, the old code rewrote the link twice (2 links), and so does the new.
   - The same test passes when run against `9f78826`'s own code.
   - **The first fuzz missed this.** P1's random vaults never put both kinds in one moved folder: the old notes-first rule also scored 0 differences. Once 40% of the vaults held such a pair, notes-first scored 81 differences against `9f78826`, and taking the earliest pair alone still scored 77, because of the chained rewrites. With the chains replayed: **0 of 4,053**, then **0 of 8,091** on another seed.

Not changed, as the brief allows:
- A yield comes only between notes, so one very large note is still rewritten in one go. That's inherited, not new.
- A note deleted while its links are being rewritten is written again, as before P1.
- The `write_note` cost at 50k stays P2's.

Cost of the fixes: the 50k one-pass rewrite went from 19.1 to 20.4 ms (1,313 sources), and the 5k one from 1.7 to 1.9 ms.

The browser move bench after the fixes, with the whole-vault hashes unchanged from before P1:

| Run | Links | Whole move | `updateLinks` | Long tasks | Hash |
|---|---:|---:|---:|---|---|
| 5k, IPC | 2,364 | 122 ms | 97 ms | 0 (max frame gap 16.7 ms) | `946309ed…` |
| 5k, mock | 2,364 | 545 ms | 80 ms | 1 × 488 ms (mock work, as before) | `946309ed…` |
| 20k, IPC | 9,941 | 575 ms | 477 ms | 1 × 86 ms (file tree, P6) | `3325ea22…` |
| 20k, mock | 9,941 | 6,812 ms | 593 ms | 1 × 6,284 ms (mock work, as before) | `3325ea22…` |

## What changed

Reused, not replaced: the `WeakMap` note index in `links/internal.ts` (`indexNotes`, from `NOTES_LINK-INDEX.md`) and the existing `Vault.fileRefs()` cache.

- **`links/internal.ts`**
  - `rewriteLinks` gets a second overload: `rewriteLinks(text, from, moves, style, fromAfter)`, where `moves` is `{ moved: Map<old, new>, before, after }[]`.
    - Each wikilink and Markdown link is resolved once in each group's `before` snapshot, then looked up in `moved`.
    - The first group with a hit writes the new link against that group's `after`.
    - The single-pair form is unchanged and is now a thin call into the same body. Fences, inline code, CRLF, escaped parentheses, headings, aliases and the overlap rule are all unchanged.
  - The "shortest" format's clash check (`linkPath`) used `notes.some(...)` over every note for each rewritten link. It now reads `indexNotes(notes).byName`, which is the same test: another note with that name, any case.
  - Resolution rules (`resolveIndexed`) were not edited.
- **`links/update.ts`**
  - `updateLinks` builds at most two groups:
    - moved notes, resolved among the notes before the move;
    - moved other files, resolved among every file (as before).
  - It makes one `rewriteLinks` call per linking note, instead of one per moved pair.
  - Sources are read in batches of 16.
  - `breathe()` yields with `setTimeout(0)` once a slice passes 8 ms, during both the rewrites and the writes. Writes stay sequential.
- **Callers on the shared cache:**
  - `workspace.ts` `resolve` and `linkTo`: `vault.files.filter(...)` became `vault.fileRefs()`.
  - `editorHost.ts` `resolve` uses `vault.fileRefs()`. Its private copy of the same cache was deleted.
  - `shell/hoverPreview.ts` and `canvas/view.ts` each changed one line, to `vault.fileRefs()`.
  - Names match: `fileRefs` names notes with `noteName` and other files by their whole name, the same as Rust's `display_name` / `strip_md`.
- **`mock/backend.ts`**
  - A `revision` counter is bumped in `put`, `rename_path` and `delete_path`, the only places the mock changes `files`.
  - `linkData()` walks once per revision and keeps backlinks for every target.
  - `backlinks` slices that walk; `link_sources` reads it.
  - `link_index` and `backlinks` return `structuredClone` copies.
- **Scripts**
  - `test-feel.mjs` takes `GROVE_FEEL_N` (default 5,000, which `npm test` uses), so the same P0 entry runs at 20k. No budget or assertion changed.
  - `bench-feel.mjs` now times:
    - the missing-note resolve on a shared array, cold and warm;
    - the real one-pass folder rewrite over every source.

    The old per-pair estimate is kept, so before and after line up.

**Aliases.** The link resolver has never read frontmatter aliases (`NOTES_LINK-INDEX.md`), and it still doesn't. No cache here holds aliases, so there's nothing for an alias change to invalidate. The note index is keyed by array identity plus length. `Vault.refreshFiles` replaces `files` and `notes` (and so `fileRefs()`) on every file-list change. The only in-place change is `touch()` writing `mtime_ms`, which the index doesn't read.

**Pair order (fixed after the review).** 8b7371a put the notes group first, so a link that a moved note *and* a moved file both answered could change target: `![[photo.png|300]]` next to `photo.png` and `photo.png.md`. Each move now carries its place in the file list (`order`). For each link, the one pass replays the old passes:
- it takes the earliest move the link resolves to, in that move's own group;
- it then offers the rewritten link to the later moves, which may move it again, as the next pass did;
- each step counts as a changed link, so the counts shown in "Update links?" match too.

A wikilink whose new path holds `]`, `|`, `#` or a line break stops there, because the old next pass would have read a different link. See "Fixes after the review".

## Measurements

Same machine and session for before and after. Vaults are from `scripts/gen-vault.mjs`, and their hashes match RUST_PERF_PLAN §2 (`5b03c1be…`, `1e7c07c8…`, `d5723282…`). They were regenerated under `/tmp` because they were missing. `node_modules` was installed with `npm ci --offline` from the unchanged lockfile, because this worktree had none. That is not a package change.

### `bench-feel.mjs` (Node, ms; medians of 5, or 3 for the folder move)

| Work | 5k before | 5k after | 20k before | 20k after | 50k before | 50k after |
|---|---:|---:|---:|---:|---:|---:|
| `resolveLink` once (shared array) | 0.01 | 0 | 0.01 | 0 | 0 | 0 |
| Missing note, `ws.resolve` (both lookups) | 1.22 | 0.01 (cold 1.64) | 5.63 | 0 (cold 5.7) | **18.63** | **0** (cold 17.8) |
| Rename one note (4 / 3 / 4 linking notes) | 0.65 | 0.09 | 1.83 | 0.08 | **6.97** | **0.08** |
| Folder move `Folder 00/Sub 0`: notes / sources | 50 / 121 | | 200 / 509 | | 500 / 1,313 | |
| … per-pair loop (old algorithm, estimated from 3 sources) | 0.1 s | 0.1 s | 1.4 s | 1.3 s | **8.4 s** | 7.3 s |
| … one pass, every source, measured | – | **1.7** (max 3.9) | – | **6.5** (max 17.6) | – | **19.1** (max 45.1) |

The plan's table (5k 11 s, 20k 13 min, 50k 4.5 h) predates the link-index work. On this tree, before P1, the per-pair loop was already down to the estimates above. The "cold" figure is the first call after a file-list change, which builds the index once. It's paid once per file list, not per hover or embed. `resolve_one` was already warm on this tree.

### A real folder move in the app (headless Chromium, browser mock)

Scratch script, not committed. It loads `?synthetic=N` and calls `fileOps.renameFile(ws, "Journal", "Journal moved")`, the same path as the file explorer's rename. It awaits `updateLinks` (no confirmation) and records:
- long tasks;
- requestAnimationFrame gaps;
- time spent in each `api` call;
- the SHA-256 of every file afterwards.

The synthetic vault's `Journal` folder holds a sixth of the notes. `link_sources` returns many sources because note names like `alpha beta 1` are substrings of others, the same rule Rust applies.

Two modes:
- **Mock:** the mock's own replies. These are synchronous, so they block the page.
- **IPC:** every `api` call answers one `MessageChannel` task later, as Tauri IPC answers in a later task. `link_sources`, `link_index` and `backlinks` answer from caches made before the clock starts, as `test-feel.mjs` does. Rust runs those off the page thread, so this mode shows page-side work only.

| 5k: 833 notes move; 2,472 sources read, 1,777 notes rewritten, 2,364 links | Before (mock) | After (mock) | After (IPC) |
|---|---:|---:|---:|
| Whole move | 11,515 ms | 526 ms | **120 ms** |
| `updateLinks` (read, rewrite, write) | 10,830 ms | 72 ms | 94 ms |
| Long tasks | 1 × 11,531 ms | 1 × 477 ms ¹ | **0** |
| Largest frame gap | 11,533 ms | 467 ms ¹ | **16.7 ms** |
| Vault hash after | `946309ed…` | `946309ed…` | `946309ed…` |

| 20k: 3,333 notes move; 7,429 sources read, 4,542 rewritten, 9,941 links | Before (mock) | After (mock) | After (IPC) |
|---|---:|---:|---:|
| Whole move | **241,660 ms** | 6,851 ms | **577 ms** |
| `updateLinks` | 231,201 ms | 581 ms | 474 ms |
| Long tasks | 1 × 241,711 ms | 1 × 6,338 ms ¹ | 1 × 90 ms ² |
| Largest frame gap | 241,707 ms | 6,333 ms ¹ | 117 ms ² |
| Vault hash after | `3325ea22…` | `3325ea22…` | `3325ea22…` |

¹ What's left in mock mode is the mock doing Rust's work on the page thread. At 20k, that's `link_sources` (2.0 s, mostly its substring scan for 3,333 names) and the link walk after the rename inside `followMove` (4.2 s). In the app those commands run in Rust, off the page thread.

² The one remaining long task in IPC mode is in `followMove`. `refreshFiles` → `changed("files")` handlers took 74.7 ms at 20k (17.8 ms at 5k), mostly the file tree rebuilding. That happens on every file-list change, rename or not. It's P6 (RUST_PERF_PLAN §4.7), not the link rewrite. P1 doesn't touch it.

### 50k / 500 notes: rewrite vs writes

The mock caps synthetic vaults at 20,000 notes, so 50k was measured in Node only.

- **The JS rewrite** for the 500-note `Folder 00/Sub 0` move: **19 ms** across all 1,313 sources (max 45 ms over three runs, with no yield in the bench loop; in the app, `breathe` slices it).
- **Reads:** 1,313 `read_note` calls, off the main thread, 16 at a time, so about 82 round trips.
- **Writes, estimated (not measured):** 1,313 `write_note` calls, one at a time. Each holds the GTK main thread for about 26 ms at 50k (the `upsert_note` map rebuild, RUST_PERF_PLAN §3.1), plus the atomic write and fsync. That's about **34–40 s**, with the window painting between writes, but each write is a block longer than a frame.

So **the 50k move misses the 2 s budget, and the bound is the writes.** P2's `write_notes` batch with incremental maps is the fix. The rewrite share of the budget is about 1%.

### P0 `test-feel.mjs`

| | 5k before (2 runs) | 5k after (2 runs) | 20k before | 20k after |
|---|---|---|---|---|
| Result | pass, pass | pass, pass | fail (3 misses) | fail (the same 3 misses) |
| Ready / links ready | 368 / 370, 364 / 369 ms | 308 / 309, 316 / 320 ms | 1,486 / 1,501 ms | 1,319 / 1,333 ms |
| Note switch (six) | all 33–34 ms | all 33 ms | all 33–34 ms | all 33–34 ms |
| Typing, switcher | 0 long tasks, max gap 16.8 ms | same | same | same |
| Expand the biggest folder | 0 long tasks | 0 long tasks | **1 × 69 ms**, gap 49.9 ms | **1 × 68 ms**, gap 50 ms |
| Graph (known gap) | p95 33.4, 0 long tasks | p95 33.4, 0 long tasks | **54 long tasks**, p95 100 | **55 long tasks**, p95 83.4 |

At 20k, the mock already loaded in about 1.5 s before P1 (the link-index work had fixed the 4.6-minute stall), so `test-feel` could run there. The three 20k misses are the file tree (P6) and the graph (P4). They're the same before and after, and P1 doesn't touch them. The 20k run isn't added to `npm test`, and no budget was changed. Run it with `GROVE_FEEL_N=20000 flock /tmp/grove-npm-test.lock node scripts/test-feel.mjs`.

## Tests

- **`links/updateRace.test.ts`** (new, after the review): typing and new lines in loaded notes mid-move, a note changed on disk mid-move, and a second folder move mid-rewrite, all through the real `renameFile` and `updateNoteText`. See "Fixes after the review".
- **`links/update.test.ts`** (new tests):
  - **64-note folder move, one pass vs one pass per pair.** The vault has clashing names across folders, headings, aliases, relative and partial paths, Markdown links with `%20` and escaped parentheses, image and drawing embeds, an extensionless file, code spans, fences, CRLF notes and unresolved links. Every written note equals the old per-pair loop's output, with over 500 links rewritten.
  - **Hashes of the literal pre-P1 code.** Five moves (folder rename, folder into a folder, subfolder out, one note, one image) × three link formats × both Wikilinks settings. The hashes were made by running `9f78826`'s own `updateLinks` / `internal.ts` beside the new code before committing, and that run also compared every written note directly: all 30 identical.
  - **A long move lets other tasks run.** Reads settle at once and each note costs 5 ms. With the yield disabled the test fails (checked).
- **Scratch fuzz (not committed):** 1,017 random cases: random vaults with case and name clashes, random link forms, random file and folder moves, three formats. Pre-P1 `updateLinks` vs the new one: **0 differences**. `formatLink` and `resolveLink` were also compared on each snapshot: identical.
- **`mock/backend.test.ts`:** the cached walk follows `write_note`, `rename_path` and `delete_path`, and a reply changed by the page doesn't change the next reply. It fails when the write path doesn't bump the revision (checked).
- **`workspace.test.ts`:** two cases built a fake vault without `fileRefs()`. They now use a real `Vault` over the same file list. The assertions are unchanged.
- **Unchanged and passing:** `internal.test.ts`, `fixtures/parity/links.json`, `test-links-embeds-edge.mjs` (its rewrite and resolve cases).

Full runs on the final tree, after the review fixes, first run, no retry:

- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`): exit 0. Vitest: 99 files, 1,544 tests. P0 at 5k passed, with the graph reported as the known gap (p95 33.4 ms, max 33.4 ms).
  - For the record: on `8b7371a`, the first full run had failed on the two `workspace.test.ts` fake vaults described above, and passed on the next run after they were fixed.
- `npm run build`: passed. The existing Vite large-chunk warning remains.
- `npm run audit:offline`: passed. 220 source files, dist, CSP, capabilities and dependencies checked.
- `cargo test`: not run, because no Rust changed.

## User-facing friction

Checked with the browser bench, the tests and the code. No window was opened, so WebKitGTK itself wasn't observed.

- **Lag and freezes.** The rewrite no longer blocks: at most about 8 ms of rewriting between paints. With IPC-like boundaries, a 833-note move at 5k has no long task and a 16.7 ms worst frame. The remaining page block at 20k is the file tree's 75 ms rebuild on the file-list change (P6), present before P1 for any rename. Rust-side `write_note` main-thread time is the remaining window-side cost at large sizes (P2). Because the move yields, the user can type, save or move again while it runs. 8b7371a then wrote its earlier snapshot over those changes. Each note is now checked just before it's written (see "Fixes after the review").
- **Focus and caret.** The rename flow didn't change: same `relocate` order, no new dialog, same "Update links?" prompt when that setting is off. Open notes are still updated through `updateNoteText`'s line-level change, so the caret and selection stay where they are, as before. The new yields don't move focus.
  - Typing in an open linking note during the move is kept, with or without a new line: the links are rewritten in the editor's text as it is just before the write. A note saved or changed on disk meanwhile is read again first.
- **Flicker.** There's one `refreshFiles` (in `followMove`) as before. Rewritten open notes change line by line, with no remount. The vault hash after a move is identical, so no extra or different writes happen.
- **Extra steps.** None: no new prompt, setting or command.
- **Stale links.** Hover previews, canvas cards, embeds, `ws.resolve` and `linkTo` read `Vault.fileRefs()`. That array is replaced on the file-list refresh in `followMove`, so the next lookup builds a fresh index with the new paths. No cache outlives a file list. The backlinks pane and link styling refresh from `refreshLinks` after `followMove`, and again one second after the last rewrite write, as before. The mock's walk is re-done after any change, so it can't serve the pre-move index.

## Line counts

Net change by file, all of P1 (`git diff --numstat 9f78826`, after the review fixes, plus this notes file):

| File | Added | Removed |
|---|---:|---:|
| `app/src/links/update.ts` | 153 | 33 |
| `app/src/links/internal.ts` | 69 | 15 |
| `app/src/fileOps.ts` | 28 | 2 |
| `app/src/mock/backend.ts` | 25 | 10 |
| `app/src/workspace.ts` | 5 | 5 |
| `app/src/editorHost.ts` | 2 | 6 |
| `app/src/shell/hoverPreview.ts` | 1 | 1 |
| `app/src/canvas/view.ts` | 1 | 1 |
| **TypeScript, app code** | **284** | **73** |
| `app/src/links/update.test.ts` | 163 | 16 |
| `app/src/links/updateRace.test.ts` (new) | 145 | 0 |
| `app/src/mock/backend.test.ts` | 28 | 0 |
| `app/src/workspace.test.ts` | 8 | 3 |
| **TypeScript, tests** | **344** | **19** |
| `app/scripts/bench-feel.mjs` | 13 | 1 |
| `app/scripts/test-feel.mjs` | 5 | 4 |
| **JavaScript, scripts** | **18** | **5** |
| `NOTES_P1-claude.md` | this file | |

The review fixes alone, against `8b7371a`: `update.ts` +138 / −32, `internal.ts` +38 / −22, `fileOps.ts` +28 / −2, `workspace.ts` +3 / −3, `bench-feel.mjs` +1 / −1, and tests +186 / −17 (including the new `updateRace.test.ts`).

- **No new dependency.**
- **Files near 800 lines:** none touched comes close. `workspace.ts` is 701 lines, `mock/backend.ts` 563, `links/internal.ts` 365, `fileOps.ts` 262 and `links/update.ts` 191.
- **Dead code removed:** `editorHost.ts`'s private `files` cache and its `NoteLike` import, and `update.ts`'s per-pair loop and `seen` set.

## Left for P2 or later (not done here)

- **P2:** `write_notes` (one batched write, one index update) and incremental Rust maps. At 50k this is the whole remaining cost of a big move (about 35 s of `write_note` estimated against a 19 ms rewrite).
- **P6:** the file tree rebuild on every file-list change (75 ms at 20k, measured here inside a move), and the 20k folder-expand miss in `test-feel`.
- **P4:** the graph's 20k long tasks in `test-feel`.
- The mock's `link_sources` substring scan is O(names × notes): 2 s at 20k for 3,333 names. It's mock-only, since Rust has its own, and is left as is.
- `editorHost.saveAttachments` still filters `vault.files` once per paste, outside this task's `resolve`-only scope. It's one lookup per paste, not per link.
