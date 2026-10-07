/* Cinder app — the Settings window. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * Every setting is one entry in SETTINGS, placed on a page (SETTINGS_PAGES). The window draws a
 * page as rows (name and description on the left, the control on the right), and the search box
 * finds settings on every page. Changes apply as they're made; there's no Save button. */

const SETTINGS_PAGES = [
  { id: 'general', name: 'General', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>' },
  { id: 'editor', name: 'Editor', icon: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>' },
  { id: 'appearance', name: 'Appearance', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>' },
  { id: 'files', name: 'Files & links', icon: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>' },
  { id: 'daily', name: 'Daily & weekly notes', icon: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' },
  { id: 'templates', name: 'Templates', icon: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>' },
  { id: 'tasks', name: 'Tasks', icon: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="m8 12 3 3 5-6"/>' },
  { id: 'inbox', name: 'Inbox', icon: '<path d="M3.5 13.5l2.6-7.2A2 2 0 0 1 8 5h8a2 2 0 0 1 1.9 1.3l2.6 7.2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/>' },
  { id: 'media', name: 'Images & screenshots', icon: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4"/>' },
  { id: 'drawings', name: 'Drawings', icon: '<rect x="3.5" y="12.5" width="8" height="8" rx="1.5"/><circle cx="16.5" cy="7.5" r="4"/><path d="M13.5 20.5l7-7"/>' },
  { id: 'hotkeys', name: 'Hotkeys', icon: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>' },
];

// type: toggle | select | text | textarea | font | custom. `folder` trims slashes from the value.
// `apply` names what has to be redrawn after a change (see applySetting).
const SETTINGS = [
  // General
  { k: 'vault', page: 'general', name: 'Vault', desc: 'The folder of notes Cinder has open.', type: 'custom', render: settingVault },
  { k: 'defaultMode', page: 'general', name: 'Open notes in', desc: 'The view a note opens in. Ctrl+E switches between them.', type: 'select', options: [['edit', 'Editing view'], ['read', 'Reading view']] },
  { k: 'autoReveal', page: 'general', name: 'Reveal the open file in the file tree', desc: 'Opening a file opens its folders and scrolls the tree to it.', type: 'toggle', apply: 'tree' },
  { k: 'hoverPreview', page: 'general', name: 'Preview links on hover', desc: 'Hover a link in reading view to see the note. In the editor, and for web pages, hold Ctrl while hovering.', type: 'toggle' },
  { k: 'windowFrame', page: 'general', name: 'Window frame', desc: 'Cinder’s own title bar matches the theme; drag the tab bar to move the window.', type: 'select', options: [['custom', 'Cinder’s own'], ['native', 'The system’s title bar']], when: () => NATIVE, apply: 'frame' },
  // Editor
  { k: 'livePreview', page: 'editor', name: 'Live preview', desc: 'Hide Markdown syntax except on the line you’re editing. Off shows plain source.', type: 'toggle', apply: 'theme' },
  { k: 'readable', page: 'editor', name: 'Readable line length', desc: 'Keep lines to a comfortable width instead of filling the window.', type: 'toggle', apply: 'theme' },
  { k: 'focusMode', page: 'editor', name: 'Focus mode', desc: 'Hide the side bars and tabs, and dim everything but the paragraph you’re writing. The ◎ in the status bar switches it too.', type: 'toggle', apply: 'theme' },
  { k: 'stickyLayout', page: 'inbox', name: 'Sticky layout in a thin window', desc: 'Narrow the window (to sit at the side of the screen, say) and it becomes a list of your stickies, as a sticky-notes app. Widen it and everything comes back.', type: 'toggle', apply: 'layout' },
  { k: 'focusOutline', page: 'editor', name: 'Outline in focus mode', desc: 'A quiet outline of the note beside the text, its current section lit with the paragraph. The ☰ in the status bar (in focus mode) switches it too.', type: 'toggle', apply: 'theme' },
  { k: 'typewriter', page: 'editor', name: 'Typewriter scrolling', desc: 'Keep the line you’re typing on in the middle of the window.', type: 'toggle', apply: 'theme' },
  { k: 'vim', page: 'editor', name: 'Vim key bindings', desc: 'Edit with Vim’s modes and motions.', type: 'toggle', apply: 'theme' },
  { k: 'pasteHtml', page: 'editor', name: 'Paste rich text as Markdown', desc: 'Text copied from a web page or a document keeps its headings, lists, links and bold as Markdown. <kbd>Ctrl+Shift+V</kbd> pastes plain text either way.', type: 'toggle' },
  { k: 'mathSnippets', page: 'editor', name: 'Math shortcuts', desc: 'While typing an equation: <code>//</code> makes a fraction, <code>@a</code> α, <code>mk</code>+Tab starts inline math, and more.', type: 'toggle' },
  { k: 'properties', page: 'editor', name: 'Properties at the top of notes', desc: 'Show the frontmatter as a table you can edit, or as its YAML text.', type: 'select', options: [['visible', 'Table'], ['source', 'YAML text']], apply: 'editor' },
  { k: 'webEmbeds', page: 'editor', name: 'Embedded web pages', desc: 'What <code>![](https://…)</code> and canvas link cards show.', type: 'select', options: [['auto', 'The live page'], ['click', 'The page, once clicked'], ['off', 'Just the link']], apply: 'editor' },
  // Appearance
  { k: 'theme', page: 'appearance', name: 'Light or dark', type: 'select', options: [['', 'Follow the system'], ['dark', 'Dark'], ['light', 'Light']], apply: 'theme' },
  { k: 'palette', page: 'appearance', name: 'Colour theme', desc: 'Each theme has a light and a dark version.', type: 'custom', render: settingThemes, wide: true },
  { k: 'fontText', page: 'appearance', name: 'Text font', desc: 'Any font installed on this computer. Empty uses the system font.', type: 'font', list: ['Inter', 'Segoe UI', 'Noto Sans', 'Ubuntu', 'Georgia', 'Iowan Old Style', 'Literata', 'JetBrains Mono'], placeholder: 'System font', apply: 'theme' },
  { k: 'fontMono', page: 'appearance', name: 'Code font', desc: 'Empty uses JetBrains Mono, which comes with Cinder.', type: 'font', list: ['JetBrains Mono', 'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'Hack Nerd Font', 'Iosevka', 'Fira Code', 'Cascadia Code', 'Consolas', 'Menlo', 'Ubuntu Mono'], placeholder: 'JetBrains Mono', apply: 'theme' },
  { k: 'fontPreview', page: 'appearance', name: 'Font preview', type: 'custom', render: settingFontPreview, wide: true, search: false },
  { k: 'mono', page: 'appearance', name: 'Monospace editor', desc: 'Write in the code font.', type: 'toggle', apply: 'theme' },
  { k: 'cssFolder', page: 'appearance', name: 'CSS snippets folder', desc: 'Every <code>.css</code> file in this vault folder styles Cinder, and reloads as you edit it. Pair with a note’s <code>cssclasses</code>.', type: 'text', folder: true, placeholder: 'e.g. Snippets', apply: 'css' },
  // Files & links
  { k: 'newNoteFolder', page: 'files', name: 'Folder for new notes', desc: 'Where Ctrl+N and new links put notes.', type: 'text', folder: true, placeholder: 'The vault’s top folder' },
  { k: 'attachFolder', page: 'files', name: 'Attachments folder', desc: 'Where pasted and dropped images and files are saved.', type: 'text', folder: true },
  // Daily notes
  { k: 'periodicPreview', page: 'daily', name: 'Today’s notes would be', type: 'custom', render: settingPeriodicPreview, wide: true, search: false },
  { k: 'dailyFolder', page: 'daily', name: 'Daily notes folder', type: 'text', folder: true },
  { k: 'dailyFormat', page: 'daily', name: 'Daily note name', desc: 'A date format: <code>YYYY-MM-DD</code>, <code>dddd, MMMM Do YYYY</code>… (as in Obsidian).', type: 'text', placeholder: 'YYYY-MM-DD' },
  { k: 'dailyTemplate', page: 'daily', name: 'Daily note template', desc: 'A note name or path. Its text starts each new daily note, with that day’s date in its date commands.', type: 'text', placeholder: 'e.g. Templates/Daily' },
  { k: 'weeklyFolder', page: 'daily', name: 'Weekly notes folder', desc: 'Empty uses the daily notes folder.', type: 'text', folder: true, placeholder: 'The daily notes folder' },
  { k: 'weeklyFormat', page: 'daily', name: 'Weekly note name', desc: '<code>GGGG-[W]WW</code> gives 2026-W39.', type: 'text', placeholder: 'GGGG-[W]WW' },
  { k: 'weeklyTemplate', page: 'daily', name: 'Weekly note template', type: 'text', placeholder: 'e.g. Templates/Weekly' },
  { k: 'monthlyFolder', page: 'daily', name: 'Monthly notes folder', desc: 'Empty uses the daily notes folder.', type: 'text', folder: true, placeholder: 'The daily notes folder' },
  { k: 'monthlyFormat', page: 'daily', name: 'Monthly note name', type: 'text', placeholder: 'YYYY-MM' },
  { k: 'monthlyTemplate', page: 'daily', name: 'Monthly note template', type: 'text', placeholder: 'e.g. Templates/Monthly' },
  { k: 'weekStart', page: 'daily', name: 'Weeks in the calendar start on', type: 'select', options: [['monday', 'Monday'], ['sunday', 'Sunday']], apply: 'calendar' },
  // Templates
  { k: 'templateHelp', page: 'templates', name: 'Template commands', desc: 'Type <code>&lt;%</code> in a note to pick a command (a date, a question, the cursor…) from a list. The cheat sheet shows them all.', type: 'custom', render: settingTemplateHelp },
  { k: 'templatesFolder', page: 'templates', name: 'Templates folder', desc: 'The notes <i>Insert template</i> offers.', type: 'text', folder: true },
  { k: 'folderTemplates', page: 'templates', name: 'Folder templates', desc: 'New notes in a folder start from its template. One per line, as <code>Folder: Template</code>; <code>/</code> means every folder.', type: 'textarea', placeholder: 'Meetings: Templates/Meeting' },
  // Tasks
  { k: 'taskInbox', page: 'tasks', name: 'New tasks go to', desc: 'A note path. Empty means today’s daily note.', type: 'text', placeholder: 'Today’s daily note' },
  { k: 'taskSuggest', page: 'tasks', name: 'Suggest dates and priorities in task lines', desc: 'Typing “due”, “every”, “high”… in a task offers 📅 🔁 ⏫ and dates, as the Tasks plugin does.', type: 'toggle' },
  { k: 'taskDoneDate', page: 'tasks', name: 'Add a done date', desc: 'Ticking a task adds ✅ and the date.', type: 'toggle' },
  // Inbox
  { k: 'inboxFolder', page: 'inbox', name: 'Inbox folder', desc: 'Where things you capture on your phone or elsewhere land. The Inbox shows what’s in it.', type: 'text', folder: true, placeholder: 'Inbox' },
  // Images & screenshots
  { k: 'screenshotHide', page: 'media', name: 'Hide Cinder while taking a screenshot', desc: 'The desktop window steps aside so you can capture what’s behind it.', type: 'toggle', when: () => NATIVE },
  { k: 'screenshotDelay', page: 'media', name: 'Screenshot delay', desc: 'Wait before capturing, to catch menus and hover states.', type: 'select', options: [['0', 'None'], ['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds']] },
  { k: 'screenshotAfter', page: 'media', name: 'After a screenshot', type: 'select', options: [['insert', 'Insert it'], ['annotate', 'Open it in a drawing to annotate']] },
  // Drawings
  { k: 'drawingFormat', page: 'drawings', name: 'Save new drawings as', desc: '<code>.excalidraw</code> also opens on excalidraw.com; <code>.excalidraw.md</code> is the Obsidian Excalidraw plugin’s format.', type: 'select', options: [['excalidraw', '.excalidraw'], ['md', '.excalidraw.md']] },
];

let settingsBack = null;
function openSettings(page = 'general', filter = '') {
  settingsBack?.remove();
  const back = settingsBack = modal(`<div class="st" role="dialog" aria-label="Settings">
    <nav class="st-nav">
      <input class="field st-q" type="search" placeholder="Search settings…" spellcheck="false" aria-label="Search settings">
      <div class="st-pages" role="tablist" aria-orientation="vertical">${SETTINGS_PAGES.map(p => `<button class="st-page" role="tab" data-page="${p.id}"><svg viewBox="0 0 24 24">${p.icon}</svg><span>${esc(p.name)}</span></button>`).join('')}</div>
    </nav>
    <section class="st-body"><header class="st-head"><h2></h2><button class="ib" data-x title="Close (Esc)" aria-label="Close settings"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button></header><div class="st-content"></div></section>
  </div>`);
  back.querySelector('.modal').classList.add('settings-modal');
  const q = $('.st-q', back), content = $('.st-content', back), title = $('.st-head h2', back);
  let cur = page;
  const close = () => { back.remove(); if (settingsBack === back) settingsBack = null; };

  const show = (id, hkFilter = '') => {
    cur = id;
    for (const b of $$('.st-page', back)) { b.classList.toggle('active', b.dataset.page === id && !q.value.trim()); b.setAttribute('aria-selected', String(b.dataset.page === id)); }
    title.textContent = SETTINGS_PAGES.find(p => p.id === id)?.name || '';
    content.scrollTop = 0;
    if (id === 'hotkeys') { content.innerHTML = '<div class="st-hk"></div>'; mountHotkeys($('.st-hk', content), hkFilter, close); return; }
    content.innerHTML = '';
    for (const s of SETTINGS.filter(s => s.page === id && (!s.when || s.when()))) content.append(settingRow(s, content));
  };
  const search = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return show(cur);
    for (const b of $$('.st-page', back)) b.classList.remove('active');
    title.textContent = 'Search results';
    content.innerHTML = ''; content.scrollTop = 0;
    const hay = s => `${s.name} ${(s.desc || '').replace(/<[^>]+>/g, '')} ${SETTINGS_PAGES.find(p => p.id === s.page).name}`.toLowerCase();
    const found = SETTINGS.filter(s => s.search !== false && (!s.when || s.when()) && words.every(w => hay(s).includes(w)));
    let last = null;
    for (const s of found) {
      if (s.page !== last) { last = s.page; const h = document.createElement('h4'); h.className = 'st-group'; h.textContent = SETTINGS_PAGES.find(p => p.id === s.page).name; content.append(h); }
      content.append(settingRow(s, content, words));
    }
    // Commands whose name matches send the search on to Hotkeys.
    const cmds = COMMANDS.filter(c => words.every(w => c.name.toLowerCase().includes(w))).length;
    if (cmds) {
      const a = document.createElement('button'); a.className = 'st-more';
      a.innerHTML = `<span>${cmds} command${cmds === 1 ? '' : 's'} in Hotkeys match</span><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>`;
      a.onclick = () => { const f = q.value.trim(); q.value = ''; show('hotkeys', f); };
      content.append(a);
    }
    if (!found.length && !cmds) content.innerHTML = `<div class="st-none">No settings match “${esc(q.value.trim())}”.</div>`;
  };

  $('.st-pages', back).addEventListener('click', e => { const b = e.target.closest('.st-page'); if (b) { q.value = ''; show(b.dataset.page); } });
  $('.st-pages', back).addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const bs = $$('.st-page', back), i = bs.indexOf(document.activeElement);
    const b = bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length];
    b.focus(); q.value = ''; show(b.dataset.page);
  });
  q.addEventListener('input', search);
  q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); $('input, select, textarea, button', content)?.focus(); } });
  $('[data-x]', back).onclick = close;
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (q.value && document.activeElement === q) { q.value = ''; search(); } else close();
  });
  if (filter && page !== 'hotkeys') { q.value = filter; search(); } else show(page, filter);
  if (page !== 'hotkeys') q.focus();
  return back;
}

// One setting's row: its name and description, its control, and a reset button once changed.
function settingRow(s, content, words = []) {
  const row = document.createElement('div');
  row.className = 'st-row' + (s.wide ? ' wide' : '') + (s.type === 'textarea' ? ' tall' : '');
  row.dataset.k = s.k;
  const id = 'st-' + s.k;
  row.innerHTML = `<div class="st-info"><label class="st-name" for="${id}">${esc(s.name)}</label>${s.desc ? `<div class="st-desc">${s.desc}</div>` : ''}</div><div class="st-ctl"></div>`;
  if (words.length) markWords($('.st-info', row), words);
  const ctl = $('.st-ctl', row);
  if (s.type === 'custom') { s.render(ctl, row); return row; }
  let el;
  if (s.type === 'toggle') {
    ctl.innerHTML = `<label class="switch"><input type="checkbox" id="${id}" name="${s.k}"><span></span></label>`;
    el = $('input', ctl); el.checked = !!cfg[s.k];
  } else if (s.type === 'select') {
    ctl.innerHTML = `<select class="field" id="${id}" name="${s.k}">${s.options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`;
    el = $('select', ctl); el.value = cfg[s.k];
  } else if (s.type === 'textarea') {
    ctl.innerHTML = `<textarea class="field" id="${id}" name="${s.k}" rows="3" spellcheck="false" placeholder="${esc(s.placeholder || '')}"></textarea>`;
    el = $('textarea', ctl); el.value = cfg[s.k];
  } else {
    const list = s.type === 'font' ? `<datalist id="${id}-list">${s.list.map(f => `<option>${esc(f)}</option>`).join('')}</datalist>` : '';
    ctl.innerHTML = `<input class="field" id="${id}" name="${s.k}" spellcheck="false" placeholder="${esc(s.placeholder || '')}"${list ? ` list="${id}-list"` : ''}>${list}`;
    el = $('input', ctl); el.value = cfg[s.k];
  }
  const reset = document.createElement('button');
  reset.className = 'ib st-reset'; reset.type = 'button'; reset.title = 'Restore the default'; reset.setAttribute('aria-label', `Restore the default for ${s.name}`);
  reset.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>';
  ctl.prepend(reset);
  const changed = () => { reset.hidden = cfg[s.k] === DEFAULTS[s.k]; };
  const read = () => el.type === 'checkbox' ? el.checked : s.type === 'textarea' ? el.value.trim() : s.folder ? el.value.trim().replace(/^\/+|\/+$/g, '') : el.value.trim();
  const commit = () => { const v = read(); if (v === cfg[s.k]) return; cfg[s.k] = v; saveCfg(); applySetting(s); changed(); };
  const later = debounce(commit, 350);
  el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', el.type === 'checkbox' || el.tagName === 'SELECT' ? commit : later);
  el.addEventListener('change', commit);
  reset.onclick = () => {
    cfg[s.k] = DEFAULTS[s.k]; saveCfg(); applySetting(s);
    if (el.type === 'checkbox') el.checked = !!cfg[s.k]; else el.value = cfg[s.k];
    changed(); el.focus();
  };
  changed();
  return row;
}

// Wrap each occurrence of any of `words` in el's text in <mark>.
function markWords(el, words) {
  const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), /** @type {Text[]} */ nodes = [];
  while (walk.nextNode()) nodes.push(/** @type {Text} */ (walk.currentNode));
  for (const n of nodes) {
    const t = n.nodeValue; let m, last = 0; const frag = document.createDocumentFragment();
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      if (!m[0]) { re.lastIndex++; continue; }
      frag.append(t.slice(last, m.index)); const mk = document.createElement('mark'); mk.textContent = m[0]; frag.append(mk); last = m.index + m[0].length;
    }
    if (!last) continue;
    frag.append(t.slice(last)); n.replaceWith(frag);
  }
}

