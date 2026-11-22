# R2 M: open PDFs, audio, and video as those files

Builder: Grok (this worktree `~/workspaces/remote/grove-r2-m`, branch `rebuild/r2-m-grok`, from `rebuild/integration` d285b70). Codex reviews afterwards. Chris approved this visible piece on Nov 18, 2026 at 8:09 AM PT: “Open PDFs, audio and video as those files.”

Planner notes (read these, then design the rest yourself):
- Grok, “Open a recording or a PDF as that kind of file”: `~/workspaces/remote/grove-r2-plans/grove-plan-grok.md` §2.
- Found on this commit: `workspace.ts` sends only images, `.canvas`, `.base`, and `.excalidraw` to their own views. Anything else, including `.pdf`, `.mp3`, and `.mp4`, is read with `read_note`. That path uses `from_utf8_lossy`, so a binary file shows up as a note full of replacement characters. Saving it back fails with “Note is not UTF-8” (`console.error` only), and S1's retry then fails forever.

## What Chris wants

Opening a PDF, or an audio or video file (and embedding one with `![[clip.mp3]]` / the usual markdown or wikilink embed), should treat it as that kind of file, not as an editable note. A PDF must not become an editable note. Audio and video that WebKit can decode should play in a player view and as an embed.

## Direction

- Find why these types fall through to `read_note` today, then fix it with the least new code, reusing existing file-view / embed patterns where they already work for images.
- Audio and video: a player view and an embed, from a byte read with a hard size cap. No new package. A long video should not be pulled into one buffer; streaming is a follow-up, not this piece — fail or degrade safely over the cap rather than hanging or ballooning memory.
- PDF: do not open it as a note. Use a built-in WebKit-capable display if that needs no new package (for example a document view). If a real PDF renderer truly needs a new package, stop and say so in the notes; do not add one, and do not leave PDFs opening as editable notes.
- Watch CSP (`media-src` and friends), large reads, and file-type sniffing: do not treat a script or other non-media file in the vault as media just because of a spoofed extension if you also sniff, and do not execute vault files.
- Do not weaken S1 save/retry, S3 CRLF/BOM, or 3A stamp behavior for real notes. Failed binary “saves” should no longer spin a UTF-8 retry on a media/PDF tab.
- Layout, shortcuts, and look of ordinary notes stay the same. This piece only changes how PDFs and audio/video open and embed.

## Tests

Opening `.pdf`, common audio (e.g. `.mp3`), and common video (e.g. `.mp4`) does not go through the note UTF-8 path and does not schedule a note save; embeds of audio/video render a player rather than replacement characters; size-cap behavior is safe; images, notes, `.canvas`, `.base`, and `.excalidraw` still open as they do today. Headless tests as far as they can go without a GUI window.

## Hard limits (every R2 piece)

- No new crates or packages. If this piece truly needs one, stop and say so in the notes; do not add it.
- No Obsidian or Excalidraw code or assets (build from observed behavior and Grove's own code). Cinder under this repo may be read for reference only.
- No network.
- Test vaults only under `/tmp`. Never touch `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`, `/tmp/grove-playground`, or `~/grove-compare-vault`.
- Don't open GUI windows. Don't launch Grove.
- No pushes. Commit to this branch only. Keep scratch files inside this worktree.
- Add tests. Run `cargo test --offline` in `rebuild/app/src-tauri` and the locked npm suite `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` (known timing flakes under load; rerun once before blaming your change). Restore any tracked screenshots the npm run rewrites (`rebuild/round*-shots`) so the commit holds only this piece.

## Done when

`cargo test --offline` and the locked npm test pass; write `rebuild/NOTES_R2_M-grok.md` (cause found, what changed, how PDFs are shown, size cap, CSP notes, what you could not verify without a window); commit locally on `rebuild/r2-m-grok`, then stop. Do not push.
