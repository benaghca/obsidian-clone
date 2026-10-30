# Bases: Kanban layout and manual group order (plan)

Written 2026-10-30 on `rebuild/kanban-plan-claude` (from `rebuild/integration` `f112151`, which has Bases B0–B6). Plan and design only; no product code. Mockups are in `rebuild/kanban-mockups/` (README there).

## In plain words

- **Two features.**
  - **Kanban:** a new layout, `type: kanban`. Notes are cards in columns, and the columns come from the view's Group by property. Dragging a card to another column rewrites that one property in the note.
  - **Manual group order,** in a new toolbar **Group** menu. You can drag groups into any order, show or hide each one (or Show all / Hide all), and add an empty group. Choosing A → Z or Z → A again brings back the automatic order and shows every group. Clicking a group heading collapses it in the table, cards and list layouts.
- **Most of the machinery already exists.**
  - B5's grouping (`groupWork`), the virtualised cards (`cards.ts`) and the YAML block writer (`writeViewSetting`) carry over unchanged.
  - Collapsing a heading already works in table and cards (`groups.ts:223-229`). The work left there is keeping the collapsed state and keyboard polish.
  - The list layout doesn't exist yet. It is its own piece (K8).
- **The new and risky part is the write.**
  - A drop changes a note on disk. That change goes through a **new Rust command, `set_property`**. It reads the note fresh under the vault lock and changes only that property's lines. It checks that those lines are still what the board saw (compare-and-swap), then writes atomically.
  - If the note is open in an editor, the same edit goes into the editor instead, so unsaved typing is never lost and the edit joins the note's own undo history.
  - Undo and redo are the same command run in reverse, with the same check, so an undo can never overwrite a change made in the meantime.
- **Speed.**
  - **Card heights are fixed per view.** All placement is arithmetic, with no measuring.
  - **Only what can be seen is in the DOM:** visible columns, and visible cards in each.
  - **Dragging moves one lifted card** with `transform` once per frame and reads no layout.
  - **A drop shows on the next frame,** before the disk write finishes.
  - **Targets at 10,000 notes:** 60 fps scrolling and dragging, and no main-thread task over 50 ms.
- **Recommendations:**
  - Kanban design **A**: a scroller per column, like the classic board.
  - Manual order stored **inside `groupBy`** in the `.base` file.
  - Collapsed headings kept as **local UI state**, not in the file.
  - Build in **8 pieces**, three of which can start now: K1 (Grok), K2 (Codex), K3 (Claude).

## 1. What this plan relied on

- **Obsidian's public help page "Views"**, read once on 2026-10-30. `https://help.obsidian.md/bases/views` redirects (301) to `https://obsidian.md/help/bases/views`, the same page at its new address. No other page was fetched, and no Obsidian code, CSS, icons or assets were used. The page says:
  - **Layouts:**
    - Table and Cards (since 1.9).
    - List: "bulleted or numbered markers" (1.10).
    - **Kanban (1.14): "Display files as cards organized into columns based on a grouped property."**
    - Map (needs a plugin).
  - **Group:**
    - You open the **Group** menu at the top of the view.
    - "Under **Group by**, choose a property."
    - "Choose an automatic sort order, or select **Manual** to order groups yourself."
    - A trash button stops grouping.
    - A view can group by only one property.
  - **Manual:**
    - "Check a group to show it, or uncheck it to hide it."
    - "Select **Show all** or **Hide all** to change the visibility of all groups."
    - "Drag the grip handle next to a group to change its position."
    - "Select **Add group** and enter a value to show a new, empty group. This does not create a note or change existing notes."
    - "To restore automatic group order and show all groups, choose an automatic sort order instead of **Manual**."
  - **Collapsing:** "In the Table, Cards, and List layouts, select a group heading to collapse or expand that group. Collapsing a group temporarily hides its items without changing their properties."
- **What the page does *not* say**, so this plan decides it and marks it as Grove's choice:
  - any YAML key names;
  - how a Kanban drop writes;
  - list-valued properties;
  - the empty ("No value") column;
  - Kanban settings;
  - keyboard access.
- **The YAML keys are therefore unverified** (D2). K1 checks them against a `.base` saved by Chris's Obsidian 1.14 before K3 starts.
- **The code at `f112151`:**
  - `bases/groups.ts`: `groupWork`, `valueKey`, `writeViewSetting`, `createGroupedView` and its collapse;
  - `bases/view.ts`: `createBase`, the B0 scheduling and B6's search;
  - `bases/cards.ts`: `cardLayout` (fixed card height);
  - `bases/cells.ts`: `setCell`, today's TS property write;
  - `editor/frontmatter.ts`: `readProperties`, `setValue`, `formatProperty`, `yamlString`;
  - `src-tauri/src/index/props.rs`: the Rust port of `readProperties`;
  - `src-tauri/src/fsutil.rs`: `atomic_write`;
  - `src-tauri/src/vault.rs`: `write_note`;
  - `src-tauri/src/lib.rs`: `write_note`, which emits `vault-changed` to the other windows;
  - BASES_PLAN.md (D5: rows are evaluated in TS);
  - RUST_MIGRATION_PLAN.md §2 (the parity corpus rule).

## 2. Behaviour

### 2.1 Kanban layout (`type: kanban`)

- **Columns** are the view's groups (`groupBy`), in group order: A → Z, Z → A, or Manual (§2.2).
  - Each column has a header: the value (as the group heading shows it today, `displayValue`), the card count, a **+** (new note in this column), and a **⋯** menu.
  - The **⋯** menu has: *Hide group*; *Move left / Move right*; and *Collapse* (D9).
  - *Hide group* and the *Move* items switch the view to Manual, keeping the current order.
