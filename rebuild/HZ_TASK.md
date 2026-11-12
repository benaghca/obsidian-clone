# Piece HZ: smooth frames on Cloud's 240 Hz screen

Builder: Claude (this worktree `~/workspaces/remote/grove-hz`, branch `rebuild/hz-claude`). Codex reviews afterwards.

## Problem
Grove is held at 60 fps on Cloud's 240 Hz NVIDIA monitor and stutters (about one dropped frame a second during scroll/pan), while Chromium apps run at 240. Fable's read-only diagnosis and fix plan is `rebuild/HZ_FABLE_DIAGNOSIS.md` (copy of `/tmp/grove-240hz-fable.md`). Background: `rebuild/WEBKIT_HZ_NOTES.md`, `rebuild/WEBKIT_PERF_NOTES.md`, old shim `rebuild/webkit-hz/vblankshim.c`. Read the diagnosis fully first; the design is yours.

## Build both
1. **Fix A2 (on by default):** an in-app frame-timing source in Grove's Rust side, used only when the driver refuses DRM vblank (WebKit falls back to its ~62.5 Hz integer-ms timer), so WebKit gets a steady 60 with no dropped frames and less delay. When vblank works it must stay out of the way. Users can switch it off with an environment variable (pick a clear `GROVE_...` name).
2. **Fix B (off by default, prototype):** pace GTK from the compositor's frame callback so Grove can reach up to the monitor's rate (240 on Cloud), behind an opt-in flag, e.g. `GROVE_FRAME_PACING=compositor`. With the flag unset, behaviour is exactly as after A2.

Fable's tidy note (canvas middle-drag calling `draw()` per pointer move instead of `schedule()`) is fine to include if it matters at 240 and causes no visible change.

## Limits
- No visible change to layout, shortcuts, look/theme or behaviour; only smoothness.
- Safe fallback: if anything in A2/B can't bind or initialise, log once and run exactly as today. Never crash, hang or spin.
- Keep CPU cost low: idle must stay idle (no constant ticking when nothing animates); measure or reason about it and note it.
- No new crates or npm packages (Fable says none are needed; if you find one is unavoidable, stop and say so in your notes).
- Do NOT change system config: no nvidia modprobe/`nvidia_drm vblank` change, no reboot, no Hyprland/driver config, no `LD_PRELOAD` shim. Don't file upstream reports.
- Don't launch Grove or open GUI windows on Cloud; no real vaults (test vaults under /tmp only). No network.
- Tests: `cargo test --offline` in `rebuild/app/src-tauri`, and the locked npm suite `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` (it has some known timing flakes under load; rerun once before blaming your change). Add unit tests for whatever logic is testable headlessly (env-flag parsing, fallback selection, timer pacing math).
- Write `rebuild/NOTES_HZ-claude.md`: what you built, the env vars, how Chris tries it (default steady 60, and the flag for 240), CPU/idle reasoning, and what you could not verify without a window.
- Commit locally on `rebuild/hz-claude`, then stop. Do not push.