// Redraw what a setting affects.
// .cinder/settings.md: every setting the vault's settings.json can hold, from the definitions
// above, so a person or an LLM editing the file can see what's there. Nothing in it changes unless
// Cinder does (no dates), so it's only rewritten then.
function settingsReference() {
  const text = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const js = v => JSON.stringify(v);
  const local = CinderVaultSettings.LOCAL_KEYS;
  const out = [
    '# Cinder settings for this vault', '',
    'Cinder keeps this vault’s settings in `settings.json`, next to this file. It holds only the settings that differ from their defaults: add a key to change a setting, and remove it to go back to the default. While Cinder is open it picks up changes to the file within a few seconds, and it keeps any key it doesn’t know. If the file isn’t valid JSON, Cinder keeps its last good settings and leaves the file alone until it’s fixed.', '',
    `Settings that belong to the computer rather than the vault aren’t kept here: ${local.map(k => '`' + k + '`').join(', ')}.`, '',
    'Cinder writes this reference; edits to it are replaced.', '',
  ];
  for (const pg of SETTINGS_PAGES) {
    const items = SETTINGS.filter(s => s.page === pg.id && s.k in DEFAULTS && !local.includes(s.k));
    if (!items.length) continue;
    out.push(`## ${pg.name}`, '');
    for (const s of items) {
      let kind;
      if (s.type === 'toggle') kind = 'true or false';
      else if (s.type === 'select') kind = 'one of ' + s.options.map(([v, label]) => `${js(v)} (${text(label)})`).join(', ');
      else if (s.k === 'palette') kind = 'one of ' + CinderThemes.list.map(t => js(t.id)).join(', ');
      else if (s.type === 'textarea') kind = 'text, one entry per line (\\n)';
      else kind = s.folder ? 'a folder path in the vault' : 'text';
      out.push(`- \`${s.k}\` (${text(s.name)}): ${kind}; default ${js(DEFAULTS[s.k])}.${s.desc ? ' ' + text(s.desc) : ''}`);
    }
    out.push('');
  }
  const unlisted = Object.keys(DEFAULTS).filter(k => !local.includes(k) && !SETTINGS.some(s => s.k === k));
  if (unlisted.length) out.push('## Set elsewhere in Cinder', '', ...unlisted.map(k => `- \`${k}\`: default ${js(DEFAULTS[k])}.`), '');
  out.push('## Other keys', '',
    '- `hotkeys`: custom shortcuts, as `{ "command id": "key" }`, overriding a command’s default key. A key is written `Mod-Shift-k` (Mod is Ctrl, or Cmd on a Mac; then Ctrl-/Meta-, Alt-, Shift-, and the key: a lower-case letter, a digit, or a name like `ArrowLeft`, `Enter`, `F5`). An empty string removes a command’s key.',
    '- `propTypes`: property types, as `{ "property": "text" | "multitext" (a list) | "number" | "checkbox" | "date" | "datetime" | "tags" | "aliases" }`. Only used when the vault has no `.obsidian/types.json`; Obsidian’s file is used when it does.', '',
    '## Commands', '', 'Their ids, for `hotkeys`, with each one’s default key.', '');
  for (const c of COMMANDS) out.push(`- \`${c.id}\`: ${c.name}${c.key ? ` (${js(c.key)})` : ''}`);
  return out.join('\n') + '\n';
}

