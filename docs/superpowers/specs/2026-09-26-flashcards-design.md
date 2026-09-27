# Flashcards: spaced repetition in the Obsidian SR plugin's format

Date: 2026-09-26
Status: design approved in conversation; waiting on review of this spec

## Why

A co-worker of the user reviews flashcards with Obsidian's community **Spaced Repetition** plugin (st3v3nmw/obsidian-spaced-repetition, checked against 1.15.4). They want to do the same in Cinder: write cards inside their notes and review what's due. Their existing cards and review progress have to carry over, and the vault has to stay usable in Obsidian. So Cinder reads the plugin's card syntax and reads and writes its schedule comments, the same way Cinder's Tasks follow the Obsidian Tasks plugin's format.

## Scope

In scope:

- Flashcard review for notes tagged `#flashcards`, with decks from the tag path.
- The plugin's default card syntax: `::`, `:::`, `?`, `??` and `==highlight==` clozes, including the `==1;;answer;;hint==` form.
- The plugin's default scheduling algorithm ("OSR", an SM-2 variant) and its schedule comments `<!--SR:!date,interval,ease-->`, read and written.
- A Flashcards view: decks with due and new counts, and a review screen with Again / Hard / Good / Easy.

Not in scope (possible later rounds, if the co-worker turns out to use them):

- Note review: whole-note scheduling with `sr-due`, `sr-interval` and `sr-ease` frontmatter, and the `#review` queue.
- `**bold**` and `{{curly}}` clozes, which are off by default in the plugin, and overlapping clozes (`==ash;;answer==`).
- The plugin's FSRS algorithm, and its other storage modes: the `> [!sr|card-metadata]` callout, and `^sr-data-id-` blocks kept in plugin data. Cards stored that way are shown as unreadable, never rewritten (see *Unreadable schedules*).
- Plugin settings: custom separators, custom tags, folders as decks, sibling burying, custom end markers. Cinder uses the plugin's defaults.
- Anki import, statistics charts, and cloze typing-in inputs.

## Decisions made while brainstorming

| Question | Decision |
|---|---|
| Whose format? | The Obsidian SR plugin's, with its default settings. The co-worker already uses it. |
| Where does review progress live? | In the note, as the plugin keeps it (`<!--SR:…-->` after each card). A sidecar file would hide progress from Obsidian. |
| Which features first? | Flashcard review, including highlight clozes (on by default in the plugin, so skipping them would drop existing cards). Note review comes later, if needed. |
| Which buttons? | Again / Hard / Good / Easy, as in the plugin's current review screen. (The conversation said Hard / Good / Easy. Reading the plugin showed that it now also has Again, so it's included.) |
| How is it built? | Like Tasks: a pure, Node-tested module `ui/flashcards.js`, plus an app piece `ui/app/flashcards.js` for the view. |

## Design

### Which notes are decks

- A note takes part when it has a tag that is `#flashcards` or starts with `#flashcards/`, in the body or in frontmatter `tags`. Notes in the templates folder are skipped, as they are for Tasks.
- **Deck of a card**, following the plugin:
  - A `#flashcards…` tag in frontmatter sets the deck for the whole note.
  - A `#flashcards…` tag in the body sets the deck for the cards after it, until the next such tag.
  - A tag at the very start of a card's first line, such as `#flashcards/spanish ¿Qué? :: What?`, sets the deck for that card only. The tag isn't part of the question.
  - A card with no deck from any of these goes in the deck of the first `#flashcards…` tag found in the note.
- Deck names are the tag path: `#flashcards/spanish/verbs` is the deck `flashcards › spanish › verbs`. Parent decks count their sub-decks' cards.

### Card syntax

Parsing follows the plugin's `parse()` (src/parser.ts):

