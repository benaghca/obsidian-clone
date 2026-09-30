// Video and audio: served in pieces, played when opened, shown on the Inbox board, embedded in
// notes, and, when this computer can't decode one, explained with "Open in default app".
// (The test browser plays WebM but not H.264/HEVC, so the playable clip is a tiny WebM.)
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
(async () => {
  const clip = fs.readFileSync(__dirname + '/fixtures/clip.webm');
  w('Inbox/clip.webm', clip);
  w('Inbox/broken.mov', Buffer.from('this is not a video at all, just some bytes '.repeat(40)));
  w('Budget.xlsx', 'PK not really a spreadsheet'); w('run.sh', 'echo hi');
  w('Videos.md', '# Videos\n\n![[clip.webm]]\n\nText after.\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(1000);

  console.log('served in pieces');
  const r = await page.evaluate(async () => { const res = await fetch(rawUrl('Inbox/clip.webm'), { headers: { Range: 'bytes=10-19' } }); return { status: res.status, range: res.headers.get('content-range'), type: res.headers.get('content-type'), len: (await res.arrayBuffer()).byteLength }; });
  assert(r.status === 206 && r.range === `bytes 10-19/${clip.length}` && r.len === 10 && r.type === 'video/webm', 'a range request gets just that piece: ' + JSON.stringify(r));
  assert(await page.evaluate(async () => (await fetch(rawUrl('Inbox/broken.mov'), { headers: { Range: 'bytes=0-3' } })).headers.get('content-type')) === 'video/mp4', 'a .mov is served as MP4');

  console.log('on the Inbox board');
  await page.click('[data-cmd=inbox]'); await sleep(1500);
  const sticky = n => `#view-inbox .ib-lane .ib-card[data-path="Inbox/${n}"]`;
  assert(await page.$(sticky('clip.webm') + '.is-video video.ib-vthumb'), 'a video is a sticky showing its first frame');
  assert(/▶ 0:01/.test(await page.textContent(sticky('clip.webm') + ' .ib-play')), 'with its length on the badge: ' + await page.textContent(sticky('clip.webm') + ' .ib-play'));
  assert(await page.$(sticky('broken.mov') + ' .ib-video.ib-noplay'), 'one this computer can’t read shows as a ▶ MOV tile');

  await page.screenshot({ path: SP + '/shots/media-inbox.png', clip: { x: 300, y: 150, width: 700, height: 500 } });
  console.log('opened');
  await page.click(sticky('clip.webm')); await sleep(800);
  assert(await page.evaluate(() => S.view === 'file' && !!document.querySelector('#view-file .media-view video.media[controls]')), 'clicking it opens a player');
  const played = await page.evaluate(async () => { const v = document.querySelector('#view-file video.media'); v.muted = true; await v.play(); await new Promise(r => setTimeout(r, 600)); return { t: v.currentTime, d: v.duration }; });
  assert(played.t > 0.2 && Math.abs(played.d - 1.2) < 0.15, 'and it plays: ' + JSON.stringify(played));
  assert(await page.$('#view-file [data-open-default="Inbox/clip.webm"]'), 'with Open in default app beside it');
  await page.screenshot({ path: SP + '/shots/media-player.png' });
  await page.evaluate(() => openPath('Inbox/broken.mov')); await sleep(1200);
  const fail = await page.textContent('#view-file .media-fail').catch(() => '');
  assert(/can’t be played here/.test(fail) && /Most Compatible/.test(fail) && await page.$('#view-file .media-fail [data-open-default="Inbox/broken.mov"]'), 'one that can’t be decoded says why, what to do, and offers the default app');
  await page.screenshot({ path: SP + '/shots/media-fail.png' });
  await page.click('#view-file .media-fail [data-open-default]'); await sleep(400);
  assert(!(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /Couldn’t open/.test(t.textContent)))), 'which the app accepts (a media file in the vault)');
  const refused = await page.evaluate(async () => { try { await api(`/api/open-file?path=${enc('Videos.md')}`, { method: 'POST' }); return 'opened'; } catch (e) { return e.message; } });
  assert(/only video, audio and documents/.test(refused), 'while anything else is refused: ' + refused);

  console.log('other files');
  await page.evaluate(() => openPath('Budget.xlsx')); await sleep(600);
  assert(!(await page.$('#view-file a[href*="/api/raw"]')), 'a spreadsheet has no link to its raw file (it replaced the whole window)');
  await page.click('#view-file [data-open-default="Budget.xlsx"]'); await sleep(400);
  assert(!(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /Couldn’t open/.test(t.textContent)))), 'it opens in the default app');
  await page.evaluate(() => openPath('run.sh')); await sleep(600);
  assert(!(await page.$('#view-file [data-open-default]')) && /can’t open this kind/.test(await page.textContent('#view-file')), 'a script gets no button');
  const script = await page.evaluate(async () => { try { await api(`/api/open-file?path=${enc('run.sh')}`, { method: 'POST' }); return 'opened'; } catch (e) { return e.message; } });
  assert(/only video, audio and documents/.test(script), 'and the app won’t open it: ' + script);

  console.log('in notes');
  await page.evaluate(() => openPath('Videos.md')); await sleep(800);
  await page.evaluate(() => setMode('read')); await sleep(500);
  assert(await page.$('#preview .media-embed video.media[controls]'), '![[clip.webm]] is a player in reading view');
  await page.evaluate(() => setMode('edit')); await sleep(500);
  assert(await page.$('.cm-editor .cm-visual-embed.media-embed video.media'), 'and in the editor');

  console.log('ERRORS:', errors.join('\n') || 'none');
  assert(!errors.length, 'no page errors');
  await browser.close();
})().catch(async e => { console.log(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });
