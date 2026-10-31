# Kanban K7 review

VERDICT: OK

This verdict includes the review fixes below. Merge this review branch.

Review branch: `rebuild/k7-review-codex`, created from
`rebuild/kanban-k7-grok` (`b422563`, implementation `d00405f`), based on
integration `9fee64d`. Grok's branch is unchanged. Nothing was pushed.

## Findings and fixes

K7 stays within tests-only scope. The product `set_property`, TS editProperty,
transport, UI and dependency lists are unchanged by K7 or this review.
package.json only appends the short TS fuzz to posttest. The native hook and
test-module registration are explicitly cfg(test). The tests use the existing
writer, including K2 review's durable/property-only directory sync.

The original tests had useful differential coverage, but three gaps warranted
fixes on this branch:

1. **An injected error is not a terminated process.** Original crash hooks
   return Err and bypass temp cleanup, then set_property returns through its
   normal error/index-refresh path. Those tests remain useful for that error
   handling, but they alone did not exercise a dead writer or real dead PID.
   Added a test-only process-exit mode and a child test process at each hook.
   It exits with code 86 without unwinding, returning to the writer, or running
   Rust cleanup. Parent checks exact old/new note bytes and complete temp bytes,
   then reopens the vault to sweep the actual dead child's temp. No fake PID
   rename is needed in this new test. The live parent's valid temp and three
   similarly named user files must survive with exact bytes. These are process
   interruption tests, not a simulation of cutting power to the filesystem.
2. **The race checked only the last document and discarded edit errors.** A
   torn intermediate file could be replaced by a good file before the final
   check, and a broken command returning errors throughout could pass. It now
   reads while the writer is active, accepts only the two complete racer
   documents or the complete edited document, and rejects unexpected errors or
   refusals. It stops and joins the writer before reporting sampled failures.
   It still requires at least 20 Grove edit attempts and 20 external writes.
   A 20-second outer deadline replaces the original 3-second deadline to avoid
   treating a temporarily busy real disk as a correctness failure; the counts
   and byte assertions are retained. Normal runs finish well below one second.
3. **Differential agreement could hide matching incorrect outcomes.** Added
   independent expected statuses to fixed and generated cases and require a
   change exactly for done results. The original non-done text check selected
   the input by construction; now an unexpected change cannot be hidden there.
   Successful existing-property edits also reconstruct the expected splice
   from raw before/after lines and compare the entire output, preserving every
   outside byte. Full body suffix and sibling line/EOL checks replace marker-
   only/substring-only checks. Missing-key random cases now check their sibling
   too. Default large body grows from 64 KiB to 1 MiB, with a fixed over-limit
   frontmatter case and more generated quote/punctuation/Unicode/newline values.

Commits:

- `ddba88f`: process-exit crash coverage, intermediate race reads, stronger fuzz.
- `4e8e400`: reject masked read/edit errors in the race.

Review code changes: **3 files, +233/-29** (`edit_fuzz.rs`, `fsutil.rs`,
`scripts/fuzz-property-edit.mjs`), including rustfmt of the new test module.
This notes file is additional. No product bug was found or product fix made.

## Release isolation

Read every hook declaration, flag, access, branch and cleanup exception: each
is cfg(test), as is `mod edit_fuzz`. Thread-local state prevents one parallel
test from arming another thread's write, and the flag fires once. Existing
error-injection tests disarm on scope exit. The new exit mode is armed only in
the child process test. There is no product environment-variable crash switch.

Independently ran `cargo build --release --offline` and checked all **16 compiled
object members** in `target/release/libgrove_lib.rlib`, its defined symbols,
and the `target/release/grove` executable. None contain the injected error
strings, crash environment name, hook functions, hook state or edit_fuzz code.
The rlib's **metadata** retains some source identifiers (crash_process_at and
take_crash); scanning the archive as a whole for every name therefore produces
a false positive. No corresponding object code or defined symbol is emitted.
The final race-only assertion change is inside the excluded test module.

## Differential coverage and scratch safety

Seed remains **0x6b37 / 27447**, with no time or entropy input. Five consecutive
short --json runs had identical SHA-256
`cc1f3c006e33d76c7bfc7c2c8093f41462e479e66df240a7e8a9d6a427511bdf`.
Default run still has 48 cases (now 27 fixed plus 21 generated). Rust invokes
the actual TS reference script, deserializes its input/edit/result, independently
runs edit_property, and compares status, before/after/current/reason and the
**entire UTF-8 output string byte-for-byte**. JSON escaping does not normalize
CRLF or Unicode. mtime and props are not part of this differential comparison;
K2's focused tests cover those metadata contracts.

Coverage includes BOM, CRLF and their combination; plain/single/double quotes,
quoted keys, flow/block lists, comments between properties versus refused
comments inside values, exact/case-variant duplicates, Unicode, number/checkbox/
date, empty/missing/no-frontmatter/no-EOF cases, raw restore/removal, conflicts
and idempotence. Huge input is 1 MiB by default; 2,001 comment lines exercise
the frontmatter cap. A separate native test writes invalid UTF-8 bytes and
requires refusal and exact byte identity. Invalid UTF-8 cannot be a JSON string.

Both extended **Rust-versus-TS** runs passed: 2,000 cases, and a 16 MiB body
whose complete note exceeds the byte cap and must be refused. The pure TS
2,000-case run separately took 78 ms. K7 is a deterministic bounded generator,
not an exhaustive YAML grammar fuzzer; K2's 100-case authored corpus still runs.

