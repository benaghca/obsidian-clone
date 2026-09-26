/* Cinder app — the quick switcher, commands, hotkeys, palette and shortcuts sheet. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// One launcher for everything: files by name, and after a prefix, commands (>), headings in
// the open note (@), tags (#) and text in any note (/). Ctrl+O opens it on files, Ctrl+P on
// commands; deleting the prefix switches back.
const LAUNCH_MODES = [['', 'Files'], ['>', 'Commands'], ['@', 'Headings'], ['#', 'Tags'], ['/', 'Text']];
function openSwitcher() { return openLauncher(''); }
function openPalette() { return openLauncher('>'); }

function openLauncher(prefix = '') {
  const files = [...S.files.keys()];
  const recentCmds = store('recentCmds') || [];
  const order = c => { const i = recentCmds.indexOf(c.id); return i < 0 ? 1e9 : i; };
  const modeOf = q => LAUNCH_MODES.find(([p]) => p && q.startsWith(p))?.[0] || '';
  const items = q => {
    const mode = modeOf(q), t = q.slice(mode.length).trim();
    if (mode === '>') return (t ? rank(COMMANDS, t, c => c.name) : [...COMMANDS].sort((a, b) => order(a) - order(b)))
      .map(c => ({ main: c.name, sub: fmtKey(keyFor(c)), value: { kind: 'cmd', c } }));
    if (mode === '@') {
      const n = S.cur && S.notes.get(S.cur);
      if (!n) return [];
      const hs = n.headings.map((h, i) => ({ ...h, i }));
      return (t ? rank(hs, t, h => h.text) : hs).map(h => ({ main: '  '.repeat(h.level - 1) + h.text, sub: 'H' + h.level, value: { kind: 'heading', text: h.text } }));
    }
    if (mode === '#') {
      const count = new Map();
      for (const n of S.notes.values()) for (const tg of n.tags) count.set(tg, (count.get(tg) || 0) + 1);
      return rank([...count].map(([tg, n]) => ({ tg, n })), t, x => x.tg).map(x => ({ main: '#' + x.tg, sub: `${x.n} note${x.n === 1 ? '' : 's'}`, value: { kind: 'tag', tag: x.tg } }));
    }
    if (mode === '/') {
      if (t.length < 2) return [];
      const out = [], lq = t.toLowerCase();
      for (const [p, n] of S.notes) {
        if (isDrawing(p)) continue;
        const low = n.content.toLowerCase();
        let i = low.indexOf(lq), k = 0;
        while (i >= 0 && k < 3 && out.length < 60) {
          const s = n.content.lastIndexOf('\n', i) + 1, e0 = n.content.indexOf('\n', i), e = e0 < 0 ? n.content.length : e0;
          const a = Math.max(s, i - 50), line = n.content.slice(a, Math.min(e, i + t.length + 70));
          const at = i - a;
          out.push({ main: line, mainHtml: `${a > s ? '…' : ''}${esc(line.slice(0, at))}<mark>${esc(line.slice(at, at + t.length))}</mark>${esc(line.slice(at + t.length))}`, sub: noteName(p), value: { kind: 'text', path: p, index: i, len: t.length } });
          i = low.indexOf(lq, i + t.length); k++;
        }
        if (out.length >= 60) break;
      }
      return out;
    }
    const r = rank(files, t, p => isMd(p) ? noteName(p) : basename(p)).map(p => ({ main: isMd(p) ? noteName(p) : basename(p), sub: dirname(p), value: { kind: 'file', path: p } }));
    if (t) for (const [a, p] of S.byAlias) if (a.includes(t.toLowerCase())) r.push({ main: a, sub: '→ ' + noteName(p), value: { kind: 'file', path: p } });
    if (!t) { const recent = S.recent.filter(p => S.files.has(p)); return [...recent.map(p => ({ main: noteName(p), sub: dirname(p) || 'recent', value: { kind: 'file', path: p } })), ...r.filter(x => !recent.includes(x.value.path))]; }
    return r;
  };
  const HINTS = { '': 'Find or create a note', '>': 'Run a command', '@': 'Go to a heading in this note', '#': 'Find notes with a tag', '/': 'Find text in any note' };
  const foot = q => {
    const m = modeOf(q);
    return `<span class="lm-modes">${LAUNCH_MODES.map(([p, name]) => `<span class="lm${p === m ? ' on' : ''}">${p ? `<kbd>${esc(p)}</kbd> ` : ''}${name}</span>`).join('')}</span><span class="lm-keys">${m === '' ? '↵ open · ctrl ↵ new tab · ⇧↵ create' : m === '>' ? '↵ run' : '↵ go'}</span>`;
  };
  return picker({
    placeholder: 'Find a note… or type > for commands, @ headings, # tags, / text',
    value: prefix, items, foot,
    createIf: q => modeOf(q) === '',
    empty: q => { const m = modeOf(q); return m === '@' && !(S.cur && S.notes.get(S.cur)) ? 'Open a note to jump to its headings' : m === '/' && q.slice(1).trim().length < 2 ? 'Type at least two letters' : 'No matches'; },
    onCreate: name => followLink(name, null, null),
  }).then(v => {
    if (!v) return;
    if (v.kind === 'file') return pickedWithMod ? openInNewTab(v.path) : openPath(v.path);
    if (v.kind === 'cmd') { store('recentCmds', [v.c.id, ...recentCmds.filter(x => x !== v.c.id)].slice(0, 12)); return v.c.run(); }
    if (v.kind === 'heading') return scrollToHeading(v.text);
    if (v.kind === 'tag') return searchFor(`tag:${v.tag}`);
    if (v.kind === 'text') return openPath(v.path, { mode: 'edit', select: [v.index, v.index + v.len] });
  });
}

// Every command, for the palette, hotkeys and the shortcuts sheet. `key` is the default binding
// in CodeMirror notation (Mod = Ctrl, or Cmd on a Mac); Settings → Hotkeys overrides it
// (cfg.hotkeys: id -> key, '' for none). Editor commands come from CinderEditor and are bound in
// the editor's own keymap, so they work while typing and never leak out of it.
const MAC = /Mac|iP(hone|ad)/.test(navigator.platform);
const inNote = f => () => S.view === 'note' ? f() : toast('Open a note first');
/** @typedef {{id: string, name: string, key: string, run: () => any, editor?: string}} Command */
/** @type {Command[]} */
const APP_COMMANDS = [
  ['switcher', 'Open quick switcher', 'Mod-o', () => openSwitcher()],
  ['palette', 'Open command palette', 'Mod-p', () => openPalette()],
  ['shortcuts', 'Show keyboard shortcuts', 'Mod-/', () => showShortcuts()],
  ['hotkeys', 'Customize hotkeys…', '', () => openHotkeys()],
  ['new-note', 'Create new note', 'Mod-n', () => newNote()],
  ['save', 'Save', 'Mod-s', () => save()],
  ['new-folder', 'Create new folder', '', () => newFolder(S.cur ? dirname(S.cur) : '')],
  ['new-drawing', 'Create new drawing', '', () => newDrawing()],
  ['new-canvas', 'Create new canvas', '', () => newCanvas()],
  ['new-base', 'Create new base', '', () => newBase()],
  ['drawing-in-note', 'Create new drawing and embed it in the current note', '', () => newDrawingInNote()],
  ['export-svg', 'Export drawing as SVG', '', () => exportDrawing('svg')],
  ['export-png', 'Export drawing as PNG', '', () => exportDrawing('png')],
  ['copy-drawing', 'Copy drawing as PNG', '', () => S.view === 'drawing' ? copyDrawing('png', false) : toast('Open a drawing first')],
  ['drawing-md', 'Open drawing as Markdown', '', () => S.cur && isMd(S.cur) && isDrawing(S.cur) ? openPath(S.cur, { raw: true }) : toast('Only .excalidraw.md drawings have a Markdown view')],
  ['daily', "Open today's daily note", '', () => openDaily()],
  ['daily-prev', 'Open the previous daily note', '', () => stepDaily(-1)],
  ['daily-next', 'Open the next daily note', '', () => stepDaily(1)],
  ['daily-tomorrow', "Open tomorrow's daily note", '', () => { const d = new Date(); d.setDate(d.getDate() + 1); openDaily(d); }],
  ['weekly', "Open this week's note", '', () => openPeriodic('week')],
  ['monthly', "Open this month's note", '', () => openPeriodic('month')],
  ['calendar', 'Show calendar', '', () => showRight('calendar')],
  ['related', 'Show related notes', '', () => showRight('related')],
  ['insert-template', 'Insert template', '', () => insertTemplate()],
  ['note-from-template', 'Create new note from template', '', () => newNoteFromTemplate()],
  ['run-templates', 'Replace template commands in current note', '', () => replaceTemplatesInNote()],
  ['templater-insert', 'Insert template command… (date, question, cursor…)', '', () => insertTemplaterCommand()],
  ['templater-help', 'Template commands cheat sheet', '', () => showTemplaterHelp()],
  ['template-preview', 'Preview the current template', '', () => previewTemplate()],
  ['new-template', 'Create new template', '', () => newTemplate()],
  ['toggle-mode', 'Toggle reading / editing view', 'Mod-e', () => { if (S.view === 'note') setMode(S.mode === 'edit' ? 'read' : 'edit'); }],
  ['search', 'Search in all notes', 'Mod-Shift-f', () => showPanel('search', true)],
  ['files', 'Focus the file tree', 'Mod-Shift-e', () => focusTree()],
  ['graph', 'Open graph view', 'Mod-g', () => openGraph(false)],
  ['local-graph', 'Open local graph of current note', '', () => openGraph(true)],
  ['back', 'Go back', 'Alt-ArrowLeft', () => goHist(-1)],
  ['forward', 'Go forward', 'Alt-ArrowRight', () => goHist(1)],
  ['rename', 'Rename current file', 'F2', () => S.cur && renameDialog(S.cur)],
  ['move', 'Move current file to folder…', '', () => S.cur && moveDialog(S.cur)],
  ['delete', 'Delete current file', '', () => S.cur && deletePath(S.cur)],
  ['history', 'Show version history of current file', '', () => openHistory()],
  ['export-pdf', 'Export current note to PDF (print)…', '', () => printNote()],
  ['export-html', 'Export current note to HTML', '', () => exportHtml()],
  ['copy-html', 'Copy current note as formatted text', '', () => copyHtml()],
  ['conflicts', 'Resolve conflicting copies (from OneDrive, Dropbox…)', '', () => listConflicts()],
  ['reveal', 'Reveal current file in file tree', '', () => S.cur && revealInTree(S.cur)],
  ['bookmark', 'Bookmark current file (or remove its bookmark)', '', () => S.cur ? toggleBookmark() : toast('Open a file first')],
  ['bookmarks', 'Show bookmarks', '', () => showPanel('bookmarks', true)],
  ['bookmark-search', 'Bookmark current search', '', () => bookmarkSearch()],
  ['bookmark-group', 'New bookmark group', '', () => newBookmarkGroup()],
  ['auto-reveal', 'Toggle auto-reveal current file in file tree', '', () => toggleAutoReveal()],
  ['expand-all', 'Expand all folders in file tree', '', () => setAllExpanded(true)],
  ['collapse-all', 'Collapse all folders in file tree', '', () => setAllExpanded(false)],
  ['toggle-left', 'Toggle left sidebar', 'Mod-\\', () => toggleSide('left')],
  ['backlinks', 'Show backlinks', 'Mod-Shift-b', () => showRight('backlinks')],
  ['all-properties', 'Show all properties', '', () => showPanel('props', true)],
  ['present', 'Present canvas', 'F5', () => S.view === 'canvas' ? CinderCanvas.present() : toast('Open a canvas to present it')],
  ['toggle-embed', 'Embed the link under the cursor (or show an embed as a link)', '', inNote(() => { setMode('edit'); toggleEmbed(ed, ed.selectionStart); })],
  ['outline', 'Show outline', 'Mod-Shift-o', () => showRight('outline')],
  ['outgoing', 'Show outgoing links', '', () => showRight('outgoing')],
  ['new-tab', 'New tab', 'Mod-t', () => openInNewTab(null, { switcher: true })],
  ['close-tab', 'Close tab', 'Mod-w', () => closeTab()],
  ['reopen-tab', 'Reopen closed tab', '', () => reopenClosedTab()],
  ['next-tab', 'Next tab', 'Mod-PageDown', () => cycleTab(1)],
  ['prev-tab', 'Previous tab', 'Mod-PageUp', () => cycleTab(-1)],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [`tab-${n}`, `Go to tab ${n}`, `Alt-${n}`, () => activateTab(n - 1)]),
  ['tab-last', 'Go to the last tab', 'Alt-9', () => activateTab(S.tabs.length - 1)],
  ['open-new-tab', 'Open current file in a new tab', '', () => openInNewTab(viewKey())],
  ['split-open', 'Open a file to the right (split pane)…', 'Mod-Alt-\\', () => openSplit()],
  ['split-current', 'Open current file to the right too', '', () => S.cur ? openSplit(S.cur) : toast('Open a file first')],
  ['split-close', 'Close the split pane', '', () => closeSplit()],
  ['split-swap', 'Swap the main and split panes', '', () => SPLIT.path ? swapSplit() : toast('Nothing is open in the split pane')],
  ['split-focus', 'Move between the main and split panes', '', () => { if (!SPLIT.path) return toast('Nothing is open in the split pane'); if ($('#split').contains(document.activeElement)) focusMain(); else SPLIT.handle ? SPLIT.handle.focus() : $('#split .split-body').focus(); }],
  ['recent', 'Switch to a recent file', MAC ? 'Ctrl-Tab' : 'Mod-Tab', () => recentSwitcher(1)],
  ['recent-back', 'Switch to a recent file (backwards)', MAC ? 'Ctrl-Shift-Tab' : 'Mod-Shift-Tab', () => recentSwitcher(-1)],
  ['toggle-right', 'Toggle right sidebar', 'Mod-Shift-\\', () => toggleSide('right')],
  ['tasks', 'Open tasks', 'Mod-Shift-t', () => openTasks()],
  ['inbox', 'Open inbox', 'Mod-Shift-i', () => openInbox()],
  ['inbox-capture', 'Add to inbox…', '', async () => { const t = await promptModal('Add to inbox', 'A quick note (it goes into the inbox folder)', '', { multiline: true }); if (t) inboxCapture(t); }],
  ['add-task', 'Add task…', '', () => quickAddTask()],
  ['screenshot', 'Insert screenshot', 'Mod-Shift-s', () => insertScreenshot()],
  ['screenshot-annotate', 'Insert screenshot and annotate it', 'Mod-Alt-s', () => insertScreenshot({ annotate: true })],
  ['screenshot-screen', 'Insert screenshot of the whole screen', '', () => insertScreenshot({ screen: true })],
  ['live-preview', 'Toggle live preview / source mode', '', () => { cfg.livePreview = !cfg.livePreview; saveCfg(); applyTheme(); toast(cfg.livePreview ? 'Live preview' : 'Source mode'); }],
  ['find', 'Find in current note', 'Mod-f', inNote(() => { setMode('edit'); ed.openSearch(); })],
  ['toggle-theme', 'Toggle light / dark theme', '', () => toggleTheme()],
  ['focus-mode', 'Toggle focus mode', 'Mod-Alt-z', () => toggleFocusMode()],
  ['typewriter', 'Toggle typewriter scrolling', '', () => { cfg.typewriter = !cfg.typewriter; saveCfg(); applyTheme(); toast(cfg.typewriter ? 'Typewriter scrolling' : 'Typewriter scrolling off'); }],
  ['insert-icon', 'Insert icon (Nerd Fonts)…', '', () => insertIcon()],
  ['choose-theme', 'Change colour theme…', '', () => chooseTheme()],
  ['random', 'Open random note', '', () => { const n = [...S.notes.keys()]; n.length && openPath(n[Math.floor(Math.random() * n.length)]); }],
  ['reload', 'Reload vault from disk', '', () => loadAll().then(() => toast('Reloaded'))],
  ['vault', 'Switch vault…', '', () => switchVault()],
  ['welcome', 'Open the welcome note', '', () => showWelcome()],
  ['settings', 'Settings', 'Mod-,', () => openSettings()],
].map((/** @type {[string, string, string, () => any]} */ [id, name, key, run]) => ({ id, name, key, run }));
const EDITOR_COMMANDS = Object.entries(CinderEditor.commands).map(([id, c]) => ({
  id: 'editor:' + id, name: id === 'add-property' ? c.name : `Format: ${c.name}`, key: c.key, editor: id,
  run: inNote(() => { setMode('edit'); ed.run(id); }),
}));
const COMMANDS = [...APP_COMMANDS, ...EDITOR_COMMANDS];
const CMD_BY_ID = new Map(COMMANDS.map(c => [c.id, c]));

