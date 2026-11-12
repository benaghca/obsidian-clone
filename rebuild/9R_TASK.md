# 9R: stop superseded search scans in Rust (Fable finding 9, Rust half)

Goal: typing in Search on a 20k-note vault should never queue up stale work. Fable's review (finding 9) found that in src-tauri/src/lib.rs (search command, around lines 552-559 at the time) a superseded scan still runs to the end while holding the lock, so each keystroke's older scan delays the newer one. Fable suggests a generation counter so an older scan stops at the next note, plus a read/write lock instead of an exclusive one (finding 4). Some of this may already be done (finding 4 and the page half of 9 may have landed), so check the current code first and only do what is still missing.

Hard limits:
- No visible change: results, ordering, search syntax, timing as the user sees it (no debounce, no minimum length) stay identical. The newest query must always return its full, correct results.
- No new crates or packages. No Obsidian code.
- Don't weaken save/flush/watcher locking or data safety (S1/S3/S4/S5/S9/8B/13 behavior).
- Test vaults under /tmp only. No GUI windows, no network.

Design is yours. Add Rust tests proving an older search stops early once a newer one starts, the newest search returns complete results, and concurrent searches don't block saves; a cheap timing check at 20k notes if practical.

Done when: cargo test --offline and the locked npm test (cd rebuild/app && flock /tmp/grove-npm-test.lock npm test) pass; restore any tracked screenshots the npm run rewrites; write rebuild/NOTES_9R-grok.md (what changed, results); commit locally on rebuild/9r-grok and stop. Do not push.
