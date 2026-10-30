// Formula dates use local calendar days/months and elapsed milliseconds for
// hours/minutes/seconds. No host Date object is exposed to the expression language.
import { formatDate } from "../settings/dateFormat";

const DAY = 86_400_000;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
export class FormulaDate {
  readonly kind = "date";
  constructor(readonly time: number, readonly dateOnly = false) {
    if (!Number.isFinite(time) || Math.abs(time) > 8.64e15) throw Error("Date is out of range");
    this.time = Math.trunc(time);
    Object.freeze(this);
  }
  toString() {
    const d = new Date(this.time);
    const year = d.getFullYear();
    const y = year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? "-" : "+"}${pad(Math.abs(year), 6)}`;
    return this.dateOnly ? `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : d.toISOString();
  }
}
export class FormulaDuration {
  readonly kind = "duration";
  constructor(readonly months: number, readonly days: number, readonly milliseconds: number) {
    if (![months, days, milliseconds].every(Number.isFinite) || !Number.isSafeInteger(months)) throw Error("Invalid duration");
    Object.freeze(this);
  }
  toString() {
    return [this.months && `${this.months}mo`, this.days && `${this.days}d`, this.milliseconds && `${this.milliseconds}ms`].filter(Boolean).join(" ") || "0ms";
  }
}

const calendar = (y: number, m: number, d: number, h = 0, min = 0, sec = 0, ms = 0) => {
  const out = new Date(0);
  out.setFullYear(y, m - 1, d); out.setHours(h, min, sec, ms);
  return out;
};
const monthDays = (y: number, m: number) => {
  const d = new Date(0); d.setUTCFullYear(y, m, 0); return d.getUTCDate();
};

/** Strict ISO date or datetime; date-only and offset-free datetime are local. */
export function parseDate(value: string | number | FormulaDate): FormulaDate | null {
  if (value instanceof FormulaDate) return value;
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new FormulaDate(value) : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, y, m, day, hours, minutes, seconds, fraction, zone] = match;
  const year = Number(y), month = Number(m), date = Number(day);
  const h = Number(hours ?? 0), min = Number(minutes ?? 0), sec = Number(seconds ?? 0), ms = Number((fraction ?? "").padEnd(3, "0"));
  if (month < 1 || month > 12 || date < 1 || date > monthDays(year, month) || h > 23 || min > 59 || sec > 59) return null;
  let time: number;
  if (zone) {
    const offset = zone === "Z" ? 0 : Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2));
    if (offset >= 24 * 60 || (zone !== "Z" && Number(zone.slice(-2)) > 59)) return null;
    const d = new Date(0); d.setUTCFullYear(year, month - 1, date); d.setUTCHours(h, min, sec, ms);
    time = d.getTime() - (zone.startsWith("-") ? -offset : offset) * 60_000;
  } else {
    const d = calendar(year, month, date, h, min, sec, ms);
    // Reject nonexistent local clock times instead of silently changing input.
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== date || d.getHours() !== h || d.getMinutes() !== min) return null;
    time = d.getTime();
  }
  return new FormulaDate(time, hours === undefined);
}

/** A duration consists of signed quantities and units, e.g. "1 month 2d 3h". */
export function parseDuration(text: string | number | FormulaDuration): FormulaDuration | null {
  if (text instanceof FormulaDuration) return text;
  if (typeof text === "number") return Number.isFinite(text) ? new FormulaDuration(0, 0, text) : null;
  text = text.trim();
  if (!text || text.length > 4000) return null;
  const term = /([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([A-Za-z]+)/y;
  let at = 0, months = 0, days = 0, milliseconds = 0;
  while (at < text.length) {
    term.lastIndex = at;
    const part = term.exec(text);
    if (!part) return null;
    const value = Number(part[1]), raw = part[2], lower = raw.toLowerCase();
    const unit = raw === "M" ? "mo" : ["ms", "s"].includes(lower) ? lower : lower.replace(/s$/, "");
    if (!Number.isFinite(value)) return null;
    if (["y", "yr", "year"].includes(unit)) months += value * 12;
    else if (["q", "quarter"].includes(unit)) months += value * 3;
    else if (["mo", "month"].includes(unit)) months += value;
    else if (["w", "wk", "week"].includes(unit)) days += value * 7;
    else if (["d", "day"].includes(unit)) days += value;
    else if (["h", "hr", "hour"].includes(unit)) milliseconds += value * 3_600_000;
    else if (["m", "min", "minute"].includes(unit)) milliseconds += value * 60_000;
    else if (["s", "sec", "second"].includes(unit)) milliseconds += value * 1000;
    else if (["ms", "millisecond"].includes(unit)) milliseconds += value;
    else return null;
    at = term.lastIndex;
    if (at === text.length) break;
    const separator = /^(?:\s*,\s*|\s+)/.exec(text.slice(at));
    if (separator) { at += separator[0].length; if (at === text.length && separator[0].includes(",")) return null; }
    // Adjacent terms, e.g. 1h30m, are allowed; everything must be consumed.
  }
  return Number.isSafeInteger(months) && [days, milliseconds].every(Number.isFinite) ? new FormulaDuration(months, days, milliseconds) : null;
}

export function today(time = Date.now()): FormulaDate {
  const d = new Date(time);
  return new FormulaDate(calendar(d.getFullYear(), d.getMonth() + 1, d.getDate()).getTime(), true);
}

export function addDuration(date: FormulaDate, duration: FormulaDuration, sign = 1): FormulaDate {
  const d = new Date(date.time);
  const day = d.getDate();
  if (duration.months) {
    d.setDate(1); d.setMonth(d.getMonth() + sign * duration.months);
    d.setDate(Math.min(day, monthDays(d.getFullYear(), d.getMonth() + 1)));
  }
  const days = sign * duration.days, whole = Math.trunc(days);
  // Avoid re-resolving an unchanged local clock during the repeated DST hour.
  if (whole) d.setDate(d.getDate() + whole);
  const time = d.getTime() + (days - whole) * DAY + sign * duration.milliseconds;
  return new FormulaDate(time, date.dateOnly && duration.milliseconds === 0 && Number.isInteger(duration.days));
}

/** Calendar months need an anchor and cannot be reduced to a fixed elapsed time. */
export function durationMilliseconds(duration: FormulaDuration): number {
  if (duration.months) throw Error("Calendar months require a date anchor");
  const n = duration.days * DAY + duration.milliseconds;
  if (!Number.isFinite(n)) throw Error("Duration is out of range");
  return n;
}

export function datePart(date: FormulaDate, part: "year" | "month" | "day"): number {
  const d = new Date(date.time);
  return part === "year" ? d.getFullYear() : part === "month" ? d.getMonth() + 1 : d.getDate();
}

/** Reuse Grove's Moment-style formatter, adding fractional seconds/offset/epoch tokens. */
export function formatFormulaDate(date: FormulaDate, pattern: string): string {
  if (pattern.length > 1000) throw Error("Date format is too long");
  const d = new Date(date.time);
  return pattern.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|ZZ|Z|A|a|Q|WW|W|X|x/g, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    if (token === "YYYY") return pad(d.getFullYear(), 4);
    if (token === "SSS") return pad(d.getMilliseconds(), 3);
    if (token === "x") return String(date.time);
    if (token === "X") return String(Math.floor(date.time / 1000));
    if (token === "Z" || token === "ZZ") {
      const n = -d.getTimezoneOffset();
      return `${n < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(n) / 60))}${token === "Z" ? ":" : ""}${pad(Math.abs(n) % 60)}`;
    }
    return formatDate(d, token);
  });
}
