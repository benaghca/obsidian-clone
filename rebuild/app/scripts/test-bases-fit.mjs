// R2 B1: double-clicking a column edge fits the widest cell, not only the header.
// Headless Chromium. An embedded ```base block and a standalone .base share one path.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const LONG = 'Wider than the header ' + 'column-fit '.repeat(12);
const yaml = `filters: 'file.inFolder("R2B1Fit")'
views:
  - type: table
    name: Fit
    order:
      - t
      - file.name
`;
const notes = {
  'R2B1Fit/A.md': '---\nt: no\n---\n# A\n',
  'R2B1Fit/B.md': `---\nt: ${LONG}\n---\n# B\n`,
};
const host = `# Host\n\n\`\`\`base\n${yaml}\`\`\`\n`;

await withBrowser(async ({ run, double, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 150; i++) { if (await test()) return; await sleep(20); }
    assert.fail(label);
  };
  const ready = (root) => run((root) => {
    const scope = document.querySelector(root);
    const count = scope?.querySelector('.bases-count span')?.textContent;
    const long = [...(scope?.querySelectorAll('td[data-property="t"]') ?? [])].some(td => td.textContent.includes('Wider than the header'));
    return count === '2 results' && long;
  }, root);
  const width = (sel) => run((sel) => document.querySelector(sel).getBoundingClientRect().width, sel);
  const cell = (root) => run((root) => {
    const scope = document.querySelector(root);
    const td = [...scope.querySelectorAll('td[data-property="t"]')].find(el => el.textContent.includes('Wider than the header'));
    const field = td?.querySelector('.property-text') ?? td;
    if (!field) return null;
    return { col: td.getBoundingClientRect().width, overflow: field.scrollWidth - field.clientWidth };
  }, root);
  const saved = (text) => {
    const n = Number(text.match(/note\.t:\s*(\d+(?:\.\d+)?)/)?.[1]);
    return Number.isFinite(n) ? n : 0;
  };

  await run(async (files, base, note) => {
    const { api } = await import('/src/api.ts');
    for (const [path, text] of Object.entries(files)) await api.createNote(path, text);
    await api.createNote('Fit.base', base);
    await api.createNote('FitHost.md', note);
    await ws.vault.refreshFiles();
    ws.setMode('live');
    await ws.open('FitHost.md');
  }, notes, yaml, host);

  await wait(() => ready('.bases-embed'), 'embed rows');
  const embedBefore = await width('.bases-embed th[data-property="t"]');
  check(embedBefore < 120, `embedded column starts at the header (${embedBefore}px)`);
  await double('.bases-embed th[data-property="t"] .bases-resizer');
  await wait(() => run(() => /note\.t:\s*\d/.test(ws.view.state.doc.toString())), 'embed fit writes columnSize');
  await wait(() => run((before) => document.querySelector('.bases-embed th[data-property="t"]').getBoundingClientRect().width > before + 40, embedBefore), 'embed column widens');
  const embedAfter = await width('.bases-embed th[data-property="t"]');
  const embedDoc = await run(() => ws.view.state.doc.toString());
  const embedSaved = saved(embedDoc);
  check(embedAfter > embedBefore + 40 && embedSaved > embedBefore, `embedded fit ${embedBefore} -> ${embedAfter}, saved ${embedSaved}`);
  const embedCell = await cell('.bases-embed');
  check(embedCell && embedCell.overflow <= 2, `embedded long cell fits (${JSON.stringify(embedCell)})`);

  await run(async () => { await ws.open('Fit.base'); });
  await wait(() => ready('.bases-view'), 'standalone rows');
  const before = await width('.bases-table th[data-property="t"]');
  check(before < 120, `standalone column starts at the header (${before}px)`);
  await double('.bases-table th[data-property="t"] .bases-resizer');
  await wait(async () => saved(await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Fit.base'); })) > before, 'standalone fit writes columnSize');
  await wait(() => run((before) => document.querySelector('.bases-table th[data-property="t"]').getBoundingClientRect().width > before + 40, before), 'standalone column widens');
  const after = await width('.bases-table th[data-property="t"]');
  const file = await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Fit.base'); });
  const wrote = saved(file);
  check(after > before + 40 && wrote > before && Math.abs(wrote - after) < 1.5, `standalone fit ${before} -> ${after}, saved ${wrote}`);
  const fitted = await cell('.bases-view');
  check(fitted && fitted.overflow <= 2, `standalone long cell fits (${JSON.stringify(fitted)})`);
  console.log('PASS column fit uses row text in an embed and a standalone base');
});
