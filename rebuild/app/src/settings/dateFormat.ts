// Dates in the formats Obsidian's Daily notes and Templates settings use
// (Moment.js tokens; the common ones: YYYY YY M MM MMM MMMM D DD Do d dd ddd
// dddd H HH h hh m mm s ss A a Q W WW, text in [brackets] kept as is). Free
// of the DOM; English names.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKENS = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|A|a|Q|WW|W/g;

const pad = (n: number) => String(n).padStart(2, "0");
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** ISO week number (Moment's W). */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatDate(d: Date, format: string): string {
  return format.replace(TOKENS, (tok, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    const h12 = d.getHours() % 12 || 12;
    switch (tok) {
      case "YYYY": return String(d.getFullYear());
      case "YY": return pad(d.getFullYear() % 100);
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
      case "WW": return pad(isoWeek(d));
      case "W": return String(isoWeek(d));
      default: return tok;
    }
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * A pattern matching names written in a format, with the date parts
 * captured, for telling daily notes apart and putting them in order.
 */
export function dateNamePattern(format: string): { parse(name: string): number | null } {
  const order: string[] = [];
  let src = "";
  let last = 0;
  for (const m of format.matchAll(TOKENS)) {
    src += escape(format.slice(last, m.index));
    last = m.index! + m[0].length;
    const tok = m[0];
    if (m[1] !== undefined) src += escape(m[1]);
    else if (tok === "YYYY") (order.push("Y"), (src += "(\\d{4})"));
    else if (tok === "MM" || tok === "M") (order.push("M"), (src += tok === "MM" ? "(\\d{2})" : "(\\d{1,2})"));
    else if (tok === "DD" || tok === "D") (order.push("D"), (src += tok === "DD" ? "(\\d{2})" : "(\\d{1,2})"));
    else if (tok === "MMMM" || tok === "MMM") (order.push("Mn"), (src += `(${MONTHS.map((n) => (tok === "MMM" ? n.slice(0, 3) : n)).join("|")})`));
    else if (tok === "Do") (order.push("D"), (src += "(\\d{1,2})(?:st|nd|rd|th)"));
    else if (tok.startsWith("d")) src += tok === "d" ? "\\d" : `(?:${DAYS.map((n) => (tok === "dddd" ? n : n.slice(0, tok.length))).join("|")})`;
    else src += "\\d{1,4}";
  }
  src += escape(format.slice(last));
  const regex = new RegExp(`^${src}$`);
  return {
    parse(name) {
      const m = regex.exec(name);
      if (!m) return null;
      let y = 0;
      let mo = 0;
      let d = 1;
      order.forEach((part, i) => {
        const v = m[i + 1];
        if (part === "Y") y = Number(v);
        else if (part === "M") mo = Number(v) - 1;
        else if (part === "Mn") mo = MONTHS.findIndex((n) => n.startsWith(v));
        else d = Number(v);
      });
      return order.includes("Y") ? new Date(y, mo, d).getTime() : null;
    },
  };
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
