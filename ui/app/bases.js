/* Cinder app — base files, embeds and blocks. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ bases

let baseView = null;
let rowsCache = { gen: -1, rows: [] };
// A note's properties, as Bases and Properties see them: the index has already read them (typed,
// by ui/yaml.js); frontmatter that isn't valid YAML has none.
const noteProps = n => (n && n.fmValid && n.fm) || {};
// Every file in the vault as a base row: file.* fields plus the note's properties.
function baseRows() {
  if (rowsCache.gen === S.dataGen) return rowsCache.rows;
  const rows = [];
  for (const [p, f] of S.files) {
    const n = S.notes.get(p), name = basename(p);
    rows.push({
      path: p, name, basename: isMd(name) ? name.slice(0, -3) : name.replace(/\.[^.]+$/, ''), folder: dirname(p),
      ext: name.includes('.') ? name.split('.').pop().toLowerCase() : '', size: f.size || 0, ctime: f.ctime || f.mtime || 0, mtime: f.mtime || 0,
      tags: n ? [...n.tags] : [], links: n ? [...new Set((n.out || []).filter(Boolean))] : [], props: n ? noteProps(n) : {},
    });
  }
  rowsCache = { gen: S.dataGen, rows };
  return rows;
}

function baseHooks(basePath, thisPath) {
  return {
    rows: baseRows,
    thisRow: () => baseRows().find(r => r.path === thisPath) || null,
    backlinks: p => [...backlinksOf(p).keys()],
    openFile: p => openPath(p),
    openLink: name => followLink(name, null, thisPath),
    imageUrl: (v, from) => {
      const s = String(v).replace(/^!?\[\[|\]\]$/g, '').split('|')[0].trim();
      if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // Cinder never loads images from the web
      const t = resolveLink(s, from);
      return t && IMG_EXT.test(t) ? rawUrl(t) : null;
    },
    setProperty: (p, k, v) => setNoteProperty(p, k, v),
    createNote: (folder, props) => createNoteWithProps(folder, props),
    save: b => saveBaseFile(basePath, b),
    menu: (x, y, items) => menu(x, y, items),
    prompt: (title, label, value) => promptModal(title, label, value),
    toast: msg => toast(msg),
  };
}

async function openBase(p) {
  showView('base');
  $('#view-base').replaceChildren();
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${displayName(p)} — ${VAULT} — Cinder`;
  setSaveState('');
  renderTreeActive(true);
  refreshPanels();
  const got = /** @type {any} */ (await readMany([p]).catch(e => ({ error: e })));
  if (S.cur !== p) return;
  if (!got[p]) return showDrawingError(p, got.error || new Error('the file couldn’t be read'), 'a base');
  loadBase(p, got[p].content, got[p].mtime);
}
function loadBase(p, text, mtime) {
  let base;
  try { base = CinderBases.parseBase(text); } catch (e) { showDrawingError(p, e, 'a base'); return; }
  S.baseDoc = { mtime, text };
  if (S.view !== 'base') showView('base');
  const el = document.createElement('div');
  $('#view-base').replaceChildren(el);
  baseView = CinderBases.mount(el, { base, path: p, editable: true, view: S.pos.get(p)?.baseView, hooks: baseHooks(p, p) });
  updateStatus();
}
async function reloadBase() {
  const p = S.cur;
  const got = (await readMany([p]).catch(() => ({})))[p];
  if (got && S.cur === p && S.view === 'base' && !S.dirty) {
    const name = baseView?.viewName();
    S.pos.set(p, { baseView: name });
    loadBase(p, got.content, got.mtime);
  }
}

