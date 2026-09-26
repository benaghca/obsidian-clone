/* Cinder app — sidebar resizing and start-up. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ layout: sidebar resizing

function makeResizer(handle, side) {
  const panel = $('#' + side);
  const saved = store('w-' + side); if (saved) panel.style.width = saved + 'px';
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const x0 = e.clientX, w0 = panel.getBoundingClientRect().width;
    handle.classList.add('drag');
    const mv = ev => {
      const w = Math.max(180, Math.min(600, w0 + (side === 'left' ? 1 : -1) * (ev.clientX - x0)));
      panel.style.width = w + 'px';
      if (S.view === 'graph') CinderGraph.resize();
    };
    const up = () => {
      handle.classList.remove('drag');
      store('w-' + side, parseInt(panel.style.width));
      removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
}

// ============================================================ boot

const WELCOME = `---
tags:
  - welcome
---
Cinder is a local notes app. Your notes are plain Markdown files in this folder, so the same vault opens in Obsidian or any text editor.

## The basics
- Link notes with double brackets: [[My first note]]. Clicking a link to a note that doesn't exist creates it, and hovering one previews it.
- Tag with #hashtags or the **Properties** above this line. Click a property to edit it; **Ctrl+;** adds one.
- Paste or drag in an image to save it into \`attachments/\`, or press **Ctrl+Shift+S** for a screenshot.
- Formatting renders as you type. Put the cursor on a line to see its Markdown, and press **Ctrl+E** for reading view.
- Math works too: $E = mc^2$. Inside math, \`//\` makes a fraction and \`@a\` makes α.

## More than notes
The icons down the left make:
- **Drawings**: a hand-drawn whiteboard. Embed one in a note with \`![[Drawing name.excalidraw]]\`.
- **Canvases**: cards and arrows on an endless board. Press **F5** to present one, with each group as a slide.
- **Bases**: tables, cards and kanban boards made from your notes' properties.
- **Tasks**: every \`- [ ]\` in the vault in one place (**Ctrl+Shift+T**), with due dates, repeats and quick add.
- **The graph** (**Ctrl+G**): click a note to light up its links, or tick **3D** and fly around it.

## Getting around
| Keys | Does |
| --- | --- |
| Ctrl+O | Quick switcher (Shift+Enter creates) |
| Ctrl+P | Command palette |
| Ctrl+/ | All keyboard shortcuts |
| Ctrl+N | New note |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Tab | Recent files |
| Ctrl+Shift+F | Search all notes (\`tag:x\`, \`[status:done]\`, \`"exact phrase"\`) |
| Ctrl+Shift+E | File tree (arrows, Enter; Ctrl-click to pick several) |
| Alt+← / Alt+→ | Back / forward |

Every shortcut can be changed in **Settings → Hotkeys**. Click the vault's name above the file tree to switch vaults.

- [ ] Tick this box (or put the cursor on it and press Ctrl+Enter)
- [ ] Open today's daily note from the calendar icon
- [ ] Try another colour theme in Settings (Volcanic is the default)

> [!tip] Nothing leaves this machine
> Cinder has no accounts, no telemetry and no plugins, and it doesn't reach the network. The one exception is a web page you embed yourself, like \`![](https://example.com)\`.
`;

// The welcome note, made again (or brought up to date, if it's an older one).
async function showWelcome() {
  const p = 'Welcome.md';
  if (!S.files.has(p)) return createNote(p, WELCOME, { mode: 'read' });
  if (S.notes.get(p)?.content !== WELCOME && await confirmModal('Update the welcome note?', 'Welcome.md is from an older version of Cinder, or you’ve changed it. Replace it with the latest one?', { ok: 'Replace it', cancel: 'Just open it' })) {
    try { await writeFile(p, WELCOME, S.notes.get(p)?.mtime); } catch (e) { toast('Couldn’t update it: ' + e.message); }
    reindexAll();
  }
  await openPath(p, { mode: 'read' });
}

// Buttons that show only an icon are named by their tooltip, for screen readers.
/** @param {ParentNode} [root] */
function labelIconButtons(root = document) {
  const sel = 'button[title]:not([aria-label])';
  const self = /** @type {any} */ (root).matches?.(sel) ? [root] : [];
  for (const b of [...self, ...root.querySelectorAll(sel)]) if (!b.textContent.trim()) b.setAttribute('aria-label', b.title.replace(/\s*\([^)]*\)$/, ''));
}
// (The editors' own frequent changes are skipped: they have no such buttons.)
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && !(/** @type {Element} */ (n)).closest('.cm-editor')) labelIconButtons(/** @type {Element} */ (n)); }).observe(document.body, { childList: true, subtree: true });

async function boot() {
  labelIconButtons();
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  $('#vault-name .vault-label').textContent = VAULT;
  $('#vault-name').title = `${VAULT}: switch vault`;
  $('#vault-name').onclick = () => switchVault();
  const layout = store('layout');
  if (layout && !layout.left) document.body.classList.add('app-no-left');
  if (layout && !layout.right) document.body.classList.add('app-no-right');
  makeResizer($('#resize-left'), 'left');
  makeResizer($('#resize-right'), 'right');
  showPanel('files', true);
  try { await loadAll(); } catch (e) { document.body.innerHTML = `<p style="padding:2em">Couldn't reach the Cinder server: ${esc(e.message)}. Is it still running?</p>`; return; }
  renderTree();
  watchVault();
  setTimeout(() => syncSearchIndex(), 1500); // ready before the first search
  updateTaskBadge();
  updateInboxBadge();
  loadBookmarks();
  api('/api/info').then(i => { S.vaultPath = i.vault; }).catch(() => { });
  if (S.files.size === 0 && !store('welcomed')) {
    store('welcomed', true);
    await createNote('Welcome.md', WELCOME, { mode: 'read' });
    return;
  }
  await restoreTabs();
  { const sp = store('split'); if (sp && S.files.has(sp)) openSplit(sp); }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else poll(); });
// Native window: Rust asks us to flush edits before it closes.
window.__cinderClose = async () => {
  window.ipc.postMessage('close-ack');
  flushDocViews();
  try { await save(); } catch { }
  if (S.dirty && !(await confirmModal('Your latest changes aren’t saved', 'Cinder couldn’t save them. Close anyway and lose them?', { ok: 'Close anyway', cancel: 'Stay', danger: true }))) {
    window.ipc.postMessage('close-cancel');
    return;
  }
  window.ipc.postMessage('close-ok');
};

window.addEventListener('beforeunload', e => {
  if (NATIVE || !S.dirty || !S.cur) return;
  let body, base;
  if (S.view === 'drawing' && S.drawing) { CinderDraw.flush(); body = drawingContent(S.drawing); base = S.drawing.mtime; }
  else if (S.view === 'canvas' && S.canvasDoc) { CinderCanvas.flush(); body = CinderCanvas.serializeCanvas(CinderCanvas.getData()); base = S.canvasDoc.mtime; }
  else if (S.view === 'base' && S.baseDoc) { body = S.baseDoc.text; base = S.baseDoc.mtime; }
  else if (S.view === 'note') { body = ed.value; base = S.notes.get(S.cur)?.mtime; }
  else return;
  fetch(`/api/file?path=${enc(S.cur)}`, { method: 'PUT', body, keepalive: true, headers: { 'X-Cinder-Token': TOKEN, ...(base ? { 'X-Base-Mtime': String(base) } : {}) } });
});

boot();
