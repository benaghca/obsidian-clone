// Cut, Copy, Paste and Paste as plain text for the editor's context menu.
// These run only from a click in that menu (a user gesture). The native
// commands go through CodeMirror's own clipboard handling; the async
// clipboard API is the fallback where a webview refuses them. Also how the
// app copies text it shows (paths, URLs, a code block).

import type { EditorView } from "@codemirror/view";

const selectedText = (view: EditorView) =>
  view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join(view.state.lineBreak);

/** Put text on the clipboard (a code block's copy button, Copy path, Copy URL). */
export const writeClipboard = (text: string) => void navigator.clipboard.writeText(text).catch((err) => console.warn("Grove could not write the clipboard", err));

export async function copySelection(view: EditorView, cut: boolean) {
  view.focus();
  if (document.execCommand(cut ? "cut" : "copy")) return;
  const text = selectedText(view);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  if (cut) view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut" });
}

export async function paste(view: EditorView, plain: boolean) {
  view.focus();
  if (!plain && document.execCommand("paste")) return;
  try {
    const text = await navigator.clipboard.readText();
    view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
  } catch (err) {
    console.warn("Grove could not read the clipboard", err);
  }
}
