/* Cinder app — the Properties table and the All properties panel. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ properties

// Property types by name, shared by the whole vault like Obsidian's: .obsidian/types.json when the
// vault has an .obsidian folder, otherwise Cinder's own settings.
S.propTypes = { ...(cfg.propTypes || {}) };
let obsidianTypes = false;
async function loadPropTypes() {
  try { const r = await api('/api/prop-types'); S.propTypes = { ...(cfg.propTypes || {}), ...r.types }; obsidianTypes = !!r.obsidian; }
  catch { obsidianTypes = false; }
}
async function savePropType(key, type) {
  S.propTypes[key] = type;
  if (obsidianTypes) {
    try { await api('/api/prop-types', { method: 'PUT', body: JSON.stringify({ [key]: type }) }); return; } catch { obsidianTypes = false; }
  }
  cfg.propTypes = { ...(cfg.propTypes || {}), [key]: type }; saveCfg();
}
const propType = (key, value) => S.propTypes[key] || CinderProps.inferType(key, value);

// A frontmatter block's properties, or null if it isn't a YAML mapping (then it shows as text).
function propsOf(fmText) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*$/.exec(fmText.replace(/\s+$/, ''));
  if (!m) return null;
  try { const v = CinderYaml.parse(m[1]); return v == null ? {} : typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

// Names in use across the vault (commonest first), and the values a property already has.
function knownProps() {
  const n = new Map();
  for (const note of S.notes.values()) for (const k of Object.keys(note.fm || {})) {
    const e = n.get(k) || { name: k, count: 0, note };
    e.count++; n.set(k, e);
  }
  // Types come from a typed reading of one note that has the property (5, not "5").
  return [...n.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))
    .map(e => ({ name: e.name, get type() { return propType(e.name, noteProps(e.note)[e.name]); } }));
}
function knownValues(key) {
  const c = new Map();
  for (const note of S.notes.values()) {
    const v = note.fm?.[key];
    for (const x of Array.isArray(v) ? v : v == null || v === '' ? [] : [v]) { const s = String(x).replace(key === 'tags' ? /^#/ : /$^/, ''); c.set(s, (c.get(s) || 0) + 1); }
  }
  if (key === 'tags') for (const t of allTags()) if (!c.has(t)) c.set(t, 0);
  return [...c].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

// Draw a note's properties. edit(f) applies f(content) -> content to the note; exit(dir) hands
// the keyboard back (up: the title, down: the text).
function mountProps(el, fmText, { edit, exit, from }) {
  const props = propsOf(fmText) || {};
  const redraw = () => { S.version++; refreshEditorSoon(); if (S.view === 'note' && S.mode === 'read') renderPreview(); };
  return CinderProps.render(el, {
    props,
    typeOf: (k, v) => propType(k, v),
    set: (k, v) => edit(c => CinderBases.setFrontmatter(c, k, v)),
    rename: (a, b) => {
      if (S.propTypes[a] && !S.propTypes[b]) savePropType(b, S.propTypes[a]);
      edit(c => CinderBases.renameFrontmatter(c, a, b));
    },
    setType: async (k, t) => {
      await savePropType(k, t);
      const v = CinderProps.coerce(props[k], t);
      if (JSON.stringify(v) !== JSON.stringify(props[k] ?? null)) edit(c => CinderBases.setFrontmatter(c, k, v));
      redraw();
    },
    keys: () => knownProps(),
    adopt: (k, t) => { if (!S.propTypes[k]) savePropType(k, t); },
    values: k => knownValues(k),
    inline: (d, text) => { d.innerHTML = markdownToHtml(String(text), from()).replace(/^\s*<p>|<\/p>\s*$/g, ''); renderMathIn(d); },
    tag: t => searchFor(`tag:${t}`),
    menu: (x, y, items) => menu(x, y, items),
    collapsed: !!store('propsCollapsed'),
    onCollapse: c => { store('propsCollapsed', c); redraw(); },
    onExit: exit,
  });
}

// ------------------------------------------------------------ All properties panel

// Every property in the vault: its type, how many notes use it and, opened, its values. Click
// a name or value to search for it; right-click to rename, retype or remove it everywhere.
const propsOpen = new Set();
function renderPropsPanel() {
  const box = $('#props-list'), f = ($('#props-filter').value || '').trim().toLowerCase();
  const had = box.contains(document.activeElement) ? document.activeElement.dataset.k + '|' + (document.activeElement.dataset.v ?? '') : null;
  const all = knownPropsCounted().filter(p => !f || p.name.toLowerCase().includes(f));
  box.innerHTML = all.length ? all.map(p => {
    const open = propsOpen.has(p.name);
    const vals = open ? knownValueCounts(p.name) : [];
    return `<div class="pr-name${open ? ' open' : ''}" tabindex="-1" data-k="${esc(p.name)}" title="${esc(p.type)}">${CHEV}<span class="pr-icon">${PROP_ICON[p.type] || PROP_ICON.text}</span><span class="pr-label">${esc(p.name)}</span><span class="n">${p.count}</span></div>` +
      (open ? `<div class="pr-vals">${vals.slice(0, 100).map(([v, c]) => `<div class="pr-val" tabindex="-1" data-k="${esc(p.name)}" data-v="${esc(v)}"><span>${esc(v === '' ? '(empty)' : v)}</span><span class="n">${c}</span></div>`).join('')}${vals.length > 100 ? `<div class="none">${vals.length - 100} more…</div>` : ''}</div>` : '');
  }).join('') : `<div class="none">${f ? 'No matching properties.' : 'No properties yet. Add them at the top of a note (Ctrl+;).'}</div>`;
  if (had) $$('.pr-name, .pr-val', box).find(x => x.dataset.k + '|' + (x.dataset.v ?? '') === had)?.focus({ preventScroll: true });
}
const PROP_ICON = Object.fromEntries(['text', 'multitext', 'number', 'checkbox', 'date', 'datetime', 'tags', 'aliases'].map(t => [t, `<svg viewBox="0 0 24 24">${{
  text: '<path d="M5 7h14M5 12h14M5 17h9"/>', multitext: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
  number: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>', checkbox: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  date: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', datetime: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  tags: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/>', aliases: '<path d="M15 4l4 4-4 4M19 8H9a5 5 0 0 0 0 10h2"/>',
}[t]}</svg>`]));
function knownPropsCounted() {
  const n = new Map();
  for (const note of S.notes.values()) for (const k of Object.keys(note.fm || {})) {
    const e = n.get(k) || { name: k, count: 0, note };
    e.count++; n.set(k, e);
  }
  return [...n.values()].sort((a, b) => collator.compare(a.name, b.name)).map(e => ({ name: e.name, count: e.count, type: propType(e.name, noteProps(e.note)[e.name]) }));
}
function knownValueCounts(key) {
  const c = new Map();
  for (const note of S.notes.values()) {
    if (!note.fm || !(key in note.fm)) continue;
    const v = note.fm[key];
    const list = Array.isArray(v) ? v : [v ?? ''];
    for (const x of list.length ? list : ['']) { const s = String(x ?? ''); c.set(s, (c.get(s) || 0) + 1); }
  }
  return [...c].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
}
const quoteProp = s => /[\s\]"]/.test(s) ? `"${s.replace(/"/g, '')}"` : s;

$('#props-filter').addEventListener('input', () => renderPropsPanel());
$('#props-list').addEventListener('click', e => {
  const val = e.target.closest('.pr-val');
  if (val) return searchFor(`[${quoteProp(val.dataset.k)}:${quoteProp(val.dataset.v)}]`);
  const nm = e.target.closest('.pr-name');
  if (!nm) return;
  if (e.target.closest('.chev')) { togglePropOpen(nm.dataset.k); return; }
  searchFor(`[${quoteProp(nm.dataset.k)}]`);
});
function togglePropOpen(k, open) {
  if (open ?? !propsOpen.has(k)) propsOpen.add(k); else propsOpen.delete(k);
  renderPropsPanel();
  $(`#props-list .pr-name[data-k="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
}
$('#props-list').addEventListener('keydown', e => {
  const nm = e.target.closest?.('.pr-name');
  if (nm && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); e.stopPropagation(); togglePropOpen(nm.dataset.k, e.key === 'ArrowRight'); }
  else if (nm && (e.key === 'F2' || e.key === 'ContextMenu')) { e.preventDefault(); const b = nm.getBoundingClientRect(); propMenu(nm.dataset.k, b.left + 20, b.bottom); }
});
$('#props-list').addEventListener('contextmenu', e => {
  const nm = e.target.closest('.pr-name, .pr-val');
  if (!nm) return;
  e.preventDefault();
  propMenu(nm.dataset.k, e.clientX, e.clientY);
});
function propMenu(k, x, y) {
  const cur = knownPropsCounted().find(p => p.name === k)?.type;
  menu(x, y, [
    [`Show notes with “${k}”`, () => searchFor(`[${quoteProp(k)}]`)],
    ['Rename everywhere…', () => renamePropEverywhere(k)],
    null,
    ...CinderProps.TYPES.map(([t, name]) => [`Type: ${name}${t === cur ? '  ✓' : ''}`, async () => { await savePropType(k, t); S.version++; refreshEditorSoon(); if (S.view === 'note' && S.mode === 'read') renderPreview(); renderPropsPanel(); }]),
    null,
    ['Remove from every note…', () => removePropEverywhere(k), 'danger'],
  ]);
}

// Change the text of every note that has property k (the open note through its editor, so undo works).
async function editPropEverywhere(k, f) {
  let n = 0, skipped = [];
  for (const [p, note] of S.notes) {
    if (!note.fm || !(k in note.fm)) continue;
    const open = p === S.cur && S.view === 'note';
    const before = open ? ed.value : note.content, after = f(before, p);
    if (after == null) { skipped.push(p); continue; }
    if (after === before) continue;
    if (open) ed.value = after;
    else { try { await writeFile(p, after, note.mtime); } catch (e) { toast(`Couldn’t update ${noteName(p)}: ${e.message}`); continue; } }
    n++;
  }
  reindexAll(); refreshPanels(); renderPropsPanel();
  if (S.view === 'note' && S.mode === 'read') renderPreview();
  return { n, skipped };
}
async function renamePropEverywhere(k) {
  const to = (await promptModal(`Rename “${k}” in every note`, 'New name', k))?.trim();
  if (!to || to === k) return;
  const { n, skipped } = await editPropEverywhere(k, (text, p) => S.notes.get(p)?.fm && to in S.notes.get(p).fm ? null : CinderBases.renameFrontmatter(text, k, to));
  if (S.propTypes[k] && !S.propTypes[to]) await savePropType(to, S.propTypes[k]);
  propsOpen.delete(k);
  renderPropsPanel();
  toast(`Renamed in ${n} note${n === 1 ? '' : 's'}${skipped.length ? ` · skipped ${skipped.length} that already have “${to}”` : ''}`, 4000);
}
async function removePropEverywhere(k) {
  const count = [...S.notes.values()].filter(n => n.fm && k in n.fm).length;
  if (!(await confirmModal(`Remove “${k}” from ${count} note${count === 1 ? '' : 's'}?`, 'The property and its values are taken out of each note’s frontmatter.', { ok: 'Remove', danger: true }))) return;
  const { n } = await editPropEverywhere(k, text => CinderBases.setFrontmatter(text, k, undefined));
  toast(`Removed from ${n} note${n === 1 ? '' : 's'}`);
}