// .cinder/README.md: a guide for AI assistants (and people) working on this vault: what Cinder is,
// how this vault is set up right now, how to set it up for someone, the formats Cinder reads and
// the ground rules. Generated from Cinder's own data (settings, templates, template commands,
// property types), so it matches the running version; rewritten only when something in it changes.
function assistantGuide() {
  // Real HTML tags go; a template tag like <%* %> in the text stays.
  const text = h => String(h || '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const q = v => v ? '`' + v + '`' : 'the top of the vault';
  const templates = templateList().filter(isMd).sort(collator.compare);
  const folderTemplates = String(cfg.folderTemplates || '').split('\n').map(l => l.trim()).filter(Boolean);
  // Each command with its signature and what it does, from the editor's own "tp." help.
  const tp = Object.entries(TP_MEMBERS).filter(([path]) => path !== 'tp').flatMap(([path, members]) => members.map(([name, , info]) => {
    const [sig, ...rest] = text(info).split(' — '), desc = rest.join(' — ');
    if (desc) return `- \`${path}.${sig}\`: ${desc}`;
    return sig.startsWith(name + '(') ? `- \`${path}.${sig}\`` : `- \`${path}.${name}\`: ${sig}`;
  }));
  return [
    '# Cinder: a guide for assistants',
    '',
    'This folder is a vault for **Cinder**, a notes app that keeps notes as plain Markdown files and reads and writes them in the formats Obsidian and its common plugins use, so the same vault also opens in Obsidian. Cinder writes this guide (and `settings.md` beside it) and keeps it up to date; edits to it are replaced. If you’re helping someone set up or organise this vault, read it first.',
    '',
    '## This vault now',
    '',
    `- Templates folder: ${q(cfg.templatesFolder)}. Templates in it: ${templates.length ? templates.map(t => '`' + noteName(t) + '`').join(', ') : 'none yet'}.`,
    `- Daily notes: in ${q(cfg.dailyFolder)}, named \`${cfg.dailyFormat}\`, template ${cfg.dailyTemplate ? '`' + cfg.dailyTemplate + '`' : 'none'}.`,
    `- Weekly notes: in ${cfg.weeklyFolder ? q(cfg.weeklyFolder) : 'the daily notes folder'}, named \`${cfg.weeklyFormat}\`, template ${cfg.weeklyTemplate ? '`' + cfg.weeklyTemplate + '`' : 'none'}.`,
    `- Monthly notes: in ${cfg.monthlyFolder ? q(cfg.monthlyFolder) : 'the daily notes folder'}, named \`${cfg.monthlyFormat}\`, template ${cfg.monthlyTemplate ? '`' + cfg.monthlyTemplate + '`' : 'none'}.`,
    `- Folder templates (a new note in the folder starts from the template): ${folderTemplates.length ? folderTemplates.map(l => '`' + l + '`').join(', ') : 'none'}.`,
    `- New notes go to ${q(cfg.newNoteFolder)}; pasted and dropped files to ${q(cfg.attachFolder)}; the Inbox is ${q(cfg.inboxFolder)}; quick-added tasks go to ${cfg.taskInbox ? '`' + cfg.taskInbox + '`' : 'today’s daily note'}.`,
    '',
    '## Setting it up for someone',
    '',
    '1. Ask how they work before changing anything: what they keep (work, study, projects, a journal…), whether they want daily, weekly or monthly notes, how they track tasks, and whether they study with flashcards.',
    '2. Change settings in `settings.json` in this folder. It holds only settings that differ from their defaults; `settings.md` lists every key, its values and its default. It must stay valid JSON. Cinder applies changes within a few seconds, even while it’s open.',
    '3. Put templates in the templates folder (below: what they can contain). Point the daily, weekly and monthly templates and the folder templates at them in `settings.json` (a template is named by its path without `.md`).',
    '4. Make the folders, and a `Home.md` linking the main areas.',
    '5. Check the result: every `[[link]]` goes to a note that exists, `settings.json` reads as JSON, and templates render (`{{date}}` and `<% %>` below).',
    '',
    '## What Cinder reads',
    '',
    '- **Notes** are `.md` files. `[[Note]]`, `[[Note#Heading]]`, `[[Note|shown text]]` link; `![[Note]]` embeds a note, `![[image.png|300]]` an image 300 px wide, `![[clip.mov]]` a video player. `#tag` and `#nested/tag` are tags.',
    `- **Properties** are YAML frontmatter between \`---\` lines. Their types: ${CinderProps.TYPES.map(([t, n]) => `\`${t}\` (${n})`).join(', ')}. With an \`.obsidian/types.json\`, types are kept there, as Obsidian does.`,
    '- **Callouts**: `> [!note] Title`, also `tip`, `warning`, `question` and the rest of Obsidian’s. **Math**: `$…$` inline, `$$…$$` on its own lines. **Diagrams**: ```` ```mermaid ```` blocks, drawn by Mermaid 12.',
    '- **Tasks** use the Obsidian Tasks plugin’s format: `- [ ] Call Sam 📅 2026-10-02 ⏫ 🔁 every week`, with 📅 due, ⏳ scheduled, 🛫 start, ✅ done, priorities 🔺 ⏫ 🔼 🔽 ⏬ and 🔁 repeats. A ```` ```tasks ```` block is a live list (`not done`, `due before tomorrow`, `path includes Projects`, `sort by due`, `group by tags`…).',
    '- **Flashcards** use the Spaced Repetition plugin’s format, in notes tagged `#flashcards` (or `#flashcards/deck`): `Question::Answer`, `Question:::Answer` (both ways), several lines with `?` or `??` between, and `==clozes==`. Cinder writes each card’s schedule after it as `<!--SR:…-->`; leave those alone.',
    '- **Bases** are database views of notes in Obsidian’s `.base` YAML format (filters, formulas, table, cards, list and board views), as files or in ```` ```base ```` blocks.',
    '- **Canvases** are `.canvas` files (JSON Canvas). Groups on a canvas are slides when it’s presented.',
    '- **Drawings** are `.excalidraw` or `.excalidraw.md` files, in Excalidraw’s format.',
    `- **The Inbox** is every file in ${q(cfg.inboxFolder)}, shown as sticky notes in lanes. The lanes are kept in \`${cfg.inboxFolder || 'Inbox'}/Inbox.canvas\`; to add something, just put a file in the folder (a text note named like \`2026-09-28 0930.md\`), and it appears in New.`,
    '- **Daily, weekly and monthly notes** are named by date formats in moment.js style (`YYYY-MM-DD`, `GGGG-[W]WW`, `YYYY/MM-MMMM/YYYY-MM-DD-dddd` with folders).',
    '',
    '## Templates',
    '',
    '- Obsidian’s core syntax: `{{title}}`, `{{date}}`, `{{time}}`, `{{date:YYYY-MM-DD}}`.',
    '- Templater’s `<% … %>` (outputs a value) and `<%* … %>` (runs statements; `tR += "text"` adds text), with these commands:',
    ...tp.map(l => '  ' + l),
    '- In `<%* %>`: `let`/`const`, `if`/`else`, `for (const x of list)`, and `await` for the commands that ask something. For safety, templates can’t define functions or use arrow functions, `while` loops, the network (`tp.web`) or Obsidian’s `app` object (except `app.workspace.activeLeaf.view.editor.focus()`, which does nothing here). Anything else stops the template with a message saying what.',
    '- A template can name and file its note: `<%* await tp.file.rename(await tp.system.prompt("Title")) %>`, `<%* await tp.file.move("Projects/" + tp.file.title) %>`.',
    '',
    '## Ground rules',
    '',
    '- Keep everything Obsidian-compatible; the person may open this vault in Obsidian too.',
    '- Never put passwords, tokens or keys in the vault: it syncs (OneDrive, git…) and may be shared.',
    '- Renaming or moving a note breaks links to it: say so and update the links, or ask first.',
    '- Don’t delete notes without asking.',
    '- Leave `.obsidian/`, `.trash/` and the `<!--SR:…-->` comments alone unless asked.',
    '',
  ].join('\n');
}

