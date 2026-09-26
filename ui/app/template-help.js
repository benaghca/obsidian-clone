/* Cinder app — help for writing templates, so Templater's syntax needn't be remembered.
 * (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * - Typing "<%" in the editor lists template commands in plain words; "tp." lists what follows.
 * - "Insert template command…" does the same from the command palette.
 * - The cheat sheet shows every command with what it would give right now, and the date formats.
 * - A note in the templates folder gets a bar with those, plus a preview of the filled-in template. */

// The commands, as a person would ask for them. ${fields} are Tab stops.
const TP_COMMANDS = [
  { section: 'Dates', label: 'Today’s date', snippet: '<% tp.date.now("${YYYY-MM-DD}") %>', ex: () => tpDate('YYYY-MM-DD') },
  { section: 'Dates', label: 'Today, written out', snippet: '<% tp.date.now("${dddd, MMMM Do YYYY}") %>', ex: () => tpDate('dddd, MMMM Do YYYY') },
  { section: 'Dates', label: 'The time now', snippet: '<% tp.date.now("${HH:mm}") %>', ex: () => tpDate('HH:mm') },
  { section: 'Dates', label: 'Tomorrow’s date', snippet: '<% tp.date.tomorrow("${YYYY-MM-DD}") %>', ex: () => tpDate('YYYY-MM-DD', 1) },
  { section: 'Dates', label: 'Yesterday’s date', snippet: '<% tp.date.yesterday("${YYYY-MM-DD}") %>', ex: () => tpDate('YYYY-MM-DD', -1) },
  { section: 'Dates', label: 'A date some days away', snippet: '<% tp.date.now("YYYY-MM-DD", ${7}) %>', desc: 'The number is days from today; use a negative number for the past, or <code>"P1W"</code> / <code>"P1M"</code> for a week or month.', ex: () => tpDate('YYYY-MM-DD', 7) },
  { section: 'Dates', label: 'This week’s Monday', snippet: '<% tp.date.weekday("YYYY-MM-DD", ${0}) %>', desc: '0 is this week’s Monday, 4 its Friday, 7 next Monday.', ex: () => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return CinderTemplater.formatDate(d, 'YYYY-MM-DD'); } },
  { section: 'Dates', label: 'The week number', snippet: '<% tp.date.now("${GGGG-[W]WW}") %>', ex: () => tpDate('GGGG-[W]WW') },
  { section: 'This note', label: 'The note’s title', snippet: '<% tp.file.title %>', ex: () => 'Example note' },
  { section: 'This note', label: 'The note’s folder', snippet: '<% tp.file.folder(true) %>', ex: () => 'Projects/Example' },
  { section: 'This note', label: 'When the note was made', snippet: '<% tp.file.creation_date("${YYYY-MM-DD HH:mm}") %>', ex: () => tpDate('YYYY-MM-DD HH:mm') },
  { section: 'This note', label: 'Put the cursor here', snippet: '<% tp.file.cursor() %>', desc: 'After the template is used, typing continues here.', ex: () => '' },
  { section: 'This note', label: 'The selected text', snippet: '<% tp.file.selection() %>', desc: 'What was selected when the template was inserted.', ex: () => 'the selection' },
  { section: 'This note', label: 'A property of the note', snippet: '<% tp.frontmatter["${status}"] %>', desc: 'A value from the note’s properties.', ex: () => 'in progress' },
  { section: 'This note', label: 'Rename the note', snippet: '<%* await tp.file.rename(${tp.date.now("YYYY-MM-DD")}) %>', desc: 'Gives the new note a name when the template runs.', ex: () => '' },
  { section: 'This note', label: 'Move the note to a folder', snippet: '<%* await tp.file.move("${Folder}/" + tp.file.title) %>', ex: () => '' },
  { section: 'Ask when used', label: 'Ask a question', snippet: '<% tp.system.prompt("${Question}") %>', desc: 'Asks when the template is used, and puts the answer here.', ex: () => 'your answer' },
  { section: 'Ask when used', label: 'Ask once, use the answer in several places', snippet: '<%* let ${answer} = await tp.system.prompt("${Question}") %>', desc: 'Then write <code>&lt;% answer %&gt;</code> wherever the answer should go.', ex: () => '' },
  { section: 'Ask when used', label: 'Pick from a list', snippet: '<% tp.system.suggester(["${First}", "${Second}"], ["${First}", "${Second}"]) %>', desc: 'The first list is what’s shown, the second what goes in the note.', ex: () => 'First' },
  { section: 'Ask when used', label: 'Name the note from a question', snippet: '<%* let title = await tp.system.prompt("${Title}"); await tp.file.rename(title) %>', ex: () => '' },
  { section: 'Ask when used', label: 'Paste the clipboard', snippet: '<% tp.system.clipboard() %>', ex: () => 'clipboard text' },
  { section: 'More', label: 'Include another template', snippet: '<% tp.file.include("[[${Template}]]") %>', desc: 'The other template’s text, filled in, goes here.', ex: () => '' },
  { section: 'More', label: 'Only if…', snippet: '<%* if (${tp.file.folder(true) == "Work"}) { %>\n${text}\n<%* } %>', desc: 'The text in between only appears when the condition holds.', ex: () => '' },
  { section: 'More', label: 'Either… or…', snippet: '<%* if (${condition}) { %>\n${this}\n<%* } else { %>\n${that}\n<%* } %>', ex: () => '' },
  { section: 'More', label: 'Repeat for each item', snippet: '<%* for (const ${item} of [${"a", "b"}]) { %>\n- <% ${item} %>\n<%* } %>', ex: () => '' },
];
const tpDate = (f, days = 0) => { const d = new Date(); d.setDate(d.getDate() + days); return CinderTemplater.formatDate(d, f); };

