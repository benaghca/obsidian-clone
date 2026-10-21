import { expect, test } from "vitest";
import { calloutBody, calloutHeader, calloutKind } from "./callouts";
import { embedSection, embedSize, embedStopped, resizedSize, splitSubpath } from "./embeds";
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
  expect(embedSection(text, "Second")).toBe("## Second\nbody ^abc\nmore\n\n### Deeper\nx");
  expect(embedSection(text, "third")).toBe("## Third\nend");
  expect(embedSection(text, "Missing")).toBeNull();
  expect(embedSection(text, "^abc")).toBe("body\nmore");
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
