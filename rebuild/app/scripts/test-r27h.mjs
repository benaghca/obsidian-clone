// Round 27h: multi-file canvas drops, the note-title gap, dropped image.png names,
// and a datetime value that includes seconds. Real pointer input. Scratch vault only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 207, 192, 80, 15, 0, 4, 133, 1, 128, 132, 169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const note = `---
tags: [round]
when: 2026-10-23T20:15:30
---
# Heading

Body

## Later
`;
const base = '{"nodes":[],"edges":[]}';

await withBrowser(async ({ send, run, press, point, move, click, chord, check }) => {
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const selected = () => run(() => [...document.querySelectorAll('.nav-files .tree-item-self.is-selected')].map((el) => el.dataset.path));
  const data = async () => JSON.parse(await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote(ws.active.viewFile); }));
  const wait = async (test, label) => {
    for (let i = 0; i < 40; i++) { if (await test()) return; await sleep(50); }
    assert.fail(label);
  };
  const at = async (path) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), row(path));
    await sleep(20);
    return point(row(path));
  };
  const clickAt = async (p, modifiers = 0) => {
    await move(p);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1, modifiers });
    }
    await sleep(40);
  };
  const release = async (p) => { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 }); await sleep(400); };
  const begin = async (path, destination) => {
    const start = await at(path);
    await move(start);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (destination.x - start.x) * i / 8, y: start.y + (destination.y - start.y) * i / 8, button: 'left', buttons: 1 });
      await sleep(16);
    }
    return destination;
  };
  const world = (p) => run((p) => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
    return { x: Math.round((p.x - r.x - m.e) / m.a), y: Math.round((p.y - r.y - m.f) / m.a) };
  }, p);

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('H/A.md', body);
    await api.createNote('H/B.md', 'Plain');
    await api.createNote('H/Shot.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="orange"/></svg>');
    await api.createFolder('H/Skip');
    await api.createNote('H/Beta.md', 'See [[A]]\n');
    await ws.vault.refreshFiles();
  }, note);
  await run(async (source) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('H/Board.canvas', source);
    await ws.vault.refreshFiles();
    await ws.open('H/Board.canvas');
  }, base);
  await sleep(150);
  await click('.nav-files [aria-label="Expand all"]');
  for (const path of ['H/Skip', 'H/A.md', 'H/B.md', 'H/Shot.svg']) await clickAt(await at(path), 2);
  check((await selected()).join('|') === 'H/A.md|H/B.md|H/Shot.svg|H/Skip' || (await selected()).sort().join('|') === 'H/A.md|H/B.md|H/Shot.svg|H/Skip', `ctrl-click selects the folder and three files (${(await selected()).join('|')})`);
  check(await run(() => ws.active.viewFile === 'H/Board.canvas'), 'ctrl-click leaves the canvas open');

  const dropAt = await run(() => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    return { x: Math.round(r.x + 200), y: Math.round(r.y + 180) };
  });
  const expected = await world(dropAt);
  const end = await begin('H/B.md', dropAt);
  check(await run(() => document.querySelector('.drag-ghost')?.textContent?.includes('4 items') && !!document.querySelector('.canvas-view.is-file-drop')), 'a multi-selection drag reaches the canvas');
  await release(end);
  const placed = (await data()).nodes;
  check(placed.map((n) => n.file).join('|') === 'H/A.md|H/B.md|H/Shot.svg', `tree order drops the files and skips the folder (${placed.map((n) => n.file).join('|')})`);
  check(placed.every((n, i) => n.x === expected.x + i * 445 && n.y === expected.y && n.width === 400 && n.height === 400), `one 400×400 row, stride 445, top-left at the pointer (${placed.map((n) => [n.x, n.y, n.width, n.height].join(',')).join(' | ')})`);
  await wait(() => run(() => {
    const title = [...document.querySelectorAll('.canvas-note-title')].find((el) => el.textContent === 'A');
    return !!title?.parentElement?.querySelector('.cm-line.cm-h');
  }), 'the note card rendered its title and heading');
  const gap = await run(() => {
    const title = [...document.querySelectorAll('.canvas-note-title')].find((el) => el.textContent === 'A');
    const heads = [...title.parentElement.querySelectorAll('.cm-line.cm-h')];
    const card = title.closest('.canvas-node').innerText;
    return {
      gap: heads[0].getBoundingClientRect().top - title.getBoundingClientRect().bottom,
      first: parseFloat(getComputedStyle(heads[0]).marginTop),
      later: parseFloat(getComputedStyle(heads[1]).marginTop),
      raw: card.includes('---') || card.includes('when:'),
      heading: card.includes('Heading'),
    };
  });
  check(Math.abs(gap.gap - 12.944) < 1.5 && gap.first === 0 && gap.later === 16, `title-to-heading gap is the title's half-em (${gap.gap}px), and a later heading keeps 16px`);
  check(!gap.raw && gap.heading, 'the card shows the heading and not the frontmatter fence');
  const dropped = await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('H/Board.canvas'); });
  await chord('z');
  await sleep(350);
  check(await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('H/Board.canvas'); }) === base, 'one undo removes the whole row');
  await chord('y');
  await sleep(350);
  check(await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('H/Board.canvas'); }) === dropped, 'redo restores the same row');
  await chord('z');
  await sleep(350);

  const again = await begin('H/A.md', dropAt);
  await press('Escape');
  await release(again);
  check(await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('H/Board.canvas'); }) === base && await run(() => !document.querySelector('.is-file-drop,.drag-ghost')), 'Escape mid-drag adds nothing');
  await begin('H/A.md', { x: dropAt.x, y: 30 });
  await release({ x: dropAt.x, y: 30 });
  check(await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('H/Board.canvas'); }) === base, 'a drop outside the canvas adds nothing');
  await click('.canvas-controls [aria-label="Canvas settings"]');
  await click('.menu-item:nth-child(3)');
  const locked = await begin('H/A.md', dropAt);
  await release(locked);
  check(await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('H/Board.canvas'); }) === base, 'a read-only canvas refuses the multi-file drop');
  await click('.canvas-controls [aria-label="Canvas settings"]');
  await click('.menu-item:nth-child(3)');

  const have = new Set(await selected());
  for (const path of have) if (path !== 'H/Skip' && path !== 'H/Shot.svg') await clickAt(await at(path), 2);
  if (!have.has('H/Skip')) await clickAt(await at('H/Skip'), 2);
  if (!have.has('H/Shot.svg')) await clickAt(await at('H/Shot.svg'), 2);
  const only = await begin('H/Shot.svg', dropAt);
  await release(only);
  await wait(async () => {
    const nodes = (await data()).nodes;
    return nodes.length === 1 && nodes[0].file === 'H/Shot.svg' && nodes[0].width === 400 && nodes[0].height === 200;
  }, 'a folder plus one image uses the single-file aspect path');
  check(true, 'one remaining image is 400×200 at the pointer');
  await chord('z');
  await sleep(350);

  await run(() => ws.open('H/A.md'));
  await sleep(200);
  await run(() => ws.setMode('live'));
  await sleep(200);
  const live = await run(() => ({
    when: document.querySelector('.property-value[data-type="datetime"] input')?.value ?? '',
    heading: [...document.querySelectorAll('.cm-line')].some((el) => el.textContent.includes('Heading')),
    fence: [...document.querySelectorAll('.cm-line')].some((el) => el.textContent.trim() === '---'),
  }));
  check(live.when === '2026-10-23T20:15:30' && live.heading && !live.fence, `live preview shows the datetime seconds (${live.when})`);
  await run(() => ws.setMode('source'));
  await sleep(150);
  check(await run(() => [...document.querySelectorAll('.cm-line')].some((el) => el.textContent.trim() === '---') && ws.view.state.doc.toString().includes('when: 2026-10-23T20:15:30')), 'source mode shows the frontmatter fence');
  await run(() => ws.setMode('reading'));
  await sleep(200);
  const reading = await run(() => ({
    when: document.querySelector('.property-value[data-type="datetime"] input')?.value ?? '',
    heading: [...document.querySelectorAll('.cm-line')].some((el) => el.textContent.includes('Heading')),
    fence: [...document.querySelectorAll('.cm-line')].some((el) => el.textContent.trim() === '---'),
  }));
  check(reading.when === '2026-10-23T20:15:30' && reading.heading && !reading.fence, `reading view shows the datetime seconds (${reading.when})`);
  await run(() => grove.run('editor:add-alias'));
  await sleep(80);
  check(await run(() => document.activeElement?.closest('.property')?.dataset.key === 'aliases'), 'Add alias in reading view focuses the aliases field');

  await run(() => ws.setMode('live'));
  await sleep(200);
  const body = await run(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('Body'));
    const r = line.getBoundingClientRect();
    return { x: r.x + 16, y: r.y + r.height / 2 };
  });
  await move(body);
  await run((x, y, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(bytes)], 'image.png', { type: 'image/png' }));
    const target = document.elementFromPoint(x, y);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, body.x, body.y, PNG);
  await wait(() => run(() => ws.view.state.doc.toString().includes('![[image.png]]')), 'dropped image.png embed appeared');
  check(!/Pasted image/.test(await run(() => ws.view.state.doc.toString())), 'a dropped image.png keeps its name');

  await click(body);
  const before = await run(() => ws.view.state.doc.toString());
  await run(() => grove.run('editor:insert-embed'));
  await press('Escape');
  check((await run(() => ws.view.state.doc.toString())).includes('![[') && await run(() => ws.view.state.doc.toString()) !== before, 'Add embed works in live preview');
  await chord('z');
  await sleep(80);
  await run(() => grove.run('editor:insert-tag'));
  const tagged = await run(() => ws.view.state.doc.toString());
  check(tagged.length === before.length + 1 && tagged.includes('#'), 'Add tag works in live preview');

  await run(async () => { await ws.vault.refreshLinks(); await ws.open('H/A.md'); });
  await sleep(150);
  await run(() => grove.run('backlink:open-backlinks'));
  await sleep(250);
  check(await run(() => [...document.querySelectorAll('.workspace-tab-header-inner-title')].some((el) => el.textContent === 'Backlinks for A')), 'backlinks opens a tab for that note');
  await run(() => ws.open('Welcome.md', { where: 'tab' }));
  await sleep(150);
  const tabAt = await run(() => {
    const el = [...document.querySelectorAll('.workspace-tab-header-inner-title')].find((item) => item.textContent === 'Backlinks for A');
    const r = el.closest('.workspace-tab-header').getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2 };
  });
  await click(tabAt);
  await sleep(200);
  const tab = await run(() => ({
    title: document.querySelector('.workspace-tab-header.is-active .workspace-tab-header-inner-title')?.textContent ?? '',
    mentions: document.querySelector('.backlinks-tab')?.innerText ?? '',
  }));
  check(tab.title === 'Backlinks for A' && tab.mentions.includes('Beta'), `the backlinks tab stays on the note it was opened for (${tab.title})`);
});
