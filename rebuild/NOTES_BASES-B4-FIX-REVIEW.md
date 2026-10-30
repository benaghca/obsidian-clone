# Bases B4 fix review

Reviewed by Claude on `rebuild/b4fix-review-claude`. The branch was made from `rebuild/b4-fix-grok` (`8f39c76`), with `rebuild/integration` (`918b75d`, which has B5) merged in using `--no-ff`. Nothing was pushed.

What I reviewed:
- Codex's `85dcb99`: indented fences, and releasing widgets when the last tab closes.
- Grok's `f80f3a8`: following a renamed embed host, and releasing a nested base whose read fails.
- Both sets of notes, `NOTES_BASES-B4-REVIEW2.md` and `NOTES_BASES-B4-FIX.md`.

VERDICT: OK. No fixes are needed beyond the merge. Two small costs are recorded under Performance; I think both are worth paying.

## The merge

- **One conflict, in `bases/view.ts`.** It was on the line that builds the host row: B5 keeps that row in `host` for custom summaries' `this`, and the fix reads the host path through `hostPath()`.
- **Resolution:** `host` is now built from `hostPath()`, read once per evaluation. So after a rename, the rows and the summaries both see the new host.
- **Against integration, `view.ts` differs only in Grok's marked B4-FIX lines.**
- **I broke the merge once, then fixed it before committing.** My scripted resolution first wrote `\b` as backspace characters in the `this` check. Every `this` filter then matched nothing, and the embed test caught it at once.
- The branch changes +241 / −15 lines against integration, almost all of it in the fixes and their tests (`test-bases-embed.mjs` +185).

## Are the fixes real? Each one, undone, fails a test

I undid each fix in turn on the merged code and ran `embed.test.ts` and `test-bases-embed.mjs`. All five fail without their fix:

| Fix undone | What failed |
|---|---|
| Indented fence read (`baseBlockYaml` keeps the indentation) | the unit tests (exit 1), and the browser test at "indented fence renders" |
| Empty state when no note is shown (`NoteEditors.present`) | browser: "closing all tabs disposes every base and subscription" |
| Host read once at mount, not on each evaluation (`BaseWidget.embed`) | browser: "note rename updates both embeds" |
| Failed nested read doesn't `release(painted)` | browser: "a rejected nested read releases the base" |
| Generation guard removed from the rejection path | browser: "a stale rejection does not destroy the newer base" |

What each fix covers:

