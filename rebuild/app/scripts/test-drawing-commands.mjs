// X4: the drawing commands with real mouse and key input. New drawing from
// the ribbon, the palette and the file explorer; New drawing and embed it
// here; a rename that rewrites ![[x.excalidraw]] embeds (and saves a waiting
// edit first); Export as SVG and PNG beside the file, with Replace and
// Cancel; Copy as PNG.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const STAMPED = /^(?:(.+)\/)?Drawing \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d(?: \d+)?\.excalidraw$/;
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

await withBrowser(async ({ run, send, press, chord, move, click, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 400; i++) { if (await test()) return; await sleep(20); }
    assert.fail(label);
  };
  const readNote = (path) => run(async (path) => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, path);
  const exists = (path) => run(async (path) => { const { api } = await import('/src/api.ts'); return (await api.listFiles()).some((f) => f.path === path); }, path);
  const bytesOf = (path) => run(async (path) => {
    const { api } = await import('/src/api.ts');
    return [...new Uint8Array(await api.readFileBytes(path))];
  }, path);
  const pngSizeOf = (bytes) => ({
    width: (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0,
    height: (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0,
  });
  const menuItem = (title) => run((title) => {
    const el = [...document.querySelectorAll('.menu .menu-item')].find((e) => e.querySelector('.menu-item-title')?.textContent === title);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const choose = async (title) => {
    const p = await menuItem(title);
    assert.ok(p, `menu item ${title}`);
    await click(p);
    await sleep(100);
  };
  const menuTitles = () => run(() => [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent));
  const treeRow = (path) => run((path) => {
    const r = document.querySelector(`.nav-files [data-path="${CSS.escape(path)}"]`)?.getBoundingClientRect();
    return r ? { x: r.x + 24, y: r.y + r.height / 2 } : null;
  }, path);
  const palette = async (name) => {
    await chord('p');
    await sleep(60);
    await send('Input.insertText', { text: name });
    await sleep(80);
    const title = await run(() => document.querySelector('.suggestion-item.is-selected .suggestion-title')?.textContent ?? '');
    assert.equal(title, name, `palette picks ${name}`);
    await press('Enter');
    await sleep(120);
  };
  const confirmButton = (label) => run((label) => {
    const b = [...document.querySelectorAll('.modal.mod-confirm button')].find((e) => e.textContent === label);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  const notices = () => run(() => [...document.querySelectorAll('.notice')].map((n) => n.textContent));
  const activeDrawing = () => run(() => (ws.active.type === 'drawing' ? ws.active.viewFile : null));
  const editorReady = () => wait(() => run(() => !!document.querySelector('.workspace-tabs.mod-active .drawing-view') && !document.querySelector('.workspace-tabs.mod-active .drawing-toolbar')?.hidden), 'drawing editor ready');

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('Sketches').catch(() => {});
    await api.createNote('Sketches/Host.md', '# Host\n\nBefore\nAfter\n');
    await api.createNote('Elsewhere.md', 'Plain.\n');
    await ws.vault.refreshFiles();
    await ws.open('Elsewhere.md');
  });

  // ----- New drawing: the ribbon -----
  const ribbon = '.side-dock-ribbon-action[aria-label="Create new drawing"]';
  check(await run((s) => !!document.querySelector(s) && !document.querySelector(s).hidden, ribbon), 'The ribbon has Create new drawing');
  await click(ribbon);
  await wait(async () => STAMPED.test(await activeDrawing() ?? ''), 'ribbon drawing opens');
  const fromRibbon = await activeDrawing();
  check(!STAMPED.exec(fromRibbon)[1], `Ribbon drawing is at the vault root, named by the time: ${fromRibbon}`);
  const blank = JSON.parse(await readNote(fromRibbon));
  check(blank.type === 'excalidraw' && blank.version === 2 && blank.elements.length === 0 && blank.appState.viewBackgroundColor === '#ffffff', 'It is an empty Excalidraw file');
  await editorReady();
  check(await run(() => ws.layout.tabs().some((t) => t.path === 'Elsewhere.md')), 'The note it was made from stays in its own tab');
  check(await run((p) => document.querySelector(`.nav-files [data-path="${CSS.escape(p)}"] .tree-item-inner`)?.textContent === p.replace(/\.excalidraw$/, '')
    && document.querySelector(`.nav-files [data-path="${CSS.escape(p)}"] .nav-file-tag`)?.textContent === 'excalidraw', fromRibbon), 'The explorer shows its name without the extension, and an excalidraw tag');

  // ----- New drawing: the palette -----
  await palette('Create new drawing');
  await wait(async () => { const p = await activeDrawing(); return !!p && p !== fromRibbon && STAMPED.test(p); }, 'palette drawing opens');
  const fromPalette = await activeDrawing();
  check(fromPalette !== fromRibbon && await exists(fromRibbon), `The palette makes a second drawing with its own name: ${fromPalette}`);
  check(await run(() => !grove.all().some((c) => c.id === 'drawing:new-file-embed' && c.when?.())), 'Embed it here is not offered while a drawing is active');

  // ----- New drawing: the file explorer, in a folder and at the vault root -----
  await click(await treeRow('Sketches'), 'right');
  await sleep(60);
  check((await menuTitles()).includes('New drawing'), 'The folder menu has New drawing');
  await choose('New drawing');
  await wait(async () => STAMPED.exec(await activeDrawing() ?? '')?.[1] === 'Sketches', 'folder drawing opens');
  const inFolder = await activeDrawing();
  check(STAMPED.exec(inFolder)[1] === 'Sketches', `Explorer New drawing goes in that folder: ${inFolder}`);
  const empty = await run(() => {
    const r = document.querySelector('.nav-files-container').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.bottom - 12 };
  });
  await click(empty, 'right');
  await sleep(60);
  check((await menuTitles()).includes('New drawing'), 'The explorer background menu has New drawing');
  await press('Escape');

  // ----- New drawing and embed it here -----
  await run(async () => {
    await ws.open('Sketches/Host.md');
    ws.setMode('source');
  });
  await sleep(150);
  const lineEnd = await run(() => {
    const doc = ws.view.state.doc;
    const r = ws.view.coordsAtPos(doc.line(3).to);
    return { x: r.left + 40, y: (r.top + r.bottom) / 2 };
  });
  await click(lineEnd);
  check(await run(() => ws.view.state.selection.main.head === ws.view.state.doc.line(3).to), 'Caret at the end of "Before"');
  const groups = await run(() => ws.layout.tabs().length);
  await palette('Create new drawing and embed it here');
  await wait(async () => STAMPED.exec(await activeDrawing() ?? '')?.[1] === 'Sketches' && await activeDrawing() !== inFolder, 'embedded drawing opens');
  const embedded = await activeDrawing();
  const embeddedName = embedded.slice('Sketches/'.length);
  const hostText = await run(() => ws.editors.doc('Sketches/Host.md')?.toString());
  check(hostText === `# Host\n\nBefore\n![[${embeddedName}]]\nAfter\n`, `The embed goes on its own line at the caret: ${JSON.stringify(hostText)}`);
  check(await run((n) => ws.layout.tabs().length === n + 1 && ws.layout.tabs().some((t) => t.path === 'Sketches/Host.md' && ws.groupOf(t) !== ws.activeGroup), groups), 'The drawing opens to the right and the note stays in view');
  await editorReady();

  // Draw a box, so there is something to export, and rename before the save pause ends.
  await run(() => document.querySelector('.workspace-tabs.mod-active .drawing-controls [aria-label="Reset zoom"]').click());
  // An empty spot of the drawing, clear of its toolbar, style panel and zoom buttons, with room for the box.
  const centre = await run(() => {
    const view = document.querySelector('.workspace-tabs.mod-active .drawing-view');
    const r = view.getBoundingClientRect();
    const clear = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && view.contains(el) && !el.closest('.drawing-controls, .drawing-toolbar, .drawing-style, .drawing-help'); };
    for (let y = r.y + r.height / 2; y < r.bottom - 60; y += 20) {
      for (let x = r.right - 100; x > r.x + 100; x -= 20) {
        if ([[0, 0], [-80, -40], [80, 40], [-80, 40], [80, -40]].every(([dx, dy]) => clear(x + dx, y + dy))) return { x, y };
      }
    }
    return null;
  });
  assert.ok(centre, 'room to draw');
  const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', ...extra });
  // R, then a real drag: one box, saved after the editor's short pause.
  const drawBox = async (at) => {
    await click(at);
    await press('Escape');
    await press('r');
    await move({ x: at.x - 80, y: at.y - 40 });
    await mouse('mousePressed', { x: at.x - 80, y: at.y - 40 }, { buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', { x: at.x - 80 + 20 * i, y: at.y - 40 + 10 * i }, { buttons: 1 }); await sleep(16); }
    await mouse('mouseReleased', { x: at.x + 80, y: at.y + 40 }, { buttons: 0, clickCount: 1 });
  };
  await drawBox(centre);
  check(await run(() => document.querySelectorAll('.workspace-tabs.mod-active .drawing-world > svg > [data-id]').length === 1), 'A box is drawn in the new drawing');

  // The note's text gets a sized embed and a Markdown embed of the same drawing too.
  await run((name) => {
    const doc = ws.editors.doc('Sketches/Host.md');
    ws.editors.change('Sketches/Host.md', { changes: { from: doc.length, insert: `![[${name}|400]] and ![sketch](${encodeURI(name)})\n` } });
  }, embeddedName);
  await run(async () => { await ws.saveNow('Sketches/Host.md'); });

  // Rename through the explorer, with the edit still waiting to be saved.
  if (!await treeRow(embedded)) { await click(await treeRow('Sketches')); await sleep(250); }
  await click(await treeRow(embedded), 'right');
  await sleep(60);
  const fileMenu = await menuTitles();
  for (const title of ['Open in new tab', 'Make a copy', 'Export as SVG', 'Export as PNG', 'Copy as PNG', 'Rename...', 'Delete']) check(fileMenu.includes(title), `The drawing's file menu has ${title}`);
  await choose('Rename...');
  check(await run(() => document.activeElement?.isContentEditable && document.activeElement.textContent === document.activeElement.textContent.replace(/\.excalidraw$/, '')), 'Rename edits the name without its extension');
  await send('Input.insertText', { text: 'Floor plan' });
  await press('Enter');
  await sleep(150);
  const update = await confirmButton('Update');
  if (update) { await click(update); await sleep(150); }
  const renamed = 'Sketches/Floor plan.excalidraw';
  await wait(async () => await activeDrawing() === renamed, 'renamed drawing tab follows');
  check(!await exists(embedded) && await exists(renamed), 'The file has its new name and keeps .excalidraw');
  await wait(async () => (await run(() => ws.editors.doc('Sketches/Host.md')?.toString())).includes('Floor plan'), 'embeds rewritten');
  const after = await run(() => ws.editors.doc('Sketches/Host.md').toString());
  check(after === '# Host\n\nBefore\n![[Floor plan.excalidraw]]\nAfter\n![[Floor plan.excalidraw|400]] and ![sketch](Floor%20plan.excalidraw)\n', `Every embed of it is rewritten and keeps its size: ${JSON.stringify(after)}`);
  await sleep(500);
  const kept = JSON.parse(await readNote(renamed));
  check(kept.elements.length === 1 && kept.elements[0].type === 'rectangle', 'The edit waiting at rename time is saved into the renamed file');
  check(!await exists(embedded), 'No late save brings the old name back');

  // ----- Export as SVG (palette), then again: Cancel, then Replace -----
  await run(() => document.querySelector('.workspace-tabs.mod-active .drawing-view').focus());
  await palette('Drawing: Export as SVG');
  const svgPath = 'Sketches/Floor plan.svg';
  await wait(() => exists(svgPath), 'svg written');
  let svg = await readNote(svgPath);
  const boxId = kept.elements[0].id;
  check(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"') && svg.includes(`data-id="${boxId}"`) && svg.includes('fill="#ffffff"'), 'Export as SVG writes a standalone SVG beside the drawing, with its box and paper');
  check(await run(() => ws.vault.files.some((f) => f.path === 'Sketches/Floor plan.svg')), 'The explorer lists the SVG');
  check((await notices()).some((t) => t.includes('Saved “Floor plan.svg”')), 'A notice says where it went');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.writeNote('Sketches/Floor plan.svg', 'old');
  });
  await palette('Drawing: Export as SVG');
  await wait(async () => !!await confirmButton('Replace'), 'replace prompt');
  check(await run(() => document.querySelector('.modal.mod-confirm .modal-title')?.textContent === 'Replace “Floor plan.svg”?'), 'Exporting over a file asks first');
  await click(await confirmButton('Cancel'));
  await sleep(150);
  check(await readNote(svgPath) === 'old', 'Cancel leaves the file there alone');
  await palette('Drawing: Export as SVG');
  await wait(async () => !!await confirmButton('Replace'), 'replace prompt again');
  await click(await confirmButton('Replace'));
  await wait(async () => (await readNote(svgPath)).startsWith('<?xml'), 'svg replaced');
  check((await run(async () => (await (await import('/src/api.ts')).api.listFiles()).filter((f) => f.path.toLowerCase() === 'sketches/floor plan.svg').length)) === 1, 'Replace writes over it: one SVG');

  // ----- Export as PNG (the view's More options), then Replace -----
  await wait(() => run(() => !document.querySelector('.modal-container')), 'confirm dialog gone');
  // Notices sit over the top right of the window, where the button is; a click dismisses one.
  const dismiss = async () => { while (await run(() => !!document.querySelector('.notice'))) { await click('.notice'); await sleep(40); } };
  await dismiss();
  await click('.workspace-tabs.mod-active .view-header [aria-label="More options"]');
  await sleep(80);
  const more = await menuTitles();
  for (const title of ['Export as SVG', 'Export as PNG', 'Copy as PNG', 'Rename...']) check(more.includes(title), `The drawing's More options has ${title}`);
  await choose('Export as PNG');
  const pngPath = 'Sketches/Floor plan.png';
  await wait(() => exists(pngPath), 'png written');
  const png = await bytesOf(pngPath);
  const box = await run(async (path) => {
    const [{ parseScene }, { renderDrawing }, { api }] = await Promise.all([import('/src/drawing/scene.ts'), import('/src/drawing/render.ts'), import('/src/api.ts')]);
    const parsed = parseScene(await api.readNote(path));
    return renderDrawing(parsed.scene, { omitMarkup: true }).viewBox;
  }, renamed);
  const size = pngSizeOf(png);
  check(PNG.every((b, i) => png[i] === b), 'Export as PNG writes PNG bytes beside the drawing');
  check(size.width === Math.round(box.width * 2) && size.height === Math.round(box.height * 2), `The PNG is twice the drawing's size: ${size.width}x${size.height} for ${box.width}x${box.height}`);
  const lit = await run(async (path) => {
    const { api } = await import('/src/api.ts');
    const bitmap = await createImageBitmap(new Blob([await api.readFileBytes(path)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    g.drawImage(bitmap, 0, 0);
    const data = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let ink = 0, paper = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 200) ink++;
      else if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) paper++;
    }
    return { ink, paper, total: data.length / 4 };
  }, pngPath);
  check(lit.ink > 200 && lit.paper > lit.total / 2, `The PNG shows the box's dark outline on white paper (${lit.ink} ink, ${lit.paper} paper of ${lit.total})`);
  await dismiss();
  await click('.workspace-tabs.mod-active .view-header [aria-label="More options"]');
  await sleep(80);
  await choose('Export as PNG');
  await wait(async () => !!await confirmButton('Replace'), 'png replace prompt');
  await click(await confirmButton('Replace'));
  await sleep(300);
  const again = await bytesOf(pngPath);
  check(again.length === png.length && again.every((b, i) => b === png[i]), 'Replacing the PNG writes the same picture again');

  // ----- Copy as PNG (the explorer) -----
  await run(async () => { const { setMockClipboardImage } = await import('/src/mock/backend.ts'); setMockClipboardImage(null); });
  await click(await treeRow(renamed), 'right');
  await sleep(60);
  await choose('Copy as PNG');
  await wait(() => run(async () => !!(await import('/src/mock/backend.ts')).mockCopiedClipboardImage()), 'clipboard written');
  const copied = await run(async () => [...(await import('/src/mock/backend.ts')).mockCopiedClipboardImage()]);
  check(copied.length === png.length && copied.every((b, i) => b === png[i]), 'Copy as PNG puts the same PNG on the clipboard');
  check((await notices()).some((t) => t.includes('Copied as PNG')), 'A notice says it was copied');

  // ----- Make a copy keeps .excalidraw and the bytes -----
  await click(await treeRow(renamed), 'right');
  await sleep(60);
  await choose('Make a copy');
  const copy = 'Sketches/Floor plan 1.excalidraw';
  await wait(async () => await activeDrawing() === copy, 'copy opens');
  check(await readNote(copy) === await readNote(renamed), 'Make a copy numbers the name, keeps .excalidraw and the exact bytes');

  // ----- A rename or a delete inside the save pause writes the edit first -----
  await editorReady();
  await drawBox(centre);
  const waiting = await run(async (from) => {
    const { renameFile } = await import('/src/fileOps.ts');
    const { api } = await import('/src/api.ts');
    const before = JSON.parse(await api.readNote(from)).elements.length;
    await renameFile(ws, from, 'Quick');
    return before;
  }, copy);
  const quick = 'Sketches/Quick.excalidraw';
  check(waiting === 1, 'The second box was still waiting to be saved when the rename started');
  await sleep(600);
  check(JSON.parse(await readNote(quick)).elements.length === 2 && !await exists(copy), 'A rename inside the pause saves the box into the new file, and nothing writes the old one back');
  await wait(async () => await activeDrawing() === quick, 'quick tab follows');
  await editorReady();
  await drawBox(centre);
  await run(async (path) => {
    const { deleteFile } = await import('/src/fileOps.ts');
    await deleteFile(ws, path, { confirmed: true });
  }, quick);
  await sleep(600);
  check(!await exists(quick), 'A delete inside the pause stays deleted');
});