// A base's view settings changed in the UI: save the .base file.
async function saveBaseFile(path, base) {
  const text = CinderBases.serializeBase(base);
  if (S.view === 'base' && S.cur === path && S.baseDoc) {
    S.baseDoc.text = text;
    S.dirty = true; setSaveState('Unsaved'); scheduleSave();
    return;
  }
  try { await writeFile(path, text, S.files.get(path)?.mtime); } catch (e) { toast('Couldn’t save the base: ' + e.message); }
}
async function doSaveBase(force) {
  const p = S.cur, d = S.baseDoc;
  S.dirty = false; setSaveState('Saving…');
  try {
    const r = await api(`/api/file?path=${enc(p)}`, { method: 'PUT', body: d.text, headers: (!force && d.mtime) ? { 'X-Base-Mtime': String(d.mtime) } : {} });
    d.mtime = r.mtime;
    S.files.set(p, { ...S.files.get(p), mtime: r.mtime, size: new Blob([d.text]).size });
    if (!S.dirty) setSaveState('Saved');
    return;
  } catch (e) {
    S.dirty = true;
    if (e.status !== 409) { setSaveState('Save failed: ' + e.message, true); return; }
  }
  if (await conflictAsk(basename(p))) return doSaveBase(true);
  S.dirty = false;
  await reloadBase();
  setSaveState('Reloaded from disk');
}

// Change one frontmatter property of a note (from a base's table, board or checkbox).
async function setNoteProperty(path, key, value) {
  if (!S.notes.has(path)) return toast('Only notes have properties');
  if (path === S.cur && S.view === 'note') await save();
  const n = S.notes.get(path);
  const text = CinderBases.setFrontmatter(n.content, key, value);
  if (text === n.content) return;
  try { await writeFile(path, text, n.mtime); } catch (e) { toast(`Couldn’t update ${noteName(path)}: ${e.message}`); return; }
  resolveNote(path);
  if (path === S.cur && S.view === 'note') reloadEditorFromDisk(text);
  refreshBases();
  refreshPanels(true);
}
function refreshBases() {
  if (S.view === 'base') baseView?.refresh();
  else if (S.view === 'note') { S.version++; refreshEditorSoon(); if (S.mode === 'read') renderPreview(); }
}

async function createNoteWithProps(folder, props) {
  let text = '';
  for (const [k, v] of Object.entries(props || {})) text = CinderBases.setFrontmatter(text, k, v);
  await createNote(uniquePath(folder ?? cfg.newNoteFolder, 'Untitled.md'), text, { focusTitle: true, mode: 'edit' });
}

async function newBase(folder) {
  if (folder == null) folder = cfg.newNoteFolder;
  await createNote(uniquePath(folder, 'Untitled.base'), 'views:\n  - type: table\n    name: Table\n');
}

// ![[Books.base]] or ![[Books.base#View name]]: a live base inside a note.
function renderBaseEmbed(el, path, sub) {
  el.classList.add('base-embed');
  const host = document.createElement('div');
  el.replaceChildren(host);
  const thisPath = S.cur;
  readMany([path]).then(got => {
    if (!got[path]) throw new Error('file not found');
    const base = CinderBases.parseBase(got[path].content);
    CinderBases.mount(host, { base, path, editable: true, embedded: true, view: sub || undefined, stateKey: `${thisPath}|${path}|${sub || ''}`, hooks: baseHooks(path, thisPath) });
  }).catch(e => { host.innerHTML = `<div class="bs-error">Couldn’t show ${esc(displayName(path))}: ${esc(e.message)}</div>`; });
}

