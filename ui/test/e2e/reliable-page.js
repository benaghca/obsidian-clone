// Loaded by run.sh (NODE_OPTIONS=--require) before each suite. Chromium's `load` event often
// never fires here: a proxy lookup can hang, and the app's long-poll stays open. Suites then
// die on the first page.goto. Launch without a proxy, wait until the document and the app are
// up, and try the navigation again. A suite that passes its own waitUntil is left as it asked.
'use strict';
const pw = require('playwright-core');
const origLaunch = pw.chromium.launch.bind(pw.chromium);

pw.chromium.launch = async function (options = {}) {
  const args = [...(options.args || [])];
  for (const a of ['--no-proxy-server', '--disable-dev-shm-usage']) if (!args.includes(a)) args.push(a);
  const browser = await origLaunch({ ...options, args });
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...cargs) => patchContext(await origNewContext(...cargs));
  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...pargs) => patchPage(await origNewPage(...pargs));
  return browser;
};

function patchContext(ctx) {
  const orig = ctx.newPage.bind(ctx);
  ctx.newPage = async (...args) => patchPage(await orig(...args));
  return ctx;
}

function patchPage(page) {
  if (page.__cinderNav) return page;
  page.__cinderNav = true;
  const origGoto = page.goto.bind(page);
  page.goto = async (url, options = {}) => {
    const opts = { timeout: 45000, ...options };
    if (options.waitUntil == null) opts.waitUntil = 'domcontentloaded';
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await origGoto(url, opts);
        if (/^https?:\/\/127\.0\.0\.1:43199\b/.test(String(url))) {
          await page.waitForFunction(() => typeof cfg === 'object' && !!document.querySelector('#app'), null, { timeout: 20000 });
        }
        return res;
      } catch (e) {
        last = e;
        await new Promise(r => setTimeout(r, 400));
      }
    }
    throw last;
  };
  page.reload = (options = {}) => page.goto(page.url() || 'http://127.0.0.1:43199/', options);
  return page;
}
