# R2 P2a: incremental name, alias, and path maps

Builder: Claude (this worktree `~/workspaces/remote/grove-r2-p2a`, branch `rebuild/r2-p2a-claude`, from `rebuild/integration` d285b70). Codex reviews afterwards. Chris approved this invisible piece on Nov 18, 2026 at 8:09 AM PT.

Planner notes (read these, then design the rest yourself):
- Claude, “Quiet saves at 20k+ notes (RUST_PERF_PLAN P2)”, **P2a only**: `~/workspaces/remote/grove-r2-plans/grove-plan-claude.md` §5.
- `rebuild/RUST_PERF_PLAN.md` §4.2, the incremental-maps part only.
- Found on this commit: `Index::upsert_note` still calls the whole `rebuild_maps()` on every save (`src-tauri/src/index.rs`). S4 batched only the outside-change paths. Old bench numbers (re-measure if you cite them): `rebuild_maps` about 6.1 ms at 20k and 25.9 ms at 50k, under the write lock.

## What Chris wants

Saves on a large vault should not rebuild every name, alias, and path map. Update only the changed path in `upsert_note`, `relocate`, and `remove_tree`. Behavior is identical; this piece is invisible.

This is **P2a only**. Do **not** start P2b (index version, `changes_since`, link-index deltas, Vault applying deltas, `vault-changed` file entries, `Mutex` → `RwLock`, reverse link index, `write_notes`, or consumer patching). Those are a later piece.

## Direction

- Incremental name, alias, and path maps for the three mutation paths above.
- Keep the full `rebuild_maps` as the test oracle, with a shadow comparison in tests across random edit sequences (including rename and delete).
- `relocate`'s rename trap must stay covered (see `RUST_MIGRATION_PLAN` Step 2 / existing tests).
- Don't weaken S4 batching, S5 off-thread writes, or 8B/13/14/L1/9R behavior.
- Stay in Rust for this piece; no visible TS behavior change.

## Tests

Maps after upsert, relocate, and remove_tree match a full `rebuild_maps` on the same index, including aliases and path maps; random sequences of edit/rename/delete; the existing relocate rename trap; a cheap timing check at 20k notes if practical. Lookups stay correct when the file list is replaced or patched.

## Hard limits (every R2 piece)

- No new crates or packages. If this piece truly needs one, stop and say so in the notes; do not add it.
- No Obsidian or Excalidraw code or assets (build from observed behavior and Grove's own code). Cinder under this repo may be read for reference only.
- No network.
- Test vaults only under `/tmp`. Never touch `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`, `/tmp/grove-playground`, or `~/grove-compare-vault`.
- Don't open GUI windows. Don't launch Grove.
- No pushes. Commit to this branch only. Keep scratch files inside this worktree.
- Add tests. Run `cargo test --offline` in `rebuild/app/src-tauri` and the locked npm suite `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` (known timing flakes under load; rerun once before blaming your change). Restore any tracked screenshots the npm run rewrites (`rebuild/round*-shots`) so the commit holds only this piece.

## Done when

`cargo test --offline` and the locked npm test pass; write `rebuild/NOTES_R2_P2A-claude.md` (what changed, how the incremental maps stay correct, measurements if you took them, leftover gaps); commit locally on `rebuild/r2-p2a-claude`, then stop. Do not push.
