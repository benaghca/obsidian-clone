# 8B: File-list half of the new-note / rename hitch

From Fable 5.2's 10 Nov 2026 read-only review of Grove (finding 8). S7 already took the sidebar half (buildTree depth sort, row rebuild) and S4 the Rust name-map rebuilds. This piece takes the rest, which was held back until S1 merged because S1 was editing the same files. S1 is now merged (base 9203860). Grok builds on `rebuild/8b-grok` in `~/workspaces/remote/grove-8b`; Codex reviews later, read-only. Commit locally. Never push.

## In plain words

Creating or moving a note still hitches because the page gets the new entry back from Rust and then re-reads the whole file list anyway, and that one event fans out to every pane and drops the link-target and tag caches. Make new note, rename and move cheaper. Nothing the user sees may change.

## Problem (paths relative to `rebuild/app/`, line numbers from Fable's review, may have moved)

- `src/fileOps.ts` (createNote, ~:31-38): gets the new FileEntry back, then re-reads the whole file list.
- `src/workspace.ts` (~:667-679): same after a move/rename.
- `src/main.ts` (~:269): the file-list change dispatches to every pane and drops the link-target and tag caches.

Fable's suggested fix: patch the file list from the returned entry (keep a new array so identity-keyed caches still reset correctly). Design the rest yourself, including whether the main.ts fan-out / cache drop can be narrowed safely.

## Hard limits

- No visible change: layout, shortcuts, look/theme, ordering, links, sidebar, selection behave exactly as today.
- Data safety first: must not weaken S1's close/quit flush, save retry, vault-switch sealing, or S5's write ordering. The file list must never end up stale or wrong versus disk (outside edits and the watcher still win; a failed create/rename must not leave a phantom entry).
- No new crates/packages. No network. Test vaults under /tmp only.
- Add regressions that fail before and pass after where practical, plus a timing check if there is an existing friction harness.
- Run `cargo test --offline` and the locked npm suite (`flock /tmp/grove-npm-test.lock npm test`). Restore any screenshot dirt under rebuild/round*-shots; don't commit it.
- Write notes to `rebuild/NOTES_8B-grok.md` (what changed, measured before/after if you can, test results).
