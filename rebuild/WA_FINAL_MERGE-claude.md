# Wave A final merge prep (Claude)

Branch: `rebuild/wa-final-merge-claude`, from `rebuild/integration` 37d5c77
(already had X1, BX1, M0a, WK1, T1, I1, I2, P0, X2). Not pushed.

## Merges (all `--no-ff`, in order)

| # | Branch | Head | Merge commit |
|---|--------|------|--------------|
| 1 | `rebuild/t2-merge-grok-a` (T2 templates insert) | 39873c4 | 1b7a98a |
| 2 | `rebuild/m0b-merge-grok-c` (M0b settings import) | d6bfe77 | 13ada39 |
| 3 | `rebuild/c2-merge-claude` (C1 daily notes + C2 calendar) | fee9646 | c61bba2 |

## Conflicts and resolutions

The only conflict in each merge was the `"test"` script in `rebuild/app/package.json`.
I resolved each one as an ordered union of the two `&&`-separated lists. Nothing was
dropped or reordered. Each new entry went in after the entry that comes before it on
its own branch:

1. **T2**: HEAD had `test-drawing.mjs` (from X2) at the end. T2 added
   `test-template-create.mjs` after `test-template-merge.mjs`. Both kept.
2. **M0b**: added `test-settings-import.mjs`. All entries already on HEAD kept.
3. **C2**: added `test-calendar.mjs` and `test-daily-notes.mjs`. All entries already on HEAD kept.

After the merges I checked that every `test` and `posttest` entry from 37d5c77 and from
each of the three branch heads is in the final `package.json`. None are missing. Git
auto-merged the other overlapping files without conflict: `src/shell/pane.ts` (T2),
`src/main.ts` (M0b, C2), `src/appCommands.ts` (C2) and `src/settings/plugins.ts` (C2).
No conflict markers remain in the tree. No packages or crates were added.

## Checks (in `rebuild/app`, on c61bba2)

- `npm run build`: pass (tsc + vite. The only warning is the existing chunk-size warning.)
- `flock /tmp/grove-npm-test.lock npm test`: pass, exit 0, first attempt, no retries.
  Vitest: 87 files, 1414 tests passed. All node test scripts passed, including the new
  `test-template-create`, `test-settings-import`, `test-calendar` and `test-daily-notes`.
  The `posttest` bases suite also passed.
- `npm run audit:offline`: pass ("Offline audit passed: 204 source files, dist/, CSP,
  capabilities and dependencies checked.")
- `cargo test --offline` (src-tauri): pass. 102 passed, 0 failed, 4 ignored.
- `rebuild/round*-shots/`: unchanged after the merges. The tests regenerated them, and I
  restored them to HEAD afterwards. The working tree is clean apart from pre-existing
  untracked files.

VERDICT: READY
