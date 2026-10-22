// ![[embeds]] as Obsidian draws them (observed in Obsidian 1.14.4). An image
// in the vault (![[pic.png|200]], ![alt](pics/a.png)) shows inline at its
// size, and stays an image while the caret passes it: its "Edit this block"
// button shows the source, with the link's path selected. A note
// (![[Note]], ![[Note#Heading]], ![[Note#^block]]) shows its text, rendered
// as Reading view renders it (render.ts), under a thin accent bar with an
// "Open link" button. A missing file shows a grey box saying so.
//
// Files are read through the app's EmbedHost when an embed is first drawn,
// never per keystroke; an embed redraws when its file changes. A note
// already being drawn further out (a note embedding itself, A ↔ B), or five
// embeds deep, shows as a small file chip instead.

import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { dragPointer, h } from "../shell/dom";
import { icon } from "../shell/icons";
import { fileName, noteName } from "../paths";
import { splitFrontmatter } from "./frontmatter";
import { editorHost } from "./host";
import { zoomImage } from "./imageZoom";
import { DrawnWidget, editAt, editButton, isLinkEvent, onDestroy, readingMode, release, render, widgetAction } from "./render";

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MAX_DEPTH = 5;

export interface EmbedSize {
  alt: string;
  width?: number;
  height?: number;
}

/** "200", "200x100", "caption|200": the size Obsidian reads after the last "|" (an image's alias or alt text). */
const SIZED = /^(?:([\s\S]*)\|)?\s*(\d+)(?:x(\d+))?\s*$/;
export function embedSize(text: string): EmbedSize {
  const m = SIZED.exec(text);
  return m ? { alt: m[1] ?? "", width: Number(m[2]), height: m[3] ? Number(m[3]) : undefined } : { alt: text };
}

/** "Note#Heading" → ["Note", "Heading"]; no "#" → ["Note", ""]. */
export function splitSubpath(target: string): [string, string] {
  const hash = target.indexOf("#");
  return hash < 0 ? [target.trim(), ""] : [target.slice(0, hash).trim(), target.slice(hash + 1).trim()];
}

/** Some lines of a note, and the line (from 0) they start at. */
export interface NotePart {
  text: string;
  line: number;
}

/**
 * The part of a note an embed's #subpath shows: a heading's section (to the
 * next heading of its level or above), or for "^id" the paragraph ending in
 * " ^id" (without it). Null if there is no such heading or block.
 */
export function embedSection(text: string, sub: string): NotePart | null {
  const lines = text.split("\n");
  if (sub.startsWith("^")) {
    const mark = ` ^${sub.slice(1)}`;
    const at = lines.findIndex((l) => l.trimEnd().endsWith(mark));
    if (at < 0) return null;
    let a = at;
    let b = at;
    const inPara = (l: string) => !!l.trim() && !/^#{1,6}\s/.test(l);
    while (a > 0 && inPara(lines[a - 1])) a--;
    while (b + 1 < lines.length && inPara(lines[b + 1])) b++;
    lines[at] = lines[at].trimEnd().slice(0, -mark.length);
    return { text: lines.slice(a, b + 1).join("\n"), line: a };
  }
  const want = sub.split("#").pop()!.trim().toLowerCase();
  let start = -1;
  let level = 0;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const m = fence ? null : /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start < 0 && m[2].toLowerCase() === want) {
      start = i;
      level = m[1].length;
    } else if (start >= 0 && m[1].length <= level) return { text: lines.slice(start, i).join("\n").trimEnd(), line: start };
  }
  return start < 0 ? null : { text: lines.slice(start).join("\n").trimEnd(), line: start };
}

/** What an embed of a note shows (#subpath: its section), without the frontmatter. */
export function embedPart(text: string, sub: string): NotePart | null {
  const fm = splitFrontmatter(text);
  const skip = fm ? fm.close + 1 : 0;
  const body = { text: fm ? text.split("\n").slice(skip).join("\n") : text, line: 0 };
  const part = sub ? embedSection(body.text, sub) : body;
  return part && { text: part.text, line: part.line + skip };
}

/** Whether an embed of `path` shows only a chip: it is the note on screen (`top`) or one it is drawn inside of, or it is too deep. */
export const embedStopped = (path: string, top: string | null, chain: readonly string[]) =>
  chain.length >= MAX_DEPTH || path === top || chain.includes(path);


