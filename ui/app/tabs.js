/* Cinder app — tabs. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ tabs

// Each tab shows one thing: a file, the graph (':graph'), tasks (':tasks'), or nothing (null).
// A tab has its own back/forward history (swapped in and out of S.hist), and a note keeps its
// editor state, undo history included, while it's open in a tab.
S.tabs = []; S.tab = -1;
const edStates = new Map(); // note path -> editor state
const closedTabs = [];      // keys, for "Reopen closed tab"
let tabSeq = 0;
const newTabObj = key => ({ id: ++tabSeq, key, hist: key ? [key] : [], histIdx: key ? 0 : -1 });
const curTab = () => S.tabs[S.tab];
const viewKey = () => S.view === 'graph' ? ':graph' : S.view === 'tasks' ? ':tasks' : S.view === 'inbox' ? ':inbox' : S.view === 'empty' ? null : S.cur;
const tabName = k => k == null ? 'New tab' : k === ':graph' ? 'Graph' : k === ':tasks' ? 'Tasks' : k === ':inbox' ? 'Inbox' : displayName(k);

// The page changed what it shows (see showView): the current tab follows.
function syncTab() {
  if (!S.tabs.length) { S.tabs.push(newTabObj(null)); S.tab = 0; }
  const t = curTab();
  t.key = viewKey(); t.hist = S.hist; t.histIdx = S.histIdx;
  pruneEdStates();
  saveTabs(); renderTabs();
}
function pruneEdStates() { const open = new Set(S.tabs.map(t => t.key)); for (const k of edStates.keys()) if (!open.has(k)) edStates.delete(k); }
function saveTabs() { store('tabs', { keys: S.tabs.map(t => t.key), active: S.tab }); }

// Show tab i: its history comes back and its thing reopens.
async function activateTab(i, opts = {}) {
  if (i < 0 || i >= S.tabs.length) return;
  if (i === S.tab && !opts.force) return focusMain();
  const t = S.tabs[i];
  const old = curTab();
  if (old) { old.hist = S.hist; old.histIdx = S.histIdx; }
  S.tab = i; S.hist = t.hist; S.histIdx = t.histIdx;
  await openKey(t.key, opts);
}
async function openKey(k, opts = {}) {
  if (k === ':graph') return openGraph(false);
  if (k === ':tasks') return openTasks();
  if (k === ':inbox') return openInbox();
  if (k && S.files.has(k)) return openPath(k, { push: false, ...opts });
  flushDocViews(); await save(); rememberPos();
  S.cur = null; showEmpty();
}

// Open something in a new tab next to the current one (or at the end).
async function openInNewTab(k, opts = {}) {
  const old = curTab();
  if (old) { old.hist = S.hist; old.histIdx = S.histIdx; }
  const t = newTabObj(null);
  S.tabs.splice(S.tab + 1, 0, t);
  S.tab = S.tab + 1; S.hist = []; S.histIdx = -1;
  if (k == null) { await openKey(null); if (opts.switcher) openSwitcher(); return; }
  if (k.startsWith(':')) return openKey(k);
  await openPath(k, opts);
}

async function closeTab(i = S.tab) {
  const t = S.tabs[i];
  if (!t) return;
  if (i === S.tab) await save();
  if (t.key) closedTabs.push(t.key);
  if (S.tabs.length === 1) { S.tabs[0] = newTabObj(null); S.tab = 0; S.hist = []; S.histIdx = -1; return openKey(null); }
  S.tabs.splice(i, 1);
  if (i === S.tab) { S.tab = -1; await activateTab(Math.min(i, S.tabs.length - 1), { force: true }); }
  else { if (i < S.tab) S.tab--; saveTabs(); renderTabs(); }
  pruneEdStates();
}
async function closeTabs(keep) {
  const keepTabs = S.tabs.filter((t, i) => keep(t, i));
  if (!keepTabs.length) return;
  const cur = curTab();
  for (const t of S.tabs) if (!keepTabs.includes(t) && t.key) closedTabs.push(t.key);
  S.tabs = keepTabs;
  const i = S.tabs.indexOf(cur);
  if (i >= 0) { S.tab = i; saveTabs(); renderTabs(); pruneEdStates(); }
  else { S.tab = -1; await activateTab(0, { force: true }); }
}
function reopenClosedTab() {
  while (closedTabs.length) {
    const k = closedTabs.pop();
    if (k.startsWith(':') || S.files.has(k)) return openInNewTab(k);
  }
  toast('No closed tabs to reopen');
}
const cycleTab = d => S.tabs.length > 1 && activateTab((S.tab + d + S.tabs.length) % S.tabs.length);

// Files renamed or deleted: tabs follow, or close.
function tabsAfterRename(moved) {
  for (const t of S.tabs) { if (moved.has(t.key)) t.key = moved.get(t.key); t.hist = t.hist.map(h => moved.get(h) || h); }
  for (const [a, b] of moved) if (edStates.has(a)) { edStates.set(b, edStates.get(a)); edStates.delete(a); }
  saveTabs(); renderTabs();
}
function tabsAfterDelete() {
  const gone = k => k && !k.startsWith(':') && !S.files.has(k);
  for (const t of S.tabs) { t.hist = t.hist.filter(h => !gone(h)); t.histIdx = Math.min(t.histIdx, t.hist.length - 1); }
  const cur = curTab();
  S.tabs = S.tabs.filter(t => t === cur || !gone(t.key));
  S.tab = S.tabs.indexOf(cur);
  if (gone(cur?.key)) cur.key = null;
  pruneEdStates(); saveTabs(); renderTabs();
}

function renderTabs() {
  const bar = $('#tabbar .tabs-list');
  bar.innerHTML = S.tabs.map((t, i) => `<div class="tab${i === S.tab ? ' active' : ''}" data-i="${i}" draggable="true" title="${esc(t.key && !t.key.startsWith(':') ? t.key : tabName(t.key))}" role="tab" aria-selected="${i === S.tab}"><span class="tab-name">${esc(tabName(t.key))}</span><button class="tab-x" tabindex="-1" title="Close (Ctrl+W)">×</button></div>`).join('');
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let dragTab = null;
$('#tabbar').addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest('.tab')) e.preventDefault(); }); // no autoscroll
$('#tabbar').addEventListener('click', e => {
  if (e.target.closest('.tab-new')) return openInNewTab(null, { switcher: true });
  const tab = e.target.closest('.tab');
  if (!tab) return;
  if (e.target.closest('.tab-x')) return closeTab(+tab.dataset.i);
  activateTab(+tab.dataset.i);
});
$('#tabbar').addEventListener('auxclick', e => { const tab = e.target.closest('.tab'); if (tab && e.button === 1) closeTab(+tab.dataset.i); });
$('#tabbar').addEventListener('dblclick', e => { if (!e.target.closest('.tab, button') && !document.body.classList.contains('frame-custom')) openInNewTab(null, { switcher: true }); });
$('#tabbar').addEventListener('contextmenu', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  e.preventDefault();
  const i = +tab.dataset.i, t = S.tabs[i];
  menu(e.clientX, e.clientY, [
    ['Close', () => closeTab(i)],
    ['Close other tabs', () => closeTabs(x => x === t)],
    ['Close tabs to the right', () => closeTabs((x, j) => j <= i)],
    null,
    ['Duplicate tab', () => { activateTab(i).then(() => openInNewTab(t.key)); }],
    ...(t.key && !t.key.startsWith(':') ? [['Reveal in file tree', () => revealInTree(t.key)], ['Copy path', () => navigator.clipboard?.writeText(t.key).then(() => toast('Path copied'))]] : []),
  ]);
});
$('#tabbar').addEventListener('dragstart', e => { const tab = e.target.closest('.tab'); if (!tab) return; dragTab = S.tabs[+tab.dataset.i]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tabName(dragTab.key)); });
$('#tabbar').addEventListener('dragover', e => {
  if (!dragTab) return;
  const tab = e.target.closest('.tab');
  e.preventDefault();
  $$('#tabbar .tab.drop-before, #tabbar .tab.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (tab) { const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
});
$('#tabbar').addEventListener('drop', e => {
  if (!dragTab) return;
  e.preventDefault();
  const tab = e.target.closest('.tab'), cur = curTab(), moving = dragTab;
  let to = S.tabs.length;
  if (tab) { const r = tab.getBoundingClientRect(); to = +tab.dataset.i + (e.clientX < r.left + r.width / 2 ? 0 : 1); }
  const from = S.tabs.indexOf(moving);
  S.tabs.splice(from, 1);
  S.tabs.splice(to > from ? to - 1 : to, 0, moving);
  S.tab = S.tabs.indexOf(cur);
  dragTab = null; saveTabs(); renderTabs();
});
$('#tabbar').addEventListener('dragend', () => { dragTab = null; $$('#tabbar .drop-before, #tabbar .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });

// Start with the tabs from last time (or the last file, in one tab).
async function restoreTabs() {
  const saved = store('tabs');
  const keys = (saved?.keys || []).filter(k => k == null || k.startsWith(':') || S.files.has(k));
  if (!keys.length) {
    const last = store('last');
    S.tabs = [newTabObj(last && S.files.has(last) ? last : null)];
  } else S.tabs = keys.map(newTabObj);
  S.tab = -1;
  await activateTab(Math.max(0, Math.min(saved?.active ?? 0, S.tabs.length - 1)), { force: true, focus: false });
}

