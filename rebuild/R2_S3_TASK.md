# R2 S3: say when a save keeps failing

Builder: Grok (worktree `~/workspaces/remote/grove-r2-s3`, branch `rebuild/r2-s3-grok`, from `rebuild/integration`). Codex reviews afterwards. Chris approved this on Nov 18, 2026 and chose "just a notice".

## The problem

When a note's save fails (permission denied, read-only mount, full disk, file locked, non-UTF-8 refusal), the existing retry/backoff in `noteEditors.ts` keeps trying silently. The user never learns their typing isn't on disk.

## Direction

- Show a plain notice through the existing notice system (`shell/notice.ts`) when a note's saves keep failing, e.g. "Couldn't save <Note>: <reason>. Grove will keep trying." Once per failure streak per note, not on every retry. A short follow-up notice when that note finally saves again is fine.
- Design the details (when a streak counts as failing, wording, throttling across many notes) yourself, keeping it calm and non-spammy.
- Don't change the retry, backoff, quit-flush order or any save semantics. This piece only adds the notice.

## Not approved (don't build)

No unsaved mark on tabs/status bar, no quit warning or keep-open prompt, no read-only mode for non-UTF-8 notes. Nothing else visible changes: layout, shortcuts, look and other behavior stay the same.

## Tests

Vitest for the notice logic (shown once per streak, cleared on success, throttled for many notes) and a headless check with a mocked failing save, as far as it goes without a window.

## Hard limits

- No new crates or packages. No Obsidian code or assets. No network.
- Test vaults only under `/tmp`. Never touch `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`, `/tmp/grove-playground`, or `~/grove-compare-vault`.
- Don't open GUI windows. Don't launch Grove.
- No pushes. Commit to this branch only. Keep scratch inside this worktree or /tmp.
- If `rebuild/app/node_modules` is missing, run `npm ci --offline` there (don't symlink another worktree's).
- Run `cargo test --offline` in `rebuild/app/src-tauri` if Rust changed, and the locked npm suite `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` (known timing flakes under load; rerun once before blaming your change). Restore any tracked screenshots the npm run rewrites (`rebuild/round*-shots`).

## Done when

Tests pass; write `rebuild/NOTES_R2_S3-grok.md` (what triggers the notice, wording, tests); commit locally on `rebuild/r2-s3-grok`, then stop. Do not push.
