// Edge cases for search, properties and links that the older scripts do not drive.
// Search must save a pending edit before it reads the vault. A file named ".md"
// is not a note. Headings and blocks that are not in the note do not move the caret.
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ run, click, check }) => {
  const wait = async (test, message) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(50); }
    throw new Error(message);
  };
  const search = async (query) => {
    await run((query) => {
      grove.run('global-search:open');
      const input = document.querySelector('.search-view .search-input');
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, query);
  };
  const names = () => run(() => [...document.querySelectorAll('.search-view .search-result-file-name')].map((el) => el.textContent));

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('.md', 'only-in-dot\n#hidden\n');
    await api.createNote('.MD', 'only-in-dot-upper\n');
    await api.createNote('dir/.md', 'nested dot\n');
    await api.createNote('Edge/Real.md', 'only-in-real\n');
    await api.createNote('Edge/Literal.md', 'cost is $5.00 (usd) plus a+b and c++ and the mark .*\n');
    await api.createNote('Edge/Plain.md', 'aaa aaab abc usd\n');
    await api.createNote('Edge/Quoted.md', 'say "hello" there\n');
    await api.createNote('Edge/Emoji.md', 'family \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466} and \u{1F600}\n');
    await api.createNote('Edge/Brackets.md', 'see [draft] in the prose\n');
    await api.createNote('Edge/Long.md', `prefix ${'n'.repeat(4000)} suffix\n`);
    await api.createNote('Edge/Pending.md', 'saved line\n');
    await api.createNote('Edge/Life.md', 'lifeword before rename\n');
    await api.createNote('Edge/CASE.MD', '---\ntags: [café, a/b_c-d]\n---\n#タグ #end\u{1F642}more #123-ok\n');
    await api.createNote('Edge/Props.md', '---\r\nempty:\r\nitems:\r\n  - one\r\n  - two\r\nnested:\r\n  child: x\r\ndue: 2026-10-31\r\ncount: "42"\r\nrank: 7\r\n---\r\nbody\r\n');
    await api.createNote('Edge/Dup.md', '---\nstatus: onlyprop\nStatus: other\n---\nstill here\n');
    await api.createNote('Edge/Bom.md', '\uFEFF---\nstatus: bomdraft\n---\nbom body\n');
    await api.createNote('Edge/Target.MD', 'intro line\n\n# Real\n\nparagraph ^known\n');
    await api.createNote('Edge/Source.md', '[[Target#Missing Heading|shown]] [[Target#^nope|block name]] [[Target#Real|real alias]]\n');
    await ws.vault.refreshFiles();
  });

  check(await run(() => !ws.vault.notes.some((n) => n.path === '.md' || n.path === '.MD' || n.path === 'dir/.md')), 'a file named .md is not in the note list');
  check(await run(() => ws.vault.notes.some((n) => n.path === 'Edge/CASE.MD' && n.name === 'CASE')), 'an uppercase .MD file stays a note');

  await run(async () => {
    const { api } = await import('/src/api.ts');
    const order = [];
    const write = api.writeNote.bind(api);
    const find = api.searchNotes.bind(api);
    api.writeNote = (path, content) => { order.push(['write', path, content.includes('PENDTOKEN')]); return write(path, content); };
    api.searchNotes = (query, matchCase, request) => { order.push(['search', query]); return find(query, matchCase, request); };
    window.__edgeOrder = order;
    await ws.open('Edge/Pending.md');
    ws.view.dispatch({ changes: { from: ws.view.state.doc.length, insert: '\nPENDTOKEN\n' }, userEvent: 'input' });
    grove.run('global-search:open');
    const input = document.querySelector('.search-view .search-input');
    input.value = 'PENDTOKEN';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(() => run(() => window.__edgeOrder.some((step) => step[0] === 'search' && step[1] === 'PENDTOKEN')), 'search did not run for the pending edit');
  check(await run(() => {
    const order = window.__edgeOrder;
    const searchAt = order.findIndex((step) => step[0] === 'search' && step[1] === 'PENDTOKEN');
    return searchAt > 0 && order.slice(0, searchAt).some((step) => step[0] === 'write' && step[1] === 'Edge/Pending.md' && step[2]);
  }), 'search writes the pending edit before it asks the vault');
  await wait(async () => (await names()).includes('Pending'), 'the saved edit did not appear in search');
  check(await run(async () => {
    const { api } = await import('/src/api.ts');
    return (await api.readNote('Edge/Pending.md')).includes('PENDTOKEN');
  }), 'the pending edit is on disk when search results are shown');

  await search('a+b');
  await wait(() => run(() => document.querySelector('.search-results-count-label')?.textContent === '1 result'), 'literal a+b did not match one note');
  check((await names()).join() === 'Literal', 'a+b matches the literal note and not aaa');
  // ".*" is the two characters, so a line that ends a sentence and then closes bold
  // (".**") matches too. A regex would also match Plain, which has neither character pair.
  await search('.*');
  await wait(async () => {
    const found = await names();
    return found.includes('Literal') && !found.includes('Plain');
  }, '.* is a literal substring, not a pattern that matches every note');
  await search('"hello"');
  await wait(async () => (await names()).includes('Quoted'), 'a quoted word matches the phrase');
  await search('\u{1F600}');
  await wait(async () => (await names()).includes('Emoji'), 'an emoji query matches the note that contains it');
  await search('');
  await wait(() => run(() => document.querySelector('.search-results-count-label')?.textContent === '' && document.querySelectorAll('.search-view .search-result').length === 0), 'an empty query shows nothing');
  // Start from a hit. A whitespace or quote query that never runs would leave Real on screen.
  const cleared = () => run(() => document.querySelector('.search-results-count-label')?.textContent === '' && document.querySelectorAll('.search-view .search-result').length === 0);
  await search('only-in-real');
  await wait(async () => (await names()).includes('Real'), 'a real note is searchable before a whitespace query');
  await search('   ');
  await wait(cleared, 'a whitespace query shows nothing');
  await search('only-in-real');
  await wait(async () => (await names()).includes('Real'), 'a real note is searchable before an empty quote');
  await search('"');
  await wait(cleared, 'an empty quote shows nothing');
  const needle = 'n'.repeat(4000);
  await search(needle);
  await wait(async () => (await names()).includes('Long'), 'a long query matches the note that contains it');

  await search('only-in-dot');
  await wait(() => run(() => document.querySelector('.search-view .pane-empty')?.textContent === 'No matches found.'), 'text that lives only in a file named .md is not a search result');
  await search('only-in-real');
  await wait(async () => (await names()).includes('Real'), 'a real note is still searchable beside a file named .md');
  await search('tag:café');
  await wait(async () => (await names()).includes('CASE'), 'a tag with an accent on an uppercase .MD file is searchable');
  await search('tag:more');
  await wait(() => run(() => document.querySelector('.search-view .pane-empty')?.textContent === 'No matches found.'), 'an emoji ends a tag, so the letters after it are not a tag');
  await search('[due:2026-10-31]');
  await wait(async () => (await names()).includes('Props'), 'a CRLF date property matches');
  await search('[status:onlyprop]');
  await wait(() => run(() => document.querySelector('.search-view .pane-empty')?.textContent === 'No matches found.'), 'duplicate property keys are not searchable as a property');
  await search('[status:bomdraft]');
  await wait(async () => (await names()).includes('Bom'), 'a BOM in front of frontmatter still matches the property');

  await run(() => ws.open('Edge/Props.md'));
  await wait(() => run(() => [...document.querySelectorAll('.property')].map((row) => row.dataset.key).join() === 'empty,items,nested,due,count,rank'), 'the property block shows empty, list, nested, date, string number and number');
  check(await run(() => {
    const value = (key) => {
      const el = document.querySelector(`.property[data-key="${key}"] [data-part="value"]`);
      if (!el) return null;
      return el instanceof HTMLInputElement ? el.value : el.textContent;
    };
    return value('count') === '42' && value('rank') === '7' && value('due') === '2026-10-31' && value('empty') === '';
  }), 'a quoted number stays text, a bare number stays a number, and an empty value stays empty');
  await run(() => ws.open('Edge/Dup.md'));
  await sleep(150);
  check(await run(() => document.querySelectorAll('.property').length === 0 && ws.view.state.doc.toString().includes('status: onlyprop') && ws.view.state.doc.toString().includes('Status: other')), 'duplicate keys stay source and are not two property rows');

  await search('lifeword');
  await wait(async () => (await names()).includes('Life'), 'the note is searchable before it is renamed');
  await run(async () => {
    const { renameFile } = await import('/src/fileOps.ts');
    await renameFile(ws, 'Edge/Life.md', 'After');
  });
  await search('lifeword');
  await wait(async () => { const found = await names(); return found.includes('After') && !found.includes('Life'); }, 'search follows the renamed note');
  await run(async () => {
    const { deleteFile } = await import('/src/fileOps.ts');
    await deleteFile(ws, 'Edge/After.md', { confirmed: true });
  });
  await search('lifeword');
  await wait(() => run(() => document.querySelector('.search-view .pane-empty')?.textContent === 'No matches found.'), 'search drops a deleted note');

  await run(() => { ws.open('Edge/Source.md'); ws.setMode('live'); });
  await sleep(200);
  // A caret on the link reveals the raw text, and a click on raw text edits
  // instead of following. Park the caret at the end so the alias renders.
  await run(() => ws.view.dispatch({ selection: { anchor: ws.view.state.doc.length } }));
  await sleep(100);
  check(await run(() => [...document.querySelectorAll('.cm-wikilink.cm-rendered-link')].map((el) => el.textContent).includes('shown')), 'a link alias is the text on screen');
  const alias = await run(() => {
    const el = [...document.querySelectorAll('.cm-wikilink.cm-rendered-link')].find((node) => node.textContent === 'shown');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, href: el.dataset.href };
  });
  check(alias.href === 'Target#Missing Heading', 'the alias still points at the heading');
  await click({ x: alias.x, y: alias.y });
  await wait(() => run(() => ws.active.path === 'Edge/Target.MD'), 'clicking an alias opens the note');
  check(await run(() => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text === 'intro line'), 'a missing heading leaves the caret at the start of the note');
  await run(() => ws.openLink('Target#Real'));
  await sleep(150);
  check(await run(() => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.startsWith('# Real')), 'a heading that exists moves the caret there');
  const beforeBlock = await run(() => ws.view.state.selection.main.head);
  await run(() => ws.openLink('Target#^nope'));
  await sleep(100);
  check(await run((before) => ws.active.path === 'Edge/Target.MD' && ws.view.state.selection.main.head === before, beforeBlock), 'a missing block id leaves the caret where it was');
  const beforeDot = await run(() => ws.active.path);
  const dotLink = await run(async (before) => {
    await ws.openLink('.md');
    return {
      path: ws.active.path,
      before,
      listed: ws.vault.notes.some((n) => n.path === '.md' || n.path === '.MD' || n.path === 'dir/.md'),
    };
  }, beforeDot);
  check(!dotLink.listed, 'a file named .md is not a note');
  check(dotLink.path === dotLink.before, 'opening a link whose target is a file named .md leaves the open note alone');

});
