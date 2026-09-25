/* Cinder app — the Settings dialog. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
function openSettings() {
  const back = modal(`<form class="form">
    <h3>Settings</h3>
    <label>Vault<div style="display:flex;gap:8px"><input class="field" id="vault-path" readonly><button type="button" class="btn" data-x-vault>Change…</button></div></label>
    <label>Default folder for new notes<input class="field" name="newNoteFolder" placeholder="(vault root)"></label>
    <label>Daily notes folder<input class="field" name="dailyFolder"></label>
    <label>Daily note template (note name or path)<input class="field" name="dailyTemplate" placeholder="e.g. Templates/Daily"></label>
    <label>Templates folder<input class="field" name="templatesFolder"></label>
    <label><span>Folder templates — new notes in a folder start from its template. One per line, e.g. <code>Meetings: Templates/Meeting</code> (<code>/</code> means every folder)</span><textarea class="field" name="folderTemplates" rows="3" spellcheck="false" placeholder="Meetings: Templates/Meeting"></textarea></label>
    <label>Attachments folder<input class="field" name="attachFolder"></label>
    <label>New tasks go to (a note path; empty means today's daily note)<input class="field" name="taskInbox" placeholder="(today's daily note)"></label>
    <label class="check"><input type="checkbox" name="taskDoneDate"> Add a done date (✅) when ticking a task</label>
    <label>New drawings are saved as<select class="field" name="drawingFormat"><option value="excalidraw">.excalidraw (Excalidraw file; also opens on excalidraw.com)</option><option value="md">.excalidraw.md (Obsidian Excalidraw plugin)</option></select></label>
    <label>Default view for notes<select class="field" name="defaultMode"><option value="edit">Editing</option><option value="read">Reading</option></select></label>
    <label>Light or dark<select class="field" name="theme"><option value="">Follow system</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
    <label>Colour theme<select class="field" name="palette">${CinderThemes.list.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="livePreview"> Live preview (hide Markdown syntax except where you're editing)</label>
    <label class="check"><input type="checkbox" name="readable"> Readable line length</label>
    <label class="check"><input type="checkbox" name="mono"> Monospace editor font</label>
    <label class="check"><input type="checkbox" name="vim"> Vim key bindings in the editor</label>
    <label>Embedded web pages (<code>![](https://…)</code> and canvas link cards)<select class="field" name="webEmbeds"><option value="auto">Load them</option><option value="click">Load when clicked</option><option value="off">Show just the link</option></select></label>
    <label class="check"><input type="checkbox" name="hoverPreview"> Preview links on hover (hold Ctrl in the editor and for web pages)</label>
    <label class="check"><input type="checkbox" name="mathSnippets"> Math shortcuts while typing equations (<code>//</code> fraction, <code>@a</code> α, <code>mk</code>+Tab inline math…)</label>
    <label class="check"><input type="checkbox" name="screenshotHide"> Hide Cinder while taking a screenshot (desktop app)</label>
    <div class="row" style="justify-content:flex-start;gap:12px"><label>Screenshot delay<select class="field" name="screenshotDelay"><option value="0">None</option><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="10">10 seconds</option></select></label>
    <label>After a screenshot<select class="field" name="screenshotAfter"><option value="insert">Insert it</option><option value="annotate">Open it in a drawing to annotate</option></select></label></div>
    <label>CSS snippets folder (every <code>.css</code> file in it styles Cinder; pair with a note's <code>cssclasses</code>)<input class="field" name="cssFolder" placeholder="e.g. Snippets (empty: none)"></label>
    ${NATIVE ? `<label>Window frame<select class="field" name="windowFrame"><option value="custom">Cinder’s own (matches the theme; drag the tab bar to move)</option><option value="native">The system’s title bar</option></select></label>` : ''}
    <label>Properties at the top of notes<select class="field" name="properties"><option value="visible">Show as a table you can edit</option><option value="source">Show the YAML frontmatter as text</option></select></label>
    <div class="row" style="justify-content:flex-start"><button type="button" class="btn" data-x-hotkeys>Hotkeys…</button><button type="button" class="btn" data-x-shortcuts>Keyboard shortcuts</button></div>
    <label>Text font (any font installed on this computer; empty for the system font)<input class="field" name="fontText" list="font-text-list" placeholder="System font" spellcheck="false"></label>
    <label>Code font (empty for JetBrains Mono, which comes with Cinder)<input class="field" name="fontMono" list="font-mono-list" placeholder="JetBrains Mono" spellcheck="false"></label>
    <datalist id="font-text-list"><option>Inter</option><option>Segoe UI</option><option>Noto Sans</option><option>Ubuntu</option><option>Georgia</option><option>Iowan Old Style</option><option>Literata</option><option>JetBrains Mono</option></datalist>
    <datalist id="font-mono-list"><option>JetBrains Mono</option><option>JetBrainsMono Nerd Font</option><option>FiraCode Nerd Font</option><option>Hack Nerd Font</option><option>Iosevka</option><option>Fira Code</option><option>Cascadia Code</option><option>Consolas</option><option>Menlo</option><option>Ubuntu Mono</option></datalist>
    <div class="font-preview">Preview: <span class="fp-text">The quick brown fox — 0O 1lI</span> <code class="fp-mono">fn main() { 0O 1lI =&gt; }</code> <span class="fp-icons">\uf09b \ue7a8 \uf0e7 \uf011 \udb80\ude0c</span></div>
    <div class="row"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div>
  </form>`);
  const f = $('form', back);
  for (const [k, v] of Object.entries(cfg)) { const el = f.elements[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = v; else el.value = v; }
  // Live font preview while typing a font name.
  const fp = () => {
    $('.fp-text', back).style.fontFamily = f.elements.fontText.value.trim() ? `${cssFontName(f.elements.fontText.value)}, var(--font-ui)` : 'var(--font-ui)';
    $('.fp-mono', back).style.fontFamily = f.elements.fontMono.value.trim() ? `${cssFontName(f.elements.fontMono.value)}, ${FONT_MONO_DEFAULT}` : FONT_MONO_DEFAULT;
  };
  f.elements.fontText.addEventListener('input', fp); f.elements.fontMono.addEventListener('input', fp); fp();
  const close = () => back.remove();
  $('[data-x]', back).onclick = close;
  api('/api/info').then(i => { $('#vault-path', back).value = i.vault; }).catch(() => { });
  $('[data-x-vault]', back).onclick = () => { close(); switchVault(); };
  $('[data-x-hotkeys]', back).onclick = () => { close(); openHotkeys(); };
  $('[data-x-shortcuts]', back).onclick = () => { close(); showShortcuts(); };
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  f.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  f.addEventListener('submit', e => {
    e.preventDefault();
    for (const k of Object.keys(DEFAULTS)) {
      const el = f.elements[k]; if (!el) continue;
      cfg[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'TEXTAREA' ? el.value.trim() : el.value.trim().replace(/^\/+|\/+$/g, '');
    }
    saveCfg(); applyTheme(); close();
    setFrame(cfg.windowFrame);
    S.version++; ed.refresh(); if (S.view === 'note' && S.mode === 'read') renderPreview(); // (properties display)
    userCssKey = null; loadUserCss();
  });
}

