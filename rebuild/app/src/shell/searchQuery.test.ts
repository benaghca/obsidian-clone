import { describe, expect, it } from "vitest";
import { explainQuery, highlightsOf, matchCount, parseQuery, pathQuery, propertyLine, spansOf, termsOf } from "./searchQuery";

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

  it("parses a 10,000-word query into one and of every word", () => {
    const q = parseQuery(Array.from({ length: 10_000 }, (_, i) => `w${i}`).join(" "));
    expect(q?.op).toBe("and");
    expect(q && "parts" in q && q.parts.length).toBe(10_000);
    expect(q && "parts" in q && q.parts[9_999]).toEqual({ op: "term", text: "w9999", field: "any" });
  });

  it("highlights the words that were looked for, not the ones excluded", () => {
    expect(highlightsOf(parseQuery('"star wars" alpha -beta file:x [status:draft]'))).toEqual(["star wars", "alpha", "draft"]);
  });

  it("finds a property's line and highlights every match", () => {
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

  it("treats a negated term removed by field scoping as nothing to search for", () => {
    for (const query of ["file:(-tag:#)", "file:(path:(-tag:#))", "path:(-path:/)"]) {
      expect(parseQuery(query)).toBeNull();
      expect(explainQuery(parseQuery(query))).toBe("");
    }
  });

  it("writes Search in folder's path: as Obsidian does", () => {
    expect(pathQuery("Projects/Big ideas")).toBe('path:"Projects/Big ideas" ');
  });

  it("counts overlapping matches once, and respects match case in a span", () => {
    expect(spansOf("Alpha alpha", ["alpha"], true)).toEqual([{ from: 6, to: 11 }]);
    expect(matchCount([{ line: 1, text: "star wars and stars" }], ["star wars", "star"])).toBe(2);
  });
});
