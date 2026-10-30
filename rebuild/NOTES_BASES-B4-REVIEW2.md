# Bases B4 — second review (Codex)

VERDICT: NEEDS FIXES

Reviewed merged B4 at integration `78d3bb3`, on `rebuild/b4-review2-codex`. Two small fixes and regressions are committed as `85dcb99`. Two further correctness/lifecycle findings remain below. `bases/view.ts`, `model.ts` and `menus.ts` were not edited, as requested during Claude's B4/B5 integration. `rebuild/bases-b5-codex` remains exactly `8844101961a040765755c21d16b8537853fe3d25`. Nothing was pushed.

## Remaining findings and exact proposed fixes

### P2 — renaming the host silently invalidates `this`

`BaseWidget.embed()` resolves the host path once, `mountBaseEmbed()` copies it into `BaseOptions.host` (`bases/embed.ts:26`), and `createBase()` continues to use that old path for its host row and `readsChanged` checks. A note rename preserves the editor/widget, so ordinary re-evaluation never updates this identity.

Reproduction in the scratch mock: open `Rename.md` containing a base block with `filters: 'file.path == this.file.path'` and `order: [file.name]`. It shows `Rename.md`. Call the normal `renameFile(ws, 'Rename.md', 'Renamed')` path. The active path becomes `Renamed.md`, but the embedded Base has **zero rows and no notice**. Expected: the row becomes `Renamed.md`, and future unsaved edits read the renamed host's properties. The review probe recorded exactly this transition.

Proposed integration fix:

1. Allow the Base host to be resolved dynamically, for example `BaseOptions.host: string | null | (() => string | null)`, with a `hostPath()` helper in `createBase`.
2. In `BaseWidget.embed`, derive the current direct host from `editorHost.embeds.pathOf(view)` when requested, rather than retaining its old string. Preserve the innermost-note rule for nested embeds. `mountBaseEmbed` must pass the resolver through, not evaluate it while mounting. Its `update(next)` must also refresh the current descriptor.
3. Snapshot `hostPath()` once per evaluation when constructing `Row.host`; use the current resolver in `readsChanged`/outside-filter decisions too. A snapshot for one evaluation is correct; a snapshot for the widget's whole lifetime is not.
4. Add block and `![[X.base#View]]` browser cases for note/folder rename followed by an unsaved host-property change. Check rows, host file facts, named-view retention and cleanup. Keep `model.ts`'s per-selection shared host context.

This needs coordination with the B4/B5 host and summary-context wiring, so the protected implementation was left unchanged here.

### P2 — a failed nested-note reread detaches a Base without disposing it

In `editor/embeds.ts`, `NoteEmbedWidget.fill()`'s rejection branch replaces the content with a missing-note box, but does not `release(painted)`. This was an existing generic painting cleanup omission; B4 makes it retain a live Base and its subscriptions as well.

Reproduction: `Outer.md` embeds `Nested.md`, which contains a base block. Instrument `ws.embeds.base` to count mounts/destroys. After it mounts, make `ws.embeds.read('Nested.md')` reject and notify its watcher. Result: **one active Base, zero attached `.bases-embed` elements**, and the missing-note box. It remains retained until another successful fill or destruction of the outer widget. This is separate from the final-tab bug fixed in this branch.

Exact proposed change to the current guarded rejection callback:

```ts
if (gone || mine !== generation) return;
if (painted) release(painted);
painted = null;
content.replaceChildren(missingBox(`“${name}” is not created yet.`));
```

Add a browser regression that forces a watched read to reject after a nested Base has mounted, checks zero active Bases/subscriptions, recovers the read and checks exactly one mount, then closes the outer note. Preserve the generation guard so a stale rejection cannot destroy newer content. This remaining fix is proposed for the integration owner; this review's committed fixes are the two below.

## Fixes committed here

**Indented fences:** a valid two-space-indented `base` fence originally rendered “Unable to open base / Expected an unindented mapping.” The reader now applies CommonMark's removal of up to the opening fence's indentation from content lines. Writeback restores appropriate indentation while retaining unchanged raw prefix/suffix lines, including blank-line spaces, fences and surrounding prose. It also keeps a closing fence on its own line if supplied replacement YAML lacks a final newline. Unit cases cover one/two/three spaces, tilde fences, shorter content indentation and mixed whitespace; a real-mouse sort saves an indented block byte-exactly.

