import { expect, test } from "vitest";
import { tagsByNote, tagsInLine, tagsInText, tagTree, wikilinkTargets } from "./linksTags";

test("wikilink targets skip fenced code and keep repeats", () => {
  const text = "See [[A]] and [[B#Head|alias]], [[A]]\n```\n[[Nope]]\n```\n![[C]] [[ ]]";
  expect(wikilinkTargets(text)).toEqual(["A", "B", "A", "C"]);
});

test("tags: words after # at a word start, not headings, numbers, code or URL fragments", () => {
  expect(tagsInLine("#idea and #project/grove, x#no http://a.b/#frag")).toEqual(["idea", "project/grove"]);
  expect(tagsInLine("# Heading #tag")).toEqual(["tag"]);
  expect(tagsInLine("#123 #1a `#code` ##double")).toEqual(["1a"]);
});

test("tag tree nests, counts parents with their children, and ignores case", () => {
  const tree = tagTree(["project/grove", "Project", "idea", "project/Grove", "project/cinder"]);
  expect(tree.map((n) => [n.tag, n.count])).toEqual([
    ["idea", 1],
    ["project", 4],
  ]);
  expect(tree[1].children.map((n) => [n.name, n.count])).toEqual([
    ["cinder", 1],
    ["grove", 2],
  ]);
});

test("tags in text skip fenced code, including ~~~ and longer fences", () => {
  const text = "#a\n```js\n#no\n```\n#b\n~~~~\n```\n#still-no\n~~~~\n#c\n```\n#open-to-end";
  expect(tagsInText(text)).toEqual(["a", "b", "c"]);
});

test("tags by note use fence hits to drop lines inside code blocks", () => {
  const note = "#a\n```\n#no\n```\n#b\n~~~\n```inside\n#no2\n~~~\n#c";
  const lines = note.split("\n").map((text, i) => ({ path: "n.md", line: i + 1, text }));
  const tagLines = lines.filter((l) => l.text.includes("#"));
  const fenceLines = [...lines.filter((l) => l.text.includes("```")), ...lines.filter((l) => l.text.includes("~~~"))];
  const other = { path: "o.md", line: 3, text: "#d `#code`" };
  const byNote = tagsByNote([...tagLines, other, { path: "x.png", line: 1, text: "#img" }], fenceLines);
  expect(byNote.get("n.md")).toEqual(["a", "b", "c"]);
  expect(byNote.get("o.md")).toEqual(["d"]);
  expect(byNote.has("x.png")).toBe(false);
});
