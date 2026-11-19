# R2 M: open PDFs, audio, and video as those files

On `rebuild/r2-m-grok`. Nothing was pushed. No new crates or packages.

## Cause

`Workspace.open` sent images, `.canvas`, `.base`, and `.excalidraw` to their own views. A `.pdf`, `.mp3`, or `.mp4` fell through to `editors.load`, which calls `read_note`. That path uses `from_utf8_lossy`, so the binary showed up as a note full of replacement characters. `write_note` then refused it with "Note is not UTF-8", and S1's `scheduleRetry` kept trying. A tab whose `path` is null never creates editor state, so a media or PDF view does not arm that retry. Note save, CRLF/BOM, and own-write stamps for real notes are unchanged.

## What changed

Audio, video, and PDF open as views (`audio`, `video`, `pdf`) with `path` null and `viewFile` set. History travel and a saved layout do the same, including an older layout that stored the file path with no type. `editors.load` is not called, so no note save is scheduled.

`read_file_bytes` still does the vault path checks. Images stay extension-only and are not sniffed. Audio, video, and PDF (`mp3`, `m4a`, `aac`, `wav`, `ogg`, `oga`, `opus`, `flac`, `mp4`, `m4v`, `mov`, `webm`, `ogv`, `pdf`) must also match the header in `src/media.ts`. A script, HTML (including a UTF-8 BOM and leading spaces), an empty file, or the wrong container (`webm` bytes in `.mp4`, AVI in `.wav`) is `not a media file`. The mock backend uses the same check.

A note embed `![[clip.mp3]]` or `![alt](clip.mp3)` (hash stripped, alias size kept) is a player with controls, `preload="metadata"`, and no autoplay. `![[a.pdf]]` and `![x](a.pdf)` are the same unsandboxed PDF iframe as the pane: the frame is attached only after the sniffed bytes succeed, and it is not focused. A script such as `![[run.sh]]` stays a link. A canvas card of one of these files still says "Unsupported file".

Closing a pane pauses the player, clears the iframe, and releases both blob holders, including when the read finishes after the pane is gone. The pane also watches the path, as the embed does. An outside replacement drops the old bytes and reads again, so a failure is replaced when a valid file arrives. The same reload puts a player or PDF frame back after a failed read. A create, remove, or rename of that audio, video, or PDF path does this once per disk batch, including a remove and a later create in two batches. The file-list install and that path signal are one reload, not two reads. A folder event that does not name the file still drops the holder when the installed file list no longer matches the path being watched. A modify stays on the existing modified signal and reloads the holder then. A later file-list install that only catches that version up does not reload it again, and only when the watched file's ancestors still have the versions from that read. A folder swapped into the same name still reloads. That catch-up is remembered only while a watcher is active. A later modify still does, and so does a list install that drops the file. Note reloads are unchanged. Closing the last watcher for a path drops it, so later file-list installs do not scan it.

## How PDFs are shown

This machine's WebKitGTK is 2.54.1 (`libwebkit2gtk-4.1`). Its binary contains `webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=`, so the built-in PDF.js viewer needs no new package. The pane and a note embed read the file, register that `blob:` URL, then set an unsandboxed iframe `src` to it (`application/pdf`). The iframe is attached only after that read succeeds, and it is not focused. A sandbox would block the viewer. WebKit then navigates the frame to its viewer with that blob as `file`. The page does not load `pdf.js` itself. `script-src` stays `'self'`. There is no "open in default app" control.

Inline PDF in a note uses that same iframe. It stays inside the limits: no new package, the existing CSP and viewer scheme, and no extra chrome beyond the embed and the edit button the audio and video embeds already have.

## Size cap

The cap is the existing `IMAGE_MAX_BYTES`, 20 MB. The length is checked on metadata before the body is read, and again if the file grew during the read. Over the cap, the command returns `too large to show` and the view says "Too large to show." There is no player and no iframe. A longer video is not streamed in this piece.

On Unix the open uses that target's `O_NONBLOCK`, then `fstat` on that descriptor. The value is `0x800` on Linux (mips `128`, sparc `0x4000`), and `0x4` on macOS and the BSDs. Android matches Linux. A FIFO, or any other non-regular file, returns `no such file` instead of blocking the vault read lock. A regular file ignores the flag. The type check is on the opened descriptor, so a replacement during the open is still refused. Windows has no POSIX FIFO and opens normally. An unknown Unix target does not compile. `read_note` is unchanged.

A read that fails for any other reason says "This file can't be shown." A PDF says "This PDF can't be shown." A player that cannot decode the bytes says "This file can't be played here."

## CSP

`media-src` was already `'self' blob:`. Audio and video elements are subresources, so they do not go through the navigation guard.

