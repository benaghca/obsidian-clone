import { Text } from "@codemirror/state";
import { expect, test } from "vitest";
import { addProperty, asType, type Change, fits, type Frontmatter, type Property, readFrontmatter, removeProperty, renameKey, setValue, yamlString } from "./frontmatter";

const NOTE = `---
title: Hello world
tags:
  - alpha
  - beta
count: 42
done: true
due: 2026-10-21
when: 2026-10-21T10:30
aliases: [Hi, "a, b"]
links:
  - "[[Other]]"
quoted: "42"
nested:
  a: 1
block: |
  two
  lines
# a comment of its own
noted: value # with a comment
empty:
---
Body text.
`;

const read = (text: string) => readFrontmatter(Text.of(text.split("\n")))!;
const apply = (text: string, c: Change) => text.slice(0, c.from) + c.insert + text.slice(c.to);
const prop = (fm: Frontmatter, key: string) => fm.props!.find((p) => p.key === key)!;

test("properties and their types, as Obsidian reads them", () => {
  const fm = read(NOTE);
  expect(fm.props!.map((p) => [p.key, p.type, p.value])).toEqual([
    ["title", "text", "Hello world"],
    ["tags", "tags", ["alpha", "beta"]],
    ["count", "number", "42"],
    ["done", "checkbox", true],
    ["due", "date", "2026-10-21"],
    ["when", "datetime", "2026-10-21T10:30"],
    ["aliases", "aliases", ["Hi", "a, b"]],
    ["links", "list", ["[[Other]]"]],
    ["quoted", "text", "42"],
    ["nested", "unknown", "a: 1"],
    ["block", "unknown", "|\n  two\n  lines"],
    ["noted", "unknown", "value # with a comment"],
    ["empty", "text", ""],
  ]);
  expect(NOTE.slice(fm.end)).toBe("\nBody text.\n");
  // Plain tags split like Obsidian's; a frontmatter-less note has none.
  expect(read("---\ntags: a, b c\n---\n").props![0].value).toEqual(["a", "b", "c"]);
  expect(readFrontmatter(Text.of(["# Title", "---"]))).toBeNull();
  expect(readFrontmatter(Text.of(["---", "never closed"]))).toBeNull();
});

test("YAML Grove can't place line by line is shown as source", () => {
  expect(read("---\nnot a property\n---\n").props).toBeNull();
  expect(read("---\n- a list at the top\n---\n").props).toBeNull();
  expect(read("---\nname: first\nName: second\n---\n").props).toBeNull();
  expect(read("---\n---\n").props).toEqual([]);
});

test("an edit rewrites only its own property's lines", () => {
  let fm = read(NOTE);
  let text = setValue(fm, prop(fm, "title"), "Hello again").insert;
  expect(text).toBe("title: Hello again");
  const after = apply(NOTE, setValue(fm, prop(fm, "tags"), ["alpha", "beta", "gamma delta"]));
  expect(after).toBe(NOTE.replace("  - beta\n", "  - beta\n  - gamma delta\n"));
  // Everything else, unknown values and comments included, is untouched.
  fm = read(after);
  expect(prop(fm, "nested").value).toBe("a: 1");
  expect(after).toContain("# a comment of its own\nnoted: value # with a comment\n");
  // Lists keep being lists when emptied; checkboxes, numbers and dates are written as such.
  expect(setValue(fm, prop(fm, "aliases"), []).insert).toBe("aliases: []");
  expect(read(apply(after, setValue(fm, prop(fm, "aliases"), []))).props!.find((p) => p.key === "aliases")!.value).toEqual([]);
  expect(setValue(fm, prop(fm, "done"), false).insert).toBe("done: false");
  expect(setValue(fm, prop(fm, "count"), "-1.5").insert).toBe("count: -1.5");
  expect(setValue(fm, prop(fm, "due"), "").insert).toBe("due:");
  text = apply(after, renameKey(fm, prop(fm, "title"), "Name"));
  expect(text).toContain("\nName: Hello world\n");
  text = apply(text, removeProperty(read(text), prop(read(text), "count")));
  expect(text).not.toContain("count");
  expect(text).toContain("tags:\n  - alpha");
  expect(text).toContain("  - gamma delta\ndone: true\n");
});

test("a key written in quotes stays quoted", () => {
  const note = '---\n"my: key": old\n---\n';
  const fm = read(note);
  expect(fm.props![0].key).toBe("my: key");
  expect(apply(note, setValue(fm, fm.props![0], "new"))).toBe('---\n"my: key": new\n---\n');
});