// What "tp." and friends offer next. [name, call snippet, description]
const TP_MEMBERS = {
  'tp': [['date', 'date.', 'Dates: now, tomorrow, yesterday, weekday'], ['file', 'file.', 'The note: title, folder, cursor, rename, move…'], ['system', 'system.', 'Ask: prompt, suggester, clipboard'], ['frontmatter', 'frontmatter.', 'The note’s properties'], ['config', 'config.', 'template_file, target_file']],
  'tp.date': [['now', 'now("${YYYY-MM-DD}")', 'now(format, offset?, reference?, referenceFormat?) — today, or offset days (or "P1W") away'], ['tomorrow', 'tomorrow("${YYYY-MM-DD}")', 'tomorrow(format)'], ['yesterday', 'yesterday("${YYYY-MM-DD}")', 'yesterday(format)'], ['weekday', 'weekday("${YYYY-MM-DD}", ${0})', 'weekday(format, day) — 0 is this week’s Monday']],
  'tp.file': [['title', 'title', 'The note’s name'], ['folder', 'folder(${true})', 'folder(relative?) — true gives the path from the vault'], ['path', 'path(${true})', 'path(relative?)'], ['cursor', 'cursor()', 'Where typing continues afterwards'], ['selection', 'selection()', 'The selected text'], ['creation_date', 'creation_date("${YYYY-MM-DD HH:mm}")', 'creation_date(format)'], ['last_modified_date', 'last_modified_date("${YYYY-MM-DD HH:mm}")', 'last_modified_date(format)'], ['tags', 'tags', 'The note’s tags'], ['content', 'content', 'The note’s text'], ['include', 'include("[[${Template}]]")', 'include(link) — another template, filled in'], ['rename', 'rename(${name})', 'rename(name) — use with await in <%* %>'], ['move', 'move("${Folder}/" + tp.file.title)', 'move(path) — use with await in <%* %>'], ['create_new', 'create_new(${text}, "${Name}")', 'create_new(text, name, open?, folder?)'], ['exists', 'exists("${Note}")', 'exists(name) — true if the note exists'], ['cursor_append', 'cursor_append("${text}")', 'Adds text at the cursor']],
  'tp.system': [['prompt', 'prompt("${Question}")', 'prompt(question, default?, throwOnCancel?, multiline?)'], ['suggester', 'suggester(["${A}", "${B}"], ["${A}", "${B}"])', 'suggester(labels, values)'], ['clipboard', 'clipboard()', 'The clipboard’s text']],
  'tp.config': [['template_file', 'template_file', 'The template’s path'], ['target_file', 'target_file', 'The note’s path']],
};

