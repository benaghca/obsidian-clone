// Round 27o: backlink rows and toolbar, outline indent and toolbar, search
// settings. Headless Chromium, real pointer input, scratch vault only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const gap = '\n'.repeat(40);
const note = `---
due: 2026-10-24
---
# Alpha

${gap}
## Beta

${gap}
### Gamma

## Delta
`;

await withBrowser(async ({ send, run, move, click, press, chord, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const center = async (sel) => run((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R27oDates.md', body);
    await api.createNote('R27oPair.md', 'before the mention\nSee [[R27oDates]] in the middle.\nafter the mention\n');
    await api.createNote('R27oOther.md', 'Also [[R27oDates]] from the other note.\n');
    await api.createNote('R27oPlain.md', 'R27oDates unlinked.\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('R27oDates.md');
  }, note);

  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    const spot = await run(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((el) => /Alpha|due/.test(el.textContent));
      const rect = line.getBoundingClientRect();
      return { x: rect.x + 28, y: rect.y + rect.height / 2 };
    });
    await move(spot);
    for (let n = 0; n < 2; n++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
      }
      await sleep(30);
    }
    check((await run(() => ws.view.state.doc.toString())).includes('# Alpha'), `${mode}: two clicks at one point leave the headings intact`);
  }
  await run(() => ws.setMode('live'));

  await run(() => grove.run('backlink:open'));
  await wait(async () => {
    const dock = await run(() => document.querySelector('.mod-right-split')?.getBoundingClientRect().width ?? 0);
    const rows = await run(() => document.querySelectorAll('.backlink-pane .search-result-file-match').length);
    return Math.abs(dock - 300) < 2 && rows >= 2;
  }, 'linked mentions did not appear in the open dock');

  const layout = await run(() => {
    const pane = document.querySelector('.backlink-view').getBoundingClientRect();
    const row = document.querySelector('.backlink-pane .search-result-file-match');
    const rr = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    const header = document.querySelector('.backlink-header').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.backlink-toolbar .clickable-icon')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, label: el.getAttribute('aria-label') };
    });
    const mid = buttons.reduce((s, b) => s + b.x + b.w / 2, 0) / buttons.length;
    return {
      inset: rr.x - pane.x,
      width: rr.width,
      height: rr.height,
      pad: style.padding,
      line: style.lineHeight,
      font: style.fontSize,
      headerH: header.height,
      headerY: header.y,
      buttons,
      mid,
      paneMid: pane.x + pane.width / 2,
    };
  });
  check(Math.abs(layout.inset - 13) < 2 && Math.abs(layout.width - 274) < 2, `a mention row is inset 13px and 274px wide (inset ${layout.inset}, width ${layout.width})`);
  check(Math.abs(layout.height - 31.6) < 1.5 && layout.line === '15.6px' && layout.font === '12px', `a mention row is 31.6px at 12px/15.6px (${layout.height}, ${layout.font}, ${layout.line}, pad ${layout.pad})`);
  check(layout.pad === '8px 20px 8px 12px', `mention padding is 8px 20px 8px 12px (${layout.pad})`);
  check(layout.buttons.length === 4 && layout.buttons.every((b) => Math.abs(b.w - 28) < 1 && Math.abs(b.h - 24) < 1 && Math.abs(b.y - 48) < 2), `four 28×24 toolbar buttons sit at y=48 (${JSON.stringify(layout.buttons)})`);
  check(Math.abs(layout.mid - layout.paneMid) < 8, `the backlink toolbar is centered (${layout.mid} vs ${layout.paneMid})`);
  check(Math.abs(layout.headerH - 24.9) < 1 && Math.abs(layout.headerY - 84) < 3, `Linked mentions is 24.9px at y=84 (${layout.headerH} at ${layout.headerY})`);

  const unlinkedHeader = await run(() => {
    const el = [...document.querySelectorAll('.backlink-header')].find((n) => n.textContent.includes('Unlinked'));
    const r = el.getBoundingClientRect();
    return { x: r.x + 40, y: r.y + r.height / 2 };
  });
  await click(unlinkedHeader);
  await wait(async () => (await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-match')].some((row) => row.textContent.includes('unlinked')))), 'the unlinked row did not appear');
  const plain = await run(() => {
    const row = [...document.querySelectorAll('.backlink-pane .search-result-file-match')].find((n) => n.textContent.includes('unlinked'));
    const r = row.getBoundingClientRect();
    return { x: r.x + 30, y: r.y + r.height / 2, h: r.height };
  });
  check(Math.abs(plain.h - 31.6) < 1.5, `an unlinked mention row is 31.6px (${plain.h})`);
  await move(plain);
  const linkBtn = await run(() => {
    const row = [...document.querySelectorAll('.backlink-pane .search-result-file-match')].find((n) => n.textContent.includes('unlinked'));
    const button = row.querySelector('.search-result-file-match-replace-button');
    const chevron = row.querySelector('.backlink-context-toggle');
    const b = button.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return { gap: rowBox.right - b.right, h: b.height, chevron: getComputedStyle(chevron).display };
  });
  check(Math.abs(linkBtn.gap - 24) < 2 && Math.abs(linkBtn.h - 25) < 0.6, `the Link button sits 24px from the row's right edge and is 25px tall (gap ${linkBtn.gap}, h ${linkBtn.h})`);
  check(linkBtn.chevron === 'flex', 'hovering a mention shows the context chevron');

  await click(await center('.backlink-toolbar [aria-label="Show more context"]'));
  await wait(async () => (await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-match')].some((row) => row.textContent.includes('before the mention')))), 'Show more context did not draw the lines around the hit');
  check(await run(() => document.querySelector('.backlink-toolbar [aria-label="Show more context"]').classList.contains('is-active')), 'Show more context stays pressed');

  await click(await center('.backlink-toolbar [aria-label="Change sort order"]'));
  await wait(async () => !!(await run(() => [...document.querySelectorAll('.menu-item')].some((el) => el.textContent.includes('Z to A')))), 'the sort menu did not open');
  const za = await run(() => {
    const el = [...document.querySelectorAll('.menu-item')].find((n) => n.textContent.includes('Z to A'));
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(za);
  await wait(async () => {
    const names = await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-name')].map((el) => el.textContent));
    return names[0]?.includes('Pair') && names[1]?.includes('Other');
  }, 'sort did not put Pair before Other');

  await click(await center('.backlink-toolbar [aria-label="Show search filter"]'));
  const filterAt = await run(() => {
    const el = document.querySelector('.backlink-filter');
    const r = el.getBoundingClientRect();
    return { x: r.x + 16, y: r.y + r.height / 2, h: r.height };
  });
  check(filterAt.h > 10, 'the backlink filter opens under the toolbar');
  await click(filterAt);
  await send('Input.insertText', { text: 'pair' });
  await wait(async () => (await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-name')].map((el) => el.textContent).join('|'))) === 'R27oPair', 'the backlink filter did not keep only Pair');
  await press('Escape');

  await run(() => grove.run('outline:open'));
  await wait(async () => (await run(() => [...document.querySelectorAll('.outline-item .tree-item-inner')].map((el) => el.textContent).join('|'))) === 'Alpha|Beta|Gamma|Delta', 'the outline did not list Alpha through Delta');
  const outline = await run(() => [...document.querySelectorAll('.outline-item')].map((el) => {
    const row = el.getBoundingClientRect();
    const text = el.querySelector('.tree-item-inner').getBoundingClientRect();
    return { name: el.querySelector('.tree-item-inner').textContent, dx: text.x - row.x, y: row.y, guide: getComputedStyle(el, '::before').width };
  }));
  const byName = Object.fromEntries(outline.map((row) => [row.name, row]));
  check([byName.Alpha.dx, byName.Beta.dx, byName.Gamma.dx, byName.Delta.dx].every((dx, i) => Math.abs(dx - [24, 41, 58, 41][i]) < 1.5), `outline text sits at +24/+41/+58/+41 (${outline.map((r) => r.name + ':' + r.dx.toFixed(1)).join(' ')})`);
  check(Math.abs((byName.Beta.y - byName.Alpha.y) - 27) < 1.5, `outline rows are 27px apart (${byName.Beta.y - byName.Alpha.y})`);
  check(byName.Alpha.guide === '0px' && byName.Beta.guide === '17px' && byName.Gamma.guide === '34px' && byName.Delta.guide === '17px', `indent guides follow the depth (${outline.map((r) => r.guide).join(' ')})`);
  check(await run(() => document.querySelector('.outline-filter').hidden), 'the outline filter stays hidden until its button is pressed');

  const editor = await run(() => {
    const el = [...document.querySelectorAll('.cm-scroller')].find((node) => node.offsetParent && node.getBoundingClientRect().width > 80);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: Math.min(r.bottom - 24, r.y + 140) };
  });
  await move(editor);
  check(await run(() => !document.querySelector('.outline-toolbar [aria-label="Auto-scroll to current section"]').classList.contains('is-active')), 'auto-scroll starts off');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: editor.x, y: editor.y, deltaX: 0, deltaY: 280 });
  await sleep(40);
  check((await run(() => document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent ?? '')) !== 'Beta', 'auto-scroll stays off until its button is pressed');
  await click(await center('.outline-toolbar [aria-label="Auto-scroll to current section"]'));
  let followed = '';
  for (let i = 0; i < 16 && followed !== 'Beta'; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: editor.x, y: editor.y, deltaX: 0, deltaY: 280 });
    await sleep(40);
    followed = await run(() => document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent ?? '');
  }
  check(followed === 'Beta', `auto-scroll follows the heading (${followed})`);
  await click(await center('.outline-toolbar [aria-label="Auto-scroll to current section"]'));
  for (let i = 0; i < 10; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: editor.x, y: editor.y, deltaX: 0, deltaY: 400 });
    await sleep(30);
  }
  check(await run(() => document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent) === 'Beta', 'turning auto-scroll off leaves the highlight where it was');

  await run(() => grove.run('global-search:open'));
  const searchBox = await run(() => {
    const input = document.querySelector('.search-view .search-input');
    const button = document.querySelector('.search-view [aria-label="Search settings"]');
    const ir = input.getBoundingClientRect();
    const br = button.getBoundingClientRect();
    return { x: ir.x + 40, y: ir.y + ir.height / 2, inputRight: ir.right, buttonX: br.x, buttonW: br.width, buttonH: br.height };
  });
  await click({ x: searchBox.x, y: searchBox.y });
  const ring = await run(() => {
    const style = getComputedStyle(document.querySelector('.search-view .search-input'));
    return { shadow: style.boxShadow, border: style.borderColor };
  });
  check(ring.shadow.includes('0px 0px 0px 2px') && ring.border === 'rgb(189, 189, 189)', `a focused search field uses the grey ring (${ring.shadow}; ${ring.border})`);
  check(searchBox.buttonX >= searchBox.inputRight - 1 && Math.abs(searchBox.buttonW - 28) < 1 && Math.abs(searchBox.buttonH - 24) < 1, `Search settings is a 28×24 button to the right of the field (${searchBox.buttonX} vs ${searchBox.inputRight}, ${searchBox.buttonW}×${searchBox.buttonH})`);
  check(await run(() => {
    const info = document.querySelector('.search-results-info');
    return !!info?.querySelector('[aria-label="Sort order"]') && !!info?.querySelector('[aria-label="More options"]');
  }), 'the count row keeps the sort and the more button');

  await click(await center('.search-view [aria-label="Search settings"]'));
  check(await run(() => {
    const panel = document.querySelector('.search-settings');
    const toggles = [...panel.querySelectorAll('[role="switch"]')].map((el) => el.getAttribute('aria-label'));
    return !panel.hidden && !panel.querySelector('select') && toggles.includes('Collapse results') && toggles.includes('Show more context') && toggles.includes('Explain search terms');
  }), 'Search settings holds labeled toggles for collapse, context, and explain');
  await click(await center('.search-settings [aria-label="Explain search terms"]'));
  await click({ x: searchBox.x, y: searchBox.y });
  await send('Input.insertText', { text: 'file:R27oPair' });
  await wait(async () => (await run(() => document.querySelector('.search-explain')?.textContent ?? '')).includes('file name'), 'Explain search terms did not describe the query');
  check(await run(() => document.querySelector('.search-explain').textContent) === 'Matches notes that have a file name containing "r27opair".', 'the explanation names the file term');

  await click({ x: searchBox.x, y: searchBox.y });
  await chord('a');
  await send('Input.insertText', { text: 'middle' });
  await wait(async () => (await run(() => document.querySelectorAll('.search-view .search-result-file-match').length)) > 0, 'search did not list the mention');
  await press('ArrowDown');
  check(await run(() => !!document.querySelector('.search-view .search-result.has-focus') && !document.querySelector('.search-view .search-result-file-match.is-selected')), 'the first ArrowDown focuses the file row');
  await press('ArrowDown');
  const picked = await run(() => {
    const row = document.querySelector('.search-view .search-result-file-match.is-selected');
    if (!row) return null;
    const style = getComputedStyle(row);
    const bg = style.backgroundColor;
    const nums = bg.match(/[\d.]+/g)?.map(Number) ?? [];
    return { path: row.dataset.previewPath, bg, plain: nums.length < 3 || nums[3] === 0 || (nums[0] === nums[1] && nums[1] === nums[2]), shadow: style.boxShadow, radius: style.borderRadius };
  });
  check(picked?.plain && picked.shadow.includes('0px 0px 0px 2px') && picked.radius === '4px', `ArrowDown outlines the match with a 4px radius (${picked?.bg}; ${picked?.shadow}; ${picked?.radius})`);
  await click(await center('.search-settings [aria-label="Show more context"]'));
  await wait(async () => (await run(() => [...document.querySelectorAll('.search-view .search-result-file-match')].some((row) => row.textContent.includes('before the mention')))), 'search Show more context did not draw the surrounding lines');
}, { height: 800 });
