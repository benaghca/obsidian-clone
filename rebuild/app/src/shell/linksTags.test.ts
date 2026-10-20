import { expect, test } from "vitest";
import { tagsInLine, tagTree, wikilinkTargets } from "./linksTags";

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
