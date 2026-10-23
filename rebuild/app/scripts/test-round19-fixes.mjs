// Round 19 stage 3: native input on frontmatter notes in all three view modes.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, key, press, chord, move, click, fill, point, check }) => {
  const fm = '---\ntags: [r19]\n---\n';
  let sequence = 0;
  const fixture = async (body, mode) => {
    await run(async (doc, mode, path) => {
      const { api } = await import('/src/api.ts');
      await api.createNote(path, doc); await ws.vault.refreshFiles(); await ws.open(path); ws.setMode(mode);
      ws.view.dispatch({ selection: { anchor: 0 } });
    }, fm + body, mode, `Fixes${++sequence}.md`);
    await sleep(150);
  };
  const textPoint = (text, offset = 0) => run((text, offset) => {
    const at = ws.view.state.doc.toString().indexOf(text) + offset;
    const r = ws.view.coordsAtPos(at); return { x: r.left + 1, y: (r.top + r.bottom) / 2 };
  }, text, offset);
  const doc = () => run(() => ws.view.state.doc.toString());
  for (const mode of ['live', 'source', 'reading']) {
    const before = '1. a\n2. b\n    5. child\n3. c';
    await fixture(before, mode);
    await click(await textPoint('b'));
    await press('Tab'); await sleep(50);
    if (mode === 'reading') {
      assert.equal(await doc(), fm + before, 'Reading view remains read-only');
    } else {
      assert.equal(await doc(), fm + '1. a\n\t1. b\n\t\t5. child\n2. c', mode + ': move children without renumbering');
      await chord('z');
      assert.equal(await doc(), fm + before, mode + ': one undo includes renumber');
      await chord('y');
      assert.equal(await doc(), fm + '1. a\n\t1. b\n\t\t5. child\n2. c');
      await key('Shift', 8); await press('Tab', 8); await key('Shift', 0, 'keyUp');
      assert.equal(await doc(), fm + '1. a\n2. b\n\t5. child\n3. c', mode + ': outdent children together');
    }
    check(true, mode + ': list item and children stay together; child keeps 5');
    for (const callout of [false, true]) {
      const header = callout ? '> [!note] Steps\n' : '';
      const before = header + '> 1. alpha\n> 2. beta\n> 3. gamma';
      await fixture(before, mode);
      if (callout && mode !== 'source') { await click('.inline-title'); await click('.callout-content > .cm-line[data-line="2"]'); }
      else await click(await textPoint('beta', 2));
      if (mode !== 'reading') check(await run(() => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.includes('beta')), mode + ': rendered callout/quote click edits beta');
      await press('Tab'); await sleep(50);
      if (mode === 'reading') assert.equal(await doc(), fm + before);
      else {
        assert.equal(await doc(), fm + header + '> 1. alpha\n>     1. beta\n> 2. gamma');
        await key('Shift', 8); await press('Tab', 8); await key('Shift', 0, 'keyUp');
        assert.equal(await doc(), fm + before);
      }
      check(true, `${mode}: ${callout ? 'callout' : 'quote'} indentation stays after >`);
    }
  }
});
