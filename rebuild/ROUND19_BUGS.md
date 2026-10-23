# Round 19 bugs

Hunter pass on `rebuild/r19-grok` at `6454081` (Codex's round 19, notes in `ROUND19_NOTES.md`). Nothing in the app was changed. Checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, window 1280×800, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release). Keys are `Input.dispatchKeyEvent`. No remote URL was requested. The page threw no exception.

Obsidian 1.14.4 was not driven in this pass. Expected behavior is the round brief, plus the Obsidian behavior already recorded in `ROUND19_NOTES.md`. Two recorded differences are left as the notes have them: the preview shows the large file title the brief asked for, and the first Backspace on a list item removes the whole marker.

`src/editor/format.r19bugs.test.ts` encodes the list bugs below. All 10 tests fail on this commit.

## Bugs

### 1. Tab on an ordered item leaves its children behind and renumbers them

Severity: moderate.

Repro:

1. In Live Preview, with the default tab indent, put the caret on `b`:

```
1. a
2. b
    1. child
3. c
```

2. Press Tab.
3. Press Shift+Tab on this sibling shape, caret on `b`:

```
1. a
    1. b
        1. child
2. c
```

Expected: the item and its existing sublist move together. Tab gives `1. a`, then `b` and `child` one level deeper, then `c` as `2`. Shift+Tab brings `b` and `child` back out one level, and `c` becomes `3`. A child that was `1` stays `1`.

Actual: Tab indents only `b`. The child stays at four spaces, and the new renumber rewrites it from `1` to `2`:

```
1. a
	1. b
    2. child
2. c
```

Shift+Tab outdents only `b`. The child stays at eight spaces:

```
1. a
2. b
        1. child
3. c
```

The same pair of results happens with a four-space indent unit. A four-space Tab produces `    1. b` and `    2. child`.

Suspected: `src/editor/format.ts` lines 175–226. `indentList` changes `selectedLines` only, then renumbers every ordered list in the touched tree. The child was not moved, so it is now a sibling and gets the next number. Failing tests: "Tab moves an ordered item together with its children", "Tab with the default tab indent moves the children too", "Shift+Tab outdents an ordered item together with its children".

### 2. Tab in a quote or callout inserts the indent before `>`

Severity: moderate.

Repro:

1. Caret on `second`:

```
> 1. first
> 2. second
> 3. third
```

2. Press Tab. Then, from `>     1. second`, press Shift+Tab.
3. Repeat Tab on the same list under `> [!note] Steps`.
4. In Live Preview, open a rendered callout whose body is `1. alpha` / `2. beta` / `3. gamma`. Click `2. beta` (pointer move, then press, then release) and press Tab.

Expected: the indent stays inside the quote or callout. Tab turns the middle item into `>     1. second` and the following item into `> 2. third`. Shift+Tab brings it back to `> 2. second` and restores `> 3. third`. A click on a rendered callout item edits that item.

Actual: Tab writes the indent at column 0, so the item leaves the quote and the following number stays `3`:

```
> 1. first
    > 2. second
> 3. third
```

With the default tab indent the source is a tab, then `> 2. second`. Shift+Tab on `>     1. second` changes nothing, because the line does not start with whitespace. The callout source does the same (`    > 2. second`, and `3` stays `3`).

Clicking the rendered `2. beta` and pressing Tab indents the header instead. The note becomes a tab, then `> [!note] Steps`, and the callout draws as raw syntax. The body lines stay `> 1. alpha`, `> 2. beta`, `> 3. gamma`.

Suspected: `src/editor/format.ts` lines 216–226, where the four-space path and `indentMore` / `indentLess` insert at `line.from`. The rendered-callout click is `src/editor/callouts.ts` lines 92–97: the position callback returns the header line's `from` unless the click is inside a markdown embed. `src/editor/render.ts` lines 103–109 then puts the caret there before Tab runs. Failing tests: "Tab indents an ordered item inside the quote", "Shift+Tab outdents an ordered item inside the quote", "Tab indents an ordered item inside a callout".

### 3. A heading preview scrolls the title and the Open icon out of the popup

Severity: moderate.

Repro:

1. `LongP` is `# Top`, thirty `Filler.` paragraphs, `## Deep`, `Target.`, then thirty `Tail.` paragraphs.
2. In Live Preview, Ctrl+hover `[[LongP#Deep|deep]]` until the preview opens.
3. Repeat with the same note and no paragraphs after `Target.`.

Expected: the popover starts with the note title as a large heading and an Open icon at the top right. `[[note#heading]]` scrolls that heading near the top of the body.

Actual: with room below the heading, the popup is 450×400 and `Deep` is 16 px from the top of the popup. The title `LongP` is at −1300 px and the Open icon at −1296 px, so both are outside the visible box. Scroll position is 1321, under a max of 2266. With nothing after `Target.`, scroll clamps at 1050. `Deep` sits at 287 px, the title at −1029 px, and the icon is not visible. Filler lines occupy the top of the box. Short notes, an empty note, and a heading already near the top of a short note still show the title and the icon.

The round's browser check looks at the title's `textContent` and requires the heading's y between 8 and 24. That passes for the long-tail note while the title and the icon are scrolled away.

Suspected: `src/editor/embeds.ts` lines 255 and 276–280. The title and the Open link are inside `.hover-popover`, which scrolls (`src/styles/blocks.css` lines 337–342). The scroll adds `target.top - popup.top - 16` to `scrollTop`. The icon is `position: absolute` on the embed (`blocks.css` lines 35–40), so it scrolls with the title.

### 4. Backspace at the end of an indent outdents fenced code and frontmatter

Severity: moderate.

Repro:

1. Caret on the first character of `code` (column 4, after four spaces):

````
```
    code
```
````

2. Press Backspace.
3. In Source mode, caret on the first character of `value`:

```
---
nested:
    value
---
```

4. Press Backspace.

Expected: one character is deleted. The fence line becomes three spaces, then `code`. The frontmatter line becomes three spaces, then `value`. A line that only looks like a list marker inside a fence already deletes one character (`- code` → `-` + `code`), which is the behavior this case should follow.

Actual: the whole indent unit disappears. The fence line is `code` with the caret at column 0. The frontmatter line is `value` at column 0. Both were measured with the caret on the first character of the word, after a real Backspace.

Suspected: `src/editor/format.ts` lines 232–235. Any empty selection sitting at the end of `/^[ \t]+/` calls `indentLess`, with no check for a list, a fence, or frontmatter. Failing tests: "Backspace in a fence deletes one character", "Backspace in frontmatter deletes one character".

### 5. The second Backspace in a quoted list does not outdent one level

Severity: moderate.

Repro:

1. Caret on the first character of `child`:

```
> - parent
>     - child
```

2. Press Backspace twice.

Expected: the first press removes the marker and keeps the quote and the indent (`>     child`). The second press outdents one list level and keeps the quote (`> child`).

Actual: the first press is `>     child` (caret at column 6). The second press leaves `>   child` (caret at column 4): two spaces deleted, quote kept, one list level still there. The same two-space result comes from the command test.

Suspected: `src/editor/format.ts` lines 232–251. The outdent branch only matches a line that starts with spaces or tabs. A line that starts with `>` falls through to `deleteMarkupBackward`, which deletes the extra space after the quote marker instead of one list level. Failing test: "the second Backspace in a quoted list outdents one level and keeps the quote".

### 6. Escape does not cancel a failed rename after the field blurs

Severity: moderate.

Repro:

1. Open `RenameA`. Click the inline title, replace it with `Bad/name`, then click the editor.
2. Press Escape without clicking the title again.
3. Right-click `RenameA` in the explorer, choose Rename, type `Bad:name`, and click the note header.
4. Press Escape.

Expected: Escape cancels the rename. The title and the explorer row show `RenameA` again, and the error goes away. The file stays `RenameA.md`.

Actual: after the title blurs, Escape leaves `Bad/name` in the title, `aria-invalid` set, and the error `Names cannot contain /, \ or : or control characters.` The path is still `RenameA.md`. The explorer row stays contentEditable, still reads `Bad:name`, and still shows that error. Escape while the title or the explorer field is focused does restore the name. Clicking away on an invalid name keeps the draft and shows the error, which is what the brief asked for on a failed commit.

Suspected: `src/shell/pane.ts` lines 610–617 and `src/shell/dom.ts` lines 106–110. Escape is handled only on the focused field. Blur runs the commit, the commit throws, and the draft stays editable with focus already in the editor.

### 7. A long note title overflows under the Open icon

Severity: moderate.

Repro:

1. Create `VeryLongTitleNoteForPreviewWrappingAndIconOverlapCheck` with one line of body text.
2. Ctrl+hover a link to it.

Expected: the title wraps inside the popup, clear of the Open icon. The popup does not grow a horizontal scrollbar.

Actual: the title is one unbreakable line. The popup is 450×152 and shows a horizontal scrollbar. The visible title is cut off (`VeryLongTitleNoteForPreviewWr…`). The icon box is 28×24 at the top right, and a text rectangle of the title intersects it.

Suspected: `src/styles/blocks.css` lines 337–342 and 363–370. `.hover-popover` is `overflow: auto`. The title's `padding-right` is 28 px, and the name has no break opportunity, so the glyphs run into the icon.

### 8. A missing-note preview has no title and no Open icon

Severity: minor.

Repro:

1. Ctrl+hover `[[MissingP]]` when that note does not exist.

Expected: the preview starts with the note title and the Open icon, and a short note shrinks under the 400 px cap. The missing-note sentence can sit under that title.

Actual: the popup is 450×78 and contains only `“MissingP” is not created yet. Click to create.` There is no `.markdown-embed-title` and no `.markdown-embed-link`. It does stay inside the window.

Suspected: `src/editor/embeds.ts` line 249. An unresolved path returns `missingBox` (line 139) before the title and the Open control are built.

### 9. Two list Backspaces are one undo step

Severity: minor.

Repro:

1. Caret on the first character of `nested` in `- a` / `    - nested`.
2. Wait long enough that loading the note is its own undo step (about 700 ms).
3. Press Backspace, wait about 80 ms, press Backspace again.
4. Press Ctrl+Z once.
5. Repeat with about 700 ms between the two Backspaces.

Expected: the first press removes the marker and keeps the indent (`    nested`). The second outdents (`nested`). One Ctrl+Z restores only the indent. A second Ctrl+Z restores the marker.

Actual: within the short gap, one Ctrl+Z restores both the indent and the marker (`    - nested`). With about 700 ms between the presses, one Ctrl+Z restores only the indent. Tab's indent-and-renumber stays one undo step, and Ctrl+Y restores it. That part matches the brief.

Suspected: `src/editor/format.ts` line 252 (`delete.backward` for the marker) and line 235 (`indentLess`, whose event is `delete.dedent`). Both match CodeMirror's `delete` history group, the edits touch, and the default group delay is 500 ms. Failing test: "two list Backspaces are two undo steps".

### 10. A trailing space stays in the inline title after a no-op rename

Severity: minor.

Repro:

1. Open `RenameA`. Click the inline title, set it to `RenameA ` (one trailing space), and press Enter.

Expected: the name is trimmed. The title shows `RenameA`, there is no error, and the path stays `RenameA.md`.

Actual: the path stays `RenameA.md` and there is no error, but the title keeps the trailing space, so the heading does not match the file.

Suspected: `src/fileOps.ts` lines 66–70. `renameFile` trims, sees the current name, and returns. `commitTitle` in `src/shell/pane.ts` lines 586–592 clears the error and does not write the trimmed text back, and no rename event refreshes the field.

## What held

Part A, checked with the same native input:

- Random note, Bookmark all tabs, Insert template, and Add file property are registered. Add file property's hotkey is Ctrl+;.
- Search for `Hit` highlights both hits on `FirstHit then several words then SecondHit on one line`. A real click on the second highlight selects `Hit` at columns 39–42.
- Ctrl+click on the search result title opens a second tab of that note.
- In Source mode, a heading that contains `**bold**` and `*italic*` computes font-weight 700 and italic for the italic span.
- Clicking table cell `a` and pressing Tab still moves to the next cell.

Part B:

- A three-line preview is 450×161, shows the title at a large size, shows the Open icon, and sits inside the window. An empty note shrinks to 450×113 with the title and the icon.
- A heading at the top of a short note stays under the title (`HeadP`, then `Only`). The popup does not stick at 400 px.
- Releasing Ctrl while the pointer stays on the link leaves the preview open 400 ms later. A link within about 50 px of the bottom of the window opens a 450×137 preview that stays inside the viewport (top 606, bottom 743).
- An invalid inline title (`Bad/name`), an empty title, and a case-insensitive clash (`takena`) keep the draft and show the error under the field. The path does not change. Escape while the title is focused restores it.
- An explorer rename to an existing folder name keeps the draft and shows `"FolderB" already exists`.
- Tab on `5. first` / `6. second` / `7. third` produces a nested `1. second` and renumbers the parent to `6`. Ctrl+Z restores `5/6/7`. Ctrl+Y puts the indent back.
- The first Backspace on `- nested`, on `1. nested`, and on `> - [x] done` removes the marker (and the checkbox) and keeps the quote. The caret was on the first character of the text.
- A bullet that only looks like a list marker inside a fence still loses one character.

## Suggested next

These are suggestions only.

1. **Move a list item with its children, inside the block it already belongs to.** Tab and Shift+Tab should carry the sublist, and the indent should land after `>` in a quote or a callout. A click on a rendered callout item should edit that item. It matters because the new renumber turns a nested `1` into `2`, and Tab on a callout item can dissolve the callout. Size: small. `format.ts`, and the click position in `callouts.ts`.

2. **Keep the preview's title and Open icon on screen.** Put them outside the scrolling body, including a missing note and a heading target, and wrap a long title clear of the icon. It matters because a heading preview currently hides the title this round added. Size: small. `embeds.ts` and `blocks.css`.

3. **Make failed renames and list Backspaces undo one action at a time.** Escape should cancel a blurred invalid rename. Backspace in a fence or in frontmatter should delete one character. Two list Backspaces should be two undo steps. It matters because the explorer can keep showing a name the file does not have, and one undo puts a marker back that was already removed. Size: small. `pane.ts`, `dom.ts`, and `format.ts`.
