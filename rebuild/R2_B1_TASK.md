# R2 B1: embedded base column fit-to-width uses row text

Builder: Grok (this worktree `~/workspaces/remote/grove-r2-b1`, branch `rebuild/r2-b1-grok`, from `rebuild/integration`). Codex reviews afterwards. Chris reported this bug on Nov 19, 2026 and approved the fix.

## The bug

In an EMBEDDED base (a `.base` shown inside a note), double-clicking a column separator in the header ("fit to width") sizes the column only to the header text, not to the words in the rows. It should autofit the column to its widest content, cell text included, like Obsidian does.

## Direction

- Find why the embedded view measures only the header. Check whether standalone `.base` views have the same bug; fix both, sharing one measuring path if that is the simplest correct fix.
- Fit = widest of header and every visible/rendered cell in that column (sensible padding, existing min/max width rules kept). Keep it fast on large bases (no layout thrash per row; measure smartly).
- Keep whatever persistence the manual column resize already uses (the fitted width should save/restore the same way a dragged width does). Don't write to the base file in any new way.
- Nothing else visible changes: layout, shortcuts, look and other base behavior stay the same.

## Tests

A regression test that fails before the fix: an embedded base with a short header and long cell text fits wider than the header alone; same for a standalone base. Headless tests as far as they go without a window.

## Hard limits

- No new crates or packages. No Obsidian code or assets. No network.
- Test vaults only under `/tmp`. Never touch `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`, `/tmp/grove-playground`, or `~/grove-compare-vault`.
- Don't open GUI windows. Don't launch Grove.
- No pushes. Commit to this branch only. Keep scratch inside this worktree.
- Run `cargo test --offline` in `rebuild/app/src-tauri` (if Rust changed) and the locked npm suite `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` (known timing flakes under load; rerun once before blaming your change). Restore any tracked screenshots the npm run rewrites (`rebuild/round*-shots`).

## Done when

Tests pass; write `rebuild/NOTES_R2_B1-grok.md` (cause, fix, whether standalone had it, tests); commit locally on `rebuild/r2-b1-grok`, then stop. Do not push.
