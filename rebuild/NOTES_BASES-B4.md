# NOTES_BASES-B4: bases embedded in notes (Claude)

Branch `rebuild/bases-b4-claude`, from `rebuild/integration` `08641e4`. Local only, not pushed.

A note can now show a base in two ways, in Live Preview and in Reading view:
- a ` ```base ` code block holding the base's YAML;
- `![[X.base]]`, or `![[X.base#View]]` for a named view.

`this` in a formula or filter means the note the base is drawn in. Opening a note with embeds writes nothing.

## What changed

| Commit | What |
|---|---|
| `9d0d01c` | `view.ts` split into a reusable `createBase` plus the tab wrapper `createBaseView`. `this` plumbing. Cards drawn by the shared view. |
| `08a5e2d` | The embeds: `bases/embed.ts`, the widget in `editor/embeds.ts`, the code-block hook in `editor/blocks.ts`, the `![[X.base]]` hook in `editor/livePreview.ts`, and CSS. |
| `a66fac3` | The browser test `scripts/test-bases-embed.mjs`, added to `posttest`. |
| `3611aa5` | Its geometry check waits for CodeMirror's next measure (below, under Checks). |

| File | +/− | Owned by B4? |
|---|---:|---|
| `bases/view.ts` | +90 / −23 | yes |
| `bases/embed.ts` (new) | +40 | yes |
| `editor/embeds.ts` | +90 / −4 | yes |
| `bases/cards.ts` | +2 / −233 | no: dead code removed (below) |
| `bases/model.ts` | +5 / −2 | no: B5's (below) |
| `bases/menus.ts` | +5 / −4 | no: B5's (below) |
| `editor/blocks.ts` | +6 / −2 | no: one hook |
| `editor/livePreview.ts` | +6 / −4 | no: one hook |
| `editor/host.ts` | +16 | no: the hook's interface |
| `editorHost.ts` | +2 | no: wires the hook to `bases/embed.ts` |
| `main.ts` | −3 | no: the removed card attach call |
| `styles/bases.css` | +16 | shared (plan §8: small additions allowed) |
| `bases/embed.test.ts` (new), `bases/view.test.ts` | +54, +10 / −1 | tests |
| `scripts/test-bases-embed.mjs` (new), `test-bases-cards.mjs`, `package.json` | +223, −5, +1 / −1 | tests |

App code (without tests) is +279 / −276: the embeds cost about as many lines as the card attach code they made unnecessary.

### The split (`bases/view.ts`)

- **`createBase(ws, options)`** draws a base's toolbar and its table or cards. Its options:
  - `file`: where the YAML is read from and written to (`read()` / `write(text)`);
  - `watch`: the file whose change on disk reloads the YAML;
  - `host`: the note `this` reads;
  - `viewIndex`, and an optional `viewName` that picks a view by name once;
  - `shown()` and `remember()`.

  It returns `{ el, reload(), dispose() }`. Rebuilding still goes only through B0's `schedule` and `baseChange`.
- **`createBaseView(ws, path, group)`** is the tab, now about 8 lines.
  - `this` is the base file itself.
  - The view shown is remembered per tab, as before.
  - The base waits while its tab is hidden, as before.

  `pane.ts` calls it unchanged.
- **For Codex's B5:** `createBase` is the one place a call site goes, and both the tab and embeds get it. The function bodies are unchanged except for the marked lines (read through `file`, the host row, the cards branch), so a B5 hunk in `update()` or `paint()` should merge as it would have before.

### Cards are drawn by the shared view

Gemini's B2 attached cards to a tab's `.bases-view` from outside:
- a workspace listener found the element;
- a toolbar `MutationObserver` re-read the `.base` file;
- it built the rows a second time, 16 ms after every `files`/`doc`/`links` event.

That second build ignored B0's 300 ms quiet period and hidden-tab rules (the B2 review flagged it as left open, for B4's `view.ts`). An embed has no tab for that listener to find, so cards in embeds needed the same change anyway.

`createBase` now builds the rows once and either paints the table or calls `createCardGrid(...).render()`. `attachCardsToBaseView`, `enableBaseCards` and the window hook were then dead code, so they're deleted, with their call in `main.ts` and the four lines of `test-bases-cards.mjs` that called them. `createCardGrid`, `cardLayout` and `resolveCoverPath` are untouched. The cards test passes unchanged otherwise. A cards view no longer builds the hidden table either.

### `this` (`model.ts`, +5 / −2)

- `Row` gets an optional `host` (the row `this` reads), and the row context passes `this: hostContext(row.host)`.
- One context per host is cached in a `WeakMap`, so `this.formula.x` is worked out once per selection, not once per row.
- `view.ts` sets `host` only when the YAML contains the word `this`, so other bases do exactly the work they did before.
- The host row is a copy, so its own context has no `this` (no loop). Its data is the same as any row's: properties from the index, tags with unsaved text, and links.
- B5 owns `model.ts`. The change sits in `context()` and the `Row` line, away from `select()` and the sort, so it should merge cleanly with grouping work.

### The toolbar writes through a `BaseFile` (`menus.ts`, +5 / −4)

`baseMenus` took a path and called `api.readNote` / `api.writeNote` itself. It now takes a `BaseFile` `{ read, write }`:
- **The tab and `![[X.base]]`** pass `baseFile(ws, path)`: the same calls as before, plus `ws.vault.written`.
- **A ` ```base ` block** passes one whose `write` replaces only the YAML between the block's fences, through the note's editor. The edit is then saved and undoable like any other.

The change is only the signature and the three lines of `save`. Codex's B5 header-menu items are further down the file.

### The embeds

- **` ```base ` blocks** (`editor/blocks.ts`). They are found with the callouts and tables, in the same state field, and replace their lines as a block widget.
  - The caret in the block shows its source, as for a callout. "Edit this block" (top right, on hover) puts the caret in its YAML. Arrow keys step in, as for other blocks.
  - When the block's YAML changes, the widget keeps its DOM (`updateDOM`) and re-reads the YAML, so a toolbar write doesn't lose the scroll position or the open menu.
  - The fence is CommonMark's: ```` ``` ```` or `~~~`, three or more, up to three spaces of indent, and the closing fence at least as long.
- **`![[X.base]]` / `![[X.base#View]]`** (`editor/livePreview.ts`). These are drawn where a note embed is drawn: in place of the link, or below its line while the caret is on it.
  - `#View` picks that view by name when the base opens. After that, the embed's view menu switches views without writing.
  - A missing `.base` shows the grey "could not be found" box.
- **`this`** is the innermost note the base is drawn in. That is usually the note on screen. For a block inside an embedded note, it is that embedded note.
- **Height.** The embed's scroll area is capped at 400 px (`--bases-embed-height`) and scrolls inside. Above 200 rows the table and cards virtualise exactly as in the tab.
- **Geometry.** The block widget has padding, never vertical margins. Its caret buffers are hidden, inside a line's reading-view text span too. CodeMirror measures its height.
- **Compact toolbar.** In an embed, Sort, Filter, Properties and New show their icon only (the aria-labels stay).
- **Writes.**
  - Viewing writes nothing.
  - A cell edit writes the row's note, as in the tab.
  - A toolbar change writes the `.base` file (for `![[X.base]]`) or the block's YAML.
  - A block drawn inside another embed has no place in the note on screen to write to. Its toolbar shows "Open the note this base is in to change it." and writes nothing.
- **Rebuilds** follow B0:
  - typing waits for 300 ms of quiet;
  - a note outside the base's folder or tag filter is skipped;
  - the widgets aren't redrawn while typing elsewhere in the note.

  One addition: a change to the note `this` reads always rebuilds a base whose YAML reads `this`, even when that note is outside its folder (`readsChanged`). Otherwise B0's folder pre-filter would skip it and `this.status` would go stale.

## What this relied on (Obsidian)

Obsidian's public help pages "Embed a base" and "Bases syntax" (the `this` section), **from prior knowledge only**. There was no network, and no page was fetched. From them:
- embedding is a ` ```base ` code block holding the YAML, or `![[File.base]]`, or `![[File.base#View]]`;
- `this` is the file the base is embedded in;
- in its own tab, `this` is the base file itself.

No Obsidian code, CSS or assets were used.

**Grove's own choices, not observed:**
- the 400 px height cap;
- the icon-only embedded toolbar;
- the block toolbar's message when it can't write;
- an unknown `#View` showing the first view.

## Performance

Bases timings, interleaved over three rounds, integration `08641e4` vs this branch, each in the same session under the test lock:

| Measure (browser mock, no IPC) | Integration, rounds 1 / 2 / 3 | This branch, rounds 1 / 2 / 3 |
|---|---|---|
| Warm 1,000-note table open (`test-bases.mjs`) | 8.2 / 8.5 / 8.5 ms | 8.2 / 8.9 / 13.8 ms |
| 1,000-row table scroll, max frame | 16.7 / 16.7 / 16.8 ms | 16.8 / 16.7 / 16.8 ms |
| 5,000-row cold open (`test-bases-b0.mjs`) | 42.9 / 42.7 / 42.4 ms | 42.4 / 41.5 / 41.8 ms |
| 5,000-row warm opens (3 per round; median of 9) | 15.4 ms (11.3–22.1) | 16.1 ms (12.6–22.7) |
| Typing beside an open 5,000-row base: max frame; rebuilds during / after the burst | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| 1,000-card grid scroll, max frame (`test-bases-cards.mjs`) | 18.9 / 18.8 / 19.1 ms | **16.8 / 16.8 / 17.3 ms** |

- **Cards improved.** Their rows are built once now, without the second build and the hidden table, and the max scroll frame went from about 19 ms (just under the 20 ms budget) to about 17 ms.
- **Flag: the warm table open.** Two rounds match integration (8.2 and 8.9 ms against 8.2 and 8.5), and round 3 read 13.8 ms. The tab's open path does the same work as before: the host row is skipped unless the YAML reads `this`, and the card grid is one empty element. So I read round 3 as noise, but it is recorded rather than averaged away. The 5,000-row warm opens overlap the same way (medians 15.4 and 16.1 ms, ranges 11.3–22.1 and 12.6–22.7 ms), and the cold open is about 1 ms faster. All of these are far inside the 100 ms and 150 ms checks.

The embed's own numbers (`test-bases-embed.mjs`, full test run):

| Measure (`test-bases-embed.mjs`) | Full `npm test` run | Three standalone runs |
|---|---|---|
| Note opened, both embeds drawn: cold (first property read, 1,000+ notes in the vault) | 84.4 ms | 86.3 / 85.0 / 83.5 ms |
| The same, warm (three opens) | 8.1 / 6.4 / 6.3 ms | 5.7–7.2 ms |
| Typing in the note: max frame; rebuilds during / after the burst | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| Paging a 1,000-row embed: max frame | 16.8 ms | 16.7–16.8 ms |

The plan's target (§6) is "renders within 100 ms of the note opening, and doesn't move the editor's line geometry". The test asserts 100 ms on the warm opens. The cold open is under it too, at about 85 ms, but it includes the first read of every note's properties, which the tab pays the same way.

- **Typing** in a note with two embeds: no rebuild during a burst of 100 ms pauses. One rebuild after the quiet period, from the block that reads `this`. The embeds keep their DOM through it.
- **Scroll frames** are timed by paging with the scrollbar, as `test-bases.mjs` does. Synthetic CDP wheel events alternate 17 / 33 ms frames in headless Chromium, and a base **tab** on integration shows the identical pattern, so that's the harness, not the embed. The test still checks that the wheel scrolls the embed. No long tasks (> 50 ms) were recorded during the wheel run.
- **No Rust changed.** No IPC is added: an embed uses the same property index, tag and link reads as the tab.

## Tests

- **`bases/embed.test.ts`** (new, 5 tests):
  - a block's YAML from its fences (closing rules, unclosed blocks, other languages, indented code);
  - writing it back in place;
  - `this` from a host row: `this.status`, `this.file.name`, `this.file.hasTag`, `this.formula.x`, and no host giving `null`.
- **`bases/view.test.ts`:** one test for `readsChanged` against B0's pre-filter.
- **`scripts/test-bases-embed.mjs`** (new; real CDP pointer and key input):
  1. Both embeds render on opening the note. The block's `status == this.status` gives B. `![[Embed.base#Open]]` shows the view named Open.
  2. The geometry check from `test-geometry.mjs`: every direct child of `.cm-content` is within 1 px of CodeMirror's heights, with no vertical margins, in Live Preview and in Reading view.
  3. The view menu, used with the mouse, switches the `.base` embed to cards (3 cards) and back. `Embed.base` and `Host.md` stay byte-identical, and `api.writeNote` is never called.
  4. A file-name click opens the row's note.
  5. Typing: 0 rebuilds during the burst, at most 1 after it, frames under 20 ms, and the embeds keep their DOM.
  6. Changing `status` in the note re-filters the block (the note is outside its folder).
  7. A cell edit with the mouse writes only the row's note.
  8. A right-click header "Sort Z → A" writes the sort into the block. Only the block's YAML in the note changes, and the block keeps its DOM.
  9. The same on `![[Embed.base#Open]]` writes the Open view of `Embed.base`, byte-exact.
  10. "Edit this block" puts the caret in the YAML. Leaving it draws the base again.
  11. A 1,000-row embed: capped at 400 px, 30 rows drawn, paging scrolls the embed and not the note, frames under 20 ms, and the wheel scrolls it.

## Checks

All under `flock /tmp/grove-npm-test.lock`, on this branch's head (`3611aa5`):

- `npm run build`: passed (Vite's existing large-chunk warning remains).
- `npm run audit:offline`: passed (172 source files).
- **`npm test`, first full run: failed in my own new test.** Vitest (64 files, 1,056 tests) and every browser, geometry and real-mouse script passed. Then `posttest` failed in `test-bases-embed.mjs`: its first Live Preview geometry check found "Intro line." 134 px off CodeMirror's height map.
  - The check ran in the same frame the note opened, before CodeMirror's measure. Logged over three standalone runs, the first reading was off by 154 px once and 0 twice, and it settled within one 20 ms poll every time.
  - `test-geometry.mjs` sleeps 250 ms after opening for the same reason. `3611aa5` makes the check poll up to a second for the heights to settle, and a mismatch that lasts still fails. It is not a product change.
- **`npm test`, second full run (after `3611aa5`): passed, exit 0.** This was vitest 64 files and 1,056 tests, then every browser script, then `posttest` (`test-bases-config.mjs`, `test-bases-cards.mjs`, `test-bases-embed.mjs`). No flake reruns were needed. From that run:
  - warm 1,000-note open 8.2 ms, 1,000-row scroll 16.7 ms;
  - 1,000-card grid scroll 16.9 ms;
  - the 300-card canvas drag 16.8 ms.
- From `src-tauri`, with `--offline`: `cargo build` passed, and `cargo test` gave 58 passed, 0 failed, 2 ignored (the benches). No Rust changed.
- `rebuild/round*-shots` were restored before every commit. Prompt files and logs aren't committed.

No GUI window, network, real vault, other worktree or Herdr pane was used. Test vaults were the in-memory browser mock. Nothing was pushed.

## Left open, and decisions for Chris

1. **Files outside B4's list.** `model.ts` and `menus.ts` (B5's) and `cards.ts` (B2's, now unowned) changed a little, for the reasons above. Each hunk is small and away from where B5 works. If B5 lands first, re-apply them by hand: `Row.host` plus the context's `this`, and `BaseFile` in `save`.
2. **What Obsidian really draws.** The 400 px cap and the icon-only toolbar should be checked against Chris's Obsidian. Also check whether an embedded block's toolbar edits write back into the block there; here they do.
3. **Saves rebuild once more.** A save of a note inside a base's filter rebuilds it once more after the quiet-period rebuild. That is B0's existing tab behaviour, kept for embeds. Embeds that read `this` follow it for their own note. Holding off rebuilds until both have happened would be a B0 change.
4. **Hover previews** of a note also draw its bases (they paint blocks like any rendered text). They are read-only as far as `this` goes, but their cells are editable as in the tab. Making previews draw a placeholder instead is a one-line check, if wanted.
5. **B1's hand-off** (error cells, a notice per failing formula) is still unowned. B4 only did the `this` part.
