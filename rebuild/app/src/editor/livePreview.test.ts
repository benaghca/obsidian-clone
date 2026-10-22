import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { MarkdownParser } from "@lezer/markdown";
import { expect, test, vi } from "vitest";
import { editingEmbed } from "./embeds";
import { checkedTaskText, LivePreview } from "./livePreview";
import { markdownSyntax, Tag, WikiLink } from "./syntax";

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

// A stand-in for the editor view: just what Live Preview reads, with
// dispatch running the plugin's update as CodeMirror would.
function editor(doc: string, caret: number) {
  const view = {
    state: EditorState.create({ doc, selection: { anchor: caret }, extensions: [markdownSyntax, editingEmbed] }),
    hasFocus: true,
    get visibleRanges() {
      return [{ from: 0, to: this.state.doc.length }];
    },
    plugin: () => lp,
    dispatch(spec: TransactionSpec) {
      const tr = this.state.update(spec);
      const startState = this.state;
      this.state = tr.state;
      const u = { view, state: tr.state, startState, transactions: [tr], changes: tr.changes, docChanged: tr.docChanged, selectionSet: !!tr.selection, focusChanged: false, viewportChanged: false };
      lp.update(u as unknown as ViewUpdate);
    },
  };
  const lp = new LivePreview(view as unknown as EditorView);
  /** The markup Live Preview shows (rather than hides). */
  const shown = () => {
    const out: string[] = [];
    lp.decorations.between(0, view.state.doc.length, (from, to, d) => void (d.spec.class?.includes("cm-formatting") && out.push(view.state.sliceDoc(from, to))));
    return out;
  };
  const press = (detail: number) => lp.press({ button: 0, detail } as MouseEvent);
  return { view, lp, shown, press };
}
const release = () => window.dispatchEvent(new Event("mouseup"));

test("markup stays as it was while the mouse button is down, and catches up when it comes up", () => {
  vi.stubGlobal("window", new EventTarget());
  const { view, shown, press } = editor("Some **bold** text\n\nfar away", 25);
  expect(shown()).toEqual([]);
  press(1);
  view.dispatch({ selection: { anchor: 8 } }); // the press puts the caret in the bold word
  view.dispatch({ selection: { anchor: 0, head: 14 } }); // and drags across it
  expect(shown()).toEqual([]);
  release();
  expect(shown()).toEqual(["**", "**"]);
  vi.unstubAllGlobals();
});
