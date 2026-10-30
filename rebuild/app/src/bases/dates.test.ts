import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { addDuration, datePart, durationMilliseconds, formatFormulaDate, FormulaDate, FormulaDuration, parseDate, parseDuration, today } from "./dates";
beforeEach(() => vi.stubEnv("TZ", "UTC"));
afterEach(() => vi.unstubAllEnvs());
describe("ISO dates", () => {
  it.each(["2024-02-29", "0000-02-29", "9999-12-31"])("preserves date-only %s", input => {
    const date = parseDate(input)!;
    expect(date).toBeInstanceOf(FormulaDate);
    expect(date.dateOnly).toBe(true); expect(String(date)).toBe(input);
    expect(parseDate(date)).toBe(date);
  });
  it.each([
    ["2024-02-29T12:34", "2024-02-29T12:34:00.000Z"],
    ["2024-02-29 12:34:56.1", "2024-02-29T12:34:56.100Z"],
    ["2024-02-29T12:34:56.123Z", "2024-02-29T12:34:56.123Z"],
    ["2024-02-29T12:34:56+02:30", "2024-02-29T10:04:56.000Z"],
    ["2024-02-29T12:34:56-0230", "2024-02-29T15:04:56.000Z"],
  ])("parses %s as an instant", (input, expected) => expect(String(parseDate(input))).toBe(expected));
  it.each(["", "today", "2023-02-29", "2024-02-30", "2024-13-01", "2024-00-01", "2024-01-00", "2024-04-31", "2024-01-01x", "2024-01-01T24:00", "2024-01-01T12:60", "2024-01-01T12:00:60", "2024-01-01T12:00:00+24:00", "2024-01-01T12:00:00+00:60", "2024-01-01T12:00:00.1234Z"])("rejects invalid date %s", input => expect(parseDate(input)).toBeNull());
  it("bounds timestamps, truncates fractional milliseconds, and never leaks mutable Date state", () => {
    expect(parseDate(0)?.time).toBe(0); expect(parseDate(1.9)?.time).toBe(1);
    expect(parseDate(Infinity)).toBeNull(); expect(parseDate(NaN)).toBeNull(); expect(parseDate(8.64e15 + 1)).toBeNull();
    expect(() => new FormulaDate(NaN)).toThrow(); expect(Object.isFrozen(parseDate(0))).toBe(true);
  });
});

describe("duration units", () => {
  it.each([
    ["1ms", 0, 0, 1], ["2 milliseconds", 0, 0, 2], ["1s", 0, 0, 1000], ["2sec", 0, 0, 2000], ["1 second", 0, 0, 1000],
    ["1m", 0, 0, 60000], ["2 mins", 0, 0, 120000], ["1minute", 0, 0, 60000], ["1h", 0, 0, 3600000], ["2 hrs", 0, 0, 7200000], ["1 hour", 0, 0, 3600000],
    ["1d", 0, 1, 0], ["2 days", 0, 2, 0], ["1w", 0, 7, 0], ["2 wks", 0, 14, 0], ["1week", 0, 7, 0],
    ["1mo", 1, 0, 0], ["1M", 1, 0, 0], ["2 months", 2, 0, 0], ["1q", 3, 0, 0], ["2 quarters", 6, 0, 0], ["1y", 12, 0, 0], ["2 yrs", 24, 0, 0], ["1 year", 12, 0, 0],
    ["1h30m", 0, 0, 5400000], ["1 week, 2 days 3h", 0, 9, 10800000], ["-1d +2h", 0, -1, 7200000], [".5y", 6, 0, 0], ["1.5d", 0, 1.5, 0], ["0ms", 0, 0, 0],
  ])("%s", (input, months, days, ms) => expect(parseDuration(input as string)).toEqual(new FormulaDuration(months as number, days as number, ms as number)));
  it.each(["", "7", "1 month x", "1month,", "1h,,2m", "1h, ,2m", "1.5months", "1x", "NaNd", "Infinityh", "1..5d", "999999999999999999999years"])("rejects %s", input => expect(parseDuration(input)).toBeNull());
  it("converts only fixed durations and rejects overflowing or fractional calendar months", () => {
    expect(durationMilliseconds(parseDuration("1d 2h")!)).toBe(93600000);
    expect(() => durationMilliseconds(parseDuration("1mo")!)).toThrow(/anchor/);
    expect(() => new FormulaDuration(.5, 0, 0)).toThrow();
    expect(parseDuration(Infinity)).toBeNull();
    const d = parseDuration("2d")!; expect(parseDuration(d)).toBe(d);
    expect(String(new FormulaDuration(0, 0, 0))).toBe("0ms");
  });
});

