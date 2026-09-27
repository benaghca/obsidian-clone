/* Cinder inbox board: the Inbox's sticky notes in lanes (📌 Pinned, New, and lanes you name),
 * kept as <inbox folder>/Inbox.canvas in the JSON Canvas format, so Obsidian opens the same board.
 * Lanes are groups and stickies are file cards: a sticky's lane is the group its card's centre is
 * in, ordered top to bottom. Files with no card (anything that arrived since the board was last
 * arranged) show at the top of New. Anything else in the file is kept as it is.
 * No DOM here: reading, changing and writing a board are tested under Node. */
'use strict';

(function (root) {
  const C = typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./canvas.js') : root.CinderCanvas;

  const LAYOUT = { laneWidth: 300, laneGap: 40, cardWidth: 260, cardGap: 20, top: 40, pad: 20, minLane: 200 };
  const PINNED = /^\s*(📌\s*)?pinned\s*$/i, NEW = /^\s*new\s*$/i;
  // A card's height in the file (Obsidian shows it at that size; Cinder sizes stickies itself).
  const heightOf = m => m.kind === 'picture' ? 220 : m.kind === 'file' ? 80 : Math.max(90, Math.min(220, 50 + Math.ceil((m.length || 0) / 30) * 20));
  const metaOf = (meta, p) => meta(p) || {};

  // The board from the board file's text (null or '' if there's none), the inbox's files (without
  // the board file) and meta(path) = { mtime, kind: 'text' | 'picture' | 'file', length }. dir is
  // the inbox folder: cards for files there that have gone are dropped; other cards are kept.
  // A board: { lanes: [{ id, name, kind: 'pinned' | 'new' | 'lane', stickies: [{ path, color, id }] }],
  //            broken (the file didn't parse), extra: { nodes, edges } (the rest of the file) }.
  function readBoard(text, files, meta, dir = '') {
    let data = { nodes: [], edges: [] }, broken = false;
    if (text) { try { data = C.parseCanvas(text); } catch { broken = true; } }
    const inbox = new Set(files);
    const groups = data.nodes.filter(n => n.type === 'group');
    const pinnedG = groups.find(g => PINNED.test(g.label || '')), newG = groups.find(g => g !== pinnedG && NEW.test(g.label || ''));
    const userG = groups.filter(g => g !== pinnedG && g !== newG).sort((a, b) => a.x - b.x || a.y - b.y);
    const lanes = [
      { id: pinnedG?.id || 'pinned', name: 'Pinned', kind: 'pinned', stickies: [] },
      { id: newG?.id || 'new', name: 'New', kind: 'new', stickies: [] },
      ...userG.map(g => ({ id: g.id, name: String(g.label || '').trim() || 'Untitled', kind: 'lane', stickies: [] })),
    ];
    const laneOfGroup = new Map();
    laneOfGroup.set(pinnedG, lanes[0]).set(newG, lanes[1]);
    userG.forEach((g, i) => laneOfGroup.set(g, lanes[i + 2]));
    // Each card goes in the smallest group its centre is in (a card may overhang a lane's edge).
    const placed = [];
    for (const n of data.nodes) {
      if (n.type !== 'file' || !inbox.has(n.file)) continue;
      const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
      let best = null;
      for (const g of groups) {
        if (cx < g.x || cx > g.x + g.width || cy < g.y || cy > g.y + g.height) continue;
        if (!best || g.width * g.height < best.width * best.height) best = g;
      }
      if (best) placed.push({ lane: laneOfGroup.get(best), node: n });
    }
    // In lane order, top to bottom; a file with two cards shows once, where it comes first.
    placed.sort((a, b) => lanes.indexOf(a.lane) - lanes.indexOf(b.lane) || a.node.y - b.node.y || a.node.x - b.node.x);
    const seen = new Set();
    for (const { lane, node } of placed) {
      if (seen.has(node.file)) continue;
      seen.add(node.file);
      lane.stickies.push({ path: node.file, color: node.color || null, id: node.id });
    }
    const fresh = files.filter(p => !seen.has(p)).sort((a, b) => (metaOf(meta, b).mtime || 0) - (metaOf(meta, a).mtime || 0));
    lanes[1].stickies.unshift(...fresh.map(path => ({ path, color: null, id: null })));
    const ours = n => n.type === 'group' || (n.type === 'file' && (inbox.has(n.file) || (dir && String(n.file).startsWith(dir + '/'))));
    return { lanes, broken, extra: { nodes: data.nodes.filter(n => !ours(n)), edges: data.edges } };
  }

  // A new board with one change made (the board passed in is left alone; nothing to do returns it):
  //   { move: path, to: laneId, index }  index among the lane's other stickies (past the end: last)
  //   { pin: path } / { unpin: path }     to the top of Pinned / of New
  //   { color: path, value }             '1'–'6', '#rrggbb' or null
  //   { addLane: name } / { renameLane: id, name } / { moveLane: id, by: ±1 } / { deleteLane: id }
  // Pinned and New are always first and can't be renamed, moved or deleted. A deleted lane's
  // stickies go to the top of New.
  function applyChange(board, ch, newId = C.randomId) {
    const b = { ...board, lanes: board.lanes.map(l => ({ ...l, stickies: l.stickies.map(s => ({ ...s })) })) };
    const find = path => { for (const l of b.lanes) { const i = l.stickies.findIndex(s => s.path === path); if (i >= 0) return { l, i }; } return null; };
    const take = path => { const f = find(path); return f.l.stickies.splice(f.i, 1)[0]; };
    const laneIx = id => b.lanes.findIndex(l => l.id === id);
    const [pinned, fresh] = b.lanes;
    if ('move' in ch) {
      const to = b.lanes[laneIx(ch.to)];
      if (!to || !find(ch.move)) return board;
      const s = take(ch.move);
      to.stickies.splice(Math.max(0, Math.min(ch.index ?? to.stickies.length, to.stickies.length)), 0, s);
    } else if ('pin' in ch || 'unpin' in ch) {
      const p = ch.pin ?? ch.unpin;
      if (!find(p)) return board;
      (ch.pin != null ? pinned : fresh).stickies.unshift(take(p));
    } else if ('color' in ch) {
      const f = find(ch.color);
      if (!f) return board;
      f.l.stickies[f.i].color = ch.value || null;
    } else if ('addLane' in ch) {
      b.lanes.push({ id: newId(), name: String(ch.addLane).trim() || 'Untitled', kind: 'lane', stickies: [] });
    } else if ('renameLane' in ch) {
      const i = laneIx(ch.renameLane), name = String(ch.name || '').trim();
      if (i < 2 || !name) return board;
      b.lanes[i].name = name;
    } else if ('moveLane' in ch) {
      const i = laneIx(ch.moveLane), j = i + ch.by;
      if (i < 2 || j < 2 || j >= b.lanes.length) return board;
      b.lanes.splice(j, 0, b.lanes.splice(i, 1)[0]);
    } else if ('deleteLane' in ch) {
      const i = laneIx(ch.deleteLane);
      if (i < 2) return board;
      fresh.stickies.unshift(...b.lanes.splice(i, 1)[0].stickies);
    } else throw new Error('Unknown board change: ' + JSON.stringify(ch));
    return b;
  }

  // The board as JSON Canvas text: lanes as tidy columns (groups first, so cards draw on top),
  // stickies stacked in them, then everything else the file had.
  function writeBoard(board, meta, newId = C.randomId) {
    const L = LAYOUT, groups = [], cards = [];
    board.lanes.forEach((lane, i) => {
      const x = i * (L.laneWidth + L.laneGap);
      let y = L.top;
      for (const s of lane.stickies) {
        const height = heightOf(metaOf(meta, s.path));
        cards.push({ id: s.id || newId(), type: 'file', file: s.path, x: x + L.pad, y, width: L.cardWidth, height, ...(s.color ? { color: s.color } : {}) });
        y += height + L.cardGap;
      }
      groups.push({ id: lane.id, type: 'group', label: lane.kind === 'pinned' ? '📌 Pinned' : lane.name, x, y: 0, width: L.laneWidth, height: Math.max(L.minLane, y - L.cardGap + L.pad) });
    });
    const ids = new Set([...groups, ...cards].map(n => n.id));
    const nodes = [...groups, ...cards, ...(board.extra?.nodes || []).filter(n => !ids.has(n.id))];
    const all = new Set(nodes.map(n => n.id));
    const edges = (board.extra?.edges || []).filter(e => all.has(e.fromNode) && all.has(e.toNode));
    return C.serializeCanvas({ nodes, edges });
  }

  const laneOf = (board, path) => board.lanes.find(l => l.stickies.some(s => s.path === path)) || null;

  const api = { readBoard, applyChange, writeBoard, laneOf, LAYOUT };
  root.CinderInboxBoard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
