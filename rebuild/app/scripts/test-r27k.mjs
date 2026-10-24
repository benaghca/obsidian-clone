// Round 27k: in-note date fields are 116px, property rows are 29px, and
// explorer labels start 36px from the file list (17px more at each depth).
// Headless Chromium, real pointer and key input. Scratch vault only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const note = `---
r27jdue: 2026-10-23
r27jwhen: 2026-10-23T20:15:30
plain: hello
---
# Heading

## Section

### Detail

A frontmatter note for the pointer checks.
`;

await withBrowser(async ({ send, run, press, move, click, check }) => {
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const at = async (selector) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), selector);
    await sleep(20);
    return run((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector);
  };
  const clickAt = async (p) => {
    await move(p);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
    }
    await sleep(50);
  };

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Dates.md', body);
    await api.createNote('Folder/Deep/Leaf.md', 'leaf\n');
    await api.createNote('Folder/Nested.md', 'nested\n');
    await ws.vault.refreshFiles();
  }, note);
  await click('.nav-files [aria-label="Expand all"]');
  await wait(() => run((selector) => !!document.querySelector(selector), row('Folder/Deep/Leaf.md')), 'nested row visible');

  const tree = await run(() => {
    const list = document.querySelector('.nav-files > .nav-files-container');
    const edge = list.getBoundingClientRect().x;
    const place = (path) => {
      const self = document.querySelector(`.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`);
      const inner = self.querySelector('.tree-item-inner');
      return {
        textX: +(inner.getBoundingClientRect().x - edge).toFixed(2),
        h: +self.getBoundingClientRect().height.toFixed(2),
        pad: getComputedStyle(self).paddingLeft,
      };
    };
    return {
      pad: getComputedStyle(list).padding,
      root: place('Dates.md'),
      nested: place('Folder/Nested.md'),
      leaf: place('Folder/Deep/Leaf.md'),
      folderIcon: +(document.querySelector('.nav-files .tree-item-self[data-path="Folder"] .collapse-icon').getBoundingClientRect().x - edge).toFixed(2),
    };
  });
  check(tree.pad === '4px 12px 24px', `file list padding is 4px 12px 24px (${tree.pad})`);
  check(tree.root.textX === 36 && tree.root.pad === '24px' && tree.root.h > 24 && tree.root.h < 26, `a root label starts at 36px on a 25px row (${tree.root.textX}px, pad ${tree.root.pad}, ${tree.root.h}px)`);
  check(tree.nested.textX === 53 && tree.leaf.textX === 70, `nested labels step 17px (${tree.nested.textX}px, ${tree.leaf.textX}px)`);
  check(tree.folderIcon === 16, `the folder chevron stays at 16px (${tree.folderIcon}px)`);

  await click('.mod-left-split [aria-label="Bookmarks"]');
  await sleep(40);
  const bookmarks = await run(() => getComputedStyle(document.querySelector('.bookmarks-list')).padding);
  check(bookmarks === '4px 8px 16px', `bookmarks keep their own padding (${bookmarks})`);
  await click('.mod-left-split [aria-label="Files"]');

  await run(() => ws.open('Dates.md'));
  await sleep(80);
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
    const aligned = await run(() => {
      const lines = [...ws.view.contentDOM.children].filter((el) => el.classList.contains('cm-line'));
      return lines.every((el) => {
        const style = getComputedStyle(el);
        const pos = ws.view.posAtDOM(el, 0);
        const delta = ws.view.documentTop + ws.view.lineBlockAt(pos).top - el.getBoundingClientRect().top;
        return Math.abs(delta) <= 1 && style.marginTop === '0px' && style.marginBottom === '0px';
      });
    });
    check(aligned, `${mode}: body lines stay on the editor's layout, with no vertical margin`);
    const body = await run(() => ws.view.state.doc.toString());
    check(body.includes('r27jdue: 2026-10-23') && body.includes('# Heading'), `${mode}: two clicks at one point leave the note intact`);
  }

  await run(() => ws.setMode('live'));
  await sleep(60);
  const fields = await run(() => {
    const measure = (type) => {
      const value = document.querySelector(`.cm-content .property-value[data-type="${type}"]`);
      const input = value.querySelector('input');
      const row = value.closest('.property');
      const link = value.querySelector('.property-daily');
      const inputBox = input.getBoundingClientRect();
      const valueBox = value.getBoundingClientRect();
      return {
        width: inputBox.width,
        height: inputBox.height,
        row: row.getBoundingClientRect().height,
        column: valueBox.width,
        value: input.value,
        link: link ? +(link.getBoundingClientRect().x - valueBox.x).toFixed(2) : null,
        color: getComputedStyle(input).color,
        weight: getComputedStyle(input).fontWeight,
      };
    };
    const plain = document.querySelector('.cm-content [data-key="plain"]');
    return { due: measure('date'), when: measure('datetime'), plain: plain.getBoundingClientRect().height };
  });
  check(fields.due.width === 116 && fields.due.link === 116, `the in-note date field is 116px and the daily-note link follows it (${fields.due.width}px, link +${fields.due.link}px)`);
  check(fields.due.height === 29 && fields.due.row === 29 && fields.when.height === 29 && fields.when.row === 29 && fields.plain === 29, `property rows and date inputs are 29px (${fields.due.height}/${fields.due.row}, ${fields.when.height}/${fields.when.row}, plain ${fields.plain})`);
  check(fields.when.value === '2026-10-23T20:15:30' && fields.when.width > 400, `datetime keeps seconds and fills the column (${fields.when.value}, ${fields.when.width}px)`);
  check(fields.due.color === 'rgb(34, 34, 34)' && fields.due.weight === '400', `date text stays regular dark type (${fields.due.color}, ${fields.due.weight})`);

  await clickAt(await at('.cm-content .property-value[data-type="date"] .property-date-icon'));
  check(await run(() => document.activeElement?.type === 'date' && document.activeElement.value === '2026-10-23'), 'the calendar icon focuses the date field and keeps its value');
  await press('ArrowRight');
  const keyed = await run(() => ({ type: document.activeElement?.type ?? '', value: document.activeElement?.value ?? '', width: document.activeElement?.getBoundingClientRect().width ?? 0 }));
  check(keyed.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(keyed.value) && keyed.width === 116, `a key edits the date field and it stays 116px (${keyed.value}, ${keyed.width}px)`);
  await run(() => { document.querySelector('.cm-content .property-value[data-type="date"] input').value = '2026-10-23'; });

  await run(() => { ws.setMode('live'); grove.run('properties:open-local'); });
  await sleep(150);
  const side = await run(() => {
    const input = document.querySelector('.file-properties .property-value[data-type="date"] input');
    const when = document.querySelector('.file-properties .property-value[data-type="datetime"] input');
    const box = input.getBoundingClientRect();
    return { width: box.width, height: box.height, when: when.value, whenWidth: when.getBoundingClientRect().width };
  });
  check(side.width > 95 && side.width < 110 && side.height >= 28 && side.height <= 30, `file properties date stays near 101px and 29px tall (${side.width}px, ${side.height}px)`);
  check(side.when === '2026-10-23T20:15:30' && side.whenWidth > 90, `file properties datetime still carries seconds (${side.when}, ${side.whenWidth}px)`);
}, { height: 800 });