describe("calendar and elapsed arithmetic", () => {
  it.each([
    ["2024-01-31", "1mo", 1, "2024-02-29"], ["2023-01-31", "1mo", 1, "2023-02-28"],
    ["2024-03-31", "1mo", -1, "2024-02-29"], ["2024-02-29", "1y", 1, "2025-02-28"],
    ["2024-12-31", "1d", 1, "2025-01-01"], ["2024-03-01", "1d", -1, "2024-02-29"],
    ["2024-01-31", "2mo", 1, "2024-03-31"],
  ])("%s ± %s", (input, amount, sign, expected) => expect(String(addDuration(parseDate(input as string)!, parseDuration(amount as string)!, sign as number))).toBe(expected));
  it.each(["America/Los_Angeles", "Europe/Berlin"])("calendar days span DST in %s", zone => {
    vi.stubEnv("TZ", zone);
    const spring = zone === "America/Los_Angeles" ? "2024-03-09T12:00" : "2024-03-30T12:00";
    const fall = zone === "America/Los_Angeles" ? "2024-11-02T12:00" : "2024-10-26T12:00";
    for (const [text, hours] of [[spring, 23], [fall, 25]] as const) {
      const base = parseDate(text)!, day = addDuration(base, parseDuration("1d")!), elapsed = addDuration(base, parseDuration("24h")!);
      expect((day.time - base.time) / 3600000).toBe(hours);
      expect(formatFormulaDate(day, "HH:mm")).toBe("12:00");
      expect(elapsed.time - base.time).toBe(86400000);
      expect(formatFormulaDate(elapsed, "HH:mm")).toBe(hours === 23 ? "13:00" : "11:00");
    }
  });
  it("uses local today, rejects nonexistent input clock times, and normalizes arithmetic through a DST gap", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(String(today(Date.UTC(2024, 0, 1, 2)))).toBe("2023-12-31");
    expect(parseDate("2024-03-10T02:30")).toBeNull();
    const day = addDuration(parseDate("2024-03-09T02:30")!, parseDuration("1d")!);
    expect(formatFormulaDate(day, "HH:mm")).toBe("03:30");
  });
  it("keeps operands immutable and validates range overflow", () => {
    const base = parseDate("2024-01-31")!, duration = parseDuration("1mo")!;
    addDuration(base, duration); expect(String(base)).toBe("2024-01-31"); expect(duration.months).toBe(1);
    expect(() => addDuration(new FormulaDate(8.64e15), parseDuration("1d")!)).toThrow(/range/);
  });
  it("preserves the second occurrence of a repeated DST hour for elapsed arithmetic", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const second = parseDate("2024-11-03T01:30:00-08:00")!;
    expect(addDuration(second, parseDuration("0ms")!).time).toBe(second.time);
    expect(addDuration(second, parseDuration("1h")!).time - second.time).toBe(3600000);
  });
});

describe("date fields and formatting", () => {
  it("formats common Moment tokens, literals, fractions, timezone and epoch", () => {
    const d = parseDate("2024-02-29T13:04:05.006Z")!;
    expect([datePart(d, "year"), datePart(d, "month"), datePart(d, "day")]).toEqual([2024, 2, 29]);
    expect(formatFormulaDate(d, "YYYY-MM-DD HH:mm:ss.SSS Z ZZ")).toBe("2024-02-29 13:04:05.006 +00:00 +0000");
    expect(formatFormulaDate(d, "[YYYY SSS Z] YY MMM D h A Q")).toBe("YYYY SSS Z 24 Feb 29 1 PM 1");
    expect(formatFormulaDate(d, "X x")).toBe(`${Math.floor(d.time / 1000)} ${d.time}`);
    expect(() => formatFormulaDate(d, "x".repeat(1001))).toThrow(/too long/);
  });
});
