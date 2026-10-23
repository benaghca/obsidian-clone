// Headless UI regressions. Native CDP mouse/keyboard input; only the in-memory mock vault.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = root + 'node_modules/.round18-partb';
await mkdir(scratch, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1438'], { cwd: root, stdio: 'ignore' });
const browser = spawn('chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--remote-debugging-port=9448', `--user-data-dir=${scratch}/chromium`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let tabs;
  for (let i = 0; i < 100; i++) {
    try { await fetch('http://127.0.0.1:1438/'); tabs = await (await fetch('http://127.0.0.1:9448/json')).json(); if (tabs.some(t => t.type === 'page')) break; } catch {}
    await sleep(100);
  }
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => { socket.onopen = resolve; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.id) { const [resolve, reject] = pending.get(message.id); pending.delete(message.id); message.error ? reject(message.error) : resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++sequence, [resolve, reject]); socket.send(JSON.stringify({ id: sequence, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const run = (fn, ...args) => evaluate(`(${fn})(...${JSON.stringify(args)})`);
  const key = async (key, modifiers = 0, type = 'keyDown') => {
    const virtual = { Enter: 13, Escape: 27, Control: 17, End: 35 }[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    await send('Input.dispatchKeyEvent', { type, key, modifiers, windowsVirtualKeyCode: virtual });
  };
  const press = async (k, modifiers = 0) => { await key(k, modifiers); await key(k, modifiers, 'keyUp'); };
  const chord = async k => { await key('Control', 2); await press(k, 2); await key('Control', 0, 'keyUp'); };
  const point = selector => run(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
  const click = async selector => {
    const p = await point(selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p }); await sleep(50);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
    await sleep(100);
  };
  const fill = async (selector, text) => { await click(selector); await chord('a'); await send('Input.insertText', { text }); await press('End'); await sleep(100); };
  const check = (value, message) => { assert.ok(value, message); console.log('PASS', message); };
  const shot = async name => writeFile(`${scratch}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:1438/' }); await sleep(700);
  await evaluate('localStorage.clear()'); await send('Page.reload'); await sleep(700);
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Round18.md', '# Heading\n\nalpha Alpha alpha\n\n#tag #nested/child\n\n![[Embedded18]]\n\nEnd.\n\n## Subheading\n\nA paragraph with a soft\nline break.\n\nAnother paragraph.');
    await api.createNote('Embedded18.md', '# Embedded note\n\nEmbedded text with [[Welcome|a link]] and a checkbox.\n\n- [ ] Task');
    await ws.vault.refreshFiles(); await ws.open('Round18.md');
  });
  await sleep(200);
  await chord('f'); await sleep(150);
  check(await evaluate('document.activeElement?.name === "search"'), 'Ctrl+F keeps find field focused');
  await fill('.cm-search [name=search]', 'alpha');
  check(await evaluate('document.querySelector(".cm-search-input .cm-search-count")?.textContent === "1 / 3"'), 'count is inside find field wrapper');
  check(await evaluate('document.querySelector(".cm-panels-top .cm-search-row") !== null'), 'compact find bar is in the top panel');
  check(await evaluate('document.querySelector(".cm-search [name=next] svg") !== null'), 'find actions use bundled icons');
  check(await evaluate('(()=>{const row=document.querySelector(".cm-search-row").getBoundingClientRect();const close=document.querySelector(".cm-search [name=close]").getBoundingClientRect();return Math.abs(close.y + close.height / 2 - row.y - row.height / 2) < 2})()'), 'Close button aligns with the compact toolbar row');
  await click('.cm-search [name=next]');
  check(await evaluate('document.querySelector(".cm-search-count").textContent === "2 / 3"'), 'real Next click advances match');
  await click('.cm-search [name=prev]');
  check(await evaluate('document.querySelector(".cm-search-count").textContent === "1 / 3"'), 'real Previous click returns to match');
  await shot('find');
  await click('.cm-search [name=case]');
  check(await evaluate('document.querySelector(".cm-search-count").textContent === "1 / 2"'), 'case icon retains stock query behavior');
  await click('.cm-search [name=re]'); await fill('.cm-search [name=search]', 'al.ha');
  check(await evaluate('document.querySelector(".cm-search-count").textContent.endsWith(" / 2")'), 'regex icon retains stock query behavior');
  await click('.cm-search [name=re]'); await fill('.cm-search [name=search]', 'alpha');
  await click('.cm-search [name=toggle-replace]');
  check(await evaluate('document.querySelector(".cm-search [name=toggle-replace]").getAttribute("aria-expanded") === "true"'), 'replace toggle reveals stock replacement controls');
  await fill('.cm-search input[name=replace]', 'omega');
  await click('.cm-search button[name=replace]');
  check(await evaluate('ws.view.state.doc.toString().includes("omega")'), 'stock Replace changes the selected match');
  await click('.cm-search [name=replaceAll]');
  check(await evaluate('!ws.view.state.doc.toString().includes("alpha") && ws.view.state.doc.toString().includes("Alpha")'), 'stock Replace all honors case');
  await press('Escape');
  check(await evaluate('!document.querySelector(".cm-search") && ws.view.hasFocus'), 'Escape dismisses find and focuses editor');
  await chord('h'); await sleep(150);
  check(await evaluate('document.activeElement?.name === "replace"'), 'Ctrl+H reveals and focuses replacement field');
  await press('Escape');
  // Tags search unless the Live Preview caret is already touching their source.
  await run(() => { ws.view.dispatch({ selection: { anchor: 0 } }); ws.view.focus(); });
  await click('.cm-tag');
  check(await evaluate('document.querySelector("input[aria-label=Search]").value === "tag:#tag"'), 'Live Preview tag click opens tag search');
  await run(() => {
    const at = ws.view.state.doc.toString().indexOf('#tag') + 2;
    ws.view.dispatch({ selection: { anchor: at } }); ws.view.focus();
    document.querySelector('input[aria-label=Search]').value = '';
  });
  await click('.cm-tag');
  check(await evaluate('document.querySelector("input[aria-label=Search]").value === "" && ws.view.hasFocus'), 'click inside the active tag keeps editing');
  await run(() => ws.setMode('reading')); await sleep(100);
  await click('.cm-tag');
  check(await evaluate('document.querySelector("input[aria-label=Search]").value === "tag:#tag"'), 'Reading tag click opens tag search');
  await run(() => { ws.setMode('live'); ws.view.dispatch({ selection: { anchor: 0 } }); });
  await click('.cm-tag + .cm-tag');
  check(await evaluate('document.querySelector("input[aria-label=Search]").value === "tag:#nested/child"'), 'nested tag names remain intact');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Search18.md', Array.from({ length: 60 }, (_, i) => 'Context line ' + i).join('\n') + '\n' +
      'A long line of surrounding context before SearchNeedle, followed by enough additional words to wrap across several sidebar lines without cutting off the surrounding context.');
    await ws.vault.refreshFiles();
  });
  await fill('input[aria-label=Search]', 'searchneedle'); await sleep(250);
  const hit = '.search-view .search-result-file-match[data-preview-path="Search18.md"]';
  check(await run(selector => { const el = document.querySelector(selector); return el.getBoundingClientRect().height > 3 * parseFloat(getComputedStyle(el).lineHeight) && el.textContent.includes('SearchNeedle') && el.textContent.endsWith('…'); }, hit), 'search snippet wraps a bounded context window');
  await click(hit); await sleep(200);
  check(await evaluate('ws.active.path === "Search18.md" && ws.view.state.sliceDoc(ws.view.state.selection.main.from, ws.view.state.selection.main.to) === "SearchNeedle"'), 'search hit selects the matched text with original case');
  check(await evaluate('ws.view.state.doc.lineAt(ws.view.state.selection.main.from).number === 61 && ws.view.coordsAtPos(ws.view.state.selection.main.from).top < 750'), 'search opens scrolled to its matching line');
  await shot('search');
  await run(async () => { await ws.open('Round18.md'); ws.view.dispatch({ selection: { anchor: 0 } }); }); await sleep(100);
  await click('.markdown-embed-content .cm-h1 .cm-reading-text');
  check(await evaluate('ws.view.hasFocus && ws.view.state.selection.main.head === (ws.view.state.doc.toString().indexOf("![[Embedded18]]") + 3)'), 'embedded note text places caret on its embed source line');
  check(await evaluate('ws.view.contentDOM.innerText.includes("![[Embedded18]]")'), 'embedded note click reveals its source');
  await shot('embed');
  await run(() => ws.view.dispatch({ selection: { anchor: 0 } }));
  await click('.markdown-embed .cm-task-checkbox'); await sleep(350);
  check(await run(async () => { const { api } = await import('/src/api.ts'); return (await api.readNote('Embedded18.md')).includes('[x] Task'); }), 'embedded task click still toggles the target task');
  await click('.markdown-embed [data-href=Welcome]');
  check(await evaluate('ws.active.path === "Welcome.md"'), 'embedded link click still navigates');
  await run(async () => { await ws.open('Round18.md'); ws.setMode('reading'); }); await sleep(100);
  await click('.markdown-embed-content .cm-h1 .cm-reading-text');
  check(await evaluate('ws.view.state.readOnly && !ws.view.contentDOM.innerText.includes("![[Embedded18]]")'), 'Reading embed text remains rendered and read-only');
  const heading = '.is-reading-mode .cm-content > .cm-line.cm-h1';
  check(await run(selector => { const s = getComputedStyle(document.querySelector(selector)); return s.fontSize === '31px' && s.paddingTop === '0px' && s.marginTop === '0px'; }, heading), 'Reading H1 is 31px without top padding or first-line margin');
  check(await evaluate('(()=>{const s=getComputedStyle(document.querySelector(".is-reading-mode .cm-content > .cm-line.cm-h2"));return s.paddingTop === "0px" && s.marginTop === "16px"})()'), 'Reading secondary headings use margins rather than top padding');
  await shot('reading');
  await run(() => ws.setMode('live')); await sleep(100);
  check(await evaluate('getComputedStyle(document.querySelector(".cm-content > .cm-line.cm-h1")).fontSize !== "31px"'), 'Reading heading CSS leaves Live Preview typography alone');
  await run(async () => { await ws.open('Round18.md'); ws.view.dispatch({ selection: { anchor: 0 } }); });
  const tagStart = await run(() => {
    const tag = document.querySelector('.cm-tag'), range = document.createRange();
    range.setStart(tag.firstChild, 1); range.setEnd(tag.firstChild, 3);
    const r = range.getBoundingClientRect(); return { x: r.left, y: r.y + r.height / 2, end: r.right + 100 };
  });
  const queryBeforeDrag = await evaluate('document.querySelector("input[aria-label=Search]").value');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tagStart.x, y: tagStart.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tagStart.x, y: tagStart.y, button: 'left', clickCount: 1 });
  for (let x = tagStart.x + 5; x < tagStart.end; x += 5) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: tagStart.y, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tagStart.end, y: tagStart.y, button: 'left', clickCount: 1 }); await sleep(100);
  check(await evaluate('!ws.view.state.selection.main.empty'), 'dragging from a tag selects text normally');
  check(await evaluate('document.querySelector("input[aria-label=Search]").value') === queryBeforeDrag, 'tag drag does not launch a search');
  // Stage 3: preview lifetime, scroll alignment, and side placement for result lists.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('HoverFix18.md', '# Links\n\nA paragraph above the links.\n\n[[LongFix18#Deep|heading]] and [[LongFix18#^block|block]]');
    await api.createNote('LongFix18.md', '# Top\n\n' + 'Filler paragraph.\n\n'.repeat(24) + '## Deep\n\nBlock body ^block\n\n' + 'Tail paragraph.\n\n'.repeat(24));
    await api.createNote('SearchFix18.md', 'FirstNeedleFix then SecondNeedleFix on one line\nAnother NeedleFix here\nNeedleFix tail');
    await api.createNote('BackFix18.md', 'First [[LongFix18]] then [[LongFix18]] end');
    await ws.vault.refreshFiles(); await ws.vault.refreshLinks(); await ws.open('HoverFix18.md');
  });
  const hover = async selector => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 700 });
    await key('Control', 2);
    const p = await point(selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, modifiers: 2 }); await sleep(450);
    return p;
  };
  const headingPoint = await hover('[data-href="LongFix18#Deep"]');
  check(await evaluate('(()=>{const popup=document.querySelector(".hover-popover"), target=popup.querySelector(".cm-h2");const top=target.getBoundingClientRect().top-popup.getBoundingClientRect().top;return top >= 8 && top <= 24})()'), 'heading preview scrolls the target near the popup top');
  await key('Control', 0, 'keyUp');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: headingPoint.x + 1, y: headingPoint.y }); await sleep(300);
  check(await evaluate('document.querySelectorAll(".hover-popover").length === 1'), 'releasing Ctrl on the same link keeps the preview open');
  await press('Escape'); await hover('[data-href="LongFix18#^block"]');
  check(await evaluate('(()=>{const popup=document.querySelector(".hover-popover"), target=[...popup.querySelectorAll(".cm-line")].find(el=>el.textContent.includes("Block body"));const top=target.getBoundingClientRect().top-popup.getBoundingClientRect().top;return top >= 8 && top <= 24})()'), 'block preview scrolls the target near the popup top');
  await press('Escape'); await key('Control', 0, 'keyUp');
  await run(() => grove.run('global-search:open')); await fill('input[aria-label=Search]', 'NeedleFix'); await sleep(200);
  await hover('.search-view .search-result-file-match[data-preview-path="SearchFix18.md"]');
  check(await evaluate('(()=>{const popup=document.querySelector(".hover-popover").getBoundingClientRect(), dock=document.querySelector(".mod-left-split").getBoundingClientRect();return popup.left >= dock.right && popup.right <= innerWidth})()'), 'Search preview sits beside its dock, leaving other rows uncovered');
  await press('Escape'); await key('Control', 0, 'keyUp');
  await run(async () => { await ws.open('LongFix18.md'); grove.run('backlink:open'); }); await sleep(250);
  await hover('.backlink-pane .search-result-file-match[data-preview-path="BackFix18.md"]');
  check(await evaluate('(()=>{const popup=document.querySelector(".hover-popover").getBoundingClientRect(), dock=document.querySelector(".mod-right-split").getBoundingClientRect();return popup.right <= dock.left && popup.left >= 0})()'), 'Backlinks preview sits beside its dock, leaving other rows uncovered');
  await press('Escape'); await key('Control', 0, 'keyUp');
  await click('.backlink-pane [data-preview-path="BackFix18.md"] .search-result-file-matched-text:nth-of-type(2)');
  check(await evaluate('ws.active.path === "BackFix18.md" && ws.view.state.selection.main.from === ws.view.state.doc.toString().lastIndexOf("[[LongFix18]]")'), 'second Backlinks highlight selects its own source range');
  await fill('input[aria-label=Search]', 'NeedleFix'); await sleep(200);
  await click('.search-view [data-preview-path="SearchFix18.md"] .search-result-file-matched-text:nth-of-type(2)');
  check(await evaluate('ws.active.path === "SearchFix18.md" && ws.view.state.selection.main.from === ws.view.state.doc.line(1).text.lastIndexOf("NeedleFix")'), 'second Search highlight selects its own source range');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('TailFix18.md', 'padding '.repeat(30) + 'FarNeedleFix at the far side ' + 'padding '.repeat(30));
    await ws.vault.refreshFiles();
  });
  await fill('input[aria-label=Search]', 'FarNeedleFix'); await sleep(200);
  check(await evaluate('(()=>{const row=document.querySelector(`.search-view [data-preview-path="TailFix18.md"].search-result-file-match`);return row.textContent.startsWith("…") && row.textContent.endsWith("…") && row.textContent.length < 150 && row.getBoundingClientRect().height < 200})()'), 'a long search line shows a short window around the hit, with ellipses');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('CalloutFix18.md', 'Before.\n\n> [!note] Callout\n> Embedded below.\n> ![[Embedded18]]\n\nAfter.');
    await ws.vault.refreshFiles(); await ws.open('CalloutFix18.md');
  }); await sleep(100);
  await click('.cm-callout .markdown-embed .cm-h1 .cm-reading-text');
  check(await evaluate('ws.view.hasFocus && ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text === "> ![[Embedded18]]" && ws.view.contentDOM.innerText.includes("![[Embedded18]]")'), 'callout embed click reveals the embed source line, not the callout header');
  await run(() => { ws.view.dispatch({ selection: { anchor: 0 } }); }); await sleep(100);
  await click('.cm-callout .markdown-embed-link');
  check(await evaluate('ws.active.path === "Embedded18.md"'), 'callout embed Open link control still navigates');
  await run(async () => { await ws.open('Round18.md'); ws.setMode('reading'); }); await sleep(100);
  check(await evaluate('(()=>{const s=getComputedStyle(document.querySelector(".markdown-embed-content .cm-h1"));return s.fontSize === "31px" && s.paddingTop === "0px"})()'), 'Reading embedded H1 follows the Reading heading size and padding');
  await run(() => ws.setMode('live')); await sleep(100);
  check(await evaluate('getComputedStyle(document.querySelector(".markdown-embed-content .cm-h1")).fontSize !== "31px"'), 'embedded H1 keeps Live Preview typography in editing mode');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
} finally {
  socket?.close(); browser.kill('SIGTERM'); server.kill('SIGTERM');
}
