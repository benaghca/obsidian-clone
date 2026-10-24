// Round 27e: empty new-tab page, tab strip order, settings focus, window
// title, Ctrl+Enter / Alt+Up, URL-over-selection, and Back restoring the caret.
// Headless Chromium, real pointer and key input. Scratch paths only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, press, chord, key, click, check }) => {
  const titles = () => run(() =>
    [...document.querySelectorAll('.workspace-tab-header:not(.is-closing) .workspace-tab-header-inner-title')].map((el) => el.textContent),
  );
  const tabs = () => run(() => ws.tabs.map((t) => ({
    id: t.id,
    path: t.path,
    type: t.type ?? null,
    file: t.viewFile ?? null,
    active: t === ws.active,
  })));
  const caret = () => run(() => {
    const s = ws.view.state.selection.main;
    return { path: ws.active.path, anchor: s.anchor, head: s.head };
  });
  const docText = () => run(() => ws.view.state.doc.toString());
  const spot = async (pos) => run((pos) => {
    const c = ws.view.coordsAtPos(pos);
    return { x: c.left + 1, y: (c.top + c.bottom) / 2 };
  }, pos);
  const pillAt = async (label) => run((label) => {
    const el = [...document.querySelectorAll('.empty-state-action')].find((node) => node.textContent.startsWith(label) && !node.closest('[hidden]'));
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  const altArrow = async (which) => {
    await key('Alt', 1);
    await press(which, 1);
    await key('Alt', 0, 'keyUp');
  };
  const ctrlAlt = async (which) => {
    await key('Control', 2);
    await key('Alt', 3);
    await press(which, 3);
    await key('Alt', 2, 'keyUp');
    await key('Control', 0, 'keyUp');
    await sleep(80);
  };
  const ctrlEnter = async () => {
    await key('Control', 2);
    await press('Enter', 2);
    await key('Control', 0, 'keyUp');
    await sleep(80);
  };

  check(await run(() => document.title === 'Welcome - Sample Vault - Grove'), `title is Welcome - Sample Vault - Grove (${await run(() => document.title)})`);

  await click(await spot(2));
  await press('ArrowRight', 8);
  await press('ArrowRight', 8);
  await press('ArrowRight', 8);
  const selected = await run(() => {
    const s = ws.view.state.selection.main;
    return { anchor: s.anchor, head: s.head, text: ws.view.state.sliceDoc(s.from, s.to) };
  });
  check(!await run(() => ws.view.state.selection.main.empty) && selected.text.length === 3, `a word is selected before settings (${selected.text})`);
  await chord(',');
  await sleep(80);
  check(await run(() => !!document.querySelector('.modal.mod-settings') && document.activeElement?.classList.contains('setting-search-input')), 'settings opens with the search field focused');
  await press('Escape');
  await sleep(80);
  const backInNote = await run((selected) => {
    const s = ws.view.state.selection.main;
    return {
      settings: !!document.querySelector('.modal.mod-settings'),
      focused: document.activeElement?.classList.contains('cm-content') === true,
      same: s.anchor === selected.anchor && s.head === selected.head,
      text: ws.view.state.sliceDoc(s.from, s.to),
    };
  }, selected);
  check(!backInNote.settings && backInNote.focused && backInNote.same, `Esc returns to the note and keeps the selection (${backInNote.text}, focused ${backInNote.focused})`);

  const beforeEnter = await docText();
  await ctrlEnter();
  const afterEnter = await caret();
  check(await docText() === beforeEnter && afterEnter.anchor === selected.anchor && afterEnter.head === selected.head, 'Ctrl+Enter on a plain line inserts nothing');

  const headingLine = await run(() => ws.view.state.doc.toString().indexOf('## Live Preview'));
  await click(await spot(headingLine));
  const beforeMove = await docText();
  const line = await run(() => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).number);
  check(line > 1, `Alt+Up is tried off the first line (line ${line})`);
  await altArrow('ArrowUp');
  await altArrow('ArrowDown');
  check(await docText() === beforeMove, 'Alt+Up and Alt+Down leave the lines where they are');

  await chord('t');
  await sleep(50);
  let open = await tabs();
  check(open.length === 2 && open[0].path === 'Welcome.md' && open[1].path === null && open[1].active, 'Ctrl+T opens an empty tab after the current note');
  check(await run(() => document.title === 'New tab - Sample Vault - Grove'), `an empty tab titles the window New tab - Sample Vault - Grove (${await run(() => document.title)})`);
  const emptyA = open[1].id;

  const pills = await run(() => {
    const leaf = document.querySelector('.workspace-leaf');
    const empty = document.querySelector('.empty-state');
    const probe = document.createElement('div');
    probe.style.color = 'var(--text-normal)';
    document.body.append(probe);
    const normal = getComputedStyle(probe).color;
    probe.remove();
    const lr = leaf.getBoundingClientRect();
    const er = empty.getBoundingClientRect();
    const actions = [...empty.querySelectorAll('.empty-state-action')].filter((el) => !el.hidden).map((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent,
        radius: s.borderRadius,
        transition: s.transitionDuration,
        animation: s.animationName,
        animations: el.getAnimations().length,
        border: s.borderTopWidth,
        pad: s.padding,
        margin: `${s.marginTop} ${s.marginBottom}`,
        decoration: s.textDecorationLine,
        color: s.color,
        font: s.fontSize,
        width: r.width,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    });
    const midY = (actions[0].cy + actions[actions.length - 1].cy) / 2;
    return {
      hidden: empty.hidden,
      title: empty.querySelector('.empty-state-title')?.textContent ?? '',
      normal,
      actions,
      leafCx: lr.x + lr.width / 2,
      emptyCx: er.x + er.width / 2,
      emptyMid: er.y + er.height / 2,
      midY,
    };
  });
  check(!pills.hidden && pills.title === '' && pills.actions.every((a) => a.font === '13px'), 'the empty tab is a 13px column with no heading');
  check(pills.actions.map((a) => a.text).join('|') === 'New noteCtrl + N|New canvas|New base|Go to fileCtrl + O', `pills are New note, New canvas, New base, Go to file (${pills.actions.map((a) => a.text).join(' | ')})`);
  const pillWidth = pills.actions[0]?.width ?? 0;
  check(pills.actions.every((a) => a.radius === '999px' && a.border === '1px' && a.pad === '8px 12px' && a.margin === '0px 0px' && a.color === pills.normal && a.decoration === 'none' && Math.abs(a.width - pillWidth) < 1 && Math.abs(a.width - 168) < 2), `pills are normal-coloured, equally wide (measured ${pillWidth}px), fully rounded, and padded 8px 12px`);
  check(pills.actions.every((a) => a.transition === '0s' && a.animation === 'none' && a.animations === 0), 'pills do not animate');
  check(pills.actions.every((a) => Math.abs(a.cx - pills.emptyCx) < 2) && Math.abs(pills.midY - pills.emptyMid) < 24, 'the column is centred in the empty page');

  await click(await pillAt('Go to file'));
  const prompt = await run(() => {
    const el = document.querySelector('.prompt');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { placeholder: document.querySelector('.prompt-input')?.getAttribute('placeholder'), animation: s.animationName, transition: s.transitionDuration, animations: el.getAnimations().length };
  });
  check(prompt?.placeholder === 'Find or create a note...' && prompt.animation === 'none' && prompt.transition === '0s' && prompt.animations === 0, 'Go to file opens the switcher immediately');
  await press('Escape');
  check(await run((id) => !document.querySelector('.prompt') && ws.active.id === id, emptyA), 'Escape leaves the empty tab open');

  await click('.workspace-tab-header[aria-label="Welcome.md"]');
  await sleep(40);
  await chord('t');
  await sleep(40);
  open = await tabs();
  check(open.map((t) => t.id).join(',') === `${open[0].id},${emptyA},${open[2].id}` && open[2].active && open[2].path === null && open[0].path === 'Welcome.md', `Ctrl+T appends at the end (${open.map((t) => t.path ?? 'new').join(', ')})`);

  await click('.workspace-tab-header[aria-label="Welcome.md"]');
  await sleep(40);
  await chord('o');
  await sleep(40);
  await send('Input.insertText', { text: 'Ideas' });
  await sleep(40);
  check(await run(() => document.querySelector('.suggestion-item.is-selected .suggestion-title')?.textContent === 'Ideas'), 'the switcher selects Ideas');
  await ctrlEnter();
  for (let i = 0; i < 40 && !((await tabs())[1]?.path === 'Ideas.md'); i++) await sleep(50);
  open = await tabs();
  check(open[0].path === 'Welcome.md' && open[1].path === 'Ideas.md' && open[1].active && open.map((t) => t.id).includes(emptyA), `Open in new tab stays beside the current tab (${open.map((t) => t.path ?? 'new').join(', ')})`);

  await click('.workspace-tab-header[aria-label="Welcome.md"]');
  await sleep(40);
  const beforePlus = (await tabs()).map((t) => t.id);
  await click('.workspace-tab-header-new-tab');
  await sleep(40);
  open = await tabs();
  check(open.slice(0, beforePlus.length).every((t, i) => t.id === beforePlus[i]) && open.at(-1).active && open.at(-1).path === null && open.length === beforePlus.length + 1, `the + button appends a tab (${open.map((t) => t.path ?? 'new').join(', ')})`);

  const beforeClose = await tabs();
  await click('.workspace-tab-header.is-active .workspace-tab-header-inner-close-button');
  await sleep(200);
  open = await tabs();
  check(open.length === beforeClose.length - 1 && open.at(-1).id === beforeClose.at(-2).id && open.at(-1).active, 'the tab close button removes the empty tab and shows its neighbour');

  const noteHost = (await tabs()).find((t) => t.path === null);
  assert.ok(noteHost, 'an empty tab remains for New note');
  await click(`.workspace-tab-header[aria-label="New tab"]`);
  await sleep(40);
  if ((await run(() => ws.active.path)) !== null) {
    const emptyHeader = await run(() => {
      const el = [...document.querySelectorAll('.workspace-tab-header:not(.is-closing)')].find((node) => node.getAttribute('aria-label') === 'New tab');
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await click(emptyHeader);
    await sleep(40);
  }
  const noteTab = await run(() => ws.active.id);
  await click(await pillAt('New note'));
  for (let i = 0; i < 40 && await run(() => ws.active.path) !== 'Untitled.md'; i++) await sleep(50);
  check(await run((id) => ws.active.id === id && ws.active.path === 'Untitled.md' && document.querySelector('.empty-state').hidden && document.title === 'Untitled - Sample Vault - Grove', noteTab), 'New note fills the empty tab');

  await chord('t');
  await sleep(40);
  const canvasTab = await run(() => ws.active.id);
  await click(await pillAt('New canvas'));
  for (let i = 0; i < 40 && await run(() => ws.active.type) !== 'canvas'; i++) await sleep(50);
  check(await run((id) => ws.active.id === id && ws.active.type === 'canvas' && /\.canvas$/.test(ws.active.viewFile ?? '') && document.querySelector('.empty-state').hidden, canvasTab), `New canvas fills the empty tab (${await run(() => ws.active.viewFile)})`);

  await click('.workspace-tab-header[aria-label="Welcome.md"]');
  await sleep(80);
  await run(() => ws.setMode('source'));
  await sleep(80);
  await click(await spot(2));
  const linkPos = await run(() => {
    const at = ws.view.state.doc.toString().indexOf('[[Project roadmap]]');
    const pos = at + 6;
    ws.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    ws.view.focus();
    return pos;
  });
  check(await run((pos) => ws.view.state.sliceDoc(pos - 6, pos + 8).includes('Project'), linkPos), 'the caret sits on the Project roadmap link');
  const welcomeId = await run(() => ws.active.id);
  await ctrlEnter();
  for (let i = 0; i < 40 && !((await tabs()).some((t) => t.path === 'Projects/Project roadmap.md' && t.active)); i++) await sleep(50);
  open = await tabs();
  const welcomeAt = open.findIndex((t) => t.id === welcomeId);
  check(open[welcomeAt + 1]?.path === 'Projects/Project roadmap.md' && open[welcomeAt + 1].active, `Ctrl+Enter on a wikilink opens it in the next tab (${open.map((t) => t.path ?? t.file ?? 'new').join(', ')})`);
  check(await run(() => document.title === 'Project roadmap - Sample Vault - Grove'), `the roadmap titles the window (${await run(() => document.title)})`);

  await click('.workspace-tab-header[aria-label="Welcome.md"]');
  await sleep(80);
  const mark = await run(() => {
    const at = ws.view.state.doc.toString().indexOf('sample vault');
    ws.view.dispatch({ selection: { anchor: at, head: at + 6 } });
    const s = ws.view.state.selection.main;
    return { anchor: s.anchor, head: s.head };
  });
  await run(() => ws.open('Projects/Project roadmap.md'));
  await sleep(120);
  const road = await run(() => {
    const at = ws.view.state.doc.toString().indexOf('Milestones');
    ws.view.dispatch({ selection: { anchor: at, head: at + 10 } });
    const s = ws.view.state.selection.main;
    return { anchor: s.anchor, head: s.head };
  });
  await run(() => ws.open('Welcome.md', { heading: 'Lists and tasks' }));
  await sleep(120);
  const heading = await caret();
  check(heading.path === 'Welcome.md' && (heading.anchor !== mark.anchor || heading.head !== mark.head), 'reopening Welcome lands on the heading, not the earlier caret');
  await ctrlAlt('ArrowLeft');
  const mid = await caret();
  check(mid.path === 'Projects/Project roadmap.md' && mid.anchor === road.anchor && mid.head === road.head, `Back returns to the roadmap caret (${mid.anchor},${mid.head} vs ${road.anchor},${road.head})`);
  await ctrlAlt('ArrowLeft');
  const restored = await caret();
  check(restored.path === 'Welcome.md' && restored.anchor === mark.anchor && restored.head === mark.head, `Back returns to the caret left on Welcome (${restored.anchor},${restored.head} vs ${mark.anchor},${mark.head})`);
  await ctrlAlt('ArrowRight');
  const forwardRoad = await caret();
  check(forwardRoad.path === 'Projects/Project roadmap.md' && forwardRoad.anchor === road.anchor && forwardRoad.head === road.head, 'Forward returns to the roadmap caret');
  await ctrlAlt('ArrowRight');
  const forwardWelcome = await caret();
  check(forwardWelcome.path === 'Welcome.md' && forwardWelcome.anchor === heading.anchor && forwardWelcome.head === heading.head, 'Forward returns to the heading the second visit left');

  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('UrlPaste.md', 'word');
    await ws.vault.refreshFiles();
    await ws.open('UrlPaste.md');
    ws.setMode('source');
  });
  await sleep(80);
  await click('.cm-content');
  await chord('End');
  for (let i = 0; i < 4; i++) await press('ArrowLeft', 8);
  await run(() => navigator.clipboard.writeText('https://example.com'));
  await chord('v');
  await sleep(100);
  const pasted = await run(() => {
    const sel = ws.view.state.selection.main;
    const text = ws.view.state.doc.toString();
    const link = '[word](https://example.com)';
    const at = text.lastIndexOf(link);
    return { ok: !sel.empty && at >= 0 && sel.from === at && sel.to === at + link.length, text, from: sel.from, to: sel.to };
  });
  check(pasted.ok, `pasting a URL over a word selects the whole link (${pasted.text} @ ${pasted.from}-${pasted.to})`);
});
