// Clipboard commands and the note's single native paste handler.
// The context menu uses native clipboard commands first and the async
// clipboard API as a fallback. Native HTML paste and that fallback share
// conversion; ordinary text stays with CodeMirror's clipboard handling.
// Also how the app copies paths, URLs, code blocks and images.

import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { clipboardFiles } from "./attachments";
import { frontmatterField } from "./frontmatter";
import { editorHost } from "./host";
import { htmlToMarkdown } from "./htmlToMarkdown";

export const autoConvertHTML = Facet.define<boolean, boolean>({ combine: values => values[0] ?? true });

const selectedText = (view: EditorView) =>
  view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join(view.state.lineBreak);

/** Put text on the clipboard (a code block's copy button, Copy path, Copy URL). */
export const writeClipboard = (text: string) => void navigator.clipboard.writeText(text).catch((err) => console.warn("Grove could not write the clipboard", err));

/**
 * Plain text the way the editor context menu reads the clipboard: the native
 * paste command first, then the async clipboard API. The paste event is
 * consumed so it is not inserted into a focused editor as well.
 */
export function readClipboardText(): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("paste", onPaste, true);
      resolve(text);
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      finish(event.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("paste", onPaste, true);
    let commanded = false;
    try { commanded = document.execCommand("paste"); } catch { commanded = false; }
    if (settled) return;
    document.removeEventListener("paste", onPaste, true);
    if (commanded) { finish(""); return; }
    void navigator.clipboard.readText().then(finish, (err) => {
      console.warn("Grove could not read the clipboard", err);
      finish("");
    });
  });
}

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

/** Clipboard images the paste event didn't carry, saved as attachments. */
async function pasteImages(view: EditorView): Promise<boolean> {
  if (!navigator.clipboard?.read) return false;
  const items = await navigator.clipboard.read().catch(() => []);
  const files: File[] = [];
  for (const item of items) {
    // Text alongside an image stays a text paste (the file-bearing clipboard case).
    if (item.types.includes("text/plain") || item.types.includes("text/html")) continue;
    const type = item.types.find((t) => t.startsWith("image/"));
    if (!type) continue;
    files.push(new File([await item.getType(type)], "image.png", { type }));
  }
  if (!files.length) return false;
  return (await view.state.facet(editorHost)?.saveAttachments?.(view, files)) ?? false;
}

export async function paste(view: EditorView, plain: boolean) {
  if (view.state.readOnly) return;
  view.focus();
  if (!plain && document.execCommand("paste")) return;
  try {
    if (!plain && await pasteImages(view)) return;
    if (!plain && navigator.clipboard.read) {
      const items = await navigator.clipboard.read().catch(() => []);
      const item = items.find(item => item.types.includes("text/html"));
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
  if (/^(?:https?:\/\/|mailto:|xmpp:|www\.)\S+$/i.test(text) && view.state.selection.ranges.some(r => !r.empty) && !protectedSelection(view)) {
    const url = /^www\./i.test(text) ? "https://" + text : text;
    view.dispatch(view.state.changeByRange(r => {
      const insert = r.empty ? url : `[${view.state.sliceDoc(r.from, r.to)}](${url})`;
      // Over a selection the whole link stays selected, as in Obsidian. A bare URL leaves the caret after it.
      const range = r.empty ? EditorSelection.cursor(r.from + insert.length) : EditorSelection.range(r.from, r.from + insert.length);
      return { changes: { from: r.from, to: r.to, insert }, range };
    }), { userEvent: "input.paste", scrollIntoView: true, annotations: isolateHistory.of("full") });
    return true;
  }
  return false;
}

/** One paste handler, shared by native keyboard and context-menu paste. */
export const clipboard = [
  keymap.of([{ key: "Mod-Shift-v", run: view => { void paste(view, true); return true; } }]),
  EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return true;
      const data = event.clipboardData;
      if (!data) return false;
      const text = data.getData("text/plain");
      const html = data.getData("text/html");
      const files = clipboardFiles(data);
      // A file that arrives with text stays a plain paste, as before: CodeMirror
      // inserts the text and the HTML converter does not run. A file or image
      // with no text is saved as an attachment.
      if (files.length && (text || html)) return false;
      if (files.length) {
        void view.state.facet(editorHost)?.saveAttachments?.(view, files);
        return true;
      }
      if (!text && !html && [...data.types].some((t) => t.startsWith("image/"))) {
        void pasteImages(view);
        return true;
      }
      if (insertRich(view, html, text)) return true;
      if (insertUrl(view, text)) return true;
      return false; // CodeMirror retains its ordinary, linewise and multi-cursor paste.
    },
    dragover(event, view) {
      const types = event.dataTransfer?.types;
      if (!types || ![...types].includes("Files")) return false;
      event.dataTransfer!.dropEffect = view.state.readOnly ? "none" : "copy";
      return true;
    },
    drop(event, view) {
      const files = event.dataTransfer ? [...event.dataTransfer.files] : [];
      if (!files.length) return false;
      if (view.state.readOnly) return true;
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
      void view.state.facet(editorHost)?.saveAttachments?.(view, files, at, true);
      return true;
    },
  }),
];
