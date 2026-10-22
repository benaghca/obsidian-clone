import { expect, test } from "vitest";
import { calloutBody, calloutHeader, calloutKind } from "./callouts";
import { embedPart, embedSection, embedSize, embedStopped, resizedSize, splitSubpath, toggledTask } from "./embeds";
import { alignments, splitRow } from "./tables";

test("callout headers: type, title and fold marker", () => {
  expect(calloutHeader("> [!note]")).toEqual({ type: "note", title: "", fold: "" });
  expect(calloutHeader(">[!TIP] Custom *title* ")).toEqual({ type: "tip", title: "Custom *title*", fold: "" });
  expect(calloutHeader("> [!warning]- Folded")).toEqual({ type: "warning", title: "Folded", fold: "-" });
  expect(calloutHeader("> [!faq]+")).toEqual({ type: "faq", title: "", fold: "+" });
  expect(calloutHeader("> just a quote")).toBeNull();
  expect(calloutHeader("> [!] empty")).toBeNull();
});

test("callout aliases share their type's icon and colour; unknown types look like a note", () => {
  expect(calloutKind("tldr")).toEqual(calloutKind("abstract"));
  expect(calloutKind("hint")).toEqual({ icon: "flame", color: "cyan" });
  expect(calloutKind("done")).toEqual({ icon: "check", color: "green" });
  expect(calloutKind("attention")).toEqual({ icon: "triangle-alert", color: "orange" });
  expect(calloutKind("error")).toEqual({ icon: "zap", color: "red" });
  expect(calloutKind("cite")).toEqual({ icon: "quote", color: "gray" });
  expect(calloutKind("todo")).toEqual({ icon: "circle-check", color: "blue" });
  expect(calloutKind("whatever")).toEqual(calloutKind("note"));
});

test("a callout's body loses its quote markers", () => {
  expect(calloutBody("> [!note] T\n> line one\n>  indented\n>\nlazy")).toBe("line one\n indented\n\nlazy");
});

test("table rows split at unescaped pipes; outer pipes are optional", () => {
  const cells = (line: string) => splitRow(line).map(({ from, to }) => line.slice(from, to));
  expect(cells("| a | **b** | c |")).toEqual(["a", "**b**", "c"]);
  expect(cells("a | b")).toEqual(["a", "b"]);
  expect(cells("| x \\| y |  |")).toEqual(["x \\| y", ""]);
  expect(cells("|single|")).toEqual(["single"]);
});

test("column alignment from the delimiter row", () => {
  expect(alignments("| :--- | :----: | ----: | --- |")).toEqual(["left", "center", "right", ""]);
  expect(alignments(":-:|-")).toEqual(["center", ""]);
});

test("embed sizes after the last pipe", () => {
  expect(embedSize("200")).toEqual({ alt: "", width: 200, height: undefined });
  expect(embedSize("200x100")).toEqual({ alt: "", width: 200, height: 100 });
  expect(embedSize("A caption|320")).toEqual({ alt: "A caption", width: 320, height: undefined });
  expect(embedSize("just alt text")).toEqual({ alt: "just alt text" });
  expect(embedSize("")).toEqual({ alt: "" });
});

test("embed targets and their sections", () => {
  expect(splitSubpath("Note#Heading")).toEqual(["Note", "Heading"]);
  expect(splitSubpath("Note")).toEqual(["Note", ""]);
  const text = "# Title\nintro\n## Second\nbody ^abc\nmore\n\n### Deeper\nx\n## Third\nend";
  expect(embedSection(text, "Second")).toEqual({ text: "## Second\nbody ^abc\nmore\n\n### Deeper\nx", line: 2 });
  expect(embedSection(text, "third")).toEqual({ text: "## Third\nend", line: 8 });
  expect(embedSection(text, "Missing")).toBeNull();
  expect(embedSection(text, "^abc")).toEqual({ text: "body\nmore", line: 3 });
  expect(embedSection("```\n# not a heading\n```\n# Real\nyes", "not a heading")).toBeNull();
});

test("an embed stops at a cycle or five deep", () => {
  expect(embedStopped("A.md", "A.md", [])).toBe(true); // a note embedding itself
  expect(embedStopped("A.md", "A.md", ["B.md"])).toBe(true); // A → B → A
  expect(embedStopped("B.md", "A.md", ["B.md", "C.md"])).toBe(true);
  expect(embedStopped("C.md", "A.md", ["B.md"])).toBe(false);
  expect(embedStopped("F.md", "A.md", ["B.md", "C.md", "D.md", "E.md", "G.md"])).toBe(true);
});

test("a resized image's size, written as Obsidian writes it", () => {
  // ![[pic.png]] → ![[pic.png|358]], |200 and |100x30 → |358, a caption kept.
  expect([null, "200", "100x30", "caption", "caption|200", ""].map((t) => resizedSize(t, 358))).toEqual(["|358", "358", "358", "caption|358", "caption|358", "358"]);
  // ![alt](a.png) → ![alt|348](a.png), ![](a.png) → ![348](a.png), ![|80](a.png) → ![|128](a.png).
  expect([resizedSize("alt", 348), resizedSize("", 348), resizedSize("|80", 128)]).toEqual(["alt|348", "348", "|128"]);
});

test("ticking a task in an embedded note writes that line of the note", () => {
  const note = "---\ntags: [a]\n---\n# Tasks\n\n- [ ] first\n- [x] done\n> - [ ] quoted\n## Later\n1. [ ] numbered";
  // An embed shows the note without its frontmatter: its line 2 is the note's line 5.
  const all = embedPart(note, "")!;
  expect(all.line).toBe(3);
  const tick = (line: number) => {
    const t = toggledTask(note, line);
    return t && note.slice(0, t.at) + t.insert + note.slice(t.at + 1);
  };
  expect(tick(all.line + 2)?.split("\n")[5]).toBe("- [x] first");
  expect(tick(6)?.split("\n")[6]).toBe("- [ ] done");
  expect(tick(7)?.split("\n")[7]).toBe("> - [x] quoted");
  const later = embedPart(note, "Later")!;
  expect(tick(later.line + 1)?.split("\n")[9]).toBe("1. [x] numbered");
  expect(toggledTask(note, 3)).toBeNull(); // a heading
  // A line on its own, as a Live Preview checkbox ticks it.
  expect(toggledTask("  * [X] nested\t+ [ ] not this one", 0)).toEqual({ at: 5, insert: " " });
});
