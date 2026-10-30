VERDICT: OK

Reviewed Gemini's Bases B2 at `a3445c5` on `rebuild/bases-b2-gemini` (`rebuild/NOTES_BASES-B2.md`). This branch is `rebuild/b2-review-grok`. Gemini's branch is still `a3445c5`. Nothing was pushed. The merge-base with integration is `542d984`. Later integration commits were not merged.

## What Gemini landed

`a3445c5` is 7 files, +1056 / −4, and stays in B2's files:

- `rebuild/app/src/bases/model.ts`: `type: cards` is accepted, and `cardSize`, `image`, `imageFit`, and `imageAspectRatio` are parsed. Unknown YAML keys are not rewritten.
- `rebuild/app/src/bases/cards.ts` (new in that commit, 608 lines)
- `rebuild/app/src/styles/bases-cards.css` (new, 86)
- `rebuild/app/src/bases/model.test.ts`
- `rebuild/app/scripts/test-bases-cards.mjs` (261)
- `rebuild/app/package.json` (posttest runs the cards script)
- `rebuild/NOTES_BASES-B2.md`

The plan merge already on the branch (`5218c20`, `c55c3ad`) also brings `BASES_PLAN.md` and `rebuild/bases-mockups/`. That is the plan, not the card implementation.

## Fixes on this review

The card module was only reached from the test. A production load never imported it, so `type: cards` still drew the table. `window.ws` is assigned only in dev, and the module tail runs before that assignment.

`db5678f` mounts the card view and drops the observers that retried it. `main.ts` calls `enableBaseCards(ws)` after `createPanes`, so the cards listener runs after the pane has inserted `.bases-view`. Covers are released when the card leaves the visible rows or the scroller. The toolbar icon is replaced only when the Lucide class is wrong: replacing it always mutated the toolbar and scheduled another update. The host observer watches the toolbar, not the table body. The document-wide mutation observer is gone. `cards.ts` is 606 lines after this commit. `main.ts` is +3.

`deb91b1` lets a cards view be chosen and shows the grid icon. `menus.ts` is outside B2's file list (+3 / −2). The view menu disabled every type other than `table`, so a cards view in a multi-view base could not be selected, and the toolbar button was always the table glyph. Cards are now enabled and use `grid-2x2`. Cached toolbar buttons still do not swap the icon themselves. The guarded replace in `cards.ts` does it once.

## Checks against the plan

D2 and §3.2: a cover from the image property, none when unset, then the title, then the view's `order` properties as label/value rows. The grid is `repeat(auto-fill, minmax(var(--bases-card-size, 220px), 1fr))`, gap 16, padding 16, radius 8. The test's cover is 220 × 0.5 = 110, which matches the mockup. Titles are 14px/600, keys are 56px, and tags are pills. The colored status dots in `cards.html` are static mockup markup. The table cell renderer does not draw them, and the cards use that same rendering. Dates stay as stored (`2026-05-01`) unless the value ends in `Z`, same as the table. The card hover is an 80ms border-color transition, not a menu-open animation.

Unknown keys stay on disk. `baseModel` does not write. `writeView` replaces only `order`, `sort`, `filters`, `columnSize`, `limit`, `name`, and `rowHeight`. Opening `Cards.base` left the file byte-identical, including the leading comment and the card keys.

Lazy covers: 9 of 36 loaded before scroll, and `cover-36.png` only after the wheel. Above 200 cards the grid virtualizes by row: 1,000 cards, 25 DOM nodes at the bottom, last path `BigGrid/Card 1000.md`. Click opens the note in the current tab. Ctrl-click (CDP modifiers 2) opens a new tab. The results limit menu cuts the grid to 2.

Card key names were not checked against a `.base` written by Chris's Obsidian. The plan said to do that before B2 (§4, §10). The names read are `cardSize` (a number, or `small` / `medium` / `large`), `image` with aliases `cover` and `imageProperty`, `imageFit` with alias `coverFit`, and `imageAspectRatio` with aliases `aspectRatio` and `coverAspectRatio`. No page was fetched.

## Performance

Before, on `a3445c5`, the cards module was not in the app. The same three scripts ran under the lock:

- warm 1000-note open 12.2 ms
- 1000-row table scroll, max frame 16.8 ms
- 300-card/400-edge pan: 70 samples, p95 16.8 ms, max 16.8 ms
- zoom: 47 samples, p95 16.8 ms, max 16.8 ms
- 300-card drag, max 16.8 ms, 47 intervals

After the two fixes, inside the full `npm test`:

- warm 1000-note open 11.5 ms
- 1000-row table scroll, max frame 16.8 ms
- pan: 70 samples, p95 16.7 ms, max 16.8 ms
- zoom: 56 samples, p95 16.7 ms, max 16.8 ms
- 300-card drag, max 16.8 ms, 49 intervals
- 1,000-card grid: 25 DOM nodes, max scroll step 18.9 ms

A dedicated rerun of `test-bases-cards.mjs` under the lock measured 19.1 ms for that same step. The script allows 50 ms. The plan's cap is 20 ms (§6). The step times `scrollTop` through the test's own `requestAnimationFrame`, so it includes the paints that scroll scheduled. 19 ms is still one frame. The table and canvas frame times did not move.

## Checks

From `rebuild/app`:

- `npm run build`: passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest 58 files, 674 tests. Posttest `test-bases-config.mjs` and `test-bases-cards.mjs` passed (grid, click, Ctrl-click, lazy 9/36, 1,000-card virtualization).
- `npm run audit:offline`: passed, 168 source files.

From `rebuild/app/src-tauri`, `--offline`:

- `cargo build`: passed (dev profile).
- `flock /tmp/grove-npm-test.lock cargo test`: 58 passed, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`).

No Rust files changed. No new crates or npm packages.

## Left open

- Card key names are still the guessed set above. Confirm them against a `.base` Chris's Obsidian wrote before anyone writes those keys back. Until then, unknown keys stay on disk.
- `setViewOption` in `cards.ts` casts a card key into `writeView`. Nothing in the UI calls it. A number falls through `writeView`'s array branch and can be written as `cardSize: []`. `writeView`'s key union does not include the card keys.
- A cards view still builds and virtualizes the hidden table. Toolbar changes still schedule a card re-read, including on a table view, because the type check happens after `readNote`. Frame times stayed inside the budgets above. `view.ts` is B4's file.
- The mockup status dots and the "Nov 3, 2026" date style are not app behavior.

## Relied on

`rebuild/BASES_PLAN.md` (D2, §3.2, §4, §6, §8 B2, §9, §10), `rebuild/NOTES_BASES-B2.md`, and the Grove mockup `rebuild/bases-mockups/cards.png` with `cards.html` and `mockups.css`. Those mockups use Grove's tokens and the bundled Lucide set. Obsidian's public Bases help ("Introduction to Bases", "Bases syntax", "Views"), from prior knowledge. No page was fetched. No Obsidian code or assets.