// The editor's hook: options for "<%" (kind 'open') or for a "tp.…" path (kind 'member').
function templaterOptions(kind, path) {
  if (kind === 'open') {
    // Sections keep the list's order (the editor would otherwise sort them by name).
    const secs = new Map([...new Set(TP_COMMANDS.map(c => c.section))].map((name, rank) => [name, { name, rank }]));
    return TP_COMMANDS.map(c => ({ label: c.label, detail: tpShort(c.snippet), section: secs.get(c.section), snippet: c.snippet, info: tpInfo(c) }));
  }
  if (path === 'tp.frontmatter') return [...new Set([...S.notes.values()].flatMap(n => Object.keys(n.fm || {})))].sort(collator.compare).map(k => ({ label: k, detail: 'property', snippet: /^[A-Za-z_$][\w$]*$/.test(k) ? k : `["${k}"]` }));
  return (TP_MEMBERS[path] || []).map(([label, snippet, info]) => ({ label, detail: info.split(' — ')[0].replace(/^\w+/, '') || '', snippet, info: esc(info) }));
}
const tpShort = s => s.replace(/\$\{([^}]*)\}/g, '$1').replace(/\n[\s\S]*/, ' …');
function tpInfo(c) {
  const ex = c.ex();
  return `${c.desc ? `<p>${c.desc}</p>` : ''}<pre>${esc(tpShort(c.snippet))}</pre>${ex ? `<p class="tp-ex">Right now: <b>${esc(ex)}</b></p>` : ''}`;
}

// Command palette: pick a command in plain words and insert it.
async function insertTemplaterCommand() {
  if (S.view !== 'note') return toast('Open a note first');
  const c = await picker({
    placeholder: 'Insert template command… (e.g. date, ask, cursor)',
    items: q => rank(TP_COMMANDS, q, c => `${c.label} ${c.section}`).map(c => ({ main: c.label, sub: tpShort(c.snippet), value: c })),
  });
  if (!c) return;
  if (S.mode !== 'edit') setMode('edit');
  ed.snippet(c.snippet);
}

// Every command with what it gives right now, the date formats, and the basics.
function showTemplaterHelp() {
  const sections = [...new Set(TP_COMMANDS.map(c => c.section))];
  const TOKENS = [['YYYY', 'year'], ['MM', 'month, 01–12'], ['MMMM', 'month name'], ['MMM', 'short month'], ['DD', 'day, 01–31'], ['Do', 'day with suffix'], ['dddd', 'weekday'], ['ddd', 'short weekday'], ['HH', 'hour, 00–23'], ['hh A', '12-hour clock'], ['mm', 'minutes'], ['WW', 'ISO week'], ['GGGG', 'ISO week’s year'], ['Q', 'quarter'], ['[text]', 'text as it is']];
  const back = modal(`<div class="tp-help"><header><h3>Template commands</h3><input class="field tp-q" type="search" placeholder="Find a command…" spellcheck="false"><button class="ib" data-x title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button></header>
    <div class="tp-body">
      <div class="tp-intro"><p>Templates are notes in your <b>${esc(cfg.templatesFolder || 'templates')}</b> folder. Anything inside <code>&lt;% %&gt;</code> is filled in when the template is used; <code>&lt;%* %&gt;</code> runs a step without writing anything. You don’t need to remember these: type <kbd>&lt;%</kbd> in a note and pick from the list, or run <i>Insert template command…</i>. Click a command below to copy it.</p></div>
      ${sections.map(s => `<section class="tp-sec"><h4>${esc(s)}</h4>${TP_COMMANDS.filter(c => c.section === s).map(c => {
        const ex = c.ex();
        return `<button class="tp-cmd" data-copy="${esc(tpShort(c.snippet).replace(/ …$/, ''))}" data-text="${esc(`${c.label} ${c.snippet}`.toLowerCase())}"><span class="tp-l">${esc(c.label)}</span><code>${esc(tpShort(c.snippet))}</code>${ex ? `<span class="tp-r">→ ${esc(ex)}</span>` : c.desc ? `<span class="tp-r">${c.desc}</span>` : ''}</button>`;
      }).join('')}</section>`).join('')}
      <section class="tp-sec tp-tokens"><h4>Date formats</h4><div class="tp-grid">${TOKENS.map(([t, d]) => `<div><code>${esc(t)}</code><span>${esc(d)}</span><b>${esc(t === '[text]' ? 'text' : tpDate(t))}</b></div>`).join('')}</div></section>
    </div></div>`);
  back.querySelector('.modal').classList.add('wide');
  const close = () => back.remove();
  $('[data-x]', back).onclick = close;
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  $('.tp-q', back).addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    for (const b of $$('.tp-cmd', back)) b.hidden = q && !b.dataset.text.includes(q);
    for (const s of $$('.tp-sec', back)) s.hidden = !s.classList.contains('tp-tokens') && !$$('.tp-cmd', s).some(b => !b.hidden);
  });
  back.addEventListener('click', e => {
    const b = e.target.closest('.tp-cmd'); if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Copied'), () => { });
  });
  $('.tp-q', back).focus();
}

