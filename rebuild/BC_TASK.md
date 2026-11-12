# BC: Bases on Canvas

Chris asked for this on 11 Nov 2026 and approved it as a behavior change. Grok builds on `rebuild/bc-grok` in `~/workspaces/remote/grove-bc` (base: integration 9203860); Codex reviews later, read-only. Commit locally. Never push.

## In plain words

Bases (`.base` files) can't be added to a Canvas today. Make them addable the same ways notes and files are: dragging from the file list, the canvas add-file / "add note from vault" picker, and any embed path the canvas already supports. The card should show the Base's view live inside it (like Obsidian does), with the usual card resize and move. Everything else about the canvas looks and behaves the same.

## Approach

First find out why it fails today (a filtered file type, a missing renderer, a picker filter, etc.), then fix it with the least new code by reusing the existing Bases view (`src/bases/`) inside the canvas card. Design the rest yourself.

## Hard limits

- No other visible change: canvas look, layout, shortcuts and behavior stay as today. No Obsidian code or assets.
- The `.canvas` file format stays compatible (a Base card is saved as a normal file node pointing at the `.base` path) and must round-trip through save and reload.
- No lag on big boards: a Base card off screen must not keep doing work; reuse the canvas's existing lazy-load/visibility handling.
- Data safety: don't weaken S1's save/flush/seal behavior or S5's write ordering; editing a Base inside a card must save through the normal Bases path.
- No new crates/packages. No network. Test vaults under /tmp only.
- Tests: adding a Base by each supported path, saving and reloading the .canvas file, and rendering the view in the card (and not rendering off screen).
- Run `cargo test --offline` and the locked npm suite (`flock /tmp/grove-npm-test.lock npm test`). Restore any screenshot dirt under rebuild/round*-shots; don't commit it.
- Write notes to `rebuild/NOTES_BC-grok.md` (cause found, what changed, test results).
