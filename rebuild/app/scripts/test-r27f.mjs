// Round 27f: status pill, Obsidian word count, editing-mode menu, vault footer.
// Headless Chromium, real pointer input. Scratch paths only.
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ run, press, click, check, send }) => {
  const titles = () => run(() => [...document.querySelectorAll('.menu .menu-item-title')].map((el) => el.textContent));
  const pick = async (title) => {
    const at = await run((title) => {
      const row = [...document.querySelectorAll('.menu-item')].find((el) => el.querySelector('.menu-item-title')?.textContent === title);
      const r = row.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, title);
    await click(at);
  };

  const welcomeText = () => run(() => {
    const words = (174).toLocaleString();
    const chars = (1019).toLocaleString();
    const shown = document.querySelector('.status-bar')?.innerText ?? '';
    return { shown, words, chars, ok: shown.includes(`${words} word`) && shown.includes(`${chars} character`) };
  });
  let welcome = await welcomeText();
  for (let i = 0; i < 40 && !welcome.ok; i++) {
    await sleep(50);
    welcome = await welcomeText();
  }
  check(welcome.ok, `Welcome counts as Obsidian does (${welcome.shown.replace(/\s+/g, ' ')})`);

  const pill = await run(() => {
    const el = document.querySelector('.status-bar');
    const style = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.background = 'var(--background-secondary)';
    probe.style.borderColor = 'var(--background-modifier-border)';
    document.body.append(probe);
    const secondary = getComputedStyle(probe).backgroundColor;
    const border = getComputedStyle(probe).borderColor;
    probe.remove();
    const rect = el.getBoundingClientRect();
    const items = [...el.querySelectorAll('.status-bar-item')].filter((item) => !item.hidden).map((item) => item.textContent.replace(/\s+/g, ' ').trim());
    const segments = [...el.querySelectorAll('.plugin-word-count .status-bar-item-segment')].map((el) => el.textContent);
    return {
      background: style.backgroundColor,
      secondary,
      borderTop: style.borderTopWidth,
      borderRight: style.borderRightWidth,
      borderBottom: style.borderBottomWidth,
      borderLeft: style.borderLeftWidth,
      borderColor: style.borderTopColor,
      border,
      radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      padding: style.padding,
      gap: style.gap,
      fontSize: style.fontSize,
      right: rect.right,
      bottom: rect.bottom,
      innerWidth,
      innerHeight,
      items,
      segments,
    };
  });
  check(pill.background === pill.secondary, 'status pill uses the secondary background');
  check(pill.borderTop === '1px' && pill.borderLeft === '1px' && pill.borderRight === '0px' && pill.borderBottom === '0px', `thin top and left border (${pill.borderTop} ${pill.borderRight} ${pill.borderBottom} ${pill.borderLeft})`);
  check(pill.borderColor === pill.border, 'the border uses the divider colour');
  check(pill.radius.join(' ') === '8px 0px 0px 0px', `top-left corner is rounded (${pill.radius.join(' ')})`);
  check(pill.padding === '4px 8px 4px 4px' && pill.gap === '4px' && pill.fontSize === '12px', `tight padding and 12px text (${pill.padding}, ${pill.gap})`);
  check(pill.right >= pill.innerWidth - 1 && pill.bottom >= pill.innerHeight - 1, 'the pill sits in the bottom right corner');
  check(pill.items[0].includes('backlink') && !pill.items.some((text) => text.includes('propert')), `Welcome hides properties (${pill.items.join(' | ')})`);
  check(pill.segments.length === 2 && /174 word/.test(pill.segments[0]) && /1[.,\s]?019 character/.test(pill.segments[1]), `words and characters are one item (${pill.segments.join(' / ')})`);

  await click('.plugin-editor-status');
  const modeMenu = await run(() => {
    const menu = document.querySelector('.menu');
    const style = getComputedStyle(menu);
    return {
      titles: [...menu.querySelectorAll('.menu-item-title')].map((el) => el.textContent),
      animation: style.animationName,
      transition: style.transitionDuration,
      animating: menu.getAnimations().length,
    };
  });
  // Installed Obsidian's editor-status menu lists these three, Reading included.
  check(modeMenu.titles.join(' | ') === 'Reading | Source mode | Live Preview', `editing-mode menu matches Obsidian (${modeMenu.titles.join(' | ')})`);
  check(modeMenu.animation === 'none' && modeMenu.transition === '0s' && modeMenu.animating === 0, 'the editing-mode menu opens with no animation');
  await press('Escape');

  await run(() => ws.open('Projects/Project roadmap.md'));
  let roadmap = [];
  for (let i = 0; i < 40; i++) {
    roadmap = await run(() => [...document.querySelectorAll('.status-bar-item')].filter((item) => !item.hidden).map((item) => ({
      text: item.textContent.replace(/\s+/g, ' ').trim(),
      mode: item.classList.contains('plugin-editor-status'),
      words: item.classList.contains('plugin-word-count'),
    })));
    if (roadmap.some((item) => /propert/.test(item.text)) && roadmap.some((item) => item.words)) break;
    await sleep(50);
  }
  check(/backlink/.test(roadmap[0].text) && /propert/.test(roadmap[1].text) && roadmap[2].mode && roadmap[3].words, `order is backlinks, properties, mode, words (${roadmap.map((item) => item.text || 'mode').join(' | ')})`);

  const footer = await run(() => {
    const name = document.querySelector('.workspace-drawer-vault-name');
    const style = getComputedStyle(name);
    const actions = [...document.querySelectorAll('.workspace-drawer-vault-actions .clickable-icon')].map((el) => el.getAttribute('aria-label'));
    const probe = document.createElement('div');
    probe.style.color = 'var(--text-faint)';
    document.body.append(probe);
    const faint = getComputedStyle(probe).color;
    probe.remove();
    return {
      weight: style.fontWeight,
      size: style.fontSize,
      chevron: !!document.querySelector('.vault-switcher .lucide-chevrons-up-down'),
      vaultIcon: !!document.querySelector('.vault-switcher .lucide-vault'),
      icon: getComputedStyle(document.querySelector('.vault-switcher .svg-icon')).color,
      faint,
      actions,
    };
  });
  check(footer.chevron && !footer.vaultIcon, 'the vault name has an up/down chevron');
  check(footer.weight === '500' && footer.size === '13px', `the vault name is lighter (${footer.weight}, ${footer.size})`);
  check(footer.icon === footer.faint, 'the chevron is the faint icon colour');
  check(footer.actions.join(' | ') === 'Help | Settings', `help sits beside the gear (${footer.actions.join(' | ')})`);

  await click('.workspace-drawer-vault-actions [aria-label="Help"]');
  const help = await run(() => {
    const modal = document.querySelector('.modal.mod-confirm');
    const style = getComputedStyle(modal);
    return {
      title: modal.querySelector('.modal-title')?.textContent ?? '',
      animation: style.animationName,
      transition: style.transitionDuration,
      animating: modal.getAnimations().length,
    };
  });
  check(help.title === 'Help' && help.animation === 'none' && help.transition === '0s' && help.animating === 0, 'Help opens immediately, on this machine');
  await press('Escape');

  await click('.vault-switcher');
  await pick('Manage vaults...');
  const manage = await run(() => {
    const menu = document.querySelector('.menu');
    const style = getComputedStyle(menu);
    return {
      titles: [...menu.querySelectorAll('.menu-item-title')].map((el) => el.textContent),
      animation: style.animationName,
      animating: menu.getAnimations().length,
    };
  });
  check(manage.titles.join(' | ') === 'Open another vault... | Create new vault...' && manage.animation === 'none' && manage.animating === 0, `Manage vaults opens the open dialog with no animation (${manage.titles.join(' | ')})`);
  await press('Escape');

  // Nested folders: three levels, an empty folder, and a folder of many files.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('Top/Mid/Empty');
    await api.createFolder('Top/Empty');
    for (let i = 0; i < 30; i++) await api.createNote(`Top/Mid/Many/n${i}.md`, `note ${i}\n`);
    await ws.vault.refreshFiles();
  });
  const folderButton = () => run(() => document.querySelector('.nav-files [aria-label="Expand all"], .nav-files [aria-label="Collapse all"]')?.getAttribute('aria-label') ?? '');
  const title = (path) => `.nav-folder-title[data-path=${JSON.stringify(path)}]`;
  const openAt = (path) => run((path) => {
    const el = document.querySelector(`.nav-folder-title[data-path=${JSON.stringify(path)}]`);
    return !!el && !el.querySelector('.collapse-icon.is-collapsed');
  }, path);
  const shown = (path) => run((path) => !!document.querySelector(`[data-path=${JSON.stringify(path)}]`), path);
  const manyCount = (dir) => run((dir) => document.querySelectorAll(`.nav-file-title[data-path^="${dir}/"]`).length, dir);
  const waitGone = async (path) => {
    for (let i = 0; i < 25 && await shown(path); i++) await sleep(40);
  };

  await click('.nav-files [aria-label="Expand all"]');
  for (const path of ['Top', 'Top/Mid', 'Top/Mid/Empty', 'Top/Mid/Many', 'Top/Empty']) {
    check(await openAt(path), `${path} is open`);
  }
  check(await manyCount('Top/Mid/Many') === 30, `Expand all shows every file (${await manyCount('Top/Mid/Many')})`);
  check(await folderButton() === 'Collapse all', 'Expand all flips the button to Collapse all');

  await click('.nav-files [aria-label="Collapse all"]');
  check(await folderButton() === 'Expand all', 'Collapse all flips the button');
  check(await run(() => document.querySelectorAll('.nav-files .tree-item-children').length) === 0, 'Collapse all closes every folder');
  check(!(await shown('Top/Mid')) && await shown('Top') && !(await openAt('Top')), 'nested folders are hidden and the top folder is closed');

  await click('.nav-files [aria-label="Expand all"]');
  await click(title('Top'));
  await waitGone('Top/Mid');
  check(!(await shown('Top/Mid')) && await folderButton() === 'Collapse all', 'closing a folder hides its children and leaves Collapse all');
  await click(title('Top'));
  check(await openAt('Top/Mid') && await openAt('Top/Mid/Empty') && await openAt('Top/Mid/Many') && await manyCount('Top/Mid/Many') === 30, 'opening the folder again restores every nested folder');

  await run(() => document.querySelector('.nav-folder-title[data-path="Top/Mid/Many"]')?.scrollIntoView({ block: 'center' }));
  await click(title('Top/Mid/Many'));
  await waitGone('Top/Mid/Many/n0.md');
  check(!(await shown('Top/Mid/Many/n0.md')) && await openAt('Top/Mid/Empty') && await folderButton() === 'Collapse all', 'closing one nested folder leaves the others open');
  await click(title('Top/Mid/Many'));
  check(await manyCount('Top/Mid/Many') === 30, 'opening that folder shows its files again');

  await click('.nav-files [aria-label="New folder"]');
  await sleep(80);
  check(await run(() => document.querySelector('.tree-item-inner[contenteditable]')?.textContent ?? '') === 'Untitled', 'New folder starts a rename');
  await send('Input.insertText', { text: 'Fresh' });
  await press('Enter');
  await sleep(100);
  check(await shown('Fresh') && !(await openAt('Fresh')) && await folderButton() === 'Collapse all', 'a new folder stays closed and the button stays Collapse all');

  await run(async () => {
    const { renameFile } = await import('/src/fileOps.ts');
    await renameFile(ws, 'Top/Mid', 'Middle');
  });
  check(await openAt('Top/Middle') && await openAt('Top/Middle/Empty') && await openAt('Top/Middle/Many') && await manyCount('Top/Middle/Many') === 30, 'renaming a folder keeps it and its children open');
  check(!(await shown('Top/Mid')), 'the old folder path is gone');

  await run(() => location.reload());
  let restored = false;
  for (let i = 0; i < 100; i++) {
    try {
      restored = await run(() => !!window.ws?.active?.path && !!document.querySelector('.tree-item-self[data-path="Projects/Project roadmap.md"]'));
      if (restored) break;
    } catch { /* the page is still loading */ }
    await sleep(100);
  }
  check(restored && await openAt('Projects') && await openAt('Daily') && await openAt('Attachments') && await folderButton() === 'Collapse all', 'a reload opens the same folders and keeps Collapse all');
});
