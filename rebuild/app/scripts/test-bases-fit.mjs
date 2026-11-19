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

await withBrowser(async ({ run, double, click, check }) => {
  const wait = async (test, label, attempts = 150) => {
    for (let i = 0; i < attempts; i++) { if (await test()) return; await sleep(20); }
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

  const hideYaml = `filters: 'file.inFolder("R2B1Hide")'
views:
  - type: table
    name: Hide
    order:
      - t
      - file.name
    groupBy:
      property: g
      direction: ASC
      order:
        - show
        - hide
      hidden:
        - hide
`;
  await run(async (long, yaml) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R2B1Hide/A.md', '---\ng: show\nt: no\n---\n# A\n');
    await api.createNote('R2B1Hide/B.md', `---\ng: hide\nt: ${long}\n---\n# B\n`);
    await api.createNote('Hide.base', yaml);
    await ws.vault.refreshFiles();
    await ws.open('Hide.base');
  }, LONG, hideYaml);
  await wait(() => run(() => {
    const scope = document.querySelector('.bases-view');
    const count = scope?.querySelector('.bases-count span')?.textContent;
    const hidden = [...(scope?.querySelectorAll('td[data-property="t"]') ?? [])].some(td => td.textContent.includes('Wider than the header'));
    return count === '1 results' && !hidden;
  }), 'hidden group is not drawn');
  const hideBefore = await width('.bases-table th[data-property="t"]');
  check(hideBefore < 120, `hidden-group column starts at the header (${hideBefore}px)`);
  await double('.bases-table th[data-property="t"] .bases-resizer');
  let hideGrew = false;
  for (let i = 0; i < 25; i++) {
    const now = await width('.bases-table th[data-property="t"]');
    const src = await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Hide.base'); });
    if (now >= 120 || /note\.t:\s*\d{3,}/.test(src)) hideGrew = true;
    await sleep(40);
  }
  check(!hideGrew, 'a hidden group does not widen the column');
  console.log('PASS hidden group rows are left out of the fit');

  const pill = 'Wider than the header ' + 'pill-fit '.repeat(8);
  const formulaYaml = `filters: 'file.inFolder("R2B1Pills")'
formulas:
  pills: items
views:
  - type: table
    name: Pills
    order:
      - formula.pills
      - file.name
`;
  await run(async (pill, yaml) => {
    const { api } = await import('/src/api.ts');
    const { settings } = await import('/src/settings/store.ts');
    settings.setPropertyType('mix', 'text');
    await api.createNote('R2B1Pills/A.md', `---\nitems:\n  - ${pill}\nmix:\n  - ${pill}\n---\n# A\n`);
    await api.createNote('R2B1Pills/B.md', '---\nitems:\n  - no\nmix: no\n---\n# B\n');
    await api.createNote('Pills.base', yaml);
    await api.createNote('Mix.base', `filters: 'file.inFolder("R2B1Pills")'\nviews:\n  - type: table\n    name: Mix\n    order:\n      - mix\n      - file.name\n`);
    await ws.vault.refreshFiles();
    await ws.open('Pills.base');
  }, pill, formulaYaml);
  await wait(() => run(() => {
    const scope = document.querySelector('.bases-view');
    return scope?.querySelector('.bases-count span')?.textContent === '2 results' && !!scope.querySelector('td[data-property="formula.pills"] .property-pill');
  }), 'formula pills render');
  const pillBefore = await width('.bases-table th[data-property="formula.pills"]');
  check(pillBefore < 160, `formula column starts at the header (${pillBefore}px)`);
  await double('.bases-table th[data-property="formula.pills"] .bases-resizer');
  await wait(() => run(async (before) => {
    const { api } = await import('/src/api.ts');
    const th = document.querySelector('.bases-table th[data-property="formula.pills"]');
    return /formula\.pills:\s*\d/.test(await api.readNote('Pills.base')) && th.getBoundingClientRect().width > before + 40;
  }, pillBefore), 'formula fit writes columnSize');
  const pillFit = await run(() => {
    const td = [...document.querySelectorAll('td[data-property="formula.pills"]')].find(el => el.textContent.includes('Wider than the header'));
    const item = td?.querySelector('.property-pill');
    if (!td || !item) return null;
    return { col: td.getBoundingClientRect().width, pill: item.getBoundingClientRect().width };
  });
  check(pillFit && pillFit.pill <= pillFit.col + 2, `formula pills fit (${JSON.stringify(pillFit)})`);
  console.log('PASS formula list fit uses the drawn pills');

  await run(async () => { await ws.open('Mix.base'); });
  await wait(() => run(() => {
    const scope = document.querySelector('.bases-view');
    return scope?.querySelector('.bases-count span')?.textContent === '2 results' && !!scope.querySelector('td[data-property="mix"] .property-pill');
  }), 'mixed list cell renders as pills');
  const mixBefore = await width('.bases-table th[data-property="mix"]');
  check(mixBefore < 120, `mixed column starts at the header (${mixBefore}px)`);
  await double('.bases-table th[data-property="mix"] .bases-resizer');
  await wait(() => run(async (before) => {
    const { api } = await import('/src/api.ts');
    const th = document.querySelector('.bases-table th[data-property="mix"]');
    return /note\.mix:\s*\d/.test(await api.readNote('Mix.base')) && th.getBoundingClientRect().width > before + 40;
  }, mixBefore), 'mixed fit writes columnSize');
  const mixFit = await run(() => {
    const td = [...document.querySelectorAll('td[data-property="mix"]')].find(el => el.textContent.includes('Wider than the header'));
    const item = td?.querySelector('.property-pill');
    if (!td || !item) return null;
    return { col: td.getBoundingClientRect().width, pill: item.getBoundingClientRect().width };
  });
  check(mixFit && mixFit.pill <= mixFit.col + 2, `mixed list cell fits (${JSON.stringify(mixFit)})`);
  console.log('PASS a list drawn in a text column is part of the fit');

  const rows = 300;
  await run(async (n, long) => {
    const { api } = await import('/src/api.ts');
    for (let i = 0; i < n; i++) {
      const text = i === n - 1 ? long : 'no';
      await api.createNote(`R2B1Large/${String(i).padStart(3, '0')}.md`, `---\nt: ${text}\n---\n`);
    }
    await api.createNote('Large.base', `filters: 'file.inFolder("R2B1Large")'\nviews:\n  - type: table\n    name: Large\n    order:\n      - t\n      - file.name\n`);
    await ws.vault.refreshFiles();
    await ws.open('Large.base');
  }, rows, LONG);
  await wait(() => run((n) => document.querySelector('.bases-view .bases-count span')?.textContent === `${n} results`, rows), 'large result', 400);
  const painted = await run(() => [...document.querySelectorAll('.bases-view td[data-property="t"]')].some(td => td.textContent.includes('Wider than the header')));
  check(!painted, 'the widest cell is outside the painted window');
  const largeBefore = await width('.bases-table th[data-property="t"]');
  check(largeBefore < 120, `large column starts at the header (${largeBefore}px)`);
  const elapsed = await run(() => {
    const handle = document.querySelector('.bases-table th[data-property="t"] .bases-resizer');
    const start = performance.now();
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return performance.now() - start;
  });
  check(elapsed < 400, `fit of ${rows} virtualized rows took ${elapsed.toFixed(1)}ms`);
  await wait(() => run((before) => document.querySelector('.bases-table th[data-property="t"]').getBoundingClientRect().width > before + 40, largeBefore), 'off-screen cell widens the column');
  const largeAfter = await width('.bases-table th[data-property="t"]');
  const largeFile = await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Large.base'); });
  const largeSaved = saved(largeFile);
  check(largeAfter > largeBefore + 40 && largeSaved > largeBefore, `off-screen fit ${largeBefore} -> ${largeAfter}, saved ${largeSaved}, ${elapsed.toFixed(1)}ms`);
  console.log('PASS virtualized fit includes the off-screen cell');

  // A hidden group's long pill sets the automatic width. The fit is the short
  // visible pill, which is narrower, and that smaller width has to be saved.
  const hidePill = 'Wider than the header ' + 'pill-fit '.repeat(8);
  const pillHideYaml = `filters: 'file.inFolder("R2B1PillHide")'
views:
  - type: table
    name: PillHide
    order:
      - labels
      - file.name
    groupBy:
      property: g
      direction: ASC
      order:
        - show
        - hide
      hidden:
        - hide
`;
  await run(async (pill, yaml) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R2B1PillHide/A.md', '---\ng: show\nlabels:\n  - no\n---\n# A\n');
    await api.createNote('R2B1PillHide/B.md', `---\ng: hide\nlabels:\n  - ${pill}\n---\n# B\n`);
    await api.createNote('PillHide.base', yaml);
    await ws.vault.refreshFiles();
    await ws.open('PillHide.base');
  }, hidePill, pillHideYaml);
  await wait(() => run(() => {
    const scope = document.querySelector('.bases-view');
    const count = scope?.querySelector('.bases-count span')?.textContent;
    const hidden = [...(scope?.querySelectorAll('td[data-property="labels"]') ?? [])].some(td => td.textContent.includes('pill-fit'));
    return count === '1 results' && !hidden && !!scope.querySelector('td[data-property="labels"] .property-pill');
  }), 'hidden pill group is not drawn');
  const pillHideBefore = await width('.bases-table th[data-property="labels"]');
  check(pillHideBefore > 280, `hidden pill sets the automatic width (${pillHideBefore}px)`);
  await double('.bases-table th[data-property="labels"] .bases-resizer');
  await wait(() => run(async (before) => {
    const { api } = await import('/src/api.ts');
    const th = document.querySelector('.bases-table th[data-property="labels"]');
    const saved = Number((await api.readNote('PillHide.base')).match(/note\.labels:\s*(\d+(?:\.\d+)?)/)?.[1]);
    const now = th.getBoundingClientRect().width;
    return now < before - 80 && saved < before - 80 && Math.abs(saved - now) < 1.5;
  }, pillHideBefore), 'hidden pill fit persists the smaller width');
  const pillHideAfter = await width('.bases-table th[data-property="labels"]');
  const pillHideFit = await run(() => {
    const td = document.querySelector('td[data-property="labels"]');
    const item = td?.querySelector('.property-pill');
    if (!td || !item) return null;
    return { col: td.getBoundingClientRect().width, pill: item.getBoundingClientRect().width };
  });
  check(pillHideFit && pillHideFit.pill <= pillHideFit.col + 2, `visible pill fits after the shrink (${pillHideBefore} -> ${pillHideAfter}, ${JSON.stringify(pillHideFit)})`);
  console.log('PASS a hidden pill does not keep the fitted width');

  // A collapsed group's longer text must not widen the fit. An unpainted row
  // of the expanded group still does.
  const longer = LONG + ' ' + 'W'.repeat(40);
  const shutRows = 80;
  await run(async (n, long, extra) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R2B1Shut/shut.md', `---\ng: shut\nt: ${extra}\n---\n`);
    for (let i = 0; i < n; i++) {
      const text = i === n - 1 ? long : 'no';
      await api.createNote(`R2B1Shut/${String(i).padStart(3, '0')}.md`, `---\ng: open\nt: ${text}\n---\n`);
    }
    await api.createNote('Shut.base', `filters: 'file.inFolder("R2B1Shut")'\nviews:\n  - type: table\n    name: Shut\n    order:\n      - t\n      - file.name\n    groupBy:\n      property: g\n      direction: ASC\n      order:\n        - shut\n        - open\n`);
    await ws.vault.refreshFiles();
    await ws.open('Shut.base');
  }, shutRows, LONG, longer);
  await wait(() => run((n) => {
    const scope = document.querySelector('.bases-view');
    const labels = [...(scope?.querySelectorAll('.bases-b5-toggle') ?? [])].map(b => b.getAttribute('aria-label'));
    return scope?.querySelector('.bases-count span')?.textContent === `${n + 1} results` && labels[0] === 'shut (1)' && labels[1] === `open (${n})`;
  }, shutRows), 'collapsed-group fixture', 400);
  await click(`.bases-b5-toggle[data-group-id='s:"shut"']`);
  await wait(() => run(() => {
    const shut = document.querySelector(`.bases-b5-toggle[data-group-id='s:"shut"']`);
    const drawn = [...document.querySelectorAll('td[data-property="t"]')].some(td => td.textContent.includes('column-fit'));
    return shut?.getAttribute('aria-expanded') === 'false' && !drawn;
  }), 'collapsed group and the off-screen cell are not drawn');
  const shutBefore = await width('.bases-table th[data-property="t"]');
  check(shutBefore < 120, `grouped column starts at the header (${shutBefore}px)`);
  await double('.bases-table th[data-property="t"] .bases-resizer');
  await wait(() => run((before) => document.querySelector('.bases-table th[data-property="t"]').getBoundingClientRect().width > before + 40, shutBefore), 'expanded off-screen cell widens the column');
  const shutAfter = await width('.bases-table th[data-property="t"]');
  const shutFile = await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Shut.base'); });
  const shutSaved = saved(shutFile);
  check(shutAfter > 700 && shutAfter < 980 && shutSaved > 700 && shutSaved < 980 && Math.abs(shutSaved - shutAfter) < 1.5, `collapsed group is left out of the fit (${shutBefore} -> ${shutAfter}, saved ${shutSaved})`);
  console.log('PASS collapsed groups are left out of the fit');
});
