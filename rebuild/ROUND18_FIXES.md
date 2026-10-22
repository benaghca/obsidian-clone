# Round 18 stage 3 fixes

Branch: `rebuild/r18-codex`. Grok's `05b3f7e` was cherry-picked as `1304f7a` before fixes. Changes are local only.

1. **Ctrl release — `fa31ea4`:** Keep an open preview on the same link without the modifier; unmodified movement cannot open another target. Covered by Grok's `hoverPreview.test.ts` regression, the corrected outside-leave timing test, and a native pointer/Ctrl-release check.
2. **Heading/block underscroll — `fa31ea4`:** Scroll by the target's rectangle relative to the popup, in one coordinate system. `scripts/test-round18.mjs` checks both targets land 8–24px from the popup top.
3. **Sidebar previews covering rows — `fa31ea4`:** Place previews beside the owning dock and constrain their width to the available side space. The headless script verifies Search previews are right of the left dock and Backlinks previews left of the right dock.
4. **Tag drag selection — `63e1e4a`:** Let native selection start on mousedown; cancel the tag-search click after pointer movement. Native held-button drag tests verify a nonempty selection and unchanged query; existing plain-click and active-tag checks still pass.
5. **Second highlight selection — `5b20867`:** Carry original columns through rendered snippets and share `hitColumns` between Search and Backlinks, with first-match fallback. `mentions.test.ts` covers columns/fallback; real second-highlight clicks verify both panes select the second source range.
6. **Callout embed source — `0a9ed8f`:** Map the rendered callout body line back to its source embed line; keep handled inner presses from being claimed again. Native checks verify source reveal on the embed line and the Open link control still navigating.
7. **Long snippet tails — `5b20867`:** End the snippet at a word boundary within 60 characters after the last hit and add an ellipsis. `mentions.test.ts` checks bounded text and retained ranges; a real long-line Search result checks ellipses, text length and row height.
8. **Embedded Reading headings — `0a9ed8f`:** Apply Reading heading selectors to nested rendered headings too. Native checks verify embedded H1 is 31px with zero top padding in Reading and retains Live Preview typography in editing mode.

## Validation

All final required gates passed: `npm run build`, `npm test` (**198 tests, 38 files**), `npm run audit:offline`, `cargo build`, `cargo test` (**32 Rust tests**) and `git diff --check`.

`node scripts/test-round18.mjs` passed **43 browser assertions**, including all eight fixes and the prior Part B checks. It starts Vite and headless Chromium with a private profile, uses native CDP mouse moves followed by press/release (and held-button movement for drag), and uses only the in-memory mock vault. No DOM `.click()` calls, visible app windows, Tauri windows or real vaults were used. Its log remains ignored at `rebuild/app/node_modules/.round18-partb/stage3.log`.

No new dependency, production module, backend command or permission. The largest production TypeScript file is **649 lines**. No document work was added to ordinary typing.

## Net tracked app lines

Compared with accepted Part B (`16b14c8`), counting newline lines under `rebuild/app` and excluding `/gen/`, notes and screenshots. These counts include Grok's added regression test.

- TypeScript production: **19,091 → 19,121 (+30)**.
- TypeScript tests: **2,708 → 2,742 (+34)**.
- TypeScript total: **21,799 → 21,863 (+64)**.
- CSS: **3,698 → 3,698 (0)**; three selectors were widened.
- Rust: **3,104 → 3,104 (0)**.
- Brief's TS/CSS/Rust total: **28,601 → 28,665 (+64)**.
- JavaScript (`.mjs`, separate from the brief's total): **459 → 530 (+71)**, extending the headless regression harness.

Including JavaScript, stage 3 is **+135** app/test lines. Nothing was pushed or merged.
