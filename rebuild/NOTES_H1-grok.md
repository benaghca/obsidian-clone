# H1: localhost origin and unused asset CSP sources

Two hardening fixes on `rebuild/h1-grok`. Nothing was pushed. No new crates or packages.

## What got safer

A main-frame navigation to `http://tauri.localhost` (port 80) or `https://tauri.localhost` (port 443) used to pass both navigation guards on every platform. On Linux that name is not the app. It is a normal local server, because `.localhost` resolves to the loopback address. `is_app_url` now accepts that host only where Tauri 2.12.4 actually serves the app that way.

`img-src` and `media-src`, in both `csp` and `devCsp`, no longer list `asset:` or `http://asset.localhost`. The asset protocol is not turned on, so those sources never loaded a Grove file. They only widened the policy.

## What Tauri 2.12.4 does

Checked from the crates already on disk. No network. `Cargo.lock` pins tauri 2.12.4, wry 0.57.0, and tauri-utils 2.10.2. The copies are under `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`.

`tauri-2.12.4/src/protocol/mod.rs`, `origin()`: on Windows and Android the custom protocol is `http://{scheme}.localhost`, or `https://` when `use_https` is set. Everywhere else, including Linux, macOS, and iOS, it is `{scheme}://localhost`. The `https` flag does not change that second form.

`tauri-2.12.4/src/manager/mod.rs`, test `check_get_url`, with the custom protocol on: Windows and Android get `http://tauri.localhost/` (or `https://tauri.localhost/` when https is requested). Every other target gets `tauri://localhost` for both.

wry 0.57 `src/custom_protocol_workaround.rs`: WebView2 and Android cannot rely on a registered custom scheme, so wry rewrites `tauri://localhost/...` to `http://tauri.localhost/...` (or `https://` if that webview asked for it). Linux, macOS, and iOS register `tauri` and keep `tauri://localhost`.

Grove's `tauri.conf.json` does not set `useHttpsScheme`, and wry's default is http. The URL a Windows build of Grove actually loads is `http://tauri.localhost`. Tauri's own `is_local_url` still treats both the http and the https form as the app on Windows and Android, because it picks the scheme from the URL it is asked about. The guard follows that: both schemes on those two targets, neither scheme anywhere else. The task named Windows. Android is in the same `cfg` because that is what `origin()` does, and refusing the name there would reject the real app origin.

`protocol-asset` is not a default tauri feature and Grove does not enable it. It is absent from `Cargo.lock`. The asset protocol is never registered.

## Proof nothing visible changed

On Linux the page was already `tauri://localhost` in a release build and `http://localhost:1420` in dev. Refusing `http(s)://tauri.localhost` only blocks a navigation that was never Grove.

Images, embeds, canvas cards, drawings, and attachments do not use the asset protocol. They are `blob:` URLs from `readFileBytes` / `URL.createObjectURL`, or `data:` URLs (drawing bytes and the SVG masks in CSS). Web-embed frames use `frame-src`, which is still `https:` and `http:` and was not edited. `connect-src` still allows `ipc:` and `http://ipc.localhost`. `img-src` is still `'self' data: blob:`. `media-src` is still `'self' blob:`.

`npm test` loads those surfaces in a browser and passed. `npm run build` and `npm run audit:offline` passed. The audit still allows those asset tokens if someone adds them back; this change only removes them from the policy.

## Tests

Before the fix, on Linux, three tests failed:

- `http_tauri_localhost_is_app_only_on_the_workaround_targets`: `is_app_url("http://tauri.localhost/")` was true; the test requires false off Windows and Android.
- `release_builds_allow_only_the_app_origin`: same mismatch. The old unconditional "this is the app" asserts are now equal to that same `cfg`. On Windows they are still required to be true. The refusals (look-alike host, `file:`, `mailto:`, `about:srcdoc`, and the rest) are unchanged.
- `csp_does_not_allow_the_unused_asset_protocol`: `img-src` was `'self' data: blob: asset: http://asset.localhost`.

After the fix, `cargo test --offline` in `src-tauri` passed: 117 passed, 0 failed, 4 ignored. `flock /tmp/grove-npm-test.lock npm test` passed. Screenshots and fixture files the suite rewrote were restored and are not in the commit.

`ipc_origin_allowed` is unchanged. It is the model of which URL Tauri will run an IPC command from, not a navigation guard, and its existing asserts still stand.

## Net line change

Code, not counting this note: 92 lines added, 12 removed, net +80. `lockdown.rs` is +88 / −8. `tauri.conf.json` is +4 / −4.
