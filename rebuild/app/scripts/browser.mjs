// Shared scratch-vault CDP driver. All interaction uses native pointer/key input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Resolve without launching candidates (especially Chrome/Edge on Windows).
export function findBrowser(env = process.env, platform = process.platform) {
  const windows = platform === 'win32';
  const dirs = (env.PATH ?? '').split(windows ? ';' : delimiter);
  const roots = [env.PROGRAMFILES ?? 'C:\\Program Files', env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', env.LOCALAPPDATA].filter(Boolean);
  const candidates = [env.GROVE_BROWSER, 'chromium', 'chromium-browser', 'google-chrome', ...(windows ? [
    ...roots.map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ...roots.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
  ] : [])].filter(Boolean);
  for (const candidate of candidates) {
    const paths = /[/\\]/.test(candidate) ? [candidate] : dirs.map(dir => join(dir, candidate));
    for (const path of paths) for (const executable of windows && !extname(path) ? [path, path + '.exe'] : [path]) {
      try { accessSync(executable, constants.X_OK); if (statSync(executable).isFile()) return executable; } catch {}
    }
  }
  return null;
}
export async function withBrowser(test, { height = 1000, screenshots } = {}) {
  const executable = findBrowser();
  if (!executable) {
    console.error('No browser found. Set GROVE_BROWSER to the full path to Chrome, Edge or Chromium.');
    process.exit(1);
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = await mkdtemp(root + 'node_modules/.browser-');
  const port = await new Promise(resolve => {
    const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'ignore' });
  const browser = spawn(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${scratch}`, 'about:blank'], { stdio: 'ignore' });
  let socket;
  try {
    let tabs;
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(url);
        const debugPort = (await readFile(scratch + '/DevToolsActivePort', 'utf8')).split('\n')[0];
        tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        if (tabs.some(t => t.type === 'page')) break;
      } catch {}
      await sleep(100);
    }
    assert.ok(tabs, 'headless Chromium and Vite started');
    socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => { socket.onopen = resolve; });
    let sequence = 0;
    const pending = new Map(), errors = [];
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
      const virtual = { Enter: 13, Escape: 27, Control: 17, End: 35, Tab: 9, Backspace: 8, Shift: 16, ArrowDown: 40, ArrowUp: 38, Home: 36, ArrowLeft: 37, ArrowRight: 39, Alt: 18 }[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      await send('Input.dispatchKeyEvent', { type, key, modifiers, windowsVirtualKeyCode: virtual });
    };
    const press = async (k, modifiers = 0) => { await key(k, modifiers); await key(k, modifiers, 'keyUp'); };
    const chord = async k => { await key('Control', 2); await press(k, 2); await key('Control', 0, 'keyUp'); };
    const point = selector => run(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    const move = async p => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p }); await sleep(40); };
    const click = async (target, button = 'left') => {
      const p = typeof target === 'string' ? await point(target) : target;
      await move(p);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button, clickCount: 1 });
      await sleep(50);
    };
    const double = async target => {
      const p = typeof target === 'string' ? await point(target) : target;
      await move(p);
      for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount });
      await sleep(80);
    };
    const read = () => run(async () => { const { api } = await import('/src/api.ts'); return api.readNote(ws.active.viewFile); });
    const open = async (path, source, delay = 100) => {
      await run(async (path, content) => {
        const { api } = await import('/src/api.ts');
        await api.createNote(path, content); await ws.vault.refreshFiles(); await ws.open(path);
      }, path, typeof source === 'string' ? source : JSON.stringify(source));
      await sleep(delay);
    };
    const fill = async (selector, text) => { await click(selector); await chord('a'); await send('Input.insertText', { text }); await press('End'); };
    const check = (value, message) => { assert.ok(value, message); console.log('PASS', message); };
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    for (let i = 0; i < 100 && !await evaluate('!!window.ws?.active.path'); i++) await sleep(100);
    assert.ok(await evaluate('!!window.ws?.active.path'), 'scratch mock vault loaded');
    const shot = async name => {
      assert.ok(screenshots, 'screenshot output directory configured');
      await mkdir(screenshots, { recursive: true });
      await writeFile(join(screenshots, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    };
    await test({ send, evaluate, run, key, press, chord, point, move, click, fill, double, read, open, check, shot });
    assert.deepEqual(errors, [], 'no browser exceptions');
  } finally {
    socket?.close(); browser.kill(); server.kill();
    await Promise.all([new Promise(r => browser.once('exit', r)), new Promise(r => server.once('exit', r))]);
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
