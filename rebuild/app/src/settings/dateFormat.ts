// Dates in the formats Obsidian's Daily notes and Templates settings use
// (Moment.js tokens; the common ones: YYYY YY M MM MMM MMMM D DD Do d dd ddd
// dddd H HH h hh m mm s ss A a Q W WW GGGG GG w ww gggg gg, text in
// [brackets] kept as is). Free of the DOM; English names, and the English
// locale's weeks for w and gggg (they start on Sunday; week 1 holds 1 January).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKENS = /\[([^\]]*)\]|YYYY|YY|GGGG|GG|gggg|gg|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|A|a|Q|WW|W|ww|w/g;
/** Tokens a time of day fills in: a daily note's name does not have to agree with them. */
const TIME_TOKEN = /^(?:HH|H|hh|h|mm|m|ss|s|A|a)$/;

const pad = (n: number) => String(n).padStart(2, "0");
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * The week `d` is in and the year that week belongs to, for weeks starting on
 * `firstDay` (0 Sunday, 1 Monday) whose week 1 holds 1 January (`anchor` 6) or
 * the year's first Thursday (ISO, `anchor` 3): the year of the week's day
 * `anchor` days after its start.
 */
function week(d: Date, firstDay: number, anchor: number): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() - firstDay + 7) % 7) + anchor);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { week: Math.floor((t.getTime() - yearStart) / 86400000 / 7) + 1, year: t.getUTCFullYear() };
}
/** ISO weeks (Moment's W and GGGG): Monday first, week 1 holds the year's first Thursday. */
const isoWeek = (d: Date) => week(d, 1, 3);
/** English-locale weeks (Moment's w and gggg): Sunday first, week 1 holds 1 January. */
const localeWeek = (d: Date) => week(d, 0, 6);

export function formatDate(d: Date, format: string): string {
  return format.replace(TOKENS, (tok, literal: string | undefined) => (literal !== undefined ? literal : formatToken(d, tok)));
}