// The command "Add assistant instructions to this vault": an AGENTS.md at the top of the vault
// (the file AI coding assistants look for) pointing to the guide, written now if it isn't yet.
const AGENTS_POINTER = 'This folder is a notes vault for Cinder, a Markdown notes app compatible with Obsidian. Before changing anything, read `.cinder/README.md`: what Cinder is, how this vault is set up, the formats it reads, and how to change its settings (`.cinder/settings.json`, whose keys are listed in `.cinder/settings.md`). Cinder writes those files and keeps them current.';
async function addAssistantInstructions() {
  try {
    await api('/api/settings-doc?name=README.md', { method: 'PUT', body: assistantGuide() });
    await api('/api/settings-doc?name=settings.md', { method: 'PUT', body: settingsReference() });
  } catch (e) { return toast('Couldn’t write the guide: ' + e.message); }
  const p = 'AGENTS.md', n = S.notes.get(p);
  if (n?.content.includes('.cinder/README.md')) { toast('AGENTS.md already points assistants to Cinder’s guide'); return openPath(p); }
  const body = n ? n.content.replace(/\s*$/, '\n\n## Cinder\n\n') + AGENTS_POINTER + '\n'
    : `# Instructions for AI assistants\n\n${AGENTS_POINTER}\n\nAdd your own instructions here: how you like your notes organised, and what an assistant may and may not change.\n`;
  try { await writeFile(p, body, n?.mtime); } catch (e) { return toast('Couldn’t write AGENTS.md: ' + e.message); }
  reindexAll(); renderTree();
  await openPath(p);
  toast(n ? 'Added a pointer to Cinder’s guide to AGENTS.md' : 'Made AGENTS.md: assistants will find Cinder’s guide from it');
}

