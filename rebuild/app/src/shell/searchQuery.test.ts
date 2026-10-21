import { describe, expect, it } from "vitest";
import { type Facts, highlightsOf, matches, parseQuery, pathQuery, shownLines, termsOf } from "./searchQuery";

// The throwaway vault the cases were observed on in Obsidian 1.14.4.
const VAULT: Record<string, string> = {
  "A.md": "---\nstatus: done\nproject: Grove\ntags: [gamma]\n---\nAlpha line here\nanother line with beta\nstar wars is a phrase\nwars star reversed\n#inline-tag",
  "B.md": "---\nstatus: in progress\ncategory:\n  - one\n  - two\n---\nalpha beta on one line",
  "C.md": "No frontmatter here. alpha only.",
  "Props.md": "---\ntags:\n  - alpha\n  - beta\nstatus: draft\n---\nBody text with five words.",
  "Projects/Roadmap.md": "---\nstatus: draft\n---\nThe roadmap mentions alpha and gamma.",
  "Gamma file.md": "Nothing relevant inside.",
  "Daily/2026-10-21.md": "Daily note with beta.",
};
const TAGS = new Map([["A.md", ["gamma", "inline-tag"]], ["Props.md", ["alpha", "beta"]]]);
const PROPS = new Map([
  ["A.md", new Map([["status", ["done"]], ["project", ["Grove"]], ["tags", ["gamma"]]])],
  ["B.md", new Map([["status", ["in progress"]], ["category", ["one", "two"]]])],
  ["Props.md", new Map([["tags", ["alpha", "beta"]], ["status", ["draft"]]])],
  ["Projects/Roadmap.md", new Map([["status", ["draft"]]])],
]);

/** Lines per term the way the backend's search finds them: every word on one line. */
const facts: Facts = {
  lines(term) {
    const words = term.split(/\s+/);
    const out = new Map<string, { line: number; text: string }[]>();
    for (const [path, text] of Object.entries(VAULT)) {
      const hits = text.split("\n").flatMap((t, i) => (words.every((w) => t.toLowerCase().includes(w)) ? [{ line: i + 1, text: t }] : []));
      if (hits.length) out.set(path, hits);
    }
    return out;
  },
  tags: TAGS,
  props: PROPS,
};
const names = (p: string) => p.replace(/^.*\//, "").replace(/\.md$/, "");
const search = (q: string) =>
  Object.keys(VAULT)
    .filter((path) => matches(path, parseQuery(q), facts))
    .map(names)
    .sort();

describe("search query", () => {
  it("matches as Obsidian 1.14.4 does", () => {
    expect(search("alpha")).toEqual(["A", "B", "C", "Props", "Roadmap"]);
    expect(search("alpha beta")).toEqual(["A", "B", "Props"]); // anywhere in the note, not one line
    expect(search('"star wars"')).toEqual(["A"]);
    expect(search("alpha -beta")).toEqual(["C", "Roadmap"]);
    expect(search("-alpha")).toEqual(["2026-10-21", "Gamma file"]);
    expect(search("alpha OR gamma")).toEqual(["A", "B", "C", "Gamma file", "Props", "Roadmap"]); // the name counts
    expect(search("tag:gamma")).toEqual(["A"]);
    expect(search("tag:#gamma")).toEqual(["A"]);
    expect(search("#gamma")).toEqual([]); // text, and the frontmatter says "gamma"
    expect(search("tag:#inline")).toEqual([]);
    expect(search("file:roadmap")).toEqual(["Roadmap"]);
    expect(search("file:2026")).toEqual(["2026-10-21"]);
    expect(search("path:proj")).toEqual(["Roadmap"]);
    expect(search("line:(alpha beta)")).toEqual(["B"]);
    expect(search("[status]")).toEqual(["A", "B", "Props", "Roadmap"]);
    expect(search('["status"]')).toEqual(["A", "B", "Props", "Roadmap"]);
    expect(search("[status:draft]")).toEqual(["Props", "Roadmap"]);
    expect(search('[status:"in progress"]')).toEqual(["B"]);
    expect(search("[status:dra]")).toEqual(["Props", "Roadmap"]);
    expect(search("[category:one]")).toEqual(["B"]);
    expect(search("[status:draft OR done]")).toEqual(["A", "Props", "Roadmap"]);
    expect(search("-[status]")).toEqual(["2026-10-21", "C", "Gamma file"]);
    expect(search("alpha (beta OR gamma)")).toEqual(["A", "B", "Props", "Roadmap"]);
    expect(search("content:gamma")).toEqual(["A", "Roadmap"]);
    expect(search('path:"Projects" alpha')).toEqual(["Roadmap"]);
  });

  it("parses once into a tree, asks the backend for each term once, and survives stray brackets", () => {
    expect(parseQuery("  ")).toBeNull();
    expect(parseQuery('a "b c" -d')).toEqual({
      op: "and",
      parts: [{ op: "term", text: "a", field: "any" }, { op: "term", text: "b c", field: "any" }, { op: "not", part: { op: "term", text: "d", field: "any" } }],
    });
    expect(parseQuery("file:(a OR b)")).toEqual({ op: "or", parts: [{ op: "term", text: "a", field: "file" }, { op: "term", text: "b", field: "file" }] });
    expect([...termsOf(parseQuery('alpha -beta tag:#x line:(c "d e") file:f [p:q]'))]).toEqual(["alpha", "beta", "#x", "c", "d e"]);
    expect(parseQuery("a ) b")).toEqual({ op: "and", parts: [{ op: "term", text: "a", field: "any" }, { op: "term", text: "b", field: "any" }] });
    expect(parseQuery("ORANGE OR")).toEqual({ op: "term", text: "orange", field: "any" });
    expect(parseQuery("https://example.com")).toEqual({ op: "term", text: "https://example.com", field: "any" });
  });

  it("shows the lines with what was looked for, highlighted", () => {
    const q = parseQuery("alpha -beta [status]");
    const line = (key: string) => (key === "status" ? { line: 2, text: "status: draft" } : null);
    expect(shownLines("Projects/Roadmap.md", q, facts, line)).toEqual([
      { line: 2, text: "status: draft" },
      { line: 4, text: "The roadmap mentions alpha and gamma." },
    ]);
    expect(shownLines("B.md", parseQuery("line:(alpha beta)"), facts, line)).toEqual([{ line: 7, text: "alpha beta on one line" }]);
    expect(highlightsOf(parseQuery('"star wars" alpha -beta file:x [status:draft]'))).toEqual(["star wars", "alpha", "draft"]);
  });

  it("writes Search in folder's path: as Obsidian does", () => {
    expect(pathQuery("Projects/Big ideas")).toBe('path:"Projects/Big ideas" ');
    expect(search(pathQuery("Projects"))).toEqual(["Roadmap"]);
  });
});
