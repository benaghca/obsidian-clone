// Round 27c: styled tooltips, shrinking hover previews, and the [[ suggester.
// Native pointer input on frontmatter notes, in Live Preview, Source and Reading.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, click, move, point, press, check }) => {
  const fm = '---\ntags: [r27c]\n---\n\n';
  await run(async fm => {
    const { api } = await import('/src/api.ts');
    const notes = {
      'RecentA27c.md': 'Alpha',
      'RecentZ27c.md': 'Zulu',
      'Projects/Plan27c.md': 'Plan',
      'Index27c.md': '[[Uncreated27c]]',
      'Short27c.md': 'One.\n\nTwo.\n\nThree.',
      'Long27c.md': Array.from({ length: 30 }, (_, i) => `Line ${i} sits in the long preview.`).join('\n\n'),
      'Links27c.md': 'See [[Short27c]] and [[Long27c]].\n\n```js\nconst n = 1;\n```\n\n# Fold me\n\nHidden line.\n',
    };
    for (const [path, body] of Object.entries(notes)) await api.createNote(path, fm + body);
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('Links27c.md');
  }, fm);
  await sleep(150);

  const away = () => move({ x: 640, y: 420 });
  const tipAt = async selector => {
    await away();
    await sleep(60);
    await move(await point(selector));
    await sleep(140);
    const early = await run(() => !!document.querySelector('.tooltip'));
    await sleep(220);
    const tip = await run(selector => {
      const owner = document.querySelector(selector);
      const el = document.querySelector('.tooltip');
      if (!el || !owner) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const ownerBox = owner.getBoundingClientRect();
      return {
        text: el.textContent,
        label: owner.getAttribute('aria-label'),
        title: owner.hasAttribute('title'),
        side: el.classList.contains('mod-right'),
        animation: style.animationName,
        transition: style.transitionDuration,
        radius: parseFloat(style.borderRadius),
        centered: Math.abs((box.left + box.width / 2) - (ownerBox.left + ownerBox.width / 2)),
        below: box.top >= ownerBox.bottom - 1,
        rightOf: box.left >= ownerBox.right - 1,
        inside: box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 8 && box.bottom <= innerHeight - 8,
      };
    }, selector);
    return { early, tip };
  };

  for (const mode of ['live', 'source', 'reading']) {
    await run(async mode => { await ws.open('Links27c.md'); ws.setMode(mode); }, mode);
    await sleep(120);
    const ribbon = await tipAt('.side-dock-ribbon-action[aria-label="Open quick switcher"]');
    assert.equal(ribbon.early, false, mode + ' tooltip appeared before 300ms');
    assert.ok(ribbon.tip && ribbon.tip.text === ribbon.tip.label && !ribbon.tip.title, mode + ' ribbon tooltip');
    assert.equal(ribbon.tip.animation, 'none');
    assert.equal(ribbon.tip.transition, '0s');
    assert.ok(ribbon.tip.side && ribbon.tip.rightOf && ribbon.tip.inside && ribbon.tip.radius >= 8);
    check(true, mode + ': ribbon tooltip waits about 300ms, then sits beside the button with no fade');

    const header = await tipAt('.nav-buttons-container [aria-label="New note"]');
    assert.equal(header.early, false);
    assert.ok(header.tip && !header.tip.side && header.tip.below && header.tip.centered < 20 && header.tip.inside && !header.tip.title);
    check(true, mode + ': toolbar tooltip is a dark rounded label centred under the button');
  }

  await run(mode => ws.setMode(mode), 'live');
  await sleep(80);
  const copy = await tipAt('.code-block-flair[aria-label="Copy"]');
  assert.equal(copy.early, false);
  assert.ok(copy.tip && copy.tip.text === 'Copy' && !copy.tip.title && copy.tip.animation === 'none');
  check(true, 'live: code flair uses the styled tooltip instead of a native title');

  await run(mode => ws.setMode(mode), 'reading');
  await sleep(100);
  const copyReading = await tipAt('.copy-code-button[aria-label="Copy"]');
  assert.ok(copyReading.tip && copyReading.tip.text === 'Copy' && !copyReading.tip.title);
  check(true, 'reading: copy button uses the styled tooltip instead of a native title');

  await run(() => { ws.setMode('live'); grove.run('editor:fold-all'); });
  await sleep(80);
  const fold = await tipAt('.cm-foldPlaceholder[aria-label="Unfold"]');
  assert.ok(fold.tip && fold.tip.text === 'Unfold' && !fold.tip.title && fold.tip.animation === 'none');
  check(true, 'live: a folded section uses the styled Unfold tooltip');

  const hover = async (mode, target) => {
    await run(mode => { ws.setMode(mode); grove.run('editor:unfold-all'); }, mode);
    await sleep(100);
    await away();
    const p = mode === 'source'
      ? await run(target => {
        const at = ws.view.state.doc.toString().indexOf('[[' + target);
        const r = ws.view.coordsAtPos(at + 2);
        return { x: r.left + 2, y: (r.top + r.bottom) / 2 };
      }, target)
      : await point(`[data-href="${target}"]`);
    if (mode !== 'reading') await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', modifiers: 2, windowsVirtualKeyCode: 17 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, modifiers: mode === 'reading' ? 0 : 2 });
    await sleep(520);
    if (mode !== 'reading') await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', windowsVirtualKeyCode: 17 });
  };
  for (const mode of ['live', 'source', 'reading']) {
    await hover(mode, 'Short27c');
    const box = await run(() => {
      const pop = document.querySelector('.hover-popover');
      const title = pop?.querySelector('.markdown-embed-title');
      const icon = pop?.querySelector('.markdown-embed-link');
      if (!pop || !title || !icon) return null;
      const style = getComputedStyle(title);
      const popBox = pop.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      return {
        h: pop.offsetHeight,
        w: pop.offsetWidth,
        title: title.textContent,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
        icon: iconBox.width > 0 && iconBox.top >= popBox.top && iconBox.right <= popBox.right + 1,
        titleFirst: titleBox.top <= popBox.top + 36 && titleBox.top < iconBox.bottom,
      };
    });
    assert.ok(box && box.title === 'Short27c' && box.size > 24 && box.weight >= 700 && box.icon && box.titleFirst, JSON.stringify(box));
    assert.ok(box.h < 250 && box.h > 70 && box.w >= 400 && box.w <= 460, JSON.stringify(box));
    check(true, mode + ': short preview leads with a large title and expand icon, and shrinks under 250px');
    await press('Escape');
  }
  await hover('live', 'Long27c');
  const longBox = await run(() => {
    const pop = document.querySelector('.hover-popover');
    const body = pop.querySelector('.markdown-embed-content');
    return { h: pop.offsetHeight, scroll: body.scrollHeight > body.clientHeight, title: pop.querySelector('.markdown-embed-title').textContent };
  });
  assert.equal(longBox.title, 'Long27c');
  assert.ok(longBox.h <= 400 && longBox.h > 250 && longBox.scroll, JSON.stringify(longBox));
  check(true, 'live: long preview keeps its title and caps at 400px');
  await press('Escape');

  const row = path => `.nav-files [data-path=${JSON.stringify(path)}]`;
  for (const mode of ['live', 'source', 'reading']) {
    for (const path of ['RecentA27c.md', 'RecentZ27c.md', 'Links27c.md']) await click(row(path));
    await run((mode, fm) => {
      ws.setMode(mode);
      if (mode !== 'reading') {
        ws.view.dispatch({
          changes: { from: fm.length, to: ws.view.state.doc.length, insert: 'A paragraph.\n\n' },
          selection: { anchor: fm.length + 'A paragraph.\n\n'.length },
        });
      }
    }, mode, fm);
    await sleep(120);
    const caret = await run(() => {
      const r = ws.view.coordsAtPos(ws.view.state.doc.length);
      return { x: r.left + 1, y: (r.top + r.bottom) / 2 };
    });
    await click(caret);
    const before = await run(() => ws.view.state.doc.toString());
    await send('Input.insertText', { text: '[[' });
    await sleep(250);
    const labels = await run(() => [...document.querySelectorAll('.cm-link-suggest .cm-completionLabel')].map(el => el.textContent));
    if (mode === 'reading') {
      check(labels.length === 0 && await run(() => ws.view.state.doc.toString()) === before, 'reading: link suggester stays closed');
      continue;
    }
    assert.deepEqual(labels.slice(0, 3), ['Links27c', 'RecentZ27c', 'RecentA27c']);
    check(labels.includes('photo.png') && labels.includes('diagram.svg'), mode + ': attachments are listed');
    check(labels.includes('Uncreated27c'), mode + ': unresolved targets are listed');
    check(await run(() => [...document.querySelectorAll('.cm-link-suggest li')].some(el =>
      el.querySelector('.cm-completionLabel')?.textContent === 'Plan27c' && el.querySelector('.cm-completionDetail')?.textContent === 'Projects/',
    )), mode + ': a folder is shown as Projects/');
    check(await run(() => {
      const popup = document.querySelector('.cm-link-suggest');
      const style = getComputedStyle(popup, '::after');
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = style.font;
      const text = style.content.slice(1, -1);
      const wide = popup.offsetWidth >= 420;
      const oneLine = style.whiteSpace === 'nowrap' && ctx.measureText(text).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) <= popup.clientWidth;
      return wide && oneLine && text.includes('Type # to link heading') && text.includes('Type ^ to link blocks') && text.includes('Type | to change display text');
    }), mode + ': the widened suggester keeps the hint on one line');
    await press('Escape');
  }
});