**Last-tab cleanup:** `NoteEditors.present()` previously released ownership of a note but retained its editor state/DOM when the next tab had no note path. Reproduction before the fix: close every tab while a Base is embedded; the active path is null, yet one Base remains mounted in the hidden editor. Installing an empty editor state on that path destroys its widgets. The saved note state/undo history remains in the existing state map. Browser cases close/reopen/close the final tab and check zero active Base widgets and zero directly registered workspace/vault Base subscriptions.

Changed files, excluding this notes file: **+77 / −5**:

- `app/src/editor/embeds.ts`: +18 / −3, fence read/write handling.
- `app/src/noteEditors.ts`: +1 / −1, empty-state teardown.
- `app/src/bases/embed.test.ts`: +17, two added unit cases.
- `app/scripts/test-bases-embed.mjs`: +41 / −1, indentation, lifecycle and toolbar undo/redo regressions. No package-script changes; this script already runs in posttest.

## Writes, unsaved text, undo and syntax

The committed browser regression uses native pointer/key input for the block header menu and undo/redo. A block sort changes only its YAML. Undo returns to the exact prior editor text, including the earlier unsaved `xxxxx` prose; redo restores the sort. The live embed returns after leaving its source. Row edits still write the row note, and a file embed's sort still changes only the named view of its `.base` file. Viewing and switching views remain byte-identical with no writes. Both Live Preview and Reading geometry checks pass.

The additional nested-block probe confirms that its toolbar write is rejected with “Open the note this base is in to change it.” `Nested.md` remains exactly its original text. No outer-note or wrong-block overwrite was observed.

Relied on BASES_PLAN §3.5/§4/§8/§9 and the existing B4 implementation/review notes' descriptions of Obsidian's public “Embed a base” and “Bases syntax” help, from prior knowledge. No page was fetched because this task forbids network access. The canonical `base` fence, `![[X.base]]` and `![[X.base#View]]` forms, named-view selection and embedding-note meaning of `this` match those descriptions. This is not a new live Obsidian parity observation. The 400 px cap, icon-only toolbar and unknown-view fallback remain documented Grove choices. No Obsidian code, CSS or assets were used.

## Save rebuilds

The first review's description needs a latency qualification. On a normal fast mock write, one edit produced evaluations at **322 and 1,325 ms**: the quiet timer and save notification coalesced, then the delayed link refresh caused another pass. With only `api.writeNote` delayed **80 ms**, the same edit produced passes at **302, 402 and 1,405 ms**: unsaved text, completed save and link refresh. Thus “at most one after quiet” with held/fast saves does not establish one pass for a real slower save.

This scheduling predates B4. The committed test still records 0 rebuilds during typing and 1 after quiet under its normal conditions. Do not simply remove `onModified`: disk metadata and link-dependent expressions must become current. Proposed future change in the protected `createBase` schedule is to track the last evaluated document revision and metadata/link dependencies, skip an identical text-only save notification, and skip link refreshes for expressions that do not read links. Keep YAML-watch reloads and metadata/link-dependent updates. Add held, fast and delayed-save cases, including `file.mtime` and `hasLink`, before coalescing. No scheduling change was made in this review.

## Performance against `08641e4`

