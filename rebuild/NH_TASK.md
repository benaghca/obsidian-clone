# Piece NH: nested hover previews (approved behavior change)

Builder: Claude (this worktree `~/workspaces/remote/grove-nh`, branch `rebuild/nh-claude`, from integration 9203860). Codex reviews afterwards.

## What Chris wants
In Obsidian, Ctrl+hovering a link inside a hover preview opens another preview, with no depth limit, so you can keep chaining. In Grove only the first preview works; Ctrl+hovering a link inside that preview shows nothing. Make hover previews nest the same way: every preview's links (wikilinks, markdown links, embeds that already preview today) can open their own preview, stacked on top, with parent previews staying open while the pointer is inside a child, and the chain closing sensibly when the pointer leaves (leaving a child back into its parent closes just that child and deeper ones; leaving the whole chain closes it all after the usual delay). Chris approved this change on Nov 11, 2026.

Find out first why it fails today (e.g. the preview body isn't wired to the hover handler, a single global preview slot, a close-on-any-mouseout rule) and fix it with the least new code by reusing the existing preview. The design is yours.

## Limits
- Keep Grove's existing preview look, size, delay, positioning style and Ctrl behavior otherwise; only nesting is new. No other visible change to layout, shortcuts, look/theme.
- Snappy and safe: no flicker, no stuck/orphaned previews, no leaked listeners or DOM nodes after close, no lag while hovering around. Deep chains (e.g. 10+) must stay cheap. Escape / clicking a link / scrolling should behave as they do today, applied sensibly to the whole chain.
- No Obsidian code or assets (build from observed behavior). No new crates or npm packages. No network.
- Don't launch Grove or open GUI windows on Cloud; no real vaults (test vaults under /tmp only).
- Tests: add tests for nested opening (preview inside preview, depth 3+), closing rules (leave child into parent, leave chain, Escape), no leaked previews after close, and that the single-level behavior is unchanged. Run `cargo test --offline` in `rebuild/app/src-tauri` and the locked npm suite `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` (known timing flakes under load; rerun once before blaming your change). Restore tracked screenshots the npm run rewrites (round*-shots) so the commit holds only this piece.
- Write `rebuild/NOTES_NH-claude.md`: what was wrong, what you changed, how it closes, what you tested.
- Commit locally on `rebuild/nh-claude`, then stop. Do not push.
