import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { compileFormula, expression, FormulaDate, FormulaDuration, FormulaError, FormulaLink, isFormulaError, type Context, type Value } from "./expression";
const time = Date.UTC(2024, 0, 31, 12, 34, 56, 123);
const data = new Map<string, Value>([["title", "  Mixed Case  "], ["tags", ["work/project", "later"]], ["empty", ""], ["file.name", "Task"], ["file.path", "Tasks/Task.md"], ["file.folder", "Tasks"], ["file.mtime", "2024-01-31T12:34:56.123Z"], ["file.links", ["Other.md"]], ["file.properties", ["title", "empty"]]]);
const ctx: Context = { get: key => data.get(key) ?? null, now: () => time, hasTag: tag => tag.replace(/^#/, "") === "work", hasLink: link => link === "Other.md", hasProperty: key => ["title", "empty", "nullProperty"].includes(key) };
const run = (s: string, c = ctx) => expression(s)(c);
beforeEach(() => vi.stubEnv("TZ", "UTC"));
afterEach(() => vi.unstubAllEnvs());

describe("global functions", () => {
  it.each([
    ["date", "date('2024-02-29').format('YYYY/MM/DD')", "2024/02/29"],
    ["date timestamp", "date(0).format('YYYY-MM-DD HH:mm:ss')", "1970-01-01 00:00:00"],
    ["date empty", "date(null)", null], ["duration empty", "duration(null)", null],
    ["if", "if(1 < 2, 'yes', 'no')", "yes"], ["if false", "if(null, 1, 2)", 2],
    ["list", "list(1, 'two', false, null)", [1, "two", false, null]], ["list empty", "list()", []], ["list nested", "list(list(1), 2)", [[1], 2]],
    ["number text", "number('  -12.5e2  ')", -1250], ["number number", "number(12.5)", 12.5],
    ["number true", "number(true)", 1], ["number false", "number(false)", 0], ["number null", "number(null)", null], ["number empty", "number('  ')", null],
    ["min variadic", "min(4, -2, 1)", -2], ["min list", "min(list(null, 4, 2))", 2], ["min empty list", "min(list())", null], ["min empty", "min()", null],
    ["max variadic", "max(4, -2, 1)", 4], ["max list", "max(list(4, null, 2))", 4], ["max empty list", "max(list())", null], ["max empty", "max()", null],
    ["contains text", "contains('abc', 'b')", true], ["contains text number", "contains('123', 2)", true], ["contains list", "contains(list(1,2), 2)", true], ["contains missing", "contains(null, 2)", false],
    ["number duration", "number(duration('1d 2h'))", 93_600_000], ["link empty", "link(null)", null],
  ])("%s", (_name, source, expected) => expect(run(source as string)).toEqual(expected));
  it("now/today use one sampled clock per expression and return immutable dates", () => {
    expect(run("now()")).toEqual(new FormulaDate(time));
    expect(run("today()")).toEqual(new FormulaDate(Date.UTC(2024, 0, 31), true));
    let calls = 0;
    expect(run("now() == now()", { ...ctx, now: () => time + calls++ })).toBe(true);
    expect(calls).toBe(1);
    expect(Object.isFrozen(run("today()"))).toBe(true);
  });
  it("duration and link values keep metadata without exposing JS objects", () => {
    expect(run("duration('2mo 3d 4ms')")).toEqual(new FormulaDuration(2, 3, 4));
    expect(run("duration(123)")).toEqual(new FormulaDuration(0, 0, 123));
    expect(String(run("duration('0d')"))).toBe("0ms");
    expect(run("link('Other.md', 'Other')")).toEqual(new FormulaLink("Other.md", "Other"));
    expect(String(run("link('Other.md')"))).toBe("[[Other.md]]");
    expect(run("link(file)")).toEqual(new FormulaLink("Tasks/Task.md"));
    expect(run("link(link('Other.md', 'Old'), 'New')")).toEqual(new FormulaLink("Other.md", "New"));
    expect(run("link('Other.md') == link('Other.md', 'Label')")).toBe(true);
  });
});

describe("methods and value properties", () => {
  it.each([
    ["text contains", "title.contains('Mixed')", true], ["text startsWith", "'abc'.startsWith('a')", true], ["text endsWith", "'abc'.endsWith('z')", false],
    ["text lower", "'ÄBC'.lower()", "äbc"], ["text upper", "'straße'.upper()", "STRASSE"], ["text trim", "title.trim()", "Mixed Case"],
    ["text length", "'😀a'.length", 3], ["empty length", "''.length", 0], ["null length", "null.length", null],
    ["list contains", "list(1,2).contains(2)", true], ["list deep contains", "list(list(1,2)).contains(list(1,2))", true], ["list missing item", "list(1).contains(2)", false], ["list membership stays typed", "list(null).contains('')", false], ["empty member differs from null", "list('').contains(null)", false],
    ["list length", "list(1,2,3).length", 3], ["list join", "list('a','b',null).join('|')", "a|b|"], ["list join default", "list(1,2).join()", "1, 2"],
    ["list join empty", "list().join()", ""], ["list isEmpty", "list().isEmpty()", true], ["list filled", "list(1).isEmpty()", false], ["null isEmpty", "null.isEmpty()", true], ["text isEmpty", "''.isEmpty()", true],
    ["date year", "date('2024-02-29').year", 2024], ["date month", "date('2024-02-29').month", 2], ["date day", "date('2024-02-29').day", 29],
    ["date string part", "file.mtime.year", 2024], ["date format", "date('2024-02-29').format('dddd, MMMM Do YYYY')", "Thursday, February 29th 2024"],
    ["date null part", "date(null).year", null], ["date null format", "date(null).format('YYYY')", null],
    ["number round", "2.6.round()", 3], ["number negative round", "(-2.5).round()", -2], ["number decimal round", "1.005.round(2)", 1.01], ["number tens round", "123.round(-1)", 120],
    ["number huge round", "1e308.round(100)", 1e308], ["number toFixed", "1.25.toFixed(1)", "1.3"], ["number toFixed zeros", "2.toFixed(3)", "2.000"], ["number toFixed default", "1.9.toFixed()", "2"],
    ["null method", "null.round()", null], ["null text method", "null.trim()", null],
  ])("%s", (_name, source, expected) => expect(run(source as string)).toEqual(expected));
});

describe("duration order", () => {
  it.each([
    ['duration("1 month") > duration("1 day")', true],
    ['duration("1 month") > duration("40d")', false],
    ['duration("1 year") > duration("11M")', true],
    ['duration("1 month") == duration("30d")', false],
    ['(now() - "2024-01-01") > "1 week"', true],
    ['(now() - "2024-01-30") < "2d"', true],
    ['"1 week" > now() - "2024-01-30"', true],
    ['duration("1d") > "soon"', false],
  ])("%s", (source, expected) => expect(run(source)).toBe(expected));
});

describe("file functions", () => {
  it.each([
    ["hasTag", "file.hasTag('work')", true], ["hasTag hash", "file.hasTag('#work')", true], ["hasTag missing", "file.hasTag('absent')", false],
    ["hasLink", "file.hasLink('Other.md')", true], ["hasLink typed", "file.hasLink(link('Other.md'))", true], ["hasLink missing", "file.hasLink('Missing.md')", false],
    ["inFolder", "file.inFolder('/Tasks/')", true], ["inFolder root", "file.inFolder('')", true], ["inFolder boundary", "file.inFolder('Task')", false],
    ["hasProperty", "file.hasProperty('title')", true], ["hasProperty empty", "file.hasProperty('empty')", true], ["hasProperty null", "file.hasProperty('nullProperty')", true],
    ["hasProperty prefix", "file.hasProperty('note.title')", true], ["hasProperty absent", "file.hasProperty('missing')", false],
    ["file links fact", "file.links.contains('Other.md')", true], ["file properties fact", "file.properties.length", 2],
  ])("%s", (_name, source, expected) => expect(run(source as string)).toEqual(expected));
  it("provides asLink with optional display text and an existence fallback for older callers", () => {
    expect(run("file.asLink()")).toEqual(new FormulaLink("Tasks/Task.md"));
    expect(run("file.asLink('Label')")).toEqual(new FormulaLink("Tasks/Task.md", "Label"));
    const legacy = { ...ctx, hasProperty: undefined };
    expect(run("file.hasProperty('empty')", legacy)).toBe(true);
    expect(run("file.hasProperty('missing')", legacy)).toBe(false);
  });
});

describe("every call validates arity and types", () => {
  it.each(["date()", "date(1,2)", "now(1)", "today(1)", "duration()", "duration(1,2)", "if(1,2)", "number()", "number(1,2)", "link()", "link('x','y','z')", "contains(1)", "contains(1,2,3)", "'x'.contains()", "'x'.contains('x','y')", "'x'.startsWith()", "'x'.endsWith()", "'x'.lower(1)", "'x'.upper(1)", "'x'.trim(1)", "list().join(1,2)", "list().isEmpty(1)", "date(null).format()", "1.round(1,2)", "1.toFixed(1,2)", "file.hasTag()", "file.hasLink()", "file.inFolder()", "file.hasProperty()", "file.asLink('x','y')"])("rejects arity: %s", source => expect(() => expression(source)).toThrow(FormulaError));
  it.each(["date('2023-02-29')", "date('tomorrow')", "date(true)", "duration('oops')", "duration(true)", "number('abc')", "number('Infinity')", "number(list(1))", "number(duration('1month'))", "link(12)", "link('x', 1)", "min('1')", "max(list(1,'2'))", "1.contains(2)", "1.startsWith('a')", "'a'.startsWith(1)", "1.endsWith('a')", "1.lower()", "1.upper()", "1.trim()", "'a'.join()", "list(1).join(1)", "1.format('YYYY')", "1.round(1.2)", "1.round(-101)", "1.toFixed(-1)", "1.toFixed(101)", "file.hasTag(1)", "file.hasLink(1)", "file.inFolder(1)", "file.hasProperty(1)", "file.asLink(1)", "file.trim()"])("returns a typed error: %s", source => {
    const value = compileFormula(source)(ctx);
    expect(isFormulaError(value)).toBe(true);
    expect((value as FormulaError).message.length).toBeGreaterThan(0);
  });
});
