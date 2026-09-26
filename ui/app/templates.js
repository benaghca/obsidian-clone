/* Cinder app — daily notes and templates. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ daily notes & templates

function fmtDate(d, f) {
  const p = n => String(n).padStart(2, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const map = {
    YYYY: d.getFullYear(), MMMM: months[d.getMonth()], MMM: months[d.getMonth()].slice(0, 3), MM: p(d.getMonth() + 1),
    DD: p(d.getDate()), dddd: days[d.getDay()], ddd: days[d.getDay()].slice(0, 3), HH: p(d.getHours()), mm: p(d.getMinutes()),
  };
  return f.replace(/YYYY|MMMM|MMM|MM|DD|dddd|ddd|HH|mm/g, t => map[t]);
}

function fillTemplate(text, title) {
  const now = new Date();
  return text
    .replace(/\{\{\s*date:([^}]+)\}\}/g, (_, f) => fmtDate(now, f.trim()))
    .replace(/\{\{\s*time:([^}]+)\}\}/g, (_, f) => fmtDate(now, f.trim()))
    .replace(/\{\{\s*date\s*\}\}/g, fmtDate(now, 'YYYY-MM-DD'))
    .replace(/\{\{\s*time\s*\}\}/g, fmtDate(now, 'HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/g, title);
}

async function openDaily() {
  const name = fmtDate(new Date(), 'YYYY-MM-DD');
  const path = join(cfg.dailyFolder, name + '.md');
  if (S.files.has(path)) return openPath(path);
  const t = cfg.dailyTemplate && resolveLink(cfg.dailyTemplate, null);
  const template = t && S.notes.has(t) ? { text: S.notes.get(t).content, from: t, optional: true } : undefined;
  const r = await createNote(path, '', { mode: 'edit', template });
  if (r && r.cursor < 0 && S.cur === path) ed.setSelectionRange(ed.value.length, ed.value.length, true);
}

// ============================================================ templates (core {{date}} syntax + Templater's <% %>)

function templateList() {
  const folder = cfg.templatesFolder;
  return [...S.notes.keys()].filter(p => (folder ? p.startsWith(folder + '/') : true) && !isDrawing(p));
}
async function pickTemplate(placeholder) {
  const list = templateList();
  if (!list.length) { toast(`No templates found in "${cfg.templatesFolder}/"`); return null; }
  return picker({ placeholder, items: q => rank(list, q, noteName).map(p => ({ main: noteName(p), sub: dirname(p), value: p })) });
}

// What tp.* sees when a template is applied to the note at `path`.
function templateEnv(path, selection, templatePath) {
  const n = S.notes.get(path), f = S.files.get(path);
  return {
    path, title: noteName(path), folder: dirname(path), content: n?.content ?? '', selection,
    frontmatter: n?.fm || {}, tags: n ? [...n.tags] : [], vaultPath: S.vaultPath || '',
    ctime: f?.ctime || f?.mtime || Date.now(), mtime: f?.mtime || Date.now(), templatePath,
    prompt: (text, def, multiline) => promptModal('Template', text || 'Value', def, { multiline, raw: true }),
    suggest: async (labels, values, placeholder) => {
      const i = await picker({ placeholder: placeholder || 'Choose…', items: q => rank(labels.map((l, k) => ({ l, k })), q, x => x.l).map(x => ({ main: x.l, value: x.k })) });
      return i == null ? null : values[i];
    },
    clipboard: async () => { try { return await navigator.clipboard.readText(); } catch { return ''; } },
    read: link => { const t = resolveLink(splitOnce(splitOnce(link, '|')[0], '#')[0].trim(), path); return t && S.notes.has(t) ? S.notes.get(t).content : null; },
    exists: link => !!resolveLink(link.trim(), path),
  };
}

// Fill a template for the note at `path`. Returns {text, cursor, actions}, or null if it
// failed or was cancelled (the reason is shown as a toast).
async function applyTemplate(text, path, { selection = '', templatePath = '' } = {}) {
  text = fillTemplate(text, noteName(path));
  if (!CinderTemplater.hasTemplaterSyntax(text)) return { text, cursor: -1, actions: [] };
  try {
    const r = await CinderTemplater.render(text, templateEnv(path, selection, templatePath));
    if (r.aborted) { toast('Template cancelled'); return null; }
    return r;
  } catch (e) { toast(`Template error${templatePath ? ` in ${noteName(templatePath)}` : ''}: ${e.message}`, 6000); return null; }
}

// tp.file.rename / move / create_new run after the text is in place.
async function runTemplateActions(path, actions) {
  let cur = path;
  for (const a of actions || []) {
    try {
      if (a.type === 'rename' || a.type === 'move') {
        const name = a.type === 'rename' ? a.name : basename(a.path);
        if (!name.trim() || BAD_NAME.test(name)) throw new Error(`"${name}" isn't a valid note name`);
        const to = a.type === 'rename' ? join(dirname(cur), name + '.md') : normPath(a.path) + '.md';
        if (to !== cur) { await renamePath(cur, to); if (S.files.has(to)) cur = to; }
      } else if (a.type === 'create') {
        const p = uniquePath(dirname(a.path), basename(a.path));
        const r = await applyTemplate(a.content, p);
        await writeFile(p, r ? r.text : a.content);
        let d = dirname(p);
        while (d) { S.dirs.add(d); d = dirname(d); }
        reindexAll(); renderTree();
        if (a.open) await openPath(p);
      }
    } catch (e) { toast('Template: ' + e.message, 5000); }
  }
  return cur;
}

// The template for new notes in `path`'s folder: the most specific "folder: template" line wins.
function folderTemplateFor(path) {
  const dir = dirname(path);
  let best = null, bestLen = -1;
  for (const line of String(cfg.folderTemplates || '').split('\n')) {
    const m = /^\s*([^:→]*?)\s*(?::|→)\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const folder = m[1].replace(/^\/+|\/+$/g, '');
    if ((folder === '' || dir === folder || dir.startsWith(folder + '/')) && folder.length > bestLen) { best = m[2]; bestLen = folder.length; }
  }
  if (!best) return null;
  const t = resolveLink(best.replace(/^\[\[|\]\]$/g, ''), null);
  return t && S.notes.has(t) ? t : null;
}

async function insertTemplate() {
  if (S.view !== 'note') return toast('Open a note first');
  const pick = await pickTemplate('Insert template…');
  if (!pick) return;
  if (S.mode !== 'edit') setMode('edit');
  const target = S.cur, a = ed.selectionStart, b = ed.selectionEnd;
  const r = await applyTemplate(S.notes.get(pick).content, target, { selection: ed.value.slice(a, b), templatePath: pick });
  if (!r || S.cur !== target) return;
  insertText(a, b, r.text);
  if (r.cursor >= 0) ed.setSelectionRange(a + r.cursor, a + r.cursor, true);
  await runTemplateActions(target, r.actions);
}

async function newNoteFromTemplate() {
  const pick = await pickTemplate('New note from template…');
  if (!pick) return;
  const path = uniquePath(cfg.newNoteFolder, 'Untitled.md');
  await createNote(path, '', { mode: 'edit', template: { text: S.notes.get(pick).content, from: pick } });
}

// Run the template commands written in the current note itself.
async function replaceTemplatesInNote() {
  if (S.view !== 'note') return toast('Open a note first');
  const target = S.cur, src = ed.value;
  if (!CinderTemplater.hasTemplaterSyntax(src) && !/\{\{\s*(date|time|title)/.test(src)) return toast('This note has no template commands');
  const r = await applyTemplate(src, target);
  if (!r || S.cur !== target || ed.value !== src) return;
  if (S.mode !== 'edit') setMode('edit');
  insertText(0, src.length, r.text);
  if (r.cursor >= 0) ed.setSelectionRange(r.cursor, r.cursor, true);
  await runTemplateActions(target, r.actions);
}