// ```base blocks inside a note: view changes are written back into the block.
function renderBaseBlock(el, code, notePath) {
  el.classList.add('base-embed');
  let base;
  try { base = CinderBases.parseBase(code); } catch (e) { el.innerHTML = `<div class="bs-error">This base block has a problem: ${esc(e.message)}</div>`; return; }
  let current = code;
  CinderBases.mount(el, {
    // The UI state follows the block by its view names (they survive sorting and filtering).
    base, path: notePath, editable: true, embedded: true, stateKey: `${notePath}|block|${base.views.map(v => v.name).join('|')}`,
    hooks: { ...baseHooks(notePath, notePath), save: b => { const next = CinderBases.serializeBase(b).replace(/\n$/, ''); saveBaseBlock(notePath, current, next); current = next; } },
  });
}
async function saveBaseBlock(notePath, oldCode, newCode) {
  // Find the block's code after any fence the editor treats as "base": ``` or ~~~, any length and case.
  const escRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\n)([ \\t]*(\`{3,}|~{3,})[ \\t]*base[ \\t]*\\r?\\n)${escRe(oldCode)}${oldCode ? '\\r?\\n' : ''}[ \\t]*\\3`, 'i');
  const find = src => { const m = re.exec(src); return m ? m.index + m[1].length + m[2].length : -1; };
  if (S.cur === notePath && S.view === 'note') {
    const i = find(ed.value);
    if (i < 0) return toast('Couldn’t find that base block to update');
    // Keep the cursor where it was (outside the block), shifted by the change in length.
    const delta = newCode.length - oldCode.length, shift = x => x >= i + oldCode.length ? x + delta : x;
    ed.insert(i, i + oldCode.length, newCode, shift(ed.selectionStart), shift(ed.selectionEnd));
    return;
  }
  const n = S.notes.get(notePath), i = n ? find(n.content) : -1;
  if (i < 0) return toast('Couldn’t find that base block to update');
  try { await writeFile(notePath, n.content.slice(0, i) + newCode + n.content.slice(i + oldCode.length), n.mtime); resolveNote(notePath); } catch (e) { toast('Couldn’t save the base block: ' + e.message); }
}


// ============================================================ Dataview

// Rows for Dataview queries: as for bases, plus each note's inline fields (key:: value) as
// properties (its frontmatter wins where both have a key).
let dvRowsCache = { gen: -1, rows: [] };
function dataviewRows() {
  if (dvRowsCache.gen === S.dataGen) return dvRowsCache.rows;
  const rows = baseRows().map(r => {
    const n = S.notes.get(r.path);
    if (!n || !n.content.includes('::')) return r;
    return { ...r, props: { ...CinderDataview.inlineFields(blankCode(n.content.slice(n.fmLen))), ...r.props } };
  });
  dvRowsCache = { gen: S.dataGen, rows };
  return rows;
}

// What a query needs besides the rows: the note it's in, backlinks, and Dataview's functions.
function dataviewContext(from) {
  const rows = dataviewRows();
  return {
    rows, thisRow: rows.find(r => r.path === from) || null,
    backlinks: p => [...backlinksOf(p).keys()],
    funcs: { ...CinderDataview.FUNCS, outgoing: name => { const p = resolveLink(name, from); return (S.notes.get(p)?.out || []).filter(Boolean).map(x => new CinderBases.Link(x)); } },
  };
}

// A value as Dataview shows it: notes and [[links]] as links, dates formatted, lists as lists,
// text as Markdown.
function dataviewValueHtml(v, from) {
  const B = CinderBases;
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.length > 1 ? `<ul class="dv-ul">${v.map(x => `<li>${dataviewValueHtml(x, from)}</li>`).join('')}</ul>` : dataviewValueHtml(v[0], from);
  if (v && v.__file) v = new B.Link(v.__file.path);
  if (v instanceof B.Link) {
    const p = resolveLink(v.path.replace(/\.md$/, ''), from) || v.path;
    return `<a class="internal-link${S.files.has(p) ? '' : ' unresolved'}" data-href="${esc(S.files.has(p) ? p : v.path)}"${S.files.has(p) ? ' data-path="1"' : ''}>${esc(v.display || noteName(p))}</a>`;
  }
  if (typeof v === 'string') return taskHooks().inline(v, from);
  return esc(B.display(v));
}

