# NOTES_R2_P2A: incremental name, alias, and path maps

Built on `rebuild/r2-p2a-claude` from `rebuild/integration` `d285b70` (brief: `R2_P2A_TASK.md`). Rust only. This is P2a of the "Quiet saves at 20k+ notes" plan (RUST_PERF_PLAN §4.2, incremental maps only). P2b (index version, `changes_since`, link-index deltas, `vault-changed` file entries, `RwLock`, reverse link index, consumer patching) is **not** started.

## In plain words

- Saving a note on a big vault no longer rebuilds every name, alias, and path map while holding the vault lock. A save now updates only the saved note's own entries. At 50k notes that is about **8 µs** instead of **~70 ms** (release build, see Measurements).
- The same goes for renaming or deleting a file, deleting a small folder (up to 256 paths), and the watcher reloading one changed file.
- A folder rename and a large folder delete still rebuild the maps once, the same as before P2a. A folder rename already had to rebuild, because the destination folder is reloaded right after. Done path by path, these two would get quadratically slow when many folders hold files with the same name (Codex review 1, see below).
- Nothing visible changes. Links, aliases, partial paths (`[[folder/note]]`), and case clashes resolve exactly as before. The tests check that after every edit, rename, and delete the maps are identical to a full rebuild, and that each key has the same winner as the old rebuild code.
- Opening a vault and the watcher's rescan still build the maps once, from scratch. That full build is now also a little faster than before (16 vs 20 ms at 20k notes, 58 vs 70 ms at 50k).

## What changed

**`src-tauri/src/index/name_maps.rs` (new): `NameMaps`.** It holds the four lookup maps `resolve` uses: note name, alias, lower-case path, and partial path (slash-aligned tail such as `/folder/note.md`).

- **Each key keeps every file that claims it, not just the winner.** That is what makes removal cheap: when the winner goes away, the next one is already there, with no vault walk. Each list is kept in winner order:
  - names: path order (`pick` still ranks them at lookup time, as before);
  - aliases: path order, first wins (the old walk kept the first path in path order);
  - lower-case paths: path order, **last** wins (the old walk overwrote, so the last path won);
  - partial paths: shortest path first, then path order, first wins (the old `remember_suffix` rule).
- **One owner is stored inline.** `Owners::One(String)` for the usual single owner, `Owners::Many(Vec)` only when two or more files share a key (`Many` always holds two or more). This keeps the per-key cost the same as the old one-string maps, and is why the full build did not get slower.
- **`add(path, node)` / `remove(path, node)`** update one path: a hash lookup and a binary search per key, about 3 to 6 keys per note.
- **`refill(files)`** is the full rebuild: one walk, push in path order, then sort only the partial-path lists and drop duplicate aliases (one note can list the same alias twice).
- **`keys_of(path, node)`** is the single place that says which keys a node contributes. It has the same rules as the old loop: folders contribute nothing; a file named `.md` has no partial-path keys; aliases count only for note paths.

**`src-tauri/src/index.rs`:**

- The four `by_*` fields are replaced by `maps: NameMaps`. `resolve` and `resolve_path` read through `names` / `alias` / `path_lower` / `suffix`.
- **Every file-list change goes through `put_node` or `take_node`.** They remove the old node's keys and add the new node's keys for that one path. Nodes move as shared `Arc<Node>`s: a replaced or removed node is only read to forget its keys, and is never deep-copied, even while a search holds it. `insert_file`, `insert_dir`, `relocate`, and `remove_tree` all use them, so a folder that replaces a file, a rename onto an existing file, or a note renamed to `.png` (its aliases dropped) are all handled in one place.
  - **Shortcut:** a save that keeps the same kind of node (file or folder) and the same aliases changes no keys, so `put_node` skips the maps entirely. That is the usual "typing in a note" save.
