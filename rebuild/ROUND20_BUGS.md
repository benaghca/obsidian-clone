# Round 20 bugs

Hunter pass on `rebuild/r20-grok` at `f390b17` (Codex's round 20, notes in `ROUND20_NOTES.md`). Nothing in the app was changed. Checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release). Stationary clicks send press and release again at the same point with no `mouseMoved` between them. Keys are `Input.dispatchKeyEvent`. No remote URL was requested.

Obsidian 1.14.4 was not driven in this pass. Expected behavior is the round brief, plus the Obsidian behavior already recorded in `ROUND20_NOTES.md`. On this commit the geometry suite (187 checks, menus and prompts visible within two frames, longest sampled frame 17.0ms), the header suite, and the explorer drag suite all passed.

`scripts/test-r20-bugs.mjs` encodes the breadcrumb bug below. It fails on this commit.

## Bugs

### 1. A long breadcrumb hides the note name and clips ancestors with no ellipsis

Severity: moderate.

Repro:

1. Create `VeryLongFolderNameThatOverflows/AnotherExtremelyLongFolderName/ThirdLongFolderNameHere/Short.md` and open it.
2. Set the window to 1000×800 (the same failure is at 900, 860, 700 and 600). Look at the view header beside the back and forward arrows.

Expected: the header shows the folder path and the note name, as in the brief's "00 - System / How this vault works". When the path is wider than the header, ancestor segments shrink with an ellipsis and the current note name stays visible.

Actual: at 1000px the three folder names stay at their full widths (221px, 216px, 167px) and `text-overflow` is `clip`. The header box ends at x=930, which is exactly where `ThirdLongFolderNameHere` ends. The following `/` and the note name `Short` are outside that box. `Short`'s border box is 0×0 at x=943, so no ellipsis is painted either. At 700px the second folder runs to x=750 while the header ends at x=630, so that name is cut mid-word and the note name is still 0px wide. At 1100px and 1280px the same path does fit, and `Short` is 33px wide inside the header. A short path (`Notes / Short`) still shows the name at 700px.

The header suite does not catch this. It reads the container's `innerText`, which still includes `Short` when the box width is 0, and its fixture path is short enough to fit at 600px.

Suspected: `src/styles/noteView.css` lines 31–49. `.view-header-title-container` is a nowrap flex row with `overflow: hidden`. `.view-header-breadcrumb` sets only a color, so `min-width: auto` keeps each ancestor at its text width. `.view-header-title` is the only segment with `overflow: hidden` and `text-overflow: ellipsis`, which makes its flex minimum 0, so the note name shrinks away before any folder does. The spans are built in `src/shell/pane.ts` `renderHeader` (lines 422–429). Failing test: `scripts/test-r20-bugs.mjs`.

## Checked, not filed

- Live Preview, scroll 0, frontmatter note, stationary clicks on H1: the collapsed icon stays under the pointer, the second click unfolds, and the hover arrow is back. After `scrollIntoView` from the bottom of the same note, folding H1 clamps `.view-content` from scroll 232 to 0 and the icon moves down by that amount (pointer y=101, icon y=330). The second click hits `.view-content` and does not unfold. Source and Reading do the same on H1, and all three modes do it on H3 (the line moves 339–354px, equal to the scroll clamp). The heading's document position does not change. The scroller is refusing an offset past the new end.
- File rows: a still click and a 2px, 3px, or 4px move open the file and show no ghost. A 5px or 6px move shows the ghost and does not open the file. Folder rows: a still click and a 3px or 4px move expand the folder. A 24px drag on a folder adds `is-being-dragged`, plays no animation, and releasing on that same row does not expand it or create a numbered copy.
- Over a real folder the ghost is two lines, `Quick` then `Move into “QuickDest”`, on a 18px + 18px grid, with no animation. A quick drop into a collapsed folder moves the file and leaves the folder collapsed. A drop on the editor does not move the file or change the note. A drop on a descendant is refused. A drop on the current parent does nothing. Empty space at the bottom of the list highlights the whole list, says `Move into “Sample Vault”`, and moves the file to the root.
- An open `Src/Open.md` dropped onto `Dest`, which already has `Open.md`, becomes `Dest/Open 1.md`. The tab stays in Source, the inline title and breadcrumb become `Open 1`, and the unsaved ` edited` text remains. The dialog title is `Update links?`. Accepting it rewrites `[[Src/Open#HeadingOne|alias]]` to `[[Open 1#HeadingOne|alias]]`, `![[Src/Open]]` to `![[Open 1]]`, and `[label](Src/Open.md)` to `[label](Open%201.md)`. The link inside a fence stays `[[Src/Open]]`. Ctrl+Z removes ` edited`.
- Moving the open note's folder `Pack` into `Dest` stores `Dest/Pack/Moved.md` on the back stack. The back button opens that path. `[[Pack/Moved#HeadingOne|alias]]` becomes `[[Moved#HeadingOne|alias]]`, the sibling link becomes `[[Sibling]]`, and `[[Stay]]` is unchanged.
- A background tab: pointer down does not activate it, a 4px move still activates on release and does not drag, and an 8px drag leaves the current note active.
- Settings nav and section scrollers use the shared scrollbar rules: 12px, thumb border 3px, radius 12px, `padding-box`, arrow buttons `display: none`.
- At 860px and 700px the inline title stays on the text column and inside the pane.

## Next improvements

- Drop an explorer row onto a note to insert a wikilink at the pointer. A drop on the editor currently leaves the file where it is and does not change the note. The move drag already has a pointer, a ghost, and a target, so this is the other half of Obsidian's drag. Medium.
- Select several explorer rows and move them together. One-file moves work; a group still needs the menu one file at a time. Medium.
- Paste rich text as Markdown. Copied formatting from a browser or document becomes plain text today. Medium.
