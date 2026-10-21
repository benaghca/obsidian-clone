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
import { type EditorView, WidgetType } from "@codemirror/view";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { fileName, noteName } from "../paths";
import { splitFrontmatter } from "./frontmatter";
import { editorHost } from "./host";
import { destroyed, onDestroy, release, render } from "./render";

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MAX_DEPTH = 5;

export interface EmbedSize {
  alt: string;
  width?: number;
  height?: number;
}

/** "200", "200x100", "caption|200": the size Obsidian reads after the last "|" (an image's alias or alt text). */
export function embedSize(text: string): EmbedSize {
  const m = /^(?:([\s\S]*)\|)?\s*(\d+)(?:x(\d+))?\s*$/.exec(text);
  return m ? { alt: m[1] ?? "", width: Number(m[2]), height: m[3] ? Number(m[3]) : undefined } : { alt: text };
}

/** "Note#Heading" → ["Note", "Heading"]; no "#" → ["Note", ""]. */
export function splitSubpath(target: string): [string, string] {
  const hash = target.indexOf("#");
  return hash < 0 ? [target.trim(), ""] : [target.slice(0, hash).trim(), target.slice(hash + 1).trim()];
}

/**
 * The part of a note an embed's #subpath shows: a heading's section (to the
 * next heading of its level or above), or for "^id" the paragraph ending in
 * " ^id" (without it). Null if there is no such heading or block.
 */
export function embedSection(text: string, sub: string): string | null {
  const lines = text.split("\n");
  if (sub.startsWith("^")) {
    const mark = ` ^${sub.slice(1)}`;
    const at = lines.findIndex((l) => l.trimEnd().endsWith(mark));
    if (at < 0) return null;
    let a = at;
    let b = at;
    while (a > 0 && lines[a - 1].trim()) a--;
    while (b + 1 < lines.length && lines[b + 1].trim()) b++;
    lines[at] = lines[at].trimEnd().slice(0, -mark.length);
    return lines.slice(a, b + 1).join("\n");
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
    } else if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join("\n");
  }
  return start < 0 ? null : lines.slice(start).join("\n");
}

/** A note's text without its frontmatter (an embed doesn't show it). */
const body = (text: string) => {
  const fm = splitFrontmatter(text);
  return fm ? text.split("\n").slice(fm.close + 1).join("\n") : text;
};

/** "Edit this block" on an image: its source shows, path selected, until the selection moves. */
const editEmbed = StateEffect.define<number>();
export const editingEmbed = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(editEmbed)) return e.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/** Clicks on links inside a widget go to Live Preview's link handling; anything else is the widget's. */
export const isLinkEvent = (e: Event) => !!(e.target as Element).closest?.("[data-href]");

const missingBox = (text: string, onclick?: () => void) =>
  h("span", { class: `internal-embed file-embed mod-empty${onclick ? " is-clickable" : ""}`, onclick }, text);

export class ImageWidget extends WidgetType {
  constructor(
    readonly path: string | null,
    /** The link as written, and where its path is from the embed's start (for "Edit this block"). */
    readonly src: string,
    readonly srcAt: number,
    readonly size: EmbedSize,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.path === this.path && o.src === this.src && o.srcAt === this.srcAt && o.size.alt === this.size.alt && o.size.width === this.size.width && o.size.height === this.size.height;
  }
  toDOM(view: EditorView) {
    const host = view.state.facet(editorHost)?.embeds;
    const { path, size } = this;
    if (!path || !host) return missingBox(`“${this.src}” could not be found.`);
    const img = h("img", { alt: size.alt || fileName(path) });
    img.decoding = "async";
    if (size.width) img.width = size.width;
    if (size.height) img.height = size.height;
    const edit = h("div", { class: "embed-action edit-block-button", "aria-label": "Edit this block", title: "Edit this block" }, icon("code-xml"));
    const dom = h("span", { class: "internal-embed media-embed image-embed" }, img, h("span", { class: "embed-actions" }, edit));
    edit.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const at = view.posAtDOM(dom);
      const from = at + this.srcAt;
      view.dispatch({ selection: EditorSelection.range(from, from + this.src.length), effects: editEmbed.of(at) });
      view.focus();
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
      held = null;
    });
    return dom;
  }
  destroy(dom: HTMLElement) {
    destroyed(dom);
  }
}

export class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly path: string | null,
    readonly chain: readonly string[],
  ) {
    super();
  }
  eq(o: NoteEmbedWidget) {
    return o.target === this.target && o.path === this.path && o.chain.join("\0") === this.chain.join("\0");
  }
  toDOM(view: EditorView) {
    const host = view.state.facet(editorHost);
    const embeds = host?.embeds;
    const [name, sub] = splitSubpath(this.target);
    const { path, chain } = this;
    const open = () => host?.openLink(this.target, false, view);
    if (!path || !embeds) return missingBox(`“${name}” is not created yet. Click to create.`, open);
    if (chain.length >= MAX_DEPTH || [embeds.pathOf(view), ...chain].includes(path)) {
      return h("span", { class: "internal-embed file-embed is-clickable", onclick: open }, icon("file"), fileName(path));
    }
    const content = h("div", { class: "markdown-embed-content" });
    const link = h("div", { class: "markdown-embed-link", "aria-label": "Open link", title: "Open link", onclick: open }, icon("maximize-2"));
    const dom = h("span", { class: "internal-embed markdown-embed" }, h("div", { class: "markdown-embed-title" }, sub ? "" : noteName(path)), content, link);
    let painted: ReturnType<typeof render> | null = null;
    let gone = false;
    const fill = () =>
      void embeds.read(path).then((text) => {
        if (gone) return;
        if (painted) release(painted);
        content.replaceChildren();
        const shown = sub ? embedSection(body(text), sub) : body(text);
        if (shown === null) content.append(missingBox(`Unable to find “${sub}” in “${noteName(path)}”.`));
        else painted = render(content, shown, view, [...chain, path]);
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
  destroy(dom: HTMLElement) {
    destroyed(dom);
  }
  ignoreEvent(e: Event) {
    return !isLinkEvent(e);
  }
}
