# 14: drop linear file-list scans in hot helpers (Fable finding 14)

Goal: Grove should stay snappy in very large vaults (20k+ files). Fable's review (finding 14) found about 16 call sites that scan the whole file list with vault.files.find/some/filter or vault.notes.some, for example src/vault.ts isFolder and touch (runs on every save), and src/workspace.ts restore/history checks that test every restored tab and history entry against every note. Some of this may already be fixed (S4 added a direct file-entry lookup), so check first.

Hard limits:
- No visible change at all: layout, look, shortcuts, behavior and ordering stay identical.
- No new crates or packages. No Obsidian code.
- Keep S1/S3/S4/S5/S9/8B behavior (save, flush, list patching, watcher batching) intact; any lookup structure must stay correct when the file list is replaced or patched in place.
- Test vaults under /tmp only. No GUI windows, no network.

Design is yours (Fable suggests one path-to-entry Map per file list). Add tests that prove lookups stay correct after list replace, patch, rename and delete, plus a simple timing check at 20k files if cheap.

Done when: cargo test --offline and the locked npm test (cd rebuild/app && flock /tmp/grove-npm-test.lock npm test) pass; restore any tracked screenshots the npm run rewrites; write rebuild/NOTES_14-grok.md (what changed, call sites touched, results); commit locally on rebuild/14-grok and stop. Do not push.
