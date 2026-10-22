import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { expect, test } from "vitest";
import { resolveLink } from "../links/internal";
import { linkAt } from "./linkAt";
import { markdownSyntax } from "./syntax";

const notes = [{ name: "Note", path: "Folder/Note.md" }];
test("hover targets preserve headings, blocks and missing notes at every link character", () => {
  for (const [doc, target] of [
    ["[[Note#Heading|alias]]", "Note#Heading"],
    ["[[Note#^block]]", "Note#^block"],
    ["[label](./Note.md#Heading)", "./Note.md#Heading"],
    ["[[Missing]]", "Missing"],
  ]) {
    const state = EditorState.create({ doc, extensions: markdownSyntax });
    ensureSyntaxTree(state, doc.length, 1000);
    for (let pos = 1; pos < doc.length; pos++) {
      const found = linkAt(state, pos);
      expect(found?.kind).toBe("internal");
      if (found?.kind !== "internal") continue;
      expect(found.target).toBe(target);
      expect(resolveLink(found.target, "Folder/Source.md", notes)).toBe(target === "Missing" ? null : "Folder/Note.md");
    }
  }
});

test("code has no hover target and external links remain external", () => {
  for (const doc of ["`[[Note]]`", "```\n[[Note]]\n```", "[web](https://example.com)"]) {
    const state = EditorState.create({ doc, extensions: markdownSyntax });
    ensureSyntaxTree(state, doc.length, 1000);
    const found = linkAt(state, doc.indexOf(doc.includes("https") ? "https" : "Note") + 1);
    expect(found?.kind ?? null).toBe(doc.includes("https") ? "external" : null);
  }
});
