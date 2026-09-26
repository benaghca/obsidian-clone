/* Cinder app — toolbar buttons and global hotkeys. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ commands & keys

const CMD = {
  'panel-files': () => showPanel('files'),
  'panel-search': () => showPanel('search'),
  'panel-tags': () => showPanel('tags'),
  'panel-bookmarks': () => showPanel('bookmarks'),
  bookmark: () => toggleBookmark(),
  'bookmark-group': () => newBookmarkGroup(),
  'bookmark-search': () => bookmarkSearch(),
  'panel-props': () => showPanel('props'),
  switcher: openSwitcher,
  inbox: () => openInbox(),
  palette: openPalette,
  daily: openDaily,
  graph: () => openGraph(false),
  theme: toggleTheme,
  settings: openSettings,
  'new-note': () => newNote(),
  'new-drawing': () => newDrawing(),
  'new-canvas': () => newCanvas(),
  'new-base': () => newBase(),
  tasks: () => openTasks(),
  'new-folder': () => newFolder(''),
  'collapse-all': () => setAllExpanded(false),
  'expand-all': () => setAllExpanded(true),
  'toggle-expand': () => setAllExpanded(!anyExpanded()),
  'auto-reveal': () => toggleAutoReveal(),
  'toggle-left': () => toggleSide('left'),
  back: () => goHist(-1),
  forward: () => goHist(1),
  'toggle-mode': () => setMode(S.mode === 'edit' ? 'read' : 'edit'),
  'toggle-right': () => toggleSide('right'),
  'note-menu': () => {
    if (!S.cur) return;
    const r = $('[data-cmd=note-menu]').getBoundingClientRect();
    const drawing = S.view === 'drawing';
    menu(r.left - 150, r.bottom + 4, [
      ['Rename…', () => renameDialog(S.cur)],
      ['Move to…', () => moveDialog(S.cur)],
      ['Open local graph', () => openGraph(true)],
      ...(drawing ? [['Export as SVG', () => exportDrawing('svg')], ['Export as PNG', () => exportDrawing('png')]] : [['Insert template', () => insertTemplate()]]),
      ...(drawing && isMd(S.cur) ? [['Open as Markdown', () => openPath(S.cur, { raw: true })]] : []),
      ...(S.view === 'note' ? [['New drawing embedded here', () => newDrawingInNote()]] : []),
      [isBookmarked(S.cur) ? 'Remove bookmark' : 'Bookmark', () => toggleBookmark()],
      ['Version history…', () => openHistory(S.cur)],
      ...(S.view === 'note' ? [null, ['Export to PDF…', () => printNote()], ['Export to HTML', () => exportHtml()], ['Copy as formatted text', () => copyHtml()], null] : []),
      ['Copy path', () => navigator.clipboard?.writeText(S.cur).then(() => toast('Copied'))],
      null,
      ['Delete', () => deletePath(S.cur), 'danger'],
    ]);
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (b && CMD[b.dataset.cmd]) { e.preventDefault(); CMD[b.dataset.cmd](); }
});

window.addEventListener('keydown', onHotkey);

