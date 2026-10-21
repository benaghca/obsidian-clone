// An image's "Zoom in", as Obsidian 1.14.4 shows it (observed): the image
// at its own size (at most the window's) over a black backdrop at 90%, its
// alt text or file name in a bar along the top and a close button on the
// right. It glides there from its place in the note and back when closed.
// Escape, the close button or a click beside the image closes it; a click
// on the image itself doesn't.

import { animateOut, duration, easing } from "../motion";
import { h, iconButton } from "../shell/dom";
import { icon } from "../shell/icons";

/** The transform that puts `to`'s box where `from`'s is. */
const flip = (from: DOMRect, to: DOMRect) =>
  `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width || 1})`;

export function zoomImage(source: HTMLImageElement, title: string) {
  const img = h("img", { alt: title });
  img.src = source.currentSrc || source.src;
  img.draggable = false;
  img.style.visibility = "hidden"; // until it can start from its place in the note
  const box = h(
    "div",
    { class: "lightbox", tabindex: "-1" },
    h("div", { class: "lightbox-bg" }),
    h("div", { class: "lightbox-content" }, img),
    h("div", { class: "lightbox-titlebar" }, title),
    iconButton(icon("x"), "Close", undefined, "modal-close-button"),
  );
  const glide = (reverse: boolean) => {
    if (!source.isConnected) return;
    const frames = [{ transform: flip(source.getBoundingClientRect(), img.getBoundingClientRect()) }, { transform: "none" }];
    img.animate(reverse ? frames.reverse() : frames, { duration: duration("moderate"), easing: easing(reverse ? "in" : "out"), fill: "forwards" });
  };
  const focused = document.activeElement as HTMLElement | null;
  const close = () => {
    removeEventListener("keydown", onKey, true);
    focused?.focus();
    glide(true);
    void animateOut(box);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  box.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (e.button === 0 && e.target !== img) close();
  });
  addEventListener("keydown", onKey, true);
  document.body.append(box);
  box.focus();
  void img.decode().finally(() => {
    img.style.visibility = "";
    glide(false);
  });
}
