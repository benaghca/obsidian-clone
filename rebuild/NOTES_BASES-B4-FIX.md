# Bases B4 fix — host rename and nested-read cleanup

Branch `rebuild/b4-fix-grok`, from `rebuild/b4-review2-codex` `db097a8` (integration `78d3bb3`, plus Codex's `85dcb99`). Codex's branch is still `db097a8`. Nothing was pushed. `model.ts` and `menus.ts` were not edited.

Two findings from `NOTES_BASES-B4-REVIEW2.md`. The save-scheduling change and the mock `resolveLink` cold path were left alone.

## What changed

Product code +21 / −10, plus the browser regression. `view.ts` is the small marked change: `createBase` is where the host path is read, so the resolver has to be called there.

| File | +/− | Why |
|---|---:|---|
| `bases/view.ts` | +7 / −4 | `BaseOptions.host` may be a function. `hostPath()` is snapshotted once per evaluation and read again for `readsChanged`. Marked B4-FIX. |
| `bases/embed.ts` | +4 / −2 | Passes that function through. `update()` replaces the descriptor and does not call it while mounting. |
| `editor/embeds.ts` | +8 / −2 | The note on screen is `pathOf(view)` at evaluation time. A nested note stays the host. A failed `fill()` releases the painting it owns. |
| `editor/host.ts` | +2 / −2 | `BaseEmbed.host` allows the function. |
| `scripts/test-bases-embed.mjs` | +143 | The two browser regressions. |

`model.ts` still builds one shared host context per selection (`WeakMap`). The row's `host` is still one copy for that evaluation.

## Rename

A note rename keeps the editor and the base widget, so a host path copied at mount time kept filtering on the old file and the embed went to zero rows. `BaseWidget.embed` now returns a function for the note on screen: `editorHost.embeds.pathOf(view)`. The innermost note in `chain` is still a string, so a base drawn inside another note does not start reading the outer note. `mountBaseEmbed` stores that descriptor and `createBase` calls it when it builds rows and when it decides whether an edit is outside the folder filter. One call per evaluation is the snapshot. The next evaluation calls it again.

The tab still passes its path string. This fix is the embed.

## Failed nested read

`NoteEmbedWidget.fill()` already ignored a stale generation. Its rejection branch replaced the DOM and left the painted base, and its subscriptions, alive. It now releases that painting and clears `painted` only when this fill is still the current one. A rejection from an older read returns before that.

## Regressions

`test-bases-embed.mjs`, real pointer input, scratch vault:

- `Move/Rename.md` has a `base` block and `![[HostMove.base#Named]]`, both filtered with `file.path == this.file.path`. The file embed is switched to the view named First. Renaming the note to `Moved`, then the folder to `Shifted`, keeps both rows on `Shifted/Moved.md`, the formulas `this.file.path` and `this.file.folder`, and the names Self and First. `HostMove.base` is unchanged. With `writeNote` held, changing `status` to `fresh` shows on both embeds while disk still says `old`. Closing the note leaves zero bases and zero base subscriptions.
- `Outer.md` embeds `Nested.md`, which has a base block. After it mounts, a watched read is started and left hanging, a second read paints one new base, and rejecting the first read leaves that base up. A later rejection leaves zero bases, zero subscriptions, and the missing-note box. Restoring the read mounts one base. Closing Outer releases it.

## Performance

Same scripts as the review, this machine, before the patch and in the full `npm test` after it. Frames stay under 20 ms. The host lookup is one `pathOf` per evaluation.

| Measure | Before | After |
|---|---|---|
| Warm 1,000-note table (`test-bases.mjs`) | 8.3 ms | 8.7 ms |
| 1,000-row scroll, max frame | 16.7 ms | 16.8 ms |
| 5,000-row cold | 41.5 ms | 43.5 ms |
| 5,000-row warm, three opens | 15.5 / 13.4 / 12.6 ms | 15.9 / 22.5 / 13.4 ms |
| Typing beside the 5,000-row base | 16.7 ms, 0 during / 1 after | 16.7 ms, 0 / 1 |
| 1,000-card scroll, max frame | 16.8 ms | 16.8 ms |
| Embed cold / warm (`test-bases-embed.mjs`) | 86.5 ms; 7.8 / 7.6 / 7.0 ms | 84.7 ms; 7.0 / 6.4 / 5.9 ms |
| Embed typing / paged scroll | 16.8 ms, 0 / 1 | 16.8 ms, 0 / 1 |

A separate before-only `test-bases-b0.mjs` on the same tree, run immediately after the first, measured 5,000-row warm opens at 20.4 / 21.2 / 13.9 ms. The after sample of 22.5 ms sits in that spread. Nothing in this patch walks rows differently.

## Checks

- `npm run build`: passed. TypeScript and Vite, built in 370 ms. The existing chunk-size warning remains.
- `npm run audit:offline`: passed. 172 source files, dist, CSP, capabilities and dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first full run. Vitest 64 files / 1,058 tests, the browser, geometry and real-pointer scripts, and `posttest` (config, cards, embed, including the new cases). No retry.
- `cargo build --offline`: passed, dev profile in 0.13 s. `cargo test --offline`: 58 passed, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`). Binary and doc-test targets passed. Rust was not changed.

Screenshot fixtures under `rebuild/round*-shots/` were restored before the commits. Prompts and logs are not committed.

## What this relied on

`NOTES_BASES-B4-REVIEW2.md` (the proposed fixes), `NOTES_BASES-B4.md`, and `BASES_PLAN.md` section 8's B4 row and section 3 on `this`. Obsidian's public help "Embed a base" and "Bases syntax" (`this` is the embedding note), from prior knowledge, the same pages the B4 notes name. No page was fetched. No Obsidian code or assets. No network, no new packages or crates, no GUI, no real vaults, no other worktrees.

Still open, and not done here: coalescing the extra save rebuild inside `createBase`, and the mock `resolveLink` cost on a cold 5,000-note embed. Both are described in the second review.
