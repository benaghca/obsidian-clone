import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { MarkdownParser } from "@lezer/markdown";
import { expect, test } from "vitest";
import { checkedTaskText } from "./livePreview";
import { Tag, WikiLink } from "./syntax";

const parser = (markdownLanguage.parser as MarkdownParser).configure([WikiLink, Tag]);

function struck(text: string): string[] {
  const doc = EditorState.create({ doc: text }).doc;
  const out: string[] = [];
  parser.parse(text).iterate({
    enter: (n) => {
      if (n.name !== "Task") return;
      const marker = n.node.getChild("TaskMarker")!;
      const { from, to } = checkedTaskText(doc, n.node, marker);
      out.push(text.slice(from, to));
    },
  });
  return out;
}

test("a line typed under a checked task is not struck through", () => {
  // Both lines are one Task node (lazy continuation); only the first is done text.
  expect(struck("- [x] Done task\nnew line")).toEqual(["Done task"]);
  expect(struck("- [x] Done task\n  indented")).toEqual(["Done task"]);
});

test("each task strikes its own line", () => {
  expect(struck("- [x] Done\n- [x] Also done")).toEqual(["Done", "Also done"]);
  expect(struck("1. [x] Numbered")).toEqual(["Numbered"]);
});
