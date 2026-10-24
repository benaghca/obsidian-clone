// Round 27a: collapse/expand toggle, vault switcher, status bar layout.
// Headless Chromium, real pointer and key input. Scratch paths only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ run, press, click, fill, check }) => {
  const button = () => run(() => {
    const el = document.querySelector('.nav-files [aria-label="Expand all"], .nav-files [aria-label="Collapse all"]');
    return {
      label: el?.getAttribute('aria-label') ?? '',
      expandIcon: !!el?.querySelector('.lucide-chevrons-up-down'),
      collapseIcon: !!el?.querySelector('.lucide-chevrons-down-up'),
    };
  });
  const openFolders = () => run(() =>
    [...document.querySelectorAll('.nav-folder-title')]
      .filter((el) => !el.querySelector('.collapse-icon.is-collapsed'))
      .map((el) => el.dataset.path),
  );
  const childCount = () => run(() => document.querySelectorAll('.nav-files .tree-item-children').length);

  const start = await button();
  check(start.label === 'Expand all' && start.expandIcon && !start.collapseIcon, 'a fully collapsed tree shows Expand all');
  check(await childCount() === 0, 'sample folders start closed');

  await click('.nav-files [aria-label="Expand all"]');
  const opened = await button();
  const folders = await openFolders();
  check(opened.label === 'Collapse all' && opened.collapseIcon && !opened.expandIcon, 'expanding flips the button to Collapse all');
  check(folders.includes('Projects') && folders.includes('Daily') && folders.includes('Attachments'), 'expand opens every folder');
  check(await run(() => !!document.querySelector('.tree-item-self[data-path="Projects/Project roadmap.md"]')), 'an expanded folder shows its note');

  for (const path of folders) {
    await click(`.nav-folder-title[data-path=${JSON.stringify(path)}]`);
    // The close slides. Wait so the next click lands on the row, not the moving one.
    await sleep(300);
  }
  const closed = await button();
  check(closed.label === 'Collapse all' && closed.collapseIcon, 'closing the last open folder leaves Collapse all');

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('Nest');
    await api.createFolder('Nest/Inner');
    await ws.vault.refreshFiles();
  });
  await click('.nav-folder-title[data-path="Nest"]');
  await sleep(280);
  await click('.nav-folder-title[data-path="Nest/Inner"]');
  check((await button()).label === 'Collapse all', 'a nested open folder keeps Collapse all');
  await click('.nav-folder-title[data-path="Nest"]');
  check((await button()).label === 'Collapse all', 'closing a parent leaves Collapse all');
  check(await run(() => !!document.querySelector('.nav-folder-title[data-path="Nest"] .collapse-icon.is-collapsed')), 'the parent folder is closed');

  const runCommand = async (name) => {
    await run(() => grove.run('command-palette:open'));
    await fill('.prompt-input', name);
    const selected = await run(() => document.querySelector('.suggestion-item.is-selected .suggestion-title')?.textContent ?? '');
    assert.equal(selected, name, `palette selects ${name}`);
    await press('Enter');
  };
  await runCommand('Files: Expand all');
  check((await button()).label === 'Collapse all' && (await openFolders()).length >= 3, 'Files: Expand all opens the tree');
  await runCommand('Files: Collapse all');
  check((await button()).label === 'Expand all', 'Files: Collapse all flips the button immediately');
  for (let i = 0; i < 20 && await childCount() > 0; i++) await sleep(40);
  check(await childCount() === 0, 'Files: Collapse all closes every folder');

  await runCommand('Files: Expand all');
  await click('.tree-item-self[data-path="Projects/Project roadmap.md"]');
  let statusText = '';
  for (let i = 0; i < 40; i++) {
    statusText = await run(() => document.querySelector('.status-bar')?.innerText ?? '');
    if (statusText.includes('backlink') && statusText.includes('propert') && statusText.includes('word') && statusText.includes('character')) break;
    await sleep(50);
  }
  const bar = await run(() => {
    const el = document.querySelector('.status-bar');
    const style = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.color = 'var(--text-muted)';
    document.body.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    const items = [...el.querySelectorAll('.status-bar-item')].filter((item) => !item.hidden).map((item) => ({
      text: item.textContent.trim(),
      mode: item.classList.contains('plugin-editor-status'),
      svg: !!item.querySelector('svg'),
      link: !!item.querySelector('.lucide-link'),
      top: item.getBoundingClientRect().top,
      height: getComputedStyle(item).height,
      pad: getComputedStyle(item).padding,
    }));
    const rect = el.getBoundingClientRect();
    return {
      fontSize: style.fontSize,
      height: style.height,
      color: style.color,
      muted,
      justify: style.justifyContent,
      whiteSpace: style.whiteSpace,
      rectRight: rect.right,
      rectLeft: rect.left,
      innerWidth,
      items,
    };
  });
  check(bar.fontSize === '12px', `status bar text is 12px (${bar.fontSize})`);
  check(bar.color === bar.muted, 'status bar text is the muted colour');
  check(bar.justify === 'flex-end' && bar.rectRight >= bar.innerWidth - 2 && bar.rectLeft > bar.innerWidth / 2, 'status bar is a right-hand cluster');
  check(bar.whiteSpace === 'nowrap', 'status bar stays on one line');
  const tops = bar.items.map((item) => item.top);
  check(Math.max(...tops) - Math.min(...tops) < 3, 'status bar items share one row');
  check(!bar.items[0].svg && !bar.items[0].link && /backlink/.test(bar.items[0].text), `backlinks lead and are text only (${bar.items[0].text})`);
  check(/propert/.test(bar.items[1].text), `properties follow backlinks (${bar.items[1].text})`);
  const modeAt = bar.items.findIndex((item) => item.mode);
  const countAt = bar.items.findIndex((item) => /word/.test(item.text) && /character/.test(item.text));
  check(modeAt === 2 && bar.items[modeAt].svg && bar.items[modeAt].text === '', 'the editing-mode icon follows the counts');
  check(countAt === bar.items.length - 1, `words and characters share the last item (${bar.items.map((item) => item.text).join(' | ')})`);
  check(!bar.items.some((item) => /sync/i.test(item.text)), 'status bar has no sync item');
  check(modeAt > bar.items.findIndex((item) => /backlink/.test(item.text)), 'the mode icon is not first');

  const menuTitles = async () => run(() =>
    [...document.querySelectorAll('.menu .menu-item-title')].map((el) => el.textContent),
  );
  const pick = async (title) => {
    const at = await run((title) => {
      const row = [...document.querySelectorAll('.menu-item')].find((el) => el.querySelector('.menu-item-title')?.textContent === title);
      const r = row.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, title);
    await click(at);
  };
  const waitVault = async (name) => {
    let last = '';
    for (let i = 0; i < 120; i++) {
      try {
        const got = await run(() => document.querySelector('.workspace-drawer-vault-name')?.textContent ?? '');
        last = got;
        if (got === name && await run(() => !!document.querySelector('.vault-switcher .lucide-chevrons-up-down'))) return;
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
      await sleep(100);
    }
    assert.fail(`vault footer did not become ${name} (${last})`);
  };

  check(await run(() => document.querySelector('.vault-switcher')?.getAttribute('aria-label') === 'Manage vaults' && !!document.querySelector('.vault-switcher .lucide-chevrons-up-down') && document.querySelector('.workspace-drawer-vault-name')?.textContent === 'Sample Vault'), 'footer shows the chevron and the vault name');
  const before = await run(() => {
    const r = document.querySelector('.vault-switcher').getBoundingClientRect();
    return { y: r.y, name: document.querySelector('.workspace-drawer-vault-name').textContent };
  });
  await click('.vault-switcher');
  const openedMenu = await run(() => {
    const menu = document.querySelector('.menu');
    const style = getComputedStyle(menu);
    const box = menu.getBoundingClientRect();
    const anchor = document.querySelector('.vault-switcher').getBoundingClientRect();
    return {
      titles: [...menu.querySelectorAll('.menu-item-title')].map((el) => el.textContent),
      checked: [...menu.querySelectorAll('.menu-item.is-checked .menu-item-title')].map((el) => el.textContent),
      animation: style.animationName,
      transition: style.transitionDuration,
      animating: menu.getAnimations().length,
      above: box.bottom <= anchor.top + 1,
    };
  });
  check(openedMenu.titles[0] === 'Sample Vault' && openedMenu.titles.includes('Manage vaults...'), `vault menu lists the current vault and Manage vaults (${openedMenu.titles.join(' | ')})`);
  check(openedMenu.checked.length === 1 && openedMenu.checked[0] === 'Sample Vault', 'the current vault is marked');
  check(openedMenu.above, 'the menu opens above the footer');
  check(openedMenu.animation === 'none' && openedMenu.transition === '0s' && openedMenu.animating === 0, 'the vault menu opens with no animation');

  await pick('Manage vaults...');
  await pick('Create new vault...');
  check(await run(() => !!document.querySelector('.prompt-input') && !document.querySelector('.menu')), 'Create new vault opens the path prompt immediately');
  await press('Enter');
  check(await run(() => !!document.querySelector('.prompt-input') && document.querySelector('.workspace-drawer-vault-name').textContent === 'Sample Vault'), 'an empty path does not switch vaults');
  await press('Escape');

  const created = `/tmp/grove-r27a-created-${Date.now()}`;
  const createdName = created.split('/').pop();
  await click('.vault-switcher');
  await pick('Manage vaults...');
  await pick('Create new vault...');
  await fill('.prompt-input', created);
  await press('Enter');
  await waitVault(createdName);
  check(await run(() => !ws.vault.files.some((f) => f.path === 'Welcome.md')), 'a new vault does not keep the sample notes');
  await click('.vault-switcher');
  const afterCreate = await run(() => ({
    titles: [...document.querySelectorAll('.menu-item-title')].map((el) => el.textContent),
    checked: [...document.querySelectorAll('.menu-item.is-checked .menu-item-title')].map((el) => el.textContent),
  }));
  check(afterCreate.titles.includes(createdName) && afterCreate.titles.includes('Sample Vault') && afterCreate.checked[0] === createdName, `recent vaults list both, with the new one marked (${afterCreate.titles.join(' | ')})`);

  const openedPath = `/tmp/grove-r27a-opened-${Date.now()}`;
  const openedName = openedPath.split('/').pop();
  await pick('Manage vaults...');
  await pick('Open another vault...');
  await fill('.prompt-input', openedPath);
  await press('Enter');
  await waitVault(openedName);
  await click('.vault-switcher');
  const afterOpen = await menuTitles();
  check(afterOpen.includes(openedName) && afterOpen.includes(createdName) && afterOpen.includes('Sample Vault'), `Open another vault keeps the earlier recents (${afterOpen.join(' | ')})`);
  await pick('Sample Vault');
  await waitVault('Sample Vault');
  check(await run(() => ws.vault.files.some((f) => f.path === 'Welcome.md') && !!ws.active.path), 'switching back reloads the sample vault');
  check(before.name === 'Sample Vault' && before.y > 600, 'the switcher sits at the bottom of the left sidebar');
});
