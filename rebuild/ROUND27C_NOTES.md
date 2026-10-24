# Round 27c

Styled tooltips, hover preview, and the wikilink suggester. Branch `rebuild/r27c-grok`. Local commits only. Nothing was pushed.

## What changed

The shared hover tooltip in `src/shell/dom.ts` waits 300 ms, then appears with no fade. Ribbon buttons place it beside the control. Other labelled buttons place it centred under the control, flip it above near the bottom of the window, and clamp it inside the viewport. The same helper now covers the live-preview code flair, the reading-mode copy button, and the fold placeholder. Those three dropped their native `title` attributes and keep `aria-label`.

Hover preview (`src/shell/hoverPreview.ts`) and the `[[` suggester (`src/editor/wikilinkComplete.ts`) already matched the requested behavior, so their source and CSS stayed as they were. The preview opens with the note name as a large heading, an expand icon at the top right, a width of 450px, and a max height of 400px, so a short note is shorter than 400. The suggester lists recently opened notes first, includes attachments and unresolved targets, shows a parent folder as `Projects/`, uses a popup up to 520px wide, and keeps the three hint phrases on one line.

## How it was checked

Headless only. Scratch vaults under `/tmp`. Chris's vaults were not opened. No window was opened on the real screen.

Obsidian 1.14.4 was observed through its public API and the rendered DOM (Electron, empty `DISPLAY`, scratch `HOME`). The app package was not read. The ribbon tooltip was absent before 300 ms and present at 300 ms: class `tooltip`, no animation, 12px radius, beside the button. A right-edge view tooltip stayed under the button and was clamped to the viewport. A three-line hover preview measured about 452 by 170, with an expand control labelled "Open link". The `[[` popup was about 425px wide, listed attachments and folders as `Projects/`, listed unresolved names with an empty note subtitle, and put the three hint phrases on one line.

Grove checks, all from `rebuild/app`:

- `node scripts/test-r27c.mjs`: exit 0. Live, source, and reading, on notes that start with frontmatter. The ribbon tooltip is absent at about 180 ms and present by about 400 ms, beside the button. The toolbar tooltip is centred under "New note". Copy and Unfold use the styled tooltip and have no `title`. A short preview shows the note title at a large bold size, the expand icon, a height of 70–250, and a width of 400–460. A long preview stays at most 400px tall and its body scrolls. After opening Recent A, Recent Z, then the links note, the first three suggester rows are Links27c, RecentZ27c, RecentA27c. The list also includes `photo.png`, `diagram.svg`, `Uncreated27c`, and `Plan27c` with detail `Projects/`. The hint stays on one line inside the widened popup. Reading mode leaves the document unchanged and does not open the suggester.
- `npm test`: exit 0. Browser discovery: 4 passed. Vitest: 45 files, 257 tests. Geometry on `Geometry.md` and `GeometryFM.md` in live, source, and reading: every line within 1px, no vertical margins. The chain includes `test-r27c.mjs`. Canvas scripts rewrote screenshots and `rebuild/round24-shots/Grove-partb.canvas`; those files were restored with `git checkout` and are not in the commits.
- `npm run audit:offline`: exit 0. `tsc --noEmit`, Vite build, then the offline audit: 140 source files, `dist/`, CSP, capabilities, and dependencies.
- `git diff --check` was clean on the committed diff.
- Rust was not edited, so `cargo test` was not run.

## Net lines

Under `rebuild/app`, excluding generated files: 35186 to 35380.

| Bucket | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production TypeScript | 21031 | 21034 | +3 |
| Test TypeScript | 3289 | 3289 | 0 |
| CSS | 3925 | 3925 | 0 |
| Rust | 3211 | 3211 | 0 |
| Browser scripts | 3730 | 3921 | +191 |
| Total | 35186 | 35380 | +194 |

The production change is `dom.ts` (+3). The script change is the new `scripts/test-r27c.mjs` (191 lines). `package.json`, `fold.ts`, and `livePreview.ts` replace lines and add none.

## Skipped

Canvas sources and canvas CSS. `src/shell/sidebar.ts`, the status bar implementation, and the explorer drag payload. Unresolved suggester rows keep the target name and an empty subtitle, which is what Obsidian renders. The hint keeps its middot separators between the three phrases. `hoverPreview.ts` and `wikilinkComplete.ts` were not edited. `cargo test` was not run.