- **No `groupBy` yet:** the board shows one column, "All results". Above it, a prompt reads *Group by a property to make columns* and opens the Group menu.
- **"No value" column:** notes where the property is missing, empty, `[]`, or a formula error (as B5's "Empty" group, relabelled for Kanban). It sits last in automatic order and can be moved or hidden in Manual. Dropping a card here clears the property (D4).
- **Cards** look like the card view's: an optional cover (`image`), the note name, then the view's `order` properties, one line each.
  - Long text is cut with an ellipsis, and pills that don't fit are clipped.
  - **Every card in a view has the same height**, which is what makes the board cheap (§5).
  - Click opens the note; Ctrl/Cmd-click or middle-click opens it in a new tab (as cards do now).
- **Order inside a column** is the view's `sort`. There is no manual card order (D6), as with tables, where Obsidian doesn't offer one either.
- **Dragging a card to another column** sets the grouped property to that column's value (§4).
  - While dragging, the card lifts and its old slot stays dimmed.
  - The target column is outlined, with a line where the card will land in sort order. A hint reads "Drop to set **status** to **doing**".
  - After the drop, a notice says "Moved "X" to doing · **Undo**", and Ctrl+Z works (§4.6).
- **Dragging a column header** reorders the columns and switches to Manual (D13).
- **Read-only boards.** The columns still work, but cards can't be moved, when the grouped property is:
  - a formula (`formula.*`);
  - a file fact (`file.*`, including `file.tags`, which also counts tags in the body);
  - `this.*`.

  A lock icon and "Grouped by a formula: cards can't be moved" show in the toolbar. Individual cards are also not movable when their frontmatter can't be edited safely (duplicate keys, more than 2,000 lines, YAML Grove can't place) or when the property has an unknown type (a comment, nested YAML). Those cards have no grab cursor, and *Move to* is disabled with the reason in the tooltip.
- **List-valued properties** (`tags`, `list`, `aliases`) group by the whole list, the same as Group by in the table today (`valueKey` `ls:`). A card is in exactly one column, so a move is never ambiguous. Moving writes the whole list of the target column. One card per column per item is listed as a later option (D3).
- **Filters can hide a moved card.** For example, a view filtering `status != "done"` with an added "done" column. After the drop the card leaves the board, and the notice says "Moved "X" to done · it no longer matches this view's filters · Undo".
- **Empty columns** come from Add group (§2.2). They show a dashed "Drop here to set status to blocked" area.
- **Hidden groups** draw no column.
  - The result count counts what is shown, and its tooltip adds "N in hidden groups" (D7).
  - Copy and CSV follow what is shown, as they follow B6's search.
