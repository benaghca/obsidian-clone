# Kanban and manual group order: mockups

These are static pages in Grove's dark theme. The tokens come from `src/styles/theme.css`, and the base styles are copied from `../bases-mockups/mockups.css`. The icons are Lucide path data, taken from the app's own `lucide` dependency and written into each page. There are no scripts, no external assets and nothing from Obsidian. The task data is made up.

- **Rebuild everything:** run `node rebuild/kanban-mockups/build.mjs` from the repository root. It writes the `.html` files and makes the `.png` files with headless Chromium's `--screenshot` (1280 × 800, no window).
- **The full plan:** `../KANBAN_PLAN.md`.

| File | Shows |
|---|---|
| `kanban-a.png` | **Option A, Board:** one scroller per column, with the columns side by side and a horizontal scroll. Cards have a fixed height. Each column header has a count, **+** and **⋯**. The "No value" column is last, with a drop area. One card shows the keyboard focus ring. |
| `kanban-b.png` | **Option B, Lanes:** one shared vertical scroll with sticky column headers, and columns that fill the width. |
| `kanban-c.png` | **Option C, Compact:** one-line cards (30 px). Big columns collapse to 40 px strips, and an empty added group shows as a column. |
| `kanban-drag.png` | **A drag in option A:** the lifted card is moved by `transform` only, and its source slot stays dimmed. The target column is outlined, with a "Drop to set status to doing" hint and a line where the card will land in sort order. The notice shown after the drop has Undo. |
| `group-menu.png` | **The new toolbar Group menu in Manual:** the property and order pickers (A → Z, Z → A, Manual) and a trash button. Each group has a grip and a show/hide tick. One row is being dragged, with a drop line. An added empty group is labelled "empty · added", and two groups are hidden. Show all, Hide all, and the Add group box are at the bottom. |
| `collapsed.png` | **Collapsed group headings in table, cards and list:** the list layout isn't built yet (piece K8). Collapsed headings show a right-pointing chevron and the count, and one heading shows the keyboard focus ring. |

## Comparing the Kanban options

| | A: Board | B: Lanes | C: Compact |
|---|---|---|---|
| **Long and short columns** | Each column scrolls on its own, so a column of 1,284 cards doesn't move a column of 37. | Every column scrolls together. Short columns leave empty space, and finding a card deep in one column scrolls every other column too. | Each column scrolls on its own, as in A. |
| **Many columns** | Horizontal scroll, and only visible columns are in the DOM. | Columns share the width, so above about 6 columns they get too narrow or the board needs a horizontal scroll as well. | It fits the most: about 6 columns at 1280 px, and strips for big columns. |
| **Card detail** | Full: the cover, the title and the view's properties. | Full. | Title, date and priority only. Other properties need a hover or the note itself. |
| **Virtualisation** | Per column: a 1-D window in each mounted column, plus a horizontal window over the columns. Simple, with fixed heights. | One 2-D window over a shared scroll. Equally cheap, but columns of different lengths waste the space. | The same as A, with denser rows: more cards in the DOM per screen, still capped. |
| **Drag** | Target is the column under the pointer; auto-scrolls horizontally and in the target column. | Simplest: a single scroller to auto-scroll. | The same as A. The narrow strips are small drop targets. |
| **In a note embed (height cap)** | Works: the columns scroll inside the cap. | Works well: a single scroller. | Works. |
| **Familiar** | The usual Kanban (Trello, GitHub Projects, the Obsidian Kanban plugin's look). It matches Obsidian's description, "cards organized into columns". | Less common. | A power-user density. |

**Recommendation: A.**

- Columns of very different lengths are normal in a vault: "done" grows forever. Independent scrollers keep the board usable.
- A is also the simplest to make 60 fps at 10,000 cards, because every column is a fixed-pitch list.
- C's one-line card is worth keeping as a later card-size choice (`cardSize: small`), but not as the default.
- Collapsing columns to strips (C) is decision D9 in the plan, and the recommendation is no for v1.
