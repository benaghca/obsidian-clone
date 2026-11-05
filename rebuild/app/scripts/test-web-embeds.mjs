// W2: web pages embedded in notes, against local fixture pages on 127.0.0.1
// (never a real site). Two fixture servers stand in for two web origins.
// Every request the browser makes is recorded and must stay on 127.0.0.1;
// each fixture server counts the loads it serves.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { permitFrameOrigin, withBrowser, sleep } from './browser.mjs';

const fixture = async (name) => {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url.startsWith('/page')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><title>${name}</title><body style="margin:0;font:16px sans-serif"><h1>Fixture ${name}</h1></body>`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, hits, loads: (path = '/page') => hits.filter((h) => h === path).length, close: () => new Promise((r) => server.close(r)) };
};

const a = await fixture('A');
const b = await fixture('B');
const releaseA = permitFrameOrigin(a.origin);
const releaseB = permitFrameOrigin(b.origin);
try {
  await withBrowser(async ({ send, on, run, press, chord, click, move, check, open, key }) => {
    const requests = [];
    const logs = [];
    await send('Network.enable');
    on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
    on('Runtime.consoleAPICalled', (p) => logs.push(p.args.map((x) => x.value).join(' ')));
    const until = async (fn, label, tries = 60) => {
      let last;
      for (let i = 0; i < tries; i++) {
        last = await fn();
        if (last) return last;
        await sleep(50);
      }
      assert.fail(`${label}: ${JSON.stringify(last)}`);
    };
    const text = () => run(() => ws.view.state.doc.toString());
    const frame = () => run(() => {
      const f = document.querySelector('.cm-content .web-embed iframe');
      return f && { src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'), referrer: f.getAttribute('referrerpolicy'), loading: f.getAttribute('loading'), allow: f.getAttribute('allow'), title: f.title };
    });
    const origins = () => run(async () => (await import('/src/mock/backend.ts')).mockAllowedFrameOrigins());
    const setting = (value) => run(async (value) => {
      const { settings } = await import('/src/settings/store.ts');
      await settings.set('app.json', 'webEmbeds', value);
    }, value);

    check(await run(async () => (await import('/src/settings/store.ts')).settings.get('app.json').webEmbeds === 'always'), 'Embedded web pages default to Always');
    check((await origins()).length === 0 && a.hits.length === 0, 'opening the vault registers and loads nothing');

    // ----- Always: the page loads, in the sandbox the plan asks for -----
    const url = `${a.origin}/page`;
    await open('Web.md', `Intro line\n\n![](${url})\n\nAfter line\n`);
    await run(() => ws.setMode('live'));
    const f = await until(frame, 'the embed frames the page');
    check(f.src === url, 'the frame loads the address written');
    check(f.sandbox === 'allow-scripts allow-same-origin allow-forms', 'sandbox: scripts, same origin and forms only (no top navigation, no popups)');
    check(f.referrer === 'no-referrer' && f.loading === 'lazy' && f.allow === null, 'no referrer, lazy loading, no allow= features');
    check(JSON.stringify(await origins()) === JSON.stringify([a.origin]), 'the frame origin is registered with allow_frame_origin first');
    await until(() => a.loads() === 1, 'the fixture page is requested once');
    check(await run(() => document.querySelector('.web-embed-host')?.textContent.includes('127.0.0.1')), 'the bar shows the host');
    const box = await run(() => { const r = document.querySelector('.web-embed-frame').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    check(box.h === 480, `the default height is 480 (${box.h})`);

    // ----- the caret passes it as it passes an image -----
    await run(() => { ws.view.focus(); ws.view.dispatch({ selection: { anchor: 3 } }); });
    await run(() => document.querySelector('.web-embed iframe').dataset.mark = 'first');
    const heads = [];
    for (let i = 0; i < 3; i++) {
      await press('ArrowDown');
      await sleep(40);
      heads.push(await run(() => ws.view.state.selection.main.head));
    }
    const embedFrom = 'Intro line\n\n'.length, embedTo = embedFrom + `![](${url})`.length;
    check(heads.every((h) => h <= embedFrom || h >= embedTo), `ArrowDown never puts the caret inside the embed's source (${heads})`);
    check(heads.at(-1) > embedTo, 'ArrowDown goes past the embed to the next lines');
    check(await run(() => document.querySelector('.web-embed iframe')?.dataset.mark === 'first'), 'moving the caret past it keeps the page loaded');
    await run((at) => ws.view.dispatch({ selection: { anchor: at } }), embedTo);
    await sleep(60);
    check(await run(() => document.querySelector('.web-embed iframe')?.dataset.mark === 'first'), 'with the caret on its line it stays drawn, as an image does');

    // ----- resize: the size is written on release, one undo step, the page stays loaded -----
    const corner = await run(() => { const r = document.querySelector('.web-embed-corner').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await move(corner);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...corner, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: corner.x - 50 * i, y: corner.y - 20 * i, button: 'left', buttons: 1 });
      await sleep(20);
    }
    check(await run(() => document.querySelector('.web-embed').classList.contains('is-resizing')), 'while resizing, the page underneath takes no pointer events');
    check((await text()).includes(`![](${url})`), 'nothing is written while dragging');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: corner.x - 300, y: corner.y - 120, button: 'left', buttons: 0, clickCount: 1 });
    const resized = await until(async () => /!\[\|(\d+)x(\d+)\]\(/.exec(await text()), 'the resize writes |WxH');
    const [w, h] = [Number(resized[1]), Number(resized[2])];
    check(Math.abs(w - (box.w - 300)) <= 2 && Math.abs(h - 360) <= 2, `the size written is the size dragged (${w}x${h})`);
    check((await text()) === `Intro line\n\n![|${w}x${h}](${url})\n\nAfter line\n`, 'only the alt text changes');
    check(await run(() => document.querySelector('.web-embed iframe')?.dataset.mark === 'first') && a.loads() === 1, 'the resized page stays loaded (no reload)');
    const drawnSize = await run(() => { const r = document.querySelector('.web-embed-frame').getBoundingClientRect(); return { w: document.querySelector('.web-embed').getBoundingClientRect().width, h: r.height }; });
    check(Math.abs(drawnSize.w - w) <= 1 && drawnSize.h === h, 'it is drawn at the size written');
    await chord('z');
    await sleep(80);
    check((await text()) === `Intro line\n\n![](${url})\n\nAfter line\n`, 'one undo puts the size back');
    await chord('y');
    await sleep(80);
    check((await text()).includes(`![|${w}x${h}](`), 'redo writes it again');
    // A double-click on the corner goes back to the default size.
    const corner2 = await run(() => { const r = document.querySelector('.web-embed-corner').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await move(corner2);
    for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...corner2, button: 'left', clickCount });
    await until(async () => (await text()).includes(`![](${url})`), 'double-clicking the corner drops the size');

    // ----- Edit this block, then Esc, as with an image -----
    await move(await run(() => { const r = document.querySelector('.web-embed-bar').getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 }; }));
    await click('.web-embed-action[aria-label="Edit this block"]');
    const sel = await run(() => { const s = ws.view.state.selection.main; return ws.view.state.sliceDoc(s.from, s.to); });
    check(sel === url, 'Edit this block selects the address');
    check(await run(() => !document.querySelector('.cm-content .web-embed')), 'and shows the source');
    await press('Escape');
    await until(() => run(() => !!document.querySelector('.cm-content .web-embed iframe')), 'Esc draws the page again');
    check(await run(() => ws.view.state.selection.main.empty), 'Esc leaves the caret, not a selection');

    // ----- Reload and Open in browser -----
    // Esc drew it again, which loads it again; let that settle first.
    let settled = -1;
    for (let i = 0; i < 20 && settled !== a.loads(); i++) { settled = a.loads(); await sleep(100); }
    const before = a.loads();
    await click('.web-embed-reload');
    await until(() => a.loads() === before + 1, `Reload loads the page again (${a.hits})`);
    await click('.web-embed-action[aria-label="Open in browser"]');
    await until(() => logs.some((l) => l.includes(`would open externally: ${url}`)), 'Open in browser hands the address to the system opener');

    // ----- Reading view -----
    await run(() => ws.setMode('reading'));
    await until(() => run(() => !!document.querySelector('.web-embed iframe') && !document.querySelector('.web-embed-action[aria-label="Edit this block"]')), 'reading view shows the page, without Edit this block');
    check(await run(() => getComputedStyle(document.querySelector('.web-embed-corner')).display === 'none'), 'reading view has no resize corner');
    await run(() => ws.setMode('live'));

    // ----- only alone on a line; images stay chips -----
    const inline = `See ![](${b.origin}/page) inline\n\n![pic](${b.origin}/pic.png)\n\n- ![](${b.origin}/page)\n`;
    await open('Inline.md', inline);
    await run(() => ws.setMode('reading'));
    await sleep(200);
    check(await run(() => !document.querySelector('.web-embed') && document.querySelectorAll('.cm-remote-embed').length === 3), 'inline, image and list-item embeds stay link chips');
    check(b.hits.length === 0, 'and nothing is fetched for them');
    await run(() => ws.setMode('live'));

    // ----- inside a callout: the page shows; its source can't be edited from there -----
    await open('Callout.md', `Top\n\n> [!note] Page\n> ![](${a.origin}/page?callout)\n\nEnd\n`);
    await until(() => run(() => !!document.querySelector('.cm-callout .web-embed iframe')), 'a page in a callout shows');
    check(await run(() => ['.web-embed-edit', '.web-embed-corner'].every((sel) => { const el = document.querySelector(`.cm-callout ${sel}`); return !el || getComputedStyle(el).display === 'none'; })), 'a page in a callout has no Edit this block or resize corner');

    // ----- Click to load: nothing until clicked -----
    await setting('click');
    const urlB = `${b.origin}/page?click`;
    await open('Click.md', `Top\n\n![|x300](${urlB})\n`);
    await until(() => run(() => !!document.querySelector('.web-embed-ask')), 'click mode draws a Load prompt');
    await sleep(300);
    check(await run(() => !document.querySelector('.web-embed iframe')), 'click mode draws no frame');
    check(b.hits.length === 0 && !(await origins()).includes(b.origin), 'click mode registers and fetches nothing');
    check(await run(() => document.querySelector('.web-embed-frame').getBoundingClientRect().height === 300), 'the prompt has the size written');
    await click('.web-embed-load');
    await until(frame, 'Load frames the page');
    await until(() => b.loads('/page?click') === 1, 'Load fetches the page once');
    check((await origins()).includes(b.origin), 'Load registers the origin first');
    // The same page drawn again this session loads without asking.
    await open('Click again.md', `Top\n\n![](${urlB})\n`);
    await until(frame, 'a page loaded once this session loads at once');

    // ----- the setting changing redraws an open note -----
    await setting('off');
    await until(() => run(() => !document.querySelector('.web-embed') && !!document.querySelector('.cm-remote-embed')), 'Off turns the page back into a link chip');
    check(await run(() => document.querySelector('.cm-remote-embed').dataset.href) === urlB, 'the chip links the address');
    const hits = b.hits.length;
    await open('Off.md', `Top\n\n![](${b.origin}/page?off)\n`);
    await sleep(300);
    check(await run(() => !document.querySelector('.web-embed') && !!document.querySelector('.cm-remote-embed')) && b.hits.length === hits, 'Off draws a chip and fetches nothing');
    await setting('always');
    await until(frame, 'Always loads it once switched back');

    // ----- the setting is in Settings → Editor -----
    await run(() => grove.run('app:open-settings'));
    await until(() => run(() => !!document.querySelector('.vertical-tab-nav-item')), 'settings open');
    await run(() => [...document.querySelectorAll('.vertical-tab-nav-item')].find((el) => el.textContent.trim() === 'Editor').click());
    const row = await until(() => run(() => {
      const item = [...document.querySelectorAll('.setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent === 'Embedded web pages');
      return item && [...item.querySelectorAll('option')].map((o) => o.value).join(',') + ':' + item.querySelector('select').value;
    }), 'Settings → Editor lists Embedded web pages');
    check(row === 'always,click,off:always', `its choices are Always, Click to load and Off (${row})`);
    await press('Escape');

    const remote = requests.filter((r) => !/^(?:https?:\/\/127\.0\.0\.1[:/]|data:|blob:|about:)/.test(r));
    check(remote.length === 0, `every request stayed on 127.0.0.1 (${remote.slice(0, 3)})`);
  });
} finally {
  releaseA();
  releaseB();
  await a.close();
  await b.close();
}
console.log('web embed checks passed');
