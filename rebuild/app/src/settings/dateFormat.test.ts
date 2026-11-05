import { expect, test } from "vitest";
import { adjacentDailyNote, dailyNoteList, dailyNotePath, dateNamePattern, existingDailyNote, fillTemplate, formatDate } from "./dateFormat";

const d = new Date(2026, 9, 3, 14, 5, 9); // Saturday 3 October 2026, 14:05:09

test("Moment-style tokens, as Obsidian's daily notes and templates use them", () => {
  expect(formatDate(d, "YYYY-MM-DD")).toBe("2026-10-03");
  expect(formatDate(d, "HH:mm")).toBe("14:05");
  expect(formatDate(d, "dddd, MMMM Do YYYY")).toBe("Saturday, October 3rd 2026");
  expect(formatDate(d, "ddd D MMM YY h:mm A")).toBe("Sat 3 Oct 26 2:05 PM");
  expect(formatDate(d, "[Week] W [of] YYYY")).toBe("Week 40 of 2026");
  expect(formatDate(d, "YYYY/MM/YYYY-MM-DD")).toBe("2026/10/2026-10-03");
});

test("daily note names are recognised and ordered by their format", () => {
  const iso = dateNamePattern("YYYY-MM-DD");
  expect(iso.parse("Meeting 2026-10-03")).toBeNull();
  expect(iso.parse("2026-10-03")).toBe(new Date(2026, 9, 3).getTime());
  const long = dateNamePattern("dddd, MMMM Do YYYY");
  expect(long.parse(formatDate(d, "dddd, MMMM Do YYYY"))).toBe(new Date(2026, 9, 3).getTime());
  expect(long.parse("Saturday, October 3rd")).toBeNull();
  const nested = dateNamePattern("YYYY/MM/YYYY-MM-DD");
  expect(nested.parse("2026/10/2026-10-03")).toBe(new Date(2026, 9, 3).getTime());
});

test("impossible daily note dates are rejected instead of rolling forward", () => {
  const iso = dateNamePattern("YYYY-MM-DD");
  expect(iso.parse("2026-02-29")).toBeNull();
  expect(iso.parse("2026-03-01")).toBe(new Date(2026, 2, 1).getTime());
  expect(iso.parse("2026-13-40")).toBeNull();
  expect(iso.parse("2026-00-10")).toBeNull();
  expect(iso.parse("2026-04-31")).toBeNull();
  expect(iso.parse("2024-02-29")).toBe(new Date(2024, 1, 29).getTime());
  expect(iso.parse("1900-02-29")).toBeNull();
  expect(iso.parse("2000-02-29")).toBe(new Date(2000, 1, 29).getTime());
  const written = dateNamePattern("MMMM D YYYY");
  expect(written.parse("February 29 2026")).toBeNull();
  expect(written.parse("February 29 2024")).toBe(new Date(2024, 1, 29).getTime());
  expect(dateNamePattern("YYYYMMDD").parse("20260229")).toBeNull();
  expect(dateNamePattern("YYYYMMDD").parse("20240229")).toBe(new Date(2024, 1, 29).getTime());
});

test("templates fill in title, date and time, with one-off formats", () => {
  const out = fillTemplate("# {{title}}\n{{date}} {{time}} {{date:dddd}} {{ time:HH }} {{other}}", "Plan", d, "YYYY-MM-DD", "HH:mm");
  expect(out).toBe("# Plan\n2026-10-03 14:05 Saturday 14 {{other}}");
});

test("week-years around New Year: GGGG with ISO weeks, gggg with Sunday-first weeks", () => {
  const at = (y: number, m: number, day: number) => new Date(y, m - 1, day);
  const iso = "GGGG-[W]WW";
  const local = "gggg-[w]ww";
  // Thursday 31 December 2026: ISO week 53 of 2026; its Sunday-first week holds 1 January, so week 1 of 2027.
  expect(formatDate(at(2026, 12, 31), iso)).toBe("2026-W53");
  expect(formatDate(at(2026, 12, 31), local)).toBe("2027-w01");
  // Friday 1 January 2027 is still in ISO 2026.
  expect(formatDate(at(2027, 1, 1), iso)).toBe("2026-W53");
  expect(formatDate(at(2027, 1, 1), `${local} YYYY`)).toBe("2027-w01 2027");
  expect(formatDate(at(2027, 1, 3), iso)).toBe("2026-W53");
  expect(formatDate(at(2027, 1, 3), local)).toBe("2027-w02");
  expect(formatDate(at(2027, 1, 4), iso)).toBe("2027-W01");
  // Monday 30 December 2024 is ISO week 1 of 2025.
  expect(formatDate(at(2024, 12, 30), `${iso} YYYY`)).toBe("2025-W01 2024");
  expect(formatDate(at(2024, 12, 28), local)).toBe("2024-w52");
  expect(formatDate(at(2024, 12, 29), local)).toBe("2025-w01");
  // Saturday 1 January 2022: ISO week 52 of 2021, Sunday-first week 1 of 2022; Sunday 2 January starts week 2.
  expect(formatDate(at(2022, 1, 1), iso)).toBe("2021-W52");
  expect(formatDate(at(2022, 1, 1), local)).toBe("2022-w01");
  expect(formatDate(at(2022, 1, 2), local)).toBe("2022-w02");
  expect(formatDate(at(2020, 12, 27), "gg w GG W")).toBe("21 1 20 52");
  expect(formatDate(at(2021, 1, 1), iso)).toBe("2020-W53");
  // Every day of 2020-2028: the ISO year is the calendar year except within three days of New Year.
  for (let t = at(2020, 1, 1); t.getFullYear() < 2029; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    const [g, w] = formatDate(t, "GGGG W").split(" ").map(Number);
    const near = (t.getMonth() === 0 && t.getDate() <= 3) || (t.getMonth() === 11 && t.getDate() >= 29);
    if (!near) expect(g).toBe(t.getFullYear());
    expect(Math.abs(g - t.getFullYear())).toBeLessThanOrEqual(1);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(w).toBeLessThanOrEqual(53);
    const thursday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) + 3);
    expect(g).toBe(thursday.getFullYear());
  }
});

