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
  const longName = 'VeryLongTitleNoteForPreviewWrappingAndIconOverlapCheck';
  await run(async (fm, longName) => {
    const { api } = await import('/src/api.ts');
    for (const [name, text] of [
      ['PreviewDeep', '# Top\n\n' + 'Filler.\n\n'.repeat(30) + '## Deep\n\nTarget.\n\n' + 'Tail.\n\n'.repeat(30)],
      ['PreviewEnd', '# Top\n\n' + 'Filler.\n\n'.repeat(30) + '## Deep\n\nTarget.'],
      [longName, 'Short body.'], ['PreviewEmpty', ''],
    ]) await api.createNote(name + '.md', fm + text);
    await ws.vault.refreshFiles();
  }, fm, longName);
  const hover = async (target, mode) => {
    await move({ x: 20, y: 900 });
    await key('Control', 2);
    const p = mode === 'source' ? await textPoint(target, 3) : await point(`[data-href="${target}"]`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, modifiers: 2 });
    await sleep(500); await key('Control', 0, 'keyUp');
    check(await run(() => !!document.querySelector('.hover-popover')), mode + ': native hover opens preview');
  };
  const headerVisible = () => run(() => {
    const p = document.querySelector('.hover-popover'), t = p.querySelector('.markdown-embed-title'), i = p.querySelector('.markdown-embed-link');
    if (!t || !i) return false;
    const r = p.getBoundingClientRect(), a = t.getBoundingClientRect(), b = i.getBoundingClientRect();
    return a.top >= r.top && a.bottom <= r.bottom && b.top >= r.top && b.bottom <= r.bottom;
  });
  for (const mode of ['live', 'source', 'reading']) {
    await fixture(`[[PreviewDeep#Deep]] [[PreviewEnd#Deep]] [[${longName}]] [[PreviewEmpty]] [[Missing${mode}]]`, mode);
    await click('.inline-title');
    for (const target of ['PreviewDeep#Deep', 'PreviewEnd#Deep']) {
      await hover(target, mode);
      check(await headerVisible(), mode + ': deep heading preview keeps title and Open visible');
      const body = await run(() => {
        const p = document.querySelector('.hover-popover'), c = p.querySelector('.markdown-embed-content'), t = c.querySelector('.cm-h2');
        return { height: p.offsetHeight, y: t.getBoundingClientRect().top - c.getBoundingClientRect().top, bodyScroll: c.scrollTop, outerScroll: p.scrollTop };
      });
      assert.ok(body.height <= 400 && body.y >= 15 && body.y <= 17 && body.bodyScroll > 0 && body.outerScroll === 0, JSON.stringify(body));
      check(true, mode + ': heading aligns 16px inside the scrolling body, including at note end');
      const p = await point('.hover-popover .markdown-embed-content'); await move(p);
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...p, deltaX: 0, deltaY: 180 }); await sleep(80);
      check(await headerVisible(), mode + ': native body scrolling keeps the preview header visible');
      await press('Escape');
    }
    await hover(longName, mode);
    const wrapping = await run(() => {
      const p = document.querySelector('.hover-popover'), t = p.querySelector('.markdown-embed-title'), i = p.querySelector('.markdown-embed-link').getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(t);
      const rects = [...range.getClientRects()];
      return p.scrollWidth === p.clientWidth && p.offsetHeight < 300 && rects.length > 1 && rects.every(r => r.right <= i.left - 3);
    });
    check(wrapping, mode + ': long preview title wraps clear of Open, without horizontal overflow');
    await click('.hover-popover .markdown-embed-link');
    check(await run(name => ws.active.path === name + '.md' && !document.querySelector('.hover-popover'), longName), mode + ': real Open click navigates');
    // Return to the link fixture after navigation.
    await run(async path => { await ws.open(path); }, `Fixes${sequence}.md`); await sleep(100);
    await click('.inline-title');
    for (const target of ['PreviewEmpty', `Missing${mode}`]) {
      await hover(target, mode);
      check(await headerVisible(), mode + ': empty/missing preview has title and Open icon');
      check(await run(target => {
        const p = document.querySelector('.hover-popover');
        return p.offsetHeight < 250 && p.querySelector('.markdown-embed-title').textContent === target && p.scrollWidth === p.clientWidth;
      }, target), mode + ': empty/missing preview shrinks to content');
      if (target.startsWith('Missing')) {
        await click('.hover-popover .markdown-embed-link');
        check(await run(target => ws.active.path === target + '.md' && !document.querySelector('.hover-popover'), target), mode + ': missing preview Open creates its note');
      } else await press('Escape');
    }
  }

});
