/* Cinder app — the Tasks view, task blocks and quick add. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ tasks

let tasksView = null;
let tasksCache = { gen: -1, tasks: [] };
function allTasks() {
  if (tasksCache.gen === S.dataGen) return tasksCache.tasks;
  const tasks = [];
  // Template notes hold example tasks, not real ones.
  const tpl = cfg.templatesFolder ? cfg.templatesFolder + '/' : null;
  for (const [p, n] of S.notes) if (!isDrawing(p) && !(tpl && p.startsWith(tpl))) tasks.push(...CinderTasks.parseNote(p, n.content));
  tasksCache = { gen: S.dataGen, tasks };
  return tasks;
}
const findTask = (path, line) => allTasks().find(x => x.path === path && x.line === line);

// Rewrite one task's line (fn: line -> [lines]) wherever the note is: the editor or disk.
async function modifyTaskLine(x, fn) {
  const inEditor = x.path === S.cur && S.view === 'note';
  const content = inEditor ? ed.value : S.notes.get(x.path)?.content;
  if (content == null) return;
  const lines = content.split('\n');
  let li = x.line;
  if ((lines[li] || '').replace(/\r$/, '') !== x.raw) li = lines.findIndex(l => l.replace(/\r$/, '') === x.raw);
  if (li < 0) { toast('That task has changed since the list was drawn'); refreshTasks(); return; }
  const cr = lines[li].endsWith('\r') ? '\r' : '';
  const out = fn(lines[li].replace(/\r$/, ''));
  const remove = out.length === 1 && out[0] === null; // the line goes, with its line break
  const text = remove ? '' : out.map(l => l + cr).join('\n');
  let start = 0;
  for (let k = 0; k < li; k++) start += lines[k].length + 1;
  const end = start + lines[li].length + (remove && li < lines.length - 1 ? 1 : 0);
  if (inEditor) {
    const delta = text.length - (end - start), shift = v => v > end ? v + delta : v;
    ed.insert(start, end, text, shift(ed.selectionStart), shift(ed.selectionEnd));
    // The editor holds the newest text; index it now so task lists redraw from it (saving follows).
    const n = S.notes.get(x.path);
    if (n) { setNote(x.path, ed.value, n.mtime); resolveNote(x.path); }
  } else {
    try { await writeFile(x.path, content.slice(0, start) + text + content.slice(end), S.notes.get(x.path).mtime); resolveNote(x.path); }
    catch (e) { toast(`Couldn’t update ${noteName(x.path)}: ${e.message}`); return; }
  }
  refreshTasks();
}
const toggleTaskItem = x => modifyTaskLine(x, l => CinderTasks.toggle(l, { date: CinderTasks.today(), doneDate: cfg.taskDoneDate }));
const setTaskField = (x, f, v) => modifyTaskLine(x, l => [CinderTasks.setField(l, f, v)]);
const setTaskText = (x, text) => modifyTaskLine(x, l => [CinderTasks.setText(l, text)]);
const cancelTask = x => modifyTaskLine(x, l => [CinderTasks.setStatus(l, '-')]);
// Deleting a task takes its line out of the note; Undo puts it back.
async function deleteTask(x) {
  await modifyTaskLine(x, () => [null]);
  toast(`Deleted “${x.text}”`, 5000, { label: 'Undo', run: () => restoreTaskLine(x) });
}
async function restoreTaskLine(x) {
  const inEditor = x.path === S.cur && S.view === 'note';
  const content = inEditor ? ed.value : S.notes.get(x.path)?.content;
  if (content == null) return;
  const lines = content.split('\n'), li = Math.min(x.line, lines.length);
  let start = 0;
  for (let k = 0; k < li; k++) start += lines[k].length + 1;
  const text = x.raw + '\n';
  if (inEditor) { ed.insert(start, start, text, ed.selectionStart, ed.selectionEnd); const n = S.notes.get(x.path); if (n) { setNote(x.path, ed.value, n.mtime); resolveNote(x.path); } }
  else { await writeFile(x.path, content.slice(0, start) + text + content.slice(start), S.notes.get(x.path).mtime); resolveNote(x.path); }
  refreshTasks();
}
// Completing from a list offers Undo. A recurring task's next occurrence goes in above it, so
// undoing removes that too.
async function completeTask(x) {
  await toggleTaskItem(x);
  const recurring = !!CinderTasks.parseRecur(x.recur);
  toast(`Done: “${x.text}”`, 5000, {
    label: 'Undo', run: async () => {
      const doneAt = recurring ? x.line + 1 : x.line;
      const d = allTasks().find(y => y.path === x.path && y.line === doneAt && y.done && y.text === x.text);
      if (!d) return toast('That task has changed since');
      await toggleTaskItem(d);
      if (recurring) { const n = allTasks().find(y => y.path === x.path && y.line === x.line && !y.done && y.text === x.text); if (n) await modifyTaskLine(n, () => [null]); }
    },
  });
}

function refreshTasks() {
  if (S.view === 'tasks') tasksView?.refresh();
  else if (S.view === 'note') { S.version++; refreshEditorSoon(); if (S.mode === 'read') renderPreview(); }
  updateTaskBadge();
  updateStatus();
}

// The ribbon's Tasks button shows how many open tasks are due today or overdue.
function updateTaskBadge() {
  const b = $('[data-cmd=tasks] .rb-badge');
  if (!b) return;
  const t = CinderTasks.today();
  const n = allTasks().filter(x => !x.done && !x.cancelled && (x.due || x.scheduled) && (x.due || x.scheduled) <= t).length;
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = !n;
}

function taskInboxPath() {
  const p = String(cfg.taskInbox || '').trim().replace(/^\/+/, '');
  if (!p) return periodPath('day', new Date());
  return isMd(p) ? p : p + '.md';
}

// Append a task line to a note (the task inbox unless one is given), creating it if needed.
async function addTask(line, to) {
  const path = to || taskInboxPath();
  try {
    if (path === S.cur && S.view === 'note') {
      const v = ed.value, pre = v && !v.endsWith('\n') ? '\n' : '';
      ed.insert(v.length, v.length, pre + line + '\n', ed.selectionStart, ed.selectionEnd);
      await save();
    } else if (S.notes.has(path)) {
      const n = S.notes.get(path), pre = n.content && !n.content.endsWith('\n') ? '\n' : '';
      await writeFile(path, n.content + pre + line + '\n', n.mtime);
      resolveNote(path);
    } else {
      await writeFile(path, line + '\n');
      let d = dirname(path);
      while (d) { S.dirs.add(d); d = dirname(d); }
      reindexAll(); renderTree();
    }
  } catch (e) { toast('Couldn’t add the task: ' + e.message); return; }
  toast(`Added to ${noteName(path)}`);
  refreshTasks();
}

function taskHooks() {
  return {
    tasks: allTasks,
    find: findTask,
    inline: (text, path) => {
      const prev = RC;
      RC = { from: path, depth: 1 };
      const div = document.createElement('div');
      try { div.innerHTML = DOMPurify.sanitize(marked.parseInline(text), { FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'object', 'embed', 'img', 'input'] }); } finally { RC = prev; }
      linkifyTags(div);
      renderMathIn(div);
      return div.innerHTML;
    },
    toggle: x => toggleTaskItem(x),
    complete: x => completeTask(x),
    setField: (x, f, v) => setTaskField(x, f, v),
    setText: (x, t) => setTaskText(x, t),
    cancel: x => cancelTask(x),
    remove: x => deleteTask(x),
    open: (path, line) => {
      const c = S.notes.get(path)?.content || '';
      let off = 0;
      for (let k = 0, i = 0; k < line && i >= 0; k++) { i = c.indexOf('\n', off); off = i < 0 ? c.length : i + 1; }
      const end = c.indexOf('\n', off);
      openPath(path, { mode: 'edit', select: [off, end < 0 ? c.length : end] });
    },
    menu: (x, y, items) => menu(x, y, items),
    add: (line, path) => addTask(line, path),
    inboxLabel: () => noteName(taskInboxPath()) + (cfg.taskInbox ? '' : ' (today’s daily note)'),
    targetLabel: path => path ? noteName(path) : cfg.taskInbox ? noteName(taskInboxPath()) : 'today’s daily note',
    pickTarget: () => picker({
      placeholder: 'Add new tasks to which note?',
      items: q => {
        const def = { main: cfg.taskInbox ? noteName(taskInboxPath()) : 'Today’s daily note', sub: 'the default', value: taskInboxPath() };
        return [...(score(q, def.main) > -Infinity || !q ? [def] : []), ...rank([...S.notes.keys()].filter(p => !isDrawing(p)), q, noteName).map(p => ({ main: noteName(p), sub: dirname(p), value: p }))].slice(0, 60);
      },
    }),
    saved: store('tasksView'),
    save: v => store('tasksView', v),
  };
}

async function openTasks() {
  flushDocViews();
  await save();
  rememberPos();
  showView('tasks');
  setSaveState('');
  $('#crumbs').innerHTML = '<b>Tasks</b>';
  document.title = `Tasks — ${VAULT} — Cinder`;
  if (!tasksView) tasksView = CinderTasks.mountView($('#view-tasks'), taskHooks());
  else tasksView.refresh();
  updateStatus();
  requestAnimationFrame(() => $('#view-tasks .tk-add')?.focus());
}

// A small quick-add box usable from anywhere.
function quickAddTask() {
  const back = modal(`<div class="form tk-quick"><h3>Add a task</h3><input class="field" placeholder="e.g. “Call the dentist friday !high”" spellcheck="false"><div class="tk-preview"></div><div class="tk-inbox">Adds to ${esc(taskHooks().inboxLabel())}</div></div>`);
  const input = $('input', back), pv = $('.tk-preview', back);
  input.focus();
  input.addEventListener('input', () => {
    const q = CinderTasks.parseQuick(input.value);
    pv.textContent = input.value.trim() ? [q.text, q.due && CinderTasks.friendly(q.due), q.priority && q.priority + ' priority', q.recur && 'repeats ' + q.recur].filter(Boolean).join(' · ') : '';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') back.remove();
    if (e.key === 'Enter' && input.value.trim()) { const q = CinderTasks.parseQuick(input.value); back.remove(); if (q.text) addTask(CinderTasks.formatTask(q)); }
  });
  back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); });
}

// ```tasks blocks: a live query of tasks across the vault.
function renderTasksBlock(el, code) {
  el.classList.add('tasks-embed');
  CinderTasks.mountQuery(el, code, taskHooks());
}

function goHist(d) {
  const i = S.histIdx + d;
  if (i < 0 || i >= S.hist.length) return;
  S.histIdx = i;
  openPath(S.hist[i], { push: false });
}
function updateHistButtons() {
  $('[data-cmd=back]').disabled = S.histIdx <= 0;
  $('[data-cmd=forward]').disabled = S.histIdx >= S.hist.length - 1;
}

async function followLink(name, sub, from, opts = {}) {
  const target = resolveLink(name, from);
  if (target) {
    if (target === S.cur && sub) return scrollToHeading(sub);
    return openPath(target, { heading: sub || undefined });
  }
  // Unresolved: create it (Obsidian behaviour).
  const clean = name.replace(/\.md$/i, '');
  const path = clean.includes('/') ? normPath(clean) + '.md' : join(cfg.newNoteFolder, clean + '.md');
  await createNote(path, '', { mode: 'edit', ...opts });
}

function setMode(m, silent = false) {
  if (S.view !== 'note') return;
  if (!silent && S.mode === 'edit') rememberPos();
  S.mode = m;
  const reading = m === 'read';
  $('#edit-wrap').hidden = reading;
  preview.hidden = !reading;
  $('#mode-btn').innerHTML = reading
    ? '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M3 5.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3zM21 5.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z"/></svg>';
  $('#mode-btn').title = reading ? 'Edit (Ctrl+E)' : 'Reading view (Ctrl+E)';
  if (reading) renderPreview();
  else { ed.refresh(); if (!silent) ed.focus(); }
}

function scrollToHeading(h) {
  const n = S.notes.get(S.cur); if (!n) return;
  const want = h.replace(/^\^/, '').trim().toLowerCase();
  const hd = n.headings.find(x => x.text.trim().toLowerCase() === want) || n.headings.find(x => slug(x.text) === slug(want));
  if (S.mode === 'read') {
    const el = hd ? preview.querySelector(`#${CSS.escape('h-' + slug(hd.text))}`) : null;
    if (el) el.scrollIntoView({ block: 'start' });
  } else if (hd) {
    selectRange(hd.index, hd.index);
  }
}

function selectRange(a, b) {
  if (S.mode !== 'edit') setMode('edit');
  ed.focus();
  ed.setSelectionRange(a, b, true);
}

