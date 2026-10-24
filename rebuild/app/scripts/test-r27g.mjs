// Round 27g: Alt/Shift/Ctrl explorer selection, the multi-select menu,
// selected-row pills, the empty new-tab page, and the vault footer.
// Headless Chromium, real pointer and key input. Scratch vault only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const note = `---
status: round
tags: [select]
---
A frontmatter note for the selection checks.
`;

await withBrowser(async ({ send, run, press, chord, point, move, click, check }) => {
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const selected = () => run(() => [...document.querySelectorAll('.nav-files .tree-item-self.is-selected')].map((el) => el.dataset.path));
  const has = (path) => run((path) => ws.vault.files.some((file) => file.path === path), path);
  const tabs = () => run(() => ws.tabs.map((tab) => tab.path));
  const titles = () => run(() => [...document.querySelectorAll('.menu .menu-item-title')].map((el) => el.textContent));
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const at = async (path) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), row(path));
    await sleep(20);
    return point(row(path));
  };
  const clickAt = async (p, modifiers = 0, button = 'left') => {
    await move(p);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...p, button, clickCount: 1, modifiers });
    }
    await sleep(50);
  };
  const menuAt = async (title) => {
    const p = await run((title) => {
      const item = [...document.querySelectorAll('.menu .menu-item')].find((el) => el.querySelector('.menu-item-title')?.textContent === title);
      const rect = item.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, title);
    await click(p);
  };

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    for (const path of ['G/A.md', 'G/B.md', 'G/C.md']) await api.createNote(path, body);
    await ws.vault.refreshFiles();
  }, note);
  await click('.nav-files [aria-label="Expand all"]');
  await wait(() => run(() => !!document.querySelector('.tree-item-self[data-path="G/A.md"]')), 'rows visible');

  const before = await run(() => ws.active.path);
  await clickAt(await at('G/A.md'), 1);
  check((await selected()).join() === 'G/A.md' && await run(() => ws.active.path) === before, 'alt-click adds a row and does not open it');
  await clickAt(await at('G/B.md'), 1);
  check((await selected()).join() === 'G/A.md,G/B.md', 'alt-click adds a second row');
  await clickAt(await at('G/A.md'), 1);
  check((await selected()).join() === 'G/B.md', 'alt-click again removes that row');
  await clickAt(await at('G/A.md'), 1);
  await clickAt(await at('G/C.md'), 8);
  check((await selected()).join() === 'G/A.md,G/B.md,G/C.md', 'shift-click selects the visible range');

  const tabsBefore = await tabs();
  await clickAt(await at('G/C.md'), 2);
  await sleep(80);
  const opened = await run(() => ({ path: ws.active.path, tabs: ws.tabs.map((tab) => tab.path), selected: [...document.querySelectorAll('.nav-files .tree-item-self.is-selected')].map((el) => el.dataset.path) }));
  check(opened.selected.length === 0 && opened.path === 'G/C.md' && opened.tabs.length === tabsBefore.length + 1 && opened.tabs.includes('Welcome.md'), `ctrl-click opens a new tab and clears the selection (${opened.tabs.join(', ')})`);
  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    check(await run(() => ws.view.state.doc.toString().startsWith('---\nstatus: round')), `${mode}: the ctrl-clicked note still shows its frontmatter`);
  }
  await run(() => ws.setMode('live'));

  await clickAt(await at('G/A.md'), 1);
  await clickAt(await at('G/B.md'), 1);
  await click(row('G/B.md'), 'right');
  const menu = await run(() => {
    const open = document.querySelector('.menu');
    const style = getComputedStyle(open);
    const clicked = document.querySelector('.tree-item-self[data-path="G/B.md"]');
    const other = document.querySelector('.tree-item-self[data-path="G/A.md"]');
    const probe = document.createElement('div');
    probe.style.color = 'var(--background-modifier-border-focus)';
    document.body.append(probe);
    const focus = getComputedStyle(probe).color;
    probe.remove();
    return {
      titles: [...open.querySelectorAll('.menu-item-title')].map((el) => el.textContent),
      animation: style.animationName,
      transition: style.transitionDuration,
      animations: open.getAnimations().length,
      radius: getComputedStyle(clicked).borderRadius,
      clicked: clicked.classList.contains('has-active-menu'),
      other: other.classList.contains('has-active-menu'),
      shadow: getComputedStyle(clicked).boxShadow,
      otherShadow: getComputedStyle(other).boxShadow,
      focus,
    };
  });
  check(menu.titles[0] === 'New folder with selection' && menu.titles.includes('Bookmark...') && menu.titles.includes('Move 2 items to...'), `the multi-select menu leads with a new folder and Bookmark... (${menu.titles.join(' | ')})`);
  check(menu.animation === 'none' && menu.transition === '0s' && menu.animations === 0, 'the selection menu opens with no animation');
  check(menu.radius === '8px' && menu.clicked && !menu.other && menu.shadow.includes(menu.focus) && menu.otherShadow === 'none', `selected rows are 8px pills and only the right-clicked row is outlined (${menu.radius}, ${menu.shadow})`);
  await press('Escape');
  const cleared = await run(() => ({
    menu: !!document.querySelector('.menu'),
    outline: document.querySelector('.tree-item-self.has-active-menu'),
    selected: [...document.querySelectorAll('.nav-files .tree-item-self.is-selected')].map((el) => el.dataset.path),
  }));
  check(!cleared.menu && !cleared.outline && cleared.selected.join() === 'G/A.md,G/B.md', 'escape closes the menu and leaves the selection');

  await click(row('G/B.md'), 'right');
  await menuAt('Bookmark...');
  await sleep(40);
  await click('.mod-left-split .workspace-tab-header[aria-label="Bookmarks"]');
  const marks = await run(() => [...document.querySelectorAll('.bookmarks-list .tree-item-self')].map((el) => el.dataset.path));
  check(marks.join() === 'G/A.md,G/B.md', `Bookmark... lists both notes (${marks.join(', ')})`);

  await click('.mod-left-split .workspace-tab-header[aria-label="Files"]');
  await click(row('G/B.md'), 'right');
  await menuAt('New folder with selection');
  await wait(() => run(() => document.querySelector('.nav-files .tree-item-inner[contenteditable]')?.textContent === 'Untitled'), 'the new folder is ready to rename');
  check(await has('G/Untitled/A.md') && await has('G/Untitled/B.md') && !await has('G/A.md') && !await has('G/B.md') && await has('G/C.md'), 'the new folder holds the selection and leaves the other file');
  await press('Escape');
  await click('.mod-left-split .workspace-tab-header[aria-label="Bookmarks"]');
  const movedMarks = await run(() => [...document.querySelectorAll('.bookmarks-list .tree-item-self')].map((el) => el.dataset.path));
  check(movedMarks.join() === 'G/Untitled/A.md,G/Untitled/B.md', `bookmarks follow the files into the new folder (${movedMarks.join(', ')})`);

  await click('.mod-left-split .workspace-tab-header[aria-label="Files"]');
  await click(row('G/C.md'), 'right');
  const single = await titles();
  check(single.includes('Bookmark') && !single.includes('Bookmark...'), `a single file stays Bookmark without an ellipsis (${single.filter((title) => title.includes('Bookmark')).join(', ')})`);
  await press('Escape');

  await chord('t');
  await sleep(60);
  const empty = await run(() => {
    const state = document.querySelector('.empty-state');
    const probe = document.createElement('div');
    document.body.append(probe);
    const colorOf = (value) => { probe.style.color = value; return getComputedStyle(probe).color; };
    const normal = colorOf('var(--text-normal)');
    const muted = colorOf('var(--text-muted)');
    probe.remove();
    const actions = [...state.querySelectorAll('.empty-state-action')].filter((el) => !el.hidden).map((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const label = el.querySelector('.empty-state-action-label');
      const hotkey = el.querySelector('.empty-state-hotkey');
      const icon = el.querySelector('svg');
      return {
        label: label?.textContent ?? '',
        hotkey: hotkey?.textContent ?? '',
        hotkeyHidden: hotkey?.hidden === true,
        icon: icon?.getAttribute('class') ?? '',
        justify: style.justifyContent,
        font: style.fontSize,
        weight: style.fontWeight,
        color: style.color,
        hotkeyColor: hotkey ? getComputedStyle(hotkey).color : '',
        pad: style.padding,
        radius: style.borderRadius,
        transition: style.transitionDuration,
        animation: style.animationName,
        animations: el.getAnimations().length,
        width: rect.width,
        iconLeft: icon.getBoundingClientRect().left - rect.left,
        labelClip: label.scrollWidth > label.clientWidth + 1,
        hotkeyClip: hotkey && !hotkey.hidden ? hotkey.scrollWidth > hotkey.clientWidth + 1 : false,
      };
    });
    const sr = state.getBoundingClientRect();
    return {
      title: document.querySelector('.view-header .view-header-title')?.textContent ?? '',
      close: [...state.querySelectorAll('.empty-state-action-label')].some((el) => el.textContent === 'Close'),
      normal,
      muted,
      actions,
      centered: actions.every((action) => Math.abs(action.width) >= 0) && Math.abs((actions[0] && (document.querySelector('.empty-state-action').getBoundingClientRect().x + actions[0].width / 2)) - (sr.x + sr.width / 2)) < 2,
    };
  });
  const wanted = [
    ['New note', 'Ctrl + N', 'lucide-square-pen'],
    ['Go to file', 'Ctrl + O', 'lucide-layout-list'],
    ['Search', 'Ctrl + Shift + F', 'lucide-search'],
    ['New canvas', '', 'lucide-layout-dashboard'],
  ];
  const got = empty.actions.map((action) => [action.label, action.hotkey, action.icon.includes('lucide-') ? action.icon.split(' ').find((name) => name.startsWith('lucide-')) : action.icon]);
  check(empty.title === 'New tab' && !empty.close && JSON.stringify(got) === JSON.stringify(wanted), `the empty tab is titled New tab and its pills are ${got.map((item) => item.join(' ')).join(' | ')}`);
  check(empty.actions.every((action) => action.hotkeyHidden === !action.hotkey && !/[[\]]/.test(action.hotkey)), 'each shortcut is its own span, with no brackets, and a missing shortcut is hidden');
  const width = empty.actions[0]?.width ?? 0;
  check(empty.actions.every((action) => action.font === '13px' && action.weight === '400' && action.color === empty.normal && action.pad === '8px 12px' && action.radius === '999px' && action.justify === 'flex-start' && action.iconLeft > 10 && action.iconLeft < 16 && (action.hotkey === '' || action.hotkeyColor === empty.muted)), 'pills are 13px normal text, padded 8px 12px, with the icon and label on the left');
  check(empty.actions.every((action) => Math.abs(action.width - width) < 1 && Math.abs(action.width - 184) < 2 && !action.labelClip && !action.hotkeyClip && action.transition === '0s' && action.animation === 'none' && action.animations === 0) && empty.centered, `pills share one width near 184px so Ctrl + Shift + F fits (${width}px, clips ${empty.actions.map((action) => action.labelClip || action.hotkeyClip).join(',')})`);

  const vault = await run(() => {
    const name = document.querySelector('.workspace-drawer-vault-name');
    const dock = document.querySelector('.mod-left-split').getBoundingClientRect();
    const short = { text: name.textContent, scroll: name.scrollWidth, client: name.clientWidth };
    name.textContent = 'This Vault Name Is Intentionally Very Long';
    const long = { scroll: name.scrollWidth, client: name.clientWidth, overflow: getComputedStyle(name).textOverflow };
    name.textContent = short.text;
    return { dock: dock.width, short, long };
  });
  check(Math.abs(vault.dock - 200) < 1 && vault.short.text === 'Sample Vault' && vault.short.scroll <= vault.short.client, `Sample Vault fits the 200px sidebar (${vault.short.scroll}px in ${vault.short.client}px, dock ${vault.dock})`);
  check(vault.long.scroll > vault.long.client && vault.long.overflow === 'ellipsis', 'a long vault name still ends in an ellipsis');

  const spot = await run(() => {
    const name = document.querySelector('.workspace-drawer-vault-name').getBoundingClientRect();
    const button = document.querySelector('.vault-switcher').getBoundingClientRect();
    return { x: name.right - 6, y: name.top + name.height / 2, buttonLeft: button.left };
  });
  await clickAt({ x: spot.x, y: spot.y });
  const placed = await run((spot) => {
    const menu = document.querySelector('.menu');
    const rect = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      animation: style.animationName,
      animations: menu.getAnimations().length,
      dx: Math.min(Math.abs(rect.left - spot.x), Math.abs(rect.right - spot.x)),
      dy: Math.min(Math.abs(rect.top - spot.y), Math.abs(rect.bottom - spot.y)),
    };
  }, spot);
  check(placed.dx < 8 && placed.dy < 8 && Math.abs(placed.left - spot.buttonLeft) > 16 && placed.animation === 'none' && placed.animations === 0, `the vault menu opens at the click (${placed.dx}px across, ${placed.dy}px down)`);
  await press('Escape');
});