// A new template in the templates folder, started with the commands most templates use.
async function newTemplate() {
  const name = await promptModal('New template', 'Template name', 'Meeting');
  if (!name) return;
  const path = uniquePath(cfg.templatesFolder, name.trim() + '.md');
  const starter = `---\ncreated: <% tp.date.now("YYYY-MM-DD") %>\ntags: []\n---\n# <% tp.file.title %>\n\n<% tp.file.cursor() %>\n`;
  await writeFile(path, starter);
  let d = dirname(path);
  while (d) { S.dirs.add(d); d = dirname(d); }
  reindexAll(); renderTree();
  await openPath(path);
  toast('Type <% anywhere to add a template command');
}

const isTemplateNote = p => !!p && isMd(p) && !!cfg.templatesFolder && p.startsWith(cfg.templatesFolder + '/');

// The bar above a template: what it is, and the helpers.
function updateTemplateBar() {
  let bar = $('#template-bar');
  const show = S.view === 'note' && isTemplateNote(S.cur);
  if (!show) { if (bar) bar.hidden = true; return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'template-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Template');
    bar.innerHTML = `<span class="tb-what"><svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>Template</span><span class="tb-hint">Type <kbd>&lt;%</kbd> to add a command</span>
      <button class="btn" data-tb="insert">Insert command…</button><button class="btn" data-tb="preview">Preview</button><button class="btn" data-tb="help">Cheat sheet</button>`;
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-tb]'); if (!b) return;
      ({ insert: insertTemplaterCommand, preview: previewTemplate, help: showTemplaterHelp })[b.dataset.tb]();
    });
    $('#view-note').prepend(bar);
  }
  bar.hidden = false;
}

// Fill in the open template as if it were used for a new note called "Example note", and show the result.
async function previewTemplate() {
  if (!isTemplateNote(S.cur)) return toast('Open a template first');
  const src = ed.value, tpl = S.cur;
  const fake = join(dirname(cfg.newNoteFolder ? cfg.newNoteFolder + '/x' : 'x'), 'Example note.md');
  let r;
  try {
    const text = fillTemplate(src, 'Example note');
    r = CinderTemplater.hasTemplaterSyntax(text) ? await CinderTemplater.render(text, { ...templateEnv(fake, 'the selection', tpl), content: '' }) : { text, cursor: -1, actions: [] };
  } catch (e) { r = { error: e.message }; }
  const out = r.error ? '' : r.cursor >= 0 ? r.text.slice(0, r.cursor) + '‸' + r.text.slice(r.cursor) : r.text;
  const acts = (r.actions || []).map(a => a.type === 'rename' ? `renames the note to “${a.name}”` : a.type === 'move' ? `moves the note to ${a.path}.md` : `creates ${a.path}`);
  const back = modal(`<div class="tp-prev"><header><h3>Preview: ${esc(noteName(tpl))}</h3><div class="seg" role="tablist"><button class="on" data-v="md" role="tab">Rendered</button><button data-v="src" role="tab">Text</button></div><button class="ib" data-x title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button></header>
    ${r.error ? `<div class="tp-err">This template has a problem: ${esc(r.error)}</div>` : ''}
    ${r.aborted ? '<div class="tp-err">The template was cancelled.</div>' : ''}
    ${acts.length ? `<div class="tp-acts">When used, it also ${esc(acts.join(', and '))}.</div>` : ''}
    <div class="tp-out markdown"></div><pre class="tp-src" hidden></pre>
    <footer>As if used for a new note called <b>Example note</b>, now. ${r.cursor >= 0 ? 'The ‸ marks where the cursor goes.' : ''}</footer></div>`);
  back.querySelector('.modal').classList.add('wide');
  $('.tp-out', back).innerHTML = markdownToHtml(out, fake, 1); renderMathIn($('.tp-out', back));
  $('.tp-src', back).textContent = out;
  $('.seg', back).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $$('.seg button', back)) x.classList.toggle('on', x === b);
    $('.tp-out', back).hidden = b.dataset.v !== 'md'; $('.tp-src', back).hidden = b.dataset.v !== 'src';
  });
  const close = () => back.remove();
  $('[data-x]', back).onclick = close;
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  $('.seg button.on', back).focus();
}

// Settings → Templates: the helpers.
function settingTemplateHelp(ctl) {
  ctl.innerHTML = `<div class="st-btns"><button type="button" class="btn" data-a="help">Cheat sheet</button><button type="button" class="btn" data-a="new">New template…</button></div>`;
  ctl.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    settingsBack?.remove(); settingsBack = null;
    if (b.dataset.a === 'help') showTemplaterHelp(); else newTemplate();
  });
}