- **Search** (B6) works unchanged: it narrows the cards. Columns stay, even when empty, so the board doesn't jump while typing.
- **Embedded in a note** (`![[Tasks.base#Board]]` or ` ```base `): the same board inside the B4 height cap. The block widget ignores pointer events, so CodeMirror never starts a text drag. The geometry rules apply: no vertical margins on `.cm-content` children, and the widget measures its own height.

### 2.2 Group menu and Manual order (all layouts)

- **A new toolbar button, Group,** goes between Sort and Filter. That is where Obsidian has it; Grove has no Group button today, only the header menu. When grouped it reads "Group · status", or "Group · status · Manual".
- **Menu contents** (mockup `group-menu.png`):
  - **Group by:** a property picker (the Sort menu's picker), an order picker (*A → Z*, *Z → A*, *Manual*; the labels follow the type, as in Sort: *Old → new* and *0 → 1*), and a trash button that stops grouping.
  - **Groups** (shown in Manual only): one row per group, with a grip, a show/hide tick, the label and a count.
    - An added group with no notes is marked "empty · added" and has an ✕ to remove it. That only removes it from the order; no note changes.
    - Dragging the grip reorders the groups. The drop line uses the same `drag.ts` helpers as Sort's reorder.
  - **Show all**, **Hide all**.
  - **Add group:** a text box. Enter adds the value as a new group at the end, shown. The value is read with the property's type: `3` is a number for a number property, `true` for a checkbox, and dates stay dates. Adding a value that already exists shows that group and focuses its row instead.
- **Picking Manual** keeps the current automatic order as the starting order, with nothing hidden.
- **Picking A → Z or Z → A again** removes the manual order, the hidden list and the added groups: the restore Obsidian describes. One Undo in the toast brings them back.
- **New values while in Manual.** A group that isn't in the saved order (for example, a note gets `status: blocked` later) is shown, after the ordered ones, in automatic order. Hidden is a list of what to hide, so new values are never hidden by surprise. Hide all hides only the groups that exist at that moment.
- **Big groupings.** Manual allows up to 1,000 groups (D11). Above that, the Manual item is disabled: "Manual order needs 1,000 groups or fewer". The group list in the menu is virtualised (28 px rows) and has a filter box once there are more than 30 groups.
- **Keyboard:**
  - Tab moves through the rows. On a row, Space toggles show/hide and Alt+↑/↓ moves the group.
  - In the Add group box, Enter adds and Escape closes.
  - Menus open on frame 1 with no animation (standing rule).

### 2.3 Collapsed group headings (table, cards, list)

- **Click, Enter or Space on a heading** toggles it. Today's button already has `aria-expanded` and a chevron that turns, and the count stays visible.
- **State is local UI state, not in the `.base` file** (D5): Obsidian says collapsing is "temporary".
  - It is kept per tab, for each base file, view name and group-by property. It survives rebuilds, view switches, B6 search, and closing and reopening the base during a session.
  - It is not written to disk. Today it is lost on every `createBase` (`collapsedViews`, `groups.ts:195`).
- **Collapsing changes nothing in the data.** The count, summaries and Copy/CSV include collapsed groups.
- **Keyboard:** a heading is focusable and stays focused after a rebuild (already done, `focusedGroup`). Alt+Shift+↑/↓ collapses or expands all.
- **List layout:** Grove doesn't have it (K8). When it is built, it uses the same heading and the same state.
- **Kanban:** Obsidian doesn't list Kanban among the layouts that collapse. Column collapse to a narrow strip (option C) is D9; the recommendation is not in v1.

## 3. Data model and `.base` keys

### 3.1 Keys (Grove's choice; to verify, D2)

```yaml
views:
  - type: kanban            # new layout name
    name: Board
    groupBy:
      property: status
      direction: ASC        # the last automatic order: kept so A → Z / Z → A is one click back
      order:                # present ⇒ Manual. The groups in order; YAML values as written in notes.
        - todo
        - doing
        - blocked           # an added (empty) group is just an entry nothing matches
        - review
        - null              # the "No value" group's place
      hidden:               # groups not shown (Manual only)
        - done
    order: [file.name, due, priority, tags]   # card properties, as in cards
    sort:
      - property: due
        direction: ASC
    cardSize: 272           # column/card width in px (cards' existing key: number or small/medium/large)
    image: cover            # optional cover, cards' existing keys (imageFit, imageAspectRatio)
```

- **Manual lives inside `groupBy`.** Changing the group property (Group menu or header menu) rewrites the whole `groupBy` block, so a stale manual order can never apply to a different property. Going back to automatic order is the same writer with `order` and `hidden` left out.
- **Group identity.** Each entry is the group's value as a YAML scalar: plain text, number, `true`/`false`, a date as `2026-11-03`, `null` for No value, and a list as a block list for list-valued groups. An entry matches a group when `valueKey(entry) === group.id`. That is the same encoding grouping already uses, so `2026-11-03`, a quoted `"2026-11-03"` and a date value all match one group, as they group together today.
- **Validation.** `order` and `hidden` must be lists. An entry that can't be read (a mapping, for example) is ignored with a notice and kept on disk. Duplicates count once. More than 1,000 entries gives a notice, and only the first 1,000 are used.
- **Writer.** `writeViewSetting(source, "groupBy", …)` (`groups.ts:138`) already replaces one view's `groupBy` block byte-preservingly. It needs list values inside the mapping, which `yamlBlock` already writes. No new YAML writer.

### 3.2 In memory

```ts
// groups.ts
interface GroupBy {
  property: string;
  direction: "ASC" | "DESC";
  manual: { order: string[]; hidden: Set<string>; values: Map<string, Value> } | null;
}
// order/hidden hold valueKey ids; values keeps the typed value of each added group (for its label and for writes)
```

- `groupWork` is unchanged. A new `arrangeGroups(groups, manual)` costs O(G):
  - sort by index in `order`, with unlisted groups after, in automatic order;
  - add an empty `RowGroup` for each `order` entry with no rows;
  - mark hidden groups.
- **Hidden groups are dropped before paint.** Counts, Copy/CSV and summaries use the shown groups (D7).

### 3.3 Local UI state (not in the file)

- **Collapsed groups:** `Map<"<base path>\0<view name>\0<group property>", Set<groupId>>`, kept on the tab next to the remembered view index (`viewsByTab`, `view.ts`), so the B4 embed and tab paths share it.
- **Kanban scroll positions** (`scrollLeft`, and each column's `scrollTop` by group id) are kept the same way, so a rebuild or a view switch back doesn't jump.
- **Undo and redo stacks for card moves:** per base tab (§4.6).

### 3.4 Backward compatibility

| File | Read by | Result |
|---|---|---|
| Existing `.base` (no new keys) | New Grove | Unchanged: automatic order, nothing hidden, no Kanban. |
| New keys inside `groupBy` | Grove at `f112151` | `parseGroupBy` reads only `property`/`direction` (`groups.ts:19-23`), so the grouping still works and the manual order is ignored. Writing `groupBy` from its header menu drops `order`/`hidden` (the whole block is replaced). Acceptable: the whole job lands as one merge. |
| `type: kanban` | Grove at `f112151` | That view fails to open with "Unsupported view type"; other views are fine; the view menu greys it out (`menus.ts`, `disabled` for other types). |
| A file Obsidian wrote | New Grove | **K1 hardens two spots:** `parseGroupBy` throws on any `direction` other than ASC/DESC (`groups.ts:21`), and `baseModel` throws on unknown view types (`model.ts:65`). Both become notices that keep the base open. If Obsidian's real keys differ from §3.1, K1 reads both and writes Obsidian's. |
| A file Grove wrote | Obsidian | Unknown keys under `groupBy` may be ignored, or dropped when Obsidian saves that view. That is the main compatibility risk (R1); K1's check answers it. |

## 4. How a drag writes the property

### 4.1 What is written (TS decides, Rust formats)

The grouped key is `noteKey(groupBy.property)`. The property's type is `types.json`'s (`index.host.typeOf`). If it has none, the type is inferred from the note's current value, and failing that, from the column's value.

| Property type | Target column | Line(s) written |
|---|---|---|
| text | text | `status: doing` (quoted only if needed; see 4.3 for style) |
| number | number | `priority: 3` |
| checkbox | true / false | `done: true` |
| date / datetime | date | `due: 2026-11-03` / `due: 2026-11-03T09:00` |
| list / tags / aliases | a list (whole value) | `tags:` + `  - a` lines, or `tags: [a, b]` if the old value was a flow list |
| list / tags / aliases | an added scalar group (`urgent`) | a one-item list `tags:` + `  - urgent` |
| any | **No value** | `status:` (scalars) or `tags: []` (lists), so the line stays in place (D4) |
| any | a value that doesn't fit the type (`fits()` rules, `frontmatter.ts:285`) | refused: "doing isn't a number" (card snaps back) |
| property missing in the note | any column but No value | a new line at the end of the frontmatter (`addProperty`'s place); a note with no frontmatter gets `---` … `---` at the top, after a BOM if there is one |
| property missing | No value | nothing to write (the card is already there) |

### 4.2 The edit as data

```ts
interface PropertyEdit {
  key: string;
  /** What the board saw: the property's exact lines (CR stripped, joined with "\n"), or null = the key was absent. */
  expect: string | null;
  /** A typed value Rust formats, the exact lines to put back (undo/redo), or null = remove the property. */
  to: { type: PropertyType; value: string | boolean | string[] } | { lines: string } | null;
}
type EditResult =
  | { status: "done" | "unchanged"; before: string | null; after: string | null; props: NoteProperties; mtime_ms: number }
  | { status: "conflict"; current: string | null }   // the property's lines now
  | { status: "refused"; reason: string };            // can't edit safely; nothing written
```

- `expect` comes from the row the board drew. `propertyIndex` already keeps each note's frontmatter `lines` beside its props (`propertyIndex.ts:58`), so it is `lines.slice(p.line, p.line + p.count).join("\n")`.
- For an open note, `propertyIndex` reads the editor's text, so `expect` includes unsaved typing.

### 4.3 Rust: `set_property` (new, `src-tauri/src/edit.rs`)

`#[tauri::command(async)] fn set_property(path: String, edit: PropertyEdit) -> Result<EditResult, String>`. It is async, as Step 0 requires, so it is off the GTK thread. Steps, all under the vault mutex:

1. **Path checks:** `fsutil::resolve_in_vault` (inside the vault, no `..`, no symlink out, not hidden). The target must be an existing note (`is_note_path`, any case: `.MD` counts) and at most 16 MB.
2. **Read** the bytes, then `stat` (mtime, size, and the inode on Unix). Bytes that aren't UTF-8 are refused.
3. **Frontmatter.**
   - **BOM:** a UTF-8 BOM is skipped and kept (decided rule).
   - **Splitting:** the same rule as `splitFrontmatter`: a first line of `---` up to the next `---`, at most 2,000 lines. The code extends `props.rs`'s reader to also return each line's byte offset and its own line ending.
   - **Line endings:** CRLF is kept per line. New lines use the frontmatter's first line ending (decided rule: CRLF as today).
4. **Parse** with `props.rs::read_properties`. It is refused, writing nothing, if:
   - it returns `None` (the frontmatter isn't line-editable: duplicate keys in any case, a line it can't place);
   - the property's type is `unknown` (a comment inside the value, nested YAML, odd numbers);
   - `to.lines` doesn't parse as exactly one property with this key and no other lines.
5. **Compare-and-swap.**
   - Take the property's current lines (CR stripped).
   - **If they equal the target already:** `unchanged`. This makes retries and double drops safe.
   - **Else, if they differ from `expect`:** `conflict`, with the current lines. Only this property is compared. An edit elsewhere in the note (the body, another property) made meanwhile is not a conflict, and it is kept, because step 2 read the fresh file.
6. **Format the new lines** with a port of `formatProperty` and `setValue`: the key kept exactly as written, quoted or not, and the value in canonical style. Style is kept where it is safe (D10):
   - a scalar keeps its quote style (plain, `'…'`, `"…"`) when the new value is valid in that style;
   - a list keeps flow `[a, b]` or block style, and its item indent (`- ` vs `  - `).

   `to.lines` (undo/redo) is used as given.
7. **Splice:** prefix bytes + new lines + suffix bytes. Everything outside the property's lines is byte-identical by construction: the BOM, other properties, comments, blank lines, the closing `---` and the body.
8. **Check the result before writing** (cheap, always on, not just in debug). Parse the result again, then confirm all of the following:
   - every other property's key and lines are identical;
   - the body bytes after the closing line are identical;
   - this property reads back as the intended value and type.

   If any of these fails, the edit is refused, with nothing written and an internal error logged. This catches formatter bugs before they reach a note.
9. **Stale check:** `stat` again. If the file changed since step 2 (an external editor, sync), go back to step 2, up to 3 times, then return `conflict`.
10. **Write with `fsutil::atomic_write`:**
    - a temp file in the same folder, `.grove-tmp`-marked so the watcher ignores it;
    - `write_all`, then `sync_all`, then `rename` over the note.

    **New:** after the rename, `fsync` the parent folder, so a power loss can't undo the rename (a few lines in `fsutil.rs`, for every `atomic_write` caller). File permissions: kept by `set_permissions` from the old file's mode before the rename (new; today's `write_note` doesn't keep them either; noted as R6).
11. **Bookkeeping:**
    - `mark_own` (no watcher echo);
    - `index.upsert_note`, so tags, properties and links are fresh;
    - emit `vault-changed` (Modify) to the other windows, as `write_note` does (`lib.rs:194-212`).

    It returns `done`, with the old and new lines, the note's new `NoteProperties` and its mtime.

The mock backend (`src/mock/backend.ts`) gets `set_property`, calling the TS reference (4.4), so every browser test exercises the same rules. `api.ts` and `CONTRACT.md` each gain one entry.

### 4.4 The TS reference and open notes

- **A new pure module, `src/editor/propertyEdit.ts`:** `editProperty(text: string, edit: PropertyEdit): EditResult & { change?: Change }`.
  - It implements steps 3–8 on a string, reusing `readFrontmatter`, `formatProperty` and `yamlString`.
  - It is the spec that Rust is held to by a shared corpus, `fixtures/parity/property-edits.json`, which vitest and `cargo test` both run (RUST_MIGRATION_PLAN §2).
  - `setValue` stays as it is for the Properties block.
- **The corpus covers:**
  - BOM; CRLF; quoted keys; the three quote styles; flow and block lists;
  - an empty value; a missing key; no frontmatter; 2,000+ lines;
  - duplicate keys; comments (refused); `---` with trailing spaces;
  - a body that starts right after `---`; a file without a final newline;
  - non-ASCII; and every row of 4.1.
- **Notes loaded in an editor** (`ws.editors.isLoaded(path)`): the board does **not** call Rust.
  - It runs `editProperty` on the editor's current text, the source of truth with unsaved typing, and applies the returned `change` as one transaction: `ws.editors.change(path, { changes, userEvent: "input.property" })`. That is the path `cells.ts:17` uses today.
  - The edit is now part of the note's own Ctrl+Z history, and the editor's normal save writes it, so there is never a second writer racing the editor.
  - A `conflict` here means the user changed that very property in the note since the board drew it.
- **Other notes** call `api.setProperty(path, edit)`.
- `cells.ts`'s table cell edits can move to the same path later (K6 option). They are not changed in this job.

### 4.5 TS flow of one drop (`bases/move.ts`, new)

1. **Pointer up over a column.** Work out the target group value and the write (4.1) and build the `PropertyEdit`. If the card or the board isn't writable, stop: no write, and the card snaps back.
2. **Optimistic paint in the same frame.**
   - Take the entry out of the source column's array and insert it into the target's at its sort position (a binary search with the view's comparator on the moved row's sort keys).
   - Patch the entry's row: its `props` gain the new property, and its context is rebuilt with `model.context`, which is cheap for one row.
   - Repaint only those two columns' visible windows and update the two counts.
3. **Queue the write:** one promise chain per view, so two quick moves of the same card are applied in order. Moves of different notes still run back-to-back; Rust's lock serialises them anyway.
4. **The result:**
   - **`done` / `unchanged`:** push an undo entry (4.6) and show the notice with Undo.
   - **`conflict`:** put the card back where the current value says it belongs, and refresh from the index. The notice reads: "X changed since the board was drawn (status is now *review*). Not moved." There is no retry and no overwrite.
   - **`refused` or an error:** put the card back, and the notice gives the reason. Nothing was written.
5. **Reconcile.** Rust's own-write suppression means no watcher event. The board calls `ws.vault.written(path)`, as `baseFile` does, so the property index re-reads that one note.
   - **The new fast path in `view.ts` (K6):** when the only changed path is one this board just wrote, and the re-read props equal the patched ones, skip the full rebuild.
   - Anything else (the moved note is `this`, or a formula reads other files' data such as `file.backlinks`) takes the normal sliced rebuild.

### 4.6 Undo and redo

- **The stack lives per base tab** (`bases/history.ts`, new): up to 100 entries, cleared when the tab closes. A new move clears redo.
- **An entry** is `{ label, ops: { path, key, before: string|null, after: string|null }[] }`, holding the exact lines from `EditResult`.
- **Undo** runs, in reverse order, `{ key, expect: after, to: before === null ? null : { lines: before } }` for each op.
- **Redo** runs `{ expect: before, to: after === null ? null : { lines: after } }`.
- **Undo restores the exact old bytes,** including the old quote style, not a re-rendered value.
- **The same compare-and-swap applies:**
  - If the property changed since (another edit, the note's own Ctrl+Z, sync), the undo stops with "Can't undo: X's status changed since". The entry stays, so nothing is overwritten.
  - If the current lines already equal the undo target (for example, the user pressed Ctrl+Z in the note itself), the step counts as done (`unchanged`).
- **Keys:** Ctrl+Z, and Ctrl+Shift+Z or Ctrl+Y, while focus is in the base view but not in a text field (a cell, Search, a menu). The Undo button in the notice runs the same command.
- **Open notes:** the move is also in that note's editor history. Undoing from either place leaves the other as a no-op (`unchanged`), never a double revert.
- **Multi-step and batches.** One entry can hold several ops, for a later multi-select move or a column-header drop that moves notes. Undo first dry-runs every op (`set_property` with a `dry_run` flag that checks without writing). It writes only if all pass. If a write still fails midway (a race after the dry run), the ops already written are compensated in reverse, with the same check. Atomicity across several files is best-effort, and the notice names any note left changed.

### 4.7 Failure cases

| Failure | What happens |
|---|---|
| Crash, power loss or kill mid-write | `atomic_write`: the note is either the old or the new bytes, never partial. The temp file (`*.grove-tmp`) is ignored by the watcher. **New:** on vault open, Grove removes `*.grove-tmp` files left over from earlier runs (K2). The folder `fsync` keeps the rename itself. |
| Disk full or permission denied | The temp write fails and is removed. `Err` goes to the board: the card goes back, with a notice. |
| Note changed on disk between the board's paint and the drop | The compare-and-swap on that property gives `conflict`. Changes elsewhere in the note are kept, because Rust reads fresh. |
| Note changed between Rust's read and its rename | The stat check retries up to 3 times, then gives `conflict`. The window left is the microseconds between the last stat and the rename. No cross-application file lock exists, so this is the floor (R5). |
| Note open with unsaved typing | The edit goes into the editor, not to disk. No race with the save. |
| Note open, unmodified, in another Grove window | `vault-changed` makes that window reload it, as for `write_note` today. |
| Note open **with unsaved edits** in another Grove window | That window's next save overwrites the property change. Today's `write_note` has the same gap (R4). It's not fixed here; the fix is a compare-and-swap on the editor's save, listed as a follow-up. |
| Note renamed or deleted meanwhile | `set_property` returns `refused` ("not found"). The board rebuilds. |
| Frontmatter or property Grove can't edit safely | `refused`, nothing written. The card was never draggable anyway. |
| Formatter bug | Step 8's re-parse check refuses the write. K7's fuzz looks for these. |
| Undo after someone else's change | `conflict`: the undo is refused and the entry kept. |
| `.base` write fails (Group menu) | As today: `save()` reports the error and the menu re-reads the file. No note is touched. |

## 5. Performance

### 5.1 Where the work runs

- **Rust:** the property write (§4.3), which is safety-critical and must read and write the file under one lock, plus everything Rust already does: index, properties, tags, and B7's pre-filter later.
- **TS:**
  - **Evaluation, grouping and manual order stay in TS,** as BASES_PLAN D5 decided. The group key is often a formula, and unsaved edits only exist in the page.
  - Shipping evaluated values to Rust to group them would cost more than grouping, which is one pass. B6's search bench refilters a grouped view of 50,000 rows in a median of 53 ms, sliced so that no single task runs over 50 ms.
  - `arrangeGroups` is O(groups).
  - The `.base` YAML writer stays in TS. It already exists, is byte-exact and tested, and also writes ` ```base ` blocks inside notes through `BaseFile`.
- **This departs from "prefer Rust for grouping and ordering",** on purpose: it avoids a second evaluator and an IPC round trip per rebuild. If K6's bench shows grouping over budget at 50,000 rows, the remedy is B7's pre-filter (fewer rows), not a Rust grouper.

### 5.2 Rendering design

- **Fixed geometry.**
  - Card height is a pure function of the view: the cover, the title and the property count, as `cardLayout` already works it out. Kanban cards are 92 px with 2 properties and no cover.
  - Column width is `cardSize` (272 px by default).
  - A column's height is `count × pitch`, and column `i` is at `x = i × (width + gap)`.
  - Nothing is measured in the scroll, drag or drop paths. Only a `ResizeObserver` on the board element reads sizes.
- **Two-axis virtualisation:**
  - The board is one horizontal scroller. Only columns intersecting `[scrollLeft − width, scrollLeft + viewport + width]` get a DOM body; others are absent, as the track has a fixed width.
  - Each mounted column is its own vertical scroller with a spacer. Cards in `[first − 3, last + 3]` are absolutely positioned (`top = i × pitch`).
  - DOM size at 1280 × 800 with 4–5 columns visible is at most about 60 cards, at any vault size.
- **Recycling:** each column keeps its card nodes keyed by path. Scrolling by one card builds one card. Covers load lazily for visible cards only, with `cards.ts`'s `ws.embeds.image` handle.
- **CSS containment:**
  - `.bases-kanban-col { contain: strict }` (its size is known);
  - `.bases-kanban-card { contain: layout paint style }`;
  - `overflow-anchor: none` on the scrollers;
  - no transitions or animations;
  - `will-change: transform` only on the drag ghost.
- **Scroll handling:** `{ passive: true }` listeners coalesced into one rAF per frame, which repaints only the scrolled column (or the column window for horizontal scrolls).
- **Drag** (pointer events through `drag.ts`, not HTML5 drag and drop, which is janky in WebKitGTK and can't be styled):
  - **At the 4 px threshold, snapshot once:** the board rect, `scrollLeft`, and each column's cached `scrollTop` (kept up to date by its scroll events).
  - **The ghost** is a clone of the card in a `position: fixed` layer, moved only with `transform: translate3d`. The source card stays put, dimmed, so there is no reflow.
  - **In each frame's rAF, only arithmetic:**
    - the column is `floor((x − left + scrollLeft) / (width + gap))`;
    - the landing index is a binary search over that column's sort keys;
    - then two style writes: the ghost's transform and the drop line's transform.

    No `getBoundingClientRect` and no DOM inserts while moving.
  - **Auto-scroll:** within 48 px of the board's or a column's edge, speed scales with distance, applied in the same rAF.
  - **Escape, `pointercancel`, or the window losing focus** cancels: the ghost is removed and nothing is written (`drag.ts` already handles all of these).
- **Drop:** the optimistic patch (4.5 step 2) is O(log n) for the position plus the repaint of two column windows, well under a frame. The disk write is asynchronous.
- **After a drop:** a full rebuild at 10,000 notes is about 20 ms of synchronous `select`, scaled from B6's ~100 ms at 50,000. The K6 fast path skips it for our own writes. At 50,000 the remaining synchronous `select` is B7's subject, not this plan's.
- **The Group menu** builds its rows only for what is visible (28 px rows, virtualised above 30 groups), so it opens on frame 1 even with 1,000 groups.
- **Typing in a note while a board is open:** B0's rules already apply (300 ms quiet, hidden bases wait, edits outside the filter are skipped).

### 5.3 Budgets and how each is measured

**Fixtures** come from a generator in the new bench and test scripts, in the scratch browser mock: `K/00001.md` …, written through `api.createNote` like `bench-bases-search.mjs`. Each note has:

- `status` ∈ {todo, doing, review, done}, with 3% having none;
- a `priority` (number), a `due` (date) and `tags` (a list).

1% of the notes use a quoted value, a flow list, CRLF or a BOM, so the write paths are exercised. The shapes are:

- **"balanced"**: 4 statuses;
- **"tall"**: 10,000 cards in one column;
- **"wide"**: grouped by `project`, with 200 values.

Every timing comes from headless Chromium through CDP's `Input.*` events (real pointer, wheel and keys). It reports:

- rAF frame deltas;
- `PerformanceObserver("longtask")`;
- `Performance.getMetrics` (`LayoutCount`, `RecalcStyleCount`) before and after.

| # | Budget | Measured by |
|---|---|---|
| P1 | Warm open of a 10,000-note Kanban, to cards painted: **≤ 150 ms**; **no long task > 50 ms** | `bench-bases-kanban.mjs 10000` (report) + `test-bases-kanban.mjs` (assert, posttest) |
| P2 | Scrolling the "tall" column (10,000 cards) with wheel events, 3 s: **p95 frame ≤ 16.7 ms, max ≤ 20 ms**, **≤ 40 cards in that column's DOM** | same scripts; card count via `querySelectorAll` per frame |
| P3 | Horizontal scroll across the "wide" board (200 columns), 3 s: **p95 ≤ 16.7 ms, max ≤ 20 ms**, **≤ visible + 2 mounted columns** | same |
| P4 | Drag across 3 columns with auto-scroll, 120 pointer moves at 8 ms: **p95 frame ≤ 16.7 ms**; **script per move ≤ 1 ms**; **`LayoutCount` grows by ≤ 1 per frame** (no forced layout in the move handler); ghost painted on the frame after each move | same; `Performance.getMetrics` diff, frame log |
| P5 | Drop to the card painted in its new column: **next frame (≤ 16.7 ms of work)**; drop to file renamed, index updated and board reconciled: **≤ 100 ms at 10,000 with no long task** | same (mock); the reconcile path counted by an instrumented `update()` run count = 0 for own writes |
| P6 | Rust `set_property`: **≤ 2 ms** for a 10 KB note, **≤ 5 ms** for 1 MB (release, excluding `fsync`); 1,000 sequential edits with no leftover temp files | `#[ignore]` bench test beside `index/bench.rs` (`cargo test --release -- --ignored set_property_bench`), plus a normal `cargo test` for the temp-file check |
| P7 | Undo / redo of a move: same as P5 | `test-bases-kanban-move.mjs` |
| P8 | Group menu with 1,000 groups opens on **frame 1**; dragging a group row: **p95 ≤ 16.7 ms** | `test-bases-group-order.mjs` |
| P9 | Collapsing or expanding a heading in a grouped 10,000-row table and cards: **painted next frame** | `test-bases-group-order.mjs` |
| P10 | Typing in a note while a 10,000-note board is open in another pane: **no frame > 20 ms** | extend `test-bases-b0.mjs` with a Kanban view |
| P11 | Embedded board: renders **≤ 100 ms** after the note opens; **editor line geometry unchanged** | `test-bases-embed.mjs` + the geometry suite |
| P12 | Existing benches unchanged (`bench-bases-groups`, `bench-bases-search`, `bench-frontend`) | before/after runs in each piece's notes, as B6 did |

- **Thresholds.** In the `npm test` assertions, frame thresholds get 20% slack (p95 ≤ 20 ms) for machine noise, and a timing flake gets one rerun under the lock. The bench prints the strict numbers.
- **The real app runs WebKitGTK, not Chromium (R2).** After K5, Chris should do one manual drag/scroll check in the app. The design leans on what both engines do cheaply: transforms, containment, and no layout reads.

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Obsidian's real key names for Kanban, Manual order and hidden groups differ from §3.1, or Obsidian drops Grove's keys when it saves. | K1 checks a file saved by Obsidian 1.14 first (D2). Grove reads both, writes Obsidian's, and keeps unknown keys. |
| R2 | WebKitGTK performs differently from headless Chromium (compositing, pointer events in a GTK window). | Transform-only drag, fixed sizes, containment. Chris's manual check after K5. The keyboard *Move to* path doesn't depend on drag. |
| R3 | TS and Rust property edits drift apart (two formatters). | The shared parity corpus (§4.4); the mock calls the TS reference; K7's differential fuzz; Rust's re-parse check before every write. |
| R4 | A second Grove window with unsaved edits to the same note overwrites the move on its next save (true for every write today). | Documented. Follow-up: compare-and-swap on the editor save path (not in this job). |
| R5 | An external program writes in the microseconds between Rust's last stat and its rename. | Retries plus stat; there is no portable cross-app lock. Undo is still possible because the old lines are kept. |
| R6 | `atomic_write` replaces the file, losing hard links, extended attributes and (today) permissions. | Copy the mode bits (K2). Hard links and xattrs are rare in vaults; noted. |
| R7 | Users expect tags or lists to put a card in several columns. | D3; whole-value now, per-item later if wanted. |
| R8 | A moved card disappears because of the view's filter. | The notice says so and offers Undo. |
| R9 | Manual `order` grows stale when values are renamed in notes (old entries become empty groups). | Empty added groups show "empty · added" with ✕ remove. A vault-wide "rename group value" is a later feature. |
| R10 | Very many groups (grouped by `file.name`) make Manual and the board heavy. | The 1,000-group Manual cap; horizontal virtualisation keeps the board cheap anyway. |
| R11 | Drag inside an embedded base fights CodeMirror (text selection, scroll). | The widget's `ignoreEvent`, pointer capture, and the embed tests in K5. |
| R12 | Gemini's quota (until about Nov 3, 9 PM PT) delays pieces assigned to it. | Only K6 and K8 wait for Gemini; K3 goes to Claude now (§8). |

## 7. Decisions for Chris

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **Kanban look** (`kanban-mockups/`) | **A** Board: one scroller per column, horizontal scroll, full cards. **B** Lanes: one shared vertical scroll, sticky headers, columns fill the width. **C** Compact: one-line cards, big columns collapse to strips. | **A.** Long columns don't drag short ones along; it is the expected Kanban; virtualisation per column is simple; it works in an embed's height cap. Keep C's compact cards as a later card-size option (`cardSize: small`). |
| D2 | **YAML keys** | §3.1 (Manual inside `groupBy`: `order`, `hidden`; `type: kanban`; reuse cards' keys) | **As drawn, after K1 checks a `.base` saved by Obsidian 1.14** with a Kanban view and a Manual group order (hide one, add one). Chris: please save such a file in a scratch vault and drop it in this worktree, or let Grok-A have one by observation. |
| D3 | **List-valued group property** | Whole list = one column (as Group by today), or one column per item (card shown in several) | **Whole list** for v1: one card, one place, unambiguous moves, the same groups as the table. Per-item is a later option. |
| D4 | **Dropping on "No value"** | Write an empty value (`status:` / `tags: []`) or remove the line | **Empty value.** It keeps the property's place and type (still shown in the Properties block), and undo is trivial. |
| D5 | **Collapsed state** | Local per tab/session, saved in the workspace layout, or in the `.base` | **Local per tab, for the session**, as Obsidian calls it "temporary"; never written to the `.base`. Saving it in the workspace layout across restarts can come later. |
| D6 | **Card order inside a column** | View sort only, or manual card order | **View sort only** (no writes to reorder; the same as tables). |
| D7 | **Hidden groups and the count** | Count shown rows, or all | **Shown rows**, with "N in hidden groups" in the tooltip. Summaries and Copy/CSV follow, consistent with B6's search. |
| D8 | **Undo scope** | Per base tab; app-wide; also table cell edits | **Per base tab**, Ctrl+Z when focus is in the board, plus Undo in the notice. Cell edits can join later. |
| D9 | **Collapse Kanban columns** | No (as Obsidian's page implies) / yes, to a 40 px strip | **No in v1.** Hide group covers it; revisit with option C. |
| D10 | **How much formatting a move keeps** | Canonical rewrite of the one property / keep quote and list style | **Keep quote style and flow/block list style**, in the corpus; properties with comments stay refused (as today, "unknown"). |
| D11 | **Manual cap** | None / 1,000 groups | **1,000.** |
| D12 | **Group by `file.folder`: move the file on drop?** | Read-only / move the file | **Read-only** for now (a move is a rename with link updates: a separate feature). |
| D13 | **Dragging a column header** | Off / reorders and switches to Manual | **On.** |
| D14 | **Toolbar Group button** | Add (as Obsidian) / header menu only | **Add**, between Sort and Filter. |
| D15 | **Writes for closed notes** | Rust `set_property` / keep TS read-whole-file + `writeNote` | **Rust.** It reads and writes under one lock (no lost external edits between a TS read and write), sends no whole note text over IPC twice, and adds the re-parse check. |
| D16 | **Gemini's pieces** | Wait for Gemini (after Nov 3) / reassign | **K3 to Claude now** (it gates K4/K5). **K6 and K8 can wait for Gemini.** |

## 8. Build split

Sizes: big (about 500+ lines with tests), medium (150–400), small (under 150). Each piece lists the files it owns, and two pieces running at once never own the same file. Each ends with its own `rebuild/NOTES_<ID>.md`, the full checks and before/after benches.

| Piece | Scope | Size | Needs | Owns | Builder | Reviewer |
|---|---|---|---|---|---|---|
| **K1** Format check + hardening | Compare §3.1 with an Obsidian-saved file (D2) and adjust the key names in this plan. `parseGroupBy` accepts an unknown `direction` and extra keys (notice, not a throw). An unknown view `type` opens with "This layout isn't supported yet" for that view only. Unit tests. | Small (~80) | D2's file, if Chris has one | `groups.ts` (`parseGroupBy` only), `model.ts` (view-type line), `groups.test.ts`, `model.test.ts` | Grok-A | Grok-B |
| **K2** Safe property edit | Rust `set_property` (§4.3), with `dry_run`; the TS reference `editProperty` (§4.4); `fixtures/parity/property-edits.json` (60+ cases); mock backend; `api.setProperty`; parent-folder `fsync` and mode copy in `atomic_write`; leftover `.grove-tmp` sweep on open; the `P6` bench test; `CONTRACT.md`. No UI. | Big (~700) | – | new `src-tauri/src/edit.rs`, `index/props.rs` (line offsets), `fsutil.rs`, `vault.rs`, `lib.rs` (one command), new `src/editor/propertyEdit.ts` + test, `api.ts`, `mock/backend.ts`, `fixtures/parity/` | Codex | Claude |
| **K3** Group menu + Manual + collapse state | The toolbar Group button; the Group menu (§2.2) with virtualised rows, drag, show/hide, Show all / Hide all, Add group and remove; `arrangeGroups`; `order`/`hidden` parse and write; header menu "Hide group"; collapse state per tab (§3.3) plus Alt+Shift+↑/↓; `test-bases-group-order.mjs` (P8, P9) | Big-medium (~450) | K1 merged | new `bases/groupMenu.ts`, `groups.ts` (arrange + collapse hook), `menus.ts` (toolbar, header item), `view.ts` (tab memory), `styles/bases.css`, tests | **Claude** (Gemini could do it after Nov 3, but it gates K4/K5) | Grok |
| **K4** Kanban layout (read-only) | `type: kanban` in the model and in Configure view and the view menu (icon `square-kanban`); `bases/kanban.ts`: columns from groups, two-axis virtualisation, recycling, covers, the empty/No value/no-groupBy states, column header + and ⋯ (Hide, Move left/right → Manual), keyboard (§2.1); `kanban.test.ts` (layout maths); `test-bases-kanban.mjs` (render, open, scroll, P1–P3, embed P11) | Big (~650) | K1; K3 merged (or K3's `arrangeGroups` signature agreed first; then K4 can start in parallel) | new `bases/kanban.ts`, new `styles/bases-kanban.css`, `model.ts` (type), `view.ts` (dispatch, a few lines), `config.ts` (layout choice), tests | Claude | Codex |
| **K5** Moving cards | Pointer drag (§5.2), drop hint and landing line, auto-scroll; keyboard move (Space to pick up, arrows, Space to drop, Escape; Alt+←/→ moves one column) with live-region announcements; card context menu *Move to ›*; read-only and per-card checks; optimistic patch; the write queue; notices; `bases/history.ts` undo/redo (§4.6); column header drag → Manual; new note via the column **+** (`newRow` seeded with the column value); `test-bases-kanban-move.mjs` (P4, P5, P7; conflicts via the mock; open-note path; embed drag) | Big (~650) | K2 + K4 merged (K3 for header drag) | new `bases/move.ts`, new `bases/history.ts`, `kanban.ts` (hooks), `newRow.ts` (seed), tests | Codex | Claude (+ Grok adversarial pass) |
| **K6** Reconcile fast path + bench | Skip the full rebuild after our own write when the re-read props match (§4.5 step 5); `bench-bases-kanban.mjs [1000,10000,50000]`; P10 in `test-bases-b0.mjs`; P12 before/after; optional: move `cells.ts` writes onto `set_property` | Medium (~300) | K5 merged | `view.ts` (update path), new bench script, `test-bases-b0.mjs` | Gemini (after Nov 3; can wait) or Claude | Grok |
| **K7** Write fuzz and failure tests | Differential fuzz of Rust and TS `editProperty` over generated frontmatters (BOM, CRLF, quotes, flow lists, comments, duplicates, huge, non-UTF-8), byte-identity invariants outside the property, crash injection (a test hook that aborts between temp write and rename, and between rename and the folder `fsync`), a writer thread racing `set_property` | Medium (~200, tests only) | K2 merged | new Rust test module + a scratch fuzz script | Grok | Codex |
| **K8** List layout | `type: list` (bulleted or numbered, from Obsidian's page): the note name plus inline properties, virtualised, group headings with collapse (K3's state) | Medium (~300) | K3 merged | new `bases/list.ts`, `styles/bases-list.css`, `model.ts` (type) after K4, tests | Gemini (after Nov 3; can wait) | Grok |

**Order:**

```text
wave 1 (now, parallel):  K1 (Grok-A, first; tiny) · K2 (Codex) · K3 (Claude, after K1 lands)
wave 2:                  K4 (Claude, after K3) · K7 (Grok, after K2)
wave 3:                  K5 (Codex, after K2 + K4) · K8 (Gemini, after Nov 3 and K3)
wave 4:                  K6 (Gemini if back, else Claude)
```

**Shared-file conflicts:**

- `groups.ts`: K1 (`parseGroupBy`), then K3 (arrange and collapse).
- `model.ts`: K1, then K4 (`kanban`), then K8 (`list`).
- `menus.ts`: K3 (toolbar and header). K4 needs only the view-icon line, merged after K3.
- `view.ts`: K3 (tab memory), then K4 (dispatch), then K6 (fast path).
- `kanban.ts`: K4, then K5.
- **Merge order:** K1 → K2 → K3 → K4 → K7 → K5 → K8 → K6.

**Rules for every piece:**

- Only behaviour from Obsidian's public help pages or observation; Grove's own look and the bundled Lucide icons.
- No new crates or npm packages, and `npm run audit:offline` passes.
- Real input in browser tests; menus open on frame 1 with no animation.
- The geometry and real-mouse suites stay green, with no vertical margins on `.cm-content` children.
- `flock /tmp/grove-npm-test.lock npm test`, `cargo test`, and `rebuild/round*-shots` restored before commits.
