/* Cinder app — Cinder’s own right-click menu and field suggestions. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ native-looking bits, replaced

// Right-click anywhere that has no menu of its own: Cinder's menu for text (cut, copy, paste,
// select all, and formatting in the editor), never the browser's. Shift+right-click still gives
// the browser's, for its spelling suggestions.
document.addEventListener('contextmenu', e => {
  if (e.defaultPrevented || e.shiftKey) return;
  e.preventDefault();
  const t = e.target;
  const field = t.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea');
  const reg = EDITORS.get(t.closest?.('.cm-editor'));
  const selText = String(window.getSelection() || '');
  if (!field && !reg && !selText) return; // nothing to offer here
  const editable = (!!field && !field.readOnly && !field.disabled) || !!reg;
  const hasSel = field ? field.selectionStart !== field.selectionEnd : reg ? reg.ed.selectionStart !== reg.ed.selectionEnd : !!selText;
  const off = on => on ? '' : 'disabled';
  const items = [];
  if (editable) items.push(['Cut', () => document.execCommand('cut'), off(hasSel)]);
  items.push(['Copy', () => document.execCommand('copy'), off(hasSel)]);
  if (editable) items.push(['Paste', () => pasteInto(field, reg)]);
  items.push(null, ['Select all', () => {
    if (field) field.select();
    else if (reg) reg.ed.setSelectionRange(0, reg.ed.value.length);
    else getSelection().selectAllChildren(t.closest('#preview, .hp-body, .markdown, .modal') || document.body);
  }]);
  if (reg) items.push(null, ...['bold', 'italic', 'highlight', 'code', 'wikilink', 'inline-math'].filter(id => CinderEditor.commands[id]).map(id => [CinderEditor.commands[id].name, () => { reg.ed.focus(); reg.ed.run(id); }]));
  menu(e.clientX, e.clientY, items);
});
async function pasteInto(field, reg) {
  let text;
  try { text = await navigator.clipboard.readText(); }
  catch { return toast('Press Ctrl+V to paste here (a menu can’t read the clipboard)'); }
  if (field) { field.focus(); field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end'); field.dispatchEvent(new Event('input', { bubbles: true })); }
  else if (reg) { reg.ed.focus(); reg.ed.insert(reg.ed.selectionStart, reg.ed.selectionEnd, text); }
}

// Fields: no browser autofill, and suggestion lists (<datalist>) shown as Cinder's own dropdown.
// The first time a field is focused its list moves to data-suggest, which turns the native one off.
const suggest = { el: null, input: null, items: [], i: -1 };
function suggestionsFor(input) {
  const dl = document.getElementById(input.dataset.suggest);
  if (!dl) return [];
  const q = input.value.trim().toLowerCase();
  const all = [...dl.options].map(o => o.value).filter(Boolean);
  return all.filter(v => v.toLowerCase() !== q && (!q || v.toLowerCase().includes(q)))
    .sort((a, b) => (b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q))).slice(0, 8);
}
function showSuggest(input) {
  suggest.input = input;
  suggest.items = suggestionsFor(input);
  suggest.i = -1;
  if (!suggest.items.length) return hideSuggest();
  if (!suggest.el) {
    suggest.el = document.createElement('div');
    suggest.el.className = 'suggest-pop';
    suggest.el.addEventListener('mousedown', e => {
      e.preventDefault(); // keep the field focused
      const it = e.target.closest('[data-i]');
      if (it) pickSuggest(+it.dataset.i);
    });
    document.body.append(suggest.el);
  }
  suggest.el.innerHTML = suggest.items.map((v, i) => `<div data-i="${i}">${esc(v)}</div>`).join('');
  const r = input.getBoundingClientRect();
  suggest.el.hidden = false;
  suggest.el.style.minWidth = Math.max(160, r.width) + 'px';
  suggest.el.style.left = Math.min(r.left, innerWidth - suggest.el.offsetWidth - 8) + 'px';
  const below = r.bottom + 4 + suggest.el.offsetHeight < innerHeight;
  suggest.el.style.top = (below ? r.bottom + 4 : r.top - suggest.el.offsetHeight - 4) + 'px';
}
function hideSuggest() { if (suggest.el) suggest.el.hidden = true; suggest.i = -1; }
function pickSuggest(i) {
  const input = suggest.input, v = suggest.items[i];
  if (!input || v == null) return;
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  hideSuggest();
}
document.addEventListener('focusin', e => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
  if (!t.hasAttribute('autocomplete')) t.setAttribute('autocomplete', 'off');
  if (t.hasAttribute('list')) { t.dataset.suggest = t.getAttribute('list'); t.removeAttribute('list'); }
  if (t.dataset.suggest) showSuggest(t);
}, true);
document.addEventListener('input', e => { if (e.target.dataset?.suggest && e.target === document.activeElement) showSuggest(e.target); }, true);
document.addEventListener('focusout', e => { if (e.target === suggest.input) setTimeout(() => { if (document.activeElement !== suggest.input) hideSuggest(); }, 0); }, true);
// ↑↓ choose, Enter or Tab takes it (and Enter still reaches the field, so it commits), Esc closes.
document.addEventListener('keydown', e => {
  if (!suggest.el || suggest.el.hidden || e.target !== suggest.input) return;
  const n = suggest.items.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    suggest.i = (suggest.i + (e.key === 'ArrowDown' ? 1 : -1) + n + 1) % (n + 1) - (0);
    if (suggest.i >= n) suggest.i = -1;
    [...suggest.el.children].forEach((c, i) => c.classList.toggle('sel', i === suggest.i));
  } else if ((e.key === 'Enter' || e.key === 'Tab') && suggest.i >= 0) {
    pickSuggest(suggest.i);
    if (e.key === 'Tab') e.preventDefault();
  } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSuggest(); }
}, true);
addEventListener('resize', hideSuggest);
document.addEventListener('scroll', e => { if (suggest.input && !suggest.el?.contains(e.target)) hideSuggest(); }, true);


