// Tests for the pure parts of ui/canvas.js (JSON Canvas files, geometry, previews).
// Run with plain Node 18+, no packages needed:  node ui/test/canvas.test.js
'use strict';
const assert = require('assert');
const C = require('../canvas.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

// A file as Obsidian writes it (JSON Canvas 1.0), with fields Cinder doesn't use.
const OBSIDIAN = `{
	"nodes":[
		{"id":"g1","type":"group","x":-40,"y":-60,"width":700,"height":400,"label":"Ideas","color":"4"},
		{"id":"a","type":"text","text":"# Hello\\n- [ ] task","x":0,"y":0,"width":250,"height":120,"color":"1"},
		{"id":"b","type":"file","file":"Notes/Plan.md","subpath":"#Goals","x":400,"y":0,"width":250,"height":300},
		{"id":"c","type":"link","url":"https://jsoncanvas.org","x":0,"y":400,"width":300,"height":100,"color":"#ff00aa"}
	],
	"edges":[
		{"id":"e1","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left","label":"leads to"},
		{"id":"e2","fromNode":"b","toNode":"c","fromEnd":"arrow","toEnd":"none","color":"5"},
		{"id":"bad","fromNode":"a","toNode":"missing"}
	],
	"x-custom":{"keep":true}
}`;

t('parses Obsidian canvases and keeps unknown fields', () => {
  const d = C.parseCanvas(OBSIDIAN);
  assert.equal(d.nodes.length, 4);
  assert.deepEqual(d.edges.map(e => e.id), ['e1', 'e2'], 'edges to missing nodes are dropped');
  assert.deepEqual(d['x-custom'], { keep: true });
  const out = JSON.parse(C.serializeCanvas(d));
  assert.equal(out.nodes[2].subpath, '#Goals');
  assert(C.serializeCanvas(d).includes('\n\t"nodes"'), 'tab-indented like Obsidian');
  assert.deepEqual(C.parseCanvas(''), { nodes: [], edges: [] });
  assert.throws(() => C.parseCanvas('[]'));
  assert.throws(() => C.parseCanvas('{nope'));
  const fixed = C.parseCanvas('{"nodes":[{"id":"x","type":"text","x":"bad"},{"type":"text"}]}');
  assert.equal(fixed.nodes.length, 1); assert.equal(fixed.nodes[0].x, 0); assert.equal(fixed.nodes[0].width, 250);
});

t('ids look like Obsidian\'s (16 hex characters)', () => {
  for (let i = 0; i < 50; i++) assert(/^[0-9a-f]{16}$/.test(C.randomId()));
});

t('edge sides', () => {
  const a = { x: 0, y: 0, width: 100, height: 50 }, right = { x: 300, y: 10, width: 100, height: 50 }, below = { x: 10, y: 300, width: 100, height: 50 };
  assert.deepEqual(C.autoSides(a, right), ['right', 'left']);
  assert.deepEqual(C.autoSides(right, a), ['left', 'right']);
  assert.deepEqual(C.autoSides(a, below), ['bottom', 'top']);
  assert.equal(C.sideToward(a, [50, -100]), 'top');
  assert.deepEqual(C.sidePoint(a, 'bottom'), [50, 50]);
  const d = C.parseCanvas(OBSIDIAN), by = new Map(d.nodes.map(x => [x.id, x]));
  const c = C.edgeCurve(d.edges[0], by);
  assert.deepEqual(c.p0, [250, 60]); assert.deepEqual(c.p3, [400, 150]);
  assert(c.c1[0] > c.p0[0] && c.c2[0] < c.p3[0], 'control points leave along the side normals');
});

t('groups contain cards', () => {
  const d = C.parseCanvas(OBSIDIAN), g = d.nodes[0];
  assert(C.inside(d.nodes[1], g) && C.inside(d.nodes[2], g) && !C.inside(d.nodes[3], g) && !C.inside(g, g));
  assert.deepEqual(C.boundsOf(d.nodes), { x1: -40, y1: -60, x2: 660, y2: 500 });
});

t('file references follow renames', () => {
  const d = C.parseCanvas(OBSIDIAN);
  assert.deepEqual(C.fileRefs(d), ['Notes/Plan.md']);
  assert(C.renameRefs(d, new Map([['Notes/Plan.md', 'Archive/Plan 2024.md']])));
  assert.equal(d.nodes[2].file, 'Archive/Plan 2024.md');
  assert(!C.renameRefs(d, new Map([['Other.md', 'X.md']])));
});

t('plain text and wrapping for previews', () => {
  assert.equal(C.plainText('# Title\n**bold** [[Note|alias]] [link](x) ==hi==\n- [ ] todo\n- item'), 'Title\nbold alias link hi\n☐ todo\n• item');
  assert.deepEqual(C.wrapLines('one two three four five', 9, 5), ['one two', 'three', 'four five']);
  assert.deepEqual(C.wrapLines('a\nb\nc\nd', 10, 2), ['a', 'b…']);
});

t('SVG preview', () => {
  const svg = C.toSVG(C.parseCanvas(OBSIDIAN), { noteText: p => p === 'Notes/Plan.md' ? 'Plan <script>' : null, name: p => p.split('/').pop() });
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert(svg.includes('Ideas') && svg.includes('leads to') && svg.includes('Plan &lt;script&gt;') && svg.includes('Plan.md'));
  assert(!/NaN|undefined/.test(svg));
  assert(C.toSVG({ nodes: [], edges: [] }).includes('viewBox'));
});

console.log(`ok ${n} tests`);