const keyFor = c => (cfg.hotkeys && c.id in cfg.hotkeys ? cfg.hotkeys[c.id] : c.key) || '';
// Editor key overrides by the editor's own command ids, for CinderEditor.create / setKeys.
const editorKeys = () => Object.fromEntries(EDITOR_COMMANDS.map(c => [c.editor, keyFor(c)]));
let HOTKEYS = new Map(); // key -> app command
function rebuildHotkeys() {
  HOTKEYS = new Map();
  for (const c of APP_COMMANDS) { const k = keyFor(c); if (k && !HOTKEYS.has(k)) HOTKEYS.set(k, c); }
  ed.setKeys(editorKeys());
  for (const el of $$('[data-cmd][title]')) {
    const c = CMD_BY_ID.get(el.dataset.hk || el.dataset.cmd);
    if (!c) continue;
    const k = keyFor(c), base = el.title.replace(/\s*\([^)]*\)$/, '');
    el.title = k ? `${base} (${fmtKey(k)})` : base;
  }
}

// Punctuation keys by position, so Shift+key names the key rather than the shifted character.
const PUNCT_CODES = { Backslash: '\\', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Backquote: '`' };
// A keydown as a key string: [Mod-][Ctrl-/Meta-][Alt-][Shift-]key, letters lower case.
function keyOf(e) {
  const k = e.key;
  if (!k || k === 'Dead' || k === 'Unidentified' || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'].includes(k)) return null;
  let name = k.length === 1 ? k.toLowerCase() : k;
  if (/^Digit\d$/.test(e.code)) name = e.code.slice(5); // Shift+1 is "1", not "!"
  else if (e.shiftKey && PUNCT_CODES[e.code]) name = PUNCT_CODES[e.code]; // Shift+\ is "\", not "|"
  else if (/^Key[A-Z]$/.test(e.code) && !/^[a-z]$/.test(name)) name = e.code.slice(3).toLowerCase(); // Alt+letter on a Mac
  if (name === ' ') name = 'Space';
  const mod = MAC ? e.metaKey : e.ctrlKey, other = MAC ? e.ctrlKey : e.metaKey;
  return `${mod ? 'Mod-' : ''}${other ? (MAC ? 'Ctrl-' : 'Meta-') : ''}${e.altKey ? 'Alt-' : ''}${e.shiftKey ? 'Shift-' : ''}${name}`;
}
const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', Escape: 'Esc', Space: 'Space', Backspace: 'Backspace', Delete: 'Del' };
function fmtKey(k) {
  if (!k) return '';
  const parts = k.split(/-(?!$)/), key = parts.pop();
  const mods = parts.map(m => MAC ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }[m] : { Mod: 'Ctrl', Meta: 'Win' }[m] || m);
  const name = KEY_NAMES[key] || (key.length === 1 ? key.toUpperCase() : key);
  return MAC ? mods.join('') + name : [...mods, name].join('+');
}

