import { expect, test } from "vitest";
import { dailyNoteDays, dailyNoteTime, monthGrid, monthTitle, weekdayLabels } from "./calendarGrid";

const cell = (year: number, month: number, day: number, inMonth: boolean) => ({ year, month, day, inMonth });
const inMonth = (rows: { inMonth: boolean }[][]) => rows.flat().filter((c) => c.inMonth).length;

test("weeks start on Monday or Sunday, and every row starts on that day", () => {
  expect(weekdayLabels("monday")).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
  expect(weekdayLabels("sunday")).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
  // 1 January 2023 was a Sunday, so Monday's grid leads with 26 December.
  const monday = monthGrid(2023, 0, "monday");
  const sunday = monthGrid(2023, 0, "sunday");
  expect(monday[0][0]).toEqual(cell(2022, 11, 26, false));
  expect(monday[0][6]).toEqual(cell(2023, 0, 1, true));
  expect(sunday[0][0]).toEqual(cell(2023, 0, 1, true));
  expect(sunday).toHaveLength(5);
  expect(monday).toHaveLength(6);
  for (const row of monday) expect(new Date(row[0].year, row[0].month, row[0].day).getDay()).toBe(1);
  for (const row of sunday) expect(new Date(row[0].year, row[0].month, row[0].day).getDay()).toBe(0);
  expect(monthTitle(2023, 0)).toBe("January 2023");
});

test("a 31-day month that starts at the end of the week is six rows", () => {
  // 1 August 2015 was a Saturday. Both week starts spill into a sixth row.
  for (const weekStart of ["sunday", "monday"] as const) {
    const rows = monthGrid(2015, 7, weekStart);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.length === 7)).toBe(true);
    expect(inMonth(rows)).toBe(31);
    expect(rows[5].some((c) => c.inMonth)).toBe(true);
    expect(rows[5].at(-1)!.month).not.toBe(7);
  }
  const sunday = monthGrid(2015, 7, "sunday");
  const monday = monthGrid(2015, 7, "monday");
  expect(sunday[0][0]).toEqual(cell(2015, 6, 26, false));
  expect(sunday[5][6]).toEqual(cell(2015, 8, 5, false));
  expect(monday[0][0]).toEqual(cell(2015, 6, 27, false));
  expect(monday[5][6]).toEqual(cell(2015, 8, 6, false));
});

test("February keeps the leap day and drops a trailing empty week", () => {
  // 2021-02-01 was a Monday: four exact weeks, no spill.
  const short = monthGrid(2021, 1, "monday");
  expect(short).toHaveLength(4);
  expect(inMonth(short)).toBe(28);
  expect(short[0][0]).toEqual(cell(2021, 1, 1, true));
  expect(short[3][6]).toEqual(cell(2021, 1, 28, true));
  expect(short.flat().some((c) => c.month === 2)).toBe(false);

  const leap = monthGrid(2024, 1, "monday");
  expect(inMonth(leap)).toBe(29);
  expect(leap.flat().some((c) => c.year === 2024 && c.month === 1 && c.day === 29 && c.inMonth)).toBe(true);
  expect(leap.length).toBeLessThan(6);

  const common = monthGrid(2023, 1, "monday");
  expect(inMonth(common)).toBe(28);
  expect(common.flat().some((c) => c.month === 1 && c.day === 29)).toBe(false);

  // 1900 is not a leap year; 2000 is.
  expect(inMonth(monthGrid(1900, 1, "sunday"))).toBe(28);
  expect(inMonth(monthGrid(2000, 1, "sunday"))).toBe(29);
  expect(monthGrid(2000, 1, "sunday").flat().some((c) => c.day === 29 && c.month === 1 && c.inMonth)).toBe(true);
});

test("dots come from daily-note names already in the note list", () => {
  const notes = [
    { path: "Daily/2026-10-19.md" },
    { path: "Daily/2024-02-29.md" },
    { path: "Daily/2026-02-29.md" },
    { path: "Daily/Meeting.md" },
    { path: "Elsewhere/2026-10-19.md" },
    { path: "Daily/2026/10/2026-10-03.md" },
    { path: "2026-10-01.MD" },
  ];
  const iso = dailyNoteDays(notes, "Daily/", "YYYY-MM-DD");
  expect(iso.has(new Date(2026, 9, 19).getTime())).toBe(true);
  expect(iso.has(new Date(2024, 1, 29).getTime())).toBe(true);
  expect(iso.has(new Date(2026, 1, 29).getTime())).toBe(false);
  expect(iso.has(new Date(2026, 9, 1).getTime())).toBe(false);
  expect(iso.size).toBe(2);

  const nested = dailyNoteDays(notes, "Daily", "YYYY/MM/YYYY-MM-DD");
  expect([...nested]).toEqual([new Date(2026, 9, 3).getTime()]);

  const root = dailyNoteDays(notes, "", "YYYY-MM-DD");
  expect(root.has(new Date(2026, 9, 1).getTime())).toBe(true);
  expect(root.has(new Date(2026, 9, 19).getTime())).toBe(false);

  expect(dailyNoteTime("Daily/2026-10-19.md", "Daily", "YYYY-MM-DD")).toBe(new Date(2026, 9, 19).getTime());
  expect(dailyNoteTime("Welcome.md", "Daily", "YYYY-MM-DD")).toBeNull();
  expect(dailyNoteTime(null, "Daily", "YYYY-MM-DD")).toBeNull();
});
