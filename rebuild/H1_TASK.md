# H1: Two small hardening fixes (no visible change)

From Fable 5.2's 10 Nov 2026 Grove review, "Smaller hardening". Grok 4.7 builds on `rebuild/h1-grok`; Codex reviews later, read-only. Commit locally. Never push.

## What to fix (paths relative to `rebuild/app/`)

1. `src-tauri/src/lockdown.rs` (~267-278): `is_app_url` accepts `http(s)://tauri.localhost` on every platform, though on Linux the app origin is `tauri://localhost`. A main-frame navigation to a local port-80 server could pass both guards. Accept that origin only where Tauri actually uses it (Windows), e.g. with a `cfg`. Check what the Tauri version in Cargo.lock really uses on each platform from vendored/registry source on disk (no network); write down what you found.
2. `src-tauri/tauri.conf.json` (~32): `img-src` and `media-src` still allow `asset:` and `http://asset.localhost` though the asset protocol is off. Remove them if nothing uses them (check images, embeds, drawings, canvas, attachments).

Design the rest yourself. Keep it the smallest correct change.

## Must hold

- Nothing visible changes on Linux: images, embeds, web-embed frames, drawings, canvas and attachments all still load exactly as before.
- Regression tests that fail before and pass after (Rust unit tests for `is_app_url` per platform; a check on the CSP string). Don't weaken existing assertions; the offline audit stays green.
- Do not edit `vault.rs`, `watch.rs`, `queue.rs`, `index.rs`, `lib.rs` (S3/S4/S5/S8/L1 own those) or any TypeScript outside tests.
- No new crates or packages. No network. No app or GUI windows. Test vaults only under `/tmp`; never touch real vaults, `/tmp/grove-playground` or `~/grove-compare-vault`. No Obsidian/Excalidraw code or assets.
- `cargo test --offline` in `src-tauri`, `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, `npm run audit:offline` pass. Restore screenshots the suite rewrites.
- Commit on `rebuild/h1-grok`, never push, don't commit `.x-*.txt` prompt files. Don't buy credits or change tool config.

## Notes

Write `rebuild/NOTES_H1-grok.md` (plain words: what got safer, proof nothing visible changed, tests failing before/passing after, net line change) and commit it with the code.