// Keys belong to text fields while typing unless they use Ctrl/Cmd/Alt or are function keys.
const typingIn = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
// Registered at boot, after the canvas and drawing views, so their own keys (Ctrl+G to group,
// Alt+arrows between cards…) win while they're open.
function onHotkey(e) {
  if ($('#modal-root').children.length || e.defaultPrevented) return;
  const k = keyOf(e);
  const c = k && HOTKEYS.get(k);
  if (!c) return;
  if (!/(^|-)(Mod|Ctrl|Meta|Alt)-/.test(k) && !/^(Shift-)?F\d+$/.test(k) && typingIn(e.target)) return;
  e.preventDefault();
  c.run();
}

rebuildHotkeys();

// ------------------------------------------------------------ Settings → Hotkeys

// Hotkeys are a page of Settings.
function openHotkeys(filter = '') { openSettings('hotkeys', filter); }

// The hotkeys list, inside `box` (Settings' Hotkeys page). `close` shuts the dialog it's in.
function mountHotkeys(box, filter, close) {
  box.innerHTML = `<div class="hk"><div class="hk-head"><input class="field hk-q" placeholder="Filter commands or keys…" spellcheck="false"></div>
    <div class="hk-list" tabindex="-1"></div>
    <div class="hk-foot"><span>Click a shortcut to change it. Press the new keys, <kbd>Backspace</kbd> to clear, <kbd>Esc</kbd> to cancel.</span><button class="btn" data-x-shortcuts>All shortcuts</button></div></div>`;
  const back = box;
  const q = $('.hk-q', back), list = $('.hk-list', back);
  let recording = null;
  const conflictsOf = c => {
    const k = keyFor(c);
    if (!k) return [];
    return COMMANDS.filter(o => o !== c && keyFor(o) === k && (!!o.editor === !!c.editor || !o.editor || !c.editor)).map(o => o.name);
  };
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    const rows = COMMANDS.filter(c => !f || c.name.toLowerCase().includes(f) || fmtKey(keyFor(c)).toLowerCase().includes(f));
    list.innerHTML = rows.map(c => {
      const k = keyFor(c), custom = cfg.hotkeys && c.id in cfg.hotkeys, clash = conflictsOf(c);
      return `<div class="hk-row${clash.length ? ' clash' : ''}" data-id="${esc(c.id)}"><span class="hk-name">${esc(c.name)}${clash.length ? `<small>Also used by: ${esc(clash.join(', '))}</small>` : ''}</span>
        <button class="hk-key${recording === c.id ? ' rec' : ''}${k ? '' : ' none'}" data-rec>${recording === c.id ? 'Press keys…' : k ? esc(fmtKey(k)) : 'Blank'}</button>
        <button class="ib hk-reset" data-reset title="Restore the default${c.key ? ` (${esc(fmtKey(c.key))})` : ' (none)'}" ${custom ? '' : 'disabled'}>↺</button></div>`;
    }).join('') || '<div class="none">No matching commands</div>';
  };
  // Redraw, keeping the keyboard on the row just changed.
  const redraw = id => { draw(); if (id) $(`.hk-row[data-id="${CSS.escape(id)}"] .hk-key`, list)?.focus(); };
  const setKey = (id, k) => {
    cfg.hotkeys = { ...(cfg.hotkeys || {}) };
    const c = CMD_BY_ID.get(id);
    if (k === c.key) delete cfg.hotkeys[id]; else cfg.hotkeys[id] = k;
    saveCfg(); rebuildHotkeys();
  };
  list.addEventListener('click', e => {
    const row = e.target.closest('.hk-row');
    if (!row) return;
    if (e.target.closest('[data-rec]')) { recording = recording === row.dataset.id ? null : row.dataset.id; redraw(row.dataset.id); }
    else if (e.target.closest('[data-reset]')) { setKey(row.dataset.id, CMD_BY_ID.get(row.dataset.id).key); redraw(row.dataset.id); }
  });
  back.addEventListener('keydown', e => {
    if (!recording) return;
    e.preventDefault(); e.stopPropagation();
    const id = recording;
    if (e.key === 'Escape') { recording = null; redraw(id); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) { setKey(id, ''); recording = null; redraw(id); return; }
    const k = keyOf(e);
    if (!k) return; // a lone modifier: keep waiting
    setKey(id, k); recording = null; redraw(id);
  }, true);
  $('[data-x-shortcuts]', back).onclick = () => { close(); showShortcuts(); };
  q.value = filter;
  q.addEventListener('input', draw);
  draw(); q.focus();
}

