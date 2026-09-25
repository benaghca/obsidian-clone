// Tests for ui/draw-render.js (drawing model, renderer and file formats).
// Run with plain Node 18+, no packages needed:  node ui/test/draw-render.test.js
'use strict';
const assert = require('assert');
const S = require('../draw-render.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

// A scene compressed with lz-string's compressToBase64, as the Obsidian plugin's "compressed-json" stores it.
const COMPRESSED = ['N4IgLgngDgpiBcIYA8DGBDANgSwCYCd0B3EAGhADcZ8BnbAewDsEAmcm+gV31TkQAswYKDXgB6MQHNsYfpwBGAOlT0AtmIBeNCtlQbs6RmPry6uA4wC0KDDg', 'LFLUTJ2nNyMTDFUxGYGggBtUDwEEHR5VABGFgBmABYAVjJwaD5wFDBk5AQABnIIXPIiPFkEBLyQfhhsSUFWBPIwDNCAeUxcAAIm5Ezyenwa7EYsABVmxDbO7', 't6QADMmMABlbA0+Fgr53wAxdFVsTAL4SIBfUmDcUOxVSRzbnMjkyFhL1XRJOHJs+ArDuIri3CleDlchVGp1eAsBpzfYwACSF0QswexwAuuR0FAoIswOgmghQ', 'DoYEQAELoVAAa0k+C4jFwAGF6Jh+qEAMSzDnJRj0fGIAA/jAA96gAB+4ACXHUAyOQdQC8G4AAPZApxhnn88GAx2OQA=='];

t('theme', () => {
  assert.equal(S.themeColor('#ffffff', true), '#121212');
  assert.equal(S.themeColor('#1e1e1e', true), '#d3d3d3');
  assert.equal(S.themeColor('#1e1e1e', false), '#1e1e1e');
  assert.equal(S.themeColor('transparent', true), 'transparent');
});

t('shapes build for every type & roughness', () => {
  for (const type of ['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'frame', 'text', 'image']) {
    for (const roughness of [0, 1, 2]) for (const fillStyle of ['solid', 'hachure', 'cross-hatch']) for (const strokeStyle of ['solid', 'dashed']) {
      const el = S.newElement(type, { x: 10, y: 20, width: 120, height: 80, roughness, fillStyle, strokeStyle, backgroundColor: '#a5d8ff', roundness: { type: 3 } });
      if (S.hasPoints(el)) { el.points = [[0, 0], [60, 40], [120, 10], [30, 80]]; S.syncPointsSize(el); el.startArrowhead = 'dot'; }
      const items = S.shapeOf(el);
      for (const it of items) { assert(typeof it.d === 'string'); assert(!/NaN|undefined|Infinity/.test(it.d), type + ' ' + it.d.slice(0, 80)); }
      if (['rectangle', 'diamond', 'ellipse'].includes(type)) assert(items.length >= 2, type);
    }
  }
  for (const ah of ['arrow', 'triangle', 'bar', 'dot', 'circle', 'circle_outline', 'diamond', 'diamond_outline', 'triangle_outline'])
    for (const pts of [[[0, 0], [100, 0]], [[0, 0], [50, 50], [100, 0]], [[0, 0], [0.1, 0]]]) {
      const el = S.newElement('arrow', { points: pts, endArrowhead: ah, startArrowhead: ah, roundness: { type: 2 } }); S.syncPointsSize(el);
      for (const it of S.shapeOf(el)) assert(!/NaN|Infinity/.test(it.d), ah);
    }
  const fd = S.newElement('freedraw', { points: [[0, 0]] });
  assert(!/NaN/.test(S.shapeOf(fd)[0].d));
});

t('deterministic by seed', () => {
  const a = S.newElement('rectangle', { width: 100, height: 50, seed: 42 });
  const b = S.newElement('rectangle', { width: 100, height: 50, seed: 42 });
  assert.equal(S.buildShape(a)[0].d, S.buildShape(b)[0].d);
});

t('hit test', () => {
  const r = S.newElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  assert(S.hitTest(r, 0, 50, 5)); assert(!S.hitTest(r, 50, 50, 5)); assert(S.hitTest(r, 50, 50, 5, { inside: true }));
  r.backgroundColor = '#ffc9c9'; assert(S.hitTest(r, 50, 50, 5));
  r.angle = Math.PI / 4; r.backgroundColor = 'transparent';
  assert(!S.hitTest(r, 0, 0, 3)); // corner rotated away
  const e = S.newElement('ellipse', { x: 0, y: 0, width: 200, height: 100 });
  assert(S.hitTest(e, 100, 0, 3)); assert(S.hitTest(e, 0, 50, 3)); assert(!S.hitTest(e, 100, 50, 3));
  const l = S.newElement('line', { x: 10, y: 10, points: [[0, 0], [100, 0]] });
  assert(S.hitTest(l, 60, 12, 5)); assert(!S.hitTest(l, 60, 30, 5));
});

t('outline point', () => {
  const r = S.newElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  const p = S.outlinePoint(r, [-100, 50], 4);
  assert(Math.abs(p[0] + 4) < 1e-6 && Math.abs(p[1] - 50) < 1e-6, p);
  assert.equal(S.outlinePoint(r, [50, 60], 4), null);
  const e = S.newElement('ellipse', { x: 0, y: 0, width: 100, height: 100 });
  const q = S.outlinePoint(e, [50, -100], 0);
  assert(Math.abs(q[0] - 50) < 1e-6 && Math.abs(q[1]) < 1e-6, q);
  const d = S.newElement('diamond', { x: 0, y: 0, width: 100, height: 100 });
  const z = S.outlinePoint(d, [200, 50], 0);
  assert(Math.abs(z[0] - 100) < 1e-6 && Math.abs(z[1] - 50) < 1e-6, z);
  r.angle = Math.PI / 2; // rotated square: still hits the side
  const w = S.outlinePoint(r, [-100, 50], 0);
  assert(Math.abs(w[0]) < 1e-6 && Math.abs(w[1] - 50) < 1e-6, w);
});

t('text wrap & layout', () => {
  const font = '20px Virgil';
  const wrapped = S.wrapText('the quick brown fox jumps over the lazy dog', font, 100);
  for (const line of wrapped.split('\n')) assert(S.textWidth(line, font) <= 100 || !line.includes(' '), line);
  assert.equal(S.wrapText('supercalifragilistic', font, 50).replace(/\n/g, ''), 'supercalifragilistic');
  const box = S.newElement('rectangle', { x: 0, y: 0, width: 100, height: 40 });
  const tx = S.newElement('text', { containerId: box.id, originalText: 'hello world this is long text that wraps', text: '', textAlign: 'center', verticalAlign: 'middle' });
  S.layoutBoundText(tx, box);
  assert(box.height >= tx.height + 10 - 1e-6, 'container grew');
  assert(Math.abs(tx.x + tx.width / 2 - 50) < 1e-6);
  assert(Math.abs(tx.y + tx.height / 2 - (box.y + box.height / 2)) < 1e-6);
});

t('bounds of rotated', () => {
  const r = S.newElement('rectangle', { x: 0, y: 0, width: 100, height: 100, angle: Math.PI / 4 });
  const b = S.bounds(r);
  assert(Math.abs(b[0] - (50 - 70.71)) < 0.01 && Math.abs(b[2] - (50 + 70.71)) < 0.01);
  const a = S.newElement('arrow', { x: 5, y: 5, points: [[0, 0], [10, 20]] });
  const ap = S.absPoints(a); assert.deepEqual(ap, [[5, 5], [15, 25]]);
  S.setAbsPoints(a, [[1, 2], [3, 4], [10, 0]]);
  assert.deepEqual(a.points, [[0, 0], [2, 2], [9, -2]]); assert.equal(a.width, 9); assert.equal(a.height, 4);
});

t('json round trip', () => {
  const scene = S.emptyScene();
  scene.elements.push(S.newElement('rectangle', { width: 10, height: 10 }));
  scene.rest.custom = 1; scene.appState.gridSize = 20; scene.appState.foo = 'bar';
  const txt = S.serializeDrawing(scene, { format: 'json' });
  const back = S.parseDrawing(txt, 'x.excalidraw');
  assert.equal(back.scene.elements.length, 1); assert.equal(back.scene.rest.custom, 1); assert.equal(back.scene.appState.foo, 'bar');
  assert.equal(JSON.parse(txt).type, 'excalidraw');
  assert.equal(S.parseDrawing('', 'x.excalidraw').scene.elements.length, 0);
  assert.throws(() => S.parseDrawing('{"a":1}', 'x.excalidraw'));
  // deleted elements dropped
  assert.equal(S.parseDrawing(JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', isDeleted: true }] }), 'a.excalidraw').scene.elements.length, 0);
});

t('lz-string decompress', () => {
  const json = S.lzDecompressFromBase64(COMPRESSED.join(''));
  const d = JSON.parse(json);
  assert.equal(d.elements.length, 2); assert.equal(d.appState.note, 'ünïcødé ✓ 😀');
  assert.equal(S.lzDecompressFromBase64(''), null);
});

const PLUGIN_MD = (block, extra = '') => `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data...


# Excalidraw Data

## Text Elements
Old text ^abc12345

${extra}%%
## Drawing
${block}
%%`;

t('md compressed parse + serialize', () => {
  const comp = COMPRESSED.join('\n\n'); // the plugin wraps the base64 over several lines
  const md = PLUGIN_MD('```compressed-json\n' + comp + '\n```', '## Embedded Files\nf1: [[pic.png]]\n\n');
  const p = S.parseDrawing(md, 'Drawing.excalidraw.md');
  assert.equal(p.format, 'md'); assert.equal(p.scene.elements.length, 2); assert.deepEqual(p.embedded, { f1: 'pic.png' });
  p.scene.elements[0].originalText = 'New text [[Some Note]]';
  const out = S.serializeDrawing(p.scene, { format: 'md', source: md, embedded: { ...p.embedded, f2: 'other.png' } });
  assert(out.startsWith('---\n\nexcalidraw-plugin: parsed'));
  assert(out.includes('## Text Elements\nNew text [[Some Note]] ^abc12345\n\n## Embedded Files'), out.slice(0, 600));
  assert(!out.includes('Old text ^abc'));
  assert(out.includes('## Embedded Files\nf1: [[pic.png]]\n\nf2: [[other.png]]\n\n%%'), out);
  assert(out.includes('## Drawing\n```json\n{'));
  const again = S.parseDrawing(out, 'Drawing.excalidraw.md');
  assert.equal(again.scene.elements[0].originalText, 'New text [[Some Note]]');
  assert.deepEqual(again.embedded, { f1: 'pic.png', f2: 'other.png' });
  // idempotent
  assert.equal(S.serializeDrawing(again.scene, { format: 'md', source: out, embedded: again.embedded }), out);
});

t('md new + without embedded section', () => {
  const sc = S.emptyScene(); sc.elements.push(S.newElement('text', { text: 'hi', originalText: 'hi', id: 'T1' }));
  const out = S.serializeDrawing(sc, { format: 'md', source: '', embedded: { F: 'a b.png' } });
  const p = S.parseDrawing(out, 'x.excalidraw.md');
  assert.equal(p.scene.elements.length, 1); assert.deepEqual(p.embedded, { F: 'a b.png' });
  assert(/## Text Elements\nhi \^T1\n\n## Embedded Files\nF: \[\[a b.png\]\]\n\n%%\n## Drawing\n```json/.test(out), out);
  // md with no drawing block at all -> empty scene
  assert.equal(S.parseDrawing('---\nexcalidraw-plugin: parsed\n---\n', 'y.excalidraw.md').scene.elements.length, 0);
  // legacy v1 layout "# Drawing" with json fence
  const legacy = '# Text Elements\nhey ^q\n\n%%\n# Drawing\n```json\n' + JSON.stringify({ type: 'excalidraw', elements: [{ id: 'q', type: 'text', text: 'hey' }] }) + '\n```\n%%';
  const lp = S.parseDrawing(legacy, 'z.excalidraw.md');
  assert.equal(lp.scene.elements[0].text, 'hey');
  lp.scene.elements[0].originalText = 'yo';
  const lo = S.serializeDrawing(lp.scene, { format: 'md', source: legacy });
  assert(lo.startsWith('# Text Elements\nyo ^q\n\n%%\n# Drawing\n```json\n'), lo);
});

t('ids are 8 alphanumerics (plugin block refs)', () => {
  for (let i = 0; i < 200; i++) assert(/^[A-Za-z0-9]{8}$/.test(S.randomId()));
});

t('md output passes the Obsidian plugin\'s own parsing regexes', () => {
  // Copied from obsidian-excalidraw-plugin src/shared/excalidrawMarkdownParsing.ts and ExcalidrawData.ts
  const DRAWING_REG = /\n##? Drawing\n[^`]*(```json\n)([\s\S]*?)```\n/gm;
  const TEXT_REF = /\s\^(.{8})[\n]+/g;
  const RE_ELEMENT_LINKS = /^(.{8}):\s*(.*)$/gm;
  const sc = S.emptyScene();
  const t1 = S.newElement('text', { text: 'Hello [[Note]]', originalText: 'Hello [[Note]]' });
  const t2 = S.newElement('text', { text: 'two\nlines', originalText: 'two\nlines' });
  const r = S.newElement('rectangle', { width: 10, height: 10, link: '[[Other]]' });
  sc.elements.push(t1, t2, r);
  const md = S.serializeDrawing(sc, { format: 'md', source: '' });
  const m = [...md.matchAll(DRAWING_REG)];
  assert.equal(m.length, 1); assert.equal(JSON.parse(m[0][2]).elements.length, 3);
  const text = md.slice(md.indexOf('## Text Elements\n') + 18);
  const ids = [...text.matchAll(TEXT_REF)].map(x => x[1]);
  assert.deepEqual(ids.slice(0, 2), [t1.id, t2.id]);
  const links = [...md.slice(md.indexOf('## Element Links\n'), md.indexOf('## Drawing')).matchAll(RE_ELEMENT_LINKS)].map(x => [x[1], x[2]]);
  assert.deepEqual(links, [[r.id, '[[Other]]']]);
  // links edited in the note win on load; editing in Cinder rewrites the section
  const edited = md.replace(`${r.id}: [[Other]]`, `${r.id}: [[Renamed]]`);
  const p = S.parseDrawing(edited, 'x.excalidraw.md');
  assert.equal(p.scene.elements.find(e => e.id === r.id).link, '[[Renamed]]');
  p.scene.elements.find(e => e.id === r.id).link = 'https://example.com';
  const again = S.serializeDrawing(p.scene, { format: 'md', source: edited });
  assert(again.includes(`## Element Links\n${r.id}: https://example.com\n\n%%`), again);
});

t('legacy excalidraw fields are upgraded', () => {
  const d = { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, strokeSharpness: 'round', boundElementIds: ['z'] }, { id: 'b', type: 'draw', points: [[0, 0], [1, 1]] }] };
  const p = S.parseDrawing(JSON.stringify(d), 'x.excalidraw');
  assert.deepEqual(p.scene.elements[0].roundness, { type: 3 }); assert.deepEqual(p.scene.elements[0].boundElements, [{ id: 'z', type: 'arrow' }]);
  assert.equal(p.scene.elements[1].type, 'line');
});

t('svg export', () => {
  const els = [S.newElement('rectangle', { x: 0, y: 0, width: 100, height: 50, backgroundColor: '#ffc9c9', fillStyle: 'hachure' }),
    S.newElement('text', { x: 10, y: 10, text: 'a <b> & "c"', width: 50, height: 25 }),
    S.newElement('image', { x: 0, y: 60, width: 20, height: 20, fileId: 'f', scale: [-1, 1] })];
  const svg = S.toSVG(els, { background: '#ffffff', dark: true, fontData: 'AAAA', fileData: () => 'data:image/png;base64,xx' });
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert(svg.includes('a &lt;b&gt; &amp; &quot;c&quot;')); assert(svg.includes('@font-face')); assert(svg.includes('#121212'));
  assert(!/NaN/.test(svg));
  assert(S.toSVG([], {}).includes('viewBox'));
});
console.log(`ok ${n} tests`);