Crash/race/invalid-byte test files are below this worktree's
`src-tauri/target/k7-scratch`, confirmed ignored by src-tauri/.gitignore.
The disk detector reported **btrfs**. These tests reject tmpfs/ramfs/devtmpfs
when identified, and use only their own PID/counter subdirectories. Scratch
directories are removed by their owner. Child paths are canonicalized and
required to remain under the scratch root. Test invocations use fixed arguments,
never a shell command containing a note or path value. The scratch baseline
archive and measurement script are also below this ignored target directory;
it is not another git worktree. Existing tests/P6 use /tmp scratch vaults.
No real vault, other worktree, Herdr pane or GUI window was used.

The race deliberately uses complete atomic external replacements. An external
program doing non-atomic partial writes, power failure, and R5's final
stat-to-rename lost-update window remain outside its guarantee. The assertion
is whole-document membership, not proof that every possible race interleaving
or hardware failure was exercised.

## Performance

P6 command: `cargo test --release --offline --lib set_property_bench -- --ignored`.
The first run passed; reran with test output uncaptured to obtain the numbers.
No threshold or fixture was changed. This existing harness uses /tmp (tmpfs)
and subtracts measured fsync time, as the P6 budget specifies.

- 10 KB median/max excluding fsync: **0.0622/0.0746 ms**. K2 notes:
  0.0619/0.2010; K7 builder: 0.0626/0.0860. Median is +0.0003 ms (+0.5%)
  versus K2, -0.0004 versus K7: no material regression, within 2 ms.
- 1 MB median/max excluding fsync: **2.9536/3.3762 ms**. K2 notes:
  2.9917/3.6409; K7 builder: 3.1015/3.4029. Median is -0.0381 ms (-1.3%)
  versus K2 and -0.1479 (-4.8%) versus K7, within 5 ms.
- Wall medians including fsync: **0.0628/2.9543 ms** on tmpfs. These do not
  replace the K2 review's real-disk durable-write figures. Crash/race coverage
  ran on btrfs, where sync is not effectively free.

Posttest's added CLI cost, five warm process runs per variant: original K7
median **51.97 ms** (49.01–53.28); review **58.83 ms** (57.19–60.19).
Thus K7 adds about **59 ms** to the pre-K7 npm suite, and these stronger checks
add about **6.9 ms** versus Grok's script. This includes Node startup and runs
outside the app; it is not a >50 ms UI task. Existing browser scripts and
production UI paths are unchanged.

Warm paired Cargo measurement, same cached target/dependencies, baseline
source/fixtures archived from 9fee64d under ignored scratch:
**0.2926 s before K7 → 0.5521 s review**, +0.2595 s wall. Test harness work
was 0.06 → 0.33 s; other successful full/focused review runs were 0.41–0.68 s,
showing disk scheduling variability. The review rebuild in the paired run
took 7.17 s including compilation; compilation is not charged as steady test
overhead. A final-source warm run was **0.5415 s**, +0.2489 s versus baseline,
with 0.28 s in the test harness. The first scratch baseline attempt lacked parity fixtures; supplying
the archived fixtures corrected that setup failure without changing a test.

## Full checks

- `npm run build`: passed under the shared lock; existing Vite chunk warning.
- `npm run audit:offline`: passed under the lock, **177 source files**, dist,
  CSP, capabilities and dependencies; also rebuilt successfully.
- `cargo build --offline`: passed on final source, including under the shared lock.
- `cargo test --offline`: **73 passed, 0 failed, 4 ignored**, bin/doc tests
  passed, including a final locked run (0.27 s harness work). The added ignored test is the subprocess-only helper; its parent
  explicitly runs it twice. The existing three ignored tests are unchanged.
- `cargo build --release --offline`: passed; release-hook checks above passed.
- Release P6, long differential and over-byte-cap differential: passed.
- Full `flock /tmp/grove-npm-test.lock npm test`: **exit 0**, **69 files /
  1,222 tests**, **2,049 PASS lines**, all browser/geometry/real-pointer scripts
  and posttest completed. Wrapper wall time was **580 s including lock wait**;
  the added fuzz's isolated ~59 ms is its measured contribution, not a paired
  whole-suite runtime claim. Final posttest printed the expected 48 cases,
  seed 27447, 1 MiB body and outcome counts (39 done, 4 refused, 1 conflict,
  4 unchanged).

Browser performance retained: 300-card drag max **16.8 ms**, 1,000-row scroll
max **16.7 ms**, 1,000-card grid max **17.4 ms**, and B6's 46 key-to-paint
measurements max **18 ms**. K3's 1,000-group menu opened on frame 1, with
16.8 ms max frame and 16.7 ms p95 drag frames. Collapse/expand at 10,000 rows
painted next frame, with median work **3.0 ms table / 3.7 ms cards**, no long
tasks recorded in that check. All assertions passed. The 17.4/18 ms raw maxima
are above 16.7 ms but within the existing test thresholds; these tests-only
changes add no app/UI work, and this is not evidence of a causal UI regression.

No npm source or test-script edits were made during the full browser run.
The final Rust-only race assertion was rechecked with full Cargo build/tests;
Vite ignores src-tauri. No timing-flake retry was needed.

## Disposition

All required checks passed. No product decision is pending for Chris.
Merge this review branch for the stronger tests, not Grok's branch
alone. No new packages/crates, network use, Obsidian code/assets or fresh public
help lookup. Behaviour sources were KANBAN_PLAN §§4.3–4.7, R3/R5, D4/D10/D15,
K2/K7 notes and the K2 review. Git used hooksPath=/dev/null throughout the review;
no Git hook scripts ran. Prompts, logs and measurement scripts are not committed.
Screenshots are restored before every commit. Never pushed.
