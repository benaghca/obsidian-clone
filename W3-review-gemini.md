# W3 Review — Canvas Web Pages (`rebuild/w3-grok-c` @ `8a6ad80`)

VERDICT: OK-WITH-FIXES

Review branch: `rebuild/w3-review-gemini`
Author commit: `8a6ad80`
Review fix commit: `dfd0dca`

## Summary of Checks

1. **Plan & Feature Correctness (`src/canvas/linkFrame.ts`, `src/canvas/webFrames.ts`, `src/editor/webEmbed.ts`, `src/settings/`)**
   - Setting *Embedded web pages* (`webEmbeds` in `app.json`) supports `always` (default), `click` ("Click to load"), and `off` ("Off"), and imports Cinder's `webEmbeds` (`off` / `click` imported, `auto` / `always` recognized as Grove's default, unknown values reported in `notImported`).
   - Only strictly on-screen link cards above the title threshold (`!view.titles && card.width * view.scale >= 50 && card.height * view.scale >= 26`) are eligible for a frame slot, capped at 6 live frames (`WEB_FRAME_CAP = 6`).
   - Unselected link card frames have `pointer-events: none` (`.canvas-node:not(.is-selected) .canvas-web-frame`), so wheel zoom over an unselected frame still reaches the board; selecting the card enables pointer interaction.

2. **Network Isolation & W1 Lockdown (`src/editor/webEmbed.ts`, `scripts/browser.mjs`, `scripts/audit-offline.mjs`)**
   - Every iframe is configured with `sandbox="allow-scripts allow-same-origin allow-forms"`, `referrerpolicy="no-referrer"`, `loading="lazy"`, and no `allow` attribute.
   - `armWebFrame` validates `http(s)` origin form (no userinfo) via `webFrameTarget` and awaits `api.allowFrameOrigin(target.origin)` immediately before setting `frame.src`, re-checking `alive()` and `frame.isConnected` after the async IPC returns.
   - The address link in `.canvas-web-bar` has no `href` attribute and opens externally only on a trusted click/Enter via `api.openExternal`.
   - Browser tests use a local `127.0.0.1` loopback fixture (`frameFixture()` in `scripts/browser.mjs`) and block all non-app/non-fixture requests via CDP `Fetch.enable`.
   - W1 Rust lockdown (`src-tauri/src/lockdown.rs`, `tauri.conf.json`) and `npm run audit:offline` remain intact.

3. **Small Fixes Applied on `rebuild/w3-review-gemini` (`dfd0dca`)**
   - **Immediate frame unload on slot eviction (`src/canvas/bodies.ts`):** Previously, when a framed card lost its slot in `assignFrames` (e.g., panned into the overscan margin where it remained in `visible`, or entered title mode), its `release()` waited until its queued `body-show` / `body-hide` work slice ran—allowing new closer cards to mount iframes before far evicted cards unloaded theirs (temporarily exceeding 6 iframes) or leaving frames mounted until queued slices drained. `assignFrames` now immediately calls `release()` on any card removed from `frameOrder` before new slots mount.
   - **LRU eviction & Load button recovery in `Click to load` mode (`src/canvas/bodies.ts`, `src/canvas/linkFrame.ts`, `src/canvas/view.ts`):** Clicking `Load` on a 7th card when 6 frames were already live previously did not promote the clicked card into `frameOrder` and hid its `Load` button because `asked` stayed `true` while unslotted. `recheck(prefer)` now passes the clicked card id as the newest entry to `webFrameSlots` (evicting the oldest slot when at cap), and `linkFrame.ts` resets `asked = false` when a card is unslotted or released so the `Load` button remains available. Also added `Enter` / `Space` keyboard activation to the `Load`, `Reload`, and `Open` buttons.
   - **Unit test coverage (`src/canvas/bodies.test.ts`):** Extended the frame-cap test to verify `peak <= 6` at all times, test `recheck(prefer)` slot promotion/eviction at cap and from 0 frames, and verify immediate unload on title mode.

4. **Verification Runs**
   - `npm run build`: **passed**.
   - `flock /tmp/grove-npm-test.lock npm test`: **passed** (89 Vitest files / 1,420 tests + full browser and benchmark suite).
   - `npm run audit:offline`: **passed** (207 source files, `dist/`, CSP, capabilities, and dependencies).
   - `cargo test --offline` (in `src-tauri`): **105 passed, 0 failed, 4 ignored**.
   - Restored `rebuild/round*-shots/` after tests.
