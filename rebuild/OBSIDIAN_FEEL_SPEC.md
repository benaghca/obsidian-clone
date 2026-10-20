# Obsidian feel spec (observed in Obsidian 1.14.4, default theme, light, 1280x800)

## Live Preview (CodeMirror 6 decorations)
- Markdown syntax hides/reveals PER ELEMENT when cursor/selection touches it, not per line.
  - `**bold**`: markers show only when cursor is inside the bold span; markers in normal weight.
  - `[[Link]]`: rendered as underlined accent link; brackets appear muted when cursor touches it.
  - Headings: `#` marker shows only when cursor on that line, dimmed gray, lighter weight. Fold chevron in left gutter on hover.
- Checkboxes, bullets, tags, external-link icons stay rendered widgets even with cursor on the line.
- Checked task: accent-filled rounded box, white check, gray strikethrough text.
- Select All shows everything raw; selection is light accent tint per line.
- Typing `[[` auto-inserts `]]`, caret between.
- Undo groups typing bursts. Single click on a link navigates the same tab; back/forward enabled.

## Layout
- Frameless window; tab strip doubles as title bar.
- Ribbon ~29px far left, muted gray icons.
- Left sidebar ~200px: icon tabs (Files/Search/Bookmarks), action row, flat file list (no extensions), rows ~18px, ~13px text, selected = rounded light-gray pill. Vault name bottom-left, help/settings bottom-right.
- Right sidebar ~200px: Backlinks (count, linked mentions grouped per file as small bordered cards with highlighted match, unlinked mentions), Outgoing links, Tags, Outline.
- Tabs ~28px; active tab lighter bg, rounded top, close x; inactive plain text with thin separators; + button; tab list chevron.
- Sub-header ~24px: back/forward, breadcrumb title, reading-view icon, kebab menu. Muted.
- Inline title (file name) ~28px bold above body.
- Readable line width ~700px, centered, re-centers when sidebars/splits change.
- Floating status bar bottom-right, no background: backlinks, word count, char count (live).
- Splits: each pane own tab strip, thin divider, 50/50.

## Typography & color
- System sans (Noto Sans on Linux), 16px body, line-height ~1.5. H1 ~28px, H2 ~22px, headings in text color.
- Editor bg #fff; ribbon/sidebars ~#f5f5f5; near-black text; accent violet ~#7c3aed.
- Links accent, underlined; tags accent pills on light accent bg; inline code mono on light-gray chip; blockquote accent left bar.
- Minimal chrome: no borders except thin separators, muted icons.

## Popups & modals (one shared pattern)
- `[[` suggest: below caret, ~300px wide, white, ~8px radius, thin border, soft shadow; note names only; matched letters bold; selected row = full-width gray pill; footer hint "Type # to link heading, ^ to link blocks, | to change display text"; shrinks to fit; Esc dismisses keeping text.
- Quick switcher Ctrl+O and command palette Ctrl+P: centered ~465px wide, ~120px from top, rounded, strong shadow, dim overlay; input with clear button; footer key hints (up/down, enter open, ctrl+enter new tab, ctrl+alt+enter open right, shift+enter create, esc).
- Fuzzy subsequence matching, tighter matches ranked first, matched letters bold, first row preselected, modal shrinks to results.
- Command palette lists commands alphabetically with right-aligned shortcuts, "Plugin: Command" naming.
- Opening feels instant (<~100ms), no visible slide.

## Performance targets
- 5,300-line / 330k-char note opens instantly; fast scrolling has no blanking; mid-document typing has no visible lag; counts update live.
- Viewport virtualization (CodeMirror 6 default).

## Other
- Graph view: dark-gray nodes with labels, thin light edges, floating settings panel (Filters, Groups, Display, Forces).
- Settings: separate window, left nav, grouped rounded cards, label + muted description + right control, accent pill toggles.
- Shortcuts: Ctrl+O, Ctrl+P, Ctrl+N, Ctrl+, , Ctrl+\ split.