/** "Edit this block" on an image: its source shows, path selected, until the selection moves. */
const editEmbed = StateEffect.define<number>();
export const editingEmbed = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(editEmbed)) return e.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/**
 * What a resized image's alt text or alias becomes, `width` wide, as
 * Obsidian writes it: the size replaced ("caption|200" → "caption|358",
 * "100x30" → "358"), or added ("alt" → "alt|358", "" → "358"); null is a
 * wiki embed without an alias, which gets "|358".
 */
export function resizedSize(text: string | null, width: number): string {
  if (text === null) return `|${width}`;
  const m = SIZED.exec(text);
  const caption = m ? m[1] : text || undefined;
  return caption === undefined ? `${width}` : `${caption}|${width}`;
}

/**
 * "Reset size" on an image's embed text (`sizeAt`, `sizeText`: its alt text
 * or alias, as ImageWidget has them): the change that drops the size, as
 * Obsidian writes it ("![[a.png|200]]" → "![[a.png]]", "![alt|150](a.png)"
 * → "![alt](a.png)", "![150](a.png)" → "![](a.png)"); null: it has none.
 */
export function resetSize(embed: string, sizeAt: number, sizeText: string | null): { from: number; to: number; insert: string } | null {
  const m = sizeText === null ? null : SIZED.exec(sizeText);
  if (!m) return null;
  const caption = m[1] ?? "";
  // A wiki embed's "|" goes with its size when nothing is left.
  const from = !caption && embed[sizeAt - 1] === "|" ? sizeAt - 1 : sizeAt;
  return { from, to: sizeAt + sizeText!.length, insert: caption };
}

const missingBox = (text: string, onclick?: () => void) =>
  h("span", { class: `internal-embed file-embed mod-empty${onclick ? " is-clickable" : ""}`, onclick }, text);

export class ImageWidget extends DrawnWidget {
  constructor(
    readonly path: string | null,
    /** The link as written, and where its path is from the embed's start (for "Edit this block"). */
    readonly src: string,
    readonly srcAt: number,
    readonly size: EmbedSize,
    /** Where the alt text or alias is from the embed's start, and what it says (null: none; a resize adds one there). */
    readonly sizeAt: number,
    readonly sizeText: string | null,
    /** The embed's length in the note. */
    readonly length: number,
  ) {
    super();
  }
  toDOM(view: EditorView) {
    const editor = view.state.facet(editorHost);
    const host = editor?.embeds;
    const { path, size } = this;
    if (!path || !host) return missingBox(`“${this.src}” could not be found.`);
    const img = h("img", { alt: size.alt || fileName(path) });
    img.decoding = "async";
    if (size.width) img.width = size.width;
    if (size.height) img.height = size.height;
    const zoom = widgetAction("Zoom in", "zoom-in");
    const actions = editButton(zoom);
    const corner = h("div", { class: "image-resize-corner" });
    const dom = h("span", { class: "internal-embed media-embed image-embed" }, img, actions, corner);
    actions.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (zoom.contains(e.target as Node)) return zoomImage(img, img.alt);
      const at = view.posAtDOM(dom);
      const from = at + this.srcAt;
      view.dispatch({ selection: EditorSelection.range(from, from + this.src.length), effects: editEmbed.of(at) });
      view.focus();
    });
    // Reading view zooms on a click, and on a right-click too (as Obsidian's
    // does); elsewhere a right-click shows the image's menu. In a callout,
    // table or embed the image is part of that block, as in Obsidian: no
    // menu, buttons or resize corner of its own (styles/blocks.css).
    const zoomIn = (e: MouseEvent) => {
      e.preventDefault();
      zoomImage(img, img.alt);
    };
    img.addEventListener("click", (e) => view.state.facet(readingMode) && zoomIn(e));
    dom.addEventListener("contextmenu", (e) => {
      if (view.state.facet(readingMode)) return zoomIn(e);
      if (dom.parentElement?.closest(".cm-callout, .cm-table-widget, .markdown-embed")) return;
      e.preventDefault();
      const from = view.posAtDOM(dom);
      editor?.contextMenu?.(view, { x: e.clientX, y: e.clientY }, from, false, { path, img, from, to: from + this.length, sizeAt: this.sizeAt, sizeText: this.sizeText });
    });
    // Dragging the corner resizes the image as it goes; the size is written on release, one undo step.
    corner.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || view.state.readOnly) return;
      e.preventDefault();
      const start = img.getBoundingClientRect().width;
      let width = this.size.width;
      const resize = (m: PointerEvent) => {
        width = Math.max(16, Math.round(start + m.clientX - e.clientX));
        img.width = width;
        img.removeAttribute("height");
      };
      dragPointer(e, corner, resize, () => {
        if (width === undefined || width === this.size.width) return;
        const at = view.posAtDOM(dom) + this.sizeAt;
        view.dispatch({ changes: { from: at, to: at + (this.sizeText?.length ?? 0), insert: resizedSize(this.sizeText, width) }, userEvent: "input.resize" });
      });
    });
    let held: ReturnType<typeof host.image> | null = null;
    const load = () => {
      held?.release();
      const mine = (held = host.image(path));
      mine.url.then(
        (url) => {
          if (held !== mine) return;
          img.src = url;
          dom.classList.add("is-loaded");
        },
        () => held === mine && dom.replaceChildren(`“${this.src}” could not be loaded.`),
      );
    };
    load();
    const unwatch = host.watch(path, load);
    onDestroy(dom, () => {
      unwatch();
      held?.release();
    });
    return dom;
  }
}

