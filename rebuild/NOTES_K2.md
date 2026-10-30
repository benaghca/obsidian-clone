# K2 — Safe property edit

Completed on `rebuild/kanban-k2-codex`, based on `eb02c47` (the approved
Kanban plan over integration `f112151`). This implements K2 only: native and
reference property edits, transport, durability, parity tests and P6. No UI.

Implementation commits:

- `9ac556e` — atomic-write durability and abandoned-temp cleanup.
- `de01ae5` — property CAS command, TS reference, shared corpus and contract.
- `50dcf9f` — small index fast paths needed to meet the large-note P6 budget.

## Changes and ownership

Implementation total, excluding this notes file: **21 files, +3,083 / -29**.

- New `src-tauri/src/edit.rs`: +848, including native tests and release bench.
- New `src/editor/propertyEdit.ts`: +117; its test file: +59.
- New `fixtures/parity/property-edits.json`: +1,798, 100 authored cases.
- `index/props.rs`: +69/-19, frontmatter spans with byte offsets and each
  line's original ending; the existing properties reader is reused.
- `fsutil.rs`: +99/-3; `vault.rs`: +4/-1, mode copy, directory sync and sweep.
- `lib.rs`: +29, one async command, registration and other-window Modify event.
- `api.ts`: +2; `mock/backend.ts`: +12; `CONTRACT.md`: +5.
- Necessary small edits outside the assigned list: `frontmatter.ts` +1/-1
  exports its existing formatter; `index.rs` +1/-1 exposes props within the
  crate; the TS/Rust parity runners +4/-1 and +12/-1 execute the new corpus;
  `build.rs` +1, capability +1 and generated permission +11 register/allow the
  command. Fixture README +2 documents the added case format.
- Performance exceptions: `index/parse.rs` +5/-2 avoids link scanning when
  neither link marker occurs, and borrows lines without inline-code markers;
  `index/tags.rs` +3 bounds collection to frontmatter when no `#` occurs.
  These retain search lines and all frontmatter tags, with the normal parsing
  paths retained when markers exist. Full native/parity tests pass. The
  pre-optimization complete command missed P6 at 1 MB; these few lines remove
  redundant scans rather than changing write semantics.

No Bases model, view, menus, grouping, cell-edit UI or editor dispatch changed.
No packages or crates added.

## API and safety decisions

`api.setProperty(path, edit, dryRun?)` invokes `set_property`; the mock invokes
the pure TS twin. `PropertyEdit` has required `key`, `expect` (raw property
lines or null), and `to` (typed value, exact raw lines, or null). Rust rejects
omitted expect/to fields instead of silently treating omission as deletion.
Results are `done`, `unchanged`, `conflict` with current lines, or `refused`
with reason. Success includes before/after raw lines, fresh props and mtime.
Raw protocol lines use LF; file splices retain original per-line endings.

The current target is compared before expect: a retry whose target already
exists is unchanged. Other stale expectations conflict. Only this property's
lines participate in CAS; edits to another property or the body are retained
from the fresh file. Keys compare case-insensitively, but the written key's
quoting, case and spacing survive. BOM, CRLF/mixed endings, other properties,
comments, blank lines, fences and body outside the splice survive unchanged.
New lines use the opening fence's EOL, or the file's CRLF hint when creating
frontmatter. Scalars retain safe quote style; lists retain flow/block style
and indentation. Unsafe plain values fall back to canonical quoting.

D4 is implemented as an empty scalar or `[]`, not key removal. A missing key
given a typed empty target is already unchanged. Raw undo can still restore
an explicitly empty property. `to: null` removes exactly that property's
lines, for undo of a previously absent key. Raw restore must parse as exactly
one editable property with the requested key, without extra lines. Undo
restores recorded property lines; deleting a newly added property leaves the
frontmatter envelope because the protocol does not record its prior absence.

Unknown target values, comments inside the target value, duplicate keys,
unplaceable frontmatter, nested/unsupported YAML, invalid typed values and
unclosed/over-limit frontmatter are refused. Both engines reparse every
prospective edit and check the target type/value, other properties' key/raw
lines and body identity. Read/write cap is 16 MiB; frontmatter cap follows
the existing 2,000-line reader. The TS scanner reuses readProperties and the
existing formatter; it does not use readFrontmatter's early startsWith check,
which rejects BOM/space-prefixed fences and lacks raw EOL spans.

