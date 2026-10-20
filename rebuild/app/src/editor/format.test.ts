import { insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { expect, test } from "vitest";
import { insertBlock, insertMarkdownLink, insertWikilink, setLineKind, stripFormatting, toggleCheckbox, toggleWrap } from "./format";
import { linkAt } from "./linkAt";
import { Tag, WikiLink } from "./syntax";

/** Run a command on text where « » mark the selection (or | a caret); return the result marked the same way. */
function run(cmd: StateCommand, marked: string): string {
  const anchor = marked.search(/[«|]/);
  const clean = marked.replace(/[«»|]/g, "");
  const head = marked.includes("»") ? marked.indexOf("»") - 1 : anchor;
  let state = EditorState.create({
    doc: clean,
    selection: EditorSelection.single(anchor, head),
    extensions: markdown({ base: markdownLanguage, extensions: [WikiLink, Tag] }),
  });
  cmd({ state, dispatch: (tr) => (state = tr.state) });
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  return from === to ? doc.slice(0, from) + "|" + doc.slice(from) : doc.slice(0, from) + "«" + doc.slice(from, to) + "»" + doc.slice(to);
}

test("toggle bold wraps, unwraps from inside or outside, and inserts an empty pair", () => {
  expect(run(toggleWrap("**"), "a «word» b")).toBe("a **«word»** b");
  expect(run(toggleWrap("**"), "a **«word»** b")).toBe("a «word» b");
  expect(run(toggleWrap("**"), "a «**word**» b")).toBe("a «word» b");
  expect(run(toggleWrap("**"), "a | b")).toBe("a **|** b");
  expect(run(toggleWrap("**"), "a **|** b")).toBe("a | b");
});

test("italic inside bold wraps rather than eating half of the bold markers", () => {
  expect(run(toggleWrap("*"), "**«word»**")).toBe("***«word»***");
  expect(run(toggleWrap("*"), "*«word»*")).toBe("«word»");
});

test("clear formatting strips inline markers but keeps snake_case words", () => {
  expect(stripFormatting("**b** *i* ~~s~~ ==h== `c` %%x%% snake_case_name")).toBe("b i s h c x snake_case_name");
});

test("line kinds: headings, lists, tasks and quotes replace each other and toggle off", () => {
  expect(run(setLineKind("h2"), "|Title")).toBe("## |Title");
  expect(run(setLineKind("h2"), "## |Title")).toBe("|Title");
  expect(run(setLineKind("bullet"), "# |Title")).toBe("- |Title");
  expect(run(setLineKind("task"), "- |item")).toBe("- [ ] |item");
  expect(run(setLineKind("numbered"), "«a\nb»")).toBe("1. «a\n2. b»");
  expect(run(setLineKind("quote"), "  - |x")).toBe("  > |x");
  expect(run(setLineKind("body"), "> |quoted")).toBe("|quoted");
  expect(run(setLineKind("bullet"), "|")).toBe("- |");
});

test("toggle checkbox status: plain → task → checked → unchecked", () => {
  expect(run(toggleCheckbox, "do |it")).toBe("- [ ] do |it");
  expect(run(toggleCheckbox, "- [ ] do |it")).toBe("- [x] do |it");
  expect(run(toggleCheckbox, "- [x] do |it")).toBe("- [ ] do |it");
  expect(run(toggleCheckbox, "- do |it")).toBe("- [ ] do |it");
});

test("blocks go on their own line", () => {
  expect(run(insertBlock("```\n\n```", 4), "text|")).toBe("text\n```\n|\n```");
  expect(run(insertBlock("---\n", 4), "|")).toBe("---\n|");
});

test("links: markdown link around the selection, wikilink with the caret inside", () => {
  expect(run(insertMarkdownLink, "see «this» now")).toBe("see [this](|) now");
  expect(run(insertMarkdownLink, "see «https://x.org» now")).toBe("see [|](https://x.org) now");
  expect(run(insertWikilink, "go |")).toBe("go [[|]]");
  expect(run(insertWikilink, "go «Note»")).toBe("go [[Note]]|");
});

test("Enter on an empty list item ends the list without a blank line (Obsidian)", () => {
  const enter = insertNewlineContinueMarkupCommand({ nonTightLists: false });
  expect(run((t) => enter(t), "- [x] Done|")).toBe("- [x] Done\n- [ ] |");
  expect(run((t) => enter(t), "- [x] Done\n- [ ] |")).toBe("- [x] Done\n|");
  expect(run((t) => enter(t), "1. one\n2. |")).toBe("1. one\n|");
  expect(run((t) => enter(t), "- a\n    - |")).toBe("- a\n- |");
});

test("linkAt finds wikilinks, markdown links and bare URLs at a position", () => {
  const state = EditorState.create({
    doc: "see [[Note#Head|alias]] and [site](https://x.org) or https://y.org end",
    extensions: markdown({ base: markdownLanguage, extensions: [WikiLink, Tag] }),
  });
  const at = (s: string) => linkAt(state, state.doc.toString().indexOf(s) + 1);
  expect(at("Note")).toEqual({ kind: "internal", target: "Note#Head" }); // openLink follows the heading
  expect(at("site")).toEqual({ kind: "external", url: "https://x.org" });
  expect(at("y.org")).toEqual({ kind: "external", url: "https://y.org" });
  expect(at("end")).toBeNull();
});
