/* Folio tasks: every "- [ ] …" line in the vault, in the format of Obsidian's Tasks
 * plugin (📅 due, ⏳ scheduled, 🛫 start, ✅ done, ⏫ priority, 🔁 recurrence), with
 * natural-language quick add, recurring tasks, a Tasks view and ```tasks query blocks.
 * The parsing/formatting/query parts don't touch the DOM and are tested under Node. */
'use strict';

(function (root) {
  // ============================================================ dates (local "YYYY-MM-DD" strings)

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const addMonths = (s, n) => {
    const d = parseYmd(s), day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); // Jan 31 + 1 month = Feb 29/28
    return ymd(d);
  };
  const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
  const today = (now = new Date()) => ymd(now);
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const dayIndex = w => DAYS.findIndex(d => d.startsWith(w.toLowerCase().slice(0, 3)) && w.length >= 3 && d.startsWith(w.toLowerCase()));
  const monthIndex = w => MONTHS.findIndex(m => w.length >= 3 && m.startsWith(w.toLowerCase()));

  // "Tomorrow", "Friday", "in 12 days", "3 days ago", "Mon, Oct 6"
  function friendly(date, now = new Date()) {
    const t = today(now), n = daysBetween(t, date);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    const d = parseYmd(date);
    if (n > 1 && n < 7) return DAYS[d.getDay()][0].toUpperCase() + DAYS[d.getDay()].slice(1);
    if (n < 0 && n > -7) return `${-n} days ago`;
    const label = `${DAYS[d.getDay()].slice(0, 3).replace(/^./, c => c.toUpperCase())}, ${MONTHS[d.getMonth()].slice(0, 3).replace(/^./, c => c.toUpperCase())} ${d.getDate()}`;
    return d.getFullYear() === now.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
  }

  // ============================================================ task lines

  const PRIORITY = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };
  const PRIORITY_EMOJI = Object.fromEntries(Object.entries(PRIORITY).map(([e, p]) => [p, e]));
  const PRIORITY_RANK = { highest: 0, high: 1, medium: 2, null: 3, low: 4, lowest: 5 };
  const DATE_FIELDS = { '📅': 'due', '⏳': 'scheduled', '🛫': 'start', '✅': 'doneDate', '➕': 'created', '❌': 'cancelledDate' };
  const FIELD_EMOJI = Object.fromEntries(Object.entries(DATE_FIELDS).map(([e, f]) => [f, e]));
  const DATAVIEW = { due: 'due', scheduled: 'scheduled', start: 'start', completion: 'doneDate', created: 'created' };

  const TASK_RE = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])(\s+)\[(.)\](\s+|$)(.*)$/;
  const META_RE = /\s*(?:(📅|⏳|🛫|✅|➕|❌)️?\s*(\d{4}-\d{2}-\d{2})|(🔺|⏫|🔼|🔽|⏬)️?|🔁️?\s*([^📅⏳🛫✅➕❌🔺⏫🔼🔽⏬^]*?)(?=\s*(?:[📅⏳🛫✅➕❌🔺⏫🔼🔽⏬]|\^[\w-]+\s*$|$))|\[(due|scheduled|start|completion|created|priority|repeat)::\s*([^\]]*)\])/gu;

  // Parse one line; returns null if it isn't a task.
  function parseLine(line) {
    const m = TASK_RE.exec(line);
    if (!m) return null;
    const t = { prefix: m[1], marker: m[2], status: m[4], body: m[6], due: null, scheduled: null, start: null, doneDate: null, created: null, cancelledDate: null, priority: null, recur: null };
    let body = m[6];
    const blockRef = /\s\^[\w-]+\s*$/.exec(body);
    if (blockRef) { t.blockRef = blockRef[0].trim(); body = body.slice(0, blockRef.index); }
    let mm;
    META_RE.lastIndex = 0;
    while ((mm = META_RE.exec(body))) {
      if (mm[1]) t[DATE_FIELDS[mm[1]]] = mm[2];
      else if (mm[3]) t.priority = PRIORITY[mm[3]];
      else if (mm[4] !== undefined) t.recur = mm[4].trim() || null;
      else if (mm[5]) {
        const k = mm[5], v = mm[6].trim();
        if (DATAVIEW[k] && /^\d{4}-\d{2}-\d{2}/.test(v)) t[DATAVIEW[k]] = v.slice(0, 10);
        if (k === 'priority' && PRIORITY_RANK[v] !== undefined) t.priority = v;
        if (k === 'repeat') t.recur = v;
      }
    }
    t.text = body.replace(META_RE, '').replace(/\s+/g, ' ').trim();
    t.done = t.status === 'x' || t.status === 'X';
    t.cancelled = t.status === '-';
    t.tags = [...t.text.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(x => x[1].toLowerCase()).filter(x => !/^[\d/]+$/.test(x));
    return t;
  }

  // Blank out fenced code so "- [ ]" inside code isn't a task (keeps line numbers).
  function codeLines(content) {
    const skip = new Set();
    let fence = null;
    content.split('\n').forEach((l, i) => {
      const f = /^\s*(```+|~~~+)/.exec(l);
      if (fence) { skip.add(i); if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; }
      else if (f) { fence = f[1]; skip.add(i); }
    });
    return skip;
  }

  // All tasks in a note. heading: the nearest heading above each task.
  function parseNote(path, content) {
    const out = [], skip = codeLines(content);
    let heading = null, inFm = content.startsWith('---\n') || content.startsWith('---\r\n');
    content.split('\n').forEach((raw, line) => {
      const l = raw.replace(/\r$/, '');
      if (inFm) { if (line > 0 && /^---\s*$/.test(l)) inFm = false; return; }
      if (skip.has(line)) return;
      const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
      if (h) { heading = h[2]; return; }
      const t = parseLine(l);
      if (t) out.push({ ...t, path, line, raw: l, heading });
    });
    return out;
  }

  // ------------------------------------------------------------ writing task lines

  // Replace (in place), add (at the end) or with value null remove a metadata field.
  function setField(line, field, value) {
    const m = TASK_RE.exec(line);
    if (!m) return line;
    let body = m[6], ref = '';
    const br = /\s\^[\w-]+\s*$/.exec(body);
    if (br) { ref = br[0]; body = body.slice(0, br.index); }
    let res, token;
    if (field === 'priority') {
      res = [/\s*[🔺⏫🔼🔽⏬]️?/u, /\s*\[priority::[^\]]*\]/];
      token = value ? PRIORITY_EMOJI[value] : '';
    } else if (field === 'recur') {
      res = [/\s*🔁️?\s*[^📅⏳🛫✅➕❌🔺⏫🔼🔽⏬]*?(?=\s*[📅⏳🛫✅➕❌🔺⏫🔼🔽⏬]|\s*$)/u, /\s*\[repeat::[^\]]*\]/];
      token = value ? `🔁 ${value}` : '';
    } else {
      const e = FIELD_EMOJI[field], dv = Object.keys(DATAVIEW).find(k => DATAVIEW[k] === field);
      res = [new RegExp(`\\s*${e}\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}`, 'u'), ...(dv ? [new RegExp(`\\s*\\[${dv}::[^\\]]*\\]`)] : [])];
      token = value ? `${e} ${value}` : '';
    }
    let replaced = false;
    for (const re of res) {
      const hit = re.exec(body);
      if (!hit) continue;
      // The first occurrence becomes the new value; any later duplicates go.
      const before = body.slice(0, hit.index), after = body.slice(hit.index + hit[0].length).replace(new RegExp(re.source, re.flags + 'g'), '');
      body = before + (!replaced && token ? ' ' + token : '') + after;
      replaced = true;
    }
    body = body.replace(/\s+$/, '');
    if (!replaced && token) body += (body ? ' ' : '') + token;
    return `${m[1]}${m[2]}${m[3]}[${m[4]}]${m[5] || ' '}${body.replace(/^\s+/, '')}${ref}`;
  }
  function setStatus(line, status) {
    const m = TASK_RE.exec(line);
    return m ? `${m[1]}${m[2]}${m[3]}[${status}]${m[5] || ' '}${m[6]}` : line;
  }

  // ------------------------------------------------------------ recurrence

  // Parse "every day", "every 2 weeks", "every weekday", "every mon, wed", "every month on the 15th",
  // "every year", with optional "when done". Returns {kind, n, days?, dom?, whenDone} or null.
  function parseRecur(s) {
    if (!s) return null;
    let r = s.toLowerCase().trim();
    const whenDone = /\bwhen done\b/.test(r);
    r = r.replace(/\bwhen done\b/, '').trim();
    const aliases = { daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year', annually: 'every year' };
    r = aliases[r] || r;
    let m;
    if ((m = /^every\s+(\d+)?\s*(day|days|week|weeks|month|months|year|years)\b(?:\s+on\s+the\s+(\d+)(?:st|nd|rd|th)?)?/.exec(r))) {
      const kind = m[2].replace(/s$/, '');
      return { kind, n: +(m[1] || 1), dom: m[3] ? +m[3] : null, whenDone };
    }
    if (/^every\s+weekday/.test(r)) return { kind: 'days', days: [1, 2, 3, 4, 5], n: 1, whenDone };
    if (/^every\s+weekend/.test(r)) return { kind: 'days', days: [0, 6], n: 1, whenDone };
    if ((m = /^every\s+(?:week\s+on\s+)?([a-z,\s]+(?:and\s+[a-z]+)?)$/.exec(r))) {
      const days = m[1].split(/,|\band\b|\s+/).map(w => w.trim()).filter(Boolean).map(dayIndex).filter(i => i >= 0);
      if (days.length) return { kind: 'days', days: [...new Set(days)].sort(), n: 1, whenDone };
    }
    return null;
  }
  function nextDate(date, rule) {
    switch (rule.kind) {
      case 'day': return addDays(date, rule.n);
      case 'week': return addDays(date, 7 * rule.n);
      case 'month': {
        const d = addMonths(date, rule.n);
        if (!rule.dom) return d;
        const x = parseYmd(d);
        x.setDate(Math.min(rule.dom, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
        return ymd(x);
      }
      case 'year': return addMonths(date, 12 * rule.n);
      case 'days': { let d = date; for (let k = 0; k < 8; k++) { d = addDays(d, 1); if (rule.days.includes(parseYmd(d).getDay())) return d; } return addDays(date, 1); }
    }
    return null;
  }

  // Toggle a task line. Returns the new line(s): completing a recurring task puts the next
  // occurrence above it, like the Tasks plugin. opts: {date: today, doneDate: add ✅}
  function toggle(line, opts = {}) {
    const t = parseLine(line);
    if (!t) return [line];
    const date = opts.date || today();
    if (t.done || t.cancelled) {
      let l = setStatus(line, ' ');
      l = setField(l, 'doneDate', null);
      return [l];
    }
    let doneLine = setStatus(line, 'x');
    if (opts.doneDate !== false) doneLine = setField(doneLine, 'doneDate', date);
    const rule = parseRecur(t.recur);
    if (!rule) return [doneLine];
    const anchor = t.due || t.scheduled || t.start;
    let next = setField(line, 'doneDate', null);
    const base = rule.whenDone || !anchor ? date : anchor;
    const shift = anchor ? daysBetween(anchor, nextDate(base, rule)) : null;
    for (const f of ['due', 'scheduled', 'start']) if (t[f] && shift != null) next = setField(next, f, addDays(t[f], shift));
    if (!anchor) next = setField(next, 'due', nextDate(date, rule));
    return [next, doneLine];
  }

  // ============================================================ natural-language quick add

  const PRIO_WORDS = { '!highest': 'highest', '!urgent': 'highest', '!high': 'high', '!!!': 'high', '!medium': 'medium', '!med': 'medium', '!!': 'medium', '!low': 'low', '!lowest': 'lowest' };

  // "Call Sam tomorrow !high every week #family" -> {text, due, priority, recur}
  function parseQuick(input, now = new Date()) {
    let s = ' ' + input.trim() + ' ';
    const t = today(now);
    const out = { text: '', due: null, scheduled: null, priority: null, recur: null };
    const take = re => { const m = re.exec(s); if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); return m; };
    // priority
    for (const [w, p] of Object.entries(PRIO_WORDS)) if (take(new RegExp(`\\s${w.replace(/[!]/g, '\\!')}(?=\\s)`, 'i'))) { out.priority = p; break; }
    // recurrence
    let m;
    if ((m = take(/\s(every\s+(?:\d+\s+)?(?:day|days|week|weeks|month|months|year|years|weekday|weekend|(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:\s*,\s*|\s+and\s+)?)+)(?:\s+on\s+the\s+\d+(?:st|nd|rd|th)?)?(?:\s+when\s+done)?|daily|weekly|monthly|yearly)(?=\s)/i))) {
      const r = m[1].toLowerCase();
      if (parseRecur(r)) out.recur = r;
    }
    // dates
    const lead = '(?:\\s(?:due|by|on))?';
    const dow = d => { const cur = now.getDay(); let n = (d - cur + 7) % 7; if (n === 0) n = 7; return addDays(t, n); };
    const rules = [
      [new RegExp(`${lead}\\s(today|tonight)(?=\\s)`, 'i'), () => t],
      [new RegExp(`${lead}\\s(tomorrow|tmrw|tmr)(?=\\s)`, 'i'), () => addDays(t, 1)],
      [new RegExp(`${lead}\\s(day after tomorrow)(?=\\s)`, 'i'), () => addDays(t, 2)],
      [new RegExp(`${lead}\\sin\\s(\\d+)\\s(day|days|week|weeks|month|months)(?=\\s)`, 'i'), m => /day/.test(m[2]) ? addDays(t, +m[1]) : /week/.test(m[2]) ? addDays(t, 7 * m[1]) : addMonths(t, +m[1])],
      [new RegExp(`${lead}\\s(next week)(?=\\s)`, 'i'), () => dow(1)],
      [new RegExp(`${lead}\\s(next month)(?=\\s)`, 'i'), () => { const d = parseYmd(addMonths(t, 1)); d.setDate(1); return ymd(d); }],
      [new RegExp(`${lead}\\s(this weekend|weekend)(?=\\s)`, 'i'), () => (now.getDay() === 6 ? t : dow(6))],
      [new RegExp(`${lead}\\s(end of (?:the )?month)(?=\\s)`, 'i'), () => { const d = new Date(now.getFullYear(), now.getMonth() + 1, 0); return ymd(d); }],
      [new RegExp(`${lead}\\s(next\\s)?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?(?=\\s)`, 'i'), m => { const d = dow(dayIndex(m[2])); return m[1] && daysBetween(t, d) < 7 ? addDays(d, 7) : d; }],
      [new RegExp(`${lead}\\s(\\d{4}-\\d{2}-\\d{2})(?=\\s)`), m => parseYmd(m[1]) ? m[1] : null],
      [new RegExp(`${lead}\\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s(\\d{4}))?(?=\\s)`, 'i'), m => monthDay(monthIndex(m[1]), +m[2], m[3])],
      [new RegExp(`${lead}\\s(\\d{1,2})(?:st|nd|rd|th)?\\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?(?:\\s(\\d{4}))?(?=\\s)`, 'i'), m => monthDay(monthIndex(m[2]), +m[1], m[3])],
    ];
    function monthDay(mi, d, y) {
      if (mi < 0 || d < 1 || d > 31) return null;
      let yr = y ? +y : now.getFullYear();
      let x = new Date(yr, mi, d);
      if (!y && ymd(x) < t) x = new Date(yr + 1, mi, d); // "Jan 5" in December means next year
      return ymd(x);
    }
    for (const [re, fn] of rules) {
      const mm = re.exec(s);
      if (!mm) continue;
      const d = fn(mm);
      if (!d) continue;
      s = s.slice(0, mm.index) + ' ' + s.slice(mm.index + mm[0].length);
      out.due = d;
      break;
    }
    if (out.recur && !out.due) { const rule = parseRecur(out.recur); out.due = rule.kind === 'days' && !rule.days.includes(now.getDay()) ? nextDate(t, rule) : t; }
    out.text = s.replace(/\s+/g, ' ').trim();
    return out;
  }
  // The Markdown line for a quick-added task (Tasks plugin field order).
  function formatTask(q) {
    let s = `- [ ] ${q.text}`;
    if (q.priority) s += ` ${PRIORITY_EMOJI[q.priority]}`;
    if (q.recur) s += ` 🔁 ${q.recur}`;
    if (q.scheduled) s += ` ⏳ ${q.scheduled}`;
    if (q.due) s += ` 📅 ${q.due}`;
    return s;
  }

  // ============================================================ queries (```tasks blocks)

  // A subset of the Tasks plugin's query language, one instruction per line.
  function parseQuery(src, now = new Date()) {
    const q = { filters: [], sort: [], group: null, limit: 0, errors: [] };
    const t = today(now);
    const dateWord = w => {
      w = w.trim().toLowerCase();
      if (w === 'today') return t;
      if (w === 'tomorrow') return addDays(t, 1);
      if (w === 'yesterday') return addDays(t, -1);
      let m;
      if ((m = /^in (\d+) days?$/.exec(w))) return addDays(t, +m[1]);
      if ((m = /^(\d+) days? ago$/.exec(w))) return addDays(t, -m[1]);
      if (/^next week$/.test(w)) return addDays(t, 7);
      if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
      const d = dayIndex(w);
      if (d >= 0) { let n = (d - now.getDay() + 7) % 7; return addDays(t, n); }
      return null;
    };
    for (let line of String(src).split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const l = line.toLowerCase();
      let m;
      if (l === 'not done') q.filters.push(x => !x.done && !x.cancelled);
      else if (l === 'done') q.filters.push(x => x.done);
      else if ((m = /^(no|has) (due|scheduled|start|done) date$/.exec(l))) { const f = m[2] === 'done' ? 'doneDate' : m[2]; q.filters.push(m[1] === 'no' ? x => !x[f] : x => !!x[f]); }
      else if ((m = /^(due|scheduled|starts|done|happens)\s+(on or before|on or after|before|after|on)?\s*(.+)$/.exec(l))) {
        const f = { due: 'due', scheduled: 'scheduled', starts: 'start', done: 'doneDate', happens: 'happens' }[m[1]];
        const op = m[2] || 'on';
        const d = dateWord(m[3]);
        if (!d) { q.errors.push(`don't know the date "${m[3]}"`); continue; }
        const get = f === 'happens' ? x => [x.due, x.scheduled, x.start].filter(Boolean).sort()[0] : x => x[f];
        q.filters.push(x => { const v = get(x); if (!v) return false; return op === 'on' ? v === d : op === 'before' ? v < d : op === 'after' ? v > d : op === 'on or before' ? v <= d : v >= d; });
      }
      else if ((m = /^(path|description|heading|filename|tag|tags) (includes|does not include) (.+)$/.exec(l))) {
        const needle = line.slice(line.toLowerCase().indexOf(m[2]) + m[2].length).trim().toLowerCase().replace(/^#/, '');
        const get = { path: x => x.path, filename: x => x.path.split('/').pop(), description: x => x.text, heading: x => x.heading || '', tag: x => x.tags.join(' '), tags: x => x.tags.join(' ') }[m[1]];
        const has = x => (m[1].startsWith('tag') ? x.tags.some(tg => tg === needle || tg.startsWith(needle + '/')) : get(x).toLowerCase().includes(needle));
        q.filters.push(m[2] === 'includes' ? has : x => !has(x));
      }
      else if ((m = /^priority is (above |below |not )?(highest|high|medium|none|low|lowest)$/.exec(l))) {
        const want = m[2] === 'none' ? 'null' : m[2], r = PRIORITY_RANK[want];
        const rank = x => PRIORITY_RANK[x.priority ?? 'null'];
        q.filters.push(m[1] === 'above ' ? x => rank(x) < r : m[1] === 'below ' ? x => rank(x) > r : m[1] === 'not ' ? x => rank(x) !== r : x => rank(x) === r);
      }
      else if (l === 'is recurring') q.filters.push(x => !!x.recur);
      else if (l === 'is not recurring') q.filters.push(x => !x.recur);
      else if ((m = /^sort by (due|scheduled|start|done|priority|path|description|status)( reverse)?$/.exec(l))) q.sort.push({ by: m[1], reverse: !!m[2] });
      else if ((m = /^group by (due|scheduled|filename|path|folder|heading|priority|tags?|status)$/.exec(l))) q.group = m[1];
      else if ((m = /^limit (?:to )?(\d+)(?: tasks?)?$/.exec(l))) q.limit = +m[1];
      else if (/^(hide|show|short mode|explain|full mode)\b/.test(l)) { /* presentation hints: ignored */ }
      else q.errors.push(`don't understand "${line}"`);
    }
    return q;
  }
  const FIELD_OF = { due: 'due', scheduled: 'scheduled', start: 'start', done: 'doneDate' };
  function runQuery(q, tasks) {
    let out = tasks.filter(x => q.filters.every(f => f(x)));
    const sorts = q.sort.length ? q.sort : [{ by: 'status' }, { by: 'due' }, { by: 'priority' }, { by: 'path' }];
    const key = (x, by) => by === 'priority' ? PRIORITY_RANK[x.priority ?? 'null'] : by === 'status' ? (x.done || x.cancelled ? 1 : 0) : by === 'path' ? x.path : by === 'description' ? x.text.toLowerCase() : x[FIELD_OF[by]] || '￿';
    out = out.map((x, i) => ({ x, i })).sort((a, b) => {
      for (const s of sorts) {
        const ka = key(a.x, s.by), kb = key(b.x, s.by);
        if (ka === kb) continue;
        if (ka === '\uffff' || kb === '\uffff') return ka === '\uffff' ? 1 : -1; // undated last either way
        return (ka < kb ? -1 : 1) * (s.reverse ? -1 : 1);
      }
      return a.i - b.i;
    }).map(o => o.x);
    if (q.limit) out = out.slice(0, q.limit);
    if (!q.group) return [{ key: null, tasks: out }];
    const g = new Map();
    const gk = x => {
      switch (q.group) {
        case 'due': case 'scheduled': return x[q.group] || 'No date';
        case 'filename': return x.path.split('/').pop().replace(/\.md$/, '');
        case 'path': return x.path;
        case 'folder': return x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : '/';
        case 'heading': return x.heading || '(no heading)';
        case 'priority': return x.priority ? x.priority[0].toUpperCase() + x.priority.slice(1) : 'Normal';
        case 'status': return x.done ? 'Done' : x.cancelled ? 'Cancelled' : 'To do';
        default: return x.tags.length ? '#' + x.tags[0] : '(no tags)';
      }
    };
    for (const x of out) { const k = gk(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    return [...g].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([key, tasks]) => ({ key, tasks }));
  }

  // The Tasks view's sections for open tasks.
  function buckets(tasks, now = new Date()) {
    const t = today(now);
    const date = x => x.due || x.scheduled || null;
    const open = tasks.filter(x => !x.done && !x.cancelled);
    const out = [];
    const add = (id, title, list, extra = {}) => { if (list.length || extra.always) out.push({ id, title, tasks: list, ...extra }); };
    const byPrio = (a, b) => (PRIORITY_RANK[a.priority ?? 'null'] - PRIORITY_RANK[b.priority ?? 'null']) || a.path.localeCompare(b.path) || a.line - b.line;
    const byDate = (a, b) => (date(a) < date(b) ? -1 : date(a) > date(b) ? 1 : byPrio(a, b));
    add('overdue', 'Overdue', open.filter(x => date(x) && date(x) < t).sort(byDate), { tone: 'danger' });
    add('today', 'Today', open.filter(x => date(x) === t).sort(byPrio), { date: t, always: true });
    for (let k = 1; k < 7; k++) {
      const d = addDays(t, k);
      add('d' + k, friendly(d, now), open.filter(x => date(x) === d).sort(byPrio), { date: d, always: k === 1 });
    }
    add('later', 'Later', open.filter(x => date(x) && date(x) >= addDays(t, 7)).sort(byDate));
    add('none', 'No date', open.filter(x => !date(x)).sort(byPrio), { date: '' });
    return out;
  }

  const pure = { parseLine, parseNote, setField, setStatus, toggle, parseRecur, nextDate, parseQuick, formatTask, parseQuery, runQuery, buckets, friendly, today, addDays, addMonths, PRIORITY_EMOJI, PRIORITY_RANK };

  if (typeof document === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = pure; return; }

  // ============================================================ UI

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const PRIO_LABEL = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' };

  // One task row. h: {inline(text, path) -> html}
  function rowHtml(x, h, opts = {}) {
    const t = today();
    const date = x.due || x.scheduled;
    const cls = !date || x.done ? '' : date < t ? ' overdue' : date === t ? ' today' : '';
    const chips = [];
    if (date) chips.push(`<span class="tk-date${cls}" title="${x.due ? 'Due' : 'Scheduled'} ${esc(date)}">${ICON('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>')}${esc(friendly(date))}</span>`);
    if (x.recur) chips.push(`<span class="tk-recur" title="Repeats ${esc(x.recur)}">${ICON('<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>')}${esc(x.recur)}</span>`);
    if (x.done && x.doneDate) chips.push(`<span class="tk-donedate">✓ ${esc(friendly(x.doneDate))}</span>`);
    if (opts.source !== false) chips.push(`<a class="tk-src" data-open="${esc(x.path)}" data-line="${x.line}" title="${esc(x.path)}${x.heading ? ' › ' + esc(x.heading) : ''}">${esc(x.path.split('/').pop().replace(/\.md$/, ''))}</a>`);
    return `<div class="tk-row${x.done ? ' done' : ''}${x.cancelled ? ' cancelled' : ''}${x.priority ? ' p-' + x.priority : ''}" data-path="${esc(x.path)}" data-line="${x.line}" draggable="${opts.drag ? 'true' : 'false'}">
      <input type="checkbox" class="tk-check"${x.done ? ' checked' : ''} title="${x.done ? 'Mark not done' : 'Complete'}">
      <div class="tk-main"><div class="tk-text">${h.inline(x.text || '(empty task)', x.path)}</div><div class="tk-meta">${x.priority ? `<span class="tk-prio" title="${PRIO_LABEL[x.priority]} priority">${PRIO_LABEL[x.priority]}</span>` : ''}${chips.join('')}</div></div>
      ${opts.actions !== false && !x.done ? `<div class="tk-actions"><button data-act="today" title="Do today">${ICON('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>')}</button><button data-act="tomorrow" title="Do tomorrow">${ICON('<path d="M5 12h14M13 6l6 6-6 6"/>')}</button><button data-act="date" title="Pick a date">${ICON('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>')}</button><button data-act="more" title="More">${ICON('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>')}</button></div>` : ''}
    </div>`;
  }

  // Events shared by the Tasks view and ```tasks blocks. h: {toggle(x), setField(x, field, value), open(path, line), menu, find(path, line)}
  function wire(el, h) {
    el.addEventListener('click', e => {
      const row = e.target.closest('.tk-row');
      const src = e.target.closest('[data-open]');
      if (src) { e.preventDefault(); return h.open(src.dataset.open, +src.dataset.line); }
      if (!row) return;
      const x = h.find(row.dataset.path, +row.dataset.line);
      if (!x) return;
      if (e.target.closest('.tk-check')) { e.preventDefault(); return h.toggle(x); }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const t = today();
      if (b.dataset.act === 'today') return h.setField(x, x.due || !x.scheduled ? 'due' : 'scheduled', t);
      if (b.dataset.act === 'tomorrow') return h.setField(x, x.due || !x.scheduled ? 'due' : 'scheduled', addDays(t, 1));
      if (b.dataset.act === 'date') {
        const inp = document.createElement('input');
        inp.type = 'date'; inp.className = 'tk-datepick'; inp.value = x.due || t;
        b.replaceWith(inp);
        inp.focus(); try { inp.showPicker?.(); } catch { }
        inp.addEventListener('change', () => { if (inp.value) h.setField(x, 'due', inp.value); });
        inp.addEventListener('blur', () => setTimeout(() => inp.isConnected && h.refresh?.(), 200));
        return;
      }
      if (b.dataset.act === 'more') {
        const r = b.getBoundingClientRect();
        return h.menu(r.left - 150, r.bottom + 4, [
          ...['highest', 'high', 'medium', 'low'].map(p => [`Priority: ${PRIO_LABEL[p]}${x.priority === p ? ' ✓' : ''}`, () => h.setField(x, 'priority', p)]),
          ['Priority: normal', () => h.setField(x, 'priority', null)],
          null,
          ['Next week', () => h.setField(x, 'due', addDays(t, 7 - ((new Date().getDay() + 6) % 7)))],
          ['Remove date', () => h.setField(x, 'due', null)],
          ['Cancel task', () => h.cancel?.(x)],
          ['Open in note', () => h.open(x.path, x.line)],
        ]);
      }
    });
    // Drag a task onto a section to reschedule it.
    let drag = null;
    el.addEventListener('dragstart', e => { const row = e.target.closest?.('.tk-row'); if (!row) return; drag = h.find(row.dataset.path, +row.dataset.line); e.dataTransfer.setData('text/plain', row.textContent.trim()); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    el.addEventListener('dragend', () => { drag = null; el.querySelectorAll('.dragging, .drop').forEach(n => n.classList.remove('dragging', 'drop')); });
    el.addEventListener('dragover', e => { const s = e.target.closest?.('.tk-section[data-date]'); if (!s || !drag) return; e.preventDefault(); el.querySelectorAll('.tk-section.drop').forEach(n => n !== s && n.classList.remove('drop')); s.classList.add('drop'); });
    el.addEventListener('drop', e => { const s = e.target.closest?.('.tk-section[data-date]'); if (!s || !drag) return; e.preventDefault(); const x = drag; drag = null; h.setField(x, 'due', s.dataset.date || null); });
  }

  // The Tasks view. h: {tasks(), inline, toggle, setField, open, menu, add(line) -> Promise, refresh via returned object, inboxLabel}
  function mountView(el, h) {
    let search = '', tag = '', showDone = false, focusAdd = false;
    const state = () => ({ search, tag, showDone });
    function render() {
      const all = h.tasks();
      const tags = [...new Set(all.filter(x => !x.done).flatMap(x => x.tags))].sort();
      let list = all;
      if (tag) list = list.filter(x => x.tags.some(t => t === tag || t.startsWith(tag + '/')));
      if (search) { const q = search.toLowerCase(); list = list.filter(x => x.text.toLowerCase().includes(q) || x.path.toLowerCase().includes(q)); }
      const secs = buckets(list);
      const done = list.filter(x => x.done && x.doneDate && x.doneDate >= addDays(today(), -7)).sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || ''));
      const openCount = list.filter(x => !x.done && !x.cancelled).length;
      const addVal = el.querySelector('.tk-add')?.value || '';
      el.innerHTML = `<div class="tk-view">
        <div class="tk-head"><h2>Tasks</h2><span class="tk-count">${openCount} open</span></div>
        <div class="tk-addbox"><input class="field tk-add" placeholder="Add a task… e.g. “Pay rent tomorrow !high every month #home”" spellcheck="false" value="${esc(addVal)}"><div class="tk-preview"></div><div class="tk-inbox">Adds to ${esc(h.inboxLabel())}</div></div>
        <div class="tk-filters"><input class="field tk-search" type="search" placeholder="Filter…" value="${esc(search)}" spellcheck="false">
          <select class="field tk-tag"><option value="">All tags</option>${tags.map(t => `<option value="${esc(t)}"${t === tag ? ' selected' : ''}>#${esc(t)}</option>`).join('')}</select>
          <label class="tk-showdone"><input type="checkbox"${showDone ? ' checked' : ''}> Recently done</label></div>
        ${secs.map(s => `<section class="tk-section${s.tone ? ' tk-' + s.tone : ''}"${s.date !== undefined ? ` data-date="${esc(s.date)}"` : ''}><h3>${esc(s.title)} <span>${s.tasks.length}</span></h3>${s.tasks.map(x => rowHtml(x, h, { drag: true })).join('') || '<div class="tk-empty">Nothing here — drag a task onto this day, or add one above.</div>'}</section>`).join('')}
        ${showDone ? `<section class="tk-section tk-done"><h3>Done in the last week <span>${done.length}</span></h3>${done.map(x => rowHtml(x, h, { actions: false })).join('') || '<div class="tk-empty">Nothing yet.</div>'}</section>` : ''}
        ${!all.length ? '<div class="tk-blank">No tasks in the vault yet. Add one above, or write <code>- [ ] something</code> in any note.</div>' : ''}
      </div>`;
      preview();
      const add = el.querySelector('.tk-add');
      if (focusAdd) { add.focus(); add.setSelectionRange(add.value.length, add.value.length); focusAdd = false; }
    }
    function preview() {
      const inp = el.querySelector('.tk-add'), pv = el.querySelector('.tk-preview');
      if (!inp || !pv) return;
      const v = inp.value.trim();
      if (!v) { pv.innerHTML = ''; return; }
      const q = parseQuick(v);
      const bits = [];
      if (q.due) bits.push(`<b>${esc(friendly(q.due))}</b> <small>${esc(q.due)}</small>`);
      if (q.priority) bits.push(`${PRIO_LABEL[q.priority]} priority`);
      if (q.recur) bits.push(`repeats ${esc(q.recur)}`);
      pv.innerHTML = `<span class="tk-pv-text">${esc(q.text || '…')}</span>${bits.length ? ' · ' + bits.join(' · ') : ''} <kbd>Enter</kbd>`;
    }
    el.addEventListener('input', e => {
      if (e.target.classList.contains('tk-add')) return preview();
      if (e.target.classList.contains('tk-search')) { search = e.target.value; render(); el.querySelector('.tk-search').focus(); el.querySelector('.tk-search').setSelectionRange(search.length, search.length); }
    });
    el.addEventListener('change', e => {
      if (e.target.classList.contains('tk-tag')) { tag = e.target.value; render(); }
      if (e.target.closest('.tk-showdone')) { showDone = e.target.checked; render(); }
    });
    el.addEventListener('keydown', async e => {
      if (!e.target.classList.contains('tk-add')) return;
      if (e.key === 'Escape') { e.target.value = ''; preview(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = e.target.value.trim();
      if (!v) return;
      const q = parseQuick(v);
      if (!q.text) return;
      e.target.value = '';
      focusAdd = true;
      await h.add(formatTask(q));
    });
    wire(el, { ...h, refresh: render });
    render();
    return { refresh: render, state };
  }

  // A ```tasks block. h as for wire, plus inline; source is the query text.
  function mountQuery(el, source, h) {
    function render() {
      const q = parseQuery(source);
      const groups = runQuery(q, h.tasks());
      const n = groups.reduce((a, g) => a + g.tasks.length, 0);
      el.innerHTML = `<div class="tk-query">${q.errors.length ? `<div class="tk-qerr">${q.errors.map(esc).join('<br>')}</div>` : ''}${groups.map(g => (g.key != null ? `<h4>${esc(/^\d{4}-\d{2}-\d{2}$/.test(g.key) ? friendly(g.key) : g.key)} <span>${g.tasks.length}</span></h4>` : '') + g.tasks.map(x => rowHtml(x, h)).join('')).join('')}<div class="tk-qfoot">${n ? `${n} task${n === 1 ? '' : 's'}` : 'No matching tasks'}</div></div>`;
    }
    wire(el, { ...h, refresh: render });
    render();
    return { refresh: render };
  }

  root.FolioTasks = { ...pure, mountView, mountQuery };
})(typeof window !== 'undefined' ? window : globalThis);