- **`upsert_note`** no longer calls `rebuild_maps`.
- **`relocate` of a file** and **`remove_tree` of up to `BULK_PATHS` (256) paths** no longer call `rebuild_maps`. A **folder `relocate`** and a **larger `remove_tree`** mark the maps stale, move or drop the nodes, and rebuild once, deferred to the outermost `MapBatch` (see "Review 1 fixes"). Neither walks the whole file list any more: `Files::tree_keys` and `Files::has_below` use a `BTreeMap` range (`rel/` up to `rel0`, since `'0'` follows `'/'`), so they visit only the moved or deleted paths. Before, `remove_tree` ran `retain` over every file, and `relocate` filtered every key.
- **`refresh_path` for one file** (the watcher's modify or create, and the reload of a rename's destination) updates its own path, like `upsert_note`. This is needed for user renames to benefit at all: `rename_path` is `relocate` plus `refresh_path(to)`.
- **`refresh_path` for a folder** still does one full rebuild (a new folder can bring many files at once, and one sorted build beats thousands of sorted inserts). It marks the maps stale first, so no per-file work is wasted. Inside a `MapBatch` (S4) that rebuild is still deferred to the outermost drop, so a batch rebuilds at most once.
- **`maps_dirty` means "the maps don't match the file list yet".** While it is set, `put_node` / `take_node` skip the maps, because a full rebuild is pending. It is set only by a folder refresh, a folder move, a delete of more than `BULK_PATHS` paths, `scan`, and a deferred rebuild inside a batch. It is cleared by the rebuild at the end of that same call or batch. `Index::stale()` builds an empty index in that state, for `scan` and the test constructor.
- `rebuild_maps` is now one line (`self.maps.refill(&self.files)`), with the same `defer_depth` / `maps_dirty` / counter handling as before. `remember_suffix` moved into the test oracle.

**`src-tauri/src/index/file_map.rs`:** `tree_keys` and `has_below` were added (both count their visits for the walk tests). `retain` was removed, as nothing uses it now. `insert` and `remove` return the old `Arc<Node>` instead of unwrapping it, so `unique_node` (which cloned a node a search still shared) is gone.

## Review 1 fixes (Codex PASS-WITH-FIXES, no P1)

**P2: bulk moves and deletes could go quadratic.** Many folders holding a file with the same name (`README.md`, `index.md`) share one name list and one partial-path list. Removing or moving such a tree path by path shifts those sorted lists once per path. Codex measured 93–95 ms for 20,000 such removals, against about 10 ms for a full refill. The fix:

- **A folder `relocate` always takes the full-rebuild path:** stale first, then one rebuild at the end, deferred inside a `MapBatch`.
  - Both production callers (`rename_path` and the watcher's `apply`) call `refresh_path(to)` right after it, in the same batch. For a folder that refresh already rebuilds.
  - So a folder rename still costs exactly **one** rebuild, as at `d5e3a78` and before P2a, with no per-path work wasted first.
  - A file rename (one path) stays per-path.
- **A `remove_tree` of more than `BULK_PATHS` = 256 paths does the same: one rebuild.**
  - Smaller deletes stay per-path. At 256 paths, a few µs each, that is about 1 ms.
  - Even in the absurd case where every file in the vault shares one name, 256 shifted removals cost about one full rebuild.
- The threshold is per call. Inside a batch, once anything goes stale, every later step skips the maps, and the batch rebuilds once on drop.

**P3: a replace or delete could deep-copy a note a search still held.** `Files::insert` and `Files::remove` used to unwrap the old `Arc<Node>` and clone it when a search snapshot shared it. Also, `put_node` inserted before it checked whether the keys were unchanged. The fix:

- `Files::insert` and `Files::remove` now take and return `Arc<Node>`.
- `put_node` reads the old `Arc` to forget its keys (or to see that they are unchanged) and drops it.
- `take_node` returns the `Arc`.
- `relocate` re-inserts the **same** `Arc` under its new path. It builds a fresh node only when a note moves to a non-note path (its parsed note is dropped, as before). Nothing clones a `Note` any more.

**New tests for these fixes:**

- `bulk_deletes_and_folder_moves_of_repeated_names_rebuild_once`. The fixture: 3,000 `big/pNNNNN/{docs/README.md, index.md}` notes, all with alias `readme` and links to `[[README]]` and `[[docs/README]]`, plus trees of exactly 256 and 257 paths.
  - Deleting the 256-path tree does **0** rebuilds and exactly 256 per-path updates.
  - Deleting the 257-path tree does **1** rebuild and **0** per-path updates.
  - One batch does a folder move of `big` (15,001 paths), 1,500 subtree deletes, and a delete of the rest. It must do exactly **1** rebuild and **0** per-path map updates.
  - Then a 3,000-folder delete outside any batch must rebuild once.
  - After each step, the maps equal both oracles and `README` / `docs/README` / `readme` resolve to the surviving note.
  - Per-path updates are counted by a new test counter (`take_map_updates`), so the check is deterministic, not timing-based.
  - Mutations, each reverted:
    - with the bulk rule removed, it fails ("one path more rebuilds once");
    - with the folder rule removed, it fails ("no per-path updates for a folder move or a bulk delete"). That version also ran 98 ms against 26 ms in a debug build.
  - A loose timing bound (under 20 rebuilds plus 200 ms) is printed for reference. Release: the batch takes 10.8 ms, one rebuild of the remaining index 2.6 ms.
- `renames_and_deletes_share_nodes_a_search_still_holds`: a search's note list is held while a note is renamed, another is saved, and a third is deleted.
  - The renamed path's node is the **same** `Arc` the search holds (`Arc::ptr_eq`), with the expected strong counts.
  - The deleted node lives on only in the search's list.
  - The maps match the oracles.
- Updated to the new rule:
  - `per_path_updates_visit_only_the_changed_paths`: a folder move now asserts one rebuild; the file-level and small-delete visit counts are unchanged.
  - `random_edits_renames_and_deletes_match_a_full_rebuild`: file-level ops still must do **0** rebuilds; folder moves and batches may do at most 1.

## How the incremental maps stay correct

- **One definition of a node's keys.** `add`, `remove`, and the full build all call `keys_of`, so they cannot disagree about which keys a path owns.
- **Symmetric updates through one door.** Every insert or removal of a node in `Index` goes through `put_node` / `take_node`, which first remove the replaced node's keys, then add the new node's keys. No other code calls `files.insert` or `files.remove`.
- **Canonical form.** Lists are always sorted in winner order with no duplicates; a key with no owner is removed; a key with one owner is always `One`. So "per-path maps equal a full rebuild" is a plain `==` on the whole structure, and the tests check exactly that.
- **Two oracles in tests** (`index/name_maps_tests.rs`):
  1. `NameMaps::build` over the whole file list: the new full rebuild.
  2. `legacy_winners`: the pre-P2a `rebuild_maps` loop, copied verbatim, returning its four maps. The live maps' winners, read through the **same accessors `resolve` uses**, must equal it. This catches a wrong winner rule (for example, first instead of last for lower-case paths), not just drift between the two new code paths.
- **Batches.** A batch with only per-path work (file renames, small deletes, and file refreshes: the watcher's usual shape) never goes stale and never rebuilds. A batch with a folder refresh, a folder move, or a large delete goes stale at that point; any later per-path work in that batch skips the maps; the outermost drop rebuilds once.

## Tests

All in Rust; no TypeScript changes.

**New, `src-tauri/src/index/name_maps_tests.rs`:**

| Test | What it checks |
|---|---|
| `random_edits_renames_and_deletes_match_a_full_rebuild` | 5 seeds × 300 random steps: saves (with and without alias changes, including saves that change no keys), file and folder renames (including onto existing paths, into new folders, and a note renamed to a picture), deletes of files and folders, watcher-shaped batches of renames and deletes, and batches with a real on-disk refresh. Paths are chosen to collide: case clashes (`note` / `Note` / `NOTE`, `a` / `A`), `.md` / `.MD` / `.png` / no extension / `.md.md`, a file named `.md`, non-ASCII (`é`, `İ`), nested folders, and a file path that later becomes a folder. After **every** step: the maps equal both oracles; `link_index()`, `backlinks()` for every path, and 14 link spellings resolved from 4 folders all equal a fully rebuilt copy; no file-level save, rename, or delete ran a full rebuild, and folder moves and batches ran at most one. |
| `every_winner_change_matches_the_rebuild` | Each winner rule one by one: alias first-owner promotion on delete, alias dropped and re-added by a save, lower-case path last-wins and fallback, partial path shortest-wins and promotion (twice), note → `.png` drops its aliases, a file replaced by a folder of the same path, a rename onto an existing file. |
| `rename_trap_reads_before_relocate_see_old_paths_and_after_match_a_rebuild` | The RUST_MIGRATION_PLAN step 2 trap: `link_sources` and `backlinks` read **before** `relocate` see the old paths (5 links, 3 sources); after a folder move and then a file rename, the results equal a full rebuild (4 links, then 2 via the alias only). The existing relocate tests (`rename_moves_children_and_resolution_follows`, the backlinks relocate test, `link_sources` tests) are unchanged and pass. |
| `per_path_updates_visit_only_the_changed_paths` | In a 2,000-note index: two saves visit **0** file-list nodes; a file rename visits 1; a file delete visits 1; a folder delete (20 notes in 7 subfolders) visits 28; a rename of a missing path visits 0; **0** full rebuilds. A folder move then does exactly 1 rebuild. Before P2a each of these rebuilt the maps (a full walk), and delete and rename also walked every key. |
| `bulk_deletes_and_folder_moves_of_repeated_names_rebuild_once` | Review 1, P2 (above). |
| `renames_and_deletes_share_nodes_a_search_still_holds` | Review 1, P3 (above). |
| `saves_at_20k_notes_cost_far_less_than_a_full_rebuild` | Cheap timing check at 20k notes, measured as a ratio in the same run, so it holds on a loaded machine: one save must cost under 1/20 of a full rebuild. In a debug build it is about 24 µs vs 94 ms. |
| `bench_name_maps` (ignored) | The release timings below. |

**Changed, `src-tauri/src/vault_batch_tests.rs` (S4):**

- `matches_disk` now also asserts the live maps equal a full rebuild and the pre-P2a winners, so every S4 scenario (mixed sync batch, renames, creates) checks the maps too.
- Rebuild counts that P2a lowers, with the batching guarantee kept:
  - `s4_apply_batch_rebuilds_maps_once`: N file creates, as N records or as one, now do **0** full rebuilds (was 1). A new case, N folder creates in one batch, must rebuild **exactly once** for N = 3, 6, 8: that is the S4 guarantee, still enforced.
  - `s4_apply_mixed_batch_rebuilds_once_and_matches_a_rescan`: still exactly **1** (it creates a folder).
  - `s4_rename_path_rebuilds_maps_once` is renamed `..._at_most_once`: a file rename, folder rename, and rename into a new folder now do **(0, 1, 0)** full rebuilds (was (1, 1, 1)). The folder rename still rebuilds once, because `rename_path` refreshes the destination folder.
  - `s4_empty_apply_does_not_rebuild_maps`: unchanged (0, 0).
- New, `p2a_lookups_survive_a_rescan_swap_and_later_patches` (the file list **replaced**, then **patched**): a watcher rescan whose fresh `Index` was scanned before the app made a save that drops an alias, a rename into a new folder, a create that claims the alias, and a permanent folder delete; `finish_rescan` replays them onto the fresh index and swaps it in. Then more saves, plus a watcher batch with a modify and a rename. At each stage: maps equal both oracles, the file list and `link_index` equal a rescan from disk, and alias, name, and path lookups are correct.

**Mutation checks** (run by hand, then reverted). Each must make `random_edits_renames_and_deletes_match_a_full_rebuild` fail, and against the final code each did:

- `same_keys` ignores aliases;
- `take_node` doesn't forget keys;
- lower-case path winner is first instead of last;
- partial paths ordered by path only;
- the full build doesn't tidy aliases (no dedup or collapse);
- the full build doesn't tidy partial paths (no sort);
- the sorted insert skips its rotate;
- `One.remove` always empties the key;
- `Many` is not collapsed back to `One` after a removal.

The lower-case path mutation was missed at first: the rebuilt copy shares the lookup code. `winners()` now reads through the same accessors `resolve` uses, so the pre-P2a oracle catches it. A folder refresh that doesn't mark the maps stale first was also tried. It passes, as expected: per-path work followed by a full rebuild is still correct, just wasted.

**Suites:**

- `cargo test --offline` in `rebuild/app/src-tauri`: **210 passed**, 0 failed, 6 ignored (after review 1; 208 at `d5e3a78`).
- `flock /tmp/grove-npm-test.lock npm test` in `rebuild/app`, after review 1: **passed** (exit 0; vitest 1691/1691, every browser script and posttest PASS) on its second run.
  - The first run failed only in `test-drawing-editor.mjs`: one 52 ms task against a 50 ms budget (`DRAWING_EDIT_LONG [52]`). That is a browser-mock timing flake with no Rust index involved. On the rerun it read `[]`.
- At `d5e3a78` the same suite **passed** (exit 0; vitest 1691/1691, every browser script and posttest PASS) on its second run.
  - The first run failed only in the last posttest, `test-bases-edge.mjs`: one 33.3 ms frame in the 10k-row scroll (`10k scroll p95 16.8 max 33.3`). That is a known load-timing flake, and that browser-mock test doesn't touch the Rust index. On the rerun it read max 16.8 ms.
  - The tracked `rebuild/round*-shots` files the runs rewrote were restored with `git checkout`, so the commit holds only this piece.
- `cargo clippy --all-targets`: no new warnings in the changed code. The remaining warnings (`ValueWalk`, `len`, `values`, and others) were there before this change.
- This worktree had no `node_modules`, so `edit_fuzz` (which runs a TS reference script) failed at first. `npm ci --offline` from the local cache fixed that. No network, and no tracked file changed.

## Measurements

Release build, `cargo test --release --offline --lib -- --ignored --nocapture bench_name_maps`. Synthetic index: notes at `f{0..99}/g{0..6}/n{i}.md`, each with one alias and two links. Machine idle (npm suite finished):

| Notes | Old full rebuild | New full rebuild | Save (`upsert_note`) | File rename (`relocate`) | Folder rename |
|---|---|---|---|---|---|
| 20,000 | 20.8 ms | 15.8 ms | 6.5 µs | 2.1 µs | 15.0 ms (one rebuild) |
| 50,000 | 68.5 ms | 56.5 ms | 7.3 µs | 2.8 µs | 58.8 ms (one rebuild) |

These are after review 1. At `d5e3a78` the folder rename was per-path: 0.24 ms for 200 notes at 20k and 0.80 ms for 500 notes at 50k, because this bench has no repeated names. In production, though, `rename_path` and the watcher followed it with a folder refresh that rebuilt anyway. So a user's folder rename costs one rebuild either way, as it did before P2a.

Each figure is the median of three bench runs. Each bench run averages 5 rebuilds, 500 saves, and 500 renames. The save includes parsing the note and one `stat` per parent folder (`ensure_dirs`).

- "Old full rebuild" is the pre-P2a loop (the test oracle), run on the same index. The older RUST_PERF_PLAN figures (6.1 ms at 20k, 25.9 ms at 50k) came from `gen-vault.mjs`'s flatter vault: fewer folder levels mean fewer partial-path keys. They are not comparable to this index, so they aren't cited.
- A save went from a full rebuild (tens of ms under the write lock at 20k–50k) to microseconds, roughly 4 to 5 orders of magnitude, and it no longer grows with vault size.
- Memory: each key still stores its key string plus one path string; only keys shared by two or more files hold a `Vec`. That is about the same as before.

## Leftover gaps

- **A folder refresh, a folder move, and a delete of more than 256 paths still do one full rebuild.** These are a watcher folder create, a folder rename (with its destination reload), a big folder delete, and rescan replay of a folder. That is deliberate (see "Review 1 fixes") and still batched once per `MapBatch`. To make them per-path later, removals and inserts would have to be grouped per key, with one `retain` or merge per list instead of one shift per path. Do that only if a folder rename on a huge vault shows up in a profile.
- **`link_index` is still sent in full** about a second after each save (`LINK_INDEX_DELAY` in `vault.ts`), and the page still rebuilds its link consumers. That is P2b, which is the larger half of the felt gain on big vaults. P2a only takes the map rebuild out of the save path.
- `upsert_note` still calls `ensure_dirs`, which runs one `stat` per parent folder per save. That was already there and is cheap, so it was left alone.
- The 20k timing check is a ratio inside one debug run, not an absolute budget, so a slow CI box can't flake it. The absolute numbers live in the ignored bench.