export class NoteEmbedWidget extends DrawnWidget {
  constructor(
    readonly target: string,
    readonly path: string | null,
    readonly chain: readonly string[],
    readonly preview = false,
  ) {
    super();
  }
  toDOM(view: EditorView) {
    const host = view.state.facet(editorHost);
    const embeds = host?.embeds;
    const [name, sub] = splitSubpath(this.target);
    const { path, chain } = this;
    const open = () => host?.openLink(this.target, false, view);
    if (!path || !embeds) return missingBox(`“${name}” is not created yet. Click to create.`, open);
    if (!this.preview && embedStopped(path, embeds.pathOf(view), chain)) {
      return h("span", { class: "internal-embed file-embed is-clickable", onclick: open }, icon("file"), fileName(path));
    }
    const content = h("div", { class: "markdown-embed-content" });
    const link = h("div", { class: "markdown-embed-link clickable-icon", "aria-label": "Open link", title: "Open link", onclick: open }, icon("maximize-2"));
    const dom = h("span", { class: "internal-embed markdown-embed" }, h("div", { class: "markdown-embed-title" }, sub ? "" : noteName(path)), content, link);
    dom.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || this.preview || chain.length || view.state.readOnly || view.state.facet(readingMode) || isLinkEvent(event)) return;
      if ((event.target as Element).closest("input, button, .markdown-embed-link") || dom.parentElement?.closest(".cm-callout, .cm-table-widget, .markdown-embed")) return;
      event.preventDefault();
      const at = view.posAtDOM(dom);
      const line = view.state.doc.lineAt(at);
      editAt(view, line.from + Math.max(0, line.text.lastIndexOf("![[", at - line.from)) + 3);
    });
    let painted: ReturnType<typeof render> | null = null;
    let gone = false;
    const fill = () =>
      void embeds.read(path).then((text) => {
        if (gone) return;
        if (painted) release(painted);
        content.replaceChildren();
        const shown = embedPart(text, this.preview ? "" : sub);
        if (shown === null) content.append(missingBox(`Unable to find “${sub}” in “${noteName(path)}”.`));
        // Ordinary embeds can tick tasks; page previews remain read-only.
        else {
          painted = render(content, shown.text, view, [...chain, path], this.preview ? undefined : (line) => embeds.toggleTask(path, shown.line + line));
          if (this.preview && sub) {
            const section = embedSection(shown.text, sub);
            const target = section && content.querySelector<HTMLElement>(`[data-line="${section.line + 1}"]`);
            const popup = dom.closest<HTMLElement>(".hover-popover");
            if (target && popup) popup.scrollTop = target.offsetTop - popup.offsetTop - 16;
          }
        }
      }, () => {
        if (!gone) content.replaceChildren(missingBox(`“${name}” is not created yet.`));
      });
    fill();
    const unwatch = embeds.watch(path, fill);
    onDestroy(dom, () => {
      gone = true;
      unwatch();
      if (painted) release(painted);
    });
    return dom;
  }
}
