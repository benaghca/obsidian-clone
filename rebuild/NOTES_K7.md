# K7 — Write fuzz and failure tests

Tests only, on `rebuild/kanban-k7-grok` from `rebuild/integration` `9fee64d`. No product bug turned up, so `set_property` and `editProperty` are unchanged. Nothing was pushed.

## What changed

| File | Lines | Role |
|---|---|---|
| `src-tauri/src/edit_fuzz.rs` (new) | +343 | Differential fuzz, crash injection, non-UTF-8, racing writer |
| `scripts/fuzz-property-edit.mjs` (new) | +283 | Fixed-seed generator and the TypeScript side |
| `src-tauri/src/fsutil.rs` | +59 | Test-only crash point inside `replace` |
| `src-tauri/src/lib.rs` | +2 | `#[cfg(test)] mod edit_fuzz` |
| `package.json` | +1 / −1 | `posttest` runs the short fuzz |

The crash point is `cfg(test)`. A release build does not compile it: `strings` on `target/release/libgrove_lib.rlib` and `target/release/grove` finds no `injected crash`. The write path in a release binary is the same as before this branch.

## Decisions

The fuzz seed is `0x6b37`. The default run is 48 cases: 26 fixed notes (BOM, CRLF, both quote styles, a quoted key, flow and block lists, a comment between properties, a comment inside a value, duplicate keys, number, checkbox, date, empty, missing, no frontmatter, no final newline, conflict, unchanged, remove, raw lines, and a 64 KB body) plus seeded random cases. `K7_FUZZ_CASES` adds more random cases. `K7_FUZZ_HUGE_BYTES` grows the huge note. A longer run of 2,000 cases passed.

Each case carries a body marker and, unless the edit is the missing-key case, a sibling `keep: same`. The script checks that a refused or conflicting edit leaves the text alone, that the marker survives once, and that the sibling line survives. `cargo test` runs the same script with `--json` and compares Rust `edit_property` on status, before, after, current, reason, and the full text. Non-UTF-8 cannot live in that JSON. A separate test writes `0xFF 0xFE` bytes, expects `Note is not UTF-8`, and checks the bytes are unchanged.

Crash and race tests use `rebuild/app/src-tauri/target/k7-scratch`, which is gitignored. On this machine that directory is btrfs. `/tmp` is tmpfs, so those tests refuse to run there. The hook fires once, on the calling thread:

- **Before rename.** The temp file is the complete new note. The note is still the old bytes. The sweep leaves the temp alone while its PID is this process, then removes it after the test renames it to PID `u32::MAX` (the same dead-process rule as vault open). A following `set_property` writes the new note and leaves no temp.
- **Before the folder sync.** The rename has already happened, so the note is the new bytes and there is no temp. The sweep removes nothing. `set_property` returns the error and does not claim the write succeeded. That matches K2: a directory-sync failure can land after the rename.

The racer thread replaces the note with two complete documents through `atomic_write`, and the test calls `set_property` only after each new replacement (20 overlapped edits). The file afterwards is one of those two documents or the edit of the original. A lost update in the stat-to-rename window (R5) is still one of those complete notes. This run overlapped 42 racer writes. No torn mix appeared, and no temp was left.

## Performance

P6 is the same ignored test as `NOTES_K2.md`: `cargo test --release --offline --lib set_property_bench -- --ignored`. It still uses that test's `/tmp` vault. Excluding fsync, which is the budget:

| | NOTES_K2 | K2 review, `/tmp` | This run |
|---|---|---|---|
| 10 KB median / max | 0.0619 / 0.2010 ms | 0.062–0.063 / 0.070–0.071 ms | 0.0626 / 0.0860 ms |
| 1 MB median / max | 2.9917 / 3.6409 ms | 3.10–3.26 / 3.43–3.68 ms | 3.1015 / 3.4029 ms |

Both medians are inside the 2 ms / 5 ms budgets. Wall time on this tmpfs was 0.0632 ms and 3.1021 ms, because fsync there is almost free. The K2 review's real-disk wall (about 7–15 ms) is the durable write on btrfs, not this harness. The crash and race tests are the ones that ran on btrfs.

`cargo test --offline` was 72 passed, 3 ignored (the previous 67 plus these 5), in 6 seconds including the compile. The tests themselves finished in 0.45 seconds. The 2,000-case fuzz finished in 0.11 seconds.

## Checks

First run, no flake, no retry.

- `npm run build`: passed. The existing Vite large-chunk warning remains.
- `npm run audit:offline`: passed, 177 source files, dist, CSP, capabilities, dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest 69 files / 1,222 tests. 2,049 PASS lines. Posttest printed `K7_FUZZ cases=48 seed=27447`. 300-card drag max 16.8 ms. 1,000-row scroll max 16.7 ms.
- `cargo build --offline` and `cargo test --offline`: 72 passed, 0 failed, 3 ignored. `cargo build --release --offline` passed, and the crash string is absent from that binary.

## Left open

The in-process crash temp keeps this process's PID, so the sweep will not delete it until the process is dead. The test renames that temp onto PID `u32::MAX` to exercise the open-time sweep. A real kill does not need that rename.

The racer uses whole-file renames. A writer that tears the note with a single non-atomic `write` can still leave a partial file. That partial file would be the other writer's, which is the R5 floor already in the plan.

No Obsidian page was fetched. Behaviour is KANBAN_PLAN §4.1–4.4, §4.7, the K7 row, and R3, plus `NOTES_K2.md` and `NOTES_KANBAN-K2-REVIEW.md`. No Obsidian code or assets were used.
