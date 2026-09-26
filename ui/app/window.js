/* Cinder app — presenting a canvas, and the desktop window’s own frame. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ presenting a canvas

// Everything but the canvas goes, and the window (or the page, in a browser) goes full screen.
function presentMode(on) {
  document.body.classList.toggle('presenting', on);
  if (NATIVE && window.ipc) window.ipc.postMessage('win:fullscreen:' + (on ? 'on' : 'off'));
  else if (on) document.documentElement.requestFullscreen?.().catch(() => { });
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { });
}
// Leaving the browser's full screen (its own Esc) ends the presentation too.
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('presenting')) CinderCanvas.endPresent(); });

// ============================================================ window frame (desktop app)

// Cinder can draw its own title bar: the tab bar (and the sidebars' header rows) move the window,
// double-click maximizes, and buttons at the top right minimize, maximize and close. The frame
// choice lives in the app's config, since the window is made before the page loads.
const winCmd = c => { if (NATIVE && window.ipc) window.ipc.postMessage('win:' + c); };
if (NATIVE) cfg.windowFrame = $('meta[name=cinder-frame]')?.content === 'custom' ? 'custom' : 'native';

let frameNow = cfg.windowFrame; // what the window was made with
function setFrame(kind) {
  if (!NATIVE) return;
  const custom = kind === 'custom';
  if (kind !== frameNow) { winCmd('frame:' + kind); frameNow = kind; }
  document.body.classList.toggle('frame-custom', custom);
  if (custom && !$('#win-controls')) {
    const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
    const bar = document.createElement('div');
    bar.id = 'win-controls';
    bar.innerHTML = `<button data-win="min" title="Minimize" tabindex="-1">${svg('<path d="M6 12h12"/>')}</button><button data-win="max" title="Maximize" tabindex="-1">${svg('<rect x="6.5" y="6.5" width="11" height="11" rx="1"/>')}</button><button data-win="close" class="close" title="Close" tabindex="-1">${svg('<path d="m7 7 10 10M17 7 7 17"/>')}</button>`;
    document.body.append(bar);
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const edge = document.createElement('div');
      edge.className = `win-edge win-${d}`; edge.dataset.dir = d;
      document.body.append(edge);
    }
  }
}
window.__cinderWinState = max => {
  document.body.classList.toggle('win-max', !!max);
  const b = $('#win-controls [data-win=max]');
  if (b) { b.title = max ? 'Restore' : 'Maximize'; b.innerHTML = max ? '<svg viewBox="0 0 24 24"><rect x="5.5" y="8.5" width="10" height="10" rx="1"/><path d="M8.5 8.5v-3h10v10h-3"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1"/></svg>'; }
};
// Empty parts of the top bars drag the window; a double-click maximizes.
const DRAG_AREAS = '#tabbar, #left .panel-head, #right .tabs, #viewbar';
document.addEventListener('mousedown', e => {
  if (!document.body.classList.contains('frame-custom') || e.button !== 0) return;
  const win = e.target.closest('#win-controls [data-win]');
  if (win) { e.preventDefault(); return winCmd(win.dataset.win); }
  const edge = e.target.closest('.win-edge');
  if (edge) { e.preventDefault(); return winCmd('resize:' + edge.dataset.dir); }
  if (!e.target.closest(DRAG_AREAS) || e.target.closest('button, input, select, a, .tab, #crumbs, [contenteditable]')) return;
  e.preventDefault();
  winCmd(e.detail === 2 ? 'max' : 'drag');
});
setFrame(cfg.windowFrame);

