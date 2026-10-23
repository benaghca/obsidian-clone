# Round 21 — Part A: web rich text as Markdown

Worktree `grove-r21-codex`, branch `rebuild/r21-codex`; baseline `1543bd7`.
Local commits only; nothing pushed or merged. Part B is untouched, including
its URL-paste caret change.

## Built and reused

- `d951ace`: a dependency-free DOMParser tree walker in
  `src/editor/htmlToMarkdown.ts`, now **98 lines**, covering the requested
  inline formatting, language fences, links, nested/numbered/task lists,
  headings, quotes, paragraphs/divs/breaks, rules, images and simple tables.
  Literal code survives whitespace cleanup; nested lists use four spaces.
  Scripts, styles, comments, Office `o:p` and `mso-list:Ignore` markers are
  discarded. A Google Docs normal-weight `b` wrapper adds no bold markers.
- Reuse `clipboard.ts` and its context-menu clipboard fallback, registering
  one CodeMirror paste handler in the existing note state. Reuse
  `frontmatterField` and the Markdown syntax tree to protect YAML and code;
  ordinary plain-text paste still goes through CodeMirror, retaining its
  linewise and multi-selection behavior. Ctrl+Shift+V uses the existing
  plain-text clipboard helper, including for a URL over selected text.
- Reuse the settings schema, Editor toggle rows and cached CodeMirror
  configuration compartments. **Auto convert HTML** defaults on, persists
  through the existing per-vault store, and applies to open notes.
- Rich paste uses `replaceSelection`, `input.paste` and `isolateHistory`:
  one undo step, caret after the entire insertion. Reading stays read-only.
  There is no converter, document scan or new transaction listener on the
  ordinary typing path; conversion runs only on paste. No layout, CSS,
  backend command, dependency, permission or network behavior was added.
- `e5dfeec`: converter unit cases in Chromium's real DOMParser, plus trusted
  native clipboard integration tests, using the existing scratch-vault CDP
  driver. They run in `npm test`; no DOM shim or test dependency was added.
- `4314f45`: keep multiline unformatted editor wrappers as exact plain text;
  share URL-selection behavior between native paste and its async fallback;
  bypass HTML when an async clipboard item carries an image.

The supplied tree had **no URL-over-selection paste handler** despite the
brief describing one. Part A adds `[word](url)` with only `word` selected,
the convention specified for the pre-Part-B behavior. Changing that caret
is deliberately deferred to Part B.

**Attachment baseline limitation:** this tree also has no clipboard-file
attachment importer or backend command for writing attachment bytes. Native
file-bearing clipboards bypass the converter, preserving CodeMirror's
existing plain-text behavior; the async clipboard path also skips HTML for
images. A real PNG + HTML + plain-text ClipboardItem regression confirms the
bypass. This round does not claim that clipboard files are saved as
attachments, and does not introduce a new attachment subsystem. The
brief's assertion that this feature already exists does not match the
provided baseline.

## Obsidian observations

Observed Obsidian **1.14.4** with headless Ozone, private HOME/XDG/profile
folders and a scratch vault under this worktree's ignored
`rebuild/app/node_modules/.round21/`. It ran in `unshare -Urn` with only
loopback enabled: external network access was impossible. Clipboard HTML
was written using Electron's clipboard API and pasted using CDP native
Ctrl+V. Only rendered UI and the public active editor API were inspected;
no Obsidian implementation, styles or assets were copied. No visible
window, Tauri instance or owner's real vault was opened.

The brief's paragraph + list + heading produced exactly:

```md
From a web page: **important** point, see [the docs](https://example.com/doc).

- first
- second

## Heading
```

A combined punctuation/inline-code/list/quote/fence/table fixture produced
exactly (the code fence inside this excerpt has its original three ticks):

````md
Literal *star* _under_ [square] # hash !bang a.b 1. one + plus - dash \path | pipe ~tilde~ & two spaces.

_italic_ ~~strike~~ ``a`b`` [https://example.com](https://example.com)

3. three
    - nested
4. four

> quote
> 
> > inner

---

```js
  let x = 1;

  // hi
```

|A|B|
|---|---|
|a\|b|c|
````

Grove matches the observed italic marker, literal punctuation, four-space
nesting, quotes, code whitespace and compact table formatting. One explicit
brief requirement differs from that reference: Grove emits a **bare URL**
when an anchor's label equals its href; Obsidian emitted the wrapped link
shown above.

The Google Docs/Word/tasks/image/break fixture produced this exact opening
text in Obsidian:

```md
**

Docs bold Docs italic **strong** _em_

**

Word **bold** 
```

Here `Docs bold` and `Docs italic` came from styled spans inside the
normal-weight Google Docs `b` wrapper. Obsidian added stray wrapper markers
and retained the Office `o:p` nonbreaking space after `bold`. Grove follows
the brief: it drops those wrapper markers and Office junk. Styled spans
otherwise unwrap to their text; arbitrary CSS is not translated.
The remainder was exactly:

```md
- [ ] todo
- [x] done

# heading literal

1. literal item

- literal bullet

