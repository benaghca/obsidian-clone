// R2 S1: an outside change to an open, clean note keeps the cursor and the
// scroll position, and Ctrl+Z afterwards does not bring the old text back or
// write it over the synced file. Headless, on the mock vault.
import { withBrowser, sleep } from './browser.mjs';

const PATH = 'Reload S1.md';
const body = Array.from({ length: 400 }, (_, i) => `Line ${i} with some words in it`).join('\n');

await withBrowser(async ({ run, open, check, chord, send }) => {
  await open(PATH, body, 300);
  // Caret on line 200, column 5, scrolled so that line is in the middle of the pane.
  const place = await run(async () => {
    const group = ws.activeGroup, view = ws.editors.viewOf(group);
    const line = view.state.doc.line(201);
    view.focus();
    view.dispatch({ selection: { anchor: line.from + 5 } });
    ws.editors.glide(group, line.from);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { scrollTop: view.dom.closest('.view-content').scrollTop };
  });
  check(place.scrollTop > 1000, `the note is scrolled down (${place.scrollTop}px)`);

  // Your own edit first, saved before any sync arrives.
  await send('Input.insertText', { text: 'Q' });
  await sleep(600);

  /** Where the caret and the top of the pane are, by the text they are on. */
  const where = () => run(() => {
    const group = ws.activeGroup, view = ws.editors.viewOf(group);
    const head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
    const top = ws.editors.topLine(group);
    return {
      caretLine: line.text, column: head - line.from,
      topText: top === null ? null : view.state.doc.lineAt(top).text,
      scrollTop: view.dom.closest('.view-content').scrollTop,
      doc: view.state.doc.toString(),
    };
  });
  const sync = (text) => run(async (path, text) => {
    const { api } = await import('/src/api.ts');
    await api.writeNote(path, text); ws.vault.written(path); await ws.editors.reload(path);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, PATH, text);

  const start = await where();
  check(start.caretLine === 'Line Q200 with some words in it' && start.column === 6, 'the caret sits after the typed letter');
  check(start.topText !== null, `a line is at the top of the pane (${start.topText})`);
  check(await run((path) => !ws.editors.hasUnsaved((p) => p === path), PATH), 'the typed letter is saved before the sync');

  // A sync inserts three lines above the caret and the visible part.
  let disk = start.doc.replace('Line 5 with', 'synced a\nsynced b\nsynced c\nLine 5 with');
  await sync(disk);
  let now = await where();
  check(now.doc === disk, 'the editor shows the synced text');
  check(now.caretLine === start.caretLine && now.column === start.column, 'an insert above keeps the caret on its own text');
  check(now.topText === start.topText, `an insert above keeps the same line at the top of the pane (${now.topText})`);
  check(now.scrollTop > start.scrollTop, 'the pane scrolled down by the inserted lines, so nothing visible moved');

  // A sync inserts below the visible part.
  const before = now;
  disk = disk.replace('Line 390 with', 'synced below\nLine 390 with');
  await sync(disk);
  now = await where();
  check(now.doc === disk && now.caretLine === before.caretLine && now.column === before.column, 'an insert below keeps the caret');
  check(Math.abs(now.scrollTop - before.scrollTop) <= 1 && now.topText === before.topText, 'an insert below keeps the scroll position');

  // A sync edits the caret's own line on both sides of it.
  disk = disk.replace('Line Q200 with some words in it', 'LINE Q200 with some words in it, and more');
  await sync(disk);
  now = await where();
  check(now.doc === disk && now.caretLine === 'LINE Q200 with some words in it, and more' && now.column === 6, "an edit on the caret's line keeps its column");
  check(Math.abs(now.scrollTop - before.scrollTop) <= 1, "an edit on the caret's line keeps the scroll position");

  // Ctrl+Z undoes your own letter only; the synced text stays.
  await run(() => ws.editors.viewOf(ws.activeGroup).focus());
  await chord('z');
  await sleep(600);
  now = await where();
  const withoutQ = disk.replace('LINE Q200', 'LINE 200');
  check(now.doc === withoutQ, 'the first Ctrl+Z takes back only your own letter');
  const saved = await run(async (path) => (await import('/src/api.ts')).api.readNote(path), PATH);
  check(saved === withoutQ, 'that undo saves text that still has every synced line');

  // A second Ctrl+Z has nothing of yours left: the pre-sync text does not come back, and nothing is written.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    window.s1Writes = [];
    const write = api.writeNote;
    api.writeNote = (...args) => { window.s1Writes.push(args[0]); return write(...args); };
  });
  await chord('z');
  await sleep(600);
  now = await where();
  check(now.doc === withoutQ, 'a second Ctrl+Z does not undo the sync');
  check(await run(() => window.s1Writes.length === 0), 'and nothing is written over the synced file');
  check(await run((path) => !ws.editors.hasUnsaved((p) => p === path), PATH), 'the note is still clean');

  // Codex review 1, P1: an undo or redo step that the sync touched must not run.
  const onDisk = (path) => run(async (path) => (await import('/src/api.ts')).api.readNote(path), path);
  const shown = () => run(() => ws.editors.viewOf(ws.activeGroup).state.doc.toString());
  const outside = (path, text) => run(async (path, text) => {
    const { api } = await import('/src/api.ts');
    await api.writeNote(path, text); ws.vault.written(path); await ws.editors.reload(path);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, path, text);
  /** Open `path` with `text`, then replace `word` with `typed` by real input and let it save. */
  const typeOver = async (path, text, word, typed) => {
    await open(path, text, 300);
    await run((word) => {
      const view = ws.editors.viewOf(ws.activeGroup), at = view.state.doc.toString().indexOf(word);
      view.focus(); view.dispatch({ selection: { anchor: at, head: at + word.length } });
    }, word);
    await send('Input.insertText', { text: typed });
    await sleep(600);
  };
  const writes = () => run(() => window.s1Writes.length);
  const rest = '\n' + Array.from({ length: 20 }, (_, i) => `filler ${i}`).join('\n');

  for (const [name, synced] of [['deleted', 'status: '], ['replaced', 'status: published']]) {
    const path = `Status ${name}.md`;
    await typeOver(path, 'status: draft' + rest, 'draft', 'ready');
    check(await onDisk(path) === 'status: ready' + rest, `${name}: your edit is saved`);
    await outside(path, synced + rest);
    const before = await writes();
    await run(() => ws.editors.viewOf(ws.activeGroup).focus());
    await chord('z');
    await sleep(600);
    check(await shown() === synced + rest, `${name}: Ctrl+Z after the sync leaves the synced text (no "draft")`);
    check(await onDisk(path) === synced + rest && await writes() === before, `${name}: nothing is written over the synced file`);
  }

  {
    const path = 'Status redo.md';
    await typeOver(path, 'status: draft' + rest, 'draft', 'ready');
    await run(() => ws.editors.viewOf(ws.activeGroup).focus());
    await chord('z');
    await sleep(600);
    check(await onDisk(path) === 'status: draft' + rest, 'redo: your undo is saved, "ready" waits for redo');
    await outside(path, 'status: final' + rest);
    const before = await writes();
    await run(() => ws.editors.viewOf(ws.activeGroup).focus());
    await chord('y');
    await sleep(600);
    check(await shown() === 'status: final' + rest, 'redo: Ctrl+Y after the sync leaves the synced text');
    check(await onDisk(path) === 'status: final' + rest && await writes() === before, 'redo: nothing is written over the synced file');
  }

  // Codex review 1, P2: separate edits on a long line keep a caret in its unchanged middle.
  {
    const path = 'Long line.md';
    const middle = Array.from({ length: 1700 }, (_, i) => `w${i % 10}`).join(' ');
    const text = `start ${middle} end\nnext line`;
    await open(path, text, 300);
    const caret = text.indexOf('w7', 3000);
    await run((caret) => { const view = ws.editors.viewOf(ws.activeGroup); view.focus(); view.dispatch({ selection: { anchor: caret } }); }, caret);
    const next = text.replace('start ', 'START here ').replace(' end', ' the end');
    await outside(path, next);
    const head = await run(() => ws.editors.viewOf(ws.activeGroup).state.selection.main.head);
    check(await shown() === next && head === caret + 5 && next.slice(head, head + 2) === 'w7', 'a caret inside a long unchanged span stays on its word');
  }
});
