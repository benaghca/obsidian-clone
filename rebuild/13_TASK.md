# 13: batch outside-change re-reads (Fable finding 13)

Goal: when files change outside Grove (git pull, sync, another editor), Grove should refresh once per batch instead of re-reading everything several times. Fable's review (finding 13) found src/vault.ts (around the outside-change event handlers) reacts to one backend event per kind per batch, and each one makes the page call list_files and link_index again and reload changed paths one at a time. Stale replies are dropped, but Rust still does the work under the lock. Fable suggests queuing events and refreshing once per frame. S9 (watcher batching) and S4/8B/14 may already cover part of this, so check first and fix only what's left.

Hard limits:
- No visible change: layout, look, shortcuts and behavior stay identical. Outside edits must still show up promptly and correctly, including in open editors, and never overwrite unsaved local edits (keep S1/S3/S5/S9/8B save and conflict behavior intact).
- No new crates or packages. No Obsidian code.
- Piece 14 (rebuild/14-grok, in review) also edits src/vault.ts to add path lookups; keep your change small and focused so the two merge cleanly.
- Test vaults under /tmp only. No GUI windows, no network.

Design is yours. Add tests that prove a burst of mixed outside events (create, modify, delete, rename) causes one refresh and ends in the right state, and that an event arriving mid-refresh is not lost.

Done when: cargo test --offline and the locked npm test (cd rebuild/app && flock /tmp/grove-npm-test.lock npm test) pass; restore any tracked screenshots the npm run rewrites; write rebuild/NOTES_13-claude.md (what was already fixed, what changed, results); commit locally on rebuild/13-claude and stop. Do not push.