The native command holds the vault mutex throughout read, CAS, write and index
refresh, off the GTK thread. It accepts existing regular .md/.MD notes only;
outside/ignored paths, ignored-folder aliases, final symlinks, oversized and
non-UTF-8 notes are refused. Final symlinks are conservatively refused even
when they point inside the vault, to avoid replacing the symlink itself.
Reads are bounded; pre/post-read and final stats compare full mtime, size,
and Unix device/inode/ctime. A changed snapshot is retried up to three times,
then conflicts with current lines where readable. This is not an OS-wide
lock: an external writer can still race the final stat and rename (R4/K7).

`dry_run` performs the same read, validation, CAS and stale checks and returns
prospective props with the current file mtime. It does not write, update the
index, mark an own write or emit a change. A real successful write marks own,
refreshes the existing full note index and emits Modify to other windows.
Unchanged/refused/conflict/dry-run results emit no event. Existing indexing
size policy is unchanged; the edit engine's 16 MiB cap does not expand it.

## Durability and startup cleanup

Every atomic_write caller now copies old permissions after writing data and
before syncing/renaming, syncs the file, renames, and syncs the pre-opened
parent directory on Unix. Opening the directory first avoids replacing the
note before discovering that the directory cannot be opened. create_new
collisions cannot cause cleanup to delete someone else's temp; failures close
the file before trying to remove this call's temp.

A directory-sync failure can occur after rename. set_property then refreshes
the index from disk, leaves watcher echo unsuppressed and returns an error;
it does not claim the old file necessarily remains. Validation failures log
the key/reason, never note contents.

Vault open sweeps abandoned regular files ending in `.grove-tmp`, recursing
without following symlinks and skipping .obsidian/.git/.trash. It includes
.grove, where settings writes also leave temps. Current-process files and
Linux live-PID temp names survive; cleanup failures are logged and do not
prevent opening the vault. Tests cover unrelated similarly named files.

Directory fsync is Unix-only: std offers no portable equivalent on the other
targets. File sync remains enabled everywhere. Replacement still does not
preserve hard links, xattrs or ownership, as covered by approved R6. No claim
of cross-platform power-loss verification or crash-injection coverage is made;
K7 owns that follow-up.

## K5 hand-off

Loaded notes must call editProperty on current editor text and apply its one
UTF-16 `change` with `userEvent: "input.property"`, through the existing
editor change path. The normal editor save owns disk writes. Closed notes
call api.setProperty; the caller handles the existing own-page written/update
flow and notices. Do not call Rust for a loaded note with unsaved typing.

Store before/after for CAS undo/redo; use raw `to.lines` to restore exact
property text, and null only to undo absence. Pure results use `mtime_ms: 0`
as a placeholder; mock/native supply filesystem mtime. A successful dry-run's
props are prospective, not proof the disk was changed. No moving, queues,
history stacks, toolbar notices or editor wiring are built in K2.

## Verification

All required checks passed:

- `npm run build`: passed; existing large-chunk warning remains (1,083.57 kB).
- `flock /tmp/grove-npm-test.lock npm test`: exit 0, **68 files / 1,216 tests**,
  all permanent browser geometry/real-pointer scripts and posttest completed.
- `npm run audit:offline`: passed on final source, **176 source files**, dist,
  CSP, capabilities and dependencies; this also rebuilt successfully.
- `cargo build`: passed; `cargo test`: **66 passed, 0 failed, 3 ignored**,
  with bin/doc tests also passing. Ignored P6 was run separately in release.
- Shared 100-case corpus runs through both engines, with expected status,
  before/after/current/reason and full output text. Cases cover all §4.1
  conversions, styles, Unicode/BOM/EOLs, no EOF newline, boundary line caps,
  malformed/unsupported YAML, absent/empty properties, retries and raw undo.
- Focused tests cover fresh metadata, mock API, index props/tags/links,
  deterministic stale retries/exhaustion, invalid paths/bytes/size, modes,
  symlinks, sweep and **1,000 durable sequential edits with no leftover temps**.
- Headless API probe passed dryRun, BOM/CRLF/quotes, metadata and idempotence.

No timing-flake retry was needed. Two test-harness mistakes were corrected:
the first bench reused create_note for its second size, and a TS test oracle
used readFrontmatter's BOM-rejecting early path. These were setup/oracle fixes;
assertions and budgets were not relaxed. The full npm run covered final TS
source; subsequent Rust-only tuning was covered by final Cargo tests/P6 (Vite
ignores src-tauri). A redundant audit queued behind another test run was
cancelled and run directly; audits need no browser lock and the final run passed.

## Performance

Milliseconds below. Measurements use scratch fixtures, existing installed
dependencies and headless scripts; no GUI windows or real vaults.

