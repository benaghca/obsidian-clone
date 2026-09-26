/* Cinder app — daily, weekly and monthly notes, and the calendar that finds them.
 * (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * A periodic note's name is its date in a format (moment.js style, as in Obsidian's Daily
 * notes and Periodic Notes plugins), in a folder, started from a template. The calendar (a tab
 * in the right side bar) shows a month: a dot on each day that has a note, a ring on days with
 * tasks due, the week numbers for weekly notes and the month's name for the monthly note. */

const PERIODS = {
  day: { name: 'daily note', folder: () => cfg.dailyFolder, format: () => cfg.dailyFormat || 'YYYY-MM-DD', template: () => cfg.dailyTemplate },
  week: { name: 'weekly note', folder: () => cfg.weeklyFolder || cfg.dailyFolder, format: () => cfg.weeklyFormat || 'GGGG-[W]WW', template: () => cfg.weeklyTemplate },
  month: { name: 'monthly note', folder: () => cfg.monthlyFolder || cfg.dailyFolder, format: () => cfg.monthlyFormat || 'YYYY-MM', template: () => cfg.monthlyTemplate },
};
const periodPath = (kind, d) => join(PERIODS[kind].folder(), CinderTemplater.formatDate(d, PERIODS[kind].format()) + '.md');

// The date a periodic note's name stands for (null if it isn't one). Handles the formats'
// usual tokens; anything else in the format has to match as written.
function periodDate(kind, path) {
  const P = PERIODS[kind];
  if (!isMd(path) || dirname(path) !== P.folder()) return null;
  const name = noteName(path), fmt = P.format();
  const parts = [];
  let re = '';
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  fmt.replace(/\[([^\]]*)\]|YYYY|GGGG|MMMM|MMM|MM|M|DDDD|DD|Do|D|WW|W|dddd|ddd|[^\[YGMDWd]+|./g, (t, lit) => {
    if (lit !== undefined) re += lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (t === 'YYYY' || t === 'GGGG') { re += '(\\d{4})'; parts.push('Y'); }
    else if (t === 'MMMM' || t === 'MMM') { re += '([A-Za-z]+)'; parts.push('Mname'); }
    else if (t === 'MM' || t === 'M') { re += '(\\d{1,2})'; parts.push('M'); }
    else if (t === 'DD' || t === 'D') { re += '(\\d{1,2})'; parts.push('D'); }
    else if (t === 'Do') { re += '(\\d{1,2})(?:st|nd|rd|th)'; parts.push('D'); }
    else if (t === 'WW' || t === 'W') { re += '(\\d{1,2})'; parts.push('W'); }
    else if (t === 'dddd' || t === 'ddd') re += '[A-Za-z]+';
    else re += t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return t;
  });
  const m = new RegExp('^' + re + '$', 'i').exec(name);
  if (!m) return null;
  const v = {};
  parts.forEach((p, i) => { v[p] = m[i + 1]; });
  if (v.Mname) { const i = MONTHS.findIndex(x => x.startsWith(v.Mname.toLowerCase().slice(0, 3))); if (i < 0) return null; v.M = i + 1; }
  const y = +v.Y;
  if (!y) return null;
  let d;
  if (v.W) { // ISO week: that week's Monday
    const jan4 = new Date(y, 0, 4), mon1 = new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7));
    d = new Date(mon1); d.setDate(mon1.getDate() + (+v.W - 1) * 7);
  } else d = new Date(y, (+v.M || 1) - 1, +v.D || 1);
  // Only if formatting the date gives the name back (so "2024-02-31" isn't a date).
  return CinderTemplater.formatDate(d, fmt).toLowerCase() === name.toLowerCase() ? d : null;
}
const periodOf = path => { for (const k of ['day', 'week', 'month']) { const d = periodDate(k, path); if (d) return { kind: k, date: d }; } return null; };

// Open (making it first, from its template) the periodic note for `date`.
async function openPeriodic(kind, date = new Date(), opts = {}) {
  const path = periodPath(kind, date);
  if (S.files.has(path)) return openPath(path, opts);
  const tname = PERIODS[kind].template();
  const t = tname && resolveLink(tname, null);
  // The template runs as of that day (at the current time of day), so its dates are that day's.
  const now = new Date(date); const clock = new Date(); now.setHours(clock.getHours(), clock.getMinutes(), clock.getSeconds());
  const template = t && S.notes.has(t) ? { text: S.notes.get(t).content, from: t, optional: true, now } : undefined;
  const r = await createNote(path, '', { mode: 'edit', template, ...opts });
  if (r && r.cursor < 0 && S.cur === path) ed.setSelectionRange(ed.value.length, ed.value.length, true);
  refreshCalendar();
}
const openDaily = (d, opts) => openPeriodic('day', d, opts);

// The daily note before or after the open one (or today), skipping days without a note.
function stepDaily(dir) {
  const cur = S.cur && periodDate('day', S.cur);
  const from = CinderTasks.today(), pivot = cur ? CinderTemplater.formatDate(cur, 'YYYY-MM-DD') : from;
  const days = [...S.files.keys()].map(p => periodDate('day', p)).filter(Boolean).map(d => CinderTemplater.formatDate(d, 'YYYY-MM-DD')).sort();
  const next = dir > 0 ? days.find(d => d > pivot) : [...days].reverse().find(d => d < pivot);
  if (!next) return toast(dir > 0 ? 'No later daily note' : 'No earlier daily note');
  const [y, m, dd] = next.split('-').map(Number);
  openPeriodic('day', new Date(y, m - 1, dd));
}

