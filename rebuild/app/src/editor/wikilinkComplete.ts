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

// The chosen note replaces the whole "[[...]]" with a link written the way
// the link settings ask: [[Name]], [[Folder/Name]], or [Name](Name.md).
function applyLink(view: EditorView, completion: Completion, from: number, to: number) {
  const host = view.state.facet(editorHost);
  const path = (completion as Completion & { path: string }).path;
  const closed = view.state.sliceDoc(to, to + 2) === "]]";
  const link = host ? host.formatLink(path, view) : `[[${completion.label}]]`;
  view.dispatch({
    changes: { from: from - 2, to: closed ? to + 2 : to, insert: link },
    selection: { anchor: from - 2 + link.length },
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
    return { label: note.name, detail: folder, apply: applyLink, type: "note", path: note.path };
  });
  return { from: before.from + 2, options, validFor: /^[^[\]|#\n]*$/ };
}

export const wikilinkCompletion = autocompletion({
  override: [wikilinkSource],
  icons: false,
  activateOnTypingDelay: 0,
  maxRenderedOptions: 50,
  tooltipClass: () => "cm-link-suggest",
});
