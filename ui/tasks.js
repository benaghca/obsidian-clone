/* Cinder tasks: every "- [ ] …" line in the vault, in the format of Obsidian's Tasks
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
  const daysBetween = (a, b) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 864e5);
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
  // Replace a task's description, keeping its dates, priority, recurrence and block id.
  function setText(line, text) {
    const m = TASK_RE.exec(line);
    if (!m) return line;
    let body = m[6], ref = '';
    const br = /\s\^[\w-]+\s*$/.exec(body);
    if (br) { ref = br[0]; body = body.slice(0, br.index); }
    const meta = [];
    META_RE.lastIndex = 0;
    let mm;
    while ((mm = META_RE.exec(body))) if (mm[0].trim()) meta.push(mm[0].trim());
    const t = String(text).replace(/\s+/g, ' ').trim();
    return `${m[1]}${m[2]}${m[3]}[${m[4]}]${m[5] || ' '}${[t, ...meta].filter(Boolean).join(' ')}${ref}`;
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
    if ((m = /^every\s+(\d+)?\s*(day|days|week|weeks|month|months|year|years)(?:\s+on\s+the\s+(\d+)(?:st|nd|rd|th)?)?\s*$/.exec(r))) {
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
    /** @type {[RegExp, (m: any) => any][]} */
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

  const pure = { parseLine, parseNote, setField, setText, setStatus, toggle, parseRecur, nextDate, parseQuick, formatTask, parseQuery, runQuery, buckets, friendly, today, addDays, addMonths, PRIORITY_EMOJI, PRIORITY_RANK };

  if (typeof document === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = pure; return; }

  // ============================================================ UI

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const PRIO_LABEL = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' };
  const I = {
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    arrow: '<path d="M5 12h12M13 7l5 5-5 5"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    recur: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
    flag: '<path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>',
    note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    check: '<path d="m6 12.5 4 4 8-9"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    upcoming: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8 14h2M12 14h2M16 14h.01M8 17h2"/>',
    layers: '<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
    inbox: '<path d="M4 13l2.5-7h11l2.5 7v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    hash: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3.5 15h16"/>',
  };
  const PRIO_COLOR = { highest: 'var(--c-red)', high: 'var(--c-orange)', medium: 'var(--c-yellow)', low: 'var(--c-blue)', lowest: 'var(--c-blue)' };
  const dateOf = x => x.due || x.scheduled || null;
  const noteLabel = p => p.split('/').pop().replace(/\.md$/, '');
  const longDate = d => parseYmd(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  // One task row. h: {inline(text, path) -> html}. opts: {source: show the note, actions, drag}
  function rowHtml(x, h, opts = {}) {
    const t = today();
    const date = dateOf(x);
    const cls = !date || x.done ? '' : date < t ? ' overdue' : date === t ? ' today' : '';
    const chips = [];
    if (date) chips.push(`<button class="tk-chip tk-date${cls}" data-act="date" title="${x.due ? 'Due' : 'Scheduled'} ${esc(date)}">${ICON(I.cal)}${esc(friendly(date))}</button>`);
    if (x.priority) chips.push(`<button class="tk-chip tk-prio" data-act="more" title="${PRIO_LABEL[x.priority]} priority" style="--pc:${PRIO_COLOR[x.priority]}">${ICON(I.flag)}${PRIO_LABEL[x.priority]}</button>`);
    if (x.recur) chips.push(`<button class="tk-chip tk-recur" data-act="more" title="Repeats ${esc(x.recur)}">${ICON(I.recur)}${esc(x.recur)}</button>`);
    if (x.done && x.doneDate) chips.push(`<span class="tk-chip tk-donedate">${ICON(I.check)}${esc(friendly(x.doneDate))}</span>`);
    if (opts.source !== false) chips.push(`<a class="tk-src" data-open="${esc(x.path)}" data-line="${x.line}" title="${esc(x.path)}${x.heading ? ' › ' + esc(x.heading) : ''}">${ICON(I.note)}${esc(noteLabel(x.path))}${x.heading && opts.heading !== false && x.heading !== noteLabel(x.path) ? `<span> › ${esc(x.heading)}</span>` : ''}</a>`);
    const actions = opts.actions !== false && !x.done && !x.cancelled
      ? `<div class="tk-actions">${date === t ? '' : `<button data-act="today" title="Do today (T)">${ICON(I.sun)}</button>`}<button data-act="tomorrow" title="Tomorrow (M)">${ICON(I.arrow)}</button><button data-act="date" title="Pick a date (D)">${ICON(I.cal)}</button><button data-act="more" title="Details (P)">${ICON(I.more)}</button></div>` : '';
    return `<div class="tk-row${x.done ? ' done' : ''}${x.cancelled ? ' cancelled' : ''}${x.priority ? ' p-' + x.priority : ''}" data-path="${esc(x.path)}" data-line="${x.line}" tabindex="-1" draggable="${opts.drag ? 'true' : 'false'}"${x.priority ? ` style="--pc:${PRIO_COLOR[x.priority]}"` : ''}>
      <button class="tk-check" role="checkbox" aria-checked="${x.done}" title="${x.done ? 'Mark not done' : 'Complete (Space)'}">${ICON(I.check)}</button>
      <div class="tk-main"><div class="tk-text" title="Click to edit">${h.inline(x.text || '(empty task)', x.path)}</div><div class="tk-meta">${chips.join('')}</div></div>
      ${actions}
    </div>`;
  }

  // A small popover next to `anchor`, closed by Esc or a click outside. Returns its element.
  function popover(anchor, html, cls = '') {
    document.querySelector('.tk-pop')?.remove();
    const pop = /** @type {any} */ (document.createElement('div'));
    pop.className = 'tk-pop ' + cls; pop.setAttribute('role', 'dialog');
    pop.innerHTML = html;
    document.body.append(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, hgt = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    pop.style.top = (r.bottom + hgt + 8 > innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4) + 'px';
    const close = () => { pop.remove(); document.removeEventListener('mousedown', out, true); };
    const out = e => { if (!pop.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.isConnected && anchor.focus?.(); } });
    pop.close = close;
    return pop;
  }

  // Dates offered for "when": [label, date or '' for none, hint]
  function whenChoices(t = today()) {
    const dow = new Date().getDay();
    const sat = addDays(t, dow === 6 ? 0 : (6 - dow + 7) % 7);
    const mon = addDays(t, ((8 - dow) % 7) || 7);
    return [['Today', t, ICON(I.sun)], ['Tomorrow', addDays(t, 1), ICON(I.arrow)], ['This weekend', sat, ''], ['Next week', mon, ''], ['In a month', addMonths(t, 1), ''], ['No date', '', '']];
  }

  // Everything about one task: when, priority, repeat, and where it lives.
  function details(anchor, x, h, focus = 'when') {
    const field = x.due || !x.scheduled ? 'due' : 'scheduled';
    const cur = x[field] || '';
    const REPEATS = ['every day', 'every weekday', 'every week', 'every 2 weeks', 'every month', 'every year'];
    const pop = popover(anchor, `
      <div class="tk-pop-sec"><h5>When</h5><div class="tk-chips">${whenChoices().map(([l, d, ic]) => `<button data-when="${d}" class="${d === cur ? 'on' : ''}">${ic}${l}${d && friendly(d) !== l ? `<small>${esc(friendly(d))}</small>` : ''}</button>`).join('')}</div>
        <label class="tk-pick">On <input type="date" value="${esc(cur)}"></label></div>
      <div class="tk-pop-sec"><h5>Priority</h5><div class="tk-chips">${['highest', 'high', 'medium', null, 'low'].map(p => `<button data-prio="${p || ''}" class="${(x.priority || null) === p ? 'on' : ''}" style="--pc:${p ? PRIO_COLOR[p] : 'var(--faint)'}">${ICON(I.flag)}${p ? PRIO_LABEL[p] : 'None'}</button>`).join('')}</div></div>
      <div class="tk-pop-sec"><h5>Repeat</h5><div class="tk-chips">${[null, ...REPEATS].map(r => `<button data-recur="${r || ''}" class="${(x.recur || null) === r ? 'on' : ''}">${r ? esc(r.replace(/^every /, 'Every ')) : 'Never'}</button>`).join('')}</div>
        <input class="tk-recur-in" placeholder="or type: every mon, thu · every month on the 15th · every week when done" value="${esc(x.recur && !REPEATS.includes(x.recur) ? x.recur : '')}" spellcheck="false"></div>
      <div class="tk-pop-foot"><button data-foot="open">${ICON(I.note)}Open in ${esc(noteLabel(x.path))}</button><span></span>${h.cancel ? '<button data-foot="cancel">Cancel task</button>' : ''}${h.remove ? '<button data-foot="delete" class="danger">Delete</button>' : ''}</div>`, 'tk-details');
    const done = () => pop.close();
    pop.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.when !== undefined) { h.setField(x, field, b.dataset.when || null); done(); }
      else if (b.dataset.prio !== undefined) { h.setField(x, 'priority', b.dataset.prio || null); done(); }
      else if (b.dataset.recur !== undefined) { h.setField(x, 'recur', b.dataset.recur || null); done(); }
      else if (b.dataset.foot === 'open') { done(); h.open(x.path, x.line); }
      else if (b.dataset.foot === 'cancel') { done(); h.cancel(x); }
      else if (b.dataset.foot === 'delete') { done(); h.remove(x); }
    });
    pop.querySelector('input[type=date]').addEventListener('change', e => { if (e.target.value) { h.setField(x, field, e.target.value); done(); } });
    const rin = pop.querySelector('.tk-recur-in');
    rin.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = rin.value.trim().toLowerCase();
      if (!v) return;
      if (!parseRecur(v.startsWith('every') ? v : 'every ' + v)) { rin.classList.add('bad'); return; }
      h.setField(x, 'recur', v.startsWith('every') ? v : 'every ' + v); done();
    });
    rin.addEventListener('input', () => rin.classList.remove('bad'));
    (focus === 'date' ? pop.querySelector('input[type=date]') : pop.querySelector('button.on') || pop.querySelector('button'))?.focus();
    if (focus === 'date') try { pop.querySelector('input[type=date]').showPicker?.(); } catch { }
    return pop;
  }

  // Edit a task's text in place: Enter saves, Esc cancels.
  function editText(row, x, h) {
    const box = row.querySelector('.tk-text');
    if (!box || row.querySelector('.tk-edit')) return;
    const inp = document.createElement('input');
    inp.className = 'tk-edit'; inp.value = x.text; inp.spellcheck = true;
    box.replaceWith(inp);
    inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    let finished = false;
    const finish = save => {
      if (finished) return; finished = true;
      const v = inp.value.trim();
      if (save && v && v !== x.text) h.setText(x, v);
      else { inp.replaceWith(box); row.focus(); }
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => finish(true));
  }

  // Events shared by the Tasks view and ```tasks blocks. h: {toggle(x), setField(x, field, value), setText, open(path, line), find(path, line), cancel, remove, complete?}
  function wire(el, h) {
    const t0 = () => today();
    const when = (x, d) => h.setField(x, x.due || !x.scheduled ? 'due' : 'scheduled', d);
    const complete = (row, x) => {
      if (x.done || x.cancelled || !h.complete) return h.toggle(x);
      // Tick it, let it be seen ticked for a moment, then complete it.
      row.classList.add('completing'); row.querySelector('.tk-check')?.setAttribute('aria-checked', 'true');
      setTimeout(() => h.complete(x), 650);
    };
    el.addEventListener('click', e => {
      const row = e.target.closest('.tk-row');
      const src = e.target.closest('[data-open]');
      if (src) { e.preventDefault(); return h.open(src.dataset.open, +src.dataset.line); }
      if (!row || e.target.closest('.tk-edit')) return;
      const x = h.find(row.dataset.path, +row.dataset.line);
      if (!x) return;
      if (e.target.closest('.tk-check')) { e.preventDefault(); return complete(row, x); }
      const b = e.target.closest('[data-act]');
      if (!b) {
        // A click on the text edits it (links and tags inside it still work).
        if (e.target.closest('.tk-text') && !e.target.closest('a, .tag, [data-href]') && h.setText) editText(row, x, h);
        return;
      }
      if (b.dataset.act === 'today') return when(x, t0());
      if (b.dataset.act === 'tomorrow') return when(x, addDays(t0(), 1));
      if (b.dataset.act === 'date') return details(b, x, h, 'date');
      if (b.dataset.act === 'more') return details(b, x, h);
    });
    // Keyboard: ↑↓ (j/k) move, Space/X tick, T today, M tomorrow, D date, P details, E edit, Enter opens the note.
    // The list redraws after each change, so focus comes back to the same place in it.
    let refocus = null;
    const rowsOf = () => [...el.querySelectorAll('.tk-row')];
    el.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, .tk-pop')) return;
      const cur = e.target.closest('.tk-row');
      const rows = rowsOf(), i = rows.indexOf(cur);
      const go = j => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; r?.focus(); r?.scrollIntoView({ block: 'nearest' }); };
      const x = cur && h.find(cur.dataset.path, +cur.dataset.line);
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, t = t0();
      const change = f => { if (!x) return; refocus = i; f(); };
      if (k === 'ArrowDown' || k === 'j') go(i + 1);
      else if ((k === 'ArrowUp' || k === 'k') && i <= 0 && el.querySelector('.tk-add')) el.querySelector('.tk-add').focus();
      else if (k === 'ArrowUp' || k === 'k') go(i - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(rows.length - 1);
      else if ((k === ' ' || k === 'x') && x) { refocus = i; complete(cur, x); }
      else if (k === 't') change(() => when(x, t));
      else if (k === 'm') change(() => when(x, addDays(t, 1)));
      else if (k === 'd' && x) details(cur.querySelector('[data-act=date]') || cur, x, h, 'date');
      else if (k === 'p' && x) details(cur.querySelector('[data-act=more]') || cur, x, h);
      else if ((k === 'e' || k === 'F2') && x && h.setText) editText(cur, x, h);
      else if ((k === 'Delete' || k === 'Backspace') && x && h.remove) change(() => h.remove(x));
      else if (k === 'Enter' && x) h.open(x.path, x.line);
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    new MutationObserver(() => {
      if (refocus == null) return;
      const rows = rowsOf();
      if (!rows.length) return;
      const r = rows[Math.min(refocus, rows.length - 1)];
      refocus = null;
      r.focus({ preventScroll: true }); r.scrollIntoView({ block: 'nearest' });
    }).observe(el, { childList: true, subtree: true });

    // Drag a task onto a section (or a list in the side bar) to reschedule it.
    let drag = null;
    const target = e => e.target.closest?.('.tk-section[data-date], .tk-nav [data-date]');
    el.addEventListener('dragstart', e => { const row = e.target.closest?.('.tk-row'); if (!row) return; drag = h.find(row.dataset.path, +row.dataset.line); e.dataTransfer.setData('text/plain', row.textContent.trim()); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    el.addEventListener('dragend', () => { drag = null; el.querySelectorAll('.dragging, .drop').forEach(n => n.classList.remove('dragging', 'drop')); });
    el.addEventListener('dragover', e => { const s = target(e); if (!s || !drag) return; e.preventDefault(); el.querySelectorAll('.drop').forEach(n => n !== s && n.classList.remove('drop')); s.classList.add('drop'); });
    el.addEventListener('dragleave', e => { const s = target(e); if (s && !s.contains(e.relatedTarget)) s.classList.remove('drop'); });
    el.addEventListener('drop', e => { const s = target(e); if (!s || !drag) return; e.preventDefault(); const x = drag; drag = null; h.setField(x, 'due', s.dataset.date || null); });
  }

  // Sections for a list of open tasks, by date / note / priority / heading.
  function groupTasks(list, by, now = new Date()) {
    const byPrio = (a, b) => (PRIORITY_RANK[a.priority ?? 'null'] - PRIORITY_RANK[b.priority ?? 'null']) || a.path.localeCompare(b.path) || a.line - b.line;
    const byDate = (a, b) => ((dateOf(a) || '9') < (dateOf(b) || '9') ? -1 : (dateOf(a) || '9') > (dateOf(b) || '9') ? 1 : byPrio(a, b));
    if (by === 'date') return buckets(list, now);
    const m = new Map();
    const key = by === 'note' ? x => x.path : by === 'heading' ? x => x.heading || '' : x => x.priority || 'none';
    for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    let keys = [...m.keys()];
    if (by === 'priority') keys.sort((a, b) => PRIORITY_RANK[a === 'none' ? 'null' : a] - PRIORITY_RANK[b === 'none' ? 'null' : b]);
    else if (by === 'note') keys.sort((a, b) => noteLabel(a).localeCompare(noteLabel(b)));
    else keys.sort((a, b) => Math.min(...m.get(a).map(x => x.line)) - Math.min(...m.get(b).map(x => x.line)));
    return keys.map(k => ({ id: by + ':' + k, title: by === 'note' ? noteLabel(k) : by === 'heading' ? (k || 'Top of the note') : k === 'none' ? 'No priority' : PRIO_LABEL[k] + ' priority', path: by === 'note' ? k : undefined, tasks: m.get(k).sort(byDate) }));
  }

  // The Tasks view: smart lists on the left, the chosen list on the right.
  // h: {tasks(), inline, toggle, complete, setField, setText, open, find, cancel, remove, add(line, path) -> Promise,
  //     pickTarget() -> Promise<path>, targetLabel(path), defaultTarget(), saved, save(state)}
  function mountView(el, h) {
    const st = Object.assign({ list: 'today', group: {}, showDone: false, target: null }, h.saved || {});
    let search = '', focusAdd = false;
    const keep = () => h.save?.({ list: st.list, group: st.group, showDone: st.showDone });

    const LISTS = [
      { id: 'today', name: 'Today', icon: I.star, sub: () => longDate(today()) },
      { id: 'upcoming', name: 'Upcoming', icon: I.upcoming, sub: () => 'The next seven days and later' },
      { id: 'anytime', name: 'Anytime', icon: I.layers, sub: () => 'Tasks without a date', date: '' },
      { id: 'all', name: 'Everything', icon: I.inbox, sub: () => 'Every open task in the vault' },
      { id: 'logbook', name: 'Logbook', icon: I.book, sub: () => 'Done and cancelled in the last 30 days' },
    ];
    function listTasks(all, id, t) {
      const open = all.filter(x => !x.done && !x.cancelled);
      if (id === 'today') return open.filter(x => dateOf(x) && dateOf(x) <= t);
      if (id === 'upcoming') return open.filter(x => dateOf(x) && dateOf(x) > t);
      if (id === 'anytime') return open.filter(x => !dateOf(x));
      if (id === 'all') return open;
      if (id === 'logbook') { const since = addDays(t, -30); return all.filter(x => (x.done && (x.doneDate || '') >= since) || (x.cancelled && (!x.cancelledDate || x.cancelledDate >= since))); }
      if (id.startsWith('note:')) return open.filter(x => x.path === id.slice(5));
      if (id.startsWith('tag:')) { const tg = id.slice(4); return open.filter(x => x.tags.some(g => g === tg || g.startsWith(tg + '/'))); }
      return open;
    }
    const groupFor = id => st.group[id] || (id.startsWith('note:') ? 'heading' : 'date');

    function render() {
      const all = h.tasks(), t = today();
      if (st.list.startsWith('note:') && !all.some(x => x.path === st.list.slice(5))) st.list = 'today';
      const open = all.filter(x => !x.done && !x.cancelled);
      const count = id => listTasks(all, id, t).length;
      const noteCounts = new Map(); for (const x of open) noteCounts.set(x.path, (noteCounts.get(x.path) || 0) + 1);
      const notes = [...noteCounts].sort((a, b) => b[1] - a[1] || noteLabel(a[0]).localeCompare(noteLabel(b[0]))).slice(0, 12);
      const tagCounts = new Map(); for (const x of open) for (const g of x.tags) tagCounts.set(g, (tagCounts.get(g) || 0) + 1);
      const tags = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
      const L = LISTS.find(l => l.id === st.list);
      const title = L ? L.name : st.list.startsWith('note:') ? noteLabel(st.list.slice(5)) : '#' + st.list.slice(4);
      const sub = L ? L.sub() : st.list.startsWith('note:') ? st.list.slice(5) : 'Open tasks with this tag';

      let list = listTasks(all, st.list, t);
      if (search) { const q = search.toLowerCase(); list = list.filter(x => x.text.toLowerCase().includes(q) || x.path.toLowerCase().includes(q)); }
      const logbook = st.list === 'logbook';
      const group = groupFor(st.list);
      let secs;
      if (logbook) {
        const m = new Map();
        for (const x of list.sort((a, b) => (b.doneDate || b.cancelledDate || '').localeCompare(a.doneDate || a.cancelledDate || ''))) { const d = x.doneDate || x.cancelledDate || ''; if (!m.has(d)) m.set(d, []); m.get(d).push(x); }
        secs = [...m].map(([d, ts]) => ({ id: 'd' + d, title: d ? friendly(d) : 'Cancelled', tasks: ts }));
      } else {
        secs = groupTasks(list, group);
        if (st.list === 'today' && group === 'date') secs = secs.filter(s => s.id === 'today' || s.id === 'overdue');
        if (st.list === 'upcoming' && group === 'date') secs = secs.filter(s => s.id !== 'today' && s.id !== 'overdue');
      }
      // Today's progress: what's been done today against what's left for today.
      const doneToday = all.filter(x => x.done && x.doneDate === t).length, leftToday = count('today');
      const pct = doneToday + leftToday ? doneToday / (doneToday + leftToday) : 0;
      const tg = st.list.startsWith('tag:') ? st.list.slice(4) : null;
      const recent = st.showDone && !logbook ? all.filter(x => x.done && (x.doneDate || '') >= addDays(t, -7) && (st.list === 'today' ? x.doneDate === t : st.list.startsWith('note:') ? x.path === st.list.slice(5) : tg ? x.tags.some(g => g === tg || g.startsWith(tg + '/')) : true)).sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || '')) : [];
      const addVal = el.querySelector('.tk-add')?.value || '';
      const target = st.target || (st.list.startsWith('note:') ? st.list.slice(5) : null);
      const navItem = (id, name, icon, n, extra = '') => `<button class="tk-li${st.list === id ? ' on' : ''}" data-list="${esc(id)}"${extra}>${ICON(icon)}<span>${esc(name)}</span>${n ? `<b>${n}</b>` : ''}</button>`;

      el.innerHTML = `<div class="tk-app">
        <nav class="tk-nav" aria-label="Task lists">
          ${navItem('today', 'Today', I.star, count('today'), ` data-date="${t}"`)}
          ${navItem('upcoming', 'Upcoming', I.upcoming, count('upcoming'))}
          ${navItem('anytime', 'Anytime', I.layers, count('anytime'), ' data-date=""')}
          ${navItem('all', 'Everything', I.inbox, open.length)}
          ${navItem('logbook', 'Logbook', I.book, 0)}
          ${notes.length ? `<h5>Notes</h5>${notes.map(([p, n]) => navItem('note:' + p, noteLabel(p), I.note, n, ` title="${esc(p)}"`)).join('')}` : ''}
          ${tags.length ? `<h5>Tags</h5>${tags.map(([g, n]) => navItem('tag:' + g, g, I.hash, n)).join('')}` : ''}
        </nav>
        <div class="tk-view">
          <div class="tk-head"><div><h2>${esc(title)}</h2><div class="tk-sub">${esc(sub)}</div></div>
            ${st.list === 'today' ? `<div class="tk-ring" title="${doneToday} done today, ${leftToday} to go"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dasharray:${(pct * 94.25).toFixed(1)} 94.25"/></svg><span><b>${doneToday}</b> of ${doneToday + leftToday}</span></div>` : `<span class="tk-count">${logbook ? list.length + ' done' : list.length + ' open'}</span>`}</div>
          ${logbook ? '' : `<div class="tk-addbox"><div class="tk-addrow"><span class="tk-plus">+</span><input class="tk-add" placeholder="Add a task… try “Call Sam tomorrow !high every week #home”" spellcheck="false" value="${esc(addVal)}" aria-label="Add a task"></div>
            <div class="tk-addfoot"><div class="tk-preview"></div><button class="tk-target" title="Choose the note new tasks go to">Adds to <b>${esc(h.targetLabel(target))}</b> ▾</button></div></div>`}
          <div class="tk-filters"><input class="field tk-search" type="search" placeholder="Filter this list…" value="${esc(search)}" spellcheck="false" aria-label="Filter tasks">
            ${logbook ? '' : `<div class="seg tk-group" role="radiogroup" aria-label="Group by">${[['date', 'Date'], ['note', 'Note'], ['priority', 'Priority'], ...(st.list.startsWith('note:') ? [['heading', 'Heading']] : [])].map(([v, l]) => `<button data-group="${v}" class="${group === v ? 'on' : ''}" role="radio" aria-checked="${group === v}">${l}</button>`).join('')}</div>
            <label class="tk-showdone"><input type="checkbox"${st.showDone ? ' checked' : ''}> Show done</label>`}</div>
          ${st.list === 'today' && secs.some(s => s.id === 'overdue') ? `<div class="tk-rollover">${secs.find(s => s.id === 'overdue').tasks.length} overdue <button class="btn" data-roll>Move them all to today</button></div>` : ''}
          ${secs.map(s => `<section class="tk-section${s.tone ? ' tk-' + s.tone : ''}"${s.date !== undefined ? ` data-date="${esc(s.date)}"` : ''}><h3>${s.path ? `<a data-open="${esc(s.path)}" data-line="0">${esc(s.title)}</a>` : esc(s.title)} <span>${s.tasks.length}</span></h3>${s.tasks.map(x => rowHtml(x, h, { drag: !logbook, source: !(group === 'note' || st.list.startsWith('note:')), heading: group !== 'heading', actions: !logbook })).join('') || (s.date !== undefined ? '<div class="tk-empty">Nothing here. Drag a task onto this day, or add one above.</div>' : '')}</section>`).join('')}
          ${recent.length ? `<section class="tk-section tk-done"><h3>Done this week <span>${recent.length}</span></h3>${recent.map(x => rowHtml(x, h, { actions: false })).join('')}</section>` : ''}
          ${!secs.length && all.length ? `<div class="tk-blank">${ICON(st.list === 'today' ? I.sun : I.check)}<p>${st.list === 'today' ? 'Nothing left for today.' : logbook ? 'Nothing done in the last 30 days.' : 'No tasks here.'}</p></div>` : ''}
          ${!all.length ? `<div class="tk-blank">${ICON(I.check)}<p>No tasks in the vault yet. Add one above, or write <code>- [ ] something</code> in any note.</p></div>` : ''}
        </div></div>`;
      preview();
      const add = el.querySelector('.tk-add');
      if (focusAdd && add) { add.focus(); add.setSelectionRange(add.value.length, add.value.length); focusAdd = false; }
    }
    function preview() {
      const inp = el.querySelector('.tk-add'), pv = el.querySelector('.tk-preview');
      if (!inp || !pv) return;
      const v = inp.value.trim();
      if (!v) { pv.innerHTML = '<span class="tk-tip">Understands dates like “friday”, <code>!high</code>, <code>every week</code> and <code>#tags</code></span>'; return; }
      const q = parseQuick(v);
      const bits = [];
      if (q.due) bits.push(`<span class="tk-chip tk-date${q.due === today() ? ' today' : ''}">${ICON(I.cal)}${esc(friendly(q.due))}</span>`);
      if (q.priority) bits.push(`<span class="tk-chip tk-prio" style="--pc:${PRIO_COLOR[q.priority]}">${ICON(I.flag)}${PRIO_LABEL[q.priority]}</span>`);
      if (q.recur) bits.push(`<span class="tk-chip tk-recur">${ICON(I.recur)}repeats ${esc(q.recur)}</span>`);
      pv.innerHTML = `<span class="tk-pv-text">${esc(q.text || '…')}</span>${bits.join('')}<kbd>Enter</kbd>`;
    }
    el.addEventListener('input', e => {
      if (e.target.classList.contains('tk-add')) return preview();
      if (e.target.classList.contains('tk-search')) { search = e.target.value; render(); el.querySelector('.tk-search').focus(); el.querySelector('.tk-search').setSelectionRange(search.length, search.length); }
    });
    el.addEventListener('change', e => {
      if (e.target.closest('.tk-showdone')) { st.showDone = e.target.checked; keep(); render(); }
    });
    el.addEventListener('click', async e => {
      const li = e.target.closest('.tk-li');
      if (li) { st.list = li.dataset.list; st.target = null; search = ''; keep(); render(); return; }
      const g = e.target.closest('[data-group]');
      if (g) { st.group = { ...st.group, [st.list]: g.dataset.group }; keep(); render(); return; }
      if (e.target.closest('[data-roll]')) { const t = today(); for (const x of listTasks(h.tasks(), 'today', t).filter(x => dateOf(x) < t)) await h.setField(x, x.due || !x.scheduled ? 'due' : 'scheduled', t); return; }
      if (e.target.closest('.tk-target')) { const p = await h.pickTarget(); if (p) { st.target = p; render(); el.querySelector('.tk-add')?.focus(); } }
    });
    el.addEventListener('keydown', async e => {
      // ↓ from the add or search box moves into the list; ↑↓ move through the side bar.
      if (e.key === 'ArrowDown' && e.target.matches('.tk-add, .tk-search') && el.querySelector('.tk-row')) { e.preventDefault(); el.querySelector('.tk-row').focus(); return; }
      if (e.target.classList.contains('tk-li') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const lis = [...el.querySelectorAll('.tk-li')], i = lis.indexOf(e.target);
        const n = lis[Math.max(0, Math.min(lis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        st.list = n.dataset.list; st.target = null; keep(); render(); el.querySelector(`.tk-li[data-list="${CSS.escape(n.dataset.list)}"]`)?.focus();
        return;
      }
      if (!e.target.classList.contains('tk-add')) return;
      if (e.key === 'Escape') { e.target.value = ''; preview(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = e.target.value.trim();
      if (!v) return;
      const q = parseQuick(v);
      if (!q.text) return;
      // In Today, a task with no date is for today; in a tag's list it gets the tag.
      if (st.list === 'today' && !q.due) q.due = today();
      if (st.list.startsWith('tag:') && !q.text.toLowerCase().includes('#' + st.list.slice(4))) q.text += ' #' + st.list.slice(4);
      e.target.value = '';
      focusAdd = true;
      await h.add(formatTask(q), st.target || (st.list.startsWith('note:') ? st.list.slice(5) : null));
    });
    wire(el, { ...h, refresh: render });
    render();
    return { refresh: render, state: () => ({ ...st, search }), show: id => { st.list = id; keep(); render(); } };
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

  root.CinderTasks = { ...pure, mountView, mountQuery };
})(typeof window !== 'undefined' ? window : globalThis);
