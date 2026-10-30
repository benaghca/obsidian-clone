#!/usr/bin/env node
// Builds the static Kanban and Manual-group-order mockups (HTML + PNG) in this
// folder, the same way bases-mockups/build.mjs does: icons are Lucide's path
// data from the app's own `lucide` dependency, written into each page, so the
// pages are plain HTML/CSS with no scripts and no external assets. PNGs come
// from headless Chromium's --screenshot (no window).
//
//   node rebuild/kanban-mockups/build.mjs        (from the repo root)

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '../app');
const lucide = createRequire(join(app, 'package.json'))('lucide');
const { findBrowser } = await import(join(app, 'scripts/browser.mjs'));

const pascal = name => name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
const icon = (name, small = false) => {
  const node = lucide[pascal(name)];
  if (!node) throw new Error(`no icon ${name}`);
  const parts = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="i${small ? ' s' : ''}" viewBox="0 0 24 24">${parts}</svg>`;
};

// Made-up tasks: what a 'Tasks' folder of notes with status/due/priority/tags looks like.
const titles = ['Draft launch post', 'Fix sync conflict', 'Canvas alignment guides', 'Book dentist', 'Bases table summaries', 'Renew passport',
  'Read “Designing Data-Intensive Apps”', 'Quarterly review notes', 'Clean up attachments folder', 'Plan holiday trip', 'Ship search in Rust',
  'Kanban drag benchmark', 'Write property-edit corpus', 'Water the plants', 'Tax documents', 'Graph view colours', 'Reply to Sam',
  'Backup vault to disk', 'Split pane polish', 'Update THIRD_PARTY_NOTICES', 'Order new keyboard', 'Release notes 0.9', 'Fix CRLF frontmatter', 'Sketch onboarding'];
const statuses = ['todo', 'doing', 'review', 'done'];
const tagsets = [['work'], ['work', 'writing'], ['home'], ['work', 'bases'], ['reading'], ['home', 'travel'], ['vault']];
const tasks = titles.map((name, i) => ({ name, status: i === 23 ? null : statuses[(i * 7 + 1) % 4], priority: 1 + (i * 3) % 5, due: `2026-11-${String(1 + (i * 5) % 28).padStart(2, '0')}`, tags: tagsets[i % tagsets.length] }));
const by = s => tasks.filter(t => t.status === s);
const fmtDate = d => new Date(`${d}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
// Counts shown for a large base: the board is virtualised, so a column of 1,284 cards draws only what is visible.
const big = { todo: 1284, doing: 37, review: 112, done: 8410, null: 157 };
const label = s => s ?? 'No value';

const frame = (body, caption, title = 'Tasks') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="mockups.css"><link rel="stylesheet" href="kanban.css"></head><body>
<div class="app">
  <div class="ribbon">${icon('files')}${icon('search')}${icon('layers')}${icon('layout-grid')}</div>
  <div class="sidebar">
    <div class="row folder">${icon('chevron-down', true)} Projects</div>
    <div class="row indent">${icon('file-text', true)} Grove roadmap</div>
    <div class="row folder">${icon('chevron-down', true)} Tasks</div>
    <div class="row indent">${icon('file-text', true)} Draft launch post</div>
    <div class="row indent">${icon('file-text', true)} Fix sync conflict</div>
    <div class="row indent">${icon('file-text', true)} Book dentist</div>
    <div class="row active">${icon('table', true)} Tasks.base</div>
    <div class="row">${icon('file-text', true)} Welcome</div>
  </div>
  <div class="main">
    <div class="tabs"><div class="tab active">${icon('table', true)} Tasks <span class="spacer"></span>${icon('x', true)}</div><div class="tab">${icon('file-text', true)} Welcome</div></div>
    <div class="view">${body}<div class="caption">${caption}</div></div>
  </div>
</div></body></html>`;

// Obsidian's toolbar order (Grove's today, plus the Group button the Manual menu lives in).
const toolbar = ({ view = 'Board', glyph = 'square-kanban', results = '10,000 results', group = 'status', extra = '' } = {}) => `
    <div class="toolbar">
      <span class="btn strong">${icon(glyph, true)} ${view} ${icon('chevrons-up-down', true)}</span>
      <span class="btn">${icon('text-align-start', true)} ${results}</span>
      <span class="spacer"></span>${extra}
      <span class="btn on">${icon('arrow-up-narrow-wide', true)} Sort <span class="badge">1</span></span>
      <span class="btn${group ? ' on' : ''}">${icon('group', true)} Group${group ? ` <span style="color:var(--text-muted)">· ${group}</span>` : ''}</span>
      <span class="btn on">${icon('list-filter', true)} Filter <span class="badge">1</span></span>
      <span class="btn">${icon('list', true)} Properties</span>
      <span class="btn">${icon('search', true)}</span>
      <span class="btn primary">${icon('plus', true)} New</span>
    </div>`;

const card = (t, cls = '') => `<div class="kcard ${cls}"><div class="t">${t.name}</div>
  <div class="kv"><span class="k">due</span>${icon('calendar', true)} ${fmtDate(t.due)}<span class="pri">P${t.priority}</span></div>
  <div class="kv"><span class="k">tags</span>${t.tags.map(x => `<span class="pill">${x}</span>`).join('')}</div></div>`;
const colHead = (s, n, tools = true) => `<div class="col-head">${label(s)} <span class="n">${n.toLocaleString('en-US')}</span>${tools ? `<span class="tools"><span>${icon('plus', true)}</span><span>${icon('ellipsis', true)}</span></span>` : ''}</div>`;
const column = (s, cards, n, { bar, cls = '', foot = true, extra = '' } = {}) => `<div class="col ${cls}">${colHead(s, n)}${extra}<div class="col-body">${cards}${bar ? `<div class="vbar" style="top:${bar[0]}px;height:${bar[1]}px"></div>` : ''}</div>${foot ? `<div class="col-foot">${icon('plus', true)} New note</div>` : ''}</div>`;
const fill = (s, count) => { const list = by(s); return Array.from({ length: count }, (_, i) => list[i % list.length]); };

const pages = {
  'kanban-a': frame(`${toolbar()}
    <div class="board">
      ${column('todo', fill('todo', 6).map((t, i) => card(t, i === 1 ? 'focus' : '')).join(''), big.todo, { bar: [4, 28] })}
      ${column('doing', fill('doing', 5).map(t => card(t)).join(''), big.doing, { bar: [4, 300] })}
      ${column('review', fill('review', 6).map(t => card(t)).join(''), big.review, { bar: [40, 120] })}
      ${column(null, card(tasks[23]) + '<div class="empty-col">Drop here to clear status</div>', big.null)}
    </div>`, 'Option A · Board: one scroller per column, columns side by side, horizontal scroll; virtualised both ways'),

  'kanban-b': frame(`${toolbar()}
    <div class="lanes-head" style="grid-template-columns:repeat(4,minmax(0,1fr))">${['todo', 'doing', 'review', 'done'].map(s => `<div>${s} <span class="n">${big[s].toLocaleString('en-US')}</span></div>`).join('')}</div>
    <div class="lanes" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${['todo', 'doing', 'review', 'done'].map(s => `<div class="lane">${fill(s, s === 'doing' ? 3 : 7).map(t => `<div class="kcard"><div class="t">${t.name}</div><div class="kv"><span class="k">due</span>${fmtDate(t.due)}<span class="pri">P${t.priority}</span></div><div class="kv">${t.tags.map(x => `<span class="pill">${x}</span>`).join('')}</div></div>`).join('')}</div>`).join('')}
      <div class="sharedbar"></div>
    </div>`, 'Option B · Lanes: one shared vertical scroll with sticky column headers; columns fill the width'),

  'kanban-c': frame(`${toolbar()}
    <div class="board compact">
      ${['todo', 'doing', 'review'].map(s => `<div class="col">${colHead(s, big[s])}<div class="col-body">${fill(s, 17).map(t => `<div class="crow"><span class="tt">${t.name}</span><span class="d">${fmtDate(t.due)}</span><span class="p">${t.priority}</span></div>`).join('')}<div class="vbar" style="top:4px;height:${s === 'doing' ? 420 : 30}px"></div></div></div>`).join('')}
      <div class="strip">${icon('chevron-right', true)}<span class="v">done</span><span class="n">8,410</span></div>
      <div class="strip">${icon('chevron-right', true)}<span class="v">No value</span><span class="n">157</span></div>
      <div class="col">${colHead('blocked', 0)}<div class="col-body"><div class="empty-col">Empty group (added in Manual)</div></div></div>
    </div>`, 'Option C · Compact: one-line cards (30 px), big columns collapse to strips; most cards on screen'),

  'kanban-drag': frame(`${toolbar()}
    <div class="board" style="position:relative">
      ${column('todo', fill('todo', 6).map((t, i) => card(t, i === 2 ? 'placeholder' : '')).join(''), big.todo, { bar: [4, 28] })}
      ${column('doing', fill('doing', 2).map(t => card(t)).join('') + '<div class="drop-line"></div>' + fill('doing', 5).slice(2).map(t => card(t)).join(''), big.doing, { cls: 'target', extra: `<div class="drop-hint">${icon('arrow-right', true)} Drop to set <b>status</b> to <b>doing</b></div>` })}
      ${column('review', fill('review', 6).map(t => card(t)).join(''), big.review)}
      ${column(null, card(tasks[23]), big.null)}
      <div class="kcard ghost" style="left:318px;top:212px">${card(fill('todo', 6)[2]).replace(/^<div class="kcard ">|<\/div>$/g, '')}</div>
    </div>
    <div class="toast"><span class="when">after drop</span>${icon('check', true)} Moved “${fill('todo', 6)[2].name}” to <b>doing</b> <span class="btn" style="color:var(--text-accent)">Undo</span> <span style="color:var(--text-faint)">Ctrl+Z</span></div>`,
    'Drag (option A): card lifts (transform only), source keeps its slot, target column outlined; the sorted landing place is shown'),

  'group-menu': frame(`${toolbar({ view: 'By status', glyph: 'table', results: '9,864 results', group: 'status · Manual' })}
    <div class="scroll"><table><colgroup><col style="width:300px"><col style="width:120px"><col style="width:96px"><col style="width:150px"><col></colgroup>
      <thead><tr><th><div class="h">${icon('info', true)}file name</div></th><th><div class="h">${icon('text', true)}status</div></th><th><div class="h">${icon('hash', true)}priority</div></th><th><div class="h">${icon('calendar', true)}due</div></th><th><div class="h">${icon('tags', true)}tags</div></th></tr></thead>
      <tbody>${['doing', 'todo'].map(s => `<tr class="group"><td colspan="5">${icon('chevron-down', true)} ${s}<span class="count">${big[s].toLocaleString('en-US')}</span></td></tr>${by(s).slice(0, 4).map(t => `<tr><td><a>${t.name}</a></td><td>${t.status}</td><td class="num">${t.priority}</td><td><span class="date">${icon('calendar', true)}${fmtDate(t.due)}</span></td><td>${t.tags.map(x => `<span class="pill">${x}</span>`).join('')}</td></tr>`).join('')}`).join('')}</tbody></table></div>
    <div class="menu gmenu" style="right:300px;top:44px">
      <div class="lbl">Group by</div>
      <div class="ghead"><span class="select wide">${icon('text', true)} status ${icon('chevrons-up-down', true)}</span><span class="select" style="min-width:96px">Manual ${icon('chevrons-up-down', true)}</span><span class="icon-btn">${icon('trash-2', true)}</span></div>
      <div class="sep"></div>
      <div class="lbl">Groups · drag to reorder, untick to hide</div>
      <div class="grow"><span class="grip">${icon('grip-vertical', true)}</span><span class="check on"></span>doing<span class="n">37</span></div>
      <div class="grow lifted"><span class="grip">${icon('grip-vertical', true)}</span><span class="check on"></span>todo<span class="n">1,284</span></div>
      <div class="gline"></div>
      <div class="grow"><span class="grip">${icon('grip-vertical', true)}</span><span class="check on"></span>review<span class="n">112</span></div>
      <div class="grow"><span class="grip">${icon('grip-vertical', true)}</span><span class="check on"></span>blocked <em>empty · added</em><span class="n">0</span></div>
      <div class="grow off"><span class="grip">${icon('grip-vertical', true)}</span><span class="check"></span>done<span class="n">8,410</span></div>
      <div class="grow off hover"><span class="grip">${icon('grip-vertical', true)}</span><span class="check"></span>No value<span class="n">157</span></div>
      <div class="sep"></div>
      <div class="mitem">${icon('eye', true)} Show all</div>
      <div class="mitem">${icon('eye-off', true)} Hide all</div>
      <div class="addrow">${icon('plus', true)}<span class="input focusring">waiting<span style="color:var(--text-faint);margin-left:auto">Enter</span></span></div>
    </div>
    <div class="menu" style="right:132px;top:92px;width:160px;padding:4px">
      <div class="mitem">A → Z</div><div class="mitem">Z → A</div><div class="mitem on">Manual<span class="chk">${icon('check', true)}</span></div>
    </div>`, 'Group menu · Manual: grips, show/hide ticks, Show all / Hide all, Add group (an empty group; no note is made)'),

  collapsed: frame(`${toolbar({ view: 'By status', glyph: 'table', results: '24 results', group: 'status' })}
    <div class="panels">
      <div class="panel"><h6>Table</h6><table><colgroup><col style="width:300px"><col style="width:120px"><col style="width:96px"><col></colgroup><tbody>
        <tr class="group"><td colspan="4">${icon('chevron-right', true)} doing<span class="count">${by('doing').length}</span></td></tr>
        <tr class="group"><td colspan="4">${icon('chevron-down', true)} review<span class="count">${by('review').length}</span></td></tr>
        ${by('review').slice(0, 2).map(t => `<tr><td><a>${t.name}</a></td><td>${t.status}</td><td class="num">${t.priority}</td><td><span class="date">${icon('calendar', true)}${fmtDate(t.due)}</span></td></tr>`).join('')}
        <tr class="group"><td colspan="4" class="kb">${icon('chevron-right', true)} todo<span class="count">${by('todo').length}</span></td></tr>
      </tbody></table></div>
      <div class="panel"><h6>Cards</h6>
        <div class="ghd shut">${icon('chevron-right', true)} doing <span class="n">${by('doing').length}</span></div>
        <div class="ghd">${icon('chevron-down', true)} review <span class="n">${by('review').length}</span></div>
        <div class="minicards">${by('review').slice(0, 4).map(t => `<div class="card"><div class="body"><div class="title">${t.name}</div><div class="kv"><span class="k">due</span>${fmtDate(t.due)}</div></div></div>`).join('')}</div>
      </div>
      <div class="panel"><h6>List (layout not built yet: K8)</h6>
        <div class="ghd kb" style="margin:0 12px">${icon('chevron-right', true)} doing <span class="n">${by('doing').length}</span></div>
        <div class="ghd" style="margin:0 12px">${icon('chevron-down', true)} review <span class="n">${by('review').length}</span></div>
        <div class="listv">${by('review').slice(0, 3).map(t => `<div class="li"><span class="m">•</span>${t.name}<span class="meta">${fmtDate(t.due)} · P${t.priority}</span></div>`).join('')}</div>
      </div>
    </div>`, 'Collapsed headings · click, Enter or Space toggles; chevron-right and the count stay; focus ring shown on a keyboard-focused heading'),
};

for (const [name, html] of Object.entries(pages)) writeFileSync(join(here, `${name}.html`), html);

const browser = findBrowser();
if (!browser) throw new Error('no Chromium found (set GROVE_BROWSER)');
for (const name of Object.keys(pages)) {
  execFileSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1280,800', `--screenshot=${join(here, `${name}.png`)}`, `file://${join(here, `${name}.html`)}`], { stdio: 'ignore' });
  console.log(`${name}.png`);
}
