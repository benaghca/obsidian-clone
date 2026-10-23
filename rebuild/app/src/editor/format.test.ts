import { insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { deleteCharBackward, history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, test } from "vitest";
import {
  closeCodeFence,
  backspaceList,
  insertBlock,
  indentList,
  insertFootnote,
  insertMarkdownLink,
  insertWikilink,
  markdownHome,
  setLineKind,
  stripFormatting,
  toggleCheckbox,
  toggleHighlight,
  toggleWrap,
} from "./format";
import { linkAt } from "./linkAt";
import { Tag, WikiLink } from "./syntax";

/** Run a command on text where « » mark the selection (or | a caret); return the result marked the same way. */
function run(cmd: StateCommand, marked: string, unit = "    "): string {
  const anchor = marked.search(/[«|]/);
  const clean = marked.replace(/[«»|]/g, "");
  const head = marked.includes("»") ? marked.indexOf("»") - 1 : anchor;
  let state = EditorState.create({
    doc: clean,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage, extensions: [WikiLink, Tag] }), indentUnit.of(unit)],
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

test("Tab renumbers the parent and new sublist; Shift+Tab rejoins the parent numbering", () => {
  expect(run(indentList(), "1. first\n2. |second\n3. third")).toBe("1. first\n    1. |second\n2. third");
  expect(run(indentList(true), "1. first\n    1. |second\n2. third")).toBe("1. first\n2. |second\n3. third");
  expect(run(indentList(), "5. first\n6. |second\n7. third")).toBe("5. first\n    1. |second\n6. third");
  expect(run(indentList(), "1. first\n    5. nested\n2. |second\n3. third")).toBe("1. first\n    5. nested\n    6. |second\n2. third");
  expect(run(indentList(true), "1. first\n    5. |nested\n    6. child\n2. last")).toBe("1. first\n2. |nested\n    5. child\n3. last");
  expect(run(indentList(), "1. first\n2. |second\n3. third", "\t")).toBe("1. first\n\t1. |second\n2. third");
  expect(run(indentList(), "1. first\n2. |second\n3. third", "  ")).toBe("1. first\n    1. |second\n2. third");
  expect(run(indentList(true), "1. first\n    1. |second\n2. third", "  ")).toBe("1. first\n2. |second\n3. third");
});

test("list indentation keeps selections and ignores fenced code and unrelated lists", () => {
  expect(run(indentList(), "1. first\n2. «second\n3. third»\n4. last")).toBe("1. first\n    1. «second\n    2. third»\n2. last");
  expect(run(indentList(), "1. first\n2. |second\n\nParagraph.\n\n8. other\n11. unchanged")).toBe("1. first\n    1. |second\n\nParagraph.\n\n8. other\n11. unchanged");
  expect(run(indentList(), "```\n2. |code\n```\n\n1. other\n4. unchanged")).toBe("```\n    2. |code\n```\n\n1. other\n4. unchanged");
});

test("renumbering maps multi-digit markers and undoes with the indentation", () => {
  const doc = "9. first\n10. second\n11. third";
  let state = EditorState.create({ doc, selection: { anchor: 13 }, extensions: [markdown(), indentUnit.of("\t"), history()] });
  const dispatch = (tr: import("@codemirror/state").Transaction) => { state = tr.state; };
  indentList()({ state, dispatch });
  expect(state.doc.toString()).toBe("9. first\n\t1. second\n10. third");
  expect(state.doc.lineAt(state.selection.main.head).number).toBe(2);
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.doc.toString()).toBe(doc);
  expect(indentList()({ state: EditorState.create({ doc, extensions: EditorState.readOnly.of(true) }), dispatch })).toBe(false);
});

const backspace: StateCommand = (target) => backspaceList(target) || deleteCharBackward(target as EditorView);

test("Backspace removes bullet, number or task markers while preserving indentation", () => {
  for (const marker of ["- ", "* ", "+ ", "12. ", "3) ", "- [ ] ", "1. [x] "]) {
    const text = "- first\n\n    " + marker + "|body";
    expect(run(backspace, text)).toBe("- first\n\n    |body");
  }
  expect(run(backspace, "1. first\n    1. |nested\n2. last")).toBe("1. first\n    |nested\n2. last");
  expect(run(backspace, "> - |quoted")).toBe("> |quoted");
});

test("the second Backspace outdents, then joins the preceding line", () => {
  expect(run(backspace, "first\n    |body")).toBe("first\n|body");
  expect(run(backspace, "first\n|body")).toBe("first|body");
  expect(run(backspace, "1. first\n    |nested\n2. last")).toBe("1. first\n|nested\n2. last");
});

