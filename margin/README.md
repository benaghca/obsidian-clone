# Margin

A notebook of sentences. There are no titles, folders, or files. You write the next line, and sentences you already kept lean in beside the pen when they share its words.

The sample is a commonplace already in progress — a garden, a dough, and a reading life — so the margin has something to say on the first try.

## Run

From the repository root:

```bash
python3 -m http.server 8765 --directory margin
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

No install and no build. The page is static. What you write stays in this browser's `localStorage`. **More → Take the notebook as text** downloads a Markdown file. **More → Restore the sample** puts the original sentences back.

The memory behind the margin (which sentences surface, which words gather, which questions are still open) is plain JavaScript. Check it with:

```bash
node --test margin/engine.test.js
```

## A way in

The page opens at the pen. Above it, one question is still open. Click it and type something about rain and skin. The margin should offer the sentence that already answered it. Click that sentence, press Enter, and the two lines sit together. **Gatherings** shows the words that have been coming back. **Open** is every question you have not followed yet.