Two interleaved rounds, baseline then review, under the shared lock. Baseline was a temporary `git archive 08641e4` app plus its round30 fixtures under `/tmp`, using the already installed dependencies. No checkout of B5 or other worktree was used. Scripts were the existing `test-bases.mjs` (including B0's 5k check) and `test-bases-cards.mjs`; all valid comparison runs passed.

- Warm 1k table, rounds 1/2: baseline **8.3 / 10.4 ms**, review **10.6 / 9.1 ms**.
- 5k cold table: baseline **41.3 / 43.2 ms**, review **43.8 / 42.9 ms**.
- 5k warm samples: baseline **15.4, 12.0, 18.4 / 16.2, 14.6, 11.6 ms**; review **16.7, 13.5, 18.7 / 16.9, 22.4, 13.7 ms**. Median of six: **15.0 → 16.8 ms**.
- Table scroll: baseline **16.7 / 16.8 ms** maximum frame, review **16.8 / 16.8 ms**. Typing beside the 5k Base: **16.8 ms** in every round, 0 rebuilds during the burst and 1 after quiet. Outside edits/saves and hidden pending/saved cases remained 0; reveal remained 1.
- 1k cards: baseline **18.9 / 19.0 ms**, review **16.8 / 17.3 ms** maximum scroll frame. Both retain 25 DOM cards and 9/36 initial lazy covers.

**Flagged raw regressions:** median 1k warm table **+0.5 ms** (~5%), 5k cold **+1.1 ms** (~3%), 5k warm **+1.8 ms** (12%). These short runs do not establish causality, but being under the caps is not proof of no regression. Cards improved by about 1.9 ms on the two-round medians. No warm scrolling/typing frame exceeded 20 ms.

Embeds on this review branch, normal production code:

- Standard 1k-generated-note fixture: standalone cold **85.4 ms**, warm **7.5 / 6.6 / 6.6 ms**. Full-suite cold **92.2 ms**, warm **7.4 / 6.2 / 5.7 ms**. Full typing and paged-scroll maxima **16.8 ms**, 400 px cap, 30 rendered rows. The prior review's full cold value was 84.3 ms; the higher current full-run cold value is retained here rather than hidden.
- Expanding that same fixture to **5,000 generated notes plus the sample/host notes**: cold **463.5 ms**, warm **13.8 / 13.5 / 12.7 ms**; typing **16.7 ms**, 0/1 rebuilds; paged 5k scroll **16.7 ms**, still 30 rows. Diagnostic repeats had cold **445.2 / 447.0 ms**. This is a real whole-note cold target miss in the mock.

The existing test's “within 100 ms” PASS message reports cold time but **asserts only the maximum warm time**. Do not interpret that PASS as a cold-open guarantee. Proposed test correction is to label warm and cold separately and assert the cold target once the following baseline bottleneck is addressed, with any mock-specific allowance explicit.

### Cold-path attribution

A settled cold trace recorded an **849.9 ms maximum frame and 869 ms long task across the open helper**, which switches to Elsewhere and then Host. These are helper-wide values, not solely the separately timed 447 ms Host interval. CPU sampling found **751 self samples in `links/internal.ts`'s `resolveLink`**, versus 24 at the next largest node, called through the mock backlink path. The properties reply's elapsed time also includes this main-thread contention; it is not evidence that property parsing itself consumed all that time.

`src/mock/backend.ts` and `src/links/internal.ts` are byte-identical to `08641e4`. `backlinks()` calls `linkData(wanted)`, which resolves the sample vault's links repeatedly, rebuilding a file-path Map inside `resolveLink` for each link over all files. This is an existing mock cold-path limit, not a demonstrated B4 row-evaluation regression or a native Tauri measurement.

Diagnostic isolation only: with `api.backlinks` returning an empty object, the otherwise unchanged 5k embed fixture opened cold in **31.5 ms**, warm **15.2 / 16.8 / 14.5 ms**, typing **16.8 ms**, scrolling **16.7 ms**. This stub was never applied to app code or the committed/full tests. It demonstrates the source of the cold stall; it is not a replacement whole-app benchmark.

Exact proposed follow-up: build/reuse one resolver/path index per mock `linkData` file snapshot instead of rebuilding it per resolved link, preserve all nearest-folder/case/alias semantics with the existing link corpus, then rerun the unmodified 5k cold fixture and enforce its target. No Rust pre-filter or separate performance-plan work was implemented here. The raw cold miss and the smaller warm-table deltas remain flagged.

## Checks and scope

- `npm run build`: passed; existing Vite large-chunk warning remains.
- `npm run audit:offline`: passed, **172 source files**, dist/CSP/capabilities/dependencies.
- Exact `flock /tmp/grove-npm-test.lock npm test`: passed on the first full run of this review, exit 0, **64 files / 1,058 Vitest tests**, all discovery/geometry/browser/real-pointer suites and **posttest**, including the expanded embed regression. No flake retry and no assertion was relaxed.
- Targeted embed units: **7 passed**. Targeted and full embed browser runs passed. The expanded 5k scripts passed their existing warm/scroll/typing assertions while exposing the unenforced cold miss above.
- `cargo build --offline` and `cargo test --offline`: passed under the same lock; **58 passed, 0 failed, 2 ignored**, binary/doc suites also passed. Rust unchanged.
- Whitespace/staged checks passed. The first baseline harness attempt omitted the round30 fixture directory; archival input was corrected before collecting the valid comparison rounds. This was harness setup, not a product failure or timing-flake retry.
- App source stayed frozen throughout the successful full run. Headless diagnostics used the in-memory mock; the baseline copy was under `/tmp`. No GUI window, network, package/crate install, real vault, other worktree or Herdr access. Hooks were disabled for checkout/commits. Prompts, logs and diagnostic scripts are not committed. Round screenshots were restored before every commit.

The verdict remains NEEDS FIXES for host identity after rename and cleanup after a nested-note read failure. The two committed fixes are safe to take independently. The integration owner has exact proposed changes and regressions above; no new product decision from Chris is required. Stopping after the local notes commit. Never pushed.
