# I1 — native clipboard image, raw attachment write

Branch `rebuild/i1-grok-b` from `b5d0a34` (`rebuild/integration`). Local commit only. Cinder at the repo root was read and not edited.

## What I built

`read_clipboard_image` is an async command (`allow-read-clipboard-image`). It does not need a vault. On Linux it uses only `std::process`:

- Wayland (`WAYLAND_DISPLAY` set): `wl-paste --list-types`, then `wl-paste --no-newline --type <mime>`.
- Otherwise X11: `xclip -selection clipboard -t TARGETS -o`, then `xclip -selection clipboard -o -t <mime>`.

The mime is the first exact line among `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/bmp`. PNG wins when both PNG and JPEG are offered. The argument is that fixed string, not the clipboard line. A missing tool is `install wl-clipboard to paste images` or `install xclip to paste images`. Any other failure to start the tool is `{program}: {error}`. No image is JSON `null`. An image is a raw body: the mime, one `\n`, then the bytes. Split on the first newline only. The read stops at 20 MB (`too large to paste`) and does not return those bytes. A type list over 64 KB is `clipboard type list is too large`. macOS and Windows return `null`; those webviews hand the image to the page.

`write_file_bytes` is now `#[tauri::command(async)]`. The body is raw bytes (`tauri::ipc::Request`), not a JSON array of numbers. The vault-relative path is the `x-grove-path` header, percent-encoded (`/` and `A-Za-z0-9-._~` left as themselves, other bytes as uppercase `%HH`, space as `%20`). A JSON body is `write_file_bytes expects a raw body, not JSON`. The vault checks, the 20 MB cap, the no-overwrite rule, and the `vault-changed` create to other windows are unchanged.

`rebuild/CONTRACT.md` describes both. `src/api.ts` still sends `{ path, bytes: number[] }`. That call fails on the desktop command until the front end switches to the raw invoke in the contract. The browser mock can keep the old object until the same change. I2 owns that call, the paste handler, and the canvas image card. This piece does not edit `rebuild/app/src/`.

## Checks

From `rebuild/app/src-tauri`:

`cargo test --offline --lib` — 97 passed, 0 failed, 4 ignored. The ignored tests were already ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`). Index and search code were not changed, so those benches were not re-run.

The I1 tests in that run:

| Check | Test | Result |
|---|---|---|
| Type picking | `prefers_png_then_the_other_image_types`, plus the Wayland and X11 argument tests | passed |
| Missing tool | `a_missing_tool_is_a_clear_error` (the install strings) and `a_program_that_is_not_installed_is_missing` (a real `std::process` spawn of a path that is not there) | passed |
| Size cap | `an_oversized_image_or_type_list_is_refused`; `spawn_capture_stops_a_stream_past_the_cap` (`dd if=/dev/zero`, cap 1024, killed, no bytes returned) | passed |
| Capability | `every_command_is_in_build_manifest_and_default_capability` (`read_clipboard_image` is in `generate_handler!`, `build.rs`, and `allow-read-clipboard-image`) | passed |
| 10 MB off the caller thread | `write_10mb_stays_off_the_calling_thread` | passed |

The 10 MB bench is the debug test profile, writing `ten.bin` under `/tmp` through `Vault::write_file_bytes` inside `tauri::async_runtime::spawn`. That is the same spawn `#[tauri::command(async)]` uses, so the body is not on the thread that received the IPC (the GTK thread in the app). The writer thread id was not the caller. `write_10mb_ms=4.4`. The file was 10,485,760 bytes. The command attribute is also asserted in that test.

## Limits

A clipboard owner that never answers blocks one async worker until the tool exits. There is no timeout. It does not run on the GTK thread. A `write_file_bytes` of a large file blocks one async worker for the write, which is the point of taking it off the main thread. The postMessage IPC fallback (used if the custom-protocol IPC fails) cannot send a raw body; the command then returns the JSON error. Linux WebKit uses the custom protocol, which sends the `Uint8Array` as the request body.