test("text that would read back as something else is quoted", () => {
  for (const s of ["42", "true", "2026-10-21", "[[Link]]", "#tag", "a: b", "a #b", " padded", "-x", "null", "", "it's"]) {
    const fm = read(`---\nx: ${yamlString(s)}\n---\n`);
    expect([s, fm.props![0].value]).toEqual([s, s]);
  }
  expect(yamlString("plain words")).toBe("plain words");
  expect(yamlString("https://example.com/a")).toBe("https://example.com/a");
});

test("adding a property: at the end, or a new frontmatter", () => {
  const fm = read(NOTE);
  const added = apply(NOTE, addProperty(fm, "status", "text", "draft"));
  expect(added).toContain("empty:\nstatus: draft\n---\nBody");
  expect(apply("Body.\n", addProperty(null, "status"))).toBe("---\nstatus:\n---\nBody.\n");
  expect(read(apply("Body.\n", addProperty(null, "my key: x", "list", ["a"]))).props![0]).toMatchObject({ key: "my key: x", value: ["a"] });
});

test("YAML Grove could misread or rewrite is shown read-only, and stays as written", () => {
  const note = `---
octal: 012
sci: 1e3
half: .5
hex: 0x1F
plus: +5
under: 1_000
inf: .inf
clock: 10:30
trailing: value # a comment
list:
  - a # a comment
flow: [a, 012]
fine: 12.5
---
Body.
`;
  const fm = read(note);
  expect(Object.fromEntries(fm.props!.map((p) => [p.key, p.type]))).toEqual({
    octal: "unknown",
    sci: "unknown",
    half: "unknown",
    hex: "unknown",
    plus: "unknown",
    under: "unknown",
    inf: "unknown",
    clock: "unknown",
    trailing: "unknown",
    list: "unknown",
    flow: "unknown",
    fine: "number",
  });
  // Read-only values keep their text as written, and an edit next to them leaves them alone.
  expect(prop(fm, "octal").value).toBe("012");
  expect(prop(fm, "trailing").value).toBe("value # a comment");
  expect(apply(note, setValue(fm, prop(fm, "fine"), "13"))).toBe(note.replace("fine: 12.5", "fine: 13"));
  // Text that looks like one of those numbers is quoted when Grove writes it.
  for (const s of ["012", "1e3", ".5", "0x1F", "10:30"]) expect(yamlString(s)).toBe(JSON.stringify(s));
});

test("a `...` end line doesn't make frontmatter (as in Obsidian), so nothing is rewritten", () => {
  expect(readFrontmatter(Text.of(["---", "title: Dots", "...", "Body"]))).toBeNull();
  // Adding a property puts a new frontmatter above, leaving those lines as they were.
  expect(apply("---\ntitle: Dots\n...\n", addProperty(null, "a", "text", "b"))).toBe("---\na: b\n---\n---\ntitle: Dots\n...\n");
});

test("which values fit a chosen type, and how they are shown in it (Obsidian's rules)", () => {
  const p = (type: Property["type"], value: Property["value"]): Property => ({ key: "k", type, value, line: 0, count: 1 });
  const text = p("text", "hello"), num = p("number", "42"), yes = p("checkbox", true), date = p("date", "2026-10-21");
  const time = p("datetime", "2026-10-21T10:30"), list = p("list", ["a", "b"]), empty = p("text", "");
  const fitting = (v: Property) => ["text", "number", "checkbox", "date", "datetime", "list"].filter((t) => fits(v, t as Property["type"]));
  expect(fitting(text)).toEqual(["text", "list"]);
  expect(fitting(num)).toEqual(["number"]);
  expect(fitting(yes)).toEqual(["checkbox"]);
  expect(fitting(date)).toEqual(["text", "date", "datetime", "list"]);
  expect(fitting(time)).toEqual(["text", "date", "datetime", "list"]);
  expect(fitting(list)).toEqual(["list"]);
  expect(fitting(empty)).toHaveLength(6);
  expect(fitting(p("text", "2026-10-21"))).toContain("date"); // a quoted date
  expect([asType(text, "list"), asType(date, "datetime"), asType(time, "date")]).toEqual([["hello"], "2026-10-21T00:00", "2026-10-21"]);
  // After "Display as ...?": adapted as Obsidian's Update does.
  expect([asType(num, "text"), asType(list, "text"), asType(yes, "text"), asType(text, "number"), asType(time, "checkbox"), asType(num, "list")]).toEqual(["42", "a,b", "true", "", false, ["42"]]);
});

test("a value is written in the type it is shown as", () => {
  const fm = read("---\nstatus: draft\ncount: 42\n---\n");
  expect(setValue(fm, prop(fm, "status"), ["draft", "done"], "list").insert).toBe("status:\n  - draft\n  - done");
  expect(setValue(fm, prop(fm, "count"), "43", "text").insert).toBe('count: "43"');
});
