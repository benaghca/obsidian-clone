import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileFormula, expression, FormulaError, FormulaFile, FormulaLink, isFormulaError, testExpression, type Context, type Value } from "./expression";

beforeEach(() => vi.stubEnv("TZ", "UTC"));
afterEach(() => vi.unstubAllEnvs());
const values = new Map<string, Value>([["a", 3], ["b", 2], ["title", " Hello "], ["tags", ["x", "y"]], ["file.path", "Notes/A.md"], ["file.folder", "Notes"], ["file.name", "A"], ["note.My key", "spaced"], ["note.constructor", "literal"], ["formula.score", 7]]);
const context: Context = { get: key => values.get(key) ?? null, hasTag: tag => tag === "x", hasLink: link => link === "B.md", now: () => 1_700_000_000_000 };
const run = (s: string, c = context) => expression(s)(c);

describe("operator precedence and left associativity", () => {
  it.each([
    ["1 + 2 * 3", 7], ["(1 + 2) * 3", 9], ["12 / 3 * 2", 8], ["10 - 3 - 2", 5], ["10 - (3 - 2)", 9],
    ["10 % 4 + 2", 4], ["-5 % 2", -1], ["5 / 2", 2.5], ["+.5 + 1e2", 100.5], ["-a * -b", 6],
    ["2 + 3 > 4 == true", true], ["!false && false || true", true], ["true || false && false", true],
    ["1 < 2 && 3 >= 3", true], ["1 <= 1 && 4 > 3", true], ["1 != 2 && 2 == 2", true], ["1 == 2", false],
    ["'a' + 2 + 3", "a23"], ["2 + 3 + 'a'", "5a"], ["'a' + true", "atrue"], ["'a' + null", "a"],
    ["null + 1", null], ["null - 1", null], ["null * 1", null], ["null / 2", null], ["null % 2", null],
    ["-null", null], ["+null", null], ["!null", true], ["missing > 2", false], ["1 < 'x'", false],
    ["null == ''", true], ["list() == null", true], ["false == null", false], ["0 == ''", false],
    ["list(1, list(2)) == list(1, list(2))", true], ["list(1, 2) != list(2, 1)", true], ["!list()", false],
    ["-2.5.round()", -3], ["(-2.5).round()", -2], ["(title.trim() + '!').upper()", "HELLO!"],
  ])("%s → %s", (source, expected) => expect(run(source as string)).toEqual(expected));
});

describe("properties and host this context", () => {
  it.each([["a", 3], ["note['My key']", "spaced"], ["note.constructor", "literal"], ["formula.score", 7], ["file.name", "A"], ["file.path", "Notes/A.md"], ["missing", null], ["this.file.name", null], ["this.title", null], ["this.file.asLink()", null]])("reads %s", (source, expected) => expect(run(source as string)).toEqual(expected));
  it("routes this properties, file methods and quoted keys only through the supplied host", () => {
    const host: Context = { ...context, get: key => new Map<string, Value>([["title", "Host"], ["note.My key", "host key"], ["file.name", "Host"], ["file.path", "Host.md"]]).get(key) ?? null, hasTag: t => t === "host", hasProperty: key => key === "empty" };
    const c = { ...context, this: host };
    expect(run("this.title + ':' + this.file.name", c)).toBe("Host:Host");
    expect(run("this.note['My key']", c)).toBe("host key");
    expect(run("this.file.hasTag('host')", c)).toBe(true);
    expect(run("this.file.hasProperty('empty')", c)).toBe(true);
    expect(run("this.file.asLink('Home')", c)).toEqual(new FormulaLink("Host.md", "Home"));
    expect(run("file == file", c)).toBe(true);
    expect(run("this == file", c)).toBe(false);
    expect(run("this", c)).toBeInstanceOf(FormulaFile);
  });
  it("reports getter dependencies without evaluating data or starting reads", () => {
    const f = expression("if(this.file.hasProperty('x'), note.x + this.note.y, file.hasLink('A'))");
    expect(f.dependencies).toEqual(["this.file.properties", "note.x", "this.note.y", "file.links"]);
    expect(f.usesThis).toBe(true);
    expect(Object.isFrozen(f.dependencies)).toBe(true);
    expect(expression("file.name").usesThis).toBe(false);
  });
  it("does not capture this at compile time", () => {
    const f = expression("this.file.name");
    expect(f(context)).toBeNull();
    expect(f({ ...context, this: context })).toBe("A");
  });
});

