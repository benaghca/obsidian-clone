/* Cinder kanban: boards in the format of Obsidian's Kanban plugin, a note with `kanban-plugin` in
 * its frontmatter whose ## headings are lists and whose - [ ] items are cards (a **Complete** line
 * marks a list whose cards are done). Reading view draws such a note as a board: drag cards
 * between and within lists (or Alt+arrows on a focused card), add, tick and edit them, rename and
 * add lists. Each change rewrites
 * the note's Markdown; what the board doesn't use (the frontmatter, the archive, the plugin's
 * settings block) is kept as it was. The parsing parts don't touch the DOM and are tested under Node. */
'use strict';

(function (root) {
  const LANE = /^##\s+(.*?)\s*$/;
  const CARD = /^[-*+][ \t]+(?:\[(.)\][ \t]+)?(.*)$/;
  // Where the lists end: the archive (a *** line) or the plugin's settings.
  const TAIL = /^(\*\*\*|---)\s*$|^%% kanban:settings/;

  const isBoard = fm => !!fm && fm['kanban-plugin'] != null;

  // A board note -> {head, lanes: [{title, complete, cards: [{status, text}], extra: [lines]}], tail}.
  // status is the checkbox's character (' ', 'x'…) or null for a card without one; text may span
  // lines (the indented lines under an item).
  function parse(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    // The frontmatter, and anything before the first list.
    if (lines[0] === '---') { i = 1; while (i < lines.length && lines[i] !== '---') i++; i++; }
    while (i < lines.length && !LANE.test(lines[i])) i++;
    const head = lines.slice(0, i).join('\n');
    const lanes = [];
    let lane = null, card = null;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (TAIL.test(l) && lanes.length) break;
      let m;
      if ((m = LANE.exec(l))) { lane = { title: m[1], complete: false, cards: [], extra: [] }; lanes.push(lane); card = null; continue; }
      if (!lane) continue;
      if (/^\*\*Complete\*\*\s*$/.test(l)) { lane.complete = true; card = null; continue; }
      if ((m = CARD.exec(l))) { card = { status: m[1] ?? null, text: m[2] }; lane.cards.push(card); continue; }
      if (card && /^[ \t]+\S/.test(l)) { card.text += '\n' + l.replace(/^(\t| {1,4})/, ''); continue; }
      if (!l.trim()) { card = null; continue; }
      lane.extra.push(l); card = null;
    }
    return { head, lanes, tail: lines.slice(i).join('\n') };
  }

  // Back to Markdown, spaced as the Kanban plugin writes it.
  function serialize(b) {
    const lanes = b.lanes.map(l => {
      const cards = l.cards.map(c => `- ${c.status != null ? `[${c.status}] ` : ''}${c.text.split('\n').join('\n\t')}`);
      return [`## ${l.title}`, '', ...(l.complete ? ['**Complete**'] : []), ...cards, ...(l.extra.length ? ['', ...l.extra] : [])].join('\n');
    });
    const tail = b.tail.replace(/^\s+/, '');
    return (b.head.replace(/\s+$/, '') + '\n\n' + lanes.join('\n\n\n') + (tail.startsWith('%%') ? '\n\n\n\n\n' : '\n\n\n') + tail).replace(/\s+$/, '') + '\n';
  }

  // Move card `from` = [lane, index] to list `toLane` before index `toIndex`. A card going into a
  // **Complete** list is ticked, and one leaving it for another list unticked, as in the plugin.
  function moveCard(b, from, toLane, toIndex) {
    const [fl, fi] = from, src = b.lanes[fl], dst = b.lanes[toLane];
    const [card] = src.cards.splice(fi, 1);
    if (fl === toLane && toIndex > fi) toIndex--;
    if (dst.complete && !src.complete) card.status = 'x';
    else if (src.complete && !dst.complete && card.status != null) card.status = ' ';
    dst.cards.splice(Math.max(0, Math.min(toIndex, dst.cards.length)), 0, card);
    return b;
  }

  const pure = { isBoard, parse, serialize, moveCard };
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = pure;
    return;
  }

  // ============================================================ the board

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The card to focus once the board is drawn again (after a move by keyboard): [list, index].
  let focusAfter = null;

  // Draw the board for `text` in `host` (in place of what it held). h: {inline(text) -> html, change(newText)}.
  function mount(host, text, h) {
    const b = parse(text);
    const commit = () => h.change(serialize(b));
    // Its own element, so the listeners go when the board is drawn again.
    const el = document.createElement('div');
    el.className = 'kb-root';
    host.replaceChildren(el);
    el.innerHTML = `<div class="kb-board">${b.lanes.map((l, li) => `
      <section class="kb-lane" data-lane="${li}">
        <header class="kb-head"><h3 class="kb-title" tabindex="0" title="Double-click to rename">${esc(l.title)}</h3><span class="kb-count">${l.cards.length}</span>${l.complete ? '<span class="kb-done" title="Cards moved here are ticked">✓</span>' : ''}</header>
        <div class="kb-cards">${l.cards.map((c, ci) => `
          <article class="kb-card${c.status === 'x' || c.status === 'X' ? ' done' : ''}" draggable="true" data-card="${ci}" tabindex="0">
            ${c.status != null ? `<input type="checkbox" class="kb-check"${c.status !== ' ' ? ' checked' : ''} aria-label="Done">` : ''}
            <div class="kb-text">${h.inline(c.text)}</div>
            <button class="kb-del" type="button" title="Delete card" aria-label="Delete card">×</button>
          </article>`).join('')}
        </div>
        <button class="kb-add" type="button">+ Add a card</button>
      </section>`).join('')}
      <button class="kb-add-lane" type="button">+ Add a list</button>
    </div>`;
    if (focusAfter) { el.querySelector(`.kb-lane[data-lane="${focusAfter[0]}"] .kb-card[data-card="${focusAfter[1]}"]`)?.focus(); focusAfter = null; }
    const cardAt = e => { const c = e.target.closest('.kb-card'); return c ? [+c.closest('.kb-lane').dataset.lane, +c.dataset.card] : null; };

    el.addEventListener('change', e => {
      if (!e.target.matches('.kb-check')) return;
      const [li, ci] = cardAt(e);
      b.lanes[li].cards[ci].status = e.target.checked ? 'x' : ' ';
      commit();
    });
    el.addEventListener('click', e => {
      if (e.target.closest('a')) return; // links in cards open as anywhere else
      if (e.target.matches('.kb-del')) { const [li, ci] = cardAt(e); b.lanes[li].cards.splice(ci, 1); return commit(); }
      if (e.target.matches('.kb-add')) return editor(e.target, '', t => { if (t) { b.lanes[+e.target.closest('.kb-lane').dataset.lane].cards.push({ status: ' ', text: t }); commit(); } });
      if (e.target.matches('.kb-add-lane')) return editor(e.target, '', t => { if (t) { b.lanes.push({ title: t, complete: false, cards: [], extra: [] }); commit(); } }, true);
    });
    el.addEventListener('dblclick', e => {
      const title = e.target.closest('.kb-title');
      if (title) { const li = +title.closest('.kb-lane').dataset.lane; return editor(title, b.lanes[li].title, t => { if (t && t !== b.lanes[li].title) { b.lanes[li].title = t; commit(); } }, true); }
      const at = cardAt(e);
      if (at && !e.target.closest('a, .kb-check, .kb-del')) {
        const card = b.lanes[at[0]].cards[at[1]];
        editor(e.target.closest('.kb-card'), card.text, t => {
          if (t === card.text) return;
          if (t) card.text = t; else b.lanes[at[0]].cards.splice(at[1], 1);
          commit();
        });
      }
    });
    el.addEventListener('keydown', e => {
      if (e.target.closest('textarea')) return;
      // Alt+arrows move the focused card: ←/→ to the next list, ↑/↓ within its list.
      const at = e.target.matches('.kb-card') && e.altKey && cardAt(e);
      if (at && /^Arrow/.test(e.key)) {
        e.preventDefault(); e.stopPropagation(); // not the app's Alt+←/→ (back, forward)
        const [li, ci] = at, side = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const to = side ? [li + side, Math.min(ci, b.lanes[li + side]?.cards.length ?? 0)] : [li, ci + (e.key === 'ArrowUp' ? -1 : 2)];
        if (!b.lanes[to[0]] || to[1] < 0 || (!side && to[1] > b.lanes[li].cards.length)) return;
        moveCard(b, at, to[0], to[1]);
        focusAfter = [to[0], side ? to[1] : ci + (e.key === 'ArrowUp' ? -1 : 1)];
        return commit();
      }
      if (e.key !== 'Enter') return;
      if (e.target.matches('.kb-title, .kb-card')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
    });

    // Dragging a card: it goes before the card under the pointer, or at the end of the list.
    let dragging = null;
    const marker = document.createElement('div');
    marker.className = 'kb-drop';
    el.addEventListener('dragstart', e => {
      const at = cardAt(e);
      if (!at) return;
      dragging = at;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', b.lanes[at[0]].cards[at[1]].text);
      e.target.closest('.kb-card').classList.add('dragging');
    });
    const dropPlace = e => {
      const lane = e.target.closest('.kb-lane');
      if (!lane) return null;
      const cards = [...lane.querySelectorAll('.kb-card')];
      const before = cards.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      return { lane, li: +lane.dataset.lane, index: before ? +before.dataset.card : cards.length, before };
    };
    el.addEventListener('dragover', e => {
      if (!dragging) return;
      const p = dropPlace(e);
      if (!p) return;
      e.preventDefault();
      const list = p.lane.querySelector('.kb-cards');
      if (p.before) list.insertBefore(marker, p.before); else list.append(marker);
    });
    el.addEventListener('drop', e => {
      const p = dragging && dropPlace(e);
      if (!p) return;
      e.preventDefault();
      moveCard(b, dragging, p.li, p.index);
      dragging = null;
      commit();
    });
    el.addEventListener('dragend', () => { dragging = null; marker.remove(); el.querySelector('.kb-card.dragging')?.classList.remove('dragging'); });

    // A text box in place of `anchor`: Enter keeps it (Shift+Enter for a new line in a card), Esc
    // or leaving it untouched gives up.
    function editor(anchor, value, done, oneLine = false) {
      const ta = document.createElement('textarea');
      ta.className = 'kb-edit field';
      ta.value = value;
      ta.rows = oneLine ? 1 : Math.max(2, value.split('\n').length);
      anchor.hidden = true;
      anchor.after(ta);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      let over = false;
      const finish = keep => {
        if (over) return;
        over = true;
        const t = ta.value.replace(/\s+$/, '').replace(/^\s+/, '');
        ta.remove(); anchor.hidden = false;
        if (keep) done(oneLine ? t.replace(/\s*\n\s*/g, ' ') : t);
      };
      ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      });
      ta.addEventListener('blur', () => finish(ta.value.trim() !== value.trim()));
    }
  }

  root.CinderKanban = { ...pure, mount };
})(typeof window !== 'undefined' ? window : globalThis);
