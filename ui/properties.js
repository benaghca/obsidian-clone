/* Cinder properties: the table of a note's frontmatter at the top of the page, like Obsidian's
 * Properties. Each property has a type (text, list, number, checkbox, date, date & time, tags,
 * aliases), stored the way Obsidian does in .obsidian/types.json, with an editor to match. The
 * host owns the text: this module only reports edits (set/rename) and redraws when told. */
'use strict';

(function (root) {
  // ------------------------------------------------------------ types (pure)

  const TYPES = [
    ['text', 'Text'], ['multitext', 'List'], ['number', 'Number'], ['checkbox', 'Checkbox'],
    ['date', 'Date'], ['datetime', 'Date & time'], ['tags', 'Tags'], ['aliases', 'Aliases'],
  ];
  const TYPE_NAME = Object.fromEntries(TYPES);
  const LISTY = t => t === 'multitext' || t === 'tags' || t === 'aliases';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

  // The type Obsidian would pick for a property it hasn't seen typed.
  function inferType(key, value) {
    const k = String(key).toLowerCase();
    if (k === 'tags' || k === 'tag') return 'tags';
    if (k === 'aliases' || k === 'alias') return 'aliases';
    if (k === 'cssclasses' || k === 'cssclass') return 'multitext';
    if (Array.isArray(value)) return 'multitext';
    if (typeof value === 'boolean') return 'checkbox';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string' && DATE_RE.test(value.trim())) return 'date';
    if (typeof value === 'string' && DATETIME_RE.test(value.trim())) return 'datetime';
    return 'text';
  }

  const asText = v => v == null ? '' : Array.isArray(v) ? v.map(asText).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const asList = v => v == null || v === '' ? [] : Array.isArray(v) ? v.map(asText).filter(x => x !== '') : String(v).split(/\s*,\s*/).filter(Boolean);

  // A value converted to what a type holds (when the type changes, or a file disagrees with it).
  function coerce(value, type) {
    switch (type) {
      case 'multitext': case 'aliases': return asList(value);
      case 'tags': return asList(value).map(t => t.replace(/^#/, '')).filter(Boolean);
      case 'number': { if (typeof value === 'number') return value; const n = parseFloat(asText(value)); return isFinite(n) ? n : null; }
      case 'checkbox': return value === true || /^(true|yes|on|1|x)$/i.test(asText(value).trim());
      case 'date': { const m = /^(\d{4}-\d{2}-\d{2})/.exec(asText(value).trim()); return m ? m[1] : null; }
      case 'datetime': { const s = asText(value).trim(); if (DATETIME_RE.test(s)) return s.replace(' ', 'T').slice(0, 16); return DATE_RE.test(s) ? s + 'T00:00' : null; }
      default: return value == null ? null : Array.isArray(value) ? asText(value) : typeof value === 'boolean' || typeof value === 'number' ? String(value) : value;
    }
  }

  const pure = { TYPES, inferType, coerce, asList, asText };
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = pure;
    return;
  }

  // ------------------------------------------------------------ UI

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = d => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    text: svg('<path d="M5 7h14M5 12h14M5 17h9"/>'),
    multitext: svg('<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17" r="1"/>'),
    number: svg('<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>'),
    checkbox: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>'),
    date: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    datetime: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'),
    tags: svg('<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.4"/>'),
    aliases: svg('<path d="M15 4l4 4-4 4"/><path d="M19 8H9a5 5 0 0 0 0 10h2"/>'),
    add: svg('<path d="M12 5v14M5 12h14"/>'),
    chevron: svg('<path d="m9 6 6 6-6 6"/>'),
    x: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
  };

  // Where focus should land after the host redraws (edits cause a redraw).
  let pending = null; // { key, part: 'key' | 'value' | 'add' | 'chip-input' }

  // Draw the properties of `props` into `el`.
  // o: { props, typeOf(key, value), setType(key, type), set(key, value|undefined), rename(from, to) -> bool,
  //      keys() -> [{name, type}], values(key) -> [string], inline(el, text), tag(t), menu(x, y, items),
  //      collapsed, onCollapse(bool), onExit('up'|'down'), readOnly }
  function render(el, o) {
    const keys = Object.keys(o.props || {});
    const uid = 'pp' + Math.random().toString(36).slice(2, 8);
    el.classList.add('pp');
    el.classList.toggle('pp-collapsed', !!o.collapsed);
    el.innerHTML = `<div class="pp-head"><button class="pp-fold" type="button" title="${o.collapsed ? 'Show' : 'Hide'} properties" aria-expanded="${!o.collapsed}">${ICONS.chevron}<span>Properties</span>${o.collapsed ? `<small>${keys.length}</small>` : ''}</button></div>
      <div class="pp-rows" role="table"></div>
      ${o.readOnly ? '' : `<button class="pp-add" type="button">${ICONS.add}<span>Add property</span></button>`}
      <datalist id="${uid}-keys"></datalist>`;
    const rows = el.querySelector('.pp-rows');
    if (!o.collapsed) for (const k of keys) rows.append(row(k));
    el.querySelector('.pp-fold').onclick = () => o.onCollapse?.(!o.collapsed);

    function row(key) {
      const raw = o.props[key], type = o.typeOf(key, raw), value = coerce(raw, type);
      const r = document.createElement('div');
      r.className = `pp-row pp-t-${type}`;
      r.dataset.key = key;
      r.innerHTML = `<button class="pp-type" type="button" title="${esc(TYPE_NAME[type] || type)} · click for options">${ICONS[type] || ICONS.text}</button>
        <input class="pp-key" value="${esc(key)}" spellcheck="false" aria-label="Property name"${o.readOnly ? ' readonly' : ''}>
        <div class="pp-value"></div>`;
      const cell = r.querySelector('.pp-value');
      valueEditor(cell, key, type, value);
      // Rename on commit; a clash puts the old name back.
      const kin = r.querySelector('.pp-key');
      const commitKey = move => {
        const to = kin.value.trim();
        if (!to || to === key) { kin.value = key; return false; }
        if (to in o.props) { kin.value = key; kin.classList.add('pp-bad'); setTimeout(() => kin.classList.remove('pp-bad'), 900); return false; }
        pending = move ? { key: to, part: 'value' } : null; // (a rename on blur leaves focus where it went)
        o.rename(key, to);
        return true;
      };
      kin.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); if (!commitKey(true)) focusPart(r, 'value'); }
        else if (e.key === 'Escape') { e.preventDefault(); kin.value = key; o.onExit?.('down'); }
      });
      kin.addEventListener('blur', () => commitKey(false));
      r.querySelector('.pp-type').onclick = e => {
        if (o.readOnly) return;
        const b = e.currentTarget.getBoundingClientRect();
        o.menu(b.left, b.bottom + 4, [
          ...TYPES.map(([t, name]) => [`${name}${t === type ? '  ✓' : ''}`, () => { pending = { key, part: 'value' }; o.setType(key, t); }]),
          null,
          ['Remove property', () => { pending = { key: nextKey(key), part: 'key' }; o.set(key, undefined); }, 'danger'],
        ]);
      };
      return r;
    }
    const nextKey = key => { const i = keys.indexOf(key); return keys[i + 1] ?? keys[i - 1] ?? null; };

    function valueEditor(cell, key, type, value) {
      const ro = o.readOnly;
      // hint: where focus goes after the redraw (null when the edit came from focus leaving).
      const put = (v, hint = null) => { pending = hint; o.set(key, v); };
      const here = inp => document.activeElement === inp ? { key, part: 'value' } : null;
      if (type === 'checkbox') {
        cell.innerHTML = `<input type="checkbox" class="pp-check"${value ? ' checked' : ''}${ro ? ' disabled' : ''} aria-label="${esc(key)}">`;
        cell.firstChild.onchange = e => put(e.target.checked, { key, part: 'value' });
        return;
      }
      if (type === 'number' || type === 'date' || type === 'datetime') {
        const t = type === 'number' ? 'number' : type === 'date' ? 'date' : 'datetime-local';
        cell.innerHTML = `<input class="pp-input" type="${t}" value="${esc(value ?? '')}"${type === 'number' ? ' step="any"' : ''}${ro ? ' readonly' : ''} aria-label="${esc(key)}">`;
        const inp = cell.firstChild;
        const commit = hint => {
          const v = inp.value === '' ? null : type === 'number' ? Number(inp.value) : inp.value;
          if (v === (value ?? null)) return false;
          put(v, hint);
          return true;
        };
        inp.addEventListener('change', () => commit(here(inp)));
        inp.addEventListener('keydown', e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (!commit(nextKey(key) ? { key: nextKey(key), part: 'value' } : { part: 'add' })) focusAfter(key);
        });
        return;
      }
      if (LISTY(type)) return chips(cell, key, type, value, put);
      // Text: shown with its links rendered; click (or focus) to edit.
      const show = () => {
        cell.innerHTML = `<div class="pp-display" tabindex="0" role="textbox" aria-label="${esc(key)}"></div>`;
        const d = cell.firstChild;
        if (value) o.inline(d, value); else d.innerHTML = '<span class="pp-empty">Empty</span>';
        // typed: a character that started the edit (typing on the focused value appends it).
        const edit = (e, typed = '') => {
          if (ro || e?.target?.closest?.('a, .internal-link, .tag')) return;
          const inp = document.createElement('input');
          inp.className = 'pp-input'; inp.value = (value || '') + typed; inp.spellcheck = true; inp.setAttribute('list', `${uid}-vals`);
          suggest(`${uid}-vals`, o.values?.(key) || []);
          cell.replaceChildren(inp);
          inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
          let done = false;
          const finish = (save, move) => {
            if (done) return; done = true;
            const v = inp.value;
            if (save && v !== (value || '')) put(v === '' ? null : v, !move ? null : nextKey(key) ? { key: nextKey(key), part: 'value' } : { part: 'add' });
            else { show(); if (move) focusAfter(key); }
          };
          inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); finish(true, true); }
            else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); cell.firstChild?.focus(); }
          });
          inp.addEventListener('blur', () => finish(true, false));
        };
        d.addEventListener('click', e => edit(e));
        d.addEventListener('keydown', e => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); edit(); }
          else if (e.key.length === 1) { e.preventDefault(); edit(null, e.key); }
        });
      };
      show();
    }

    // Lists, tags and aliases: one chip per item, and a box to add more.
    function chips(cell, key, type, items, put) {
      cell.innerHTML = `<div class="pp-chips">${items.map((it, i) => `<span class="pp-chip" data-i="${i}"><span class="pp-chip-text"></span>${o.readOnly ? '' : `<button class="pp-chip-x" type="button" tabindex="-1" title="Remove">${ICONS.x}</button>`}</span>`).join('')}${o.readOnly ? '' : `<input class="pp-chip-input" spellcheck="false" list="${uid}-${esc(key)}" aria-label="Add to ${esc(key)}" placeholder="${items.length ? '' : type === 'tags' ? 'Add tags' : 'Add items'}">`}</div>`;
      cell.querySelectorAll('.pp-chip-text').forEach((t, i) => {
        if (type === 'tags') { t.innerHTML = `<a class="tag" data-tag="${esc(items[i])}">#${esc(items[i])}</a>`; t.firstChild.onclick = e => { e.preventDefault(); o.tag?.(items[i]); }; }
        else o.inline(t, items[i]);
      });
      const again = { key, part: 'chip-input' };
      cell.querySelectorAll('.pp-chip-x').forEach(b => b.onclick = () => { const i = +b.parentNode.dataset.i; put(items.filter((_, j) => j !== i), again); });
      const inp = cell.querySelector('.pp-chip-input');
      if (!inp) return;
      suggest(`${uid}-${key}`, (o.values?.(key) || []).filter(v => !items.includes(v)));
      const add = () => {
        const extra = inp.value.split(',').map(s => s.trim()).map(s => type === 'tags' ? s.replace(/^#/, '') : s).filter(s => s && !items.includes(s));
        inp.value = '';
        if (extra.length) { put([...items, ...extra], document.activeElement === inp ? again : null); return true; }
        return false;
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (!add() && e.key === 'Enter') focusAfter(key); }
        else if (e.key === 'Backspace' && !inp.value && items.length) { e.preventDefault(); put(items.slice(0, -1), again); }
        else if (e.key === 'Escape') { e.preventDefault(); inp.value = ''; o.onExit?.('down'); }
      });
      inp.addEventListener('blur', () => { if (inp.value.trim()) add(); });
      cell.querySelector('.pp-chips').addEventListener('click', e => { if (e.target === e.currentTarget) inp.focus(); });
    }

    function suggest(id, vals) {
      let dl = document.getElementById(id);
      if (!dl) { dl = document.createElement('datalist'); dl.id = id; el.append(dl); }
      dl.innerHTML = vals.slice(0, 200).map(v => `<option value="${esc(v)}">`).join('');
    }

    // Enter on the last value goes to "Add property"; otherwise to the next row's value.
    function focusAfter(key) {
      const nk = nextKey(key);
      if (nk) focusPart(rows.querySelector(`.pp-row[data-key="${CSS.escape(nk)}"]`), 'value');
      else el.querySelector('.pp-add')?.focus();
    }

    // + Add property: a name box with the vault's known names; Enter adds it (typed as it's known).
    const addBtn = el.querySelector('.pp-add');
    if (addBtn) addBtn.onclick = () => startAdd();
    function startAdd() {
      if (o.collapsed) { pending = { part: 'add-open' }; o.onCollapse?.(false); return; }
      const known = (o.keys?.() || []).filter(k => !(k.name in o.props));
      suggest(`${uid}-keys`, known.map(k => k.name));
      const r = document.createElement('div');
      r.className = 'pp-row pp-new';
      r.innerHTML = `<span class="pp-type">${ICONS.text}</span><input class="pp-key" placeholder="Property name" list="${uid}-keys" spellcheck="false" aria-label="New property name"><div class="pp-value"><span class="pp-empty">Press Enter to add</span></div>`;
      rows.append(r);
      addBtn.hidden = true;
      const kin = r.querySelector('.pp-key');
      kin.focus();
      let done = false;
      const finish = save => {
        if (done) return; done = true;
        const name = kin.value.trim();
        if (save && name && !(name in o.props)) {
          const t = known.find(k => k.name === name)?.type;
          if (t) o.adopt?.(name, t); // a name already in use keeps its type here too
          pending = { key: name, part: 'value' };
          o.set(name, t && LISTY(t) ? [] : t === 'checkbox' ? false : null);
        } else if (save && name in o.props) { r.remove(); addBtn.hidden = false; focusPart(rows.querySelector(`.pp-row[data-key="${CSS.escape(name)}"]`), 'value'); }
        else { r.remove(); addBtn.hidden = false; }
      };
      kin.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); addBtn.focus(); }
      });
      kin.addEventListener('blur', () => setTimeout(() => finish(!!kin.value.trim()), 0));
    }

    // ↑/↓ move between rows in the same column; off either end hands the keyboard back to the page.
    el.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const t = e.target;
      if (t.type === 'number' || t.type === 'date' || t.type === 'datetime-local') return; // arrows change those
      const list = [...rows.querySelectorAll('.pp-row:not(.pp-new)')];
      const r = t.closest('.pp-row'), i = r ? list.indexOf(r) : t.closest('.pp-add') ? list.length : -1;
      const part = t.closest('.pp-key') ? 'key' : 'value';
      const j = i + (e.key === 'ArrowDown' ? 1 : -1);
      e.preventDefault();
      if (j < 0) return o.onExit?.('up');
      if (j >= list.length) { if (i < list.length && addBtn && !addBtn.hidden) return addBtn.focus(); return o.onExit?.('down'); }
      focusPart(list[j], part);
    });

    // Put the keyboard back where the last edit left it.
    if (pending) {
      const p = pending;
      requestAnimationFrame(() => {
        if (!el.isConnected || pending !== p) return;
        pending = null;
        if (p.part === 'add-open') return startAdd();
        if (p.part === 'add') return el.querySelector('.pp-add')?.focus();
        const r = p.key != null && rows.querySelector(`.pp-row[data-key="${CSS.escape(p.key)}"]`);
        if (r) focusPart(r, p.part); else el.querySelector('.pp-add')?.focus();
      });
    }
    return {
      focus(where = 'first') {
        const list = rows.querySelectorAll('.pp-row');
        if (!list.length || o.collapsed) return (el.querySelector('.pp-add') || el.querySelector('.pp-fold')).focus();
        // The name column: ↑/↓ move between rows from there (date and number fields keep the arrows).
        focusPart(where === 'last' ? list[list.length - 1] : list[0], 'key');
      },
      add: () => startAdd(),
    };
  }

  function focusPart(r, part) {
    if (!r) return;
    const t = part === 'key' ? r.querySelector('.pp-key')
      : part === 'chip-input' ? r.querySelector('.pp-chip-input')
        : r.querySelector('.pp-value :is(.pp-chip-input, .pp-display, .pp-input, .pp-check)') || r.querySelector('.pp-key');
    t?.focus();
  }

  root.CinderProps = { ...pure, render };
})(typeof window !== 'undefined' ? window : globalThis);
