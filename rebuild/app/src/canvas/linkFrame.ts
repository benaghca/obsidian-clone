// The body of a canvas link card. The address stays text until this card has a
// frame slot (on screen, above the title size, and inside the cap of six).
// The frame element itself is created in webEmbed.ts, with the note embeds.

import { api } from "../api";
import { armWebFrame, createWebFrame, parseWebEmbedMode, webFrameTarget } from "../editor/webEmbed";
import { isExternalUrl } from "../links/external";
import { h } from "../shell/dom";
import { settings } from "../settings/store";
import type { CanvasNode } from "./model";

export interface FrameHost {
  slotted(id: string): boolean;
  ready(node: CanvasNode): void;
  recheck(prefer?: string): void;
}

type Showing = "none" | "text" | "ask" | "frame";

export function linkFrameBody(node: CanvasNode, content: HTMLElement, host: FrameHost) {
  let asked = false;
  let token = 0;
  let showing: Showing = "none";

  const mode = () => parseWebEmbedMode(settings.get("app.json").webEmbeds);
  const target = () => webFrameTarget(node.url ?? "");
  const wantsFrame = () => {
    const embed = mode();
    return embed !== "off" && (embed === "always" || asked) && !!target();
  };

  function openUrl(url: string) {
    if (isExternalUrl(url)) void api.openExternal(url).catch(console.warn);
  }

  function urlLink() {
    const url = node.url ?? "";
    const link = h("a", { class: "cm-link cm-rendered-link canvas-web-url", role: "link", tabindex: "0" }, url);
    const open = (e: Event) => {
      if (!e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      openUrl(url);
    };
    link.addEventListener("click", open);
    link.addEventListener("keydown", e => { if (e.key === "Enter") open(e); });
    return link;
  }

  function action(cls: string, label: string, name: string, run: () => void) {
    const button = h("button", { type: "button", class: cls, "aria-label": name }, label);
    // A finished press. click is not delivered when the press never moved.
    button.addEventListener("pointerup", e => {
      if (!e.isTrusted || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    });
    button.addEventListener("keydown", e => {
      if (!e.isTrusted || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    });
    return button;
  }

  function showText(ask: boolean) {
    content.classList.remove("canvas-web");
    content.classList.toggle("canvas-web-ask", ask);
    if (ask) {
      // The address and Load share one bar. A short card clips a button that sits under the URL.
      const bar = h("div", { class: "canvas-web-bar" });
      bar.append(urlLink(), action("canvas-web-load", "Load", "Load page", () => { asked = true; host.recheck(node.id); }));
      content.replaceChildren(bar);
    } else content.replaceChildren(urlLink());
    showing = ask ? "ask" : "text";
  }

  function release() {
    token++;
    asked = false;
    if (showing !== "frame") return;
    content.classList.remove("canvas-web");
    content.replaceChildren();
    showing = "none";
  }

  function reload() {
    const frame = content.querySelector("iframe");
    const page = target();
    if (!frame || !page || showing !== "frame") return;
    const mine = ++token;
    frame.removeAttribute("src");
    void armWebFrame(frame, page, () => mine === token && showing === "frame" && frame.isConnected).then(() => {
      if (mine === token) host.ready(node);
    }, () => {
      if (mine !== token) return;
      showText(false);
      host.ready(node);
    });
  }

  function openPage() {
    const page = target();
    openUrl(page?.href ?? node.url ?? "");
  }

  async function showFrame() {
    const page = target();
    if (!page) { showText(false); host.ready(node); return; }
    const mine = ++token;
    const bar = h("div", { class: "canvas-web-bar" });
    bar.append(urlLink(), action("canvas-web-reload", "Reload", "Reload", reload), action("canvas-web-open", "Open", "Open in browser", openPage));
    const frame = createWebFrame("Embedded page");
    frame.className = "canvas-web-frame";
    content.classList.remove("canvas-web-ask");
    content.classList.add("canvas-web");
    content.replaceChildren(bar, frame);
    showing = "frame";
    try {
      await armWebFrame(frame, page, () => mine === token && showing === "frame");
    } catch {
      if (mine !== token) return;
      showText(false);
      host.ready(node);
      return;
    }
    if (mine !== token) return;
    if (!frame.isConnected || !frame.getAttribute("src")) showText(mode() === "click" && !asked);
    host.ready(node);
  }

  function ensure() {
    const page = target();
    const embed = mode();
    const should = embed !== "off" && (embed === "always" || asked) && !!page && host.slotted(node.id);
    if (should) {
      if (showing === "frame") return;
      void showFrame();
      return;
    }
    asked = false;
    const ask = embed === "click" && !!page;
    if (showing === "frame") release();
    if ((ask && showing === "ask") || (!ask && showing === "text")) return;
    showText(ask);
  }

  function ready() {
    if (showing === "text" || showing === "ask") return true;
    if (showing !== "frame") return false;
    return !!content.querySelector("iframe")?.getAttribute("src");
  }

  return { element: content, frame: true as const, wantsFrame, ensure, release, ready };
}
