# Notes — BASES-B2 (Card View `type: cards`)

## Summary

Implemented **Bases B2: Card view (`type: cards`)** on branch `rebuild/bases-b2-gemini` per `rebuild/BASES_PLAN.md` (§1 D2, §3.2, §4, §7, §8 row B2) and `rebuild/bases-mockups/cards.png`.

## Owned Files Modified / Created

- `rebuild/app/src/bases/model.ts`:
  - Allowed `view.type === "cards"` alongside `"table"`.
  - Added card view configuration properties to `baseModel` return object:
    - `type`: `"table" | "cards"`
    - `cardSize`: `number` (clamped `[80, 800]`, default `220`, with `"small": 160`, `"medium": 220`, `"large": 320` preset support)
    - `image`: `string | null` (from `view.image ?? view.cover ?? view.imageProperty`)
    - `imageFit`: `"cover" | "contain"` (from `view.imageFit ?? view.coverFit`, default `"cover"`)
    - `imageAspectRatio`: `number` (from `view.imageAspectRatio ?? view.aspectRatio ?? view.coverAspectRatio`, clamped `[0.2, 3]`, default `0.5`)
- `rebuild/app/src/bases/model.test.ts`:
  - Updated the unsupported view type assertion from `type: cards` to `type: map`.
  - Added unit tests for `type: cards` YAML options (`cardSize`, `image`, `imageFit`, `imageAspectRatio`) and `cardLayout` grid/virtualization geometry.
- `rebuild/app/src/styles/bases-cards.css` (new):
  - Styled `.bases-cards` (`grid-template-columns: repeat(auto-fill, minmax(var(--bases-card-size, 220px), 1fr)); gap: 16px; padding: 16px`), `.bases-card`, `.bases-card-cover`, `.bases-card-image`, `.bases-card-body`, `.bases-card-title`, `.bases-card-prop`, `.bases-card-key`, and `.bases-card-value` matching `rebuild/bases-mockups/cards.png` and `rebuild/bases-mockups/mockups.css`.
- `rebuild/app/src/bases/cards.ts` (new):
  - `cardLayout(input)`: pure grid geometry and row virtualization calculation above 200 cards (`firstIndex`, `endIndex`, `topSpace`, `bottomSpace`, `visibleStartRow`, `visibleEndRow`).
  - `resolveCoverPath(ws, rawValue, fromPath)`: strips wikilink/embed/markdown link syntax, resolves relative to the note path in the vault, and verifies `IMAGE_EXT`.
  - `createCardGrid(ws, group, scroller)`: renders `.bases-cards`, lazy-loads `blob:` cover images via `ws.embeds.image(coverPath)` and `ws.embeds.watch(coverPath, ...)` **only for visible cards** intersecting the scroller viewport, releases blob URLs on scroll-out or disposal, renders note title and ordered property key/value rows (including `.property-pill.is-tag` pills, checkboxes, and formatted dates), and opens the card's note on click (`whereFromEvent(e)`) or in a new tab on Ctrl/Cmd/middle-click.
  - `attachCardsToBaseView(el, ws, path, group)` and `enableBaseCards(ws)`: upgrades `.bases-view` panes so `type: "cards"` views render the card grid inside `.bases-scroll` with the `grid-2x2` toolbar icon while sharing the host toolbar and menus.
- `rebuild/app/scripts/test-bases-cards.mjs` (new) & `rebuild/app/package.json`:
  - End-to-end headless Chromium CDP test covering card grid layout, titles, property key/value rows, tag pills, cover image rendering, byte-for-byte YAML preservation, click and Ctrl-click card navigation, toolbar Results limit on card views, lazy cover image loading for visible cards only (`9/36` loaded initially, bottom loaded on scroll), and virtualized scrolling on a 1,000-card grid (`25` DOM nodes, `< 20 ms` frame time).

## Verification

- `cd rebuild/app && npm run build && npm run audit:offline` — passed (`168 source files, dist/, CSP, capabilities and dependencies checked`).
- `cd rebuild/app && flock /tmp/grove-npm-test.lock npm test` — all Vitest unit suites and all headless Chromium integration scripts (including `test-bases-cards.mjs`) passed.
- `cd rebuild/app/src-tauri && flock /tmp/grove-npm-test.lock cargo build --offline && flock /tmp/grove-npm-test.lock cargo test --offline` — passed (`58 passed; 0 failed`).