test("a name is a day's only when every date part in it agrees", () => {
  const nested = dateNamePattern("YYYY/MM/YYYY-MM-DD");
  expect(nested.parse("2026/09/2026-10-03")).toBeNull();
  expect(nested.parse("2025/10/2026-10-03")).toBeNull();
  const named = dateNamePattern("dddd YYYY-MM-DD");
  expect(named.parse("Saturday 2026-10-03")).toBe(new Date(2026, 9, 3).getTime());
  expect(named.parse("Monday 2026-10-03")).toBeNull();
  const weekly = dateNamePattern("GGGG/[W]WW/YYYY-MM-DD");
  expect(weekly.parse("2026/W53/2027-01-01")).toBe(new Date(2027, 0, 1).getTime());
  expect(weekly.parse("2027/W53/2027-01-01")).toBeNull();
  expect(weekly.parse("2026/W52/2027-01-01")).toBeNull();
  // A time of day in the format does not have to match the day.
  expect(dateNamePattern("YYYY-MM-DD HHmm").parse("2026-10-03 0915")).toBe(new Date(2026, 9, 3).getTime());
});

test("daily notes in folders from the date format round-trip through their path", () => {
  const daily = { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" };
  expect(dailyNotePath(new Date(2026, 9, 3, 14), daily)).toBe("Journal/2026/10/2026-10-03.md");
  expect(dailyNotePath(new Date(2026, 9, 3), { folder: "/Journal/", format: "/YYYY//MM/DD/" })).toBe("Journal/2026/10/03.md");
  // An empty escape is not a folder: the note that was written is the note that is read back.
  expect(dailyNotePath(new Date(2026, 9, 3), { folder: "", format: "YYYY/[]/MM-DD" })).toBe("2026/10-03.md");
  expect(dailyNoteList(["2026/10-03.md"], { folder: "", format: "YYYY/[]/MM-DD" }).map((n) => n.time)).toEqual([new Date(2026, 9, 3).getTime()]);
  expect(dailyNotePath(new Date(2026, 9, 3), { folder: "", format: "" })).toBe("2026-10-03.md");
  for (const format of ["YYYY/MM/YYYY-MM-DD", "YYYY/MMMM/Do dddd", "GGGG/[W]WW/YYYY-MM-DD", "gggg/ww/ddd D MMM YYYY", "YYYY//MM/DD"]) {
    const days: Date[] = [];
    for (let t = new Date(2024, 11, 20); t < new Date(2025, 0, 12); t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) days.push(t);
    const paths = days.map((t) => dailyNotePath(t, { folder: "Journal", format }));
    expect(new Set(paths).size).toBe(days.length);
    const list = dailyNoteList([...paths].reverse(), { folder: "Journal", format });
    expect(list.map((n) => n.time), format).toEqual(days.map((t) => t.getTime()));
    expect(list.map((n) => n.path)).toEqual(paths);
  }
});

test("a leading zero still names the day when the format writes none", () => {
  const oct3 = new Date(2026, 9, 3);
  const sep3 = new Date(2026, 8, 3);
  const jan4 = new Date(2027, 0, 4);
  // Grove keeps writing the short form.
  expect(formatDate(oct3, "YYYY-MM-D")).toBe("2026-10-3");
  expect(formatDate(sep3, "YYYY-M-DD")).toBe("2026-9-03");
  expect(formatDate(jan4, "GGGG-[W]W")).toBe("2027-W1");
  expect(dailyNotePath(oct3, { folder: "Journal", format: "YYYY-MM-D" })).toBe("Journal/2026-10-3.md");
  // Moment accepts "03" for D and "09" for M, and "W01" for W. A vault that already has those names still has that day.
  const day = dateNamePattern("YYYY-MM-D");
  expect(day.parse("2026-10-03")).toBe(oct3.getTime());
  expect(day.parse("2026-10-3")).toBe(oct3.getTime());
  expect(dateNamePattern("YYYY-M-DD").parse("2026-09-03")).toBe(sep3.getTime());
  expect(dateNamePattern("GGGG/[W]W/YYYY-MM-DD").parse("2027/W01/2027-01-04")).toBe(jan4.getTime());
  expect(dateNamePattern("dddd D MMMM YYYY").parse("Saturday 03 October 2026")).toBe(oct3.getTime());
  // A padded and an unpadded repeat of the same month are the same month. A different month is not.
  expect(dateNamePattern("YYYY/M/YYYY-M-D").parse("2026/09/2026-9-03")).toBe(sep3.getTime());
  expect(dateNamePattern("YYYY/M/YYYY-M-D").parse("2026/9/2026-09-03")).toBe(sep3.getTime());
  expect(dateNamePattern("YYYY/M/YYYY-M-D").parse("2026/09/2026-10-03")).toBeNull();
  // DD still wants two digits, and a disagreed folder is still not that day.
  expect(dateNamePattern("YYYY-MM-DD").parse("2026-10-3")).toBeNull();
  expect(dateNamePattern("YYYY/MM/YYYY-MM-DD").parse("2026/09/2026-10-03")).toBeNull();
  expect(dateNamePattern("GGGG/[W]W/YYYY-MM-DD").parse("2027/W02/2027-01-04")).toBeNull();
  const daily = { folder: "", format: "YYYY-MM-D" };
  const list = dailyNoteList(["2026-10-4.md", "2026-10-03.md", "2026-10-30.md"], daily);
  expect(list.map((n) => n.path)).toEqual(["2026-10-03.md", "2026-10-4.md", "2026-10-30.md"]);
  expect(adjacentDailyNote(list, "2026-10-4.md", -1)).toBe("2026-10-03.md");
  // Open today's note finds the padded file and does not need a second, short-named one.
  expect(existingDailyNote(["Journal/2026-10-03.md", "Journal/2026-10-4.md"], new Date(2026, 9, 3, 14, 5), { folder: "Journal", format: "YYYY-MM-D" })).toBe("Journal/2026-10-03.md");
  expect(existingDailyNote(["Journal/2026-10-03.md", "Journal/2026-10-3.md"], oct3, { folder: "Journal", format: "YYYY-MM-D" })).toBe("Journal/2026-10-3.md");
  expect(existingDailyNote(["Journal/2026-10-4.md"], oct3, { folder: "Journal", format: "YYYY-MM-D" })).toBeNull();
});

test("previous and next daily note cross month and year folders", () => {
  const daily = { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" };
  const paths = [
    "Journal/2027/01/2027-01-01.md",
    "Journal/2026/12/2026-12-31.md",
    "Journal/2026/11/2026-11-30.md",
    "Journal/2026/09/2026-10-03.md", // the wrong month folder: not a daily note
    "Journal/2026/12/Plan.md",
    "Journal/2026-12-15.md", // not in the format's folders
    "Other/2026/12/2026-12-20.md", // not in the daily notes folder
    "Journal/2026/12/2026-12-25.canvas",
  ];
  const list = dailyNoteList(paths, daily);
  expect(list.map((n) => n.path)).toEqual([
    "Journal/2026/11/2026-11-30.md",
    "Journal/2026/12/2026-12-31.md",
    "Journal/2027/01/2027-01-01.md",
  ]);
  expect(adjacentDailyNote(list, "Journal/2026/12/2026-12-31.md", -1)).toBe("Journal/2026/11/2026-11-30.md");
  expect(adjacentDailyNote(list, "Journal/2026/12/2026-12-31.md", 1)).toBe("Journal/2027/01/2027-01-01.md");
  expect(adjacentDailyNote(list, "Journal/2026/11/2026-11-30.md", -1)).toBeNull();
  expect(adjacentDailyNote(list, "Journal/2027/01/2027-01-01.md", 1)).toBeNull();
  expect(adjacentDailyNote(list, "Journal/2026/12/Plan.md", 1)).toBeNull();
  expect(adjacentDailyNote(list, null, 1)).toBeNull();
  // The same notes with no daily notes folder: the format's own folders are enough.
  const top = paths.map((p) => p.replace(/^Journal\//, ""));
  expect(adjacentDailyNote(dailyNoteList(top, { folder: "", format: daily.format }), "2026/12/2026-12-31.md", 1)).toBe("2027/01/2027-01-01.md");
});
