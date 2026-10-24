// Round 27i: selection-menu count and separator, empty-tab key chips,
// and a short vault name that must not ellipsize.
// Headless Chromium, real pointer and key input. Scratch vault only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const note = `---
status: round
tags: [chips]
---
A frontmatter note for the pointer checks.
`;

await withBrowser(async ({ send, run, press, move, click, check }) => {
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const at = async (path) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), row(path));
    await sleep(20);
    return run((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, row(path));
  };
  const clickAt = async (p, modifiers = 0, button = 'left') => {
    await move(p);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...p, button, clickCount: 1, modifiers });
    }
    await sleep(50);
  };

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    for (const path of ['I/A.md', 'I/B.md', 'I/C.md']) await api.createNote(path, body);
    await ws.vault.refreshFiles();
  }, note);
  await click('.nav-files [aria-label="Expand all"]');
  await wait(() => run(() => !!document.querySelector('.tree-item-self[data-path="I/A.md"]')), 'rows visible');

  await clickAt(await at('I/A.md'), 1);
  await clickAt(await at('I/B.md'), 1);
  await click(row('I/B.md'), 'right');
  const menu = await run(() => {
    const open = document.querySelector('.menu');
    const style = getComputedStyle(open);
    const kinds = [...open.children].map((el) => el.classList.contains('menu-separator') ? 'separator' : el.querySelector('.menu-item-title')?.textContent ?? '');
    return { kinds, animation: style.animationName, transition: style.transitionDuration, animations: open.getAnimations().length };
  });
  check(menu.kinds[0] === 'New folder with selection (2 items)' && menu.kinds[1] === 'separator' && menu.kinds.includes('Move 2 items to...') && menu.kinds.at(-1) === 'Delete', `the count is in the label and a separator follows it (${menu.kinds.join(' | ')})`);
  check(menu.animation === 'none' && menu.transition === '0s' && menu.animations === 0, 'the selection menu opens with no animation');
  await press('Escape');

  await clickAt(await at('I/C.md'), 1);
  await click(row('I/C.md'), 'right');
  const three = await run(() => document.querySelector('.menu .menu-item-title')?.textContent ?? '');
  check(three === 'New folder with selection (3 items)', `three selected rows say 3 items (${three})`);
  await press('Escape');

  await run(() => ws.open('I/A.md'));
  await sleep(80);
  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    const spot = await run(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('frontmatter note'));
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
    check(body.startsWith('---\nstatus: round') && body.includes('A frontmatter note'), `${mode}: two clicks at one point leave the frontmatter note intact`);
  }

  await run(() => ws.newTab());
  await sleep(60);
  const empty = await run(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    probe.style.background = 'var(--background-modifier-hover)';
    const chipBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const actions = [...document.querySelectorAll('.empty-state-action')].filter((el) => !el.hidden).map((el) => {
      const rect = el.getBoundingClientRect();
      const label = el.querySelector('.empty-state-action-label');
      const hotkey = el.querySelector('.empty-state-hotkey');
      const labelBox = label.getBoundingClientRect();
      const hotkeyBox = hotkey.getBoundingClientRect();
      const hotkeyStyle = getComputedStyle(hotkey);
      return {
        label: label.textContent,
        hotkey: hotkey.hidden ? '' : hotkey.textContent,
        width: rect.width,
        labelClip: label.scrollWidth > label.clientWidth + 1,
        chipBg: hotkeyStyle.backgroundColor,
        radius: hotkeyStyle.borderRadius,
        pad: hotkeyStyle.padding,
        marginLeft: hotkeyStyle.marginLeft,
        gap: hotkey.hidden ? null : hotkeyBox.left - labelBox.right,
        slack: hotkey.hidden ? null : rect.right - hotkeyBox.right,
      };
    });
    return { chipBg, actions, search: actions.some((action) => action.label === 'Search') };
  });
  check(!empty.search && empty.actions.map((action) => action.label).join('|') === 'New note|New canvas|Go to file', `order is New note, New canvas, Go to file (${empty.actions.map((action) => action.label).join(' | ')})`);
  const noteChip = empty.actions[0];
  check(noteChip.hotkey === 'Ctrl + N' && noteChip.chipBg === empty.chipBg && noteChip.radius === '999px' && noteChip.pad === '2px 6px 2px 4px' && noteChip.marginLeft === '0px' && noteChip.gap > 4 && noteChip.gap < 12 && noteChip.slack > 8, `the shortcut is a chip just after the label (${noteChip.gap}px gap, ${noteChip.slack}px before the edge)`);
  check(empty.actions.every((action) => Math.abs(action.width - 168) < 2 && !action.labelClip), `pills are 168px and the labels fit (${empty.actions.map((action) => action.width).join(', ')})`);
  check(empty.actions[2].hotkey === 'Ctrl + O' && empty.actions[1].hotkey === '', 'New canvas has no chip and Go to file keeps Ctrl + O');

  const vault = await run(() => {
    const name = document.querySelector('.workspace-drawer-vault-name');
    const style = getComputedStyle(name);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = canvas.measureText(name.textContent).width;
    const short = { text: name.textContent, textWidth: text, client: name.clientWidth, scroll: name.scrollWidth };
    name.textContent = 'This Vault Name Is Intentionally Very Long';
    const long = { scroll: name.scrollWidth, client: name.clientWidth, overflow: getComputedStyle(name).textOverflow };
    name.textContent = short.text;
    const actions = [...document.querySelectorAll('.workspace-drawer-vault-actions .clickable-icon')].map((el) => el.getBoundingClientRect().width);
    return { short, long, actions };
  });
  check(vault.short.text === 'Sample Vault' && vault.short.textWidth <= vault.short.client && vault.short.scroll <= vault.short.client, `Sample Vault fits (${vault.short.textWidth}px of text in ${vault.short.client}px)`);
  check(vault.long.scroll > vault.long.client && vault.long.overflow === 'ellipsis', 'a long vault name still ends in an ellipsis');
  check(vault.actions.every((width) => Math.abs(width - 28) < 1), `footer icons are 16px inside 28px buttons (${vault.actions.join(', ')})`);
});
