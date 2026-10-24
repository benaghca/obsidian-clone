// Round 27l: explorer pitch, header, ribbon, default sidebar, property key
// icon, date and datetime calendars, vault footer, sidebar tabs, and a
// new note's links showing up in backlinks. Headless Chromium, real pointer
// input. Scratch vault only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const note = `---
due: 2026-10-23
when: 2026-10-23T20:15:30
plain: hello
---
# Heading

## Section

### Detail

A frontmatter note for the pointer checks.
`;

await withBrowser(async ({ send, run, move, click, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Dates.md', body);
    await api.createNote('Folder/Deep/Leaf.md', 'leaf\n');
    await api.createNote('Folder/Nested.md', 'nested\n');
    await ws.vault.refreshFiles();
    await ws.open('Dates.md');
  }, note);
  await click('.nav-files [aria-label="Expand all"]');
  await wait(() => run(() => !!document.querySelector('.nav-files .tree-item-self[data-path="Folder/Deep/Leaf.md"]')), 'nested row visible');

  const chrome = await run(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const list = document.querySelector('.nav-files > .nav-files-container');
    const edge = list.getBoundingClientRect().x;
    const rows = [...list.querySelectorAll('.tree-item-self')].map((el) => ({
      y: el.getBoundingClientRect().y,
      h: el.getBoundingClientRect().height,
      textX: el.querySelector('.tree-item-inner').getBoundingClientRect().x - edge,
      mb: getComputedStyle(el).marginBottom,
    }));
    const header = document.querySelector('.nav-files > .nav-header');
    const button = header.querySelector('.clickable-icon');
    const action = document.querySelector('.side-dock-ribbon-action');
    const tab = document.querySelector('.mod-left-split .workspace-tab-header.is-active');
    const tabIcon = tab.querySelector('svg');
    const row = document.querySelector('.cm-content .property');
    const keySvg = row.querySelector('.property-icon svg');
    const keyInput = row.querySelector('.property-key-input');
    const rx = row.getBoundingClientRect().x;
    const footer = document.querySelector('.workspace-sidedock-vault-profile');
    return {
      rows,
      header: box(header),
      button: box(button),
      ribbon: box(document.querySelector('.workspace-ribbon')).w,
      action: box(action),
      dock: box(document.querySelector('.mod-left-split')).w,
      tab: box(tab),
      tabIcon: box(tabIcon),
      footer: box(footer).h,
      nameLh: getComputedStyle(document.querySelector('.workspace-drawer-vault-name')).lineHeight,
      keyIcon: keySvg.getBoundingClientRect().x - rx,
      keyLabel: keyInput.getBoundingClientRect().x - rx,
      keyBox: box(keyInput),
      dateIcon: !!document.querySelector('.cm-content .property-value[data-type="date"] .property-date-icon'),
      timeIcon: !!document.querySelector('.cm-content .property-value[data-type="datetime"] .property-date-icon'),
      rowH: row.getBoundingClientRect().height,
    };
  });
  const pitch = chrome.rows.slice(1).map((row, i) => +(row.y - chrome.rows[i].y).toFixed(2));
  check(chrome.rows.every((row) => row.h > 24 && row.h < 26 && row.mb === '2px') && pitch.every((gap) => Math.abs(gap - 26.89) < 0.2), `file rows are 24.89px with a 2px gap (${chrome.rows[0].h}px, pitch ${pitch.join(',')})`);
  check(Math.abs(chrome.rows[0].textX - 36) < 0.6 && Math.abs(chrome.rows.find((row) => row.textX > 50).textX - 53) < 0.6, `labels stay at 36px then 53px (${chrome.rows.map((row) => row.textX.toFixed(1)).join(',')})`);
  check(chrome.header.h === 40 && chrome.button.w === 28 && chrome.button.h === 24 && Math.abs(chrome.button.y - (chrome.header.y + 8)) < 0.6, `explorer header is 40px and its buttons are 28×24, 8px down (${chrome.header.h}, ${chrome.button.w}×${chrome.button.h}, +${(chrome.button.y - chrome.header.y).toFixed(1)})`);
  check(chrome.ribbon === 44 && chrome.action.w === 28 && chrome.action.h === 24 && Math.abs(chrome.action.y - 48) < 1 && Math.abs(chrome.action.x - 7.5) < 1, `ribbon is 44px and an action is 28×24 under the tab row (${chrome.ribbon}, ${chrome.action.w}×${chrome.action.h} at ${chrome.action.x},${chrome.action.y})`);
  check(Math.abs(chrome.dock - 300) < 1, `a fresh left sidebar is 300px (${chrome.dock})`);
  check(chrome.tab.w === 28 && chrome.tab.h === 25 && chrome.tabIcon.w === 16 && chrome.tabIcon.h === 16, `an active sidebar tab is 28×25 around a 16px icon (${chrome.tab.w}×${chrome.tab.h}, icon ${chrome.tabIcon.w})`);
  check(Math.abs(chrome.footer - 41.9) < 0.4 && chrome.nameLh === '16.9px', `the vault footer is 41.9px (${chrome.footer}, line ${chrome.nameLh})`);
  check(Math.abs(chrome.keyIcon - 4) < 0.6 && Math.abs(chrome.keyLabel - 20) < 0.6 && chrome.keyBox.w === 124 && chrome.keyBox.h === 28 && chrome.rowH === 29, `the key icon is 4px in, the label is 124×28, and the row stays 29px (icon +${chrome.keyIcon}, label +${chrome.keyLabel} ${chrome.keyBox.w}×${chrome.keyBox.h}, row ${chrome.rowH})`);
  check(chrome.dateIcon && chrome.timeIcon, 'a date value and a datetime value both keep a calendar');

  const openAt = await run(() => {
    const row = document.querySelector('.nav-files .tree-item-self[data-path="Folder/Nested.md"]');
    const rect = row.getBoundingClientRect();
    return { x: rect.x + 40, y: rect.y + rect.height / 2 };
  });
  await click(openAt);
  await wait(() => run(() => ws.active.path === 'Folder/Nested.md'), 'the spaced row did not open');
  check(await run(() => ws.active.path === 'Folder/Nested.md'), 'a click on a spaced file row opens that note');

  await run(() => ws.open('Dates.md'));
  await sleep(60);
  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    const spot = await run(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((el) => /frontmatter note|Heading/.test(el.textContent));
      const rect = line.getBoundingClientRect();
      return { x: rect.x + 24, y: rect.y + rect.height / 2 };
    });
    await move(spot);
    for (let n = 0; n < 2; n++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
      }
      await sleep(40);
    }
    const body = await run(() => ws.view.state.doc.toString());
    check(body.includes('due: 2026-10-23') && body.includes('# Heading'), `${mode}: two clicks at one point leave the note intact`);
  }

  await run(async () => {
    const { createNote } = await import('/src/fileOps.ts');
    await createNote(ws, 'Linked.md', 'See [[Welcome]]\n');
    await ws.open('Welcome.md');
  });
  await sleep(1500);
  await run(() => grove.run('backlink:open'));
  await wait(() => run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-name')].some((el) => el.textContent === 'Linked')), 'the new note did not show in backlinks');
  const linkedAt = await run(() => {
    const el = [...document.querySelectorAll('.backlink-pane .search-result-file-name')].find((n) => n.textContent === 'Linked');
    el.scrollIntoView({ block: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await click(linkedAt);
  await wait(() => run(() => ws.active.path === 'Linked.md'), 'the backlink row did not open');
  check(await run(() => ws.active.path === 'Linked.md'), 'a note created with a link is indexed and opens from backlinks');
}, { height: 800 });
