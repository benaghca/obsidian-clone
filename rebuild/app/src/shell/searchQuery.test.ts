import { describe, expect, it } from "vitest";
import { explainQuery, type Facts, highlightsOf, matchCount, matchingNotes, parseQuery, pathQuery, propertyLine, spansOf, termsOf } from "./searchQuery";

// Enough of the old vault for matchingNotes. Parse trees and search results live in fixtures/parity.
const VAULT: Record<string, string> = {
  "A.md": "---\nstatus: done\nproject: Grove\ntags: [gamma]\n---\nAlpha line here\nanother line with beta\nstar wars is a phrase\nwars star reversed\n#inline-tag",
  "B.md": "---\nstatus: in progress\ncategory:\n  - one\n  - two\n---\nalpha beta on one line",
  "C.md": "No frontmatter here. alpha only.",
  "Props.md": "---\ntags:\n  - alpha\n  - beta\nstatus: draft\n---\nBody text with five words.",
  "Projects/Roadmap.md": "---\nstatus: draft\n---\nThe roadmap mentions alpha and gamma.",
};

/** Lines for the one term matchingNotes asks about. The corpus applies the real phrase rule. */
const facts: Facts = {
  lines(term) {
    const out = new Map<string, { line: number; text: string }[]>();
    if (term !== "alpha") return out;
    for (const [path, text] of Object.entries(VAULT)) {
      const hits = text.split("\n").flatMap((line, i) => (line.toLowerCase().includes(term) ? [{ line: i + 1, text: line }] : []));
      if (hits.length) out.set(path, hits);
    }
    return out;
  },
};

const names = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

describe("search query", () => {
  it("explains a query in one sentence", () => {
    expect(explainQuery(null)).toBe("");
    expect(explainQuery(parseQuery("alpha beta"))).toBe('Matches notes that contain "alpha" and contain "beta".');
    expect(explainQuery(parseQuery("file:road"))).toBe('Matches notes that have a file name containing "road".');
    expect(explainQuery(parseQuery("tag:#idea"))).toBe('Matches notes that have the tag "#idea".');
    expect(explainQuery(parseQuery("-alpha"))).toBe('Matches notes that do not contain "alpha".');
    expect(explainQuery(parseQuery("[status:draft]"))).toBe('Matches notes that have property "status" that contain "draft".');
  });

  it("asks the backend for each term once", () => {
    expect([...termsOf(parseQuery('alpha -beta tag:#x line:(c "d e") file:f [p:q]'))]).toEqual(["alpha", "beta", "#x", "c", "d e"]);
  });

  it("highlights the words that were looked for, not the ones excluded", () => {
    expect(highlightsOf(parseQuery('"star wars" alpha -beta file:x [status:draft]'))).toEqual(["star wars", "alpha", "draft"]);
  });

  it("builds the results: matching notes by name less excluded ones, a property's line, every match highlighted", () => {
    const notes = Object.keys(VAULT).map((path) => ({ path, name: names(path) }));
    const found = matchingNotes(notes, parseQuery("alpha")!, facts, (path) => path.startsWith("Projects/"));
    expect(found.map((n) => n.name)).toEqual(["A", "B", "C", "Props"]);
    const fm = { props: [{ key: "Status", line: 0 }, { key: "tags", line: 1 }], lines: ["Status: draft", "tags: [x]"] };
    expect(propertyLine(fm, "tags")).toEqual({ line: 3, text: "tags: [x]" });
    expect(propertyLine(fm, "status")).toEqual({ line: 2, text: "Status: draft" });
    expect(propertyLine(undefined, "status")).toBeNull();
    expect(spansOf("Alpha and alphabet, ALPHA", ["alpha", "and"])).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 9 },
      { from: 10, to: 15 },
      { from: 20, to: 25 },
    ]);
  });

  it("writes Search in folder's path: as Obsidian does", () => {
    expect(pathQuery("Projects/Big ideas")).toBe('path:"Projects/Big ideas" ');
  });

  it("counts overlapping matches once, and respects match case in a span", () => {
    expect(spansOf("Alpha alpha", ["alpha"], true)).toEqual([{ from: 6, to: 11 }]);
    expect(matchCount([{ line: 1, text: "star wars and stars" }], ["star wars", "star"])).toBe(2);
  });
});
