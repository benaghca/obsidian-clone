# R2 M: open PDFs, audio, and video as those files

On `rebuild/r2-m-grok`. Nothing was pushed. No new crates or packages.

## Cause

`Workspace.open` sent images, `.canvas`, `.base`, and `.excalidraw` to their own views. A `.pdf`, `.mp3`, or `.mp4` fell through to `editors.load`, which calls `read_note`. That path uses `from_utf8_lossy`, so the binary showed up as a note full of replacement characters. `write_note` then refused it with "Note is not UTF-8", and S1's `scheduleRetry` kept trying. A tab whose `path` is null never creates editor state, so a media or PDF view does not arm that retry. Note save, CRLF/BOM, and own-write stamps for real notes are unchanged.

## What changed

Audio, video, and PDF open as views (`audio`, `video`, `pdf`) with `path` null and `viewFile` set. History travel and a saved layout do the same, including an older layout that stored the file path with no type. `editors.load` is not called, so no note save is scheduled.

`read_file_bytes` still does the vault path checks. Images stay extension-only and are not sniffed. Audio, video, and PDF (`mp3`, `m4a`, `aac`, `wav`, `ogg`, `oga`, `opus`, `flac`, `mp4`, `m4v`, `mov`, `webm`, `ogv`, `pdf`) must also match the header in `src/media.ts`. A script, HTML (including a UTF-8 BOM and leading spaces), an empty file, or the wrong container (`webm` bytes in `.mp4`, AVI in `.wav`) is `not a media file`. The mock backend uses the same check.

A note embed `![[clip.mp3]]` or `![alt](clip.mp3)` (hash stripped, alias size kept) is a player with controls, `preload="metadata"`, and no autoplay. A PDF wikilink stays a link; choosing it opens the document view. A canvas card of one of these files still says "Unsupported file".

## How PDFs are shown

This machine's WebKitGTK is 2.54.1 (`libwebkit2gtk-4.1`). Its binary contains `webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=`, so the built-in PDF.js viewer needs no new package. The pane reads the file, then sets an unsandboxed iframe `src` to a `blob:` URL of type `application/pdf`. The iframe is created only after that read succeeds, and it is not focused. A sandbox would block the viewer. WebKit then navigates the frame to its viewer with that blob as `file`. The page does not load `pdf.js` itself. `script-src` stays `'self'`.

## Size cap

The cap is the existing `IMAGE_MAX_BYTES`, 20 MB. The length is checked on metadata before the body is read, and again if the file grew during the read. Over the cap, the command returns `too large to show` and the view says "Too large to show." There is no player and no iframe. A longer video is not streamed in this piece.

A read that fails for any other reason says "This file can't be shown." A PDF says "This PDF can't be shown." A player that cannot decode the bytes says "This file can't be played here."

## CSP

`media-src` was already `'self' blob:`. Audio and video elements are subresources, so they do not go through the navigation guard.

`frame-src` in both `csp` and `devCsp` is `https: http: blob: webkit-pdfjs-viewer:`. `object-src` stays `'none'`, `child-src` stays `'none'`, and `script-src` stays `'self'`. The asset protocol stays off.

The navigation guard allows a child frame, and a navigation whose frame wry cannot name, to load a `blob:` URL or `webkit-pdfjs-viewer://pdfjs/web/viewer.html` when every `file` parameter parses as a `blob:` URL. The main frame refuses both. On Linux the response-policy hook still ignores those URLs as a main-frame document. `file:`, `javascript:`, and `data:` stay refused. A viewer URL with no `file`, a non-blob `file`, another path (the viewer's `content-script.js`), another host, or userinfo is refused.

A note cannot mint a blob URL. The page creates the blob after a sniffed read, and the vault bytes are not page script. The residual is that any blob URL is allowed as a child or unnamed-frame navigation, because that is how the PDF iframe loads. On platforms where wry cannot tell a child frame from the main frame, the same limit as the web-embed frames applies; the Linux main-frame document check still refuses blob and the viewer.

## Tests

`cargo test --offline` in `rebuild/app/src-tauri`: 203 passed, 0 failed, 5 ignored. That includes the media header and size-cap reads, the image reads, and the navigation-guard table for the viewer scheme above. The scheme in the guard matches the URL strings in this machine's `libwebkit2gtk-4.1.so.0`.

`flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` passed (exit 0) on the frontend. Earlier runs on a busy machine failed in unrelated timing checks (a 52 ms drawing long task, a base-embed cold open, a 10 s scratch-vault startup, a 17 ms list-item friction sample) and passed on the next quieter run. Screenshot fixtures the suite rewrote were restored and are not in the commit. The viewer-scheme correction is in the Rust guard, `tauri.conf.json`, and the offline audit list; the frontend sources the npm suite executes did not change after that pass, and `cargo test --offline` was run again after the scheme correction.

Headless checks cover the sniff, the cap, opening without `read_note`, layout restore, the embed widget type, and the guard table. Vitest runs in node and does not build the player DOM.

## What a window would still have to show

Grove was not launched. The headless Chromium harness is not WebKitGTK, so these are unverified:

- An `application/pdf` blob iframe actually navigating to `webkit-pdfjs-viewer://pdfjs/web/viewer.html?file=` and painting pages under this CSP.
- `<audio>` and `<video>` decoding the MIME types used here, including `.mov` as `video/mp4`.
- The Linux response policy ignoring a blob or viewer response that arrives as a main-frame document.