// ------------------------------------------------------------ the calendar

let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();

function drawCalendar(body) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const monday = cfg.weekStart !== 'sunday';
  const first = new Date(y, m, 1);
  const lead = monday ? (first.getDay() + 6) % 7 : first.getDay();
  const start = new Date(y, m, 1 - lead);
  const today = CinderTasks.today();
  const cur = S.cur && periodOf(S.cur);
  const curKey = cur ? cur.kind + CinderTemplater.formatDate(cur.date, 'YYYY-MM-DD') : '';
  // Open tasks due each day.
  const due = new Map();
  for (const x of allTasks()) if (!x.done && !x.cancelled && (x.due || x.scheduled)) { const k = x.due || x.scheduled; due.set(k, (due.get(k) || 0) + 1); }
  const names = [...Array(7)].map((_, i) => new Date(2024, 0, (monday ? 1 : 7) + i).toLocaleDateString(undefined, { weekday: 'narrow' }));
  const monthPath = periodPath('month', first);
  let rows = '';
  for (let w = 0; w < 6; w++) {
    const wd = new Date(start); wd.setDate(start.getDate() + w * 7);
    if (w >= 4 && wd.getMonth() !== m) break;
    const isoMon = new Date(wd); if (!monday) isoMon.setDate(isoMon.getDate() + 1);
    const wp = periodPath('week', isoMon), wk = CinderTemplater.formatDate(isoMon, 'W');
    rows += `<div class="cal-row"><button class="cal-wk${S.files.has(wp) ? ' has' : ''}${curKey === 'week' + CinderTemplater.formatDate(isoMon, 'YYYY-MM-DD') ? ' cur' : ''}" data-week="${CinderTemplater.formatDate(isoMon, 'YYYY-MM-DD')}" title="Week ${wk}${S.files.has(wp) ? '' : ' (no weekly note yet)'}">${wk}</button>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(wd); d.setDate(wd.getDate() + i);
      const key = CinderTemplater.formatDate(d, 'YYYY-MM-DD'), p = periodPath('day', d), f = S.files.get(p);
      const dots = f ? Math.min(3, 1 + Math.floor((f.size || 0) / 1500)) : 0;
      const cls = ['cal-day', d.getMonth() !== m && 'out', key === today && 'today', curKey === 'day' + key && 'cur', due.get(key) && 'due'].filter(Boolean).join(' ');
      rows += `<button class="${cls}" data-day="${key}" title="${esc(d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}${f ? '' : ' · no note yet'}${due.get(key) ? ` · ${due.get(key)} task${due.get(key) === 1 ? '' : 's'} due` : ''}"><span>${d.getDate()}</span><i>${'<b></b>'.repeat(dots)}</i></button>`;
    }
    rows += '</div>';
  }
  body.innerHTML = `<div class="cal">
    <div class="cal-head"><button class="cal-title${S.files.has(monthPath) ? ' has' : ''}${curKey === 'month' + CinderTemplater.formatDate(first, 'YYYY-MM-DD') ? ' cur' : ''}" data-month title="Open the monthly note">${esc(first.toLocaleDateString(undefined, { month: 'long' }))} <span>${y}</span></button>
      <button class="ib" data-cal="-1" title="Previous month" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button><button class="cal-today" data-cal="0">Today</button><button class="ib" data-cal="1" title="Next month" aria-label="Next month"><svg viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"/></svg></button></div>
    <div class="cal-grid" role="grid"><div class="cal-row cal-names"><span class="cal-wk">W</span>${names.map(n => `<span>${esc(n)}</span>`).join('')}</div>${rows}</div>
    <div class="cal-foot"><button class="btn" data-open="week">This week</button><button class="btn" data-open="month">This month</button></div>
    <div class="cal-hint">Click a day for its daily note, a week number for its weekly note, the month for the monthly note. Ctrl+click opens a new tab.</div>
  </div>`;
}
function refreshCalendar() { if (rtab === 'calendar') refreshPanels(true); }

$('#right-body').addEventListener('click', e => {
  const b = e.target.closest('.cal [data-day], .cal [data-week], .cal [data-month], .cal [data-cal], .cal [data-open]');
  if (!b) return;
  e.stopPropagation();
  const newTab = e.ctrlKey || e.metaKey;
  const at = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const go = (kind, d) => newTab ? openInNewTab(null).then(() => openPeriodic(kind, d)) : openPeriodic(kind, d);
  if (b.dataset.day) go('day', at(b.dataset.day));
  else if (b.dataset.week) go('week', at(b.dataset.week));
  else if (b.dataset.month !== undefined) go('month', calMonth);
  else if (b.dataset.open) go(b.dataset.open, new Date());
  else {
    const n = +b.dataset.cal;
    calMonth = n ? new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    refreshPanels(true);
  }
}, true);

// Settings → Daily notes: what today's note would be called.
function settingPeriodicPreview(ctl) {
  const draw = () => {
    const d = new Date();
    ctl.innerHTML = `<div class="st-pp">${['day', 'week', 'month'].map(k => `<div><span>${esc(PERIODS[k].name.replace(/^./, c => c.toUpperCase()))}</span><code>${esc(periodPath(k, d))}</code></div>`).join('')}</div>`;
  };
  draw();
  setTimeout(() => ctl.closest('.st-content')?.addEventListener('input', debounce(draw, 450)));
}
