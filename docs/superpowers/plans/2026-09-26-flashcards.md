# Flashcards Implementation Plan

> **For agentic workers:** executed natively (the user asked for it to be implemented straight away). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review flashcards written in notes, in the Obsidian Spaced Repetition plugin's format, from a Flashcards view.

**Architecture:** A pure module `ui/flashcards.js` (`CinderFlashcards`, no DOM, tested under Node) parses cards, schedules answers and rewrites `<!--SR:…-->` comments. An app piece `ui/app/flashcards.js` gathers cards from `S.notes`, draws the deck list and the review screen, and saves through `writeFile`. This is the same split as Tasks (`ui/tasks.js` + `ui/app/tasks.js`).

**Tech Stack:** Plain browser JS, embedded by `src/api.rs`. Node's `assert` for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-09-26-flashcards-design.md`

## Global Constraints

- The plugin's defaults, exactly: tag `#flashcards`, separators `::`, `:::`, `?`, `??`, highlight clozes `==[123;;]answer[;;hint]==`, base ease 250, easy bonus 1.3, lapse interval change 0.5, maximum interval 36525, load balancing on, new-side placeholder `!2000-01-01,1,250`.
- Never rewrite a card Cinder can't read (FSRS, metadata callout, `^sr-data-id-`, a bad comment, overlapping clozes).
- Byte-exact writes: only the card's comment changes, and CRLF is kept.
- No Node at runtime; nothing new to build.

## Review Focus

1. A note edited while a card is on screen: the answer must not land in the wrong place (e2e: edit on disk mid-review, expect the toast and an unchanged card).
2. Windows vaults with CRLF line endings (unit: parse and write CRLF).
3. A reversed or cloze card whose sides are answered in one session: each save must keep the other side's fresh schedule (unit: two writes in a row on one card).
4. Big vaults: `allCards()` is cached against `S.dataGen`, and only notes with a `flashcards` tag are parsed.
5. Keys typed in inputs (the rename box, the palette) must not rate cards (the key handler ignores inputs and modified keys).

---

### Task 1: Pure module — dates, scheduling, parsing, clozes, writing, decks

**Files:** Create `ui/flashcards.js`, `ui/test/flashcards.test.js`. Modify `ui/tsconfig.json` and `ui/types/globals.d.ts` (`declare var CinderFlashcards: any;`).

**Interfaces (produced):**
- `today(now?) → 'YYYY-MM-DD'`, `addDays(ymd, n)`, `readDate(s) → ymd|null`.
- `schedule(side, response, day?, load?) → { due, interval, ease }`. `side` is `{ due: ymd|null, interval, ease }`, `response` is one of `RESPONSES = ['again','hard','good','easy']`, and `load` is a `Map<ymd, count>` or null.
- `intervalText(days) → string`.
- `parseNote(path, content, { fmLen, fmTags }) → Card[]`, where a Card is `{ path, kind, deck, first, last, body, comment: {line,from,to}|null, sides: [{ front, back, due, interval, ease }], readable, reason }` and `kind` is one of `basic|reversed|multi|multiReversed|cloze`.
- `findCard(cards, card) → Card|null`, matched by kind and body, nearest `first`.
- `setSideSchedule(content, card, index, sched, meta) → { content, card } | null`.
- `deckTree(cards, day?) → { name, path, due, new, unreadable, children }`.
- `reviewQueue(cards, day?, rand?) → [{ card, side }]`, `dueLoad(cards) → Map`, `inDeck(card, deckPath) → bool`.

- [ ] Write `ui/test/flashcards.test.js` covering the spec's Testing section: every card form, decks, dates, unreadable forms, clozes (plain, hint, numbered, gap, overlapping, multi-line, with comment), scheduling (worked values below), writing (add, replace next-line, replace same-line, placeholders, block ID, CRLF, no trailing newline, moved, changed, gone, unreadable, two sides in a row), deck tree, queue order.
- [ ] Run `node ui/test/flashcards.test.js`: it fails (module missing).
- [ ] Write `ui/flashcards.js`.
- [ ] Run the tests: they pass. Run the typecheck (`npm run typecheck` in `ui/editor`): clean.
- [ ] Commit.

Worked scheduling values (day 2024-03-06):
- New side: Good gives 3 days (ease 250). Easy gives 4 (ease 270). Hard gives 1 (230). Again gives 0, due today (230).
- Due 2024-03-02, interval 4, ease 250 (4 days late): Good gives 15. Easy gives 28 (270). Hard gives 3 (230).
- Due 2024-03-10, interval 4 (early): Good gives 10.
- Interval 3, ease 140: Hard gives 2 (ease 130).
- Interval 30000, ease 300: Good gives 36525.
- Load balancing, interval 10 (target day 03-16): with loads {03-16:5, 03-15:2, 03-17:1} it gives 11. With {03-16:5, 03-17:1} it gives 9 (03-15 is empty).

### Task 2: Wiring and the deck list

**Files:** Create `ui/app/flashcards.js`. Modify:
- `src/api.rs`: `FLASHCARDS_JS`, the `/flashcards.js` route, `APP_JS` (after `inbox.js`), and the served-paths test.
- `ui/index.html`: the script tag after `tasks.js`, the `#view-flashcards` container, and a ribbon button with `data-cmd="flashcards"` and a badge.
- `ui/app/navigation.js`: the view list.
- `ui/app/tabs.js`: `viewKey`, `tabName` and `openKey` for `:flashcards`.
- `ui/app/actions.js`: `flashcards` and the note-menu item.
- `ui/app/commands.js`: `flashcards` (Mod-Shift-y) and `flashcards-note`.
- `ui/app/vault-index.js`: refresh on change.
- `ui/app/boot.js`: the initial badge.
- `ui/style.css`, `ui/tsconfig.json`.

**Interfaces:** `allCards() → Card[]`, cached on `S.dataGen`. `cardMeta(n) → { fmLen, fmTags }`. `updateCardBadge()`. `openFlashcards({ note? })`. `renderDecks()`.

- [ ] E2e `ui/test/e2e/flashcards.js`, first part: a vault with Spanish (frontmatter deck), Science (body tag, cloze, a card due today, a placeholder) and FSRS (unreadable) notes. It checks the badge count, the deck tree with due and new counts, the unreadable note, and that Ctrl+Shift+Y opens the view. Run it: it fails.
- [ ] Implement the wiring and the deck list. Run: it passes. Commit.

### Task 3: Review session and saving

**Files:** Modify `ui/app/flashcards.js` and `ui/style.css`, and extend the e2e.

**Interfaces:** `startReview(filter, title)`, `showCard()`, `revealAnswer()`, `rateCard(response)`, `saveCardSchedule(card, side, next) → Card|null`, `endReview()`.

- [ ] E2e, second part:
  - Review the Science deck with the keyboard (Space, then 2). The due card comes first and gets `!today+10,10,250` on disk.
  - Answer Again once, and that card comes back at the end.
  - The end screen shows the count.
  - A card edited on disk mid-review gets the toast, and its file is unchanged.
  - "Review flashcards in this note" from the note menu reviews only that note.
  - Run: it fails.
- [ ] Implement. Run it, plus the tasks, keys and tabs suites: they pass. Commit.

### Task 4: README and merge

- [ ] Add a README Flashcards section (formats, decks, keys, what Cinder can't read yet). Run the unit tests, the typecheck, `cargo test`, and the flashcards, tasks, keys and tabs e2e suites. Merge to `main` and push.
