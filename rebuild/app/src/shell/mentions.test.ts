import { expect, test } from "vitest";
import { hitColumns } from "./sideView";
import { linkSpans, mentionSpans, snippetParts } from "./mentions";

const isWelcome = (t: string) => t.toLowerCase() === "welcome";
const cut = (text: string, spans: { from: number; to: number }[]) => spans.map((s) => text.slice(s.from, s.to));

test("linked mentions: only links to this note, with heading or alias", () => {
  const line = "See [[Welcome]], [[welcome#Lists|the lists]] and [[Ideas]] or ![[Welcome]]";
  expect(cut(line, linkSpans(line, isWelcome))).toEqual(["[[Welcome]]", "[[welcome#Lists|the lists]]", "![[Welcome]]"]);
});

test("unlinked mentions: whole words, any case, outside links", () => {
  const line = "Welcome back. The welcome note, [[Welcome]], [Welcome](x.md) and Welcomed or unwelcome.";
  expect(cut(line, mentionSpans(line, "Welcome"))).toEqual(["Welcome", "welcome"]);
});

test("tags are not mentions", () => {
  const line = "Loose ideas, most of them for #ideas/later and #ideas.";
  expect(cut(line, mentionSpans(line, "Ideas"))).toEqual(["ideas"]);
});

test("multi-word titles match across any run of spaces", () => {
  const line = "the project  roadmap and Project Roadmap2";
  expect(cut(line, mentionSpans(line, "Project roadmap"))).toEqual(["project  roadmap"]);
  expect(mentionSpans("anything", "  ")).toEqual([]);
});

test("titles with regex characters are matched literally", () => {
  expect(cut("C++ (notes) here", mentionSpans("C++ (notes) here", "C++ (notes)"))).toEqual(["C++ (notes)"]);
});

test("snippets drop list markers and highlight the hits", () => {
  const line = "- [x] Read [[Welcome]] today";
  expect(snippetParts(line, linkSpans(line, isWelcome))).toEqual([
    { text: "Read ", hit: false },
    { text: "[[Welcome]]", hit: true, range: { from: 11, to: 22 } },
    { text: " today", hit: false },
  ]);
});

test("snippets cap the tail after the final hit and retain original columns", () => {
  const line = `${"padding ".repeat(30)}FirstHit and SecondHit ${"padding ".repeat(30)}`;
  const spans = [...line.matchAll(/Hit/g)].map((m) => ({ from: m.index, to: m.index + 3 }));
  const parts = snippetParts(line, spans);
  expect(parts[0].text).toBe("…");
  expect(parts.at(-1)?.text).toBe("…");
  expect(parts.map((p) => p.text).join("").length).toBeLessThan(150);
  expect(parts.filter((p) => p.hit).map((p) => p.range)).toEqual(spans);
  expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Hit", "Hit"]);
  expect(snippetParts("No hit or trailing trim", [])).toEqual([{ text: "No hit or trailing trim", hit: false }]);
});

test("a hit far into a long line keeps some context before it", () => {
  const line = `${"word ".repeat(40)}[[Welcome]] end`;
  const parts = snippetParts(line, linkSpans(line, isWelcome), 20);
  expect(parts[0]).toEqual({ text: "…", hit: false });
  expect(parts[1].text).toBe("word word word "); // whole words, within 20 characters of the hit
  expect(parts.find((p) => p.hit)?.text).toBe("[[Welcome]]");
});

test("a hit just past the cut-off is not cut mid-word", () => {
  const line = "- Headings lists editor lines links this separate without. See [[Welcome]]";
  const parts = snippetParts(line, linkSpans(line, isWelcome));
  expect(parts[0].text).toBe("…");
  const rest = parts.slice(1).map((p) => p.text).join("");
  expect(line.endsWith(rest) && line[line.length - rest.length - 1]).toBe(" ");
});


test("pressed highlights use their source columns, with a first-match fallback", () => {
  const spans = [{ from: 5, to: 8 }, { from: 33, to: 36 }];
  const event = (hit: unknown) => ({ target: { closest: () => hit } }) as unknown as MouseEvent;
  expect(hitColumns(event({ dataset: { from: "33", to: "36" } }), spans)).toEqual([33, 36]);
  expect(hitColumns(event(null), spans)).toEqual([5, 8]);
  expect(hitColumns(event(null), [])).toBeUndefined();
});