function applySetting(s) {
  const what = s.apply;
  if (what === 'theme') { applyTheme(); $('.st-fp')?.dispatchEvent(new Event('refresh')); }
  if (what === 'frame') setFrame(cfg.windowFrame);
  if (what === 'layout') applyStickyLayout();
  if (what === 'tree') { updateTreeButtons(); if (cfg.autoReveal) renderTreeActive(true); }
  if (what === 'css') { userCssKey = null; loadUserCss(); }
  if (what === 'calendar') refreshCalendar();
  if (what === 'editor') { S.version++; ed.refresh(); if (S.view === 'note' && S.mode === 'read') renderPreview(); }
}

function settingVault(ctl) {
  ctl.innerHTML = `<div class="st-vault"><code class="st-path" title=""></code><button type="button" class="btn">Switch…</button></div>`;
  api('/api/info').then(i => { $('.st-path', ctl).textContent = i.vault; $('.st-path', ctl).title = i.vault; }).catch(() => { });
  $('button', ctl).onclick = () => { settingsBack?.remove(); settingsBack = null; switchVault(); };
}

// Swatches for every colour theme, drawn in the current light / dark mode.
function settingThemes(ctl) {
  const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  ctl.innerHTML = `<div class="st-themes" role="radiogroup" aria-label="Colour theme">${CinderThemes.list.map(t => {
    const c = CinderThemes.swatch(t.id, mode);
    return `<button type="button" class="st-theme" role="radio" data-id="${t.id}" aria-checked="${cfg.palette === t.id}" title="${esc(t.name)}">
      <span class="st-sw" style="background:${c.bg2}"><i style="background:${c.bg};color:${c.text}"><b style="background:${c.accent}"></b><b style="background:${c.green}"></b><b style="background:${c.blue}"></b><u style="background:${c.text}"></u><u style="background:${c.text}"></u></i></span>
      <span class="st-tn">${esc(t.name.replace(/ \(default\)$/, ''))}</span></button>`;
  }).join('')}</div>`;
  ctl.addEventListener('click', e => {
    const b = e.target.closest('.st-theme'); if (!b) return;
    cfg.palette = b.dataset.id; saveCfg(); applyTheme();
    for (const x of $$('.st-theme', ctl)) x.setAttribute('aria-checked', String(x === b));
  });
  ctl.addEventListener('keydown', e => {
    if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    const bs = $$('.st-theme', ctl), i = bs.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault();
    const n = bs[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length];
    n.focus(); n.click();
  });
}

function settingFontPreview(ctl) {
  ctl.innerHTML = `<div class="font-preview st-fp"><span class="fp-text">The quick brown fox jumps over the lazy dog — 0O 1lI</span><code class="fp-mono">fn main() { let x = 0O + 1lI; } =&gt;</code><span class="fp-icons">    󰈌</span></div>`;
  const fp = $('.st-fp', ctl);
  // While a font name is being typed, preview it before it's saved.
  const draw = () => {
    const t = $('#st-fontText')?.value ?? cfg.fontText, m = $('#st-fontMono')?.value ?? cfg.fontMono;
    $('.fp-text', fp).style.fontFamily = t.trim() ? `${cssFontName(t)}, var(--font-ui)` : 'var(--font-ui)';
    $('.fp-mono', fp).style.fontFamily = m.trim() ? `${cssFontName(m)}, ${FONT_MONO_DEFAULT}` : FONT_MONO_DEFAULT;
  };
  fp.addEventListener('refresh', draw);
  setTimeout(() => { for (const id of ['#st-fontText', '#st-fontMono']) $(id)?.addEventListener('input', draw); draw(); });
}
