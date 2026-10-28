# Step 0.4: Fast Debug Builds (`NOTES_S0-4.md`)

## What Changed
- Added `[profile.dev.package."*"]` with `opt-level = 2` to `rebuild/app/src-tauri/Cargo.toml` so that dependencies (notably `serde_json` and `serde`) are compiled with optimizations during `tauri dev` / `cargo build`, while leaving Grove's own crate unoptimized for fast incremental debug builds.

## Files & Line Counts
- `rebuild/app/src-tauri/Cargo.toml`: +3 lines, -0 lines

## Build Times & Test Results
- **Cargo build times (`rebuild/app/src-tauri`)**:
  - **Before (`opt-level = 0` for deps)**:
    - Initial cold build of dependencies + crate: `32.84s` (user `3m01.7s`, sys `35.1s`)
    - Incremental build (`touch src/lib.rs && cargo build`): `1.16s`
    - `cargo test` (37 unit tests): `2.46s` compile, `0.05s` test execution
  - **After (`[profile.dev.package."*"] opt-level = 2`)**:
    - First build (recompiling dependencies at `opt-level = 2`): `1m 07s` (`67.22s` wall, user `14m03.2s`, sys `46.7s`)
    - Incremental build (`touch src/lib.rs && cargo build`): `2.14s`
    - `cargo test` (37 unit tests): `1.94s` compile, `0.05s` test execution
- **Full verification (`rebuild/app` & `rebuild/app/src-tauri`)**:
  - `npm run build`: Passed (`tsc --noEmit && vite build`, 265ms)
  - `npm run audit:offline`: Passed (164 source files, `dist/`, CSP, capabilities, and dependencies checked)
  - `npm test` (including `vitest`, geometry, fixes, header, drag, all round scripts, and `posttest` `test-bases-config.mjs`): Passed on first run (no flaky reruns needed; regenerated `rebuild/round*-shots/` test artifacts were restored with `git checkout -- rebuild/round*` to keep the tree clean)
  - `cargo build`: Passed
  - `cargo test`: Passed (37/37 tests)

## Uncertainties / Notes
- Step 0.2 (`bench.rs`) is running in parallel on another branch and is not yet present in this worktree, so the 5k-note `"#"` serialization drop (expected ~84 ms → a few ms in debug) could not be timed directly here; it can be verified once Step 0.2 and Step 0.4 are merged together.
- No open questions or decisions needed from Chris for this step.
