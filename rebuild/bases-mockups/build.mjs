#!/usr/bin/env node
// Builds the static Bases mockups (HTML + PNG) in this folder. Icons are Lucide's
// path data from the app's own `lucide` dependency, written into each page, so
// the pages are plain HTML/CSS with no scripts. PNGs come from headless
// Chromium's --screenshot (no window).
//
//   node rebuild/bases-mockups/build.mjs        (from the repo root)

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

const tasks = [
  { name: 'Draft launch post', status: 'open', priority: 5, due: '2026-11-03', tags: ['work', 'writing'], project: 'Launch', done: false, est: 3 },
  { name: 'Fix sync conflict', status: 'open', priority: 5, due: '2026-11-04', tags: ['work'], project: 'Grove', done: false, est: 5 },
  { name: 'Canvas alignment guides', status: 'review', priority: 4, due: '2026-11-05', tags: ['work', 'canvas'], project: 'Grove', done: false, est: 2 },
  { name: 'Book dentist', status: 'open', priority: 3, due: '2026-11-07', tags: ['home'], project: 'Personal', done: false, est: 1 },
  { name: 'Bases table summaries', status: 'waiting', priority: 3, due: '2026-11-10', tags: ['work', 'bases'], project: 'Grove', done: false, est: 3 },
  { name: 'Renew passport', status: 'open', priority: 2, due: '2026-11-14', tags: ['home'], project: 'Personal', done: false, est: 2 },
  { name: 'Read “Designing Data-Intensive Apps”', status: 'open', priority: 2, due: '2026-11-21', tags: ['reading'], project: 'Learning', done: false, est: 8 },
  { name: 'Quarterly review notes', status: 'review', priority: 2, due: '2026-11-28', tags: ['work'], project: 'Launch', done: false, est: 2 },
  { name: 'Clean up attachments folder', status: 'waiting', priority: 1, due: '2026-12-01', tags: ['vault'], project: 'Personal', done: false, est: 1 },
  { name: 'Plan holiday trip', status: 'open', priority: 1, due: '2026-12-12', tags: ['home', 'travel'], project: 'Personal', done: false, est: 4 },
  { name: 'Ship search in Rust', status: 'done', priority: 4, due: '2026-10-30', tags: ['work'], project: 'Grove', done: true, est: 5 },
];
const colour = { open: 'var(--color-green)', review: 'var(--color-purple)', waiting: 'var(--color-orange)', done: 'var(--text-faint)' };
const open = tasks.filter(t => t.status !== 'done');
const fmtDate = d => new Date(`${d}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const frame = (body, caption) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="mockups.css"></head><body>
<div class="app">
  <div class="ribbon">${icon('files')}${icon('search')}${icon('layers')}${icon('layout-grid')}</div>
  <div class="sidebar">
    <div class="row folder">${icon('chevron-down', true)} Projects</div>
    <div class="row indent">${icon('file-text', true)} Grove roadmap</div>
    <div class="row indent">${icon('file-text', true)} Launch plan</div>
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

const header = (label, ico, sorted) => `<th><div class="h">${icon(ico, true)}${label}${sorted ? `<span class="sort">${icon(sorted, true)}</span>` : ''}</div></th>`;
const head = (cols) => `<colgroup>${cols.map(w => `<col style="width:${w}px">`).join('')}<col></colgroup>`;
const cells = (t) => `<td><a>${t.name}</a></td>
  <td><span class="status"><span class="dot" style="background:${colour[t.status]}"></span>${t.status}</span></td>
  <td class="num">${t.priority}</td>
  <td><span class="date">${icon('calendar', true)}${fmtDate(t.due)}</span></td>
  <td>${t.tags.map(x => `<span class="pill">${x}</span>`).join('')}</td>
  <td>${t.project}</td>`;
const thead = `<thead><tr>${header('file name', 'info')}${header('status', 'circle-dot')}${header('priority', 'hash', 'arrow-down')}${header('due', 'calendar')}${header('tags', 'tags')}${header('project', 'text')}</tr></thead>`;
const cols = [300, 120, 96, 150, 190];
const summary = `<tfoot><tr><td>Count<b>${open.length}</b></td><td>Unique<b>3</b></td><td class="num">Average<b>${(open.reduce((s, t) => s + t.priority, 0) / open.length).toFixed(1)}</b></td><td>Earliest<b>${fmtDate(open[0].due)}</b></td><td></td><td></td></tr></tfoot>`;

const pages = {
  'table-a': frame(`
    <div class="toolbar">
      <span class="btn strong">${icon('table', true)} Open tasks ${icon('chevrons-up-down', true)}</span>
      <span class="btn">${icon('align-left', true)} ${open.length} results</span>
      <span class="spacer"></span>
      <span class="btn on">${icon('arrow-up-down', true)} Sort</span>
      <span class="btn">${icon('layers', true)} Group</span>
      <span class="btn on">${icon('list-filter', true)} Filter <span class="badge">2</span></span>
      <span class="btn">${icon('settings-2', true)} Properties</span>
      <span class="btn">${icon('search', true)}</span>
      <span class="btn primary">${icon('plus', true)} New</span>
    </div>
    <div class="scroll"><table>${head(cols)}${thead}<tbody>${open.map((t, i) => `<tr${i === 2 ? ' class="sel"' : ''}>${cells(t)}</tr>`).join('')}</tbody>${summary}</table></div>`,
    'Option A · Obsidian layout: one toolbar row, everything in menus, summaries in a footer row'),

  'table-b': frame(`
    <div class="viewtabs">
      <span class="viewtab active">${icon('table', true)} Open tasks</span>
      <span class="viewtab">${icon('layers', true)} By project</span>
      <span class="viewtab">${icon('layout-grid', true)} Board</span>
      <span class="viewtab">${icon('plus', true)}</span>
      <span class="spacer"></span>
      <span class="btn">${icon('search', true)}</span>
      <span class="btn">${icon('settings-2', true)} Properties</span>
      <span class="btn primary" style="margin-bottom:4px">${icon('plus', true)} New</span>
    </div>
    <div class="chips">
      <span class="chip">status <b>is not</b> done ${icon('x', true)}</span>
      <span class="chip">tags <b>contains</b> work ${icon('x', true)}</span>
      <span class="chip">${icon('arrow-up-down', true)} priority <b>9 → 1</b> ${icon('x', true)}</span>
      <span class="chip add">${icon('plus', true)} Filter</span>
      <span class="spacer"></span>
      <span style="color:var(--text-faint)">5 of 10 results · grouped by status</span>
    </div>
    <div class="scroll"><table>${head(cols)}${thead}<tbody>${['open', 'review', 'waiting'].map(s => {
      const rows = open.filter(t => t.status === s && t.tags.includes('work'));
      return rows.length ? `<tr class="group"><td colspan="6">${icon('chevron-down', true)} <span class="dot" style="display:inline-block;background:${colour[s]}"></span> ${s}<span class="count">${rows.length}</span></td></tr>${rows.map(t => `<tr>${cells(t)}</tr>`).join('')}` : '';
    }).join('')}</tbody></table></div>`,
    'Option B · View tabs and filter chips: views and active filters always visible, rows grouped'),

  'table-c': frame(`
    <div class="toolbar">
      <span class="btn strong">${icon('table', true)} Open tasks ${icon('chevrons-up-down', true)}</span>
      <span class="btn">${icon('align-left', true)} ${open.length} results</span>
      <span class="spacer"></span>
      <span class="btn">${icon('search', true)}</span>
      <span class="btn on">${icon('settings-2', true)} View settings</span>
      <span class="btn primary">${icon('plus', true)} New</span>
    </div>
    <div class="split">
      <div class="scroll"><table>${head([260, 110, 90, 140])}<thead><tr>${header('file name', 'info')}${header('status', 'circle-dot')}${header('priority', 'hash', 'arrow-down')}${header('due', 'calendar')}${header('tags', 'tags')}</tr></thead><tbody>${open.map(t => `<tr><td><a>${t.name}</a></td><td><span class="status"><span class="dot" style="background:${colour[t.status]}"></span>${t.status}</span></td><td class="num">${t.priority}</td><td><span class="date">${icon('calendar', true)}${fmtDate(t.due)}</span></td><td>${t.tags.map(x => `<span class="pill">${x}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div>
      <div class="inspector">
        <h4>Properties</h4>
        ${['file name', 'status', 'priority', 'due', 'tags'].map(p => `<div class="prop"><span class="grip">${icon('grip-vertical', true)}</span><span class="check on"></span>${p}</div>`).join('')}
        ${['project', 'estimate', 'created time'].map(p => `<div class="prop off"><span class="grip">${icon('grip-vertical', true)}</span><span class="check"></span>${p}</div>`).join('')}
        <h4>Sort</h4>
        <div class="field">${icon('arrow-down', true)} priority <span class="spacer"></span>9 → 1</div>
        <div class="field" style="margin-top:6px">${icon('arrow-up', true)} due <span class="spacer"></span>Old → New</div>
        <h4>Filter</h4>
        <div class="field">${icon('list-filter', true)} 2 conditions <span class="spacer"></span>${icon('chevron-right', true)}</div>
        <h4>Group</h4>
        <div class="field" style="color:var(--text-faint)">${icon('layers', true)} None</div>
      </div>
    </div>`,
    'Option C · Docked view settings: properties, sort, filter and group always open beside the table'),

  cards: frame(`
    <div class="toolbar">
      <span class="btn strong">${icon('layout-grid', true)} Board ${icon('chevrons-up-down', true)}</span>
      <span class="btn">${icon('align-left', true)} ${open.length} results</span>
      <span class="spacer"></span>
      <span class="btn">${icon('arrow-up-down', true)} Sort</span>
      <span class="btn on">${icon('list-filter', true)} Filter <span class="badge">2</span></span>
      <span class="btn">${icon('settings-2', true)} Properties</span>
      <span class="btn primary">${icon('plus', true)} New</span>
    </div>
    <div class="cards">${open.slice(0, 8).map((t, i) => `<div class="card">
      <div class="cover" style="background:linear-gradient(135deg, hsl(${(172 + i * 37) % 360} 35% 26%), hsl(${(172 + i * 37 + 40) % 360} 30% 16%))"></div>
      <div class="body"><div class="title">${t.name}</div>
        <div class="kv"><span class="k">status</span><span class="status"><span class="dot" style="background:${colour[t.status]}"></span>${t.status}</span></div>
        <div class="kv"><span class="k">due</span>${fmtDate(t.due)}</div>
        <div class="kv"><span class="k">tags</span>${t.tags.map(x => `<span class="pill">${x}</span>`).join('')}</div>
      </div></div>`).join('')}</div>`,
    'Card view · cover from an image property (or none), title, then the view’s properties'),

  filter: frame(`
    <div class="toolbar">
      <span class="btn strong">${icon('table', true)} Open tasks ${icon('chevrons-up-down', true)}</span>
      <span class="btn">${icon('align-left', true)} ${open.length} results</span>
      <span class="spacer"></span>
      <span class="btn">${icon('arrow-up-down', true)} Sort</span>
      <span class="btn">${icon('layers', true)} Group</span>
      <span class="btn on">${icon('list-filter', true)} Filter <span class="badge">3</span></span>
      <span class="btn">${icon('settings-2', true)} Properties</span>
      <span class="btn">${icon('search', true)}</span>
      <span class="btn primary">${icon('plus', true)} New</span>
    </div>
    <div class="scroll"><table>${head(cols)}${thead}<tbody>${open.map(t => `<tr>${cells(t)}</tr>`).join('')}</tbody></table></div>
    <div class="backdrop"></div>
    <div class="menu" style="right:150px;top:44px;width:580px">
      <h5>All views <span class="count">1</span></h5>
      <div class="group">
        <div class="frow"><span class="select">All of the following ${icon('chevron-down', true)}</span></div>
        <div class="frow"><span class="where">where</span><span class="select">${icon('folder', true)} file folder ${icon('chevron-down', true)}</span><span class="select">is in ${icon('chevron-down', true)}</span><span class="input">Tasks</span><span class="spacer"></span><span class="icon-btn">${icon('trash-2', true)}</span></div>
      </div>
      <div class="sep"></div>
      <h5>This view <span class="count">2</span></h5>
      <div class="group">
        <div class="frow"><span class="select">All of the following ${icon('chevron-down', true)}</span></div>
        <div class="frow"><span class="where">where</span><span class="select">${icon('circle-dot', true)} status ${icon('chevron-down', true)}</span><span class="select">is not ${icon('chevron-down', true)}</span><span class="input">done</span><span class="spacer"></span><span class="icon-btn">${icon('trash-2', true)}</span></div>
        <div class="group" style="margin-left:62px">
          <div class="frow"><span class="select">Any of the following ${icon('chevron-down', true)}</span><span class="spacer"></span><span class="icon-btn">${icon('trash-2', true)}</span></div>
          <div class="frow"><span class="where">where</span><span class="select">${icon('hash', true)} priority ${icon('chevron-down', true)}</span><span class="select">≥ ${icon('chevron-down', true)}</span><span class="input" style="min-width:60px">4</span></div>
          <div class="frow"><span class="where">or</span><span class="select">${icon('calendar', true)} due ${icon('chevron-down', true)}</span><span class="select">is before ${icon('chevron-down', true)}</span><span class="input">today() + "7d"</span></div>
        </div>
        <div class="frow"><span class="link-btn">${icon('plus', true)} Add filter</span><span class="link-btn">${icon('plus', true)} Add filter group</span><span class="spacer"></span><span class="link-btn">${icon('square-function', true)} Formula</span></div>
      </div>
      <div class="code">status != "done" &amp;&amp; (priority &gt;= 4 || due &lt; today() + "7d")</div>
    </div>`,
    'Filter editor · All views / This view, nested groups, each row editable as a formula'),
};

for (const [name, html] of Object.entries(pages)) writeFileSync(join(here, `${name}.html`), html);

const browser = findBrowser();
if (!browser) throw new Error('no Chromium found (set GROVE_BROWSER)');
for (const name of Object.keys(pages)) {
  execFileSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1280,800', `--screenshot=${join(here, `${name}.png`)}`, `file://${join(here, `${name}.html`)}`], { stdio: 'ignore' });
  console.log(`${name}.png`);
}