// A ```dataview block: its LIST or TABLE, or its TASK list.
function renderDataviewBlock(el, code, from) {
  el.className = 'dataview-block';
  let q;
  try { q = CinderDataview.parse(code); } catch (e) { el.innerHTML = `<div class="dv-error">Dataview: ${esc(e.message)}</div>`; return; }
  const cx = dataviewContext(from);
  if (q.type === 'task') return renderDataviewTasks(el, q, cx);
  let r;
  try { r = CinderBases.query(q.base, 0, cx.rows, cx); } catch (e) { el.innerHTML = `<div class="dv-error">Dataview: ${esc(e.message)}</div>`; return; }
  const cell = (id, row) => { try { return dataviewValueHtml(CinderBases.valueOf(id, row, r.ctx), from); } catch (e) { return `<span class="dv-error" title="${esc(e.message)}">⚠</span>`; } };
  const nameCell = row => `<a class="internal-link" data-href="${esc(row.path)}" data-path="1">${esc(row.basename)}</a>`;
  const value = (c, row) => c.id === 'file.name' ? nameCell(row) : cell(c.id, row);
  const sections = r.groups ? r.groups.map(g => ({ title: g.value == null ? '—' : dataviewValueHtml(g.value, from), rows: g.rows })) : [{ title: null, rows: r.rows }];
  let html;
  if (q.type === 'table') {
    const head = q.columns.map((c, k) => `<th>${esc(c.name)}${k === 0 && !q.withoutId ? ` <span class="dv-count">${r.rows.length}</span>` : ''}</th>`).join('');
    html = sections.map(s => (s.title != null ? `<h4 class="dv-group">${s.title}</h4>` : '') + `<table class="dv-table"><thead><tr>${head}</tr></thead><tbody>${s.rows.map(row => `<tr>${q.columns.map(c => `<td>${value(c, row)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('');
  } else {
    html = sections.map(s => (s.title != null ? `<h4 class="dv-group">${s.title}</h4>` : '') + `<ul class="dv-list">${s.rows.map(row => `<li>${q.columns.map(c => value(c, row)).filter(Boolean).join(': ')}</li>`).join('')}</ul>`).join('');
  }
  el.innerHTML = (r.rows.length ? html : '<div class="dv-none">No results.</div>') + (r.errors.length ? `<div class="dv-error">${r.errors.map(esc).join('<br>')}</div>` : '');
}

// TASK: the tasks in the notes FROM picks that WHERE holds for (with Dataview's task fields:
// completed, checked, status, text, due…), grouped by note, ticked as in a ```tasks block.
function renderDataviewTasks(el, q, cx) {
  const where = q.where;
  const tasks = () => {
    const files = new Map(CinderBases.query(q.base, 0, cx.rows, cx).rows.map(r => [r.path, r]));
    const ctx = { thisRow: cx.thisRow, backlinks: cx.backlinks, funcs: cx.funcs };
    return allTasks().filter(x => {
      const row = files.get(x.path);
      if (!row) return false;
      if (!where) return true;
      const props = { ...row.props, completed: x.done, checked: x.status !== ' ', fullyCompleted: x.done, status: x.status, text: x.text, due: x.due, scheduled: x.scheduled, start: x.start, completion: x.doneDate, created: x.created, line: x.line, tags: x.tags };
      try { const v = CinderBases.evaluate(where, { ...row, props }, ctx); return Array.isArray(v) ? v.length > 0 : !!v && v !== 'false'; } catch { return false; }
    });
  };
  el.classList.add('tasks-embed');
  CinderTasks.mountQuery(el, 'group by filename', { ...taskHooks(), tasks });
}

// Inline `= expr` (Dataview's inline query): the value, for the note it's in.
function dataviewInline(expr, from) {
  const span = document.createElement('span');
  span.className = 'dv-inline';
  const cx = dataviewContext(from);
  try {
    if (!cx.thisRow) throw new Error('not in a note');
    span.innerHTML = dataviewValueHtml(CinderBases.evaluate(CinderDataview.translate(expr), cx.thisRow, { thisRow: cx.thisRow, backlinks: cx.backlinks, funcs: cx.funcs }), from) || '<span class="dv-none">—</span>';
  } catch (e) { span.classList.add('dv-error'); span.textContent = '= ' + expr; span.title = 'Dataview: ' + e.message; }
  return span;
}

// A ```dataviewjs block runs JavaScript, which Cinder doesn't run from notes: it says so, and the
// code shows below it.
function renderDataviewJsBlock(el) {
  el.className = 'dv-none dv-js';
  el.textContent = 'This dataviewjs block isn’t run: Cinder doesn’t run JavaScript from notes. A dataview block can often do the same.';
  return el;
}