- The note is read line by line, with frontmatter excluded, and `\r\n` treated as `\n`. HTML comments other than `<!--SR:` comments are skipped. A fenced code block (```` ``` ```` or `~~~`) inside a card is kept whole and never parsed for separators.
- **One-line cards:** a line containing `:::` gives two cards, one per direction. Otherwise a line containing `::` gives one. A separator inside inline code (odd backticks on both sides) doesn't count. When both would match, the longer separator wins. The card is that line, plus the next line if it starts with `<!--SR:`.
- **Multi-line cards:** lines up to a line that is just `?` (or `??` for both directions) are the question. The lines after it, up to the next blank line, are the answer. A card with an empty question is ignored.
- **Cloze cards:** a line containing `==…==` starts a cloze card, which runs to the next blank line. Its cards follow the `clozecraft` library the plugin uses (0.4.x), with the plugin's default pattern `==[123;;]answer[;;hint]==`. A hint (`==answer;;hint==`) is shown in the gap.
  - **Plain:** when no highlight in the text is numbered, each highlight is one card, in order of appearance. Card *k* hides the *k*th highlight and shows the rest.
  - **Numbered:** when any highlight is numbered (`==2;;answer==`), the text has as many cards as the highest number. Card *k* hides every highlight numbered *k* and shows the others. Unnumbered highlights in that text are left as ordinary highlights, and a number with no highlight still counts as a (blank) card, as in clozecraft.
  - **Overlapping** (`==ash;;answer==`, one letter per card) is out of scope. Such a card counts as unreadable (see *Unreadable schedules*).
- A card ends at a blank line.
- An Obsidian block ID at the end of a card (` ^abc-123`) is kept and not shown.

### Schedules

- **Reading:** a card's schedule is the `<!--SR:…-->` comment that ends it: on its last line, or on the line after a one-line card. Inside it, each `!date,interval,ease` group is one of the card's sides, in order: forward then reverse, or each cloze in order.
  - Dates may be `YYYY-MM-DD`, `DD-MM-YYYY` or `ddd MMM DD YYYY`, as the plugin allows. The date `2000-01-01` means "new" (the plugin's placeholder for a side not reviewed yet).
  - A card with no comment, or with fewer groups than sides, has new sides.
- **Algorithm:** a port of the plugin's `osrSchedule()` with its default settings: starting ease 250, easy bonus 1.3, lapse interval change 0.5, maximum interval 36525 days, load balancing on. For a side with interval *i*, ease *e*, reviewed *d* whole days after it was due (0 if early):
  - **Again:** ease = max(130, *e* − 20), interval 0, due today.
  - **Hard:** ease = max(130, *e* − 20), interval = max(1, (*i* + *d*/4) × 0.5).
  - **Good:** interval = (*i* + *d*/2) × *e* / 100.
  - **Easy:** ease = *e* + 20, interval = (*i* + *d*) × ease / 100 × 1.3.
  - A new side starts from interval 1 and ease 250, with *d* = 0.
  - Intervals are rounded to whole days. Past 7 days, the interval moves within a small window (±1 day up to 21 days, ±5% capped at 3 days up to 180 days, ±2.5% capped at 7 days beyond that) to whichever day has the fewest cards already due. This is the plugin's load balancing.
  - The new due date is today + interval.
- **Writing:** after an answer, only that card's comment changes, rebuilt with every side's group (new sides as `!2000-01-01,1,250`, as the plugin writes them).
  - A card that had no comment gets one on a new line straight after it. This is the plugin's default placement, and required after a code block.
  - An existing comment is replaced where it is, same line or next line.
  - Every other byte of the note is kept, including CRLF line endings and the block ID.
- **Unreadable schedules:** a card whose comment doesn't parse, or uses FSRS (`<!--SR:!fsrs,…`), the metadata callout or `^sr-data-id-`, or that is an overlapping cloze, counts as unreadable. It's listed in its deck ("3 cards use a format Cinder can't read yet") and is never reviewed or rewritten.

### The Flashcards view

- Opens as a view tab (`:flashcards`) in the same way as Tasks. It's reached from a ribbon icon, the command palette ("Review flashcards") and **Ctrl+Shift+Y**.
- **Deck list:** decks as a tree, each showing **due** and **new** counts. Clicking a deck reviews it and its sub-decks. **Review all** reviews every deck.
- **Review screen:**
  - The question is rendered with the reading-view Markdown renderer, so links, images, math and code look as they do in notes. Relative links resolve from the card's note.
  - **Space** or a click shows the answer, below the question for basic cards. A cloze shows its sentence with the hidden part as `[...]`, or `[hint]`, then filled in.
  - **Again / Hard / Good / Easy** buttons (keys **1–4**) each show the interval they would set ("Good · 6 days"). They appear once the answer is showing.
  - **Skip** moves on without saving. **Open note** jumps to the card's line in its note.
  - Order, as the plugin's default: due cards (earliest first, shuffled within a day), then new cards, shuffled.
  - An Again card comes round once more at the end of the session.
  - A counter shows progress ("12 of 30").
- **End of session:** how many cards were reviewed and how many are left for later. A button returns to the decks.
- **Command "Review flashcards in this note"** reviews only the open note's cards. It's also in the note's ⋯ menu when the note has cards.
- **Due count:** the ribbon icon shows a small badge with the number of cards due today. It's hidden at zero.

### Code structure

- **`ui/flashcards.js`** (`CinderFlashcards`), with no DOM access and tested under Node:
  - `parseNote(path, content, frontmatterTags)` returns cards: note path, first and last line, deck path, kind (basic, reversed, multi-line, multi-line reversed, cloze), sides, each side's front and back text and schedule, the location of the comment in the text, and whether it's readable.
  - `schedule(side, response, today, dueCounts)` returns `{ due, interval, ease }`.
  - `writeSchedule(content, card, sides)` returns the new note text.
  - `deckTree(cards, today)` returns the tree with due and new counts.
  - `clozeView(side)` returns the question and answer text for one cloze.
- **`ui/app/flashcards.js`:** gathers cards from `S.notes`, cached against `S.dataGen` as `allTasks()` is. It also holds the view, the review session, the ribbon badge and the commands. It saves the way `modifyTaskLine()` does: through the editor when the note is open, otherwise with `writeFile(path, content, base)`, so version history, conflict checks and the open editor all behave.
- **Before saving**, the app re-reads the note's current text and finds the card again by its original text. The plugin does the same with `MultiLineTextFinder`. If the card has moved, it's written where it now is. If it has gone or changed, nothing is written and a toast says "This card changed since it was shown, so the answer wasn't saved".
- **Wiring:**
  - `src/api.rs` serves `/flashcards.js` and joins `ui/app/flashcards.js` into `/app.js`.
  - `ui/index.html` gets the script tag, the view container and the ribbon button.
  - `ui/tsconfig.json` gets both files.
  - `commands.js` gets the commands.
  - The README gets a Flashcards section.

## Testing

- **`ui/test/flashcards.test.js` (Node):**
  - Every card form, including tags at the start of lines, frontmatter tags, separators inside inline code, code blocks inside cards, skipped HTML comments, block IDs and CRLF. Where possible, examples are taken from the plugin's own parser tests.
  - Reading every date format, the `2000-01-01` placeholder, sides with fewer groups than cards, and each unreadable format.
  - Scheduling: each response for new sides and for sides reviewed on time and late, checked against values worked by hand from the formulas above. Also the ease floor, the maximum interval, and load balancing picking the least-used day.
  - Writing: byte-exact output when adding a comment, replacing one on the same line or the next line, with a block ID, after a code block, and with CRLF.
- **`ui/test/e2e/flashcards.js`:** a vault with several decks and every card form.
  - Opens the view and checks the counts.
  - Reviews cards with each button and checks the `<!--SR:…-->` comments written to disk.
  - Checks that editing a card mid-review stops the answer being saved.
  - Checks "Review flashcards in this note".
- **By hand:** a vault with the co-worker's real cards, if they share some, opened in both Cinder and Obsidian after a review, to confirm Obsidian reads what Cinder wrote.
