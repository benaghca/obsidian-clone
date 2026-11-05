// Web pages embedded in a note (W2). `![](address)` alone on a line, where
// the address is http(s) and not an image, shows the live page in a
// sandboxed frame, in Live Preview and Reading view, under a bar with the
// page's host, Reload, Open in browser and "Edit this block". Dragging the
// corner resizes it, which writes "|WxH" into the alt text (`![|600x400](…)`,
// one undo step); a double-click on the corner drops the size. YouTube and
// Vimeo pages become their players, which are made to be framed.
//
// This is the one place Grove reaches the network, and only for frames the
// note's own text asks for. Settings → Editor → Embedded web pages: Always
// (the default), Click to load, or Off (the address stays a link chip). A
// view without the setting, such as a canvas card's, shows links only.
// Before a frame is created its origin is registered with the backend
// (`allow_frame_origin`, W1); the navigation guard lets a frame load only
// registered origins and keeps the main window on the app. The frame has
// no `allow-top-navigation` (it cannot move Grove away), no `allow-popups`
// (new windows are denied anyway), no `allow=` features (no camera,
// microphone, location or clipboard) and sends no referrer.

import { EditorSelection, Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { dragPointer, h, iconButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { editEmbed } from "./embeds";
import { editorHost } from "./host";
import { DrawnWidget, onDestroy, readingMode } from "./render";

export type WebEmbedMode = "always" | "click" | "off";

/** Settings → Editor → Embedded web pages. Views that don't set it (canvas cards) show links only. */
export const webEmbedMode = Facet.define<WebEmbedMode, WebEmbedMode>({ combine: (values) => values[0] ?? "off" });

/** What the frame may do: run its scripts as its own origin and submit its forms. Nothing that reaches Grove's window. */
export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms";

const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** An http(s) address with a host and no user name, whose path isn't an image: a page an embed may show. */
export function isWebPage(url: string): boolean {
  if (!/^https?:\/\/[^\s/?#]/i.test(url) || /\s/.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && !u.username && !u.password && !IMAGE_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export const DEFAULT_HEIGHT = 480;
export const MIN_WIDTH = 240;
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 2400;

export interface WebSize {
  /** The alt text without its size. */
  caption: string;
  /** The width written, or null: the note's full width. */
  width: number | null;
  /** The height written, or null: the default. */
  height: number | null;
}

/** "600x400", "x380", "600", "caption|600x400": the size after the last "|", as Cinder writes it. */
const WEB_SIZED = /^(?:([\s\S]*)\|)?\s*(\d+)?\s*(?:x\s*(\d+))?\s*$/;

export function webEmbedSize(alt: string): WebSize {
  const m = WEB_SIZED.exec(alt);
  if (!m || (!m[2] && !m[3])) return { caption: alt, width: null, height: null };
  return { caption: m[1] ?? "", width: m[2] ? Number(m[2]) : null, height: m[3] ? Number(m[3]) : null };
}

/** The frame's height in pixels: the size written, kept between 120 and 2400. */
export const frameHeight = (size: WebSize) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, size.height ?? DEFAULT_HEIGHT));

/**
 * The alt text after a resize to `width` (null: full width) by `height`
 * (null: no size at all): "" → "|600x400", "caption|200" → "caption|600x400",
 * "caption" → "caption|x400"; with both null, the caption alone.
 */
export function resizedWebAlt(alt: string, width: number | null, height: number | null): string {
  const { caption } = webEmbedSize(alt);
  if (width === null && height === null) return caption;
  return `${caption}|${width ?? ""}${height === null ? "" : `x${height}`}`;
}

/** "90", "90s", "1m30s", "1h2m3s" → seconds; null when it isn't a time. */
function seconds(t: string | null): number | null {
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** `url` with its host and path replaced (and https), its query `query`: a player address built from the page's own. */
function rebuilt(url: URL, host: string, path: string, query: Record<string, string> = {}) {
  const out = new URL(url.href);
  out.protocol = "https:";
  out.username = "";
  out.password = "";
  out.host = host;
  out.pathname = path;
  out.search = "";
  out.hash = "";
  for (const [k, v] of Object.entries(query)) out.searchParams.set(k, v);
  return out.href;
}

/**
 * What the frame loads for a page: a YouTube video (watch, youtu.be,
 * shorts, live) becomes its privacy-enhanced player, starting at its `t`; a
 * Vimeo video, its player (an unlisted video keeps its hash). Anything else
 * loads as it is.
 */
export function playerUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  let video: string | null = null;
  if (host === "youtube.com") {
    if (u.pathname === "/watch") video = u.searchParams.get("v");
    else if (parts.length === 2 && (parts[0] === "shorts" || parts[0] === "live")) video = parts[1];
  } else if (host === "youtu.be" && parts.length === 1) video = parts[0];
  if (video && /^[\w-]{6,20}$/.test(video)) {
    const start = seconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    return rebuilt(u, "www.youtube-nocookie.com", `/embed/${video}`, start ? { start: String(start) } : {});
  }
  if (host === "vimeo.com" && /^\d+$/.test(parts[0] ?? "") && parts.length <= 2) {
    const hash: Record<string, string> = parts[1] && /^[0-9a-f]+$/i.test(parts[1]) ? { h: parts[1] } : {};
    if (parts.length === 1 || hash.h) return rebuilt(u, "player.vimeo.com", `/video/${parts[0]}`, hash);
  }
  return url;
}

const isDomainName = (host: string) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) && !/^[\d.]+$/.test(host);

/**
 * The origins to register before framing `src`: its own, and, so the
 * redirects sites make on their own address still load, the same host
 * with or without "www.", and https for an http address. Only for a domain
 * name without a port; an IP address or a port is its origin alone.
 */
export function frameOrigins(src: string): string[] {
  const u = new URL(src);
  const out = new Set([u.origin]);
  if (u.port || !isDomainName(u.hostname)) return [...out];
  const hosts = [u.hostname, u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`];
  const schemes = u.protocol === "http:" ? ["http:", "https:"] : ["https:"];
  for (const scheme of schemes) {
    for (const host of hosts) {
      const twin = new URL(u.href);
      twin.protocol = scheme;
      twin.hostname = host;
      out.add(twin.origin);
    }
  }
  return [...out];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Pages loaded this session with "Click to load": drawn again (scrolled back, the note reopened), they load without asking. */
const clicked = new Set<string>();

/** Each embed's current widget, by its DOM: a resize keeps the frame and swaps the widget in place. */
const drawn = new WeakMap<HTMLElement, { widget: WebEmbedWidget; size(): void }>();

export class WebEmbedWidget extends DrawnWidget {
  constructor(
    /** The page's address, as the note links it. */
    readonly url: string,
    /** The alt text, and where it starts from the embed's start (a resize writes there). */
    readonly alt: string,
    readonly altAt: number,
    /** Where the address starts from the embed's start, and its length in the note ("Edit this block" selects it). */
    readonly urlAt: number,
    readonly urlLength: number,
    readonly mode: Exclude<WebEmbedMode, "off">,
    readonly reading: boolean,
  ) {
    super();
  }
  get estimatedHeight() {
    return frameHeight(webEmbedSize(this.alt)) + 36;
  }
  toDOM(view: EditorView) {
    const { url } = this;
    const host = hostOf(url);
    const frame = h("div", { class: "web-embed-frame" });
    const bar = h("div", { class: "web-embed-bar" });
    const corner = h("div", { class: "web-embed-corner", "aria-label": "Drag to resize (double-click: default size)" });
    const dom = h("div", { class: "web-embed", "data-url": url }, bar, frame, corner);
    const widget = () => drawn.get(dom)?.widget ?? this;

    const button = (name: "rotate-cw" | "external-link" | "code-xml", label: string, run: (e: MouseEvent) => void) => {
      const b = iconButton(icon(name), label, undefined, "web-embed-action");
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        run(e);
      });
      return b;
    };
    const loadButton = h("button", { class: "web-embed-load mod-cta" }, "Load");
    const reload = button("rotate-cw", "Reload", () => load());
    reload.classList.add("web-embed-reload");
    // Only a real click leaves the app (as with any link).
    const open = button("external-link", "Open in browser", (e) => {
      if (!e.isTrusted) return;
      view.state.facet(editorHost)?.openUrl(url);
    });
    const edit = button("code-xml", "Edit this block", () => {
      const at = view.posAtDOM(dom);
      const from = at + widget().urlAt;
      view.dispatch({ selection: EditorSelection.range(from, from + widget().urlLength), effects: editEmbed.of(at) });
      view.focus();
    });
    bar.append(
      h("span", { class: "web-embed-host" }, icon("globe"), host),
      h("span", { class: "web-embed-url", title: url }, url.replace(/^https?:\/\//i, "")),
      loadButton,
      reload,
      open,
    );
    edit.classList.add("web-embed-edit");
    if (!this.reading) bar.append(edit);

    let gone = false;
    let generation = 0;
    const fail = (why: string) => {
      dom.classList.remove("is-loaded");
      frame.replaceChildren(h("div", { class: "web-embed-message mod-error" }, why));
    };
    // Register the page's origins, then frame it. A newer load (Reload) wins over one still registering.
    const load = () => {
      const mine = ++generation;
      const src = playerUrl(url);
      clicked.add(url);
      dom.classList.add("is-asked");
      const allow = view.state.facet(editorHost)?.allowFrameOrigin;
      let origins: string[];
      try {
        origins = frameOrigins(src);
      } catch {
        return fail("This address can't be embedded.");
      }
      if (!allow) return fail("Web pages can't be shown here. Open it in the browser instead.");
      Promise.all(origins.map((origin) => allow(origin))).then(
        () => {
          if (gone || mine !== generation) return;
          const f = document.createElement("iframe");
          // The sandbox and referrer policy are set before the address, so the first load has them.
          f.setAttribute("sandbox", FRAME_SANDBOX);
          f.referrerPolicy = "no-referrer";
          f.loading = "lazy";
          f.title = host;
          f.src = src;
          frame.replaceChildren(f);
          dom.classList.add("is-loaded");
        },
        () => !gone && mine === generation && fail("Grove couldn't allow this page to load. Open it in the browser instead."),
      );
    };
    loadButton.addEventListener("mousedown", (e) => e.preventDefault());
    loadButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      load();
    });

    const size = () => {
      const s = webEmbedSize(widget().alt);
      dom.style.maxWidth = s.width ? `${Math.max(MIN_WIDTH, s.width)}px` : "";
      frame.style.height = `${frameHeight(s)}px`;
    };
    drawn.set(dom, { widget: this, size });
    size();

    if (this.mode === "always" || clicked.has(url)) load();
    else {
      const ask = h(
        "button",
        { class: "web-embed-message web-embed-ask" },
        h("span", null, `Load ${host}`),
        h("small", null, "This page comes from the web. Settings → Editor can load pages without asking."),
      );
      ask.addEventListener("mousedown", (e) => e.preventDefault());
      ask.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        load();
      });
      frame.append(ask);
    }

    // The corner resizes the page as it goes (it stays loaded); the size is written on release, one undo step.
    corner.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || view.state.readOnly || view.state.facet(readingMode)) return;
      e.preventDefault();
      e.stopPropagation();
      const line = dom.parentElement;
      const style = line ? getComputedStyle(line) : null;
      const full = line ? line.clientWidth - parseFloat(style!.paddingLeft) - parseFloat(style!.paddingRight) : Infinity;
      const w0 = dom.getBoundingClientRect().width;
      const h0 = frame.getBoundingClientRect().height;
      let width = w0;
      let height = h0;
      dom.classList.add("is-resizing");
      dragPointer(e, corner, (m) => {
        width = Math.round(Math.max(MIN_WIDTH, Math.min(full, w0 + m.clientX - e.clientX)));
        height = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h0 + m.clientY - e.clientY)));
        dom.style.maxWidth = width >= full - 2 ? "" : `${width}px`;
        frame.style.height = `${height}px`;
        corner.dataset.size = `${width >= full - 2 ? "full width" : width} × ${height}`;
      }, (cancelled) => {
        dom.classList.remove("is-resizing");
        delete corner.dataset.size;
        if (cancelled || (Math.abs(width - w0) < 2 && Math.abs(height - h0) < 2)) return size();
        write(width >= full - 2 ? null : width, height);
      });
    });
    corner.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (view.state.readOnly || view.state.facet(readingMode)) return;
      write(null, null);
    });
    const write = (width: number | null, height: number | null) => {
      const w = widget();
      const next = resizedWebAlt(w.alt, width, height);
      if (next === w.alt || !dom.isConnected) return size();
      const at = view.posAtDOM(dom) + w.altAt;
      view.dispatch({ changes: { from: at, to: at + w.alt.length, insert: next }, userEvent: "input.resize" });
    };

    onDestroy(dom, () => {
      gone = true;
    });
    return dom;
  }
  /** The same page in the same mode keeps its frame: only the size (and where its text is) changes. */
  updateDOM(dom: HTMLElement, _view: EditorView, from: WebEmbedWidget) {
    const live = drawn.get(dom);
    if (!live || from.url !== this.url || from.mode !== this.mode || from.reading !== this.reading) return false;
    live.widget = this;
    live.size();
    return true;
  }
}
