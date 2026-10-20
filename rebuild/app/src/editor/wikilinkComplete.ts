// The [[ link suggester. closeBrackets turns "[[" into "[[]]" with the caret
// in the middle; this source then offers note names, fuzzy-filtered and
// ranked by CodeMirror's matcher. The footer hint is drawn by CSS.

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { editorHost } from "./host";

function applyLink(view: EditorView, completion: Completion, from: number, to: number) {
  const name = completion.label;
  const closed = view.state.sliceDoc(to, to + 2) === "]]";
  const insert = closed ? name : name + "]]";
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + name.length + 2 },
    userEvent: "input.complete",
  });
}

function wikilinkSource(ctx: CompletionContext): CompletionResult | null {
  const before = ctx.matchBefore(/\[\[[^[\]|#\n]*$/);
  if (!before) return null;
  const host = ctx.state.facet(editorHost);
  if (!host) return null;
  const options: Completion[] = host.notes().map((note) => {
    const folder = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : undefined;
    return { label: note.name, detail: folder, apply: applyLink, type: "note" };
  });
  return { from: before.from + 2, options, validFor: /^[^[\]|#\n]*$/ };
}

export const wikilinkCompletion = autocompletion({
  override: [wikilinkSource],
  icons: false,
  maxRenderedOptions: 50,
  tooltipClass: () => "cm-link-suggest",
});
