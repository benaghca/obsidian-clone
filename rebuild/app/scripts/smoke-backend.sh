#!/usr/bin/env bash
# Headless smoke of the real vault commands (save, rename, watcher flush).
# MockRuntime opens no window. The vault is under the system temp directory.
# Not part of `npm test`. CI runs it inside `cargo test --offline`.
set -euo pipefail
cd "$(dirname "$0")/.."
exec cargo test --offline --manifest-path src-tauri/Cargo.toml --lib smoke:: -- --test-threads=1
