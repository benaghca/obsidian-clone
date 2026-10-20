import { expect, test } from "vitest";
import { dateNamePattern, fillTemplate, formatDate } from "./dateFormat";

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
  expect(iso.regex.test("2026-10-03")).toBe(true);
  expect(iso.regex.test("Meeting 2026-10-03")).toBe(false);
  expect(iso.parse("2026-10-03")).toBe(new Date(2026, 9, 3).getTime());
  const long = dateNamePattern("dddd, MMMM Do YYYY");
  expect(long.parse(formatDate(d, "dddd, MMMM Do YYYY"))).toBe(new Date(2026, 9, 3).getTime());
  expect(long.parse("Saturday, October 3rd")).toBeNull();
  const nested = dateNamePattern("YYYY/MM/YYYY-MM-DD");
  expect(nested.parse("2026/10/2026-10-03")).toBe(new Date(2026, 9, 3).getTime());
});

test("templates fill in title, date and time, with one-off formats", () => {
  const out = fillTemplate("# {{title}}\n{{date}} {{time}} {{date:dddd}} {{ time:HH }} {{other}}", "Plan", d, "YYYY-MM-DD", "HH:mm");
  expect(out).toBe("# Plan\n2026-10-03 14:05 Saturday 14 {{other}}");
});
