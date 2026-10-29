import { expect, test } from "vitest";
import { frontmatterTags, tagsByNote, tagsInLine, tagsInText, tagTree, wikilinkTargets } from "./linksTags";

test("wikilink targets skip fenced code and keep repeats", () => {
  const text = "See [[A]] and [[B#Head|alias]], [[A]]\n```\n[[Nope]]\n```\n![[C]] [[ ]]";
  expect(wikilinkTargets(text)).toEqual(["A", "B", "A", "C"]);
});

test("wikilink targets follow CommonMark fence rules and skip inline code", () => {
  const text = [
    "[[Start]] `[[InSingle]]` ``[[InDouble]] ` [[StillInDouble]]`` `unclosed [[AfterUnclosed]]",
    "~~~",
    "```",
    "[[InTildeFence]]",
    "~~~",
    "````",
    "```",
    "[[InFourBacktickFence]]",
    "````",
    "\t```",
    "[[TabIndentedIsNotAFence]]",
    "\t```",
    "    ```",
    "[[FourSpaceIndentedIsNotAFence]]",
    "    ```",
    "```info`backtick",
    "[[BacktickInInfoStringIsNotAFence]]",
    "```",
    "[[InsideFenceNotClosedBy4SpaceIndent]]",
    "    ```",
    "``` trailing",
    "[[StillInsideFence]]",
  ].join("\n");
  expect(wikilinkTargets(text)).toEqual([
    "Start",
    "AfterUnclosed",
    "TabIndentedIsNotAFence",
    "FourSpaceIndentedIsNotAFence",
    "BacktickInInfoStringIsNotAFence",
  ]);
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

test("frontmatter tags: list, inline list and plain forms, with or without #", () => {
  expect(frontmatterTags("---\ntags:\n  - alpha\n  - \"#beta\"\n  - 'gamma/delta'\ntitle: x\n---\nBody #inline")).toEqual({
    tags: ["alpha", "beta", "gamma/delta"],
    end: 7,
  });
  expect(frontmatterTags('---\ntags: [one, "#two", three]\n---\n').tags).toEqual(["one", "two", "three"]);
  expect(frontmatterTags("---\naliases: [x]\ntag: solo, pair\n---").tags).toEqual(["solo", "pair"]);
  // As in YAML, " #" starts a comment.
  expect(frontmatterTags("---\ntags: a # not a tag\n---").tags).toEqual(["a"]);
  expect(frontmatterTags("---\nTags: a b\n---").tags).toEqual(["a", "b"]);
  // Not frontmatter: not at the very start, or never closed.
  expect(frontmatterTags("\n---\ntags: [a]\n---")).toEqual({ tags: [], end: 0 });
  expect(frontmatterTags("---\ntags: [a]")).toEqual({ tags: [], end: 0 });
  // Invalid values are dropped.
  expect(frontmatterTags("---\ntags: [\"two words\", 123, ok]\n---").tags).toEqual(["ok"]);
});

test("tagsInText adds frontmatter tags and doesn't read # inside it as tags", () => {
  const text = "---\ntags: [front]\nnote: \"see #notatag\"\n---\n#body\n```\n#code\n```";
  expect(tagsInText(text)).toEqual(["front", "body"]);
});

test("tagsByNote adds frontmatter tags and skips # lines inside frontmatter", () => {
  const fm = new Map([["a.md", { tags: ["front"], end: 3 }]]);
  const hits = [
    { path: "a.md", line: 2, text: "x: '#inside'" },
    { path: "a.md", line: 5, text: "#body" },
    { path: "b.md", line: 1, text: "#other" },
  ];
  const tags = tagsByNote(hits, [], fm);
  expect(tags.get("a.md")).toEqual(["front", "body"]);
  expect(tags.get("b.md")).toEqual(["other"]);
});
