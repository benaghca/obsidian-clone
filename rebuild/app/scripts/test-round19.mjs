// Headless UI regressions. Native CDP mouse/keyboard input; only the in-memory mock vault.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = root + 'node_modules/.round19-partb';
await mkdir(scratch, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1440'], { cwd: root, stdio: 'ignore' });
const browser = spawn('chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--remote-debugging-port=9450', `--user-data-dir=${scratch}/chromium`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let tabs;
  for (let i = 0; i < 100; i++) {
    try { await fetch('http://127.0.0.1:1440/'); tabs = await (await fetch('http://127.0.0.1:9450/json')).json(); if (tabs.some(t => t.type === 'page')) break; } catch {}
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
    const virtual = { Enter: 13, Escape: 27, Control: 17, End: 35, Tab: 9, Backspace: 8, Shift: 16, ArrowDown: 40 }[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
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
  await send('Page.navigate', { url: 'http://127.0.0.1:1440/' }); await sleep(700);
  await evaluate('localStorage.clear()'); await send('Page.reload'); await sleep(250);
  for (let i = 0; i < 100 && !await evaluate('!!window.ws?.active.path'); i++) await sleep(100);

  assert.ok(await evaluate('!!window.ws'), JSON.stringify({errors,body:await evaluate('document.body.innerText')}));
  await run(async () => {
    const {api} = await import('/src/api.ts');
    await api.createNote('Hover19.md', 'Links to [[Short19]], [[Long19]] and [[Long19#Deep|a heading]].');
    await api.createNote('Short19.md', 'First line.\nSecond line.\nThird line.');
    await api.createNote('Long19.md', '# Top\n\n' + 'Filler.\n\n'.repeat(40) + '## Deep\n\nTarget.\n\n' + 'Tail.\n\n'.repeat(40));
    await ws.vault.refreshFiles(); await ws.open('Hover19.md');
    ws.view.dispatch({selection:{anchor:0}}); ws.view.contentDOM.blur();
  }); await sleep(200);
  const hover = async selector => {
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:20,y:700});
    await key('Control',2);
    const p=await point(selector);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p,modifiers:2}); await sleep(500);
    await key('Control',0,'keyUp');
  };
  await hover('[data-href=Short19]');
  check(await evaluate('document.querySelector(".hover-popover .markdown-embed-title").textContent === "Short19"'), 'preview starts with the note title');
  check(await evaluate('(()=>{const p=document.querySelector(".hover-popover"),t=p.querySelector(".markdown-embed-title");return p.offsetHeight < 250 && parseFloat(getComputedStyle(t).fontSize)>24})()'), 'short preview shrinks beneath 250px with a large heading');
  check(await evaluate('document.querySelector(".hover-popover .markdown-embed-link svg") !== null'), 'preview retains the existing Open link icon');
  await shot('hover-short');
  await click('.hover-popover .markdown-embed-link');
  check(await evaluate('ws.active.path === "Short19.md" && !document.querySelector(".hover-popover")'), 'native Open link click opens the previewed note and dismisses preview');
  await run(async()=>{await ws.open('Hover19.md'); ws.view.contentDOM.blur();}); await sleep(150);
  await hover('[data-href=Long19]');
  check(await evaluate('(()=>{const p=document.querySelector(".hover-popover");return p.offsetHeight===400 && p.scrollHeight>p.clientHeight})()'), 'long preview is capped at 400px and scrolls');
  await shot('hover-long'); await press('Escape');
  await hover('[data-href="Long19#Deep"]');
  check(await evaluate('(()=>{const p=document.querySelector(".hover-popover"),t=p.querySelector(".cm-h2");const y=t.getBoundingClientRect().top-p.getBoundingClientRect().top;return p.querySelector(".markdown-embed-title").textContent==="Long19" && y>=8 && y<=24})()'), 'heading preview keeps its file title and existing target alignment');
  await press('Escape');
  await send('Emulation.setDeviceMetricsOverride',{width:800,height:520,deviceScaleFactor:1,mobile:false});
  await run(async()=>{await ws.open('Hover19.md');ws.view.contentDOM.blur();});await sleep(150);
  await hover('[data-href=Long19]');
  check(await evaluate('(()=>{const r=document.querySelector(".hover-popover").getBoundingClientRect();return r.left>=8 && r.top>=8 && r.right<=innerWidth-8 && r.bottom<=innerHeight-8})()'), 'asynchronously loaded long preview remains within a constrained viewport');
  await press('Escape');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  assert.equal(errors.length,0,JSON.stringify(errors));
} finally {socket?.close();browser.kill();server.kill();}