P6 runs `cargo test --release -- --ignored set_property_bench`: 10 warmups,
100 alternating edits per size, including fresh read/parse/CAS, atomic write,
mode copy, stat and full index refresh. A test-only thread-local counter
subtracts actual measured file+directory sync time; syncs remain enabled.
Bodies repeat short plain lines (10,012 and 1,000,007 bytes, about 52.6k lines
at the larger size). The test asserts median budgets and reports maxima too.

- Initial complete implementation medians excluding fsync: **0.1441 / 11.4504**
  for 10 KB / 1 MB. The 1 MB result motivated the small index exceptions.
- Final excluding-fsync median: **0.0619 / 2.9917**; maximum **0.2010 / 3.6409**.
  Both measured maxima are also below the respective **2 / 5 ms** budgets.
  Wall medians including sync: **0.0625 / 2.9928** on this filesystem.
- Separately, the old/new atomic_write-only helper median was
  **0.0141 → 0.0173** (10 KB), **0.2357 → 0.2405** (1 MB); maxima
  **0.0153 → 0.0260**, **0.3064 → 0.2535**. This isolates the durability cost,
  not the full new command; it is not comparable to full-command P6 work.
- TS existing setValue + CM Text edit standalone baseline medians:
  **0.005390 / 0.005009**. Interleaved old/new CAS + same Text edit:
  10 KB **0.005350 → 0.010189** median, **0.015549 → 0.018504** max;
  1 MB **0.003617 → 0.058781** median, **0.020158 → 0.783088** max.
  The new reference does extra CAS and invariant checks; this is a measured
  increase, still below 1 ms in these runs and the 50 ms main-thread limit.

P12 uses the unchanged frontend, Bases groups and Bases search bench scripts,
comparing an `eb02c47` scratch archive against this branch, under the browser
lock. All six runs passed. This is one paired comparison, not proof that every
small delta is causal; raw increases are reported as well as improvements.

- 5k frontend tags **13.2 → 9.9**, search **16.0 → 16.8**, link refresh
  **41.2 → 45.7** (+4.5 / 11%). Payload parse **0.4 → 0.5**, page **4.7 → 4.8**;
  setup **95.9 → 95.2**. Counts unchanged.
- Group-model 5k tag/formula sort medians **10.353 → 8.434** /
  **9.225 → 10.139**; 50k **94.762 → 93.348** / **169.777 → 166.181**.
  Warm aggregate CPU 5k **12.472 → 10.345**, 50k **109.129 → 110.923**.
- 50k folder grouping browser CPU **125.7 → 123.3**, wall **400.4 → 375.4**,
  max frame **16.8 → 16.7**, 27 DOM rows. Distinct grouping CPU
  **171.5 → 186.4**, wall **552.7 → 613.0**, max frame **16.8 → 16.8**,
  8 DOM rows. Those +14.9/+60.3 ms aggregate increases are retained in the
  report. Largest final slices were 5.1/5.3 ms; the old synchronous aggregate
  selection already takes roughly 104–115 ms, not new K2 UI work.
- Search Table/Grouped/Cards work medians at 5k:
  **6.0/10.6/1.6 → 6.1/9.3/1.5**; at 50k:
  **7.4/57.0/19.5 → 7.9/55.1/20.4**. Upper key-to-paint medians at 50k:
  **24.9/73.3/36.7 → 21.0/71.0/36.7**. Narrowed rows unchanged (199/2,475),
  max frame 16.8 ms, no recorded long tasks in search. Grouped totals span
  scheduled slices; they are not single main-thread tasks.

The complete npm suite also retained B0 5k typing max 16.7 ms, B4 typing/scroll
max 16.8 ms, 1k card scroll max 16.8 ms, 300-card canvas pan/zoom max 16.8 ms,
and B6's 46 native keys max 16.7 ms to painted result. K2 adds no steady UI
work; the new loaded-note and board paths will be wired and measured in K5/K6.

## Scope and remaining work

No product decision is pending for Chris. K5 integration, K6 reconciliation
and K7 fuzz/crash/external-racer tests remain their separately assigned work.
Other-window unsaved-editor races remain approved R4; this command does not
add an editor-wide lock. No UI performance claims are made for unbuilt Kanban.

Behaviour sources were the approved KANBAN_PLAN, migration rules, existing
frontmatter implementation and parity fixtures. No Obsidian code/assets or
new public-help research was used; this task prohibited network access.
No network, GUI windows, pushes, other worktrees, Herdr panes or real vaults
were used. Test vaults were under /tmp. Prompt files, logs and scratch scripts
remain untracked; only explicit task files were staged. Screenshots were
restored before each commit; checkout/commit hooks were disabled as requested.