// ------------------------------------------------------------ shortcuts sheet

// Everything bound, plus the fixed keys of each view (canvas and drawing keys live in their help).
function showShortcuts() {
  const bound = cs => cs.filter(c => keyFor(c)).map(c => `<p><span>${esc(c.name.replace(/^Format: /, ''))}</span><kbd>${esc(fmtKey(keyFor(c)))}</kbd></p>`).join('');
  const fixed = rows => rows.map(([n, k]) => `<p><span>${esc(n)}</span><span class="keys">${k.split(' / ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</span></p>`).join('');
  const M = MAC ? '⌘' : 'Ctrl+', A = MAC ? '⌥' : 'Alt+', S_ = MAC ? '⇧' : 'Shift+';
  const back = modal(`<div class="dr-help shortcuts"><h3>Keyboard shortcuts</h3><div class="dr-help-cols">
    <div><h4>App</h4>${bound(APP_COMMANDS.filter(c => !/^tab-(\d|last)$/.test(c.id)))}${fixed([['Go to tab 1–8 / the last', `${A}1…${A}8 / ${A}9`]])}</div>
    <div><h4>Editing</h4>${bound(EDITOR_COMMANDS)}${fixed([['Move line up / down', `${A}↑ / ${A}↓`], ['Copy line', `${S_}${A}↑ / ${S_}${A}↓`], ['Select next match', `${M}D`], ['Indent / outdent list', `Tab / ${S_}Tab`], ['Follow link under cursor', `${M}click`], ['Undo / redo', `${M}Z / ${M}${S_}Z`]])}</div>
    <div><h4>File tree</h4>${fixed([['Move', '↑ / ↓'], ['Expand / collapse', '→ / ←'], ['Open', 'Enter'], ['Open in a new tab', `${M}Enter / middle-click`], ['Select several', `${S_}↑↓ / ${M}click / ${S_}click`], ['Rename', 'F2'], ['Delete', 'Del'], ['New note here', `${M}N`], ['Back to the page', 'Esc']])}
      <h4>Lists (search, tasks)</h4>${fixed([['Move', '↑ / ↓'], ['Open', 'Enter'], ['Tick a task', 'Space / X'], ['Due today / tomorrow', 'T / M']])}
      <h4>Backlinks / outline pane</h4>${fixed([['Switch tab', '← / →'], ['Preview a heading', 'Space'], ['Link an unlinked mention', 'L']])}
      <h4>Recent files</h4>${fixed([['Step through (hold Ctrl)', 'Tab / Shift+Tab'], ['Open', 'release Ctrl']])}
      <h4>Viewer</h4>${fixed([['Previous / next image', '← / →'], ['Zoom', '+ / - / 0 / 1']])}</div>
  </div><div class="shortcuts-foot"><button class="btn" data-hk>Customize hotkeys…</button><span>Canvas and drawing shortcuts: press <kbd>?</kbd> in those views.</span></div></div>`);
  back.tabIndex = -1; back.focus();
  back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape' || keyOf(e) === keyFor(CMD_BY_ID.get('shortcuts'))) { e.preventDefault(); back.remove(); } });
  $('[data-hk]', back).onclick = () => { back.remove(); openHotkeys(); };
}

