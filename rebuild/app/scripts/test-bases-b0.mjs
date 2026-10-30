// B0 scheduling/5,000-row regression checks in the scratch browser mock.
// Native pointer/key input edits notes. A retained view fixture exercises hiding
// independently of today's pane host, which disposes a Base when switching tabs.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
const record = process.env.GROVE_B0_RECORD === '1';
await withBrowser(async ({ run, send, click, press, check }) => {
  const metrics = {};
  const verify = (value, label) => { if (record) console.log('RECORD', label, !!value); else check(value, label); };
  const wait = async (test, label) => { for (let i = 0; i < 150; i++) { if (await test()) return; await sleep(20); } assert.fail(label); };
  await run(async () => {
    const { api } = await import('/src/api.ts');
    for (let i = 0; i < 5000; i++) await api.createNote(`B0Perf/${String(i).padStart(4, '0')}.md`, `---\npriority: ${i % 5}\nstatus: open\n---\n# Note ${i} #work\n`);
    await api.createNote('B0Other.md', '# Outside\n');
    window.b0Source = 'filters: \'file.inFolder("B0Perf") && file.hasTag("work") && status != "done"\'\nformulas:\n  label: \'if(priority >= 3, "high", "low")\'\nviews:\n  - name: Performance\n    order: [file.name, formula.label]\n    sort:\n      - property: priority\n        direction: DESC\n      - property: file.name\n        direction: ASC\n';
    await api.createNote('B0Perf.base', b0Source);
    await ws.vault.refreshFiles(); await ws.vault.refreshLinks();
    await ws.open('B0Perf/0000.md'); ws.setMode('source');
    window.b0ActorGroup = ws.activeGroup;
    const { propertyIndex } = await import('/src/shell/propertyIndex.ts');
    const index = propertyIndex(ws), notes = index.notes;
    window.b0Meter = { calls: 0 };
    index.notes = (...args) => { if (new Error().stack.includes('/src/bases/view.ts')) b0Meter.calls++; return notes(...args); };
  });
  const openBase = () => run(async () => {
    const begin = performance.now();
    // Observe the completed DOM update rather than adding up to one frame of
    // polling delay to these short before/after performance measurements.
    const ready = new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.bases-count')?.textContent !== '5000 results') return;
        observer.disconnect(); clearTimeout(timeout); resolve(performance.now() - begin);
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(Error('5,000-row Base did not render')); }, 5000);
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await ws.open('B0Perf.base', window.b0BaseGroup ? { group: b0BaseGroup } : { where: 'right' });
    window.b0BaseGroup = ws.activeGroup;
    return ready;
  });
  metrics.coldMs = await openBase();
  metrics.warmMs = [];
  for (let i = 0; i < 3; i++) {
    await run(() => ws.open('B0Other.md', { group: b0BaseGroup }));
    metrics.warmMs.push(await openBase());
  }
  verify(Math.max(...metrics.warmMs) <= 150, '5,000-row warm opens stay within 150ms');
  await sleep(1400);
  await run(async () => {
    const { api } = await import('/src/api.ts');
    window.b0Write = api.writeNote; window.b0Held = []; window.b0Hold = true;
    window.b0Actor = 'B0Perf/0000.md';
    api.writeNote = (path, text) => b0Hold && path === b0Actor ? new Promise((resolve, reject) => b0Held.push({ path, text, resolve, reject })) : b0Write(path, text);
  });
  const content = '.cm-content .cm-line';
  const bodyPoint = await run(() => {
    const line = [...ws.editors.viewOf(b0ActorGroup).dom.querySelectorAll('.cm-line')].find(el => el.textContent.startsWith('# Note 0'));
    const r = line.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 };
  });
  await click(bodyPoint); await press('End'); await sleep(100);
  const before = await run(() => b0Meter.calls);
  await run(() => { window.b0Frames = []; let last = performance.now(); window.b0Frame = requestAnimationFrame(function tick(t) { b0Frames.push(t - last); last = t; b0Frame = requestAnimationFrame(tick); }); });
  for (let i = 0; i < 5; i++) { await send('Input.insertText', { text: 'x' }); await sleep(100); }
  await sleep(100);
  metrics.duringBurst = await run(() => b0Meter.calls) - before;
  metrics.typingFrameMs = await run(() => { cancelAnimationFrame(b0Frame); return Math.max(...b0Frames.slice(2)); });
  verify(metrics.duringBurst === 0, '100ms typing pauses do not rebuild a 5,000-row Base');
  verify(metrics.typingFrameMs < 20, 'typing frames stay below 20ms');
  await sleep(250);
  metrics.afterQuiet = await run(() => b0Meter.calls) - before;
  verify(metrics.afterQuiet === 1, 'one rebuild follows the 300ms quiet period');
  // Change a filter property while holding saves: the table must use editor text.
  const statusPoint = await run(() => {
    const line = [...ws.editors.viewOf(b0ActorGroup).dom.querySelectorAll('.cm-line')].find(el => el.textContent === 'status: open');
    const r = line.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 };
  });
  await click(statusPoint); await press('Home'); await press('End', 1); await send('Input.insertText', { text: 'status: done' });
  await wait(() => run(() => document.querySelector('.bases-count')?.textContent === '4999 results'), 'unsaved property reaches Base');
  verify(await run(async () => { const { api } = await import('/src/api.ts'); return (await api.readNote(b0Actor)).includes('status: open'); }), 'Base includes edits while the note is still unsaved');
  await run(async () => {
    window.b0Hold = false;
    for (const entry of b0Held.splice(0)) { try { await b0Write(entry.path, entry.text); entry.resolve(); } catch (e) { entry.reject(e); } }
  });
  await sleep(1400);
  await run(async () => { await ws.open('B0Other.md', { group: b0ActorGroup }); window.b0Actor = 'B0Other.md'; window.b0Hold = true; });
  await click(content); await press('End'); await sleep(100);
  const outsideBefore = await run(() => b0Meter.calls);
  await send('Input.insertText', { text: ' outside' }); await sleep(400);
  metrics.outsideDoc = await run(() => b0Meter.calls) - outsideBefore;
  verify(metrics.outsideDoc === 0, 'an outside-folder edit is skipped');
  await run(() => ws.vault.written('B0Other.md')); await sleep(80);
  metrics.outsideSave = await run(() => b0Meter.calls) - outsideBefore;
  verify(metrics.outsideSave === 0, 'an outside-folder save cannot bypass the skip');
  for (const method of ['refreshFiles', 'refreshLinks']) {
    const count = await run(() => b0Meter.calls);
    await run(method => ws.vault[method](), method);
    await wait(async () => await run(() => b0Meter.calls) > count, `${method} refresh`);
  }
  await run(async () => {
    const { api } = await import('/src/api.ts');
    b0Hold = false;
    for (const entry of b0Held.splice(0)) { await b0Write(entry.path, entry.text); entry.resolve(); }
    api.writeNote = b0Write;
    // Dispose the regular Base before checking a retained, hidden view instance.
    await ws.open('B0Other.md', { group: b0BaseGroup });
    const { createBaseView } = await import('/src/bases/view.ts');
    const { propertyIndex } = await import('/src/shell/propertyIndex.ts');
    const listeners = new Set(), fixture = Object.create(ws);
    fixture.on = fn => { listeners.add(fn); return () => listeners.delete(fn); };
    const tab = { ...b0BaseGroup.active }, group = { ...b0BaseGroup, active: tab };
    const index = propertyIndex(fixture), notes = index.notes;
    window.b0HiddenCalls = 0;
    index.notes = (...args) => { b0HiddenCalls++; return notes(...args); };
    const view = createBaseView(fixture, 'B0Perf.base', group);
    Object.assign(view.el.style, { position: 'fixed', left: '-10000px', width: '800px', height: '600px' });
    document.body.append(view.el);
    window.b0Fixture = { view, group, tab, fire: change => { for (const fn of listeners) fn(change); } };
  });
  await wait(() => run(() => b0Fixture.view.el.querySelector('.bases-count')?.textContent === '4999 results'), 'retained Base rendered');
  await sleep(150);
  const hiddenBefore = await run(() => b0HiddenCalls);
  await run(() => { b0Fixture.fire('doc'); b0Fixture.group.active = { ...b0Fixture.tab }; b0Fixture.fire('tabs'); });
  await sleep(400);
  metrics.hiddenPending = await run(() => b0HiddenCalls) - hiddenBefore;
  verify(metrics.hiddenPending === 0, 'hiding cancels a pending doc rebuild without another keystroke');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.writeNote('B0Perf.base', b0Source.replace('name: Performance', 'name: Refreshed'));
    ws.vault.written('B0Perf.base');
  });
  await sleep(100);
  metrics.hiddenSave = await run(() => b0HiddenCalls) - hiddenBefore;
  verify(metrics.hiddenSave === 0, 'a hidden Base defers its own file modification');
  const revealBefore = await run(() => b0HiddenCalls);
  await run(() => { b0Fixture.group.active = b0Fixture.tab; b0Fixture.fire('show'); });
  await sleep(150);
  metrics.revealUpdates = await run(() => b0HiddenCalls) - revealBefore;
  verify(metrics.revealUpdates === 1 && await run(() => b0Fixture.view.el.textContent.includes('Refreshed')), 'showing a deferred Base reloads current source once');
  await run(() => { b0Fixture.view.dispose(); b0Fixture.view.el.remove(); });
  console.log('B0_METRICS', JSON.stringify(metrics));
});
