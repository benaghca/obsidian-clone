// Round 27t: link-popup footer and anchor, suggestion type, rename pill, delete spacing, attachments in the quick switcher.
// Headless Chromium at 1280×800, real pointer and keyboard, scratch vault.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, click, press, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const placeCaret = async () => click(await run(() => {
    const pos = ws.view.state.doc.length;
    ws.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    ws.view.focus();
    const r = ws.view.coordsAtPos(pos);
    return { x: Math.min(1100, r.left + 8), y: (r.top + r.bottom) / 2 };
  }));
  const popup = () => run(() => {
    const tip = document.querySelector('.cm-tooltip.cm-link-suggest');
    if (!tip) return null;
    const box = tip.getBoundingClientRect();
    const footer = tip.querySelector('.cm-link-suggest-footer');
    const ul = tip.querySelector('ul');
    const label = tip.querySelector('.cm-completionLabel');
    const row = label?.closest('li');
    const key = footer?.querySelector('b');
    const at = ws.view.state.doc.toString().lastIndexOf('[[');
    const after = at < 0 ? null : ws.view.coordsAtPos(at + 2);
    const shift = new DOMMatrix(getComputedStyle(tip).transform).m41;
    return {
      kids: [...tip.children].map((el) => el.tagName + (el.className ? '.' + el.className.split(' ')[0] : '')),
      x: box.x, y: box.y, w: box.width, h: box.height,
      left: parseFloat(tip.style.left), shift,
      footerBelow: !!(footer && ul && footer.getBoundingClientRect().top >= ul.getBoundingClientRect().bottom - 1),
      labelSize: label ? getComputedStyle(label).fontSize : null,
      rowH: row ? row.getBoundingClientRect().height : null,
      keyColor: key ? getComputedStyle(key).color : null,
      keyWeight: key ? getComputedStyle(key).fontWeight : null,
      keyText: key?.textContent ?? '',
      afterX: after?.left ?? null,
      text: tip.innerText.replaceAll('\n', ' | '),
    };
  });

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R27t Plain.md', 'Plain line.\n');
    await api.createNote('R27t Zep.md', '---\naliases:\n  - Zephyr\n---\nZep note.\n');
    await api.createNote('R27t Linker.md', 'See [[Missing note]] and [[R27t Plain]].\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('R27t Plain.md');
    ws.setMode('live');
  });

  await placeCaret();
  await send('Input.insertText', { text: '\n' });
  for (const ch of '[[Zep') {
    await send('Input.insertText', { text: ch });
    await sleep(40);
  }
  await wait(async () => !!(await run(() => document.querySelector('.cm-link-suggest li'))), 'char-by-char [[Zep did not open');
  await sleep(80);
  const typed = await popup();
  console.log(`MEASURE typed ${typed.x.toFixed(1)}×${typed.w.toFixed(1)} h=${typed.h.toFixed(1)} kids=${typed.kids.join('>')} row=${typed.rowH?.toFixed(1)} key=${typed.keyColor} ${typed.keyText}`);
  check(typed.footerBelow && typed.kids.at(-1).startsWith('DIV'), `the hint stays under the suggestions (${typed.kids.join('>')})`);
  check(Math.abs(typed.x - typed.afterX) < 4 && Math.abs(typed.left + typed.shift - typed.afterX) < 4, `typed [[Zep sits on the character after [[ (${typed.x.toFixed(1)} vs ${typed.afterX.toFixed(1)})`);
  check(typed.keyColor === 'rgb(92, 92, 92)' && typed.keyText.startsWith('Type '), `the hint key is muted (${typed.keyColor}, ${typed.keyText})`);
  await press('Escape');
  await sleep(40);

  await run(() => {
    window.__tipFrames = [];
    const obs = new MutationObserver(() => {
      const tip = document.querySelector('.cm-tooltip.cm-link-suggest');
      if (!tip || tip.style.top === '-10000px') return;
      const box = tip.getBoundingClientRect();
      if (box.width < 2) return;
      window.__tipFrames.push({ x: box.x, left: tip.style.left, transform: tip.style.transform });
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
  });
  await placeCaret();
  await send('Input.insertText', { text: '\n[[Ide' });
  await wait(async () => !!(await run(() => document.querySelector('.cm-link-suggest li'))), 'one-insert [[Ide did not open');
  await sleep(60);
  const pasted = await popup();
  const frames = await run(() => window.__tipFrames);
  console.log(`MEASURE insert ${pasted.x.toFixed(1)} left=${pasted.left.toFixed(1)} shift=${pasted.shift.toFixed(1)} frames=${frames.length}`);
  check(Math.abs(pasted.x - pasted.afterX) < 4, `a one-insert [[Ide sits on the same anchor (${pasted.x.toFixed(1)} vs ${pasted.afterX.toFixed(1)})`);
  check(frames.every((frame) => Math.abs(frame.x - pasted.afterX) < 40), `the popup never jumps to twice the anchor (${frames.map((frame) => frame.x.toFixed(0)).join(',')})`);
  check(pasted.footerBelow, 'a one-insert popup also keeps the hint last');
  check(pasted.labelSize === '15px' && Math.abs(pasted.rowH - 31.5) < 2, `suggestion titles are 15px on a 31.5px row (${pasted.labelSize}, ${pasted.rowH?.toFixed(1)})`);
  await press('Escape');

  await placeCaret();
  await send('Input.insertText', { text: '\n[[#' });
  await wait(async () => (await run(() => document.querySelector('.cm-link-suggest li')?.textContent ?? '')) === 'Heading', '[[# with no headings did not open');
  await sleep(80);
  const empty = await popup();
  console.log(`MEASURE empty ${empty.w.toFixed(1)}×${empty.h.toFixed(1)} x=${empty.x.toFixed(1)} after=${empty.afterX.toFixed(1)}`);
  check(Math.abs(empty.x - empty.afterX) < 4, `an empty heading popup uses the same anchor (${empty.x.toFixed(1)} vs ${empty.afterX.toFixed(1)})`);
  check(Math.abs(empty.w - 94) < 4 && Math.abs(empty.h - 78) < 4, `an empty heading popup is about 94×78 (${empty.w.toFixed(1)}×${empty.h.toFixed(1)})`);
  await press('Escape');

  await placeCaret();
  await send('Input.insertText', { text: '\n[[' });
  await wait(async () => (await run(() => document.querySelectorAll('.cm-link-suggest li').length)) > 5, '[[ did not list notes');
  await sleep(120);
  const listed = await run(() => [...document.querySelectorAll('.cm-link-suggest li')].map((li) => li.innerText.replaceAll('\n', ' / ')));
  console.log(`MEASURE links ${listed.join(' || ')}`);
  check(listed.some((row) => row.includes('photo.png')) && listed.some((row) => row.includes('diagram.svg')), 'the link menu lists image attachments');
  check(listed.some((row) => row.includes('Projects/')), 'a note in a folder shows the folder as Projects/');
  check(listed.some((row) => row.startsWith('Missing note')), 'an unresolved link target is listed');
  await press('Escape');

  await click(await run(() => {
    const r = document.querySelector('.inline-title').getBoundingClientRect();
    return { x: r.x + 30, y: r.y + r.height / 2 };
  }));
  await send('Input.insertText', { text: ':' });
  await sleep(60);
  const rename = await run(() => {
    const title = document.querySelector('.inline-title');
    const err = document.querySelector('.inline-title + .rename-error');
    const tr = title.getBoundingClientRect();
    const er = err.getBoundingClientRect();
    const cs = getComputedStyle(err);
    const arrow = getComputedStyle(err, '::before');
    return {
      cls: err.className, text: err.textContent,
      x: er.x, y: er.y, w: er.width, h: er.height,
      color: cs.color, bg: cs.backgroundColor, pad: cs.padding, radius: cs.borderRadius, align: cs.textAlign, size: cs.fontSize,
      titleCenter: tr.x + tr.width / 2, titleBottom: tr.bottom,
      arrow: arrow.borderBottomColor, arrowH: parseFloat(arrow.borderBottomWidth),
    };
  });
  console.log(`MEASURE rename ${rename.w.toFixed(1)}×${rename.h.toFixed(1)} at ${rename.x.toFixed(1)},${rename.y.toFixed(1)} center ${rename.titleCenter.toFixed(1)} bottom ${rename.titleBottom.toFixed(1)}`);
  check(rename.cls === 'rename-error' && rename.text.includes('cannot contain'), 'the rename error keeps its text');
  check(Math.abs(rename.w - 400) < 2 && Math.abs(rename.h - 33) < 2 && rename.bg === 'rgb(233, 49, 71)' && rename.color === 'rgb(255, 255, 255)', `the error is a red pill with white text (${rename.w.toFixed(1)}×${rename.h.toFixed(1)}, ${rename.bg})`);
  check(Math.abs(rename.x - (rename.titleCenter - 200)) < 2 && Math.abs(rename.y - (rename.titleBottom + 8)) < 2, `the pill is centred under the title (${rename.x.toFixed(1)}, ${rename.y.toFixed(1)})`);
  check(rename.arrow === 'rgb(233, 49, 71)' && Math.abs(rename.arrowH - 5) < 0.5 && rename.align === 'center', 'the pill has a centred arrow and centred text');
  await press('Escape');

  await run(() => grove.run('file-explorer:open'));
  await sleep(40);
  await press('ArrowDown');
  await sleep(30);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await wait(async () => !!(await run(() => document.querySelector('.modal.mod-confirm'))), 'Delete did not ask');
  const dialog = await run(() => {
    const modal = document.querySelector('.modal.mod-confirm');
    const mr = modal.getBoundingClientRect();
    const last = [...modal.querySelectorAll('.modal-content p')].at(-1).getBoundingClientRect();
    const label = modal.querySelector('.modal-checkbox');
    const lr = label.getBoundingClientRect();
    return { h: mr.height, gap: lr.top - last.top, label: getComputedStyle(label).fontSize, text: label.textContent };
  });
  console.log(`MEASURE dialog h=${dialog.h.toFixed(1)} gap=${dialog.gap.toFixed(1)} label=${dialog.label}`);
  check(Math.abs(dialog.h - 201.3) < 3 && dialog.label === '15px' && Math.abs(dialog.gap - 64.5) < 4, `the delete dialog matches Obsidian's spacing (${dialog.h.toFixed(1)}, gap ${dialog.gap.toFixed(1)}, ${dialog.label})`);
  await press('Escape');

  const rowH = await run(() => document.querySelector('.nav-file-title').getBoundingClientRect().height);
  check(Math.abs(rowH - 25) < 1.5, `file rows are about 25px (${rowH.toFixed(1)})`);

  await run(() => grove.run('switcher:open'));
  await sleep(60);
  await send('Input.insertText', { text: 'photo' });
  await sleep(80);
  const switched = await run(() => [...document.querySelectorAll('.suggestion-item')].map((el) => el.textContent));
  console.log(`MEASURE switcher ${switched.join(' | ')}`);
  check(switched.some((row) => row.includes('photo.png')), `the quick switcher lists photo.png (${switched.join(' | ')})`);
  await press('Escape');

  const chrome = await run(() => ({
    title: document.title,
    collapse: document.querySelector('.nav-header [aria-label="Expand all"], .nav-header [aria-label="Collapse all"]')?.getAttribute('aria-label'),
    vault: document.querySelector('.vault-switcher')?.innerText.replaceAll('\n', ' ').trim(),
    status: document.querySelector('.status-bar')?.innerText.replaceAll('\n', ' | '),
  }));
  console.log(`MEASURE chrome ${JSON.stringify(chrome)}`);
  check(/ - Sample Vault - Grove$/.test(chrome.title), `the window title ends with the vault and Grove (${chrome.title})`);
  check(chrome.collapse === 'Expand all', `the explorer starts on Expand all (${chrome.collapse})`);
  await click('.nav-header [aria-label="Expand all"]');
  await sleep(80);
  const expanded = await run(() => ({
    label: document.querySelector('.nav-header [aria-label="Expand all"], .nav-header [aria-label="Collapse all"]')?.getAttribute('aria-label'),
    child: !!document.querySelector('.nav-file-title[data-path="Projects/Project roadmap.md"]'),
  }));
  check(expanded.label === 'Collapse all' && expanded.child, `Expand all opens folders and renames the button (${expanded.label})`);
  await click('.nav-header [aria-label="Collapse all"]');
  await sleep(80);
  check(await run(() => document.querySelector('.nav-header [aria-label="Expand all"]')?.getAttribute('aria-label')) === 'Expand all', 'Collapse all restores the Expand all label');
  await click('.vault-switcher');
  await sleep(50);
  const vaultMenu = await run(() => [...document.querySelectorAll('.menu-item')].map((el) => el.textContent.trim()));
  check(vaultMenu.some((item) => item.includes('Manage vaults')), `the vault switcher offers manage (${vaultMenu.join(', ')})`);
  await press('Escape');
  check(chrome.vault?.includes('Sample Vault'), 'the vault switcher shows the vault name');
  check(/backlink/.test(chrome.status) && chrome.status.includes('word') && chrome.status.includes('character'), `the status bar lists backlinks, words and characters (${chrome.status})`);
}, { height: 800 });
