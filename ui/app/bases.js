/* Cinder app — base files, embeds and blocks. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ bases

let baseView = null;
let rowsCache = { gen: -1, rows: [] };
const propsCache = new WeakMap();
function noteProps(n) {
  let p = propsCache.get(n);
  if (!p) { p = CinderBases.frontmatter(n.content); propsCache.set(n, p); }
  return p;
}
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
  const got = await readMany([p]).catch(e => ({ error: e }));
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

