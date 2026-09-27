#!/usr/bin/env bash
# Cinder's responsiveness benchmarks, run in WebKitGTK (the engine of the Linux app) against a
# generated 3,000-note vault. Needs cargo, Python 3 with PyGObject and WebKit2GTK 4.1. Opens a window.
#
#   ui/test/perf/run.sh                 every benchmark
#   ui/test/perf/run.sh actions graph   just those (actions, search-tabs, graph, scroll, save)
#
# Each line is one measurement in milliseconds: median and worst of several runs, each timed to the
# next painted frame (so ~17ms is "within one frame" at 60 Hz).
set -u
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd)
WORK=${CINDER_PERF_WORK:-$(mktemp -d -t cinder-perf-XXXXXX)}
[ -d "$WORK/vault" ] || python3 "$HERE/make-vault.py" "$WORK/vault"
cargo build --release --manifest-path "$ROOT/Cargo.toml" -q || exit 1
mkdir -p "$WORK/xdg"
XDG_DATA_HOME="$WORK/xdg" "$ROOT/target/release/cinder" "$WORK/vault" --browser --port 43399 --no-open >"$WORK/server.log" 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT; sleep 2
if [ $# -gt 0 ]; then SUITES=("$@"); else SUITES=(actions search-tabs graph scroll save); fi
for s in "${SUITES[@]}"; do
  echo "== $s"
  python3 "$HERE/webkit.py" http://127.0.0.1:43399/ "$HERE/$s.js" 2>/dev/null | grep -v '^DONE$'
done
