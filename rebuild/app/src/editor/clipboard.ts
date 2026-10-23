// Clipboard commands and the note's single native paste handler.
// The context menu uses native clipboard commands first and the async
// clipboard API as a fallback. Native HTML paste and that fallback share
// conversion; ordinary text stays with CodeMirror's clipboard handling.
// Also how the app copies paths, URLs, code blocks and images.

import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { frontmatterField } from "./frontmatter";
import { htmlToMarkdown } from "./htmlToMarkdown";

export const autoConvertHTML = Facet.define<boolean, boolean>({ combine: values => values[0] ?? true });

const selectedText = (view: EditorView) =>
  view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join(view.state.lineBreak);

/** Put text on the clipboard (a code block's copy button, Copy path, Copy URL). */
export const writeClipboard = (text: string) => void navigator.clipboard.writeText(text).catch((err) => console.warn("Grove could not write the clipboard", err));

/** Copy an image as PNG (the image menu's "Copy image"). */
export async function copyImage(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (png) await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export async function copySelection(view: EditorView, cut: boolean) {
  view.focus();
  if (document.execCommand(cut ? "cut" : "copy")) return;
  const text = selectedText(view);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  if (cut) view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut" });
}

export async function paste(view: EditorView, plain: boolean) {
  if (view.state.readOnly) return;
  view.focus();
  if (!plain && document.execCommand("paste")) return;
  try {
    if (!plain && navigator.clipboard.read) {
      const items = await navigator.clipboard.read().catch(() => []);
      const item = items.some(item => item.types.some(type => type.startsWith("image/")))
        ? undefined : items.find(item => item.types.includes("text/html"));
      if (item) {
        const html = await (await item.getType("text/html")).text();
        const text = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : "";
        if (insertRich(view, html, text)) return;
      }
    }
    const text = await navigator.clipboard.readText();
    if (plain || !insertUrl(view, text)) insertText(view, text);
  } catch (err) {
    console.warn("Grove could not read the clipboard", err);
  }
}

// Protect YAML and code in both editing modes, including a selection that
// starts outside a code block but ends inside it. No scan runs while typing.
function protectedSelection(view: EditorView): boolean {
  const { state } = view;
  const fm = state.field(frontmatterField, false);
  if (fm && state.selection.ranges.some(r => r.from <= fm.end)) return true;
  const to = Math.max(...state.selection.ranges.map(r => r.to));
  const tree = ensureSyntaxTree(state, to, 100) ?? syntaxTree(state);
  let code = false;
  for (const r of state.selection.ranges) tree.iterate({ from: r.from, to: r.to, enter(node) {
    if (/^(FencedCode|CodeBlock|InlineCode)$/.test(node.name)) code = true;
  } });
  return code;
}

function insertText(view: EditorView, text: string) {
  if (view.state.readOnly) return;
  view.dispatch(view.state.replaceSelection(text), {
    userEvent: "input.paste", scrollIntoView: true, annotations: isolateHistory.of("full"),
  });
}

function insertRich(view: EditorView, html: string, plain: string): boolean {
  if (!html || !view.state.facet(autoConvertHTML) || protectedSelection(view)) return false;
  const markdown = htmlToMarkdown(html);
  if (markdown == null || markdown === plain) return false;
  insertText(view, markdown);
  return true;
}

function insertUrl(view: EditorView, text: string): boolean {
  // URL paste keeps the word selected; the caret change belongs to Part B.
  if (/^(?:https?:\/\/|mailto:|www\.)\S+$/i.test(text) && view.state.selection.ranges.some(r => !r.empty) && !protectedSelection(view)) {
    view.dispatch(view.state.changeByRange(r => ({
      changes: { from: r.from, to: r.to, insert: r.empty ? text : `[${view.state.sliceDoc(r.from, r.to)}](${text})` },
      range: r.empty ? EditorSelection.cursor(r.from + text.length) : EditorSelection.range(r.from + 1, r.to + 1),
    })), { userEvent: "input.paste", scrollIntoView: true, annotations: isolateHistory.of("full") });
    return true;
  }
  return false;
}

/** One paste handler, shared by native keyboard and context-menu paste. */
export const clipboard = [
  keymap.of([{ key: "Mod-Shift-v", run: view => { void paste(view, true); return true; } }]),
  EditorView.domEventHandlers({ paste(event, view) {
    if (view.state.readOnly) return true;
    const data = event.clipboardData;
    if (!data || data.files.length) return false;
    const text = data.getData("text/plain");
    if (insertRich(view, data.getData("text/html"), text)) return true;
    if (insertUrl(view, text)) return true;
    return false; // CodeMirror retains its ordinary, linewise and multi-cursor paste.
  } }),
];