- **Host rename and folder rename.**
  - The test renames the note, then its folder, and covers both a ```` ```base ```` block and `![[HostMove.base#Named]]`.
  - It checks the rows, `this.file.path`, `this.file.folder`, `file.name`, and that the block's view and the file embed's chosen view are kept.
  - `HostMove.base` is never written. An unsaved change to the host's `status` (with the save held) reaches both embeds. Closing the note releases both bases and all their subscriptions.
  - The host path is read once per evaluation. Rows and `readsChanged` read it again each time, and a nested embed keeps the inner note as its host.
- **A failed nested read.** The base is released along with its subscriptions, and the missing-note box replaces it. When the read is restored, exactly one base mounts again. A stale rejection from an older read leaves the newer base alone.
- **Indented fences.**
  - The fence's own indentation (up to 3 spaces) is removed from content lines, as CommonMark does.
  - Writes put it back. Unchanged lines (blank-line spaces, the fences, the prose around them) stay byte-exact.
  - A new line takes the content's indentation.
  - I checked the indentation arithmetic by hand: new lines read back correctly when the content is indented less than its fence.
  - A real-mouse sort saves an indented block byte-exactly.
- **Releasing widgets when the last tab closes.** Closing, reopening and closing the last tab leaves no base widgets and no Base subscriptions on the workspace or vault. The note's state and undo history are kept: `release()` saves the state to the map before the empty state is swapped in.

**One edge not covered:** a nested embed's host is the inner note's path, fixed when it's drawn. Renaming the inner note updates the outer note's `![[link]]`, which redraws the embed with the new path, so I expect it to work, but no test checks it.

## Nothing else changed

- The only product changes in the branch are the four fixes and the merge resolution.
- Tables, cards, groups and summaries, CSV/Copy and embeds are covered by the full suite, which passed:
  - `test-bases.mjs` with B0 and B5's groups script;
  - `test-bases-cards`, `-results`, `-menus`, `-columns`, `-config` and `-embed`, including my B5 grouped-embed step.

### A wider effect of the last-tab fix

`present()` now gives the editor an empty state whenever the tab shown has no note path. That includes base, canvas, graph, image and backlinks tabs, not just the empty tab left after closing the last one.

- **The gain.** The pane only *hides* the editor (`scroller.hidden`), so before this fix a note's embedded bases stayed mounted behind a base or canvas tab. They counted as shown, kept their subscriptions, and rebuilt on vault changes nobody could see. Now they're released.
- **The cost:** see Performance.
- **Recommendation:** keep it as it is. If you'd rather keep note ↔ view-tab switches as cheap as before, the narrower version is to empty the state only for a blank tab (`!tab.type`). Hidden embeds behind view tabs would then keep evaluating.

## Performance

Integration `918b75d` against this branch, all headless under the lock:
- three interleaved rounds of the same scripts as my B5 review, with the order flipped in round 2;
- then four runs of 15 warm opens each;
- then a tab-switch probe.

| Measure | Integration | This branch |
|---|---|---|
| Warm 1,000-note table open, single sample per round | 8.5 / 8.3 / 8.8 ms | 8.4 / 11.1 / 8.3 ms |
| Same, median of 15 opens, 2 runs each | **6.5 / 6.6 ms** | **7.0 / 7.2 ms** |
| 1,000-row table scroll, worst frame | 16.7–16.8 ms | 16.7–16.8 ms |
| 1,000-card scroll, worst frame | 16.8 / 17.4 / 16.7 ms | 17.7 / 17.4 / 17.5 ms |
| 1,000 grouped cards, wheel scroll, worst frame | 16.8 ms | 16.7–16.8 ms |
| 5,000-note cold open (B0) | 39.8 / 40.3 / 40.2 ms | 38.9 / 41.4 / 41.5 ms |
| 5,000-note warm open, median per round | 15.3 / 13.4 / 14.7 ms | 15.3 / 14.6 / 13.3 ms |
| Typing beside a 5,000-note base: worst frame; rebuilds during / after | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| Embed cold open | 84.0 / 86.8 / 83.1 ms | 83.1 / 84.6 / 84.0 ms |
| Embed warm opens | 5.7–7.3 ms | 5.6–6.9 ms |
| Typing in a note with embeds: worst frame; rebuilds during / after | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| Embed paging scroll, worst frame | 16.8 ms | 16.7–16.8 ms |

### Flagged costs

1. **Warm 1,000-note open: +0.5 ms (about 8%). This is real, not noise.**
   - The single samples overlap, but both 15-open medians on this branch are above both on integration. This is the cost behind Grok's 8.3 → 8.7 ms.
   - **Cause:** the test opens the `.base` tab from a note. That now swaps an empty state into the hidden note editor, which tears down the note's DOM.
   - I tried building that empty state once and reusing it. The medians stayed at 7.1 / 7.2 ms, so the cost is the teardown itself, which is the point of the fix. I reverted the experiment.
   - Still far inside the 100 ms test limit and the plan's 150 ms target.
2. **Switching back to a note with embeds: about +5 ms.** My scratchpad probe `switch.mjs` goes note → base tab → note, 10 times per run, two runs each:
   - **A 2,000-line note with two embedded bases:** median 16.0 / 16.3 ms, against 11.2 / 11.5 ms on integration. Its embeds mount again on return; before, they had stayed mounted while hidden.
   - **A 2,000-line note without bases:** 9.2 / 9.3 ms, against 10.1 / 10.1 ms, a little faster.
   - These times include two frames of waiting, so all the work fits within a frame.
3. **Card scroll worst frames read 17.4–17.7 ms here, against 16.7–17.4 ms.** Nothing in these fixes touches the card grid. I read it as noise, and every frame is under 20 ms.

**Nothing else moved:** 5,000-note opens, typing and scrolling are level, and embed cold opens are slightly faster here.

## Checks, on the merge commit `dca94a6` (code unchanged since)

- `npm run build`: passed.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0, with 66 files / 1,102 unit tests, every browser and geometry script, and posttest (config, cards, embed). No flakes or reruns.
- `npm run audit:offline`: passed over 174 source files.
- `cargo build` passed. `cargo test`: 58 passed, 2 ignored.
- Before the merge commit, the embed and Bases browser scripts passed on their own, including all five new cases.

## Still open (not in this task)

- The extra rebuild on a slow save, and the mock `resolveLink` cost on a cold 5,000-note embed. Both are described in `NOTES_BASES-B4-REVIEW2.md`; neither was changed here.
- Whether to narrow the empty-state swap to blank tabs (above). My recommendation is no.

## Sources

- The two notes files, `BASES_PLAN.md` (§3.5, §8) and the code.
- For Obsidian's behaviour, the "Embed a base" and "Bases syntax" help pages (`this` is the embedding note), from memory; nothing was fetched.
- CommonMark's rule for removing a fence's indentation, from memory.
- No Obsidian code or assets were used.
- Test vaults were only the in-memory browser mock.
