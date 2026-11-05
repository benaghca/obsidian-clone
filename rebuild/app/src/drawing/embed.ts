// A ![[drawing.excalidraw]] embed, and ![[drawing.excalidraw|400]]. Read-only.

import type { EditorView } from "@codemirror/view";
import { editorHost } from "../editor/host";
import { DrawnWidget, onDestroy } from "../editor/render";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { openDrawingImages, renderDrawing, type RenderOptions } from "./render";
import { parseScene } from "./scene";

let embedIds = 0;

export class DrawingEmbedWidget extends DrawnWidget {
  constructor(
    readonly path: string | null,
    readonly src: string,
    readonly width?: number,
    readonly height?: number,
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const editor = view.state.facet(editorHost);
    const embeds = editor?.embeds;
    if (!this.path || !embeds) return h("span", { class: "internal-embed file-embed mod-empty" }, `“${this.src}” could not be found.`);
    const svgHost = h("span", { class: "drawing-embed-body" });
    const open = () => editor?.openLink(this.path ?? this.src, false, view);
    const link = h("div", { class: "markdown-embed-link clickable-icon", "aria-label": "Open link", onclick: (event) => { event.preventDefault(); open(); } }, icon("maximize-2"));
    const dom = h("span", { class: "internal-embed media-embed drawing-embed" }, svgHost, link);
    let images: ReturnType<typeof openDrawingImages> | null = null;
    let text = "";
    let generation = 0;
    const paint = () => {
      const parsed = parseScene(text);
      images?.revoke();
      images = null;
      if (!parsed.ok) {
        svgHost.replaceChildren(h("span", { class: "internal-embed file-embed mod-empty" }, parsed.error));
        return;
      }
      images = openDrawingImages(parsed.scene);
      const opts: RenderOptions = {
        dark: document.documentElement.classList.contains("theme-dark"),
        images: (id) => images?.href(id),
        idPrefix: `em${++embedIds}`,
        paper: true,
      };
      if (this.width) opts.width = this.width;
      if (this.height) opts.height = this.height;
      if (!this.width && !this.height) opts.flexHeight = true;
      svgHost.innerHTML = renderDrawing(parsed.scene, opts).markup;
    };
    const load = () => {
      const mine = ++generation;
      void embeds.read(this.path!).then((next) => {
        if (mine !== generation) return;
        text = next;
        paint();
      }, () => {
        if (mine !== generation) return;
        svgHost.replaceChildren(h("span", { class: "internal-embed file-embed mod-empty" }, `“${this.src}” could not be found.`));
      });
    };
    load();
    const unwatch = embeds.watch(this.path, load);
    let dark = document.documentElement.classList.contains("theme-dark");
    const theme = new MutationObserver(() => {
      const next = document.documentElement.classList.contains("theme-dark");
      if (next === dark || !text) return;
      dark = next;
      paint();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    onDestroy(dom, () => {
      generation++;
      unwatch();
      theme.disconnect();
      images?.revoke();
    });
    return dom;
  }
}