![remote](https://example.com/pic.png)

line  
break
```

The final line break has two spaces before its newline. Grove preserves
that break and the remote image URL as Markdown; the existing offline image
chip renders it without loading an image. Unformatted paragraph/div/editor
wrappers use the original plain clipboard text, preserving indentation and
line breaks instead of manufacturing Markdown paragraph spacing.

## Verification

- `npm run build`: passed.
- `npm test`: passed: **4** browser-discovery tests, **230** TypeScript
  unit tests in **41** files, all five existing headless browser suites,
  and the new paste suite (**37** converter unit cases and **29** additional
  named checks). The permanent geometry suite retains line tops within
  **1px**, zero direct-child vertical margins, and stationary fold/unfold
  clicks. Prompts/menus appeared within two frames, with no sampled opening
  frame over 20ms; longest sampled frame **17.1ms**.
- `npm run audit:offline`: passed, including release build and **130** source
  files, release output, CSP, capabilities and dependency checks.
- `cargo build` and `cargo test`: passed; **32** Rust tests.
- `git diff --check`: passed.

The paste suite includes **37 converter unit cases** and native integration
checks in Live Preview and Source on a note with frontmatter: both clipboard
types, caret, undo, Reading rendering, plain paste, disabled conversion,
code/frontmatter protection, unformatted editor wrappers, URL selections,
context-menu paste, read-only Reading, file bypass and actual toggle clicks.
Browser tests use native CDP pointer/key input, moving over each control
before pressing. No DOM `.click()` or synthetic paste dispatch is used.
Grove uses headless Chromium, private profiles and its in-memory mock vault.

## Net tracked app lines

Same newline convention as the brief: tracked files under `rebuild/app`,
excluding `/gen/`; JSON and mjs counted separately. Versus `1543bd7`:

- Production TypeScript: **19,433 → 19,611 (+178)**.
- TypeScript tests: **3,047 → 3,047 (0)**; converter unit cases run in the
  browser mjs suite to use the actual DOMParser without adding a dependency.
- TypeScript total: **22,480 → 22,658 (+178)**.
- CSS: **3,733 → 3,733 (0)**.
- Rust: **3,104 → 3,104 (0)**.
- TS/CSS/Rust total: **29,317 → 29,495 (+178)**.
- JavaScript mjs tests/tools: **1,513 → 1,676 (+163)**.
- JSON: **2,229 → 2,229 (0)**; only the test command changed.
- Total including mjs/JSON: **+341** lines. Production TS/CSS/Rust: **+178**.

## Next improvements

- Clipboard-file attachment importing: make image/file paste actually save
  bytes into the vault; medium, requiring a backend byte-write command and
  existing path/offline safeguards.
- Translate selected inline span styles from document editors: preserve
  Google Docs' styled bold/italic spans too; small, roughly 20–40 lines plus
  fixtures, with code-editor wrapper regressions.
- Explorer-to-note dragging: insert a file link using the existing pointer
  drag machinery; medium, reducing manual link insertion.

Part A complete with the attachment baseline limitation documented above.
Stop here; Part B requires a separate message.

# Part B — three small fixes

Baseline: completed Part A, `ad0480b`; same worktree and branch. Local
commits only. The later explicit Part B request supersedes the initial
Part-A-only stop instruction.

## 1. Folding at the absolute bottom: observation, no production change

Observed Obsidian 1.14.4 again with headless Ozone, a new private HOME/XDG/
profile and scratch vault under ignored `node_modules/.round21b`, inside
`unshare -Urn` with only loopback. The frontmatter note contains 160 lines
before a final H2 and eight body lines. At 1280×800, scroll all the way to
the bottom, move onto the fold arrow, click, then click again at exactly
the same coordinates with no intervening mouse movement.

Obsidian clamps its scroll position and the heading moves down:

- Source: **163.05 → 379.05px (+216px)**; scrollTop **3883 → 3667**.
- Live Preview: **147.23 → 363.23px (+216px)**; scrollTop **3910 → 3694**.
- Reading: **155.14 → 363.14px (+208px)**; scrollTop **3918 → 3710**.

The stationary second click misses and leaves the section folded in every
mode. Obsidian already reserves half a viewport below editing content;
that does not prevent clamping at the absolute bottom. Grove reproduces
the same behavior: **+171px Live Preview**, **+192px Source/Reading** in
this fixture (its font/line geometry differs). Moving to the relocated
arrow unfolds normally.

Per the brief's explicit observation gate, **no production folding or
padding change was made**. `scripts/test-round21b.mjs`, wired into
`npm test`, verifies these three cases in every mode with real CDP mouse
input; nine named checks pass. Existing stationary fold/unfold behavior
away from the clamping boundary remains covered by the geometry suite.

## 2. Quick switcher: recent-only empty list and Tab completion

Restrict the existing empty-query loop to the recent paths (deduplicated,
missing/excluded paths skipped, active note excluded); fuzzy queries still
search every included note. The shared prompt passes its existing
`setQuery` function to the optional key callback. Quick switcher Tab fills
the selected name and keeps input focus, without opening; Tab with no
result stays in the input. Shift+Tab retains ordinary focus traversal.
The footer includes the Tab hint. Merge's shared helper is supplied all
note paths after recents so its pre-existing full note list stays intact.

Four switcher unit tests pass. The browser suite adds seven checks in each
of Live Preview, Source and Reading on frontmatter notes: native explorer
clicks establish recency, mouse hover chooses a non-first result, native
Tab/Enter complete and open, a fuzzy query finds an unopened note, and an
empty history stays empty. Nine bottom-fold checks still pass.

Additional Obsidian observation: native Tab completed the selected `Test`
row into the input and kept focus there without changing the active file.
Its public recent-file list in this scratch profile also contained newly
created files; Grove follows the brief's explicit recently-*opened* rule
and retains its existing exclusion of the active note.
