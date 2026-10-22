# Round 16 relay stage 2: reviewer / trimmer

Base: Claude's finished `fbbfca1` on `rebuild/r16-claude`.
Work: `rebuild/r16-codex`, local commits only. Read `CLEANUP4_TASK.md`,
the contract, feel spec, prior cleanup/round notes and every commit subject
in `git log rebuild/integration..HEAD`.

## Trim commits

- `5647ae0` — **3 lines saved, TypeScript.** Reuse `kept()` for search's
  term/hit caches and counts. Previously `countOf(path)` evaluated its
  default `lines(path)` argument even when the count was already cached;
  now matching lines are computed only on a cache miss. Cache eviction,
  matching, displayed counts and deferred rendering stay the same.
  Backlinks grouping also appends to the existing array instead of copying
  the growing group for each mention, avoiding quadratic copying.
- `208b755` — **13 lines saved, CSS.** Group identical rules for view-header
  and vault-footer button spacing, search/backlinks chevron positioning,
  and active search/settings buttons. Selectors and declarations are kept;
  no editor fold, selection, cursor or typography rule changed.
- `81cf965` — **2 lines saved, Rust.** Walk the existing old/fresh index
  path iterators during a rescan instead of first cloning both full path
  lists. Only paths placed in the change events are cloned. Comparison and
  event order are unchanged.
- `cd88d33` — **5 lines saved, TypeScript.** Represent the editor's optional
  Edit link item as `condition && item`, the menu component's existing
  pattern, instead of creating and spreading an optional one-item array.
  The action and availability conditions are unchanged.

## Lines

Counted tracked `.ts`, `.css` and `.rs` under `rebuild/app`, excluding
`/gen/`, with the brief's newline-count convention. These figures exclude
this Markdown review file.

- TypeScript app: **18,506 → 18,498 (−8)**.
- TypeScript tests: **2,249 → 2,249 (0)**.
- TypeScript total: **20,755 → 20,747 (−8)**.
- CSS: **3,548 → 3,535 (−13)**.
- Rust: **3,106 → 3,104 (−2)**.
- **This pass: 27,409 → 27,386 (−23, about 0.08%).**
- Whole round versus `rebuild/integration`: **27,416 → 27,386 (−30)**.

This remains well short of the original ~800-line target. Stopped after
the small, obvious wins as requested; no tests, comments or features were
deleted to increase the count, and no lines were joined to game it.
The largest source file remains `src/workspace.ts`, 641 lines.
No dependencies, commands, permissions, file formats or defaults changed.

## Validation

All required checks pass on the final app changes:

- `rebuild/app`: `npm run build`, `npm test` (**170 tests, 32 files**),
  `npm run audit:offline`.
- `rebuild/app/src-tauri`: `cargo build`, `cargo test` (**32 tests**).
- `git diff --check` passes.

The first baseline TypeScript run hit the existing unlinked-mentions
300 ms timing guard at ~310 ms during a full fresh Cargo compilation.
Subsequent complete runs passed, including the final run. The test and its
threshold were left intact.

Headless Chromium, Vite at `127.0.0.1:1426`, mock vault plus
`?synthetic=1000`, 1280×800, device scale 1:

- **12/12 final screenshots byte-identical to `fbbfca1`:** note, search,
  folded search result, File properties, All properties and Settings, each
  in light and dark themes. Reduced motion and hidden carets keep captures
  deterministic. Search result rows and totals also match exactly
  (`alpha gamma`: 703 results); no page exceptions.
- CDP mouse input verified crossing from heading text to the hover
  chevron, folding and unfolding, in both Live Preview and Source mode.
- Real mouse double-click selected `boldword` inside `**boldword**`.
  Dragging across bold text and a wikilink kept the markup hidden while
  held and revealed it after release. Margins and space below the document
  computed to `cursor: auto`.
- Edit link remains present for internal links in Live Preview/Source,
  absent in Reading view and on plain text/external links; its action still
  selects `Project roadmap`, the original target range.

The headless harness and captures are scratch files under the ignored
`rebuild/app/node_modules/.review-r16/` directory. No Tauri window was run;
no window was opened on the owner's display and no Documents vault was
accessed. This pass did not repeat the Obsidian/WebKitGTK comparison or the
full typing/graph timing suite. Performance improvements here describe
removed work, not a claimed measured latency gain; graph code and the
editor's per-keystroke paths were not edited.

## Suggested next improvements (not implemented)

1. **Edit table cells in place.** Clicking a rendered table still exposes
   pipe syntax. Keeping the table drawn while editing would prevent the
   layout jump and meet the owner's first round-17 request. Rough size:
   300–600 TypeScript lines plus 80–150 lines of interaction tests.
2. **Remember linked tabs across restarts.** Link relationships currently
   disappear when restoring a workspace, unlike Obsidian. Saving a stable
   relationship and dropping orphaned links on restore would preserve the
   user's navigation setup. Rough size: 50–100 TypeScript lines plus
   20–40 test lines in tab/layout persistence.
3. **Make common-term search counts complete.** Counts are still lower
   bounds when the backend hit limit truncates a very common term. Accurate
   totals would make the results label reliable on large vaults without
   requiring every matching line in the UI. Rough size: 150–300 lines
   across Rust search, its contract/frontend facts and tests; keep counting
   off the typing/rendering path.