/** One token of a format, as `d` writes it. */
function formatToken(d: Date, tok: string): string {
  const h12 = d.getHours() % 12 || 12;
  switch (tok) {
    case "YYYY": return String(d.getFullYear());
    case "YY": return pad(d.getFullYear() % 100);
    case "GGGG": return String(isoWeek(d).year);
    case "GG": return pad(isoWeek(d).year % 100);
    case "gggg": return String(localeWeek(d).year);
    case "gg": return pad(localeWeek(d).year % 100);
    case "MMMM": return MONTHS[d.getMonth()];
    case "MMM": return MONTHS[d.getMonth()].slice(0, 3);
    case "MM": return pad(d.getMonth() + 1);
    case "M": return String(d.getMonth() + 1);
    case "Do": return ordinal(d.getDate());
    case "DD": return pad(d.getDate());
    case "D": return String(d.getDate());
    case "dddd": return DAYS[d.getDay()];
    case "ddd": return DAYS[d.getDay()].slice(0, 3);
    case "dd": return DAYS[d.getDay()].slice(0, 2);
    case "d": return String(d.getDay());
    case "HH": return pad(d.getHours());
    case "H": return String(d.getHours());
    case "hh": return pad(h12);
    case "h": return String(h12);
    case "mm": return pad(d.getMinutes());
    case "m": return String(d.getMinutes());
    case "ss": return pad(d.getSeconds());
    case "s": return String(d.getSeconds());
    case "A": return d.getHours() < 12 ? "AM" : "PM";
    case "a": return d.getHours() < 12 ? "am" : "pm";
    case "Q": return String(Math.floor(d.getMonth() / 3) + 1);
    case "WW": return pad(isoWeek(d).week);
    case "W": return String(isoWeek(d).week);
    case "ww": return pad(localeWeek(d).week);
    case "w": return String(localeWeek(d).week);
    default: return tok;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const patterns = new Map<string, { parse(name: string): number | null }>();

/**
 * A pattern matching names written in a format, with the date parts
 * captured, for telling daily notes apart and putting them in order. A name
 * is that day's only if every date part agrees with it: the year in
 * `YYYY/MM/YYYY-MM-DD` both times, the weekday, the week number.
 */
export function dateNamePattern(format: string): { parse(name: string): number | null } {
  let pattern = patterns.get(format);
  if (!pattern) {
    if (patterns.size > 32) patterns.clear();
    patterns.set(format, (pattern = buildPattern(format)));
  }
  return pattern;
}

function buildPattern(format: string): { parse(name: string): number | null } {
  // The date tokens in the order they are captured. Literals and times are not captured.
  const tokens: string[] = [];
  let src = "";
  let last = 0;
  for (const m of format.matchAll(TOKENS)) {
    src += escape(format.slice(last, m.index));
    last = m.index! + m[0].length;
    const tok = m[0];
    if (m[1] !== undefined) {
      src += escape(m[1]);
      continue;
    }
    if (TIME_TOKEN.test(tok)) {
      src += tok === "A" || tok === "a" ? "(?:AM|PM|am|pm)" : "\\d{1,2}";
      continue;
    }
    tokens.push(tok);
    if (tok === "YYYY" || tok === "GGGG" || tok === "gggg") src += "(\\d{4})";
    else if (tok === "MMMM" || tok === "MMM") src += `(${MONTHS.map((n) => (tok === "MMM" ? n.slice(0, 3) : n)).join("|")})`;
    else if (tok === "Do") src += "(\\d{1,2}(?:st|nd|rd|th))";
    else if (tok === "dddd" || tok === "ddd" || tok === "dd") src += `(${DAYS.map((n) => (tok === "dddd" ? n : n.slice(0, tok.length))).join("|")})`;
    else if (tok.length === 2) src += "(\\d{2})";
    else src += "(\\d{1,2})";
  }
  src += escape(format.slice(last));
  const regex = new RegExp(`^${src}$`);
  const yearAt = tokens.indexOf("YYYY");
  const monthAt = tokens.findIndex((t) => t === "MM" || t === "M" || t === "MMMM" || t === "MMM");
  const dayAt = tokens.findIndex((t) => t === "DD" || t === "D" || t === "Do");
  const monthNumber = tokens[monthAt] === "MM" || tokens[monthAt] === "M";
  // What else has to agree with the day: a repeat of the year, month or day
  // token must be the same text; anything else is written out and compared.
  // The year, month and day themselves are proven by the calendar check below,
  // except a one-digit M or D written "03" and Do's suffix.
  const checks: [at: number, same: number][] = [];
  tokens.forEach((tok, i) => {
    const first = tokens.indexOf(tok);
    if (i === yearAt || (i === monthAt && tok !== "M") || (i === dayAt && tok === "DD")) return;
    checks.push([i, first < i && (first === yearAt || first === monthAt || first === dayAt) ? first : -1]);
  });
  return {
    parse(name) {
      if (yearAt < 0) return null;
      const m = regex.exec(name);
      if (!m) return null;
      const y = Number(m[yearAt + 1]);
      const mo = monthAt < 0 ? 0 : monthNumber ? Number(m[monthAt + 1]) - 1 : MONTHS.findIndex((n) => n.startsWith(m[monthAt + 1]));
      const d = dayAt < 0 ? 1 : parseInt(m[dayAt + 1], 10);
      // Date rolls 2026-02-29 to 1 March and 2026-13-40 into 2027. A daily
      // note name has to be that calendar day, or it is not one.
      const date = new Date(y, mo, d);
      if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
      // Every other date part as that day writes it ("2026/09/2026-10-03" is not 3 October).
      for (const [i, same] of checks) if (m[i + 1] !== (same < 0 ? formatToken(date, tokens[i]) : m[same + 1])) return null;
      return date.getTime();
    },
  };
}

/** The daily notes folder and date format as a path's parts are joined: no empty folders, no ".md". */
const dailyParts = (folder: string, format: string) => ({
  prefix: folder.trim().split("/").filter(Boolean).join("/"),
  format: (format.trim() || "YYYY-MM-DD").split("/").filter(Boolean).join("/") || "YYYY-MM-DD",
});
const joinPath = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);

/**
 * Where the daily note for `date` goes: the daily notes folder, then the
 * date in the format, which can hold folders of its own (`YYYY/MM/YYYY-MM-DD`).
 */
export function dailyNotePath(date: Date, daily: { folder: string; format: string }): string {
  const { prefix, format } = dailyParts(daily.folder, daily.format);
  return `${joinPath(prefix, formatDate(date, format).split("/").filter(Boolean).join("/"))}.md`;
}

/** The daily notes among `paths`, oldest first: notes under the folder whose path there fits the format. */
export function dailyNoteList(paths: Iterable<string>, daily: { folder: string; format: string }): { path: string; time: number }[] {
  const { prefix, format } = dailyParts(daily.folder, daily.format);
  const start = prefix ? `${prefix}/` : "";
  const pattern = dateNamePattern(format);
  const out: { path: string; time: number }[] = [];
  for (const path of paths) {
    if (!path.startsWith(start) || !/\.md$/i.test(path)) continue;
    const time = pattern.parse(path.slice(start.length, -3));
    if (time !== null) out.push({ path, time });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** In a `dailyNoteList`, the daily note before (`dir` -1) or after (1) `path`; null at either end or when `path` is not one. */
export function adjacentDailyNote(list: readonly { path: string }[], path: string | null, dir: 1 | -1): string | null {
  if (!path) return null;
  const i = list.findIndex((n) => n.path === path);
  return i < 0 ? null : (list[i + dir]?.path ?? null);
}

/**
 * A template's text with Obsidian's variables filled in: {{title}},
 * {{date}} and {{time}} (in the Templates settings' formats), and
 * {{date:FORMAT}} / {{time:FORMAT}} for a one-off format.
 */
export function fillTemplate(text: string, title: string, now: Date, dateFormat: string, timeFormat: string): string {
  return text.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (_m, name: string, format: string | undefined) => {
    const key = name.toLowerCase();
    if (key === "title") return title;
    return formatDate(now, format?.trim() || (key === "date" ? dateFormat : timeFormat));
  });
}
