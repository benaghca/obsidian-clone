# LINKS-EMBEDS-EDGE-TESTS

Branch `rebuild/links-embeds-edge-tests-grok`, from `b5cffcb` (`Merge branch 'rebuild/kanban-edge-review-grok' into rebuild/integration`). Local commit only. Nothing pushed.

Product code is unchanged. Nothing under `rebuild/app/src/` was edited, and `rebuild/app/package.json` was left as it is. No new packages or crates. No Obsidian code or assets. No filesystem vault: the node script loads pure functions through Vite SSR, and the browser script uses the in-memory mock vault. Notes created there are named `Zzledge*` so they do not collide with the sample vault. Chris's vaults, `/tmp/grove-playground`, and `~/grove-compare-vault` were not opened.

The scripts do not call `shot()`. `rebuild/round*-shots/` was already clean, so there was nothing to restore.

## What changed

| File | Lines |
| --- | ---: |
| `rebuild/app/scripts/test-links-embeds-edge.mjs` | 450 |
| `rebuild/app/scripts/test-links-embeds-edge-browser.mjs` | 357 |
| `rebuild/app/scripts/links-embeds-edge-cm.ts` | 5 |

`links-embeds-edge-cm.ts` re-exports `EditorState` and `ensureSyntaxTree` through Vite's module graph. A direct `ssrLoadModule("@codemirror/state")` is a second copy, and `EditorState.create` then rejects `markdownSyntax`. The helper is loaded only by the node script.

## Node script

`test-links-embeds-edge.mjs` loads the link, embed, callout, table, tag, and date modules and checks them without a browser. 131 PASS. Fuzz seed `20261031` (mulberry32).

- Wikilinks and markdown links: aliases, headings, `#^` block refs, same-note headings, percent-encoding (`%`, space, parentheses; `é` stays as written), clashing names, paths that climb out of the vault, a broken `%ZZ`, a hashless `Note^id` (a name, not a block ref), `./` paths, and escaped parentheses.
- The resolver cache: a same-length in-place replace keeps the old index; a push builds it again.
- Renames: seven links outside code are rewritten. Aliases, headings, and `#^` survive. A now-redundant alias stays written. Inline code and both fence markers stay literal. A second pass changes nothing. An unclosed fence protects the rest of the note. Turning the markdown-link setting on does not convert an existing wikilink.
- Embeds: subpath split, size parsing (a zero size, a third dimension as alt text, the size after the last pipe), a heading section that skips a fenced copy and stops at the next same-level heading, case-insensitive headings, an inline block id, a standalone id above a paragraph, pipes dropped from a heading match, frontmatter skipped by a whole-note embed, self-embed and cycle chips, and depth.
- Callouts: every alias in the kind table, an unknown type drawn as a note, a title against the bracket, `++` leaving the second character as the title, two spaces after `>` not a header, a tab counting as the one optional space, a non-ascii type, and a body that keeps a table plus a lazy line.
- Tables: escaped pipes, a lone `:` counting as center, ragged rows padded, a stable format roundtrip, last row and last column refused, Tab adding a row, sort keeping the header, cell input turning `|` into `\|` and a newline into `<br>`, and the delimiter-row caret counting as the header.
- Tags: `#123` dropped, `#1a` kept, `##double` not a tag, frontmatter before body, fences and inline code skipped, a BOM plus legacy `tag:`, wikilink targets, and a case-folded tag tree.
- Daily-note dates: 29 February 2024 round-trips, midnight is `12:00 AM`, noon is `12:00 pm`, 1 January 2021 is ISO week 53, 1 January 2020 is week 1, `MM-DD` does not order notes, `YYYYMMDD` parses, and template variables fill title, date, time, and a one-off format (spaces inside `{{ }}` ignored).

Fuzz, all of which passed: 400 rename notes (804 links rewritten, fence bodies and inline code unchanged, second pass count 0), 200 embed notes, 80 table edit sequences (rectangular, format/parse keeps cells and alignment), 100 tag texts, 60 callout lines, 40 real-day format round-trips, 300 resolver results (null or a path from the snapshot).

## Browser script

`test-links-embeds-edge-browser.mjs` drives headless Chromium through `scripts/browser.mjs` at 1280×900. 48 PASS. No screenshots.

