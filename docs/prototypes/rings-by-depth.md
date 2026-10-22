# Prototype: rings by depth

Status: experimental, on the `claude/confident-lamport-whrf73` branch only. Not merged.

## The idea

The local graph usually lays notes out with forces alone, so where a note lands says little. With **Rings by depth**, distance from the middle means something:

- The open note is pinned in the middle.
- Notes it links to, or that link to it, sit on the first ring.
- Their links sit on the second ring, and so on out to the depth slider.
- Links still pull related notes together, so notes that link to each other end up on the same side of a ring.
- In 3D the rings become shells around the note.

It's the "atom" idea from the design exploration (a note with its links in shells around it), built as a plain option without the themed names. The question to answer is whether it's easier to read than the normal local graph on a real vault.

## Get it

- **Windows, no build:** on GitHub, open the repository's **Actions** tab, pick the latest **prototype build** run for this branch, and download **cinder-windows** from the bottom of its summary page. Unzip it and run `cinder.exe`. It's unsigned, so SmartScreen may warn: **More info** → **Run anyway**.
- **Windows, build it yourself:** `git fetch`, `git checkout claude/confident-lamport-whrf73`, then `cargo build --release` and run `target\release\cinder.exe`.
- **Arch or CachyOS:** check out the branch, then `cd packaging/arch && makepkg -si`. That replaces the installed `cinder` package. Reinstall from `main` to go back.

The prototype uses the same settings folder and history as your normal Cinder and opens your last vault. The feature only changes the graph's layout; it doesn't write to notes. To be extra careful, open a copy of your vault (**Settings → Vault → Change…**).

## Try it

1. Open a note with a fair number of links.
2. Open its local graph: command palette (**Ctrl+P**) → *Open local graph of current note*, or **Ctrl+G** and tick **Local (current note)**.
3. Tick **Rings by depth** in the graph controls. The setting is remembered.
4. Try **Depth** 1, 2 and 3, and tick **3D** to see the rings as shells (drag to orbit; **Rotate** spins it).
5. Click a note on a ring to select it, then use **Local graph** in its card to re-centre on that note.

Try three kinds of note:

- an ordinary note (5 to 15 links),
- your busiest hub or index note,
- a daily note.

## Things to judge

- Is it quicker to see what's directly connected than with the normal local graph?
- Do related notes sit together on a ring, or does it look random?
- At depth 2 on a busy note, is it still readable? A crowded ring spreads its notes over up to four close lanes and then grows its radius, so a hub's rings get big.
- Is 3D useful here, or only nice to look at?
- Labels: they overlap on busy rings, as in the normal graph. Is that a deal-breaker?

## Known limits

- Notes that are both a direct link and a link of a link go on the inner ring, the shortest distance.
- Lanes are assigned by file name, not by position, so a busy ring looks like a band rather than neat circles.
- Only the local graph has rings. The global graph is unchanged.

## Where the code is

- `ui/app/graph.js`: `graphData` records each note's link depth; `applyRings` wires the checkbox.
- `ui/graph.js`: `layoutRings` (ring radii and lanes), `ringForce` (pulls notes to their ring), `pin` (keeps the open note in the middle), and the dashed ring guides in `draw` and `draw3d`.
- `ui/test/e2e/graphrings.js`: the browser test.
