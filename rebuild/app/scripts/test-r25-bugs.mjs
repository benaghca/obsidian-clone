// Round 25 confirmed-bug regressions. Pointer and keys are CDP Input events.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const failures = [];
const check = (ok, message) => {
  if (ok) console.log('PASS', message);
  else { console.log('FAIL', message); failures.push(message); }
};

await withBrowser(async ({ send, run, click, press, double, read, open: openFile, key, shot }) => {
  const open = (path, text) => openFile(path, text, 160);
  const note = path => run(async path => {
    const { api } = await import('/src/api.ts');
    return api.readNote(path);
  }, path);
  const labels = () => run(() => [...document.querySelectorAll('.cm-link-suggest .cm-completionLabel')].map(el => el.textContent ?? ''));
  const doc = () => run(() => ws.view.state.doc.toString());
  const line = () => run(() => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text);
  const ctrl = async k => { await key('Control', 2); await press(k, 2); await key('Control', 0, 'keyUp'); };
  const typeAtEnd = async text => {
    await run(() => {
      const end = ws.view.state.doc.length;
      ws.view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
      ws.view.focus();
    });
    await sleep(40);
    const p = await run(() => {
      const r = ws.view.coordsAtPos(ws.view.state.doc.length);
      return { x: r.left + 1, y: (r.top + r.bottom) / 2 };
    });
    await click(p);
    await send('Input.insertText', { text });
    await sleep(280);
  };
  const waitLabels = async () => {
    for (let i = 0; i < 10; i++) {
      const rows = await labels();
      if (rows.length) return rows;
      await sleep(80);
    }
    return labels();
  };
  const hrefs = () => run(() => [...document.querySelectorAll('.cm-editor [data-href]')].map(el => el.getAttribute('data-href')));
  const clickHref = async (part) => {
    const at = await run(part => {
      const el = [...document.querySelectorAll('.cm-editor [data-href]')].find(node => (node.getAttribute('data-href') || '').includes(part));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2, href: el.getAttribute('data-href'), text: el.textContent };
    }, part);
    if (!at) return null;
    await click(at);
    await sleep(180);
    return { ...at, line: await line() };
  };
  const cover = selector => run(selector => {
    const el = document.querySelector(selector);
    const view = document.querySelector('.canvas-view')?.getBoundingClientRect();
    if (!el || !view) return null;
    const r = el.getBoundingClientRect();
    let covered = 0, total = 0;
    const y = r.top + r.height / 2;
    for (let x = r.left + 2; x < r.right - 2; x += 4) {
      if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
      total++;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) covered++;
    }
    return { covered, total, w: Math.round(r.width), h: Math.round(r.height), text: el.textContent };
  }, selector);

  await open('Dbl.canvas', JSON.stringify({
    nodes: [{ id: 'a', type: 'text', x: 80, y: 80, width: 200, height: 80, text: 'Keep' }],
    edges: [],
  }));
  await click('[data-node-id="a"]');
  await sleep(80);
  const remove = await run(() => {
    const el = document.querySelector('.canvas-selection-menu [aria-label="Remove"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!remove) check(false, 'Remove is on screen to double-click');
  else {
    await double(remove);
    await sleep(420);
    const born = await run(() => [...document.querySelectorAll('.canvas-node')].map(node => ({
      editing: node.classList.contains('is-editing'),
      text: node.querySelector('.cm-content')?.textContent ?? '',
    })));
    const saved = await read();
    check(born.length === 0, `double-click Remove deletes the card and does not create another, got ${JSON.stringify(born)} file ${JSON.stringify(saved)}`);
    await double('.canvas-view'); await press('Escape'); await sleep(420);
    check(JSON.parse(await read()).nodes.length === 1, 'a subsequent background double-click still creates a card');
  }

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Land.md', '---\ntitle: Land\n---\n\nBefore the headings.\n\n# Has id ^keep\n\n# Pipe | split\n');
    await api.createNote('Nest.md', '---\ntitle: Nest\n---\n\n# Alpha\n\nBody paragraph.\n');
    await api.createNote('Lists.md', '- Parent item\n  - Nested item\n');
    await api.createNote('Section.md', '# Alpha\n\nAlpha only.\n\n# Beta\n\nBeta only.\n');
    await ws.vault.refreshFiles();
  });

  await open('Nav.md', '[[Land#Has id]]\n\n');
  await typeAtEnd('');
  await sleep(80);
  const hasLink = await clickHref('Has id');
  check(!!hasLink && hasLink.line.startsWith('# Has id'), `[[Land#Has id]] opens the heading that carries a block id, got ${JSON.stringify(hasLink)}`);

  await open('From.md', 'See links.\n\n');
  await typeAtEnd('[[Land#Has');
  const hasRows = await waitLabels();
  check(hasRows.some(row => row.trim() === 'Has id') && !hasRows.some(row => row.includes('^keep')), `a heading row drops its trailing block id, got ${JSON.stringify(hasRows)}`);
  await press('Enter');
  await sleep(180);
  const hasInserted = await doc();
  check(hasInserted.includes('[[Land#Has id]]') && !hasInserted.includes('^keep'), `accepting that heading inserts [[Land#Has id]], got ${JSON.stringify(hasInserted)}`);

  await typeAtEnd('\n[[Land#Pipe');
  const pipeRows = await waitLabels();
  check(pipeRows.some(row => row.includes('Pipe | split')), `the pipe heading is offered whole, got ${JSON.stringify(pipeRows)}`);
  await press('Enter');
  await sleep(160);
  await typeAtEnd('\n');
  await sleep(120);
  const pipeDoc = await doc();
  const pipeHref = (await hrefs())?.find(href => href?.includes('Pipe')) ?? null;
  check(!!pipeHref && pipeHref.includes('split') && !pipeDoc.includes('[[Land#Pipe | split]]'), `a heading pipe stays inside the link target, href ${JSON.stringify(pipeHref)} doc ${JSON.stringify(pipeDoc)}`);
  const pipeLink = await clickHref('Pipe');
  check(!!pipeLink && pipeLink.line.startsWith('# Pipe'), `following the accepted pipe heading lands on that heading, got ${JSON.stringify(pipeLink)}`);

  await open('Same.md', '---\ntitle: S\n---\n\nTarget paragraph.\n\n');
  await typeAtEnd('[[^Target');
  check((await waitLabels()).some(row => row.includes('Target paragraph')), 'same-note block row is offered');
  await press('Enter');
  await sleep(220);
  const accepted = await doc();
  check(/Target paragraph\. \^[a-z0-9]{6}/.test(accepted) && /\[\[#\^[a-z0-9]{6}\]\]/.test(accepted), `accepting a block writes an id and a link, got ${JSON.stringify(accepted)}`);
  await ctrl('z');
  await sleep(180);
  const undone = await doc();
  check(undone.includes('[[^Target') && !/ \^[a-z0-9]{6}/.test(undone), `one Ctrl+Z removes the inserted link and the generated id, got ${JSON.stringify(undone)}`);

  await open('Cross.md', 'From here.\n\n');
  const nestBefore = await note('Nest.md');
  await typeAtEnd('[[Nest^Body');
  check((await waitLabels()).some(row => row.includes('Body paragraph')), 'cross-note block row is offered');
  await press('Enter');
  await sleep(420);
  await ctrl('z');
  await sleep(200);
  const crossDoc = await doc();
  const nestAfter = await note('Nest.md');
  // Stage 3 explicitly permits independent per-file undo; never rewrite another
  // file from the source's history after its ID might already have been reused.
  check(crossDoc.includes('[[Nest^Body') && / \^[a-z0-9]{6}/.test(nestAfter), 'cross-note undo restores the source query and retains the target ID on its own history');
  await run(() => ws.open('Nest.md'));
  await ctrl('z'); await sleep(420);
  check(await note('Nest.md') === nestBefore, 'one undo in the target removes its generated ID without changing other text');

  await open('ListFrom.md', 'Links.\n\n');
  await typeAtEnd('[[Lists^');
  const listRows = (await waitLabels()).map(row => row.replace(/\s+/g, ' ').trim());
  check(listRows.includes('Nested item'), `a nested list item is its own block row, got ${JSON.stringify(listRows)}`);
  await press('Escape');

  await typeAtEnd('[[Section#Alpha^');
  const sectionRows = await waitLabels();
  check(sectionRows.some(row => row.includes('Alpha only')) && !sectionRows.some(row => row.includes('Beta only')), `[[Note#Heading^ lists only that section, got ${JSON.stringify(sectionRows)}`);
  await press('Escape');

  // Exercise the editor fixes in Source mode, then follow both heading forms
  // in Reading. All editing fixtures retain frontmatter.
  const fm = '---\ntitle: Stage 3\n---\n\nTarget paragraph.\n\n';
  const prepare = async query => {
    await run(fm => { ws.view.dispatch({changes:{from:0,to:ws.view.state.doc.length,insert:fm},selection:{anchor:fm.length}});ws.view.focus(); }, fm);
    await typeAtEnd(query);
  };
  await open('Source-fixes.md', fm);
  await run(() => ws.setMode('source'));
  await prepare('[[Land#Has');
  check((await waitLabels()).join('|') === 'Has id', 'Source: heading labels omit trailing IDs with frontmatter');
  await press('Enter'); await sleep(100);
  check((await doc()).endsWith('[[Land#Has id]]'), 'Source: heading acceptance omits the ID');
  await prepare('[[Land#Pipe'); await waitLabels(); await press('Enter'); await sleep(100);
  check((await doc()).endsWith('[[Land#Pipe split]]'), 'Source: pipe-heading insertion matches Obsidian');
  await prepare('[[^Target'); await waitLabels(); await press('Enter'); await sleep(100);
  const sourceAccepted = await doc();
  await ctrl('z'); await sleep(100);
  check((await doc()) === fm + '[[^Target', 'Source: one undo removes both the ID and accepted link');
  await press('Z', 10); await sleep(100);
  check((await doc()) === sourceAccepted, 'Source: one redo restores both the ID and accepted link');
  await prepare('[[Lists^');
  check((await waitLabels()).includes('Nested item'), 'Source: nested list item is a separate row');
  await send('Input.insertText', {text:'Nested'}); await sleep(180); await press('Enter'); await sleep(420);
  check(/- Parent item\n  - Nested item \^[a-z0-9]{6}/.test(await note('Lists.md')), 'Source: choosing a nested item puts its ID on that item');
  await prepare('[[Section#Alpha^');
  check((await waitLabels()).some(row => row.includes('Alpha only')) && !(await labels()).some(row => row.includes('Beta')), 'Source: heading block choices exclude the next section');
  await send('Input.insertText', {text:'only'}); await sleep(180); await press('Enter'); await sleep(420);
  check(/\[\[Section#\^[a-z0-9]{6}\]\]$/.test(await doc()) && /Alpha only\. \^[a-z0-9]{6}/.test(await note('Section.md')), 'Source: scoped block completion inserts #^id and edits only the chosen section');
  await prepare('[[Section#Missing^'); await sleep(300);
  check(!(await labels()).length, 'Source: a missing heading offers no blocks from other sections');
  await press('Escape');
  for (const heading of ['Has id', 'Pipe split']) {
    await open(`Reading-${heading}.md`, fm + `[[Land#${heading}]]\n\n`);
    await run(() => ws.setMode('reading')); await sleep(120);
    const before = await doc();
    await send('Input.insertText', {text:'[[#'}); await sleep(100);
    check(await doc() === before && !(await labels()).length, `Reading: ${heading} fixture stays read-only`);
    const followed = await clickHref(heading);
    check(followed?.line.startsWith(heading === 'Has id' ? '# Has id ^keep' : '# Pipe | split'), `Reading: ${heading} links land on the heading, got ${JSON.stringify(followed)}`);
  }

  const longName = 'A very long note name that should sit above the card.md';
  await run(async name => {
    const { api } = await import('/src/api.ts');
    await api.createNote(name, 'Hello from the long note.\n');
    await ws.vault.refreshFiles();
  }, longName);
  await open('Cover.canvas', JSON.stringify({
    nodes: [
      { id: 'g', type: 'group', x: 80, y: 160, width: 420, height: 220, label: 'Notes from the whole first chapter' },
      { id: 'f', type: 'file', file: longName, x: 80, y: 460, width: 260, height: 110 },
    ],
    edges: [],
  }));
  await click('[data-node-id="g"]');
  await sleep(80);
  const groupCover = await cover('[data-node-id="g"] .canvas-group-label');
  check(groupCover && groupCover.total > 8 && groupCover.covered === 0, `the selection toolbar leaves the whole group label hit-testable, got ${JSON.stringify(groupCover)}`);
  await shot('grove-stage3-group');
  await click('[data-node-id="f"]');
  await sleep(80);
  const fileCover = await cover('[data-node-id="f"] .canvas-file-label');
  check(fileCover && fileCover.total > 8 && fileCover.covered === 0, `the selection toolbar leaves the whole file name hit-testable, got ${JSON.stringify(fileCover)}`);
  await click('[aria-label^="Zoom to selection"]'); await sleep(80);
  const zoomedCover = await cover('[data-node-id="f"] .canvas-file-label');
  check(zoomedCover && zoomedCover.total > 8 && zoomedCover.covered === 0, 'zooming the file card keeps its whole name above the toolbar');
  await shot('grove-stage3-file');

  await open('Redo.canvas', JSON.stringify({
    nodes: [{ id: 'a', type: 'text', x: 80, y: 90, width: 200, height: 80, text: 'A' }],
    edges: [],
  }));
  await click('[data-node-id="a"]');
  await click('[aria-label="Set color"]');
  await click('.canvas-color-menu [aria-label="Cyan"]');
  await sleep(420);
  const colored = await read();
  check(colored.includes('"color":"5"'), `Cyan writes color 5 before the redo check, got ${JSON.stringify(colored)}`);
  await click('[aria-label="Undo"]');
  await sleep(420);
  await click('[data-node-id="a"]');
  await ctrl('y');
  await sleep(420);
  const redone = await read();
  check(redone.includes('"color":"5"'), `Ctrl+Y redoes the canvas color, got ${JSON.stringify(redone)}`);
  await click('[aria-label="Canvas help"]');
  check(await run(() => document.querySelector('.canvas-help')?.textContent.includes('Ctrl + Y')), 'Canvas help lists Ctrl+Y as a redo shortcut');
  await press('Escape');
}, { height: 800, screenshots: new URL('../../round25-shots/', import.meta.url).pathname });

assert.deepEqual(failures, []);