test("list Backspace leaves fenced code, selections and interior text to normal deletion", () => {
  expect(run(backspace, "```\n- |code\n```")).toBe("```\n-|code\n```");
  expect(run(backspace, "first\n    - |code")).toBe("first\n    -|code");
  expect(run(backspace, "- bo|dy")).toBe("- b|dy");
  expect(run(backspace, "- «body»")).toBe("- |");
  expect(run(backspace, "first\n- |second")).toBe("first\n|second");
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
  expect(at("Note")).toMatchObject({ kind: "internal", target: "Note#Head" }); // openLink follows the heading
  expect(at("site")).toEqual({ kind: "external", url: "https://x.org" });
  expect(at("y.org")).toEqual({ kind: "external", url: "https://y.org" });
  expect(at("end")).toBeNull();
});

describe("insertFootnote", () => {
  it("numbers after the highest footnote and adds its definition at the end", () => {
    const state = EditorState.create({ doc: "One[^1] two\n\n[^1]: first", selection: { anchor: 11 } });
    let next = state;
    insertFootnote({ state, dispatch: (tr) => (next = tr.state) });
    expect(next.doc.toString()).toBe("One[^1] two[^2]\n\n[^1]: first\n\n[^2]: ");
    expect(next.selection.main.head).toBe(next.doc.length);
  });

  it("works in an empty note", () => {
    const state = EditorState.create({ doc: "" });
    let next = state;
    insertFootnote({ state, dispatch: (tr) => (next = tr.state) });
    expect(next.doc.toString()).toBe("[^1]\n\n[^1]: ");
  });
});

test("coloured highlights, written as Obsidian writes them", () => {
  // What Obsidian 1.14.4 wrote for each command (observed).
  expect(run(toggleHighlight("red"), "plain «word» one")).toBe("plain ==🔴«word»== one");
  expect(run(toggleHighlight(null), "plain wo|rd two")).toBe("plain ==wo|rd== two");
  expect(run(toggleHighlight("purple"), "plain wo|rd two")).toBe("plain ==🟣wo|rd== two");
  // The same colour again removes it; another recolours it; plain highlight takes a colour.
  expect(run(toggleHighlight("red"), "plain ==🔴«word»== one")).toBe("plain «word» one");
  expect(run(toggleHighlight("orange"), "plain ==🔴wo|rd== one")).toBe("plain ==🟠wo|rd== one");
  expect(run(toggleHighlight("green"), "plain ==wo|rd== one")).toBe("plain ==🟢wo|rd== one");
  expect(run(toggleHighlight(null), "a ==🔵bl|ue== b")).toBe("a bl|ue b");
  // Only the highlight around the caret is touched.
  expect(run(toggleHighlight("blue"), "==x== and w|ord ==y==")).toBe("==x== and ==🔵w|ord== ==y==");
  expect(run(toggleHighlight("yellow"), "a | b")).toBe("a ==🟡|== b");
});


test("Home and Shift+Home toggle after list/task/quote markers, excluding code", () => {
  for (const prefix of ["- ", "  + ", "- [ ] ", "1. ", "12) ", "1. [x] ", "> ", "> > ", "> - [ ] "]) {
    expect(run(markdownHome(), `${prefix}text|`)).toBe(`${prefix}|text`);
    expect(run(markdownHome(), `${prefix}|text`)).toBe(`|${prefix}text`);
    expect(run(markdownHome(true), `${prefix}text|`)).toBe(`${prefix}«text»`);
    expect(run(markdownHome(true), `${prefix}|text`)).toBe(`«${prefix}»text`);
  }
  expect(run(markdownHome(), "plain|")).toBe("plain|");
  expect(run(markdownHome(), "```md\n- code|\n```")).toBe("```md\n- code|\n```");
});


test("Enter closes a new code fence and keeps its language, indent and caret", () => {
  expect(run(closeCodeFence, "```|")).toBe("```\n|\n```");
  expect(run(closeCodeFence, "```ts|")).toBe("```ts\n|\n```");
  expect(run(closeCodeFence, "  ~~~~js|")).toBe("  ~~~~js\n  |\n  ~~~~");
  expect(run(closeCodeFence, "```ts|\n```")).toBe("```ts|\n```");
  expect(run(closeCodeFence, "    ```|")).toBe("    ```|");
});


test("bold, italic and comment at an interior caret toggle the word and preserve its caret", () => {
  for (const marker of ["**", "*", "%%"]) {
    expect(run(toggleWrap(marker), "a wo|rd b")).toBe(`a ${marker}wo|rd${marker} b`);
    expect(run(toggleWrap(marker), `a ${marker}wo|rd${marker} b`)).toBe("a wo|rd b");
    expect(run(toggleWrap(marker), "a | b")).toBe(`a ${marker}|${marker} b`);
  }
});