- Seven top-level embeds on `ZzledgeHost.md`: the whole note (frontmatter omitted, the note continues after a rendered fence), the `Second` heading (stops before `Later`, ignores the fenced copy), the `#^zzbid` paragraph without the id, a missing heading, a missing-note chip, a self-embed chip, and a cycle that chips the way back.
- Alias, heading, and unresolved wikilinks render with the expected `data-href`. A `[-]` warning starts collapsed in orange. An unknown `[+]` callout starts open and looks like a note. Clicking a title toggles the fold and leaves the note bytes unchanged.
- Table cells keep left and right alignment. Reading mode keeps the same seven embeds. Clicking the block ref opens `ZzledgeTarget.md` on `Section body`.
- Typing `[[Zzledge sec` offers the alias `Zzledge secret` with detail `ZzledgeTarget`.
- The tags pane lists `#zzledge/alpha`, `#zzledge/live`, and `#zzledge-body`, and omits the fenced and inline-code tags. Clicking alpha fills the search box with `tag:#zzledge/alpha`.
- Daily notes: an existing `YYYY-MM-DD` file opens unchanged; previous and next walk yesterday, today, and tomorrow. `YYYYMMDD` creates the missing note from `ZzledgeTemplates/Day` (`# 20261031`, the ISO date, the time, and Saturday). Previous is refused until that neighbor exists. `MM-DD` creates today's file and both neighbor commands return false.
- With `alwaysUpdateLinks` off, renaming `ZzledgeTarget.md` to `ZzledgeRenamed` asks `Update links?`. Confirming rewrites the alias, the heading, the block ref, the markdown link, and the heading embed. Inline code and the fence keep `ZzledgeTarget`. The missing link stays missing. Reopening the host shows the embed title `ZzledgeRenamed`.

## Timings

Node medians, five runs (date and template, twenty). `0` is under 0.01 ms after rounding.

| Work | Median ms |
| --- | ---: |
| `resolveLink` of one name in 4000 notes | 0 |
| `resolveLink` of a missing name | 0 |
| `linkTargets` for a shared name | 1.70 |
| rewrite 200 links | 0.43 |
| embed section among 300 headings | 0.09 |
| `tagsInText` of 2000 tags | 0.17 |
| `tagTree` of that set | 2.87 |
| format/parse a 100×8 table | 0.35 |
| `formatDate` | 0 |
| `fillTemplate` | 0 |

Browser frames are `requestAnimationFrame` gaps with the first two dropped, plus `PerformanceObserver` long tasks. The cap is 50 ms. Both samples stayed on the headless frame time.

| Sample | Frames | Max ms | p95 ms | Median ms | Long tasks over 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Typing 20 characters into the live host | 41 | 16.8 | 16.7 | 16.7 | none |
| Switching six notes | 14 | 16.8 | 16.8 | 16.7 | none |

`ws.open` plus two animation frames, in order `ZzledgePlain`, `ZzledgeTarget`, `ZzledgeHost`, `ZzledgeCycle`, `ZzledgeScratch`, `Welcome`: 32, 33, 34, 33, 33, 33 ms.

## Bugs

Recorded, not fixed.

1. `embed-first-line-block`. A standalone `^id` on line 1 makes `embedSection` return null (`if (!at) return null`). `headingPos` returns 0. An embed of that block says it is missing. Following the link lands on the id line.
2. `embed-depth-off-by-one`. `embedStopped` chips when `chain.length >= 5`. The chain lists notes already drawn and does not include the embed being drawn, so the sixth nested embed is the first chip. The file comment says five embeds deep.
3. `daily-date-rollover`. `dateNamePattern` builds `new Date(y, mo, d)` and does not check the calendar. `2026-02-29` parses as 1 March 2026, so it collides with a real `2026-03-01` daily note. `2026-13-40` rolls into 2027, the same instant as `new Date(2026, 12, 40)`.

## package.json line to add later

`test` currently ends with `node scripts/test-search-commands.mjs`. Append the two scripts. The helper is loaded by the first one.

```
&& node scripts/test-links-embeds-edge.mjs && node scripts/test-links-embeds-edge-browser.mjs
```

## Commands

From `rebuild/app`, under the lock. Both exited 0.

```
flock /tmp/grove-npm-test.lock node scripts/test-links-embeds-edge.mjs
flock /tmp/grove-npm-test.lock node scripts/test-links-embeds-edge-browser.mjs
```

The full `npm test` chain was not run. These scripts are not wired into it, and `src/` is unchanged.
