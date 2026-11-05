# P0 — cheap hitch tests and dev meter

Branch: `rebuild/p0-codex`, based on integration `b5d0a34`.

## Changes

- Added `scripts/test-feel.mjs` to `npm test`, using the existing headless browser harness and a fixed 5,000-note synthetic mock vault. Checks typing (40 characters, including the delayed save refresh), quick switcher, six note switches, large-folder expansion, graph frames, and long tasks against RUST_PERF_PLAN §1. Reports measurements before failing on all budget misses. Checks the UI actually received each action and that performance observers are supported.
- Like the measuring script, caches the mock's initial link/backlink replies while retaining JSON parsing cost. This does not measure Rust commands, real IPC, or WebKitGTK. The 20k increase remains deferred until P1.
- Added a dev-only, opt-in rAF hitch meter. In devtools run `localStorage.setItem('grove.dev.hitchMeter', 'true')`, then reload. Disable with `localStorage.removeItem('grove.dev.hitchMeter')` and reload. Logs gaps strictly over 50 ms with the latest command ID or event type/target and its age; excludes background-tab gaps and typed text. There is no release-build loop. A deliberate 90 ms command in the headless test verifies reporting and cleanup before the budget measurements.
- P1/P2/B7 and graph fixes are outside this change. No dependencies, Rust changes, external network, GUI windows, or real vaults used. Git/npm lifecycle hooks are disabled; the required posttest script is invoked explicitly.

## Checks

- `npm --ignore-scripts run build`: passed (existing bundle-size warning).
- `npm --ignore-scripts run audit:offline`: passed.
- `node --check scripts/test-feel.mjs` and `git diff --check`: passed.
- Initial sandbox `npm --ignore-scripts test` failed in browser discovery; direct headless and explicit posttest attempts could not start the browser/server (unsettled top-level await). Unrestricted headless checks queued under `/tmp/grove-npm-test.lock`; final results below.

- Corrected an initial test-only readiness assertion: the mock adds generated notes to its sample notes, so the total is at least 5k, not exactly 5k.
- Final unrestricted `flock /tmp/grove-npm-test.lock npm --ignore-scripts test`: browser discovery/trace tests passed (6/6); the new hitch test completed, including its deliberate-hitch meter verification, and **failed on the existing graph frame budget**. At 5k: note switches 31–32 ms; typing max frame 16.8 ms, max Event Timing 16 ms, zero frames over 20 ms; switcher max frame 16.8 ms, max Event Timing 16 ms; folder expansion 1,674 rows, p95 16.7 ms, max 16.8 ms; graph p95 33.4 ms, max 50 ms, 43 frames over 20 ms. All measured phases had zero long tasks. The graph gate remains a real failure; no threshold relaxation or P4 work was done.
- Explicit, lock-serialized `posttest`: passed (exit 0), including property-edit fuzzing and Bases edge cases. Invoked directly with lifecycle hooks disabled because the intentional graph failure prevents npm from reaching it automatically.
- The rest of the pre-existing test command was also run separately under the lock, with only `test-feel.mjs` omitted to get past that known graph failure. The first wrapper attempt failed to find Vitest because it lacked npm's PATH; the final attempt includes `node_modules/.bin`.

- Final existing-suite run: **passed, exit 0**; Vitest **80 files / 1,282 tests passed**, followed by every original interaction script. This run excluded only the new, intentionally failing graph budget gate.
- Rust was unchanged, so no Cargo check was required by the gap plan's per-piece rule.
- Restored all tracked test-generated screenshot directories and their generated fixture/measurement files before committing. Existing unrelated untracked files were left alone. No push.

The release-app WebKitGTK check remains a manual check for Chris; no app windows were opened. The meter is ready for that check, but Chromium results do not establish WebKit performance.
