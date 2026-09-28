/* Cinder flashcards: spaced repetition in the format of Obsidian's Spaced Repetition plugin
 * (st3v3nmw/obsidian-spaced-repetition, with its default settings). Cards are written in notes
 * tagged #flashcards, each card's schedule is kept after it as <!--SR:!date,interval,ease-->, and
 * answers are scheduled with the plugin's default "OSR" algorithm (SM-2 style).
 * No DOM here: parsing, scheduling and rewriting are tested under Node. */
'use strict';

(function (root) {
  // ============================================================ dates (local "YYYY-MM-DD" strings)

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const daysBetween = (a, b) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 864e5);
  const today = (now = new Date()) => ymd(now);
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const valid = (y, mo, d) => { const x = new Date(y, mo - 1, d); return x.getFullYear() === y && x.getMonth() === mo - 1 && x.getDate() === d ? ymd(x) : null; };
  // The plugin reads YYYY-MM-DD, DD-MM-YYYY and "ddd MMM DD YYYY" ("Wed Mar 06 2024"), and writes the first.
  function readDate(s) {
    let m;
    s = String(s).trim();
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return valid(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s))) return valid(+m[3], +m[2], +m[1]);
    if ((m = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{4})$/.exec(s))) {
      const mo = MONTHS.indexOf(m[1].toLowerCase());
      return mo < 0 ? null : valid(+m[3], mo + 1, +m[2]);
    }
    return null;
  }

  // ============================================================ scheduling (the plugin's osrSchedule())

  const BASE_EASE = 250, EASY_BONUS = 1.3, LAPSE = 0.5, MAX_INTERVAL = 36525;
  const NEW_DATE = '2000-01-01'; // the plugin's placeholder for a side not reviewed yet
  const RESPONSES = ['again', 'hard', 'good', 'easy'];

  // side: { due: 'YYYY-MM-DD' or null (new), interval, ease }. load: a Map of due date -> sides due
  // then, for spreading long intervals over quieter days (the plugin's load balancing), or null.
  function schedule(side, response, day = today(), load = null) {
    const isNew = !side.due;
    let interval = isNew ? 1 : Math.max(1, side.interval), ease = isNew ? BASE_EASE : side.ease;
    const late = isNew ? 0 : Math.max(0, daysBetween(side.due, day));
    if (response === 'easy') { ease += 20; interval = (interval + late) * ease / 100 * EASY_BONUS; }
    else if (response === 'good') interval = (interval + late / 2) * ease / 100;
    else if (response === 'hard') { ease = Math.max(130, ease - 20); interval = Math.max(1, (interval + late / 4) * LAPSE); }
    else if (response === 'again') { ease = Math.max(130, ease - 20); interval = 0; }
    else throw new Error('Unknown response: ' + response);
    interval = Math.round(interval);
    if (interval > 7 && load) {
      const fuzz = interval <= 21 ? 1 : interval <= 180 ? Math.min(3, Math.floor(interval * 0.05)) : Math.min(7, Math.floor(interval * 0.025));
      interval = leastBusy(interval, fuzz, day, load);
    }
    interval = Math.min(interval, MAX_INTERVAL);
    return { due: addDays(day, interval), interval, ease };
  }

  // The plugin's findLeastUsedIntervalOverRange: an empty day wins at once, else the quietest.
  function leastBusy(interval, fuzz, day, load) {
    const busy = i => load.get(addDays(day, i)) || 0;
    if (!busy(interval)) return interval;
    let best = interval;
    for (let i = 1; i <= fuzz; i++) for (const iv of [interval - i, interval + i]) {
      if (!busy(iv)) return iv;
      if (busy(iv) < busy(best)) best = iv;
    }
    return best;
  }

  // "25 days", "1.5 months", "1.1 years", as the plugin words it.
  function intervalText(days) {
    if (days < 1) return 'today';
    const m = Math.round(days / 3.04375) / 10, y = Math.round(days / 36.525) / 10;
    const unit = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    return m < 1 ? unit(days, 'day') : y < 1 ? unit(m, 'month') : unit(y, 'year');
  }

  // ============================================================ cards (the plugin's parse())

  const DECK_TAG = /(^|\s)#(flashcards(?:\/[^\s#]+)?)(?=\s|$)/gi;
  const OWN_DECK = /^#(flashcards(?:\/[^\s#]+)?)\s+/i;
  const isDeck = t => /^flashcards(\/|$)/i.test(t);
  const CLOZE = /==(?!=)(?:(\d+);;)?(.+?)(?:;;(.+?))?==/g;
  const HAS_CLOZE = /==(?!=).+?==/;
  const CLOZE_ONE = new RegExp(CLOZE.source); // one match, no lastIndex to carry over
  // Inline code blanked out (same length), so ==…== inside it isn't taken for a highlight.
  const maskCode = s => s.replace(/`[^`\n]*`/g, m => ' '.repeat(m.length));
  const SR_COMMENT = /\s?<!--SR:(.*?)-->/;
  const BLOCK_ID = / \^[a-zA-Z0-9-]+$/;
  const CALLOUT = '> [!sr|card-metadata]';

  // Is the first `sep` in the line outside inline code?
  function hasMarker(line, sep) {
    const i = line.indexOf(sep);
    if (i < 0) return false;
    const ticks = s => (s.match(/`/g) || []).length;
    return !(ticks(line.slice(0, i)) % 2 === 1 && ticks(line.slice(i + sep.length)) % 2 === 1);
  }

  // The cards in a note, or [] when it has no #flashcards tag. meta: { fmLen (the frontmatter's
  // length, which is skipped), fmTags (its tags) }. A card:
  //   { path, kind: 'basic' | 'reversed' | 'multi' | 'multiReversed' | 'cloze', deck: 'flashcards/…',
  //     first, last: its lines (0-based, the schedule comment included), body: its text without the
  //     comment (how it's found again), comment: { line, from, to } | null,
  //     sides: [{ front, back, due, interval, ease }] (due null = new), readable, reason }
  function parseNote(path, content, meta = {}) {
    const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
    const start = meta.fmLen ? content.slice(0, meta.fmLen).split('\n').length - 1 : 0;
    const fmDeck = (meta.fmTags || []).map(t => String(t).trim().replace(/^#/, '')).find(isDeck) || null;
    // Deck tags in the body, by line, outside code blocks.
    const tagAt = [];
    for (let i = start, fence = null; i < lines.length; i++) {
      const f = /^(`{3,}|~{3,})/.exec(lines[i]);
      if (fence) { if (f && lines[i].startsWith(fence)) fence = null; continue; }
      if (f) { fence = f[1]; continue; }
      for (const m of lines[i].matchAll(DECK_TAG)) tagAt.push({ line: i, deck: m[2], start: m.index === 0 });
    }
    if (!fmDeck && !tagAt.length) return [];

    const found = [];
    let kind = null, first = start, count = 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i], trimmed = line.trim();
      if (line.startsWith('<!--') && !line.startsWith('<!--SR:')) { // other HTML comments are skipped
        while (i < lines.length - 1 && !lines[i].includes('-->')) i++;
        continue;
      }
      if (!trimmed) {
        if (kind) found.push({ kind, first, last: i - 1 });
        kind = null; count = 0; first = i + 1;
        continue;
      }
      count++;
      const inline = hasMarker(line, ':::') ? 'reversed' : hasMarker(line, '::') ? 'basic' : null;
      if (inline) {
        const at = i;
        let callout = false;
        if (i + 1 < lines.length && lines[i + 1].startsWith('<!--SR:')) i++;
        else if (i + 1 < lines.length && lines[i + 1].startsWith(CALLOUT)) {
          callout = true;
          while (i + 1 < lines.length) { i++; if (lines[i].includes('<!--SR:')) break; }
        }
        found.push({ kind: inline, first: at, last: i, callout });
        kind = null; count = 0; first = i + 1;
      } else if (trimmed === '?' || trimmed === '??') {
        if (count > 1) kind = trimmed === '?' ? 'multi' : 'multiReversed';
      } else if (line.startsWith('```') || line.startsWith('~~~')) {
        const fence = /^(`+|~+)/.exec(line)[1];
        while (i + 1 < lines.length && !lines[i + 1].startsWith(fence)) { i++; count++; }
        i++; count++;
      } else if (!kind && HAS_CLOZE.test(maskCode(line))) kind = 'cloze';
    }
    if (kind) found.push({ kind, first, last: lines.length - 1 });

    const fallback = fmDeck || tagAt[0].deck;
    // A tag starting a card's first line is that card's own deck (makeCard), not a body tag.
    const own = new Set(found.filter(f => OWN_DECK.test(lines[f.first])).map(f => f.first));
    const body = tagAt.filter(t => !(t.start && own.has(t.line)));
    const deckAt = line => { let d = null; for (const t of body) if (t.line <= line) d = t.deck; return d || fallback; };
    return found.map(f => makeCard(path, lines, f, deckAt(f.first)));
  }

  function makeCard(path, lines, f, deck) {
    const block = lines.slice(f.first, f.last + 1);
    const card = { path, kind: f.kind, deck, first: f.first, last: f.last, body: '', comment: null, sides: [], readable: true, reason: '' };
    // The schedule: a comment at the end of the card's last line, or on a line of its own.
    let schedules = null;
    const cm = SR_COMMENT.exec(block[block.length - 1]);
    if (cm) {
      const at = cm.index + (cm[0].startsWith('<') ? 0 : 1);
      card.comment = { line: f.last, from: at, to: cm.index + cm[0].length };
      const l = block[block.length - 1];
      block[block.length - 1] = l.slice(0, cm.index) + l.slice(cm.index + cm[0].length);
      if (!block[block.length - 1].trim()) block.pop();
      schedules = readComment(cm[1]);
      if (!schedules) { card.readable = false; card.reason = /^!fsrs,/.test(cm[1]) ? 'fsrs' : 'unreadable schedule'; }
    }
    if (f.callout || block.some(l => l.includes('^sr-data-id-'))) { card.readable = false; card.reason = 'plugin data'; }
    card.body = block.join('\n');
    // What the card shows: no block ID, and no deck tag at its start (that tag is its deck).
    const shown = block.slice();
    shown[shown.length - 1] = shown[shown.length - 1].replace(BLOCK_ID, '');
    const own = OWN_DECK.exec(shown[0]);
    if (own) { card.deck = own[1]; shown[0] = shown[0].slice(own[0].length); }
    const faces = facesOf(f.kind, shown);
    if (!faces) { card.readable = false; card.reason = card.reason || 'overlapping cloze'; }
    card.sides = (faces || []).map((face, i) => ({ ...face, ...(schedules?.[i] || { due: null, interval: 1, ease: BASE_EASE }) }));
    return card;
  }

  // "!2024-03-01,3,250!2000-01-01,1,250": one group per side, in order. null if it isn't that.
  function readComment(inner) {
    if (/^!fsrs,/.test(inner)) return null;
    const out = [], group = /^!([^!,]+),(\d+),(\d+)/;
    let rest = inner, m;
    while ((m = group.exec(rest))) {
      const date = readDate(m[1]);
      if (!date) return null;
      out.push(date === NEW_DATE ? { due: null, interval: 1, ease: BASE_EASE } : { due: date, interval: +m[2], ease: +m[3] });
      rest = rest.slice(m[0].length);
    }
    return out.length && !rest.trim() ? out : null;
  }

  function facesOf(kind, lines) {
    if (kind === 'basic' || kind === 'reversed') {
      const sep = kind === 'reversed' ? ':::' : '::', line = lines[0], i = line.indexOf(sep);
      const q = line.slice(0, i).trim(), a = line.slice(i + sep.length).trim();
      return kind === 'basic' ? [{ front: q, back: a }] : [{ front: q, back: a }, { front: a, back: q }];
    }
    if (kind === 'multi' || kind === 'multiReversed') {
      const at = lines.findIndex(l => l.trim() === (kind === 'multi' ? '?' : '??'));
      const q = lines.slice(0, at).join('\n').trim(), a = lines.slice(at + 1).join('\n').trim();
      return kind === 'multi' ? [{ front: q, back: a }] : [{ front: q, back: a }, { front: a, back: q }];
    }
    return clozeFaces(lines.join('\n'));
  }

  // Cloze cards as the plugin's clozecraft library makes them from ==[123;;]answer[;;hint]==:
  // with no numbers, each highlight is a card; with numbers, card k hides every highlight numbered
  // k (and there are as many cards as the highest number), and unnumbered highlights stay as they are.
  function clozeFaces(text) {
    const masked = maskCode(text);
    if (/==[ash]+;;/.test(masked)) return null; // overlapping clozes ("==ash;;answer=="): not yet
    // Found in the masked text, read from the real one (the positions are the same).
    const found = [...masked.matchAll(CLOZE)].map(m => ({ at: m.index, len: m[0].length, m: CLOZE_ONE.exec(text.slice(m.index, m.index + m[0].length)) }));
    const dels = found.map(({ m }) => ({ seq: m[1] ? +m[1] : 0, answer: m[2], hint: m[3] || '' }));
    const numbered = dels.some(d => d.seq);
    const count = numbered ? Math.max(...dels.map(d => d.seq)) : dels.length;
    const face = (k, hidden) => {
      let out = '', last = 0;
      found.forEach(({ at, len }, j) => {
        const d = dels[j], raw = text.slice(at, at + len);
        out += text.slice(last, at) + (numbered && !d.seq ? raw : (numbered ? d.seq === k : j + 1 === k) ? hidden(d) : d.answer);
        last = at + len;
      });
      return out + text.slice(last);
    };
    const out = [];
    for (let k = 1; k <= count; k++) out.push({ front: face(k, d => `[${d.hint || '...'}]`), back: face(k, d => `==${d.answer}==`) });
    return out;
  }

  // ============================================================ writing a schedule back

  // The card in `cards` that is `card` (same kind and text), nearest where it was.
  function findCard(cards, card) {
    let best = null;
    for (const c of cards) {
      if (c.kind !== card.kind || c.body !== card.body) continue;
      if (!best || Math.abs(c.first - card.first) < Math.abs(best.first - card.first)) best = c;
    }
    return best;
  }

  // The note's text with side `index` of `card` set to `sched` ({ due, interval, ease }), and the
  // card as it then reads; null if the card has changed, gone or can't be read. Only the card's
  // <!--SR:…--> comment changes (a new one goes on the line after the card, as the plugin puts it).
  function setSideSchedule(content, card, index, sched, meta = {}) {
    const c = findCard(parseNote(card.path, content, meta), card);
    if (!c || !c.readable || index >= c.sides.length) return null;
    const groups = c.sides.map((s, i) => { const x = i === index ? sched : s; return x.due ? `!${x.due},${x.interval},${x.ease}` : `!${NEW_DATE},1,${BASE_EASE}`; });
    const comment = `<!--SR:${groups.join('')}-->`;
    const lines = content.split('\n');
    if (c.comment) {
      const l = lines[c.comment.line];
      lines[c.comment.line] = l.slice(0, c.comment.from) + comment + l.slice(c.comment.to);
    } else lines.splice(c.last + 1, 0, comment + (lines[c.last].endsWith('\r') ? '\r' : ''));
    const text = lines.join('\n');
    return { content: text, card: findCard(parseNote(card.path, text, meta), c) };
  }

  // ============================================================ decks and review order

  const inDeck = (card, deck) => { const d = card.deck.toLowerCase(), p = deck.toLowerCase(); return d === p || d.startsWith(p + '/'); };

  // Decks as a tree with the sides due and new, and the cards that can't be read, in each deck and
  // everything under it. The root (name '') holds the totals.
  function deckTree(cards, day = today()) {
    const node = (name, path) => ({ name, path, due: 0, new: 0, unreadable: 0, children: [] });
    const root = node('', '');
    for (const c of cards) {
      const chain = [root], parts = c.deck.split('/');
      for (let i = 0; i < parts.length; i++) {
        const path = parts.slice(0, i + 1).join('/'), up = chain[chain.length - 1];
        let child = up.children.find(x => x.path.toLowerCase() === path.toLowerCase());
        if (!child) up.children.push(child = node(parts[i], path));
        chain.push(child);
      }
      for (const d of chain) {
        if (!c.readable) { d.unreadable++; continue; }
        for (const s of c.sides) { if (!s.due) d.new++; else if (s.due <= day) d.due++; }
      }
    }
    const sort = d => { d.children.sort((a, b) => a.name.localeCompare(b.name)); d.children.forEach(sort); };
    sort(root);
    return root;
  }

  // What to review, as { card, side } pairs: due sides (earliest first, shuffled within a day),
  // then new ones, shuffled. This is the plugin's default "due first, random" order.
  function reviewQueue(cards, day = today(), rand = Math.random) {
    const due = [], fresh = [];
    for (const c of cards) {
      if (!c.readable) continue;
      c.sides.forEach((s, i) => {
        if (!s.due) fresh.push({ card: c, side: i, r: rand() });
        else if (s.due <= day) due.push({ card: c, side: i, r: rand() });
      });
    }
    due.sort((a, b) => a.card.sides[a.side].due.localeCompare(b.card.sides[b.side].due) || a.r - b.r);
    fresh.sort((a, b) => a.r - b.r);
    return [...due, ...fresh].map(({ card, side }) => ({ card, side }));
  }

  // How many sides fall due on each day, for load balancing.
  function dueLoad(cards) {
    const m = new Map();
    for (const c of cards) for (const s of c.sides) if (s.due) m.set(s.due, (m.get(s.due) || 0) + 1);
    return m;
  }

  const api = { today, addDays, readDate, schedule, intervalText, parseNote, findCard, setSideSchedule, deckTree, reviewQueue, dueLoad, inDeck, RESPONSES, NEW_DATE, BASE_EASE };
  root.CinderFlashcards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