describe("errors and short circuiting", () => {
  it.each(["unknown()", "true || unknown()", "if(false, unknown(), 1)", "a.constructor()", "file.unknown", "title.__proto__", "note['x'][0]", "file['constructor']", "window.location", "eval('1')", "(()=>1)()", "1;2", "a = 1", "1 === 1", "if(true, 1)", "1 2", "", "'unclosed", '"bad\\q"', "'\\uZZZZ'", "'line\nbreak'"])("rejects %s during parsing", source => {
    expect(() => expression(source)).toThrow(FormulaError);
    const f = compileFormula(source);
    expect(f.error).toBeInstanceOf(FormulaError);
    expect(f.error?.phase).toBe("parse");
    expect(f(context)).toBe(f.error);
    expect(String(f(context))).toMatch(/^#ERROR: /);
    expect(testExpression(f, context)).toBe(false);
  });
  it.each(["1 / 0", "1 % 0", "-true", "+'1'", "2 * 'x'", "1.year", "true.length", "1e308 * 10", "true.lower()"])("returns an evaluation error for %s", source => {
    const value = run(source);
    expect(isFormulaError(value)).toBe(true);
    expect((value as FormulaError).phase).toBe("evaluate");
    expect(testExpression(expression(source), context)).toBe(false);
  });
  it.each([["if(false, 1/0, 2)", 2], ["if(true, 3, number('bad'))", 3], ["false && 1/0", false], ["true || 1/0", true], ["if(false, missing.lower(), 'ok')", "ok"]])("does not evaluate skipped branches: %s", (source, expected) => expect(run(source as string)).toBe(expected));
  it("propagates dependency errors, catches throwing/invalid context values, and does not throw outside evaluation", () => {
    const err = new FormulaError("Bad dependency");
    expect(run("a + 1", { ...context, get: () => err })).toBe(err);
    expect(run("a", { ...context, get: () => { throw Error("Read failed"); } })).toMatchObject({ message: "Read failed", phase: "evaluate" });
    expect(isFormulaError(run("a", { ...context, get: () => ({ constructor: Function }) as unknown as Value }))).toBe(true);
    expect(run("a", { ...context, get: () => undefined as unknown as Value })).toBeNull();
    expect(isFormulaError(run("now()", { ...context, now: () => NaN }))).toBe(true);
  });
  it("does not retain a previous row's evaluation error", () => {
    const f = expression("1 / a");
    expect(isFormulaError(f({ ...context, get: () => 0 }))).toBe(true);
    expect(f({ ...context, get: () => 2 })).toBe(.5);
    expect(f.error).toBeUndefined();
  });
  it.each([() => 1, Symbol("value"), 1n, NaN, Infinity])("rejects unsupported or non-finite callback values: %s", value => {
    expect(isFormulaError(run("a", { ...context, get: () => value as unknown as Value }))).toBe(true);
  });
  it("decodes escaped quotes, backslashes, control characters and Unicode without executing text", () => {
    expect(run('"\\uD83D\\uDE00\\n\\t\\\\\\\""')).toBe('😀\n\t\\"');
    expect(run("'it\\'s'" )).toBe("it's");
    expect(run("'constructor()'")).toBe("constructor()");
  });
});

describe("safety limits", () => {
  it("keeps the 4,000-character, 500-token and 50-level limits", () => {
    expect(() => expression(" ".repeat(4001))).toThrow(/too long/);
    expect(run("'" + "x".repeat(3998) + "'")).toHaveLength(3998);
    expect(() => expression(Array(251).fill("1").join("+"))).toThrow(/too complex/);
    expect(run(Array(250).fill("1").join("+"))).toBe(250);
    expect(run("(".repeat(50) + "1" + ")".repeat(50))).toBe(1);
    for (const s of ["(".repeat(51) + "1" + ")".repeat(51), "!".repeat(51) + "true", "list(".repeat(51) + "1" + ")".repeat(51)]) expect(() => expression(s)).toThrow(/too deep/);
    expect(() => expression("(".repeat(100_000))).toThrow(/too long/);
  });
  it("bounds large and cyclic values and value-processing work", () => {
    expect(isFormulaError(run("title", { ...context, get: () => "x".repeat(100_001) }))).toBe(true);
    const cyclic: Value[] = []; cyclic.push(cyclic);
    expect(isFormulaError(run("tags.join()", { ...context, get: () => cyclic }))).toBe(true);
    expect(isFormulaError(run("tags.join()", { ...context, get: () => Array(10_001).fill("x") }))).toBe(true);
    expect(isFormulaError(run(Array(10).fill("tags.contains(0)").join(" || "), { ...context, get: () => Array(10_000).fill(1) }))).toBe(true);
    expect(isFormulaError(run(Array(6).fill("('' + tags).contains('x')").join(" || "), { ...context, get: () => Array(10_000).fill(1) }))).toBe(true);
  });
  it("does not equate different durations when their elapsed totals overflow", () => {
    const amount = "1" + "0".repeat(302);
    expect(isFormulaError(run(`duration('${amount}d') == duration('2${amount}d')`))).toBe(true);
  });
});

const dateContext: Context = { get: key => key === "due" ? "2024-02-01" : key === "file.mtime" ? "2024-01-30T12:00:00Z" : null, hasTag: () => false, hasLink: () => false, now: () => Date.UTC(2024, 0, 31, 12) };
describe("date arithmetic in expressions", () => {
  it.each([
    ["due < today() + '7d'", true], ["file.mtime > now() - '1 week'", true],
    ["(today() + duration('1d')).format('YYYY-MM-DD')", "2024-02-01"],
    ["('1d' + date('2024-02-28')).day", 29],
    ["number(date('2024-02-02') - date('2024-02-01'))", 86400000],
    ["duration('2d') - duration('1d') == duration('1d')", true],
    ["(date('2024-02-02') - date('2024-02-01')) >= duration('1d')", true],
    ["date('2024-02-01') == due", true],
    ["'2024-01-01' + ' label'", "2024-01-01 label"],
  ])("%s", (input, expected) => expect(expression(input as string)(dateContext)).toEqual(expected));
  it.each(["date('2024-01-01') + 'bad'", "date('2024-01-01') * 2", "date('2024-01-01') + 1", "date('2024-01-01') - 1"])("rejects incompatible date arithmetic %s", source => expect(isFormulaError(expression(source)(dateContext))).toBe(true));
});
