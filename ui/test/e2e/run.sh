#!/usr/bin/env bash
# Cinder's browser tests. Each suite drives the real app (browser mode, 127.0.0.1:43199) in headless
# Chromium, with a fresh vault and a fresh data folder.
#
#   ui/test/e2e/run.sh                 every suite (about ten minutes)
#   ui/test/e2e/run.sh tasks search    just those
#
# Once, in this folder:  npm install && npx playwright-core install chromium
# Also needs cargo and Node 18+; Python 3 serves the test web pages on port 43200.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
WORK=${CINDER_E2E_WORK:-$(mktemp -d -t cinder-e2e-XXXXXX)}
cargo build --manifest-path "$ROOT/Cargo.toml" -q || exit 1
BIN="$ROOT/target/debug/cinder"
up() { (exec 3<>/dev/tcp/127.0.0.1/43199) 2>/dev/null; }
if up; then echo "Something is already listening on 127.0.0.1:43199; stop it first." >&2; exit 1; fi
mkdir -p "$WORK/shots"
python3 -m http.server 43200 --bind 127.0.0.1 --directory "$HERE/fixtures/web" >/dev/null 2>&1 &
WEB=$!
SRV=
trap 'kill $WEB $SRV 2>/dev/null' EXIT
if [ $# -gt 0 ]; then SUITES=("$@"); else SUITES=($(cd "$HERE" && ls *.js | sed 's/\.js$//')); fi
fail=0
for t in "${SUITES[@]}"; do
  rm -rf "$WORK/vault" "$WORK/xdg"; mkdir -p "$WORK/vault" "$WORK/xdg"
  CINDER_HISTORY_SESSION_MS=1500 CINDER_FOLDER_PICKER=none CINDER_SCREENSHOT_CMD="cat $HERE/fixtures/pic.png" XDG_DATA_HOME="$WORK/xdg" \
    "$BIN" "$WORK/vault" --browser --port 43199 --no-open >"$WORK/server.log" 2>&1 &
  SRV=$!
  for _ in $(seq 50); do up && break; sleep 0.1; done
  out=$(cd "$HERE" && SP="$WORK" timeout 240 node "$t.js" 2>&1); code=$?
  kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
  n=$(grep -c '✓' <<<"$out")
  if [ $code -ne 0 ] || grep -qE '^ASSERT|pageerror' <<<"$out"; then
    fail=1; echo "✗ $t ($n passed before it failed)"; grep -E 'ASSERT|Error|Timeout|pageerror' <<<"$out" | head -3 | sed 's/^/    /'
  else echo "✓ $t ($n checks)"; fi
done
echo "Screenshots are in $WORK/shots"
exit $fail