`frame-src` in both `csp` and `devCsp` is `https: http: blob: webkit-pdfjs-viewer:`. `object-src` stays `'none'`, `child-src` stays `'none'`, and `script-src` stays `'self'`. The asset protocol stays off.

`on_navigation` still passes `Unknown`. It does not allow every blob URL. A blob navigation, and `webkit-pdfjs-viewer://pdfjs/web/viewer.html`, are allowed only when every blob is one the page registered with `allow_pdf_blob` and this window has connected its Linux response-policy hook. That hook sets the window's flag only after `connect_decide_policy` is installed. If `with_webview` does not run the closure, the flag stays false and the PDF frame is refused. Non-Linux builds do not install the hook, so they refuse the blob and the viewer too. The main frame still refuses both, including through `main_frame_document_allowed`. `file:`, `javascript:`, and `data:` stay refused. A viewer URL with no `file`, a non-blob `file`, another path (the viewer's `content-script.js`), another host, or userinfo is refused.

The page registers the blob only after a sniffed PDF read, and awaits that before the iframe `src` is set. `allow_pdf_blob` refuses, and does not record the blob, when the calling window's flag is still false. The pane and the embed then show "This PDF can't be shown in this window." and do not attach the iframe. The navigation rule is unchanged. The last holder clears `src`, then `release_pdf_blob`, then revokes the URL. Audio and video blobs are not registered. A note cannot mint a blob URL, and the vault bytes are not page script. The residual is that the trusted page can register a blob URL it created once this window's hook is connected. Each window has its own main-frame flag, so one window's hook does not enable PDF frames in a window whose hook failed. A closed window drops its flag.

## Tests

`cargo test --offline` in `rebuild/app/src-tauri` after the second review: 207 passed, 0 failed, 5 ignored (lib), plus main 0 and doc 0. That includes the media header and size-cap reads, the FIFO open returning `no such file`, the non-blocking flag for this target, a window without the viewer hook not registering a PDF blob, the image reads, and the navigation-guard table (a registered PDF blob only while this window's top-level deny is on). The scheme in the guard matches the URL strings in this machine's `libwebkit2gtk-4.1.so.0`. Two pre-existing `dead_code` warnings in `index/file_map.rs` remain.

`flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` exited 0 in 1044s. Vitest: 113 files, 1704 tests. Cold open 29.5 ms, `DRAWING_EDIT_LONG []`, 10,000-row scroll max 16.8 ms.

Headless checks cover the sniff, the cap, opening without `read_note`, layout restore, the audio, video, and PDF embed widget types, the FIFO open returning, and the guard table (a registered PDF blob only while the top-level deny is on; `Unknown` refuses it before that). Vitest runs in node and does not build the player or the iframe. Closing a pane and the outside-replacement reload are in the pane code; node tests do not construct that DOM.

Codex review 1 (PASS-WITH-FIXES on `e146989`): the pane now releases media and PDF holders on dispose; Linux opens the byte read without blocking on a FIFO; PDF navigations are limited to registered blobs after the main-frame hook; a note embed shows the PDF with the same iframe; the open pane reloads when the file changes.

Codex review 2 (PASS-WITH-FIXES on `bf891eb`): a window whose viewer hook is off refuses `allow_pdf_blob` and the page shows a fallback instead of a blank iframe; create, remove, and rename of a media path refresh holders inside the existing disk batch; Unix opens use that target's `O_NONBLOCK`.

Codex review 3 (PASS-WITH-FIXES on `fe48146`): one disk batch reloads a watched audio, video, or PDF path once when both the file list and the path signal notice it, and a path leaves the file-list scan when its last watcher unsubscribes.

Codex review 4 (PASS-WITH-FIXES on `792ae80`): a modify reloads the holder before the file list updates, and a later unrelated list install adopts that version instead of reloading again.

Codex review 5 (PASS-WITH-FIXES on `694dc34`): a catch-up skip is kept only when the ancestors match the version from the read, so replacing the folder still reloads, and a modify nobody is watching is not remembered.

## What a window would still have to show

Grove was not launched. When this window's viewer hook is off, the page is written to show "This PDF can't be shown in this window." and not attach the iframe. That fallback was not seen in a WebKit window. The headless Chromium harness is not WebKitGTK, so these are unverified:

- An `application/pdf` blob iframe, in the pane and in a note, actually navigating to `webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=` and painting pages under this CSP.
- `<audio>` and `<video>` decoding the MIME types used here, including `.mov` as `video/mp4`.
- The Linux response policy ignoring a blob or viewer response that arrives as a main-frame document, and `with_webview` actually running the hook that arms the PDF exception.
- Closing a split leaving no blob URL, and an outside replace of an open recording or PDF showing the new bytes.
